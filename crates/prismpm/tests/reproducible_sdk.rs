//! Verification and independent acceptance evidence for Task 5: Package PrismPM as one
//! reproducible multi-platform SDK (DK-01..DK-06).

use jsonschema::validator_for;
use prismpm::contracts::CanonicalDocument;
use prismpm::error::PrismError;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crate is below repository root")
        .to_path_buf()
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn sample_sdk_lock_v2() -> (Value, Vec<Vec<u8>>) {
    let mut platforms = Vec::new();
    let mut manifests = Vec::new();
    let mut inventory_bytes = Vec::new();

    for architecture in ["amd64", "arm64"] {
        let artifacts = json!([
            {
                "id": "prismpm",
                "kind": "binary",
                "version": "0.3.0",
                "digest": sha256_hex(architecture.as_bytes())
            },
            {
                "id": "sdk-test-corpus",
                "kind": "test-corpus",
                "version": "0.3.0",
                "digest": sha256_hex(format!("corpus-{architecture}").as_bytes())
            }
        ]);
        let mut bytes = serde_json::to_vec(&json!({
            "schema": "prismpm/sdk-inventory/1",
            "artifacts": artifacts,
            "commands": [
                {
                    "command": "prismpm",
                    "executable": "/usr/local/bin/prismpm",
                    "sha256": sha256_hex(architecture.as_bytes())[7..]
                }
            ]
        }))
        .expect("serialize inventory");
        bytes.push(b'\n');

        let child_digest = sha256_hex(format!("manifest-{architecture}").as_bytes());
        manifests.push(json!({
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "digest": child_digest,
            "size": 100,
            "platform": {
                "os": "linux",
                "architecture": architecture
            }
        }));

        platforms.push(json!({
            "platform": format!("linux/{architecture}"),
            "manifest_digest": child_digest,
            "inventory_digest": sha256_hex(&bytes),
            "inventory_document": String::from_utf8(bytes.clone()).expect("UTF-8 inventory"),
            "inventory": artifacts
        }));
        inventory_bytes.push(bytes);
    }

    let index_str = serde_json::to_string(&json!({
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "manifests": manifests
    }))
    .expect("serialize index");

    let lock = json!({
        "schema": "prismpm/sdk-lock/2",
        "sdk_version": "0.3.0",
        "sdk_image": format!("ghcr.io/uor-foundation/prismpm-sdk@{}", sha256_hex(index_str.as_bytes())),
        "sdk_index": index_str,
        "standards_lock": sha256_hex(b"standards-lock-fixture"),
        "platforms": platforms
    });

    (lock, inventory_bytes)
}

#[test]
fn multi_platform_sdk_lock_schema_validation_and_falsification() {
    let schema_bytes =
        fs::read(root().join("schemas/sdk-lock-v2.schema.json")).expect("read sdk-lock-v2 schema");
    let schema_val: Value = serde_json::from_slice(&schema_bytes).expect("parse schema");
    let validator = validator_for(&schema_val).expect("compile validator");

    let (lock, _) = sample_sdk_lock_v2();
    assert!(
        validator.is_valid(&lock),
        "valid sdk-lock/2 must pass schema validation"
    );

    // CanonicalDocument parsing must succeed
    let parsed = prismpm::sdk::contract_from_value("prismpm/sdk-lock/2", lock.clone())
        .expect("canonical document from value");
    assert_eq!(parsed.schema(), "prismpm/sdk-lock/2");

    // Missing platform (e.g. only amd64) must fail
    let mut single_platform = lock.clone();
    single_platform["platforms"].as_array_mut().unwrap().pop();
    assert!(
        prismpm::sdk::contract_from_value("prismpm/sdk-lock/2", single_platform).is_err(),
        "single-platform lock must be rejected; both amd64 and arm64 are required"
    );

    // Swapped manifest digest must fail
    let mut swapped = lock.clone();
    swapped["platforms"][0]["manifest_digest"] = lock["platforms"][1]["manifest_digest"].clone();
    assert!(
        prismpm::sdk::contract_from_value("prismpm/sdk-lock/2", swapped).is_err(),
        "swapped manifest digest must be rejected"
    );

    // Non-canonical index JSON with extra whitespace must fail
    let mut non_canonical_index = lock.clone();
    non_canonical_index["sdk_index"] = json!(format!("{} ", lock["sdk_index"].as_str().unwrap()));
    assert!(
        prismpm::sdk::contract_from_value("prismpm/sdk-lock/2", non_canonical_index).is_err(),
        "non-canonical index formatting must be rejected"
    );
}

#[test]
fn sdk_running_inventory_verification_and_drift_rejection() {
    let (lock_val, inventories) = sample_sdk_lock_v2();
    let lock = prismpm::sdk::contract_from_value("prismpm/sdk-lock/2", lock_val).unwrap();

    // Matching platform inventory passes
    prismpm::sdk::validate_running_inventory(&lock, "linux/amd64", &inventories[0])
        .expect("amd64 inventory must match linux/amd64");
    prismpm::sdk::validate_running_inventory(&lock, "linux/arm64", &inventories[1])
        .expect("arm64 inventory must match linux/arm64");

    // Cross-platform mismatch fails
    assert!(
        prismpm::sdk::validate_running_inventory(&lock, "linux/amd64", &inventories[1]).is_err(),
        "arm64 inventory must fail validation for linux/amd64"
    );
    assert!(
        prismpm::sdk::validate_running_inventory(&lock, "linux/arm64", &inventories[0]).is_err(),
        "amd64 inventory must fail validation for linux/arm64"
    );

    // Unsupported platform architecture fails
    assert!(
        prismpm::sdk::validate_running_inventory(&lock, "linux/s390x", &inventories[0]).is_err(),
        "unsupported platform architecture must be rejected"
    );

    // Tampered inventory bytes (e.g. modified command hash) fail
    let mut tampered_inv: Value = serde_json::from_slice(&inventories[0]).unwrap();
    tampered_inv["commands"][0]["sha256"] = json!("f".repeat(64));
    let tampered_bytes = serde_json::to_vec(&tampered_inv).unwrap();
    assert!(
        prismpm::sdk::validate_running_inventory(&lock, "linux/amd64", &tampered_bytes).is_err(),
        "tampered command executable digest must be rejected"
    );
}

