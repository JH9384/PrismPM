//! Acceptance of a built text command line against the Core-Wasm entry.
//!
//! Every acceptance vector is executed through the Core-Wasm guest and through
//! the program for the host architecture, over standard input, a file argument
//! and the explicit `-` argument. A report must be byte-identical to the guest's
//! and exit with the code of its modeled outcome. A request over the modeled
//! maximum cannot reach the guest through the program: it must be refused with
//! the typed `InputLimit` failure before dispatch, so the guest's response to it
//! is compared only with the model.

use super::{binary_path, help};
use crate::error::PrismError;
use crate::holo::model_document::TextApplicationModel;
use crate::holo::text_cli::TextCli;
use crate::verification::{run_process_limited, ProcessRecord};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

const RUNNER: &str = include_str!("acceptance.mjs");
const TIMEOUT_SECONDS: &str = "600";
const OUTPUT_LIMIT: usize = 1024 * 1024;
/// Transports exercised for every vector, in the order the runner reports them.
pub(crate) const TRANSPORTS: [&str; 3] = ["stdin", "file", "stdin-dash"];

fn invalid(message: &str) -> PrismError {
    PrismError::new("PP6003", message)
}

/// Target of the program that can run on this host.
pub(crate) fn host_target(architecture: &str) -> Result<&'static str, PrismError> {
    match architecture {
        "x86_64" => Ok("x86_64-unknown-linux-musl"),
        "aarch64" => Ok("aarch64-unknown-linux-musl"),
        _ => Err(invalid(
            "command-line acceptance has no program for this host architecture",
        )),
    }
}

fn modeled(application: &TextApplicationModel) -> Result<&TextCli, PrismError> {
    application
        .cli
        .as_ref()
        .ok_or_else(|| invalid("command-line acceptance requires a text/3 application"))
}

fn within_maximum(application: &TextApplicationModel) -> usize {
    application
        .acceptance_vectors
        .iter()
        .filter(|vector| vector.request.len() <= application.request_maximum as usize)
        .count()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn plan(application: &TextApplicationModel, cli: &TextCli) -> Result<Value, PrismError> {
    let mut vectors = Vec::new();
    for vector in &application.acceptance_vectors {
        let outcome = cli
            .classify(&vector.response)
            .ok_or_else(|| invalid("an acceptance response has no modeled outcome"))?;
        vectors.push(json!({
            "code": outcome.exit_code,
            "request": hex(&vector.request),
            "response": hex(&vector.response),
        }));
    }
    Ok(json!({
        "binary": application.cargo_name,
        "command": cli.command,
        "examples": cli.examples,
        "fault_code": cli.fault_code(),
        "help": help(application, cli),
        "outcomes": cli
            .outcomes
            .iter()
            .map(|outcome| json!({"code": outcome.exit_code, "prefix": outcome.prefix}))
            .collect::<Vec<_>>(),
        "request_maximum": application.request_maximum,
        "response_maximum": application.response_maximum,
        "vectors": vectors,
        "version": format!("{} {}\n", application.cargo_name, application.cargo_version),
    }))
}

/// The report the runner must print for this application.
fn expected_report(application: &TextApplicationModel, cli: &TextCli) -> Value {
    let within = within_maximum(application);
    json!({
        "examples": cli.examples.len(),
        "oversized_vectors": application.acceptance_vectors.len() - within,
        "schema": "prismpm/text-cli-acceptance/1",
        "transports": TRANSPORTS,
        "vectors": application.acceptance_vectors.len(),
        "within_request_maximum": within,
    })
}

/// Run the runner under Node and return its process record after checking that
/// its report is exactly the one the model requires.
#[allow(clippy::too_many_arguments)]
pub(crate) fn execute(
    application: &TextApplicationModel,
    wasm: &Path,
    program: &Path,
    work: &Path,
    node: &Path,
    replacements: &[(&Path, &str)],
) -> Result<ProcessRecord, PrismError> {
    let cli = modeled(application)?;
    let runner = work.join("text-cli-acceptance.mjs");
    let plan_path = work.join("text-cli-acceptance.json");
    let scratch = work.join("text-cli-vectors");
    for (path, bytes) in [
        (&runner, RUNNER.as_bytes().to_vec()),
        (
            &plan_path,
            serde_json::to_vec(&plan(application, cli)?)
                .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
        ),
    ] {
        std::fs::write(path, bytes)
            .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", path.display())))?;
    }
    let record = run_process_limited(
        "text-cli-acceptance",
        node,
        &[
            runner.to_string_lossy().into_owned(),
            wasm.to_string_lossy().into_owned(),
            program.to_string_lossy().into_owned(),
            plan_path.to_string_lossy().into_owned(),
            scratch.to_string_lossy().into_owned(),
        ],
        work,
        &BTreeMap::new(),
        replacements,
        "PP6003",
        TIMEOUT_SECONDS,
        OUTPUT_LIMIT,
    )?;
    check_report(application, &record.stdout)?;
    Ok(record)
}

/// Require a runner report to be exactly the one the model demands. Source-free
/// verification applies the same check to the retained process record.
pub(crate) fn check_report(
    application: &TextApplicationModel,
    stdout: &str,
) -> Result<(), PrismError> {
    let report: Value = serde_json::from_str(stdout.trim())
        .map_err(|error| invalid(&format!("command-line acceptance report: {error}")))?;
    if report != expected_report(application, modeled(application)?) {
        return Err(invalid(
            "command-line acceptance report differs from the modeled corpus",
        ));
    }
    Ok(())
}

/// The closed acceptance record bound into `application-acceptance.json`.
/// `digests` maps each published program path to its SHA-256.
pub(crate) fn evidence(
    application: &TextApplicationModel,
    host_architecture: &str,
    digests: &BTreeMap<String, String>,
) -> Result<Value, PrismError> {
    let cli = modeled(application)?;
    let mut programs = Vec::new();
    for target in super::TARGETS {
        let path = binary_path(target, application);
        let sha256 = digests
            .get(&path)
            .ok_or_else(|| invalid("a built command-line program is absent"))?;
        programs.push(json!({"path": path, "sha256": sha256, "target": target}));
    }
    let expected = expected_report(application, cli);
    Ok(json!({
        "executed_target": host_target(host_architecture)?,
        "examples": expected["examples"],
        "oversized_vectors": expected["oversized_vectors"],
        "programs": programs,
        "schema": "prismpm/text-cli-acceptance/1",
        "status": "verified",
        "transports": TRANSPORTS,
        "vectors": expected["vectors"],
        "within_request_maximum": expected["within_request_maximum"],
    }))
}
