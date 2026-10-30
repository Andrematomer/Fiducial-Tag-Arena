// Runtime scene synthesis + camera degradation pipeline.
// Everything is generated procedurally; no photos. All tags receive the exact same
// parameters AND the same random streams (shapes, noise, shadows) so the comparison is fair.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randn(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// ---------------------------------------------------------------------------
// Setting definitions. These drive both the UI and the random sampling.
// kind (random mode): 'amp' U(0,v) · 'sym' U(-|v|,|v|) · 'angle' U(0,360) · 'fixed' v
// type: 'range' (default) · 'select' (opts [[value,label]]) · 'number'
// ---------------------------------------------------------------------------
const SIZES = [16, 32, 64, 128, 256, 512, 1024].map(s => [s, `${s} × ${s}`]);

export const CATEGORIES = [
  { id: 'frame', title: 'Test setup & camera', on: true, always: true, open: true, vars: [
    { id: 'size', type: 'select', label: 'Frame size (square)', opts: SIZES, def: 128 },
    { id: 'mode', type: 'select', label: 'Parameter mode', opts: [['random', 'Random each tick (sliders = maximum)'], ['exact', 'Exact (sliders as set)']], def: 'random' },
    { id: 'seed', type: 'number', label: 'Base seed', min: 0, max: 999999, step: 1, def: 1 },
    { id: 'tagPct', label: 'Tag size / zoom (% of frame)', min: 3, max: 95, step: 1, def: 50, kind: 'fixed' },
    { id: 'shiftX', label: 'Lens shift X (% of frame)', min: -50, max: 50, step: 1, def: 15, kind: 'sym' },
    { id: 'shiftY', label: 'Lens shift Y (% of frame)', min: -50, max: 50, step: 1, def: 10, kind: 'sym' },
    { id: 'bg', label: 'Background brightness', min: 0, max: 255, step: 1, def: 150, kind: 'fixed' },
    { id: 'bgTex', label: 'Background clutter', min: 0, max: 100, step: 1, def: 30, kind: 'amp' },
  ]},
  { id: 'persp', title: '3D rotation (perspective)', on: true, open: true, vars: [
    { id: 'yaw', label: 'Yaw (°)', min: -88, max: 88, step: 1, def: 45, kind: 'sym' },
    { id: 'pitch', label: 'Pitch (°)', min: -88, max: 88, step: 1, def: 35, kind: 'sym' },
    { id: 'roll', label: 'Roll (°)', min: -180, max: 180, step: 1, def: 30, kind: 'sym' },
    { id: 'fov', label: 'Field of view (°, wide = stronger perspective)', min: 20, max: 140, step: 1, def: 70, kind: 'fixed' },
  ]},
  { id: 'lens', title: 'Lens distortion', on: true, vars: [
    { id: 'bulge', label: 'Bulge k1 (+ barrel / − pincushion)', min: -1.5, max: 1.5, step: 0.01, def: 0.4, kind: 'sym' },
    { id: 'ca', label: 'Chromatic aberration (R/B radial split)', min: 0, max: 0.2, step: 0.002, def: 0.04, kind: 'amp' },
  ]},
  { id: 'occ', title: 'Occlusion', on: true, vars: [
    { id: 'cover', label: 'Coverage (% of tag area)', min: 0, max: 80, step: 1, def: 15, kind: 'amp' },
    { id: 'count', label: 'Number of occluders', min: 1, max: 12, step: 1, def: 3, kind: 'fixed' },
    { id: 'shape', type: 'select', label: 'Shape', opts: [[0, 'Rectangle'], [1, 'Ellipse'], [2, 'Scratch line'], [3, 'Mixed']], def: 3 },
    { id: 'tone', type: 'select', label: 'Colour', opts: [[0, 'Black'], [1, 'White'], [2, 'Gray'], [3, 'Random']], def: 3 },
  ]},
  { id: 'light', title: 'Uneven lighting', on: true, vars: [
    { id: 'grad', label: 'Gradient strength (across the tag)', min: 0, max: 1, step: 0.01, def: 0.35, kind: 'amp' },
    { id: 'gradAng', label: 'Gradient direction (°)', min: 0, max: 360, step: 1, def: 30, kind: 'angle' },
    { id: 'shadow', label: 'Hard cast shadow', min: 0, max: 1, step: 0.01, def: 0.3, kind: 'amp' },
    { id: 'glare', label: 'Glare hotspot', min: 0, max: 1, step: 0.01, def: 0.25, kind: 'amp' },
    { id: 'vig', label: 'Vignette (around the lens axis)', min: 0, max: 1, step: 0.01, def: 0.3, kind: 'amp' },
  ]},
  { id: 'blur', title: 'Motion blur', on: true, vars: [
    { id: 'blurLen', label: 'Intensity (length px)', min: 0, max: 80, step: 1, def: 4, kind: 'amp' },
    { id: 'blurAng', label: 'Direction (°)', min: 0, max: 180, step: 1, def: 0, kind: 'angle' },
    { id: 'defocus', label: 'Defocus blur radius (px)', min: 0, max: 20, step: 0.5, def: 0.5, kind: 'amp' },
  ]},
  { id: 'expo', title: 'Exposure (extreme bright / dark)', on: true, vars: [
    { id: 'ev', label: 'Exposure (EV stops, + bright / − dark)', min: -5, max: 5, step: 0.1, def: 0.7, kind: 'sym' },
    { id: 'contrast', label: 'Contrast ×', min: 0.1, max: 2, step: 0.05, def: 1, kind: 'fixed' },
    { id: 'gamma', label: 'Gamma', min: 0.3, max: 3, step: 0.05, def: 1, kind: 'fixed' },
  ]},
  { id: 'noise', title: 'Sensor noise', on: true, vars: [
    { id: 'luma', label: 'Luminance noise σ', min: 0, max: 100, step: 1, def: 12, kind: 'amp' },
    { id: 'chroma', label: 'Colour noise σ', min: 0, max: 100, step: 1, def: 10, kind: 'amp' },
    { id: 'sp', label: 'Salt & pepper (% of pixels)', min: 0, max: 20, step: 0.1, def: 0.3, kind: 'amp' },
  ]},
];

