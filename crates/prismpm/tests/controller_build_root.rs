//! CT-13: the controller reads the LexLean build root from `lexlean.toml`.
//!
//! A LexLean project names its build root itself, and the compiler resolves it
//! against the project directory, which need not be the Prism project root. The
//! controller reads the LexLean build tree where the compiler wrote it. LexLean
//! has no default for the field: a `lexlean.toml` without `build_root` is not a
//! LexLean project, and the controller refuses it with the compiler's diagnostic.

use lexlean::{Engine, LockRequest};
use prismpm::controller::BuildRequest;
use prismpm::Controller;
use std::path::{Path, PathBuf};

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crate is below repository root")
        .to_path_buf()
}

const MODULE: &str = "\\begin{lexlean}{Trivial}\n\
\\useglossary{lexlean.std.nat@1.2.0}\n\
\\useglossary{trivial.module@1.0.0}\n\
\\title{Trivial module}\n\
\\begin{semanticmodule}\n\
definition{\n  name: one,\n  parameters: [],\n  result: Nat,\n  body: 1\n}\n\
\\end{semanticmodule}\n\
\\end{lexlean}\n";

const LEXICON: &str = "spec = \"lexlean/lexicon/1\"\npackage = \"trivial.module\"\nversion = \"1.0.0\"\n\
language = \"1.2\"\nimports = [\"lexlean.core@1.2.0\", \"lexlean.std.bool@1.2.0\", \"lexlean.std.nat@1.2.0\"]\n";

const ENTRY: &str = "spec = \"lexlean/entry/1\"\nid = \"trivial-module\"\ncategory = \"label-word\"\nsurface_arity = 0\n\
frame = \"atom\"\n\n[denotation]\nkind = \"document\"\nmodule = \"Trivial\"\ncomponent = \"Trivial\"\n\n\
[[form]]\nid = \"trivial-module\"\nchannel = \"text\"\nsurface = \"Trivial module\"\ncanonical_source = true\n\
features = [\"sentence-case\", \"singular\"]\n";

/// A Prism project whose LexLean project lives in `lexlean_directory` below the
/// Prism project root (`.` for the same directory) and configures `build_root`.
fn project(lexlean_directory: &str, build_root: Option<&str>) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join(lexlean_directory);
    std::fs::create_dir_all(directory.join("src")).unwrap();
    let fixture = repository().join("tests/fixtures/holo/ho-11-text-application/project");
    for name in ["lean-toolchain", "lakefile.toml", "lake-manifest.json"] {
        std::fs::copy(fixture.join(name), directory.join(name)).unwrap();
    }
    std::fs::write(directory.join("src/Trivial.lex.tex"), MODULE).unwrap();
    std::fs::create_dir_all(directory.join("language/trivial.module/entries")).unwrap();
    std::fs::write(
        directory.join("language/trivial.module/lexicon.toml"),
        LEXICON,
    )
    .unwrap();
    std::fs::write(
        directory.join("language/trivial.module/entries/trivial-module.toml"),
        ENTRY,
    )
    .unwrap();
    let limits = std::fs::read_to_string(fixture.join("lexlean.toml")).unwrap();
    let limits = &limits[limits.find("[limits]").unwrap()..];
    let build_root = build_root.map_or_else(String::new, |root| format!("build_root = {root:?}\n"));
    std::fs::write(
        directory.join("lexlean.toml"),
        format!(
            "spec = \"lexlean/project/1\"\nname = \"trivial\"\nlanguage = \"1.2\"\nmodule_prefix = \"Trivial\"\n\
source_roots = [\"src\"]\nentrypoints = [\"src/Trivial.lex.tex\"]\n{build_root}\
lockfile = \"lexlean.lock\"\nlean_workspace = \".\"\nlean_toolchain = \"leanprover/lean4:v4.32.1\"\n\n\
[[lexicon_source]]\npackage = \"lexlean.std.nat\"\nkind = \"builtin\"\n\n\
[[lexicon_source]]\npackage = \"trivial.module\"\nkind = \"path\"\npath = \"language/trivial.module\"\n\n{limits}"
        ),
    )
    .unwrap();
    std::fs::write(
        root.path().join("prismpm.toml"),
        format!(
            "spec = \"prismpm/project/1\"\nproject = \"Trivial\"\nlexlean_project = \"{}\"\nbuild_root = \".prism\"\n\n\
[limits]\nmax_holo_bytes = 16777216\nmax_entities = 100000\nmax_diagnostics = 256\n",
            if lexlean_directory == "." {
                "lexlean.toml".to_owned()
            } else {
                format!("{lexlean_directory}/lexlean.toml")
            }
        ),
    )
    .unwrap();
    root
}

