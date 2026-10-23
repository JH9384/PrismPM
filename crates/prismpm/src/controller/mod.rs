//! Controller orchestration and atomic platform-independent publication.

use crate::config::ProjectConfig;
use crate::error::PrismError;
use crate::holo::canonical::{content_id, encode_canonical, encode_value};
use crate::holo::model_document::ModelDocument;
use crate::holo::projector::project_snapshot;
use camino::Utf8PathBuf;
use fs4::fs_std::FileExt;
use lexlean::{
    BuildRequest as LexBuildRequest, CheckRequest as LexCheckRequest, Engine, Selection,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::cell::Cell;
use std::collections::BTreeSet;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::marker::PhantomData;
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;

mod config_witness;
mod model_worker;

fn library_generator_identity() -> String {
    let mut source = b"prismpm/library-generator/2\0".to_vec();
    for (path, bytes) in [
        (
            "library_build.rs",
            include_bytes!("../library_build.rs").as_slice(),
        ),
        (
            "lean_project.rs",
            include_bytes!("../lean_project.rs").as_slice(),
        ),
        ("exporter.rs", include_bytes!("../exporter.rs").as_slice()),
        (
            "exporter/owner.rs",
            include_bytes!("../exporter/owner.rs").as_slice(),
        ),
        (
            "exporter/custody.rs",
            include_bytes!("../exporter/custody.rs").as_slice(),
        ),
        (
            "exporter/directory.rs",
            include_bytes!("../exporter/directory.rs").as_slice(),
        ),
        (
            "sdk/exporter-seed-admission.mjs",
            include_bytes!("../../sdk/exporter-seed-admission.mjs").as_slice(),
        ),
        (
            "sdk/exporter-seed.mjs",
            include_bytes!("../../sdk/exporter-seed.mjs").as_slice(),
        ),
        (
            "sdk/inventory-metadata.mjs",
            include_bytes!("../../sdk/inventory-metadata.mjs").as_slice(),
        ),
    ] {
        source.extend_from_slice(path.as_bytes());
        source.push(0);
        source.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
        source.extend_from_slice(bytes);
    }
    content_id(&source)
}

thread_local! {
    static VERIFY_WORKER_ACTIVE: Cell<bool> = const { Cell::new(false) };
}

struct VerifyWorkerGuard;

fn ensure_verification_not_active() -> Result<(), PrismError> {
    VERIFY_WORKER_ACTIVE.with(|active| {
        if active.get() {
            Err(PrismError::new(
                "PP5008",
                "recursive verification worker invocation is forbidden",
            ))
        } else {
            Ok(())
        }
    })
}

impl VerifyWorkerGuard {
    fn enter() -> Result<Self, PrismError> {
        ensure_verification_not_active()?;
        VERIFY_WORKER_ACTIVE.with(|active| active.set(true));
        Ok(Self)
    }
}

impl Drop for VerifyWorkerGuard {
    fn drop(&mut self) {
        VERIFY_WORKER_ACTIVE.with(|active| active.set(false));
    }
}

fn require_verified_build(
    verified: &VerifyResult,
    selected: &BuildResult,
) -> Result<(), PrismError> {
    if verified.build_id != selected.build_id {
        return Err(PrismError::new(
            "PP6101",
            "verification and selected build identities disagree",
        ));
    }
    Ok(())
}

/// Controller for one canonical project root.
#[derive(Debug, Clone)]
pub struct Controller {
    pub(crate) root: PathBuf,
}

/// Request for a no-write model check.
#[derive(Debug, Clone)]
pub struct CheckRequest {
    /// Confined project configuration path, or the default prismpm.toml.
    pub config_path: Option<PathBuf>,
}

/// Successful check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckResult {
    /// Result schema.
    pub schema: String,
    /// LexLean semantic identity.
    pub semantic_id: String,
    /// Semantic snapshot identity.
    pub snapshot_id: String,
    /// Canonical Holo identity.
    pub model_id: String,
    /// Number of domain entities, excluding fixed catalogs.
    pub entity_count: u64,
}

/// Request for a platform-independent build.
#[derive(Debug, Clone)]
pub struct BuildRequest {
    /// Confined project configuration path, or the default prismpm.toml.
    pub config_path: Option<PathBuf>,
}

/// Request for a fully verified OCI product release.
#[derive(Debug, Clone)]
pub struct ProductBuildRequest {
    /// Confined project configuration path, or the default prismpm.toml.
    pub config_path: Option<PathBuf>,
    /// Required tagged discovery reference; identity remains the returned digest.
    pub reference: String,
    /// Locked mode must be explicitly selected for product release assembly.
    pub locked: bool,
    /// Named system release selected from the authoritative source graph.
    pub release: Option<String>,
}

/// Request to export the exact browser closure of an immutable local release.
#[derive(Debug, Clone)]
pub struct ExportBrowserRequest {
    /// Registry-qualified immutable release reference, never a mutable tag.
    pub reference: String,
    /// New direct child directory of the project; existing paths are not replaced.
    pub output: PathBuf,
}

/// Request for source-free HTTPS byte-integrity verification, not authorization.
#[derive(Debug, Clone)]
pub struct VerifyBrowserPublicationRequest {
    /// Registry-qualified immutable local release reference.
    pub reference: String,
    /// Explicit canonical HTTPS base URL, including its trailing slash.
    pub url: String,
}

