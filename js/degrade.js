// Runtime scene synthesis + camera degradation pipeline.
// Everything is generated procedurally; no photos. All tags receive the exact same
// parameters AND the same random streams (shapes, noise) so the comparison is fair.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randn(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Setting definitions. These drive both the UI and the random sampling.
// kind: 'amp'   random mode samples U(0, value)
//       'sym'   random mode samples U(-value, value)
//       'angle' random mode samples U(0, 360)
//       'fixed' random mode uses the value as is
// ---------------------------------------------------------------------------
export const CATEGORIES = [
  { id: 'frame', title: 'Frame & placement', on: true, always: true, vars: [
    { id: 'tagPct', label: 'Tag size (% of frame height)', min: 3, max: 90, step: 1, def: 40, kind: 'fixed' },
    { id: 'offX', label: 'Offset X (% of frame)', min: 0, max: 40, step: 1, def: 0, kind: 'sym' },
    { id: 'offY', label: 'Offset Y (% of frame)', min: 0, max: 40, step: 1, def: 0, kind: 'sym' },
    { id: 'bg', label: 'Background brightness', min: 0, max: 255, step: 1, def: 150, kind: 'fixed' },
    { id: 'bgTex', label: 'Background clutter', min: 0, max: 100, step: 1, def: 0, kind: 'amp' },
  ]},
  { id: 'persp', title: '3D rotation (perspective)', on: false, vars: [
    { id: 'yaw', label: 'Yaw (°)', min: 0, max: 88, step: 1, def: 30, kind: 'sym' },
    { id: 'pitch', label: 'Pitch (°)', min: 0, max: 88, step: 1, def: 30, kind: 'sym' },
    { id: 'roll', label: 'Roll (°)', min: 0, max: 180, step: 1, def: 20, kind: 'sym' },
    { id: 'fov', label: 'Camera field of view (°, wide = stronger perspective)', min: 20, max: 140, step: 1, def: 60, kind: 'fixed' },
  ]},
  { id: 'lens', title: 'Lens distortion', on: false, vars: [
    { id: 'bulge', label: 'Bulge k1 (+ barrel / − pincushion)', min: 0, max: 1.5, step: 0.01, def: 0.4, kind: 'sym' },
  ]},
  { id: 'occ', title: 'Occlusion', on: false, vars: [
    { id: 'cover', label: 'Coverage (% of tag area)', min: 0, max: 80, step: 1, def: 15, kind: 'amp' },
    { id: 'count', label: 'Number of occluders', min: 1, max: 12, step: 1, def: 3, kind: 'fixed' },
    { id: 'shape', label: 'Shape (0 rect, 1 ellipse, 2 scratch line, 3 mixed)', min: 0, max: 3, step: 1, def: 3, kind: 'fixed' },
    { id: 'tone', label: 'Colour (0 black, 1 white, 2 gray, 3 random)', min: 0, max: 3, step: 1, def: 3, kind: 'fixed' },
  ]},
  { id: 'light', title: 'Uneven lighting', on: false, vars: [
    { id: 'grad', label: 'Gradient strength', min: 0, max: 1, step: 0.01, def: 0.6, kind: 'amp' },
    { id: 'gradAng', label: 'Gradient direction (°)', min: 0, max: 360, step: 1, def: 30, kind: 'angle' },
    { id: 'vig', label: 'Vignette', min: 0, max: 1, step: 0.01, def: 0, kind: 'amp' },
    { id: 'glare', label: 'Glare hotspot strength', min: 0, max: 1, step: 0.01, def: 0, kind: 'amp' },
  ]},
  { id: 'blur', title: 'Motion blur', on: false, vars: [
    { id: 'blurLen', label: 'Intensity (length px)', min: 0, max: 80, step: 1, def: 12, kind: 'amp' },
    { id: 'blurAng', label: 'Direction (°)', min: 0, max: 180, step: 1, def: 0, kind: 'angle' },
    { id: 'defocus', label: 'Defocus blur radius (px)', min: 0, max: 20, step: 0.5, def: 0, kind: 'amp' },
  ]},
  { id: 'expo', title: 'Exposure (extreme bright / dark)', on: false, vars: [
    { id: 'ev', label: 'Exposure (EV stops, + bright / − dark)', min: 0, max: 5, step: 0.1, def: 2, kind: 'sym' },
    { id: 'contrast', label: 'Contrast ×', min: 0.1, max: 2, step: 0.05, def: 1, kind: 'fixed' },
    { id: 'gamma', label: 'Gamma', min: 0.3, max: 3, step: 0.05, def: 1, kind: 'fixed' },
  ]},
  { id: 'res', title: 'Low resolution / mosaic', on: false, vars: [
    { id: 'block', label: 'Block size (px)', min: 1, max: 24, step: 1, def: 4, kind: 'amp' },
    { id: 'mosaic', label: 'Style (0 smooth, 1 hard mosaic)', min: 0, max: 1, step: 1, def: 1, kind: 'fixed' },
    { id: 'levels', label: 'Brightness levels (posterize)', min: 2, max: 256, step: 1, def: 256, kind: 'fixed' },
  ]},
  { id: 'noise', title: 'Sensor noise', on: false, vars: [
    { id: 'luma', label: 'Luminance noise σ', min: 0, max: 100, step: 1, def: 20, kind: 'amp' },
    { id: 'chroma', label: 'Colour noise σ', min: 0, max: 100, step: 1, def: 20, kind: 'amp' },
    { id: 'sp', label: 'Salt & pepper (% of pixels)', min: 0, max: 20, step: 0.1, def: 0, kind: 'amp' },
  ]},
];

