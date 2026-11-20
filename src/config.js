export const CONFIG = {
  rackId: import.meta.env.VITE_RACK_ID || 'rack-a12',
  // (ไม่บังคับ) rack_id ที่ใช้ดึงโหมดย้อนหลัง เช่น 'dataset-demo' = ชุดข้อมูลสาธารณะที่นำเข้าด้วย import_dataset.py
  historyRackId: import.meta.env.VITE_HISTORY_RACK_ID || '',
  // true = ใช้ข้อมูลจำลอง (ไม่ต้องมี MQTT / API)
  useMock: (import.meta.env.VITE_USE_MOCK ?? 'true') === 'true',
  mqttUrl: import.meta.env.VITE_MQTT_URL || 'ws://localhost:9001',
  mqttTopic: (rackId) => `rack/${rackId}/telemetry`,
  apiBase: import.meta.env.VITE_API_BASE || 'http://localhost:8000/api',

  // ค่าควบคุม (ตรงกับ Setpoint ±2°C ในปริญญานิพนธ์)
  setpoint: 30,
  band: 2,

  // การแจ้งเตือน (Alerts Tab) — เกณฑ์ critical = Setpoint + alertCritOffset (30 + 3.8 = 33.8 ตรงกับ ALERT_RULES)
  alertCritOffset: 3.8,
  alertHysteresis: 0.3, // °C ที่ต้องต่ำกว่าเกณฑ์ก่อนถือว่ากลับสู่ระดับเดิม
  fanStallMinPwm: 30, // PWM (%) ขั้นต่ำที่ถือว่าสั่งให้พัดลมหมุน
  fanStallMaxRpm: 100, // RPM ต่ำกว่านี้ทั้งที่สั่งหมุน = พัดลมอาจหยุด
  maxAlerts: 200,

  // โหมด Realtime
  liveWindowPoints: 300, // เก็บข้อมูลล่าสุดกี่จุดในหน่วยความจำ
  liveSeedMinutes: 10, // ดึงข้อมูลย้อนหลังกี่นาทีมาเติมกราฟตอนเริ่ม
  liveStaleMs: 15000, // เกินกี่ ms ที่ไม่มีข้อมูลใหม่ ให้ถือว่า "ข้อมูลค้าง"

  // โหมดย้อนหลัง
  maxHistoryPoints: 600, // จำนวนจุดสูงสุดที่ขอจาก API (ใช้คำนวณ bucket)
};
