"""
Backend ของระบบบริหารจัดการอุณหภูมิตู้แร็ค (โมดูล C-03 / C-04)

หน้าที่ (เป็นโปรเซสเดียว):
  1) ตัวรับข้อมูล: subscribe MQTT  rack/+/telemetry -> เขียนลง TimescaleDB แบบ batch
       - ถ้า DB ใช้ไม่ได้ จะเก็บข้อมูลไว้ในบัฟเฟอร์ แล้วลองเขียนใหม่ (ประกอบ QR-08)
       - นับข้อความที่ขาดจากเลขลำดับ seq ที่ ESP32 ใส่มาใน payload
  2) บันทึกคำสั่งตั้งค่า: subscribe rack/+/cmd -> เขียนตาราง pid_settings
  3) REST API ให้แดชบอร์ดดึงข้อมูลย้อนหลัง:
       GET /api/telemetry?rack_id=&from=&to=&bucket_sec=
       GET /api/settings?rack_id=
       GET /api/stats           (ตัวเลขประกอบ QR-08)
       GET /api/health

รัน:  uvicorn app:app --host 0.0.0.0 --port 8000
"""
import json
import logging
import math
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg_pool import ConnectionPool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("rack-backend")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://rack:rackpw@localhost:5432/rackdb")
MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

BATCH_MAX = 200          # เขียนทันทีเมื่อครบจำนวนนี้
FLUSH_SEC = 1.0          # หรือทุกกี่วินาที
BUFFER_LIMIT = 20000     # บัฟเฟอร์สูงสุดเมื่อ DB ล่ม (เกินแล้วทิ้งแถวเก่าสุด)
MAX_POINTS = 5000        # จำนวนจุดสูงสุดที่ API ตอบ
VALID_MODES = {"manual", "pid_only", "ai_predictive"}

pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, open=False, kwargs={"autocommit": True})


# ---------------------------------------------------------------- สถิติ (QR-08)
class Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.started_at = time.time()
        self.received = 0        # ข้อความที่รับจาก MQTT และ parse ได้
        self.parse_errors = 0
        self.written = 0         # แถวที่เขียนลง DB สำเร็จ
        self.missed = 0          # ข้อความที่หายระหว่างทาง (นับจากช่องว่างของ seq)
        self.dropped_buffer = 0  # แถวที่ถูกทิ้งเพราะบัฟเฟอร์เต็ม
        self.db_errors = 0
        self.last_message_at = None
        self.last_seq = {}       # rack_id -> seq ล่าสุด

    def snapshot(self, pending):
        with self.lock:
            sent_est = self.received + self.missed
            return {
                "uptime_sec": round(time.time() - self.started_at),
                "received": self.received,
                "written": self.written,
                "pending_in_buffer": pending,
                "missed_by_seq_gap": self.missed,
                "parse_errors": self.parse_errors,
                "db_errors": self.db_errors,
                "dropped_buffer_full": self.dropped_buffer,
                "sent_estimate": sent_est,
                # QR-08 = ข้อความที่ถึง DB / ข้อความที่ส่ง  (ส่งโดยประมาณ = รับได้ + ที่หายตาม seq)
                "delivery_rate_pct": round(100 * self.written / sent_est, 3) if sent_est else None,
                "last_message_at": datetime.fromtimestamp(self.last_message_at, timezone.utc).isoformat() if self.last_message_at else None,
            }


stats = Stats()
buffer = []  # แถวที่รอเขียน
buffer_lock = threading.Lock()
stop_event = threading.Event()


# ---------------------------------------------------------------- parse
def parse_ts(raw):
    """รับ ISO string / epoch วินาที / epoch ms -> datetime (UTC). ไม่มีค่า -> เวลาปัจจุบัน"""
    if raw is None:
        return datetime.now(timezone.utc)
    if isinstance(raw, (int, float)):
        sec = raw / 1000.0 if raw >= 1e12 else float(raw)
        return datetime.fromtimestamp(sec, timezone.utc)
    if isinstance(raw, str):
        d = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    raise ValueError("timestamp ไม่ถูกรูปแบบ")


def num(v, cast=float):
    if v is None:
        return None
    x = cast(v)
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    return x


