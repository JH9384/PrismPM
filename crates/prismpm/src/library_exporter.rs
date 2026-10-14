//! Cold tools owned by one library verification; never a caller or SDK cache.

mod custody;
mod directory;

use crate::library_build::GeneratedLibrary;
use crate::verification::{run_process, ProcessRecord};
use crate::PrismError;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const ARCHIVE: &[u8] = include_bytes!("../vendor/lean4-prod/lean.tar");

fn failure(message: &str) -> PrismError {
    PrismError::new("PP5008", message)
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Phase {
    Build,
    Replay,
}

struct Package {
    namespace: Option<directory::Directory>,
    directory: directory::Directory,
    path: PathBuf,
    snapshot: custody::Snapshot,
}

impl Package {
    fn verify(&self) -> Result<(), PrismError> {
        self.directory.ready()?;
        self.namespace
            .as_ref()
            .ok_or_else(|| failure("exporter namespace absent"))?
            .ready()?;
        if custody::capture(&self.path)? != self.snapshot {
            return Err(failure("original cold exporter custody changed"));
        }
        Ok(())
    }

    fn retire(self) -> Result<(), PrismError> {
        self.verify()
            .inspect_err(|_| self.directory.scope().uncertain())?;
        drop(self.namespace);
        self.directory.close()
    }
}

/// No Clone, global state, persisted handle or caller-selected executable.
/// Only the existing verification worker carries this through build then replay.
#[derive(Default)]
pub(crate) struct LibraryExporterOwner {
    package: Option<Package>,
    project: Option<PathBuf>,
    project_identity: Option<custody::Cwd>,
    inputs: Option<(String, String)>,
    products: Option<Vec<(String, usize, String)>>,
    workspace: Option<PathBuf>,
    completed: usize,
    poisoned: bool,
}

impl LibraryExporterOwner {
    pub(crate) fn generate(
        &mut self,
        project: &Path,
        phase: Phase,
        model: &[u8],
        manifest: &[u8],
        generation: impl FnOnce(&mut Generation<'_>) -> Result<GeneratedLibrary, PrismError>,
    ) -> Result<GeneratedLibrary, PrismError> {
        if self.poisoned
            || !matches!(
                (self.completed, phase),
                (0, Phase::Build) | (1, Phase::Replay)
            )
        {
            self.poisoned = true;
            return Err(failure(
                "cold library exporter phase repeated, reordered or failed",
            ));
        }
        self.poisoned = true;
        let project = project
            .canonicalize()
            .map_err(|_| failure("library project unavailable"))?;
        if let Some(original) = &self.project_identity {
            original.verify()?;
        }
        let inputs = (hash(model), hash(manifest));
        if self.project.as_ref().is_some_and(|prior| *prior != project)
            || self.inputs.as_ref().is_some_and(|prior| *prior != inputs)
        {
            return Err(failure(
                "library exporter project or generation inputs changed",
            ));
        }
        if self.package.is_none() {
            custody::validate_archive()?;
            let mut directory = directory::Directory::temporary(
                "prismpm-library-exporter-",
                None,
                Default::default(),
            )?;
            let path = directory.path().join("lean4-prod");
            std::fs::create_dir(&path)
                .map_err(|error| failure(&format!("fresh exporter: {error}")))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                    .map_err(|error| failure(&format!("private exporter: {error}")))?;
            }
            tar::Archive::new(std::io::Cursor::new(ARCHIVE))
                .unpack(&path)
                .map_err(|error| failure(&format!("pinned exporter source: {error}")))?;
            let snapshot = custody::capture_source(&path)?;
            directory.bind_package(&path, &snapshot)?;
            let namespace = directory::Directory::existing(&path, directory.scope())?;
            self.package = Some(Package {
                namespace: Some(namespace),
                directory,
                path,
                snapshot,
            });
            self.project = Some(project);
            self.project_identity = Some(custody::Cwd::open(
                self.project.as_deref().expect("original project"),
            )?);
            self.inputs = Some(inputs);
        }
        let package = self
            .package
            .as_mut()
            .expect("fresh private package established");
        // Source-only capture on the first build; every later child sees the
        // exact original complete compiled runtime, not just a matching hash.
        package.directory.ready()?;
        package
            .namespace
            .as_ref()
            .expect("private namespace")
            .ready()?;
        if custody::capture_optional(&package.path)? != package.snapshot {
            return Err(failure("cold exporter changed before generation"));
        }
        let mut context = Generation {
            package,
            first: self.completed == 0,
            commands: 0,
            workspace: None,
            previous_workspace: self.workspace.as_deref(),
        };
        let product = generation(&mut context)?;
        if context.commands != 4 {
            return Err(failure(
                "all four original library generation commands are required",
            ));
        }
        context.package.verify()?;
        let workspace = context.workspace.take();
        drop(context);
        self.workspace = workspace;
        let rows = product
            .artifacts
            .iter()
            .map(|(path, bytes)| (path.clone(), bytes.len(), hash(bytes)))
            .collect::<Vec<_>>();
        if self.products.as_ref().is_some_and(|prior| *prior != rows) {
            return Err(failure("independent library generation products differ"));
        }
        if product.processes.len() != 4
            || product.processes.iter().map(|row| row.tool.as_str()).ne([
                "lake-build-generated",
                "lean4-prod-build",
                "prod-export",
                "native-library-package",
            ])
        {
            return Err(failure("complete actual library process records required"));
        }
        self.products = Some(rows);
        self.completed += 1;
        self.poisoned = false;
        Ok(product)
    }

    /// Retirement must finish before any native-library acceptance is published.
    pub(crate) fn finish(mut self) -> Result<(), PrismError> {
        if self.poisoned || self.completed != 2 {
            return Err(failure(
                "both complete cold library exporter phases required",
            ));
        }
        self.project_identity
            .as_ref()
            .ok_or_else(|| failure("original project identity absent"))?
            .verify()?;
        self.package
            .take()
            .ok_or_else(|| failure("cold exporter absent"))?
            .retire()
    }
}

impl Drop for LibraryExporterOwner {
    fn drop(&mut self) {
        if let Some(package) = self.package.take() {
            // An error never grants a fresh current-tree cleanup authority.
            // Directory Drop removes only its last bound original node set;
            // unexpected growth/replacement is retained rather than adopted.
            if self.poisoned {
                eprintln!(
                    "Retiring failed cold library exporter {}",
                    package.directory.path().display()
                );
            }
            drop(package.namespace);
            drop(package.directory);
        }
    }
}

pub(crate) struct Generation<'a> {
    package: &'a mut Package,
    first: bool,
    commands: usize,
    workspace: Option<PathBuf>,
    previous_workspace: Option<&'a Path>,
}

