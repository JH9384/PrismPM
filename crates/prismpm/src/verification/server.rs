//! `prismpm verify` of a server application.
//!
//! A server application has no View, no Core-Wasm guest and no archive, so its
//! verification is not the application pipeline of the Holo profiles. It is the
//! acceptance of what `prismpm build` published, and of nothing else:
//!
//! 1. every file of the build equals its manifest row (the build closure);
//! 2. the core package equals the compiler's own record of the export, which is
//!    bound to the verified source, the verification and the compiler;
//! 3. the two host packages equal their regeneration from the declaration, byte
//!    for byte, with no file missing and none added;
//! 4. the consumer's workspace is staged from the build alone (the consumer's
//!    manifest, committed lock and binding, which the build retains under
//!    `consumer/`, and the packages of the build, no file of the working tree) and
//!    built with `cargo build --release --locked --offline`;
//! 5. the program is accepted: every acceptance vector is replayed with its effect
//!    transcript, through the linked binding when one is declared, and every
//!    served vector is sent over a loopback socket, all answered with the modeled
//!    bytes, and every declared effect is reached by some vector (`PP2026`).
//!
//! The evidence is `application-acceptance.json`, the lexlean attestation and a
//! manifest binding them to the build, published under `verified/`. It binds the
//! core package, the two host packages, the consumer's workspace and the declared
//! bounds by digest. The program's own digest is not part of it: it depends on the
//! host that built it. [`acceptance_document`] derives the document from the model
//! and the files of the build alone, so that a release can be checked against it
//! without the source (`crate::server_release`).

use crate::config::ProjectConfig;
use crate::controller::{BuildResult, VerifyResult};
use crate::error::PrismError;
use crate::holo::canonical::{content_id, encode_value};
use crate::holo::model_document::{Application, ModelDocument};
use crate::holo::server_application::ServerApplication;
use crate::server_build::{core_output, RESULT_FILE};
use crate::server_host::{self, acceptance, workspace};
use crate::verification::{
    executable, publish, run_process_limited, ProcessRecord, CHILD_OUTPUT_LIMIT,
};
use lexlean::api::production::ProductionResult;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// What `verify` has established before it reaches the server application.
pub(crate) struct ServerVerification<'a> {
    pub(crate) project_root: &'a Path,
    pub(crate) config: &'a ProjectConfig,
    pub(crate) build: BuildResult,
    pub(crate) model: ModelDocument,
    pub(crate) model_bytes: Vec<u8>,
    pub(crate) build_manifest: Value,
    pub(crate) build_root: &'a Path,
    pub(crate) lex_attestation: Vec<u8>,
    pub(crate) lex_attestation_id: String,
    pub(crate) processes: Vec<ProcessRecord>,
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn generated_mismatch(message: impl Into<String>) -> PrismError {
    PrismError::new("PP4102", message)
}

/// Files by `/`-separated relative path.
pub use crate::server_host::workspace::Files;

/// Every regular file below `directory`, by `/`-separated relative path.
fn files_below(directory: &Path) -> Result<Files, PrismError> {
    let mut files = Files::new();
    for entry in walkdir::WalkDir::new(directory).follow_links(false) {
        let entry = entry.map_err(|error| PrismError::new("PP4002", error.to_string()))?;
        if entry.file_type().is_dir() {
            continue;
        }
        if !entry.file_type().is_file() {
            return Err(PrismError::new(
                "PP4001",
                format!(
                    "{} is neither a regular file nor a directory",
                    entry.path().display()
                ),
            ));
        }
        let relative = entry
            .path()
            .strip_prefix(directory)
            .map_err(|_| PrismError::new("PP9001", "a build path escaped its directory"))?
            .to_string_lossy()
            .replace('\\', "/");
        let bytes = std::fs::read(entry.path()).map_err(|error| {
            PrismError::new("PP4002", format!("{}: {error}", entry.path().display()))
        })?;
        files.insert(relative, bytes);
    }
    Ok(files)
}

