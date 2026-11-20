// ตัวสร้างข้อมูลจำลองแบบ deterministic (ค่าเดียวกันสำหรับ timestamp เดียวกัน)
// ใช้ทั้งโหมด Realtime และโหมดย้อนหลัง เพื่อให้กราฟต่อเนื่องกัน
// รูปแบบแถวข้อมูลตรงกับตาราง RACK_TELEMETRY

const DAY = 86400000;

const noise = (s) => {
  const x = Math.sin(s * 12.9898) * 43758.5453;
  return x - Math.floor(x) - 0.5; // -0.5 .. 0.5
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function synth(ts) {
  const phase = (ts / DAY) * 2 * Math.PI;
  const minuteIdx = Math.floor(ts / 60000);
  const burst = minuteIdx % 97 < 6 ? 25 : 0; // ภาระงานพุ่ง 6 นาที ทุก ๆ 97 นาที
  const load = clamp(55 + 20 * Math.sin(phase - 1.5) + burst + noise(ts / 1000) * 4, 25, 100);

  const pwm = clamp(25 + load * 0.7 + noise(ts / 777) * 3, 20, 100);
  const rpm = Math.round(400 + pwm * 22);
  const power = 19 * Math.pow(rpm / 2600, 3); // Fan Affinity Law
  const inlet = 23 + 1.2 * Math.sin(phase) + noise(ts / 913) * 0.3;
  const internal = inlet + 4 + load * 0.08 - pwm * 0.03 + 2.2 + noise(ts / 500) * 0.25;
  const outlet = inlet + (internal - inlet) * 0.6 + noise(ts / 321) * 0.2;

  return {
    ts,
    temp_inlet: round(inlet),
    temp_internal: round(internal),
    temp_outlet: round(outlet),
    current_amp: round(power / 12, 3),
    power_watt: round(power),
    fan_rpm: rpm,
    pwm_duty_cycle: round(pwm),
  };
}

export function synthRange(from, to, stepMs) {
  const rows = [];
  for (let t = from; t <= to; t += stepMs) rows.push(synth(t));
  return rows;
}
