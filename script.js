// ============================================================
// TROYIKZ — Heat Safety Monitor v2 (Enhanced)
// ============================================================

// ── Supabase ──
const SUPABASE_URL  = 'https://wjkvrwwpzngwfrxhcrlt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indqa3Zyd3dwem5nd2ZyeGhjcmx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MDczNzIsImV4cCI6MjA4OTQ4MzM3Mn0.R-DlrG4gnyYS3hZr7_a_XlFzZg0hl64fsMaFG-QVZOU';
const db    = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
const TABLE = 'sensor_readings';

let currentFilter  = 0;
let currentChartRange = 20;
let sessionStart   = new Date().toISOString();
let lastDataTime   = null;
let freshnessTimer = null;
let espConnected   = false;
let startTime      = Date.now();
let alarmEnabled   = true;

// ── Email alert config ──
const GAS_ALERT_URL        = 'https://script.google.com/macros/s/AKfycbxgL0bvvPSjgPcENRxmB0_8m_9Awg2UzkCKOYuGGqz-SXSg76U-mssV9S976ZFx0aIr_w/exec';
let   ALERT_TEMP_THRESHOLD = 38;
const ALERT_COOLDOWN_MS    = 5 * 60 * 1000;
const ALERT_LOCATION       = 'Room 1';
let lastAlertSentAt = 0;

// ── Freshness thresholds (seconds) ──
const FRESH_OK    = 8;
const FRESH_STALE = 30;
const FRESH_DEAD  = 300;

// ── Previous values for trend ──
let prevHI   = null;
let prevTemp = null;
let prevHumi = null;

// ── Alert history ──
let alertHistory = [];


// ============================================================
// HEAT INDEX — Steadman formula
// ============================================================
function calcHeatIndex(t, h) {
  if (t < 27) return t;
  return Math.round((-8.78469475556
    + 1.61139411    * t
    + 2.33854883889 * h
    - 0.14611605    * t * h
    - 0.012308094   * t * t
    - 0.016424828   * h * h
    + 0.002211732   * t * t * h
    + 0.00072546    * t * h * h
    - 0.000003582   * t * t * h * h) * 10) / 10;
}


// ============================================================
// RISK CLASSIFICATION
// ============================================================
const RISK_LEVELS = [
  { level:0, key:'safe',     label:'SAFE',            color:'#22c55e',
    advice:'Conditions are comfortable. Normal activities are safe.',
    banner:false,
    // ✅ IMPROVEMENT 1: Recommendations
    recommendations:[
      { icon:'💧', text:'Stay hydrated regularly' },
      { icon:'🌿', text:'Normal activity OK' },
      { icon:'😊', text:'Comfortable conditions' },
      { icon:'☀️', text:'Light clothing recommended' },
    ]
  },
  { level:1, key:'caution',  label:'CAUTION',         color:'#a3e635',
    advice:'Fatigue is possible with prolonged exposure. Drink water regularly and take breaks in the shade.',
    banner:false,
    recommendations:[
      { icon:'💧', text:'Drink water every 30 min' },
      { icon:'🌳', text:'Rest in shaded areas' },
      { icon:'🕐', text:'Limit activity duration' },
      { icon:'👕', text:'Wear light, loose clothing' },
    ]
  },
  { level:2, key:'xcaution', label:'EXTREME CAUTION', color:'#facc15',
    advice:'Heat cramps and heat exhaustion are possible. Limit strenuous activity, stay hydrated, and rest in a cool area.',
    banner:true, bannerTitle:'EXTREME CAUTION',
    bannerMsg:'Heat cramps and exhaustion are possible. Limit outdoor exposure and stay hydrated.',
    recommendations:[
      { icon:'💧', text:'Drink water every 15 min' },
      { icon:'🪭', text:'Turn on electric fan' },
      { icon:'🚫', text:'Avoid outdoor activity' },
      { icon:'🌡', text:'Monitor body temperature' },
    ]
  },
  { level:3, key:'danger',   label:'DANGER',          color:'#f97316',
    advice:'⚠ Heat cramps and exhaustion are very likely. Move to a cool environment now, drink water immediately, and monitor for heat stroke symptoms.',
    banner:true, bannerTitle:'HEAT DANGER',
    bannerMsg:'Heat cramps and exhaustion are very likely. Move to a cool area immediately.',
    recommendations:[
      { icon:'❄️', text:'Move to air-conditioned area' },
      { icon:'💧', text:'Drink cold water immediately' },
      { icon:'🛑', text:'Stop all strenuous activity' },
      { icon:'🧊', text:'Apply cold compress to neck' },
    ]
  },
  { level:4, key:'extreme',  label:'EXTREME DANGER',  color:'#ef4444',
    advice:'🔴 HEAT STROKE IS IMMINENT. Move everyone to a cool environment, call emergency services if needed, and stop all physical activity immediately.',
    banner:true, bannerTitle:'EXTREME DANGER — HEAT STROKE RISK',
    bannerMsg:'Heat stroke is imminent. Emergency action required. Call for help if needed.',
    recommendations:[
      { icon:'🆘', text:'Call emergency services!' },
      { icon:'❄️', text:'Cool body with ice packs' },
      { icon:'🏥', text:'Seek medical help now' },
      { icon:'🛑', text:'Stop ALL physical activity' },
    ]
  },
];

function getRiskFromHI(hi) {
  if (hi >= 52) return RISK_LEVELS[4];
  if (hi >= 42) return RISK_LEVELS[3];
  if (hi >= 33) return RISK_LEVELS[2];
  if (hi >= 27) return RISK_LEVELS[1];
  return RISK_LEVELS[0];
}