/// Successful build publication.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuildResult {
    /// Result schema.
    pub schema: String,
    /// Prism content-addressed build identity.
    pub build_id: String,
    /// LexLean source identity.
    pub source_id: String,
    /// LexLean semantic identity.
    pub semantic_id: String,
    /// Canonical relative Holo path.
    pub model_path: String,
    /// Canonical relative manifest path.
    pub manifest_path: String,
}

/// Request for complete verified execution.
#[derive(Debug, Clone)]
pub struct VerifyRequest {
    /// Confined project configuration path, or the default prismpm.toml.
    pub config_path: Option<PathBuf>,
}

/// Successful verification publication.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyResult {
    /// Result schema.
    pub schema: String,
    /// Prism attestation identity.
    pub attestation_id: String,
    /// Prism build identity.
    pub build_id: String,
    /// Published verified root.
    pub verified_root: String,
}

/// Request to remove only the configured Prism output root.
#[derive(Debug, Clone)]
pub struct CleanRequest {
    /// Confined project configuration path, or the default prismpm.toml.
    pub config_path: Option<PathBuf>,
}

/// Successful confined cleanup result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CleanResult {
    /// Result schema.
    pub schema: String,
    /// Configured project-relative output root that was absent or removed.
    pub removed: String,
}

struct Prepared {
    config: ProjectConfig,
    engine: Engine,
    snapshot: lexlean::SemanticSnapshot,
    application_snapshot: Option<lexlean::SemanticSnapshot>,
    application_selection: Option<Selection>,
    model: ModelDocument,
    model_bytes: Vec<u8>,
    /// Rendered 42010 design views, as build-relative `(path, bytes)` artifacts.
    design_views: Vec<(String, Vec<u8>)>,
    system: Option<crate::contracts::CanonicalDocument>,
    // Linked terms must be constructed, consumed and dropped on their worker.
    // Neither Prepared nor a borrowed Prepared can cross a scoped thread join.
    _worker_bound: PhantomData<Rc<()>>,
}

// Closed worker outputs never contain a linked compiler tree. System-domain
// documents are validated against the registered finite-depth closed schemas.
trait ModelWorkerOutput: Send {}
impl ModelWorkerOutput for CheckResult {}
impl ModelWorkerOutput for BuildResult {}
impl ModelWorkerOutput for bool {}
impl ModelWorkerOutput for Vec<crate::contracts::CanonicalDocument> {}

#[cfg(test)]
struct PreparedView {
    model_bytes: Vec<u8>,
    system: Option<crate::contracts::CanonicalDocument>,
}

#[cfg(test)]
impl ModelWorkerOutput for PreparedView {}

fn application_selection(
    snapshot: &lexlean::SemanticSnapshot,
) -> Result<Option<Selection>, PrismError> {
    let mut paths = BTreeSet::new();
    for module in snapshot.modules() {
        if module.declarations().iter().any(|declaration| {
            declaration.kind() == "definition"
                && declaration
                    .linked_ir()
                    .pointer("/result/member/name")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|name| name.ends_with("Application"))
                && declaration
                    .linked_ir()
                    .pointer("/body/kind")
                    .and_then(serde_json::Value::as_str)
                    == Some("record")
        }) {
            paths.insert(Utf8PathBuf::from(module.source().path()));
        }
    }
    match paths.len() {
        0 => Ok(None),
        1 => Ok(Some(Selection::Files(paths))),
        _ => Err(PrismError::new(
            "PP2001",
            "a product source graph contains multiple application roots",
        )),
    }
}

#[derive(Serialize)]
struct FileRow {
    path: String,
    kind: String,
    byte_length: u64,
    sha256: String,
}

fn utf8(path: PathBuf) -> Result<Utf8PathBuf, PrismError> {
    Utf8PathBuf::from_path_buf(path)
        .map_err(|_| PrismError::new("PP1001", "configured path is not UTF-8"))
}

fn count_entities(doc: &ModelDocument) -> Result<u64, PrismError> {
    if let Some(library) = &doc.library {
        return u64::try_from(library.export_roots.len())
            .map_err(|_| PrismError::new("PP1003", "library export count exceeds u64"));
    }
    let count = doc.architecture.components.len()
        + doc.architecture.edges.len()
        + doc.architecture.stakeholders.len()
        + doc.architecture.concerns.len()
        + doc.architecture.viewpoints.len()
        + doc.architecture.views.len()
        + doc.security.assets.len()
        + doc.security.threats.len()
        + doc.security.risks.len()
        + doc.security.controls.len()
        + doc.security.activities.len()
        + doc.security.measurements.len()
        + doc.quality.characteristics.len()
        + doc.quality.subcharacteristics.len()
        + doc.quality.requirements.len()
        + doc.quality.measures.len();
    u64::try_from(count).map_err(|_| PrismError::new("PP1003", "entity count exceeds u64"))
}

fn kind(path: &str) -> &'static str {
    if path.ends_with(".lean") {
        "lean"
    } else if path.ends_with(".tex") {
        "latex"
    } else if path.contains("/maps/") || path.starts_with("maps/") {
        "source-map"
    } else if path.contains("/coverage/") || path.starts_with("coverage/") {
        "coverage"
    } else if path.contains("/lexicons/") || path.starts_with("lexicons/") {
        "lexicon-closure"
    } else if path.ends_with("manifest.json") {
        "lexlean-manifest"
    } else if path.ends_with("snapshot.json") {
        "semantic-snapshot"
    } else if path.starts_with("cli/bin/") {
        "executable"
    } else if path == "cli/sbom.spdx.json" {
        "sbom"
    } else {
        "artifact"
    }
}

