import React from 'react';
import { CONFIG } from '../config.js';
import { fmtNum } from '../utils.js';

const Card = ({ label, value, unit, tone, sub }) => (
  <div className={`card ${tone || ''}`}>
    <div className="label">{label}</div>
    <div className="value">
      {value}
      {unit && <span className="unit">{unit}</span>}
    </div>
    {sub && <div className="sub">{sub}</div>}
  </div>
);

export default function StatCards({ mode, latest, summary, setpoint }) {
  if (mode === 'live') {
    if (!latest) return <div className="cards">{[0, 1, 2, 3].map((i) => <div key={i} className="card skeleton" />)}</div>;
    const dev = latest.temp_internal - setpoint;
    const tone = Math.abs(dev) > CONFIG.band ? 'danger' : Math.abs(dev) > CONFIG.band * 0.75 ? 'warn' : '';
    return (
      <div className="cards">
        <Card label="Inlet" value={fmtNum(latest.temp_inlet)} unit="°C" />
        <Card label="Internal" value={fmtNum(latest.temp_internal)} unit="°C" tone={tone} sub={`Setpoint ${setpoint}°C (${dev >= 0 ? '+' : ''}${dev.toFixed(1)})`} />
        <Card label="Outlet" value={fmtNum(latest.temp_outlet)} unit="°C" />
        <Card label="Fan / Power" value={fmtNum(latest.fan_rpm, 0)} unit=" RPM" sub={`${fmtNum(latest.power_watt)} W · PWM ${fmtNum(latest.pwm_duty_cycle, 0)}%`} />
      </div>
    );
  }

  if (!summary) return <div className="cards">{[0, 1, 2, 3].map((i) => <div key={i} className="card skeleton" />)}</div>;
  const ok = summary.inBandPct >= 95;
  return (
    <div className="cards">
      <Card label="Internal เฉลี่ย" value={fmtNum(summary.internalAvg)} unit="°C" sub={summary.internalAvg === null ? 'ไม่มีข้อมูล Internal ในช่วงนี้' : `ต่ำสุด ${fmtNum(summary.internalMin)} · สูงสุด ${fmtNum(summary.internalMax)}`} />
      <Card label={`อยู่ในพิสัย ±${CONFIG.band}°C`} value={fmtNum(summary.inBandPct)} unit="%" tone={ok ? '' : 'warn'} sub={summary.inBandPct === null ? 'คำนวณไม่ได้ (ไม่มีข้อมูล Internal)' : `เทียบ Setpoint ปัจจุบัน ${setpoint}°C`} />
      <Card label="พลังงานพัดลมรวม" value={fmtNum(summary.energyWh, 2)} unit=" Wh" sub={`กำลังเฉลี่ย ${fmtNum(summary.powerAvg)} W`} />
      <Card label="รอบพัดลมเฉลี่ย" value={fmtNum(summary.rpmAvg, 0)} unit=" RPM" sub={`${summary.count} จุดข้อมูล`} />
    </div>
  );
}
