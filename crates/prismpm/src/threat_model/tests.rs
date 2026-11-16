use super::{
    check, is_timestamp, normalize, oscal, probe, project, validate_normalized, Declared,
    Normalized,
};
use serde_json::{json, Value};

const OWNER: &str = "Production.ThreatModel";
const ASSET: &str = "Security::assetReport";
const MITIGATED: &str = "Security::threatTampering";
const ACCEPTED: &str = "Security::threatDisowned";
const CONTROL: &str = "Security::controlClosure";

fn string(value: &str) -> Value {
    json!({"kind": "string", "value": value})
}

fn choice(value: &str) -> Value {
    json!({"kind": "constructor", "constructor": {"name": value}})
}

fn list(values: Vec<Value>) -> Value {
    values.into_iter().rev().fold(
        json!({"kind": "nil"}),
        |tail, head| json!({"kind": "cons", "head": head, "tail": tail}),
    )
}

fn body(fields: Vec<(&str, Value)>) -> Value {
    json!({
        "kind": "record",
        "fields": fields
            .into_iter()
            .map(|(field, value)| json!({"field": field, "value": value}))
            .collect::<Vec<_>>(),
    })
}

fn row(type_name: &str, fields: Vec<(&str, Value)>) -> Value {
    json!({"result": {"member": {"name": type_name, "module": OWNER}}, "body": body(fields)})
}

fn set() -> Value {
    row(
        "ControlSet",
        vec![
            ("title", string("Example controls")),
            ("text", string("Browser-only, no storage, no network.")),
            ("version", string("0.1.0")),
            ("lastModified", string("2026-10-30T00:00:00Z")),
        ],
    )
}

fn control(evidence: Vec<Value>) -> Value {
    row(
        "ModeledControl",
        vec![
            ("control", string(CONTROL)),
            ("name", string("Artifact closure")),
            ("text", string("Every file is listed with its digest.")),
            ("evidence", list(evidence)),
        ],
    )
}

fn gate() -> Value {
    body(vec![
        ("kind", choice("Production.ThreatModel::EvidenceKind.gate")),
        ("reference", string("just vv artifact closure")),
    ])
}

fn threat(id: &str, name: &str, category: &str) -> Value {
    row(
        "ModeledThreat",
        vec![
            ("threat", string(id)),
            ("name", string(name)),
            ("text", string("A threat.")),
            (
                "category",
                choice(&format!("Production.ThreatModel::Stride.{category}")),
            ),
        ],
    )
}

fn mapping(id: &str, controls: &[&str]) -> Value {
    row(
        "ThreatMapping",
        vec![
            ("threat", string(id)),
            (
                "controls",
                list(controls.iter().map(|name| string(name)).collect()),
            ),
        ],
    )
}

fn accepted(id: &str, rationale: &str) -> Value {
    row(
        "AcceptedRisk",
        vec![("threat", string(id)), ("rationale", string(rationale))],
    )
}

/// One asset, one mitigated threat, one accepted threat and one control.
fn rows() -> Vec<(&'static str, Value)> {
    vec![
        ("set", set()),
        (
            "assetRow",
            row(
                "ModeledAsset",
                vec![
                    ("asset", string(ASSET)),
                    ("name", string("Report")),
                    ("text", string("The report shown on the page.")),
                ],
            ),
        ),
        ("tampering", threat(MITIGATED, "Tampered page", "tampering")),
        (
            "disowned",
            threat(ACCEPTED, "Disowned result", "repudiation"),
        ),
        ("closure", control(vec![gate()])),
        ("mapTampering", mapping(MITIGATED, &[CONTROL])),
        (
            "acceptDisowned",
            accepted(ACCEPTED, "Re-running the check reproduces the report."),
        ),
    ]
}