def parse_telemetry(topic, payload):
    """topic = rack/<rack_id>/telemetry -> (row_tuple, seq)"""
    parts = topic.split("/")
    if len(parts) != 3 or not parts[1]:
        raise ValueError("topic ไม่ถูกรูปแบบ")
    p = json.loads(payload)
    if not isinstance(p, dict):
        raise ValueError("payload ต้องเป็น JSON object")
    ts = parse_ts(p.get("timestamp", p.get("ts", p.get("time"))))
    row = (
        ts,
        parts[1],
        num(p.get("temp_inlet")),
        num(p.get("temp_internal")),
        num(p.get("temp_outlet")),
        num(p.get("current_amp")),
        num(p.get("power_watt")),
        num(p.get("fan_rpm"), lambda v: int(round(float(v)))),
        num(p.get("pwm_duty_cycle")),
    )
    seq = p.get("seq")
    return row, int(seq) if seq is not None else None


def track_seq(rack_id, seq):
    if seq is None:
        return
    with stats.lock:
        last = stats.last_seq.get(rack_id)
        if last is not None and seq > last + 1:
            stats.missed += seq - last - 1
        # seq <= last = อุปกรณ์รีสตาร์ท: เริ่มนับใหม่ ไม่นับว่าหาย
        stats.last_seq[rack_id] = seq


# ---------------------------------------------------------------- เขียนลง DB
INSERT_SQL = """
INSERT INTO rack_telemetry
  (time, rack_id, temp_inlet, temp_internal, temp_outlet, current_amp, power_watt, fan_rpm, pwm_duty_cycle)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON CONFLICT (time, rack_id) DO NOTHING
"""


def flush(rows):
    racks = sorted({r[1] for r in rows})
    with pool.connection(timeout=5) as conn:
        with conn.cursor() as cur:
            for rid in racks:
                cur.execute("INSERT INTO rack_info (rack_id) VALUES (%s) ON CONFLICT DO NOTHING", (rid,))
            cur.executemany(INSERT_SQL, rows)
    return len(rows)


def writer_loop():
    last_flush = time.time()
    while not stop_event.is_set():
        time.sleep(0.1)
        with buffer_lock:
            n = len(buffer)
        if n == 0 or (n < BATCH_MAX and time.time() - last_flush < FLUSH_SEC):
            continue
        with buffer_lock:
            batch = buffer[:BATCH_MAX]
        try:
            written = flush(batch)
            with buffer_lock:
                del buffer[: len(batch)]
            with stats.lock:
                stats.written += written
            last_flush = time.time()
        except Exception as e:  # DB ไม่พร้อม: เก็บไว้ในบัฟเฟอร์แล้วลองใหม่
            with stats.lock:
                stats.db_errors += 1
            log.warning("เขียน DB ไม่สำเร็จ (%s) จะลองใหม่ buffer=%d", e, n)
            time.sleep(2)


def stats_logger():
    while not stop_event.wait(30):
        with buffer_lock:
            pending = len(buffer)
        log.info("stats %s", json.dumps(stats.snapshot(pending), ensure_ascii=False))


# ---------------------------------------------------------------- MQTT
def save_command(topic, payload):
    parts = topic.split("/")
    rack_id = parts[1]
    cmd = json.loads(payload)
    mode = cmd.get("mode")
    setpoint = float(cmd.get("setpoint"))
    if mode not in VALID_MODES or not (15 <= setpoint <= 45):
        raise ValueError(f"คำสั่งไม่ถูกต้อง: {cmd}")
    with pool.connection(timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO rack_info (rack_id) VALUES (%s) ON CONFLICT DO NOTHING", (rack_id,))
            cur.execute("SELECT kp, ki, kd FROM pid_settings WHERE rack_id=%s ORDER BY setting_id DESC LIMIT 1", (rack_id,))
            kp, ki, kd = cur.fetchone() or (18.0, 0.25, 15.0)
            cur.execute(
                "INSERT INTO pid_settings (rack_id, kp, ki, kd, setpoint_temp, control_mode) VALUES (%s,%s,%s,%s,%s,%s)",
                (rack_id, kp, ki, kd, setpoint, mode),
            )


def on_connect(client, userdata, flags, reason_code, properties=None):
    if reason_code == 0:
        log.info("เชื่อมต่อ MQTT สำเร็จ %s:%s", MQTT_HOST, MQTT_PORT)
        client.subscribe([("rack/+/telemetry", 1), ("rack/+/cmd", 1)])
    else:
        log.error("เชื่อมต่อ MQTT ไม่สำเร็จ: %s", reason_code)


def on_message(client, userdata, msg):
    try:
        if msg.topic.endswith("/telemetry"):
            row, seq = parse_telemetry(msg.topic, msg.payload)
            with stats.lock:
                stats.received += 1
                stats.last_message_at = time.time()
            track_seq(row[1], seq)
            with buffer_lock:
                buffer.append(row)
                over = len(buffer) - BUFFER_LIMIT
                if over > 0:
                    del buffer[:over]
                    with stats.lock:
                        stats.dropped_buffer += over
        elif msg.topic.endswith("/cmd"):
            save_command(msg.topic, msg.payload)
    except Exception as e:
        with stats.lock:
            stats.parse_errors += 1
        log.warning("ข้อความไม่ถูกต้อง topic=%s: %s", msg.topic, e)


def start_mqtt():
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="rack-backend")
    c.on_connect = on_connect
    c.on_message = on_message
    c.reconnect_delay_set(min_delay=1, max_delay=15)
    c.connect_async(MQTT_HOST, MQTT_PORT, keepalive=30)
    c.loop_start()
    return c


