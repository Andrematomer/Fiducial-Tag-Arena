// Test-only stand-in for the Tauri backend: exposes the same commands as app/src-tauri
// (list_detectors, detector_open, detector_generate, detector_detect) over HTTP and talks to a
// real detector program using the real line+payload protocol. Used by test/e2e.py.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const exe = process.argv[2];
const port = Number(process.argv[3] || 8771);
if (!exe) { console.error('usage: node bridge-server.mjs <detector exe> [port]'); process.exit(2); }

class Proc {
  constructor(path) {
    this.p = spawn(path, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = Buffer.alloc(0); this.waiter = null; this.queue = Promise.resolve();
    this.p.stdout.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.waiter?.(); });
  }
  wait(test) { return new Promise((res) => { const go = () => { const r = test(); if (r !== undefined) { this.waiter = null; res(r); } }; this.waiter = go; go(); }); }
  readLine() { return this.wait(() => { const i = this.buf.indexOf(10); if (i < 0) return undefined; const s = this.buf.subarray(0, i).toString(); this.buf = this.buf.subarray(i + 1); return s; }); }
  readBytes(n) { return this.wait(() => { if (this.buf.length < n) return undefined; const b = Buffer.from(this.buf.subarray(0, n)); this.buf = this.buf.subarray(n); return b; }); }
  request(header, payload = Buffer.alloc(0)) {
    const run = async () => {
      const h = { ...header }; if (payload.length) h.payload = payload.length;
      this.p.stdin.write(JSON.stringify(h) + '\n'); if (payload.length) this.p.stdin.write(payload);
      const v = JSON.parse(await this.readLine());
      const data = await this.readBytes(v.payload || 0);
      if (v.ok !== true) throw new Error(v.error || 'detector error');
      return [v, data];
    };
    return (this.queue = this.queue.then(run, run));
  }
}
const proc = new Proc(exe);
const manifest = { key: 'selftest', name: 'Self-test (toy, plumbing only)', family: 'Test only', license: 'n/a', exe: 'arena-selftest', idCount: 256, note: 'test', dir: '' };

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks), cmd = req.url.slice(1);
  try {
    if (cmd === 'list_detectors') { res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify([manifest])); }
    if (cmd === 'detector_open') { const [v] = await proc.request({ cmd: 'hello', protocol: 1 }); res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify(v)); }
    if (cmd === 'detector_generate') {
      const a = JSON.parse(body.toString() || '{}');
      const [v, data] = await proc.request({ cmd: 'generate', id: a.id, size: a.size });
      const head = Buffer.alloc(8); head.writeDoubleLE(v.outerFrac, 0);
      res.writeHead(200, { ...cors, 'content-type': 'application/octet-stream' }); return res.end(Buffer.concat([head, data]));
    }
    if (cmd === 'detector_detect') {
      const [v] = await proc.request({ cmd: 'detect', w: Number(req.headers.w), h: Number(req.headers.h) }, body);
      res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify(v));
    }
    res.writeHead(404, cors); res.end('unknown command');
  } catch (e) { res.writeHead(500, cors); res.end(String(e.message || e)); }
}).listen(port, () => console.log('bridge listening on', port));
process.on('exit', () => proc.p.kill());
