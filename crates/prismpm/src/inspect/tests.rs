//! The Rust half of issue #271, held against the JavaScript half's goldens.

use super::{inspect, select, INSPECTION_SCHEMA};
use prism_stdlib as wire;
use serde_json::Value;

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

#[test]
fn the_reference_archive_inspects_exactly_as_the_javascript_half_reports_it() {
    let (bytes, golden) = reference();
    let inspected = inspect(&bytes).unwrap();
    assert_eq!(inspected, golden);
    assert_eq!(inspected["schema"], INSPECTION_SCHEMA);
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
