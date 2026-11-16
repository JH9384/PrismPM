//! The proof statement of a verified application (#266, #582).
//!
//! After `prismpm verify` has checked every theorem through the Lean kernel,
//! it writes an unsigned in-toto statement with the predicate
//! `https://uor.foundation/prism/proof/v1` into the verified directory. The
//! statement is the output of the LexLean model
//! `bindings/src/Foundation/Proof/V1/Statement.lex.tex`, exported by
//! `cargo xtask bindings-package` into [`generated`]. This file only gathers
//! that model's input from the build's evidence and reads its output back;
//! which declarations are claims, every verdict, the TCB and the statement's
//! text are the model's.
//!
//! Nothing here signs. `prism-code attest` signs the statement on a GitHub
//! Actions runner, which is how a built holo reaches P2.

#[allow(
    missing_docs,
    dead_code,
    unused_imports,
    unused_variables,
    unused_mut,
    unreachable_patterns,
    non_snake_case,
    non_camel_case_types,
    clippy::all,
    clippy::pedantic,
    clippy::nursery
)]
#[rustfmt::skip]
#[path = "proof_statement.rs"]
mod generated;

use super::ProcessRecord;
use crate::error::PrismError;
use crate::holo::archive::parse_application;
use crate::holo::canonical::encode_value;
use generated::{Adt0, Adt1, Adt2, Adt3, List, Str};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// The file the statement is written to, in the verified directory.
pub(crate) const FILE: &str = "proof-statement.json";

/// The writer recurses to a depth bounded by its input, so it runs on a
/// thread whose stack fits any build.
const STACK: usize = 256 << 20;

/// What the build's evidence says, before the model reads it.
pub(crate) struct Evidence<'a> {
    /// The verified holo.
    pub(crate) holo: &'a [u8],
    /// The guest's path in the build directory, the statement's subject name.
    pub(crate) guest: &'a str,
    /// The project's `prismpm.lock`, when it has one.
    pub(crate) lock: Option<&'a [u8]>,
    /// `lexlean/snapshot.json` of the build.
    pub(crate) snapshot: &'a Value,
    /// The LexLean attestation, parsed.
    pub(crate) attestation: &'a Value,
    /// The LexLean attestation bytes.
    pub(crate) attestation_bytes: &'a [u8],
    /// The build's `manifest.json`.
    pub(crate) build_manifest: &'a Value,
    /// The verification manifest bytes.
    pub(crate) verification_manifest: &'a [u8],
    /// Every process the verification ran.
    pub(crate) processes: &'a [ProcessRecord],
    /// When the verification ended, UTC RFC 3339.
    pub(crate) time: String,
}

/// The statement, or why the model wrote none: a code and a message.
pub(crate) enum Outcome {
    /// The canonical JSON bytes of the unsigned statement.
    Statement(Vec<u8>),
    /// The model refused: its code and message.
    Refused(String, String),
}

fn missing(what: &str) -> PrismError {
    PrismError::new("PP4004", format!("proof statement input: {what}"))
}

fn member<'a>(value: &'a Value, name: &str) -> Result<&'a str, PrismError> {
    value[name]
        .as_str()
        .ok_or_else(|| missing(&format!("{name} is absent")))
}

fn text(value: &str) -> Str {
    Str::lit(value)
}

