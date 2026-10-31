//! `prismpm replay`: re-execute recorded histories against a `.holo` and fail
//! on divergence (issue #284, `docs/proposals/284-histories-replay.md`).
//!
//! A history is `prism/history/1`, the format `prism-code` records and replays
//! (`sdk/npm/prism-code/src/replay.mjs`). The two runtimes agree on the digest
//! of a history and on every field of `prism/replay/v1` but the runtime that
//! ran it; a test holds this one against the JavaScript half's fixture.
//!
//! The crate has no Wasm engine, so the guest runs through Node, as command-line
//! acceptance already does (`text_cli/acceptance.rs`). Node only executes the
//! requests. This module reads the archive, compares every outcome and writes
//! the statement.

use crate::error::PrismError;
use crate::holo::archive::parse_application;
use crate::holo::canonical::encode_value;
use crate::verification::{executable, run_process_limited};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// The schema member of a history.
pub const HISTORY_SCHEMA: &str = "prism/history/1";
/// The predicate type of the statement a replay writes.
pub const REPLAY_PREDICATE_TYPE: &str = "https://uor.foundation/prism/replay/v1";
/// The schema member of this command's result.
pub const RESULT_SCHEMA: &str = "prismpm/replay-result/1";

const STATEMENT_TYPE: &str = "https://in-toto.io/Statement/v1";
const RUNNER: &str = include_str!("runner.mjs");
const TIMEOUT_SECONDS: &str = "600";
const OUTPUT_LIMIT: usize = 1024 * 1024;

/// What a request to replay names.
#[derive(Debug, Clone)]
pub struct ReplayRequest {
    /// History files, or directories of them.
    pub histories: Vec<PathBuf>,
    /// The build to replay against.
    pub holo: PathBuf,
    /// Where to write the statement, also when the replay diverged.
    pub statement: Option<PathBuf>,
}

/// A replay that could not be carried out. A divergence is `PP5701` instead.
fn refused(message: impl Into<String>) -> PrismError {
    PrismError::new("PP5706", message)
}

fn invalid(message: impl std::fmt::Display) -> PrismError {
    refused(format!("the history is not {HISTORY_SCHEMA}: {message}"))
}

fn digests(bytes: &[u8]) -> Value {
    json!({
        "blake3": blake3::hash(bytes).to_hex().to_string(),
        "sha256": format!("{:x}", Sha256::digest(bytes)),
    })
}

fn is_hex(text: &str) -> bool {
    text.len().is_multiple_of(2)
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_digest(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|text| text.len() == 64 && is_hex(text))
}

/// `^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$`, the stable code of a failed dispatch.
fn is_error_code(text: &str) -> bool {
    let word = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    };
    let mut parts = text.split('.');
    let first = parts.next().unwrap_or_default();
    let rest: Vec<&str> = parts.collect();
    word(first)
        && first.as_bytes()[0].is_ascii_lowercase()
        && !rest.is_empty()
        && rest.iter().all(|part| word(part))
}

fn only_members(
    object: &Map<String, Value>,
    allowed: &[&str],
    place: &str,
) -> Result<(), PrismError> {
    match object.keys().find(|key| !allowed.contains(&key.as_str())) {
        Some(key) => Err(invalid(format!("{place} has the unknown member {key}"))),
        None => Ok(()),
    }
}

fn digest_set(value: &Value, place: &str) -> Result<(), PrismError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid(format!("{place} is not a digest set")))?;
    only_members(object, &["blake3", "sha256"], place)?;
    for key in ["blake3", "sha256"] {
        if !object.get(key).is_some_and(is_digest) {
            return Err(invalid(format!(
                "{place}.{key} is not 64 lowercase hex characters"
            )));
        }
    }
    Ok(())
}

fn hex_field<'a>(value: Option<&'a Value>, place: &str) -> Result<&'a str, PrismError> {
    value
        .and_then(Value::as_str)
        .filter(|text| is_hex(text))
        .ok_or_else(|| invalid(format!("{place} is not lowercase hex")))
}

