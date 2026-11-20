#!/usr/bin/env python3
"""
ตัวจำลอง ESP32 สำหรับทดสอบระบบโดยไม่ต้องมีฮาร์ดแวร์
  - ส่งข้อมูลทุก --interval วินาทีไปที่ rack/<rack>/telemetry (มี seq + timestamp ISO ระดับ ms)
  - รับคำสั่งจาก rack/<rack>/cmd แล้วตอบ ack ที่ rack/<rack>/ack หลังหน่วง 0.2-0.8 วินาที
  - --drop 0.05 = สุ่มไม่ส่ง 5% ของข้อความ (seq ยังเดินต่อ) เพื่อทดสอบการนับข้อความที่หายของ QR-08

ใช้:  pip install paho-mqtt
      python tools/fake_esp32.py --host localhost --rack rack-a12
หมายเหตุ: แบบจำลองความร้อนและ PID ในไฟล์นี้เป็นแบบง่ายเพื่อให้ข้อมูลดูสมจริง ไม่ใช่ผลของตัวจำลองระบบในโครงงาน
"""
import argparse
import json
import math
import random
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt


def iso_now():
    d = datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--rack", default="rack-a12")
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--drop", type=float, default=0.0, help="สัดส่วนข้อความที่ไม่ส่ง 0-1")
    args = ap.parse_args()

    st = {"setpoint": 30.0, "mode": "pid_only", "manual_pwm": 50.0}
    tele_topic = f"rack/{args.rack}/telemetry"
    cmd_topic = f"rack/{args.rack}/cmd"
    ack_topic = f"rack/{args.rack}/ack"

    cli = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"fake-esp32-{args.rack}")

    def on_connect(c, u, f, rc, props=None):
        print("connected", rc)
        c.subscribe(cmd_topic, qos=1)

    def on_message(c, u, msg):
        try:
            cmd = json.loads(msg.payload)
        except Exception:
            return
        time.sleep(random.uniform(0.2, 0.8))  # จำลองเวลาที่ ESP32 ใช้ประมวลผลคำสั่ง
        st["setpoint"] = float(cmd.get("setpoint", st["setpoint"]))
        st["mode"] = cmd.get("mode", st["mode"])
        if cmd.get("manual_pwm") is not None:
            st["manual_pwm"] = float(cmd["manual_pwm"])
        c.publish(ack_topic, json.dumps({"cmd_id": cmd.get("cmd_id"), "setpoint": st["setpoint"], "mode": st["mode"], "applied_ts": iso_now()}), qos=1)
        print("applied cmd", st)

    cli.on_connect = on_connect
    cli.on_message = on_message
    cli.connect(args.host, args.port, keepalive=30)
    cli.loop_start()

    # แบบจำลองความร้อนอย่างง่าย: C dT/dt = Q - G(pwm)(T - Tin)
    T, integ, seq, t0 = 31.0, 0.0, 0, time.time()
    C = 300.0
    while True:
        t = time.time() - t0
        burst = 25 if int(t // 60) % 7 == 0 else 0
        load = clamp(55 + 20 * math.sin(t / 600) + burst + random.uniform(-2, 2), 25, 100)
        tin = 23 + 1.2 * math.sin(t / 900) + random.uniform(-0.15, 0.15)

        err = T - st["setpoint"]
        integ = clamp(integ + err * args.interval, -200, 200)
        if st["mode"] == "manual":
            pwm = st["manual_pwm"]
        else:  # pid_only และ ai_predictive ใช้ PI เหมือนกัน (ตัวจำลองนี้ไม่มี AI)
            pwm = clamp(50 + 18 * err + 0.25 * integ, 20, 100)

        G = 1.0 + 6.0 * pwm / 100.0
        for _ in range(int(args.interval)):  # ก้าวละ 1 วินาที
            T += (0.6 * load - G * (T - tin)) / C
        T_meas = T + random.uniform(-0.1, 0.1)

        rpm = int(400 + pwm * 22)
        power = 19 * (rpm / 2600) ** 3
        payload = {
            "seq": seq,
            "timestamp": iso_now(),
            "temp_inlet": round(tin, 2),
            "temp_internal": round(T_meas, 2),
            "temp_outlet": round(tin + (T_meas - tin) * 0.6, 2),
            "current_amp": round(power / 12, 3),
            "power_watt": round(power, 2),
            "fan_rpm": rpm,
            "pwm_duty_cycle": round(pwm, 1),
        }
        seq += 1
        if random.random() >= args.drop:
            cli.publish(tele_topic, json.dumps(payload), qos=0)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
