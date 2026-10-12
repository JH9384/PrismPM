use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, process::Command};

struct Subjects(PathBuf);
impl Subjects {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let serial = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("prismpm-oscal-cli-{}-{serial}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn run(&self, bytes: &[u8]) -> std::process::Output {
        let path = self.0.join("subject.json");
        fs::write(&path, bytes).unwrap();
        Command::new(env!("CARGO_BIN_EXE_prismpm-oscal-oracle"))
            .arg(path)
            .output()
            .unwrap()
    }
}
impl Drop for Subjects {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn real_cli_binds_subject_bytes_and_distinguishes_resource_refusal() {
    let subjects = Subjects::new();
    let cases: Value = serde_json::from_slice(include_bytes!("../local-subjects.json")).unwrap();
    assert_eq!(cases["positives"].as_array().unwrap().len(), 7);
    for value in cases["positives"].as_array().unwrap() {
        let bytes = serde_json::to_vec(value).unwrap();
        let result = subjects.run(&bytes);
        assert_eq!(
            result.status.code(),
            Some(0),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let report: Value = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(
            report["subject"]["sha256"],
            format!("{:x}", Sha256::digest(&bytes))
        );
        assert_eq!(report["subject"]["bytes"], bytes.len());
        assert_eq!(
            report["model"],
            value.as_object().unwrap().keys().next().unwrap().as_str()
        );
        assert_eq!(report["edition"], "1.1.0");
        assert_eq!(report["scope"], "json-structural-validation-only");
        assert_eq!(report["complete_standard_acceptance"], false);
    }
    for bytes in [b"{}".as_slice(), b"{\"x\":1,\"x\":2}", &[0xc0, 0xaf]] {
        let result = subjects.run(bytes);
        assert_eq!(result.status.code(), Some(4));
        assert!(result.stdout.is_empty());
    }
    let resource = subjects.run(b"1e1000001");
    assert_eq!(resource.status.code(), Some(5));
    assert!(resource.stdout.is_empty());
    assert!(String::from_utf8_lossy(&resource.stderr).contains("resource-refusal:"));
    let path = subjects.0.join("oversized.json");
    fs::File::create(&path)
        .unwrap()
        .set_len(67_108_865)
        .unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_prismpm-oscal-oracle"))
        .arg(&path)
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(5));
    assert!(result.stdout.is_empty());
}

#[test]
fn real_cli_preserves_full_valid_byte_boundary_and_refuses_resource_excess() {
    let subjects = Subjects::new();
    let cases: Value = serde_json::from_slice(include_bytes!("../local-subjects.json")).unwrap();
    let mut value = cases["positives"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value.get("catalog").is_some())
        .unwrap()
        .clone();
    value["catalog"]["metadata"]["title"] = Value::String(String::new());
    let overhead = serde_json::to_vec(&value).unwrap().len();
    value["catalog"]["metadata"]["title"] = Value::String("x".repeat(67_108_864 - overhead));
    let bytes = serde_json::to_vec(&value).unwrap();
    assert_eq!(bytes.len(), 67_108_864);
    let result = subjects.run(&bytes);
    assert_eq!(
        result.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let report: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(
        report["subject"]["sha256"],
        format!("{:x}", Sha256::digest(&bytes))
    );
    assert_eq!(report["subject"]["bytes"], bytes.len());
    assert_eq!(report["model"], "catalog");
    assert_eq!(report["complete_standard_acceptance"], false);
    let mut excess = bytes;
    excess.push(b' ');
    let result = subjects.run(&excess);
    assert_eq!(result.status.code(), Some(5));
    assert!(result.stdout.is_empty());

    let deep = format!("{}0{}", "[".repeat(129), "]".repeat(129));
    let result = subjects.run(deep.as_bytes());
    assert_eq!(result.status.code(), Some(5));
    assert!(result.stdout.is_empty());
    let missing = Command::new(env!("CARGO_BIN_EXE_prismpm-oscal-oracle"))
        .output()
        .unwrap();
    assert_eq!(missing.status.code(), Some(2));
    assert!(missing.stdout.is_empty());
}
