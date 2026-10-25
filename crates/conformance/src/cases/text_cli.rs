//! HO-17: the modeled text command line, its generated static programs and the
//! actual process behavior of every registered failure.

use std::path::Path;
use std::process::Command;

fn run(root: &Path, arguments: &[&str]) -> String {
    let output = Command::new("cargo")
        .current_dir(root)
        .args(["test", "--locked", "--offline", "-p", "prismpm"])
        .args(arguments)
        .args(["--", "--nocapture", "--test-threads=1"])
        // The outer conformance Cargo owner may retain its target lock; use a
        // disjoint target for the owning suites.
        .env("CARGO_TARGET_DIR", root.join("target/conformance-text-cli"))
        .output()
        .expect("HO-17 executes its owning suites");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 owning stdout");
    let stderr = String::from_utf8(output.stderr).expect("UTF-8 owning stderr");
    assert!(
        output.status.success(),
        "HO-17 {arguments:?}: {stdout}\n{stderr}"
    );
    assert!(
        stdout.contains("test result: ok.") && !stdout.contains("running 0 tests"),
        "HO-17 requires nonempty executed suites: {arguments:?}"
    );
    stdout
}

pub(super) fn verify(root: &Path) {
    // The in-tree text/3 project with a modeled command line, which
    // `verify-examples` builds and verifies, must check exactly as declared.
    crate::fixtures::check(&root.join("tests/fixtures/holo/ho-17-text-cli"))
        .expect("the complete text/3 command-line fixture matches its declared outcome");
    let library = run(root, &["--lib", "text_cli"]);
    for name in [
        "bill_of_materials_binds_every_program_to_its_digest",
        "closed_or_full_standard_output_exits_with_the_io_code",
        "invalid_command_lines_exit_with_the_usage_code",
        "oversized_input_is_refused_before_dispatch",
        "reports_are_published_unchanged_with_the_modeled_exit_code",
        "unreadable_missing_and_non_regular_input_exit_with_the_io_code",
    ] {
        assert!(
            library
                .lines()
                .any(|line| line.ends_with(&format!("{name} ... ok"))),
            "HO-17 requires passing {name}"
        );
    }
    run(root, &["--test", "text_cli_contract"]);
}
