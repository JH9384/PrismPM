//! Facet records declared in a lexlean entrypoint outside the application
//! roots reach the model document when the whole checked snapshot supplies
//! them.

use lexlean::{CheckRequest, Engine, LockRequest, Selection, SemanticSnapshot};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

fn architecture_source(standard_index: u64) -> String {
    format!(
        r#"\begin{{lexlean}}{{Architecture}}
\useglossary{{lexlean.std.bool@1.2.0}}
\useglossary{{lexlean.std.nat@1.2.0}}
\useglossary{{prism.arch@1.0.0}}
\importmodule{{Foundation.Arch}}
\importmodule{{Foundation.Qual}}
\importmodule{{Foundation.Sec}}
\title{{Text application model}}
\begin{{semanticmodule}}
definition{{
  name: stakeholderOperator,
  parameters: [],
  result: Foundation.Arch::Stakeholder,
  body: (record Foundation.Arch::Stakeholder {{index := 0, name := "operator", text := "Runs the system."}})
}}

definition{{
  name: standardCited,
  parameters: [],
  result: Foundation.Arch::StandardReference,
  body: (record Foundation.Arch::StandardReference {{standardIndex := {standard_index}, editionIndex := 0, standardId := "ISO-42010-2022", edition := "2022"}})
}}
\end{{semanticmodule}}
\end{{lexlean}}
"#
    )
}

/// The whole-project snapshot and the application-root snapshot of a project
/// whose architecture records live in `src/Architecture.lex.tex`, an
/// entrypoint outside the application roots.
fn snapshots(standard_index: u64) -> (SemanticSnapshot, SemanticSnapshot) {
    let temp = tempfile::tempdir().unwrap();
    let repo = root();
    let fixture = repo.join("tests/fixtures/holo/ho-11-text-application/project");
    for name in [
        "lexlean.lock",
        "lean-toolchain",
        "lakefile.toml",
        "lake-manifest.json",
    ] {
        std::fs::copy(fixture.join(name), temp.path().join(name)).unwrap();
    }
    let config = std::fs::read_to_string(fixture.join("lexlean.toml"))
        .unwrap()
        .replace(
            "entrypoints = [\"src/TextRequest.lex.tex\"]",
            "entrypoints = [\"src/Architecture.lex.tex\", \"src/TextRequest.lex.tex\"]",
        )
        .replace(
            "[limits]",
            "[[lexicon_source]]\npackage = \"prism.qual\"\nkind = \"path\"\npath = \"language/prism.qual\"\n\n\
             [[lexicon_source]]\npackage = \"prism.sec\"\nkind = \"path\"\npath = \"language/prism.sec\"\n\n[limits]",
        );
    assert!(config.contains("src/Architecture.lex.tex"));
    std::fs::write(temp.path().join("lexlean.toml"), config).unwrap();
    std::fs::create_dir_all(temp.path().join("src")).unwrap();
    std::fs::copy(
        fixture.join("src/TextRequest.lex.tex"),
        temp.path().join("src/TextRequest.lex.tex"),
    )
    .unwrap();
    for module in [
        "Foundation/Bytes.lex.tex",
        "Foundation/Utf8.lex.tex",
        "Foundation/Arch.lex.tex",
        "Foundation/Qual.lex.tex",
        "Foundation/Sec.lex.tex",
        "Foundation/View/Text/V1/Model.lex.tex",
    ] {
        let destination = temp.path().join("src").join(module);
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::copy(repo.join("stdlib/src").join(module), destination).unwrap();
    }
    std::fs::write(
        temp.path().join("src/Architecture.lex.tex"),
        architecture_source(standard_index),
    )
    .unwrap();
    for package in ["prism.arch", "prism.qual", "prism.sec"] {
        let language = repo.join("language").join(package);
        for entry in walkdir::WalkDir::new(&language) {
            let entry = entry.unwrap();
            let destination = temp
                .path()
                .join("language")
                .join(package)
                .join(entry.path().strip_prefix(&language).unwrap());
            if entry.file_type().is_dir() {
                std::fs::create_dir_all(destination).unwrap();
            } else {
                std::fs::copy(entry.path(), destination).unwrap();
            }
        }
    }
    let path = camino::Utf8PathBuf::from_path_buf(temp.path().join("lexlean.toml")).unwrap();
    Engine::load(&path)
        .unwrap()
        .lock(LockRequest {
            check_only: false,
            allow_network: false,
        })
        .unwrap();
    let engine = Engine::load(&path).unwrap();
    let full = engine
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .unwrap();
    let application = engine
        .snapshot(CheckRequest {
            selection: Selection::Files(BTreeSet::from([camino::Utf8PathBuf::from(
                "src/TextRequest.lex.tex",
            )])),
        })
        .unwrap();
    (full, application)
}

#[test]
fn records_in_a_non_application_entrypoint_reach_the_model_document() {
    let (full, application) = snapshots(4);
    let roots_only = prismpm::holo::application::project_application(&application)
        .unwrap()
        .unwrap();
    assert!(
        roots_only.architecture.stakeholders.is_empty(),
        "the application roots do not contain the architecture entrypoint"
    );
    let document = prismpm::holo::application::project_application_with_facets(&application, &full)
        .unwrap()
        .unwrap();
    assert_eq!(
        document.provenance.snapshot_id,
        application.snapshot_id().to_string()
    );
    assert_eq!(document.architecture.stakeholders.len(), 1);
    let stakeholder = &document.architecture.stakeholders[0];
    assert_eq!(stakeholder.id, "Architecture::stakeholderOperator");
    assert_eq!(stakeholder.name, "operator");
    assert_eq!(stakeholder.text, "Runs the system.");
    assert_eq!(document.standards_profile.len(), 5);
    assert_eq!(document.provenance.facet_packages.len(), 3);
}

#[test]
fn a_wrong_standard_index_in_a_non_application_entrypoint_is_refused() {
    let (full, application) = snapshots(42010);
    let error = prismpm::holo::application::project_application_with_facets(&application, &full)
        .unwrap_err();
    assert_eq!(error.code, "PP4004");
    assert!(
        error
            .message
            .contains("Architecture::standardCited must have standardIndex 4"),
        "{}",
        error.message
    );
}
