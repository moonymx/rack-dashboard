import mqtt from 'mqtt';
import { CONFIG } from '../config.js';
import { synth, synthRange } from './synth.js';

// ปรับ payload ที่ได้รับ ให้เป็นรูปแบบแถวเดียวกันทั้งระบบ
// ชื่อฟิลด์อิงตาราง RACK_TELEMETRY: temp_inlet, temp_internal, temp_outlet,
// current_amp, power_watt, fan_rpm, pwm_duty_cycle และ timestamp (ISO string หรือ epoch ms)
export function normalize(p) {
  let ts = Date.now();
  let devTs = false; // true = มี timestamp จากอุปกรณ์ (ใช้วัดความหน่วง QR-05 ได้)
  const raw = p.timestamp ?? p.ts ?? p.time;
  if (typeof raw === 'number') {
    ts = raw < 1e12 ? raw * 1000 : raw; // วินาที -> ms
    devTs = true;
  } else if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) {
    ts = Date.parse(raw);
    devTs = true;
  }
  const n = (v) => (v === undefined || v === null ? null : Number(v));
  return {
    ts,
    devTs,
    temp_inlet: n(p.temp_inlet),
    temp_internal: n(p.temp_internal),
    temp_outlet: n(p.temp_outlet),
    current_amp: n(p.current_amp),
    power_watt: n(p.power_watt),
    fan_rpm: n(p.fan_rpm),
    pwm_duty_cycle: n(p.pwm_duty_cycle),
  };
}

/**
 * โหมด Realtime: สมัครรับข้อมูลสดจาก MQTT (หรือข้อมูลจำลอง)
 * คืนฟังก์ชัน unsubscribe — ต้องเรียกตอนสลับโหมดเพื่อปิดการเชื่อมต่อ
 */
export function subscribeLive({ rackId, onRow, onStatus }) {
  if (CONFIG.useMock) {
    onStatus('live');
    onRow(synth(Date.now()));
    const id = setInterval(() => onRow(synth(Date.now())), 2000);
    return () => clearInterval(id);
  }

  onStatus('connecting');
  const client = mqtt.connect(CONFIG.mqttUrl, { reconnectPeriod: 3000, connectTimeout: 8000 });
  const topic = CONFIG.mqttTopic(rackId);

  client.on('connect', () => {
    onStatus('live');
    client.subscribe(topic, { qos: 0 });
  });
  client.on('reconnect', () => onStatus('connecting'));
  client.on('offline', () => onStatus('offline'));
  client.on('error', () => onStatus('offline'));
  client.on('message', (_t, buf) => {
    try {
      onRow(normalize(JSON.parse(buf.toString())));
    } catch {
      /* ข้าม payload ที่ parse ไม่ได้ */
    }
  });

  return () => client.end(true);
}

/** อ่านค่าตั้งปัจจุบัน (Setpoint / โหมด) จาก API -> ตาราง PID_SETTINGS */
export async function fetchSettings(rackId) {
  const fallback = { setpoint_temp: CONFIG.setpoint, control_mode: 'pid_only' };
  if (CONFIG.useMock) return fallback;
  try {
    const res = await fetch(`${CONFIG.apiBase}/settings?rack_id=${encodeURIComponent(rackId)}`);
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

/**
 * โหมดย้อนหลัง: ดึงข้อมูลช่วง [from, to] (epoch ms)
 * API ที่คาดหวัง: GET {apiBase}/telemetry?rack_id=&from=ISO&to=ISO&bucket_sec=
 * ตอบกลับเป็น array ของ object ตามฟิลด์ใน normalize()
 */
export async function fetchHistory({ rackId, from, to, signal }) {
  const bucketSec = Math.max(1, Math.ceil((to - from) / 1000 / CONFIG.maxHistoryPoints));

  if (CONFIG.useMock) {
    await new Promise((r) => setTimeout(r, 250)); // จำลองความหน่วงของเครือข่าย
    return synthRange(from, to, Math.max(bucketSec, 5) * 1000);
  }

  const qs = new URLSearchParams({
    rack_id: rackId,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    bucket_sec: String(bucketSec),
  });
  const res = await fetch(`${CONFIG.apiBase}/telemetry?${qs}`, { signal });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : json.data || [];
  return list.map(normalize).sort((a, b) => a.ts - b.ts);
}
