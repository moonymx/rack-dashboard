-- Schema ตาม ER Diagram ในปริญญานิพนธ์ (รูป 3.9) บน TimescaleDB (PostgreSQL)
-- ไฟล์นี้ถูกรันอัตโนมัติครั้งแรกที่สร้างคอนเทนเนอร์ (docker-entrypoint-initdb.d)
--
-- ส่วนที่เพิ่มจาก ER Diagram เดิม (ถ้าคงไว้ ควรอัปเดตรูป ER ในเล่มด้วย):
--   * rack_telemetry.ingested_at  เวลาที่แถวถูกเขียนลง DB ใช้วัดความหน่วงเซนเซอร์ -> DB (ประกอบ QR-05)
--   * pid_settings.updated_at     เวลาที่เปลี่ยนค่า
--   * rack_telemetry.load_pct / ambient_temp / is_interpolated  ใช้กับชุดข้อมูลสาธารณะ (backend/tools/import_dataset.py)

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS rack_info (
    rack_id            text PRIMARY KEY,
    location_zone      text,
    description        text,
    max_temp_threshold real DEFAULT 35
);

CREATE TABLE IF NOT EXISTS rack_telemetry (
    time           timestamptz NOT NULL,
    rack_id        text        NOT NULL REFERENCES rack_info (rack_id),
    temp_inlet     real,
    temp_internal  real,
    temp_outlet    real,
    current_amp    real,
    power_watt     real,
    fan_rpm        integer,
    pwm_duty_cycle real,
    load_pct       real,                 -- Server_Workload(%) จากชุดข้อมูลสาธารณะ (ตาราง 4.3)
    ambient_temp   real,                 -- Ambient_Temperature(°C) ตัวแปรเสริมจากชุดข้อมูลสาธารณะ
    is_interpolated boolean NOT NULL DEFAULT false,  -- true = ค่าที่ประมาณระหว่างจุด ไม่ใช่ข้อมูลตรวจวัด
    ingested_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (time, rack_id)
);
SELECT create_hypertable('rack_telemetry', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_telemetry_rack_time ON rack_telemetry (rack_id, time DESC);

CREATE TABLE IF NOT EXISTS ai_predictions (
    time              timestamptz NOT NULL,
    rack_id           text        NOT NULL REFERENCES rack_info (rack_id),
    predicted_temp_30m real,
    recommended_pwm    real,
    PRIMARY KEY (time, rack_id)
);
SELECT create_hypertable('ai_predictions', 'time', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS pid_settings (
    setting_id    serial PRIMARY KEY,
    rack_id       text NOT NULL REFERENCES rack_info (rack_id),
    kp            real NOT NULL DEFAULT 18.0,
    ki            real NOT NULL DEFAULT 0.25,
    kd            real NOT NULL DEFAULT 15.0,
    setpoint_temp real NOT NULL DEFAULT 30.0,
    control_mode  text NOT NULL DEFAULT 'pid_only'
                  CHECK (control_mode IN ('manual', 'pid_only', 'ai_predictive')),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pid_settings_rack ON pid_settings (rack_id, setting_id DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
    rule_id            serial PRIMARY KEY,
    rack_id            text NOT NULL REFERENCES rack_info (rack_id),
    metric_name        text NOT NULL,
    warning_threshold  real,
    critical_threshold real,
    is_enabled         boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS system_alert_logs (
    time        timestamptz NOT NULL DEFAULT now(),
    rack_id     text        NOT NULL REFERENCES rack_info (rack_id),
    alert_level text        NOT NULL,
    message     text,
    PRIMARY KEY (time, rack_id)
);

-- ข้อมูลตั้งต้นสำหรับทดสอบ
INSERT INTO rack_info (rack_id, location_zone, description, max_temp_threshold)
VALUES ('rack-a12', 'Lab', 'ชุดทดสอบต้นแบบ ESP32 + SHT31 + ACS712', 35)
ON CONFLICT DO NOTHING;

INSERT INTO pid_settings (rack_id) SELECT 'rack-a12'
WHERE NOT EXISTS (SELECT 1 FROM pid_settings WHERE rack_id = 'rack-a12');

INSERT INTO alert_rules (rack_id, metric_name, warning_threshold, critical_threshold)
SELECT 'rack-a12', 'temp_internal', 32, 33.8
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE rack_id = 'rack-a12');
