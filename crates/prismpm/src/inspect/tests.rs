//! The Rust half of issue #271, held against the JavaScript half's goldens.

use super::{inspect, select, INSPECTION_SCHEMA};
use prism_stdlib as wire;
use serde_json::{json, Value};

/// The reference archive and the inspection `prism-code inspect` prints for
/// it (`sdk/npm/prism-code/test/fixtures/Calculator.inspect.json`, golden of
/// issue #271). Both readers report the same values for this archive.
fn reference() -> (Vec<u8>, Value) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let bytes = std::fs::read(root.join("sdk/npm/prism-code/fixtures/Calculator.holo"))
        .expect("reference archive");
    let golden =
        std::fs::read(root.join("sdk/npm/prism-code/test/fixtures/Calculator.inspect.json"))
            .expect("inspection golden");
    (
        bytes,
        serde_json::from_slice(&golden).expect("inspection golden is canonical JSON"),
    )
}

/// The reference archive signed by the JavaScript appender with the two
/// committed bundle lines (`attestation-interop.test.mjs`, issue #267): a
/// proof statement over the guest, then a provenance statement over the guest
/// and the view.
fn signed() -> Vec<u8> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::read(root.join("sdk/npm/prism-code/test/fixtures/attestation/Calculator.signed.holo"))
        .expect("signed reference archive")
}

#[test]
fn the_reference_archive_inspects_exactly_as_the_javascript_half_reports_it() {
    let (bytes, golden) = reference();
    let inspected = inspect(&bytes).unwrap();
    assert_eq!(inspected, golden);
    assert_eq!(inspected["schema"], INSPECTION_SCHEMA);
    // Eight rows and no attestation section: the table ends at the archive's
    // own row count, although the wire model names a ninth row.
    assert_eq!(inspected["sections"].as_array().unwrap().len(), 8);
    assert_eq!(inspected["attestations"], json!([]));
}

