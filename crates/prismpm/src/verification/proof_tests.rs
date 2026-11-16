use super::*;
use serde_json::json;

/// The calculator statement of the spec package, the example of
/// `docs/proposals/266-proof-predicate.md`.
const CALCULATOR: &str =
    include_str!("../../../../sdk/npm/spec/test/fixtures/attestation/statement/calculator.json");

fn calculator() -> Value {
    serde_json::from_str(CALCULATOR).unwrap()
}

/// The writer's input: its values, the Lean modules, the theorems and the replay exits.
type Input = (Values, Vec<(String, String)>, Vec<Theorem>, Vec<u64>);

/// The writer's input that describes the calculator statement.
fn input(statement: &Value) -> Input {
    let p = &statement["predicate"];
    let s = |value: &Value| value.as_str().unwrap().to_owned();
    let tcb = |component: &str| {
        p["tcb"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["component"] == component)
            .unwrap()
            .clone()
    };
    let values: Values = [
        s(&statement["subject"][0]["name"]),
        s(&statement["subject"][0]["digest"]["sha256"]),
        s(&p["verifier"]["lean"]["version"])
            .trim_start_matches('v')
            .to_owned(),
        s(&p["verifier"]["lean"]["commit"]),
        s(&p["verifier"]["lexlean"]["version"]),
        s(&p["verifier"]["lexlean"]["commit"]),
        s(&p["verifier"]["lexlean"]["crateSha256"]),
        s(&tcb("lean4-prod")["version"]),
        s(&tcb("rustc")["version"]),
        s(&tcb("wasm-bindgen-cli")["version"]),
        s(&p["verifier"]["prismpm"]["version"]),
        s(&p["verifier"]["sdkImage"]),
        s(&tcb("sdk-image")["version"]),
        s(&p["model"]["snapshotId"]),
        s(&p["model"]["document"]["sha256"]),
        s(&p["model"]["sourceId"]),
        s(&p["model"]["semanticId"]),
        s(&p["model"]["compilerSemanticsId"]),
        s(&p["model"]["leanManifestSha256"]),
        s(&p["evidence"]["lexleanAttestation"]["sha256"]),
        s(&p["evidence"]["verificationManifest"]["sha256"]),
        s(&p["timeVerified"]),
    ];
    let modules = p["model"]["modules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|module| {
            (
                format!(
                    "lexlean/build/modules/{}.lean",
                    s(&module["name"]).replace('.', "/")
                ),
                s(&module["leanSha256"]),
            )
        })
        .collect();
    let theorems = p["theorems"]
        .as_array()
        .unwrap()
        .iter()
        .map(|theorem| Theorem {
            name: s(&theorem["name"]),
            module: s(&theorem["module"]),
            result: "ok".to_owned(),
            kind: s(&theorem["axioms"]["policy"]["kind"]),
            allowed: strings(&theorem["axioms"]["policy"]["axioms"]),
            observed: strings(&theorem["axioms"]["observed"]),
        })
        .collect();
    (values, modules, theorems, vec![0])
}

fn statement(outcome: Outcome) -> Value {
    match outcome {
        Outcome::Statement(bytes) => serde_json::from_slice(&bytes).unwrap(),
        Outcome::Refused(code, message) => panic!("refused: {code}: {message}"),
    }
}

fn refusal(outcome: Outcome) -> (String, String) {
    match outcome {
        Outcome::Refused(code, message) => (code, message),
        Outcome::Statement(bytes) => panic!("wrote {}", String::from_utf8_lossy(&bytes)),
    }
}

#[test]
fn the_model_writes_the_calculator_statement_of_the_proposal() {
    let expected = calculator();
    let (values, modules, theorems, exits) = input(&expected);
    let written = project(values, modules, theorems, exits).unwrap();
    let Outcome::Statement(bytes) = &written else {
        panic!("refused")
    };
    assert_eq!(*bytes, encode_value(&expected).unwrap());
}

#[test]
fn a_failed_replay_or_an_axiom_outside_the_policy_fails_the_verdict() {
    let (values, modules, theorems, _) = input(&calculator());
    let replayed =
        statement(project(values.clone(), modules.clone(), theorems, vec![0, 1]).unwrap());
    assert_eq!(replayed["predicate"]["verificationResult"], "FAILED");

    let (_, _, mut theorems, exits) = input(&calculator());
    theorems[1].observed = vec!["Classical.choice".to_owned()];
    let audited = statement(project(values, modules, theorems, exits).unwrap());
    assert_eq!(audited["predicate"]["verificationResult"], "FAILED");
    assert_eq!(audited["predicate"]["theorems"][1]["verdict"], "FAILED");
    assert_eq!(audited["predicate"]["theorems"][0]["verdict"], "PASSED");
}

