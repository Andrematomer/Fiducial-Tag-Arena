import { CATEGORIES, defaultSettings, resolveParams, renderFrame, mulberry32 } from './degrade.js';
import { TAGS, SKIPPED, DESKTOP_ONLY } from './detectors.js';

const $ = (s) => document.querySelector(s);
const HISTORY = 128;                       // slices kept in the rolling strip
const DEFAULT_ENABLED = new Set(['apriltag36h11', 'aruco5']);

let settings = defaultSettings();
let tick = 0;                              // global tick counter (Run once = 1 tick)
let running = false, stopFlag = false;

// ------------------------------------------------------------------ entries
const entries = [
  ...TAGS.map(t => ({ ...t, web: true, enabled: false, api: null, loadingP: null, id: { mode: 'random', value: 0 }, res: { ms: [], ok: [] }, lastId: null })),
  ...DESKTOP_ONLY.map(t => ({ ...t, key: 'desktop-' + t.name, web: false, enabled: false, res: { ms: [], ok: [] } })),
];
const grid = $('#grid');

const scriptsReady = {};
async function ensureLoaded(e) {
  if (e.api) return e.api;
  if (!e.loadingP) {
    e.loadingP = (async () => {
      const t0 = performance.now();
      const api = await e.load();
      const clean = renderFrame(api.generate(0), { frame: { tagPct: 50, bg: 150 } }, 128, 128, 1);   // warm-up, never counted
      api.detect(clean.gray, clean.rgba, 128, 128); api.detect(clean.gray, clean.rgba, 128, 128);
      api.loadMs = performance.now() - t0;
      e.api = api;
      return api;
    })();
  }
  return e.loadingP;
}

function buildCell(e) {
  const el = document.createElement('div');
  el.className = 'cell off' + (e.web ? '' : ' locked');
  el.innerHTML = `
    <div class="chead"><label><input type="checkbox" ${e.web ? '' : 'disabled'}><span>${e.name}</span></label><em>${e.family}<br>${e.license}</em></div>
    <div class="view"><canvas width="128" height="128"></canvas><div class="msg">${e.web ? 'Disabled to save performance.<br>Tick the box to enable (downloads the detector).' : 'Not available in the browser version due to browser limitations. Planned for the desktop app.'}</div></div>
    <div class="ms"><b>–</b> ms · avg <span class="avg">–</span> · med <span class="med">–</span></div>
    <canvas class="strip" height="16"></canvas>
    <div class="rate"><span class="rt">${e.web ? 'No runs yet' : e.note}</span><span class="lid"></span></div>
    <div class="state"></div>
    ${e.web ? `<div class="idrow">ID <select><option value="random">random each tick</option><option value="fixed">fixed</option></select><input type="number" min="0" max="${e.idCount - 1}" value="0" disabled><span>(0–${e.idCount - 1})</span></div>` : ''}`;
  grid.appendChild(el);
  e.el = el; e.view = el.querySelector('.view canvas'); e.strip = el.querySelector('.strip');
  if (!e.web) return;
  const cb = el.querySelector('input[type=checkbox]');
  cb.addEventListener('change', () => setEnabled(e, cb.checked));
  const sel = el.querySelector('.idrow select'), inp = el.querySelector('.idrow input');
  sel.onchange = () => { e.id.mode = sel.value; inp.disabled = sel.value !== 'fixed'; };
  inp.oninput = () => { e.id.value = Math.max(0, Math.min(e.idCount - 1, parseInt(inp.value || '0', 10))); };
  e.cb = cb; e.idInput = inp;
}
entries.forEach(buildCell);

async function setEnabled(e, on) {
  e.enabled = on;
  if (e.cb) e.cb.checked = on;
  e.el.classList.toggle('off', !on);
  const st = e.el.querySelector('.state');
  if (!on) { st.textContent = ''; return; }
  st.className = 'state'; st.textContent = e.api ? 'ready' : 'loading…';
  try {
    const api = await ensureLoaded(e);
    st.className = 'state ok'; st.textContent = `ready (loaded in ${api.loadMs.toFixed(0)} ms)`;
    e.idInput.max = api.idCount - 1;
  } catch (err) {
    st.className = 'state err'; st.textContent = 'failed to load: ' + err.message;
    e.loadingP = null;
  }
}

