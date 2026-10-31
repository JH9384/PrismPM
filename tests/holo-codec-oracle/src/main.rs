//! Independent wire vectors, never runnable-app or release acceptance evidence.
use hologram::archive::{HoloLoader, HoloWriter, SectionKind};
use hologram::space::{
    address_bytes, AppManifest, Capabilities, CapabilitySet, Layer, LayerKind, Realization,
    WASM_CONTRACT_CORE_V1,
};
use serde_json::{json, Value};
use std::path::Path;

const REVISION: &str = "2bda6a9a9476872dade705bd61ece4209607f6da";
const DIRECTORY: &str = "https://hologram.foundation/extension/application-directory/v1";
const PROVENANCE: &str = "https://uor.foundation/extension/prismpm-model/v1";
const BROWSER_PROVENANCE: &str = "https://uor.foundation/extension/prismpm-browser/v1";
const ATTESTATION: &str = "https://uor.foundation/extension/attestation-bundle/v1";
/// Two synthetic JSON Lines. Prism's reader checks the lines, Hologram only carries the bytes.
const ATTESTATION_LINES: &[u8] = b"{\"mediaType\":\"application/vnd.dev.sigstore.bundle.v0.3+json\"}\n{\"mediaType\":\"second\"}\n";

#[derive(Clone, Copy)]
enum Profile {
    Portable,
    Browser,
}

