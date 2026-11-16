//! HO-44: the session world `hologram:guest/core-wasm@2` and its generated
//! shim (issue #629). The owning suite is the generator's own tests in
//! `prismpm::session_guest`; HO-45, the runtime, is a node suite.

use std::path::Path;
use std::process::Command;

fn run(root: &Path, id: &str, arguments: &[&str]) -> String {
    let output = Command::new("cargo")
        .current_dir(root)
        .args(["test", "--locked", "--offline", "-p", "prismpm"])
        .args(arguments)
        .args(["--", "--nocapture", "--test-threads=1"])
        // A target disjoint from the outer conformance Cargo owner's lock.
        .env(
            "CARGO_TARGET_DIR",
            root.join("target/conformance-session-world"),
        )
        .output()
        .expect("the owning suite executes");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 owning stdout");
    let stderr = String::from_utf8(output.stderr).expect("UTF-8 owning stderr");
    assert!(
        output.status.success(),
        "{id} {arguments:?}: {stdout}\n{stderr}"
    );
    assert!(
        stdout.contains("test result: ok.") && !stdout.contains("running 0 tests"),
        "{id} requires a nonempty executed suite: {arguments:?}"
    );
    stdout
}

fn require(id: &str, stdout: &str, tests: &[&str]) {
    for test in tests {
        assert!(
            stdout.contains(&format!("{test} ... ok")),
            "{id} requires the passing owning test {test}"
        );
    }
}

/// HO-44: the generated session guest package and its shim.
pub(super) fn verify_generator(root: &Path) {
    let stdout = run(root, "HO-44", &["--lib", "session_guest"]);
    require(
        "HO-44",
        &stdout,
        &[
            "the_package_is_a_function_of_the_bounds_and_the_ir",
            "the_manifest_names_the_contract_the_schema_and_every_bound",
            "the_shim_exports_the_session_world_and_never_holo_run",
            "the_shim_checks_every_declared_bound_of_the_answer_and_the_request",
            "the_runtime_module_never_collides_with_a_model_name",
            "the_cargo_configuration_bounds_memory_and_the_stack",
            "an_entry_that_is_missing_or_not_bytes_to_bytes_is_refused",
            "a_malformed_name_or_digest_is_refused",
            "every_bound_that_cannot_be_generated_is_refused_by_name",
            "the_turn_and_answer_maxima_follow_the_frames",
            "the_session_probe_is_the_generated_shim_around_its_test_entry",
        ],
    );
}
