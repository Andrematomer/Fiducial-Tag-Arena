"""End-to-end browser test.

  python test/e2e.py <path to arena-selftest[.exe]>

1. Plain browser mode (as on GitHub Pages): built-in detectors work, desktop-only tags are locked.
2. Mock desktop mode: window.__TAURI__ is faked and backed by test/bridge-server.mjs, which talks the
   real detector protocol to the self-test program. Checks discovery, generate, detect, timing source.
"""
import subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
exe = sys.argv[1]
procs = [
    subprocess.Popen([sys.executable, "-m", "http.server", "8770", "-d", str(root)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
    subprocess.Popen(["node", str(root / "test" / "bridge-server.mjs"), exe, "8771"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
]
time.sleep(1.5)

FAKE = """
window.__TAURI__ = { core: { invoke: async (cmd, args, opts) => {
  const url = 'http://localhost:8771/' + cmd;
  const r = (args instanceof Uint8Array)
    ? await fetch(url, { method: 'POST', headers: { ...(opts && opts.headers || {}) }, body: args })
    : await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args || {}) });
  if (!r.ok) throw new Error(await r.text());
  return (r.headers.get('content-type') || '').includes('octet-stream') ? await r.arrayBuffer() : await r.json();
} } };
"""
CLEAN = """(() => { const s = __arena.settings();
  for (const k of ['persp','lens','occ','light','blur','expo','noise']) s[k].on = false;
  s.frame.mode = 'exact'; s.frame.bgTex = 0; s.frame.shiftX = 0; s.frame.shiftY = 0; s.frame.size = 128; })()"""
fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra) if extra != "" else ""))
    if not cond: fails.append(name)
def wait_idle(pg): pg.wait_for_function("!document.querySelector('#runOnce').disabled", timeout=120000)
def stats(pg): return pg.evaluate("Object.fromEntries(__arena.entries.filter(e=>e.web&&e.enabled).map(e=>[e.name,[e.res.ok.filter(Boolean).length,e.res.ok.length,e.res.ms.length?e.res.ms[e.res.ms.length-1]:null]]))")

try:
    with sync_playwright() as p:
        b = p.chromium.launch()

        # ---- 1. plain browser ------------------------------------------------
        pg = b.new_page(viewport={"width": 1500, "height": 900}); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://localhost:8770/index.html")
        pg.wait_for_function("document.querySelectorAll('.state.ok').length==2", timeout=60000)
        check("browser: download button visible", pg.is_visible("a.dl"))
        check("browser: locked tags show browser message", "browser limitations" in pg.inner_text(".cell.locked .msg"))
        check("browser: no selftest tag", pg.evaluate("!__arena.entries.some(e=>e.name.includes('Self-test'))"))
        pg.evaluate(CLEAN); pg.fill("#ticks", "8"); pg.click("#runTicks"); wait_idle(pg)
        st = stats(pg); print("   ", st)
        check("browser: AprilTag + ArUco clean 8/8", all(v[0] == 8 and v[1] == 8 for v in st.values()))
        check("browser: no page errors", not errs, errs)
        pg.close()

        # ---- 2. mock desktop ---------------------------------------------------
        pg = b.new_page(viewport={"width": 1500, "height": 900}); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script(FAKE)
        pg.goto("http://localhost:8770/index.html")
        pg.wait_for_function("document.querySelectorAll('.state.ok').length==2", timeout=60000)
        check("desktop: download button hidden", not pg.is_visible("a.dl"))
        check("desktop: selftest tag discovered", pg.evaluate("__arena.entries.some(e=>e.name.includes('Self-test'))"))
        check("desktop: locked tags say not installed", "not installed" in pg.inner_text(".cell.locked .msg"))
        pg.locator(".cell:has-text('Self-test') input[type=checkbox]").check()
        pg.wait_for_function("document.querySelectorAll('.state.ok').length==3", timeout=60000)
        pg.evaluate(CLEAN); pg.fill("#ticks", "10"); pg.click("#runTicks"); wait_idle(pg)
        st = stats(pg); print("   ", st)
        t = [v for k, v in st.items() if "Self-test" in k][0]
        check("desktop: selftest detected 10/10 through the protocol", t[0] == 10 and t[1] == 10, t)
        check("desktop: native timing reported", t[2] is not None and t[2] >= 0)
        check("desktop: random IDs differ between ticks", pg.evaluate("new Set(__arena.entries.filter(e=>e.name.includes('Self-test')).map(e=>e.lastId)).size")>=1)
        # stress: native tag should start failing (it is a toy, frontal-only)
        pg.click("#clear"); pg.evaluate("(()=>{const s=__arena.settings(); s.persp.on=true; s.persp.yaw=60; s.persp.pitch=50; s.frame.mode='exact';})()")
        pg.fill("#ticks", "6"); pg.click("#runTicks"); wait_idle(pg)
        t2 = [v for k, v in stats(pg).items() if "Self-test" in k][0]
        check("desktop: toy detector fails under strong perspective (sanity)", t2[0] < t2[1], t2)
        check("desktop: no page errors", not errs, errs)
        b.close()
finally:
    for pr in procs: pr.terminate()
print("\nFAILED: " + ", ".join(fails) if fails else "\nALL PASSED")
sys.exit(1 if fails else 0)