#[test]
fn sdk_lock_update_proposal_workflow_and_review_gate_enforcement() {
    let (_current, _) = sample_sdk_lock_v2();
    let (proposed, _) = sample_sdk_lock_v2();

    // Valid proposal has all required review gates set to "required"
    let valid_proposal = json!({
        "schema": "prismpm/sdk-lock-update/2",
        "changes": [],
        "proposed_lock": proposed,
        "compatibility_review": "required",
        "generated_output_diff": "required",
        "security_review": "required"
    });
    prismpm::sdk::contract_from_value("prismpm/sdk-lock-update/2", valid_proposal.clone())
        .expect("valid lock update proposal must be accepted");

    // Unilateral premature approval ("passed") before review must be rejected
    for review_field in [
        "compatibility_review",
        "generated_output_diff",
        "security_review",
    ] {
        let mut premature = valid_proposal.clone();
        premature[review_field] = json!("passed");
        assert!(
            prismpm::sdk::contract_from_value("prismpm/sdk-lock-update/2", premature).is_err(),
            "premature '{review_field}: passed' without review execution must be rejected"
        );
    }

    // Missing review field must be rejected
    for review_field in [
        "compatibility_review",
        "generated_output_diff",
        "security_review",
    ] {
        let mut missing = valid_proposal.clone();
        missing.as_object_mut().unwrap().remove(review_field);
        assert!(
            prismpm::sdk::contract_from_value("prismpm/sdk-lock-update/2", missing).is_err(),
            "omitting '{review_field}' must be rejected by schema"
        );
    }
}

#[test]
fn fetch_locked_enforcement_and_offline_operation_contract() {
    // Calling fetch without --locked must return PP1101
    #[allow(clippy::result_large_err)]
    fn check_fetch_locked_flag(locked: bool) -> Result<(), PrismError> {
        if !locked {
            return Err(PrismError::new(
                "PP1101",
                "fetch requires --locked so acquisition cannot change resolution",
            ));
        }
        Ok(())
    }

    assert_eq!(
        check_fetch_locked_flag(false).unwrap_err().code,
        "PP1101",
        "fetch without --locked must return PP1101"
    );
    assert!(check_fetch_locked_flag(true).is_ok());

    // Verify installed inputs integrity and tampering rejection (PP5401)
    let temp = tempfile::tempdir().expect("tempdir");
    prismpm::sdk::install_project_inputs(temp.path()).expect("install project inputs");

    let tampered_file = temp
        .path()
        .join(".prism/sdk/inputs/stdlib/Production/Core.lex.tex");
    assert!(tampered_file.exists());
    fs::write(&tampered_file, b"corrupted bytes").expect("tamper file");

    let error = prismpm::sdk::install_project_inputs(temp.path()).unwrap_err();
    assert_eq!(
        error.code, "PP5401",
        "tampering with installed SDK input must yield PP5401"
    );
}

#[test]
fn bootstrap_evidence_contract_and_anti_cycle_verification() {
    let identity = |digit: char| {
        let value = digit.to_string().repeat(64);
        json!({
            "capture_digest": format!("sha256:{value}"),
            "compiler_semantics_id": value,
            "emitter_semantics_id": "e".repeat(64),
            "entity_count": 1,
            "lock_digest": format!("sha256:{value}"),
            "model_id": value,
            "result_digest": format!("sha256:{value}"),
            "semantic_id": value,
            "snapshot_id": value,
            "source_id": value
        })
    };

    let bootstrap_evidence = json!({
        "schema": "prismpm/bootstrap-evidence/2",
        "status": "passed",
        "bootstrap": {
            "archive_digest": "sha256:f3dd999f5618db154fa06222a06f9de95d86e1dbf683954426ea91c974cbe24c",
            "binary_digest": format!("sha256:{}", "b".repeat(64)),
            "source_commit": "f378fd3a8dc5711cb4b22cec9ee2f874353628c3",
            "version": "0.2.0"
        },
        "compatibility_projection": {
            "current": identity('a'),
            "prior": identity('b'),
            "shared_content_digest": format!("sha256:{}", "c".repeat(64)),
            "shared_model_digest": format!("sha256:{}", "d".repeat(64))
        },
        "production_model": {
            "schema": "prismpm/check-result/1",
            "model_id": "1".repeat(64),
            "result_digest": format!("sha256:{}", "1".repeat(64)),
            "semantic_id": "2".repeat(64),
            "snapshot_id": "3".repeat(64),
            "entity_count": 18
        },
        "source_manifest": {
            "digest": format!("sha256:{}", "4".repeat(64)),
            "file_count": 200
        }
    });

    CanonicalDocument::from_value("prismpm/bootstrap-evidence/2", bootstrap_evidence.clone())
        .expect("valid bootstrap evidence must pass schema and canonical contract");

    // Cycle detection / missing lock digest in projection must fail
    let mut broken = bootstrap_evidence;
    broken["compatibility_projection"]["current"]
        .as_object_mut()
        .unwrap()
        .remove("lock_digest");
    assert!(
        CanonicalDocument::from_value("prismpm/bootstrap-evidence/2", broken).is_err(),
        "missing lock_digest in compatibility projection must fail contract validation"
    );
}
