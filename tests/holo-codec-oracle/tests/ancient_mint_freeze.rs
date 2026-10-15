use std::fs;
use std::path::Path;
use hologram::archive::{HoloLoader, HoloWriter, SectionKind};
use hologram::space::{
    address_bytes, AppManifest, Capabilities, CapabilitySet, Layer, LayerKind, Realization,
};
use serde_json::json;

fn empty_capabilities() -> Vec<u8> {
    CapabilitySet::new(Capabilities {
        storage_roots: Vec::new(),
        storage_quota_bytes: 0,
        network_fetch_endpoints: Vec::new(),
        network_announce_endpoints: Vec::new(),
        publish_channels: Vec::new(),
        subscribe_channels: Vec::new(),
        memory_max_bytes: 0,
        cpu_time_per_event_ms: 0,
        priority_weight: 0,
    })
    .canonicalize()
}

fn upstream_extension(key: &str, value: &[u8]) -> Vec<u8> {
    let mut writer = HoloWriter::new();
    writer.add_extension(key, value.to_vec());
    let archive = writer
        .finish()
        .expect("upstream synthetic extension framing");
    let plan = HoloLoader::from_bytes(&archive)
        .unwrap()
        .into_plan()
        .unwrap();
    plan.section(SectionKind::Extension).unwrap().to_vec()
}

#[test]
fn compute_and_assemble_ancient_mint_holo() {
    let base_dir = Path::new("/media/citizen/b361d448-7c51-413a-aa23-9515cb626930/home/citizen/Multiplicity/Phase Mirror");
    let model_path = base_dir.join("artifacts/ancient_mint_model.prism.json");
    let manifest_path = base_dir.join("artifacts/ancient_mint_manifest.json");

    let model_bytes = fs::read(&model_path).expect("read model.prism.json");
    let manifest_bytes = fs::read(&manifest_path).expect("read manifest.json");

    let capabilities = empty_capabilities();
    let cap_kappa = address_bytes(&capabilities);
    let model_kappa = address_bytes(&model_bytes);

    let app_manifest = AppManifest {
        primary: None,
        requires: cap_kappa,
        layers: vec![
            Layer {
                kind: LayerKind::View,
                content: model_kappa,
                entry: "model.prism.json".to_owned(),
                aux: "portable".to_owned(),
            }
        ],
        children: Vec::new(),
    };
    app_manifest.validate().unwrap();
    let canonical_manifest = app_manifest.canonicalize();
    let app_manifest_kappa = address_bytes(&canonical_manifest);

    let directory = serde_json::to_vec(&json!({
        "schema_version": 1,
        "primary_layer": null,
        "requires_kappa": cap_kappa.to_string(),
        "layers": [{
            "position": 0,
            "kind": "view",
            "content_kappa": model_kappa.to_string(),
            "entry": "model.prism.json",
            "surface": "portable"
        }],
        "children": [],
        "blobs": [{
            "kappa": model_kappa.to_string(),
            "byte_length": model_bytes.len()
        }]
    })).unwrap();

    let provenance = serde_json::to_vec(&json!({
        "schema": "prismpm/model-provenance/1",
        "model_id": "33e35edc7cf68cdf6082f46569978a193eaeb8ad9137c8b5f84b13d65471cf16",
        "semantic_id": "600f92bcbd3a96aee14922f1cff22b4616bcb7df84625af245f1a609d1f7c93b",
        "source_id": "d8743aefc1c7d166b96d8d6b90911bea5478fc9e3d4c82be7f4809c52886810b",
        "model_content_kappa": model_kappa.to_string(),
        "application_kappa": app_manifest_kappa.to_string()
    })).unwrap();

    let mut sections = vec![
        (SectionKind::AppManifest, canonical_manifest),
        (SectionKind::Metadata, manifest_bytes),
        (
            SectionKind::Extension,
            upstream_extension("https://hologram.foundation/extension/application-directory/v1", &directory),
        ),
        (
            SectionKind::Extension,
            upstream_extension("https://uor.foundation/extension/prismpm-model/v1", &provenance),
        ),
    ];

    let mut blobs = vec![
        (cap_kappa, capabilities),
        (model_kappa, model_bytes),
    ];
    blobs.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    for (label, bytes) in blobs {
        let mut payload = label.as_bytes().to_vec();
        payload.extend_from_slice(&bytes);
        sections.push((SectionKind::ContentBlob, payload));
    }

    let archive = HoloWriter::assemble(sections);

    // Verify valid Hologram v4 header and footer
    assert!(archive.starts_with(b"HOLO\x04\x00"));
    let footer = &archive[archive.len() - 32..];
    let computed_footer = blake3::hash(&archive[..archive.len() - 32]);
    assert_eq!(footer, computed_footer.as_bytes());

    let archive_kappa = address_bytes(&archive);
    let fingerprint_hex = computed_footer.to_hex().to_string();

    // Verify loader
    let plan = HoloLoader::from_bytes(&archive).unwrap().into_plan().unwrap();
    assert_eq!(plan.sections().len(), 6);

    // Write .holo archive to artifacts, docs, and project build directory
    let holo_dest_artifact = base_dir.join("artifacts/ancient_mint.holo");
    let holo_dest_doc = base_dir.join("docs/ancient_mint.holo");
    let holo_dest_build = base_dir.join("projects/Ancient Mint/.prism/build/31a993428b9760d880a7e91b9a558006d373625ea4a6678e66a2095b18405f1f/AncientMint.holo");

    fs::write(&holo_dest_artifact, &archive).unwrap();
    fs::write(&holo_dest_doc, &archive).unwrap();
    fs::write(&holo_dest_build, &archive).unwrap();

    // Acceptance attestation ID (canonical hash over provenance + archive kappa)
    let attestation_bytes = serde_json::to_vec(&json!({
        "schema": "prismpm/application-acceptance/1",
        "archive_kappa": archive_kappa.to_string(),
        "archive_fingerprint": fingerprint_hex,
        "application_kappa": app_manifest_kappa.to_string(),
        "model_id": "33e35edc7cf68cdf6082f46569978a193eaeb8ad9137c8b5f84b13d65471cf16",
        "status": "accepted"
    })).unwrap();
    let attestation_id = format!("blake3:{}", blake3::hash(&attestation_bytes).to_hex());

    println!("=== ANCIENT MINT HOLOGRAPHIC FREEZE SUMMARY ===");
    println!("archive_byte_length: {}", archive.len());
    println!("archive_kappa: {}", archive_kappa);
    println!("archive_fingerprint: {}", fingerprint_hex);
    println!("application_kappa: {}", app_manifest_kappa);
    println!("model_content_kappa: {}", model_kappa);
    println!("attestation_id: {}", attestation_id);
}
