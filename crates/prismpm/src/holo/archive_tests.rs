use super::*;
use serde_json::{json, Value};

fn bytes(hex: &str) -> Vec<u8> {
    assert!(hex.len().is_multiple_of(2));
    (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).unwrap())
        .collect()
}

fn oracle() -> Value {
    serde_json::from_str(include_str!("../../tests/data/holo-codec-v1.json")).unwrap()
}

fn hex_field(value: &Value, name: &str) -> Vec<u8> {
    bytes(value[name].as_str().unwrap())
}

fn seal(body: Vec<u8>) -> Vec<u8> {
    let footer = blake3::hash(&body).as_bytes().to_vec();
    modeled(wire::frameArchive(body, footer)).unwrap().unwrap()
}

// Test-only mutation: deliberately reseal malformed physical bytes so the
// strict modeled parser, not just the footer digest, must reject them.
fn reseal(bytes: &mut [u8]) {
    let footer = bytes.len() - 32;
    let digest = blake3::hash(&bytes[..footer]);
    bytes[footer..].copy_from_slice(digest.as_bytes());
}

#[test]
fn modeled_wire_matches_independent_frozen_upstream_bytes() {
    let fixture = oracle();
    for label in fixture["labels"].as_array().unwrap() {
        assert_eq!(
            v4_label(&hex_field(label, "bytes_hex")),
            label["kappa"].as_str().unwrap()
        );
    }
    let capabilities = wire::emptyCapabilities();
    assert_eq!(
        capabilities,
        hex_field(&fixture["empty_capabilities"], "bytes_hex")
    );
    assert_eq!(
        v4_label(&capabilities),
        fixture["empty_capabilities"]["kappa"].as_str().unwrap()
    );
    let refs = fixture["manifest"]["references"].as_array().unwrap();
    let manifest = wire::appManifest(
        refs[0].as_str().unwrap().as_bytes().to_vec(),
        refs[1].as_str().unwrap().as_bytes().to_vec(),
        refs[2].as_str().unwrap().as_bytes().to_vec(),
    )
    .unwrap();
    assert_eq!(manifest, hex_field(&fixture["manifest"], "bytes_hex"));
    assert_eq!(
        v4_label(&manifest),
        fixture["manifest"]["kappa"].as_str().unwrap()
    );
    let inputs = &fixture["archive_inputs"];
    let blobs = inputs["blobs_hex"].as_array().unwrap();
    let body = modeled(wire::archiveBody(
        manifest.clone(),
        hex_field(inputs, "metadata_hex"),
        hex_field(inputs, "directory_json_hex"),
        hex_field(inputs, "provenance_json_hex"),
        bytes(blobs[0].as_str().unwrap()),
        bytes(blobs[1].as_str().unwrap()),
        bytes(blobs[2].as_str().unwrap()),
        bytes(blobs[3].as_str().unwrap()),
    ))
    .unwrap()
    .unwrap();
    assert_eq!(body, hex_field(&fixture["archive"], "body_hex"));
    let archive = seal(body);
    assert_eq!(archive, hex_field(&fixture["archive"], "bytes_hex"));
    assert_eq!(
        v4_label(&archive),
        fixture["archive"]["kappa"].as_str().unwrap()
    );
    let decoded = decode_wire_archive(&archive).unwrap();
    assert_eq!(decoded.manifest, manifest);
    assert_eq!(decoded.directory, hex_field(inputs, "directory_json_hex"));
    assert_eq!(
        decoded.prism_extension,
        hex_field(inputs, "provenance_json_hex")
    );
    assert_eq!(decoded.blobs.len(), 4);
    assert_eq!(
        decoded.fingerprint,
        fixture["archive"]["footer_hex"].as_str().unwrap()
    );
    // Deliberately synthetic wire vectors are not an accepted application.
    assert!(validate_application(&archive).is_err());
}