function getThermalClass(hi, t) {
  if (hi >= 42 || t >= 38) return 'thermal-hot';
  if (hi >= 33 || t >= 30) return 'thermal-warm';
  if (t < 15)              return 'thermal-freezing';
  if (t < 20)              return 'thermal-cold';
  return 'thermal-normal';
}

function getHumiDesc(h) {
  if (h > 85) return { text:'Very Humid', color:'#f472b6' };
  if (h > 70) return { text:'Humid',      color:'#fb923c' };
  if (h >= 40) return { text:'Normal',    color:'#22c55e' };
  if (h >= 25) return { text:'Dry',       color:'#facc15' };
  return               { text:'Very Dry', color:'#38bdf8' };
}

function getTempDesc(t) {
  if (t >= 40) return { text:'Extreme',  color:'#ef4444' };
  if (t >= 35) return { text:'Very Hot', color:'#f97316' };
  if (t >= 30) return { text:'Hot',      color:'#fb923c' };
  if (t >= 25) return { text:'Warm',     color:'#facc15' };
  if (t >= 20) return { text:'Comfort',  color:'#22c55e' };
  if (t >= 15) return { text:'Cool',     color:'#38bdf8' };
  return               { text:'Cold',    color:'#a78bfa' };
}

function getTrend(cur, prev) {
  if (prev === null) return '→';
  const diff = cur - prev;
  if (diff > 0.3) return '↑';
  if (diff < -0.3) return '↓';
  return '→';
}

function getTrendColor(trend) {
  if (trend === '↑') return '#f97316';
  if (trend === '↓') return '#38bdf8';
  return '#5a6a82';
}


// ============================================================
// DATA FRESHNESS + CONNECTION STATE
// ============================================================
function updateFreshness() {
  if (!lastDataTime) return;
  const age = (Date.now() - lastDataTime) / 1000;

  const espBadge    = document.getElementById('espBadge');
  const espLabel    = document.getElementById('espLabel');
  const freshBadge  = document.getElementById('freshnessBadge');
  const freshText   = document.getElementById('freshnessText');
  const overlay     = document.getElementById('offlineOverlay');
  const livePill    = document.getElementById('livePill');
  const liveLabel   = document.getElementById('liveLabel');
  const sensorESP   = document.getElementById('sensorESP');
  const sensorAge   = document.getElementById('sensorAge');
  const alarmStatus = document.getElementById('alarmStatusVal');

  const fmtAge = () => {
    if (age < 5)  return 'Just now';
    if (age < 60) return `${Math.round(age)}s ago`;
    const m = Math.floor(age / 60), s = Math.round(age % 60);
    return `${m}m ${s}s ago`;
  };

  if (age < FRESH_OK) {
    espBadge.dataset.state  = 'connected';
    espLabel.textContent    = 'ESP32: Connected';
    freshBadge.dataset.state = 'ok';
    freshText.textContent   = 'LIVE';
    livePill.dataset.state  = 'live';
    liveLabel.textContent   = 'LIVE';
    espConnected = true;
    if (sensorESP) sensorESP.innerHTML = '<span class="status-dot-inline dot-ok"></span>Connected';
    if (sensorAge) { sensorAge.textContent = 'Just now'; sensorAge.className = 'sr-val sr-ok'; }
    if (alarmStatus) alarmStatus.innerHTML = '<span class="status-dot-inline dot-ok"></span>Active';
    if (overlay) overlay.classList.remove('show');

  } else if (age < FRESH_STALE) {
    espBadge.dataset.state  = 'stale';
    espLabel.textContent    = 'ESP32: Recent';
    freshBadge.dataset.state = 'stale';
    freshText.textContent   = fmtAge();
    livePill.dataset.state  = 'stale';
    liveLabel.textContent   = fmtAge();
    espConnected = false;
    if (sensorESP) sensorESP.innerHTML = '<span class="status-dot-inline dot-warn"></span>Recent';
    if (sensorAge) { sensorAge.textContent = fmtAge(); sensorAge.className = 'sr-val sr-warn'; }
    if (overlay) overlay.classList.remove('show');

  } else if (age < FRESH_DEAD) {
    espBadge.dataset.state  = 'offline';
    espLabel.textContent    = 'ESP32: Offline';
    freshBadge.dataset.state = 'offline';
    freshText.textContent   = fmtAge();
    livePill.dataset.state  = 'offline';
    liveLabel.textContent   = 'OFFLINE';
    espConnected = false;
    if (sensorESP) sensorESP.innerHTML = '<span class="status-dot-inline dot-bad"></span>Offline';
    if (sensorAge) { sensorAge.textContent = fmtAge(); sensorAge.className = 'sr-val sr-bad'; }
    if (alarmStatus) alarmStatus.innerHTML = '<span class="status-dot-inline dot-bad"></span>Offline';
    if (overlay) overlay.classList.remove('show');

  } else {
    espBadge.dataset.state  = 'offline';
    espLabel.textContent    = 'ESP32: Offline';
    freshBadge.dataset.state = 'offline';
    freshText.textContent   = fmtAge();
    livePill.dataset.state  = 'offline';
    liveLabel.textContent   = 'OFFLINE';
    espConnected = false;
    if (sensorESP) sensorESP.innerHTML = '<span class="status-dot-inline dot-bad"></span>Offline';
    if (sensorAge) { sensorAge.textContent = fmtAge(); sensorAge.className = 'sr-val sr-bad'; }
    if (alarmStatus) alarmStatus.innerHTML = '<span class="status-dot-inline dot-bad"></span>No Signal';
    if (overlay) {
      overlay.classList.add('show');
      const sub = document.getElementById('offlineSub');
      if (sub) sub.textContent = `Last data: ${new Date(lastDataTime).toLocaleTimeString()}`;
    }
  }

  const uptimeLabel = document.getElementById('uptimeLabel');
  if (uptimeLabel) {
    const secs = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(secs / 60), s = secs % 60;
    const h = Math.floor(m / 60);
    if (h > 0) uptimeLabel.textContent = `Uptime: ${h}h ${m%60}m`;
    else       uptimeLabel.textContent = `Uptime: ${m}m ${s}s`;
  }
}


