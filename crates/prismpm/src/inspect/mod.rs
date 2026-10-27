//! `inspect` on a `.holo`: what an archive says about itself, read without
//! running it.
//!
//! The result is `prismpm/holo-inspection/1`, the shape the JavaScript half
//! prints (`prism-code inspect`, issue #271,
//! `sdk/npm/prism-code/src/inspect.mjs`). Both readers report the same values
//! for the reference archive. The Rust side reads the section table through
//! the modeled `Foundation.Holo.V1.Wire` accessors — `wireSectionKind`,
//! `wireRowOffset`, `wireRowLength`, `wireSectionBytesUnchecked` — never
//! through a host-side table parser, so a change to the wire model moves this
//! reader with it.
//!
//! Digests follow ADR-015: every digest set holds `sha256` and `blake3` over
//! one byte string. A section's `digest` covers exactly its table bytes,
//! `offset` to `offset + length` in the body. A content blob also reports
//! `content.digest` over the bytes after its label, whose `blake3` equals the
//! label. The footer is BLAKE3 of the body, never of the file.

use crate::error::PrismError;
use crate::holo::archive::{content_kappa, parse_application};
use prism_stdlib as wire;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// The schema identifier of one inspection.
pub const INSPECTION_SCHEMA: &str = "prismpm/holo-inspection/1";

/// The guest contract of the only world this revision registers (issue #278),
/// and the world row itself: `sdk/npm/spec/constants.mjs`, `WORLDS`.
const CORE_WASM_CONTRACT: &str = "hologram:guest/core-wasm@1";
const CORE_WASM_PACKAGE: &str = "hologram:guest@1.0.0";
const CORE_WASM_WORLD: &str = "core-wasm";
const CORE_WASM_WORLD_FILE: &str = "worlds/core-wasm.wit";
const CORE_WASM_WORLD_BLAKE3: &str =
    "0774a8ecbfa945a427712ee7d7ad406195b2d07492ceae15cca0067276c9ced8";
const CORE_WASM_WORLD_SHA256: &str =
    "a566c87a359cadf98f652747f1b3574aa307ff5f652a190c6d99c350db9cf369";

/// The manifest suffix fields, which every revision of the format fixes. The
/// tests hold them against the modeled suffix bytes.
const MANIFEST_ENTRY: &str = "holo_run";
const VIEW_ENTRY: &str = "index.html";
const MANIFEST_SURFACE: &str = "portable";

/// Section kinds of the Holo/1 table (`Foundation.Holo.V1.Wire`).
const KIND_APP_MANIFEST: u8 = 15;
const KIND_METADATA: u8 = 8;
const KIND_EXTENSION: u8 = 14;
const KIND_CONTENT_BLOB: u8 = 16;

/// The revision whose every identifier the reference archive carries. A future
/// revision is named by date (STABILITY.md section 3) and added here, never
/// edited in place.
const REVISION_2026_10_23: &str = "2026-10-23";
const REVISION_2026_10_23_SECTIONS: [u8; 8] = [15, 8, 14, 14, 16, 16, 16, 16];
const MODEL_DOCUMENT_SCHEMAS: [&str; 4] = [
    "prismpm/model-document/1",
    "prismpm/model-document/2",
    "prismpm/model-document/5",
    "prismpm/model-document/6",
];
const HOLOVIEW_MAGIC: &[u8] = b"HOLOVIEW";
const HOLOVIEW_VERSION: u64 = 1;
const SOURCE_MANIFEST_VERSION: u64 = 4;
const PROVENANCE_SCHEMA: &str = "prismpm/model-provenance/1";

/// Effects that make a world impure (issue #283): a guest importing one can
/// see something a replay cannot reproduce.
const IMPURE_EFFECTS: [&str; 5] = ["clock", "random", "socket", "filesystem", "unknown"];
const WASI_INTERFACES: [(&str, &str); 5] = [
    ("wasi:clocks/", "clock"),
    ("wasi:random/", "random"),
    ("wasi:sockets/", "socket"),
    ("wasi:http/", "socket"),
    ("wasi:filesystem/", "filesystem"),
];
const WASI_PREVIEW1_DETERMINISTIC: [&str; 7] = [
    "proc_exit",
    "proc_raise",
    "sched_yield",
    "args_get",
    "args_sizes_get",
    "environ_get",
    "environ_sizes_get",
];

