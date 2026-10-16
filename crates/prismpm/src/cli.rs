//! CLI command parsing, canonical machine output, and stable exit classes.

use crate::controller::{
    BuildRequest, CheckRequest, CleanRequest, Controller, ExportBrowserRequest,
    ProductBuildRequest, VerifyBrowserPublicationRequest, VerifyRequest,
};
use crate::error::PrismError;
use crate::holo::canonical::encode_value;
use clap::{error::ErrorKind, CommandFactory, Parser, Subcommand, ValueEnum};
use serde::Serialize;
use serde_json::json;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::ExitCode;

/// The Prism Platform Model CLI.
#[derive(Parser, Debug)]
#[command(name = "prismpm", version, about = "Prism Platform Model Framework")]
pub struct Cli {
    /// Optional project path (defaults to current directory).
    #[arg(short, long, global = true)]
    pub project: Option<PathBuf>,

    /// Optional confined project configuration path.
    #[arg(long, global = true)]
    pub config: Option<PathBuf>,

    /// Emit exactly one canonical JSON value.
    #[arg(long, global = true)]
    pub json: bool,

    /// Subcommand to execute.
    #[command(subcommand)]
    pub command: Commands,
}

/// Available CLI subcommands.
#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Generate shell completion from the executable command contract.
    Completion {
        /// Shell whose native completion syntax is emitted.
        #[arg(value_enum)]
        shell: CompletionShell,
    },
    /// Check or propose an explicit reviewable SDK-lock update.
    Lock {
        /// SDK lock operation.
        #[command(subcommand)]
        command: LockCommands,
    },
    /// Resolve, inspect, or verify immutable standards authority bindings.
    Authority {
        /// Authority lifecycle operation.
        #[command(subcommand)]
        command: AuthorityCommands,
    },
    /// Acquire every immutable standards/oracle input in the committed lock.
    Fetch {
        /// Require the committed lock to match the reviewed embedded catalog.
        #[arg(long)]
        locked: bool,
    },
    /// Check project static validity without filesystem modification.
    Check,
    /// Build project artifacts or a locked verified OCI product release.
    Build {
        /// Tagged discovery reference for product release construction.
        #[arg(short = 't', long)]
        tag: Option<String>,
        /// Require every resolved input and prohibit lock mutation.
        #[arg(long)]
        locked: bool,
        /// Named system release from the authoritative source graph.
        #[arg(long)]
        release: Option<String>,
        /// Project context (defaults to --project or the current directory).
        context: Option<PathBuf>,
    },
    /// Inspect an immutable local product release without executing it.
    Inspect {
        /// Registry-qualified digest reference.
        reference: String,
    },
    /// Export unchanged browser artifacts after source-free release integrity replay.
    ExportBrowser {
        /// Registry-qualified immutable reference of a locally acquired release.
        reference: String,
        /// New project-child directory name; no existing file or directory is replaced.
        #[arg(long)]
        output: PathBuf,
    },
    /// Compare immutable browser bytes at an explicit HTTPS base; integrity only.
    VerifyBrowserPublication {
        /// Registry-qualified immutable reference of a locally acquired release.
        reference: String,
        /// Canonical HTTPS base including a trailing slash; redirects are rejected.
        #[arg(long)]
        url: String,
    },
    /// Replay the complete release signature closure from stored OCI evidence.
    VerifyRelease {
        /// Registry-qualified immutable reference.
        reference: String,
    },
    /// Execute the complete SDK conformance and diagnostic corpus for one release.
    Conformance {
        /// Registry-qualified immutable reference of the release under acceptance.
        reference: String,
    },
    /// Push an already verified OCI graph; never rebuild.
    Push {
        /// Registry-qualified immutable reference.
        reference: String,
    },
    /// Pull and verify an immutable OCI graph into the local store.
    Pull {
        /// Registry-qualified immutable reference.
        reference: String,
    },
    /// Derive SDK-owned production signing policy from release provenance and CI identity.
    PreparePromotion {
        /// Registry-qualified immutable reference.
        reference: String,
        /// Protected GitHub deployment environment authorizing release promotion.
        #[arg(long)]
        environment: String,
    },
    /// Sign, verify, and attach a release signature using GitHub Actions OIDC.
    Sign {
        /// Registry-qualified immutable reference.
        reference: String,
        /// Canonical Sigstore trusted-root JSON bound by the policy.
        #[arg(long)]
        trusted_root: PathBuf,
        /// Canonical closed production promotion-policy JSON.
        #[arg(long)]
        policy: PathBuf,
    },
    /// Sign and verify one exact attached deployment-evidence document.
    SignEvidence {
        /// Registry-qualified immutable release reference.
        reference: String,
        /// Sign the closed set of all currently attached deployment evidence.
        #[arg(long)]
        all: bool,
        /// Canonical Sigstore trusted-root JSON bound by the policy.
        #[arg(long)]
        trusted_root: PathBuf,
        /// Canonical closed production promotion-policy JSON.
        #[arg(long)]
        policy: PathBuf,
    },
    /// Cryptographically verify and attach a Cosign signature for one exact release.
    VerifySignature {
        /// Registry-qualified immutable reference.
        reference: String,
        /// Standard Cosign v0.3 Sigstore bundle for the local root manifest.
        #[arg(long)]
        bundle: PathBuf,
        /// Canonical Sigstore trusted-root JSON bound by the policy.
        #[arg(long)]
        trusted_root: PathBuf,
        /// Canonical closed production promotion-policy JSON.
        #[arg(long)]
        policy: PathBuf,
    },
    /// Sign and attach the next allowed production promotion transition.
    Promote {
        /// Registry-qualified immutable reference.
        reference: String,
        /// Immediate destination status: candidate or accepted.
        #[arg(long, value_enum)]
        to: PromotionDestination,
        /// Canonical Sigstore trusted-root JSON bound by the policy.
        #[arg(long)]
        trusted_root: PathBuf,
        /// Canonical closed production promotion-policy JSON.
        #[arg(long)]
        policy: PathBuf,
    },
    /// Run an immutable release locally through its modeled Compose target.
    Run {
        /// Registry-qualified immutable reference.
        reference: String,
        /// Modeled target ID.
        #[arg(long, default_value = "compose-local")]
        target: String,
        /// Leave the ready Compose deployment running and return immediately.
        #[arg(long)]
        detach: bool,
    },
    /// Produce a deterministic target-state-bound deployment plan.
    Plan {
        /// Registry-qualified immutable reference.
        reference: String,
        /// Modeled target ID.
        #[arg(long)]
        target: String,
    },
    /// Deploy an immutable release through its modeled target adapter.
    Deploy {
        /// Registry-qualified immutable reference.
        reference: String,
        /// Modeled target ID.
        #[arg(long)]
        target: String,
        /// Previously emitted plan digest; target-state changes invalidate it.
        #[arg(long)]
        plan: Option<String>,
    },
    /// Capture a complete logical snapshot from a ready modeled deployment.
    Backup {
        /// Registry-qualified immutable reference.
        reference: String,
        /// Modeled target ID.
        #[arg(long)]
        target: String,
    },
    /// Restore and prove a pending backup in a distinct clean target.
    Restore {
        /// Registry-qualified immutable reference.
        reference: String,
        /// Source target recorded by the backup.
        #[arg(long)]
        target: String,
        /// Distinct clean target in which recovery is proved.
        #[arg(long)]
        restore_target: String,
        /// Canonical pending-backup metadata file.
        #[arg(long)]
        backup: PathBuf,
    },
    /// Inspect desired, applied, and observed deployment identities.
    Status {
        /// Registry-qualified immutable reference.
        reference: String,
        /// Modeled target ID.
        #[arg(long)]
        target: String,
    },
    /// Roll back to the preceding accepted release without rebuilding.
    Rollback {
        /// Registry-qualified immutable reference of the preceding release.
        reference: String,
        /// Modeled target ID.
        #[arg(long)]
        target: String,
    },
    /// Explicitly retire and remove a modeled deployment.
    Destroy {
        /// Registry-qualified immutable reference.
        reference: String,
        /// Modeled target ID.
        #[arg(long)]
        target: String,
        /// Confirm that the separately protected destructive operation is authorized.
        #[arg(long)]
        authorized: bool,
    },
    /// Internal attachment of independently executed, digest-bound acceptance evidence.
    #[command(hide = true)]
    Acceptance {
        /// Registry-qualified immutable reference of the tested release.
        reference: String,
        /// Canonical production-acceptance document produced after executing the matrix.
        #[arg(long)]
        input: PathBuf,
    },
    /// Finalize the protected contract migration after the compatibility window.
    FinalizeContract {
        /// Registry-qualified immutable release whose data contract is finalized.
        reference: String,
        /// Modeled target ID.
        #[arg(long)]
        target: String,
        /// Confirm protected-environment authorization for the destructive boundary.
        #[arg(long)]
        authorized: bool,
    },
    /// Check or propose updates to the UOR template bootstrap contract.
    Template {
        /// Template contract operation.
        #[command(subcommand)]
        command: TemplateCommands,
    },
    /// Verify model through Lean, leanchecker, LCNF, and generated Rust.
    Verify,
    /// Remove only the configured Prism output root.
    Clean,
    /// Internal digest-bound data-oracle entrypoint.
    #[command(hide = true)]
    Oracle {
        /// Registered built-in oracle profile.
        profile: String,
        /// Exact input file.
        input: PathBuf,
    },
}

