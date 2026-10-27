//! Actual Text/3 source, generated worker and portable native View owner.
use std::path::Path;
use std::process::Command;

fn rust(root: &Path, target: Option<&str>, expected: usize) {
    let mut command = Command::new("cargo");
    command.args(["test", "--locked", "--offline", "-p", "prismpm"]);
    if let Some(target) = target {
        command.args(["--test", target]);
    } else {
        command.arg("--lib");
    }
    command
        .args(["workbench_", "--", "--nocapture"])
        .env(
            "CARGO_TARGET_DIR",
            root.join("target/conformance-text-workbench"),
        )
        .current_dir(root);
    let output = command.output().expect("HO-19 executes real Rust owners");
    assert!(
        output.status.success(),
        "HO-19 Rust owner {:?}: {}\n{}",
        target,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let summary = format!("test result: ok. {expected} passed; 0 failed; 0 ignored;");
    assert!(
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .any(|line| line.starts_with(&summary)),
        "HO-19 requires its exact nonempty Rust test count"
    );
}

pub(super) fn verify(root: &Path) {
    rust(root, Some("workbench_application"), 4);
    rust(root, None, 2);
    super::node_suite::verify_exact(
        root,
        "HO-19",
        &[
            ("scripts/portable-oracle-matrix.test.mjs", 59),
            ("scripts/text-workbench.test.mjs", 26),
        ],
        "240000",
    );
    let work = tempfile::tempdir().expect("private workbench source root");
    let fixture = root.join("tests/fixtures/holo/ho-19-workbench/project");
    for entry in walkdir::WalkDir::new(&fixture)
        .into_iter()
        .filter_entry(|entry| {
            !matches!(
                entry.file_name().to_str(),
                Some(".prism" | ".lexlean" | ".lake" | "target")
            )
        })
    {
        let entry = entry.expect("regular source fixture entry");
        assert!(
            !entry.file_type().is_symlink(),
            "HO-19 fixture has no symlinks"
        );
        let destination = work
            .path()
            .join(entry.path().strip_prefix(&fixture).unwrap());
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(destination).unwrap();
        } else {
            std::fs::copy(entry.path(), destination).unwrap();
        }
    }
    let controller =
        prismpm::Controller::load(work.path()).expect("load the complete source workbench fixture");
    let build = controller
        .build(prismpm::controller::BuildRequest { config_path: None })
        .expect("HO-19 actual native and Wasm source build");
    let verified = controller
        .verify(prismpm::controller::VerifyRequest { config_path: None })
        .expect("HO-19 actual source/guest/portable Hologram verification");
    assert_eq!(
        build.build_id, verified.build_id,
        "portable acceptance is for the actual current source build"
    );
    eprintln!(
        "HO-19 actual workbench build {} attestation {}",
        build.build_id, verified.attestation_id
    );
}
