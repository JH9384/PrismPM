//! Closed resource-bearing text profile contracts, distinct from text/1.

use prismpm::contracts::CanonicalDocument;
use serde_json::{json, Value};

#[test]
fn text_v2_resource_bounds_oracle_uses_the_modeled_allocation_boundary() {
    let source = include_str!("../../../tests/hologram-oracle/src/main.rs");
    let boundary = source
        .split_once("fn allocation_boundary(")
        .unwrap()
        .1
        .split_once("#[tokio::main]")
        .unwrap()
        .0;
    let harness = format!(
        "fn allocation_boundary({boundary}\n{}",
        r#"
#[test]
fn explicit_text_boundary_and_legacy_response_are_distinct() {
    let empty = (Vec::new(), b"malformed-request".to_vec());
    let capped = (b"abcd".to_vec(), b"request-too-large".to_vec());
    let vectors = vec![empty.clone(), capped.clone()];
    for profile in ["prismpm/text-application/1", "prismpm/text-application/2"] {
        assert_eq!(allocation_boundary(Some(profile), 4, &vectors).unwrap(), capped);
        assert!(allocation_boundary(Some(profile), 4, &[empty.clone()]).is_err());
    }
    assert_eq!(allocation_boundary(None, 4, &vectors).unwrap(),
        (b"xxxx".to_vec(), empty.1));
}
"#
    );
    let stage = tempfile::tempdir().unwrap();
    let source = stage.path().join("boundary.rs");
    let binary = stage.path().join("boundary-test");
    std::fs::write(&source, harness).unwrap();
    let compile = std::process::Command::new("rustc")
        .args(["--test", "--edition=2021"])
        .arg(&source)
        .arg("-o")
        .arg(&binary)
        .output()
        .unwrap();
    assert!(
        compile.status.success(),
        "{}",
        String::from_utf8_lossy(&compile.stderr)
    );
    let result = std::process::Command::new(binary).output().unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}

fn fixture() -> Value {
    let mut value: Value = serde_json::from_slice(include_bytes!(
        "../../../tests/data/text-model-document.json"
    ))
    .unwrap();
    value["schema"] = json!("prismpm/model-document/5");
    value["application"]["profile"] = json!("prismpm/text-application/2");
    value["application"]["core_memory_pages"] = json!(64);
    value["application"]["core_stack_bytes"] = json!(131072);
    value
}

#[test]
fn text_v2_resource_bounds_contract_accepts_only_closed_v2_shape() {
    let value = fixture();
    CanonicalDocument::from_value("prismpm/model-document/5", value.clone()).unwrap();
    let schema: Value = serde_json::from_slice(include_bytes!(
        "../../../schemas/model-document-v5.schema.json"
    ))
    .unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    assert!(validator.is_valid(&value));
    for name in ["core_memory_pages", "core_stack_bytes"] {
        let mut missing = value.clone();
        missing["application"].as_object_mut().unwrap().remove(name);
        assert!(!validator.is_valid(&missing));
        assert!(CanonicalDocument::from_value("prismpm/model-document/5", missing).is_err());
    }
    for pointer in ["", "/application"] {
        let mut unknown = value.clone();
        unknown
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unknown_resource".to_owned(), json!(1));
        assert!(!validator.is_valid(&unknown));
        assert!(CanonicalDocument::from_value("prismpm/model-document/5", unknown).is_err());
    }
}

#[test]
fn text_v2_resource_bounds_contract_rejects_invalid_budget_and_profile_substitution() {
    for (pointer, replacement) in [
        ("/application/core_memory_pages", json!(0)),
        ("/application/core_memory_pages", json!(32768)),
        ("/application/core_memory_pages", json!(-1)),
        ("/application/core_memory_pages", json!(1.5)),
        ("/application/core_memory_pages", json!("64")),
        ("/application/core_memory_pages", Value::Null),
        ("/application/core_stack_bytes", json!(0)),
        ("/application/core_stack_bytes", json!(17)),
        ("/application/core_stack_bytes", json!(4294967296_u64)),
        ("/application/core_stack_bytes", json!("131072")),
        ("/application/core_stack_bytes", Value::Null),
        ("/application/core_stack_bytes", json!(64 * 65536)),
        (
            "/application/guest_allocation_maximum",
            json!(64 * 65536 + 1),
        ),
        ("/application/response_maximum", json!(64 * 65536 + 1)),
        ("/schema", json!("prismpm/model-document/2")),
        ("/application/profile", json!("prismpm/text-application/1")),
    ] {
        let mut value = fixture();
        *value.pointer_mut(pointer).unwrap() = replacement;
        assert!(
            CanonicalDocument::from_value("prismpm/model-document/5", value).is_err(),
            "substituted or invalid text/2 field {pointer}"
        );
    }
    let legacy: Value = serde_json::from_slice(include_bytes!(
        "../../../tests/data/text-model-document.json"
    ))
    .unwrap();
    CanonicalDocument::from_value("prismpm/model-document/2", legacy.clone()).unwrap();
    let mut injected = legacy.clone();
    injected["application"]["core_memory_pages"] = json!(64);
    injected["application"]["core_stack_bytes"] = json!(131072);
    assert!(CanonicalDocument::from_value("prismpm/model-document/2", injected).is_err());
    assert!(CanonicalDocument::from_value("prismpm/model-document/5", legacy).is_err());
}