// ------------------------------------------------------------------ rolling strip + stats
function drawStrip(e) {
  const cv = e.strip, dpr = window.devicePixelRatio || 1;
  const cw = cv.clientWidth; if (!cw) return;
  const W = Math.round(cw * dpr), H = Math.round(16 * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const data = e.res.ok.slice(-HISTORY), n = data.length;
  if (!n) return;
  const sw = W / n, gap = sw / dpr >= 5 ? Math.max(1, Math.round(dpr)) : 0;   // thin gaps only while slices are wide
  for (let i = 0; i < n; i++) {
    const x0 = Math.round(i * sw), x1 = Math.round((i + 1) * sw);
    ctx.fillStyle = data[i] ? '#2ecc71' : '#e5484d';
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0 - gap), H);
  }
}
const fmt = (x) => x.toFixed(x < 10 ? 2 : 1);
function renderStats(e) {
  const r = e.res, n = r.ms.length, el = e.el;
  el.querySelector('.ms b').textContent = n ? fmt(r.ms[n - 1]) : '–';
  if (n) {
    const sorted = [...r.ms].sort((a, b) => a - b);
    el.querySelector('.avg').textContent = fmt(r.ms.reduce((a, b) => a + b, 0) / n);
    el.querySelector('.med').textContent = fmt(sorted[Math.floor(n / 2)]);
    const pass = r.ok.filter(Boolean).length;
    el.querySelector('.rt').textContent = `${pass}/${n} detected (${Math.round(100 * pass / n)}%)`;
  } else {
    el.querySelector('.avg').textContent = el.querySelector('.med').textContent = '–';
    el.querySelector('.rt').textContent = 'No runs yet';
  }
  el.querySelector('.lid').textContent = e.lastId == null ? '' : 'ID ' + e.lastId;
  drawStrip(e);
}
window.addEventListener('resize', () => entries.forEach(e => e.web && drawStrip(e)));

// ------------------------------------------------------------------ settings UI
const sliders = new Map();                 // "cat.var" -> {input, output, v}
const fmtVal = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(3)));
function setVar(cat, id, value, fromUI) {
  const c = CATEGORIES.find(x => x.id === cat), v = c.vars.find(x => x.id === id);
  if (typeof value === 'number' && v.min !== undefined) value = Math.min(v.max, Math.max(v.min, value));
  settings[cat][id] = value;
  const s = sliders.get(cat + '.' + id);
  if (s && !fromUI) { s.input.value = value; if (s.output) s.output.textContent = fmtVal(value); }
  if (id === 'size' || id === 'seed') { /* frame-level change */ }
  schedulePreview();
}
function buildSettingsUI() {
  const root = $('#cats'); root.innerHTML = ''; sliders.clear();
  for (const c of CATEGORIES) {
    const d = document.createElement('details');
    d.dataset.on = settings[c.id].on ? '1' : '0';
    d.open = !!c.open;
    const sum = document.createElement('summary');
    sum.innerHTML = c.always ? `<span>${c.title}</span>` : `<input type="checkbox" ${settings[c.id].on ? 'checked' : ''}><span>${c.title}</span>`;
    d.appendChild(sum);
    const vars = document.createElement('div'); vars.className = 'vars';
    for (const v of c.vars) {
      const w = document.createElement('div'); w.className = 'var';
      const val = settings[c.id][v.id];
      if (v.type === 'select') {
        w.innerHTML = `<label>${v.label}</label><select>${v.opts.map(([ov, ol]) => `<option ${ov === val ? 'selected' : ''}>${ol}</option>`).join('')}</select>`;
        const sel = w.querySelector('select');
        sel.addEventListener('change', () => setVar(c.id, v.id, v.opts[sel.selectedIndex][0], true));
        sliders.set(c.id + '.' + v.id, { input: sel });
      } else if (v.type === 'number') {
        w.innerHTML = `<label>${v.label}</label><input type="number" min="${v.min}" max="${v.max}" step="${v.step}" value="${val}">`;
        const inp = w.querySelector('input');
        inp.addEventListener('input', () => setVar(c.id, v.id, Math.max(v.min, Math.min(v.max, parseInt(inp.value || '0', 10))), true));
        $('#cats');                        // (no-op, keeps structure uniform)
        sliders.set(c.id + '.' + v.id, { input: inp });
        const rr = document.createElement('button'); rr.textContent = '🎲 New seed'; rr.style.marginTop = '4px';
        rr.onclick = () => { const s = Math.floor(Math.random() * 1e6); inp.value = s; setVar(c.id, v.id, s, true); };
        w.appendChild(rr);
      } else {
        w.innerHTML = `<label>${v.label}<output>${fmtVal(val)}</output></label><input type="range" min="${v.min}" max="${v.max}" step="${v.step}" value="${val}">`;
        const r = w.querySelector('input'), o = w.querySelector('output');
        r.addEventListener('input', () => { o.textContent = fmtVal(parseFloat(r.value)); setVar(c.id, v.id, parseFloat(r.value), true); });
        sliders.set(c.id + '.' + v.id, { input: r, output: o });
      }
      vars.appendChild(w);
    }
    d.appendChild(vars);
    if (!c.always) {
      const cb = sum.querySelector('input');
      cb.addEventListener('click', (ev) => ev.stopPropagation());
      cb.addEventListener('change', () => { settings[c.id].on = cb.checked; d.dataset.on = cb.checked ? '1' : '0'; if (cb.checked) d.open = true; schedulePreview(); });
    }
    root.appendChild(d);
  }
  const reset = document.createElement('button'); reset.textContent = 'Reset all settings'; reset.style.marginTop = '6px';
  reset.onclick = () => { settings = defaultSettings(); buildSettingsUI(); schedulePreview(); };
  root.appendChild(reset);
}