fn artifact_relative(path: &str) -> Result<&str, PrismError> {
    if path.is_empty()
        || path.contains('\\')
        || path.split('/').any(|part| matches!(part, "" | "." | ".."))
        || Path::new(path)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(PrismError::new(
            "PP4002",
            "generated artifact path is noncanonical",
        ));
    }
    Ok(path)
}

fn write_file(root: &Path, relative: &str, bytes: &[u8]) -> Result<(), PrismError> {
    artifact_relative(relative)?;
    let path = root.join(relative);
    let parent = path
        .parent()
        .ok_or_else(|| PrismError::new("PP4002", "artifact has no parent"))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", parent.display())))?;
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    if relative.starts_with("cli/bin/") {
        // Built command-line programs are published runnable.
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o755);
    }
    let mut file = options
        .open(&path)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", path.display())))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", path.display())))
}

fn verify_existing(root: &Path, files: &[(String, Vec<u8>)]) -> Result<(), PrismError> {
    for (relative, _) in files {
        artifact_relative(relative)?;
    }
    let expected_paths = files
        .iter()
        .map(|(relative, _)| relative.as_str())
        .collect::<BTreeSet<_>>();
    let mut expected_directories = BTreeSet::new();
    for relative in &expected_paths {
        let mut parent = Path::new(relative).parent();
        while let Some(path) = parent.filter(|path| !path.as_os_str().is_empty()) {
            expected_directories.insert(path.to_string_lossy().replace('\\', "/"));
            parent = path.parent();
        }
    }
    let mut observed_paths = BTreeSet::new();
    let mut observed_directories = BTreeSet::new();
    for entry in walkdir::WalkDir::new(root).min_depth(1) {
        let entry =
            entry.map_err(|error| PrismError::new("PP4002", format!("artifact walk: {error}")))?;
        if entry.file_type().is_symlink() {
            return Err(PrismError::new(
                "PP4001",
                "published artifact contains a symlink",
            ));
        }
        if entry.file_type().is_file() {
            observed_paths.insert(
                entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|_| PrismError::new("PP9001", "published artifact path escaped"))?
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        } else if entry.file_type().is_dir() {
            observed_directories.insert(
                entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|_| PrismError::new("PP9001", "published directory escaped"))?
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        } else {
            return Err(PrismError::new(
                "PP4001",
                "published artifact contains a non-file entry",
            ));
        }
    }
    if observed_paths
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>()
        != expected_paths
        || observed_directories != expected_directories
    {
        return Err(PrismError::new(
            "PP4001",
            "published artifact set differs from its manifest",
        ));
    }
    for (relative, expected) in files {
        let path = root.join(relative);
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|_| PrismError::new("PP4002", format!("missing {}", path.display())))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(PrismError::new("PP4001", "published artifact type changed"));
        }
        let observed = std::fs::read(&path)
            .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", path.display())))?;
        if &observed != expected {
            return Err(PrismError::new(
                "PP4001",
                format!("published artifact was modified: {relative}"),
            ));
        }
    }
    Ok(())
}

