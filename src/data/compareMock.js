// ข้อมูลตัวอย่างที่กำหนดไว้ล่วงหน้า (Mock Data) สำหรับแท็บ Compare
// *** ไม่ใช่ผลจากตัวจำลองระบบ (C-08) และไม่ใช่ผลวัดจริง ***
// ภาคการศึกษาที่ 2: แทนที่ด้วยผลจากตัวจำลองระบบ โดยคงรูปแบบ (shape) เดิมไว้
// ตัวชี้วัด 3 ค่าตามรายงานหัวข้อ 4.4.3 ภายใต้ภาระงานชุดเดียวกัน:
//   inBandPct  = ร้อยละของเวลาที่อุณหภูมิภายในอยู่ใน Setpoint ±2°C
//   maxTemp    = อุณหภูมิสูงสุดที่เกิดขึ้น (°C)
//   energyWh   = พลังงานที่พัดลมใช้รวม (Wh)
//   tempStd    = ส่วนเบี่ยงเบนมาตรฐานของอุณหภูมิ (°C) — ใช้แทน "ความแปรปรวน"
//   avgRpm     = ความเร็วรอบเฉลี่ย (RPM)

export const COMPARE_IS_SIMULATED = true;

export const COMPARE_DATA = {
  scenario: 'ภาระงานชุดเดียวกัน 24 ชั่วโมง (ตัวอย่าง)',
  pid: { inBandPct: 91.2, maxTemp: 33.4, energyWh: 412, tempStd: 1.05, avgRpm: 1810 },
  ai: { inBandPct: 96.8, maxTemp: 32.1, energyWh: 361, tempStd: 0.71, avgRpm: 1610 },
};

// เป้าหมายของโครงงาน: ลดพลังงานอย่างน้อย 10–15% (TC-03 ≥ 10%)
export const ENERGY_TARGET_PCT = 10;

export const pctChange = (from, to) => (from ? ((to - from) / from) * 100 : null);
