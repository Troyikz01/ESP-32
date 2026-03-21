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
// ============================================================
function calcHeatIndex(t, h) {
  if (t < 27) return t;
  const hi =
    -8.78469475556 +
     1.61139411   * t +
     2.33854883889 * h +
    -0.14611605   * t * h +
    -0.012308094  * t * t +
    -0.016424828  * h * h +
     0.002211732  * t * t * h +
     0.00072546   * t * h * h +
    -0.000003582  * t * t * h * h;
  return Math.round(hi * 10) / 10;
}
 
// ============================================================
// STATUS HELPERS
// ============================================================
function getTempStatus(t) {
  if (t >= 38) return ['status-hot',  'Danger!'];
  if (t >  35) return ['status-hot',  'Very Hot'];
  if (t >  30) return ['status-warn', 'Warm'];
  if (t >= 20) return ['status-ok',   'Normal'];
  if (t >= 15) return ['status-cold', 'Cool'];
  return              ['status-freezing','Freezing!'];
}
 
function getHumiStatus(h) {
  if (h >  85) return ['status-hot',  'Very Humid'];
  if (h >  70) return ['status-warn', 'Humid'];
  if (h >= 40) return ['status-ok',   'Normal'];
  if (h >= 25) return ['status-warn', 'Dry'];
  return              ['status-cold', 'Very Dry'];
}
 
function getHeatStatus(hi) {
  if (hi >= 38) return ['status-hot',      'Danger Zone'];
  if (hi >= 35) return ['status-hot',      'Very Hot'];
  if (hi >= 32) return ['status-warn',     'Caution'];
  if (hi >= 27) return ['status-ok',       'Comfortable'];
  if (hi >= 20) return ['status-cold',     'Cool'];
  return               ['status-freezing', 'Cold!'];
}
 
const colorMap = {
  'status-ok':       '#22c55e',
  'status-warn':     '#f97316',
  'status-hot':      '#ef4444',
  'status-bad':      '#ef4444',
  'status-cold':     '#38bdf8',
  'status-freezing': '#a78bfa'
};
 
// ============================================================
// TODAY DATE RANGE
// ============================================================
function todayStart() {
  const d = new Date(); d.setHours(0,0,0,0); return d.toISOString();
}
 
// ============================================================
// FETCH LATEST — update cards
// ============================================================
async function fetchLatest() {
  const { data, error } = await db
    .from(TABLE).select('*')
    .order('created_at', { ascending: false })
    .limit(1).single();
 
  if (error) { console.error('fetchLatest:', error.message); checkOffline(); return; }
 
  const t  = data.temperature;
  const h  = data.humidity;
  const hi = calcHeatIndex(t, h);
 
  // Temperature card
  const [tClass, tText] = getTempStatus(t);
  const tEl = document.getElementById('tempValue');
  tEl.innerHTML = `${t.toFixed(1)}<span>°C</span>`;
  tEl.style.color = colorMap[tClass] || '#e8edf5';
  setpill('tempStatus', tClass, tText);
 
  // Humidity card
  const [hClass, hText] = getHumiStatus(h);
  const hEl = document.getElementById('humiValue');
  hEl.innerHTML = `${h.toFixed(1)}<span>%</span>`;
  hEl.style.color = colorMap[hClass] || '#38bdf8';
  setpill('humiStatus', hClass, hText);
 
  // Heat Index card
  const [hiClass, hiText] = getHeatStatus(hi);
  const hiEl = document.getElementById('heatValue');
  hiEl.innerHTML = `${hi}<span>°C</span>`;
  hiEl.style.color = colorMap[hiClass] || '#e11d48';
  setpill('heatStatus', hiClass, hiText);
 
  // Last update
  const lastTime = new Date(data.created_at);
  document.getElementById('lastUpdate').textContent = 'Last: ' + lastTime.toLocaleTimeString();
 
  // Connection status
  const secsAgo = (Date.now() - lastTime.getTime()) / 1000;
  const espStatus = document.getElementById('espStatus');
  const espLabel  = document.getElementById('espLabel');
  if (secsAgo < 8) {
    espStatus.className = 'esp-status connected';
    espLabel.textContent = 'ESP32 CONNECTED';
  } else {
    espStatus.className = 'esp-status disconnected';
    espLabel.textContent = 'ESP32 OFFLINE';
  }
 
  // Thermal theme + gauge
  updateThermalState(t, h, hi);
  updateGauge(hi, t);
 
  // Alert banner
  const banner = document.getElementById('alert-banner');
  if (t > 35 || hi >= 38) banner.classList.add('show');
  else banner.classList.remove('show');
}
 