impl Controller {
    /// Load a project root without parsing or mutating its model.
    pub fn load(root: impl AsRef<Path>) -> Result<Self, PrismError> {
        let supplied = root.as_ref();
        if std::fs::symlink_metadata(supplied)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(PrismError::new("PP8001", "project root is a symlink"));
        }
        let root = supplied.canonicalize().map_err(|error| {
            PrismError::new("PP1002", format!("{}: {error}", supplied.display()))
        })?;
        if !root.is_dir() {
            return Err(PrismError::new("PP1002", "project root is not a directory"));
        }
        // An existing lock binds every SDK execution, not only `lock check`.
        // Empty/source projects may still load before their initial binding.
        crate::sdk::check_existing_lock(&root)?;
        Ok(Self { root })
    }

    fn prepare_release_in_worker(
        &self,
        plan: &model_worker::Plan,
        release: Option<&str>,
    ) -> Result<Prepared, PrismError> {
        model_worker::require_active(plan)?;
        plan.observe()?;
        let config = plan.config.clone();
        let engine = Engine::load(&plan.project_file);
        plan.observe()?;
        let engine = engine.map_err(|error| {
            PrismError::from_lexlean(
                "PP2001",
                "LexLean project load failed",
                error,
                config.limits.max_diagnostics,
            )
        })?;
        plan.observe()?;
        let snapshot = engine
            .snapshot(LexCheckRequest {
                selection: Selection::Entrypoints,
            })
            .map_err(|error| {
                PrismError::from_lexlean(
                    "PP2001",
                    "LexLean snapshot failed",
                    error,
                    config.limits.max_diagnostics,
                )
            })?;
        plan.observe()?;
        crate::holo::projector::validate_snapshot_envelope(&snapshot.canonical_bytes())?;
        let system = crate::system::project(&snapshot, release)?;
        if release.is_some() && system.is_none() {
            return Err(PrismError::new(
                "PP2101",
                "a release selector requires a named system release in the source graph",
            ));
        }
        let application_selection = application_selection(&snapshot)?;
        let application_snapshot = if system.is_some() {
            application_selection
                .as_ref()
                .map(|selection| {
                    plan.observe()?;
                    engine
                        .snapshot(LexCheckRequest {
                            selection: selection.clone(),
                        })
                        .map_err(|error| {
                            PrismError::from_lexlean(
                                "PP2001",
                                "application-root snapshot failed",
                                error,
                                config.limits.max_diagnostics,
                            )
                        })
                })
                .transpose()?
        } else {
            None
        };
        plan.observe()?;
        let model_snapshot = application_snapshot.as_ref().unwrap_or(&snapshot);
        // Facet records come from every entrypoint of the checked snapshot, not
        // only the application roots.
        let application_model =
            crate::holo::application::project_application_with_facets(model_snapshot, &snapshot)?;
        let library_model = crate::holo::library::project_library(&snapshot)?;
        let model = match (application_model, library_model) {
            (Some(_), Some(_)) => {
                return Err(PrismError::new(
                    "PP4004",
                    "a native library cannot also declare an application",
                ))
            }
            (_, Some(_)) if system.is_some() => {
                return Err(PrismError::new(
                    "PP4004",
                    "a native library cannot also declare a system release",
                ))
            }
            (Some(model), None) | (None, Some(model)) => model,
            (None, None) => project_snapshot(model_snapshot)?,
        };
        let model_bytes = encode_canonical(&model)?;
        let design_views = crate::design::render_snapshot(model_snapshot, &model)?;
        crate::features::check_snapshot(model_snapshot, &model)?;
        if let Some(system) = &system {
            let expected = format!("sha256:{}", content_id(&model_bytes));
            if system.value()["application_profile"]["application_model_digest"] != expected {
                return Err(PrismError::new(
                    "PP2101",
                    format!(
                        "system release binds application model {}, but the imported application model is {expected}",
                        system.value()["application_profile"]["application_model_digest"]
                    ),
                ));
            }
            if system.schema() == "prismpm/system-model/2" {
                crate::system::browser::validate_application(system.value(), &model)?;
            }
        }
        let entities = count_entities(&model)?;
        if entities > config.limits.max_entities {
            return Err(PrismError::new("PP1003", "max_entities exceeded"));
        }
        config.limits.check_holo_length(model_bytes.len())?;
        Ok(Prepared {
            config,
            engine,
            snapshot,
            application_snapshot,
            application_selection,
            model,
            model_bytes,
            design_views,
            system,
            _worker_bound: PhantomData,
        })
    }

    fn with_prepared_release<T: ModelWorkerOutput>(
        &self,
        config_path: Option<&Path>,
        release: Option<&str>,
        operation: impl FnOnce(&Prepared) -> Result<T, PrismError> + Send,
    ) -> Result<T, PrismError> {
        let plan = model_worker::Plan::load(&self.root, config_path)?;
        model_worker::run(&plan, model_worker::Kind::Model, || {
            let prepared = self.prepare_release_in_worker(&plan, release)?;
            operation(&prepared)
            // Prepared drops here, on success, error and unwind, before join.
        })
    }

    #[cfg(test)]
    fn prepare_release(
        &self,
        config_path: Option<&Path>,
        release: Option<&str>,
    ) -> Result<PreparedView, PrismError> {
        self.with_prepared_release(config_path, release, |prepared| {
            Ok(PreparedView {
                model_bytes: prepared.model_bytes.clone(),
                system: prepared.system.clone(),
            })
        })
    }

    #[cfg(test)]
    fn prepare(&self, config_path: Option<&Path>) -> Result<PreparedView, PrismError> {
        self.prepare_release(config_path, None)
    }

    pub(crate) fn production_systems(
        &self,
    ) -> Result<Vec<crate::contracts::CanonicalDocument>, PrismError> {
        self.with_prepared_release(None, None, |prepared| {
            let systems = crate::system::project_all(&prepared.snapshot)?;
            for system in &systems {
                let expected = format!("sha256:{}", content_id(&prepared.model_bytes));
                if system.value()["application_profile"]["application_model_digest"] != expected {
                    return Err(PrismError::new(
                        "PP2101",
                        "a named system release does not bind the selected application model",
                    ));
                }
            }
            Ok(systems)
        })
    }

    /// Check through LexLean snapshot, Holo projection, and validation in memory.
    pub fn check(&self, request: CheckRequest) -> Result<CheckResult, PrismError> {
        self.with_prepared_release(request.config_path.as_deref(), None, |prepared| {
            Ok(CheckResult {
                schema: "prismpm/check-result/1".to_owned(),
                semantic_id: prepared.snapshot.semantic_id().to_string(),
                snapshot_id: prepared.snapshot.snapshot_id().to_string(),
                model_id: content_id(&prepared.model_bytes),
                entity_count: count_entities(&prepared.model)?,
            })
        })
    }

    /// Replay release integrity and atomically export unchanged browser bytes.
    ///
    /// This does not load application source, execute artifacts, acquire inputs,
    /// authorize publication, or establish operational product acceptance.
    pub fn export_browser(
        &self,
        request: ExportBrowserRequest,
    ) -> Result<serde_json::Value, PrismError> {
        crate::oci::export_browser(&self.root, &request.reference, &request.output)
    }

    /// Compare the complete reverified browser closure at one explicit HTTPS target.
    pub fn verify_browser_publication(
        &self,
        request: VerifyBrowserPublicationRequest,
    ) -> Result<serde_json::Value, PrismError> {
        crate::oci::verify_browser_publication(&self.root, &request.reference, &request.url)
    }

    /// Build LexLean artifacts and atomically publish the fixed Prism artifact set.
    pub fn build(&self, request: BuildRequest) -> Result<BuildResult, PrismError> {
        self.build_release(request, None)
    }

    /// Build one named system release while retaining the same closed source graph.
    pub fn build_release(
        &self,
        request: BuildRequest,
        release: Option<&str>,
    ) -> Result<BuildResult, PrismError> {
        self.build_release_with_owner(request, release, None)
    }

    pub(crate) fn build_release_with_owner(
        &self,
        request: BuildRequest,
        release: Option<&str>,
        exporter_owner: Option<&mut crate::exporter::VerifyExporterOwner>,
    ) -> Result<BuildResult, PrismError> {
        self.with_prepared_release(request.config_path.as_deref(), release, |prepared| {
            self.build_prepared(prepared, exporter_owner)
        })
    }

    fn build_prepared(
        &self,
        prepared: &Prepared,
        mut exporter_owner: Option<&mut crate::exporter::VerifyExporterOwner>,
    ) -> Result<BuildResult, PrismError> {
        if let Some(application) = &prepared.model.application {
            crate::holo::browser_application::require_runtime(application)?;
        }
        let lex = prepared
            .engine
            .build(LexBuildRequest {
                selection: Selection::Entrypoints,
            })
            .map_err(|error| {
                PrismError::from_lexlean(
                    "PP4002",
                    "LexLean build failed",
                    error,
                    prepared.config.limits.max_diagnostics,
                )
            })?;
        let lex_build_id = lex
            .build_id
            .ok_or_else(|| PrismError::new("PP9001", "LexLean build omitted its identity"))?
            .to_string();
        let output_root = prepared.config.output_root(&self.root)?;
        let lex_root = self.root.join(".lexlean/build").join(&lex_build_id);
        let lex_manifest_path = lex_root.join("manifest.json");
        let lex_manifest_bytes = std::fs::read(&lex_manifest_path).map_err(|error| {
            PrismError::new(
                "PP4002",
                format!("{}: {error}", lex_manifest_path.display()),
            )
        })?;
        let lex_manifest: serde_json::Value = serde_json::from_slice(&lex_manifest_bytes)
            .map_err(|error| PrismError::new("PP4002", format!("LexLean manifest: {error}")))?;
        let outputs = lex_manifest
            .get("outputs")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| PrismError::new("PP4002", "LexLean manifest has no output list"))?;
        let mut lex_paths = BTreeSet::new();
        for output in outputs {
            let path = output
                .get("path")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| PrismError::new("PP4002", "LexLean output has no path"))?;
            artifact_relative(path)?;
            if !lex_paths.insert(path.to_owned()) {
                return Err(PrismError::new(
                    "PP4002",
                    "LexLean manifest contains a duplicate artifact path",
                ));
            }
        }
        lex_paths.insert("manifest.json".to_owned());

        let mut artifacts = vec![
            ("model.prism.json".to_owned(), prepared.model_bytes.clone()),
            (
                "lexlean/snapshot.json".to_owned(),
                prepared.snapshot.canonical_bytes(),
            ),
        ];
        for path in lex_paths {
            let source = lex_root.join(&path);
            let metadata = std::fs::symlink_metadata(&source).map_err(|error| {
                PrismError::new("PP4002", format!("{}: {error}", source.display()))
            })?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(PrismError::new("PP4002", "LexLean artifact is not a file"));
            }
            artifacts.push((
                format!("lexlean/build/{path}"),
                std::fs::read(&source).map_err(|error| {
                    PrismError::new("PP4002", format!("{}: {error}", source.display()))
                })?,
            ));
        }
        if prepared.model.application.is_some() {
            let application_build = prepared
                .application_selection
                .as_ref()
                .map(|selection| {
                    prepared
                        .engine
                        .build(LexBuildRequest {
                            selection: selection.clone(),
                        })
                        .map_err(|error| {
                            PrismError::from_lexlean(
                                "PP4002",
                                "application-root LexLean build failed",
                                error,
                                prepared.config.limits.max_diagnostics,
                            )
                        })
                })
                .transpose()?;
            let application_build_id = application_build
                .as_ref()
                .and_then(|result| result.build_id)
                .map_or_else(|| lex_build_id.clone(), |id| id.to_string());
            let application_lex_root = self.root.join(".lexlean/build").join(&application_build_id);
            let application_lex_manifest =
                std::fs::read(application_lex_root.join("manifest.json")).map_err(|error| {
                    PrismError::new("PP4002", format!("application LexLean manifest: {error}"))
                })?;
            artifacts.push((
                "application/lexlean-snapshot.json".to_owned(),
                prepared
                    .application_snapshot
                    .as_ref()
                    .unwrap_or(&prepared.snapshot)
                    .canonical_bytes(),
            ));
            artifacts.push((
                "application/lexlean-build-manifest.json".to_owned(),
                application_lex_manifest.clone(),
            ));
            let selected_manifest: serde_json::Value =
                serde_json::from_slice(&application_lex_manifest).map_err(|error| {
                    PrismError::new("PP4002", format!("application LexLean manifest: {error}"))
                })?;
            let mut selected_paths = BTreeSet::new();
            for output in selected_manifest["outputs"].as_array().ok_or_else(|| {
                PrismError::new("PP4002", "application LexLean outputs are absent")
            })? {
                let path = output["path"].as_str().ok_or_else(|| {
                    PrismError::new("PP4002", "application LexLean output path is absent")
                })?;
                artifact_relative(path)?;
                if !selected_paths.insert(path) {
                    return Err(PrismError::new(
                        "PP4002",
                        "application LexLean output path is duplicated",
                    ));
                }
                let source = application_lex_root.join(path);
                let metadata = std::fs::symlink_metadata(&source)
                    .map_err(|error| PrismError::new("PP4002", error.to_string()))?;
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err(PrismError::new(
                        "PP4002",
                        "application LexLean output is not a regular file",
                    ));
                }
                artifacts.push((
                    format!("application/lexlean-build/{path}"),
                    std::fs::read(source)
                        .map_err(|error| PrismError::new("PP4002", error.to_string()))?,
                ));
            }
            let application_artifacts = match exporter_owner.as_deref_mut() {
                Some(owner) => {
                    crate::application_build::generate_owned(
                        &self.root,
                        &prepared.model,
                        &prepared.model_bytes,
                        &application_lex_root,
                        &application_lex_manifest,
                        owner,
                        crate::exporter::Phase::ControllerBuild,
                    )?
                    .artifacts
                }
                None => crate::application_build::generate(
                    &self.root,
                    &prepared.model,
                    &prepared.model_bytes,
                    &application_lex_root,
                    &application_lex_manifest,
                )?,
            };
            for (path, bytes) in &application_artifacts {
                if path.ends_with(".holo") {
                    prepared.config.limits.check_holo_length(bytes.len())?;
                }
            }
            artifacts.extend(application_artifacts);
        }
        if prepared.model.library.is_some() {
            artifacts.extend(match exporter_owner {
                Some(owner) => {
                    crate::library_build::generate_owned(
                        &self.root,
                        &prepared.model,
                        &prepared.model_bytes,
                        &lex_root,
                        &lex_manifest_bytes,
                        owner,
                        crate::exporter::Phase::ControllerBuild,
                    )?
                    .artifacts
                }
                None => crate::library_build::generate(
                    &self.root,
                    &prepared.model,
                    &prepared.model_bytes,
                    &lex_root,
                    &lex_manifest_bytes,
                )?,
            });
        }
        artifacts.extend(prepared.design_views.iter().cloned());
        if let Some(system) = &prepared.system {
            artifacts.push(("system.prism.json".to_owned(), system.bytes().to_vec()));
            for projection in crate::system::projections(system, &artifacts)? {
                artifacts.push((projection.path, projection.bytes));
            }
        }
        artifacts.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
        for (path, _) in &artifacts {
            artifact_relative(path)?;
        }
        let model_id = content_id(&prepared.model_bytes);
        let dependency_digest = format!(
            "{:x}",
            Sha256::digest(include_bytes!("../../model/dependencies.toml"))
        );
        let mut inputs = json!({
            "application_generator_sha256": format!("{:x}", Sha256::digest([
                include_bytes!("../application_build.rs").as_slice(),
                include_bytes!("../lean_project.rs").as_slice(),
                include_bytes!("../holo/archive.rs").as_slice(),
                include_bytes!("../embedded/lean4-prod-rust.MANIFEST.sha256").as_slice(),
                b"prismpm/build-artifacts/2".as_slice()
            ].concat())),
            "dependency_register_sha256": dependency_digest,
            "emitter_semantics_id": prepared.model.provenance.emitter_semantics_id,
            "model_id": model_id,
            "system_id": prepared.system.as_ref().map(crate::contracts::CanonicalDocument::digest),
            "lexlean_build_id": lex_build_id,
            "lexlean_semantic_id": prepared.snapshot.semantic_id().to_string(),
            "lexlean_source_id": prepared.snapshot.source_id().to_string(),
            "schema": "prismpm/build-inputs/1"
        });
        let rows: Vec<FileRow> = artifacts
            .iter()
            .map(|(path, bytes)| FileRow {
                path: path.clone(),
                kind: kind(path).to_owned(),
                byte_length: bytes.len() as u64,
                sha256: format!("{:x}", Sha256::digest(bytes)),
            })
            .collect();
        if prepared.model.application.is_some() {
            // Source hashes alone omit embedded dependency changes. Bind the
            // complete generated closure before selecting a publication path;
            // manifest.json is excluded because it contains this identity.
            inputs["application_artifacts_sha256"] =
                json!(content_id(&encode_value(&json!(rows))?));
            inputs["schema"] = json!("prismpm/build-inputs/2");
        }
        if prepared.model.library.is_some() {
            inputs["library_artifacts_sha256"] = json!(content_id(&encode_value(&json!(rows))?));
            inputs["library_generator_sha256"] = json!(library_generator_identity());
            inputs["schema"] = json!("prismpm/build-inputs/3");
        }
        let build_id = content_id(&encode_value(&inputs)?);
        let manifest_value = serde_json::to_value(json!({
            "files": rows,
            "inputs": inputs,
            "schema": "prismpm/build-manifest/1"
        }))
        .map_err(|error| PrismError::new("PP9001", error.to_string()))?;
        let manifest_bytes = encode_value(&manifest_value)?;
        artifacts.push(("manifest.json".to_owned(), manifest_bytes));

        std::fs::create_dir_all(&output_root).map_err(|error| {
            PrismError::new("PP4002", format!("{}: {error}", output_root.display()))
        })?;
        if std::fs::symlink_metadata(&output_root)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(PrismError::new("PP8001", "output root is a symlink"));
        }
        let lock_path = output_root.join(".prismpm.lock");
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&lock_path)
            .map_err(|error| {
                PrismError::new("PP4002", format!("{}: {error}", lock_path.display()))
            })?;
        lock.lock_exclusive()
            .map_err(|error| PrismError::new("PP4002", format!("publish lock: {error}")))?;
        let build_parent = output_root.join("build");
        std::fs::create_dir_all(&build_parent).map_err(|error| {
            PrismError::new("PP4002", format!("{}: {error}", build_parent.display()))
        })?;
        let destination = build_parent.join(&build_id);
        if destination.exists() {
            verify_existing(&destination, &artifacts)?;
        } else {
            let staging_parent = output_root.join(".staging");
            std::fs::create_dir_all(&staging_parent).map_err(|error| {
                PrismError::new("PP4002", format!("{}: {error}", staging_parent.display()))
            })?;
            let staging = tempfile::Builder::new()
                .prefix("build-")
                .tempdir_in(&staging_parent)
                .map_err(|error| PrismError::new("PP4002", format!("staging: {error}")))?;
            for (path, bytes) in &artifacts {
                write_file(staging.path(), path, bytes)?;
            }
            File::open(staging.path())
                .and_then(|file| file.sync_all())
                .map_err(|error| PrismError::new("PP4002", format!("staging fsync: {error}")))?;
            std::fs::rename(staging.path(), &destination)
                .map_err(|error| PrismError::new("PP4002", format!("publish rename: {error}")))?;
            File::open(&build_parent)
                .and_then(|file| file.sync_all())
                .map_err(|error| PrismError::new("PP4002", format!("build fsync: {error}")))?;
        }
        drop(lock);
        Ok(BuildResult {
            schema: "prismpm/build-result/1".to_owned(),
            build_id: build_id.clone(),
            source_id: prepared.snapshot.source_id().to_string(),
            semantic_id: prepared.snapshot.semantic_id().to_string(),
            model_path: format!(
                "{}/build/{build_id}/model.prism.json",
                prepared.config.build_root
            ),
            manifest_path: format!(
                "{}/build/{build_id}/manifest.json",
                prepared.config.build_root
            ),
        })
    }

    pub(crate) fn check_model_configuration(
        &self,
        config_path: Option<&Path>,
    ) -> Result<(), PrismError> {
        model_worker::require_current_selection(&self.root, config_path)
    }

    /// Verify the source/tool chain and assemble the accepted build as one OCI graph.
    pub fn product_build(
        &self,
        request: ProductBuildRequest,
    ) -> Result<crate::oci::ProductBuildResult, PrismError> {
        if !request.locked {
            return Err(PrismError::new(
                "PP1101",
                "product release construction requires --locked",
            ));
        }
        if self.with_prepared_release(
            request.config_path.as_deref(),
            request.release.as_deref(),
            |prepared| Ok(prepared.model.library.is_some()),
        )? {
            return Err(PrismError::new(
                "PP6101",
                "native-library acceptance is not product-release or deployment acceptance",
            ));
        }
        crate::authority::resolve(&self.root, true)?;
        crate::authority::verify(&self.root)?;
        let config_path = request.config_path;
        let verified = self.verify_release(
            VerifyRequest {
                config_path: config_path.clone(),
            },
            request.release.as_deref(),
        )?;
        let selected = self.build_release(
            BuildRequest {
                config_path: config_path.clone(),
            },
            request.release.as_deref(),
        )?;
        require_verified_build(&verified, &selected)?;
        let validations = if self.with_prepared_release(
            config_path.as_deref(),
            request.release.as_deref(),
            |prepared| Ok(prepared.system.is_some()),
        )? {
            crate::deployment::validate_build(&self.root, &selected.build_id)?
        } else {
            Vec::new()
        };
        crate::oci::assemble(
            &self.root,
            &selected,
            &verified,
            &request.reference,
            &validations,
        )
    }

    /// Remove only the configured real Prism output directory.
    pub fn clean(&self, request: CleanRequest) -> Result<CleanResult, PrismError> {
        let (config, _) = ProjectConfig::load(&self.root, request.config_path.as_deref())?;
        let output = config.output_root(&self.root)?;
        if let Ok(metadata) = std::fs::symlink_metadata(&output) {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(PrismError::new(
                    "PP8001",
                    "configured output root is not a real directory",
                ));
            }
            std::fs::remove_dir_all(&output).map_err(|error| {
                PrismError::new("PP4002", format!("clean {}: {error}", output.display()))
            })?;
        }
        Ok(CleanResult {
            schema: "prismpm/clean-result/1".to_owned(),
            removed: config.build_root,
        })
    }

    /// Run the complete verified Lean-to-LCNF-to-Rust execution chain.
    pub fn verify(&self, request: VerifyRequest) -> Result<VerifyResult, PrismError> {
        self.verify_release(request, None)
    }

    fn verify_release(
        &self,
        request: VerifyRequest,
        release: Option<&str>,
    ) -> Result<VerifyResult, PrismError> {
        ensure_verification_not_active()?;
        let plan = model_worker::Plan::load(&self.root, request.config_path.as_deref())?;
        model_worker::run(&plan, model_worker::Kind::Verification, move || {
            let _guard = VerifyWorkerGuard::enter()?;
            crate::verification::run(self, request, release)
        })
    }
}

