import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../config.js';
import { subscribeLive, fetchHistory } from '../data/sources.js';

const mergeRows = (a, b) => {
  const map = new Map();
  [...a, ...b].forEach((r) => map.set(r.ts, r));
  return [...map.values()].sort((x, y) => x.ts - y.ts);
};

const p95 = (arr) => {
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
};

/**
 * mode = 'live'    -> สมัครรับข้อมูลสด + เก็บ rolling window
 * mode = 'history' -> ดึงข้อมูลตามช่วง range = {from, to}
 * enabled=false -> ไม่ทำงาน (ไม่เชื่อมต่อ/ไม่ดึงข้อมูล)
 * เมื่อ mode เปลี่ยน effect เดิมจะถูก cleanup (ปิด MQTT / ยกเลิก fetch) ก่อนเสมอ
 *
 * latency: (เฉพาะโหมด live + ข้อมูลจริง + payload มี timestamp จากอุปกรณ์)
 *   = เวลาที่ข้อความมาถึงเบราว์เซอร์ - timestamp ที่ ESP32 ใส่มา  -> ใช้ประกอบ QR-05
 *   ต้องซิงก์เวลา ESP32 (NTP) และเครื่องที่เปิดแดชบอร์ดให้ตรงกัน
 */
export function useTelemetry({ mode, range, rackId = CONFIG.rackId, historyRackId, enabled = true }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('idle'); // connecting | live | offline | loading | ready | error
  const [error, setError] = useState(null);
  const [latency, setLatency] = useState(null); // {count, p95, max, negative}
  const latRef = useRef([]);

  useEffect(() => {
    if (!enabled) return undefined; // เช่น ตัวดึงข้อมูลย้อนหลังจะทำงานเฉพาะตอนเปิดแท็บ History
    let cancelled = false;
    setRows([]);
    setError(null);
    latRef.current = [];
    setLatency(null);

    if (mode === 'live') {
      // เติมกราฟด้วยข้อมูลย้อนหลังสั้น ๆ ก่อน เพื่อไม่ให้กราฟว่างตอนเริ่ม
      const now = Date.now();
      fetchHistory({ rackId, from: now - CONFIG.liveSeedMinutes * 60000, to: now })
        .then((seed) => {
          if (!cancelled) setRows((prev) => mergeRows(seed, prev).slice(-CONFIG.liveWindowPoints));
        })
        .catch(() => {});

      const unsub = subscribeLive({
        rackId,
        onStatus: (s) => !cancelled && setStatus(s),
        onRow: (row) => {
          if (cancelled) return;
          if (!CONFIG.useMock && row.devTs) {
            const arr = latRef.current;
            arr.push(Date.now() - row.ts);
            if (arr.length > 500) arr.shift();
            setLatency({
              count: arr.length,
              p95: p95(arr),
              max: Math.max(...arr),
              negative: arr.filter((v) => v < 0).length, // > 0 แสดงว่านาฬิกาไม่ตรงกัน
            });
          }
          setRows((prev) => mergeRows(prev, [row]).slice(-CONFIG.liveWindowPoints));
        },
      });
      return () => {
        cancelled = true;
        unsub();
      };
    }

    // history
    setStatus('loading');
    const ctrl = new AbortController();
    fetchHistory({ rackId: historyRackId || rackId, from: range.from, to: range.to, signal: ctrl.signal })
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setStatus('ready');
      })
      .catch((e) => {
        if (cancelled || e.name === 'AbortError') return;
        setError(e.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [mode, rackId, historyRackId, range.from, range.to, enabled]);

  return { rows, status, error, latency };
}