fn check_event(value: &Value, index: usize) -> Result<(), PrismError> {
    let place = format!("events[{index}]");
    let event = value
        .as_object()
        .ok_or_else(|| invalid(format!("{place} is not an object")))?;
    hex_field(event.get("request"), &format!("{place}.request"))?;
    match (event.contains_key("response"), event.contains_key("error")) {
        (true, false) => {
            only_members(event, &["request", "response"], &place)?;
            hex_field(event.get("response"), &format!("{place}.response"))?;
        }
        (false, true) => {
            only_members(event, &["request", "error"], &place)?;
            if !event
                .get("error")
                .and_then(Value::as_str)
                .is_some_and(is_error_code)
            {
                return Err(invalid(format!("{place}.error is not a stable error code")));
            }
        }
        _ => {
            return Err(invalid(format!(
                "{place} must hold exactly one of response and error"
            )))
        }
    }
    Ok(())
}

/// Parse a history, rejecting what `schemas/history/history-v1.schema.json` rejects.
pub fn parse_history(bytes: &[u8]) -> Result<Value, PrismError> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|error| invalid(format!("it is not JSON: {error}")))?;
    let history = value
        .as_object()
        .ok_or_else(|| invalid("it is not a JSON object"))?;
    only_members(
        history,
        &["schema", "application", "recordedFrom", "events"],
        "the history",
    )?;
    if history.get("schema").and_then(Value::as_str) != Some(HISTORY_SCHEMA) {
        return Err(invalid(format!(
            "schema is {}",
            history.get("schema").unwrap_or(&Value::Null)
        )));
    }
    match history.get("application") {
        Some(Value::Null) => {}
        Some(Value::String(name)) if !name.is_empty() => {}
        Some(_) => return Err(invalid("application must be a name or null")),
        None => return Err(invalid("application is missing")),
    }
    if let Some(recorded) = history.get("recordedFrom") {
        let recorded = recorded
            .as_object()
            .ok_or_else(|| invalid("recordedFrom is not an object"))?;
        only_members(recorded, &["guest", "model"], "recordedFrom")?;
        for key in ["guest", "model"] {
            digest_set(
                recorded.get(key).unwrap_or(&Value::Null),
                &format!("recordedFrom.{key}"),
            )?;
        }
    }
    let events = history
        .get("events")
        .and_then(Value::as_array)
        .filter(|events| !events.is_empty())
        .ok_or_else(|| invalid("events must hold at least one event"))?;
    for (index, event) in events.iter().enumerate() {
        check_event(event, index)?;
    }
    Ok(value)
}

/// Both digests of a history: over its canonical JSON, with no trailing newline.
pub fn history_digest(history: &Value) -> Result<Value, PrismError> {
    Ok(digests(&encode_value(history)?))
}

/// A path given to `replay` as the files it means: a file, or every `.json`
/// directly in a directory, sorted by name.
fn history_paths(path: &Path) -> Result<Vec<PathBuf>, PrismError> {
    let metadata =
        std::fs::metadata(path).map_err(|error| refused(format!("{}: {error}", path.display())))?;
    if !metadata.is_dir() {
        return Ok(vec![path.to_owned()]);
    }
    let mut names = std::fs::read_dir(path)
        .map_err(|error| refused(format!("{}: {error}", path.display())))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| refused(format!("{}: {error}", path.display())))?
        .into_iter()
        .map(|entry| entry.path())
        .filter(|entry| {
            entry
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
        })
        .collect::<Vec<_>>();
    names.sort();
    if names.is_empty() {
        return Err(refused(format!("{} holds no history", path.display())));
    }
    Ok(names)
}