fn list<T: Clone, U>(items: &[U], each: impl Fn(&U) -> T) -> List<T> {
    items
        .iter()
        .rev()
        .fold(List::nil(), |tail, item| List::cons(each(item), tail))
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// One declaration the snapshot calls a theorem, with its audit row.
struct Theorem {
    name: String,
    module: String,
    result: String,
    kind: String,
    allowed: Vec<String>,
    observed: Vec<String>,
}

/// The snapshot's theorems, each joined with the attestation's audit row of
/// the same name. A theorem the audit does not list keeps an empty result,
/// which the model's verdict reads as not passed.
fn theorems(snapshot: &Value, attestation: &Value) -> Result<Vec<Theorem>, PrismError> {
    let audit = attestation["declarations"]
        .as_array()
        .ok_or_else(|| missing("the attestation lists no declarations"))?;
    let mut rows = Vec::new();
    for module in snapshot["modules"]
        .as_array()
        .ok_or_else(|| missing("the snapshot lists no modules"))?
    {
        let lean_module = member(module, "lean_module")?;
        for declaration in module["declarations"].as_array().into_iter().flatten() {
            if declaration["kind"].as_str() != Some("theorem") {
                continue;
            }
            let name = format!("{lean_module}.{}", member(declaration, "lean_name")?);
            let row = audit
                .iter()
                .find(|row| row["name"].as_str() == Some(name.as_str()));
            rows.push(Theorem {
                module: lean_module.to_owned(),
                result: row
                    .and_then(|row| row["result"].as_str())
                    .unwrap_or_default()
                    .to_owned(),
                kind: row
                    .and_then(|row| row["policy"]["kind"].as_str())
                    .unwrap_or_default()
                    .to_owned(),
                allowed: row
                    .map(|row| strings(&row["policy"]["axioms"]))
                    .unwrap_or_default(),
                observed: row.map(|row| strings(&row["observed"])).unwrap_or_default(),
                name,
            });
        }
    }
    Ok(rows)
}

/// Write the proof statement of a verified application with the generated
/// writer.
pub(crate) fn write(evidence: &Evidence<'_>) -> Result<Outcome, PrismError> {
    let Some(lock) = evidence.lock else {
        return Ok(Outcome::Refused(
            "proof.input".to_owned(),
            "the project has no prismpm.lock, so no SDK image is pinned to name as the verifier's host".to_owned(),
        ));
    };
    let lock: Value = serde_json::from_slice(lock)
        .map_err(|error| PrismError::new("PP4004", format!("prismpm.lock: {error}")))?;
    let parsed = parse_application(evidence.holo)?;
    let extension: Value = serde_json::from_slice(&parsed.prism_extension)
        .map_err(|error| PrismError::new("PP4004", format!("the model extension: {error}")))?;
    let blob = |label: &str| {
        parsed
            .blobs
            .get(label)
            .ok_or_else(|| missing(&format!("{label} is not a content blob of the holo")))
    };
    let guest = blob(&parsed.identities.guest_content_kappa)?;
    let model = blob(&parsed.identities.model_content_kappa)?;
    let modules = evidence.build_manifest["files"]
        .as_array()
        .ok_or_else(|| missing("the build manifest lists no files"))?
        .iter()
        .filter(|row| row["kind"].as_str() == Some("lean"))
        .map(|row| {
            Ok((
                member(row, "path")?.to_owned(),
                member(row, "sha256")?.to_owned(),
            ))
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let theorems = theorems(evidence.snapshot, evidence.attestation)?;
    let exits = evidence
        .processes
        .iter()
        .filter(|process| process.tool == "leanchecker")
        .map(|process| u64::try_from(process.exit_code).unwrap_or(u64::MAX))
        .collect::<Vec<_>>();
    let hex = |bytes: &[u8]| format!("{:x}", Sha256::digest(bytes));
    let values: Values = [
        evidence.guest.to_owned(),
        hex(guest),
        lexlean::LEAN_VERSION.to_owned(),
        lexlean::LEAN_GITHASH.to_owned(),
        lexlean::COMPILER_VERSION.to_owned(),
        member(&extension, "lexlean_commit")?.to_owned(),
        member(&extension, "lexlean_package_sha256")?.to_owned(),
        member(&extension, "lean4_prod_commit")?.to_owned(),
        crate::input_lock::RUSTC_VERSION.to_owned(),
        crate::input_lock::WASM_BINDGEN_VERSION.to_owned(),
        env!("CARGO_PKG_VERSION").to_owned(),
        member(&lock, "sdk_image")?.to_owned(),
        member(&lock, "sdk_version")?.to_owned(),
        member(&extension, "snapshot_id")?.to_owned(),
        hex(model),
        member(&extension, "source_id")?.to_owned(),
        member(&extension, "semantic_id")?.to_owned(),
        member(&extension, "compiler_semantics_id")?.to_owned(),
        member(&extension, "lean_manifest_sha256")?.to_owned(),
        hex(evidence.attestation_bytes),
        hex(evidence.verification_manifest),
        evidence.time.clone(),
    ];
    project(values, modules, theorems, exits)
}

/// The model's input, in [`write`]'s order: subject name and sha256 (its
/// κ, ADR-017); Lean version and commit; LexLean version, commit and crate
/// SHA-256; the lean4-prod commit; rustc; wasm-bindgen; prismpm; the SDK image
/// and version; the snapshot id; the model's SHA-256; the source,
/// semantic and compiler-semantics ids; the Lean manifest SHA-256; the
/// attestation and verification manifest SHA-256; the time.
type Values = [String; 22];

/// Run the generated writer on its input and read the statement back as
/// canonical JSON.
fn project(
    values: Values,
    modules: Vec<(String, String)>,
    theorems: Vec<Theorem>,
    exits: Vec<u64>,
) -> Result<Outcome, PrismError> {
    let worker = std::thread::Builder::new()
        .name("prism-proof-statement".into())
        .stack_size(STACK)
        .spawn(move || {
            let [subject_name, subject_sha256, lean_version, lean_commit, lexlean_version, lexlean_commit, lexlean_crate, lean4_prod, rustc, wasm_bindgen, prismpm, sdk_image, sdk_version, snapshot, model_sha256, source, semantic, compiler, lean_manifest, attestation, manifest, time] =
                values;
            let input = Adt0::C0(
                text(&subject_name),
                text(&subject_sha256),
                text(&lean_version),
                text(&lean_commit),
                text(&lexlean_version),
                text(&lexlean_commit),
                text(&lexlean_crate),
                text(&lean4_prod),
                text(&rustc),
                text(&wasm_bindgen),
                text(&prismpm),
                text(&sdk_image),
                text(&sdk_version),
                text(&snapshot),
                text(&model_sha256),
                text(&source),
                text(&semantic),
                text(&compiler),
                text(&lean_manifest),
                list(&modules, |(path, sha256)| Adt1::C0(text(path), text(sha256))),
                list(&theorems, |theorem| {
                    Adt2::C0(
                        text(&theorem.name),
                        text(&theorem.module),
                        text(&theorem.result),
                        text(&theorem.kind),
                        list(&theorem.allowed, |axiom| text(axiom)),
                        list(&theorem.observed, |axiom| text(axiom)),
                    )
                }),
                list(&exits, |code| *code),
                text(&attestation),
                text(&manifest),
                text(&time),
            );
            match generated::run(input) {
                Ok(Adt3::C0(statement)) => Ok(Ok(statement.text().to_owned())),
                Ok(Adt3::C1(code, message)) => {
                    Ok(Err((code.text().to_owned(), message.text().to_owned())))
                }
                Err(_) => Err(PrismError::new(
                    "PP9001",
                    "the proof statement writer overflowed",
                )),
            }
        })
        .map_err(|error| PrismError::new("PP9001", format!("proof statement writer: {error}")))?;
    let written = worker
        .join()
        .unwrap_or_else(|panic| std::panic::resume_unwind(panic))?;
    match written {
        Err((code, message)) => Ok(Outcome::Refused(code, message)),
        Ok(statement) => {
            let value: Value = serde_json::from_str(&statement).map_err(|error| {
                PrismError::new(
                    "PP9001",
                    format!("the proof statement writer wrote no JSON: {error}"),
                )
            })?;
            Ok(Outcome::Statement(encode_value(&value)?))
        }
    }
}

#[cfg(test)]
#[path = "proof_tests.rs"]
mod tests;
