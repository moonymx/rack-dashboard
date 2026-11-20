#!/usr/bin/env python3
"""
นำเข้าชุดข้อมูลสาธารณะ cold_source_control_dataset.csv ลงตาราง rack_telemetry
ตามขั้นตอนในหัวข้อ 4.1.2 และตารางที่ 4.3 ของปริญญานิพนธ์

  1) Data Cleaning   ตรวจค่าที่ขาดหาย / ค่านอกช่วงที่เป็นไปได้ทางกายภาพ แล้วรายงานจำนวน
  2) Resampling      ข้อมูลต้นฉบับรายชั่วโมง -> ประมาณค่าระหว่างจุดแบบเส้นตรงให้ละเอียดขึ้น (ค่าเริ่มต้น 5 นาที)
                     แถวที่ประมาณขึ้นจะมี is_interpolated = true (ไม่ใช่ข้อมูลตรวจวัดจริง)
  3) Feature Mapping Inlet_Temperature   -> temp_inlet      (ใช้ค่าตรง)
                     Outlet_Temperature  -> temp_outlet     (ใช้ค่าตรง)
                     Server_Workload(%)  -> load_pct        (คอลัมน์เพิ่มจาก ER Diagram)
                     Ambient_Temperature -> ambient_temp    (ตัวแปรเสริม คอลัมน์เพิ่ม)
                     Cooling_Unit_Power (kW) -> power_watt  (ปรับสเกลเป็นระดับพัดลมตู้แร็ค ดู --fan-min-w/--fan-max-w)
                     ไม่มีในชุดข้อมูล: temp_internal, current_amp, fan_rpm, pwm_duty_cycle -> เว้นเป็น NULL
                     (temp_internal ต้องมาจากแบบจำลองความร้อนในตัวจำลองระบบ ตามตาราง 4.3 ไม่สร้างขึ้นเอง)
  4) Storage         เขียนลง rack_telemetry ภายใต้ rack_id แยกต่างหาก (ค่าเริ่มต้น dataset-demo)
                     เพื่อไม่ให้ปนกับข้อมูลจากอุปกรณ์จริง

ตัวอย่าง:
  pip install "psycopg[binary]"
  python tools/import_dataset.py /path/to/cold_source_control_dataset.csv            # เขียนลง DB
  python tools/import_dataset.py data.csv --dry-run --out preview.csv                # ดูผลโดยไม่แตะ DB
  python tools/import_dataset.py data.csv --replace --end-now                        # ล้างของเดิม + เลื่อนเวลาให้จบที่ "ตอนนี้"

ข้อควรระวัง: --end-now เลื่อนวันที่ของข้อมูล ใช้เพื่อให้ปุ่ม "ล่าสุด 6/12/24/48 ชม." ในแดชบอร์ดมีข้อมูลสำหรับเดโมเท่านั้น
"""
import argparse
import csv
import math
import os
import sys
from datetime import datetime, timedelta, timezone, tzinfo

COL_TS = "Timestamp"
COL_LOAD = "Server_Workload(%)"
COL_IN = "Inlet_Temperature(°C)"
COL_OUT = "Outlet_Temperature(°C)"
COL_AMB = "Ambient_Temperature(°C)"
COL_PWR = "Cooling_Unit_Power_Consumption(kW)"
NUMERIC = [COL_LOAD, COL_IN, COL_OUT, COL_AMB, COL_PWR]

# ช่วงที่เป็นไปได้ทางกายภาพ (ใช้ตรวจค่าผิดปกติ)
LIMITS = {
    COL_LOAD: (0, 100),
    COL_IN: (5, 45),
    COL_OUT: (5, 60),
    COL_AMB: (-10, 50),
    COL_PWR: (0, 100),
}