/// The world's declared exports, in the order a conforming module exports
/// them: the canonical ABI names, lowered signatures and the exported memory.
const WORLD_EXPORTS: [(&str, &str, &[&str], &[&str]); 3] = [
    ("holo_alloc", "func", &["i32"], &["i32"]),
    ("holo_run", "func", &["i32", "i32"], &["i64"]),
    ("memory", "memory", &[], &[]),
];

fn modeled<T>(value: Result<T, wire::ComputeError>) -> Result<T, PrismError> {
    value.map_err(|error| {
        PrismError::new("PP3003", format!("modeled Holo wire arithmetic: {error:?}"))
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn blake3_hex(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

fn hex(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}

fn digest_set(bytes: &[u8]) -> Value {
    json!({ "sha256": sha256_hex(bytes), "blake3": blake3_hex(bytes) })
}

/// The identifier a modeled prefix or a row opens with. An extension row opens
/// with the identifier's little-endian `u16` length; the manifest prefix
/// carries the identifier bare. Either way the identifier ends at the first
/// zero byte when it is bare.
fn prefix_identifier(bytes: &[u8]) -> String {
    if bytes.len() >= 3 && bytes[1] == 0 {
        let length = usize::from(bytes[0]);
        if length > 0 && length + 2 <= bytes.len() {
            return String::from_utf8_lossy(&bytes[2..2 + length]).into_owned();
        }
    }
    let end = rest_end(bytes);
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

fn rest_end(bytes: &[u8]) -> usize {
    bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len())
}

/// One member of a declaration, or null when the document omits it, as the
/// JavaScript reader's `?? null` reads it.
fn member(value: &Value, key: &str) -> Value {
    match value.get(key) {
        Some(Value::Number(_)) | Some(Value::String(_)) => value[key].clone(),
        _ => Value::Null,
    }
}

fn section_kind_name(kind: u8) -> &'static str {
    match kind {
        KIND_APP_MANIFEST => "app-manifest",
        KIND_METADATA => "metadata",
        KIND_EXTENSION => "extension",
        KIND_CONTENT_BLOB => "content-blob",
        _ => "unknown",
    }
}

fn holoview_version(content: &[u8]) -> Option<u64> {
    if content.len() < 10 || &content[..8] != HOLOVIEW_MAGIC {
        return None;
    }
    Some(u64::from(u16::from_be_bytes([content[8], content[9]])))
}

fn source_manifest_version(metadata: &[u8]) -> Option<u64> {
    let document: Value = serde_json::from_slice(metadata).ok()?;
    document.get("version")?.as_u64()
}

/// Every identifier one revision fixes, as this reader observes them.
struct ObservedRevision {
    kind_sequence: Vec<u8>,
    manifest_uri: String,
    extension_names: Vec<String>,
    contract: Option<String>,
    holoview_version: Option<u64>,
    source_manifest_version: Option<u64>,
    provenance_schema: Option<String>,
    model_document_schema: Option<String>,
}

/// The first revision whose every identifier this archive carries, or null.
fn recognize_revision(observed: &ObservedRevision) -> Option<&'static str> {
    let recognized = observed.kind_sequence == REVISION_2026_10_23_SECTIONS
        && observed.manifest_uri == prefix_identifier(&wire::wireManifestPrefix())
        && observed.extension_names
            == [
                prefix_identifier(&wire::wireDirectoryPrefix()),
                prefix_identifier(&wire::wireProvenancePrefix()),
            ]
        && observed.contract.as_deref() == Some(wire::contractName().as_str())
        && observed.holoview_version == Some(HOLOVIEW_VERSION)
        && observed.source_manifest_version == Some(SOURCE_MANIFEST_VERSION)
        && observed.provenance_schema.as_deref() == Some(PROVENANCE_SCHEMA)
        && observed
            .model_document_schema
            .as_deref()
            .is_some_and(|schema| MODEL_DOCUMENT_SCHEMAS.contains(&schema));
    recognized.then_some(REVISION_2026_10_23)
}

/// One row of the section table, with the identifiers an inspection reports
/// and the classification needs.
struct Section {
    index: u64,
    kind: u8,
    offset: u64,
    length: u64,
    bytes: Vec<u8>,
    label: Option<String>,
    content: Option<Vec<u8>>,
    name: Option<String>,
    role: &'static str,
}

impl Section {
    fn value(&self) -> Value {
        let mut entry = Map::new();
        entry.insert("index".to_owned(), json!(self.index));
        entry.insert("kind".to_owned(), json!(self.kind));
        entry.insert("kind_name".to_owned(), json!(section_kind_name(self.kind)));
        entry.insert("role".to_owned(), json!(self.role));
        entry.insert("offset".to_owned(), json!(self.offset));
        entry.insert("length".to_owned(), json!(self.length));
        entry.insert("digest".to_owned(), digest_set(&self.bytes));
        if let Some(name) = &self.name {
            entry.insert("name".to_owned(), json!(name));
        }
        if let Some(label) = &self.label {
            let content = self.content.as_deref().unwrap_or_default();
            entry.insert("label".to_owned(), json!(label));
            entry.insert(
                "content".to_owned(),
                json!({
                    "length": content.len(),
                    "digest": digest_set(content),
                    "label_matches": format!("blake3:{}", blake3_hex(content)) == *label,
                }),
            );
        }
        Value::Object(entry)
    }
}

/// The role of one section, by kind and by the identifiers of the archive.
fn section_role(
    kind: u8,
    name: Option<&str>,
    label: Option<&str>,
    manifest_labels: &[String],
    model_label: Option<&str>,
) -> &'static str {
    let is = |value: Option<&str>, expected: Option<&String>| {
        value.is_some() && value == expected.map(String::as_str)
    };
    match kind {
        KIND_APP_MANIFEST => "app-manifest",
        KIND_METADATA => "source-manifest",
        KIND_EXTENSION => {
            if name == Some(prefix_identifier(&wire::wireDirectoryPrefix()).as_str()) {
                "application-directory"
            } else if name == Some(prefix_identifier(&wire::wireProvenancePrefix()).as_str()) {
                "model-provenance"
            } else {
                "extension"
            }
        }
        KIND_CONTENT_BLOB => {
            if is(label, manifest_labels.first()) {
                "capability-set"
            } else if is(label, manifest_labels.get(1)) {
                "guest"
            } else if is(label, manifest_labels.get(2)) {
                "view"
            } else if label.is_some() && label == model_label {
                "model-document"
            } else {
                "content-blob"
            }
        }
        _ => "unknown",
    }
}

/// Read every row of the table. The modeled kind accessor returns no kind past
/// the last row, which is the bound here.
fn read_sections(
    body: &[u8],
    manifest_labels: &[String],
    model_label: Option<&str>,
) -> Result<Vec<Section>, PrismError> {
    let directory_prefix = wire::wireDirectoryPrefix();
    let provenance_prefix = wire::wireProvenancePrefix();
    let mut sections = Vec::new();
    loop {
        let index = sections.len() as u64;
        let Ok([kind]) = <[u8; 1]>::try_from(wire::wireSectionKind(index).as_slice()) else {
            break;
        };
        let bytes = modeled(wire::wireSectionBytesUnchecked(body.to_vec(), index))
            .map_err(|_| PrismError::new("PP3003", "archive row is not bounded by its body"))?;
        let offset = modeled(wire::wireRowOffset(body.to_vec(), index))?;
        let length = modeled(wire::wireRowLength(body.to_vec(), index))?;
        let (label, content, name) = match kind {
            KIND_EXTENSION => {
                let name = if bytes.starts_with(&directory_prefix) {
                    prefix_identifier(&directory_prefix)
                } else if bytes.starts_with(&provenance_prefix) {
                    prefix_identifier(&provenance_prefix)
                } else {
                    prefix_identifier(&bytes)
                };
                (None, None, Some(name))
            }
            KIND_CONTENT_BLOB => {
                let label =
                    String::from_utf8_lossy(&wire::wireBlobLabel(bytes.clone())).into_owned();
                let content = wire::wireBlobContent(bytes.clone());
                (Some(label), Some(content), None)
            }
            _ => (None, None, None),
        };
        let role = section_role(
            kind,
            name.as_deref(),
            label.as_deref(),
            manifest_labels,
            model_label,
        );
        sections.push(Section {
            index,
            kind,
            offset,
            length,
            bytes,
            label,
            content,
            name,
            role,
        });
    }
    if sections.is_empty() {
        return Err(PrismError::new(
            "PP3003",
            "archive carries no modeled section table",
        ));
    }
    Ok(sections)
}

/// One import of a core module.
struct Import {
    module: String,
    field: String,
}

/// One export of a core module, with the signature of a function export.
struct Export {
    field: String,
    kind: String,
    signature: Option<(Vec<String>, Vec<String>)>,
}

struct Interface {
    imports: Vec<Import>,
    exports: Vec<Export>,
}

fn value_type(byte: u8) -> String {
    match byte {
        0x7f => "i32".to_owned(),
        0x7e => "i64".to_owned(),
        0x7d => "f32".to_owned(),
        0x7c => "f64".to_owned(),
        _ => "other".to_owned(),
    }
}

fn external_kind(byte: u8) -> &'static str {
    match byte {
        0 => "func",
        1 => "table",
        2 => "memory",
        3 => "global",
        4 => "tag",
        _ => "other",
    }
}

