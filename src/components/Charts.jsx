import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea } from 'recharts';
import { CONFIG } from '../config.js';
import { fmtTime } from '../utils.js';

const C = { inlet: '#4cb5ff', internal: '#ff9f43', outlet: '#3ddc97', rpm: '#a78bfa', power: '#f472b6' };

export default function Charts({ rows, mode, setpoint = CONFIG.setpoint }) {
  const spanMs = rows.length > 1 ? rows[rows.length - 1].ts - rows[0].ts : 0;
  const withDate = spanMs > 20 * 3600000;
  const tick = (v) => fmtTime(v, withDate);
  const common = {
    data: rows,
    margin: { top: 8, right: 12, bottom: 0, left: -8 },
  };
  const xAxis = <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tick} stroke="#6b7280" fontSize={11} minTickGap={48} />;
  const tip = { contentStyle: { background: '#15181e', border: '1px solid #2a2f3a', borderRadius: 8 }, labelFormatter: (v) => fmtTime(v, true) };
  const anim = mode !== 'live'; // โหมด Realtime ปิด animation เพื่อไม่ให้กระตุก

  const hi = setpoint + CONFIG.band;
  const lo = setpoint - CONFIG.band;

  return (
    <div className="charts">
      <section className="panel">
        <h3>อุณหภูมิ (°C)</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart {...common}>
            <CartesianGrid stroke="#222733" vertical={false} />
            {xAxis}
            <YAxis stroke="#6b7280" fontSize={11} domain={['auto', 'auto']} />
            <Tooltip {...tip} />
            <Legend />
            <ReferenceArea y1={lo} y2={hi} fill="#3ddc97" fillOpacity={0.06} />
            <ReferenceLine y={hi} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `${hi}°C`, fill: '#ef4444', fontSize: 11, position: 'insideTopRight' }} />
            <Line name="Inlet" dataKey="temp_inlet" stroke={C.inlet} dot={false} strokeWidth={2} isAnimationActive={anim} />
            <Line name="Internal" dataKey="temp_internal" stroke={C.internal} dot={false} strokeWidth={2} isAnimationActive={anim} />
            <Line name="Outlet" dataKey="temp_outlet" stroke={C.outlet} dot={false} strokeWidth={2} isAnimationActive={anim} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="panel">
        <h3>ความเร็วพัดลมและกำลังไฟฟ้า</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart {...common} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#222733" vertical={false} />
            {xAxis}
            <YAxis yAxisId="rpm" stroke={C.rpm} fontSize={11} />
            <YAxis yAxisId="w" orientation="right" stroke={C.power} fontSize={11} />
            <Tooltip {...tip} />
            <Legend />
            <Line yAxisId="rpm" name="RPM" dataKey="fan_rpm" stroke={C.rpm} dot={false} strokeWidth={2} isAnimationActive={anim} />
            <Line yAxisId="w" name="Power (W)" dataKey="power_watt" stroke={C.power} dot={false} strokeWidth={2} isAnimationActive={anim} />
          </LineChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}