fn declared(rows: &[(&'static str, Value)]) -> Declared {
    let mut declared =
        project(rows.iter().map(|(name, value)| ("Security", *name, value))).unwrap();
    declared.asset_records = [ASSET.to_owned()].into();
    declared.threat_records = [MITIGATED.to_owned(), ACCEPTED.to_owned()].into();
    declared.control_records = [CONTROL.to_owned()].into();
    declared
}

fn without(name: &str) -> Vec<(&'static str, Value)> {
    rows().into_iter().filter(|row| row.0 != name).collect()
}

fn replaced(name: &str, value: Value) -> Vec<(&'static str, Value)> {
    rows()
        .into_iter()
        .map(|row| {
            if row.0 == name {
                (row.0, value.clone())
            } else {
                row
            }
        })
        .collect()
}

fn code(rows: &[(&'static str, Value)]) -> String {
    check(&declared(rows)).unwrap_err().code.to_string()
}

/// The code of a model the projection itself refuses, before any check.
fn projection_code(rows: &[(&'static str, Value)]) -> String {
    project(rows.iter().map(|(name, value)| ("Security", *name, value)))
        .unwrap_err()
        .code
        .to_string()
}

#[test]
fn a_complete_model_is_accepted() {
    check(&declared(&rows())).unwrap();
}

#[test]
fn a_model_without_rows_declares_nothing() {
    assert!(project(std::iter::empty()).unwrap().is_empty());
}

#[test]
fn an_unmapped_threat_is_refused_with_pp2019() {
    let error = check(&declared(&without("mapTampering"))).unwrap_err();
    assert_eq!(error.code.to_string(), "PP2019");
    assert!(error.to_string().contains(MITIGATED));
    assert_eq!(
        code(&replaced("mapTampering", mapping(MITIGATED, &[]))),
        "PP2019"
    );
    assert_eq!(code(&without("acceptDisowned")), "PP2019");
}

#[test]
fn a_control_without_evidence_is_refused_with_pp2020() {
    assert_eq!(code(&replaced("closure", control(vec![]))), "PP2020");
    assert_eq!(code(&without("closure")), "PP2020");
}

#[test]
fn a_threat_without_a_category_is_refused_with_pp2021() {
    assert_eq!(code(&without("tampering")), "PP2021");
}

#[test]
fn malformed_and_unresolved_rows_are_refused_with_pp2022() {
    let cases = [
        without("set"),
        without("assetRow"),
        replaced("mapTampering", mapping("Security::nothing", &[CONTROL])),
        replaced("mapTampering", mapping(MITIGATED, &["Security::nothing"])),
        replaced("mapTampering", mapping(MITIGATED, &[CONTROL, CONTROL])),
        replaced("acceptDisowned", accepted(ACCEPTED, "  ")),
        replaced("acceptDisowned", accepted("Security::nothing", "Why.")),
        replaced(
            "closure",
            control(vec![body(vec![
                ("kind", choice("Production.ThreatModel::EvidenceKind.gate")),
                ("reference", string(" padded ")),
            ])]),
        ),
    ];
    for case in cases {
        assert_eq!(code(&case), "PP2022", "{case:?}");
    }
}

#[test]
fn a_repeated_or_open_row_cannot_be_projected() {
    let mut twice = rows();
    twice.push(("again", mapping(MITIGATED, &[CONTROL])));
    let project_code = |rows: &[(&'static str, Value)]| {
        project(rows.iter().map(|(name, value)| ("Security", *name, value)))
            .unwrap_err()
            .code
            .to_string()
    };
    assert_eq!(project_code(&twice), "PP2022");
    let open = json!({"result": {"member": {"name": "ThreatMapping", "module": OWNER}}, "body": {"kind": "call"}});
    assert_eq!(project_code(&[("open", open)]), "PP2022");
    let wrong = threat(MITIGATED, "Tampered page", "tampering");
    let mut wrong = wrong;
    wrong["body"]["fields"][3]["value"] = choice("Production.ThreatModel::Stride.unknown");
    assert_eq!(project_code(&[("wrong", wrong)]), "PP2022");
}

#[test]
fn only_the_owner_module_declares_rows() {
    let foreign = json!({"result": {"member": {"name": "ThreatMapping", "module": "Elsewhere"}}, "body": {"kind": "call"}});
    let declared = project([("Security", "foreign", &foreign)]).unwrap();
    assert!(declared.is_empty());
}

#[test]
fn only_real_utc_instants_are_timestamps() {
    for value in ["2026-10-30T00:00:00Z", "2024-02-29T23:59:59Z"] {
        assert!(is_timestamp(value), "{value}");
    }
    for value in [
        "",
        "2026-10-30",
        "2026-13-01T00:00:00Z",
        "2026-02-29T00:00:00Z",
        "2026-10-30T24:00:00Z",
        "2026-10-30T00:00:00+01:00",
        "1899-01-01T00:00:00Z",
        "20२6-10-30T00:00:00Z",
    ] {
        assert!(!is_timestamp(value), "{value}");
    }
}

/// `threatModelVector` and the verdicts of the theorems on it.
#[test]
fn the_normalized_validator_agrees_with_the_proved_vectors() {
    let vector =
        |category: [u64; 2], mitigation: [u64; 2], acceptance: [u64; 2], evidence: [u64; 2]| {
            validate_normalized(&Normalized {
                threat_count: 2,
                category_counts: category.to_vec(),
                mitigation_counts: mitigation.to_vec(),
                acceptance_counts: acceptance.to_vec(),
                evidence_counts: evidence.to_vec(),
            })
        };
    assert!(vector([1, 1], [2, 0], [0, 1], [1, 2]));
    assert!(
        !vector([1, 1], [2, 0], [0, 0], [1, 2]),
        "unmappedThreatRefused"
    );
    assert!(
        !vector([1, 1], [2, 0], [0, 1], [1, 0]),
        "controlWithoutEvidenceRefused"
    );
    assert!(
        !vector([1, 0], [2, 0], [0, 1], [1, 2]),
        "threatWithoutCategoryRefused"
    );
}

/// Every subset of one threat's and one control's rows gets the same verdict
/// from the check and from the normalized validator.
#[test]
fn the_check_and_the_normalized_validator_agree_on_every_small_model() {
    for bits in 0..16_u8 {
        let mut rows = rows();
        rows.retain(|row| !matches!(row.0, "tampering" | "mapTampering" | "disowned" | "closure"));
        rows.push((
            "disowned",
            threat(ACCEPTED, "Disowned result", "repudiation"),
        ));
        if bits & 1 != 0 {
            rows.push(("tampering", threat(MITIGATED, "Tampered page", "tampering")));
        }
        if bits & 2 != 0 {
            rows.push(("mapTampering", mapping(MITIGATED, &[CONTROL])));
        }
        let evidence = if bits & 4 != 0 { vec![gate()] } else { vec![] };
        rows.push(("closure", control(evidence)));
        let mut model = declared(&rows);
        if bits & 8 != 0 {
            model
                .accepted
                .insert(MITIGATED.to_owned(), "Accepted.".to_owned());
        }
        assert_eq!(
            check(&model).is_ok(),
            validate_normalized(&normalize(&model)),
            "bits {bits}"
        );
    }
}

fn emitted(rows: &[(&'static str, Value)]) -> Value {
    let model = declared(rows);
    check(&model).unwrap();
    serde_json::from_slice(&oscal::component_definition(&model).unwrap()).unwrap()
}

/// A model whose every threat is an accepted risk has no control to implement.
fn accepted_risks_only() -> Declared {
    let mut rows = without("closure");
    rows.retain(|row| !matches!(row.0, "mapTampering" | "tampering"));
    let mut model = declared(&rows);
    model.threat_records = [ACCEPTED.to_owned()].into();
    model.control_records.clear();
    check(&model).unwrap();
    model
}

/// The workspace `jsonschema` cannot judge these documents: it predates the
/// fragment `$id` fix the OSCAL schemas need, and SPEC 10 leaves the verdict to
/// the locked oracle. So the emitted bytes are pinned to the committed subjects
/// that AU-08 passes through that oracle.
#[test]
fn the_emitted_documents_match_their_oracle_subjects() {
    assert_eq!(
        oscal::component_definition(&declared(&rows())).unwrap(),
        include_bytes!("../../../../tests/fixtures/threat-model/oscal-subjects/complete.json"),
    );
    let model = accepted_risks_only();
    let bytes = oscal::component_definition(&model).unwrap();
    assert_eq!(
        bytes,
        include_bytes!(
            "../../../../tests/fixtures/threat-model/oscal-subjects/accepted-risks-only.json"
        ),
    );
    let document: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(document["component-definition"]
        .get("back-matter")
        .is_none());
}

#[test]
fn the_document_states_the_mapping_the_evidence_and_the_accepted_risks() {
    let document = emitted(&rows());
    let definition = &document["component-definition"];
    assert_eq!(definition["metadata"]["oscal-version"], "1.1.0");
    assert_eq!(
        definition["metadata"]["last-modified"],
        "2026-10-30T00:00:00Z"
    );
    let component = &definition["components"][0];
    let implementation = &component["control-implementations"][0];
    let source = implementation["source"].as_str().unwrap();
    assert_eq!(
        source.strip_prefix('#'),
        definition["back-matter"]["resources"][0]["uuid"].as_str()
    );
    let requirement = &implementation["implemented-requirements"][0];
    assert_eq!(requirement["control-id"], "Security.controlClosure");
    let props = requirement["props"].as_array().unwrap();
    assert!(props.iter().any(|row| row["name"] == "evidence"
        && row["class"] == "gate"
        && row["value"] == "just vv artifact closure"));
    assert!(props.iter().any(|row| row["name"] == "threat"
        && row["class"] == "tampering"
        && row["value"] == "Tampered page"));
    assert!(!props.iter().any(|row| row["value"] == "Disowned result"));
    let remarks = component["remarks"].as_str().unwrap();
    assert!(remarks.contains("Disowned result (repudiation)"));
    assert!(remarks.contains("Re-running the check reproduces the report."));
}

#[test]
fn the_document_is_reproducible_and_its_identity_follows_its_content() {
    let identity = |rows: &[(&'static str, Value)]| {
        emitted(rows)["component-definition"]["uuid"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let model = declared(&rows());
    assert_eq!(
        oscal::component_definition(&model).unwrap(),
        oscal::component_definition(&model).unwrap()
    );
    let reworded = replaced(
        "acceptDisowned",
        accepted(ACCEPTED, "A different rationale."),
    );
    assert_ne!(identity(&rows()), identity(&reworded));
}

#[test]
fn the_diagnostic_probe_runs_the_real_check() {
    let valid = json!({
        "last_modified": "2026-10-30T00:00:00Z",
        "threats": ["Probe::threat"],
        "controls": ["Probe::control"],
        "categorized": ["Probe::threat"],
        "mappings": {"Probe::threat": ["Probe::control"]},
        "evidence": {"Probe::control": ["Probe gate"]},
    });
    probe(&valid).unwrap();
    let mut unmapped = valid.clone();
    unmapped["mappings"] = json!({});
    assert_eq!(probe(&unmapped).unwrap_err().code.to_string(), "PP2019");
    let mut answered = unmapped;
    answered["accepted"] = json!({"Probe::threat": "Accepted."});
    probe(&answered).unwrap();
}

fn appended(left: Value, right: Value, kind: &str) -> Value {
    json!({"kind": "primitive", "operation": "append", "result": {"kind": kind}, "arguments": [left, right]})
}

fn review(reference: &str) -> Value {
    body(vec![
        (
            "kind",
            choice("Production.ThreatModel::EvidenceKind.review"),
        ),
        ("reference", string(reference)),
    ])
}

#[test]
fn an_appended_list_literal_is_the_list_of_its_parts() {
    let items: Vec<Value> = (0..5).map(|i| review(&format!("src/lib.rs:{i}"))).collect();
    let consed = replaced("closure", control(items.clone()));
    // ((a ++ b) ++ (c ++ (d e))), as LexLean balances a long literal.
    let tree = appended(
        appended(
            list(items[..1].to_vec()),
            list(items[1..2].to_vec()),
            "list",
        ),
        appended(
            list(items[2..3].to_vec()),
            list(items[3..].to_vec()),
            "list",
        ),
        "list",
    );
    let mut control_row = control(vec![]);
    control_row["body"]["fields"][3]["value"] = tree;
    let appended_rows = replaced("closure", control_row);
    check(&declared(&appended_rows)).unwrap();
    assert_eq!(
        format!("{:?}", declared(&appended_rows)),
        format!("{:?}", declared(&consed))
    );
    // An append whose result is no list, or with other than two arguments,
    // is not a list literal.
    for wrong in [
        appended(
            list(items[..1].to_vec()),
            list(items[1..].to_vec()),
            "string",
        ),
        json!({"kind": "primitive", "operation": "append", "result": {"kind": "list"}, "arguments": [list(items.clone())]}),
    ] {
        let mut row = control(vec![]);
        row["body"]["fields"][3]["value"] = wrong;
        assert_eq!(projection_code(&replaced("closure", row)), "PP2022");
    }
}

#[test]
fn a_long_appended_list_literal_is_read_without_recursion() {
    // Ten thousand elements as one cons chain would nest past any JSON
    // reader's limit; as balanced appends of short chains it nests a few
    // levels, and it is read with a stack.
    let items: Vec<Value> = (0..10_000)
        .map(|i| review(&format!("src/lib.rs:{i}")))
        .collect();
    let mut runs: Vec<Value> = items.chunks(32).map(|c| list(c.to_vec())).collect();
    while runs.len() > 1 {
        runs = runs
            .chunks(2)
            .filter_map(|pair| {
                pair.iter()
                    .cloned()
                    .reduce(|left, right| appended(left, right, "list"))
            })
            .collect();
    }
    let mut row = control(vec![]);
    row["body"]["fields"][3]["value"] = runs.remove(0);
    let declared = declared(&replaced("closure", row));
    check(&declared).unwrap();
    assert_eq!(declared.controls[CONTROL].evidence.len(), 10_000);
}
