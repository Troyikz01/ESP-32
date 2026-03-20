// ============================================================
// SUPABASE CONFIG — replace with your project credentials
// ============================================================
const SUPABASE_URL  = 'https://wjkvrwwpzngwfrxhcrlt.supabase.co'; // e.g. https://abcdefgh.supabase.co
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indqa3Zyd3dwem5nd2ZyeGhjcmx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MDczNzIsImV4cCI6MjA4OTQ4MzM3Mn0.R-DlrG4gnyYS3hZr7_a_XlFzZg0hl64fsMaFG-QVZOU';                  // Settings > API > anon/public key

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

const TABLE = 'sensor_readings';

let currentFilter = 0;
let sessionStart  = new Date().toISOString();

// ============================================================
// HEAT INDEX CALCULATOR (Steadman formula)
// Since there's no heat_index column, we compute it from temp + humidity
// ============================================================
function calcHeatIndex(t, h) {
  if (t < 27) return t; // formula only valid above 27°C
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

  // Status color map
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

  // ESP32 connection status — connected if last reading < 15 seconds ago
  const secondsAgo = (Date.now() - lastTime.getTime()) / 1000;
  const espStatus = document.getElementById('espStatus');
  const espLabel  = document.getElementById('espLabel');
  if (espStatus && espLabel) {
    if (secondsAgo < 5) {
      espStatus.className = 'esp-status connected';
      espLabel.textContent = 'ESP32 CONNECTED';
    } else {
      espStatus.className = 'esp-status disconnected';
      espLabel.textContent = 'ESP32 OFFLINE';
    }
  }

  // Thermal theme
  updateThermalState(t, h);

  // Alert banner
  const banner = document.getElementById('alert-banner');
  const wasDanger = banner.classList.contains('show');
  if (t > 35 || hi >= 38) {
    banner.classList.add('show');
    if (!wasDanger) playAlert('danger'); // only beep on state change
  } else if (t > 28 || hi >= 32) {
    banner.classList.remove('show');
    if (wasDanger) playAlert('warn');
  } else {
    banner.classList.remove('show');
  }
}

// ============================================================
// FETCH TOTAL & TODAY COUNTS
// ============================================================
async function fetchCounts() {
  // Total all-time count
  const { count: total } = await db
    .from(TABLE)
    .select('*', { count: 'exact', head: true });

  // Today's count
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

  const rows = [...data].reverse(); // oldest → newest for chart
  renderTempChart(rows);
  renderHumiChart(rows);
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

  // Flatten all values to get global min/max
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

  // Y axis labels
  const yLabels = [minV, (minV + maxV) / 2, maxV].map(v =>
    `<text x="${pad.left - 6}" y="${toY(v) + 4}" text-anchor="end" font-size="10" fill="#5a6a82">${v.toFixed(1)}</text>`
  ).join('');

  // X axis labels (timestamps)
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

// ============================================================
// FETCH RECENT READINGS FOR TABLE — grouped by 10-min intervals
// ============================================================
function tenMinKey(dateStr) {
  const d = new Date(dateStr);
  const m = Math.floor(d.getMinutes() / 10) * 10;
  const dateLabel = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const mStr = m.toString().padStart(2, '0');
  const mEnd = Math.min(m + 9, 59).toString().padStart(2, '0');
  return `${dateLabel} — ${h12}:${mStr}–${h12}:${mEnd} ${ampm}`;
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
  </td>`;
  tr.addEventListener('click', function(e) {
    if (e.target.classList.contains('btn-dl-session')) return;
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

// Attach CSV button listener (needs rows data)
function attachCSV(headerTr, key, rows) {
  headerTr.querySelector('.btn-dl-session').addEventListener('click', (e) => {
    e.stopPropagation();
    downloadCSV(rows, `esp32_${key.replace(/[^a-z0-9]/gi,'_').toLowerCase()}.csv`);
    showToast('⬇ CSV downloaded');
  });
}

async function fetchTable() {
  let query = db.from(TABLE).select('*').order('created_at', { ascending: false });
  if (currentFilter === 'session')  query = query.gte('created_at', sessionStart);
  else if (currentFilter > 0)       query = query.limit(currentFilter);
  else                              query = query.limit(2000);

  const { data, error } = await query;
  if (error || !data) return;

  // Group by 10-min key
  const groups = {};
  const groupOrder = [];
  data.forEach(r => {
    const key = tenMinKey(r.created_at);
    if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
    groups[key].push(r);
  });

  const tbody = document.querySelector('table tbody');
  tbody.innerHTML = '';

  groupOrder.forEach((key, idx) => {
    const rows = groups[key];
    const isLive = idx === 0; // most recent = live block
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

// Called on each new realtime INSERT — no full re-render needed
function liveAddRow(record) {
  const tbody = document.querySelector('table tbody');
  const liveHeader = tbody.querySelector('.session-current');
  const newKey = tenMinKey(record.created_at);

  if (liveHeader && liveHeader.dataset.key === newKey) {
    // Same block — prepend row right after header
    const newRow = makeDataRow(record, true);
    liveHeader.insertAdjacentElement('afterend', newRow);
    // Bump count
    const countEl = liveHeader.querySelector('.group-count');
    countEl.textContent = `${parseInt(countEl.textContent) + 1} readings`;
  } else {
    // New 10-min block — re-render so new live block appears on top
    fetchTable();
  }
}

// ============================================================
// THERMAL STATE (from scrip-adon.js logic, inlined)
// ============================================================
function updateThermalState(temperature, humidity) {
  const b = document.body;
  b.classList.remove('thermal-hot', 'thermal-warm', 'thermal-normal', 'thermal-cold', 'thermal-freezing');

  // Use heat index as the single source of truth for theme
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

// Poll connection status every 10s in case no new readings come in
setInterval(fetchLatest, 10000);

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
  // 'all' = no limit

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
// SOUND TOGGLE + AUDIO ALERT
// ============================================================
let soundEnabled = true;

// --- Synthesized beep using Web Audio API (no audio file needed) ---
function playAlert(type = 'warn') {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'danger') {
      // Two urgent beeps for danger/hot
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } else {
      // Single soft beep for warn
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch(e) { console.warn('Audio not available:', e); }
}

// To use a custom audio file instead, replace playAlert() calls with:
// const alertSound = new Audio('your-alert.mp3');
// alertSound.play();

const soundBtn = document.getElementById('soundBtn');
soundBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundBtn.classList.toggle('sound-on', soundEnabled);
  soundBtn.classList.toggle('sound-off', !soundEnabled);
  showToast(soundEnabled ? '🔊 Sound enabled' : '🔇 Sound disabled');
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