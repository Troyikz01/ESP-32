// ============================================================
// SUPABASE CONFIG — replace with your project credentials
// ============================================================
const SUPABASE_URL  = 'https://wjkvrwwpzngwfrxhcrlt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indqa3Zyd3dwem5nd2ZyeGhjcmx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MDczNzIsImV4cCI6MjA4OTQ4MzM3Mn0.R-DlrG4gnyYS3hZr7_a_XlFzZg0hl64fsMaFG-QVZOU';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

const TABLE = 'sensor_readings';
let currentFilter = 0;
let sessionStart  = new Date().toISOString();

// ============================================================
// EMAIL ALERT ADDITIONS — paste into your script.js
// Place right after your SUPABASE CONFIG block at the top
// ============================================================

// ---- Paste your deployed GAS Web App URL here ----
const GAS_ALERT_URL = 'https://script.google.com/macros/s/AKfycbxgL0bvvPSjgPcENRxmB0_8m_9Awg2UzkCKOYuGGqz-SXSg76U-mssV9S976ZFx0aIr_w/exec';

// Alert settings
const ALERT_TEMP_THRESHOLD  = 38;     // °C
const ALERT_COOLDOWN_MS     = 10 * 60 * 1000;  // 10 minutes in ms
const ALERT_LOCATION        = 'Room 1';         // shown in the email subject

let lastAlertSentAt = 0;   // tracks cooldown in this browser session


// ============================================================
// SEND ALERT — called automatically from fetchLatest()
// ============================================================
async function sendEmailAlert(temp, humidity, heatIndex) {
  const now = Date.now();

  // Respect cooldown
  if (now - lastAlertSentAt < ALERT_COOLDOWN_MS) {
    const remaining = Math.ceil((ALERT_COOLDOWN_MS - (now - lastAlertSentAt)) / 60000);
    console.log(`[Alert] Cooldown active — ${remaining} min remaining`);
    return;
  }

  // Below threshold
  if (temp < ALERT_TEMP_THRESHOLD && heatIndex < ALERT_TEMP_THRESHOLD) return;

  try {
    const res = await fetch(GAS_ALERT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },  // GAS needs text/plain for simple POST
      body: JSON.stringify({
        temperature: temp,
        humidity:    humidity,
        heat_index:  heatIndex,
        source:      'Dashboard',
        location:    ALERT_LOCATION,
      }),
    });

    const data = await res.json();

    if (data.status === 'sent') {
      lastAlertSentAt = now;
      showToast(`🚨 Heat alert email sent! (${temp.toFixed(1)}°C)`);
      console.log('[Alert] Email sent →', data);
    } else if (data.status === 'skipped' && data.reason === 'cooldown') {
      lastAlertSentAt = now - ALERT_COOLDOWN_MS + (data.next_in_mins * 60000);
      console.log('[Alert] GAS cooldown active:', data.next_in_mins, 'min remaining');
    } else {
      console.log('[Alert] GAS response:', data);
    }
  } catch (err) {
    console.warn('[Alert] Could not reach GAS endpoint:', err.message);
  }
}


// ============================================================
// UPDATE fetchLatest() — add ONE line to the existing function
//
// Find this block in your existing fetchLatest():
//
//   updateThermalState(t, h);
//   updateGauge(hi, t);
//
// Add the call RIGHT AFTER those two lines:
//
//   sendEmailAlert(t, h, hi);          // <-- add this line
//
// ============================================================


// ============================================================
// ALERT STATUS INDICATOR — optional UI widget in the nav
// Add this HTML inside <div class="nav-right"> in index.html:
//
//  <div id="alertStatus" class="alert-status-widget" title="Email alert status">
//    <span id="alertDot" class="alert-status-dot"></span>
//    <span id="alertText">Alerts ON</span>
//  </div>
//
// ============================================================