// ============================================================
// IMPROVEMENT 1: UPDATE RECOMMENDATIONS
// ============================================================
function updateRecommendations(risk) {
  const box  = document.getElementById('recommendationsBox');
  const grid = document.getElementById('recGrid');
  if (!box || !grid) return;

  // Update box styling
  box.className = 'recommendations-box';
  if (risk.key !== 'safe' && risk.key !== 'caution') {
    box.classList.add('risk-' + risk.key);
  }

  // Render recommendation items
  grid.innerHTML = risk.recommendations.map(r =>
    `<div class="rec-item">
      <span class="rec-item-icon">${r.icon}</span>
      <span class="rec-item-text">${r.text}</span>
    </div>`
  ).join('');
}


// ============================================================
// IMPROVEMENT 2: ALERT HISTORY
// ============================================================
function addAlertHistoryEntry(t, h, hi, risk) {
  const entry = {
    time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
    status: risk.label,
    statusKey: risk.key,
    temperature: t.toFixed(1),
    humidity: h.toFixed(1),
    heatIndex: hi,
    action: risk.level >= 3 ? 'Email Sent' : risk.level >= 2 ? 'Alert Shown' : 'Logged'
  };

  alertHistory.unshift(entry);
  if (alertHistory.length > 50) alertHistory.pop(); // keep max 50

  renderAlertHistory();
}

function renderAlertHistory() {
  const tbody  = document.getElementById('alertHistoryBody');
  const countEl = document.getElementById('alertHistoryCount');
  if (!tbody) return;

  if (alertHistory.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">No alerts recorded yet. System monitoring…</td></tr>';
    if (countEl) countEl.textContent = '0 events';
    return;
  }

  if (countEl) countEl.textContent = `${alertHistory.length} event${alertHistory.length !== 1 ? 's' : ''}`;

  tbody.innerHTML = alertHistory.map(e => `
    <tr>
      <td>${e.time}</td>
      <td><span class="pill pill-${e.statusKey}">${e.status}</span></td>
      <td class="td-temp">${e.temperature}°C</td>
      <td class="td-humi">${e.humidity}%</td>
      <td class="td-hi">${e.heatIndex}°C</td>
      <td style="color:var(--muted)">${e.action}</td>
    </tr>
  `).join('');
}


