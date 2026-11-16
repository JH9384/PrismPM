//! Build of a server application: the declared core through LexLean's
//! `production` API, and the generated host adapter laid out around it.
//!
//! The core is a LexLean production root whose export is `run(Bytes) ->
//! Result<List<u64>, Overflow>`. The compiler certifies it (preservation
//! certificates A, B and E, replayed by Lean's kernel); this module only names
//! the root, the package and the one target, `rust-std`, and refuses what the
//! adapter cannot run: a root the project does not declare as a production root,
//! a package that exhibits an effect the adapter gives no bound for, a project
//! that changed while it was exported.
//!
//! The result is a set of files relative to the consumer's Cargo workspace root:
//! the core package under its crate name, and the two generated packages of the
//! host adapter. The workspace manifest, the binding crate and the release
//! profile stay the consumer's own (`server_host::workspace::verify`), and the
//! build retains them beside the packages ([`consumer_artifacts`]), so that a
//! release holds everything its program is built from.

use crate::error::PrismError;
use crate::holo::server_application::ServerApplication;
use lexlean::api::production::{
    self, Expectation, PackageName, ProductionRequest, ProductionResult, RootRequest, TargetOutput,
    TargetRef, REQUEST_SPEC,
};
use lexlean::{Engine, SemanticSnapshot};
use std::path::{Component, Path};

/// The only target a served core is exported for.
pub const TARGET: &str = "rust-std";
/// The effects a core's package may exhibit on that target. `recursion` is not
/// one of them: its depth is bounded only by the input, and the stack that the
/// adapter gives the core is a model bound, not an unbounded one.
pub const ADMITTED_EFFECTS: [&str; 2] = ["allocation", "overflow"];
/// Where the result of the production build is recorded, relative to the workspace root.
pub const RESULT_FILE: &str = "production-result.json";

/// A built server application.
#[derive(Debug, Clone)]
pub struct ServerBuild {
    /// What the compiler recorded about the export.
    pub result: ProductionResult,
    /// The files of the core package and of the two generated packages, relative
    /// to the consumer's workspace root, in path order.
    pub files: Vec<(String, Vec<u8>)>,
}

fn refused(message: impl Into<String>) -> PrismError {
    PrismError::new("PP2025", message)
}

/// The production request that names the declared core.
///
/// The request pins the identities of the snapshot it was made from, so that a
/// project edited between the check and the export is stale, not exported.
///
/// # Errors
/// Returns `PP2025` when the compiler does not describe the `rust-std` target.
pub fn request(
    application: &ServerApplication,
    snapshot: &SemanticSnapshot,
) -> Result<ProductionRequest, PrismError> {
    let descriptor = production::targets()
        .map_err(|error| refused(format!("the compiler's targets are unreadable: {error:?}")))?
        .into_iter()
        .find(|descriptor| descriptor.id == TARGET)
        .ok_or_else(|| refused(format!("the compiler has no target {TARGET}")))?;
    Ok(ProductionRequest {
        spec: REQUEST_SPEC.to_owned(),
        roots: vec![RootRequest {
            root: application.core.root.clone(),
            package: PackageName {
                name: application.core.package.clone(),
                version: application.core.version.clone(),
            },
            targets: vec![TargetRef {
                id: TARGET.to_owned(),
                digest: descriptor.digest,
            }],
        }],
        expect: Expectation {
            source_id: Some(snapshot.source_id()),
            semantic_id: Some(snapshot.semantic_id()),
            lock_sha256: None,
        },
        evidence: Vec::new(),
    })
}

/// Refuse a package that exhibits an effect the adapter gives no bound for.
///
/// # Errors
/// Returns `PP2025` naming the first effect that is not admitted.
pub fn admit_effects(root: &str, effects: &[String]) -> Result<(), PrismError> {
    match effects
        .iter()
        .find(|effect| !ADMITTED_EFFECTS.contains(&effect.as_str()))
    {
        Some(effect) => Err(refused(format!(
            "the package of {root} exhibits the effect {effect}; a served core may exhibit only {}",
            ADMITTED_EFFECTS.join(" and ")
        ))),
        None => Ok(()),
    }
}

fn relative(path: &str) -> Result<&str, PrismError> {
    let safe = !path.is_empty()
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
    if safe {
        Ok(path)
    } else {
        Err(refused(format!("{path} is not a confined relative path")))
    }
}