// Updates the small nav indicator
function updateAlertIndicator(temp, heatIndex) {
  const dot  = document.getElementById('alertDot');
  const text = document.getElementById('alertText');
  if (!dot || !text) return;

  const now       = Date.now();
  const inCooldown = (now - lastAlertSentAt) < ALERT_COOLDOWN_MS;
  const hot        = temp >= ALERT_TEMP_THRESHOLD || heatIndex >= ALERT_TEMP_THRESHOLD;

  if (hot && !inCooldown) {
    dot.style.background  = '#ef4444';
    dot.style.boxShadow   = '0 0 8px #ef4444';
    dot.style.animation   = 'blink 0.8s ease-in-out infinite';
    text.textContent       = `🚨 Alerting`;
    text.style.color       = '#fca5a5';
  } else if (inCooldown) {
    const remaining = Math.ceil((ALERT_COOLDOWN_MS - (now - lastAlertSentAt)) / 60000);
    dot.style.background  = '#f97316';
    dot.style.boxShadow   = '0 0 8px #f97316';
    dot.style.animation   = '';
    text.textContent       = `⏱ ${remaining}m cooldown`;
    text.style.color       = '#fdba74';
  } else {
    dot.style.background  = '#22c55e';
    dot.style.boxShadow   = '0 0 8px #22c55e';
    dot.style.animation   = '';
    text.textContent       = `✓ Alert ready`;
    text.style.color       = '#4ade80';
  }
}


// ============================================================
// ALERT WIDGET CSS — add to your style.css
// ============================================================
/*
.alert-status-widget {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--surface2);
  border: 1px solid var(--border);
  padding: 5px 12px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-family: 'Space Mono', monospace;
  cursor: default;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.alert-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 8px #22c55e;
  flex-shrink: 0;
  transition: all 0.3s ease;
}
*/


// ============================================================
// HEAT INDEX CALCULATOR (Steadman formula)
// ============================================================
function calcHeatIndex(t, h) {
  if (t < 27) return t;
  const hi =
    -8.78469475556 +
    1.61139411 * t +
    2.33854883889 * h +
    -0.14611605 * t * h +
    -0.012308094 * t * t +
    -0.016424828 * h * h +
    0.002211732 * t * t * h +
    0.00072546 * t * h * h +
    -0.000003582 * t * t * h * h;
  return Math.round(hi * 10) / 10;
}

// ============================================================
// STATUS HELPERS
// ============================================================
function getTempStatus(t) {
  if (t >= 38) return ['status-hot', 'Danger!'];
  if (t > 35)  return ['status-hot', 'Very Hot'];
  if (t > 30)  return ['status-warn', 'Warm'];
  if (t >= 20) return ['status-ok', 'Normal'];
  if (t >= 15) return ['status-cold', 'Cool'];
  return              ['status-freezing', 'Freezing!'];
}

function getHumiStatus(h) {
  if (h > 85)  return ['status-hot', 'Very Humid'];
  if (h > 70)  return ['status-warn', 'Humid'];
  if (h >= 40) return ['status-ok', 'Normal'];
  if (h >= 25) return ['status-warn', 'Dry'];
  return              ['status-cold', 'Very Dry'];
}

function getHeatStatus(hi) {
  if (hi >= 38) return ['status-hot', 'Danger Zone'];
  if (hi >= 35) return ['status-hot', 'Very Hot'];
  if (hi >= 32) return ['status-warn', 'Caution'];
  if (hi >= 27) return ['status-ok', 'Comfortable'];
  if (hi >= 20) return ['status-cold', 'Cool'];
  return               ['status-freezing', 'Cold!'];
}

// ============================================================
// GET TODAY'S DATE RANGE (midnight to now)
// ============================================================
function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

