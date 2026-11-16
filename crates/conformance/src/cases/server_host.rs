//! HO-21 and HO-22: the declared host effects of a server application, their
//! closed validation, and the generated host adapter that executes them.

use std::path::Path;
use std::process::Command;

fn run(root: &Path, id: &str, arguments: &[&str]) -> String {
    let output = Command::new("cargo")
        .current_dir(root)
        .args(["test", "--locked", "--offline", "-p", "prismpm"])
        .args(arguments)
        .args(["--", "--nocapture", "--test-threads=1"])
        // The outer conformance Cargo owner may retain its target lock; use a
        // disjoint target for the owning suites.
        .env(
            "CARGO_TARGET_DIR",
            root.join("target/conformance-server-host"),
        )
        .output()
        .expect("the owning suites execute");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 owning stdout");
    let stderr = String::from_utf8(output.stderr).expect("UTF-8 owning stderr");
    assert!(
        output.status.success(),
        "{id} {arguments:?}: {stdout}\n{stderr}"
    );
    assert!(
        stdout.contains("test result: ok.") && !stdout.contains("running 0 tests"),
        "{id} requires nonempty executed suites: {arguments:?}"
    );
    stdout
}

fn require(id: &str, output: &str, names: &[&str]) {
    for name in names {
        assert!(
            output
                .lines()
                .any(|line| line.ends_with(&format!("{name} ... ok"))),
            "{id} requires passing {name}"
        );
    }
}

/// HO-21: declaration, projection, validation and canonical encoding.
pub(super) fn verify_declaration(root: &Path) {
    let library = run(root, "HO-21", &["--lib", "server_application"]);
    require(
        "HO-21",
        &library,
        &[
            "values_round_trip_through_their_declared_kinds",
            "malformed_values_are_refused_with_their_reason",
        ],
    );
    let contract = run(root, "HO-21", &["--test", "server_application_contract"]);
    require(
        "HO-21",
        &contract,
        &[
            "server_contract_roundtrips_and_requires_the_closed_declaration",
            "server_contract_rejects_every_invalid_declaration",
            "server_contract_binds_the_profile_and_schema_together",
            "host_failures_agree_across_lean_registry_and_generated_adapter",
            "server_application_projects_only_from_the_exact_source_owned_type",
        ],
    );
}

/// HO-22: the generated adapter, its acceptance suite and its program.
pub(super) fn verify_adapter(root: &Path) {
    let library = run(root, "HO-22", &["--lib", "server_host"]);
    require(
        "HO-22",
        &library,
        &[
            "the_request_sum_and_host_trait_contain_exactly_the_declared_effects",
            "the_generated_suite_and_program_tests_pass_against_the_core",
            "the_program_accepts_every_vector_over_a_file_and_standard_input",
            "script_failures_exit_with_the_fault_code_and_publish_nothing",
            "a_core_that_requests_an_undeclared_effect_is_refused_by_the_program",
            "invalid_command_lines_exit_with_the_usage_code",
            "the_linked_binding_serves_every_vector_without_a_script",
            "the_workspace_holds_the_declared_binding_or_the_declaration_is_refused",
            "a_binding_that_cannot_run_an_effect_exits_with_the_fault_code",
            "oversized_requests_and_scripts_are_refused_before_dispatch",
        ],
    );
}
