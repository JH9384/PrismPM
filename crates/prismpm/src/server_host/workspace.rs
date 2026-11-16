//! The consumer's workspace as the declaration sees it.
//!
//! The binding crate is a member of the consumer's own Cargo workspace, at the
//! path the model declares. The declaration alone cannot say whether that
//! directory holds the declared crate, so this check reads the workspace:
//! the production core package, the generated packages and the binding are
//! exactly listed members, the
//! binding directory resolves inside the workspace, its manifest names the
//! declared crate and depends on the generated API package, and every other
//! dependency it has is a crates.io dependency or another workspace member.
//!
//! The consumer's own files are part of the build: [`consumer_files`] reads them
//! out of the project (the root manifest, its committed lock, a pinned toolchain
//! and every member the build does not generate), and the build retains them
//! beside the generated packages. Verification, and the replay of a release, lay
//! them out from the files of the build alone ([`workspace_files`],
//! [`write_files`]) and check the result with [`verify_files`], so that what is
//! built is what the build holds and nothing the working tree happens to contain.

use super::{api_library_name, api_name, program_name};
use crate::error::PrismError;
use crate::holo::server_application::ServerApplication;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path};

/// Most bytes of the consumer's own files a verification stages.
pub const STAGED_MAXIMUM: u64 = 64 * 1024 * 1024;
/// The file the build records its compiler result in; it is not a workspace file.
const RESULT: &str = "production-result.json";

/// Files by `/`-separated path relative to the workspace root.
pub type Files = BTreeMap<String, Vec<u8>>;

fn mismatch(message: impl Into<String>) -> PrismError {
    PrismError::new("PP2013", message)
}

fn text(files: &Files, path: &str) -> Result<String, PrismError> {
    let bytes = files
        .get(path)
        .ok_or_else(|| mismatch(format!("{path}: the workspace holds no such file")))?;
    String::from_utf8(bytes.clone()).map_err(|_| mismatch(format!("{path}: not UTF-8")))
}

fn parse(path: &str, text: &str) -> Result<toml::Table, PrismError> {
    text.parse::<toml::Table>()
        .map_err(|error| mismatch(format!("{path}: {error}")))
}

/// Where the checks read the workspace: a file's text, and a path resolved to the
/// workspace-relative path it names, which must lie inside the workspace.
struct Tree<'a> {
    read: &'a dyn Fn(&str) -> Result<String, PrismError>,
    resolve: &'a dyn Fn(&str) -> Result<String, PrismError>,
}