#[cfg(test)]
mod release_tests;

#[cfg(test)]
mod tests {
    #[test]
    fn library_generator_binds_each_actual_cold_owner_source_without_hash_overrides() {
        let paths = [
            "library_build.rs",
            "lean_project.rs",
            "exporter.rs",
            "exporter/owner.rs",
            "exporter/custody.rs",
            "exporter/directory.rs",
            "sdk/exporter-seed-admission.mjs",
            "sdk/exporter-seed.mjs",
            "sdk/inventory-metadata.mjs",
        ];
        let parts = [
            include_bytes!("../library_build.rs").as_slice(),
            include_bytes!("../lean_project.rs").as_slice(),
            include_bytes!("../exporter.rs").as_slice(),
            include_bytes!("../exporter/owner.rs").as_slice(),
            include_bytes!("../exporter/custody.rs").as_slice(),
            include_bytes!("../exporter/directory.rs").as_slice(),
            include_bytes!("../../sdk/exporter-seed-admission.mjs").as_slice(),
            include_bytes!("../../sdk/exporter-seed.mjs").as_slice(),
            include_bytes!("../../sdk/inventory-metadata.mjs").as_slice(),
        ];
        let encode = |parts: &[Vec<u8>], paths: &[&str]| {
            let mut bytes = b"prismpm/library-generator/2\0".to_vec();
            for (path, part) in paths.iter().zip(parts) {
                bytes.extend_from_slice(path.as_bytes());
                bytes.push(0);
                bytes.extend_from_slice(&(part.len() as u64).to_be_bytes());
                bytes.extend_from_slice(part);
            }
            super::content_id(&bytes)
        };
        let originals = parts.map(<[u8]>::to_vec);
        let actual = super::library_generator_identity();
        assert_eq!(actual, encode(&originals, &paths));
        for index in 0..parts.len() {
            let mut changed = originals.clone();
            changed[index].push(0);
            assert_ne!(actual, encode(&changed, &paths));
            let omitted = originals
                .iter()
                .enumerate()
                .filter(|(at, _)| *at != index)
                .map(|(_, part)| part.clone())
                .collect::<Vec<_>>();
            let omitted_paths = paths
                .iter()
                .enumerate()
                .filter(|(at, _)| *at != index)
                .map(|(_, path)| *path)
                .collect::<Vec<_>>();
            assert_ne!(actual, encode(&omitted, &omitted_paths));
        }
        let mut renamed = paths;
        renamed[0] = "other-library-build.rs";
        assert_ne!(actual, encode(&originals, &renamed));
        let mut redistributed = originals.clone();
        let byte = redistributed[0].pop().unwrap();
        redistributed[1].insert(0, byte);
        assert_eq!(originals.concat(), redistributed.concat());
        assert_ne!(actual, encode(&redistributed, &paths));
    }