// ============================================================
// FETCH LATEST & UPDATE UI
// ============================================================
async function fetchLatest() {
  const { data, error } = await db
    .from(TABLE).select('*')
    .order('created_at', { ascending: false })
    .limit(1).single();

  if (error) { console.error('[fetchLatest]', error.message); return; }

  const t  = data.temperature;
  const h  = data.humidity;
  const hi = calcHeatIndex(t, h);

  lastDataTime = new Date(data.created_at).getTime();
  updateFreshness();

  const risk = getRiskFromHI(hi);

  // ── Hero Heat Index ──
  const heroNum = document.getElementById('heroHI');
  if (heroNum) {
    heroNum.textContent = hi;
    heroNum.style.color = risk.color;
    heroNum.style.textShadow = `0 0 48px ${risk.color}55, 0 0 80px ${risk.color}22`;
  }

  // Risk badge
  const badge = document.getElementById('riskBadge');
  const label = document.getElementById('riskLabel');
  if (badge && label) {
    label.textContent = risk.label;
    badge.style.color       = risk.color;
    badge.style.borderColor = risk.color + '66';
    badge.style.background  = risk.color + '18';
  }

  // Risk advice
  const advEl = document.getElementById('riskAdvice');
  if (advEl) advEl.textContent = risk.advice;

  // Risk bar segments
  for (let i = 0; i < 5; i++) {
    const seg = document.getElementById(`hrs${i}`);
    if (seg) seg.classList.toggle('active', i === risk.level);
  }

  // Heat pill
  const heatPill      = document.getElementById('heatPill');
  const heatPillLabel = document.getElementById('heatPillLabel');
  if (heatPill) heatPill.dataset.risk = risk.key;
  if (heatPillLabel) heatPillLabel.textContent = `Heat: ${risk.label}`;

  // HI Trend
  const hiTrendEl = document.getElementById('hiTrend');
  if (hiTrendEl) {
    const trend = getTrend(hi, prevHI);
    hiTrendEl.textContent = `HI ${trend}`;
    hiTrendEl.style.color = getTrendColor(trend);
  }
  prevHI = hi;

  // ── Temperature ──
  const tempDesc = getTempDesc(t);
  const tempVal     = document.getElementById('tempValue');
  const tempStatus  = document.getElementById('tempStatus');
  const tempTrendEl = document.getElementById('tempTrend');
  const tempBar     = document.getElementById('tempBar');

  if (tempVal) {
    tempVal.textContent = t.toFixed(1);
    tempVal.style.color = tempDesc.color;
    const mc = document.getElementById('mcTemp');
    if (mc) mc.style.setProperty('--mc-accent', tempDesc.color);
  }
  if (tempStatus) {
    tempStatus.textContent = tempDesc.text;
    tempStatus.style.color = tempDesc.color;
    tempStatus.style.borderColor = tempDesc.color + '55';
  }
  if (tempTrendEl) {
    const trend = getTrend(t, prevTemp);
    tempTrendEl.textContent = trend;
    tempTrendEl.style.color = getTrendColor(trend);
  }
  if (tempBar) {
    const pct = Math.min(100, Math.max(0, (t / 50) * 100));
    tempBar.style.width = pct + '%';
    tempBar.style.background = tempDesc.color;
    tempBar.style.boxShadow = `0 0 8px ${tempDesc.color}55`;
  }
  prevTemp = t;

  // ── Humidity ──
  const humiDesc = getHumiDesc(h);
  const humiVal     = document.getElementById('humiValue');
  const humiStatus  = document.getElementById('humiStatus');
  const humiTrendEl = document.getElementById('humiTrend');
  const humiBar     = document.getElementById('humiBar');

  if (humiVal) {
    humiVal.textContent = h.toFixed(1);
    humiVal.style.color = humiDesc.color;
    const mc = document.getElementById('mcHumi');
    if (mc) mc.style.setProperty('--mc-accent', humiDesc.color);
  }
  if (humiStatus) {
    humiStatus.textContent = humiDesc.text;
    humiStatus.style.color = humiDesc.color;
    humiStatus.style.borderColor = humiDesc.color + '55';
  }
  if (humiTrendEl) {
    const trend = getTrend(h, prevHumi);
    humiTrendEl.textContent = trend;
    humiTrendEl.style.color = getTrendColor(trend);
  }
  if (humiBar) {
    humiBar.style.width = Math.min(100, h) + '%';
    humiBar.style.background = humiDesc.color;
    humiBar.style.boxShadow = `0 0 8px ${humiDesc.color}55`;
  }
  prevHumi = h;

  updateGauge(risk);

  // ── Thermal body class ──
  const thermalCls = getThermalClass(hi, t);
  document.body.classList.remove('thermal-hot','thermal-warm','thermal-normal','thermal-cold','thermal-freezing');
  document.body.classList.add(thermalCls);

  // ── Alert banner ──
  const banner = document.getElementById('alertBanner');
  if (banner) {
    if (risk.banner) {
      banner.classList.add('show');
      const atEl = document.getElementById('alertTitle');
      const amEl = document.getElementById('alertMsg');
      if (atEl) atEl.textContent = risk.bannerTitle;
      if (amEl) amEl.textContent = risk.bannerMsg;
      banner.style.setProperty('border-bottom-color', risk.color);
    } else {
      banner.classList.remove('show');
    }
  }

  // ── Alarm indicator ──
  const alarmInd   = document.getElementById('alarmIndicator');
  const alarmLabel = document.getElementById('alarmLabel');
  if (alarmInd && risk.level >= 2) {
    alarmInd.dataset.active = 'true';
    if (alarmLabel) alarmLabel.textContent = risk.label;
  } else if (alarmInd) {
    alarmInd.dataset.active = 'false';
    if (alarmLabel) alarmLabel.textContent = 'Monitoring';
  }

  // ── Last update ──
  const updEl = document.getElementById('lastUpdate');
  if (updEl) updEl.textContent = 'Last Update: ' + new Date(data.created_at).toLocaleTimeString();

  // ── IMPROVEMENT 1: Recommendations ──
  updateRecommendations(risk);

  // ── IMPROVEMENT 2: Alert History — log if at risk level >=2 ──
  if (risk.level >= 2) {
    addAlertHistoryEntry(t, h, hi, risk);
  }

  // ── Email alert ──
  sendEmailAlert(t, h, hi);
}

function updateGauge(risk) {
  const lvl = risk.level;
  for (let i = 0; i < 5; i++) {
    const seg = document.getElementById(`gseg${i}`);
    if (seg) seg.classList.toggle('active', i === lvl);
  }
  const needle = document.getElementById('gaugeNeedle');
  if (needle) needle.style.left = `${(lvl / 4) * 100}%`;

  const status = document.getElementById('gaugeStatus');
  if (status) { status.textContent = '● ' + risk.label; status.style.color = risk.color; }

  const gauge = document.getElementById('gaugeWidget');
  if (gauge) gauge.style.borderColor = risk.color + '66';
}


// ============================================================
// FETCH COUNTS
// ============================================================
async function fetchCounts() {
  const { count: total } = await db.from(TABLE).select('*', { count:'exact', head:true });
  const start = new Date(); start.setHours(0,0,0,0);
  const { count: today } = await db.from(TABLE).select('*', { count:'exact', head:true })
    .gte('created_at', start.toISOString());

  if (total !== null) document.getElementById('totalValue').textContent = total.toLocaleString();

  const todayEl  = document.getElementById('todayValue');
  const todaySub = document.getElementById('todaySubLabel');
  if (todayEl) todayEl.textContent = today !== null ? today.toLocaleString() : '0';
  if (todaySub) {
    if (today === 0) todaySub.textContent = 'No data yet today';
    else todaySub.textContent = `Every ~3 seconds`;
  }
}


// ============================================================
// CHARTS — with IMPROVEMENT 6 (time filter + stats)
// ============================================================
async function fetchChartData(limit = 20) {
  const { data, error } = await db
    .from(TABLE).select('temperature,humidity,created_at')
    .order('created_at', { ascending:false }).limit(limit);
  if (error || !data) return;
  const rows = [...data].reverse();

  renderTempChart(rows);
  renderHumiChart(rows);
  updateChartStats(rows);
}