/// The imports and exports of a core module, read from its own sections.
/// Nothing is compiled or instantiated; bytes this reader cannot follow are
/// reported as unreadable rather than refused.
fn read_interface(bytes: &[u8]) -> Option<Interface> {
    if bytes.len() < 8 || &bytes[..4] != b"\0asm" || bytes[4..8] != [1, 0, 0, 0] {
        return None;
    }
    let mut at = 8usize;
    let mut types: Vec<(Vec<String>, Vec<String>)> = Vec::new();
    let mut functions: Vec<u64> = Vec::new();
    let mut imports = Vec::new();
    let mut exports = Vec::new();
    let mut imported_functions = 0u64;
    while at < bytes.len() {
        let id = *bytes.get(at)?;
        at += 1;
        let size = leb(bytes, &mut at)? as usize;
        let end = at.checked_add(size)?;
        if end > bytes.len() {
            return None;
        }
        match id {
            1 => {
                for _ in 0..leb(bytes, &mut at)? {
                    if *bytes.get(at)? != 0x60 {
                        return None;
                    }
                    at += 1;
                    let mut parameters = Vec::new();
                    for _ in 0..leb(bytes, &mut at)? {
                        parameters.push(value_type(*bytes.get(at)?));
                        at += 1;
                    }
                    let mut results = Vec::new();
                    for _ in 0..leb(bytes, &mut at)? {
                        results.push(value_type(*bytes.get(at)?));
                        at += 1;
                    }
                    types.push((parameters, results));
                }
            }
            2 => {
                for _ in 0..leb(bytes, &mut at)? {
                    let module = name(bytes, &mut at)?;
                    let field = name(bytes, &mut at)?;
                    let kind = *bytes.get(at)?;
                    at += 1;
                    match external_kind(kind) {
                        "func" => {
                            leb(bytes, &mut at)?;
                            imported_functions += 1;
                        }
                        "table" => {
                            at += 1;
                            limits(bytes, &mut at)?;
                        }
                        "memory" => limits(bytes, &mut at)?,
                        "global" => {
                            at += 2;
                        }
                        // A tag or an unknown kind: the rest of the section is
                        // not needed, so it is recorded and the section ends.
                        other => {
                            imports.push(Import {
                                module,
                                field: other.to_owned(),
                            });
                            break;
                        }
                    }
                    imports.push(Import { module, field });
                }
            }
            3 => {
                for _ in 0..leb(bytes, &mut at)? {
                    functions.push(leb(bytes, &mut at)?);
                }
            }
            7 => {
                for _ in 0..leb(bytes, &mut at)? {
                    let field = name(bytes, &mut at)?;
                    let kind = *bytes.get(at)?;
                    at += 1;
                    let index = leb(bytes, &mut at)?;
                    let signature = (external_kind(kind) == "func")
                        .then(|| {
                            index
                                .checked_sub(imported_functions)
                                .and_then(|position| functions.get(position as usize))
                                .and_then(|position| types.get(*position as usize))
                                .cloned()
                        })
                        .flatten();
                    exports.push(Export {
                        field,
                        kind: external_kind(kind).to_owned(),
                        signature,
                    });
                }
            }
            _ => {}
        }
        at = end;
    }
    Some(Interface { imports, exports })
}