    #[test]
    fn execution_boundary_rejects_wrong_native_inventory() {
        crate::sdk::execution_binding_regression(
            "controller::tests::execution_boundary_rejects_wrong_native_inventory",
            |root| super::Controller::load(root).map(|_| ()),
        );
    }

    #[test]
    fn artifact_publication_retains_nested_paths_and_rejects_overwrite() {
        let temporary = tempfile::tempdir().unwrap();
        super::write_file(temporary.path(), "nested/app.holo", b"original").unwrap();
        assert!(super::write_file(temporary.path(), "nested/app.holo", b"changed").is_err());
        assert_eq!(
            std::fs::read(temporary.path().join("nested/app.holo")).unwrap(),
            b"original"
        );
    }

    #[test]
    fn artifact_publication_rejects_escape_before_creating_files() {
        for relative in [
            "../escape.holo",
            "nested/../../escape.holo",
            "./app.holo",
            "nested//app.holo",
        ] {
            let temporary = tempfile::tempdir().unwrap();
            let staging = temporary.path().join("staging");
            std::fs::create_dir(&staging).unwrap();
            assert!(
                super::write_file(&staging, relative, b"test artifact").is_err(),
                "{relative}"
            );
            assert_eq!(std::fs::read_dir(&staging).unwrap().count(), 0);
            assert!(!temporary.path().join("escape.holo").exists());
        }
        let temporary = tempfile::tempdir().unwrap();
        let staging = temporary.path().join("staging");
        std::fs::create_dir(&staging).unwrap();
        let absolute = temporary.path().join("absolute.holo");
        assert!(super::write_file(&staging, absolute.to_str().unwrap(), b"test artifact").is_err());
        assert!(!absolute.exists());
    }

