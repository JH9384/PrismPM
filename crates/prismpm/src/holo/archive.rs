//! Modeled physical-v4 application composition and strict Holo/1 validation.

use crate::error::PrismError;
use crate::holo::attestation::{self, Attestation};
use crate::holo::canonical::{content_id, encode_value};
use prism_stdlib as wire;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Hologram's required application-directory extension.
pub const DIRECTORY_EXTENSION: &str =
    "https://hologram.foundation/extension/application-directory/v1";
/// Prism's producer-provenance extension.
pub const PRISM_EXTENSION: &str = "https://uor.foundation/extension/prismpm-model/v1";

/// All acyclic, pre-archive inputs required to compose one Holo/1 application.
#[derive(Debug, Clone)]
pub struct ApplicationArchiveInput {
    /// Human product name, used only by generated metadata.
    pub application_name: String,
    /// Core-Wasm v1 guest bytes.
    pub guest_wasm: Vec<u8>,
    /// Canonical HOLOVIEW v1 payload.
    pub view_bundle: Vec<u8>,
    /// Canonical non-Holo Prism model document.
    pub model_document: Vec<u8>,
    /// Canonical generated source-manifest bytes, also the Metadata section.
    pub source_manifest: Vec<u8>,
    /// Closed provenance fields excluding kappas computed by this function.
    pub provenance: ArchiveProvenance,
}

/// Closed pre-archive provenance values.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveProvenance {
    /// LexLean source identity.
    pub source_id: String,
    /// LexLean semantic identity.
    pub semantic_id: String,
    /// LexLean compiler-semantics identity.
    pub compiler_semantics_id: String,
    /// LexLean snapshot identity.
    pub snapshot_id: String,
    /// Generated stdlib semantic identity.
    pub stdlib_semantics_id: String,
    /// SHA-256 of the packaged generated stdlib crate.
    pub prism_stdlib_crate_sha256: String,
    /// Exact LexLean source revision.
    pub lexlean_commit: String,
    /// SHA-256 of the LexLean crate.
    pub lexlean_package_sha256: String,
    /// Exact lean4-prod source revision.
    pub lean4_prod_commit: String,
    /// Pinned independent Hologram Live interoperability-oracle revision.
    pub hologram_live_commit: String,
    /// Pinned independent uor-hologram wire-oracle revision.
    pub uor_hologram_commit: String,
    /// Core-Wasm target profile identity.
    pub target_profile_id: String,
    /// SHA-256 of generated Lean evidence.
    pub lean_manifest_sha256: String,
    /// SHA-256 of LCNF evidence.
    pub lcnf_manifest_sha256: String,
    /// SHA-256 of the generated core source/package closure.
    pub generated_core_sha256: String,
    /// Generated Cargo package name.
    pub cargo_name: String,
    /// Generated Cargo package version.
    pub cargo_version: String,
    /// SHA-256 of the generated `.crate` bytes.
    pub cargo_crate_sha256: String,
    /// Typed View-model identity.
    pub view_model_id: String,
    /// SHA-256 of the generated browser projection.
    pub browser_projection_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "tag", rename_all = "lowercase", deny_unknown_fields)]
enum BrowserProjection {
    None,
    Present { sha256: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "tag", rename_all = "lowercase", deny_unknown_fields)]
enum ViewBinding {
    None,
    Present {
        view_model_id: String,
        view_content_kappa: String,
        browser_projection: BrowserProjection,
    },
}