fn leb(bytes: &[u8], at: &mut usize) -> Option<u64> {
    let mut result = 0u64;
    let mut shift = 0u32;
    while shift < 35 {
        let byte = *bytes.get(*at)?;
        *at += 1;
        result += u64::from(byte & 0x7f) << shift;
        if byte < 0x80 {
            return Some(result);
        }
        shift += 7;
    }
    None
}

fn name(bytes: &[u8], at: &mut usize) -> Option<String> {
    let length = leb(bytes, at)? as usize;
    let slice = bytes.get(*at..at.checked_add(length)?)?;
    *at += length;
    String::from_utf8(slice.to_vec()).ok()
}

fn limits(bytes: &[u8], at: &mut usize) -> Option<()> {
    let flag = *bytes.get(*at)?;
    *at += 1;
    leb(bytes, at)?;
    if flag & 1 != 0 {
        leb(bytes, at)?;
    }
    Some(())
}

/// The effect of one import: `clock`, `random`, `socket`, `filesystem`, `none`
/// for an import known to be deterministic, or `unknown` (issue #283).
fn classify_import(module: &str, field: &str) -> &'static str {
    for (prefix, effect) in WASI_INTERFACES {
        if module.starts_with(prefix) {
            return effect;
        }
    }
    if module == "wasi_snapshot_preview1" || module == "wasi_unstable" {
        if field.starts_with("clock_") {
            return "clock";
        }
        if field == "random_get" {
            return "random";
        }
        if field.starts_with("sock_") || field == "poll_oneoff" {
            return "socket";
        }
        if field.starts_with("fd_") || field.starts_with("path_") {
            return "filesystem";
        }
        if WASI_PREVIEW1_DETERMINISTIC.contains(&field) {
            return "none";
        }
    }
    "unknown"
}