export function defaultSettings() {
  const s = {};
  for (const c of CATEGORIES) {
    s[c.id] = { on: c.on };
    for (const v of c.vars) s[c.id][v.id] = v.def;
  }
  return s;
}

// Resolve settings to concrete parameters. random=true: sliders are maxima.
// The RNG is consumed in a fixed order so every tag in a tick gets identical values.
export function resolveParams(settings, random, rng) {
  const P = {};
  for (const c of CATEGORIES) {
    const sc = settings[c.id];
    if (!sc.on) continue;
    P[c.id] = {};
    for (const v of c.vars) {
      let x = sc[v.id];
      if (random && typeof x === 'number' && v.type !== 'select' && v.type !== 'number') {
        const r = rng();
        if (v.kind === 'amp') x = r * x;
        else if (v.kind === 'sym') x = (r * 2 - 1) * Math.abs(x);
        else if (v.kind === 'angle') x = r * 360;
      }
      P[c.id][v.id] = x;
    }
  }
  if (!P.frame) P.frame = {};
  return P;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const k = 1 / (a * A + b * B + c * C);
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
          B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
          C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

function toGrayTexture(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = d[i * 4];
  return { g, w, h };
}

const NEAR = 0.15;   // nearest allowed point of the tag plane, in tag-side units

// tag: { canvas, outerFrac } ; outerFrac = black outer square side / whole canvas side.
// Frames are square (W === H). Only the detector call is ever timed, never this function.
export function renderFrame(tag, P, W, H, seed) {
  const rngBg = mulberry32(seed ^ 0x1234), rngOcc = mulberry32(seed ^ 0x5678),
        rngNoise = mulberry32(seed ^ 0x9abc), rngLight = mulberry32(seed ^ 0x2468);
  const F = new Float32Array(W * H * 3);

  // ---- background ------------------------------------------------------
  const fr = P.frame;
  const bg = fr.bg ?? 150;
  const clutter = (fr.bgTex ?? 0) / 100;
  const waves = [];
  for (let k = 0; k < 6; k++) waves.push([rngBg() * 0.06 + 0.01, rngBg() * 0.06 + 0.01, rngBg() * 6.28, rngBg() * 6.28, rngBg()]);
  const wscale = 128 / Math.max(16, W);          // clutter looks the same at every frame size
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let t = 0;
    if (clutter > 0) for (const w of waves) t += w[4] * Math.sin(x * w[0] * wscale + w[2]) * Math.sin(y * w[1] * wscale + w[3]);
    const o = (y * W + x) * 3;
    F[o] = F[o + 1] = F[o + 2] = bg + clutter * 90 * t;
  }

  // ---- placement: rotation + Blender-style lens shift -----------------
  const pr = P.persp || {};
  const yaw = (pr.yaw || 0) * Math.PI / 180, pitch = (pr.pitch || 0) * Math.PI / 180, roll = (pr.roll || 0) * Math.PI / 180;
  const fov = (pr.fov || 60) * Math.PI / 180;
  const f = (H / 2) / Math.tan(fov / 2);
  const sizePx = Math.max(2, (fr.tagPct ?? 40) / 100 * H);
  let tz = f / sizePx;                                 // tag side = 1 unit
  const sx = (fr.shiftX || 0) / 100, sy = (fr.shiftY || 0) / 100;
  const cxp = W / 2 - sx * W, cyp = H / 2 - sy * H;    // principal point moves; tag stays centred
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const Rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const Ry = [cyw, 0, syw, 0, 1, 0, -syw, 0, cyw];
  const Rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  const mul = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return C; };
  const R = mul(Rz, mul(Ry, Rx));
  const half = 0.5 / tag.outerFrac;                    // half-span of the whole texture, plane units
  // Near-plane clipping fix: if any part of the plane would be closer than NEAR (or behind the camera),
  // push the whole plane straight back until its nearest point sits at NEAR.
  let zmin = Infinity;
  for (const [X, Y] of [[-half, -half], [half, -half], [half, half], [-half, half]]) zmin = Math.min(zmin, R[6] * X + R[7] * Y + tz);
  if (zmin < NEAR) tz += NEAR - zmin;
  const tx = sx * W * tz / f, ty = sy * H * tz / f;     // lateral offset so the tag projects to frame centre
  const Hm = [
    f * R[0] + cxp * R[6], f * R[1] + cxp * R[7], f * tx + cxp * tz,
    f * R[3] + cyp * R[6], f * R[4] + cyp * R[7], f * ty + cyp * tz,
    R[6], R[7], tz,
  ];
  const Hi = inv3(Hm);
  const proj = (X, Y) => { const w = Hm[6] * X + Hm[7] * Y + Hm[8]; return [(Hm[0] * X + Hm[1] * Y + Hm[2]) / w, (Hm[3] * X + Hm[4] * Y + Hm[5]) / w]; };
  const corners = [proj(-0.5, -0.5), proj(0.5, -0.5), proj(0.5, 0.5), proj(-0.5, 0.5)];
  const full = [proj(-half, -half), proj(half, -half), proj(half, half), proj(-half, half)];
  const xs = full.map(p => p[0]), ys = full.map(p => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)) + 1);
  const tex = tag.tex || (tag.tex = toGrayTexture(tag.canvas));
  const TW = tex.w, TH = tex.h;
  const sub = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let acc = 0, cov = 0;
    for (const [ox, oy] of sub) {
      const u = x + ox, v = y + oy;
      const w = Hi[6] * u + Hi[7] * v + Hi[8];
      if (w <= 0) continue;
      const X = (Hi[0] * u + Hi[1] * v + Hi[2]) / w, Y = (Hi[3] * u + Hi[4] * v + Hi[5]) / w;
      const tu = (X / (2 * half) + 0.5) * TW - 0.5, tv = (Y / (2 * half) + 0.5) * TH - 0.5;
      if (tu < -0.5 || tv < -0.5 || tu > TW - 0.5 || tv > TH - 0.5) continue;
      const iu = Math.max(0, Math.min(TW - 2, Math.floor(tu))), iv = Math.max(0, Math.min(TH - 2, Math.floor(tv)));
      const fu = Math.max(0, Math.min(1, tu - iu)), fv = Math.max(0, Math.min(1, tv - iv));
      const p = iv * TW + iu;
      acc += (tex.g[p] * (1 - fu) + tex.g[p + 1] * fu) * (1 - fv) + (tex.g[p + TW] * (1 - fu) + tex.g[p + TW + 1] * fu) * fv;
      cov++;
    }
    if (cov === 0) continue;
    const o = (y * W + x) * 3, a = cov / 4, val = acc / cov;
    for (let c = 0; c < 3; c++) F[o + c] = F[o + c] * (1 - a) + val * a;
  }
  const centroid = [corners.reduce((a, p) => a + p[0], 0) / 4, corners.reduce((a, p) => a + p[1], 0) / 4];
  let area = 0; for (let i = 0; i < 4; i++) { const p = corners[i], q = corners[(i + 1) % 4]; area += p[0] * q[1] - q[0] * p[1]; }
  const side = Math.max(3, Math.sqrt(Math.abs(area) / 2));
  const truth = { corners, center: proj(0, 0), centroid, side };

  // ---- lighting (scaled to the TAG, so the stress is felt where it matters) ----
  const rn = Math.hypot(W / 2, H / 2);
  if (P.light) {
    const L = P.light, a = L.gradAng * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const tcx = truth.center[0], tcy = truth.center[1];
    const shAng = rngLight() * 6.2832, shOff = (rngLight() - 0.5) * 0.8, sca = Math.cos(shAng), ssa = Math.sin(shAng);
    const gx = tcx + (rngLight() - 0.5) * side * 0.9, gy = tcy + (rngLight() - 0.5) * side * 0.9, gs2 = 2 * (side * 0.45) ** 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x - tcx, dy = y - tcy;
      let gain = Math.exp(L.grad * 4 * ((dx * ca + dy * sa) / side));          // up to ~55:1 across the tag
      const vx = x - cxp, vy = y - cyp;
      gain *= Math.max(0.02, 1 - L.vig * 1.5 * (vx * vx + vy * vy) / (rn * rn));
      if (L.shadow > 0) {
        const d = (dx * sca + dy * ssa) - shOff * side;
        gain *= 1 - L.shadow * 0.95 * Math.max(0, Math.min(1, d / 1.5 + 0.5));
      }
      const gl = L.glare > 0 ? L.glare * 700 * Math.exp(-((x - gx) ** 2 + (y - gy) ** 2) / gs2) : 0;
      const o = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) F[o + c] = Math.min(255, ((15 + F[o + c] * 0.85) * 1.1) * gain + gl);   // real ink is never pure black
    }
  }

  // ---- occlusion (drawn through a 2D canvas) --------------------------
  if (P.occ && P.occ.cover > 0) {
    const cv = new OffscreenCanvas(W, H), ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { img.data[i * 4] = F[i * 3]; img.data[i * 4 + 1] = F[i * 3 + 1]; img.data[i * 4 + 2] = F[i * 3 + 2]; img.data[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    const bx0 = Math.min(...corners.map(p => p[0])), bx1 = Math.max(...corners.map(p => p[0]));
    const by0 = Math.min(...corners.map(p => p[1])), by1 = Math.max(...corners.map(p => p[1]));
    const bw = bx1 - bx0, bh = by1 - by0;
    const n = Math.max(1, Math.round(P.occ.count));
    const area2 = P.occ.cover / 100 * bw * bh;
    for (let k = 0; k < n; k++) {
      const a = area2 / n * (0.5 + rngOcc());
      const shape = Number(P.occ.shape) >= 3 ? Math.floor(rngOcc() * 3) : Math.round(P.occ.shape);
      const tone = Number(P.occ.tone) >= 3 ? Math.floor(rngOcc() * 3) : Math.round(P.occ.tone);
      const g = [0, 255, 128][tone];
      ctx.fillStyle = ctx.strokeStyle = `rgb(${g},${g},${g})`;
      const px = bx0 + rngOcc() * bw, py = by0 + rngOcc() * bh, ar = 0.5 + rngOcc() * 1.5;
      const w = Math.sqrt(a * ar), h = Math.sqrt(a / ar);
      if (shape === 0) ctx.fillRect(px - w / 2, py - h / 2, w, h);
      else if (shape === 1) { ctx.beginPath(); ctx.ellipse(px, py, w / 2 * 1.13, h / 2 * 1.13, rngOcc() * 3.14, 0, 6.2832); ctx.fill(); }
      else { const ang = rngOcc() * 3.14, len = Math.sqrt(bw * bw + bh * bh) * 0.9, th = Math.max(1, a / len); ctx.lineWidth = th; ctx.beginPath(); ctx.moveTo(px - Math.cos(ang) * len / 2, py - Math.sin(ang) * len / 2); ctx.lineTo(px + Math.cos(ang) * len / 2, py + Math.sin(ang) * len / 2); ctx.stroke(); }
    }
    const out = ctx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < W * H; i++) { F[i * 3] = out[i * 4]; F[i * 3 + 1] = out[i * 4 + 1]; F[i * 3 + 2] = out[i * 4 + 2]; }
  }

  let buf = F;
  const samp = (src, x, y, c) => {                 // bilinear, one channel, clamped
    x = x < 0 ? 0 : x > W - 1 ? W - 1 : x; y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
    const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy, ix1 = Math.min(W - 1, ix + 1), iy1 = Math.min(H - 1, iy + 1);
    return (src[(iy * W + ix) * 3 + c] * (1 - fx) + src[(iy * W + ix1) * 3 + c] * fx) * (1 - fy) + (src[(iy1 * W + ix) * 3 + c] * (1 - fx) + src[(iy1 * W + ix1) * 3 + c] * fx) * fy;
  };

  // ---- lens bulge + chromatic aberration (distortion centre = principal point) ----
  if (P.lens && (Math.abs(P.lens.bulge) > 1e-4 || P.lens.ca > 1e-4)) {
    const k1 = P.lens.bulge, ca = P.lens.ca || 0, out = new Float32Array(W * H * 3), chS = [1 + ca, 1, 1 - ca];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - cxp) / rn, dy = (y + 0.5 - cyp) / rn, s = 1 + k1 * (dx * dx + dy * dy), o = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        const sx2 = cxp + dx * s * chS[c] * rn - 0.5, sy2 = cyp + dy * s * chS[c] * rn - 0.5;
        out[o + c] = (sx2 < -1 || sy2 < -1 || sx2 > W || sy2 > H) ? bg : samp(buf, sx2, sy2, c);
      }
    }
    buf = out;
  }

  // ---- motion blur / defocus ------------------------------------------
  if (P.blur) {
    const B = P.blur;
    if (B.blurLen >= 1) {
      const n = Math.max(2, Math.round(B.blurLen)), a = B.blurAng * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), out = new Float32Array(W * H * 3);
      const offs = []; for (let i = 0; i < n; i++) { const t = (i / (n - 1) - 0.5) * B.blurLen; offs.push([Math.round(t * ca), Math.round(t * sa)]); }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0;
        for (const [ox, oy] of offs) { const xx = Math.min(W - 1, Math.max(0, x + ox)), yy = Math.min(H - 1, Math.max(0, y + oy)), s = (yy * W + xx) * 3; r += buf[s]; g += buf[s + 1]; b += buf[s + 2]; }
        const o = (y * W + x) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
      }
      buf = out;
    }
    if (B.defocus >= 0.5) {                      // separable box blur, 2 passes ≈ soft disc
      const r = Math.round(B.defocus);
      for (let pass = 0; pass < 2; pass++) { buf = boxBlur(buf, W, H, r, true); buf = boxBlur(buf, W, H, r, false); }
    }
  }

  // ---- exposure --------------------------------------------------------
  if (P.expo) {
    const E = P.expo, m = Math.pow(2, E.ev);
    if (buf === F) buf = new Float32Array(F);
    for (let i = 0; i < W * H * 3; i++) {
      let v = Math.min(255, Math.max(0, buf[i])) / 255;
      v = Math.pow(v, E.gamma) * m;
      v = (v - 0.5) * E.contrast + 0.5;
      buf[i] = Math.min(255, Math.max(0, v * 255));
    }
  }

  // ---- sensor noise ----------------------------------------------------
  if (P.noise) {
    const N = P.noise, spP = N.sp / 100;
    if (buf === F) buf = new Float32Array(F);
    for (let i = 0; i < W * H; i++) {
      const o = i * 3, l = N.luma > 0 ? randn(rngNoise) * N.luma : 0;
      for (let c = 0; c < 3; c++) buf[o + c] += l + (N.chroma > 0 ? randn(rngNoise) * N.chroma : 0);
      if (spP > 0 && rngNoise() < spP) { const v = rngNoise() < 0.5 ? 0 : 255; buf[o] = buf[o + 1] = buf[o + 2] = v; }
    }
  }

  // ---- output ----------------------------------------------------------
  const rgba = new Uint8ClampedArray(W * H * 4), gray = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = Math.round(Math.min(255, Math.max(0, buf[i * 3]))), g = Math.round(Math.min(255, Math.max(0, buf[i * 3 + 1]))), b = Math.round(Math.min(255, Math.max(0, buf[i * 3 + 2])));
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
    gray[i] = (r * 299 + g * 587 + b * 114 + 500) / 1000 | 0;
  }
  return { rgba, gray, W, H, truth };
}

function boxBlur(src, W, H, r, horiz) {
  const out = new Float32Array(src.length), n = 2 * r + 1;
  const len = horiz ? W : H, lines = horiz ? H : W;
  for (let l = 0; l < lines; l++) for (let c = 0; c < 3; c++) {
    let acc = 0;
    const idx = (k) => (horiz ? (l * W + k) : (k * W + l)) * 3 + c;
    for (let k = -r; k <= r; k++) acc += src[idx(Math.min(len - 1, Math.max(0, k)))];
    for (let k = 0; k < len; k++) {
      out[idx(k)] = acc / n;
      acc += src[idx(Math.min(len - 1, k + r + 1))] - src[idx(Math.max(0, k - r))];
    }
  }
  return out;
}
