#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ---- Configuration ----
const char* WIFI_SSID     = "Converge_Y39G";
const char* WIFI_PASSWORD = "Rojofamily";
const char* SUPABASE_URL  = "https://wjkvrwwpzngwfrxhcrlt.supabase.co/rest/v1/sensor_readings";
const char* SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indqa3Zyd3dwem5nd2ZyeGhjcmx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MDczNzIsImV4cCI6MjA4OTQ4MzM3Mn0.R-DlrG4gnyYS3hZr7_a_XlFzZg0hl64fsMaFG-QVZOU";

#define DHTPIN  4
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  dht.begin();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected! IP: " + WiFi.localIP().toString());
}

void loop() {
  float humidity    = dht.readHumidity();
  float temperature = dht.readTemperature();

  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("DHT11 read failed, retrying...");
    delay(2000);
    return;
  }

  Serial.printf("Temp: %.1f°C  Humidity: %.1f%%\n", temperature, humidity);

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(SUPABASE_URL);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
    http.addHeader("Prefer", "return=minimal");

    StaticJsonDocument<128> doc;
    doc["temperature"] = temperature;
    doc["humidity"]    = humidity;
    String body;
    serializeJson(doc, body);

    int code = http.POST(body);
    Serial.printf("Supabase response: %d\n", code);
    http.end();
  }

  delay(3000);
}