/// Whether the guest module has the interface its contract's world declares.
/// `null` when no guest module is at hand, as the JavaScript reader reports it.
fn conforms(guest: Option<&[u8]>) -> Value {
    let Some(guest) = guest else {
        return Value::Null;
    };
    let Some(interface) = read_interface(guest) else {
        return json!(false);
    };
    let mut problems = !interface.imports.is_empty();
    // Matched by name, never by position: a linker orders the export section
    // as it likes, and the world declares the interface, not the order.
    let mut have: BTreeMap<&str, &Export> = BTreeMap::new();
    for export in &interface.exports {
        if have.insert(export.field.as_str(), export).is_some() {
            problems = true;
        }
    }
    if have.len() != WORLD_EXPORTS.len() {
        problems = true;
    }
    for (name, kind, parameters, results) in WORLD_EXPORTS {
        let Some(found) = have.get(name) else {
            problems = true;
            continue;
        };
        if found.kind != kind {
            problems = true;
            continue;
        }
        if kind == "func" {
            let expected = (
                parameters
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect::<Vec<String>>(),
                results
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect::<Vec<String>>(),
            );
            if found.signature.as_ref() != Some(&expected) {
                problems = true;
            }
        }
    }
    json!(!problems)
}

/// Whether the world is pure, and which declared effects stop it.
fn world_purity(imports: &[Import]) -> (bool, Value) {
    let mut effects: Vec<&str> = imports
        .iter()
        .map(|entry| classify_import(&entry.module, &entry.field))
        .filter(|effect| IMPURE_EFFECTS.contains(effect))
        .collect();
    effects.sort_unstable();
    effects.dedup();
    (effects.is_empty(), json!(effects))
}