/// Supported native shell-completion formats.
#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum CompletionShell {
    /// Bourne Again Shell.
    Bash,
    /// Friendly Interactive Shell.
    Fish,
    /// Z shell.
    Zsh,
}

/// Closed production promotion destinations.
#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum PromotionDestination {
    /// First hosted, signed release-candidate status.
    Candidate,
    /// Production-accepted status after candidate acceptance.
    Accepted,
}

impl PromotionDestination {
    fn as_str(self) -> &'static str {
        match self {
            Self::Candidate => "candidate",
            Self::Accepted => "accepted",
        }
    }
}

/// Immutable SDK-lock operations.
#[derive(Subcommand, Debug)]
pub enum LockCommands {
    /// Verify the committed lock and print its canonical value.
    Check,
    /// Propose an explicit legacy-to-platform lock migration without adoption.
    Migrate {
        /// Immutable target SDK manifest-list reference.
        #[arg(long)]
        sdk_image: String,
        /// Exact target standards.lock digest.
        #[arg(long)]
        standards_lock: String,
    },
    /// Propose, but do not apply, an exact SDK and standards-lock update.
    Update {
        /// Immutable SDK manifest-list reference.
        #[arg(long)]
        sdk_image: String,
        /// Canonical standards.lock digest.
        #[arg(long)]
        standards_lock: String,
    },
}

