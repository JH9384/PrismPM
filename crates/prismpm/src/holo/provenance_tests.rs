use super::*;
use crate::holo::archive::{strip_attestations, validate_application};
use crate::inspect::verdict::{verify, Level, Policy};

/// The reference archive, `calculator-example` `artifacts/Calculator.holo`.
const CALCULATOR: &[u8] =
    include_bytes!("../../../../sdk/npm/prism-code/fixtures/Calculator.v5.holo");
const LOCK: &[u8] =
    include_bytes!("../../../../sdk/npm/spec/test/fixtures/documents/sdk-lock-v3/calculator.json");
/// What `sdk/npm/prism-code/src/provenance.mjs` writes for the same archive and lock.
const JAVASCRIPT_LINE: &[u8] = include_bytes!(
    "../../../../sdk/npm/prism-code/test/fixtures/Calculator.provenance-min.bundle.jsonl"
);

fn code<T: std::fmt::Debug>(result: Result<T, PrismError>) -> String {
    result.unwrap_err().code.to_string()
}

fn max_details() -> MaxDetails {
    MaxDetails {
        arguments: vec!["build".to_owned(), "--provenance=max".to_owned()],
        platform: "linux/amd64".to_owned(),
        invocation_id: "urn:prismpm:invocation:1".to_owned(),
        started_on: "2026-10-25T14:00:00Z".to_owned(),
        finished_on: "2026-10-25T14:03:12Z".to_owned(),
    }
}

fn artifacts() -> Vec<(String, Vec<u8>)> {
    vec![
        ("Calculator.holo".to_owned(), CALCULATOR.to_vec()),
        (IDENTITIES_ARTIFACT.to_owned(), b"stale".to_vec()),
    ]
}

fn stamp(max: Option<(Vec<String>, i64)>) -> Stamp {
    Stamp {
        lock: LOCK.to_vec(),
        max,
    }
}

fn changed_lock(edit: impl FnOnce(&mut Value)) -> Vec<u8> {
    let mut lock: Value = serde_json::from_slice(LOCK).unwrap();
    edit(&mut lock);
    serde_json::to_vec(&lock).unwrap()
}

#[test]
fn ho_32_a_stamped_build_carries_one_statement_and_keeps_every_other_row() {
    let mut built = artifacts();
    stamp(None).apply(&mut built).unwrap();
    let holo = &built[0].1;
    validate_application(holo).unwrap();
    let attestations = read_attestations(holo).unwrap();
    assert_eq!(attestations.len(), 1);
    assert_eq!(attestations[0].predicate_type, PROVENANCE_PREDICATE);
    assert!(attestations[0].resolved());
    assert_eq!(strip_attestations(holo).unwrap(), CALCULATOR);
    let parsed = parse_application(holo).unwrap();
    let recorded: Value = serde_json::from_slice(&built[1].1).unwrap();
    assert_eq!(recorded, serde_json::to_value(parsed.identities).unwrap());
}

#[test]
fn ho_32_min_is_deterministic_and_equals_the_javascript_bytes() {
    let line = bundle(&statement(CALCULATOR, LOCK, None).unwrap()).unwrap();
    assert_eq!(line, JAVASCRIPT_LINE[..JAVASCRIPT_LINE.len() - 1]);
    assert_eq!(JAVASCRIPT_LINE.last(), Some(&b'\n'));
    let (mut left, mut right) = (artifacts(), artifacts());
    stamp(None).apply(&mut left).unwrap();
    stamp(None).apply(&mut right).unwrap();
    assert_eq!(left, right);
}

#[test]
fn ho_32_a_placeholder_is_no_evidence_so_the_built_holo_stays_p0() {
    let holo = attach(CALCULATOR, LOCK, None).unwrap();
    let verdict = verify(&holo, &Policy::default()).unwrap();
    assert_eq!(verdict.level, Level::P0);
}

#[test]
fn ho_33_the_statement_equals_the_lock_and_the_archive() {
    let statement = statement(CALCULATOR, LOCK, None).unwrap();
    let lock: Value = serde_json::from_slice(LOCK).unwrap();
    let definition = &statement["predicate"]["buildDefinition"];
    assert_eq!(definition["buildType"], HOLO_BUILD_TYPE);
    // The lock still records two digests (sdk-lock/3); the statement names the κ.
    assert_eq!(
        definition["externalParameters"]["model"]["sha256"],
        lock["inputs"]["model"]["sha256"]
    );
    assert_eq!(
        definition["externalParameters"]["spec"],
        lock["inputs"]["spec"]
    );
    assert_eq!(
        statement["predicate"]["runDetails"]["builder"]["id"],
        lock["sdk_image"]
    );
    let parsed = parse_application(CALCULATOR).unwrap();
    let subjects = statement["subject"].as_array().unwrap();
    assert_eq!(subjects.len(), 4);
    for subject in subjects {
        let label = format!("sha256:{}", subject["digest"]["sha256"].as_str().unwrap());
        let content = parsed.blobs.get(&label).unwrap();
        assert_eq!(subject["digest"], kappa_digest(content));
    }
    let rows = definition["resolvedDependencies"].as_array().unwrap();
    let row = |name: &str| rows.iter().find(|row| row["name"] == name).unwrap();
    assert_eq!(row("sdk-lock")["digest"], kappa_digest(LOCK));
    assert_eq!(row("sdk-image")["uri"], lock["sdk_image"]);
    assert_eq!(row("world")["uri"], lock["inputs"]["world"]["contract"]);
    assert_eq!(
        row("application-generator")["digest"]["sha256"],
        lock["inputs"]["generation"]["application_generator_sha256"]
    );
}

