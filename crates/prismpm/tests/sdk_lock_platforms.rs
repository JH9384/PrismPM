//! DK-01/DK-06: multi-platform locks bind distinct native inventories, not a
//! fabricated cross-architecture equality. These are synthetic test fixtures.
use prismpm::contracts::CanonicalDocument;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn sha(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn fixture() -> (Value, Vec<Vec<u8>>) {
    let mut inventories = Vec::new();
    let mut platforms = Vec::new();
    let mut manifests = Vec::new();
    for architecture in ["amd64", "arm64"] {
        let artifacts = json!([{"id":"prismpm", "kind":"binary", "version":"0.3.0",
            "digest":sha(architecture.as_bytes())}]);
        let mut bytes = serde_json::to_vec(&json!({"schema":"prismpm/sdk-inventory/1",
            "commands":[{"command":"prismpm", "executable":"/usr/local/bin/prismpm",
            "sha256":sha(architecture.as_bytes())[7..]}], "artifacts":artifacts}))
        .unwrap();
        bytes.push(b'\n');
        let manifest_digest = sha(format!("test manifest {architecture}").as_bytes());
        manifests.push(
            json!({"mediaType":"application/vnd.oci.image.manifest.v1+json",
            "digest":manifest_digest, "size":100,
            "platform":{"os":"linux", "architecture":architecture}}),
        );
        platforms.push(json!({"platform":format!("linux/{architecture}"),
            "manifest_digest":manifest_digest, "inventory_digest":sha(&bytes), "inventory_document":String::from_utf8(bytes.clone()).unwrap(),
            "inventory":artifacts}));
        inventories.push(bytes);
    }
    let index = serde_json::to_string(&json!({"schemaVersion":2,
        "mediaType":"application/vnd.oci.image.index.v1+json", "manifests":manifests}))
    .unwrap();
    (
        json!({"schema":"prismpm/sdk-lock/2", "sdk_version":"0.3.0",
        "sdk_image":format!("ghcr.io/uor-foundation/prismpm-sdk-candidate@{}", sha(index.as_bytes())),
        "sdk_index":index, "standards_lock":sha(b"test standards"), "platforms":platforms}),
        inventories,
    )
}

#[test]
fn aggregate_contracts_admit_bounded_documents_and_reject_oversized_envelopes() {
    fn large_lock(padding: char) -> Value {
        let (mut lock, _) = fixture();
        for row in lock["platforms"].as_array_mut().unwrap() {
            let mut document: Value =
                serde_json::from_str(row["inventory_document"].as_str().unwrap()).unwrap();
            // Synthetic parser evidence, not an executable filesystem claim.
            document["commands"][0]["executable"] =
                json!(format!("/{}", padding.to_string().repeat(7 * 1024 * 1024)));
            let bytes = serde_json::to_vec(&document).unwrap();
            assert!(bytes.len() < 8 * 1024 * 1024);
            row["inventory_digest"] = json!(sha(&bytes));
            row["inventory_document"] = json!(String::from_utf8(bytes).unwrap());
        }
        lock
    }
    let current = large_lock('a');
    let proposed = large_lock('b');
    let lock_bytes = serde_json::to_vec(&proposed).unwrap();
    assert!(lock_bytes.len() > 8 * 1024 * 1024);
    prismpm::sdk::parse_lock(&lock_bytes).unwrap();
    let proposal = json!({"schema":"prismpm/sdk-lock-update/2",
        "changes":[{"op":"replace", "path":"/platforms", "from":current["platforms"], "to":proposed["platforms"]}],
        "proposed_lock":proposed, "compatibility_review":"required",
        "generated_output_diff":"required", "security_review":"required"});
    let proposal_bytes = serde_json::to_vec(&proposal).unwrap();
    assert!(proposal_bytes.len() > 32 * 1024 * 1024);
    prismpm::sdk::parse_contract("prismpm/sdk-lock-update/2", &proposal_bytes).unwrap();

    for (schema, maximum) in [
        ("prismpm/sdk-lock/2", 64 * 1024 * 1024),
        ("prismpm/sdk-lock-update/2", 192 * 1024 * 1024),
    ] {
        let oversized = vec![b' '; maximum + 1];
        let error = prismpm::sdk::parse_contract(schema, &oversized).unwrap_err();
        assert_eq!(error.code, "PP7601");
        assert!(error.message.contains(&format!("{maximum} byte limit")));
    }
}

#[test]
fn registered_platform_lock_accepts_exact_index_and_rejects_missing_or_swapped_children() {
    let (lock, _) = fixture();
    prismpm::sdk::contract_from_value("prismpm/sdk-lock/2", lock.clone()).unwrap();
    for mutation in 0..5 {
        let mut changed = lock.clone();
        match mutation {
            0 => {
                changed["platforms"].as_array_mut().unwrap().pop();
            }
            1 => {
                changed["platforms"][0]["manifest_digest"] =
                    lock["platforms"][1]["manifest_digest"].clone();
            }
            2 => {
                changed["platforms"][0]["platform"] = json!("linux/arm64");
            }
            3 => {
                changed["sdk_index"] = json!(format!("{} ", lock["sdk_index"].as_str().unwrap()));
            }
            _ => {
                changed["platforms"][0]["inventory"][0]["id"] = json!("another-tool");
            }
        }
        assert!(
            prismpm::sdk::contract_from_value("prismpm/sdk-lock/2", changed).is_err(),
            "mutation {mutation}"
        );
    }
}

#[test]
fn current_platform_requires_its_actual_bytes_not_another_architecture_or_a_partial_inventory() {
    let (value, inventories) = fixture();
    let lock = prismpm::sdk::contract_from_value("prismpm/sdk-lock/2", value).unwrap();
    for (index, platform) in ["linux/amd64", "linux/arm64"].into_iter().enumerate() {
        prismpm::sdk::validate_running_inventory(&lock, platform, &inventories[index]).unwrap();
        assert!(
            prismpm::sdk::validate_running_inventory(&lock, platform, &inventories[1 - index])
                .is_err()
        );
        let mut inventory: Value = serde_json::from_slice(&inventories[index]).unwrap();
        inventory["artifacts"] = json!([]);
        assert!(prismpm::sdk::validate_running_inventory(
            &lock,
            platform,
            &serde_json::to_vec(&inventory).unwrap()
        )
        .is_err());
    }
    assert!(
        prismpm::sdk::validate_running_inventory(&lock, "linux/riscv64", &inventories[0]).is_err()
    );
}

#[test]
fn legacy_lock_keeps_exact_native_artifact_comparison() {
    let (value, inventories) = fixture();
    let mut inventory = value["platforms"][0]["inventory"]
        .as_array()
        .unwrap()
        .clone();
    inventory.push(json!({"id":"sdk-manifest", "kind":"image", "version":"0.3.0", "digest":sha(b"legacy test image")}));
    let legacy = CanonicalDocument::from_value(
        "prismpm/sdk-lock/1",
        json!({
        "schema":"prismpm/sdk-lock/1", "sdk_version":"0.3.0", "inventory":inventory,
        "sdk_image":format!("ghcr.io/uor-foundation/prismpm-sdk@{}",sha(b"legacy test image")),
        "standards_lock":sha(b"test standards")}),
    )
    .unwrap();
    prismpm::sdk::validate_running_inventory(&legacy, "linux/amd64", &inventories[0]).unwrap();
    assert!(
        prismpm::sdk::validate_running_inventory(&legacy, "linux/arm64", &inventories[1]).is_err()
    );
}

#[test]
fn every_platform_inventory_document_binds_its_digest_and_complete_rows() {
    let (value, inventories) = fixture();
    for index in [0, 1] {
        assert_eq!(
            value["platforms"][index]["inventory_document"]
                .as_str()
                .unwrap()
                .as_bytes(),
            inventories[index]
        );
        for mutation in 0..8 {
            let mut changed = value.clone();
            let row = &mut changed["platforms"][index];
            match mutation {
                0 => row["inventory"][0]["digest"] = json!(sha(b"forged non-native artifact")),
                1 => {
                    row["inventory_document"] =
                        value["platforms"][1 - index]["inventory_document"].clone()
                }
                2 => row["inventory_digest"] = json!(sha(b"forged inventory")),
                3 => {
                    row.as_object_mut().unwrap().remove("inventory_document");
                }
                4 => {
                    row["inventory_document"] =
                        json!(format!("{} ", row["inventory_document"].as_str().unwrap()))
                }
                _ => {
                    let mut document: Value =
                        serde_json::from_str(row["inventory_document"].as_str().unwrap()).unwrap();
                    match mutation {
                        5 => document["unexpected"] = json!(true),
                        6 => document["commands"][0]["sha256"] = json!("not-a-digest"),
                        _ => document["commands"][0]["unexpected"] = json!(true),
                    }
                    let bytes = serde_json::to_vec(&document).unwrap();
                    row["inventory_digest"] = json!(sha(&bytes));
                    row["inventory_document"] = json!(String::from_utf8(bytes).unwrap());
                }
            }
            assert!(
                prismpm::sdk::contract_from_value("prismpm/sdk-lock/2", changed).is_err(),
                "platform {index}, mutation {mutation}"
            );
        }
    }
}