/// The files of `files` below the directory `prefix` (which ends in `/`), by path
/// relative to it.
#[must_use]
pub fn under(files: &Files, prefix: &str) -> Files {
    files
        .iter()
        .filter_map(|(path, bytes)| {
            path.strip_prefix(prefix)
                .map(|inside| (inside.to_owned(), bytes.clone()))
        })
        .collect()
}

/// The digest that names a set of files: SHA-256 of the canonical, path-sorted
/// rows of their relative paths, byte lengths and digests.
///
/// # Errors
/// Returns `PP9001` when the rows cannot be encoded.
pub fn package_digest(files: &Files) -> Result<String, PrismError> {
    let rows = files
        .iter()
        .map(|(path, bytes)| json!({"byte_length": bytes.len(), "path": path, "sha256": sha256(bytes)}))
        .collect::<Vec<_>>();
    Ok(sha256(&encode_value(&json!(rows))?))
}

/// The compiler's record of the export, and what it says of the core package.
#[derive(Debug, Clone)]
pub struct CoreRecord {
    /// The result identity the compiler recorded.
    pub result_id: String,
    /// The effects the package exhibits.
    pub effects: Vec<String>,
    /// The digest of the files of the package ([`package_digest`]).
    pub package_sha256: String,
}

/// Check the core package of a build against the compiler's record of its export,
/// and the record against the verified source.
///
/// `server` is the `server/` directory of the build. The record must be the
/// canonical result it names itself by; it must be about the source, the compiler
/// and the verification the caller verified (`source_id`, `semantic_id`,
/// `compiler_semantics`, `attestation_id`); the package must be the declared one
/// with only admitted effects; and every file of the package must equal its row
/// and no other file may lie in the package directory.
///
/// # Errors
/// Returns `PP4004` for a record that is not one, `PP4001` for a record about
/// other identities or a package that differs from its rows, and `PP2025` for a
/// package other than the declared one or an effect that is not admitted.
pub fn check_core(
    application: &ServerApplication,
    server: &Path,
    identities: &CoreIdentities<'_>,
) -> Result<CoreRecord, PrismError> {
    check_core_files(application, &files_below(server)?, identities)
}

/// [`check_core`] over the files of `server/`, by path relative to it.
///
/// # Errors
/// Returns the refusals of [`check_core`].
pub fn check_core_files(
    application: &ServerApplication,
    server: &Files,
    identities: &CoreIdentities<'_>,
) -> Result<CoreRecord, PrismError> {
    let recorded = server
        .get(RESULT_FILE)
        .ok_or_else(|| PrismError::new("PP4002", format!("{RESULT_FILE}: not in the build")))?;
    let result: ProductionResult = serde_json::from_slice(recorded)
        .map_err(|error| PrismError::new("PP4004", format!("{RESULT_FILE}: {error}")))?;
    if result.recomputed_id() != result.result_id || result.to_json() != *recorded {
        return Err(PrismError::new(
            "PP4004",
            "the production result is not the canonical record its identity names",
        ));
    }
    for (what, recorded, verified) in [
        (
            "source",
            result.source.source_id.to_string(),
            identities.source_id,
        ),
        (
            "semantic",
            result.source.semantic_id.to_string(),
            identities.semantic_id,
        ),
        (
            "compiler semantics",
            result.compiler.semantics.to_string(),
            identities.compiler_semantics,
        ),
        (
            "verification attestation",
            result.verification.attestation_id.to_string(),
            identities.attestation_id,
        ),
    ] {
        if recorded != verified {
            return Err(PrismError::new(
                "PP4001",
                format!(
                    "the production result is about another {what} identity than the verified one"
                ),
            ));
        }
    }
    let output = core_output(application, &result)?;
    let package = &output.package;
    let mut found = under(server, &format!("{}/", package.name));
    let package_sha256 = package_digest(&found)?;
    for file in &package.files {
        let inside = file
            .path
            .strip_prefix(&format!("{}/", package.directory))
            .ok_or_else(|| {
                PrismError::new(
                    "PP2025",
                    "a package file lies outside its package directory",
                )
            })?;
        let bytes = found
            .remove(inside)
            .ok_or_else(|| PrismError::new("PP4001", format!("the core package lacks {inside}")))?;
        if bytes.len() as u64 != file.byte_length
            || sha256(&bytes) != file.sha256.to_string().as_str()
        {
            return Err(PrismError::new(
                "PP4001",
                format!("the core package file {inside} differs from the compiler's record"),
            ));
        }
    }
    if let Some(extra) = found.keys().next() {
        return Err(PrismError::new(
            "PP4001",
            format!("the core package holds {extra}, which the compiler did not export"),
        ));
    }
    Ok(CoreRecord {
        result_id: result.result_id.to_string(),
        effects: output.effects.clone(),
        package_sha256,
    })
}

