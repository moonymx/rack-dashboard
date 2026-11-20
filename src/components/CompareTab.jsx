import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts';
import { COMPARE_DATA, COMPARE_IS_SIMULATED, ENERGY_TARGET_PCT, pctChange } from '../data/compareMock.js';
import { CONFIG } from '../config.js';
import { fmtNum } from '../utils.js';

const COLORS = { pid: '#4cb5ff', ai: '#3ddc97' };

function MetricChart({ title, unit, pid, ai, digits = 1, note }) {
  const data = [
    { name: 'PID เท่านั้น', v: pid, k: 'pid' },
    { name: 'PID + AI', v: ai, k: 'ai' },
  ];
  return (
    <section className="panel">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="#222733" vertical={false} />
          <XAxis dataKey="name" stroke="#6b7280" fontSize={12} />
          <YAxis stroke="#6b7280" fontSize={11} domain={[0, 'auto']} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,.04)' }}
            contentStyle={{ background: '#15181e', border: '1px solid #2a2f3a', borderRadius: 8 }}
            formatter={(v) => [`${fmtNum(v, digits)} ${unit}`, title]}
          />
          <Bar dataKey="v" radius={[6, 6, 0, 0]} maxBarSize={72}>
            {data.map((d) => (
              <Cell key={d.k} fill={COLORS[d.k]} />
            ))}
            <LabelList dataKey="v" position="top" fill="#cfd3da" fontSize={12} formatter={(v) => fmtNum(v, digits)} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}

const Delta = ({ label, value, sub, good }) => (
  <div className={`card ${good === false ? 'warn' : ''}`}>
    <div className="label">{label}</div>
    <div className="value" style={good ? { color: 'var(--green)' } : undefined}>{value}</div>
    <div className="sub">{sub}</div>
  </div>
);

export default function CompareTab() {
  const { pid, ai, scenario } = COMPARE_DATA;
  const energyChg = pctChange(pid.energyWh, ai.energyWh); // ติดลบ = ประหยัด
  const saving = -energyChg;
  const stdChg = pctChange(pid.tempStd, ai.tempStd);
  const rpmChg = pctChange(pid.avgRpm, ai.avgRpm);
  const bandGain = ai.inBandPct - pid.inBandPct;
  const reached = saving >= ENERGY_TARGET_PCT;

  return (
    <div className="compare">
      {COMPARE_IS_SIMULATED && (
        <div className="banner warn">
          <b>ข้อมูลจำลอง (Simulated)</b> — ค่าในหน้านี้เป็นข้อมูลตัวอย่างที่กำหนดไว้ล่วงหน้า (Mock Data) ยังไม่ใช่ผลจากตัวจำลองระบบหรือการทดลองจริง
          จะถูกแทนที่ด้วยผลจากตัวจำลองในภาคการศึกษาที่ 2
        </div>
      )}

      <div className="cards">
        <Delta
          label="พลังงานพัดลมที่ประหยัดได้"
          value={`${fmtNum(saving)}%`}
          sub={`${fmtNum(pid.energyWh, 0)} → ${fmtNum(ai.energyWh, 0)} Wh · เป้าหมาย ≥ ${ENERGY_TARGET_PCT}%${reached ? ' (ถึงเป้า)' : ' (ยังไม่ถึง)'}`}
          good={reached}
        />
        <Delta label={`อยู่ในพิสัย ±${CONFIG.band}°C เพิ่มขึ้น`} value={`+${fmtNum(bandGain)} จุด%`} sub={`${fmtNum(pid.inBandPct)}% → ${fmtNum(ai.inBandPct)}%`} good={bandGain >= 0} />
        <Delta label="ความแปรปรวนอุณหภูมิ" value={`${fmtNum(stdChg)}%`} sub={`SD ${fmtNum(pid.tempStd, 2)} → ${fmtNum(ai.tempStd, 2)} °C`} good={stdChg <= 0} />
        <Delta label="รอบพัดลมเฉลี่ย" value={`${fmtNum(rpmChg)}%`} sub={`${fmtNum(pid.avgRpm, 0)} → ${fmtNum(ai.avgRpm, 0)} RPM`} good={rpmChg <= 0} />
      </div>

      <p className="muted small" style={{ margin: 0 }}>
        เปรียบเทียบโหมด <b style={{ color: COLORS.pid }}>PID เท่านั้น</b> กับ <b style={{ color: COLORS.ai }}>PID ร่วมกับ AI</b> · {scenario}
      </p>

      <div className="compare-grid">
        <MetricChart title="พลังงานพัดลมรวม" unit="Wh" pid={pid.energyWh} ai={ai.energyWh} digits={0} note="ต่ำกว่าดีกว่า" />
        <MetricChart title={`เวลาที่อยู่ในพิสัย ±${CONFIG.band}°C`} unit="%" pid={pid.inBandPct} ai={ai.inBandPct} note="สูงกว่าดีกว่า" />
        <MetricChart title="ส่วนเบี่ยงเบนมาตรฐานอุณหภูมิ" unit="°C" pid={pid.tempStd} ai={ai.tempStd} digits={2} note="ต่ำกว่า = อุณหภูมิเสถียรกว่า" />
        <MetricChart title="อุณหภูมิสูงสุด" unit="°C" pid={pid.maxTemp} ai={ai.maxTemp} note="ต่ำกว่าดีกว่า (เกณฑ์สูงสุด 35°C)" />
      </div>

      <section className="panel">
        <h3>ตารางสรุป</h3>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>ตัวชี้วัด</th><th>PID เท่านั้น</th><th>PID + AI</th><th>เปลี่ยนแปลง</th></tr>
            </thead>
            <tbody>
              <tr><td>พลังงานพัดลมรวม (Wh)</td><td>{fmtNum(pid.energyWh, 0)}</td><td>{fmtNum(ai.energyWh, 0)}</td><td>{fmtNum(energyChg)}%</td></tr>
              <tr><td>อยู่ในพิสัย ±{CONFIG.band}°C (%)</td><td>{fmtNum(pid.inBandPct)}</td><td>{fmtNum(ai.inBandPct)}</td><td>{bandGain >= 0 ? '+' : ''}{fmtNum(bandGain)} จุด%</td></tr>
              <tr><td>SD อุณหภูมิ (°C)</td><td>{fmtNum(pid.tempStd, 2)}</td><td>{fmtNum(ai.tempStd, 2)}</td><td>{fmtNum(stdChg)}%</td></tr>
              <tr><td>อุณหภูมิสูงสุด (°C)</td><td>{fmtNum(pid.maxTemp)}</td><td>{fmtNum(ai.maxTemp)}</td><td>{fmtNum(ai.maxTemp - pid.maxTemp)} °C</td></tr>
              <tr><td>รอบพัดลมเฉลี่ย (RPM)</td><td>{fmtNum(pid.avgRpm, 0)}</td><td>{fmtNum(ai.avgRpm, 0)}</td><td>{fmtNum(rpmChg)}%</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
