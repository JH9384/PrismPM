//! Invocation-local exporter custody. Never an authority-bearing caller cache.

use super::{custody, ExecutableMeasurement};
use crate::verification::ProcessRecord;
use crate::PrismError;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    ControllerBuild,
    Replay,
}

impl Phase {
    fn name(self) -> &'static str {
        match self {
            Self::ControllerBuild => "controller-build",
            Self::Replay => "replay",
        }
    }
}

pub(crate) trait ProductEvidence {
    fn role(&self) -> &'static str;
    fn artifacts(&self) -> &[(String, Vec<u8>)];
    fn processes(&self) -> &[ProcessRecord];
}

/// Owner-created original custody carried through generated-module work to
/// the actual exporter build boundary. Not a caller-produced cache handle.
pub(crate) struct GenerationContext<'a> {
    receipt: &'a Value,
    snapshot: &'a custody::Snapshot,
    first: bool,
    built: std::cell::RefCell<Option<custody::Snapshot>>,
    package: &'a Path,
    namespace: &'a super::directory::Directory,
    directory: std::cell::RefCell<&'a mut super::directory::Directory>,
    library: std::cell::RefCell<LibraryGeneration>,
}

struct LibraryGeneration {
    required: bool,
    commands: usize,
    workspace: Option<PathBuf>,
    previous_workspace: Option<PathBuf>,
    snapshot: custody::Snapshot,
    build_authorized: bool,
}

impl GenerationContext<'_> {
    pub(crate) fn receipt(&self) -> &Value {
        self.receipt
    }
    pub(crate) fn before_build(&self, project: &Path, package: &Path) -> Result<(), PrismError> {
        let checked = if self.first {
            super::before_first_build(project, package, self.receipt, self.snapshot)
        } else if custody::capture(package)? == *self.snapshot {
            Ok(())
        } else {
            Err(failure(
                "private exporter custody changed before phased build",
            ))
        };
        checked?;
        self.library.borrow_mut().build_authorized = true;
        Ok(())
    }
    pub(crate) fn after_build(&self, package: &Path) -> Result<custody::Snapshot, PrismError> {
        if self.built.borrow().is_some() {
            return Err(failure(
                "private exporter build custody cannot be recaptured",
            ));
        }
        let after = custody::capture(package)?;
        let unchanged = if self.first && *self.receipt == super::cold_acquisition() {
            self.snapshot.same_source(&after)
        } else {
            self.snapshot.same_compiler(&after)
        };
        if !unchanged {
            return Err(failure(
                "private exporter custody changed during phased build",
            ));
        }
        *self.built.borrow_mut() = Some(after.clone());
        Ok(after)
    }

    /// One invocation-local owner guards the four actual library commands;
    /// authenticated SDK acquisition and exporter execution evidence stay in
    /// the same generic owner used by the other generated products.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn run_library(
        &self,
        tool: &str,
        program: &Path,
        args: &[String],
        cwd: &Path,
        environment: &BTreeMap<String, String>,
        replacements: &[(&Path, &str)],
        code: &'static str,
    ) -> Result<ProcessRecord, PrismError> {
        let mut state = self.library.borrow_mut();
        let expected = [
            "lake-build-generated",
            "lean4-prod-build",
            "prod-export",
            "native-library-package",
        ];
        if !state.required || state.commands >= expected.len() || tool != expected[state.commands] {
            return Err(failure("original library command order required"));
        }
        if state.commands == 0 {
            if args != ["build", "PrismGenerated"] || !environment.is_empty()
                || cwd.canonicalize().ok().as_deref() != Some(cwd)
                || state.previous_workspace.as_deref() == Some(cwd)
                || [".lake", "export", "package"].iter().any(|name| {
                    !matches!(std::fs::symlink_metadata(cwd.join(name)), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
                })
            {
                return Err(failure("fresh independent generated library workspace required"));
            }
            state.workspace = Some(cwd.to_owned());
        }
        let workspace = state
            .workspace
            .as_deref()
            .expect("first actual command binds workspace");
        let valid = match state.commands {
            0 => cwd == workspace,
            1 => {
                state.build_authorized
                    && cwd == self.package
                    && args == ["build", "prod-export"]
                    && environment.is_empty()
            }
            2 => {
                cwd == self.package
                    && args.starts_with(&["exe".to_owned(), "prod-export".to_owned()])
                    && environment
                        == &BTreeMap::from([(
                            "LEAN_PATH".to_owned(),
                            workspace
                                .join(".lake/build/lib/lean")
                                .to_string_lossy()
                                .into_owned(),
                        )])
            }
            3 => {
                cwd == workspace.join("package")
                    && args == ["package", "--locked", "--offline", "--allow-dirty"]
                    && environment
                        == &BTreeMap::from([
                            (
                                "CARGO_HOME".to_owned(),
                                workspace.join("cargo-home").to_string_lossy().into_owned(),
                            ),
                            ("CARGO_NET_OFFLINE".to_owned(), "true".to_owned()),
                        ])
            }
            _ => false,
        };
        if !valid {
            return Err(failure("original library command/cwd/environment differs"));
        }
        self.directory.borrow().ready()?;
        self.namespace.ready()?;
        let before = custody::capture_optional(self.package)?;
        if before != state.snapshot {
            return Err(failure("exporter changed before actual command"));
        }
        let program_before = custody::capture_launcher(program)?;
        let directory = custody::Cwd::open(cwd)?;
        let result = if state.commands == 2 {
            let built = self.built.borrow();
            let expected = built
                .as_ref()
                .ok_or_else(|| failure("original library build custody absent"))?;
            super::run_export_with_custody(
                tool,
                program,
                args,
                cwd,
                environment,
                replacements,
                code,
                self.receipt,
                expected,
            )
        } else {
            crate::verification::run_process(
                tool,
                program,
                args,
                cwd,
                environment,
                replacements,
                code,
            )
        };
        // A failed command is not an exemption from native/source custody.
        let checked: Result<(), PrismError> = (|| {
            directory.verify()?;
            if custody::capture_launcher(program)? != program_before {
                return Err(failure("actual library launcher changed during command"));
            }
            self.directory.borrow().ready()?;
            self.namespace.ready()?;
            let after = custody::capture_optional(self.package)?;
            let unchanged = if state.commands == 1 {
                if self.first && *self.receipt == super::cold_acquisition() {
                    before.same_source(&after)
                } else {
                    before.same_compiler(&after)
                }
            } else {
                before == after
            };
            if !unchanged {
                return Err(failure(
                    "exporter source/runtime changed during actual command",
                ));
            }
            if state.commands >= 1 && result.is_ok() {
                custody::require_executable(self.package)?;
            }
            self.directory
                .borrow_mut()
                .bind_package(self.package, &after)?;
            state.snapshot = after;
            Ok(())
        })();
        match (result, checked) {
            (Err(mut original), Err(custody)) => {
                original.message.push_str(&format!(
                    "; exporter custody also failed: {}",
                    custody.message
                ));
                Err(original)
            }
            (Err(original), _) => Err(original),
            (Ok(_), Err(custody)) => Err(custody),
            (Ok(record), Ok(())) => {
                state.commands += 1;
                Ok(record)
            }
        }
    }
}

