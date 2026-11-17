// A deliberately dumb "detector" used only to test the protocol end to end.
// Marker: black square covering [0.1, 0.9] of the image, with 8 id bits as white cells
// along its top inside strip. Works on clean frontal frames only. Not a real marker system.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::time::Instant;

const LO: f64 = 0.1;
const HI: f64 = 0.9;

fn cell_u(i: usize) -> (f64, f64) {
    let a = 0.14 + 0.09 * i as f64;
    (a, a + 0.09)
}
const STRIP_V: (f64, f64) = (0.15, 0.25);

fn generate(id: u32, size: usize) -> Vec<u8> {
    let mut img = vec![255u8; size * size];
    for y in 0..size {
        for x in 0..size {
            let (u, v) = ((x as f64 + 0.5) / size as f64, (y as f64 + 0.5) / size as f64);
            if u >= LO && u < HI && v >= LO && v < HI {
                let mut val = 0u8;
                if v >= STRIP_V.0 && v < STRIP_V.1 {
                    for i in 0..8 {
                        let (a, b) = cell_u(i);
                        if u >= a && u < b && (id >> (7 - i)) & 1 == 1 {
                            val = 255;
                        }
                    }
                }
                img[y * size + x] = val;
            }
        }
    }
    img
}

fn detect(img: &[u8], w: usize, h: usize) -> Vec<Value> {
    let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0usize, 0usize);
    for y in 0..h {
        for x in 0..w {
            if img[y * w + x] < 128 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    if x0 == usize::MAX || x1 <= x0 || y1 <= y0 {
        return vec![];
    }
    let (bw, bh) = ((x1 - x0 + 1) as f64, (y1 - y0 + 1) as f64);
    let mut id = 0u32;
    for i in 0..8 {
        let (a, b) = cell_u(i);
        let u = ((a + b) / 2.0 - LO) / (HI - LO);
        let v = ((STRIP_V.0 + STRIP_V.1) / 2.0 - LO) / (HI - LO);
        let px = (x0 as f64 + u * bw).floor().clamp(0.0, (w - 1) as f64) as usize;
        let py = (y0 as f64 + v * bh).floor().clamp(0.0, (h - 1) as f64) as usize;
        id = (id << 1) | u32::from(img[py * w + px] >= 128);
    }
    let (fx0, fy0, fx1, fy1) = (x0 as f64, y0 as f64, (x1 + 1) as f64, (y1 + 1) as f64);
    vec![json!({"id": id, "corners": [[fx0, fy0], [fx1, fy0], [fx1, fy1], [fx0, fy1]]})]
}

fn reply(out: &mut impl Write, mut v: Value, payload: &[u8]) {
    if !payload.is_empty() {
        v["payload"] = json!(payload.len());
    }
    let _ = writeln!(out, "{}", v);
    let _ = out.write_all(payload);
    let _ = out.flush();
}

fn main() {
    let stdin = std::io::stdin();
    let mut input = BufReader::new(stdin.lock());
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let mut line = String::new();
    loop {
        line.clear();
        if input.read_line(&mut line).unwrap_or(0) == 0 {
            return;
        }
        let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else {
            reply(&mut out, json!({"ok": false, "error": "invalid json"}), &[]);
            continue;
        };
        let n = msg.get("payload").and_then(Value::as_u64).unwrap_or(0) as usize;
        let mut data = vec![0u8; n];
        if input.read_exact(&mut data).is_err() {
            return;
        }
        match msg.get("cmd").and_then(Value::as_str) {
            Some("hello") => reply(&mut out, json!({"ok": true, "name": "arena-selftest", "idCount": 256, "protocol": 1}), &[]),
            Some("generate") => {
                let id = msg["id"].as_u64().unwrap_or(0) as u32 % 256;
                let size = msg["size"].as_u64().unwrap_or(256).clamp(16, 2048) as usize;
                let img = generate(id, size);
                reply(&mut out, json!({"ok": true, "outerFrac": 0.8}), &img);
            }
            Some("detect") => {
                let (w, h) = (msg["w"].as_u64().unwrap_or(0) as usize, msg["h"].as_u64().unwrap_or(0) as usize);
                if w * h != data.len() || w == 0 {
                    reply(&mut out, json!({"ok": false, "error": "image size mismatch"}), &[]);
                    continue;
                }
                let t = Instant::now();
                let dets = detect(&data, w, h);
                let ms = t.elapsed().as_secs_f64() * 1000.0; // only the detector call
                reply(&mut out, json!({"ok": true, "ms": ms, "dets": dets}), &[]);
            }
            Some("quit") => return,
            _ => reply(&mut out, json!({"ok": false, "error": "unknown cmd"}), &[]),
        }
    }
}