#[test]
fn the_signed_archive_lists_each_statement_with_its_subjects() {
    let (unsigned, _) = reference();
    let inspected = inspect(&signed()).unwrap();
    let statements = inspected["attestations"].as_array().unwrap();
    assert_eq!(statements.len(), 2);
    // The row shape is the JavaScript half's `InspectedAttestation`: the
    // predicate type and the subjects, each with its name and digest set.
    assert_eq!(
        statements[0]["predicate_type"],
        "https://uor.foundation/prism/proof/v1"
    );
    assert_eq!(
        statements[1]["predicate_type"],
        "https://slsa.dev/provenance/v1"
    );
    let names = |statement: &Value| -> Vec<String> {
        statement["subjects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|subject| subject["name"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(
        names(&statements[0]),
        ["core-wasm/prism_calculator_core_wasm.wasm"]
    );
    assert_eq!(
        names(&statements[1]),
        [
            "core-wasm/prism_calculator_core_wasm.wasm",
            "view/prism_calculator.holoview"
        ]
    );
    // Every subject's digest set is the content digest of a blob of this
    // archive, as the inspection reports it under `sections[].content`.
    let sections = inspected["sections"].as_array().unwrap();
    for statement in statements {
        assert_eq!(statement.as_object().unwrap().len(), 2);
        for subject in statement["subjects"].as_array().unwrap() {
            assert_eq!(subject.as_object().unwrap().len(), 2);
            assert_eq!(subject["digest"].as_object().unwrap().len(), 2);
            assert!(
                sections
                    .iter()
                    .any(|section| section["content"]["digest"] == subject["digest"]),
                "subject {} names no blob of the archive",
                subject["name"]
            );
        }
    }
    let guest = sections
        .iter()
        .find(|section| section["role"] == "guest")
        .unwrap();
    assert_eq!(
        statements[0]["subjects"][0]["digest"],
        guest["content"]["digest"]
    );
    // The section is the ninth row, an extension named for the bundle, and the
    // footer covers it.
    assert_eq!(sections.len(), 9);
    assert_eq!(sections[8]["kind"], 14);
    assert_eq!(sections[8]["role"], "extension");
    assert_eq!(
        sections[8]["name"],
        "https://uor.foundation/extension/attestation-bundle/v1"
    );
    assert_eq!(inspected["verification"]["footer"], true);
    assert_eq!(inspected["verification"]["labels"], true);
    assert_eq!(inspected["verification"]["cross_references"], true);
    // Signing moves the file, not the application: rows 0 to 7 and every
    // identity are the unsigned archive's.
    let reference = inspect(&unsigned).unwrap();
    assert_eq!(inspected["provenance"], reference["provenance"]);
    assert_eq!(inspected["model"], reference["model"]);
    assert_eq!(inspected["manifest"], reference["manifest"]);
    assert_eq!(inspected["world"], reference["world"]);
    for (index, section) in reference["sections"].as_array().unwrap().iter().enumerate() {
        assert_eq!(sections[index]["digest"], section["digest"]);
        assert_eq!(sections[index]["role"], section["role"]);
    }
    assert_ne!(inspected["footer"], reference["footer"]);
    // No dated revision admits the section yet, so none is recognized.
    assert_eq!(inspected["revision"], Value::Null);
    assert_eq!(
        select(&inspected, "attestations[1].subjects[1].name")
            .unwrap()
            .unwrap(),
        "view/prism_calculator.holoview"
    );
}

#[test]
fn a_scratched_signed_archive_still_lists_its_statements() {
    let signed = signed();
    let clean = inspect(&signed).unwrap();
    // A byte inside the model document, the blob the provenance statement
    // does not name; the statements still list, the damage still reports.
    let at = clean["sections"][7]["offset"].as_u64().unwrap() as usize + 100;
    let mut damaged = signed.clone();
    damaged[at] ^= 0xff;
    let inspected = inspect(&damaged).unwrap();
    assert_eq!(inspected["verification"]["footer"], false);
    assert_eq!(inspected["verification"]["cross_references"], false);
    assert_eq!(inspected["attestations"], clean["attestations"]);
}

#[test]
fn a_line_that_is_not_a_bundle_is_refused() {
    let mut broken = signed();
    let needle = b"vnd.dev.sigstore.bundle";
    let at = broken
        .windows(needle.len())
        .position(|window| window == needle)
        .expect("the first line names its media type");
    broken[at] ^= 0x20;
    assert_eq!(inspect(&broken).unwrap_err().code, "PP3017");
}

#[test]
fn the_sections_are_the_modeled_table_with_digests_over_their_own_bytes() {
    let (bytes, _) = reference();
    let inspected = inspect(&bytes).unwrap();
    let sections = inspected["sections"].as_array().unwrap();
    assert_eq!(sections.len(), 8);
    assert_eq!(
        sections
            .iter()
            .map(|section| section["kind"].as_u64().unwrap())
            .collect::<Vec<u64>>(),
        vec![15, 8, 14, 14, 16, 16, 16, 16]
    );
    assert_eq!(sections[0]["role"], "app-manifest");
    assert_eq!(sections[1]["role"], "source-manifest");
    assert_eq!(sections[2]["role"], "application-directory");
    assert_eq!(sections[3]["role"], "model-provenance");
    assert_eq!(sections[4]["role"], "guest");
    assert_eq!(sections[5]["role"], "view");
    assert_eq!(sections[6]["role"], "capability-set");
    assert_eq!(sections[7]["role"], "model-document");
    for section in sections {
        assert_eq!(
            section["kind_name"],
            match section["kind"].as_u64().unwrap() {
                15 => "app-manifest",
                8 => "metadata",
                14 => "extension",
                _ => "content-blob",
            }
        );
        assert!(section["offset"].as_u64().unwrap() < bytes.len() as u64);
        assert_eq!(section["digest"].as_object().unwrap().len(), 2);
    }
    // The guest's own label is the BLAKE3 of its content, and reports as such.
    let guest = &sections[4];
    assert_eq!(
        guest["label"],
        format!(
            "blake3:{}",
            guest["content"]["digest"]["blake3"].as_str().unwrap()
        )
    );
    assert_eq!(guest["content"]["label_matches"], true);
}

#[test]
fn the_manifest_suffix_fields_are_the_modeled_ones() {
    let suffix = wire::wireManifestSuffix();
    let text = String::from_utf8_lossy(&suffix);
    for field in [
        "holo_run",
        "index.html",
        "portable",
        "hologram:guest/core-wasm@1",
    ] {
        assert!(
            text.contains(field),
            "the modeled manifest suffix lacks {field}"
        );
    }
    let (bytes, _) = reference();
    let inspected = inspect(&bytes).unwrap();
    assert_eq!(inspected["manifest"]["entry"], "holo_run");
    assert_eq!(inspected["manifest"]["view_entry"], "index.html");
    assert_eq!(inspected["manifest"]["surface"], "portable");
    assert_eq!(
        inspected["manifest"]["uri"],
        "https://hologram.foundation/realization/app-manifest"
    );
    assert_eq!(inspected["manifest"]["contract"], wire::contractName());
}

#[test]
fn a_scratched_blob_keeps_the_inspection_readable_and_reports_the_damage() {
    let (bytes, _) = reference();
    let mut damaged = bytes.clone();
    let at = damaged.len() - 200;
    damaged[at] ^= 0xff;
    let inspected = inspect(&damaged).unwrap();
    assert_eq!(inspected["verification"]["footer"], false);
    assert_eq!(inspected["size"], damaged.len());
    // The table is untouched, so the sections still read.
    assert_eq!(inspected["sections"].as_array().unwrap().len(), 8);
    assert_eq!(inspected["verification"]["cross_references"], false);
}

#[test]
fn a_file_that_is_not_an_archive_is_refused() {
    assert_eq!(inspect(b"not a holo").unwrap_err().code, "PP3001");
    let (bytes, _) = reference();
    let mut truncated = bytes[..20].to_vec();
    truncated[..4].copy_from_slice(b"HOLO");
    assert_eq!(inspect(&truncated).unwrap_err().code, "PP3001");
}

#[test]
fn a_selector_reads_one_value_and_refuses_a_malformed_path() {
    let (bytes, _) = reference();
    let inspected = inspect(&bytes).unwrap();
    assert_eq!(
        select(&inspected, "sections[0].digest.sha256")
            .unwrap()
            .unwrap(),
        &inspected["sections"][0]["digest"]["sha256"]
    );
    assert_eq!(
        select(&inspected, ".sections.0.role").unwrap().unwrap(),
        "app-manifest"
    );
    assert_eq!(
        select(&inspected, "world.exports")
            .unwrap()
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        select(&inspected, "model.name").unwrap().unwrap(),
        "Calculator"
    );
    // A path with no value is no value, not a failure.
    assert!(select(&inspected, "world.imports[4]").unwrap().is_none());
    assert!(select(&inspected, "sections[99]").unwrap().is_none());
    assert!(select(&inspected, "absent").unwrap().is_none());
    // A malformed path is a usage error.
    for malformed in ["", ".", "sections[", "sections[x]", "a..b", "a b", "0"] {
        assert_eq!(
            select(&inspected, malformed).unwrap_err().code,
            "PP1101",
            "selector {malformed:?} was not refused"
        );
    }
}

#[test]
fn the_world_member_is_the_registered_world_and_the_guest_conforms() {
    let (bytes, _) = reference();
    let inspected = inspect(&bytes).unwrap();
    let world = &inspected["world"];
    assert_eq!(world["contract"], "hologram:guest/core-wasm@1");
    assert_eq!(world["package"], "hologram:guest@1.0.0");
    assert_eq!(world["name"], "core-wasm");
    assert_eq!(world["file"], "worlds/core-wasm.wit");
    assert_eq!(world["conforms"], true);
    assert_eq!(world["pure"], true);
    assert_eq!(world["effects"].as_array().unwrap().len(), 0);
    assert_eq!(world["capability_set"]["empty"], true);
    assert_eq!(
        world["digest"]["sha256"],
        "a566c87a359cadf98f652747f1b3574aa307ff5f652a190c6d99c350db9cf369"
    );
}

#[test]
fn the_world_digests_are_the_committed_wit_file() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let wit = std::fs::read(root.join("sdk/npm/spec/worlds/core-wasm.wit")).expect("world file");
    let (bytes, _) = reference();
    let inspected = inspect(&bytes).unwrap();
    assert_eq!(
        inspected["world"]["digest"]["blake3"],
        blake3::hash(&wit).to_hex().to_string()
    );
    assert_eq!(
        inspected["world"]["digest"]["sha256"],
        format!("{:x}", <sha2::Sha256 as sha2::Digest>::digest(&wit))
    );
}

