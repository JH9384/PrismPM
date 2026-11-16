//! The release of a server application, verified and replayed without its source.
//!
//! A release carries the files of the build, among them the consumer's workspace
//! (`consumer/`) and the packages of the core and of the host (`server/`), and the
//! evidence of `prismpm verify`. This module checks that evidence against the
//! released files alone ([`check`]) and replays the acceptance by rebuilding the
//! released program and answering every vector with it ([`replay`]).
//!
//! The check is the one release assembly and every later replay of the release
//! graph make (`crate::release_verification`): it derives the acceptance document
//! from the model and the released files and requires the retained one to be it.
//! The replay adds what only a run can show: the program built from the released
//! files, under the build bound the model declares, answers every acceptance
//! vector over every transport and every served vector over a loopback socket as
//! the model says, and its record is the retained one.

use crate::error::PrismError;
use crate::holo::model_document::decode_canonical;
use crate::holo::model_document::Application;
use crate::server_host::{acceptance, program_name, workspace};
use crate::verification::server::{build_workspace, declared_bounds, under};
use serde_json::{json, Value};
use std::path::Path;

pub use crate::server_host::workspace::Files;

fn invalid(message: impl Into<String>) -> PrismError {
    PrismError::new("PP6101", message)
}

/// Check the retained verification of a released server application against the
/// released build files, with no filesystem, subprocess or network.
///
/// The check is [`crate::release_verification`]'s: the build closure, the LexLean
/// identities and the evidence of the release, and for a server application the
/// acceptance document derived from the model and the files of the release.
///
/// # Errors
/// Returns `PP6101` for any difference between the retained evidence and what the
/// model and the released files derive.
pub fn check(build_manifest: &[u8], build: &Files, verification: &Files) -> Result<(), PrismError> {
    crate::release_verification::validate(build_manifest, build, verification).map(|_| ())
}

/// Replay the acceptance of a released server application: check the release,
/// rebuild the program from the released files and answer every vector with it.
///
/// The workspace is laid out from the release's `consumer/` and `server/` files
/// alone and built with `cargo build --release --locked --offline` under
/// `verifyBuildTimeoutSeconds`, the bound the model declares and the evidence
/// records. The replayed record must be the retained one.
///
/// # Errors
/// Returns `PP6101` for a release that is not intact or holds no server
/// application, `PP2013` for a workspace that does not hold the declared binding,
/// `PP4103` and `PP5007` for the workspace build, `PP6003` for an acceptance the
/// program does not meet or a record that is not the retained one, and `PP2026`
/// for a declared effect no vector reaches.
pub fn replay(
    build_manifest: &[u8],
    build: &Files,
    verification: &Files,
) -> Result<Value, PrismError> {
    let model_bytes = build
        .get("model.prism.json")
        .ok_or_else(|| invalid("the release holds no model"))?;
    let model = decode_canonical(model_bytes)
        .map_err(|error| invalid(format!("release model: {}", error.message)))?;
    let Some(Application::Server(application)) = model.application.as_ref() else {
        return Err(invalid("the release holds no server application"));
    };
    let binding = crate::release_verification::validate(build_manifest, build, verification)?;
    let retained: Value = serde_json::from_slice(
        verification
            .get("application-acceptance.json")
            .ok_or_else(|| invalid("the release holds no acceptance record"))?,
    )
    .map_err(|error| invalid(format!("acceptance record: {error}")))?;

    let work = tempfile::Builder::new()
        .prefix("prismpm-server-replay-")
        .tempdir()
        .map_err(|error| PrismError::new("PP4002", format!("server replay: {error}")))?;
    let staged = work.path().join("workspace");
    workspace::stage_files(
        application,
        &under(build, "consumer/"),
        &under(build, "server/"),
        &staged,
    )?;
    let target = work.path().join("target");
    build_workspace(
        application,
        &staged,
        &target,
        &[(work.path(), "$REPLAY_WORK")],
    )?;
    let trials = work.path().join("trials");
    std::fs::create_dir(&trials)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", trials.display())))?;
    let program = target.join("release").join(program_name(application));
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
    if record != retained["server"] {
        return Err(PrismError::new(
            "PP6003",
            "the replayed acceptance of the released program differs from the retained one",
        ));
    }
    Ok(json!({
        "application": application.name,
        "attestation_id": binding.attestation_id,
        "bounds": declared_bounds(application),
        "build_id": binding.build_id,
        "schema": "prismpm/server-release-replay/1",
        "server": record,
        "status": "verified",
    }))
}

/// Replay the acceptance of the server application of a release in the local
/// OCI store of the project at `root`.
///
/// The release is first verified as a whole, exactly as every other use of it
/// does (graph, locks, provenance, validation and the retained verification
/// closure); then its files are replayed by [`replay`].
///
/// # Errors
/// Returns `PP6101` for a release that is not intact or holds no server
/// application, and the refusals of [`replay`].
pub fn replay_release(root: &Path, reference: &str) -> Result<Value, PrismError> {
    let (manifest, build, verification) = crate::oci::released_files(root, reference)?;
    let mut result = replay(&manifest, &build, &verification)?;
    result["reference"] = json!(reference);
    Ok(result)
}

#[cfg(test)]
mod tests;