#[test]
fn strict_wire_rejects_resealed_oracle_frame_mutations() {
    let fixture = oracle();
    for mutation in fixture["malformed_archives"].as_array().unwrap() {
        assert!(
            decode_wire_archive(&hex_field(mutation, "bytes_hex")).is_err(),
            "accepted {}",
            mutation["name"]
        );
    }
    let archive = hex_field(&fixture["archive"], "bytes_hex");
    // Every table row's reserved bytes are constrained, not only row zero.
    for index in 0..8 {
        let mut changed = archive.clone();
        changed[17 + 24 * index] = 1;
        reseal(&mut changed);
        assert!(decode_wire_archive(&changed).is_err());
    }
    let sections = fixture["archive"]["sections"].as_array().unwrap();
    let start = |index: usize| sections[index]["offset"].as_u64().unwrap() as usize;
    for (offset, value) in [
        (8, 255),           // A hostile declared count cannot trigger an unbounded table allocation.
        (start(0) + 53, 4), // Manifest reference count.
        (start(0) + 57, b'B'), // Noncanonical label prefix.
        (start(0) + 270, 81), // Manifest payload length.
        (start(0) + 274, 1), // Primary layer.
        (start(2), 0),      // Directory extension key length.
        (start(3) + 2, b'x'), // Provenance extension identity.
        (start(4) + 7, b'A'), // Uppercase blob digest.
        (archive.len() - 33, 1), // Required capability payload must stay empty.
    ] {
        let mut changed = archive.clone();
        changed[offset] = value;
        reseal(&mut changed);
        assert!(
            decode_wire_archive(&changed).is_err(),
            "accepted mutation at {offset}"
        );
    }
    let mut changed_content = archive.clone();
    changed_content[start(4) + 71] ^= 1;
    reseal(&mut changed_content);
    assert!(modeled(wire::validArchiveFrame(&changed_content)).unwrap());
    assert_eq!(
        decode_wire_archive(&changed_content).err().unwrap().code,
        "PP3008"
    );
    for length in [0, 3, 9, 201, archive.len() - 1] {
        assert!(decode_wire_archive(&archive[..length]).is_err());
    }
}

fn application_input() -> ApplicationArchiveInput {
    let digest = "0".repeat(64);
    let revision = "0".repeat(40);
    ApplicationArchiveInput {
        application_name: "Wire fixture".to_owned(),
        guest_wasm: b"\0asm\x01\0\0\0".to_vec(),
        view_bundle: b"HOLOVIEW\0\x01".to_vec(),
        model_document: br#"{"fixture":"wire-only"}"#.to_vec(),
        source_manifest: br#"{"version":4}"#.to_vec(),
        provenance: ArchiveProvenance {
            source_id: digest.clone(),
            semantic_id: digest.clone(),
            compiler_semantics_id: digest.clone(),
            snapshot_id: digest.clone(),
            stdlib_semantics_id: digest.clone(),
            prism_stdlib_crate_sha256: digest.clone(),
            lexlean_commit: revision.clone(),
            lexlean_package_sha256: digest.clone(),
            lean4_prod_commit: revision.clone(),
            hologram_live_commit: revision.clone(),
            uor_hologram_commit: revision,
            target_profile_id: digest.clone(),
            lean_manifest_sha256: digest.clone(),
            lcnf_manifest_sha256: digest.clone(),
            generated_core_sha256: digest.clone(),
            cargo_name: "wire-fixture".to_owned(),
            cargo_version: "0.1.0".to_owned(),
            cargo_crate_sha256: digest.clone(),
            view_model_id: digest.clone(),
            browser_projection_sha256: digest,
        },
        basis: None,
    }
}

#[test]
fn public_archive_validation_distinguishes_footer_mismatch_from_header_failure() {
    let archive = compose_application_v4(&application_input()).unwrap();
    validate_application(&archive.bytes).unwrap();
    let footer = archive.bytes.len() - 32;
    for offset in footer..archive.bytes.len() {
        let mut changed = archive.bytes.clone();
        changed[offset] ^= 1;
        assert_eq!(validate_application(&changed).unwrap_err().code, "PP3004");
    }
    let mut changed = archive.bytes.clone();
    changed[0] ^= 1;
    assert_eq!(validate_application(&changed).unwrap_err().code, "PP3001");
}

fn recompose(archive: &GeneratedHolo, directory: Vec<u8>, provenance: Vec<u8>) -> Vec<u8> {
    let part = |index| {
        modeled(wire::archiveSection(archive.bytes.clone(), index))
            .unwrap()
            .unwrap()
    };
    seal(
        modeled(wire::archiveBody(
            part(0),
            part(1),
            directory,
            provenance,
            part(4),
            part(5),
            part(6),
            part(7),
        ))
        .unwrap()
        .unwrap(),
    )
}

#[test]
fn archive_composition_is_deterministic_and_directory_layers_are_exact() {
    let input = application_input();
    let archive = compose_application_v4(&input).unwrap();
    assert_eq!(archive.bytes, compose_application_v4(&input).unwrap().bytes);
    let parsed = parse_application(&archive.bytes).unwrap();
    assert_eq!(parsed.identities, archive.identities);
    assert_eq!(parsed.metadata, input.source_manifest);
    for layer in 0..2 {
        for (field, value) in [
            ("position", json!(9)),
            ("kind", json!("other")),
            ("content_kappa", json!("blake3:wrong")),
            ("entry", json!("other")),
            ("contract", json!("other")),
            ("architecture", json!("other")),
            ("surface", json!("other")),
            ("engine", json!("other")),
        ] {
            let mut directory: Value = serde_json::from_slice(&archive.directory).unwrap();
            directory["layers"][layer][field] = value;
            let directory: Directory = serde_json::from_value(directory).unwrap();
            let changed = recompose(
                &archive,
                serde_json::to_vec(&directory).unwrap(),
                archive.prism_extension.clone(),
            );
            assert_eq!(
                validate_application(&changed).unwrap_err().code,
                "PP3012",
                "{layer}:{field}"
            );
        }
    }
    let mut noncanonical_directory = archive.directory.clone();
    noncanonical_directory.push(b'\n');
    assert_eq!(
        validate_application(&recompose(
            &archive,
            noncanonical_directory,
            archive.prism_extension.clone()
        ))
        .unwrap_err()
        .code,
        "PP3012"
    );
}

