# 🌡️ ESP32 Thermal-Aware Dashboard

A real-time web dashboard that reads **temperature and humidity** from an ESP32 microcontroller and displays it live on any browser — no app needed.

> Built with ESP32 + DHT sensor + Supabase (free cloud database) + GitHub Pages (free hosting)

**Live Demo → [troyikz01.github.io/ESP-32/](https://troyikz01.github.io/ESP-32/)**

---

## 📸 What It Does

Once everything is set up and your ESP32 is plugged in:

- The dashboard **automatically updates** every 3 seconds with new temperature and humidity readings
- The **color theme changes** based on how hot or cold it is (green = normal, orange = warm, red = danger, etc.)
- A **sound alert** plays when temperature hits dangerous levels
- You can **download the data as a CSV** file for reports or records
- It shows **ESP32 CONNECTED** when the device is active, and **ESP32 OFFLINE** when it's unplugged

---

## 🧰 What You Need

### Hardware
| Item | Details |
|---|---|
| ESP32 board | Any ESP32 development board |
| DHT sensor | DHT11 (blue, cheaper) or DHT22 (more accurate) |
| Jumper wires | 3 wires |
| USB cable | To power and program the ESP32 |

### Accounts (all free)
| Service | What it's for |
|---|---|
| [Supabase](https://supabase.com) | Stores your sensor data in the cloud |
| [GitHub](https://github.com) | Hosts your dashboard website for free |

---

## 🔌 Wiring Guide

Connect your DHT sensor to the ESP32 like this:

```
DHT Sensor Pin → ESP32 Pin
VCC  (power)   → 3.3V
GND  (ground)  → GND
DATA (signal)  → D2 (GPIO 4)
```

> ⚠️ Use **D2 (GPIO4)** — not D4. D4 is a boot pin and can cause issues.

If you're using a DHT11, it has 3 pins. If DHT22, it has 4 pins (skip the empty one).

---

## ☁️ Setting Up Supabase (Cloud Database)

Supabase is a free cloud database where your ESP32 will send its readings. The dashboard then reads from it in real-time.

### Step 1 — Create a Supabase account
Go to [supabase.com](https://supabase.com) → click **Start for free** → sign up with GitHub or email.

### Step 2 — Create a new project
- Click **New Project**
- Give it a name (e.g. `esp32-dashboard`)
- Set a database password (save it somewhere)
- Choose the region closest to you
- Click **Create new project** and wait ~1 minute

### Step 3 — Create the data table
Once your project is ready:
1. Click **Table Editor** in the left sidebar
2. Click **New Table**
3. Name it exactly: `sensor_readings`
4. Add these columns (click **Add Column** for each):

| Column Name | Type | Notes |
|---|---|---|
| `id` | int8 | ✅ Already there by default |
| `temperature` | float8 | Click Add Column |
| `humidity` | float8 | Click Add Column |
| `created_at` | timestamptz | ✅ Already there, set default to `now()` |

5. Click **Save**

### Step 4 — Enable Realtime
This lets the dashboard update instantly when new data arrives.
1. Left sidebar → **Database** → **Publications**
2. Click **supabase_realtime**
3. Find `sensor_readings` in the list → toggle it **ON**

### Step 5 — Allow the dashboard to read data (RLS Policy)
By default, Supabase blocks all public access. You need to allow reading:
1. Left sidebar → **Authentication** → **Policies**
2. Find `sensor_readings` → click **New Policy**
3. Choose **"Enable read access for all users"**
4. Click **Save**

### Step 6 — Get your API keys
1. Left sidebar → **Project Settings** → **API**
2. Copy your **Project URL** (looks like `https://abcdefgh.supabase.co`)
3. Copy your **anon/public key** (a long string of letters and numbers)

You'll need these in the next step.

---

## 💻 Setting Up the Dashboard

### Step 1 — Download the files
Clone or download this repository to your computer:
```bash
git clone https://github.com/Troyikz01/ESP-32.git
```
Or click **Code → Download ZIP** on GitHub.

### Step 2 — Add your Supabase credentials
Open `script.js` in any text editor (VS Code recommended).

Find these two lines at the very top:
```js
const SUPABASE_URL  = 'https://your-project-id.supabase.co';
const SUPABASE_ANON = 'your-anon-key-here';
```

Replace them with your actual values from Step 6 above:
```js
const SUPABASE_URL  = 'https://abcdefgh.supabase.co';    // your project URL
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5c...';   // your anon key
```

Save the file.

### Step 3 — Open the dashboard
Open `index.html` in your browser, or use **Live Server** in VS Code (right-click → Open with Live Server).

---

## 🤖 Programming the ESP32

This is the Arduino code that runs on the ESP32 and sends data to Supabase.

### Step 1 — Install Arduino IDE
Download from [arduino.cc/en/software](https://www.arduino.cc/en/software) if you don't have it.

### Step 2 — Add ESP32 board support
1. Open Arduino IDE → **File → Preferences**
2. Paste this URL in "Additional Board Manager URLs":
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Go to **Tools → Board → Board Manager** → search `esp32` → install **esp32 by Espressif**

### Step 3 — Install required libraries
Go to **Sketch → Include Library → Manage Libraries** and install:
- `DHT sensor library` by Adafruit
- `Adafruit Unified Sensor` by Adafruit
- `ArduinoJson` by Benoit Blanchon

### Step 4 — Upload the code
Open the `.ino` file inside the `HTTPS_ESP32_Cloud_Weather_Station` folder, or paste the code below into a new sketch.

Fill in your **WiFi name**, **WiFi password**, and **Supabase credentials**:

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <ArduinoJson.h>

// --- Sensor setup ---
#define DHTPIN    4       // D2 = GPIO4
#define DHTTYPE   DHT11   // Change to DHT22 if you're using that

// --- WiFi credentials ---
const char* ssid     = "YOUR_WIFI_NAME";
const char* password = "YOUR_WIFI_PASSWORD";

// --- Supabase credentials ---
const char* supabaseUrl = "https://your-project-id.supabase.co/rest/v1/sensor_readings";
const char* supabaseKey = "your-anon-key-here";

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  dht.begin();

  // Connect to WiFi
  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi connected! IP: " + WiFi.localIP().toString());
}

void loop() {
  float temperature = dht.readTemperature(); // Celsius
  float humidity    = dht.readHumidity();

  // Check if sensor read failed
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("❌ Failed to read from DHT sensor. Check wiring.");
    delay(3000);
    return;
  }

  Serial.printf("🌡️ Temp: %.1f°C | 💧 Humidity: %.1f%%\n", temperature, humidity);

  // Send data to Supabase
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(supabaseUrl);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("apikey", supabaseKey);
    http.addHeader("Authorization", String("Bearer ") + supabaseKey);
    http.addHeader("Prefer", "return=minimal");

    // Build JSON payload
    StaticJsonDocument<128> doc;
    doc["temperature"] = temperature;
    doc["humidity"]    = humidity;
    String body;
    serializeJson(doc, body);

    int responseCode = http.POST(body);

    if (responseCode == 201) {
      Serial.println("✅ Data sent to Supabase successfully");
    } else {
      Serial.printf("❌ Failed to send. HTTP code: %d\n", responseCode);
    }

    http.end();
  } else {
    Serial.println("⚠️ WiFi disconnected. Trying to reconnect...");
    WiFi.reconnect();
  }

  delay(3000); // Wait 3 seconds before next reading
}
```

Select your board: **Tools → Board → ESP32 Dev Module**
Select the correct COM port: **Tools → Port**
Click **Upload** (→ arrow button)

Open **Serial Monitor** (set to 115200 baud) to see live output.

---

## 📁 Project File Structure

```
ESP-32/
├── index.html                              # The dashboard webpage
├── style.css                               # All visual styling
├── script.js                               # All logic: Supabase, charts, live updates
├── HTTPS_ESP32_Cloud_Weather_Station/
│   └── HTTPS_ESP32_Cloud_Weather_Station.ino  # Arduino code for ESP32
└── README.md                               # This file
```

---

## 🎨 Thermal States Explained

The dashboard automatically changes color based on temperature + heat index:

| State | Condition | Color |
|---|---|---|
| 🟢 Normal | 20–28°C, comfortable | Green |
| 🟠 Warm | 28–35°C or heat index ≥ 32°C | Orange |
| 🔴 Hot | Above 35°C or heat index ≥ 38°C | Red + alert sound |
| 🔵 Cold | 15–20°C | Blue |
| 🟣 Freezing | Below 15°C | Purple |

> **Heat Index** is calculated automatically from temperature + humidity. It represents how hot it *actually feels*.

---

## ❓ Troubleshooting

| Problem | Solution |
|---|---|
| Dashboard shows old data | Hard refresh: `Ctrl + Shift + R` |
| ESP32 OFFLINE even when plugged in | Check Serial Monitor — is data being sent? Check WiFi credentials |
| No data in Supabase table | Check RLS policy is set to allow anon SELECT and INSERT |
| DHT read failed in Serial Monitor | Check wiring — DATA pin should be on GPIO4 |
| Charts not showing | Make sure there are at least 2 rows in your Supabase table |
| 404 on GitHub Pages | Go to repo Settings → Pages → set branch to `main` and folder to `/ (root)` |

---

## 👤 Author

**Troyikz01** — Northern Bukidnon State College