export const FRAME_SIZES = { '320×240': [320, 240], '640×480': [640, 480], '1280×720': [1280, 720] };

export function defaultSettings() {
  const s = {};
  for (const c of CATEGORIES) {
    s[c.id] = { on: c.on };
    for (const v of c.vars) s[c.id][v.id] = v.def;
  }
  return s;
}

// Resolve settings to concrete parameters. random=true: sliders are maxima.
export function resolveParams(settings, random, rng) {
  const P = {};
  for (const c of CATEGORIES) {
    const sc = settings[c.id];
    if (!sc.on) continue;
    P[c.id] = {};
    for (const v of c.vars) {
      let x = sc[v.id];
      if (random) {
        if (v.kind === 'amp') x = rng() * x;
        else if (v.kind === 'sym') x = (rng() * 2 - 1) * x;
        else if (v.kind === 'angle') x = rng() * 360;
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
  const det = a * A + b * B + c * C;
  const k = 1 / det;
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

// tag: { canvas, outerFrac } ; outerFrac = black outer square side / whole canvas side
export function renderFrame(tag, P, W, H, seed) {
  const rngBg = mulberry32(seed ^ 0x1234);
  const rngOcc = mulberry32(seed ^ 0x5678);
  const rngNoise = mulberry32(seed ^ 0x9abc);
  const F = new Float32Array(W * H * 3);

  // ---- background ------------------------------------------------------
  const fr = P.frame;
  const bg = fr.bg ?? 150;
  const clutter = (fr.bgTex ?? 0) / 100;
  const waves = [];
  for (let k = 0; k < 6; k++) waves.push([rngBg() * 0.06 + 0.01, rngBg() * 0.06 + 0.01, rngBg() * 6.28, rngBg() * 6.28, rngBg()]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let t = 0;
    if (clutter > 0) for (const w of waves) t += w[4] * Math.sin(x * w[0] + w[2]) * Math.sin(y * w[1] + w[3]);
    const v = bg + clutter * 90 * t;
    const o = (y * W + x) * 3;
    F[o] = F[o + 1] = F[o + 2] = v;
  }

  // ---- perspective placement of the tag -------------------------------
  const pr = P.persp || {};
  const yaw = (pr.yaw || 0) * Math.PI / 180, pitch = (pr.pitch || 0) * Math.PI / 180, roll = (pr.roll || 0) * Math.PI / 180;
  const fov = (pr.fov || 60) * Math.PI / 180;
  const f = (H / 2) / Math.tan(fov / 2);
  const sizePx = (fr.tagPct ?? 40) / 100 * H;
  const tz = f / sizePx;                       // tag side = 1 unit
  const cx = W / 2 + ((fr.offX || 0) / 100) * W, cy = H / 2 + ((fr.offY || 0) / 100) * H;
  const tx = (cx - W / 2) * tz / f, ty = (cy - H / 2) * tz / f;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // R = Rz(roll) * Ry(yaw) * Rx(pitch)
  const Rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const Ry = [cyw, 0, syw, 0, 1, 0, -syw, 0, cyw];
  const Rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  const mul = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return C; };
  const R = mul(Rz, mul(Ry, Rx));
  // plane point (X,Y,0): cam = R[:,0]*X + R[:,1]*Y + t ; pixel = f*cam.xy/cam.z + (W/2,H/2)
  const t3 = [tx, ty, tz];
  const Hm = [
    f * R[0] + (W / 2) * R[6], f * R[1] + (W / 2) * R[7], f * t3[0] + (W / 2) * t3[2],
    f * R[3] + (H / 2) * R[6], f * R[4] + (H / 2) * R[7], f * t3[1] + (H / 2) * t3[2],
    R[6], R[7], t3[2],
  ];
  const Hi = inv3(Hm);
  const proj = (X, Y) => { const w = Hm[6] * X + Hm[7] * Y + Hm[8]; return [(Hm[0] * X + Hm[1] * Y + Hm[2]) / w, (Hm[3] * X + Hm[4] * Y + Hm[5]) / w]; };
  const half = 0.5 / tag.outerFrac;            // half-span of whole texture in plane units
  const corners = [proj(-0.5, -0.5), proj(0.5, -0.5), proj(0.5, 0.5), proj(-0.5, 0.5)]; // black square corners
  const full = [proj(-half, -half), proj(half, -half), proj(half, half), proj(-half, half)];
  const xs = full.map(p => p[0]), ys = full.map(p => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)) + 1);
  const tex = tag.tex || (tag.tex = toGrayTexture(tag.canvas));
  const TW = tex.w, TH = tex.h;
  const sub = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let acc = 0, cov = 0;
    for (const [sx, sy] of sub) {
      const u = x + sx, v = y + sy;
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
    const area = P.occ.cover / 100 * bw * bh;
    for (let k = 0; k < n; k++) {
      const a = area / n * (0.5 + rngOcc());
      const shape = P.occ.shape >= 3 ? Math.floor(rngOcc() * 3) : Math.round(P.occ.shape);
      const tone = P.occ.tone >= 3 ? Math.floor(rngOcc() * 3) : Math.round(P.occ.tone);
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
  const sample = (src, x, y, o) => {              // bilinear, clamped
    x = x < 0 ? 0 : x > W - 1 ? W - 1 : x; y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
    const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy, ix1 = Math.min(W - 1, ix + 1), iy1 = Math.min(H - 1, iy + 1);
    const a = (iy * W + ix) * 3, b = (iy * W + ix1) * 3, c = (iy1 * W + ix) * 3, d = (iy1 * W + ix1) * 3;
    for (let k = 0; k < 3; k++) o[k] = (src[a + k] * (1 - fx) + src[b + k] * fx) * (1 - fy) + (src[c + k] * (1 - fx) + src[d + k] * fx) * fy;
  };

  // ---- lens bulge ------------------------------------------------------
  if (P.lens && Math.abs(P.lens.bulge) > 1e-4) {
    const k1 = P.lens.bulge, out = new Float32Array(W * H * 3), tmp = [0, 0, 0];
    const rn = Math.hypot(W / 2, H / 2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - W / 2) / rn, dy = (y + 0.5 - H / 2) / rn, r2 = dx * dx + dy * dy, s = 1 + k1 * r2;
      const sx = W / 2 + dx * s * rn - 0.5, sy = H / 2 + dy * s * rn - 0.5, o = (y * W + x) * 3;
      if (sx < -1 || sy < -1 || sx > W || sy > H) { out[o] = out[o + 1] = out[o + 2] = bg; continue; }
      sample(buf, sx, sy, tmp); out[o] = tmp[0]; out[o + 1] = tmp[1]; out[o + 2] = tmp[2];
    }
    buf = out;
  }

  // ---- lighting --------------------------------------------------------
  if (P.light) {
    const L = P.light, a = L.gradAng * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), rn = Math.hypot(W / 2, H / 2);
    const gx = W * (0.15 + 0.7 * mulberry32(seed ^ 0x77)()), gy = H * (0.15 + 0.7 * mulberry32(seed ^ 0x78)());
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x - W / 2, dy = y - H / 2;
      let m = 1 + L.grad * ((dx * ca + dy * sa) / rn);        // −grad … +grad across the frame
      m *= 1 - L.vig * (dx * dx + dy * dy) / (rn * rn);
      const o = (y * W + x) * 3;
      const gl = L.glare > 0 ? L.glare * 255 * Math.exp(-((x - gx) ** 2 + (y - gy) ** 2) / (2 * (H * 0.18) ** 2)) : 0;
      buf[o] = buf[o] * m + gl; buf[o + 1] = buf[o + 1] * m + gl; buf[o + 2] = buf[o + 2] * m + gl;
    }
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
    const E = P.expo, mul = Math.pow(2, E.ev);
    for (let i = 0; i < W * H * 3; i++) {
      let v = Math.min(255, Math.max(0, buf[i])) / 255;
      v = Math.pow(v, E.gamma) * mul;
      v = (v - 0.5) * E.contrast + 0.5;
      buf[i] = Math.min(255, Math.max(0, v * 255));
    }
  }

  // ---- low resolution / mosaic ----------------------------------------
  if (P.res && P.res.block >= 1.5) {
    const bsz = Math.round(P.res.block), out = new Float32Array(W * H * 3);
    const bw = Math.ceil(W / bsz), bh = Math.ceil(H / bsz), small = new Float32Array(bw * bh * 3);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = by * bsz; y < Math.min(H, by * bsz + bsz); y++) for (let x = bx * bsz; x < Math.min(W, bx * bsz + bsz); x++) { const s = (y * W + x) * 3; r += buf[s]; g += buf[s + 1]; b += buf[s + 2]; n++; }
      const o = (by * bw + bx) * 3; small[o] = r / n; small[o + 1] = g / n; small[o + 2] = b / n;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      if (P.res.mosaic >= 0.5) { const s = (Math.floor(y / bsz) * bw + Math.floor(x / bsz)) * 3; out[o] = small[s]; out[o + 1] = small[s + 1]; out[o + 2] = small[s + 2]; }
      else {
        const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / bsz - 0.5)), fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / bsz - 0.5));
        const ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, ix1 = Math.min(bw - 1, ix + 1), iy1 = Math.min(bh - 1, iy + 1);
        for (let k = 0; k < 3; k++) out[o + k] = (small[(iy * bw + ix) * 3 + k] * (1 - ax) + small[(iy * bw + ix1) * 3 + k] * ax) * (1 - ay) + (small[(iy1 * bw + ix) * 3 + k] * (1 - ax) + small[(iy1 * bw + ix1) * 3 + k] * ax) * ay;
      }
    }
    buf = out;
  }
  if (P.res && P.res.levels < 256) {
    const q = 255 / (Math.round(P.res.levels) - 1);
    for (let i = 0; i < W * H * 3; i++) buf[i] = Math.round(buf[i] / q) * q;
  }

  // ---- sensor noise ----------------------------------------------------
  if (P.noise) {
    const N = P.noise, spP = N.sp / 100;
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
  return { rgba, gray, W, H, truth: { corners, center: proj(0, 0), side: Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]) } };
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