// ------------------------------------------------------------------ preview window
const pvCanvas = $('#pv');
const previewTag = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#d4d4d4'; x.lineWidth = 2; x.strokeRect(25.6, 25.6, 204.8, 204.8);   // marks the "tag" area (outerFrac 0.8)
  x.fillStyle = '#000'; x.font = 'bold 34px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('PREVIEW', 128, 128);
  return { canvas: c, outerFrac: 0.8 };
})();
let pvQueued = false;
function schedulePreview() {
  if (pvQueued) return; pvQueued = true;
  requestAnimationFrame(() => { pvQueued = false; renderPreview(); });
}
function renderPreview() {
  const S = settings.frame.size;
  const P = resolveParams(settings, false, mulberry32(1));            // exact slider values
  const t0 = performance.now();
  const frame = renderFrame(previewTag, P, S, S, settings.frame.seed + tick * 7919);
  const ms = performance.now() - t0;
  if (pvCanvas.width !== S) { pvCanvas.width = S; pvCanvas.height = S; }
  pvCanvas.getContext('2d').putImageData(new ImageData(frame.rgba, S, S), 0, 0);
  $('#pvInfo').textContent = `${S}×${S} · render ${ms.toFixed(0)} ms (not timed in results)`;
}

// Blender-touch style navigation: three buttons, drag on a button to act.
function gizmo(btn, fn) {
  btn.addEventListener('pointerdown', (ev) => {
    btn.setPointerCapture(ev.pointerId);
    let lx = ev.clientX, ly = ev.clientY;
    const move = (m) => { fn(m.clientX - lx, m.clientY - ly); lx = m.clientX; ly = m.clientY; };
    const up = () => { btn.removeEventListener('pointermove', move); btn.removeEventListener('pointerup', up); btn.removeEventListener('pointercancel', up); };
    btn.addEventListener('pointermove', move); btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up);
  });
}
const turnOn = (cat) => { if (!settings[cat].on) { settings[cat].on = true; buildSettingsUI(); } };
gizmo($('#gRot'), (dx, dy) => {
  turnOn('persp');
  setVar('persp', 'yaw', settings.persp.yaw + dx * 0.6);
  setVar('persp', 'pitch', settings.persp.pitch + dy * 0.6);
});
gizmo($('#gZoom'), (dx, dy) => setVar('frame', 'tagPct', settings.frame.tagPct * Math.exp(-dy * 0.012)));
gizmo($('#gPan'), (dx, dy) => {
  setVar('frame', 'shiftX', settings.frame.shiftX + dx * 0.25);
  setVar('frame', 'shiftY', settings.frame.shiftY + dy * 0.25);
});
pvCanvas.addEventListener('wheel', (ev) => { ev.preventDefault(); setVar('frame', 'tagPct', settings.frame.tagPct * Math.exp(-ev.deltaY * 0.001)); }, { passive: false });