/// UOR template-contract operations.
#[derive(Subcommand, Debug)]
pub enum TemplateCommands {
    /// Verify the local template lock and bootstrap paths without changes.
    Check,
    /// Emit a reviewable template-lock patch without applying it.
    Update {
        /// Immutable SDK image identity.
        #[arg(long)]
        sdk_image: String,
        /// Full immutable UOR template commit.
        #[arg(long)]
        template_revision: String,
    },
}

/// Immutable standards authority lifecycle operations.
#[derive(Subcommand, Debug)]
pub enum AuthorityCommands {
    /// Resolve the reviewed catalog into standards.lock.
    Resolve {
        /// Compare only; never rewrite a missing or changed lock.
        #[arg(long)]
        locked: bool,
    },
    /// Inspect the canonical lock without executing content.
    Inspect,
    /// Verify the populated immutable cache with no network operation.
    Verify,
}

fn canonical<T: Serialize>(value: &T) -> Result<Vec<u8>, PrismError> {
    let value = serde_json::to_value(value)
        .map_err(|error| PrismError::new("PP9001", format!("serialize CLI result: {error}")))?;
    encode_value(&value)
}

fn confined_input(root: &Path, relative: &Path) -> Result<PathBuf, PrismError> {
    if relative.is_absolute()
        || relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(PrismError::new(
            "PP7401",
            "signature policy inputs must be confined project-relative paths",
        ));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|error| PrismError::new("PP7401", format!("resolve project root: {error}")))?;
    let input = root.join(relative);
    let resolved = input.canonicalize().map_err(|error| {
        PrismError::new("PP7401", format!("resolve signature policy input: {error}"))
    })?;
    if !resolved.starts_with(&canonical_root) {
        return Err(PrismError::new(
            "PP7401",
            "signature policy input resolves outside the project root",
        ));
    }
    Ok(resolved)
}

fn write_line(mut stream: impl Write, bytes: &[u8]) -> Result<(), PrismError> {
    stream
        .write_all(bytes)
        .and_then(|()| stream.write_all(b"\n"))
        .map_err(|error| PrismError::new("PP9001", format!("write CLI output: {error}")))
}