struct Package {
    namespace: Option<super::directory::Directory>,
    directory: super::directory::Directory,
    path: PathBuf,
    project: PathBuf,
    inventory: Option<String>,
    lock_authority: Option<String>,
    acquisition: Value,
    snapshot: Option<custody::Snapshot>,
    executable: Option<ExecutableMeasurement>,
}

impl Package {
    fn retire(self) -> Result<(), PrismError> {
        let check = || {
            self.namespace
                .as_ref()
                .ok_or_else(|| failure("private exporter namespace absent"))?
                .ready()?;
            if self.snapshot.as_ref() != Some(&custody::capture(&self.path)?) {
                return Err(failure(
                    "private exporter custody changed before retirement",
                ));
            }
            if crate::sdk::exporter_seed_inventory(&self.project)? != self.inventory {
                return Err(failure(
                    "private exporter inventory authority changed before retirement",
                ));
            }
            if crate::sdk::exporter_lock_authority(&self.project)? != self.lock_authority {
                return Err(failure(
                    "private exporter consumer lock authority changed before retirement",
                ));
            }
            Ok(())
        };
        check().inspect_err(|_| self.directory.scope().uncertain())?;
        // This non-retiring guard is checked before the owned parent is removed.
        drop(self.namespace);
        self.directory
            .close()
            .map_err(|error| failure(&format!("private exporter retirement: {error}")))
    }
}

/// Constructed inside a verification worker and passed only through private
/// APIs. The owner cannot be cloned, shared, selected by a caller, or persisted.
#[derive(Default)]
pub(crate) struct VerifyExporterOwner {
    package: Option<Package>,
    phases: Vec<Value>,
    poisoned: bool,
    project: Option<PathBuf>,
    project_identity: Option<custody::Cwd>,
    inputs: Option<(String, String)>,
    workspace: Option<PathBuf>,
}