function checkOffline() {
  const espStatus = document.getElementById('espStatus');
  const espLabel  = document.getElementById('espLabel');
  if (espStatus) { espStatus.className = 'esp-status disconnected'; espLabel.textContent = 'ESP32 OFFLINE'; }
}
 
function setpill(id, cls, text) {
  const el = document.getElementById(id);
  if (el) { el.className = 'status-pill ' + cls; el.textContent = text; }
}
 
// ============================================================
// FETCH COUNTS
// ============================================================
async function fetchCounts() {
  const { count: total } = await db.from(TABLE).select('*', { count:'exact', head:true });
  const { count: today } = await db.from(TABLE).select('*', { count:'exact', head:true }).gte('created_at', todayStart());
  if (total !== null) document.getElementById('totalReadings').textContent = total.toLocaleString();
  if (today !== null) document.getElementById('todayReadings').textContent = today.toLocaleString();
}
 
// ============================================================
// FETCH CHART DATA
// ============================================================
async function fetchChartData() {
  const { data, error } = await db
    .from(TABLE).select('temperature,humidity,created_at')
    .order('created_at', { ascending: false }).limit(20);
 
  if (error || !data || data.length < 2) return;
  const rows = [...data].reverse();
  renderTempChart(rows);
  renderHumiChart(rows);
  renderCombinedChart(rows);
}
 
