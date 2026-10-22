//! Private, unaccepted browser compiler output. No public build bypass.

mod plan;
#[cfg(test)]
mod tests;
mod toolchain;

use crate::error::PrismError;
use crate::holo::application::project_application;
use crate::holo::canonical::{encode_canonical, encode_value};
use crate::holo::model_document::Application;
use crate::library_build::{regular_bytes, sha256, validate_export_identity, write};
use crate::verification::{executable, run_process, ProcessRecord};
use lexlean::{CheckRequest, Engine, Selection, VerifyRequest};
use plan::Plan;
use prod_codegen::{
    generate_cargo_package, generate_core_wasm_package, CargoPackageSpec, CoreWasmSpec,
    GeneratedPackage,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

// The sole future integration entry point remains private while PP2011 blocks
// every public build. Its complete source/compiler owning tests call it directly.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "private compiler prerequisite; public runtime remains unavailable"
    )
)]
fn compile(project: &Path) -> Result<Compilation, PrismError> {
    compile_inner(project)
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "private compiler result is consumed only by its owning prerequisite gate"
    )
)]
struct Compilation {
    plan: Plan,
    files: BTreeMap<String, Vec<u8>>,
    processes: Vec<ProcessRecord>,
}

fn invalid(message: impl Into<String>) -> PrismError {
    PrismError::new("PP5004", message)
}

fn lexlean_error(error: lexlean::LexLeanError) -> PrismError {
    PrismError::from_lexlean(
        "PP5004",
        "browser compiler source verification failed",
        error,
        256,
    )
}

fn json_bytes(value: &impl serde::Serialize) -> Result<Vec<u8>, PrismError> {
    encode_value(&serde_json::to_value(value).map_err(|e| invalid(e.to_string()))?)
}

fn decode(bytes: &[u8]) -> Result<Value, PrismError> {
    serde_json::from_slice(bytes).map_err(|e| invalid(e.to_string()))
}

fn add(
    files: &mut BTreeMap<String, Vec<u8>>,
    path: String,
    bytes: Vec<u8>,
) -> Result<(), PrismError> {
    plan::relative(&path)?;
    if files.insert(path, bytes).is_some() {
        return Err(invalid("browser compiler artifact path is duplicated"));
    }
    Ok(())
}

fn package(
    files: &mut BTreeMap<String, Vec<u8>>,
    work: &Path,
    prefix: &str,
    generated: GeneratedPackage,
) -> Result<(), PrismError> {
    for file in generated.files {
        plan::relative(&file.path)?;
        let path = format!("{prefix}/{}", file.path);
        write(&work.join(&path), &file.bytes)?;
        add(files, path, file.bytes)?;
    }
    Ok(())
}