// ✅ IMPROVEMENT 6: Chart summary stats
function updateChartStats(rows) {
  if (!rows.length) return;
  const his   = rows.map(r => calcHeatIndex(r.temperature, r.humidity));
  const temps = rows.map(r => r.temperature);

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('chartMinHI',   Math.min(...his).toFixed(1) + '°C');
  setEl('chartMaxHI',   Math.max(...his).toFixed(1) + '°C');
  setEl('chartAvgHI',   (his.reduce((a,b)=>a+b,0)/his.length).toFixed(1) + '°C');
  setEl('chartAvgTemp', (temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1) + '°C');
}

function buildSVG(container, datasets, thresholds, opts) {
  const W   = container.clientWidth  || 560;
  const H   = container.clientHeight || 200;
  const pad = { top:18, right:48, bottom:32, left:44 };
  const cW  = W - pad.left - pad.right;
  const cH  = H - pad.top  - pad.bottom;

  const all    = datasets.flatMap(d => d.values);
  const rawMin = Math.min(...all), rawMax = Math.max(...all);
  const buf    = Math.max(3, (rawMax - rawMin) * 0.2);
  const minV   = rawMin - buf, maxV = rawMax + buf;
  const rng    = maxV - minV || 1;
  const n      = datasets[0].values.length;

  function tx(i) { return pad.left + (i / Math.max(n - 1, 1)) * cW; }
  function ty(v) { return pad.top  + cH - ((v - minV) / rng) * cH; }

  const steps = 4;
  let gridHTML = '';
  for (let i = 1; i < steps; i++) {
    const y = pad.top + (cH / steps) * i;
    const val = (maxV - (rng / steps) * i).toFixed(0);
    gridHTML += `
      <line x1="${pad.left}" y1="${y}" x2="${pad.left+cW}" y2="${y}"
        stroke="#1c2530" stroke-width="1" stroke-dasharray="4,6" opacity="0.8"/>
      <text x="${pad.left-5}" y="${y+4}" text-anchor="end" font-size="9" fill="#3a4a60" font-family="monospace">${val}</text>`;
  }
  gridHTML += `<text x="${pad.left-5}" y="${pad.top+4}" text-anchor="end" font-size="9" fill="#3a4a60" font-family="monospace">${maxV.toFixed(0)}</text>`;
  gridHTML += `<text x="${pad.left-5}" y="${pad.top+cH+4}" text-anchor="end" font-size="9" fill="#3a4a60" font-family="monospace">${minV.toFixed(0)}</text>`;

  let threshHTML = '';
  (thresholds || []).forEach(th => {
    if (th.val < minV || th.val > maxV) return;
    const y = ty(th.val);
    threshHTML += `
      <line x1="${pad.left}" y1="${y}" x2="${pad.left+cW}" y2="${y}"
        stroke="${th.color}" stroke-width="1.2" stroke-dasharray="5,5" opacity="0.45"/>
      <text x="${pad.left+cW+4}" y="${y+4}" font-size="8" fill="${th.color}" opacity="0.7" font-family="monospace">${th.label}</text>`;
  });

  const labels = opts.labels || [];
  const step   = Math.ceil(n / 5);
  const xLabels = labels.map((l, idx) => {
    if (idx % step !== 0 && idx !== n-1) return '';
    return `<text x="${tx(idx)}" y="${H-4}" text-anchor="middle" font-size="8" fill="#3a4a60" font-family="monospace">${l}</text>`;
  }).join('');

  let dataHTML = '';
  datasets.forEach(d => {
    const pts = d.values.map((v,i) => `${tx(i)},${ty(v)}`).join(' ');
    const fill = `${tx(0)},${pad.top+cH} ${pts} ${tx(n-1)},${pad.top+cH}`;
    const gradId = `grad_${Math.random().toString(36).slice(2)}`;
    dataHTML += `
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${d.color}" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="${d.color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${fill}" fill="url(#${gradId})" stroke="none"/>
      <polyline points="${pts}" fill="none" stroke="${d.color}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round"/>
      ${d.values.map((v,i) => `<circle cx="${tx(i)}" cy="${ty(v)}" r="3.5"
        fill="${d.color}" stroke="var(--bg,#0a0d14)" stroke-width="1.8"
        class="chart-dot" data-i="${i}" opacity="0.85"/>`).join('')}`;
  });

  let hoverHTML = '';
  for (let i = 0; i < n; i++) {
    hoverHTML += `<rect x="${tx(i) - cW/(n*2)}" y="${pad.top}" width="${cW/n}" height="${cH}"
      fill="transparent" class="hover-zone" data-i="${i}" style="cursor:crosshair"/>`;
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;overflow:visible">
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top+cH}" stroke="#1c2530" stroke-width="1"/>
      <line x1="${pad.left}" y1="${pad.top+cH}" x2="${pad.left+cW}" y2="${pad.top+cH}" stroke="#1c2530" stroke-width="1"/>
      ${gridHTML}${threshHTML}${dataHTML}${xLabels}${hoverHTML}
    </svg>`;
}

function attachTooltip(container, datasets, labels, tipEl) {
  const zones = container.querySelectorAll('.hover-zone');
  zones.forEach(zone => {
    zone.addEventListener('mousemove', (e) => {
      const i    = parseInt(zone.dataset.i);
      const rect = container.getBoundingClientRect();
      const x    = e.clientX - rect.left;
      const y    = e.clientY - rect.top;
      const time = labels[i] || '';
      let html = `<b>${time}</b><br>`;
      datasets.forEach(d => {
        html += `<span style="color:${d.color}">■</span> ${d.label}: <b>${d.values[i].toFixed(1)}${d.unit}</b><br>`;
      });
      tipEl.innerHTML = html;
      const tw = 170, th = 80;
      let lx = x + 16, ly = y - 14;
      if (lx + tw > rect.width)  lx = x - tw - 12;
      if (ly + th > rect.height) ly = y - th - 10;
      if (ly < 0) ly = 4;
      tipEl.style.left = lx + 'px';
      tipEl.style.top  = ly + 'px';
      tipEl.classList.add('visible');
    });
    zone.addEventListener('mouseleave', () => tipEl.classList.remove('visible'));
  });
}

function renderTempChart(rows) {
  const container = document.getElementById('tempChart');
  const tipEl     = document.getElementById('tempTip');
  if (!container) return;
  const labels = rows.map(r => new Date(r.created_at).toLocaleTimeString([],{ hour:'2-digit', minute:'2-digit', second:'2-digit' }));
  const datasets = [
    { values:rows.map(r => calcHeatIndex(r.temperature, r.humidity)), color:'#e11d48', label:'Heat Index', unit:'°C' },
    { values:rows.map(r => r.temperature),                            color:'#f97316', label:'Temp',       unit:'°C' },
  ];
  const thresholds = [
    { val:52, color:'#ef4444', label:'Extreme'   },
    { val:42, color:'#f97316', label:'Danger'    },
    { val:33, color:'#facc15', label:'X-Caution' },
    { val:27, color:'#a3e635', label:'Caution'   },
  ];
  buildSVG(container, datasets, thresholds, { labels });
  if (tipEl) attachTooltip(container, datasets, labels, tipEl);
}

function renderHumiChart(rows) {
  const container = document.getElementById('humiChart');
  const tipEl     = document.getElementById('humiTip');
  if (!container) return;
  const labels = rows.map(r => new Date(r.created_at).toLocaleTimeString([],{ hour:'2-digit', minute:'2-digit', second:'2-digit' }));
  const datasets = [
    { values:rows.map(r => r.humidity), color:'#38bdf8', label:'Humidity', unit:'%' },
  ];
  const thresholds = [
    { val:85, color:'#f472b6', label:'Very Humid' },
    { val:70, color:'#f97316', label:'Humid'      },
    { val:40, color:'#38bdf8', label:'Ideal Low'  },
  ];
  buildSVG(container, datasets, thresholds, { labels });
  if (tipEl) attachTooltip(container, datasets, labels, tipEl);
}


// ============================================================
// TABLE
// ============================================================
function oneHourKey(dateStr) {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' });
  const h = d.getHours(), hEnd = (h+1) % 24;
  const to12 = x => (x%12||12);
  const ampm = hEnd >= 12 ? 'PM' : 'AM';
  return `${date} — ${to12(h)}:00–${to12(hEnd)}:00 ${ampm}`;
}

function makeRiskPill(hi) {
  const r = getRiskFromHI(hi);
  return `<span class="pill pill-${r.key}">${r.label}</span>`;
}

function makeDataRow(r, visible) {
  const hi = calcHeatIndex(r.temperature, r.humidity);
  const tr = document.createElement('tr');
  tr.dataset.id = r.id;
  tr.style.display = visible ? '' : 'none';
  tr.innerHTML = `
    <td>${new Date(r.created_at).toLocaleTimeString()}</td>
    <td class="td-hi">${hi}°C</td>
    <td class="td-temp">${r.temperature.toFixed(1)}°C</td>
    <td class="td-humi">${r.humidity.toFixed(1)}%</td>
    <td>${makeRiskPill(hi)}</td>
    <td></td>`;
  return tr;
}

function makeGroupHeader(key, count, expanded) {
  const tr = document.createElement('tr');
  tr.className = 'session-hdr';
  tr.dataset.key = key;
  tr.innerHTML = `<td colspan="6">
    <span class="grp-toggle">${expanded ? '▼' : '▶'}</span>
    <span class="grp-label">${key}</span>
    <span class="grp-count">${count} readings</span>
    <button class="btn-grp-dl">⬇ CSV</button>
    <button class="btn-grp-del">🗑 Delete</button>
  </td>`;
  tr.addEventListener('click', function(e) {
    if (e.target.closest('.btn-grp-dl,.btn-grp-del')) return;
    const tog = this.querySelector('.grp-toggle');
    const expanding = tog.textContent === '▶';
    tog.textContent = expanding ? '▼' : '▶';
    let next = this.nextElementSibling;
    while (next && !next.classList.contains('session-hdr')) {
      next.style.display = expanding ? '' : 'none';
      next = next.nextElementSibling;
    }
  });
  return tr;
}

function attachGroupActions(headerTr, key, rows) {
  headerTr.querySelector('.btn-grp-dl').addEventListener('click', e => {
    e.stopPropagation();
    downloadCSV(rows, `esp32_${key.replace(/[^a-z0-9]/gi,'_').toLowerCase()}.csv`);
    showToast('⬇ CSV downloaded');
  });
  headerTr.querySelector('.btn-grp-del').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Delete ${rows.length} readings from:\n"${key}"?\n\nThis cannot be undone.`)) return;
    const ids = rows.map(r => r.id);
    const { error } = await db.from(TABLE).delete().in('id', ids);
    if (error) { showToast('❌ Delete failed'); return; }

    let next = headerTr.nextElementSibling;
    while (next && !next.classList.contains('session-hdr')) {
      const toRm = next; next = next.nextElementSibling; toRm.remove();
    }
    headerTr.remove();

    const totalEl = document.getElementById('totalValue');
    if (totalEl) {
      const cur = parseInt(totalEl.textContent.replace(/,/g,'')) || 0;
      totalEl.textContent = Math.max(0, cur - rows.length).toLocaleString();
    }
    setTimeout(fetchCounts, 1000);
    showToast(`🗑 Deleted ${rows.length} readings`);
  });
}

