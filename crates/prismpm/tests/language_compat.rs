//! LexLean language 1.1 and 1.2 projects side by side (#203).
//!
//! The 1.2 Calculator is `lexlean migrate --to 1.2` of `examples/Calculator`,
//! and the data-form case is the 1.1 source declared as language 1.2.

use lexlean::{CheckRequest, Engine, Selection};
use prismpm::controller::CheckRequest as PrismCheckRequest;
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

fn calculator_1_2() -> PathBuf {
    root().join("tests/fixtures/controller/ct-02-calculator-language-1-2/project")
}

fn data_form_1_2() -> PathBuf {
    root().join("tests/negative/language/data-form-1-2/project")
}

fn engine(project: &Path) -> Engine {
    let path = camino::Utf8PathBuf::from_path_buf(project.join("lexlean.toml")).unwrap();
    Engine::load(&path).unwrap()
}

fn application(project: &Path) -> serde_json::Value {
    let snapshot = engine(project)
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .unwrap();
    let doc = prismpm::holo::application::project_application(&snapshot)
        .unwrap()
        .unwrap();
    serde_json::to_value(doc).unwrap()
}

fn copy(source: &Path, destination: &Path) {
    for entry in walkdir::WalkDir::new(source) {
        let entry = entry.unwrap();
        let relative = entry.path().strip_prefix(source).unwrap();
        let target = destination.join(relative);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target).unwrap();
        } else {
            std::fs::copy(entry.path(), &target).unwrap();
        }
    }
}

/// The model document without the identities of its source and compiler.
fn masked(mut document: serde_json::Value) -> (serde_json::Value, serde_json::Value) {
    let provenance = document
        .as_object_mut()
        .unwrap()
        .remove("provenance")
        .unwrap();
    (document, provenance)
}

#[test]
fn migrated_calculator_projects_the_same_application_as_language_1_1() {
    let (legacy, legacy_provenance) = masked(application(&root().join("examples/Calculator")));
    let (migrated, migrated_provenance) = masked(application(&calculator_1_2()));
    assert_eq!(migrated, legacy);
    // One emitter projects both; the compiler and source identities differ.
    assert_eq!(
        migrated_provenance["emitter_semantics_id"],
        legacy_provenance["emitter_semantics_id"]
    );
    for field in ["compiler_semantics_id", "source_id"] {
        assert_ne!(migrated_provenance[field], legacy_provenance[field]);
    }
}

#[test]
fn both_languages_check_through_the_controller() {
    for project in [root().join("examples/Calculator"), calculator_1_2()] {
        let scratch = tempfile::tempdir().unwrap();
        copy(&project, scratch.path());
        prismpm::Controller::load(scratch.path())
            .unwrap()
            .check(PrismCheckRequest { config_path: None })
            .unwrap();
    }
}

#[test]
fn data_form_language_1_2_is_refused_with_the_lexlean_diagnostic_unchanged() {
    let refused = engine(&data_form_1_2())
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .unwrap_err();
    assert_eq!(refused.diagnostics.len(), 1);
    let expected = &refused.diagnostics[0];
    assert_eq!(expected.code.as_str(), "LLP2003");

    let scratch = tempfile::tempdir().unwrap();
    copy(&data_form_1_2(), scratch.path());
    let error = prismpm::Controller::load(scratch.path())
        .unwrap()
        .check(PrismCheckRequest { config_path: None })
        .unwrap_err();
    assert_eq!(error.code.as_str(), "PP2001");
    assert_eq!(error.causes.len(), 1);
    let cause = &error.causes[0];
    assert_eq!(cause.subsystem, "lexlean");
    assert_eq!(cause.code, expected.code.as_str());
    assert_eq!(cause.message, expected.message);
    let span = expected.primary.as_ref().unwrap();
    let primary = cause.primary.as_ref().unwrap();
    assert_eq!(
        (
            primary.path.as_str(),
            primary.byte_start,
            primary.byte_end,
            primary.line_start,
            primary.column_start,
            primary.line_end,
            primary.column_end,
        ),
        (
            span.path.as_str(),
            span.byte_start,
            span.byte_end,
            span.line_start,
            span.column_start,
            span.line_end,
            span.column_end,
        )
    );
    assert!(cause.labels.is_empty() && cause.notes.is_empty() && cause.help.is_empty());
}