fn failure(message: &str) -> PrismError {
    PrismError::new("PP5008", message)
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

impl VerifyExporterOwner {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn generate<T: ProductEvidence>(
        &mut self,
        project: &Path,
        phase: Phase,
        model: &[u8],
        lex_manifest: &[u8],
        generation: impl FnOnce(&Path, &GenerationContext<'_>) -> Result<T, PrismError>,
    ) -> Result<T, PrismError> {
        self.generate_for(project, phase, model, lex_manifest, false, generation)
    }

    pub(crate) fn generate_library<T: ProductEvidence>(
        &mut self,
        project: &Path,
        phase: Phase,
        model: &[u8],
        lex_manifest: &[u8],
        generation: impl FnOnce(&Path, &GenerationContext<'_>) -> Result<T, PrismError>,
    ) -> Result<T, PrismError> {
        self.generate_for(project, phase, model, lex_manifest, true, generation)
    }

    #[allow(clippy::too_many_arguments)]
    fn generate_for<T: ProductEvidence>(
        &mut self,
        project: &Path,
        phase: Phase,
        model: &[u8],
        lex_manifest: &[u8],
        library_required: bool,
        generation: impl FnOnce(&Path, &GenerationContext<'_>) -> Result<T, PrismError>,
    ) -> Result<T, PrismError> {
        if !cfg!(all(
            target_os = "linux",
            any(target_arch = "x86_64", target_arch = "aarch64")
        )) {
            self.abort()?;
            return Err(failure(
                "private exporter custody requires a qualified native Linux SDK platform",
            ));
        }
        if self.poisoned
            || !matches!(
                (self.phases.len(), phase),
                (0, Phase::ControllerBuild) | (1, Phase::Replay)
            )
        {
            self.poisoned = true;
            self.abort()?;
            return Err(failure(
                "private exporter phase is repeated, reordered, or failed",
            ));
        }
        // Poison first: every error, including an unwind, prevents reuse.
        self.poisoned = true;
        let result = self.generate_inner(
            project,
            phase,
            model,
            lex_manifest,
            library_required,
            generation,
        );
        if result.is_err() {
            if let Err(mut cleanup) = self.abort() {
                cleanup.message.push_str(&format!(
                    "; original failure: {}",
                    result.as_ref().err().expect("failed generation").message
                ));
                return Err(cleanup);
            }
        }
        result
    }

    fn abort(&mut self) -> Result<(), PrismError> {
        self.poisoned = true;
        self.phases.clear();
        if let Some(package) = self.package.take() {
            if let Some(namespace) = &package.namespace {
                namespace.ready()?;
            }
            drop(package.namespace);
            package.directory.close().map_err(|error| {
                failure(&format!("failed private exporter retirement: {error}"))
            })?;
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn generate_inner<T: ProductEvidence>(
        &mut self,
        project: &Path,
        phase: Phase,
        model: &[u8],
        lex_manifest: &[u8],
        library_required: bool,
        generation: impl FnOnce(&Path, &GenerationContext<'_>) -> Result<T, PrismError>,
    ) -> Result<T, PrismError> {
        let project = project
            .canonicalize()
            .map_err(|_| failure("private exporter project is unavailable"))?;
        if let Some(original) = &self.project_identity {
            original.verify()?;
        }
        let inputs = (digest(model), digest(lex_manifest));
        if self.project.as_ref().is_some_and(|prior| prior != &project)
            || self.inputs.as_ref().is_some_and(|prior| prior != &inputs)
        {
            return Err(failure(
                "private exporter project or generation inputs changed",
            ));
        }
        if phase == Phase::Replay && self.package.is_none() {
            return Err(failure("original private exporter absent before replay"));
        }
        let inventory = crate::sdk::exporter_seed_inventory(&project)?;
        let lock_authority = crate::sdk::exporter_lock_authority(&project)?;
        if self.package.is_none() {
            self.project_identity = Some(custody::Cwd::open(&project)?);
            self.project = Some(project.clone());
            self.inputs = Some(inputs);
            let directory = super::directory::Directory::temporary(
                "prismpm-verify-exporter-",
                None,
                Default::default(),
            )?;
            let path = directory.path().join("lean4-prod");
            self.package = Some(Package {
                namespace: None,
                directory,
                path,
                project: project.clone(),
                inventory: inventory.clone(),
                lock_authority: lock_authority.clone(),
                acquisition: Value::Null,
                snapshot: None,
                executable: None,
            });
            let package = self
                .package
                .as_mut()
                .expect("private owner established before acquisition");
            let acquisition =
                super::acquire_for_owned(&project, &package.path, package.directory.scope())?;
            package.namespace = Some(super::directory::Directory::existing(
                &package.path,
                package.directory.scope(),
            )?);
            package
                .directory
                .bind_package(&package.path, &acquisition.snapshot)?;
            package.acquisition = acquisition.receipt;
            package.snapshot = Some(acquisition.snapshot);
        }
        let package = self.package.as_mut().expect("private package established");
        package.directory.ready()?;
        package
            .namespace
            .as_ref()
            .expect("acquired namespace")
            .ready()?;
        if package.project != project
            || package.inventory != inventory
            || package.lock_authority != lock_authority
        {
            return Err(failure(
                "private exporter source or inventory authority changed",
            ));
        }
        if let Some(snapshot) = &package.snapshot {
            if self.phases.is_empty() {
                super::before_first_build(&project, &package.path, &package.acquisition, snapshot)?;
            } else if &custody::capture(&package.path)? != snapshot {
                return Err(failure("private exporter custody changed between phases"));
            }
        }
        // Each generator still builds its fresh generated-module workspace,
        // executes real `lake build prod-export`, and performs its actual export.
        let context = GenerationContext {
            receipt: &package.acquisition,
            snapshot: package
                .snapshot
                .as_ref()
                .expect("original acquisition custody"),
            first: self.phases.is_empty(),
            built: Default::default(),
            package: &package.path,
            namespace: package.namespace.as_ref().expect("original namespace"),
            directory: std::cell::RefCell::new(&mut package.directory),
            library: std::cell::RefCell::new(LibraryGeneration {
                required: library_required,
                commands: 0,
                workspace: None,
                previous_workspace: self.workspace.clone(),
                snapshot: package
                    .snapshot
                    .as_ref()
                    .expect("original acquisition custody")
                    .clone(),
                build_authorized: false,
            }),
        };
        let result = generation(&package.path, &context);
        let built = context.built.borrow().clone();
        let (commands, workspace, last_snapshot) = {
            let state = context.library.borrow();
            (
                state.commands,
                state.workspace.clone(),
                state.snapshot.clone(),
            )
        };
        drop(context);
        if library_required {
            package.snapshot = Some(last_snapshot);
        }
        let product = result?;
        if library_required
            && (product.role() != "library"
                || commands != 4
                || product.processes().iter().map(|row| row.tool.as_str()).ne([
                    "lake-build-generated",
                    "lean4-prod-build",
                    "prod-export",
                    "native-library-package",
                ]))
        {
            return Err(failure("all four original library generation commands and actual process records are required"));
        }
        let snapshot = custody::capture(&package.path)?;
        if built.as_ref() != Some(&snapshot) {
            return Err(failure(
                "private exporter post-build custody absent or changed after generation",
            ));
        }
        let executable =
            super::measure_executable(&package.path.join(".lake/build/bin/prod-export"))?;
        if package
            .executable
            .as_ref()
            .is_some_and(|prior| prior != &executable)
        {
            return Err(failure("private exporter executable changed across phases"));
        }
        let mut artifacts = product
            .artifacts()
            .iter()
            .map(|(path, bytes)| json!({"path":path,"byte_length":bytes.len(),"sha256":digest(bytes)}))
            .collect::<Vec<_>>();
        artifacts.sort_by(|left, right| left["path"].as_str().cmp(&right["path"].as_str()));
        let record = json!({
            "phase":phase.name(),
            "role":product.role(),
            "model_sha256":digest(model),
            "lexlean_manifest_sha256":digest(lex_manifest),
            "artifacts":artifacts,
            "processes":product.processes(),
        });
        if let Some(prior) = self.phases.first() {
            for field in [
                "role",
                "model_sha256",
                "lexlean_manifest_sha256",
                "artifacts",
            ] {
                if prior[field] != record[field] {
                    return Err(failure(
                        "private exporter replay inputs or complete products differ",
                    ));
                }
            }
        }
        package
            .namespace
            .as_ref()
            .expect("acquired namespace")
            .ready()?;
        package.directory.bind_package(&package.path, &snapshot)?;
        package.snapshot = Some(snapshot);
        package.executable = Some(executable);
        self.phases.push(record);
        if library_required {
            self.workspace = workspace;
        }
        self.poisoned = false;
        Ok(product)
    }

    /// Consume the owner and close its private directory before any acceptance
    /// evidence is published. No owner survives a second verification request.
    pub(crate) fn finish(mut self) -> Result<Value, PrismError> {
        if self.poisoned || self.phases.len() != 2 {
            return Err(failure(
                "private exporter requires both complete generation phases",
            ));
        }
        self.project_identity
            .as_ref()
            .ok_or_else(|| failure("original project identity absent"))?
            .verify()?;
        let record = json!({"schema":"prismpm/verification-exporter-owner/1","phases":self.phases});
        validate_record(
            &record,
            record["phases"][0]["model_sha256"]
                .as_str()
                .expect("recorded model digest"),
            record["phases"][0]["role"].as_str().expect("recorded role"),
        )?;
        let package = self
            .package
            .take()
            .expect("two phases retain one private package");
        package.retire()?;
        Ok(record)
    }
}

impl Drop for VerifyExporterOwner {
    fn drop(&mut self) {
        // No acceptance is possible in Drop; cleanup still uses the retained
        // original node inventory, including on a generation unwind.
        let _ = self.abort();
    }
}

/// Structural replay is not producer authentication. The caller additionally
/// binds these original phase records to retained source/artifact/SDK evidence.
pub(crate) fn validate_record(
    value: &Value,
    model_sha256: &str,
    role: &str,
) -> Result<(), PrismError> {
    fn keys(value: &Value, expected: &[&str]) -> Result<(), PrismError> {
        let object = value
            .as_object()
            .ok_or_else(|| failure("exporter owner object required"))?;
        if object.len() != expected.len() || expected.iter().any(|key| !object.contains_key(*key)) {
            return Err(failure("exporter owner fields are not closed"));
        }
        Ok(())
    }
    fn hash(value: &Value) -> bool {
        value.as_str().is_some_and(|text| {
            text.len() == 64
                && text
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
    }
    keys(value, &["phases", "schema"])?;
    if value["schema"] != "prismpm/verification-exporter-owner/1" {
        return Err(failure("exporter owner version differs"));
    }
    let phases = value["phases"]
        .as_array()
        .ok_or_else(|| failure("exporter owner phases required"))?;
    if phases.len() != 2 {
        return Err(failure("exporter owner requires exactly two phases"));
    }
    let tools = match role {
        "library" => vec![
            "lake-build-generated",
            "lean4-prod-build",
            "prod-export",
            "native-library-package",
        ],
        "application" => vec![
            "application-lean",
            "application-exporter",
            "application-export",
        ],
        _ => return Err(failure("exporter owner role differs")),
    };
    let mut executable = None;
    for (index, phase) in phases.iter().enumerate() {
        keys(
            phase,
            &[
                "artifacts",
                "lexlean_manifest_sha256",
                "model_sha256",
                "phase",
                "processes",
                "role",
            ],
        )?;
        if phase["phase"] != ["controller-build", "replay"][index]
            || phase["role"] != role
            || phase["model_sha256"] != model_sha256
            || !hash(&phase["model_sha256"])
            || !hash(&phase["lexlean_manifest_sha256"])
        {
            return Err(failure("exporter owner phase or input binding differs"));
        }
        let artifacts = phase["artifacts"]
            .as_array()
            .ok_or_else(|| failure("exporter owner artifacts required"))?;
        if artifacts.is_empty() {
            return Err(failure("exporter owner artifact closure is empty"));
        }
        let mut previous: Option<&str> = None;
        for row in artifacts {
            keys(row, &["byte_length", "path", "sha256"])?;
            let path = row["path"]
                .as_str()
                .ok_or_else(|| failure("exporter artifact path required"))?;
            if path.is_empty()
                || path.contains('\\')
                || path.starts_with('/')
                || path.split('/').any(|part| matches!(part, "" | "." | ".."))
                || previous.is_some_and(|prior| prior >= path)
                || row["byte_length"].as_u64().is_none()
                || !hash(&row["sha256"])
            {
                return Err(failure("exporter owner artifact binding differs"));
            }
            previous = Some(path);
        }
        let processes = crate::release_verification::process_records(&phase["processes"], false)?;
        if processes.len() != tools.len()
            || processes
                .iter()
                .zip(&tools)
                .any(|(row, tool)| row["tool"] != *tool)
            || processes[0]["argv"] != json!(["build", "PrismGenerated"])
            || processes[1]["argv"] != json!(["build", "prod-export"])
            || processes[..3]
                .iter()
                .any(|row| row["executable_sha256"] != processes[0]["executable_sha256"])
        {
            return Err(failure("exporter owner actual process closure differs"));
        }
        if role == "library"
            && (processes[3]["argv"]
                != json!(["package", "--locked", "--offline", "--allow-dirty"])
                || processes[3]["executable_sha256"]
                    != phases[0]["processes"][3]["executable_sha256"])
        {
            return Err(failure("exporter owner original package process differs"));
        }
        if let Some(prior) = executable {
            if prior != &processes[2]["exporter"] {
                return Err(failure(
                    "exporter owner source, executable or acquisition changed",
                ));
            }
        }
        executable = Some(&processes[2]["exporter"]);
    }
    for field in [
        "role",
        "model_sha256",
        "lexlean_manifest_sha256",
        "artifacts",
    ] {
        if phases[0][field] != phases[1][field] {
            return Err(failure("exporter owner complete phase bindings differ"));
        }
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod cold_library_tests {
    use super::*;
    use crate::library_build::GeneratedLibrary;

    #[test]
    fn cold_owner_never_admits_missing_reordered_or_fabricated_generation_phases() {
        let project = tempfile::tempdir().unwrap();
        let mut owner = VerifyExporterOwner::default();
        let error = owner
            .generate_library::<GeneratedLibrary>(
                project.path(),
                Phase::Replay,
                b"model",
                b"manifest",
                |_, _| panic!("reordered phase must not construct or invoke anything"),
            )
            .err()
            .unwrap();
        assert_eq!(error.code, "PP5008");
        assert!(owner.package.is_none());
        assert!(owner.finish().is_err());
        let mut owner = VerifyExporterOwner::default();
        let mut actual_package = None;
        assert!(
            owner
                .generate_library::<GeneratedLibrary>(
                    project.path(),
                    Phase::ControllerBuild,
                    b"model",
                    b"manifest",
                    |package, _| {
                        actual_package = Some(package.parent().unwrap().to_owned());
                        Ok(GeneratedLibrary {
                            artifacts: Vec::new(),
                            processes: Vec::new(),
                        })
                    }
                )
                .is_err(),
            "empty outputs and records cannot replace real commands"
        );
        assert!(owner.package.is_none());
        assert!(owner.finish().is_err());
        assert!(!actual_package.unwrap().exists());
    }

    #[test]
    fn cold_owner_acquires_original_archive_and_poisoned_or_unwound_work_cannot_reuse_it() {
        let project = tempfile::tempdir().unwrap();
        let mut owner = VerifyExporterOwner::default();
        let mut path = None;
        let error = owner
            .generate_library::<GeneratedLibrary>(
                project.path(),
                Phase::ControllerBuild,
                b"model",
                b"manifest",
                |package, _context| {
                    path = Some(package.to_owned());
                    assert!(!package.join(".lake").exists());
                    custody::capture_source(package)?;
                    Err(failure("original deliberate pre-command failure"))
                },
            )
            .err()
            .unwrap();
        assert_eq!(error.message, "original deliberate pre-command failure");
        assert!(owner
            .generate_library::<GeneratedLibrary>(
                project.path(),
                Phase::ControllerBuild,
                b"model",
                b"manifest",
                |_, _| { panic!("poisoned generation cannot invoke a callback") }
            )
            .is_err());
        drop(owner);
        assert!(!path.unwrap().exists());
        let mut owner = VerifyExporterOwner::default();
        let mut path = None;
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = owner.generate_library::<GeneratedLibrary>(
                project.path(),
                Phase::ControllerBuild,
                b"model",
                b"manifest",
                |package, _context| {
                    path = Some(package.to_owned());
                    panic!("deliberate generation unwind")
                },
            );
        }));
        assert!(result.is_err());
        assert!(owner.poisoned);
        assert!(owner.finish().is_err());
        assert!(!path.unwrap().exists());
    }

    #[test]
    fn original_source_substitution_refuses_before_any_real_compiler_command() {
        for target in ["Prod/Export.lean", "lean-toolchain"] {
            let project = tempfile::tempdir().unwrap();
            let work = tempfile::tempdir().unwrap();
            let mut owner = VerifyExporterOwner::default();
            let error = owner
                .generate_library::<GeneratedLibrary>(
                    project.path(),
                    Phase::ControllerBuild,
                    b"model",
                    b"manifest",
                    |package, context| {
                        std::fs::write(package.join(target), b"actual source substitution")
                            .unwrap();
                        context.run_library(
                            "lake-build-generated",
                            &crate::verification::executable("lake")?,
                            &["build".to_owned(), "PrismGenerated".to_owned()],
                            work.path(),
                            &BTreeMap::new(),
                            &[],
                            "PP5004",
                        )?;
                        panic!("changed source cannot reach an actual compiler result")
                    },
                )
                .err()
                .unwrap();
            assert_eq!(error.code, "PP5008", "{target}: {error:?}");
            assert!(owner.finish().is_err());
        }
    }

    #[test]
    fn actual_lake_failure_preserves_original_stage_error_and_prohibits_publication() {
        let project = tempfile::tempdir().unwrap();
        let empty_workspace = tempfile::tempdir().unwrap();
        let mut owner = VerifyExporterOwner::default();
        let error = owner
            .generate_library::<GeneratedLibrary>(
                project.path(),
                Phase::ControllerBuild,
                b"model",
                b"manifest",
                |_package, context| {
                    // This is the original real command with an intentionally absent
                    // model project, not a surrogate compiler or a successful product.
                    context.run_library(
                        "lake-build-generated",
                        &crate::verification::executable("lake")?,
                        &["build".to_owned(), "PrismGenerated".to_owned()],
                        empty_workspace.path(),
                        &BTreeMap::new(),
                        &[],
                        "PP5004",
                    )?;
                    panic!("the genuine malformed-workspace build must fail")
                },
            )
            .err()
            .unwrap();
        assert_eq!(error.code, "PP5004", "{error:?}");
        assert!(owner.finish().is_err());
        assert!(!project.path().join(".prism/verified").exists());
    }

    #[test]
    fn wrong_command_and_prior_model_cache_refuse_before_any_executable_selection() {
        for cache in [false, true] {
            let project = tempfile::tempdir().unwrap();
            let work = tempfile::tempdir().unwrap();
            if cache {
                std::fs::create_dir(work.path().join(".lake")).unwrap();
            }
            let mut owner = VerifyExporterOwner::default();
            let error = owner
                .generate_library::<GeneratedLibrary>(
                    project.path(),
                    Phase::ControllerBuild,
                    b"model",
                    b"manifest",
                    |_package, context| {
                        context.run_library(
                            if cache {
                                "lake-build-generated"
                            } else {
                                "prod-export"
                            },
                            Path::new("/nonexistent/cannot-execute"),
                            &["build".to_owned(), "PrismGenerated".to_owned()],
                            work.path(),
                            &BTreeMap::new(),
                            &[],
                            "PP5004",
                        )?;
                        panic!("invalid command or stale model cache cannot execute")
                    },
                )
                .err()
                .unwrap();
            assert_eq!(error.code, "PP5008");
            assert!(error.message.contains(if cache {
                "fresh independent"
            } else {
                "command order"
            }));
            assert!(owner.finish().is_err());
        }
    }

    #[test]
    fn replay_project_model_and_manifest_binding_reject_before_materialization() {
        let original = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        // Negative predicate state only: no package, command, accepted first
        // phase or successful finish is manufactured by these private units.
        for (project, model, manifest) in [
            (other.path(), b"model".as_slice(), b"manifest".as_slice()),
            (
                original.path(),
                b"changed".as_slice(),
                b"manifest".as_slice(),
            ),
            (original.path(), b"model".as_slice(), b"changed".as_slice()),
        ] {
            let mut owner = VerifyExporterOwner::default();
            owner.project = Some(original.path().to_owned());
            owner.inputs = Some((digest(b"model"), digest(b"manifest")));
            owner.phases.push(json!({"phase":"controller-build"}));
            let error = owner
                .generate_library::<GeneratedLibrary>(
                    project,
                    Phase::Replay,
                    model,
                    manifest,
                    |_, _| panic!("mismatched replay cannot materialize tools or execute"),
                )
                .err()
                .unwrap();
            assert_eq!(error.code, "PP5008");
            assert!(error.message.contains("inputs changed"));
            assert!(owner.package.is_none());
            assert!(owner.finish().is_err());
        }
        let parent = tempfile::tempdir().unwrap();
        let project = parent.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let mut owner = VerifyExporterOwner::default();
        owner.project = Some(project.clone());
        owner.project_identity = Some(custody::Cwd::open(&project).unwrap());
        owner.inputs = Some((digest(b"model"), digest(b"manifest")));
        owner.phases.push(json!({"phase":"controller-build"}));
        let displaced = parent.path().join("original-project");
        std::fs::rename(&project, &displaced).unwrap();
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("foreign-marker"), b"retain replacement").unwrap();
        assert!(owner
            .generate_library::<GeneratedLibrary>(
                &project,
                Phase::Replay,
                b"model",
                b"manifest",
                |_, _| { panic!("same-path project replacement cannot invoke replay") },
            )
            .is_err());
        assert!(owner.package.is_none());
        assert!(owner.finish().is_err());
        assert!(displaced.exists());
        assert_eq!(
            std::fs::read(project.join("foreign-marker")).unwrap(),
            b"retain replacement"
        );
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    // Unaccepted custody fixture only. No compiler execution or production
    // acceptance is claimed; its empty transcript must never pass finish().
    struct Unaccepted(Vec<(String, Vec<u8>)>);
    impl ProductEvidence for Unaccepted {
        fn role(&self) -> &'static str {
            "library"
        }
        fn artifacts(&self) -> &[(String, Vec<u8>)] {
            &self.0
        }
        fn processes(&self) -> &[ProcessRecord] {
            &[]
        }
    }
    fn provisional(path: &Path, context: &GenerationContext<'_>) -> Result<Unaccepted, PrismError> {
        std::fs::create_dir_all(path.join(".lake/build/bin")).unwrap();
        let executable = path.join(".lake/build/bin/prod-export");
        std::fs::write(&executable, b"unaccepted custody fixture").unwrap();
        std::fs::set_permissions(executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(
            path.join(".lake/build/compiled.olean"),
            b"fixed compiled member",
        )
        .unwrap();
        std::fs::write(path.join(".lake/build/compiler.trace"), b"initial trace").unwrap();
        context.after_build(path)?;
        Ok(Unaccepted(vec![(
            "library/unaccepted".to_owned(),
            b"fixture".to_vec(),
        )]))
    }
    fn first(project: &Path) -> VerifyExporterOwner {
        let mut owner = VerifyExporterOwner::default();
        owner
            .generate(
                project,
                Phase::ControllerBuild,
                b"model",
                b"manifest",
                provisional,
            )
            .unwrap();
        owner
    }

    #[test]
    fn first_cold_phase_retains_actual_post_build_custody_until_completion() {
        let project = tempfile::tempdir().unwrap();
        let mut owner = VerifyExporterOwner::default();
        let mut original_root = PathBuf::new();
        let error = owner
            .generate(
                project.path(),
                Phase::ControllerBuild,
                b"model",
                b"manifest",
                |package, context| {
                    let product = provisional(package, context)?;
                    original_root = package.parent().unwrap().to_owned();
                    std::fs::rename(package.join(".lake"), original_root.join("original-lake"))
                        .unwrap();
                    std::fs::create_dir_all(package.join(".lake/build/bin")).unwrap();
                    std::fs::copy(
                        original_root.join("original-lake/build/bin/prod-export"),
                        package.join(".lake/build/bin/prod-export"),
                    )
                    .unwrap();
                    std::fs::write(package.join(".lake/foreign-marker"), b"must survive").unwrap();
                    Ok(product)
                },
            )
            .err()
            .unwrap();
        assert_eq!(error.code, "PP5008");
        assert!(owner.package.is_none());
        assert!(owner.finish().is_err());
        assert_eq!(
            std::fs::read(original_root.join("lean4-prod/.lake/foreign-marker")).unwrap(),
            b"must survive"
        );
        assert!(original_root
            .join("original-lake/build/bin/prod-export")
            .exists());
        std::fs::remove_dir_all(original_root).unwrap();
    }

    #[test]
    fn first_cold_generation_checks_source_again_at_the_actual_build_boundary() {
        let project = tempfile::tempdir().unwrap();
        let mut owner = VerifyExporterOwner::default();
        let mut reached_build_boundary = false;
        let error = owner
            .generate::<Unaccepted>(
                project.path(),
                Phase::ControllerBuild,
                b"model",
                b"manifest",
                |package, context| {
                    // Generated-module work separates acquisition from the real
                    // exporter build. Mutate an actual original source in place
                    // during that interval; checking only before generation fails.
                    std::fs::write(
                        package.join("Prod/Export.lean"),
                        b"unauthenticated source at build boundary",
                    )
                    .unwrap();
                    reached_build_boundary = true;
                    context.before_build(project.path(), package)?;
                    panic!("changed source reached forbidden build");
                },
            )
            .err()
            .unwrap();
        assert!(reached_build_boundary);
        assert_eq!(error.code, "PP5008");
        assert!(owner.package.is_none());
        assert!(owner.finish().is_err());
    }
    fn unused(_: &Path, _: &GenerationContext<'_>) -> Result<Unaccepted, PrismError> {
        panic!("forbidden generation invoked")
    }

    #[test]
    fn invalid_phase_order_never_acquires_and_repeated_phase_retires() {
        let project = tempfile::tempdir().unwrap();
        let mut empty = VerifyExporterOwner::default();
        assert!(empty
            .generate(project.path(), Phase::Replay, b"model", b"manifest", unused)
            .is_err());
        assert!(empty.package.is_none());
        let mut owner = first(project.path());
        let path = owner.package.as_ref().unwrap().directory.path().to_owned();
        assert!(owner
            .generate(
                project.path(),
                Phase::ControllerBuild,
                b"model",
                b"manifest",
                unused
            )
            .is_err());
        assert!(!path.exists());
        assert!(owner.poisoned);
        assert!(owner.finish().is_err());
    }

    #[test]
    fn generation_failure_in_either_phase_retires_and_cannot_retry() {
        let project = tempfile::tempdir().unwrap();
        for phase in [Phase::ControllerBuild, Phase::Replay] {
            let mut owner = if phase == Phase::Replay {
                first(project.path())
            } else {
                VerifyExporterOwner::default()
            };
            let mut path = PathBuf::new();
            let result = owner.generate::<Unaccepted>(
                project.path(),
                phase,
                b"model",
                b"manifest",
                |package, _| {
                    path = package.parent().unwrap().to_owned();
                    Err(PrismError::new("PP5004", "original generation failed"))
                },
            );
            assert_eq!(result.err().unwrap().message, "original generation failed");
            assert!(!path.exists());
            assert!(owner.package.is_none());
            assert!(owner
                .generate(project.path(), phase, b"model", b"manifest", unused)
                .is_err());
        }
    }

    #[test]
    fn source_executable_and_compiled_member_drift_refuse_before_replay() {
        let project = tempfile::tempdir().unwrap();
        for member in [
            "Prod/Export.lean",
            ".lake/build/bin/prod-export",
            ".lake/build/compiled.olean",
            ".lake/build/compiler.trace",
        ] {
            let mut owner = first(project.path());
            let package = owner.package.as_ref().unwrap();
            let path = package.directory.path().to_owned();
            let selected = package.path.join(member);
            let bytes = std::fs::read(&selected).unwrap();
            let replacement = selected.with_extension("substitution");
            std::fs::write(&replacement, &bytes).unwrap();
            std::fs::set_permissions(
                &replacement,
                std::fs::metadata(&selected).unwrap().permissions(),
            )
            .unwrap();
            std::fs::rename(replacement, &selected).unwrap();
            assert!(owner
                .generate(project.path(), Phase::Replay, b"model", b"manifest", unused)
                .is_err());
            assert_eq!(
                std::fs::read(&selected).unwrap(),
                bytes,
                "same-byte foreign replacement must survive refused cleanup"
            );
            assert!(path.exists());
            std::fs::remove_dir_all(&path).unwrap();
            assert!(owner.finish().is_err());
        }
    }

    #[test]
    fn replay_cannot_change_compiled_members_or_inputs() {
        let project = tempfile::tempdir().unwrap();
        for defect in [
            "compiled",
            "source",
            "executable-mode",
            "model",
            "manifest",
            "artifacts",
        ] {
            let mut owner = first(project.path());
            let path = owner.package.as_ref().unwrap().directory.path().to_owned();
            let model = if defect == "model" {
                b"other".as_slice()
            } else {
                b"model".as_slice()
            };
            let manifest = if defect == "manifest" {
                b"other".as_slice()
            } else {
                b"manifest".as_slice()
            };
            let result = owner.generate(
                project.path(),
                Phase::Replay,
                model,
                manifest,
                |package, _| {
                    match defect {
                        "compiled" => {
                            std::fs::write(package.join(".lake/build/compiled.olean"), b"changed")
                                .unwrap()
                        }
                        "source" => {
                            std::fs::write(package.join("Prod/Export.lean"), b"changed").unwrap()
                        }
                        "executable-mode" => std::fs::set_permissions(
                            package.join(".lake/build/bin/prod-export"),
                            std::fs::Permissions::from_mode(0o700),
                        )
                        .unwrap(),
                        _ => {}
                    }
                    Ok(Unaccepted(vec![(
                        "library/unaccepted".to_owned(),
                        if defect == "artifacts" {
                            b"other".to_vec()
                        } else {
                            b"fixture".to_vec()
                        },
                    )]))
                },
            );
            assert!(result.is_err(), "accepted defect {defect}");
            if defect == "executable-mode" {
                assert!(
                    path.exists(),
                    "mode uncertainty must retain the original scratch tree"
                );
                std::fs::remove_dir_all(&path).unwrap();
            } else {
                assert!(!path.exists());
            }
            assert!(owner.finish().is_err());
        }
    }

    #[test]
    fn only_trace_refresh_survives_and_unexecuted_transcript_never_finishes() {
        let project = tempfile::tempdir().unwrap();
        let mut owner = first(project.path());
        let path = owner.package.as_ref().unwrap().directory.path().to_owned();
        let original = owner.package.as_ref().unwrap().path.clone();
        owner
            .generate(
                project.path(),
                Phase::Replay,
                b"model",
                b"manifest",
                |package, context| {
                    assert_eq!(package, original);
                    std::fs::write(
                        package.join(".lake/build/compiler.trace"),
                        b"legitimate refreshed trace",
                    )
                    .unwrap();
                    context.after_build(package)?;
                    Ok(Unaccepted(vec![(
                        "library/unaccepted".to_owned(),
                        b"fixture".to_vec(),
                    )]))
                },
            )
            .unwrap();
        assert_eq!(owner.phases.len(), 2);
        assert!(owner.finish().is_err());
        assert!(!path.exists());
    }

    #[test]
    fn lock_addition_or_project_substitution_retires_cold_owner() {
        let project = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        for add_lock in [false, true] {
            let mut owner = first(project.path());
            let path = owner.package.as_ref().unwrap().directory.path().to_owned();
            if add_lock {
                std::fs::write(
                    project.path().join("prismpm.lock"),
                    b"invalid new authority",
                )
                .unwrap();
            }
            assert!(owner
                .generate(
                    if add_lock {
                        project.path()
                    } else {
                        other.path()
                    },
                    Phase::Replay,
                    b"model",
                    b"manifest",
                    unused
                )
                .is_err());
            assert!(!path.exists());
            assert!(owner.finish().is_err());
        }
    }

    #[test]
    fn unwind_poison_cannot_accept_and_drop_retires_owned_package() {
        let project = tempfile::tempdir().unwrap();
        let mut owner = VerifyExporterOwner::default();
        let mut path = PathBuf::new();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = owner.generate::<Unaccepted>(
                project.path(),
                Phase::ControllerBuild,
                b"model",
                b"manifest",
                |package, _| {
                    path = package.parent().unwrap().to_owned();
                    panic!("generation unwind")
                },
            );
        }));
        assert!(result.is_err());
        assert!(owner.poisoned);
        assert!(owner.finish().is_err());
        assert!(!path.exists());
    }

    #[test]
    fn concurrent_invocations_never_share_packages() {
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let workers = (0..2)
            .map(|_| {
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let project = tempfile::tempdir().unwrap();
                    let owner = first(project.path());
                    let path = owner.package.as_ref().unwrap().directory.path().to_owned();
                    barrier.wait();
                    assert!(path.exists());
                    drop(owner);
                    assert!(!path.exists());
                    path
                })
            })
            .collect::<Vec<_>>();
        let paths = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();
        assert_ne!(paths[0], paths[1]);
    }

    #[test]
    fn completed_phase_pair_cannot_run_a_third_generation() {
        let project = tempfile::tempdir().unwrap();
        let mut owner = first(project.path());
        let path = owner.package.as_ref().unwrap().directory.path().to_owned();
        owner
            .generate(
                project.path(),
                Phase::Replay,
                b"model",
                b"manifest",
                |package, context| {
                    context.after_build(package)?;
                    Ok(Unaccepted(vec![(
                        "library/unaccepted".to_owned(),
                        b"fixture".to_vec(),
                    )]))
                },
            )
            .unwrap();
        assert!(owner
            .generate(project.path(), Phase::Replay, b"model", b"manifest", unused)
            .is_err());
        assert!(!path.exists());
        assert!(owner.finish().is_err());
    }

    #[test]
    fn abort_preserves_replacement_directory_and_its_foreign_marker() {
        let project = tempfile::tempdir().unwrap();
        let mut owner = VerifyExporterOwner::default();
        let mut replaced = PathBuf::new();
        let mut displaced = PathBuf::new();
        let error = owner
            .generate::<Unaccepted>(
                project.path(),
                Phase::ControllerBuild,
                b"model",
                b"manifest",
                |package, _| {
                    replaced = package.parent().unwrap().to_owned();
                    displaced = replaced.with_extension("owned-test-displaced");
                    std::fs::rename(&replaced, &displaced).unwrap();
                    std::fs::create_dir(&replaced).unwrap();
                    std::fs::write(replaced.join("foreign-marker"), b"must survive cleanup")
                        .unwrap();
                    Err(PrismError::new(
                        "PP5004",
                        "generation failed after substitution",
                    ))
                },
            )
            .err()
            .unwrap();
        let preserved = std::fs::read(replaced.join("foreign-marker")).ok();
        // These two paths contain only this test's original package and marker.
        // Retire them after recording the outcome, not via the owner under test.
        if replaced.exists() {
            std::fs::remove_dir_all(&replaced).unwrap();
        }
        std::fs::remove_dir_all(displaced).unwrap();
        assert_eq!(
            error.code, "PP5008",
            "cleanup uncertainty must supersede generation failure"
        );
        assert_eq!(
            preserved.as_deref(),
            Some(b"must survive cleanup".as_slice())
        );
        assert!(owner.finish().is_err());
    }

    #[test]
    fn cleanup_error_is_not_a_successful_retirement() {
        let project = tempfile::tempdir().unwrap();
        let mut owner = VerifyExporterOwner::default();
        let mut path = PathBuf::new();
        let error = owner
            .generate::<Unaccepted>(
                project.path(),
                Phase::ControllerBuild,
                b"model",
                b"manifest",
                |package, _| {
                    path = package.parent().unwrap().to_owned();
                    assert!(path
                        .file_name()
                        .unwrap()
                        .to_str()
                        .unwrap()
                        .starts_with("prismpm-verify-exporter-"));
                    std::fs::remove_dir_all(&path).unwrap();
                    std::fs::write(&path, b"owned cleanup-failure sentinel").unwrap();
                    Err(PrismError::new(
                        "PP5004",
                        "generation failed before cleanup",
                    ))
                },
            )
            .err()
            .unwrap();
        assert_eq!(error.code, "PP5008");
        assert!(error.message.contains("retirement"));
        assert!(owner.finish().is_err());
        assert!(std::fs::symlink_metadata(&path).unwrap().is_file());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn retirement_rechecks_owned_custody_without_synthetic_execution_acceptance() {
        // Exercise the exact final retirement guard in isolation. The fixture
        // never executes a compiler, and no acceptance record is returned.
        let project = tempfile::tempdir().unwrap();
        for member in [
            "Prod/Export.lean",
            ".lake/build/compiled.olean",
            ".lake/build/compiler.trace",
        ] {
            let mut owner = first(project.path());
            let package = owner.package.take().unwrap();
            let path = package.directory.path().to_owned();
            std::fs::write(package.path.join(member), b"retirement custody drift").unwrap();
            let error = package.retire().unwrap_err();
            assert_eq!(error.code, "PP5008");
            assert_eq!(
                error.message,
                if member == "Prod/Export.lean" {
                    "exporter package source or build-tree custody changed"
                } else {
                    "private exporter custody changed before retirement"
                }
            );
            assert!(
                path.exists(),
                "retirement failure must retain unaccepted custody"
            );
            assert_eq!(
                std::fs::read(path.join("lean4-prod").join(member)).unwrap(),
                b"retirement custody drift"
            );
            std::fs::remove_dir_all(&path).unwrap();
        }
    }

    #[test]
    fn nested_substitutions_survive_abort_retirement_and_drop() {
        let project = tempfile::tempdir().unwrap();
        for target in ["lean4-prod", "lean4-prod/.lake/build"] {
            for operation in ["abort", "retire", "drop"] {
                let mut owner = first(project.path());
                let root = owner.package.as_ref().unwrap().directory.path().to_owned();
                let replaced = root.join(target);
                let displaced = replaced.with_extension("test-original");
                std::fs::rename(&replaced, &displaced).unwrap();
                std::fs::create_dir(&replaced).unwrap();
                std::fs::set_permissions(&replaced, std::fs::Permissions::from_mode(0o700))
                    .unwrap();
                let marker = replaced.join("foreign-marker");
                std::fs::write(&marker, b"must never be adopted for cleanup").unwrap();
                match operation {
                    "abort" => {
                        assert!(owner.abort().is_err());
                    }
                    "retire" => {
                        assert!(owner.package.take().unwrap().retire().is_err());
                    }
                    "drop" => {
                        drop(owner);
                    }
                    _ => unreachable!(),
                }
                assert_eq!(
                    std::fs::read(&marker).unwrap(),
                    b"must never be adopted for cleanup",
                    "{operation} deleted foreign content at {target}"
                );
                assert!(
                    displaced.exists(),
                    "uncertain original must also be retained"
                );
                std::fs::remove_dir_all(root).unwrap();
            }
        }
    }
}

/// Bind both original generations to independently retained source, products
/// and native preflight; replay must also be the original top-level transcript.
#[allow(clippy::too_many_arguments)]
pub(crate) fn validate_binding(
    value: &Value,
    model_sha256: &str,
    role: &str,
    lex_manifest: &[u8],
    artifacts: &Value,
    processes: &[Value],
    arguments: &[String],
) -> Result<(), PrismError> {
    validate_record(value, model_sha256, role)?;
    let phases = value["phases"].as_array().expect("validated owner phases");
    let replay = phases[1]["processes"]
        .as_array()
        .expect("validated processes");
    if processes
        .windows(replay.len())
        .filter(|rows| *rows == replay.as_slice())
        .count()
        != 1
    {
        return Err(failure(
            "original replay processes differ from retained transcript",
        ));
    }
    let lake = processes
        .iter()
        .find(|row| row["tool"] == "lake-version")
        .ok_or_else(|| failure("independent native Lake preflight is absent"))?;
    for phase in phases {
        if phase["lexlean_manifest_sha256"] != digest(lex_manifest)
            || phase["artifacts"] != *artifacts
            || phase["processes"][2]["argv"] != json!(arguments)
            || phase["processes"][0]["executable_sha256"] != lake["executable_sha256"]
        {
            return Err(failure(
                "exporter owner source, products, arguments or native tool differ",
            ));
        }
    }
    Ok(())
}
