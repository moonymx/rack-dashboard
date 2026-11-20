import React, { useMemo, useState } from 'react';
import { CONFIG } from '../config.js';
import { LEVELS, thresholds } from '../alerts.js';
import { fmtTime } from '../utils.js';

const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'danger', label: 'Danger' },
  { key: 'warning', label: 'Warning' },
  { key: 'success', label: 'Success' },
  { key: 'info', label: 'Info' },
];

export function LevelTag({ level }) {
  return <span className={`lvl ${level}`}>{LEVELS[level]?.label || level}</span>;
}

export default function AlertsTab({ alerts, setpoint, onAck, onAckAll, onRemove, onClearAcked }) {
  const [filter, setFilter] = useState('all');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const th = thresholds(setpoint);

  const counts = useMemo(() => {
    const c = { all: alerts.length, danger: 0, warning: 0, success: 0, info: 0 };
    alerts.forEach((a) => (c[a.level] += 1));
    return c;
  }, [alerts]);
  const unack = alerts.filter((a) => !a.ack).length;
  const acked = alerts.length - unack;
  const shown = alerts.filter((a) => (filter === 'all' || a.level === filter) && (!onlyOpen || !a.ack));

  return (
    <div className="alerts">
      <div className="cards">
        <div className={`card ${counts.danger ? 'danger' : ''}`}>
          <div className="label">Danger</div>
          <div className="value">{counts.danger}</div>
          <div className="sub">ต้องดำเนินการทันที</div>
        </div>
        <div className={`card ${counts.warning ? 'warn' : ''}`}>
          <div className="label">Warning</div>
          <div className="value">{counts.warning}</div>
          <div className="sub">เฝ้าระวัง</div>
        </div>
        <div className="card">
          <div className="label">ยังไม่รับทราบ</div>
          <div className="value">{unack}</div>
          <div className="sub">จากทั้งหมด {alerts.length} รายการ</div>
        </div>
        <div className="card">
          <div className="label">เกณฑ์อุณหภูมิ Internal</div>
          <div className="value" style={{ fontSize: 20 }}>
            {th.warning.toFixed(1)} / {th.critical.toFixed(1)}<span className="unit">°C</span>
          </div>
          <div className="sub">Warning / Critical (Setpoint {setpoint}°C)</div>
        </div>
      </div>

      <section className="panel">
        <div className="alert-toolbar">
          <div className="chips">
            {FILTERS.map((f) => (
              <button key={f.key} className={filter === f.key ? 'chip on' : 'chip'} onClick={() => setFilter(f.key)}>
                {f.label} ({counts[f.key]})
              </button>
            ))}
          </div>
          <div className="alert-actions">
            <label className="check">
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> เฉพาะที่ยังไม่รับทราบ
            </label>
            <button className="chip" onClick={onAckAll} disabled={!unack}>รับทราบทั้งหมด</button>
            <button className="chip" onClick={onClearAcked} disabled={!acked}>ลบที่รับทราบแล้ว ({acked})</button>
          </div>
        </div>

        <ul className="alert-list">
          {shown.map((a) => (
            <li key={a.id} className={`alert ${a.level} ${a.ack ? 'acked' : ''}`}>
              <div className="alert-main">
                <LevelTag level={a.level} />
                <span className="alert-msg">{a.message}</span>
              </div>
              <div className="alert-meta">
                <span className="muted">{fmtTime(a.ts, true)}</span>
                {a.ack ? (
                  <span className="muted">รับทราบแล้ว</span>
                ) : (
                  <button className="chip" onClick={() => onAck(a.id)}>รับทราบ</button>
                )}
                <button className="chip del" onClick={() => onRemove(a.id)} aria-label="ลบการแจ้งเตือน">ลบ</button>
              </div>
            </li>
          ))}
          {!shown.length && (
            <li className="empty-row">{alerts.length ? 'ไม่มีรายการที่ตรงกับตัวกรอง' : 'ยังไม่มีการแจ้งเตือน — ระบบกำลังเฝ้าตรวจข้อมูลสดอยู่'}</li>
          )}
        </ul>
        <p className="muted small">
          ตรวจจากข้อมูลสดฝั่งเบราว์เซอร์ขณะเปิดหน้านี้ไว้ (อุณหภูมิเกินเกณฑ์ พัดลมไม่หมุน การเชื่อมต่อขาด ข้อมูลค้าง) · เก็บสูงสุด {CONFIG.maxAlerts} รายการในเครื่องนี้
        </p>
      </section>
    </div>
  );
}