/// The world member of an inspection, or null for a contract this reader has
/// no world for.
fn world_member(
    contract: Option<&str>,
    guest: Option<&[u8]>,
    capabilities: Option<&Section>,
) -> Value {
    if contract != Some(CORE_WASM_CONTRACT) {
        return Value::Null;
    }
    let (pure, effects) = world_purity(&[]);
    let capability_set = capabilities.map_or(Value::Null, |section| {
        let content = section.content.as_deref().unwrap_or_default();
        json!({
            "label": section.label.clone().unwrap_or_default(),
            "empty": content == wire::emptyCapabilities(),
        })
    });
    json!({
        "contract": CORE_WASM_CONTRACT,
        "package": CORE_WASM_PACKAGE,
        "name": CORE_WASM_WORLD,
        "file": CORE_WASM_WORLD_FILE,
        "digest": { "blake3": CORE_WASM_WORLD_BLAKE3, "sha256": CORE_WASM_WORLD_SHA256 },
        "imports": [],
        "exports": ["holo_alloc", "holo_run", "memory"],
        "conforms": conforms(guest),
        "pure": pure,
        "effects": effects,
        "capability_set": capability_set,
    })
}

/// The rows of every section of one kind.
fn sections_of_kind(bytes: &[u8], body: &[u8], kind: u8) -> Result<Vec<Section>, PrismError> {
    let mut found = Vec::new();
    let mut index = 0u64;
    let _ = bytes;
    while let Ok([section_kind]) = <[u8; 1]>::try_from(wire::wireSectionKind(index).as_slice()) {
        if section_kind == kind {
            found.push(Section {
                index,
                kind,
                offset: modeled(wire::wireRowOffset(body.to_vec(), index))?,
                length: modeled(wire::wireRowLength(body.to_vec(), index))?,
                bytes: modeled(wire::wireSectionBytesUnchecked(body.to_vec(), index))?,
                label: None,
                content: None,
                name: None,
                role: "unknown",
            });
        }
        index += 1;
    }
    Ok(found)
}

/// One extension payload, as the modeled accessor exposes it.
fn payload(bytes: &[u8], index: u64) -> Value {
    wire::archiveExtension(bytes.to_vec(), index)
        .ok()
        .flatten()
        .and_then(|payload| serde_json::from_slice(&payload).ok())
        .unwrap_or(Value::Null)
}