#[test]
fn the_guest_module_reads_and_carries_exactly_the_worlds_interface() {
    use super::{read_interface, read_sections};
    let (bytes, _) = reference();
    let body = wire::archiveBodyBytes(bytes.clone()).unwrap().unwrap();
    let sections = read_sections(&body, &[], None).unwrap();
    let guest = sections
        .iter()
        .find(|section| {
            section
                .content
                .as_deref()
                .is_some_and(|content| content.starts_with(b"\0asm"))
        })
        .expect("the archive carries a core module");
    let interface = read_interface(guest.content.as_deref().unwrap()).expect("the guest reads");
    assert!(
        interface.imports.is_empty(),
        "the guest imports {} entries",
        interface.imports.len()
    );
    type ExportRow = (String, String, Option<(Vec<String>, Vec<String>)>);
    let found: Vec<ExportRow> = interface
        .exports
        .iter()
        .map(|export| {
            (
                export.field.clone(),
                export.kind.clone(),
                export.signature.clone(),
            )
        })
        .collect();
    assert_eq!(
        found,
        vec![
            ("memory".to_owned(), "memory".to_owned(), None),
            (
                "holo_alloc".to_owned(),
                "func".to_owned(),
                Some((vec!["i32".to_owned()], vec!["i32".to_owned()])),
            ),
            (
                "holo_run".to_owned(),
                "func".to_owned(),
                Some((
                    vec!["i32".to_owned(), "i32".to_owned()],
                    vec!["i64".to_owned()],
                )),
            ),
        ]
    );
}