async function fetchTable() {
  let q = db.from(TABLE).select('*').order('created_at', { ascending:false });
  if (currentFilter === 'session')  q = q.gte('created_at', sessionStart);
  else if (currentFilter > 0)       q = q.limit(currentFilter);
  else                              q = q.limit(2000);

  const { data, error } = await q;
  if (error || !data) return;

  const groups = {}, order = [];
  data.forEach(r => {
    const k = oneHourKey(r.created_at);
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(r);
  });

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

  order.forEach((key, idx) => {
    const rows = groups[key];
    const isLive = idx === 0;
    const hdr = makeGroupHeader(key, rows.length, isLive);
    if (isLive) hdr.classList.add('session-current');
    attachGroupActions(hdr, key, rows);
    tbody.appendChild(hdr);
    rows.forEach(r => tbody.appendChild(makeDataRow(r, isLive)));
  });

  updateStats(data);
  document.getElementById('tableCount').textContent =
    `${data.length} entries · ${order.length} intervals`;
}

function liveAddRow(record) {
  const tbody   = document.getElementById('tableBody');
  const liveHdr = tbody.querySelector('.session-current');
  const newKey  = oneHourKey(record.created_at);

  if (liveHdr && liveHdr.dataset.key === newKey) {
    liveHdr.insertAdjacentElement('afterend', makeDataRow(record, true));
    const cnt = liveHdr.querySelector('.grp-count');
    cnt.textContent = `${parseInt(cnt.textContent) + 1} readings`;
  } else {
    fetchTable();
  }
}