fn lock(root: &Path, lexlean_directory: &str) {
    let path =
        camino::Utf8PathBuf::from_path_buf(root.join(lexlean_directory).join("lexlean.toml"))
            .unwrap();
    Engine::load(&path)
        .expect("the project loads")
        .lock(LockRequest {
            check_only: false,
            allow_network: false,
        })
        .expect("the project locks");
}

/// The LexLean build directories below `root`: `<build_root>/build/<id>`.
fn builds(build_root: &Path) -> Vec<PathBuf> {
    match std::fs::read_dir(build_root.join("build")) {
        Ok(entries) => entries.map(|entry| entry.unwrap().path()).collect(),
        Err(_) => Vec::new(),
    }
}

/// The repository's own LexLean project, copied below `directory` with its build
/// root set to `build_root`, and the Prism project that selects it.
fn stdlib_project(directory: &str, build_root: &str) -> tempfile::TempDir {
    let repository = repository();
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join(directory);
    std::fs::create_dir_all(&target).unwrap();
    for name in ["lakefile.toml", "lake-manifest.json", "lean-toolchain"] {
        std::fs::copy(repository.join(name), target.join(name)).unwrap();
    }
    for tree in ["language", "stdlib/src"] {
        for entry in walkdir::WalkDir::new(repository.join(tree)) {
            let entry = entry.unwrap();
            let relative = entry.path().strip_prefix(&repository).unwrap();
            if entry.file_type().is_dir() {
                std::fs::create_dir_all(target.join(relative)).unwrap();
            } else {
                std::fs::copy(entry.path(), target.join(relative)).unwrap();
            }
        }
    }
    let configured = std::fs::read_to_string(repository.join("lexlean.toml")).unwrap();
    assert!(configured.contains("build_root = \".lexlean\""));
    std::fs::write(
        target.join("lexlean.toml"),
        configured.replace(
            "build_root = \".lexlean\"",
            &format!("build_root = {build_root:?}"),
        ),
    )
    .unwrap();
    let selected = if directory == "." {
        "lexlean.toml".to_owned()
    } else {
        format!("{directory}/lexlean.toml")
    };
    std::fs::write(
        root.path().join("prismpm.toml"),
        std::fs::read_to_string(repository.join("prismpm.toml"))
            .unwrap()
            .replace(
                "lexlean_project = \"lexlean.toml\"",
                &format!("lexlean_project = {selected:?}"),
            ),
    )
    .unwrap();
    lock(root.path(), directory);
    root
}

#[test]
fn a_project_with_another_build_root_builds_through_it() {
    // The LexLean project is in a subdirectory and configures `.lx`: neither
    // `<prism root>/.lexlean` nor `<prism root>/.lx` is where the compiler writes.
    let root = stdlib_project("lexlean", ".lx");
    let controller = Controller::load(root.path()).unwrap();
    let build = controller
        .build(BuildRequest { config_path: None })
        .expect("a build root other than .lexlean is read where it is configured");
    let written = builds(&root.path().join("lexlean/.lx"));
    assert_eq!(
        written.len(),
        1,
        "the compiler wrote one build under the configured root"
    );
    assert!(!root.path().join(".lexlean").exists());
    assert!(!root.path().join(".lx").exists());
    assert!(!root.path().join("lexlean/.lexlean").exists());
    let published = std::fs::read(
        root.path()
            .join(".prism/build")
            .join(&build.build_id)
            .join("lexlean/build/manifest.json"),
    )
    .unwrap();
    // The published manifest is the one the compiler wrote under the configured root.
    assert_eq!(
        published,
        std::fs::read(written[0].join("manifest.json")).unwrap()
    );
}

#[test]
fn a_lexlean_toml_without_a_build_root_is_refused() {
    let root = project(".", None);
    let controller = Controller::load(root.path()).unwrap();
    let error = controller
        .build(BuildRequest { config_path: None })
        .expect_err("LexLean has no default build root");
    assert_eq!(error.code, "PP2001", "{error}");
    assert!(
        !root.path().join(".lexlean").exists() && !root.path().join(".prism").exists(),
        "nothing is written for a project the compiler refuses"
    );
}
