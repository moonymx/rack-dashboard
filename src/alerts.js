import { CONFIG } from './config.js';

// ตรรกะตรวจจับความผิดปกติ (F-08 / C-06) — ฟังก์ชันล้วน ไม่มี side effect
// ระดับความสำคัญตามรายงานหัวข้อ 3.10.4: info | success | warning | danger
//
// เกณฑ์อุณหภูมิ Internal อิงตาราง ALERT_RULES (ค่าตั้งต้น warning 32 / critical 33.8 เมื่อ Setpoint 30°C)
// จึงกำหนดเป็นระยะห่างจาก Setpoint: warning = Setpoint + band, critical = Setpoint + critOffset

export const LEVELS = {
  danger: { label: 'Danger', rank: 3 },
  warning: { label: 'Warning', rank: 2 },
  success: { label: 'Success', rank: 1 },
  info: { label: 'Info', rank: 0 },
};

export const thresholds = (setpoint = CONFIG.setpoint) => ({
  warning: setpoint + CONFIG.band,
  critical: setpoint + CONFIG.alertCritOffset,
});

export const initialState = () => ({ temp: 'ok', fan: 'ok' });

const mk = (ts, level, rule, message) => ({ id: `${rule}:${level}:${ts}`, ts, level, rule, message, ack: false });

/**
 * ตรวจแถวข้อมูลหนึ่งแถว เทียบกับสถานะก่อนหน้า (edge-triggered: แจ้งเฉพาะตอนสถานะเปลี่ยน)
 * คืน { state, events } โดย events คือการแจ้งเตือนใหม่ (อาจว่าง)
 */
export function evaluateRow(row, state, setpoint = CONFIG.setpoint) {
  const events = [];
  const next = { ...state };
  const th = thresholds(setpoint);
  const H = CONFIG.alertHysteresis;

  // 1) อุณหภูมิภายในตู้ — มี hysteresis กันแจ้งเตือนซ้ำเมื่อค่าแกว่งรอบเกณฑ์
  const t = row.temp_internal;
  if (t != null && !Number.isNaN(t)) {
    const prev = state.temp;
    let level = 'ok';
    if (t >= th.critical || (prev === 'danger' && t >= th.critical - H)) level = 'danger';
    else if (t >= th.warning || ((prev === 'warning' || prev === 'danger') && t >= th.warning - H)) level = 'warning';

    if (level !== prev) {
      if (level === 'danger') events.push(mk(row.ts, 'danger', 'temp', `อุณหภูมิภายในตู้ ${t.toFixed(1)}°C ถึงเกณฑ์วิกฤต ${th.critical.toFixed(1)}°C`));
      else if (level === 'warning') events.push(mk(row.ts, 'warning', 'temp', `อุณหภูมิภายในตู้ ${t.toFixed(1)}°C ถึงเกณฑ์เตือน ${th.warning.toFixed(1)}°C`));
      else events.push(mk(row.ts, 'success', 'temp', `อุณหภูมิภายในตู้กลับสู่ปกติ (${t.toFixed(1)}°C)`));
      next.temp = level;
    }
  }

  // 2) พัดลมไม่หมุน: สั่ง PWM สูงแต่ไม่มีสัญญาณ Tachometer
  if (row.pwm_duty_cycle != null && row.fan_rpm != null) {
    const stalled = row.pwm_duty_cycle >= CONFIG.fanStallMinPwm && row.fan_rpm < CONFIG.fanStallMaxRpm;
    const level = stalled ? 'danger' : 'ok';
    if (level !== state.fan) {
      events.push(
        stalled
          ? mk(row.ts, 'danger', 'fan', `พัดลมอาจหยุดทำงาน: PWM ${row.pwm_duty_cycle.toFixed(0)}% แต่ RPM ${row.fan_rpm}`)
          : mk(row.ts, 'success', 'fan', `พัดลมกลับมาหมุนปกติ (${row.fan_rpm} RPM)`)
      );
      next.fan = level;
    }
  }

  return { state: next, events };
}