function updateStats(data) {
  if (!data?.length) return;
  const his   = data.map(r => calcHeatIndex(r.temperature, r.humidity));
  const temps = data.map(r => r.temperature);
  document.getElementById('statLogged').textContent = data.length;
  document.getElementById('statMin').textContent    = Math.min(...his).toFixed(1) + '°C';
  document.getElementById('statMax').textContent    = Math.max(...his).toFixed(1) + '°C';
  document.getElementById('statAvg').textContent    = (his.reduce((a,b)=>a+b,0)/his.length).toFixed(1) + '°C';
  document.getElementById('statTemp').textContent   = (temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1) + '°C';
}


// ============================================================
// CSV DOWNLOAD
// ============================================================
function downloadCSV(rows, filename) {
  const header = 'Timestamp,Heat Index (°C),Temperature (°C),Humidity (%),Risk Level';
  const lines  = rows.map(r => {
    const hi   = calcHeatIndex(r.temperature, r.humidity);
    const risk = getRiskFromHI(hi);
    return `${new Date(r.created_at).toLocaleString()},${hi},${r.temperature.toFixed(1)},${r.humidity.toFixed(1)},${risk.label}`;
  });
  const blob = new Blob([[header,...lines].join('\n')], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}


// ============================================================
// EMAIL ALERT
// ============================================================
async function sendEmailAlert(temp, humidity, heatIndex) {
  if (!espConnected) return;
  const now = Date.now();
  if (now - lastAlertSentAt < ALERT_COOLDOWN_MS) return;
  if (temp < ALERT_TEMP_THRESHOLD && heatIndex < ALERT_TEMP_THRESHOLD) return;
  try {
    const res  = await fetch(GAS_ALERT_URL, {
      method:'POST', headers:{ 'Content-Type':'text/plain' },
      body: JSON.stringify({ temperature:temp, humidity, heat_index:heatIndex, source:'Dashboard', location:ALERT_LOCATION }),
    });
    const data = await res.json();
    if (data.status === 'sent') {
      lastAlertSentAt = now;
      showToast(`🚨 Alert email sent! (${temp.toFixed(1)}°C)`);
    } else if (data.status === 'skipped' && data.reason === 'cooldown') {
      lastAlertSentAt = now - ALERT_COOLDOWN_MS + (data.next_in_mins * 60000);
    }
  } catch(err) { console.warn('[Alert]', err.message); }
}


// ============================================================
// REAL-TIME SUBSCRIPTION
// ============================================================
db.channel('esp32-live')
  .on('postgres_changes', { event:'INSERT', schema:'public', table:TABLE }, (payload) => {
    fetchLatest();
    fetchCounts();
    fetchChartData(currentChartRange);
    if (payload.new) liveAddRow(payload.new);
    else fetchTable();
  })
  .subscribe();


// ============================================================
// INITIAL LOAD
// ============================================================
fetchLatest();
fetchCounts();
fetchChartData(currentChartRange);
fetchTable();

setInterval(fetchLatest, 5000);
freshnessTimer = setInterval(updateFreshness, 1000);

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => fetchChartData(currentChartRange), 300);
});


// ============================================================
// TABLE CONTROLS
// ============================================================
const filterBtn  = document.getElementById('filterBtn');
const filterMenu = document.getElementById('filterMenu');
filterBtn.addEventListener('click', e => { e.stopPropagation(); filterMenu.classList.toggle('open'); });
document.addEventListener('click', () => filterMenu.classList.remove('open'));

document.querySelectorAll('.fi').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.fi').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const val = item.dataset.limit;
    currentFilter = val === 'session' ? 'session' : parseInt(val);
    filterBtn.textContent = item.textContent.toUpperCase() + ' ▾';
    filterMenu.classList.remove('open');
    fetchTable();
  });
});

document.getElementById('dlAllBtn').addEventListener('click', async () => {
  const sel = document.getElementById('dlSelect').value;
  let q = db.from(TABLE).select('*').order('created_at', { ascending:false });
  if (sel === 'current')                   q = q.gte('created_at', sessionStart);
  else if (['10','30','60'].includes(sel)) q = q.gte('created_at', new Date(Date.now() - parseInt(sel)*60000).toISOString());
  const { data } = await q;
  if (data) { downloadCSV(data, `esp32_${sel}_records.csv`); showToast(`⬇ ${data.length} records exported`); }
});