fn completion(shell: CompletionShell) -> Result<String, PrismError> {
    let command = Cli::command();
    let names = command
        .get_subcommands()
        .filter(|command| !command.is_hide_set())
        .map(|command| command.get_name())
        .collect::<Vec<_>>();
    let registry: toml::Value = toml::from_str(include_str!("../model/commands.toml"))
        .map_err(|error| PrismError::new("PP9001", format!("command contract: {error}")))?;
    let mut registered = registry["command"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| row["name"].as_str())
        .collect::<Vec<_>>();
    registered.sort_unstable();
    let mut actual = names.clone();
    actual.sort_unstable();
    if actual != registered {
        return Err(PrismError::new(
            "PP9001",
            "executable commands disagree with model/commands.toml",
        ));
    }
    let words = names.join(" ");
    Ok(match shell {
        CompletionShell::Bash => format!(
            "_prismpm() {{ COMPREPLY=( $(compgen -W '{words}' -- \"${{COMP_WORDS[1]}}\") ); }}\ncomplete -F _prismpm prismpm"
        ),
        CompletionShell::Fish => names
            .iter()
            .map(|name| format!("complete -c prismpm -n '__fish_use_subcommand' -a '{name}'"))
            .collect::<Vec<_>>()
            .join("\n"),
        CompletionShell::Zsh => format!(
            "#compdef prismpm\n_arguments '1:command:(({words}))' '*::argument:->args'"
        ),
    })
}