/// Run every request through the guest. The outcomes are `{response}` or `{error}`, in order.
fn run_guest(guest: &[u8], allocation: u64, requests: &[String]) -> Result<Vec<Value>, PrismError> {
    let node = executable("node").map_err(|error| refused(error.to_string()))?;
    let work = tempfile::tempdir().map_err(|error| refused(error.to_string()))?;
    let (runner, wasm, plan, outcomes) = (
        work.path().join("replay.mjs"),
        work.path().join("guest.wasm"),
        work.path().join("plan.json"),
        work.path().join("outcomes.json"),
    );
    let plan_bytes = serde_json::to_vec(&json!({
        "guest_allocation_maximum": allocation,
        "requests": requests,
    }))
    .map_err(|error| PrismError::new("PP9001", error.to_string()))?;
    for (path, bytes) in [
        (&runner, RUNNER.as_bytes()),
        (&wasm, guest),
        (&plan, plan_bytes.as_slice()),
    ] {
        std::fs::write(path, bytes)
            .map_err(|error| refused(format!("{}: {error}", path.display())))?;
    }
    run_process_limited(
        "replay",
        &node,
        &[&runner, &wasm, &plan, &outcomes].map(|path| path.to_string_lossy().into_owned()),
        work.path(),
        &BTreeMap::new(),
        &[],
        "PP5706",
        TIMEOUT_SECONDS,
        OUTPUT_LIMIT,
    )?;
    let bytes = std::fs::read(&outcomes)
        .map_err(|error| refused(format!("the guest runner wrote no outcomes: {error}")))?;
    let values: Vec<Value> = serde_json::from_slice(&bytes)
        .map_err(|error| PrismError::new("PP9001", error.to_string()))?;
    if values.len() != requests.len() {
        return Err(PrismError::new(
            "PP9001",
            "the guest runner answered another number of requests",
        ));
    }
    Ok(values)
}

fn expected_of(event: &Value) -> Value {
    match event.get("error") {
        Some(error) => json!({ "error": error }),
        None => json!({ "response": event["response"] }),
    }
}

/// A recorded or replayed outcome as a person reads it.
fn display_outcome(outcome: &Value) -> String {
    if let Some(error) = outcome["error"].as_str() {
        return format!("error {error}");
    }
    let hex = outcome["response"].as_str().unwrap_or_default();
    let bytes = (0..hex.len() / 2)
        .map(|at| u8::from_str_radix(&hex[at * 2..at * 2 + 2], 16))
        .collect::<Result<Vec<u8>, _>>()
        .unwrap_or_default();
    match String::from_utf8(bytes) {
        Ok(text) => Value::String(text).to_string(),
        Err(_) => format!("0x{hex}"),
    }
}

/// The application's name, as `prism-code` reads it: the model's, then the crate's.
fn application_name(model: &Value, provenance: &Value) -> Value {
    model["application"]["name"]
        .as_str()
        .or_else(|| provenance["cargo_name"].as_str())
        .map_or(Value::Null, |name| Value::String(name.to_owned()))
}

/// The outcome of one replay, whether or not it diverged.
#[derive(Debug, Clone)]
pub struct ReplayOutcome {
    /// `prismpm/replay-result/1`.
    pub result: Value,
    /// Events whose outcome differs from the recording, across every history.
    pub divergence_count: u64,
}

