//! Own the private /2 host counterexamples in ordinary workspace unit tests.
use crate::verification::{executable, run_process};
use std::collections::BTreeMap;
use std::path::Path;

#[test]
fn private_retained_host_counterexamples_execute_without_skips() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let record = run_process(
        "private-retained-host-counterexamples",
        &executable("node").unwrap(),
        &[
            "--test".to_owned(),
            "--test-concurrency=1".to_owned(),
            "scripts/resource-retention-v2.test.mjs".to_owned(),
        ],
        &root,
        &BTreeMap::new(),
        &[],
        "PP5203",
    )
    .unwrap();
    let count = record
        .stdout
        .lines()
        .find_map(|line| line.strip_prefix("# tests "))
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert!(count >= 19, "all original /2 host counterexamples must run");
    for summary in ["# fail 0", "# cancelled 0", "# skipped 0", "# todo 0"] {
        assert!(
            record.stdout.lines().any(|line| line == summary),
            "{}",
            record.stdout
        );
    }
    assert!(record.stderr.is_empty(), "{}", record.stderr);
}