/// The exact, closed `prismpm/model-provenance/1` wire value.  It deliberately
/// contains only pre-archive evidence: footer, archive, and attestation
/// identities are computed after these bytes have been embedded.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ModelProvenanceV1 {
    schema: String,
    model_content_kappa: String,
    model_id: String,
    source_id: String,
    semantic_id: String,
    compiler_semantics_id: String,
    snapshot_id: String,
    stdlib_semantics_id: String,
    prism_stdlib_crate_sha256: String,
    lexlean_commit: String,
    lexlean_package_sha256: String,
    lean4_prod_commit: String,
    hologram_live_commit: String,
    uor_hologram_commit: String,
    target_profile_id: String,
    core_wasm_contract: String,
    lean_manifest_sha256: String,
    lcnf_manifest_sha256: String,
    generated_core_sha256: String,
    cargo_name: String,
    cargo_version: String,
    cargo_crate_sha256: String,
    guest_content_kappa: String,
    view_binding: ViewBinding,
    application_kappa: String,
}

/// Distinct identities returned with a composed archive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HoloIdentities {
    /// Kappa of the guest layer.
    pub guest_content_kappa: String,
    /// Kappa of the View layer.
    pub view_content_kappa: String,
    /// Kappa of the Prism model blob.
    pub model_content_kappa: String,
    /// Kappa of the canonical application manifest.
    pub application_kappa: String,
    /// Hexadecimal archive footer fingerprint.
    pub archive_fingerprint: String,
    /// Kappa of the complete archive object.
    pub archive_kappa: String,
}