fn execute(cli: &Cli) -> Result<(serde_json::Value, String), PrismError> {
    crate::sdk::verify_environment()?;
    if let Commands::Completion { shell } = &cli.command {
        let script = completion(*shell)?;
        return Ok((
            json!({"schema":"prismpm/completion-result/1","script":script,"shell":format!("{shell:?}").to_ascii_lowercase()}),
            script,
        ));
    }
    let context = match &cli.command {
        Commands::Build { context, .. } => context.as_deref(),
        _ => None,
    };
    if cli.project.is_some() && context.is_some() {
        return Err(PrismError::new(
            "PP1001",
            "use either --project or a build context, not both",
        ));
    }
    let root = context
        .or(cli.project.as_deref())
        .unwrap_or_else(|| Path::new("."));
    // Migration reads the old lock as historical evidence, not permission to
    // execute that project's model under this SDK. Environment verification
    // above still applies; all ordinary commands retain Controller admission.
    if let Commands::Lock {
        command:
            LockCommands::Migrate {
                sdk_image,
                standards_lock,
            },
    } = &cli.command
    {
        let result = crate::sdk::propose_lock_migration(root, sdk_image, standards_lock)?;
        return Ok((
            result,
            "reviewable SDK-lock migration generated; not adopted".to_owned(),
        ));
    }
    let controller = Controller::load(root)?;
    match &cli.command {
        Commands::Completion { .. } => unreachable!("completion returns before project loading"),
        Commands::Lock { command } => match command {
            LockCommands::Migrate { .. } => {
                unreachable!("migration returns before project loading")
            }
            LockCommands::Check => {
                let result = crate::sdk::inspect_lock(&controller.root)?;
                Ok((result, "SDK lock is canonical and valid".to_owned()))
            }
            LockCommands::Update {
                sdk_image,
                standards_lock,
            } => {
                let result =
                    crate::sdk::propose_lock_update(&controller.root, sdk_image, standards_lock)?;
                Ok((result, "reviewable SDK-lock update generated".to_owned()))
            }
        },
        Commands::Authority { command } => match command {
            AuthorityCommands::Resolve { locked } => {
                let result = crate::authority::resolve(&controller.root, *locked)?;
                let human = format!("standards lock resolved: {}", result.lock_digest);
                Ok((
                    serde_json::to_value(result)
                        .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                    human,
                ))
            }
            AuthorityCommands::Inspect => {
                let result = crate::authority::inspect(&controller.root)?;
                Ok((result, "standards lock is valid".to_owned()))
            }
            AuthorityCommands::Verify => {
                let result = crate::authority::verify(&controller.root)?;
                let human = format!("authorities verified: {}", result.attestation_digest);
                Ok((
                    serde_json::to_value(result)
                        .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                    human,
                ))
            }
        },
        Commands::Fetch { locked } => {
            if !locked {
                return Err(PrismError::new(
                    "PP1101",
                    "fetch requires --locked so acquisition cannot change resolution",
                ));
            }
            crate::authority::resolve(&controller.root, true)?;
            let result = crate::authority::fetch(&controller.root)?;
            crate::sdk::install_project_inputs(&controller.root)?;
            let dependency_fetches = crate::sdk::fetch_project_dependencies(&controller.root)?;
            let system_values = controller
                .production_systems()?
                .iter()
                .map(|document| document.value().clone())
                .collect::<Vec<_>>();
            let image_advisories =
                crate::supply_chain::fetch_image_advisories(&controller.root, &system_values)?;
            let human = format!(
                "locked cache ready: {} fetched, {} reused, {} project dependency fetches, {} image advisory scans",
                result.fetched,
                result.reused,
                dependency_fetches.len(),
                image_advisories.len()
            );
            let mut value = serde_json::to_value(result)
                .map_err(|error| PrismError::new("PP9001", error.to_string()))?;
            value
                .as_object_mut()
                .ok_or_else(|| PrismError::new("PP9001", "fetch result is not an object"))?
                .insert(
                    "dependency_fetches".to_owned(),
                    serde_json::Value::Array(dependency_fetches),
                );
            value.as_object_mut().expect("fetch result object").insert(
                "image_advisories".to_owned(),
                serde_json::Value::Array(image_advisories),
            );
            Ok((value, human))
        }
        Commands::Check => {
            let result = controller.check(CheckRequest {
                config_path: cli.config.clone(),
            })?;
            let human = format!("check passed (semantic ID: {})", result.semantic_id);
            Ok((
                serde_json::to_value(result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                human,
            ))
        }
        Commands::Build {
            tag,
            locked,
            release,
            ..
        } => {
            if let Some(reference) = tag {
                let result = controller.product_build(ProductBuildRequest {
                    config_path: cli.config.clone(),
                    reference: reference.clone(),
                    locked: *locked,
                    release: release.clone(),
                })?;
                let human = format!("product release built: {}", result.release_digest);
                Ok((
                    serde_json::to_value(result)
                        .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                    human,
                ))
            } else {
                if *locked {
                    return Err(PrismError::new(
                        "PP1001",
                        "--locked requires -t for a product release build",
                    ));
                }
                let result = controller.build_release(
                    BuildRequest {
                        config_path: cli.config.clone(),
                    },
                    release.as_deref(),
                )?;
                let human = format!("build published: {}", result.build_id);
                Ok((
                    serde_json::to_value(result)
                        .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                    human,
                ))
            }
        }
        Commands::Inspect { reference } => {
            let result = crate::oci::inspect(&controller.root, reference)?;
            Ok((result, format!("verified local release: {reference}")))
        }
        Commands::ExportBrowser { reference, output } => {
            let result = controller.export_browser(ExportBrowserRequest {
                reference: reference.clone(),
                output: output.clone(),
            })?;
            Ok((
                result,
                format!(
                    "browser artifacts exported: {} (integrity only)",
                    output.display()
                ),
            ))
        }
        Commands::VerifyBrowserPublication { reference, url } => {
            let result =
                controller.verify_browser_publication(VerifyBrowserPublicationRequest {
                    reference: reference.clone(),
                    url: url.clone(),
                })?;
            Ok((
                result,
                format!("browser publication bytes match: {url} (integrity only)"),
            ))
        }
        Commands::VerifyRelease { reference } => {
            let digest = crate::oci::validate_reference(reference, true)?;
            let result = crate::supply_chain::verify_release_trust(&controller.root, digest)?;
            Ok((
                result,
                format!("release signature closure verified: {digest}"),
            ))
        }
        Commands::Push { reference } => {
            let result = crate::oci::push(&controller.root, reference)?;
            Ok((
                serde_json::to_value(&result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                format!("product release pushed: {}", result.release_digest),
            ))
        }
        Commands::Pull { reference } => {
            let result = crate::oci::pull(&controller.root, reference)?;
            Ok((
                serde_json::to_value(&result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                format!("product release pulled: {}", result.release_digest),
            ))
        }
        Commands::PreparePromotion {
            reference,
            environment,
        } => {
            let digest = crate::oci::validate_reference(reference, true)?;
            let result =
                crate::supply_chain::prepare_promotion(&controller.root, digest, environment)?;
            Ok((
                serde_json::to_value(&result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                format!("production promotion policy prepared for {digest}"),
            ))
        }
        Commands::Sign {
            reference,
            trusted_root,
            policy,
        } => {
            let digest = crate::oci::validate_reference(reference, true)?;
            let trusted_root = confined_input(&controller.root, trusted_root)?;
            let policy = crate::supply_chain::load_promotion_policy(&confined_input(
                &controller.root,
                policy,
            )?)?;
            let result = crate::supply_chain::sign_release(
                &controller.root,
                digest,
                &trusted_root,
                &policy,
            )?;
            Ok((
                serde_json::to_value(&result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                format!("release signed and verified: {}", result.release_digest),
            ))
        }
        Commands::SignEvidence {
            reference,
            all,
            trusted_root,
            policy,
        } => {
            if !all {
                return Err(PrismError::new(
                    "PP7401",
                    "sign-evidence requires --all so no attached deployment evidence is omitted",
                ));
            }
            let digest = crate::oci::validate_reference(reference, true)?;
            let trusted_root = confined_input(&controller.root, trusted_root)?;
            let policy = crate::supply_chain::load_promotion_policy(&confined_input(
                &controller.root,
                policy,
            )?)?;
            let result = crate::supply_chain::sign_deployment_evidence(
                &controller.root,
                digest,
                &trusted_root,
                &policy,
            )?;
            Ok((
                serde_json::to_value(&result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                format!(
                    "{} deployment evidence documents signed and verified",
                    result.evidence_count
                ),
            ))
        }
        Commands::VerifySignature {
            reference,
            bundle,
            trusted_root,
            policy,
        } => {
            let digest = crate::oci::validate_reference(reference, true)?;
            let bundle = confined_input(&controller.root, bundle)?;
            let trusted_root = confined_input(&controller.root, trusted_root)?;
            let policy = crate::supply_chain::load_promotion_policy(&confined_input(
                &controller.root,
                policy,
            )?)?;
            let result = crate::supply_chain::verify_release_signature(
                &controller.root,
                digest,
                &bundle,
                &trusted_root,
                &policy,
            )?;
            Ok((
                serde_json::to_value(&result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                format!("release signature verified: {}", result.release_digest),
            ))
        }
        Commands::Promote {
            reference,
            to,
            trusted_root,
            policy,
        } => {
            let digest = crate::oci::validate_reference(reference, true)?;
            let trusted_root = confined_input(&controller.root, trusted_root)?;
            let policy = crate::supply_chain::load_promotion_policy(&confined_input(
                &controller.root,
                policy,
            )?)?;
            let result = crate::supply_chain::promote_release(
                &controller.root,
                digest,
                to.as_str(),
                &trusted_root,
                &policy,
            )?;
            Ok((
                serde_json::to_value(&result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                format!("release promoted from {} to {}", result.from, result.to),
            ))
        }
        Commands::Run {
            reference,
            target,
            detach,
        } => {
            let result = crate::lifecycle::run(&controller.root, reference, target, *detach)?;
            Ok((result, format!("release running on target {target}")))
        }
        Commands::Plan { reference, target } => {
            let result = crate::lifecycle::plan(&controller.root, reference, target)?;
            Ok((
                serde_json::to_value(&result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                format!("deployment plan: {}", result.plan_digest),
            ))
        }
        Commands::Deploy {
            reference,
            target,
            plan,
        } => {
            let result = crate::lifecycle::deploy_planned(
                &controller.root,
                reference,
                target,
                plan.as_deref(),
            )?;
            Ok((result, format!("release deployed to {target}")))
        }
        Commands::Backup { reference, target } => {
            let result = crate::lifecycle::backup(&controller.root, reference, target)?;
            Ok((result, format!("pending backup captured from {target}")))
        }
        Commands::Restore {
            reference,
            target,
            restore_target,
            backup,
        } => {
            let result = crate::lifecycle::restore(
                &controller.root,
                reference,
                target,
                restore_target,
                backup,
            )?;
            Ok((
                result,
                format!("backup restored and accepted on {restore_target}"),
            ))
        }
        Commands::Status { reference, target } => {
            let result = crate::lifecycle::status(&controller.root, reference, target)?;
            Ok((result, format!("deployment state for {target}")))
        }
        Commands::Rollback { reference, target } => {
            let result = crate::lifecycle::rollback(&controller.root, reference, target)?;
            Ok((result, format!("deployment rolled back on {target}")))
        }
        Commands::Destroy {
            reference,
            target,
            authorized,
        } => {
            let result =
                crate::lifecycle::destroy(&controller.root, reference, target, *authorized)?;
            Ok((result, format!("deployment destroyed on {target}")))
        }
        Commands::Conformance { reference } => {
            let result = crate::acceptance::run(&controller.root, reference)?;
            Ok((result, "production conformance accepted".to_owned()))
        }
        Commands::Acceptance { reference, input } => {
            let input = confined_input(&controller.root, input)?;
            let result = crate::acceptance::attach(&controller.root, reference, &input)?;
            Ok((result, "production acceptance evidence attached".to_owned()))
        }
        Commands::FinalizeContract {
            reference,
            target,
            authorized,
        } => {
            let result = crate::lifecycle::finalize_contract(
                &controller.root,
                reference,
                target,
                *authorized,
            )?;
            Ok((
                result,
                format!("data contract finalized on target {target}"),
            ))
        }
        Commands::Template { command } => match command {
            TemplateCommands::Check => {
                let result = crate::template::check(&controller.root)?;
                Ok((result, "template contract passed".to_owned()))
            }
            TemplateCommands::Update {
                sdk_image,
                template_revision,
            } => {
                let result =
                    crate::template::update(&controller.root, sdk_image, template_revision)?;
                Ok((result, "template update patch generated".to_owned()))
            }
        },
        Commands::Verify => {
            let result = controller.verify(VerifyRequest {
                config_path: cli.config.clone(),
            })?;
            let human = format!("verified attestation: {}", result.attestation_id);
            Ok((
                serde_json::to_value(result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                human,
            ))
        }
        Commands::Clean => {
            let result = controller.clean(CleanRequest {
                config_path: cli.config.clone(),
            })?;
            Ok((
                serde_json::to_value(result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                "Prism output removed".to_owned(),
            ))
        }
        Commands::Oracle { profile, input } => {
            let confined = if input.is_absolute() {
                input.clone()
            } else {
                controller.root.join(input)
            };
            let result =
                crate::authority::run_oracle_in_project(&controller.root, profile, &confined)?;
            Ok((
                serde_json::to_value(result)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                "oracle accepted subject".to_owned(),
            ))
        }
    }
}

/// Parse process arguments, execute one command, and emit stable output.
#[must_use]
pub fn run() -> ExitCode {
    let machine_requested = std::env::args().any(|argument| argument == "--json");
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) => {
            if matches!(
                error.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) {
                let _ = error.print();
                return ExitCode::SUCCESS;
            }
            if machine_requested {
                let diagnostic = PrismError::new("PP1001", error.to_string());
                let envelope =
                    json!({"diagnostic": diagnostic, "schema": "prismpm/error-result/1"});
                let bytes = canonical(&envelope)
                    .unwrap_or_else(|_| b"{\"schema\":\"prismpm/error-result/1\"}".to_vec());
                let _ = write_line(std::io::stdout().lock(), &bytes);
                return ExitCode::from(2);
            }
            let _ = error.print();
            return ExitCode::from(2);
        }
    };

    match crate::process_resources::configure().and_then(|()| execute(&cli)) {
        Ok((value, human)) => {
            let result = if cli.json {
                canonical(&value).and_then(|bytes| write_line(std::io::stdout().lock(), &bytes))
            } else {
                write_line(std::io::stdout().lock(), human.as_bytes())
            };
            match result {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => ExitCode::from(error.exit_code()),
            }
        }
        Err(error) => {
            let exit = error.exit_code();
            if cli.json {
                let envelope = json!({"diagnostic": error, "schema": "prismpm/error-result/1"});
                match canonical(&envelope) {
                    Ok(bytes) => {
                        let _ = write_line(std::io::stdout().lock(), &bytes);
                    }
                    Err(fallback) => {
                        let _ = writeln!(std::io::stderr().lock(), "{fallback}");
                    }
                }
            } else {
                let _ = writeln!(std::io::stderr().lock(), "{error}");
            }
            ExitCode::from(exit)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Cli, Commands};
    use clap::Parser;

    #[test]
    fn browser_publication_requires_explicit_target_without_trust_bypass_flags() {
        let reference = format!("example.test/product@sha256:{}", "a".repeat(64));
        assert!(Cli::try_parse_from([
            "prismpm",
            "verify-browser-publication",
            &reference,
            "--url",
            "https://example.test/foundry-web/",
        ])
        .is_ok());
        assert!(
            Cli::try_parse_from(["prismpm", "verify-browser-publication", &reference,]).is_err()
        );
        for flag in [
            "--insecure",
            "--cacert",
            "--receipt",
            "--follow",
            "--accept",
            "--skip-verify",
        ] {
            assert!(Cli::try_parse_from([
                "prismpm",
                "verify-browser-publication",
                &reference,
                "--url",
                "https://example.test/foundry-web/",
                flag,
            ])
            .is_err());
        }
    }

    #[test]
    fn browser_export_has_no_build_or_publication_bypass_flags() {
        let reference = format!("example.test/product@sha256:{}", "a".repeat(64));
        let cli = Cli::try_parse_from([
            "prismpm",
            "--json",
            "export-browser",
            &reference,
            "--output",
            "site",
        ])
        .unwrap();
        assert!(matches!(cli.command, Commands::ExportBrowser { .. }));
        assert!(Cli::try_parse_from(["prismpm", "export-browser", &reference]).is_err());
        for flag in [
            "--force",
            "--skip-verify",
            "--accept",
            "--build",
            "--deploy",
        ] {
            assert!(Cli::try_parse_from([
                "prismpm",
                "export-browser",
                &reference,
                "--output",
                "site",
                flag,
            ])
            .is_err());
        }
        let root = tempfile::tempdir().unwrap();
        let cli = Cli::try_parse_from([
            "prismpm",
            "--project",
            root.path().to_str().unwrap(),
            "--json",
            "export-browser",
            &reference,
            "--output",
            "site",
        ])
        .unwrap();
        assert_eq!(super::execute(&cli).unwrap_err().code, "PP6101");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }

    #[test]
    fn run_is_foreground_by_default_and_detach_is_explicit() {
        let foreground = Cli::try_parse_from([
            "prismpm",
            "run",
            "ghcr.io/uor/example@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ])
        .unwrap();
        assert!(matches!(
            foreground.command,
            Commands::Run { detach: false, .. }
        ));
        let detached = Cli::try_parse_from([
            "prismpm",
            "run",
            "ghcr.io/uor/example@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "--detach",
        ])
        .unwrap();
        assert!(matches!(
            detached.command,
            Commands::Run { detach: true, .. }
        ));
    }

    #[test]
    fn signature_and_promotion_inputs_are_explicit() {
        let reference =
            "ghcr.io/uor/example@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let verify = Cli::try_parse_from([
            "prismpm",
            "verify-signature",
            reference,
            "--bundle",
            "evidence/release.sigstore.json",
            "--trusted-root",
            "policy/trusted-root.json",
            "--policy",
            "policy/promotion.json",
        ])
        .unwrap();
        assert!(matches!(verify.command, Commands::VerifySignature { .. }));
        let sign = Cli::try_parse_from([
            "prismpm",
            "sign",
            reference,
            "--trusted-root",
            "policy/trusted-root.json",
            "--policy",
            "policy/promotion.json",
        ])
        .unwrap();
        assert!(matches!(sign.command, Commands::Sign { .. }));
        let sign_evidence = Cli::try_parse_from([
            "prismpm",
            "sign-evidence",
            reference,
            "--all",
            "--trusted-root",
            "policy/trusted-root.json",
            "--policy",
            "policy/promotion.json",
        ])
        .unwrap();
        assert!(matches!(
            sign_evidence.command,
            Commands::SignEvidence { .. }
        ));
        let promote = Cli::try_parse_from([
            "prismpm",
            "promote",
            reference,
            "--to",
            "candidate",
            "--trusted-root",
            "policy/trusted-root.json",
            "--policy",
            "policy/promotion.json",
        ])
        .unwrap();
        assert!(matches!(promote.command, Commands::Promote { .. }));
        let prepare = Cli::try_parse_from([
            "prismpm",
            "prepare-promotion",
            reference,
            "--environment",
            "production-release",
        ])
        .unwrap();
        assert!(matches!(prepare.command, Commands::PreparePromotion { .. }));
    }
}
