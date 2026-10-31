//! The Rust half of issue #284, held against the JavaScript half's fixtures.

use super::{history_digest, parse_history, replay_bytes, run, ReplayRequest, RESULT_SCHEMA};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(relative: &str) -> Vec<u8> {
    std::fs::read(repo().join(relative)).expect(relative)
}

const HOLO: &str = "sdk/npm/prism-code/fixtures/Calculator.holo";
const CHANGED: &str = "sdk/npm/prism-code/test/fixtures/Calculator.changed-model.holo";
const HISTORY: &str = "sdk/npm/prism-code/fixtures/Calculator.history.json";
const STATEMENT: &str = "sdk/npm/spec/test/fixtures/attestation/statement/calculator-replay.json";

fn result_schema() -> Value {
    serde_json::from_slice(&read("schemas/replay-result.schema.json")).unwrap()
}

#[test]
fn the_reference_archive_replays_green_with_the_statement_the_javascript_half_writes() {
    let outcome = replay_bytes(&read(HOLO), &[read(HISTORY)]).unwrap();
    assert_eq!(outcome.divergence_count, 0);
    assert_eq!(outcome.result["schema"], RESULT_SCHEMA);
    assert_eq!(outcome.result["application"], "Calculator");
    assert_eq!(outcome.result["events"], 22);

    let mut expected: Value = serde_json::from_slice(&read(STATEMENT)).unwrap();
    // Only the runtime that ran it differs, so every other field is the same evidence.
    expected["predicate"]["runtime"] =
        json!({ "name": "prismpm", "version": env!("CARGO_PKG_VERSION") });
    assert_eq!(outcome.result["statement"], expected);
}

#[test]
fn the_digest_of_a_history_is_the_one_the_javascript_half_names() {
    let statement: Value = serde_json::from_slice(&read(STATEMENT)).unwrap();
    let digest = history_digest(&parse_history(&read(HISTORY)).unwrap()).unwrap();
    assert_eq!(digest, statement["predicate"]["histories"][0]["digest"]);

    // Reordered members and CRLF are the same history: the digest covers canonical JSON.
    let value: Value = serde_json::from_slice(&read(HISTORY)).unwrap();
    let spelled = serde_json::to_string_pretty(&value)
        .unwrap()
        .replace('\n', "\r\n");
    assert_eq!(
        history_digest(&parse_history(spelled.as_bytes()).unwrap()).unwrap(),
        digest
    );
}

#[test]
fn a_changed_model_diverges_on_exactly_the_events_the_javascript_half_finds() {
    let outcome = replay_bytes(&read(CHANGED), &[read(HISTORY)]).unwrap();
    assert_eq!(outcome.divergence_count, 7);
    let statement = &outcome.result["statement"];
    assert_eq!(statement["predicate"]["divergenceCount"], 7);
    assert_eq!(statement["predicate"]["histories"][0]["divergences"], 7);
    let first = &outcome.result["histories"][0]["divergences"][1];
    assert_eq!(first["index"], 1);
    assert_eq!(first["expected"]["response"], hex("1\tok\t42"));
    assert_eq!(first["actual"]["response"], hex("1\tOK\t42"));
    // It names the changed guest and model, so the statement cannot be mistaken for the old build's.
    let before: Value = serde_json::from_slice(&read(STATEMENT)).unwrap();
    assert_ne!(statement["subject"], before["subject"]);
    assert_ne!(
        statement["predicate"]["model"],
        before["predicate"]["model"]
    );
}

fn hex(text: &str) -> String {
    text.bytes().map(|byte| format!("{byte:02x}")).collect()
}

fn history(events: Value) -> Vec<u8> {
    serde_json::to_vec(
        &json!({ "schema": "prism/history/1", "application": null, "events": events }),
    )
    .unwrap()
}

#[test]
fn a_refusal_is_an_outcome_with_the_javascript_code() {
    let over = "00".repeat(65_537);
    let same = history(json!([{ "request": over, "error": "core.allocation" }]));
    assert_eq!(
        replay_bytes(&read(HOLO), &[same]).unwrap().divergence_count,
        0
    );

    let other = history(json!([{ "request": over, "response": "" }]));
    let outcome = replay_bytes(&read(HOLO), &[other]).unwrap();
    assert_eq!(outcome.divergence_count, 1);
    assert_eq!(
        outcome.result["histories"][0]["divergences"][0]["actual"],
        json!({ "error": "core.allocation" })
    );
}