/// Build the core of `application` through the production API and generate the
/// host adapter around it.
///
/// `root` is the directory of the LexLean project that `engine` loaded, whose
/// build root holds the production bundle until the packages are read out of it.
///
/// # Errors
/// Returns `PP2013` or `PP2024` for an invalid declaration, `PP2001` for a core
/// root the snapshot does not define, and `PP2025` when the compiler refuses the
/// export (a root that is not a production root of the project, a target the root
/// does not declare, a verification failure, a stale project) or the package
/// exhibits an effect that is not admitted.
pub fn build(
    engine: &Engine,
    snapshot: &SemanticSnapshot,
    application: &ServerApplication,
    root: &Path,
    limit: u64,
) -> Result<ServerBuild, PrismError> {
    crate::holo::server_application::validate_roots(application, snapshot)?;
    // The generated packages come first: a declaration that cannot be generated is
    // refused before the compiler spends its time.
    let generated = crate::server_host::generate(application)?;
    let output = production::build(engine, &request(application, snapshot)?)
        .map_err(|error| PrismError::from_lexlean("PP2025", "server core export", error, limit))?;
    let bundle = root.join(output.bundle.as_str());
    let outcome = read_package(application, &output.result, &bundle);
    // The staging area is not the consumer's: the packages are read out of it, or refused.
    let _ = std::fs::remove_dir_all(&bundle);
    let mut files = outcome?;
    for item in generated.files {
        relative(&item.path)?;
        files.push((item.path, item.bytes));
    }
    files.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    Ok(ServerBuild {
        result: output.result,
        files,
    })
}

/// The output of the declared core in the one target, when the compiler's result
/// holds the package the declaration names and it exhibits only admitted effects.
///
/// # Errors
/// Returns `PP2025` for a result without that output, a package other than the
/// declared one and an effect that is not admitted.
pub fn core_output<'a>(
    application: &ServerApplication,
    result: &'a ProductionResult,
) -> Result<&'a TargetOutput, PrismError> {
    let output = result
        .roots
        .iter()
        .find(|root| root.root == application.core.root)
        .and_then(|root| {
            root.outputs
                .iter()
                .find(|output| output.target.id == TARGET)
        })
        .ok_or_else(|| refused("the production result holds no package of the declared core"))?;
    admit_effects(&application.core.root, &output.effects)?;
    let package = &output.package;
    if package.name != application.core.package || package.version != application.core.version {
        return Err(refused(
            "the exported package is not the one the declaration names",
        ));
    }
    Ok(output)
}

fn read_package(
    application: &ServerApplication,
    result: &ProductionResult,
    bundle: &Path,
) -> Result<Vec<(String, Vec<u8>)>, PrismError> {
    let package = &core_output(application, result)?.package;
    let mut files = Vec::new();
    for file in &package.files {
        let inside = file
            .path
            .strip_prefix(&format!("{}/", package.directory))
            .ok_or_else(|| refused("a package file lies outside its package directory"))?;
        relative(inside)?;
        let bytes = std::fs::read(bundle.join(&file.path))
            .map_err(|error| refused(format!("{}: {error}", file.path)))?;
        files.push((format!("{}/{inside}", package.name), bytes));
    }
    Ok(files)
}

/// The artifacts of a build, as the controller publishes them: the files of the
/// workspace under `server/`, and the compiler's record of the export.
#[must_use]
pub fn artifacts(build: &ServerBuild) -> Vec<(String, Vec<u8>)> {
    let mut artifacts = build
        .files
        .iter()
        .map(|(path, bytes)| (format!("server/{path}"), bytes.clone()))
        .collect::<Vec<_>>();
    artifacts.push((format!("server/{RESULT_FILE}"), build.result.to_json()));
    artifacts
}

/// Where the build retains the consumer's own workspace files.
pub const CONSUMER_DIRECTORY: &str = "consumer";

/// The consumer's own workspace files of the project at `project`, as the build
/// retains them under `consumer/`: its manifest, its committed lock, an optional
/// toolchain pin and the members the build does not generate, the binding among
/// them. A release carries them, so that the program can be built from the release
/// alone.
///
/// # Errors
/// Returns `PP2013` for a project that does not hold them as
/// [`crate::server_host::workspace::consumer_files`] requires.
pub fn consumer_artifacts(
    application: &ServerApplication,
    project: &Path,
) -> Result<Vec<(String, Vec<u8>)>, PrismError> {
    Ok(
        crate::server_host::workspace::consumer_files(application, project)?
            .into_iter()
            .map(|(path, bytes)| (format!("{CONSUMER_DIRECTORY}/{path}"), bytes))
            .collect(),
    )
}

/// Write the files of a build under `workspace`, the consumer's workspace root.
/// Files of the build replace what is there; nothing else is touched.
///
/// # Errors
/// Returns `PP4002` when a file cannot be written and `PP2025` for a path that is
/// not confined to the workspace.
pub fn publish(build: &ServerBuild, workspace: &Path) -> Result<(), PrismError> {
    for (path, bytes) in &build.files {
        relative(path)?;
        let target = workspace.join(path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                PrismError::new("PP4002", format!("{}: {error}", parent.display()))
            })?;
        }
        std::fs::write(&target, bytes)
            .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", target.display())))?;
    }
    Ok(())
}