/// The identities the production result must be about.
pub struct CoreIdentities<'a> {
    /// The LexLean source identity.
    pub source_id: &'a str,
    /// The LexLean semantic identity.
    pub semantic_id: &'a str,
    /// The compiler-semantics identity the model records.
    pub compiler_semantics: &'a str,
    /// The attestation of the LexLean verification.
    pub attestation_id: &'a str,
}

/// Check that the two host packages of a build equal their regeneration from the
/// declaration, byte for byte, and that `server` holds exactly the core package
/// (as `core_files` lists it), those two packages and the compiler's record.
///
/// # Errors
/// Returns `PP4102` for a file that differs, is missing or was added.
pub fn check_generated(
    application: &ServerApplication,
    server: &Path,
    core_files: &BTreeSet<String>,
) -> Result<usize, PrismError> {
    check_generated_files(application, &files_below(server)?, core_files)
}

/// [`check_generated`] over the files of `server/`, by path relative to it.
///
/// # Errors
/// Returns `PP4102` for a file that differs, is missing or was added.
pub fn check_generated_files(
    application: &ServerApplication,
    server: &Files,
    core_files: &BTreeSet<String>,
) -> Result<usize, PrismError> {
    let generated = server_host::generate(application)?;
    let mut found = server.clone();
    let mut checked = 0;
    for item in &generated.files {
        let bytes = found.remove(&item.path).ok_or_else(|| {
            generated_mismatch(format!("the generated host file {} is missing", item.path))
        })?;
        if bytes != item.bytes {
            return Err(generated_mismatch(format!(
                "the generated host file {} differs from its regeneration",
                item.path
            )));
        }
        checked += 1;
    }
    found.remove(RESULT_FILE);
    let prefix = format!("{}/", application.core.package);
    for extra in found.keys() {
        let core = extra
            .strip_prefix(&prefix)
            .is_some_and(|inside| core_files.contains(inside));
        if !core {
            return Err(generated_mismatch(format!(
                "the build holds {extra}, which the declaration does not generate"
            )));
        }
    }
    Ok(checked)
}

/// The bounds that the declaration states and the evidence records: the exchange
/// maxima, the effect budget, the bounds of the listener when the application is
/// served, and the seconds that the build of the workspace may take.
#[must_use]
pub fn declared_bounds(application: &ServerApplication) -> Value {
    json!({
        "effect_budget": application.host.effect_budget,
        "request_maximum": application.request_maximum,
        "response_maximum": application.response_maximum,
        "serving": application.serving.first().map(|serving| json!({
            "address": serving.address,
            "body_maximum": serving.body_maximum,
            "connection_maximum": serving.connection_maximum,
            "header_bytes_maximum": serving.header_bytes_maximum,
            "header_count_maximum": serving.header_count_maximum,
            "port": serving.port,
            "read_timeout_millis": serving.read_timeout_millis,
            "request_line_maximum": serving.request_line_maximum,
            "root_stack_bytes": serving.root_stack_bytes,
        })),
        "verify_build_timeout_seconds": application.verify_build_timeout_seconds,
    })
}

