import { CATEGORIES, FRAME_SIZES, defaultSettings, resolveParams, renderFrame, mulberry32 } from './degrade.js';
import { TAGS, SKIPPED } from './detectors.js';

const $ = (s) => document.querySelector(s);
let settings = defaultSettings();
const loaded = new Map();      // key -> detector api
const loading = new Map();     // key -> promise
const selected = new Set();
const results = new Map();     // key -> { ms:[], ok:[] }
const idCfg = new Map();       // key -> { mode:'random'|'fixed', value }
const cellEls = new Map();
let running = false, stopFlag = false;

// ------------------------------------------------------------------ UI: tags
const tagList = $('#tagList');
for (const t of TAGS) {
  const chip = document.createElement('label');
  chip.className = 'tag-chip';
  chip.title = t.impl;
  chip.innerHTML = `<input type="checkbox" data-key="${t.key}"><div><b>${t.name}</b><span>${t.family} · ${t.license} · ${t.size}</span><span>${t.impl}</span><span class="state" id="st-${t.key}"></span></div>`;
  tagList.appendChild(chip);
  chip.querySelector('input').addEventListener('change', (e) => toggleTag(t, e.target.checked, chip));
  idCfg.set(t.key, { mode: 'random', value: 0 });
}
const skippedEl = $('#skipped');
for (const [n, why] of SKIPPED) { const li = document.createElement('li'); li.innerHTML = `<b>${n}</b>: ${why}`; skippedEl.appendChild(li); }

async function ensureLoaded(t) {
  if (loaded.has(t.key)) return loaded.get(t.key);
  if (!loading.has(t.key)) {
    loading.set(t.key, (async () => {
      const t0 = performance.now();
      const api = await t.load();
      // warm up once on a clean frame (not timed, not counted)
      const clean = renderFrame(api.generate(0), { frame: { tagPct: 50, bg: 150 } }, 320, 240, 1);
      api.detect(clean.gray, clean.rgba, 320, 240); api.detect(clean.gray, clean.rgba, 320, 240);
      api.loadMs = performance.now() - t0;
      loaded.set(t.key, api);
      return api;
    })());
  }
  return loading.get(t.key);
}

async function toggleTag(t, on, chip) {
  const st = $('#st-' + t.key);
  chip.classList.toggle('on', on);
  if (!on) { selected.delete(t.key); removeCell(t.key); return; }
  selected.add(t.key); addCell(t);
  st.className = 'state'; st.textContent = loaded.has(t.key) ? 'ready' : 'loading…';
  try {
    const api = await ensureLoaded(t);
    st.className = 'state ok'; st.textContent = `ready (loaded in ${api.loadMs.toFixed(0)} ms)`;
    const info = cellEls.get(t.key); if (info) info.idInput.max = api.idCount - 1;
  } catch (e) {
    st.className = 'state err'; st.textContent = 'failed to load: ' + e.message;
    loading.delete(t.key);
  }
}

// ------------------------------------------------------------------ UI: settings
const fs = $('#frameSize');
for (const k of Object.keys(FRAME_SIZES)) fs.add(new Option(k, k, false, k === '640×480'));
function buildSettingsUI() {
  const root = $('#cats'); root.innerHTML = '';
  for (const c of CATEGORIES) {
    const d = document.createElement('details');
    d.dataset.on = settings[c.id].on ? '1' : '0';
    const sum = document.createElement('summary');
    if (c.always) sum.innerHTML = `<span>${c.title}</span>`;
    else sum.innerHTML = `<input type="checkbox" ${settings[c.id].on ? 'checked' : ''}><span>${c.title}</span>`;
    d.appendChild(sum);
    const vars = document.createElement('div'); vars.className = 'vars';
    for (const v of c.vars) {
      const w = document.createElement('div'); w.className = 'var';
      const val = settings[c.id][v.id];
      w.innerHTML = `<label>${v.label}<output>${val}</output></label><input type="range" min="${v.min}" max="${v.max}" step="${v.step}" value="${val}">`;
      const r = w.querySelector('input'), o = w.querySelector('output');
      r.addEventListener('input', () => { settings[c.id][v.id] = parseFloat(r.value); o.textContent = r.value; });
      vars.appendChild(w);
    }
    d.appendChild(vars);
    if (!c.always) {
      const cb = sum.querySelector('input');
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => { settings[c.id].on = cb.checked; d.dataset.on = cb.checked ? '1' : '0'; if (cb.checked) d.open = true; });
    } else d.open = true;
    root.appendChild(d);
  }
}
buildSettingsUI();
$('#resetSettings').onclick = () => { settings = defaultSettings(); buildSettingsUI(); };
$('#reseed').onclick = () => { $('#seed').value = Math.floor(Math.random() * 1e6); };

