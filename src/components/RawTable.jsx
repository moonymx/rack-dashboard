import React from 'react';
import { fmtTime, fmtNum } from '../utils.js';

export default function RawTable({ rows, limit = 10 }) {
  const latest = rows.slice(-limit).reverse();
  return (
    <section className="panel">
      <h3>ข้อมูลดิบล่าสุด ({latest.length} แถว)</h3>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>เวลา</th>
              <th>Inlet</th>
              <th>Internal</th>
              <th>Outlet</th>
              <th>RPM</th>
              <th>PWM %</th>
              <th>Power</th>
            </tr>
          </thead>
          <tbody>
            {latest.map((r) => (
              <tr key={r.ts}>
                <td>{fmtTime(r.ts, true)}</td>
                <td>{fmtNum(r.temp_inlet)}°C</td>
                <td>{fmtNum(r.temp_internal)}°C</td>
                <td>{fmtNum(r.temp_outlet)}°C</td>
                <td>{fmtNum(r.fan_rpm, 0)}</td>
                <td>{fmtNum(r.pwm_duty_cycle, 0)}</td>
                <td>{fmtNum(r.power_watt)} W</td>
              </tr>
            ))}
            {!latest.length && (
              <tr>
                <td colSpan={7} className="empty">ยังไม่มีข้อมูล</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