/// What a verification, or the replay of a release, establishes the document from:
/// the model's declaration, the identities of the build and of the verified source,
/// and the files of the build.
pub struct Subject<'a> {
    /// The declaration.
    pub application: &'a ServerApplication,
    /// The identity of the build.
    pub build_id: &'a str,
    /// The identities the compiler's record must be about.
    pub identities: CoreIdentities<'a>,
    /// The files of `server/`, by path relative to it.
    pub server: &'a Files,
    /// The files of `consumer/`, by path relative to it.
    pub consumer: &'a Files,
}

/// What the checks of a [`Subject`] established.
pub struct Checked {
    /// The core package.
    pub core: CoreRecord,
    /// The digest of the generated API package.
    pub api_package_sha256: String,
    /// The digest of the generated program package.
    pub program_package_sha256: String,
    /// The digest of the consumer's files.
    pub consumer_sha256: String,
}

/// Check the files of a build against the model: the core package against the
/// compiler's record and the record against the verified identities, the host
/// packages against their regeneration, and the consumer's workspace against the
/// declared binding. No filesystem, subprocess or network is used.
///
/// # Errors
/// Returns the first refusal of [`check_core_files`], [`check_generated_files`]
/// and the checks of the workspace (`PP2013`).
pub fn check_subject(subject: &Subject<'_>) -> Result<Checked, PrismError> {
    let application = subject.application;
    let core = check_core_files(application, subject.server, &subject.identities)?;
    let core_files = under(subject.server, &format!("{}/", application.core.package))
        .into_keys()
        .collect::<BTreeSet<_>>();
    check_generated_files(application, subject.server, &core_files)?;
    let workspace = workspace::workspace_files(subject.consumer, subject.server)?;
    workspace::verify_files(application, &workspace)?;
    Ok(Checked {
        core,
        api_package_sha256: package_digest(&under(
            subject.server,
            &format!("{}/", server_host::api_name(application)),
        ))?,
        program_package_sha256: package_digest(&under(
            subject.server,
            &format!("{}/", server_host::program_name(application)),
        ))?,
        consumer_sha256: package_digest(subject.consumer)?,
    })
}

/// The acceptance document of a server application: the identities of the build,
/// the core, the host packages and the consumer's workspace, the declared bounds,
/// and `record`, the record of the acceptance. The document is the same function of
/// its inputs when a verification publishes it and when a release is checked.
#[must_use]
pub fn document(subject: &Subject<'_>, checked: &Checked, record: Value) -> Value {
    let application = subject.application;
    json!({
        "application": application.name,
        "artifact_closure": "verified",
        "bounds": declared_bounds(application),
        "build_id": subject.build_id,
        "consumer": {
            "files": subject.consumer.len(),
            "sha256": checked.consumer_sha256,
        },
        "core": {
            "effects": checked.core.effects,
            "package": {"name": application.core.package, "version": application.core.version},
            "package_sha256": checked.core.package_sha256,
            "result_id": checked.core.result_id,
            "root": application.core.root,
        },
        "host_packages": {
            "api": server_host::api_name(application),
            "api_package_sha256": checked.api_package_sha256,
            "program": server_host::program_name(application),
            "program_package_sha256": checked.program_package_sha256,
            "regeneration": "byte-identical",
        },
        "lexlean_attestation_id": subject.identities.attestation_id,
        "modeled_vectors": application.acceptance_vectors.len(),
        "schema": "prismpm/application-acceptance/1",
        "server": record,
        "source_id": subject.identities.source_id,
        "status": "verified",
    })
}

/// Build the staged workspace of `application` in release mode, locked and offline,
/// into `target`, under the bound that the declaration states
/// (`verify_build_timeout_seconds`) and no other.
///
/// # Errors
/// Returns `PP4103` when the build fails and `PP5007` when it does not finish within
/// the declared bound.
pub(crate) fn build_workspace(
    application: &ServerApplication,
    staged: &Path,
    target: &Path,
    replacements: &[(&Path, &str)],
) -> Result<ProcessRecord, PrismError> {
    let environment = BTreeMap::from([
        (
            "CARGO_TARGET_DIR".to_owned(),
            target.to_string_lossy().into_owned(),
        ),
        ("CARGO_NET_OFFLINE".to_owned(), "true".to_owned()),
    ]);
    run_process_limited(
        "server-workspace-build",
        &executable("cargo")?,
        &["build", "--release", "--locked", "--offline", "--quiet"].map(str::to_owned),
        staged,
        &environment,
        replacements,
        "PP4103",
        &application.verify_build_timeout_seconds.to_string(),
        CHILD_OUTPUT_LIMIT,
    )
}

