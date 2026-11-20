import React, { useEffect, useMemo, useState } from 'react';
import { CONFIG } from './config.js';
import { useTelemetry } from './hooks/useTelemetry.js';
import { useAlerts } from './hooks/useAlerts.js';
import { summarize, exportCsv, fmtTime } from './utils.js';
import RangePicker from './components/RangePicker.jsx';
import StatCards from './components/StatCards.jsx';
import Charts from './components/Charts.jsx';
import RawTable from './components/RawTable.jsx';
import Settings from './components/Settings.jsx';
import CompareTab from './components/CompareTab.jsx';
import AlertsTab, { LevelTag } from './components/AlertsTab.jsx';

const presetRange = (hours) => {
  const to = Date.now();
  return { from: to - hours * 3600000, to };
};

// 5 แท็บตามรายงานหัวข้อ 3.10 (ตารางที่ 3.10)
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'history', label: 'History' },
  { key: 'compare', label: 'Compare' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'settings', label: 'Settings' },
];

export default function App() {
  const [tab, setTab] = useState('overview');
  const [preset, setPreset] = useState('24'); // '6' | '12' | '24' | '48' | 'custom'
  const [range, setRange] = useState(() => presetRange(24));
  const [setpoint, setSetpoint] = useState(CONFIG.setpoint);
  // แหล่งข้อมูลของแท็บ History: 'device' = ข้อมูลที่ backend บันทึกไว้จาก Realtime (rack-a12) | 'dataset' = ชุดข้อมูลสาธารณะ
  const canPickSource = !CONFIG.useMock && !!CONFIG.historyRackId;
  const [histSource, setHistSource] = useState('device');
  const historyRackId = canPickSource && histSource === 'dataset' ? CONFIG.historyRackId : CONFIG.rackId;

  // ข้อมูลสดทำงานตลอด (ทุกแท็บ) เพื่อให้ระบบแจ้งเตือนตรวจเกณฑ์ได้แม้ไม่ได้เปิดหน้า Overview
  const live = useTelemetry({ mode: 'live' });
  // ข้อมูลย้อนหลังดึงเฉพาะตอนเปิดแท็บ History
  const hist = useTelemetry({ mode: 'history', range, historyRackId, enabled: tab === 'history' });

  // tick ทุกวินาที เพื่ออัปเดตข้อความ "อัปเดตล่าสุด" และตรวจข้อมูลค้าง
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const latest = live.rows.length ? live.rows[live.rows.length - 1] : null;
  const ageMs = latest ? now - latest.ts : null;
  const stale = live.status === 'live' && ageMs !== null && ageMs > CONFIG.liveStaleMs;
  const summary = useMemo(() => summarize(hist.rows, setpoint), [hist.rows, setpoint]);

  const { alerts, addInfo, ack, ackAll, remove, clearAcked } = useAlerts({ rows: live.rows, status: live.status, stale, setpoint });
  const openAlerts = alerts.filter((a) => !a.ack);
  const openDanger = openAlerts.filter((a) => a.level === 'danger').length;

  const handlePreset = (key, hours) => {
    setPreset(key);
    setRange(presetRange(hours)); // คำนวณครั้งเดียวตอนกด เพื่อไม่ให้ fetch ซ้ำทุก render
  };
  const handleCustom = (from, to) => {
    setPreset('custom');
    setRange({ from, to });
  };
  const MODE_TH = { manual: 'Manual', pid_only: 'PID only', ai_predictive: 'AI predictive' };
  const handleCommand = ({ setpoint: sp, mode }) => addInfo(`ปรับค่าตั้ง: Setpoint ${Number(sp).toFixed(1)}°C · โหมด ${MODE_TH[mode] || mode}`);

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Rack temperature management</h1>
          <p className="muted">Rack {CONFIG.rackId.toUpperCase()} · ESP32 + SHT31 + ACS712</p>
        </div>
        <div className="top-right">
          {CONFIG.useMock && <span className="badge sim">ข้อมูลจำลอง (Simulated)</span>}
          {canPickSource && tab === 'history' && histSource === 'dataset' && (
            <span className="badge sim">ชุดข้อมูลสาธารณะ (ประมาณค่า ไม่ใช่ข้อมูลวัดจริง)</span>
          )}
          <StatusBadge status={live.status} stale={stale} ageMs={ageMs} />
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'alerts' && openAlerts.length > 0 && <span className={`count ${openDanger ? 'danger' : ''}`}>{openAlerts.length}</span>}
          </button>
        ))}
      </nav>

      {tab === 'settings' && <Settings setpoint={setpoint} onApplied={setSetpoint} onCommand={handleCommand} />}

      {tab === 'compare' && <CompareTab />}

      {tab === 'alerts' && <AlertsTab alerts={alerts} setpoint={setpoint} onAck={ack} onAckAll={ackAll} onRemove={remove} onClearAcked={clearAcked} />}

      {tab === 'history' && (
        <>
          <section className="panel">
            {canPickSource && (
              <div className="chips" style={{ marginBottom: 12 }}>
                <button className={histSource === 'device' ? 'chip on' : 'chip'} onClick={() => setHistSource('device')}>
                  ข้อมูลที่บันทึกจากอุปกรณ์ (Realtime)
                </button>
                <button className={histSource === 'dataset' ? 'chip on' : 'chip'} onClick={() => setHistSource('dataset')}>
                  ชุดข้อมูลสาธารณะ (cold_source_control)
                </button>
              </div>
            )}
            {canPickSource && histSource === 'dataset' && (
              <p className="muted small" style={{ marginTop: 0 }}>
                ชุดข้อมูลนี้ครอบคลุม 1 ม.ค. – 26 พ.ค. 2568 (ถ้าไม่ได้นำเข้าด้วย --end-now) ให้เลือก "กำหนดเอง" ในช่วงดังกล่าว
              </p>
            )}
            <RangePicker preset={preset} range={range} onPreset={handlePreset} onCustom={handleCustom} />
            <p className="muted small">
              ช่วงที่แสดง: {fmtTime(range.from, true)} – {fmtTime(range.to, true)}
            </p>
          </section>

          {hist.status === 'error' && <div className="banner danger">โหลดข้อมูลย้อนหลังไม่สำเร็จ: {hist.error}</div>}
          {hist.status === 'ready' && hist.rows.length === 0 && <div className="banner warn">ไม่มีข้อมูลในช่วงเวลาที่เลือก</div>}

          <StatCards mode="history" latest={null} summary={summary} setpoint={setpoint} />

          {hist.status === 'loading' ? <div className="panel loading">กำลังโหลดข้อมูล…</div> : <Charts rows={hist.rows} mode="history" setpoint={setpoint} />}

          <RawTable rows={hist.rows} />

          <div className="actions">
            <button className="btn" disabled={!hist.rows.length} onClick={() => exportCsv(hist.rows, `rack_${historyRackId}_history_${Date.now()}.csv`)}>
              ส่งออก CSV ({hist.rows.length} แถว)
            </button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            ผลสรุป "อยู่ในพิสัย ±{CONFIG.band}°C" เทียบกับ Setpoint ปัจจุบัน ถ้าเคยเปลี่ยน Setpoint ในช่วงที่เลือก ค่านี้อาจไม่ตรงกับ Setpoint ขณะนั้น
          </p>
        </>
      )}

      {tab === 'overview' && (
        <>
          {live.status === 'offline' && <div className="banner danger">เชื่อมต่อ MQTT Broker ไม่ได้ กำลังพยายามเชื่อมต่อใหม่…</div>}
          {stale && <div className="banner warn">ไม่ได้รับข้อมูลใหม่มาแล้ว {Math.round(ageMs / 1000)} วินาที — ตรวจสอบอุปกรณ์ ESP32</div>}

          <StatCards mode="live" latest={latest} summary={null} setpoint={setpoint} />

          {!CONFIG.useMock && (
            <p className="muted small latency">
              {live.latency
                ? `ความหน่วงเซนเซอร์ → แดชบอร์ด (ประกอบ QR-05): p95 ${(live.latency.p95 / 1000).toFixed(2)} s · สูงสุด ${(live.latency.max / 1000).toFixed(2)} s · n=${live.latency.count}` +
                  (live.latency.negative ? ` · พบค่าติดลบ ${live.latency.negative} ครั้ง (นาฬิกา ESP32 กับเครื่องนี้ไม่ตรงกัน)` : '')
                : 'ยังไม่มีข้อมูลความหน่วง (payload ต้องมี timestamp จาก ESP32 ที่ซิงก์ NTP แล้ว)'}
            </p>
          )}

          <Charts rows={live.rows} mode="live" setpoint={setpoint} />

          <section className="panel">
            <div className="panel-head">
              <h3>แจ้งเตือนล่าสุด</h3>
              <button className="chip" onClick={() => setTab('alerts')}>ดูทั้งหมด ({alerts.length})</button>
            </div>
            <ul className="alert-list compact">
              {alerts.slice(0, 3).map((a) => (
                <li key={a.id} className={`alert ${a.level} ${a.ack ? 'acked' : ''}`}>
                  <div className="alert-main">
                    <LevelTag level={a.level} />
                    <span className="alert-msg">{a.message}</span>
                  </div>
                  <span className="muted">{fmtTime(a.ts, true)}</span>
                </li>
              ))}
              {!alerts.length && <li className="empty-row">ยังไม่มีการแจ้งเตือน</li>}
            </ul>
          </section>

          <RawTable rows={live.rows} />

          <div className="actions">
            <button className="btn" disabled={!live.rows.length} onClick={() => exportCsv(live.rows, `rack_${CONFIG.rackId}_live_${Date.now()}.csv`)}>
              ส่งออก CSV ({live.rows.length} แถว)
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status, stale, ageMs }) {
  if (status === 'offline') return <span className="badge bad"><span className="dot off" /> ออฟไลน์</span>;
  if (status === 'connecting' || status === 'idle') return <span className="badge"><span className="dot wait" /> กำลังเชื่อมต่อ…</span>;
  if (stale) return <span className="badge warnb"><span className="dot wait" /> ข้อมูลค้าง</span>;
  return (
    <span className="badge good">
      <span className="dot live pulse" /> Live{ageMs !== null ? ` · ${Math.max(0, Math.round(ageMs / 1000))} วิที่แล้ว` : ''}
    </span>
  );
}