    use super::{ensure_verification_not_active, VerifyWorkerGuard};

    #[test]
    fn verification_worker_rejects_reentrant_entry_and_resets() {
        let guard = VerifyWorkerGuard::enter().expect("first worker entry");
        let error = match ensure_verification_not_active() {
            Ok(_) => panic!("recursive worker entry must fail"),
            Err(error) => error,
        };
        assert_eq!(error.code.as_str(), "PP5008");
        drop(guard);
        VerifyWorkerGuard::enter().expect("worker state resets when its guard is dropped");
    }

    #[test]
    fn verification_worker_state_is_thread_local() {
        let guard = VerifyWorkerGuard::enter().expect("caller worker entry");
        std::thread::spawn(|| VerifyWorkerGuard::enter().expect("independent worker entry"))
            .join()
            .expect("independent worker did not panic");
        drop(guard);
    }

    #[test]
    fn prepared_cannot_escape_or_be_shared_across_worker_join() {
        // If either Prepared or &Prepared ever becomes Send, inference becomes
        // ambiguous and this compile-time property test fails to compile.
        trait AmbiguousIfSend<A> {
            fn check() {}
        }
        impl<T: ?Sized> AmbiguousIfSend<()> for T {}
        struct SendMarker;
        impl<T: ?Sized + Send> AmbiguousIfSend<SendMarker> for T {}
        let _ = <super::Prepared as AmbiguousIfSend<_>>::check;
        let _ = <&super::Prepared as AmbiguousIfSend<_>>::check;
    }
}
