//! Thin Tauri glue. All detector logic lives in the `arena-core` crate.
use arena_core::{list_manifests, Manifest, Registry};
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, State};

#[tauri::command]
async fn list_detectors() -> Vec<Manifest> {
    list_manifests()
}

#[tauri::command]
async fn detector_open(key: String, reg: State<'_, Registry>) -> Result<Value, String> {
    reg.open(&key)
}

/// Response body: [f64 outerFrac, little-endian][size*size gray bytes]
#[tauri::command]
async fn detector_generate(key: String, id: u32, size: u32, reg: State<'_, Registry>) -> Result<Response, String> {
    reg.generate(&key, id, size).map(Response::new)
}

/// Request: raw gray image bytes as the body, with headers `key`, `w`, `h`.
#[tauri::command]
async fn detector_detect(request: Request<'_>, reg: State<'_, Registry>) -> Result<Value, String> {
    let header = |name: &str| -> Result<String, String> {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
            .ok_or_else(|| format!("missing header '{name}'"))
    };
    let key = header("key")?;
    let w: u32 = header("w")?.parse().map_err(|_| "bad width")?;
    let h: u32 = header("h")?.parse().map_err(|_| "bad height")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw image body".into());
    };
    reg.detect(&key, w, h, bytes)
}

pub fn run() {
    tauri::Builder::default()
        .manage(Registry::default())
        .invoke_handler(tauri::generate_handler![list_detectors, detector_open, detector_generate, detector_detect])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(reg) = window.try_state::<Registry>() {
                    reg.close_all();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Fiducial Tag Arena");
}