/// Fully composed archive and its extension/evidence payloads.
#[derive(Debug, Clone)]
pub struct GeneratedHolo {
    /// Binary Hologram v4 archive.
    pub bytes: Vec<u8>,
    /// Canonical AppManifest bytes.
    pub application_manifest: Vec<u8>,
    /// Canonical empty CapabilitySet bytes.
    pub capability_request: Vec<u8>,
    /// Canonical application-directory JSON bytes.
    pub directory: Vec<u8>,
    /// Canonical Prism provenance-extension bytes.
    pub prism_extension: Vec<u8>,
    /// All non-interchangeable identities.
    pub identities: HoloIdentities,
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Directory {
    schema_version: u16,
    primary_layer: Option<u32>,
    requires_kappa: String,
    layers: Vec<DirectoryLayer>,
    children: Vec<DirectoryChild>,
    blobs: Vec<DirectoryBlob>,
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct DirectoryLayer {
    position: u32,
    kind: String,
    content_kappa: String,
    entry: String,
    contract: Option<String>,
    architecture: Option<String>,
    surface: Option<String>,
    engine: Option<String>,
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct DirectoryChild {
    position: u32,
    application_kappa: String,
    capabilities_kappa: String,
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct DirectoryBlob {
    kappa: String,
    byte_length: u64,
}

/// The standard BLAKE3 primitive supplies the digest; modeled wire functions
/// own the archive, manifest, capability and content-blob representations.
pub(crate) fn content_kappa(bytes: &[u8]) -> String {
    format!("blake3:{}", blake3::hash(bytes).to_hex())
}

fn modeled<T>(value: Result<T, wire::ComputeError>) -> Result<T, PrismError> {
    value.map_err(|error| {
        PrismError::new("PP3003", format!("modeled Holo wire arithmetic: {error:?}"))
    })
}

fn required<T>(value: Option<T>, code: &'static str, message: &str) -> Result<T, PrismError> {
    value.ok_or_else(|| PrismError::new(code, message))
}

fn directory_layers(guest: &str, view: &str) -> Vec<DirectoryLayer> {
    vec![
        DirectoryLayer {
            position: 0,
            kind: "wasm".to_owned(),
            content_kappa: guest.to_owned(),
            entry: "holo_run".to_owned(),
            contract: Some(wire::contractName()),
            architecture: None,
            surface: None,
            engine: None,
        },
        DirectoryLayer {
            position: 1,
            kind: "view".to_owned(),
            content_kappa: view.to_owned(),
            entry: "index.html".to_owned(),
            contract: None,
            architecture: None,
            surface: Some("portable".to_owned()),
            engine: None,
        },
    ]
}

fn digest_is_valid(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn revision_is_valid(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn validate_provenance(value: &ArchiveProvenance) -> Result<(), PrismError> {
    let digests = [
        &value.source_id,
        &value.semantic_id,
        &value.compiler_semantics_id,
        &value.snapshot_id,
        &value.stdlib_semantics_id,
        &value.prism_stdlib_crate_sha256,
        &value.lexlean_package_sha256,
        &value.target_profile_id,
        &value.lean_manifest_sha256,
        &value.lcnf_manifest_sha256,
        &value.generated_core_sha256,
        &value.cargo_crate_sha256,
        &value.view_model_id,
        &value.browser_projection_sha256,
    ];
    if digests.into_iter().any(|digest| !digest_is_valid(digest))
        || !revision_is_valid(&value.lexlean_commit)
        || !revision_is_valid(&value.lean4_prod_commit)
        || !revision_is_valid(&value.hologram_live_commit)
        || !revision_is_valid(&value.uor_hologram_commit)
        || value.cargo_name.is_empty()
        || value.cargo_version.is_empty()
    {
        return Err(PrismError::new(
            "PP3015",
            "model provenance contains an invalid identity",
        ));
    }
    Ok(())
}

/// Compose one deterministic, self-contained Wasm + portable-View application.
pub fn compose_application(input: &ApplicationArchiveInput) -> Result<GeneratedHolo, PrismError> {
    validate_provenance(&input.provenance)?;
    if input.application_name.is_empty()
        || !input.guest_wasm.starts_with(b"\0asm")
        || !input.view_bundle.starts_with(b"HOLOVIEW\0\x01")
        || input.model_document.first() != Some(&b'{')
    {
        return Err(PrismError::new(
            "PP3010",
            "application layers or model document are malformed",
        ));
    }

    let capability_request = wire::emptyCapabilities();
    let capability_kappa = content_kappa(&capability_request);
    let guest_kappa = content_kappa(&input.guest_wasm);
    let view_kappa = content_kappa(&input.view_bundle);
    let model_kappa = content_kappa(&input.model_document);
    let application_manifest = required(
        wire::appManifest(
            capability_kappa.as_bytes().to_vec(),
            guest_kappa.as_bytes().to_vec(),
            view_kappa.as_bytes().to_vec(),
        ),
        "PP3011",
        "modeled application manifest rejected its references",
    )?;
    let application_kappa = content_kappa(&application_manifest);

    let mut blob_rows = [
        (capability_kappa.as_str(), capability_request.as_slice()),
        (guest_kappa.as_str(), input.guest_wasm.as_slice()),
        (model_kappa.as_str(), input.model_document.as_slice()),
        (view_kappa.as_str(), input.view_bundle.as_slice()),
    ];
    blob_rows.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    let directory_value = Directory {
        schema_version: 1,
        primary_layer: Some(0),
        requires_kappa: capability_kappa.to_string(),
        layers: directory_layers(&guest_kappa, &view_kappa),
        children: Vec::new(),
        blobs: blob_rows
            .iter()
            .map(|(kappa, bytes)| DirectoryBlob {
                kappa: kappa.to_string(),
                byte_length: bytes.len() as u64,
            })
            .collect(),
    };
    let directory = serde_json::to_vec(&directory_value)
        .map_err(|error| PrismError::new("PP9001", error.to_string()))?;

    let model_id = content_id(&input.model_document);
    let provenance = &input.provenance;
    let prism_extension_value = serde_json::to_value(ModelProvenanceV1 {
        schema: "prismpm/model-provenance/1".to_owned(),
        model_content_kappa: model_kappa.to_string(),
        model_id,
        source_id: provenance.source_id.clone(),
        semantic_id: provenance.semantic_id.clone(),
        compiler_semantics_id: provenance.compiler_semantics_id.clone(),
        snapshot_id: provenance.snapshot_id.clone(),
        stdlib_semantics_id: provenance.stdlib_semantics_id.clone(),
        prism_stdlib_crate_sha256: provenance.prism_stdlib_crate_sha256.clone(),
        lexlean_commit: provenance.lexlean_commit.clone(),
        lexlean_package_sha256: provenance.lexlean_package_sha256.clone(),
        lean4_prod_commit: provenance.lean4_prod_commit.clone(),
        hologram_live_commit: provenance.hologram_live_commit.clone(),
        uor_hologram_commit: provenance.uor_hologram_commit.clone(),
        target_profile_id: provenance.target_profile_id.clone(),
        core_wasm_contract: wire::contractName(),
        lean_manifest_sha256: provenance.lean_manifest_sha256.clone(),
        lcnf_manifest_sha256: provenance.lcnf_manifest_sha256.clone(),
        generated_core_sha256: provenance.generated_core_sha256.clone(),
        cargo_name: provenance.cargo_name.clone(),
        cargo_version: provenance.cargo_version.clone(),
        cargo_crate_sha256: provenance.cargo_crate_sha256.clone(),
        guest_content_kappa: guest_kappa.to_string(),
        view_binding: ViewBinding::Present {
            view_model_id: provenance.view_model_id.clone(),
            view_content_kappa: view_kappa.to_string(),
            browser_projection: BrowserProjection::Present {
                sha256: provenance.browser_projection_sha256.clone(),
            },
        },
        application_kappa: application_kappa.to_string(),
    })
    .map_err(|error| PrismError::new("PP9001", error.to_string()))?;
    let prism_extension = encode_value(&prism_extension_value)?;

    let mut blobs = Vec::with_capacity(4);
    for (kappa, bytes) in blob_rows {
        blobs.push(required(
            wire::contentBlob(kappa.as_bytes().to_vec(), bytes.to_vec()),
            "PP3008",
            "modeled content blob rejected its label",
        )?);
    }
    let [blob0, blob1, blob2, blob3]: [Vec<u8>; 4] = blobs.try_into().map_err(|_| {
        PrismError::new(
            "PP3003",
            "archive does not contain exactly four content blobs",
        )
    })?;
    let body = required(
        modeled(wire::archiveBody(
            application_manifest.clone(),
            input.source_manifest.clone(),
            directory.clone(),
            prism_extension.clone(),
            blob0,
            blob1,
            blob2,
            blob3,
        ))?,
        "PP3003",
        "modeled archive composer rejected the closed Holo/1 content",
    )?;
    let fingerprint = blake3::hash(&body);
    let bytes = required(
        modeled(wire::frameArchive(body, fingerprint.as_bytes().to_vec()))?,
        "PP3001",
        "modeled archive framing rejected body or footer",
    )?;
    let identities = HoloIdentities {
        guest_content_kappa: guest_kappa.to_string(),
        view_content_kappa: view_kappa.to_string(),
        model_content_kappa: model_kappa.to_string(),
        application_kappa: application_kappa.to_string(),
        archive_fingerprint: fingerprint.to_hex().to_string(),
        archive_kappa: content_kappa(&bytes),
    };
    validate_application(&bytes)?;
    Ok(GeneratedHolo {
        bytes,
        application_manifest,
        capability_request,
        directory,
        prism_extension,
        identities,
    })
}

/// Strictly validate the closed Holo/1 Calculator/portable-app archive profile.
///
/// The archive has eight rows, or nine when it carries the attestation section
/// (`docs/proposals/267-attestation-bundle.md`). Both shapes validate.
pub fn validate_application(bytes: &[u8]) -> Result<(), PrismError> {
    parse_application(bytes).map(|_| ())
}

/// Frame a body with the BLAKE3 footer over every byte before it.
fn seal_body(body: Vec<u8>) -> Result<Vec<u8>, PrismError> {
    let fingerprint = blake3::hash(&body);
    required(
        modeled(wire::frameArchive(body, fingerprint.as_bytes().to_vec()))?,
        "PP3001",
        "modeled archive framing rejected body or footer",
    )
}

/// The attestation section's payload, absent for an eight-row archive. The
/// wire model has already checked the row, its name, its position and its line
/// framing.
fn attestation_payload(bytes: &[u8]) -> Result<Option<Vec<u8>>, PrismError> {
    modeled(wire::archiveAttestation(bytes.to_vec()))
}

/// Every bundle of the archive's attestation section, in section order. An
/// archive without the section reports none. Nothing is verified here: a
/// bundle is decoded, its signature is not checked.
pub fn read_attestations(bytes: &[u8]) -> Result<Vec<Attestation>, PrismError> {
    let parsed = parse_application(bytes)?;
    match attestation_payload(bytes)? {
        None => Ok(Vec::new()),
        Some(payload) => attestation::decode_section(&payload, &parsed.blobs),
    }
}

/// A new archive with `bundles` added to the attestation section, creating it
/// as the last row when absent. Rows 0 to 7 keep their bytes, offsets shift by
/// one table row and the footer is recomputed. The input must already
/// validate, and every bundle must be a well-formed line of its own.
pub fn attach_attestations(bytes: &[u8], bundles: &[Vec<u8>]) -> Result<Vec<u8>, PrismError> {
    if bundles.is_empty() {
        return Err(PrismError::new(
            "PP3016",
            "attaching attestations takes at least one bundle",
        ));
    }
    let parsed = parse_application(bytes)?;
    let mut lines: Vec<Vec<u8>> = match attestation_payload(bytes)? {
        None => Vec::new(),
        Some(payload) => attestation::decode_section(&payload, &parsed.blobs)?
            .into_iter()
            .map(|bundle| bundle.line)
            .collect(),
    };
    for line in bundles {
        attestation::decode_bundle(lines.len(), line, &parsed.blobs)?;
        if lines.contains(line) {
            return Err(PrismError::new(
                "PP3016",
                "the same bundle bytes are already in the archive",
            ));
        }
        lines.push(line.clone());
    }
    let unsigned = match modeled(wire::archiveStripAttestation(bytes.to_vec()))? {
        Some(body) => body,
        None => required(
            modeled(wire::archiveBodyBytes(bytes.to_vec()))?,
            "PP3003",
            "archive structure is not the closed Holo/1 profile",
        )?,
    };
    let body = required(
        modeled(wire::archiveBodyWithAttestation(
            unsigned,
            attestation::join_lines(&lines),
        ))?,
        "PP3016",
        "modeled archive composer rejected the attestation section",
    )?;
    let signed = seal_body(body)?;
    validate_application(&signed)?;
    Ok(signed)
}

/// The archive without its attestation section. For an archive produced by
/// [`attach_attestations`] from a validated one this is byte-identical to the
/// original, so reproducibility checks compare it rather than the signed file.
/// An archive without the section is returned unchanged.
pub fn strip_attestations(bytes: &[u8]) -> Result<Vec<u8>, PrismError> {
    validate_application(bytes)?;
    match modeled(wire::archiveStripAttestation(bytes.to_vec()))? {
        None => Ok(bytes.to_vec()),
        Some(body) => seal_body(body),
    }
}

/// Already validated owned wire values shared by archive and release validation.
pub(crate) struct ParsedApplicationArchive {
    pub(crate) application_manifest: Vec<u8>,
    pub(crate) metadata: Vec<u8>,
    pub(crate) directory: Vec<u8>,
    pub(crate) prism_extension: Vec<u8>,
    pub(crate) blobs: BTreeMap<String, Vec<u8>>,
    pub(crate) identities: HoloIdentities,
}

struct DecodedWireArchive {
    manifest: Vec<u8>,
    metadata: Vec<u8>,
    directory: Vec<u8>,
    prism_extension: Vec<u8>,
    blobs: BTreeMap<String, Vec<u8>>,
    references: [String; 3],
    fingerprint: String,
}

fn decode_wire_archive(bytes: &[u8]) -> Result<DecodedWireArchive, PrismError> {
    if bytes.starts_with(b"{") || !bytes.starts_with(b"HOLO\x04\0") {
        return Err(PrismError::new(
            "PP3001",
            "a .holo file must be a binary physical-v4 archive",
        ));
    }
    // These modeled accessors reject the complete closed structure before
    // exposing payloads. No host-side table, length or manifest parser exists.
    let body = required(
        modeled(wire::archiveBodyBytes(bytes.to_vec()))?,
        "PP3003",
        "archive structure is not the closed Holo/1 profile",
    )?;
    let footer = required(
        modeled(wire::archiveFooter(bytes.to_vec()))?,
        "PP3001",
        "archive has no modeled footer",
    )?;
    let fingerprint = blake3::hash(&body);
    drop(body);
    if fingerprint.as_bytes().as_slice() != footer.as_slice() {
        return Err(PrismError::new(
            "PP3004",
            "archive footer does not match its body",
        ));
    }
    let section = |index| {
        required(
            modeled(wire::archiveSection(bytes.to_vec(), index))?,
            "PP3003",
            "archive omits a modeled section",
        )
    };
    let manifest = section(0)?;
    let metadata = section(1)?;
    let mut references = Vec::with_capacity(3);
    for index in 0..3 {
        let reference = required(
            modeled(wire::manifestReference(manifest.clone(), index))?,
            "PP3005",
            "manifest omits a modeled reference",
        )?;
        references.push(
            String::from_utf8(reference)
                .map_err(|error| PrismError::new("PP3005", format!("manifest label: {error}")))?,
        );
    }
    let mut seen = BTreeMap::new();
    for index in 4..8 {
        let blob = section(index)?;
        let label = required(
            wire::contentBlobLabel(blob.clone()),
            "PP3008",
            "invalid blob label",
        )?;
        let content = required(
            wire::contentBlobBytes(blob),
            "PP3008",
            "invalid blob payload",
        )?;
        let label = String::from_utf8(label)
            .map_err(|error| PrismError::new("PP3008", format!("blob label: {error}")))?;
        if content_kappa(&content) != label || seen.insert(label, content).is_some() {
            return Err(PrismError::new(
                "PP3008",
                "content blob label is duplicate or does not match its bytes",
            ));
        }
    }
    let extension = |index| {
        required(
            modeled(wire::archiveExtension(bytes.to_vec(), index))?,
            "PP3013",
            "archive omits a modeled extension",
        )
    };
    Ok(DecodedWireArchive {
        manifest,
        metadata,
        directory: extension(0)?,
        prism_extension: extension(1)?,
        blobs: seen,
        references: references
            .try_into()
            .map_err(|_| PrismError::new("PP3005", "manifest reference count differs"))?,
        fingerprint: fingerprint.to_hex().to_string(),
    })
}

pub(crate) fn parse_application(bytes: &[u8]) -> Result<ParsedApplicationArchive, PrismError> {
    let decoded = decode_wire_archive(bytes)?;
    let manifest_bytes = &decoded.manifest;
    let [requires, guest, view] = &decoded.references;
    let seen = &decoded.blobs;
    let declared: Directory = serde_json::from_slice(&decoded.directory)
        .map_err(|error| PrismError::new("PP3012", format!("directory: {error}")))?;
    let expected_blobs = seen
        .iter()
        .map(|(label, content)| DirectoryBlob {
            kappa: label.clone(),
            byte_length: content.len() as u64,
        })
        .collect::<Vec<_>>();
    if declared.schema_version != 1
        || declared.primary_layer != Some(0)
        || declared.requires_kappa != *requires
        || declared.layers != directory_layers(guest, view)
        || declared.children != Vec::<DirectoryChild>::new()
        || declared.blobs != expected_blobs
        || serde_json::to_vec(&declared)
            .map_err(|error| PrismError::new("PP3012", error.to_string()))?
            != decoded.directory
    {
        return Err(PrismError::new(
            "PP3012",
            "application directory disagrees with manifest or blobs",
        ));
    }
    let provenance: ModelProvenanceV1 = serde_json::from_slice(&decoded.prism_extension)
        .map_err(|error| PrismError::new("PP3015", format!("Prism extension: {error}")))?;
    let (view_model_id, view_content_kappa, browser_sha256) = match &provenance.view_binding {
        ViewBinding::Present {
            view_model_id,
            view_content_kappa,
            browser_projection: BrowserProjection::Present { sha256 },
        } => (view_model_id, view_content_kappa, sha256),
        _ => {
            return Err(PrismError::new(
                "PP3015",
                "portable View applications require a bound browser projection",
            ));
        }
    };
    let model_bytes = seen.get(&provenance.model_content_kappa);
    let guest_bytes = seen.get(&provenance.guest_content_kappa);
    let view_bytes = seen.get(view_content_kappa);
    let digest_fields = [
        &provenance.model_id,
        &provenance.source_id,
        &provenance.semantic_id,
        &provenance.compiler_semantics_id,
        &provenance.snapshot_id,
        &provenance.stdlib_semantics_id,
        &provenance.prism_stdlib_crate_sha256,
        &provenance.lexlean_package_sha256,
        &provenance.target_profile_id,
        &provenance.lean_manifest_sha256,
        &provenance.lcnf_manifest_sha256,
        &provenance.generated_core_sha256,
        &provenance.cargo_crate_sha256,
        view_model_id,
        browser_sha256,
    ];
    if provenance.schema != "prismpm/model-provenance/1"
        || provenance.core_wasm_contract != wire::contractName()
        || provenance.application_kappa != content_kappa(manifest_bytes)
        || provenance.guest_content_kappa != *guest
        || *view_content_kappa != *view
        || model_bytes.is_none()
        || guest_bytes.is_none_or(|bytes| !bytes.starts_with(b"\0asm"))
        || view_bytes.is_none_or(|bytes| !bytes.starts_with(b"HOLOVIEW\0\x01"))
        || model_bytes.is_none_or(|bytes| content_id(bytes) != provenance.model_id)
        || digest_fields
            .into_iter()
            .any(|digest| !digest_is_valid(digest))
        || !revision_is_valid(&provenance.lexlean_commit)
        || !revision_is_valid(&provenance.lean4_prod_commit)
        || !revision_is_valid(&provenance.hologram_live_commit)
        || !revision_is_valid(&provenance.uor_hologram_commit)
        || provenance.cargo_name.is_empty()
        || provenance.cargo_version.is_empty()
        || [requires, guest, view, &provenance.model_content_kappa]
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
            != seen.keys().collect::<std::collections::BTreeSet<_>>()
        || encode_value(
            &serde_json::to_value(&provenance)
                .map_err(|error| PrismError::new("PP3015", error.to_string()))?,
        )? != decoded.prism_extension
    {
        return Err(PrismError::new(
            "PP3015",
            "Prism provenance is missing or disagrees with archive content",
        ));
    }
    let identities = HoloIdentities {
        guest_content_kappa: guest.clone(),
        view_content_kappa: view.clone(),
        model_content_kappa: provenance.model_content_kappa,
        application_kappa: content_kappa(manifest_bytes),
        archive_fingerprint: decoded.fingerprint,
        archive_kappa: content_kappa(bytes),
    };
    Ok(ParsedApplicationArchive {
        application_manifest: decoded.manifest,
        metadata: decoded.metadata,
        directory: decoded.directory,
        prism_extension: decoded.prism_extension,
        blobs: decoded.blobs,
        identities,
    })
}

#[cfg(test)]
#[path = "archive_tests.rs"]
mod tests;