fn freeze_source(
    project: &Path,
    snapshot: &lexlean::SemanticSnapshot,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<(), PrismError> {
    for module in snapshot.modules() {
        let source = module.source();
        let bytes = regular_bytes(project, source.path())?;
        let normalized = lexlean::source::normalize::normalize(source.path(), &bytes, false)
            .map_err(|_| invalid("browser source normalization differs from its snapshot"))?
            .text
            .into_bytes();
        if sha256(&normalized) != source.sha256().to_string() {
            return Err(invalid("browser source changed after checked snapshot"));
        }
        add(
            files,
            format!("source/project/{}", source.path()),
            normalized,
        )?;
        add(files, format!("source/original/{}", source.path()), bytes)?;
    }
    Ok(())
}

fn compile_inner(project: &Path) -> Result<Compilation, PrismError> {
    if project.canonicalize().ok().as_deref() != Some(project) {
        return Err(invalid("browser compiler project must be canonical"));
    }
    let tools = toolchain::resolve(project)?;
    let configuration = camino::Utf8PathBuf::from_path_buf(project.join("lexlean.toml"))
        .map_err(|_| invalid("browser compiler project path is not UTF-8"))?;
    let engine = Engine::load(&configuration).map_err(lexlean_error)?;
    let snapshot = engine
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .map_err(lexlean_error)?;
    let model = project_application(&snapshot)?
        .ok_or_else(|| invalid("browser compiler requires a checked application"))?;
    let Some(Application::Browser(application)) = &model.application else {
        return Err(invalid(
            "browser compiler cannot reinterpret another application profile",
        ));
    };
    let model_bytes = encode_canonical(&model)?;
    let plan = Plan::new(application, &model_bytes)?;
    let mut files = BTreeMap::new();
    add(&mut files, "source/model.json".into(), model_bytes)?;
    add(
        &mut files,
        "source/snapshot.json".into(),
        snapshot.canonical_bytes(),
    )?;
    freeze_source(project, &snapshot, &mut files)?;
    let verified = engine
        .verify(VerifyRequest {
            selection: Selection::Entrypoints,
        })
        .map_err(lexlean_error)?;
    if verified.source_id != snapshot.source_id() || verified.semantic_id != snapshot.semantic_id()
    {
        return Err(invalid(
            "browser verification differs from its checked source",
        ));
    }
    let root = verified
        .root
        .as_std_path()
        .canonicalize()
        .map_err(|e| invalid(e.to_string()))?;
    let manifest_bytes = regular_bytes(&root, "build-manifest.json")?;
    let attestation_bytes = regular_bytes(&root, "attestation.json")?;
    let manifest = decode(&manifest_bytes)?;
    let attestation = decode(&attestation_bytes)?;
    if attestation["status"] != "verified"
        || attestation["source_id"] != snapshot.source_id().to_string()
        || attestation["semantic_id"] != snapshot.semantic_id().to_string()
        || attestation["build_id"] != verified.build_id.to_string()
        || attestation["attestation_id"] != verified.attestation_id.to_string()
        || attestation["build_manifest"]["sha256"] != sha256(&manifest_bytes)
        || attestation["build_manifest"]["byte_length"].as_u64()
            != Some(manifest_bytes.len() as u64)
        || manifest["source_id"] != snapshot.source_id().to_string()
        || manifest["semantic_id"] != snapshot.semantic_id().to_string()
        || manifest["build_id"] != verified.build_id.to_string()
    {
        return Err(invalid(
            "browser kernel attestation and generated source closure differ",
        ));
    }
    crate::library_verification::audit_declarations(
        &attestation,
        &decode(&snapshot.canonical_bytes())?,
    )?;
    add(
        &mut files,
        "source/build-manifest.json".into(),
        manifest_bytes,
    )?;
    add(
        &mut files,
        "source/attestation.json".into(),
        attestation_bytes,
    )?;
    let mut work = crate::exporter::directory::Directory::temporary(
        "prismpm-browser-compiler-",
        None,
        Default::default(),
    )?;
    let workspace_path = work.path().to_owned();
    let workspace = workspace_path.as_path();
    let mut modules = BTreeSet::new();
    let mut paths = BTreeSet::new();
    for output in manifest["outputs"]
        .as_array()
        .ok_or_else(|| invalid("browser generated output list is absent"))?
    {
        let path = output["path"]
            .as_str()
            .ok_or_else(|| invalid("browser generated path is absent"))?;
        if !paths.insert(path) {
            return Err(invalid("browser generated path is duplicated"));
        }
        let bytes = regular_bytes(&root, path)?;
        if output["sha256"] != sha256(&bytes)
            || output["byte_length"].as_u64() != Some(bytes.len() as u64)
        {
            return Err(invalid(
                "browser generated source differs from its verified manifest",
            ));
        }
        add(
            &mut files,
            format!("source/generated/{path}"),
            bytes.clone(),
        )?;
        if output["kind"] == "lean" {
            let relative = Path::new(path)
                .strip_prefix("modules")
                .map_err(|_| invalid("browser generated Lean is outside modules"))?;
            if relative.extension().and_then(|v| v.to_str()) != Some("lean") {
                return Err(invalid("browser generated Lean extension differs"));
            }
            write(&workspace.join(relative), &bytes)?;
            modules.insert(
                relative
                    .with_extension("")
                    .to_string_lossy()
                    .replace('/', "."),
            );
        }
    }
    let expected_modules = snapshot
        .modules()
        .iter()
        .map(|m| m.lean_module().to_owned())
        .collect::<BTreeSet<_>>();
    if modules.is_empty() || modules != expected_modules {
        return Err(invalid(
            "browser generated Lean does not cover every checked module",
        ));
    }
    write(
        &workspace.join("lakefile.toml"),
        crate::lean_project::configuration(
            "prismpm_browser_compiler",
            &modules.iter().cloned().collect::<Vec<_>>(),
        )
        .as_bytes(),
    )?;
    write(
        &workspace.join("lean-toolchain"),
        b"leanprover/lean4:v4.32.1\n",
    )?;
    let exporter = workspace.join("exporter");
    write(
        &workspace.join("rust-toolchain.toml"),
        toolchain::RUST_TOOLCHAIN_FILE,
    )?;
    let admitted = crate::exporter::acquire_for_owned(project, &exporter, work.scope())?;
    work.protect_package(&exporter, &admitted.snapshot)?;
    let exporter_acquisition = admitted.receipt;
    let replacements = [(workspace, "$BROWSER_COMPILER"), (project, "$PROJECT")];
    let lake = executable("lake")?;
    let cargo = &tools.cargo;
    let mut processes = tools.records;
    let compiler_env = tools.environment.clone();
    for (tool, directory, args) in [
        (
            "browser-generated-kernel",
            workspace,
            vec!["build".into(), "PrismGenerated".into()],
        ),
        (
            "browser-pinned-exporter",
            exporter.as_path(),
            vec!["build".into(), "prod-export".into()],
        ),
    ] {
        if tool == "browser-pinned-exporter" {
            crate::exporter::before_first_build(
                project,
                &exporter,
                &exporter_acquisition,
                &admitted.snapshot,
            )?;
        }
        processes.push(run_process(
            tool,
            &lake,
            &args,
            directory,
            &compiler_env,
            &replacements,
            "PP5004",
        )?);
    }
    let exported = workspace.join("export");
    let export_custody =
        crate::exporter::after_build(&exporter, &exporter_acquisition, &admitted.snapshot)?;
    let mut args = vec!["exe".into(), "prod-export".into()];
    for module in &modules {
        args.extend(["--module".into(), module.clone()]);
    }
    for root in &application.library_roots {
        args.extend(["--root".into(), root.clone()]);
    }
    args.extend([
        "--ir-module".into(),
        application.cargo_name.replace('-', "_"),
        "--out".into(),
        exported.to_string_lossy().into_owned(),
    ]);
    let mut export_env = compiler_env.clone();
    export_env.insert(
        "LEAN_PATH".into(),
        workspace
            .join(".lake/build/lib/lean")
            .to_string_lossy()
            .into_owned(),
    );
    processes.push(crate::exporter::run_export_with_custody(
        "browser-export",
        &lake,
        &args,
        &exporter,
        &export_env,
        &replacements,
        "PP5004",
        &exporter_acquisition,
        &export_custody,
    )?);
    let mut export = BTreeMap::new();
    for name in ["kernel.ir", "coverage.json", "roots.json"] {
        let bytes = regular_bytes(&exported, name)?;
        export.insert(name, bytes.clone());
        add(&mut files, format!("compiler/{name}"), bytes)?;
    }
    let ir = std::str::from_utf8(&export["kernel.ir"]).map_err(|e| invalid(e.to_string()))?;
    let module = crate::verification::parse_kernel(ir)?;
    validate_export_identity(
        &decode(&export["coverage.json"])?,
        &decode(&export["roots.json"])?,
        &module,
        &application.library_roots,
        &[],
    )?;
    let ir_hash = sha256(ir.as_bytes());
    let generated = generate_cargo_package(
        &module,
        &CargoPackageSpec {
            name: application.cargo_name.clone(),
            version: application.cargo_version.clone(),
            description: application.cargo_description.clone(),
            repository: application.cargo_repository.clone(),
            homepage: application.cargo_homepage.clone(),
            readme: "Unaccepted generated browser compiler output.\n".into(),
            license_mit: include_str!("../LICENSE-MIT").into(),
            license_apache: include_str!("../LICENSE-APACHE").into(),
            input_sha256: ir_hash.clone(),
            dependencies: Vec::new(),
        },
    )
    .map_err(|e| PrismError::new("PP4102", e.to_string()))?;
    package(&mut files, workspace, "native", generated)?;
    let cargo_home = workspace.join("cargo-home");
    std::fs::create_dir(&cargo_home).map_err(|e| invalid(e.to_string()))?;
    let mut cargo_env = tools.environment;
    cargo_env.extend([
        (
            "CARGO_HOME".into(),
            cargo_home.to_string_lossy().into_owned(),
        ),
        ("CARGO_NET_OFFLINE".into(), "true".into()),
    ]);
    for target in plan.targets.values() {
        let prefix = format!("guests/{}", target.id()?);
        let generated = generate_core_wasm_package(
            &module,
            &CoreWasmSpec {
                crate_name: "prism-browser-guest".into(),
                entry: target.leaf()?.into(),
                export_name: "holo_run".into(),
                input_allocation_cap: target.input_maximum,
                output_allocation_cap: target.output_maximum,
                maximum_pages: target.memory_pages,
                input_ir_sha256: ir_hash.clone(),
            },
        )
        .map_err(|e| PrismError::new("PP5101", e.to_string()))?;
        package(&mut files, workspace, &prefix, generated)?;
        let directory = workspace.join(&prefix);
        processes.push(run_process(
            "browser-core-wasm",
            cargo,
            &["build", "--locked", "--offline", "--release"].map(str::to_owned),
            &directory,
            &cargo_env,
            &replacements,
            "PP5101",
        )?);
        let wasm = regular_bytes(
            &directory.join("target/wasm32-unknown-unknown/release"),
            "prism_browser_guest.wasm",
        )?;
        add(&mut files, format!("{prefix}/core.wasm"), wasm)?;
    }
    // No caller-controlled profile/model or source change may be adopted after
    // verification. This is byte binding, not authentication of its producer.
    let after = engine
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .map_err(lexlean_error)?;
    if after != snapshot {
        return Err(invalid("browser source changed during compilation"));
    }
    let mut source_again = BTreeMap::new();
    freeze_source(project, &snapshot, &mut source_again)?;
    if source_again
        .iter()
        .any(|(path, bytes)| files.get(path) != Some(bytes))
    {
        return Err(invalid(
            "browser original source bytes changed during compilation",
        ));
    }
    add(
        &mut files,
        "compiler/policy.json".into(),
        Plan::requested_policy(application)?,
    )?;
    add(&mut files, "compiler/toolchain.json".into(), tools.binding)?;
    let binding = plan.binding(&files)?;
    add(&mut files, "compiler/binding.json".into(), binding)?;
    plan.validate(&files)?;
    work.protect_verified_package(&exporter, &export_custody)?;
    work.close()?;
    Ok(Compilation {
        plan,
        files,
        processes,
    })
}