// ============================================================
// SVG CHART RENDERER
// ============================================================
function makeSVGChart(container, datasets, opts = {}) {
  const W   = container.clientWidth  || 600;
  const H   = container.clientHeight || 200;
  const pad = { top:20, right:20, bottom:28, left:44 };
  const cW  = W - pad.left - pad.right;
  const cH  = H - pad.top  - pad.bottom;
 
  const allVals = datasets.flatMap(d => d.values);
  const rawMin  = Math.min(...allVals);
  const rawMax  = Math.max(...allVals);
  const padding = (rawMax - rawMin) < 2 ? 2 : (rawMax - rawMin) * 0.15;
  const minV = rawMin - padding;
  const maxV = rawMax + padding;
  const range = maxV - minV || 1;
 
  const n = datasets[0].values.length;
  function toX(i) { return pad.left + (i / (n - 1 || 1)) * cW; }
  function toY(v) { return pad.top + cH - ((v - minV) / range) * cH; }
 
  function polyline(values, color) {
    const pts = values.map((v,i) => `${toX(i)},${toY(v)}`).join(' ');
    const fp  = `${toX(0)},${pad.top+cH} ${pts} ${toX(n-1)},${pad.top+cH}`;
    return `<polygon points="${fp}" fill="${color}" fill-opacity="0.1" stroke="none"/>
            <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${values.map((v,i)=>`<circle cx="${toX(i)}" cy="${toY(v)}" r="3" fill="${color}"/>`).join('')}`;
  }
 
  const yLabels = [minV,(minV+maxV)/2,maxV].map(v=>
    `<text x="${pad.left-6}" y="${toY(v)+4}" text-anchor="end" font-size="10" fill="#5a6a82">${v.toFixed(1)}</text>`).join('');
 
  const labels = opts.labels || [];
  const step   = Math.ceil(labels.length / 5);
  const xLabels = labels.filter((_,i) => i % step === 0)
    .map((l,idx) => `<text x="${toX(idx*step)}" y="${H-6}" text-anchor="middle" font-size="9" fill="#5a6a82">${l}</text>`).join('');
 
  const grid = [0.25,0.5,0.75].map(f=>
    `<line x1="${pad.left}" y1="${pad.top+cH*f}" x2="${pad.left+cW}" y2="${pad.top+cH*f}" stroke="#232d3d" stroke-width="1" stroke-dasharray="4,4"/>`).join('');
 
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top+cH}" stroke="#232d3d" stroke-width="1"/>
    <line x1="${pad.left}" y1="${pad.top+cH}" x2="${pad.left+cW}" y2="${pad.top+cH}" stroke="#232d3d" stroke-width="1"/>
    ${grid}${yLabels}
    ${datasets.map(d => polyline(d.values, d.color)).join('')}
    ${xLabels}
  </svg>`;
}
 
function timeLabels(rows) {
  return rows.map(r => new Date(r.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
}
 
function renderTempChart(rows) {
  const c = document.getElementById('tempChart'); if(!c) return;
  makeSVGChart(c, [
    { values: rows.map(r => r.temperature), color: '#f97316' },
    { values: rows.map(r => calcHeatIndex(r.temperature, r.humidity)), color: '#e11d48' }
  ], { labels: timeLabels(rows) });
}
 
function renderHumiChart(rows) {
  const c = document.getElementById('humiChart'); if(!c) return;
  makeSVGChart(c, [
    { values: rows.map(r => r.humidity), color: '#38bdf8' }
  ], { labels: timeLabels(rows) });
}
 
function renderCombinedChart(rows) {
  const container = document.getElementById('combinedChart'); if(!container) return;
  const temps  = rows.map(r => r.temperature);
  const humids = rows.map(r => r.humidity);
  const labels = timeLabels(rows);
 
  const W   = container.clientWidth  || 900;
  const H   = container.clientHeight || 220;
  const pad = { top:20, right:55, bottom:28, left:50 };
  const cW  = W - pad.left - pad.right;
  const cH  = H - pad.top  - pad.bottom;
 
  function scaleAxis(vals) {
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const p  = (mx-mn) < 1 ? 2 : (mx-mn)*0.2;
    return { min:mn-p, max:mx+p };
  }
 
  const tS = scaleAxis(temps);
  const hS = scaleAxis(humids);
 
  function toX(i,len) { return pad.left + (i/(len-1||1))*cW; }
  function toY(v,s)   { return pad.top  + cH - ((v-s.min)/(s.max-s.min))*cH; }
 
  function drawLine(vals, scale, color) {
    const pts = vals.map((v,i) => `${toX(i,vals.length)},${toY(v,scale)}`).join(' ');
    const fp  = `${toX(0,vals.length)},${pad.top+cH} ${pts} ${toX(vals.length-1,vals.length)},${pad.top+cH}`;
    return `<polygon points="${fp}" fill="${color}" fill-opacity="0.08" stroke="none"/>
            <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${vals.map((v,i)=>`<circle cx="${toX(i,vals.length)}" cy="${toY(v,scale)}" r="3" fill="${color}"/>`).join('')}`;
  }
 
  const tLabels = [tS.min,(tS.min+tS.max)/2,tS.max].map(v=>
    `<text x="${pad.left-6}" y="${toY(v,tS)+4}" text-anchor="end" font-size="10" fill="#f97316">${v.toFixed(1)}°</text>`).join('');
  const hLabels = [hS.min,(hS.min+hS.max)/2,hS.max].map(v=>
    `<text x="${W-pad.right+8}" y="${toY(v,hS)+4}" text-anchor="start" font-size="10" fill="#38bdf8">${v.toFixed(0)}%</text>`).join('');
 
  const step    = Math.ceil(labels.length/5);
  const xLabels = labels.filter((_,i)=>i%step===0).map((l,idx)=>
    `<text x="${toX(idx*step,labels.length)}" y="${H-6}" text-anchor="middle" font-size="9" fill="#5a6a82">${l}</text>`).join('');
 
  const grid = [0.25,0.5,0.75].map(f=>
    `<line x1="${pad.left}" y1="${pad.top+cH*f}" x2="${pad.left+cW}" y2="${pad.top+cH*f}" stroke="#232d3d" stroke-width="1" stroke-dasharray="4,4"/>`).join('');
 
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top+cH}" stroke="#232d3d" stroke-width="1"/>
    <line x1="${pad.left}" y1="${pad.top+cH}" x2="${pad.left+cW}" y2="${pad.top+cH}" stroke="#232d3d" stroke-width="1"/>
    <line x1="${pad.left+cW}" y1="${pad.top}" x2="${pad.left+cW}" y2="${pad.top+cH}" stroke="#38bdf8" stroke-width="1" opacity="0.3"/>
    ${grid}${tLabels}${hLabels}
    ${drawLine(temps,tS,'#f97316')}
    ${drawLine(humids,hS,'#38bdf8')}
    ${xLabels}
  </svg>`;
}
 
