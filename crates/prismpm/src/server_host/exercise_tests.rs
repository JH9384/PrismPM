//! HO-40: every declared effect is exercised by an acceptance vector, as the
//! acceptance observes it.
//!
//! Declaration validation already refuses a core effect that no transcript step
//! requests (PP2013). These tests give the acceptance declarations that skip
//! that validation, and require the run itself to refuse them: an effect the
//! program was never asked to perform is not a verified effect.

use super::acceptance::{self, exercises, require_exercised, Role};
use super::{serving_tests, tests};
use crate::holo::server_application::ServerApplication;
use serde_json::{json, Value};

fn declared(mut value: Value, effect: Value) -> ServerApplication {
    // The new effect takes the last tag, so the tags the built program knows are unchanged.
    value["host"]["effects"]
        .as_array_mut()
        .unwrap()
        .push(effect);
    serde_json::from_value(value).unwrap()
}

fn audit() -> Value {
    json!({
        "name": "audit.note",
        "request": [],
        "result": [],
        "failures": [],
        "request_maximum": 8,
        "result_maximum": 8
    })
}

#[test]
fn a_core_effect_no_vector_reaches_is_refused_with_pp2021() {
    let built = tests::built();
    let work = tempfile::tempdir().unwrap();
    // The program replays every vector as modeled; only the declaration has an
    // effect that no transcript step requests.
    let application = declared(tests::model_value(), audit());
    let error = acceptance::execute(&application, &built.program, work.path(), false)
        .expect_err("an effect no vector reaches is not verified");
    assert_eq!(error.code, "PP2026", "{}", error.message);
    assert!(error.message.contains("audit.note"), "{}", error.message);
    assert!(
        error.message.contains("transcript step"),
        "{}",
        error.message
    );
    // The same declaration without the effect is accepted.
    let record = acceptance::execute(&tests::model(), &built.program, work.path(), false).unwrap();
    assert_eq!(record["status"], "verified");
}

#[test]
fn a_frame_effect_no_served_exchange_reaches_is_refused_with_pp2021() {
    let built = serving_tests::built();
    let work = tempfile::tempdir().unwrap();
    let served = serving_tests::served_model();
    assert!(served
        .serving
        .first()
        .is_some_and(|serving| serving.vectors.len() == 4));
    // Every vector replays, but no exchange crosses the socket: nothing reached
    // the effects that fill the request frame.
    let mut value = serving_tests::served_value();
    value["serving"][0]["vectors"] = json!([]);
    let unserved: ServerApplication = serde_json::from_value(value).unwrap();
    let error = acceptance::execute(&unserved, &built.program, work.path(), false)
        .expect_err("a frame effect no exchange reaches is not verified");
    assert_eq!(error.code, "PP2026", "{}", error.message);
    assert!(
        error.message.contains("served exchange"),
        "{}",
        error.message
    );
    // Served, they are reached.
    let record = acceptance::execute(&served, &built.program, work.path(), false).unwrap();
    assert_eq!(record["served"], 4);
}

#[test]
fn the_record_names_every_effect_with_what_reached_it() {
    let plain = tests::model();
    let rows = exercises(&plain, 0);
    assert_eq!(
        rows.iter()
            .map(|row| (row.name.as_str(), row.role, row.steps, row.served))
            .collect::<Vec<_>>(),
        [
            ("store.get", Role::Core, 4, 0),
            ("clock.now", Role::Core, 1, 0),
            ("log.write", Role::Core, 1, 0),
        ]
    );
    require_exercised(&rows).unwrap();

    // Served exchanges reach the frame effects and none reaches a core effect.
    let served = serving_tests::served_model();
    let rows = exercises(&served, 4);
    assert!(rows
        .iter()
        .all(|row| row.role == Role::Frame && row.steps == 0 && row.served == 4));
    require_exercised(&rows).unwrap();
    assert_eq!(
        require_exercised(&exercises(&served, 0)).unwrap_err().code,
        "PP2026"
    );

    // One transcript step too few leaves exactly one core effect unreached.
    let mut value = tests::model_value();
    for transcript in value["host"]["transcripts"].as_array_mut().unwrap() {
        transcript["steps"]
            .as_array_mut()
            .unwrap()
            .retain(|step| step["effect"] != "log.write");
    }
    let fewer: ServerApplication = serde_json::from_value(value).unwrap();
    let error = require_exercised(&exercises(&fewer, 0)).unwrap_err();
    assert_eq!(error.code, "PP2026");
    assert!(error.message.contains("log.write"), "{}", error.message);
}