#[test]
fn several_histories_are_named_and_summed() {
    let second = history(json!([{ "request": hex("1\tadd\t1\t1"), "response": hex("1\tok\t2") }]));
    let outcome = replay_bytes(&read(CHANGED), &[read(HISTORY), second]).unwrap();
    assert_eq!(outcome.divergence_count, 8);
    assert_eq!(outcome.result["events"], 23);
    let rows = outcome.result["statement"]["predicate"]["histories"]
        .as_array()
        .unwrap();
    assert_eq!(
        rows.iter()
            .map(|row| row["divergences"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        [7, 1]
    );
}

#[test]
fn every_invalid_spec_fixture_is_refused_and_every_valid_one_parses() {
    let folder = repo().join("sdk/npm/spec/test/fixtures/history/history-v1");
    let mut valid = 0;
    for entry in std::fs::read_dir(&folder).unwrap() {
        let path = entry.unwrap().path();
        if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            parse_history(&std::fs::read(&path).unwrap()).unwrap();
            valid += 1;
        }
    }
    assert!(valid >= 2);
    let mut invalid = 0;
    for entry in std::fs::read_dir(folder.join("invalid")).unwrap() {
        let path = entry.unwrap().path();
        let error =
            parse_history(&std::fs::read(&path).unwrap()).expect_err(&path.display().to_string());
        assert_eq!(error.code.as_str(), "PP5706", "{}", path.display());
        invalid += 1;
    }
    assert!(invalid >= 5);
}

#[test]
fn what_cannot_be_replayed_is_refused_with_its_own_code_and_exit() {
    let refused = |error: crate::error::PrismError| {
        assert_eq!(error.code.as_str(), "PP5706");
        assert_eq!(error.exit_code(), 2);
    };
    refused(replay_bytes(&read(HOLO), &[]).unwrap_err());
    refused(replay_bytes(&read(HOLO), &[read(HISTORY), read(HISTORY)]).unwrap_err());
    refused(replay_bytes(b"not a holo", &[read(HISTORY)]).unwrap_err());
    let mut damaged = read(HOLO);
    let at = damaged.len() - 1;
    damaged[at] ^= 0xff;
    refused(replay_bytes(&damaged, &[read(HISTORY)]).unwrap_err());
}

#[test]
fn run_writes_the_statement_on_a_pass_and_on_a_divergence_and_only_the_divergence_fails() {
    let work = tempfile::tempdir().unwrap();
    let statement = work.path().join("statement.json");
    let request = |holo: &str| ReplayRequest {
        histories: vec![repo().join(HISTORY)],
        holo: repo().join(holo),
        statement: Some(statement.clone()),
    };

    let (result, human) = run(&request(HOLO)).unwrap();
    assert!(human.contains("no divergence"), "{human}");
    let written = std::fs::read(&statement).unwrap();
    assert_eq!(written.last(), Some(&b'\n'));
    assert_eq!(
        serde_json::from_slice::<Value>(&written).unwrap(),
        result["statement"]
    );

    let error = run(&request(CHANGED)).unwrap_err();
    assert_eq!(error.code.as_str(), "PP5701");
    assert_eq!(error.exit_code(), 1);
    assert!(
        error.message.contains("7 of 22 events"),
        "{}",
        error.message
    );
    assert!(
        error
            .message
            .contains(r#"recorded "1\tok\t0", replayed "1\tOK\t0""#),
        "{}",
        error.message
    );
    let failed: Value = serde_json::from_slice(&std::fs::read(&statement).unwrap()).unwrap();
    assert_eq!(failed["predicate"]["divergenceCount"], 7);
}

#[test]
fn a_directory_is_its_json_files_sorted_by_name() {
    let work = tempfile::tempdir().unwrap();
    std::fs::write(work.path().join("b.json"), read(HISTORY)).unwrap();
    std::fs::write(
        work.path().join("a.JSON"),
        history(json!([{ "request": hex("1\tadd\t1\t1"), "response": hex("1\tok\t2") }])),
    )
    .unwrap();
    std::fs::write(work.path().join("notes.txt"), b"not a history").unwrap();
    let (result, _) = run(&ReplayRequest {
        histories: vec![work.path().to_owned()],
        holo: repo().join(HOLO),
        statement: None,
    })
    .unwrap();
    let events = result["histories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["events"].as_u64().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(events, [1, 22]);

    let empty = tempfile::tempdir().unwrap();
    let error = run(&ReplayRequest {
        histories: vec![empty.path().to_owned()],
        holo: repo().join(HOLO),
        statement: None,
    })
    .unwrap_err();
    assert_eq!(error.code.as_str(), "PP5706");
}

#[test]
fn the_result_names_the_members_its_schema_requires() {
    let outcome = replay_bytes(&read(HOLO), &[read(HISTORY)]).unwrap();
    let schema = result_schema();
    assert_eq!(schema["properties"]["schema"]["const"], RESULT_SCHEMA);
    let result = outcome.result.as_object().unwrap();
    let required: Vec<&str> = schema["required"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    for member in &required {
        assert!(result.contains_key(*member), "{member}");
    }
    assert_eq!(result.len(), required.len());
}
