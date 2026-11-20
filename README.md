# Rack Temperature Dashboard + Backend

ระบบแดชบอร์ด (React) + backend (MQTT -> TimescaleDB -> REST API) สำหรับโครงงานระบบบริหารจัดการอุณหภูมิภายในตู้แร็คด้วย AI

```
ESP32 --MQTT--> Mosquitto --> backend (app.py) --> TimescaleDB
                    |  ^                                |
        ws:9001     |  | ack/cmd                        | REST /api/*
                    v  |                                v
                 เว็บแดชบอร์ด (React)  <----------------+
```

## 1) ลองแบบไม่ต้องมีอะไรเลย (ข้อมูลจำลอง)
```bash
npm install
cp .env.example .env     # VITE_USE_MOCK=true
npm run dev              # http://localhost:5173
```
มีป้าย "ข้อมูลจำลอง (Simulated)" ขึ้นที่หัวหน้า ผลที่ได้ใช้เป็นหลักฐานทดสอบ QR ไม่ได้

## 2) รันระบบจริงบนเครื่องตัวเอง (ต้องมี Docker)
```bash
cd backend
docker compose up -d --build        # TimescaleDB + Mosquitto + backend (พอร์ต 5432, 1883, 9001, 8000)

# ตัวจำลอง ESP32 (ถ้ายังไม่มีบอร์ด)
pip install paho-mqtt
python tools/fake_esp32.py --host localhost --rack rack-a12

# แดชบอร์ด: แก้ .env เป็น VITE_USE_MOCK=false แล้ว npm run dev
```
ตรวจสอบ: `curl localhost:8000/api/health` และ `curl localhost:8000/api/stats`

เมื่อใช้บอร์ดจริง ให้ดูตัวอย่างโค้ดที่ `backend/firmware/esp32_mqtt_example.ino`
(ยังไม่ได้ทดสอบกับบอร์ดจริง ต้องรวมกับโค้ด PID/เซนเซอร์เดิมของทีม)

## 3) รูปแบบข้อความ MQTT

| Topic | ทิศทาง | Payload |
|---|---|---|
| `rack/<rack_id>/telemetry` | ESP32 -> Broker | `{"seq":123,"timestamp":"2026-11-17T12:00:00.123Z","temp_inlet":23.4,"temp_internal":30.1,"temp_outlet":27.8,"current_amp":1.5,"power_watt":18.6,"fan_rpm":2340,"pwm_duty_cycle":62}` |
| `rack/<rack_id>/cmd` | แดชบอร์ด -> ESP32 | `{"cmd_id":"...","setpoint":30,"mode":"pid_only","manual_pwm":50,"sent_at":"..."}` (publish แบบ retain) |
| `rack/<rack_id>/ack` | ESP32 -> แดชบอร์ด | `{"cmd_id":"...","setpoint":30,"mode":"pid_only"}` |

- `mode` = `manual` / `pid_only` / `ai_predictive`
- `seq` ต้องเพิ่มทีละ 1 ทุกข้อความ backend ใช้ตรวจจับข้อความที่หาย (QR-08)
- `timestamp` ต้องมาจากนาฬิกา ESP32 ที่ซิงก์ NTP แล้ว (QR-05 วัดความหน่วงจากค่านี้)

## 4) REST API (backend)
- `GET /api/telemetry?rack_id=&from=<ISO>&to=<ISO>&bucket_sec=` ข้อมูลย้อนหลัง (เฉลี่ยตาม bucket, ตอบไม่เกิน 5,000 จุด)
- `GET /api/settings?rack_id=` ค่าตั้งล่าสุดจากตาราง `pid_settings`
- `GET /api/stats` ตัวเลขประกอบ QR-08: received / written / missed_by_seq_gap / delivery_rate_pct
- `GET /api/health`

