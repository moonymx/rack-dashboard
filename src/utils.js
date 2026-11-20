import { CONFIG } from './config.js';

export const fmtTime = (ts, withDate = false) => {
  const d = new Date(ts);
  const t = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return withDate ? `${d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })} ${t}` : t;
};

export const fmtNum = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '–' : Number(v).toFixed(d));

const vals = (rows, k) => rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));

export function summarize(rows, setpoint = CONFIG.setpoint) {
  if (!rows.length) return null;
  const t = vals(rows, 'temp_internal');
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

  // พลังงาน (Wh) ด้วยวิธี trapezoid
  let wh = 0;
  for (let i = 1; i < rows.length; i++) {
    const p0 = rows[i - 1].power_watt;
    const p1 = rows[i].power_watt;
    if (p0 == null || p1 == null) continue;
    wh += ((p0 + p1) / 2) * ((rows[i].ts - rows[i - 1].ts) / 3600000);
  }

  const inBand = t.filter((v) => Math.abs(v - setpoint) <= CONFIG.band).length;
  return {
    count: rows.length,
    internalAvg: avg(t),
    internalMin: t.length ? Math.min(...t) : null,
    internalMax: t.length ? Math.max(...t) : null,
    inBandPct: t.length ? (inBand / t.length) * 100 : null,
    rpmAvg: avg(vals(rows, 'fan_rpm')),
    powerAvg: avg(vals(rows, 'power_watt')),
    energyWh: wh,
  };
}

export function exportCsv(rows, filename = 'rack_telemetry.csv') {
  const cols = ['timestamp', 'temp_inlet', 'temp_internal', 'temp_outlet', 'current_amp', 'power_watt', 'fan_rpm', 'pwm_duty_cycle'];
  const lines = [cols.join(',')];
  rows.forEach((r) =>
    lines.push([new Date(r.ts).toISOString(), r.temp_inlet, r.temp_internal, r.temp_outlet, r.current_amp, r.power_watt, r.fan_rpm, r.pwm_duty_cycle].join(','))
  );
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
