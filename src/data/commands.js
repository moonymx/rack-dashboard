import mqtt from 'mqtt';
import { CONFIG } from '../config.js';

// ส่งคำสั่งไปยัง ESP32 ผ่าน MQTT แล้วรอ ack
//   คำสั่ง: rack/<rack_id>/cmd   {cmd_id, setpoint, mode, manual_pwm, sent_at}
//   ตอบกลับ: rack/<rack_id>/ack   {cmd_id, setpoint, mode, applied_ts?}
// ความหน่วงที่วัดได้คือ "ไป-กลับ" (กดส่ง -> ได้รับ ack) จึงเป็นค่าที่ไม่ต่ำกว่าเวลาที่ ESP32 นำค่าไปใช้จริง
// (เป็นขอบเขตบนที่ปลอดภัยสำหรับ QR-10)

const ACK_TIMEOUT_MS = 10000;
let client = null;
const pending = new Map();

const ackTopic = () => `rack/${CONFIG.rackId}/ack`;
const cmdTopic = () => `rack/${CONFIG.rackId}/cmd`;

function getClient() {
  if (client) return client;
  client = mqtt.connect(CONFIG.mqttUrl, { reconnectPeriod: 3000, connectTimeout: 8000 });
  client.on('connect', () => client.subscribe(ackTopic(), { qos: 1 }));
  client.on('message', (_t, buf) => {
    try {
      const ack = JSON.parse(buf.toString());
      const p = pending.get(ack.cmd_id);
      if (p) {
        pending.delete(ack.cmd_id);
        p.resolve(ack);
      }
    } catch {
      /* ข้าม */
    }
  });
  return client;
}

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function sendCommand({ setpoint, mode, manualPwm }) {
  const cmdId = newId();
  const t0 = performance.now();
  const payload = { cmd_id: cmdId, setpoint, mode, manual_pwm: manualPwm, sent_at: new Date().toISOString() };

  if (CONFIG.useMock) {
    return new Promise((resolve) =>
      setTimeout(() => resolve({ cmdId, latencyMs: performance.now() - t0, ack: { cmd_id: cmdId, setpoint, mode } }), 300 + Math.random() * 600)
    );
  }

  return new Promise((resolve, reject) => {
    const c = getClient();
    const timer = setTimeout(() => {
      pending.delete(cmdId);
      reject(new Error('ESP32 ไม่ตอบกลับภายใน 10 วินาที'));
    }, ACK_TIMEOUT_MS);

    pending.set(cmdId, {
      resolve: (ack) => {
        clearTimeout(timer);
        resolve({ cmdId, latencyMs: performance.now() - t0, ack });
      },
    });

    // retain=true: ESP32 ที่รีสตาร์ทจะได้รับค่าล่าสุดทันทีเมื่อ subscribe
    c.publish(cmdTopic(), JSON.stringify(payload), { qos: 1, retain: true }, (err) => {
      if (err) {
        clearTimeout(timer);
        pending.delete(cmdId);
        reject(err);
      }
    });
  });
}
