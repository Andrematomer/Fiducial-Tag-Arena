// Tag registry. Every entry lazy-loads its own detector the first time the user ticks it.
// load() resolves to { generate(id) -> {canvas, outerFrac}, detect(gray, rgba, W, H) -> [{id,cx,cy,corners}] }

const scriptCache = new Map();
function loadScript(url) {
  if (!scriptCache.has(url)) {
    scriptCache.set(url, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = url; s.onload = () => res(); s.onerror = () => rej(new Error('Failed to load ' + url));
      document.head.appendChild(s);
    }));
  }
  return scriptCache.get(url);
}

// ---- generic "square with N×N bits" image generator (ArUco / AprilTag layout) ----------
function squareBitTag(codeStr, n) {
  const cells = n + 4, k = Math.ceil(512 / cells), S = cells * k;   // 1 quiet + 1 border each side
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#000'; ctx.fillRect(k, k, (n + 2) * k, (n + 2) * k);
  ctx.fillStyle = '#fff';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (codeStr[y * n + x] === '1') ctx.fillRect((x + 2) * k, (y + 2) * k, k, k);
  return { canvas, outerFrac: (n + 2) / (n + 4) };
}

// ---- ArUco-family (js-aruco2, MIT) ----------------------------------------------------
async function loadArucoLib(dictFile) {
  await loadScript('vendor/aruco/cv.js');
  await loadScript('vendor/aruco/aruco.js');
  await loadScript('vendor/aruco/dictionaries/' + dictFile);
}
function makeArucoLoader(dictFile, dictName) {
  return async () => {
    await loadArucoLib(dictFile);
    const dict = new AR.Dictionary(dictName), n = Math.sqrt(dict.nBits);
    const det = new AR.Detector({ dictionaryName: dictName });
    const api = {
      idCount: dict.codeList.length,
      generate: (id) => squareBitTag(dict.codeList[id], n),
      detect: (gray, rgba, W, H) => det.detect({ width: W, height: H, data: rgba }).map(m => {
        const c = m.corners.map(p => [p.x, p.y]);
        return { id: m.id, cx: c.reduce((a, p) => a + p[0], 0) / c.length, cy: c.reduce((a, p) => a + p[1], 0) / c.length, corners: c };
      }),
    };
    return api;
  };
}

// ---- AprilTag (official C → WASM, BSD) -------------------------------------------------
async function loadAprilTag() {
  await loadScript('vendor/apriltag/apriltag_wasm.js');
  await loadArucoLib('apriltag_36h11.js');              // only used to generate tag images
  const dict = new AR.Dictionary('APRILTAG_36h11'), n = 6;
  const Module = await new Promise((res) => { AprilTagWasm().then((m) => res(m)); });
  const init = Module.cwrap('atagjs_init', 'number', []);
  const setOpts = Module.cwrap('atagjs_set_detector_options', 'number', ['number', 'number', 'number', 'number', 'number', 'number', 'number']);
  const setBuf = Module.cwrap('atagjs_set_img_buffer', 'number', ['number', 'number', 'number']);
  const detect = Module.cwrap('atagjs_detect', 'number', []);
  init();
  // official defaults: decimate 2.0, sigma 0, 1 thread, refine edges, no pose
  setOpts(2.0, 0.0, 1, 1, 0, 0, 0);
  return {
    idCount: dict.codeList.length,
    generate: (id) => squareBitTag(dict.codeList[id], n),
    detect: (gray, rgba, W, H) => {
      const ptr = setBuf(W, H, W);
      Module.HEAPU8.set(gray, ptr);
      const sp = detect();
      const len = Module.getValue(sp, 'i32');
      if (!len) return [];
      const strPtr = Module.getValue(sp + 4, 'i32');
      const bytes = new Uint8Array(Module.HEAP8.buffer, strPtr, len);
      let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[i]);
      const arr = JSON.parse(s);
      if (!Array.isArray(arr)) return [];
      return arr.map(d => ({ id: d.id, cx: d.center.x, cy: d.center.y, corners: d.corners.map(c => [c.x, c.y]) }));
    },
  };
}

export const TAGS = [
  {
    key: 'apriltag36h11', name: 'AprilTag 36h11', family: 'Square · binary',
    impl: 'Official AprilTag C library compiled to WebAssembly (apriltag-js-standalone)', license: 'BSD-3-Clause', size: '~200 KB',
    idCount: 587, load: loadAprilTag,
  },
  {
    key: 'aruco4', name: 'ArUco 4×4', family: 'Square · binary',
    impl: 'js-aruco2 (JavaScript port of ArUco, not OpenCV’s C++ detector)', license: 'MIT', size: '~100 KB',
    idCount: 1000, load: makeArucoLoader('aruco_4x4_1000.js', 'ARUCO_4X4_1000'),
  },
  {
    key: 'aruco5', name: 'ArUco 5×5', family: 'Square · binary',
    impl: 'js-aruco2 (JavaScript port of ArUco)', license: 'MIT', size: '~100 KB',
    idCount: 1000, load: makeArucoLoader('aruco_5x5_1000.js', 'ARUCO_5X5_1000'),
  },
  {
    key: 'aruco6', name: 'ArUco 6×6', family: 'Square · binary',
    impl: 'js-aruco2 (JavaScript port of ArUco)', license: 'MIT', size: '~100 KB',
    idCount: 1000, load: makeArucoLoader('aruco_6x6_1000.js', 'ARUCO_6X6_1000'),
  },
  {
    key: 'arucomip', name: 'ArUco MIP 36h12', family: 'Square · binary',
    impl: 'js-aruco2 (JavaScript port of ArUco)', license: 'MIT', size: '~100 KB',
    idCount: 250, load: makeArucoLoader('aruco_mip_36h12.js', 'ARUCO_MIP_36h12'),
  },
];

// Tags deliberately not included, shown on the page so nobody wonders.
export const SKIPPED = [
  ['TopoTag', 'Source is C++/OpenCV and released “for research purposes only, no commercial use”; no browser build exists.'],
  ['CCTag', 'C++ with Boost/OpenCV (CUDA optional). No practical WebAssembly build exists.'],
  ['RuneTag, Pi-Tag, Prasad et al., Cho et al., Knyaz et al., Tateno et al., FourierTag, InterSense, SIFTTag, ChromaTag', 'No public detector source that could run here, or no source at all.'],
  ['ARToolKit / ARToolKitPlus, ARTag, binARyID, CyberCode, VisualCode, Matrix', 'Obsolete or superseded by AprilTag/ArUco; ARToolKit’s WASM build needs camera-calibration files and is planned separately. ARTag is closed-source.'],
  ['reacTIVision / D-touch, BullsEye, WhyCon, CCC', 'Only GPL desktop programs or papers; a faithful browser detector would be my own re-implementation and would measure my code, not the original.'],
];