#[test]
fn archive_provenance_rejects_changed_links_unknown_fields_and_noncanonical_bytes() {
    let archive = compose_application_v4(&application_input()).unwrap();
    for (field, value) in [
        ("application_kappa", json!("blake3:wrong")),
        ("model_content_kappa", json!("blake3:wrong")),
        ("guest_content_kappa", json!("blake3:wrong")),
        ("model_id", json!("1".repeat(64))),
        ("core_wasm_contract", json!("other")),
        ("lexlean_commit", json!("g".repeat(40))),
        ("unknown", json!(true)),
    ] {
        let mut value_json: Value = serde_json::from_slice(&archive.prism_extension).unwrap();
        value_json[field] = value;
        let changed = recompose(
            &archive,
            archive.directory.clone(),
            encode_value(&value_json).unwrap(),
        );
        assert_eq!(
            validate_application(&changed).unwrap_err().code,
            "PP3015",
            "{field}"
        );
    }
    let mut noncanonical = archive.prism_extension.clone();
    noncanonical.push(b'\n');
    assert_eq!(
        validate_application(&recompose(
            &archive,
            archive.directory.clone(),
            noncanonical
        ))
        .unwrap_err()
        .code,
        "PP3015"
    );
    // A valid content address cannot relabel an existing role as the model
    // while leaving an undeclared fourth blob in the purported closed archive.
    let mut aliased: Value = serde_json::from_slice(&archive.prism_extension).unwrap();
    aliased["model_content_kappa"] = json!(archive.identities.guest_content_kappa);
    aliased["model_id"] = json!(content_id(&application_input().guest_wasm));
    assert_eq!(
        validate_application(&recompose(
            &archive,
            archive.directory.clone(),
            encode_value(&aliased).unwrap()
        ))
        .unwrap_err()
        .code,
        "PP3015"
    );
}

// --- holo v5 (ADR-017) ------------------------------------------------------

fn v5_objects(bytes: &[u8]) -> Vec<Vec<u8>> {
    v5::read_objects(bytes, v5::APPLICATION_BUDGET)
        .unwrap()
        .into_iter()
        .map(<[u8]>::to_vec)
        .collect()
}

