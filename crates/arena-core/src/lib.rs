//! Detector discovery + the Stockfish-style process protocol.
//!
//! Every external detector is a separate program started by the app. The app never links
//! or bundles detector code. Messages are one JSON line, optionally followed by a raw
//! binary payload whose byte length is given in the JSON field `"payload"`.
//! See docs/DETECTOR_PROTOCOL.md.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

/// Refuse absurd payload sizes from a misbehaving detector (64 MiB).
const MAX_PAYLOAD: u64 = 64 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub family: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub note: String,
    /// Executable path, relative to the folder holding detector.json.
    pub exe: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub id_count: u32,
    /// Filled in at discovery time; not read from the file.
    #[serde(skip_deserializing, default)]
    pub dir: String,
}

/// Folders searched for `<folder>/<detector>/detector.json`.
pub fn detector_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(paths) = std::env::var_os("ARENA_DETECTORS") {
        roots.extend(std::env::split_paths(&paths));
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(Path::to_path_buf);
        // next to the app (installed), then up the tree (development checkout)
        for _ in 0..7 {
            let Some(d) = dir else { break };
            roots.push(d.join("detectors"));
            if cfg!(debug_assertions) {
                roots.push(d.join("detectors-dev"));
            }
            dir = d.parent().map(Path::to_path_buf);
        }
    }
    roots
}

pub fn list_manifests_in(roots: &[PathBuf]) -> Vec<Manifest> {
    let mut out: Vec<Manifest> = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else { continue };
        let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        for d in dirs {
            let Ok(text) = std::fs::read_to_string(d.join("detector.json")) else { continue };
            let Ok(mut m) = serde_json::from_str::<Manifest>(&text) else { continue };
            if out.iter().any(|x| x.key == m.key) {
                continue; // first one found wins
            }
            m.dir = d.to_string_lossy().into_owned();
            out.push(m);
        }
    }
    out
}

pub fn list_manifests() -> Vec<Manifest> {
    list_manifests_in(&detector_roots())
}

pub fn find_manifest(key: &str) -> Option<Manifest> {
    list_manifests().into_iter().find(|m| m.key == key)
}

pub struct Proc {
    child: Child,
    stdin: ChildStdin,
    out: BufReader<ChildStdout>,
}

impl Drop for Proc {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"{\"cmd\":\"quit\"}\n");
        let _ = self.stdin.flush();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Proc {
    pub fn spawn(m: &Manifest) -> Result<Proc, String> {
        let exe = Path::new(&m.dir).join(&m.exe);
        let mut cmd = Command::new(&exe);
        cmd.args(&m.args)
            .current_dir(&m.dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("cannot start {}: {}", exe.display(), e))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let out = BufReader::new(child.stdout.take().ok_or("no stdout")?);
        Ok(Proc { child, stdin, out })
    }

    pub fn request(&mut self, header: Value, payload: &[u8]) -> Result<(Value, Vec<u8>), String> {
        let mut h = header;
        if !payload.is_empty() {
            h["payload"] = json!(payload.len());
        }
        let mut line = serde_json::to_vec(&h).map_err(|e| e.to_string())?;
        line.push(b'\n');
        self.stdin.write_all(&line).map_err(|e| format!("write failed (detector exited?): {e}"))?;
        self.stdin.write_all(payload).map_err(|e| e.to_string())?;
        self.stdin.flush().map_err(|e| e.to_string())?;

        let mut reply = String::new();
        let n = self.out.read_line(&mut reply).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("detector closed its output".into());
        }
        let v: Value = serde_json::from_str(reply.trim()).map_err(|e| format!("bad reply from detector: {e}"))?;
        let len = v.get("payload").and_then(Value::as_u64).unwrap_or(0);
        if len > MAX_PAYLOAD {
            return Err(format!("detector announced a {len}-byte payload; refusing"));
        }
        let mut data = vec![0u8; len as usize];
        self.out.read_exact(&mut data).map_err(|e| e.to_string())?;
        if v.get("ok").and_then(Value::as_bool) != Some(true) {
            let msg = v.get("error").and_then(Value::as_str).unwrap_or("detector reported an error");
            return Err(msg.to_string());
        }
        Ok((v, data))
    }
}

/// Running detector processes, keyed by manifest key.
#[derive(Default)]
pub struct Registry(Mutex<HashMap<String, Proc>>);

impl Registry {
    fn with<T>(&self, key: &str, f: impl FnOnce(&mut Proc) -> Result<T, String>) -> Result<T, String> {
        let mut map = self.0.lock().map_err(|e| e.to_string())?;
        if !map.contains_key(key) {
            let m = find_manifest(key).ok_or_else(|| format!("detector '{key}' not found"))?;
            map.insert(key.to_string(), Proc::spawn(&m)?);
        }
        let p = map.get_mut(key).expect("just inserted");
        let r = f(p);
        if r.is_err() {
            // A failed detector may be wedged or dead: drop it so the next call restarts it.
            map.remove(key);
        }
        r
    }

    pub fn open(&self, key: &str) -> Result<Value, String> {
        self.with(key, |p| p.request(json!({"cmd": "hello", "protocol": 1}), &[]).map(|r| r.0))
    }

    /// Returns [f64 outerFrac little-endian][size*size gray bytes].
    pub fn generate(&self, key: &str, id: u32, size: u32) -> Result<Vec<u8>, String> {
        self.with(key, |p| {
            let (v, bytes) = p.request(json!({"cmd": "generate", "id": id, "size": size}), &[])?;
            if bytes.len() != (size as usize) * (size as usize) {
                return Err(format!("generate returned {} bytes, expected {}", bytes.len(), size * size));
            }
            let frac = v.get("outerFrac").and_then(Value::as_f64).ok_or("generate reply missing outerFrac")?;
            let mut out = Vec::with_capacity(8 + bytes.len());
            out.extend_from_slice(&frac.to_le_bytes());
            out.extend_from_slice(&bytes);
            Ok(out)
        })
    }

    pub fn detect(&self, key: &str, w: u32, h: u32, gray: &[u8]) -> Result<Value, String> {
        if gray.len() != (w as usize) * (h as usize) {
            return Err(format!("image is {} bytes, expected {}x{}", gray.len(), w, h));
        }
        self.with(key, |p| p.request(json!({"cmd": "detect", "w": w, "h": h}), gray).map(|r| r.0))
    }

    pub fn close_all(&self) {
        if let Ok(mut m) = self.0.lock() {
            m.clear();
        }
    }
}
