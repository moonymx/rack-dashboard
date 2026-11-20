import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG } from '../config.js';
import { evaluateRow, initialState } from '../alerts.js';

const KEY = `rack_alerts_${CONFIG.rackId}`;

// อ่าน/เขียน localStorage อาจ throw (private window, ปิดคุกกี้) จึงห่อ try/catch เสมอ
const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && Array.isArray(raw.alerts)) return { alerts: raw.alerts, state: raw.state || initialState(), lastTs: raw.lastTs || 0, conn: raw.conn || 'ok' };
  } catch {
    /* ใช้ค่าเริ่มต้น */
  }
  return { alerts: [], state: initialState(), lastTs: 0, conn: 'ok' };
};

/**
 * ตรวจเกณฑ์จากข้อมูลสด (rows) และสถานะการเชื่อมต่อ แล้วสะสมเป็นรายการแจ้งเตือน
 * - เก็บใน localStorage เพื่อให้ยังอยู่หลังรีเฟรช (รับทราบ/ลบแล้วไม่กลับมา)
 * - ประมวลผลเฉพาะแถวที่ ts ใหม่กว่าที่เคยตรวจ จึงไม่ซ้ำเมื่อ effect ทำงานซ้ำ
 */
export function useAlerts({ rows, status, stale, setpoint }) {
  const init = useRef(null);
  if (init.current === null) init.current = load();

  const [alerts, setAlerts] = useState(init.current.alerts);
  const stateRef = useRef(init.current.state);
  const lastTsRef = useRef(init.current.lastTs);
  const connRef = useRef(init.current.conn);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  const persist = useCallback((list) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ alerts: list, state: stateRef.current, lastTs: lastTsRef.current, conn: connRef.current }));
    } catch {
      /* ไม่เป็นไร: ทำงานต่อได้โดยไม่เก็บถาวร */
    }
  }, []);

  const push = useCallback(
    (events) => {
      if (!events.length) return;
      const seen = new Set(alertsRef.current.map((a) => a.id));
      const fresh = events.filter((e) => !seen.has(e.id));
      if (!fresh.length) return;
      const next = [...fresh, ...alertsRef.current].sort((a, b) => b.ts - a.ts).slice(0, CONFIG.maxAlerts);
      alertsRef.current = next;
      setAlerts(next);
      persist(next);
    },
    [persist]
  );

  // ตรวจแถวข้อมูลใหม่ตามลำดับเวลา
  useEffect(() => {
    const fresh = rows.filter((r) => r.ts > lastTsRef.current);
    if (!fresh.length) return;
    const events = [];
    for (const r of fresh) {
      const out = evaluateRow(r, stateRef.current, setpoint);
      stateRef.current = out.state;
      events.push(...out.events);
    }
    lastTsRef.current = fresh[fresh.length - 1].ts;
    if (events.length) push(events);
    else persist(alertsRef.current);
  }, [rows, setpoint, push, persist]);

  // สถานะการเชื่อมต่อ: ออฟไลน์ (danger) / ข้อมูลค้าง (warning) / กลับมาปกติ (success)
  useEffect(() => {
    const level = status === 'offline' ? 'danger' : stale ? 'warning' : status === 'live' ? 'ok' : connRef.current;
    if (level === connRef.current) return;
    const ts = Date.now();
    const prev = connRef.current;
    connRef.current = level;
    if (level === 'danger') push([{ id: `conn:danger:${ts}`, ts, level: 'danger', rule: 'conn', message: 'เชื่อมต่อ MQTT Broker ไม่ได้', ack: false }]);
    else if (level === 'warning') push([{ id: `conn:warning:${ts}`, ts, level: 'warning', rule: 'conn', message: `ไม่ได้รับข้อมูลใหม่เกิน ${CONFIG.liveStaleMs / 1000} วินาที — ตรวจสอบ ESP32`, ack: false }]);
    else if (prev !== 'ok') push([{ id: `conn:success:${ts}`, ts, level: 'success', rule: 'conn', message: 'การเชื่อมต่อและข้อมูลกลับสู่ปกติ', ack: false }]);
  }, [status, stale, push]);

  const addInfo = useCallback(
    (message) => {
      const ts = Date.now();
      push([{ id: `info:${ts}`, ts, level: 'info', rule: 'info', message, ack: false }]);
    },
    [push]
  );

  const update = useCallback(
    (fn) => {
      const next = fn(alertsRef.current);
      alertsRef.current = next;
      setAlerts(next);
      persist(next);
    },
    [persist]
  );

  const ack = useCallback((id) => update((l) => l.map((a) => (a.id === id ? { ...a, ack: true } : a))), [update]);
  const ackAll = useCallback(() => update((l) => l.map((a) => ({ ...a, ack: true }))), [update]);
  const remove = useCallback((id) => update((l) => l.filter((a) => a.id !== id)), [update]);
  const clearAcked = useCallback(() => update((l) => l.filter((a) => !a.ack)), [update]);

  return { alerts, addInfo, ack, ackAll, remove, clearAcked };
}