// ============================================================
// FETCH & UPDATE ALL CARDS
// ============================================================
async function fetchLatest() {
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) { console.error('Supabase fetchLatest:', error.message); return; }

  const t  = data.temperature;
  const h  = data.humidity;
  const hi = calcHeatIndex(t, h);

  const colorMap = {
    'status-ok':       '#22c55e',
    'status-warn':     '#f97316',
    'status-hot':      '#ef4444',
    'status-cold':     '#38bdf8',
    'status-freezing': '#a78bfa',
    'status-bad':      '#ef4444'
  };

  // Temperature card
  const [tClass, tText] = getTempStatus(t);
  const tEl = document.getElementById('tempValue');
  tEl.innerHTML = `${t.toFixed(1)}<span>°C</span>`;
  tEl.style.color = colorMap[tClass] || '#e8edf5';
  const tPill = document.getElementById('tempStatus');
  tPill.textContent = tText;
  tPill.className = 'status-pill ' + tClass;

  // Humidity card
  const [hClass, hText] = getHumiStatus(h);
  const hEl = document.getElementById('humiValue');
  hEl.innerHTML = `${h.toFixed(1)}<span>%</span>`;
  hEl.style.color = colorMap[hClass] || '#38bdf8';
  const hPill = document.getElementById('humiStatus');
  if (hPill) { hPill.textContent = hText; hPill.className = 'status-pill ' + hClass; }

  // Heat index card
  const [hiClass, hiText] = getHeatStatus(hi);
  const hiEl = document.getElementById('heatValue');
  hiEl.innerHTML = `${hi}<span>°C</span>`;
  hiEl.style.color = colorMap[hiClass] || '#e11d48';
  const hiPill = document.getElementById('heatStatus');
  hiPill.textContent = hiText;
  hiPill.className = 'status-pill ' + hiClass;

  // Last update timestamp
  const lastTime = new Date(data.created_at);
  document.querySelector('.last-update').textContent = 'Last: ' + lastTime.toLocaleTimeString();

  // ESP32 connection status
  const secondsAgo = (Date.now() - lastTime.getTime()) / 1000;
  const espStatus = document.getElementById('espStatus');
  const espLabel  = document.getElementById('espLabel');
  if (espStatus && espLabel) {
    if (secondsAgo < 8) {
      espStatus.className = 'esp-status connected';
      espLabel.textContent = 'ESP32 CONNECTED';
    } else {
      espStatus.className = 'esp-status disconnected';
      espLabel.textContent = 'ESP32 OFFLINE';
    }
  }

  updateThermalState(t, h);
  updateGauge(hi, t);
  sendEmailAlert(t, h, hi);

  // Alert banner
  const banner = document.getElementById('alert-banner');
  if (t > 35 || hi >= 38) {
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
}

// ============================================================
// FETCH TOTAL & TODAY COUNTS
// ============================================================
async function fetchCounts() {
  const { count: total } = await db
    .from(TABLE)
    .select('*', { count: 'exact', head: true });

  const { count: today } = await db
    .from(TABLE)
    .select('*', { count: 'exact', head: true })
    .gte('created_at', todayRange());

  if (total !== null) {
    document.querySelector('.total-card .card-value').textContent =
      total.toLocaleString();
  }
  if (today !== null) {
    document.querySelector('.today-card .card-value').textContent =
      today.toLocaleString();
  }
}