impl Generation<'_> {
    pub(crate) fn package(&self) -> &Path {
        &self.package.path
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn run(
        &mut self,
        tool: &str,
        program: &Path,
        args: &[String],
        cwd: &Path,
        environment: &BTreeMap<String, String>,
        replacements: &[(&Path, &str)],
        code: &'static str,
    ) -> Result<ProcessRecord, PrismError> {
        let expected = [
            "lake-build-generated",
            "lean4-prod-build",
            "prod-export",
            "native-library-package",
        ];
        if self.commands >= expected.len() || tool != expected[self.commands] {
            return Err(failure("original library command order required"));
        }
        if self.commands == 0 {
            if args != ["build", "PrismGenerated"] || !environment.is_empty()
                || cwd.canonicalize().ok().as_deref() != Some(cwd)
                || self.previous_workspace == Some(cwd)
                || [".lake", "export", "package"].iter().any(|name| {
                    !matches!(std::fs::symlink_metadata(cwd.join(name)), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
                })
            {
                return Err(failure("fresh independent generated library workspace required"));
            }
            self.workspace = Some(cwd.to_owned());
        }
        let workspace = self
            .workspace
            .as_deref()
            .expect("first actual command binds workspace");
        let valid = match self.commands {
            0 => cwd == workspace,
            1 => {
                cwd == self.package.path
                    && args == ["build", "prod-export"]
                    && environment.is_empty()
            }
            2 => {
                cwd == self.package.path
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
        self.package.directory.ready()?;
        self.package
            .namespace
            .as_ref()
            .expect("original namespace")
            .ready()?;
        let before = custody::capture_optional(&self.package.path)?;
        if before != self.package.snapshot {
            return Err(failure("exporter changed before actual command"));
        }
        let program_before = custody::capture_launcher(program)?;
        let directory = custody::Cwd::open(cwd)?;
        let result = run_process(tool, program, args, cwd, environment, replacements, code);
        let checked: Result<(), PrismError> = (|| {
            directory.verify()?;
            if custody::capture_launcher(program)? != program_before {
                return Err(failure("actual library launcher changed during command"));
            }
            self.package.directory.ready()?;
            self.package
                .namespace
                .as_ref()
                .expect("original namespace")
                .ready()?;
            let after = custody::capture_optional(&self.package.path)?;
            let unchanged = if self.commands == 1 {
                if self.first {
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
            if self.commands >= 1 && result.is_ok() {
                custody::require_executable(&self.package.path)?;
            }
            self.package
                .directory
                .bind_package(&self.package.path, &after)?;
            self.package.snapshot = after;
            Ok(())
        })();
        match (result, checked) {
            (Err(mut original), Err(custody)) => {
                original.message.push_str(&format!(
                    "; cold exporter custody also failed: {}",
                    custody.message
                ));
                Err(original)
            }
            (Err(original), _) => Err(original),
            (Ok(_), Err(custody)) => Err(custody),
            (Ok(record), Ok(())) => {
                self.commands += 1;
                Ok(record)
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn cold_owner_never_admits_missing_reordered_or_fabricated_generation_phases() {
        let project = tempfile::tempdir().unwrap();
        let mut owner = LibraryExporterOwner::default();
        let error = owner
            .generate(project.path(), Phase::Replay, b"model", b"manifest", |_| {
                panic!("reordered phase must not construct or invoke anything")
            })
            .err()
            .unwrap();
        assert_eq!(error.code, "PP5008");
        assert!(owner.package.is_none());
        assert!(owner.finish().is_err());
        let mut owner = LibraryExporterOwner::default();
        assert!(
            owner
                .generate(project.path(), Phase::Build, b"model", b"manifest", |_| {
                    Ok(GeneratedLibrary {
                        artifacts: Vec::new(),
                        processes: Vec::new(),
                    })
                })
                .is_err(),
            "empty outputs and records cannot replace real commands"
        );
        let package = owner.package.as_ref().unwrap().directory.path().to_owned();
        assert!(owner.finish().is_err());
        assert!(!package.exists());
    }

    #[test]
    fn cold_owner_acquires_original_archive_and_poisoned_or_unwound_work_cannot_reuse_it() {
        let project = tempfile::tempdir().unwrap();
        let mut owner = LibraryExporterOwner::default();
        let mut path = None;
        let error = owner
            .generate(
                project.path(),
                Phase::Build,
                b"model",
                b"manifest",
                |context| {
                    path = Some(context.package().to_owned());
                    assert!(!context.package().join(".lake").exists());
                    custody::capture_source(context.package())?;
                    Err(failure("original deliberate pre-command failure"))
                },
            )
            .err()
            .unwrap();
        assert_eq!(error.message, "original deliberate pre-command failure");
        assert!(owner
            .generate(project.path(), Phase::Build, b"model", b"manifest", |_| {
                panic!("poisoned generation cannot invoke a callback")
            })
            .is_err());
        drop(owner);
        assert!(!path.unwrap().exists());
        let mut owner = LibraryExporterOwner::default();
        let mut path = None;
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = owner.generate(
                project.path(),
                Phase::Build,
                b"model",
                b"manifest",
                |context| {
                    path = Some(context.package().to_owned());
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
            let mut owner = LibraryExporterOwner::default();
            let error = owner
                .generate(
                    project.path(),
                    Phase::Build,
                    b"model",
                    b"manifest",
                    |context| {
                        std::fs::write(
                            context.package().join(target),
                            b"actual source substitution",
                        )
                        .unwrap();
                        context.run(
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
        let mut owner = LibraryExporterOwner::default();
        let error = owner
            .generate(
                project.path(),
                Phase::Build,
                b"model",
                b"manifest",
                |context| {
                    // This is the original real command with an intentionally absent
                    // model project, not a surrogate compiler or a successful product.
                    context.run(
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
            let mut owner = LibraryExporterOwner::default();
            let error = owner
                .generate(
                    project.path(),
                    Phase::Build,
                    b"model",
                    b"manifest",
                    |context| {
                        context.run(
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
            let mut owner = LibraryExporterOwner::default();
            owner.project = Some(original.path().to_owned());
            owner.inputs = Some((hash(b"model"), hash(b"manifest")));
            owner.completed = 1;
            let error = owner
                .generate(project, Phase::Replay, model, manifest, |_| {
                    panic!("mismatched replay cannot materialize tools or execute")
                })
                .err()
                .unwrap();
            assert_eq!(error.code, "PP5008");
            assert!(error.message.contains("inputs changed"));
            assert!(owner.package.is_none());
            assert!(owner.finish().is_err());
        }
    }
}
