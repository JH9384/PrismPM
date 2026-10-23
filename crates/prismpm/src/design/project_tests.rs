//! End-to-end design views: complete LexLean projects through the Controller.

use crate::controller::{BuildRequest, CheckRequest};
use crate::Controller;
use std::path::{Path, PathBuf};

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn project(relative: &str) -> (tempfile::TempDir, Controller) {
    let root = tempfile::tempdir().unwrap();
    copy(&repository().join(relative).join("project"), root.path());
    let controller = Controller::load(root.path()).unwrap();
    (root, controller)
}

fn rendered(root: &Path, build_id: &str) -> Vec<(String, String)> {
    let directory = root.join(".prism/build").join(build_id).join("design");
    let mut files = std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            (
                entry.file_name().to_string_lossy().into_owned(),
                std::fs::read_to_string(entry.path()).unwrap(),
            )
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

fn golden(name: &str) -> String {
    std::fs::read_to_string(
        repository()
            .join("tests/fixtures/design/dv-01-system-views/expected/artifacts/rendered/design")
            .join(name),
    )
    .unwrap()
}

#[test]
fn a_project_builds_every_view_into_the_build_output() {
    let (root, controller) = project("tests/fixtures/design/dv-01-system-views");
    controller
        .check(CheckRequest { config_path: None })
        .unwrap();
    let build = controller
        .build(BuildRequest { config_path: None })
        .unwrap();
    let files = rendered(root.path(), &build.build_id);
    assert_eq!(
        files
            .iter()
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>(),
        [
            "Design.opmPipeline.opl",
            "Design.umlComponents.puml",
            "Design.umlSequence.puml",
            "Design.umlSession.puml",
        ]
    );
    for (name, text) in &files {
        assert_eq!(*text, golden(name), "{name}");
    }
    let manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(
            root.path()
                .join(".prism/build")
                .join(&build.build_id)
                .join("manifest.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let listed = manifest["files"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|row| row["path"].as_str())
        .filter(|path| path.starts_with("design/"))
        .count();
    assert_eq!(listed, 4, "the build manifest binds every rendered view");
}

#[test]
fn rendering_is_reproducible_across_independent_builds() {
    let (first, left) = project("tests/fixtures/design/dv-01-system-views");
    let (second, right) = project("tests/fixtures/design/dv-01-system-views");
    let left = left.build(BuildRequest { config_path: None }).unwrap();
    let right = right.build(BuildRequest { config_path: None }).unwrap();
    assert_eq!(left.build_id, right.build_id);
    assert_eq!(
        rendered(first.path(), &left.build_id),
        rendered(second.path(), &right.build_id)
    );
}

#[test]
fn a_project_naming_an_unknown_component_is_refused() {
    let (root, controller) = project("tests/negative/design/unknown-component");
    let error = controller
        .check(CheckRequest { config_path: None })
        .unwrap_err();
    assert_eq!(error.code, "PP2012", "{}", error.message);
    assert_eq!(
        error.message,
        "design view Design::opmPipeline: Design::opmBilling names unknown component Foundation.Arch::componentBilling"
    );
    let error = controller
        .build(BuildRequest { config_path: None })
        .unwrap_err();
    assert_eq!(error.code, "PP2012", "{}", error.message);
    assert!(
        !root.path().join(".prism/build").exists(),
        "a refused view publishes no build"
    );
}