// ============================================================
// FETCH CHART DATA (last 20 readings)
// ============================================================
async function fetchChartData() {
  const { data, error } = await db
    .from(TABLE)
    .select('temperature, humidity, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data) return;

  const rows = [...data].reverse();
  renderTempChart(rows);
  renderHumiChart(rows);
  renderCombinedChart(rows);
}

// ============================================================
// SVG CHART RENDERER
// ============================================================
function makeSVGChart(container, datasets, opts = {}) {
  const W = container.clientWidth  || 600;
  const H = container.clientHeight || 200;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top  - pad.bottom;

  const allVals = datasets.flatMap(d => d.values);
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const padding = (rawMax - rawMin) < 2 ? 2 : (rawMax - rawMin) * 0.15;
  const minV = rawMin - padding;
  const maxV = rawMax + padding;
  const range = maxV - minV || 1;

  const xStep = cW / (datasets[0].values.length - 1 || 1);

  function toX(i) { return pad.left + i * xStep; }
  function toY(v) { return pad.top + cH - ((v - minV) / range) * cH; }

  function polyline(values, color, fill) {
    const pts = values.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
    const fillPath = fill
      ? `<polygon points="${toX(0)},${pad.top + cH} ${pts} ${toX(values.length - 1)},${pad.top + cH}"
           fill="${color}" fill-opacity="0.12" stroke="none"/>`
      : '';
    return `${fillPath}<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${values.map((v, i) => `<circle cx="${toX(i)}" cy="${toY(v)}" r="3" fill="${color}"/>`).join('')}`;
  }

  const yLabels = [minV, (minV + maxV) / 2, maxV].map(v =>
    `<text x="${pad.left - 6}" y="${toY(v) + 4}" text-anchor="end" font-size="10" fill="#5a6a82">${v.toFixed(1)}</text>`
  ).join('');

  const labels = opts.labels || [];
  const xLabels = labels
    .filter((_, i) => i % Math.ceil(labels.length / 5) === 0)
    .map((l, idx) => {
      const realIdx = idx * Math.ceil(labels.length / 5);
      return `<text x="${toX(realIdx)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#5a6a82">${l}</text>`;
    }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + cH}" stroke="#232d3d" stroke-width="1"/>
      <line x1="${pad.left}" y1="${pad.top + cH}" x2="${pad.left + cW}" y2="${pad.top + cH}" stroke="#232d3d" stroke-width="1"/>
      ${yLabels}
      ${datasets.map(d => polyline(d.values, d.color, true)).join('')}
      ${xLabels}
    </svg>`;
}

function renderTempChart(rows) {
  const container = document.getElementById('tempChart');
  if (!container) return;
  const labels = rows.map(r => new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  makeSVGChart(container, [
    { values: rows.map(r => r.temperature), color: '#f97316' },
    { values: rows.map(r => calcHeatIndex(r.temperature, r.humidity)), color: '#e11d48' }
  ], { labels });
}

function renderHumiChart(rows) {
  const container = document.getElementById('humiChart');
  if (!container) return;
  const labels = rows.map(r => new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  makeSVGChart(container, [
    { values: rows.map(r => r.humidity), color: '#38bdf8' }
  ], { labels });
}

function renderCombinedChart(rows) {
  const container = document.getElementById('combinedChart');
  if (!container) return;
  const labels = rows.map(r => new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  const temps  = rows.map(r => r.temperature);
  const humids = rows.map(r => r.humidity);

  const W = container.clientWidth || 900;
  const H = container.clientHeight || 220;
  const pad = { top: 20, right: 55, bottom: 28, left: 50 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top  - pad.bottom;

  function scaleAxis(values) {
    const mn = Math.min(...values);
    const mx = Math.max(...values);
    const p  = (mx - mn) < 1 ? 2 : (mx - mn) * 0.2;
    return { min: mn - p, max: mx + p };
  }

  const tScale = scaleAxis(temps);
  const hScale = scaleAxis(humids);

  function toX(i, len) { return pad.left + (i / (len - 1 || 1)) * cW; }
  function toY(v, scale) { return pad.top + cH - ((v - scale.min) / (scale.max - scale.min)) * cH; }

  function drawLine(values, scale, color) {
    const pts = values.map((v, i) => `${toX(i, values.length)},${toY(v, scale)}`).join(' ');
    const fp  = `${toX(0, values.length)},${pad.top+cH} ${pts} ${toX(values.length-1, values.length)},${pad.top+cH}`;
    return `<polygon points="${fp}" fill="${color}" fill-opacity="0.08" stroke="none"/>
            <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${values.map((v,i) => `<circle cx="${toX(i,values.length)}" cy="${toY(v,scale)}" r="3" fill="${color}"/>`).join('')}`;
  }

  const tLabels = [tScale.min, (tScale.min+tScale.max)/2, tScale.max].map(v =>
    `<text x="${pad.left-6}" y="${toY(v,tScale)+4}" text-anchor="end" font-size="10" fill="#f97316">${v.toFixed(1)}°</text>`).join('');

  const hLabels = [hScale.min, (hScale.min+hScale.max)/2, hScale.max].map(v =>
    `<text x="${W-pad.right+8}" y="${toY(v,hScale)+4}" text-anchor="start" font-size="10" fill="#38bdf8">${v.toFixed(0)}%</text>`).join('');

  const xLabels = labels
    .filter((_,i) => i % Math.ceil(labels.length/5) === 0)
    .map((l,idx) => {
      const ri = idx * Math.ceil(labels.length/5);
      return `<text x="${toX(ri,labels.length)}" y="${H-6}" text-anchor="middle" font-size="9" fill="#5a6a82">${l}</text>`;
    }).join('');

  const gridLines = [0.25, 0.5, 0.75].map(f =>
    `<line x1="${pad.left}" y1="${pad.top + cH*f}" x2="${pad.left+cW}" y2="${pad.top + cH*f}" stroke="#232d3d" stroke-width="1" stroke-dasharray="4,4"/>`
  ).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top+cH}" stroke="#232d3d" stroke-width="1"/>
      <line x1="${pad.left}" y1="${pad.top+cH}" x2="${pad.left+cW}" y2="${pad.top+cH}" stroke="#232d3d" stroke-width="1"/>
      <line x1="${pad.left+cW}" y1="${pad.top}" x2="${pad.left+cW}" y2="${pad.top+cH}" stroke="#38bdf8" stroke-width="1" opacity="0.3"/>
      ${gridLines}
      ${tLabels}${hLabels}
      ${drawLine(temps,  tScale, '#f97316')}
      ${drawLine(humids, hScale, '#38bdf8')}
      ${xLabels}
    </svg>`;
}

// ============================================================
// 1-HOUR KEY
// Groups readings into 1-hour buckets e.g. "Sunday, Mar 29 — 7:00–8:00 AM"
// ============================================================
function oneHourKey(dateStr) {
  const d = new Date(dateStr);
  const dateLabel = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const h = d.getHours();
  const hEnd = (h + 1) % 24;
  const ampmEnd = hEnd >= 12 ? 'PM' : 'AM';
  const h12    = h    % 12 || 12;
  const h12End = hEnd % 12 || 12;
  return `${dateLabel} — ${h12}:00–${h12End}:00 ${ampmEnd}`;
}

function downloadCSV(rows, filename) {
  const header = 'Timestamp,Temperature (°C),Humidity (%),Heat Index (°C),Status';
  const lines = rows.map(r => {
    const hi = calcHeatIndex(r.temperature, r.humidity);
    const [, tText] = getTempStatus(r.temperature);
    return `${new Date(r.created_at).toLocaleString()},${r.temperature.toFixed(1)},${r.humidity.toFixed(1)},${hi},${tText}`;
  });
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// Build one data row element
function makeDataRow(r, visible) {
  const hi = calcHeatIndex(r.temperature, r.humidity);
  const [tClass, tText] = getTempStatus(r.temperature);
  const tr = document.createElement('tr');
  tr.dataset.id = r.id;
  tr.style.display = visible ? '' : 'none';
  tr.innerHTML = `
    <td>${new Date(r.created_at).toLocaleTimeString()}</td>
    <td class="td-temp">${r.temperature.toFixed(1)}°C</td>
    <td class="td-humi">${r.humidity.toFixed(1)}%</td>
    <td class="td-heat">${hi}°C</td>
    <td><span class="status-pill ${tClass}">${tText}</span></td>`;
  return tr;
}

// Build one session header element
function makeHeaderRow(key, count, expanded) {
  const tr = document.createElement('tr');
  tr.className = 'session-header';
  tr.dataset.key = key;
  tr.innerHTML = `<td colspan="5">
    <span class="session-toggle">${expanded ? '▼' : '▶'}</span>
    <span class="group-label">${key}</span>
    <span class="group-count">${count} readings</span>
    <button class="btn-dl-session">⬇ CSV</button>
    <button class="btn-del-session">🗑 Delete</button>
  </td>`;
  tr.addEventListener('click', function(e) {
    if (e.target.classList.contains('btn-dl-session')) return;
    if (e.target.classList.contains('btn-del-session')) return;
    const toggle = this.querySelector('.session-toggle');
    const expanding = toggle.textContent === '▶';
    toggle.textContent = expanding ? '▼' : '▶';
    let next = this.nextElementSibling;
    while (next && !next.classList.contains('session-header')) {
      next.style.display = expanding ? '' : 'none';
      next = next.nextElementSibling;
    }
  });
  return tr;
}

// Attach CSV download + delete listeners
function attachCSV(headerTr, key, rows) {
  // CSV download
  headerTr.querySelector('.btn-dl-session').addEventListener('click', (e) => {
    e.stopPropagation();
    downloadCSV(rows, `esp32_${key.replace(/[^a-z0-9]/gi,'_').toLowerCase()}.csv`);
    showToast('⬇ CSV downloaded');
  });

  // Delete group — removes from Supabase, updates counts instantly
  headerTr.querySelector('.btn-del-session').addEventListener('click', async (e) => {
    e.stopPropagation();
    const count = rows.length;
    const confirmed = confirm(
      `Delete ${count} reading${count !== 1 ? 's' : ''} from:\n"${key}"?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;

    const ids = rows.map(r => r.id);
    const { error } = await db.from(TABLE).delete().in('id', ids);
    if (error) {
      showToast('❌ Delete failed');
      console.error('Delete error:', error.message);
      return;
    }

    // Remove all data rows belonging to this group from DOM
    let next = headerTr.nextElementSibling;
    while (next && !next.classList.contains('session-header')) {
      const toRemove = next;
      next = next.nextElementSibling;
      toRemove.remove();
    }
    headerTr.remove();

    // ── Optimistic UI update ──
    // Instantly subtract deleted count from Total Readings card
    const totalEl = document.querySelector('.total-card .card-value');
    if (totalEl) {
      const current = parseInt(totalEl.textContent.replace(/,/g, '')) || 0;
      totalEl.textContent = Math.max(0, current - count).toLocaleString();
    }

    // Also subtract from Today's Readings if the deleted group was from today
    const todayEl = document.querySelector('.today-card .card-value');
    if (todayEl) {
      const rowDate   = new Date(rows[0].created_at).toDateString();
      const todayDate = new Date().toDateString();
      if (rowDate === todayDate) {
        const currentToday = parseInt(todayEl.textContent.replace(/,/g, '')) || 0;
        todayEl.textContent = Math.max(0, currentToday - count).toLocaleString();
      }
    }

    // Confirm with real DB count after 1 second to ensure accuracy
    setTimeout(fetchCounts, 1000);

    showToast(`🗑 Deleted ${count} reading${count !== 1 ? 's' : ''}`);
  });
}

async function fetchTable() {
  let query = db.from(TABLE).select('*').order('created_at', { ascending: false });
  if (currentFilter === 'session')  query = query.gte('created_at', sessionStart);
  else if (currentFilter > 0)       query = query.limit(currentFilter);
  else                              query = query.limit(2000);

  const { data, error } = await query;
  if (error || !data) return;

  // Group by 1-hour key
  const groups = {};
  const groupOrder = [];
  data.forEach(r => {
    const key = oneHourKey(r.created_at);
    if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
    groups[key].push(r);
  });

  const tbody = document.querySelector('table tbody');
  tbody.innerHTML = '';

  groupOrder.forEach((key, idx) => {
    const rows = groups[key];
    const isLive = idx === 0;
    const headerTr = makeHeaderRow(key, rows.length, isLive);
    if (isLive) headerTr.classList.add('session-current');
    attachCSV(headerTr, key, rows);
    tbody.appendChild(headerTr);
    rows.forEach(r => tbody.appendChild(makeDataRow(r, isLive)));
  });

  updateStats(data);
  document.querySelector('.table-count').textContent =
    `Showing ${data.length} entries in ${groupOrder.length} intervals`;
}

// Called on each new realtime INSERT
function liveAddRow(record) {
  const tbody = document.querySelector('table tbody');
  const liveHeader = tbody.querySelector('.session-current');
  const newKey = oneHourKey(record.created_at);

  if (liveHeader && liveHeader.dataset.key === newKey) {
    const newRow = makeDataRow(record, true);
    liveHeader.insertAdjacentElement('afterend', newRow);
    const countEl = liveHeader.querySelector('.group-count');
    countEl.textContent = `${parseInt(countEl.textContent) + 1} readings`;
  } else {
    fetchTable();
  }
}

// ============================================================
// THERMAL STATE
// ============================================================
function updateThermalState(temperature, humidity) {
  const b = document.body;
  b.classList.remove('thermal-hot', 'thermal-warm', 'thermal-normal', 'thermal-cold', 'thermal-freezing');

  const hi = calcHeatIndex(temperature, humidity);

  let cls = 'thermal-normal';
  if      (hi >= 38 || temperature > 35) cls = 'thermal-hot';
  else if (hi >= 32 || temperature > 28) cls = 'thermal-warm';
  else if (temperature < 15)             cls = 'thermal-freezing';
  else if (temperature < 20)             cls = 'thermal-cold';

  b.classList.add(cls);

  const thermalLabels = {
    'thermal-hot':      '🔴 Hot',
    'thermal-warm':     '🟠 Warm',
    'thermal-normal':   '🟢 Normal',
    'thermal-cold':     '🔵 Cold',
    'thermal-freezing': '🟣 Freezing'
  };
  const lbl = document.getElementById('thermalLabel');
  if (lbl) lbl.textContent = thermalLabels[cls] || '🟢 Normal';
}

// ============================================================
// REAL-TIME SUBSCRIPTION
// ============================================================
db.channel('esp32-live')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE }, (payload) => {
    fetchLatest();
    fetchCounts();
    fetchChartData();
    if (payload.new) liveAddRow(payload.new);
    else fetchTable();
  })
  .subscribe();

// ============================================================
// INITIAL LOAD
// ============================================================
fetchLatest();
fetchCounts();
fetchChartData();
fetchTable();

// Poll connection status every 5s
setInterval(fetchLatest, 5000);

// ============================================================
// DOWNLOAD NAV
// ============================================================
document.getElementById('dlAllBtn').addEventListener('click', async () => {
  const select = document.getElementById('dlSelect').value;
  let query = db.from(TABLE).select('*').order('created_at', { ascending: false });

  if (select === 'current') {
    query = query.gte('created_at', sessionStart);
  } else if (select === '10') {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    query = query.gte('created_at', since);
  } else if (select === '30') {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    query = query.gte('created_at', since);
  } else if (select === '60') {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    query = query.gte('created_at', since);
  }

  const { data, error } = await query;
  if (error) { showToast('❌ Export failed'); return; }
  const label = document.getElementById('dlSelect').options[document.getElementById('dlSelect').selectedIndex].text;
  downloadCSV(data, `esp32_${label.replace(/\s+/g,'_').toLowerCase()}.csv`);
  showToast(`⬇ ${data.length} records exported`);
});


// ============================================================
// TABLE FILTER, EXPORT, CLEAR LOG, STATS
// ============================================================

// Filter dropdown toggle
const filterBtn  = document.getElementById('filterBtn');
const filterMenu = document.getElementById('filterMenu');
filterBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  filterMenu.classList.toggle('open');
});
document.addEventListener('click', () => filterMenu.classList.remove('open'));

document.querySelectorAll('.filter-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.filter-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const val = item.dataset.limit;
    currentFilter = val === 'session' ? 'session' : parseInt(val);
    filterBtn.textContent = item.textContent.toUpperCase() + ' ▾';
    filterMenu.classList.remove('open');
    fetchTable();
  });
});

// Export table CSV
document.getElementById('exportTableBtn').addEventListener('click', async () => {
  let query = db.from(TABLE).select('*').order('created_at', { ascending: false });
  if (currentFilter === 'session') query = query.gte('created_at', sessionStart);
  else if (currentFilter > 0) query = query.limit(currentFilter);
  const { data } = await query;
  if (data) { downloadCSV(data, 'esp32_readings.csv'); showToast('⬇ CSV exported'); }
});

// Clear log (clears table display only, not Supabase data)
document.getElementById('clearLogBtn').addEventListener('click', () => {
  document.querySelector('table tbody').innerHTML =
    '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem;">Log cleared. New readings will appear automatically.</td></tr>';
  document.getElementById('statLogged').textContent = '0';
  document.getElementById('statMin').textContent = '—';
  document.getElementById('statMax').textContent = '—';
  document.getElementById('statAvg').textContent = '—';
  showToast('✕ Log cleared');
});

// Update stats bar
function updateStats(data) {
  if (!data || !data.length) return;
  const temps = data.map(r => r.temperature);
  const min = Math.min(...temps).toFixed(1);
  const max = Math.max(...temps).toFixed(1);
  const avg = (temps.reduce((a,b) => a+b, 0) / temps.length).toFixed(1);
  document.getElementById('statLogged').textContent = data.length;
  document.getElementById('statMin').textContent  = min + '°C';
  document.getElementById('statMax').textContent  = max + '°C';
  document.getElementById('statAvg').textContent  = avg + '°C';
}

// ============================================================
// HEAT STRESS GAUGE
// ============================================================
const gaugeLevels = [
  { label: 'LOW',     color: '#22c55e', angle: -90 },
  { label: 'NORMAL',  color: '#86efac', angle: -45 },
  { label: 'CAUTION', color: '#facc15', angle:   0 },
  { label: 'HOT',     color: '#f97316', angle:  45 },
  { label: 'DANGER',  color: '#ef4444', angle:  90 }
];

let lastGaugeLevel = -1;

function getGaugeLevel(hi, t) {
  if (hi >= 38 || t > 35) return 4;
  if (hi >= 32 || t > 30) return 3;
  if (hi >= 28 || t > 28) return 2;
  if (t  >= 20)            return 1;
  return 0;
}

function updateGauge(hi, t) {
  const lvl = getGaugeLevel(hi, t);
  const { label, color } = gaugeLevels[lvl];

  ['arc0','arc1','arc2','arc3','arc4'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (i === lvl) {
      el.classList.add('active');
      el.style.boxShadow = `0 0 10px ${color}`;
    } else {
      el.classList.remove('active');
      el.style.boxShadow = '';
    }
  });

  const needle = document.getElementById('gaugeNeedle');
  if (needle) {
    const pct = (lvl / 4) * 100;
    needle.style.left = `calc(${pct}% - ${pct === 0 ? 0 : pct === 100 ? 3 : 0}px)`;
  }

  const lbl = document.getElementById('gaugeLabel');
  if (lbl) { lbl.textContent = '● ' + label; lbl.style.color = color; }

  const widget = document.getElementById('gaugeWidget');
  if (widget) widget.style.borderColor = color;

  if (lvl !== lastGaugeLevel) { lastGaugeLevel = lvl; }
}

// ============================================================
// SOUND TOGGLE + AUDIO ALERT
// ============================================================
let soundEnabled = true;

const bgAudio = new Audio('alert.mp3');
bgAudio.loop = true;

document.addEventListener('click', () => {
  if (soundEnabled) bgAudio.play().catch(e => console.warn('Audio:', e));
}, { once: true });

function stopAudio() {
  bgAudio.pause();
  bgAudio.currentTime = 0;
}

function playAlert() {
  if (!soundEnabled) return;
  bgAudio.play().catch(e => console.warn('Audio:', e));
}

const soundBtn = document.getElementById('soundBtn');
soundBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundBtn.classList.toggle('sound-on',  soundEnabled);
  soundBtn.classList.toggle('sound-off', !soundEnabled);
  soundBtn.querySelector('span').textContent = soundEnabled ? '🔊' : '🔇';

  if (soundEnabled) {
    bgAudio.play().catch(e => console.warn('Audio:', e));
    showToast('🔊 Sound ON');
  } else {
    bgAudio.pause();
    showToast('🔇 Sound OFF');
  }
});

// ============================================================
// TOAST
// ============================================================
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}
