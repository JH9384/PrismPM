//! SY-08: real containing-system source, proof, oracles, and source-free replay.

use std::collections::BTreeSet;
use std::path::Path;
use std::process::Command;

pub(super) fn verify(root: &Path) {
    let output = Command::new("cargo")
        .current_dir(root)
        .args([
            "test",
            "--locked",
            "--offline",
            "-p",
            "prismpm",
            "--lib",
            "browser_system_",
            "--",
            "--nocapture",
            "--test-threads=1",
        ])
        .output()
        .expect("browser system owning tests execute");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 owning stdout");
    let stderr = String::from_utf8(output.stderr).expect("UTF-8 owning stderr");
    assert!(output.status.success(), "{stdout}\n{stderr}");
    let actual = stdout
        .lines()
        .filter_map(|line| {
            line.strip_prefix("test ")
                .and_then(|line| line.strip_suffix(" ... ok"))
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(actual, BTreeSet::from([
        "controller::release_tests::browser_system_admits_one_command_line_component_of_a_text_command_line_application",
        "controller::release_tests::browser_system_contract_is_registered_and_closed",
        "controller::release_tests::browser_system_named_release_proves_artifacts_oracles_and_source_free_export",
        "controller::release_tests::browser_system_refuses_a_command_line_component_without_a_modeled_command_line",
        "controller::release_tests::browser_system_source_selection_and_requirements_fail_closed",
    ]));
    assert!(
        stdout.contains("test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured;"),
        "{stdout}"
    );
    assert_eq!(
        stdout
            .lines()
            .filter(|line| line.starts_with("test result:"))
            .count(),
        1
    );
}
