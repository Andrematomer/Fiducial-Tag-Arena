// Desktop-app bridge. In a normal browser (GitHub Pages) there is no window.__TAURI__ and
// this module contributes nothing. In the Tauri app it lists detector programs found on disk
// (see docs/DETECTOR_PROTOCOL.md) and wraps each one in the same {generate, detect} API the
// built-in browser detectors use. No third-party detector code is ever bundled with the page.

const T = typeof window !== 'undefined' ? window.__TAURI__ : undefined;
export const isDesktop = !!(T && T.core && typeof T.core.invoke === 'function');
const invoke = (...a) => T.core.invoke(...a);

function grayToCanvas(bytes, size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) { const v = bytes[i]; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}

export async function loadNativeTags() {
  if (!isDesktop) return [];
  let list = [];
  try { list = await invoke('list_detectors'); } catch (e) { console.error('list_detectors failed', e); return []; }
  return list.map(m => ({
    key: 'native-' + m.key,
    name: m.name,
    family: m.family || 'Native program',
    license: m.license || 'see detector folder',
    size: 'separate program',
    impl: `Separate program started by the app (${m.exe}). Its code is not part of this page.`,
    note: m.note || '',
    idCount: m.idCount,
    native: true,
    load: async () => {
      const hello = await invoke('detector_open', { key: m.key });
      const idCount = hello.idCount ?? m.idCount;
      return {
        idCount,
        // Generation is not timed and not part of the results.
        async generate(id) {
          const buf = await invoke('detector_generate', { key: m.key, id, size: 512 });
          const ab = buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer;
          const outerFrac = new DataView(ab).getFloat64(0, true);
          return { canvas: grayToCanvas(new Uint8Array(ab, 8), 512), outerFrac };
        },
        // Resolves to { dets, ms }: ms is measured by the detector program itself around the
        // detector call only, so process start-up, pipes and IPC are not counted.
        async detect(gray, _rgba, W, H) {
          const res = await invoke('detector_detect', gray, { headers: { key: m.key, w: String(W), h: String(H) } });
          const dets = (res.dets || []).map(d => {
            const c = d.corners;
            return { id: d.id, corners: c, cx: c.reduce((a, p) => a + p[0], 0) / c.length, cy: c.reduce((a, p) => a + p[1], 0) / c.length };
          });
          return { dets, ms: res.ms };
        },
      };
    },
  }));
}
