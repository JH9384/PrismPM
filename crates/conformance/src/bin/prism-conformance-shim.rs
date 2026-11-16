//! The Rust runtime's shim for `@prism-code/conformance` (#298): it reads one
//! `prism/conformance-shim/1` request on stdin, calls the `prismpm` library,
//! and writes one answer on stdout. `sdk/npm/conformance/README.md` states the
//! contract, and `sdk/npm/prism-code/conformance/shim.mjs` is the JavaScript
//! runtime's shim.
//!
//! It judges nothing and adds no behaviour: it only translates. The operations
//! the Rust runtime does not have yet (`load`, `dispatch`, `acceptance`,
//! `capabilities`, `auth`, `replay`) answer `unsupported`, and the Rust
//! declaration names each check that fails for that reason.
//!
//! DK-42 builds it and runs the suite against it with the declaration in
//! `crates/conformance/runtime/declaration.json`:
//!
//! ```text
//! cargo build -p repo-conformance --bin prism-conformance-shim
//! node sdk/npm/conformance/bin/prism-conformance.mjs run --runtime rust \
//!   --declaration crates/conformance/runtime/declaration.json -- target/debug/prism-conformance-shim
//! ```

use std::io::{Read, Write};

use prismpm::inspect::inspect;
use prismpm::inspect::verdict::{verify, NoVerdict, Policy, Verdict, MINIMUM_LEVEL_ENV};
use serde_json::{json, Map, Value};

const CONTRACT: &str = "prism/conformance-shim/1";
const OPERATIONS: [&str; 3] = ["describe", "inspect", "verify"];

/// What the runtime answers, before it is put in the contract's envelope.
enum Answer {
    Ok(Value),
    Error(Value),
    Unsupported(String),
}

/// A step that reached no verdict, as `holo.verify()` reports it.
fn no_verdict(refused: &NoVerdict) -> Answer {
    Answer::Error(json!({
        "code": "verification_failed",
        "check": refused.check,
        "message": refused.message,
    }))
}

/// The error code of the class `prism-code` maps a reason's check to
/// (`classForCheck` in `sdk/npm/prism-code/src/errors.mjs`).
fn code_for_check(check: &str) -> &'static str {
    let policy_rule = check.starts_with("policy.")
        && !matches!(
            check,
            "policy.level"
                | "policy.effects"
                | "policy.invalid"
                | "policy.unreadable"
                | "policy.digests"
        )
        && !check.starts_with("policy.digests.");
    match check {
        "policy.parse" => "policy_parse_failed",
        "policy.evaluation" => "policy_evaluation_failed",
        _ if policy_rule => "policy_denied",
        _ if check.starts_with("proof.") => "proof_mismatch",
        _ if check == "world.capabilities" || check.starts_with("capabilities.") => {
            "capability_denied"
        }
        "world.contract" | "world.hash" => "world_mismatch",
        "replay.divergence" => "determinism_violation",
        _ if check.starts_with("replay.") => "replay_failed",
        _ => "verification_failed",
    }
}

/// A verdict that did not pass, as the error `holo.verify({ throw: true })`
/// raises (`errorFromVerdict`): damage first, since it fails every policy
/// (`policy.integrity`) and is the reason to name, then a rule the caller
/// pinned, then a world outside the grant, then the first reason that
/// withholds a level up to the minimum, carrying the whole verdict.
fn failed(verdict: &Verdict) -> Answer {
    let reasons = &verdict.reasons;
    let damaged = reasons
        .iter()
        .find(|reason| reason.check == "holo.integrity");
    let pinned = reasons
        .iter()
        .find(|reason| reason.withholds.is_none() && reason.check != "policy.level");
    let outside = reasons
        .iter()
        .find(|reason| reason.check == "world.capabilities");
    let blocking = reasons.iter().find(|reason| {
        reason
            .withholds
            .is_some_and(|level| level.rank() <= verdict.minimum.rank())
    });
    let reason = damaged
        .or(pinned)
        .or(outside)
        .or(blocking)
        .or_else(|| reasons.iter().find(|reason| reason.check != "policy.level"))
        .or_else(|| reasons.first());
    let mut error = Map::new();
    let check = reason.map_or("policy.level", |reason| reason.check.as_str());
    error.insert("code".into(), json!(code_for_check(check)));
    error.insert("check".into(), json!(check));
    if let Some(code) = reason.and_then(|reason| reason.code) {
        error.insert("diagnostic".into(), json!(code));
    }
    error.insert("verdict".into(), verdict.value());
    Answer::Error(Value::Object(error))
}

fn describe() -> Answer {
    Answer::Ok(json!({
        "contract": CONTRACT,
        "runtime": "rust",
        "name": "prismpm",
        "version": env!("CARGO_PKG_VERSION"),
        "revisions": ["2026-10-23"],
        "operations": OPERATIONS,
    }))
}

fn verify_op(bytes: &[u8], input: &Map<String, Value>) -> Answer {
    let policy = input.get("policy").cloned().unwrap_or_else(|| json!({}));
    let minimum = std::env::var(MINIMUM_LEVEL_ENV).ok();
    let policy = match Policy::from_json(&policy)
        .and_then(|policy| policy.with_environment(minimum.as_deref()))
    {
        Ok(policy) => policy,
        Err(refused) => return no_verdict(&refused),
    };
    match verify(bytes, &policy) {
        Err(refused) => no_verdict(&refused),
        Ok(verdict) if !verdict.passed && input.get("throw") == Some(&Value::Bool(true)) => {
            failed(&verdict)
        }
        Ok(verdict) => Answer::Ok(verdict.value()),
    }
}

fn answer(request: &Value) -> Answer {
    let op = request.get("op").and_then(Value::as_str).unwrap_or("");
    if op == "describe" {
        return describe();
    }
    if !OPERATIONS.contains(&op) {
        return Answer::Unsupported(format!("the Rust runtime has no operation {op} yet (#298)"));
    }
    let Some(path) = request.get("archive").and_then(Value::as_str) else {
        return Answer::Unsupported(format!("{op} needs an archive"));
    };
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return Answer::Error(json!({ "code": "load.path", "message": error.to_string() }))
        }
    };
    let empty = Map::new();
    let input = request
        .get("input")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    match op {
        "inspect" => match inspect(&bytes) {
            Ok(inspection) => Answer::Ok(inspection),
            Err(error) => Answer::Error(json!({
                "code": error.code.to_string(),
                "message": error.message,
            })),
        },
        _ => verify_op(&bytes, input),
    }
}

fn main() {
    let mut text = String::new();
    let envelope = match std::io::stdin().read_to_string(&mut text) {
        Err(error) => json!({ "ok": false, "unsupported": format!("stdin: {error}") }),
        Ok(_) => match serde_json::from_str::<Value>(&text) {
            Err(error) => {
                json!({ "ok": false, "unsupported": format!("the request is not JSON: {error}") })
            }
            Ok(request) => match answer(&request) {
                Answer::Ok(result) => json!({ "ok": true, "result": result }),
                Answer::Error(error) => json!({ "ok": false, "error": error }),
                Answer::Unsupported(why) => json!({ "ok": false, "unsupported": why }),
            },
        },
    };
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{envelope}");
}