// ============================================================
// THERMAL STATE
// ============================================================
function updateThermalState(t, h, hi) {
  const b = document.body;
  b.classList.remove('thermal-hot','thermal-warm','thermal-normal','thermal-cold','thermal-freezing');
 
  let cls = 'thermal-normal';
  if      (hi >= 38 || t > 35) cls = 'thermal-hot';
  else if (hi >= 32 || t > 28) cls = 'thermal-warm';
  else if (t < 15)             cls = 'thermal-freezing';
  else if (t < 20)             cls = 'thermal-cold';
 
  b.classList.add(cls);
 
  const labels = {
    'thermal-hot':      '🔴 Hot',
    'thermal-warm':     '🟠 Warm',
    'thermal-normal':   '🟢 Normal',
    'thermal-cold':     '🔵 Cold',
    'thermal-freezing': '🟣 Freezing'
  };
  const lbl = document.getElementById('thermalLabel');
  if (lbl) lbl.textContent = labels[cls] || '🟢 Normal';
}
 
// ============================================================
// HEAT STRESS GAUGE
// ============================================================
const gaugeLevels = [
  { label:'LOW',     color:'#22c55e', pct:0    },
  { label:'NORMAL',  color:'#86efac', pct:0.25 },
  { label:'CAUTION', color:'#facc15', pct:0.5  },
  { label:'HOT',     color:'#f97316', pct:0.75 },
  { label:'DANGER',  color:'#ef4444', pct:1    }
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
  const { label, color, pct } = gaugeLevels[lvl];
 
  ['arc0','arc1','arc2','arc3','arc4'].forEach((id, i) => {
    const el = document.getElementById(id); if (!el) return;
    el.classList.toggle('active', i === lvl);
  });
 
  const needle = document.getElementById('gaugeNeedle');
  if (needle) needle.style.left = `calc(${pct * 100}%)`;
 
  const lbl = document.getElementById('gaugeLabel');
  if (lbl) { lbl.textContent = '● ' + label; lbl.style.color = color; }
 
  const widget = document.getElementById('gaugeWidget');
  if (widget) widget.style.borderColor = color;
 
  if (lvl !== lastGaugeLevel) {
    if (lastGaugeLevel !== -1) {
      if (lvl >= 3) playAlert('danger');
      else          playAlert('normal');
    }
    lastGaugeLevel = lvl;
  }
}
 
// ============================================================
// TABLE — grouped by 10-min intervals
// ============================================================
function tenMinKey(dateStr) {
  const d = new Date(dateStr);
  const m = Math.floor(d.getMinutes() / 10) * 10;
  const dateLabel = d.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'});
  const h12 = d.getHours() % 12 || 12;
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  const mEnd = Math.min(m+9,59).toString().padStart(2,'0');
  return `${dateLabel} — ${h12}:${m.toString().padStart(2,'0')}–${h12}:${mEnd} ${ampm}`;
}
 