#[test]
fn ho_33_a_lock_that_does_not_describe_the_build_is_refused() {
    for (name, lock) in [
        (
            "another model",
            changed_lock(|lock| lock["inputs"]["model"]["sha256"] = json!("0".repeat(64))),
        ),
        (
            "an unpinned image",
            changed_lock(|lock| lock["sdk_image"] = json!("ghcr.io/example/sdk:latest")),
        ),
        (
            "a /1 lock",
            changed_lock(|lock| lock["schema"] = json!("prismpm/sdk-lock/1")),
        ),
        ("not a lock", b"{".to_vec()),
    ] {
        assert_eq!(code(statement(CALCULATOR, &lock, None)), "PP3018", "{name}");
    }
    let once = attach(CALCULATOR, LOCK, None).unwrap();
    assert_eq!(code(attach(&once, LOCK, None)), "PP3018");
}

#[test]
fn ho_34_max_adds_exactly_the_members_of_max_mode() {
    let details = max_details();
    let min = statement(CALCULATOR, LOCK, None).unwrap();
    let max = statement(CALCULATOR, LOCK, Some(&details)).unwrap();
    let text = String::from_utf8(encode_value(&min).unwrap()).unwrap();
    for member in [
        "arguments",
        "platform",
        "startedOn",
        "finishedOn",
        "invocationId",
    ] {
        assert!(!text.contains(member), "min records {member}");
    }
    let definition = &max["predicate"]["buildDefinition"];
    assert_eq!(
        definition["externalParameters"]["arguments"],
        json!(details.arguments)
    );
    assert_eq!(
        definition["internalParameters"],
        json!({"platform": details.platform})
    );
    let metadata = &max["predicate"]["runDetails"]["metadata"];
    assert_eq!(metadata["startedOn"], json!(details.started_on));
    assert_eq!(metadata["finishedOn"], json!(details.finished_on));
    assert_eq!(metadata["invocationId"], json!(details.invocation_id));
    let mut stripped = max.clone();
    stripped["predicate"]["buildDefinition"]["externalParameters"]
        .as_object_mut()
        .unwrap()
        .remove("arguments");
    stripped["predicate"]["buildDefinition"]["internalParameters"] = json!({});
    stripped["predicate"]["runDetails"]
        .as_object_mut()
        .unwrap()
        .remove("metadata");
    assert_eq!(stripped, min);
}

#[test]
fn ho_34_a_max_stamp_records_the_run() {
    let mut built = artifacts();
    stamp(Some((vec!["build".to_owned()], 1_761_400_800_999)))
        .apply(&mut built)
        .unwrap();
    let attestations = read_attestations(&built[0].1).unwrap();
    let statement = attestations[0].statement().unwrap();
    let metadata = &statement["predicate"]["runDetails"]["metadata"];
    assert_eq!(metadata["startedOn"], "2025-10-25T14:00:00Z");
    assert!(metadata["finishedOn"].as_str().unwrap().ends_with('Z'));
    assert!(!metadata["finishedOn"].as_str().unwrap().contains('.'));
    let id = metadata["invocationId"].as_str().unwrap();
    assert_eq!(id.len(), "urn:uuid:".len() + 36);
    assert_ne!(invocation_id(), invocation_id());
}

#[test]
fn ho_35_omit_writes_nothing_and_needs_no_lock() {
    assert!(Stamp::begin(&BuildProvenance::Omit, || {
        unreachable!("Omit never reads the lock")
    })
    .unwrap()
    .is_none());
}

#[test]
fn ho_35_a_build_without_a_lock_is_refused_before_compiling() {
    let temporary = tempfile::tempdir().unwrap();
    let error = Stamp::begin(&BuildProvenance::Min, || {
        Ok(crate::sdk::committed_lock(temporary.path())?.map(|(_, bytes)| bytes))
    })
    .err()
    .unwrap();
    assert_eq!(error.code, "PP3018");
    assert!(error.message.contains("--no-provenance"));
}

#[test]
fn whole_seconds_equals_the_attest_clock_without_fractions() {
    for millis in [
        0_i64,
        999,
        1_778_700_213_000,
        1_672_531_199_999,
        951_782_400_000,
        -86_400_001,
        253_402_300_799_999,
    ] {
        let expected =
            crate::attest::clock::iso8601(millis - millis.rem_euclid(1000)).replace(".000Z", "Z");
        assert_eq!(super::whole_seconds(millis), expected, "{millis}");
    }
}

#[test]
fn the_local_wire_constants_equal_their_owners() {
    assert_eq!(super::SDK_LOCK_V2, crate::input_lock::SDK_LOCK_V2);
    assert_eq!(super::SDK_LOCK_V3, crate::input_lock::SDK_LOCK_V3);
    assert_eq!(
        super::PROVENANCE_PREDICATE,
        crate::inspect::verdict::PROVENANCE_PREDICATE
    );
}

// Planted defect G3: the statement time is the clock unless SOURCE_DATE_EPOCH names it,
// so two runs with the same inputs and the same SOURCE_DATE_EPOCH give the same bytes.
#[test]
fn source_date_epoch_fixes_the_statement_time() {
    assert_eq!(super::statement_time(Some("0")), "1970-01-01T00:00:00Z");
    assert_eq!(
        super::statement_time(Some("1700000000")),
        "2023-11-14T22:13:20Z"
    );
    assert_eq!(
        super::statement_time(Some(" 86400 ")),
        "1970-01-02T00:00:00Z"
    );
    for unset in [None, Some(""), Some("-1"), Some("soon")] {
        assert_ne!(
            super::statement_time(unset),
            "1970-01-01T00:00:00Z",
            "{unset:?} reads the clock"
        );
    }
}