/// Inspect one archive. Structural damage is refused; integrity findings are
/// reported in `verification` so a damaged archive can still be looked at.
pub fn inspect(bytes: &[u8]) -> Result<Value, PrismError> {
    if bytes.len() < 42 || !bytes.starts_with(b"HOLO") {
        return Err(PrismError::new(
            "PP3001",
            "a .holo file must be a binary physical-v4 archive",
        ));
    }
    let physical_version = u64::from(u16::from_le_bytes([bytes[4], bytes[5]]));
    let flags = u64::from(u16::from_le_bytes([bytes[6], bytes[7]]));
    let body = modeled(wire::archiveBodyBytes(bytes.to_vec()))?
        .ok_or_else(|| PrismError::new("PP3003", "archive has no modeled body"))?;
    let footer = modeled(wire::archiveFooter(bytes.to_vec()))?
        .ok_or_else(|| PrismError::new("PP3001", "archive has no modeled footer"))?;

    let manifest = sections_of_kind(bytes, &body, KIND_APP_MANIFEST)?
        .first()
        .ok_or_else(|| PrismError::new("PP3003", "archive carries no app-manifest row"))?
        .bytes
        .clone();
    let metadata = sections_of_kind(bytes, &body, KIND_METADATA)?
        .first()
        .map(|section| section.bytes.clone())
        .unwrap_or_default();

    let mut manifest_labels = Vec::new();
    for index in 0..3 {
        let reference = wire::manifestReference(manifest.clone(), index)
            .ok()
            .flatten()
            .ok_or_else(|| PrismError::new("PP3005", "manifest omits a modeled reference"))?;
        manifest_labels.push(String::from_utf8_lossy(&reference).into_owned());
    }

    let directory = payload(bytes, 0);
    let provenance = payload(bytes, 1);
    let model_label = provenance
        .get("model_content_kappa")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let sections = read_sections(&body, &manifest_labels, model_label.as_deref())?;
    let section_values: Vec<Value> = sections.iter().map(Section::value).collect();

    let blob = |label: Option<&String>| -> Option<&Section> {
        let label = label?;
        sections.iter().find(|section| {
            section.kind == KIND_CONTENT_BLOB && section.label.as_deref() == Some(label.as_str())
        })
    };
    let model_section = blob(model_label.as_ref());
    let guest_section = blob(manifest_labels.get(1));
    let capabilities_section = blob(manifest_labels.first());
    let view_section = blob(manifest_labels.get(2));
    let model_document = model_section
        .and_then(|section| section.content.as_deref())
        .and_then(|content| serde_json::from_slice::<Value>(content).ok())
        .unwrap_or(Value::Null);
    let application = model_document
        .get("application")
        .cloned()
        .unwrap_or(Value::Null);

    let contract = directory
        .get("layers")
        .and_then(Value::as_array)
        .and_then(|layers| {
            layers
                .iter()
                .find(|layer| layer.get("kind").and_then(Value::as_str) == Some("wasm"))
        })
        .and_then(|layer| layer.get("contract").and_then(Value::as_str))
        .map(str::to_owned)
        .or_else(|| {
            provenance
                .get("core_wasm_contract")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });

    let observed = ObservedRevision {
        kind_sequence: sections.iter().map(|section| section.kind).collect(),
        manifest_uri: prefix_identifier(&wire::wireManifestPrefix()),
        extension_names: sections
            .iter()
            .filter(|section| section.kind == KIND_EXTENSION)
            .filter_map(|section| section.name.clone())
            .collect(),
        contract: contract.clone(),
        holoview_version: view_section
            .and_then(|section| holoview_version(section.content.as_deref()?)),
        source_manifest_version: source_manifest_version(&metadata),
        provenance_schema: provenance
            .get("schema")
            .and_then(Value::as_str)
            .map(str::to_owned),
        model_document_schema: model_document
            .get("schema")
            .and_then(Value::as_str)
            .map(str::to_owned),
    };

    let name = match member(&application, "name") {
        Value::Null => member(&provenance, "cargo_name"),
        value => value,
    };
    let labels_consistent = sections
        .iter()
        .filter(|section| section.kind == KIND_CONTENT_BLOB)
        .all(|section| {
            let content = section.content.as_deref().unwrap_or_default();
            section.label.as_deref() == Some(content_kappa(content).as_str())
        });
    Ok(json!({
        "schema": INSPECTION_SCHEMA,
        "name": name,
        "revision": recognize_revision(&observed),
        "physical_version": physical_version,
        "flags": flags,
        "size": bytes.len(),
        "digest": digest_set(bytes),
        "footer": hex(&footer),
        "sections": section_values,
        "manifest": {
            "uri": prefix_identifier(&wire::wireManifestPrefix()),
            "labels": {
                "capability_set": manifest_labels.first(),
                "guest": manifest_labels.get(1),
                "view": manifest_labels.get(2),
            },
            "entry": MANIFEST_ENTRY,
            "contract": wire::contractName(),
            "view_entry": VIEW_ENTRY,
            "surface": MANIFEST_SURFACE,
        },
        "model": {
            "schema": member(&model_document, "schema"),
            "name": member(&application, "name"),
            "cargo_name": member(&application, "cargo_name"),
            "cargo_version": member(&application, "cargo_version"),
            "description": member(&application, "cargo_description"),
            "profile": member(&application, "profile"),
            "function": member(&application, "function_name"),
            "vectors": application
                .get("acceptance_vectors")
                .and_then(Value::as_array)
                .map_or(0, Vec::len),
            "limits": {
                "request": member(&application, "request_maximum"),
                "response": member(&application, "response_maximum"),
                "guest_allocation": member(&application, "guest_allocation_maximum"),
            },
            "digest": model_section
                .and_then(|section| section.content.as_deref())
                .map_or(Value::Null, digest_set),
        },
        "provenance": {
            "schema": member(&provenance, "schema"),
            "application_kappa": member(&provenance, "application_kappa"),
            "model_id": member(&provenance, "model_id"),
            "compiler_semantics_id": member(&provenance, "compiler_semantics_id"),
            "stdlib_semantics_id": member(&provenance, "stdlib_semantics_id"),
            "lexlean_commit": member(&provenance, "lexlean_commit"),
        },
        "world": world_member(
            contract.as_deref(),
            guest_section.and_then(|section| section.content.as_deref()),
            capabilities_section,
        ),
        // Statements inside the archive arrive with the attestation section
        // (#267). Until then no holo carries any, and the list is empty.
        "attestations": Vec::<Value>::new(),
        "verification": {
            "footer": blake3::hash(&body).as_bytes().as_slice() == footer.as_slice(),
            "labels": labels_consistent,
            "cross_references": parse_application(bytes).is_ok(),
        },
    }))
}