function downloadCSV(rows, filename) {
  const header = 'Timestamp,Temperature (°C),Humidity (%),Heat Index (°C),Status';
  const lines  = rows.map(r => {
    const hi = calcHeatIndex(r.temperature, r.humidity);
    const [,tText] = getTempStatus(r.temperature);
    return `${new Date(r.created_at).toLocaleString()},${r.temperature.toFixed(1)},${r.humidity.toFixed(1)},${hi},${tText}`;
  });
  const blob = new Blob([[header,...lines].join('\n')], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename; a.click();
}
 
function makeSessionHeader(key, rows, expanded = false) {
  const tr = document.createElement('tr');
  tr.className = 'session-header';
  tr.dataset.key = key;
  tr.innerHTML = `<td colspan="5">
    <span class="session-toggle">${expanded ? '▼' : '▶'}</span>
    <span class="group-label">${expanded ? '🔴 LIVE — ' : ''}${key}</span>
    <span class="group-count">${rows.length} readings</span>
    <button class="btn-dl-session">⬇ CSV</button>
  </td>`;
 
  tr.addEventListener('click', function(e) {
    if (e.target.classList.contains('btn-dl-session')) return;
    const toggle = this.querySelector('.session-toggle');
    const isExp  = toggle.textContent === '▼';
    toggle.textContent = isExp ? '▶' : '▼';
    let next = this.nextElementSibling;
    while (next && !next.classList.contains('session-header')) {
      next.style.display = isExp ? 'none' : ''; next = next.nextElementSibling;
    }
  });
 
  tr.querySelector('.btn-dl-session').addEventListener('click', e => {
    e.stopPropagation();
    downloadCSV(rows, `esp32_${key.replace(/[^a-z0-9]/gi,'_').toLowerCase()}.csv`);
    showToast('⬇ CSV downloaded');
  });
 
  return tr;
}
 
function makeDataRow(r, visible = true) {
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
 
function updateCurrentHeaderCount() {
  const h = document.querySelector('tr.session-current'); if (!h) return;
  let count = 0, next = h.nextElementSibling;
  while (next && !next.classList.contains('session-header')) { count++; next = next.nextElementSibling; }
  const c = h.querySelector('.group-count'); if (c) c.textContent = `${count} readings`;
}
 
async function fetchTable() {
  let query = db.from(TABLE).select('*').order('created_at', { ascending: false });
  if      (currentFilter === 'session') query = query.gte('created_at', sessionStart);
  else if (currentFilter > 0)           query = query.limit(currentFilter);
  else                                  query = query.limit(2000);
 
  const { data, error } = await query;
  if (error || !data) return;
 
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
 
  const groups = {}, groupOrder = [];
  data.forEach(r => {
    const key = tenMinKey(r.created_at);
    if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
    groups[key].push(r);
  });
 
  groupOrder.forEach((key, idx) => {
    const rows   = groups[key];
    const isFirst = idx === 0;
    const header  = makeSessionHeader(key, rows, isFirst);
    if (isFirst) header.classList.add('session-current');
    tbody.appendChild(header);
    rows.forEach(r => tbody.appendChild(makeDataRow(r, isFirst)));
  });
 
  updateStats(data);
  document.getElementById('tableCount').textContent =
    `Showing ${data.length} entries in ${groupOrder.length} intervals`;
}
 
function liveAddRow(record) {
  const tbody   = document.getElementById('tableBody');
  const current = tbody.querySelector('.session-current');
  if (!current) { fetchTable(); return; }
 
  const key = tenMinKey(record.created_at);
  if (current.dataset.key === key) {
    current.insertAdjacentElement('afterend', makeDataRow(record, true));
    updateCurrentHeaderCount();
  } else {
    fetchTable();
  }
}
 
function updateStats(data) {
  if (!data || !data.length) return;
  const temps = data.map(r => r.temperature);
  const min = Math.min(...temps).toFixed(1);
  const max = Math.max(...temps).toFixed(1);
  const avg = (temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(1);
  document.getElementById('statLogged').textContent = data.length;
  document.getElementById('statMin').textContent = min + '°C';
  document.getElementById('statMax').textContent = max + '°C';
  document.getElementById('statAvg').textContent = avg + '°C';
}
 
// ============================================================
// AUDIO
// ============================================================
let soundEnabled = true;
const bgAudio    = new Audio('alert.mp3');
bgAudio.loop     = true;
 
document.addEventListener('click', () => {
  if (soundEnabled) bgAudio.play().catch(e => console.warn('Audio:', e));
}, { once: true });
 
function playAlert() {
  if (!soundEnabled) return;
  bgAudio.play().catch(e => console.warn('Audio:', e));
}
 
// ============================================================
// SOUND BUTTON
// ============================================================
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
// THEME DROPDOWN — Color Dots
// ============================================================
const themes = ['dark','light','ocean','forest','midnight','sunset','rose','arctic',
                'volcano','galaxy','aurora','neon','copper','cyber','sakura','lava'];
 
function applyTheme(theme) {
  themes.forEach(t => document.body.classList.remove('theme-' + t));
  document.body.classList.add('theme-' + theme);
  document.querySelectorAll('.theme-dot').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
  const activeBtn = document.querySelector(`.theme-dot[data-theme="${theme}"]`);
  const lbl = document.getElementById('themeNameLabel');
  if (lbl && activeBtn) lbl.textContent = activeBtn.title;
  localStorage.setItem('esp32-theme', theme);
}
 
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeMenu      = document.getElementById('themeMenu');
 
if (themeToggleBtn && themeMenu) {
  themeToggleBtn.addEventListener('click', e => {
    e.stopPropagation();
    themeMenu.classList.toggle('open');
  });
  document.addEventListener('click', () => themeMenu.classList.remove('open'));
}
 
document.querySelectorAll('.theme-dot').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    applyTheme(btn.dataset.theme);
    showToast('Theme: ' + btn.title);
  });
  btn.addEventListener('mouseenter', () => {
    const lbl = document.getElementById('themeNameLabel');
    if (lbl) lbl.textContent = btn.title;
  });
  btn.addEventListener('mouseleave', () => {
    const lbl = document.getElementById('themeNameLabel');
    const active = document.querySelector('.theme-dot.active');
    if (lbl && active) lbl.textContent = active.title;
  });
});
 