# ---------------------------------------------------------------- FastAPI
@asynccontextmanager
async def lifespan(app):
    pool.open(wait=False)
    stop_event.clear()
    threading.Thread(target=writer_loop, daemon=True).start()
    threading.Thread(target=stats_logger, daemon=True).start()
    client = start_mqtt()
    yield
    stop_event.set()
    client.loop_stop()
    client.disconnect()
    pool.close()


app = FastAPI(title="Rack Temperature Backend", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET"], allow_headers=["*"])


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


@app.get("/api/health")
def health():
    try:
        with pool.connection(timeout=3) as conn:
            conn.execute("SELECT 1")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(503, f"DB ใช้ไม่ได้: {e}")


@app.get("/api/stats")
def get_stats():
    with buffer_lock:
        pending = len(buffer)
    return stats.snapshot(pending)


@app.get("/api/settings")
def get_settings(rack_id: str):
    try:
        with pool.connection(timeout=5) as conn:
            row = conn.execute(
                "SELECT setpoint_temp, control_mode, kp, ki, kd FROM pid_settings WHERE rack_id=%s ORDER BY setting_id DESC LIMIT 1",
                (rack_id,),
            ).fetchone()
    except Exception as e:
        raise HTTPException(503, f"DB ใช้ไม่ได้: {e}")
    if not row:
        return {"setpoint_temp": 30.0, "control_mode": "pid_only", "kp": 18.0, "ki": 0.25, "kd": 15.0}
    return {"setpoint_temp": row[0], "control_mode": row[1], "kp": row[2], "ki": row[3], "kd": row[4]}


@app.get("/api/telemetry")
def get_telemetry(
    rack_id: str,
    from_: datetime = Query(..., alias="from"),
    to: datetime = Query(...),
    bucket_sec: int = Query(0, ge=0),
):
    if from_.tzinfo is None:
        from_ = from_.replace(tzinfo=timezone.utc)
    if to.tzinfo is None:
        to = to.replace(tzinfo=timezone.utc)
    if from_ >= to:
        raise HTTPException(400, "from ต้องน้อยกว่า to")

    span = (to - from_).total_seconds()
    bucket = max(bucket_sec, math.ceil(span / MAX_POINTS))  # จำกัดจำนวนจุดที่ตอบ
    try:
        with pool.connection(timeout=5) as conn:
            if bucket <= 1:
                rows = conn.execute(
                    """SELECT time, temp_inlet, temp_internal, temp_outlet, current_amp, power_watt, fan_rpm, pwm_duty_cycle
                       FROM rack_telemetry WHERE rack_id=%s AND time BETWEEN %s AND %s ORDER BY time""",
                    (rack_id, from_, to),
                ).fetchall()
            else:
                rows = conn.execute(
                    """SELECT time_bucket(make_interval(secs => %s::double precision), time) AS t,
                              avg(temp_inlet), avg(temp_internal), avg(temp_outlet), avg(current_amp),
                              avg(power_watt), round(avg(fan_rpm)), avg(pwm_duty_cycle)
                       FROM rack_telemetry WHERE rack_id=%s AND time BETWEEN %s AND %s
                       GROUP BY t ORDER BY t""",
                    (bucket, rack_id, from_, to),
                ).fetchall()
    except Exception as e:
        raise HTTPException(503, f"DB ใช้ไม่ได้: {e}")

    f = lambda v: None if v is None else round(float(v), 3)
    return [
        {
            "timestamp": iso(r[0]),
            "temp_inlet": f(r[1]),
            "temp_internal": f(r[2]),
            "temp_outlet": f(r[3]),
            "current_amp": f(r[4]),
            "power_watt": f(r[5]),
            "fan_rpm": None if r[6] is None else int(r[6]),
            "pwm_duty_cycle": f(r[7]),
        }
        for r in rows
    ]
