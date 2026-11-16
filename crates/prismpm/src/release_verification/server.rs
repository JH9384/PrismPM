//! The retained verification of a server application, derived again from the
//! released files.
//!
//! A server application has no View, guest or archive. What its verification
//! establishes is that the program built from the release's files is accepted, so
//! what a release must show is the acceptance document that
//! `crate::verification::server::document` derives from the model and those files,
//! with the record of the acceptance the model determines. Nothing here runs a
//! process: the packages, the consumer's workspace and the declared bounds are
//! checked against the model, and the document the verification retained must be
//! the document derived from them.

use super::{digest, ensure, file, hex, invalid, keys, process_order, string, PREFLIGHT};
use crate::error::PrismError;
use crate::holo::model_document::ModelDocument;
use crate::holo::server_application::ServerApplication;
use crate::server_host::acceptance;
use crate::verification::server::{check_subject, document, under, CoreIdentities, Files, Subject};
use serde_json::{json, Value};

/// Each part of the acceptance document and what it says when the retained one
/// differs from the derived one, in the order they are compared.
const PARTS: [(&str, &str); 5] = [
    ("bounds", "recorded bounds differ from the model"),
    (
        "consumer",
        "the consumer workspace of the release differs from the recorded one",
    ),
    (
        "core",
        "the recorded core package differs from the released one",
    ),
    (
        "host_packages",
        "the recorded host packages differ from the released ones",
    ),
    (
        "server",
        "the recorded acceptance differs from the acceptance the model determines",
    ),
];

#[allow(clippy::too_many_arguments)]
pub(super) fn binding(
    manifest: &Value,
    lex: &Value,
    model: &ModelDocument,
    application: &ServerApplication,
    build_id: &str,
    build_files: &Files,
    files: &Files,
    processes: &[Value],
) -> Result<(), PrismError> {
    keys(
        manifest,
        &[
            "acceptance_sha256",
            "build_id",
            "lexlean_attestation_sha256",
            "model_sha256",
            "processes",
            "schema",
        ],
    )?;
    ensure(
        manifest["schema"] == "prismpm/server-verification-manifest/1",
        "server application verification family differs",
    )?;
    let acceptance_bytes = file(files, "application-acceptance.json")?;
    for (key, bytes) in [
        ("acceptance_sha256", acceptance_bytes),
        (
            "lexlean_attestation_sha256",
            file(files, "lexlean-attestation.json")?,
        ),
        ("model_sha256", file(build_files, "model.prism.json")?),
    ] {
        ensure(
            digest(&manifest[key])? == hex(bytes),
            "server application verification evidence digest differs",
        )?;
    }

    let server = under(build_files, "server/");
    let consumer = under(build_files, "consumer/");
    ensure(
        !consumer.is_empty(),
        "the release retains no consumer workspace",
    )?;
    let subject = Subject {
        application,
        build_id,
        identities: CoreIdentities {
            source_id: string(&lex["source_id"])?,
            semantic_id: string(&lex["semantic_id"])?,
            compiler_semantics: &model.provenance.compiler_semantics_id,
            attestation_id: string(&lex["attestation_id"])?,
        },
        server: &server,
        consumer: &consumer,
    };
    let checked = check_subject(&subject)
        .map_err(|error| invalid(format!("server application: {}", error.message)))?;
    let modeled = acceptance::modeled_record(application)
        .map_err(|error| invalid(format!("server application: {}", error.message)))?;
    let derived = document(&subject, &checked, modeled);
    let retained = super::canonical_json(acceptance_bytes, false)?;
    for (part, message) in PARTS {
        ensure(retained.get(part) == derived.get(part), message)?;
    }
    ensure(
        retained == derived,
        "server application acceptance differs from the model or the released files",
    )?;

    let mut expected = PREFLIGHT.to_vec();
    expected.push("server-workspace-build");
    process_order(processes, &expected)?;
    ensure(
        processes[PREFLIGHT.len()]["argv"]
            == json!(["build", "--release", "--locked", "--offline", "--quiet"]),
        "server application workspace build arguments differ",
    )
}