/// Re-execute every event of every history against the bytes of a holo.
pub fn replay_bytes(holo: &[u8], histories: &[Vec<u8>]) -> Result<ReplayOutcome, PrismError> {
    if histories.is_empty() {
        return Err(refused("replay takes at least one history"));
    }
    let archive = parse_application(holo)
        .map_err(|error| refused(format!("the holo cannot be replayed: {error}")))?;
    let blob = |label: &str| {
        archive
            .blobs
            .get(label)
            .ok_or_else(|| refused(format!("{label} is not a content blob of this holo")))
    };
    let guest = blob(&archive.identities.guest_content_kappa)?;
    let model_bytes = blob(&archive.identities.model_content_kappa)?;
    let model: Value = serde_json::from_slice(model_bytes)
        .map_err(|error| refused(format!("the model document is not JSON: {error}")))?;
    let provenance: Value = serde_json::from_slice(&archive.prism_extension)
        .map_err(|error| refused(format!("the provenance is not JSON: {error}")))?;
    let allocation = model["application"]["guest_allocation_maximum"]
        .as_u64()
        .ok_or_else(|| refused("the model states no guest allocation maximum"))?;

    let parsed = histories
        .iter()
        .map(|bytes| parse_history(bytes))
        .collect::<Result<Vec<_>, _>>()?;
    let history_digests = parsed
        .iter()
        .map(history_digest)
        .collect::<Result<Vec<_>, _>>()?;
    let distinct: BTreeSet<&str> = history_digests
        .iter()
        .filter_map(|digest| digest["blake3"].as_str())
        .collect();
    if distinct.len() != parsed.len() {
        return Err(refused(
            "the same history was given twice; the statement names each one once",
        ));
    }

    let requests: Vec<String> = parsed
        .iter()
        .flat_map(|history| history["events"].as_array().into_iter().flatten())
        .map(|event| event["request"].as_str().unwrap_or_default().to_owned())
        .collect();
    let outcomes = run_guest(guest, allocation, &requests)?;

    let mut remaining = outcomes.into_iter();
    let mut replayed = Vec::new();
    let mut predicate_histories = Vec::new();
    let mut divergence_count = 0u64;
    for (history, digest) in parsed.iter().zip(&history_digests) {
        let events = history["events"].as_array().cloned().unwrap_or_default();
        let mut divergences = Vec::new();
        for (index, event) in events.iter().enumerate() {
            let actual = remaining.next().ok_or_else(|| {
                PrismError::new("PP9001", "the guest runner answered too few requests")
            })?;
            let expected = expected_of(event);
            if actual != expected {
                divergences.push(json!({
                    "index": index,
                    "request": event["request"],
                    "expected": expected,
                    "actual": actual,
                }));
            }
        }
        divergence_count += divergences.len() as u64;
        predicate_histories.push(json!({
            "digest": digest,
            "events": events.len(),
            "divergences": divergences.len(),
        }));
        replayed.push(json!({
            "digest": digest,
            "application": history["application"],
            "events": events.len(),
            "divergences": divergences,
        }));
    }

    let runtime = json!({ "name": "prismpm", "version": env!("CARGO_PKG_VERSION") });
    let statement = json!({
        "_type": STATEMENT_TYPE,
        "subject": [{ "name": "guest", "digest": digests(guest) }],
        "predicateType": REPLAY_PREDICATE_TYPE,
        "predicate": {
            "runtime": runtime,
            "model": digests(model_bytes),
            "histories": predicate_histories,
            "divergenceCount": divergence_count,
        },
    });
    let result = json!({
        "schema": RESULT_SCHEMA,
        "application": application_name(&model, &provenance),
        "runtime": runtime,
        "events": requests.len(),
        "divergenceCount": divergence_count,
        "histories": replayed,
        "statement": statement,
    });
    Ok(ReplayOutcome {
        result,
        divergence_count,
    })
}

fn divergence_message(outcome: &ReplayOutcome) -> String {
    let first = outcome.result["histories"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|history| history["divergences"].as_array())
        .flatten()
        .next()
        .cloned()
        .unwrap_or(Value::Null);
    format!(
        "the replay diverged from its history on {} of {} events; first at event {}: recorded {}, replayed {}",
        outcome.divergence_count,
        outcome.result["events"],
        first["index"],
        display_outcome(&first["expected"]),
        display_outcome(&first["actual"]),
    )
}

/// `prismpm replay`: the result and one line for a person, or `PP5701` when an
/// event diverged, after the statement is written: a failed replay is evidence too.
pub fn run(request: &ReplayRequest) -> Result<(Value, String), PrismError> {
    let holo = std::fs::read(&request.holo)
        .map_err(|error| refused(format!("{}: {error}", request.holo.display())))?;
    let mut histories = Vec::new();
    for path in &request.histories {
        for file in history_paths(path)? {
            histories.push(
                std::fs::read(&file)
                    .map_err(|error| refused(format!("{}: {error}", file.display())))?,
            );
        }
    }
    let outcome = replay_bytes(&holo, &histories)?;
    if let Some(path) = &request.statement {
        let mut bytes = encode_value(&outcome.result["statement"])?;
        bytes.push(b'\n');
        std::fs::write(path, bytes)
            .map_err(|error| refused(format!("{}: {error}", path.display())))?;
    }
    if outcome.divergence_count > 0 {
        return Err(PrismError::new("PP5701", divergence_message(&outcome)));
    }
    let human = format!(
        "replay passed: {} events across {} histories, no divergence",
        outcome.result["events"],
        histories.len()
    );
    Ok((outcome.result, human))
}

#[cfg(test)]
mod tests;