OUT_COLS = ["time", "rack_id", "temp_inlet", "temp_internal", "temp_outlet", "current_amp",
            "power_watt", "fan_rpm", "pwm_duty_cycle", "load_pct", "ambient_temp", "is_interpolated"]


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv_path")
    ap.add_argument("--rack-id", default="dataset-demo")
    ap.add_argument("--step-sec", type=int, default=300, help="ความถี่หลัง resample (วินาที) ค่าเริ่มต้น 300 = 5 นาที")
    ap.add_argument("--utc-offset", type=float, default=0.0,
                    help="เขตเวลาของ Timestamp ในไฟล์ (ชั่วโมงจาก UTC) ค่าเริ่มต้น 0 ไฟล์ไม่ได้ระบุเขตเวลา")
    ap.add_argument("--fan-min-w", type=float, default=2.0, help="กำลังพัดลมที่สเกลให้กับค่าต่ำสุดของ kW (W) [สมมติฐาน]")
    ap.add_argument("--fan-max-w", type=float, default=24.0,
                    help="กำลังพัดลมที่สเกลให้กับค่าสูงสุดของ kW (W) ค่าเริ่มต้น 24 = ขีดจำกัดอะแดปเตอร์ 12V 2A [สมมติฐาน]")
    ap.add_argument("--end-now", action="store_true", help="เลื่อนเวลาให้จุดสุดท้ายเท่ากับตอนนี้ (เพื่อเดโม)")
    ap.add_argument("--replace", action="store_true", help="ลบข้อมูลเดิมของ rack_id นี้ก่อนนำเข้า")
    ap.add_argument("--dry-run", action="store_true", help="ไม่เขียน DB")
    ap.add_argument("--out", help="เขียนผลลัพธ์ที่แปลงแล้วเป็นไฟล์ CSV (ใช้คู่กับ --dry-run เพื่อตรวจ)")
    ap.add_argument("--database-url", default=os.getenv("DATABASE_URL", "postgresql://rack:rackpw@localhost:5432/rackdb"))
    return ap.parse_args()


def clean(path, tz):
    """อ่านและทำความสะอาด คืน (rows เรียงตามเวลา, รายงาน)"""
    report = {"read": 0, "missing": 0, "out_of_range": 0, "duplicate_ts": 0, "kept": 0}
    seen, rows = set(), []
    with open(path, encoding="utf-8-sig", newline="") as f:
        rd = csv.DictReader(f)
        missing_cols = [c for c in [COL_TS] + NUMERIC if c not in (rd.fieldnames or [])]
        if missing_cols:
            sys.exit(f"ไม่พบคอลัมน์ที่ต้องใช้: {missing_cols}\nคอลัมน์ในไฟล์: {rd.fieldnames}")
        for r in rd:
            report["read"] += 1
            try:
                ts = datetime.strptime(r[COL_TS].strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=tz)
                vals = {c: float(r[c]) for c in NUMERIC}
            except (ValueError, TypeError, KeyError):
                report["missing"] += 1
                continue
            if any(math.isnan(v) or math.isinf(v) for v in vals.values()):
                report["missing"] += 1
                continue
            if any(not (LIMITS[c][0] <= v <= LIMITS[c][1]) for c, v in vals.items()):
                report["out_of_range"] += 1
                continue
            if ts in seen:
                report["duplicate_ts"] += 1
                continue
            seen.add(ts)
            rows.append((ts, vals))
    rows.sort(key=lambda x: x[0])
    report["kept"] = len(rows)
    return rows, report