#[test]
fn an_exact_policy_needs_every_axiom_it_names() {
    let (values, modules, mut theorems, exits) = input(&calculator());
    theorems[0].kind = "exact".to_owned();
    theorems[0].allowed = vec!["propext".to_owned(), "Quot.sound".to_owned()];
    theorems[0].observed = vec!["propext".to_owned()];
    theorems[2].kind = "allow".to_owned();
    theorems[2].allowed = vec!["propext".to_owned(), "Quot.sound".to_owned()];
    theorems[2].observed = vec!["propext".to_owned()];
    let written = statement(project(values, modules, theorems, exits).unwrap());
    assert_eq!(written["predicate"]["theorems"][0]["verdict"], "FAILED");
    assert_eq!(written["predicate"]["theorems"][2]["verdict"], "PASSED");
}

#[test]
fn a_model_without_theorems_gets_no_statement() {
    let (values, modules, _, exits) = input(&calculator());
    let (code, message) = refusal(project(values, modules, Vec::new(), exits).unwrap());
    assert_eq!(code, "proof.theorems");
    assert!(message.contains("no theorem"), "{message}");
}

#[test]
fn malformed_input_is_refused_by_the_model() {
    let (values, modules, theorems, exits) = input(&calculator());
    let mut image = values.clone();
    image[11] = "ghcr.io/uor-foundation/prismpm:0.3.0".to_owned();
    let (_, message) = refusal(
        project(
            image,
            modules.clone(),
            Vec::from_iter(theorems.iter().map(copy)),
            exits.clone(),
        )
        .unwrap(),
    );
    assert!(message.contains("is not pinned"), "{message}");

    let mut commit = values.clone();
    commit[3] = "F054605A".to_owned();
    let (_, message) = refusal(
        project(
            commit,
            modules.clone(),
            Vec::from_iter(theorems.iter().map(copy)),
            exits.clone(),
        )
        .unwrap(),
    );
    assert_eq!(
        message,
        "verifier.lean.commit is not 40 lowercase hex characters"
    );

    let mut path = modules.clone();
    path[0].0 = "lean/PrismCalculator/Calculator.lean".to_owned();
    let (_, message) = refusal(
        project(
            values.clone(),
            path,
            Vec::from_iter(theorems.iter().map(copy)),
            exits.clone(),
        )
        .unwrap(),
    );
    assert!(
        message.contains("is not a generated Lean module path"),
        "{message}"
    );

    let mut control = Vec::from_iter(theorems.iter().map(copy));
    control[0].name = "PrismCalculator.Calculator.add\nCorrect".to_owned();
    let (_, message) = refusal(project(values, modules, control, exits).unwrap());
    assert!(message.contains("control character"), "{message}");
}

#[test]
fn the_snapshot_names_the_theorems_and_the_audit_their_axioms() {
    let snapshot = json!({"modules": [
        {"lean_module": "PrismCalculator.Calculator", "declarations": [
            {"kind": "definition", "lean_name": "add"},
            {"kind": "theorem", "lean_name": "addCorrect"},
            {"kind": "theorem", "lean_name": "unaudited"}
        ]}
    ]});
    let attestation = json!({"declarations": [
        {"name": "PrismCalculator.Calculator.add", "observed": [], "policy": {"axioms": [], "kind": "none"}, "result": "ok"},
        {"name": "PrismCalculator.Calculator.addCorrect", "observed": ["propext"], "policy": {"axioms": ["propext"], "kind": "allow"}, "result": "ok"}
    ]});
    let rows = theorems(&snapshot, &attestation).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].name, "PrismCalculator.Calculator.addCorrect");
    assert_eq!(
        (rows[0].kind.as_str(), rows[0].observed.clone()),
        ("allow", vec!["propext".to_owned()])
    );
    assert_eq!(
        rows[1].result, "",
        "a theorem the audit does not list cannot pass"
    );
}

fn copy(theorem: &Theorem) -> Theorem {
    Theorem {
        name: theorem.name.clone(),
        module: theorem.module.clone(),
        result: theorem.result.clone(),
        kind: theorem.kind.clone(),
        allowed: theorem.allowed.clone(),
        observed: theorem.observed.clone(),
    }
}