applyTheme(localStorage.getItem('esp32-theme') || 'dark');
 
// ============================================================
// FILTER DROPDOWN
// ============================================================
const filterBtn  = document.getElementById('filterBtn');
const filterMenu = document.getElementById('filterMenu');
 
filterBtn.addEventListener('click', e => { e.stopPropagation(); filterMenu.classList.toggle('open'); });
document.addEventListener('click', () => filterMenu.classList.remove('open'));
 
document.querySelectorAll('.filter-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.filter-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    currentFilter = item.dataset.limit === 'session' ? 'session' : parseInt(item.dataset.limit);
    filterBtn.textContent = item.textContent.toUpperCase() + ' ▾';
    filterMenu.classList.remove('open');
    fetchTable();
  });
});
 
// ============================================================
// EXPORT CSV
// ============================================================
document.getElementById('exportTableBtn').addEventListener('click', async () => {
  let query = db.from(TABLE).select('*').order('created_at', { ascending: false });
  if      (currentFilter === 'session') query = query.gte('created_at', sessionStart);
  else if (currentFilter > 0)           query = query.limit(currentFilter);
  const { data } = await query;
  if (data) { downloadCSV(data, 'esp32_readings.csv'); showToast('⬇ CSV exported'); }
});
 
// Download nav
document.getElementById('dlAllBtn').addEventListener('click', async () => {
  const val = document.getElementById('dlSelect').value;
  let query  = db.from(TABLE).select('*').order('created_at', { ascending: false });
  if      (val === 'current') query = query.gte('created_at', sessionStart);
  else if (val === '10')      query = query.gte('created_at', new Date(Date.now()-10*60*1000).toISOString());
  else if (val === '30')      query = query.gte('created_at', new Date(Date.now()-30*60*1000).toISOString());
  else if (val === '60')      query = query.gte('created_at', new Date(Date.now()-60*60*1000).toISOString());
  const { data } = await query;
  if (data) { downloadCSV(data, `esp32_${val}.csv`); showToast(`⬇ ${data.length} records exported`); }
});
 
// Clear log
document.getElementById('clearLogBtn').addEventListener('click', () => {
  document.getElementById('tableBody').innerHTML =
    '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem;">Log cleared. New readings will appear automatically.</td></tr>';
  document.getElementById('statLogged').textContent = '0';
  document.getElementById('statMin').textContent = '—';
  document.getElementById('statMax').textContent = '—';
  document.getElementById('statAvg').textContent = '—';
  showToast('✕ Log cleared');
});
 
// ============================================================
// REALTIME SUBSCRIPTION
// ============================================================
db.channel('esp32-live')
  .on('postgres_changes', { event:'INSERT', schema:'public', table:TABLE }, payload => {
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
 
// Poll every 5s for connection status
setInterval(fetchLatest, 5000);
 
// ============================================================
// TOAST
// ============================================================
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}