def resample(rows, step_sec):
    """ประมาณค่าเชิงเส้นระหว่างจุดรายชั่วโมง คืน list ของ (ts, vals, is_interpolated)
    ไม่ประมาณข้ามช่องว่างที่ใหญ่กว่า 1.5 ชั่วโมง (ถือว่าข้อมูลขาด)"""
    out = []
    for i, (ts, vals) in enumerate(rows):
        out.append((ts, vals, False))
        if i + 1 >= len(rows):
            break
        ts2, vals2 = rows[i + 1]
        gap = (ts2 - ts).total_seconds()
        if gap > 5400:
            continue
        n = int(gap // step_sec)
        for k in range(1, n):
            frac = k * step_sec / gap
            if frac >= 1:
                break
            out.append((ts + timedelta(seconds=k * step_sec),
                        {c: vals[c] + (vals2[c] - vals[c]) * frac for c in NUMERIC}, True))
    return out


def to_db_rows(samples, rack_id, kw_min, kw_max, fan_min_w, fan_max_w):
    span = (kw_max - kw_min) or 1.0
    res = []
    for ts, v, interp in samples:
        watt = fan_min_w + (v[COL_PWR] - kw_min) / span * (fan_max_w - fan_min_w)
        res.append((ts, rack_id,
                    round(v[COL_IN], 3), None, round(v[COL_OUT], 3), None,
                    round(watt, 3), None, None,
                    round(v[COL_LOAD], 3), round(v[COL_AMB], 3), interp))
    return res


def write_db(db_rows, rack_id, url, replace):
    try:
        import psycopg
    except ImportError:
        sys.exit('ต้องติดตั้ง psycopg ก่อน:  python3 -m pip install --break-system-packages "psycopg[binary]"')
    with psycopg.connect(url, autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute("ALTER TABLE rack_telemetry ADD COLUMN IF NOT EXISTS load_pct real")
        cur.execute("ALTER TABLE rack_telemetry ADD COLUMN IF NOT EXISTS ambient_temp real")
        cur.execute("ALTER TABLE rack_telemetry ADD COLUMN IF NOT EXISTS is_interpolated boolean NOT NULL DEFAULT false")
        cur.execute("INSERT INTO rack_info (rack_id, location_zone, description) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                    (rack_id, "Dataset", "ชุดข้อมูลสาธารณะ cold_source_control_dataset.csv (ผ่านการ resample/ประมาณค่า ไม่ใช่ข้อมูลวัดจริง)"))
        if replace:
            cur.execute("DELETE FROM rack_telemetry WHERE rack_id = %s", (rack_id,))
            print(f"ลบข้อมูลเดิมของ {rack_id}: {cur.rowcount} แถว")
        sql = """INSERT INTO rack_telemetry
                 (time, rack_id, temp_inlet, temp_internal, temp_outlet, current_amp, power_watt,
                  fan_rpm, pwm_duty_cycle, load_pct, ambient_temp, is_interpolated)
                 VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (time, rack_id) DO NOTHING"""
        total = 0
        for i in range(0, len(db_rows), 5000):
            chunk = db_rows[i:i + 5000]
            cur.executemany(sql, chunk)
            total += len(chunk)
            print(f"  เขียนแล้ว {total}/{len(db_rows)}", end="\r")
        print()
        cur.execute("SELECT count(*), min(time), max(time) FROM rack_telemetry WHERE rack_id = %s", (rack_id,))
        n, t0, t1 = cur.fetchone()
        print(f"ใน DB ตอนนี้ rack_id={rack_id}: {n} แถว  {t0} -> {t1}")


def main():
    a = parse_args()
    tz = timezone(timedelta(hours=a.utc_offset))
    rows, rep = clean(a.csv_path, tz)
    print(f"[1] Cleaning: อ่าน {rep['read']} แถว | ขาดหาย/แปลงไม่ได้ {rep['missing']} | นอกช่วงกายภาพ {rep['out_of_range']} "
          f"| เวลาซ้ำ {rep['duplicate_ts']} | เหลือ {rep['kept']}")
    if not rows:
        sys.exit("ไม่มีข้อมูลที่ใช้ได้")

    samples = resample(rows, a.step_sec)
    n_orig = sum(1 for s in samples if not s[2])
    print(f"[2] Resample {a.step_sec}s: {len(samples)} แถว (ข้อมูลเดิม {n_orig} | ประมาณค่า {len(samples) - n_orig})")

    if a.end_now:
        shift = datetime.now(timezone.utc) - samples[-1][0]
        samples = [(ts + shift, v, i) for ts, v, i in samples]
        print(f"    เลื่อนเวลาไป {shift.days} วัน ให้จุดสุดท้ายเป็นปัจจุบัน (เพื่อเดโม)")

    kws = [r[1][COL_PWR] for r in rows]
    db_rows = to_db_rows(samples, a.rack_id, min(kws), max(kws), a.fan_min_w, a.fan_max_w)
    pw = [r[6] for r in db_rows]
    print(f"[3] Mapping: power_watt {min(pw):.2f}-{max(pw):.2f} W (สเกลจาก {min(kws)}-{max(kws)} kW) "
          f"| temp_internal/current_amp/fan_rpm/pwm = NULL (ไม่มีในชุดข้อมูล)")
    print(f"    ช่วงเวลา {db_rows[0][0].isoformat()} -> {db_rows[-1][0].isoformat()}")

    if a.out:
        with open(a.out, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(OUT_COLS)
            for r in db_rows:
                w.writerow([r[0].isoformat()] + ["" if x is None else x for x in r[1:]])
        print(f"    เขียนไฟล์ตัวอย่าง {a.out}")

    if a.dry_run:
        print("--dry-run: ไม่ได้เขียน DB")
        return
    print("[4] Storage: เขียนลง TimescaleDB")
    write_db(db_rows, a.rack_id, a.database_url, a.replace)


if __name__ == "__main__":
    main()