// ------------------------------------------------------------------ running
const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

async function runTick(order, seed) {
  const S = settings.frame.size;
  const P = resolveParams(settings, settings.frame.mode === 'random', mulberry32(seed));
  for (const e of order) {
    if (stopFlag) return;
    const id = e.id.mode === 'fixed' ? Math.min(e.id.value, e.api.idCount - 1) : Math.floor(mulberry32(seed ^ hash(e.key))() * e.api.idCount);
    const frame = renderFrame(e.api.generate(id), P, S, S, seed);       // rendering: NOT timed
    e.view.width = S; e.view.height = S;
    e.el.classList.add('running');
    await paint();                                                       // let the highlight show, nothing else running
    const t0 = performance.now();
    let dets = [];
    try { dets = e.api.detect(frame.gray, frame.rgba, S, S); } catch (err) { console.error(e.name, err); }
    const ms = performance.now() - t0;                                   // only the detector call
    const tol = 0.25 * frame.truth.side, T = frame.truth;
    const ok = dets.some(d => d.id === id && Math.min(Math.hypot(d.cx - T.center[0], d.cy - T.center[1]), Math.hypot(d.cx - T.centroid[0], d.cy - T.centroid[1])) < tol);
    e.res.ms.push(ms); e.res.ok.push(ok); e.lastId = id;
    const ctx = e.view.getContext('2d');
    ctx.putImageData(new ImageData(frame.rgba, S, S), 0, 0);
    const quad = (pts, color, dash) => { ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, S / 128); ctx.setLineDash(dash); ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke(); };
    quad(T.corners, 'rgba(0,200,255,.8)', [3, 3]);
    for (const d of dets) quad(d.corners, d.id === id ? '#2ecc71' : '#e5484d', []);
    renderStats(e);
    e.el.classList.remove('running');
  }
}

async function start(n) {
  if (running) return;
  const active = entries.filter(e => e.web && e.enabled && e.api);
  if (!active.length) { $('#status').textContent = entries.some(e => e.enabled) ? 'Detectors are still loading…' : 'Enable at least one tag in the grid first.'; return; }
  running = true; stopFlag = false; setBusy(true);
  for (let i = 0; i < n && !stopFlag; i++) {
    const t = tick++;                                                    // every run, even "Run once", is a new tick
    $('#status').textContent = n > 1 ? `Tick ${i + 1} / ${n}` : `Tick ${t + 1}`;
    const order = active.map((_, j) => active[(j + t) % active.length]);
    await runTick(order, settings.frame.seed + t * 7919);
  }
  entries.forEach(e => e.el.classList.remove('running'));
  $('#status').textContent = (stopFlag ? 'Stopped' : 'Done') + ` · ${tick} tick${tick === 1 ? '' : 's'} total`;
  running = false; setBusy(false); schedulePreview();
}
function setBusy(b) { $('#runOnce').disabled = $('#runTicks').disabled = b; $('#stop').disabled = !b; }
$('#runOnce').onclick = () => start(1);
$('#runTicks').onclick = () => start(Math.max(1, Math.min(500, parseInt($('#ticks').value || '32', 10))));
$('#stop').onclick = () => { stopFlag = true; };
$('#clear').onclick = () => {
  tick = 0;
  for (const e of entries) { if (!e.web) continue; e.res = { ms: [], ok: [] }; e.lastId = null; renderStats(e); }
  $('#status').textContent = ''; schedulePreview();
};

// ------------------------------------------------------------------ boot
const skippedEl = $('#skipped');
for (const [n, why] of SKIPPED) { const li = document.createElement('li'); li.innerHTML = `<b>${n}</b>: ${why}`; skippedEl.appendChild(li); }
buildSettingsUI();
renderPreview();
entries.forEach(e => e.web && drawStrip(e));
for (const e of entries) if (e.web && DEFAULT_ENABLED.has(e.key)) setEnabled(e, true);

window.__arena = { settings: () => settings, entries, start, setVar, tick: () => tick };
