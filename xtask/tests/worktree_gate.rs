//! Exercise the actual gate entrypoint before any model writer can run.

use std::path::{Path, PathBuf};
use std::process::Command;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask parent")
        .canonicalize()
        .expect("physical repository root")
}

#[test]
fn actual_entrypoint_refuses_foreign_and_nested_worktrees_before_writing() {
    let root = root();
    let unrelated = tempfile::tempdir().expect("unrelated invocation");
    std::fs::create_dir_all(root.join("target")).expect("ignored test directory");
    let nested = tempfile::Builder::new()
        .prefix("gate-boundary-")
        .tempdir_in(root.join("target"))
        .expect("nested invocation");
    for work in [unrelated.path(), nested.path()] {
        std::fs::write(work.join("Cargo.toml"), "[workspace]\nmembers = []\n")
            .expect("foreign workspace manifest");
        let before: Vec<_> = std::fs::read_dir(work)
            .expect("before inventory")
            .map(|entry| entry.expect("directory entry").file_name())
            .collect();
        let output = Command::new(env!("CARGO_BIN_EXE_xtask"))
            .args(["validate-model", "--write"])
            .current_dir(work)
            .output()
            .expect("actual gate executable");
        assert_eq!(output.status.code(), Some(1));
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("gate invocation worktree mismatch")
        );
        assert!(output.stdout.is_empty(), "writer must never be reached");
        let after: Vec<_> = std::fs::read_dir(work)
            .expect("after inventory")
            .map(|entry| entry.expect("directory entry").file_name())
            .collect();
        assert_eq!(
            after, before,
            "no output may be written in the foreign tree"
        );
    }
}

#[test]
fn actual_entrypoint_accepts_its_workspace_and_member_before_task_dispatch() {
    let root = root();
    for work in [&root, &root.join("crates/model")] {
        let output = Command::new(env!("CARGO_BIN_EXE_xtask"))
            .arg("help")
            .current_dir(work)
            .output()
            .expect("actual gate executable");
        // Existing task dispatch prints usage with exit 2 for help/unknown tasks.
        assert_eq!(output.status.code(), Some(2));
        assert_eq!(output.stderr, b"Usage: cargo xtask <task>\n");
        assert!(output.stdout.is_empty());
    }
}