## 5) วิธีเก็บหลักฐานสำหรับ QR ที่เกี่ยวกับแดชบอร์ด (ต้องใช้บอร์ดจริงหรือ fake_esp32 + ระบบจริง)
- **QR-05 (ความหน่วง p95 ≤ 5 s)**: โหมด Realtime + `VITE_USE_MOCK=false` แดชบอร์ดจะแสดง p95 ใต้การ์ด ต้องรับอย่างน้อย 100 ข้อความ และนาฬิกาต้องตรงกัน (ถ้าเห็นค่าติดลบ แปลว่านาฬิกาไม่ตรง ใช้ผลไม่ได้) หมายเหตุ: ค่านี้คือ ESP32 -> เบราว์เซอร์ ไม่ใช่ ESP32 -> DB ถ้าจะวัดถึง DB ให้เทียบ `time` กับ `ingested_at` ในตาราง `rack_telemetry`
- **QR-08 (ส่งสำเร็จ ≥ 99%)**: รันต่อเนื่อง ≥ 8 ชม. แล้วดู `/api/stats` (`delivery_rate_pct`) ควรทดสอบกรณี Wi-Fi หลุดและต่อใหม่ด้วย
- **QR-10 (เวลาใช้ค่าตั้ง ≤ 5 s, ≥ 20 ครั้ง)**: แท็บ "ตั้งค่า" มีตารางบันทึกเวลาไป-กลับของแต่ละคำสั่ง และปุ่มส่งออก CSV
- **QR-09 (เวลาแจ้งเตือน ≤ 10 s)**: แท็บ Alerts มีตัวตรวจเกณฑ์แล้ว (ฝั่งเบราว์เซอร์) แต่ยังไม่ได้วัดเวลาแจ้งเตือนจริง และยังไม่ได้เขียนลง `system_alert_logs`

## 5.1) แท็บของแดชบอร์ด (ตามรายงานหัวข้อ 3.10)
| แท็บ | หน้าที่ |
|---|---|
| Overview | ค่าสด, กราฟ, แจ้งเตือนล่าสุด 3 รายการ, ข้อมูลดิบ, CSV |
| History | ช่วงเวลา 6/12/24/48 ชม. หรือกำหนดเอง, สรุปค่า, กราฟ, ข้อมูลดิบ, CSV |
| Compare | PID เท่านั้น vs PID + AI — **ข้อมูลตัวอย่าง (Mock) ใน `src/data/compareMock.js`** ยังไม่ใช่ผลจากตัวจำลองระบบ แทนที่ในภาคการศึกษาที่ 2 |
| Alerts | Info / Success / Warning / Danger, รับทราบ, ลบ, กรอง — เกณฑ์ตั้งใน `src/config.js` และตรรกะใน `src/alerts.js` |
| Settings | โหมดควบคุม, Setpoint, บันทึกความหน่วงคำสั่ง (QR-10) |

หมายเหตุ: ข้อมูลสดทำงานตลอดทุกแท็บเพื่อให้ตรวจแจ้งเตือนได้ ส่วนข้อมูลย้อนหลังดึงเฉพาะตอนเปิดแท็บ History รายการแจ้งเตือนเก็บใน localStorage ของเบราว์เซอร์ (ยังไม่มี API เขียน/อ่านตาราง `system_alert_logs`)

## 6) ข้อจำกัดที่ควรรู้
- ส่วนที่ทดสอบแล้วในเครื่องผู้พัฒนา: build ของเว็บ, การรับ MQTT, การนับ seq ที่หาย, การเก็บบัฟเฟอร์เมื่อ DB ล่ม, และการส่งคำสั่ง -> ack กับตัวจำลอง ESP32 ผ่าน broker จริง
- **ยังไม่ได้ทดสอบ**: การเขียน/อ่าน TimescaleDB จริง (schema.sql, คำสั่ง INSERT, `time_bucket`), `docker compose`, WebSocket ผ่าน Mosquitto จากเบราว์เซอร์ และโค้ด ESP32 บนบอร์ดจริง
- ผลสรุป "อยู่ในพิสัย ±2°C" ในโหมดย้อนหลังเทียบกับ Setpoint **ปัจจุบัน** ถ้าเคยเปลี่ยน Setpoint ในช่วงที่เลือก ค่านี้อาจไม่ตรงกับ Setpoint ขณะนั้น (ประวัติ Setpoint อยู่ในตาราง `pid_settings`)
- Mosquitto ตั้งค่าแบบไม่มีรหัสผ่านและไม่เข้ารหัส เหมาะกับห้องปฏิบัติการเท่านั้น
- `schema.sql` เพิ่มคอลัมน์ `ingested_at` และ `updated_at` จาก ER Diagram ในเล่ม ถ้าเก็บไว้ ควรอัปเดตรูป ER

