//! `cargo xtask bindings-package [--write]`: export the bindings writers.
//!
//! The JS, Rust and Python bindings writers of `prism generate` are one
//! LexLean model, `bindings/src/Foundation/Bindings/V1`. LexLean's certified
//! production export (`lexlean production build`) verifies that project with
//! Lean and renders each writer named in `bindings/production.json` as a Rust
//! package. This task runs that export and compares each package with the
//! committed copy under `bindings/generated/<name>`, or replaces the copy with
//! `--write`. No writer logic is written by hand in any language.
//!
//! A package that `prismpm` itself runs is also kept as a module of the
//! `prismpm` crate, so the published crate carries it, and one this gate runs
//! as a module of `xtask`: [`VENDORED`] names each one and the file its
//! exported `src/lib.rs` is copied to.

use crate::Fail;
use camino::Utf8PathBuf;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// The exported packages that are also modules of the `prismpm` crate or of
/// `xtask`, and the file each one's `src/lib.rs` is kept in.
const VENDORED: &[(&str, &str)] = &[
    (
        "prism_bindings_js",
        "crates/prismpm/src/generate/js_writer.rs",
    ),
    (
        "prism_bindings_python",
        "crates/prismpm/src/generate/python_writer.rs",
    ),
    (
        "prism_bindings_rust",
        "crates/prismpm/src/generate/rust_writer.rs",
    ),
    ("prism_developer_view", "xtask/src/developer_view/model.rs"),
    (
        "prism_image_store_rules",
        "xtask/src/image_store_rules/model.rs",
    ),
    (
        "prism_proof_statement",
        "crates/prismpm/src/verification/proof_statement.rs",
    ),
];

/// The files of one exported package, by their path inside it.
fn package_files(directory: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>, Fail> {
    let mut files = BTreeMap::new();
    for entry in walkdir::WalkDir::new(directory).sort_by_file_name() {
        let entry = entry?;
        if entry.file_type().is_file() {
            let relative = entry.path().strip_prefix(directory)?.to_path_buf();
            files.insert(relative, std::fs::read(entry.path())?);
        }
    }
    Ok(files)
}

pub(crate) fn run(root: &Path, arguments: &[String]) -> Result<(), Fail> {
    let write = match arguments {
        [] => false,
        [flag] if flag == "--write" => true,
        _ => return Err("usage: cargo xtask bindings-package [--write]".into()),
    };
    let project = root.join("bindings");
    let config = Utf8PathBuf::from_path_buf(project.join("lexlean.toml"))
        .map_err(|path| format!("not UTF-8: {}", path.display()))?;
    let engine = lexlean::api::Engine::load(&config)?;
    let request_bytes = std::fs::read(project.join("production.json"))?;
    let request = lexlean::api::production::ProductionRequest::from_json(&request_bytes)?;
    let output = lexlean::api::production::build(&engine, &request)?;
    let bundle = project.join(output.bundle.as_std_path());
    let packages = bundle.join("packages").join("rust-std");
    let generated = project.join("generated");
    let mut drifted = Vec::new();
    let mut names = Vec::new();
    for entry in std::fs::read_dir(&packages)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let exported = package_files(&entry.path())?;
        let committed_dir = generated.join(&name);
        let committed = if committed_dir.is_dir() {
            package_files(&committed_dir)?
        } else {
            BTreeMap::new()
        };
        if let Some((_, module)) = VENDORED.iter().find(|(package, _)| *package == name) {
            let library = exported
                .get(Path::new("src/lib.rs"))
                .ok_or_else(|| format!("the exported package {name} has no src/lib.rs"))?;
            let target = root.join(module);
            if std::fs::read(&target).ok().as_ref() != Some(library) {
                if write {
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(&target, library)?;
                } else {
                    drifted.push((*module).to_owned());
                }
            }
        }
        if exported != committed {
            if write {
                if committed_dir.exists() {
                    std::fs::remove_dir_all(&committed_dir)?;
                }
                for (relative, bytes) in &exported {
                    let target = committed_dir.join(relative);
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(target, bytes)?;
                }
            } else {
                drifted.push(name.clone());
            }
        }
        names.push(name);
    }
    if generated.is_dir() {
        for entry in std::fs::read_dir(&generated)? {
            let name = entry?.file_name().to_string_lossy().into_owned();
            if !names.contains(&name) {
                if write {
                    std::fs::remove_dir_all(generated.join(&name))?;
                } else {
                    drifted.push(name);
                }
            }
        }
    }
    if drifted.is_empty() || write {
        names.sort();
        println!(
            "bindings packages {}: {}",
            if write { "written" } else { "current" },
            names.join(", ")
        );
        Ok(())
    } else {
        drifted.sort();
        Err(format!(
            "bindings packages drifted from the model: {}; run `cargo xtask bindings-package --write`",
            drifted.join(", ")
        )
        .into())
    }
}