/// One step of a dotted selector, as a Go template spells it.
enum Step<'a> {
    Field(&'a str),
    Index(usize),
}

/// Split a selector into its steps, or reject it. The grammar is the
/// JavaScript reader's: a name, a bracketed index or a decimal index, then the
/// same three after a `.`.
fn selector_steps(selector: &str) -> Option<Vec<Step<'_>>> {
    let text = selector.strip_prefix('.').unwrap_or(selector);
    let bytes = text.as_bytes();
    let mut at = 0usize;
    let mut steps = Vec::new();
    while at < bytes.len() {
        if !steps.is_empty() {
            // After a step, the next one follows the same name, a dot or a
            // bracketed index, as the JavaScript reader's grammar allows.
            if bytes[at] == b'.' {
                at += 1;
            } else if bytes[at] != b'[' {
                return None;
            }
        }
        if bytes[at] == b'[' {
            let end = at + text[at..].find(']')?;
            if end == at + 1 {
                return None;
            }
            steps.push(Step::Index(text[at + 1..end].parse::<usize>().ok()?));
            at = end + 1;
            continue;
        }
        let start = at;
        while at < bytes.len()
            && (bytes[at].is_ascii_alphanumeric() || bytes[at] == b'_' || bytes[at] == b'-')
        {
            at += 1;
        }
        if at == start {
            return None;
        }
        let field = &text[start..at];
        if field.bytes().all(|byte| byte.is_ascii_digit()) {
            // A selector opens with a name or a bracketed index, as the
            // JavaScript reader's grammar does.
            if steps.is_empty() {
                return None;
            }
            steps.push(Step::Index(field.parse::<usize>().ok()?));
            continue;
        }
        if !field.starts_with(|character: char| character.is_ascii_alphabetic() || character == '_')
        {
            return None;
        }
        steps.push(Step::Field(field));
    }
    if steps.is_empty() {
        return None;
    }
    Some(steps)
}

/// Read one value out of an inspection by a dotted path, such as
/// `sections[0].digest.sha256`, `sections.0.role` or `world.exports`. A
/// leading `.` is allowed, as in a Go template. A malformed path is a usage
/// error (`PP1101`); a path with no value is `Ok(None)`.
pub fn select<'a>(value: &'a Value, selector: &str) -> Result<Option<&'a Value>, PrismError> {
    let steps = selector_steps(selector).ok_or_else(|| {
        PrismError::new(
            "PP1101",
            format!(
                "malformed selector {selector:?}; use a dotted path such as sections[0].digest.sha256"
            ),
        )
    })?;
    let mut current = value;
    for step in steps {
        let next = match (step, current) {
            (Step::Field(field), Value::Object(map)) => map.get(field),
            (Step::Index(index), Value::Array(items)) => items.get(index),
            _ => None,
        };
        let Some(next) = next else {
            return Ok(None);
        };
        current = next;
    }
    Ok(Some(current))
}

#[cfg(test)]
mod tests;
