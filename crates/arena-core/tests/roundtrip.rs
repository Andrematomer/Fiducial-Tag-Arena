// Needs the self-test detector. CI and the docs build it first and point ARENA_TEST_EXE at it:
//   cargo build --manifest-path detectors-src/selftest/Cargo.toml
//   ARENA_TEST_EXE=<path to arena-selftest[.exe]> cargo test --manifest-path crates/arena-core/Cargo.toml
use arena_core::{list_manifests_in, Registry};
use std::path::PathBuf;

fn setup() -> Option<(PathBuf, Registry)> {
    let exe = PathBuf::from(std::env::var_os("ARENA_TEST_EXE")?);
    let root = std::env::temp_dir().join(format!("arena-core-test-{}", std::process::id()));
    let dir = root.join("selftest");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("detector.json"),
        format!(
            r#"{{"key":"selftest","name":"Self-test","exe":{:?},"idCount":256}}"#,
            exe.to_string_lossy()
        ),
    )
    .unwrap();
    std::env::set_var("ARENA_DETECTORS", &root);
    Some((root, Registry::default()))
}

#[test]
fn discovery_and_roundtrip() {
    let Some((root, reg)) = setup() else {
        eprintln!("ARENA_TEST_EXE not set; skipping");
        return;
    };
    let found = list_manifests_in(&[root.clone()]);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].key, "selftest");

    let hello = reg.open("selftest").expect("hello");
    assert_eq!(hello["idCount"], 256);

    for id in [0u32, 1, 77, 200, 255] {
        let g = reg.generate("selftest", id, 256).expect("generate");
        let frac = f64::from_le_bytes(g[..8].try_into().unwrap());
        assert!((frac - 0.8).abs() < 1e-9);
        let det = reg.detect("selftest", 256, 256, &g[8..]).expect("detect");
        assert!(det["ms"].as_f64().unwrap() >= 0.0);
        let dets = det["dets"].as_array().unwrap();
        assert_eq!(dets.len(), 1, "id {id}");
        assert_eq!(dets[0]["id"], id, "decoded id");
        let c = dets[0]["corners"].as_array().unwrap();
        assert_eq!(c.len(), 4);
    }

    // wrong image size must be rejected before reaching the detector
    assert!(reg.detect("selftest", 10, 10, &[0u8; 5]).is_err());
    // unknown detector
    assert!(reg.open("nope").is_err());
    reg.close_all();
    let _ = std::fs::remove_dir_all(root);
}