## 7) นำเข้าชุดข้อมูลสาธารณะ (cold_source_control_dataset.csv) เพื่อใช้กับโหมดย้อนหลัง
ตามหัวข้อ 4.1.2 และตารางที่ 4.3 ของปริญญานิพนธ์ (ทำความสะอาด -> resample -> จับคู่ตัวแปร -> เก็บลง DB)
```bash
pip install "psycopg[binary]"            # Mac: python3 -m pip install --break-system-packages "psycopg[binary]"
cd backend
python3 tools/import_dataset.py /path/to/cold_source_control_dataset.csv --replace
```
แล้วใน `.env` ตั้ง `VITE_USE_MOCK=false` และ `VITE_HISTORY_RACK_ID=dataset-demo` รีสตาร์ท `npm run dev` เปิดแท็บ History
จะมีปุ่มเลือกแหล่งข้อมูล 2 ปุ่ม: "ข้อมูลที่บันทึกจากอุปกรณ์ (Realtime)" (rack-a12 ที่ backend เก็บไว้) กับ "ชุดข้อมูลสาธารณะ" (dataset-demo)
เลือก "กำหนดเอง" ช่วง 2025-01-01 ถึง 2025-05-26 (ปุ่ม "ล่าสุด N ชม." จะไม่มีข้อมูล เพราะข้อมูลเป็นของปี 2025)
ถ้าต้องการเดโมด้วยปุ่ม "ล่าสุด N ชม." ให้เพิ่ม `--end-now` (เลื่อนวันที่ของข้อมูลให้จบที่ตอนนี้ ใช้เพื่อเดโมเท่านั้น)

- ข้อมูลถูกเก็บใต้ `rack_id = dataset-demo` แยกจากข้อมูลอุปกรณ์จริง (`rack-a12`)
- แถวที่ประมาณค่าระหว่างจุดรายชั่วโมงมี `is_interpolated = true` (ไม่ใช่ข้อมูลตรวจวัด) ตามที่รายงานระบุ
- ไม่มี `temp_internal`, กระแสไฟ, RPM, PWM ในชุดข้อมูล จึงเป็น NULL (Internal ต้องมาจากตัวจำลองระบบ ตามตาราง 4.3)
- `power_watt` ปรับสเกลจาก kW ระดับห้องเป็นระดับพัดลมตู้แร็ค ด้วยค่าสมมติ 2-24 W (24 W = ขีดจำกัดอะแดปเตอร์ 12V 2A) ปรับได้ด้วย `--fan-min-w` / `--fan-max-w` และควรระบุในเล่มว่าเป็นสมมติฐาน
- ถ้า DB ถูกสร้างไว้ก่อนหน้านี้ สคริปต์จะเพิ่มคอลัมน์ `load_pct`, `ambient_temp`, `is_interpolated` ให้เอง

## โครงสร้างไฟล์
```
src/                      เว็บแดชบอร์ด (App, components/, data/, hooks/)
backend/app.py            ตัวรับ MQTT + REST API
backend/db/schema.sql     ตารางตาม ER Diagram (TimescaleDB)
backend/docker-compose.yml, Dockerfile, mosquitto/
backend/tools/fake_esp32.py          ตัวจำลอง ESP32
backend/tools/import_dataset.py      นำเข้า cold_source_control_dataset.csv ลง DB
backend/firmware/esp32_mqtt_example.ino   ตัวอย่างโค้ดฝั่ง ESP32 (ยังไม่ได้ทดสอบกับบอร์ด)
```