fn check(application: &ServerApplication, tree: &Tree<'_>) -> Result<(), PrismError> {
    let manifest = parse("Cargo.toml", &(tree.read)("Cargo.toml")?)?;
    let members = manifest
        .get("workspace")
        .and_then(|table| table.get("members"))
        .and_then(toml::Value::as_array)
        .map(|members| {
            members
                .iter()
                .filter_map(|member| member.as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .ok_or_else(|| mismatch("the workspace manifest lists no members"))?;
    let mut required = vec![
        application.core.package.clone(),
        api_name(application),
        program_name(application),
    ];
    required.extend(
        application
            .bindings
            .iter()
            .map(|binding| binding.path.clone()),
    );
    for path in required {
        // Members are listed exactly: a glob could admit a directory nobody declared.
        if !members.contains(&path) {
            return Err(mismatch(format!(
                "the workspace does not list {path} as a member"
            )));
        }
    }
    for binding in &application.bindings {
        let directory = (tree.resolve)(&binding.path)?;
        let manifest_path = format!("{directory}/Cargo.toml");
        let manifest = parse(&manifest_path, &(tree.read)(&manifest_path)?)?;
        let package = manifest
            .get("package")
            .and_then(toml::Value::as_table)
            .ok_or_else(|| mismatch("the binding manifest has no package"))?;
        if package.get("name").and_then(toml::Value::as_str) != Some(binding.crate_name.as_str()) {
            return Err(mismatch(format!(
                "the crate at {} is not named {}",
                binding.path, binding.crate_name
            )));
        }
        if let Some(name) = manifest
            .get("lib")
            .and_then(|lib| lib.get("name"))
            .and_then(toml::Value::as_str)
        {
            if name != binding.crate_name.replace('-', "_") {
                return Err(mismatch("the binding library is not named after its crate"));
            }
        }
        let api = api_name(application);
        let dependencies = manifest
            .get("dependencies")
            .and_then(toml::Value::as_table)
            .ok_or_else(|| mismatch("the binding declares no dependencies"))?;
        if !dependencies.contains_key(&api) {
            return Err(mismatch(format!(
                "the binding does not depend on the generated {api} ({})",
                api_library_name(application)
            )));
        }
        for section in ["dependencies", "dev-dependencies", "build-dependencies"] {
            let Some(table) = manifest.get(section).and_then(toml::Value::as_table) else {
                continue;
            };
            for (name, dependency) in table {
                let Some(dependency) = dependency.as_table() else {
                    continue;
                };
                if dependency.contains_key("git") || dependency.contains_key("registry") {
                    return Err(mismatch(format!(
                        "the binding dependency {name} is not a crates.io dependency"
                    )));
                }
                if let Some(path) = dependency.get("path").and_then(toml::Value::as_str) {
                    (tree.resolve)(&format!("{directory}/{path}")).map_err(|_| {
                        mismatch(format!(
                            "the binding dependency {name} is a path outside the workspace"
                        ))
                    })?;
                }
            }
        }
    }
    Ok(())
}

/// Check the workspace at `workspace` against the declared binding.
///
/// # Errors
/// Returns `PP2013` when the workspace does not hold the declared binding as
/// described above.
pub fn verify(application: &ServerApplication, workspace: &Path) -> Result<(), PrismError> {
    let root = workspace
        .canonicalize()
        .map_err(|error| mismatch(format!("{}: {error}", workspace.display())))?;
    let read = |path: &str| {
        let file = root.join(path);
        std::fs::read_to_string(&file)
            .map_err(|error| mismatch(format!("{}: {error}", file.display())))
    };
    let resolve = |path: &str| {
        let file = root.join(path);
        let resolved = file
            .canonicalize()
            .map_err(|error| mismatch(format!("{}: {error}", file.display())))?;
        let inside = resolved
            .strip_prefix(&root)
            .map_err(|_| mismatch(format!("{} resolves outside the workspace", file.display())))?;
        Ok(inside.to_string_lossy().replace('\\', "/"))
    };
    check(
        application,
        &Tree {
            read: &read,
            resolve: &resolve,
        },
    )
}

/// Check the workspace that `files` make up against the declared binding, with no
/// filesystem: a path resolves lexically and must name a file or a directory of
/// the files, inside the workspace.
///
/// # Errors
/// Returns `PP2013` when the workspace does not hold the declared binding.
pub fn verify_files(application: &ServerApplication, files: &Files) -> Result<(), PrismError> {
    let read = |path: &str| text(files, path);
    let resolve = |path: &str| {
        let mut parts: Vec<&str> = Vec::new();
        for part in path.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    if parts.pop().is_none() {
                        return Err(mismatch(format!("{path} resolves outside the workspace")));
                    }
                }
                part => parts.push(part),
            }
        }
        let resolved = parts.join("/");
        let prefix = format!("{resolved}/");
        if resolved.is_empty()
            || !(files.contains_key(&resolved) || files.keys().any(|key| key.starts_with(&prefix)))
        {
            return Err(mismatch(format!(
                "{path}: the workspace holds no such path"
            )));
        }
        Ok(resolved)
    };
    check(
        application,
        &Tree {
            read: &read,
            resolve: &resolve,
        },
    )
}