document.getElementById('clearLogBtn').addEventListener('click', () => {
  document.getElementById('tableBody').innerHTML =
    '<tr><td colspan="6" class="tbl-empty">Log cleared. New readings will appear automatically.</td></tr>';
  showToast('✕ Log cleared');
});


// ============================================================
// IMPROVEMENT 6: CHART TIME FILTERS
// ============================================================
document.querySelectorAll('.ctf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ctf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentChartRange = parseInt(btn.dataset.range);
    fetchChartData(currentChartRange);
  });
});


// ============================================================
// IMPROVEMENT 4: CONTROL BUTTONS
// ============================================================

// Alarm toggle
const ctrlAlarm = document.getElementById('ctrlAlarm');
if (ctrlAlarm) {
  ctrlAlarm.addEventListener('click', () => {
    alarmEnabled = !alarmEnabled;
    ctrlAlarm.classList.toggle('alarm-active', !alarmEnabled);
    ctrlAlarm.innerHTML = alarmEnabled
      ? '<span class="ctrl-icon">🔔</span><span>Alarm ON</span>'
      : '<span class="ctrl-icon">🔕</span><span>Alarm OFF</span>';
    if (alarmEnabled) bgAudio.play().catch(()=>{});
    else bgAudio.pause();
    showToast(alarmEnabled ? '🔔 Alarm enabled' : '🔕 Alarm disabled');
  });
}

// Quick CSV export
const ctrlDl = document.getElementById('ctrlDl');
if (ctrlDl) {
  ctrlDl.addEventListener('click', async () => {
    const { data } = await db.from(TABLE).select('*').order('created_at', { ascending:false }).limit(100);
    if (data) { downloadCSV(data, 'esp32_latest_100.csv'); showToast('⬇ Last 100 records exported'); }
  });
}

// Reset readings display
const ctrlReset = document.getElementById('ctrlReset');
if (ctrlReset) {
  ctrlReset.addEventListener('click', () => {
    if (!confirm('Clear the display log? (Database records are not deleted)')) return;
    document.getElementById('tableBody').innerHTML =
      '<tr><td colspan="6" class="tbl-empty">Log cleared. New readings will appear automatically.</td></tr>';
    alertHistory = [];
    renderAlertHistory();
    showToast('↺ Display reset');
  });
}

// Threshold setting
const ctrlThreshold = document.getElementById('ctrlThreshold');
const thresholdModal = document.getElementById('thresholdModal');
const thresholdCancel = document.getElementById('thresholdCancel');
const thresholdSave = document.getElementById('thresholdSave');
const thresholdInput = document.getElementById('thresholdInput');

if (ctrlThreshold && thresholdModal) {
  ctrlThreshold.addEventListener('click', () => {
    thresholdInput.value = ALERT_TEMP_THRESHOLD;
    thresholdModal.classList.add('open');
  });
  thresholdCancel.addEventListener('click', () => thresholdModal.classList.remove('open'));
  thresholdSave.addEventListener('click', () => {
    const val = parseFloat(thresholdInput.value);
    if (isNaN(val) || val < 25 || val > 50) { showToast('⚠ Enter a value between 25–50°C'); return; }
    ALERT_TEMP_THRESHOLD = val;
    thresholdModal.classList.remove('open');
    showToast(`✅ Alert threshold set to ${val}°C`);
    // Update display
    const atRow = document.querySelector('.at-row .at-val');
    if (atRow) atRow.textContent = `${val}°C / HI ${val}°C`;
  });
  thresholdModal.addEventListener('click', e => { if (e.target === thresholdModal) thresholdModal.classList.remove('open'); });
}

// Alert history clear
const clearAlertHistory = document.getElementById('clearAlertHistory');
if (clearAlertHistory) {
  clearAlertHistory.addEventListener('click', () => {
    alertHistory = [];
    renderAlertHistory();
    showToast('✕ Alert history cleared');
  });
}


// ============================================================
// SOUND
// ============================================================
let soundEnabled = true;
const bgAudio = new Audio('alert.mp3');
bgAudio.loop = true;

document.addEventListener('click', () => {
  if (soundEnabled) bgAudio.play().catch(() => {});
}, { once:true });

document.getElementById('soundBtn').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  const btn  = document.getElementById('soundBtn');
  const ico  = document.getElementById('soundIcon');
  const pill = document.getElementById('soundPill');

  ico.textContent = soundEnabled ? '🔊' : '🔇';
  if (pill) {
    pill.classList.toggle('sound-on',  soundEnabled);
    pill.classList.toggle('sound-off', !soundEnabled);
    pill.querySelector('.pill-label').textContent = soundEnabled ? 'Sound: ON' : 'Sound: OFF';
  }
  const alarmSoundState = document.getElementById('alarmSoundState');
  if (alarmSoundState) alarmSoundState.textContent = soundEnabled ? 'ON' : 'OFF (muted)';

  if (soundEnabled) { bgAudio.play().catch(()=>{}); showToast('🔊 Sound ON'); }
  else { bgAudio.pause(); showToast('🔇 Sound OFF'); }
});


// ============================================================
// ALERT MUTE
// ============================================================
const alertMuteBtn = document.getElementById('alertMute');
if (alertMuteBtn) {
  alertMuteBtn.addEventListener('click', () => {
    const banner = document.getElementById('alertBanner');
    if (banner) banner.classList.remove('show');
    showToast('⚠ Alert muted for this session');
  });
}


// ============================================================
// TOAST
// ============================================================
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}