#[test]
fn v5_composition_is_a_deterministic_uorc_archive_named_by_kappa() {
    let mut input = application_input();
    input.basis = Some(format!("sha256:{}", "a".repeat(64)));
    let archive = compose_application(&input).unwrap();
    assert_eq!(archive.bytes, compose_application(&input).unwrap().bytes);
    assert!(archive.bytes.starts_with(b"UORC\x02\x01\x00\x00\x07"));
    let parsed = parse_application(&archive.bytes).unwrap();
    assert_eq!(parsed.identities, archive.identities);
    assert_eq!(parsed.metadata, input.source_manifest);
    let identities = &archive.identities;
    assert_eq!(identities.archive_kappa, v5::kappa(&archive.bytes));
    assert_eq!(identities.guest_content_kappa, v5::kappa(&input.guest_wasm));
    assert_eq!(
        identities.model_content_kappa,
        v5::kappa(&input.model_document)
    );
    assert_eq!(
        identities.application_kappa,
        v5::kappa(&archive.application_manifest)
    );
    assert_eq!(identities.archive_fingerprint.len(), 64);
    // Every label the holo carries is a κ: no BLAKE3 survives in v5.
    assert!(!archive.bytes.windows(7).any(|window| window == b"blake3:"));
    let objects = v5_objects(&archive.bytes);
    assert_eq!(objects.len(), ROLES_V5.len());
    assert_eq!(objects[1], input.source_manifest);
    assert_eq!(objects[4], input.guest_wasm);
    assert_eq!(objects[5], input.view_bundle);
    assert_eq!(objects[6], input.model_document);
    let manifest: Value = serde_json::from_slice(&objects[0]).unwrap();
    assert_eq!(manifest["schema"], "prism/holo/5");
    assert_eq!(manifest["basis"], json!(input.basis));
    let roles: Vec<&str> = manifest["objects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["role"].as_str().unwrap())
        .collect();
    assert_eq!(
        roles,
        ROLES_V5[1..]
            .iter()
            .filter(|role| **role != "provenance")
            .copied()
            .collect::<Vec<_>>()
    );
    // Without a pinned SDK the manifest names no basis.
    let unpinned = compose_application(&application_input()).unwrap();
    let manifest: Value = serde_json::from_slice(&v5_objects(&unpinned.bytes)[0]).unwrap();
    assert!(manifest.get("basis").is_none());
    let mut bad = application_input();
    bad.basis = Some("blake3:".to_owned() + &"a".repeat(64));
    assert_eq!(compose_application(&bad).unwrap_err().code, "PP3010");
}

#[test]
fn v5_validation_refuses_changed_objects_manifest_and_provenance() {
    let archive = compose_application(&application_input()).unwrap();
    let objects = v5_objects(&archive.bytes);
    let rewrite = |index: usize, bytes: Vec<u8>| {
        let mut changed = objects.clone();
        changed[index] = bytes;
        v5::write_objects(&changed)
    };
    // A changed content object no longer matches the manifest's κ.
    assert_eq!(
        validate_application(&rewrite(4, b"\0asm\x01\0\0\x01".to_vec()))
            .unwrap_err()
            .code,
        "PP3012"
    );
    // A manifest that is not canonical, or names a different κ.
    let mut noncanonical = objects[0].clone();
    noncanonical.push(b'\n');
    assert_eq!(
        validate_application(&rewrite(0, noncanonical))
            .unwrap_err()
            .code,
        "PP3012"
    );
    let mut manifest: Value = serde_json::from_slice(&objects[0]).unwrap();
    manifest["requires"] = json!(archive.identities.guest_content_kappa);
    assert_eq!(
        validate_application(&rewrite(0, encode_value(&manifest).unwrap()))
            .unwrap_err()
            .code,
        "PP3012"
    );
    for (field, value) in [
        (
            "application_kappa",
            json!(format!("sha256:{}", "0".repeat(64))),
        ),
        (
            "model_content_kappa",
            json!(archive.identities.guest_content_kappa),
        ),
        ("schema", json!("prismpm/model-provenance/1")),
        ("unknown", json!(true)),
    ] {
        let mut provenance: Value = serde_json::from_slice(&objects[2]).unwrap();
        provenance[field] = value;
        assert_eq!(
            validate_application(&rewrite(2, encode_value(&provenance).unwrap()))
                .unwrap_err()
                .code,
            "PP3015",
            "{field}"
        );
    }
    // Objects out of role order, or one missing.
    let mut swapped = objects.clone();
    swapped.swap(4, 5);
    assert!(validate_application(&v5::write_objects(&swapped)).is_err());
    assert_eq!(
        validate_application(&v5::write_objects(&objects[..6]))
            .unwrap_err()
            .code,
        "PP3003"
    );
    // A broken seal is an integrity failure.
    let mut flipped = archive.bytes.clone();
    let middle = flipped.len() / 2;
    flipped[middle] ^= 0x40;
    assert_eq!(validate_application(&flipped).unwrap_err().code, "PP3004");
}

#[test]
fn legacy_v4_holos_stay_readable_but_cannot_be_signed() {
    let legacy = compose_application_v4(&application_input()).unwrap();
    let parsed = parse_application(&legacy.bytes).unwrap();
    assert!(parsed.identities.guest_content_kappa.starts_with("blake3:"));
    let error = attach_attestations(&legacy.bytes, &[b"{}".to_vec()]).unwrap_err();
    assert_eq!(error.code, "PP3001");
}

#[test]
fn upgrading_a_v4_holo_keeps_every_content_object_byte_for_byte() {
    let input = application_input();
    let legacy = compose_application_v4(&input).unwrap();
    let upgraded = upgrade_application(&legacy.bytes).unwrap();
    let parsed = parse_application(&upgraded).unwrap();
    for content in [&input.guest_wasm, &input.view_bundle, &input.model_document] {
        assert_eq!(parsed.blobs.get(&v5::kappa(content)), Some(content));
    }
    assert_eq!(parsed.metadata, input.source_manifest);
    // Upgrading is idempotent on v5.
    assert_eq!(upgrade_application(&upgraded).unwrap(), upgraded);
}

#[test]
#[ignore = "writes the v5 reference fixture; run with --ignored to regenerate"]
fn write_v5_reference_fixtures() {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../sdk/npm/prism-code/fixtures");
    for name in ["Calculator", "PaymentApproval"] {
        let legacy = std::fs::read(root.join(format!("{name}.holo"))).unwrap();
        std::fs::write(
            root.join(format!("{name}.v5.holo")),
            upgrade_application(&legacy).unwrap(),
        )
        .unwrap();
    }
}