// ------------------------------------------------------------------ UI: grid
function addCell(t) {
  if (cellEls.has(t.key)) return;
  const el = document.createElement('div'); el.className = 'cell';
  el.innerHTML = `<h3><span>${t.name}</span><em>${t.family}</em></h3>
    <canvas width="320" height="240"></canvas>
    <div class="ms">last <b>–</b> ms · avg <span class="avg">–</span> · median <span class="med">–</span> · min/max <span class="mm">–</span></div>
    <div class="bar"></div><div class="rate"></div>
    <div class="idrow">ID: <select><option value="random">random each tick</option><option value="fixed">fixed</option></select>
    <input type="number" min="0" max="${t.idCount - 1}" value="0" disabled><span>(0–${t.idCount - 1})</span></div>`;
  $('#grid').appendChild(el);
  const sel = el.querySelector('select'), inp = el.querySelector('input');
  sel.onchange = () => { idCfg.get(t.key).mode = sel.value; inp.disabled = sel.value !== 'fixed'; };
  inp.oninput = () => { idCfg.get(t.key).value = Math.max(0, Math.min(t.idCount - 1, parseInt(inp.value || '0', 10))); };
  cellEls.set(t.key, { el, canvas: el.querySelector('canvas'), idInput: inp });
  results.set(t.key, { ms: [], ok: [] });
  renderStats(t.key);
}
function removeCell(key) { const c = cellEls.get(key); if (c) c.el.remove(); cellEls.delete(key); results.delete(key); }

function renderStats(key) {
  const c = cellEls.get(key), r = results.get(key); if (!c || !r) return;
  const el = c.el, n = r.ms.length;
  const sorted = [...r.ms].sort((a, b) => a - b);
  const f = (x) => x.toFixed(x < 10 ? 2 : 1);
  el.querySelector('.ms b').textContent = n ? f(r.ms[n - 1]) : '–';
  el.querySelector('.avg').textContent = n ? f(r.ms.reduce((a, b) => a + b, 0) / n) + ' ms' : '–';
  el.querySelector('.med').textContent = n ? f(sorted[Math.floor(n / 2)]) + ' ms' : '–';
  el.querySelector('.mm').textContent = n ? `${f(sorted[0])} / ${f(sorted[n - 1])} ms` : '–';
  el.querySelector('.bar').textContent = r.ok.map(x => (x ? '🟩' : '🟥')).join('');
  const pass = r.ok.filter(Boolean).length;
  el.querySelector('.rate').textContent = n ? `${pass}/${n} detected (${Math.round(100 * pass / n)}%)` : 'No runs yet';
}

function drawPreview(key, frame, dets, id, ok) {
  const c = cellEls.get(key); if (!c) return;
  const cv = c.canvas; cv.width = frame.W; cv.height = frame.H;
  const ctx = cv.getContext('2d');
  ctx.putImageData(new ImageData(frame.rgba, frame.W, frame.H), 0, 0);
  const quad = (pts, color, dash) => { ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, frame.W / 320); ctx.setLineDash(dash || []); ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke(); };
  quad(frame.truth.corners, 'rgba(0,200,255,.8)', [4, 3]);
  for (const d of dets) quad(d.corners, d.id === id ? '#2ecc71' : '#e74c3c');
}

// ------------------------------------------------------------------ running
const yieldUI = () => new Promise(r => setTimeout(r, 0));
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

async function runOnce(tickIndex, seed, random, order) {
  const [W, H] = FRAME_SIZES[fs.value];
  const P = resolveParams(settings, random, mulberry32(seed));
  for (const key of order) {
    if (stopFlag) return;
    const t = TAGS.find(x => x.key === key), api = loaded.get(key);
    if (!api) continue;
    const cfg = idCfg.get(key);
    const id = cfg.mode === 'fixed' ? Math.min(cfg.value, api.idCount - 1) : Math.floor(mulberry32(seed ^ hash(key))() * api.idCount);
    const tag = api.generate(id);
    const frame = renderFrame(tag, P, W, H, seed);
    await yieldUI();                                   // nothing else running while we time
    const t0 = performance.now();
    let dets = [];
    try { dets = api.detect(frame.gray, frame.rgba, W, H); } catch (e) { console.error(t.name, e); }
    const ms = performance.now() - t0;
    const tol = 0.25 * frame.truth.side;
    const ok = dets.some(d => d.id === id && Math.hypot(d.cx - frame.truth.center[0], d.cy - frame.truth.center[1]) < tol);
    const r = results.get(key); r.ms.push(ms); r.ok.push(ok);
    drawPreview(key, frame, dets, id, ok);
    renderStats(key);
  }
}

async function start(n, random) {
  if (running) return;
  const keys = [...selected].filter(k => loaded.has(k));
  if (!keys.length) { $('#status').textContent = selected.size ? 'Detectors are still loading…' : 'Tick at least one tag first.'; return; }
  running = true; stopFlag = false; setBusy(true);
  const base = parseInt($('#seed').value || '0', 10);
  for (let i = 0; i < n && !stopFlag; i++) {
    $('#status').textContent = n > 1 ? `Tick ${i + 1} / ${n}` : 'Running…';
    const order = keys.map((_, j) => keys[(j + i) % keys.length]);      // rotate start tag each tick
    await runOnce(i, base + i * 7919, random, order);
  }
  $('#status').textContent = stopFlag ? 'Stopped.' : 'Done.';
  running = false; setBusy(false);
}
function setBusy(b) { for (const id of ['runOnce', 'runTicks']) $('#' + id).disabled = b; $('#stop').disabled = !b; }

$('#runOnce').onclick = () => start(1, document.querySelector('input[name=mode]:checked').value === 'random');
$('#runTicks').onclick = () => start(Math.max(1, Math.min(500, parseInt($('#ticks').value || '10', 10))), true);
$('#stop').onclick = () => { stopFlag = true; };
$('#clear').onclick = () => { for (const k of results.keys()) { results.set(k, { ms: [], ok: [] }); renderStats(k); } $('#status').textContent = ''; };

// tiny hook for automated testing
window.__arena = { settings: () => settings, start, results, selected, loaded };