impl Profile {
    fn surface(self) -> &'static str {
        match self {
            Self::Portable => "portable",
            Self::Browser => "prismpm-browser/1",
        }
    }

    fn provenance(self) -> &'static str {
        match self {
            Self::Portable => PROVENANCE,
            Self::Browser => BROWSER_PROVENANCE,
        }
    }

    fn manifest_length(self) -> usize {
        match self {
            Self::Portable => 356,
            Self::Browser => 365,
        }
    }

    fn fixture_path(self) -> &'static str {
        match self {
            Self::Portable => "../data/holo-codec-v1.json",
            Self::Browser => "../data/holo-browser-codec-v1.json",
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn content(bytes: &[u8]) -> Value {
    json!({"bytes_hex": hex(bytes), "kappa": address_bytes(bytes).to_string()})
}

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
    // The writer supplies its own extension encoder.
    // Recover that section instead of duplicating the expected framing here.
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

fn loader_outcome(bytes: &[u8]) -> Value {
    let loader = match HoloLoader::from_bytes(bytes) {
        Ok(loader) => loader,
        Err(error) => return json!({"stage": "header-footer", "error": format!("{error:?}")}),
    };
    let plan = match loader.into_plan() {
        Ok(plan) => plan,
        Err(error) => return json!({"stage": "section-table", "error": format!("{error:?}")}),
    };
    for section in plan.sections() {
        if let Err(error) = plan.section(section.kind) {
            return json!({"stage": "section-payload", "error": format!("{error:?}")});
        }
    }
    if let Err(error) = plan.content_blobs() {
        return json!({"stage": "content-blob", "error": format!("{error:?}")});
    }
    if let Err(error) = plan.extensions() {
        return json!({"stage": "extension", "error": format!("{error:?}")});
    }
    json!({"stage": "accepted-physical-archive"})
}

fn reseal(bytes: &mut [u8]) {
    let footer = bytes.len() - 32;
    let digest = blake3::hash(&bytes[..footer]);
    bytes[footer..].copy_from_slice(digest.as_bytes());
}

/// The archive with one more Extension row after the four content blobs, assembled by
/// Hologram's own writer in the given order. Prism's attestation section (#267) is that row.
fn attestation_vector(sections: &[(SectionKind, Vec<u8>)]) -> Value {
    let mut signed = sections.to_vec();
    signed.push((
        SectionKind::Extension,
        upstream_extension(ATTESTATION, ATTESTATION_LINES),
    ));
    let archive = HoloWriter::assemble(signed.clone());
    let plan = HoloLoader::from_bytes(&archive)
        .unwrap()
        .into_plan()
        .unwrap();
    assert_eq!(plan.sections().len(), 9);
    assert_eq!(plan.sections()[0].offset, 226);
    assert_eq!(plan.sections()[8].kind as u8, 14);
    assert_eq!(plan.content_blobs().unwrap().len(), 4);
    let extensions = plan.extensions().unwrap();
    assert_eq!(extensions.len(), 3);
    assert_eq!(extensions[2], (ATTESTATION, ATTESTATION_LINES));
    assert_eq!(
        &archive[archive.len() - 32..],
        blake3::hash(&archive[..archive.len() - 32]).as_bytes()
    );
    let outcome = loader_outcome(&archive);
    assert_eq!(outcome["stage"], "accepted-physical-archive");
    json!({
        "extension": ATTESTATION,
        "lines_hex": hex(ATTESTATION_LINES),
        "bytes_hex": hex(&archive),
        "body_hex": hex(&archive[..archive.len() - 32]),
        "footer_hex": hex(&archive[archive.len() - 32..]),
        "kappa": address_bytes(&archive).to_string(),
        "sections": plan.sections().iter().zip(&signed).map(|(section, (_, payload))| json!({"kind": section.kind as u8, "offset": section.offset, "length": section.length, "payload_hex": hex(payload)})).collect::<Vec<_>>(),
        "upstream": outcome,
    })
}

fn fixture(profile: Profile) -> Value {
    let capabilities = empty_capabilities();
    assert_eq!(capabilities.len(), 104);
    // These bytes intentionally do not claim to be an executable Wasm/View.
    let guest = b"\0asm\xffsynthetic codec guest";
    let view = b"HOLOVIEW\0\x01synthetic codec view";
    let model = br#"{"fixture":"wire-only"}"#;
    let manifest_value = AppManifest {
        primary: Some(0),
        requires: address_bytes(&capabilities),
        layers: vec![
            Layer::wasm_with_contract(address_bytes(guest), "holo_run", WASM_CONTRACT_CORE_V1),
            Layer {
                kind: LayerKind::View,
                content: address_bytes(view),
                entry: "index.html".to_owned(),
                aux: profile.surface().to_owned(),
            },
        ],
        children: Vec::new(),
    };
    manifest_value.validate().unwrap();
    let manifest = manifest_value.canonicalize();
    assert_eq!(manifest.len(), profile.manifest_length());
    assert_eq!(
        AppManifest::decode(&manifest).unwrap().canonicalize(),
        manifest
    );
    let references = <AppManifest as Realization>::references(&manifest).unwrap();
    assert_eq!(references.len(), 3);

    let metadata = br#"{"fixture":"not-an-application"}"#;
    let directory = br#"{"fixture":"synthetic-directory"}"#;
    let provenance = br#"{"fixture":"not-release-evidence"}"#;
    let mut sections = vec![
        (SectionKind::AppManifest, manifest.clone()),
        (SectionKind::Metadata, metadata.to_vec()),
        (
            SectionKind::Extension,
            upstream_extension(DIRECTORY, directory),
        ),
        (
            SectionKind::Extension,
            upstream_extension(profile.provenance(), provenance),
        ),
    ];
    let mut blobs = [capabilities.as_slice(), guest, model, view]
        .into_iter()
        .map(|bytes| (address_bytes(bytes), bytes))
        .collect::<Vec<_>>();
    blobs.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    for (label, bytes) in &blobs {
        let mut payload = label.as_bytes().to_vec();
        payload.extend_from_slice(bytes);
        sections.push((SectionKind::ContentBlob, payload));
    }
    let archive = HoloWriter::assemble(sections.clone());
    let plan = HoloLoader::from_bytes(&archive)
        .unwrap()
        .into_plan()
        .unwrap();
    assert_eq!(plan.sections().len(), 8);
    assert_eq!(plan.sections()[0].offset, 202);
    assert_eq!(plan.app_manifest().unwrap(), manifest);
    assert_eq!(plan.content_blobs().unwrap().len(), 4);
    assert_eq!(
        plan.extensions().unwrap(),
        vec![
            (DIRECTORY, directory.as_slice()),
            (profile.provenance(), provenance.as_slice())
        ]
    );
    assert_eq!(
        &archive[archive.len() - 32..],
        blake3::hash(&archive[..archive.len() - 32]).as_bytes()
    );

    let changes: [(&str, usize, Vec<u8>); 10] = [
        ("bad-magic", 0, b"NOLO".to_vec()),
        ("older-version", 4, 3u16.to_le_bytes().to_vec()),
        ("newer-version", 4, 5u16.to_le_bytes().to_vec()),
        ("nonzero-flags", 6, 1u16.to_le_bytes().to_vec()),
        ("nonzero-padding", 11, vec![1]),
        ("wrong-section-count", 8, 9u16.to_le_bytes().to_vec()),
        ("unknown-section-kind", 10, vec![255]),
        ("out-of-range-offset", 18, u64::MAX.to_le_bytes().to_vec()),
        ("payload-inside-table", 18, 10u64.to_le_bytes().to_vec()),
        ("out-of-range-length", 26, u64::MAX.to_le_bytes().to_vec()),
    ];
    let mut malformed = Vec::new();
    for (name, offset, replacement) in changes {
        let mut bytes = archive.clone();
        bytes[offset..offset + replacement.len()].copy_from_slice(&replacement);
        reseal(&mut bytes);
        malformed.push(json!({"name": name, "strict_profile_accepts": false, "bytes_hex": hex(&bytes), "upstream": loader_outcome(&bytes)}));
    }
    let mut bad_footer = archive.clone();
    let last = bad_footer.len() - 1;
    bad_footer[last] ^= 1;
    malformed.push(json!({"name":"bad-footer", "strict_profile_accepts":false, "bytes_hex":hex(&bad_footer), "upstream":loader_outcome(&bad_footer)}));
    let mut trailing = archive.clone();
    trailing.insert(trailing.len() - 32, 0);
    reseal(&mut trailing);
    malformed.push(json!({"name":"trailing-payload-byte", "strict_profile_accepts":false, "bytes_hex":hex(&trailing), "upstream":loader_outcome(&trailing)}));

    let extension_vectors = [("", b"".as_slice()), ("urn:prism:codec", &[0, 128, 255]), ("urn:prism:λ", "π".as_bytes())]
        .map(|(key, value)| json!({"key":key,"value_hex":hex(value),"bytes_hex":hex(&upstream_extension(key,value))}));
    let mut result = json!({
        "schema":"prismpm/holo-codec-oracle/1",
        "scope":"Synthetic wire-codec vectors; not executable-application, conformance, or release acceptance.",
        "oracle":{"repository":"https://github.com/Hologram-Technologies/hologram","revision":REVISION,"crate":"uor-hologram","crate_version":"0.12.1","features":["archive","space"]},
        "labels":[content(b""),content(b"abc"),content(&[0,128,255]),content(guest),content(view),content(model)],
        "empty_capabilities":content(&capabilities),
        "manifest":{"bytes_hex":hex(&manifest),"kappa":address_bytes(&manifest).to_string(),"references":references.iter().map(ToString::to_string).collect::<Vec<_>>(),"primary":0,"layers":[{"kind":0,"content_kappa":address_bytes(guest).to_string(),"entry":"holo_run","aux":WASM_CONTRACT_CORE_V1},{"kind":3,"content_kappa":address_bytes(view).to_string(),"entry":"index.html","aux":profile.surface()}],"children":[]},
        "extensions":extension_vectors,
        "archive_inputs":{"metadata_hex":hex(metadata),"directory_json_hex":hex(directory),"provenance_json_hex":hex(provenance),"blobs_hex":sections[4..].iter().map(|(_,payload)|hex(payload)).collect::<Vec<_>>()},
        "archive":{"bytes_hex":hex(&archive),"body_hex":hex(&archive[..archive.len()-32]),"footer_hex":hex(&archive[archive.len()-32..]),"kappa":address_bytes(&archive).to_string(),"sections":plan.sections().iter().zip(&sections).map(|(section,(_,payload))|json!({"kind":section.kind as u8,"offset":section.offset,"length":section.length,"payload_hex":hex(payload)})).collect::<Vec<_>>()},
        "malformed_archives":malformed,
    });
    if matches!(profile, Profile::Portable) {
        result["attestation"] = attestation_vector(&sections);
    }
    if matches!(profile, Profile::Browser) {
        // Coherent, re-addressed native authority request, not a corrupt byte
        // standing in for a capability substitution.
        let substituted = CapabilitySet::new(Capabilities {
            storage_roots: vec![address_bytes(model)],
            storage_quota_bytes: 0,
            network_fetch_endpoints: Vec::new(),
            network_announce_endpoints: Vec::new(),
            publish_channels: Vec::new(),
            subscribe_channels: Vec::new(),
            memory_max_bytes: 0,
            cpu_time_per_event_ms: 0,
            priority_weight: 0,
        })
        .canonicalize();
        assert_eq!(
            CapabilitySet::new(CapabilitySet::to_capabilities(&substituted).unwrap())
                .canonicalize(),
            substituted
        );
        let mut changed_manifest = AppManifest::decode(&manifest).unwrap();
        changed_manifest.requires = address_bytes(&substituted);
        changed_manifest.validate().unwrap();
        let mut changed = sections[..4].to_vec();
        changed[0].1 = changed_manifest.canonicalize();
        let mut changed_blobs = [substituted.as_slice(), guest, model, view]
            .into_iter()
            .map(|value| {
                let mut payload = address_bytes(value).as_bytes().to_vec();
                payload.extend_from_slice(value);
                payload
            })
            .collect::<Vec<_>>();
        changed_blobs.sort_by(|left, right| left[..71].cmp(&right[..71]));
        changed.extend(
            changed_blobs
                .iter()
                .cloned()
                .map(|payload| (SectionKind::ContentBlob, payload)),
        );
        let archive = HoloWriter::assemble(changed);
        let outcome = loader_outcome(&archive);
        assert_eq!(outcome["stage"], "accepted-physical-archive");
        result["capability_substitution"] = json!({
            "capabilities": content(&substituted),
            "manifest_hex": hex(&changed_manifest.canonicalize()),
            "blobs_hex": changed_blobs.iter().map(|blob| hex(blob)).collect::<Vec<_>>(),
            "archive_hex": hex(&archive),
            "upstream": outcome
        });
    }
    result
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let write = match std::env::args().skip(1).collect::<Vec<_>>().as_slice() {
        [flag] if flag == "--write" => true,
        [] => false,
        _ => return Err("usage: prismpm-holo-codec-oracle [--write]".into()),
    };
    for profile in [Profile::Portable, Profile::Browser] {
        let mut bytes = serde_json::to_vec_pretty(&fixture(profile))?;
        bytes.push(b'\n');
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(profile.fixture_path());
        if write {
            std::fs::write(&path, bytes)?;
        } else if std::fs::read(&path)? != bytes {
            return Err(format!(
                "frozen {} codec fixture differs from exact upstream output",
                profile.surface()
            )
            .into());
        }
    }
    println!("Holo/1 codec fixture matches upstream {REVISION}; no application acceptance claimed");
    Ok(())
}