fn confined(member: &str) -> bool {
    !member.is_empty()
        && !member.contains(['*', '?', '[', '\\'])
        && Path::new(member)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

/// Read one regular file or a tree of them into `files` below `prefix`; a symlink
/// or a special file is refused, and Cargo's own `target` output is not read.
fn read_into(
    from: &Path,
    prefix: &str,
    files: &mut Files,
    total: &mut u64,
) -> Result<(), PrismError> {
    let metadata = std::fs::symlink_metadata(from)
        .map_err(|error| mismatch(format!("{}: {error}", from.display())))?;
    if metadata.is_dir() {
        let mut entries = std::fs::read_dir(from)
            .map_err(|error| mismatch(format!("{}: {error}", from.display())))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| mismatch(format!("{}: {error}", from.display())))?;
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            // Cargo's own output is not the consumer's file.
            if entry.file_name() == "target" {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            read_into(&entry.path(), &path, files, total)?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        return Err(mismatch(format!(
            "{} is neither a regular file nor a directory",
            from.display()
        )));
    }
    *total = total.saturating_add(metadata.len());
    if *total > STAGED_MAXIMUM {
        return Err(mismatch(
            "the consumer's workspace files exceed the staging bound",
        ));
    }
    let bytes =
        std::fs::read(from).map_err(|error| mismatch(format!("{}: {error}", from.display())))?;
    files.insert(prefix.to_owned(), bytes);
    Ok(())
}

/// Every regular file below `directory`, by relative path; a link or a special
/// file is refused and Cargo's `target` output is not read.
///
/// # Errors
/// Returns `PP2013` for a file that cannot be read, a link, a special file or
/// files beyond [`STAGED_MAXIMUM`].
pub fn read_tree(directory: &Path) -> Result<Files, PrismError> {
    let mut files = Files::new();
    read_into(directory, "", &mut files, &mut 0)?;
    Ok(files)
}

/// The consumer's own files of the project: its `Cargo.toml`, its committed
/// `Cargo.lock`, an optional `rust-toolchain.toml` and every member the build does
/// not generate, by path relative to the workspace root.
///
/// # Errors
/// Returns `PP2013` when the project holds no workspace manifest or no committed
/// lock, lists a member that is a glob or leaves the project, holds a symlink or a
/// special file in a member, or exceeds [`STAGED_MAXIMUM`].
pub fn consumer_files(
    application: &ServerApplication,
    project: &Path,
) -> Result<Files, PrismError> {
    let mut total = 0;
    for file in ["Cargo.toml", "Cargo.lock"] {
        if !project.join(file).is_file() {
            return Err(mismatch(format!(
                "the project holds no {file}: the consumer commits the workspace manifest and its lock"
            )));
        }
    }
    let manifest_path = project.join("Cargo.toml");
    let manifest_text = std::fs::read_to_string(&manifest_path)
        .map_err(|error| mismatch(format!("{}: {error}", manifest_path.display())))?;
    let members = parse("Cargo.toml", &manifest_text)?
        .get("workspace")
        .and_then(|table| table.get("members"))
        .and_then(toml::Value::as_array)
        .map(|members| {
            members
                .iter()
                .filter_map(|member| member.as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .ok_or_else(|| mismatch("the workspace manifest lists no members"))?;
    let generated = BTreeSet::from([
        application.core.package.clone(),
        api_name(application),
        program_name(application),
    ]);
    let mut files = Files::new();
    for file in ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"] {
        if project.join(file).exists() {
            read_into(&project.join(file), file, &mut files, &mut total)?;
        }
    }
    for member in members.iter().filter(|member| !generated.contains(*member)) {
        if !confined(member) {
            return Err(mismatch(format!(
                "the member {member} is not a plain path inside the workspace"
            )));
        }
        read_into(&project.join(member), member, &mut files, &mut total)?;
    }
    Ok(files)
}

/// The files of the workspace to build: the consumer's own and the packages of the
/// build under `server` (all but the compiler's record).
///
/// # Errors
/// Returns `PP2013` when a file is in both, or the files exceed [`STAGED_MAXIMUM`].
pub fn workspace_files(consumer: &Files, server: &Files) -> Result<Files, PrismError> {
    let mut files = consumer.clone();
    for (path, bytes) in server {
        if path == RESULT {
            continue;
        }
        if files.insert(path.clone(), bytes.clone()).is_some() {
            return Err(mismatch(format!(
                "the consumer's workspace and the build both hold {path}"
            )));
        }
    }
    let total: u64 = files.values().map(|bytes| bytes.len() as u64).sum();
    if total > STAGED_MAXIMUM {
        return Err(mismatch(
            "the consumer's workspace files exceed the staging bound",
        ));
    }
    Ok(files)
}

/// Write `files` below `destination`.
///
/// # Errors
/// Returns `PP2013` for a path that is not a plain relative path or cannot be
/// written.
pub fn write_files(files: &Files, destination: &Path) -> Result<(), PrismError> {
    std::fs::create_dir_all(destination)
        .map_err(|error| mismatch(format!("{}: {error}", destination.display())))?;
    for (path, bytes) in files {
        if !confined(path) {
            return Err(mismatch(format!(
                "{path} is not a plain path inside the workspace"
            )));
        }
        let target = destination.join(path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| mismatch(format!("{}: {error}", parent.display())))?;
        }
        std::fs::write(&target, bytes)
            .map_err(|error| mismatch(format!("{}: {error}", target.display())))?;
    }
    Ok(())
}

/// Lay the consumer's workspace out below `destination` from its files and the
/// files of the build under `server`, then check the result with [`verify_files`].
///
/// # Errors
/// Returns the refusals of [`workspace_files`], [`verify_files`] and
/// [`write_files`].
pub fn stage_files(
    application: &ServerApplication,
    consumer: &Files,
    server: &Files,
    destination: &Path,
) -> Result<(), PrismError> {
    let files = workspace_files(consumer, server)?;
    verify_files(application, &files)?;
    write_files(&files, destination)
}

/// Lay the consumer's workspace out below `destination` for verification: the
/// project's own files ([`consumer_files`]) and the directory `server` of the
/// build, then check the result.
///
/// # Errors
/// Returns the refusals of [`consumer_files`] and [`stage_files`].
pub fn stage(
    application: &ServerApplication,
    project: &Path,
    server: &Path,
    destination: &Path,
) -> Result<(), PrismError> {
    stage_files(
        application,
        &consumer_files(application, project)?,
        &read_tree(server)?,
        destination,
    )
}
