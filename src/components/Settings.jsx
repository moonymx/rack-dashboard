import React, { useEffect, useState } from 'react';
import { CONFIG } from '../config.js';
import { sendCommand } from '../data/commands.js';
import { fetchSettings } from '../data/sources.js';
import { fmtTime } from '../utils.js';

const MODES = [
  { key: 'manual', label: 'Manual' },
  { key: 'pid_only', label: 'PID only' },
  { key: 'ai_predictive', label: 'AI predictive' },
];
const MODE_LABEL = Object.fromEntries(MODES.map((m) => [m.key, m.label]));
const QR10_LIMIT_MS = 5000;
const QR10_MIN_RUNS = 20;

const p95 = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
};

export default function Settings({ setpoint, onApplied, onCommand }) {
  const [mode, setMode] = useState('pid_only');
  const [draft, setDraft] = useState(setpoint);
  const [manualPwm, setManualPwm] = useState(50);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {type:'ok'|'err', text}
  const [log, setLog] = useState([]); // {t, mode, setpoint, ms, ok}

  // โหลดค่าตั้งปัจจุบันจาก PID_SETTINGS (ผ่าน API)
  useEffect(() => {
    let off = false;
    fetchSettings(CONFIG.rackId).then((s) => {
      if (off) return;
      if (s.control_mode) setMode(s.control_mode);
      if (s.setpoint_temp != null) {
        setDraft(s.setpoint_temp);
        onApplied(s.setpoint_temp);
      }
    });
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async () => {
    setBusy(true);
    setMsg(null);
    const entry = { t: Date.now(), mode, setpoint: draft };
    try {
      const r = await sendCommand({ setpoint: draft, mode, manualPwm: mode === 'manual' ? manualPwm : undefined });
      setLog((l) => [{ ...entry, ms: r.latencyMs, ok: true }, ...l].slice(0, 50));
      onApplied(draft);
      onCommand?.({ setpoint: draft, mode });
      setMsg({ type: 'ok', text: `ESP32 ตอบรับแล้วใน ${(r.latencyMs / 1000).toFixed(2)} วินาที (ไป-กลับ)` });
    } catch (e) {
      setLog((l) => [{ ...entry, ms: null, ok: false }, ...l].slice(0, 50));
      setMsg({ type: 'err', text: e.message || 'ส่งคำสั่งไม่สำเร็จ' });
    } finally {
      setBusy(false);
    }
  };

  const okMs = log.filter((x) => x.ok).map((x) => x.ms);
  const exportLog = () => {
    const lines = ['time,mode,setpoint,roundtrip_ms,ok', ...log.map((x) => [new Date(x.t).toISOString(), x.mode, x.setpoint, x.ms == null ? '' : x.ms.toFixed(0), x.ok].join(','))];
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr10_command_latency_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="settings">
      <section className="panel">
        <h3>โหมดควบคุม</h3>
        <div className="seg">
          {MODES.map((m) => (
            <button key={m.key} className={mode === m.key ? 'on' : ''} onClick={() => setMode(m.key)} disabled={busy}>
              {m.label}
            </button>
          ))}
        </div>
        {mode === 'manual' && (
          <label className="slider">
            <span>PWM Duty Cycle (Manual): <b>{manualPwm}%</b></span>
            <input type="range" min="0" max="100" step="1" value={manualPwm} onChange={(e) => setManualPwm(Number(e.target.value))} disabled={busy} />
          </label>
        )}
      </section>

      <section className="panel">
        <h3>Temperature setpoint</h3>
        <label className="slider">
          <span><b>{Number(draft).toFixed(1)}°C</b> <span className="muted">· ระบบรักษา Internal ให้อยู่ใน ±{CONFIG.band}°C</span></span>
          <input type="range" min="20" max="40" step="0.5" value={draft} onChange={(e) => setDraft(Number(e.target.value))} disabled={busy} />
        </label>
      </section>

      <div className="actions left">
        <button className="btn" onClick={apply} disabled={busy}>{busy ? 'กำลังส่ง…' : 'Save settings'}</button>
        {msg && <span className={msg.type === 'ok' ? 'okmsg' : 'errmsg'}>{msg.text}</span>}
      </div>

      <section className="panel">
        <h3>บันทึกการทดสอบความหน่วงของคำสั่ง (ประกอบ QR-10)</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          วัดเวลาจากกดบันทึกถึงได้รับ ack จาก ESP32 (ไป-กลับ จึงเป็นค่าที่ไม่ต่ำกว่าเวลาที่ ESP32 นำค่าไปใช้จริง) เกณฑ์ ≤ {QR10_LIMIT_MS / 1000} วินาที อย่างน้อย {QR10_MIN_RUNS} ครั้ง
        </p>
        <div className="kv">
          <div><span className="muted">จำนวนครั้งที่สำเร็จ</span><b>{okMs.length} / {QR10_MIN_RUNS}</b></div>
          <div><span className="muted">p95</span><b>{okMs.length ? `${(p95(okMs) / 1000).toFixed(2)} s` : '–'}</b></div>
          <div><span className="muted">สูงสุด</span><b>{okMs.length ? `${(Math.max(...okMs) / 1000).toFixed(2)} s` : '–'}</b></div>
          <div><span className="muted">ไม่ได้รับ ack</span><b>{log.length - okMs.length}</b></div>
        </div>
        {CONFIG.useMock && <p className="warn small">โหมดข้อมูลจำลอง: ค่าเหล่านี้เป็นความหน่วงสมมติ ใช้เป็นหลักฐานไม่ได้</p>}
        <div className="tablewrap">
          <table>
            <thead><tr><th>เวลา</th><th>โหมด</th><th>Setpoint</th><th>ไป-กลับ</th><th>ผล</th></tr></thead>
            <tbody>
              {log.map((x) => (
                <tr key={x.t}>
                  <td>{fmtTime(x.t, true)}</td>
                  <td>{MODE_LABEL[x.mode]}</td>
                  <td>{x.setpoint}°C</td>
                  <td>{x.ms == null ? '–' : `${(x.ms / 1000).toFixed(2)} s`}</td>
                  <td>{x.ok ? 'ตอบรับ' : 'ไม่ตอบกลับ'}</td>
                </tr>
              ))}
              {!log.length && <tr><td colSpan={5} className="empty">ยังไม่มีการส่งคำสั่ง</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="actions"><button className="btn" onClick={exportLog} disabled={!log.length}>ส่งออก CSV</button></div>
      </section>
    </div>
  );
}
