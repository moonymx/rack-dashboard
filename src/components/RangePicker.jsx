import React, { useState } from 'react';

const PRESETS = [
  { key: '6', label: '6 ชม.', hours: 6 },
  { key: '12', label: '12 ชม.', hours: 12 },
  { key: '24', label: '24 ชม.', hours: 24 },
  { key: '48', label: '48 ชม.', hours: 48 },
];

const toLocalInput = (ms) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

export default function RangePicker({ preset, range, onPreset, onCustom }) {
  const [from, setFrom] = useState(toLocalInput(range.from));
  const [to, setTo] = useState(toLocalInput(range.to));
  const invalid = !from || !to || new Date(from) >= new Date(to);

  return (
    <div className="range">
      <div className="chips">
        {PRESETS.map((p) => (
          <button key={p.key} className={preset === p.key ? 'chip on' : 'chip'} onClick={() => onPreset(p.key, p.hours)}>
            ล่าสุด {p.label}
          </button>
        ))}
        <button className={preset === 'custom' ? 'chip on' : 'chip'} onClick={() => onCustom(new Date(from).getTime(), new Date(to).getTime())} disabled={invalid}>
          กำหนดเอง
        </button>
      </div>
      <div className="custom">
        <label>
          ตั้งแต่
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          ถึง
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn" disabled={invalid} onClick={() => onCustom(new Date(from).getTime(), new Date(to).getTime())}>
          แสดงผล
        </button>
        {invalid && <span className="warn">ช่วงเวลาไม่ถูกต้อง</span>}
      </div>
    </div>
  );
}