/// Verify the server application of a build and publish the evidence.
///
/// # Errors
/// Returns the first refusal of the checks in the order the module lists them.
pub(crate) fn run(mut context: ServerVerification<'_>) -> Result<VerifyResult, PrismError> {
    let Some(Application::Server(application)) = context.model.application.as_ref() else {
        return Err(PrismError::new(
            "PP9001",
            "server verification received a model without a server application",
        ));
    };
    let application: &ServerApplication = application;
    crate::verification::verify_application_build_closure(
        context.build_root,
        &context.build_manifest,
    )?;

    let server = files_below(&context.build_root.join("server"))?;
    let consumer_root = context.build_root.join("consumer");
    if !consumer_root.is_dir() {
        return Err(PrismError::new(
            "PP4002",
            "the build retains no consumer workspace; build the application again",
        ));
    }
    let consumer = files_below(&consumer_root)?;
    let subject = Subject {
        application,
        build_id: &context.build.build_id,
        identities: CoreIdentities {
            source_id: &context.build.source_id,
            semantic_id: &context.build.semantic_id,
            compiler_semantics: &context.model.provenance.compiler_semantics_id,
            attestation_id: &context.lex_attestation_id,
        },
        server: &server,
        consumer: &consumer,
    };
    let checked = check_subject(&subject)?;

    let work = tempfile::Builder::new()
        .prefix("prismpm-server-verify-")
        .tempdir()
        .map_err(|error| PrismError::new("PP4002", format!("server verification: {error}")))?;
    let staged = work.path().join("workspace");
    workspace::stage_files(application, &consumer, &server, &staged)?;
    let target = work.path().join("target");
    let replacements = [
        (work.path(), "$VERIFY_WORK"),
        (context.project_root, "$PROJECT"),
        (context.build_root, "$BUILD"),
    ];
    context.processes.push(build_workspace(
        application,
        &staged,
        &target,
        &replacements,
    )?);

    let trials = work.path().join("trials");
    std::fs::create_dir(&trials)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", trials.display())))?;
    let program = target
        .join("release")
        .join(server_host::program_name(application));
    // A declared binding serves the served vectors and must reproduce the replayed ones.
    let mut record = acceptance::execute(
        application,
        &program,
        &trials,
        !application.bindings.is_empty(),
    )?;
    // The digest of the program depends on the host that built it.
    record
        .as_object_mut()
        .map(|object| object.remove("program_sha256"));

    let acceptance_document = encode_value(&document(&subject, &checked, record))?;
    let manifest = encode_value(&json!({
        "acceptance_sha256": sha256(&acceptance_document),
        "build_id": context.build.build_id,
        "lexlean_attestation_sha256": sha256(&context.lex_attestation),
        "model_sha256": sha256(&context.model_bytes),
        "processes": context.processes,
        "schema": "prismpm/server-verification-manifest/1",
    }))?;
    let attestation_id = content_id(&manifest);
    publish(
        &context.config.output_root(context.project_root)?,
        &attestation_id,
        &[
            (
                "application-acceptance.json".to_owned(),
                acceptance_document,
            ),
            (
                "lexlean-attestation.json".to_owned(),
                context.lex_attestation,
            ),
            ("manifest.json".to_owned(), manifest),
        ],
    )?;
    Ok(VerifyResult {
        schema: "prismpm/verify-result/1".to_owned(),
        attestation_id: attestation_id.clone(),
        build_id: context.build.build_id,
        verified_root: format!("{}/verified/{attestation_id}", context.config.build_root),
    })
}
