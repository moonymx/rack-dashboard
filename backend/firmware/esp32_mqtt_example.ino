// ตัวอย่างฝั่ง ESP32 (Arduino): ส่ง telemetry + รับคำสั่ง + ตอบ ack
// *** เป็นโค้ดตัวอย่างที่ยังไม่ได้ทดสอบกับบอร์ดจริง *** ใช้เป็นแนวทาง ต้องนำไปรวมกับโค้ด PID / เซนเซอร์เดิมของทีม
// ไลบรารี: PubSubClient, ArduinoJson (v6 หรือ v7)
//
// topic:  rack/<RACK_ID>/telemetry  (ESP32 -> Broker)
//         rack/<RACK_ID>/cmd        (แดชบอร์ด -> ESP32)  {cmd_id, setpoint, mode, manual_pwm}
//         rack/<RACK_ID>/ack        (ESP32 -> แดชบอร์ด)  {cmd_id, setpoint, mode}
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <sys/time.h>
#include <time.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASS";
const char* MQTT_HOST = "192.168.1.10";   // IP เครื่องที่รัน Mosquitto
const char* RACK_ID   = "rack-a12";

WiFiClient wifi;
PubSubClient mqtt(wifi);
String tTele, tCmd, tAck;
uint32_t seqNo = 0;

float setpoint = 30.0;
String controlMode = "pid_only";   // manual | pid_only | ai_predictive
float manualPwm = 50.0;

// timestamp ISO 8601 ระดับมิลลิวินาที (ต้องซิงก์ NTP ก่อน ไม่งั้นความหน่วง QR-05 วัดไม่ได้)
void isoNow(char* out, size_t n) {
  struct timeval tv; gettimeofday(&tv, nullptr);
  struct tm tmv; gmtime_r(&tv.tv_sec, &tmv);
  snprintf(out, n, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", tmv.tm_year + 1900, tmv.tm_mon + 1,
           tmv.tm_mday, tmv.tm_hour, tmv.tm_min, tmv.tm_sec, (int)(tv.tv_usec / 1000));
}

void onMessage(char* topic, byte* payload, unsigned int len) {
  JsonDocument doc;                       // ArduinoJson v7 (v6: StaticJsonDocument<256>)
  if (deserializeJson(doc, payload, len)) return;

  if (doc["setpoint"].is<float>()) setpoint = doc["setpoint"];
  if (doc["mode"].is<const char*>()) controlMode = doc["mode"].as<String>();
  if (doc["manual_pwm"].is<float>()) manualPwm = doc["manual_pwm"];
  // TODO: นำ setpoint / controlMode / manualPwm ไปใช้ในตัวควบคุม PID จริง ก่อนตอบ ack

  JsonDocument ack;
  ack["cmd_id"] = doc["cmd_id"];
  ack["setpoint"] = setpoint;
  ack["mode"] = controlMode;
  char buf[200]; size_t n = serializeJson(ack, buf);
  mqtt.publish(tAck.c_str(), (const uint8_t*)buf, n, false);
}

void connectMqtt() {
  while (!mqtt.connected()) {
    if (mqtt.connect(("esp32-" + String(RACK_ID)).c_str())) {
      mqtt.subscribe(tCmd.c_str(), 1);    // รับค่าล่าสุดที่ retain ไว้ทันทีหลังรีสตาร์ท
    } else delay(2000);
  }
}

void publishTelemetry(float tIn, float tInt, float tOut, float amp, float watt, int rpm, float pwm) {
  JsonDocument doc;
  char ts[32]; isoNow(ts, sizeof ts);
  doc["seq"] = seqNo++;                   // ใช้นับข้อความที่หาย (QR-08)
  doc["timestamp"] = ts;
  doc["temp_inlet"] = tIn;  doc["temp_internal"] = tInt;  doc["temp_outlet"] = tOut;
  doc["current_amp"] = amp; doc["power_watt"] = watt;
  doc["fan_rpm"] = rpm;     doc["pwm_duty_cycle"] = pwm;
  char buf[300]; size_t n = serializeJson(doc, buf);
  mqtt.publish(tTele.c_str(), (const uint8_t*)buf, n, false);
}

void setup() {
  tTele = String("rack/") + RACK_ID + "/telemetry";
  tCmd  = String("rack/") + RACK_ID + "/cmd";
  tAck  = String("rack/") + RACK_ID + "/ack";
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  configTime(0, 0, "pool.ntp.org", "time.google.com");   // ซิงก์เวลา
  mqtt.setServer(MQTT_HOST, 1883);
  mqtt.setCallback(onMessage);
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();
  static uint32_t last = 0;
  if (millis() - last >= 2000) {
    last = millis();
    // TODO: แทนค่าตัวอย่างด้วยค่าจาก SHT31 / ACS712 / Tachometer จริง
    publishTelemetry(23.4, 30.1, 27.8, 1.5, 18.6, 2340, 62.0);
  }
}
