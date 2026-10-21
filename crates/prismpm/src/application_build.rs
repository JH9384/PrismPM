//! Generic production pipeline for a closed Prism application value.

use crate::error::PrismError;
use crate::holo::archive::{compose_application, ApplicationArchiveInput, ArchiveProvenance};
use crate::holo::browser_application::BrowserApplication;
use crate::holo::canonical::{content_id, encode_value};
use crate::holo::model_document::{Application, ApplicationModel, ModelDocument};
use crate::verification::{executable, run_native_compilation, run_process, NativeCompilation};
use prod_codegen::{
    byte_entry_is_fallible, generate_cargo_package, generate_core_wasm_package,
    generate_core_wasm_package_v2, generate_holoview_bundle, generate_text_view_v1_for_module,
    generate_view_v1, validate_core_wasm_resources, BrowserAdapterBinding, CargoDependency,
    CargoPackageSpec, CoreWasmSpec, EvaluatedViewV1, GeneratedPackage, GeneratedViewV1,
    PackageFile, TextBrowserAdapterBinding, TextViewV1, ViewOperation,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};

const HOLOGRAM_LIVE_COMMIT: &str = "d8208266d8abdc2445b7bbc0cef412a566adfaf1";
const UOR_HOLOGRAM_COMMIT: &str = "2bda6a9a9476872dade705bd61ece4209607f6da";
const DEPENDENCY_REGISTER: &str = include_str!("../model/dependencies.toml");
const STDLIB_RELEASE_SOURCE: &str = include_str!("../stdlib/release.json");
const STDLIB_CRATE: &[u8] = include_bytes!("../stdlib/generated/prism-stdlib-0.2.0.crate");
const REGISTRY_ARCHIVE: &[u8] = include_bytes!("../vendor/registry.tar");
const LICENSE_MIT: &str = include_str!("../LICENSE-MIT");
const LICENSE_APACHE: &str = include_str!("../LICENSE-APACHE");

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StdlibRelease {
    schema: String,
    semantic_id: String,
    crate_path: String,
    crate_sha256: String,
}

#[derive(Debug, Deserialize)]
struct DependencyRegister {
    dependency: Vec<Dependency>,
}

#[derive(Debug, Deserialize)]
struct Dependency {
    id: String,
    revision: String,
    #[serde(default)]
    artifact: Vec<DependencyArtifact>,
}

#[derive(Debug, Deserialize)]
struct DependencyArtifact {
    path: String,
    sha256: String,
}

/// One application artifact prepared in memory before atomic publication.
pub(crate) type ApplicationArtifact = (String, Vec<u8>);

pub(crate) struct GeneratedApplication {
    pub(crate) artifacts: Vec<ApplicationArtifact>,
    pub(crate) exporter_processes: Vec<crate::verification::ProcessRecord>,
}

impl crate::exporter::ProductEvidence for GeneratedApplication {
    fn role(&self) -> &'static str {
        "application"
    }
    fn artifacts(&self) -> &[(String, Vec<u8>)] {
        &self.artifacts
    }
    fn processes(&self) -> &[crate::verification::ProcessRecord] {
        &self.exporter_processes
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn canonical_relative(value: &str) -> Result<&str, PrismError> {
    if value.is_empty()
        || value.contains('\\')
        || Path::new(value)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(PrismError::new(
            "PP4002",
            format!("generated artifact path is not canonical: {value}"),
        ));
    }
    Ok(value)
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), PrismError> {
    let parent = path
        .parent()
        .ok_or_else(|| PrismError::new("PP4002", "generated artifact has no parent"))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", parent.display())))?;
    std::fs::write(path, bytes)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", path.display())))
}

pub(crate) fn publish_package(root: &Path, package: &GeneratedPackage) -> Result<(), PrismError> {
    std::fs::create_dir(root)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", root.display())))?;
    for file in &package.files {
        canonical_relative(&file.path)?;
        write(&root.join(&file.path), &file.bytes)?;
    }
    Ok(())
}

fn core_wasm_cargo_environment(
    package: &GeneratedPackage,
    base: &BTreeMap<String, String>,
    workspace: &Path,
    registry_source: &Path,
) -> Result<BTreeMap<String, String>, PrismError> {
    let invalid = || {
        PrismError::new(
            "PP5101",
            "generated Core-Wasm Cargo rustflags are malformed",
        )
    };
    let config = package
        .files
        .iter()
        .find(|file| file.path == ".cargo/config.toml")
        .ok_or_else(invalid)?;
    let document: toml::Value =
        toml::from_str(std::str::from_utf8(&config.bytes).map_err(|_| invalid())?)
            .map_err(|_| invalid())?;
    let owned = document
        .get("target")
        .and_then(|value| value.get("wasm32-unknown-unknown"))
        .and_then(|value| value.get("rustflags"))
        .and_then(toml::Value::as_array)
        .filter(|flags| !flags.is_empty())
        .ok_or_else(invalid)?;
    let mut flags = owned
        .iter()
        .map(|flag| flag.as_str().map(str::to_owned).ok_or_else(invalid))
        .collect::<Result<Vec<_>, _>>()?;
    flags.extend([
        format!(
            "--remap-path-prefix={}=$APPLICATION_WORK",
            workspace.to_string_lossy()
        ),
        format!(
            "--remap-path-prefix={}=$CARGO_REGISTRY_SRC",
            registry_source.to_string_lossy()
        ),
    ]);
    if flags
        .iter()
        .any(|flag| flag.is_empty() || flag.contains(['\0', '\u{1f}']))
    {
        return Err(invalid());
    }
    // Cargo gives environment rustflags precedence over its generated config.
    // Encode each owned argument separately so remapping preserves the linker
    // resource contract and paths containing spaces retain their boundaries.
    let mut env = base.clone();
    env.remove("RUSTFLAGS");
    env.insert("CARGO_ENCODED_RUSTFLAGS".to_owned(), flags.join("\u{1f}"));
    Ok(env)
}

fn dependency<'a>(
    register: &'a DependencyRegister,
    id: &str,
) -> Result<&'a Dependency, PrismError> {
    register
        .dependency
        .iter()
        .find(|dependency| dependency.id == id)
        .ok_or_else(|| PrismError::new("PP9001", format!("dependency {id} is not registered")))
}

fn artifact_sha(dependency: &Dependency, suffix: &str) -> Result<String, PrismError> {
    dependency
        .artifact
        .iter()
        .find(|artifact| artifact.path.ends_with(suffix))
        .map(|artifact| artifact.sha256.clone())
        .ok_or_else(|| {
            PrismError::new(
                "PP9001",
                format!("registered dependency artifact {suffix} is absent"),
            )
        })
}

fn parse_kernel(path: &Path) -> Result<prod_ir::Module, PrismError> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| PrismError::new("PP5004", format!("{}: {error}", path.display())))?;
    let (remaining, module) = prod_ir::parser::parse_module(&text)
        .map_err(|error| PrismError::new("PP5004", format!("LCNF parse: {error:?}")))?;
    if !remaining.trim().is_empty() {
        return Err(PrismError::new("PP5004", "LCNF has trailing input"));
    }
    Ok(module)
}

fn view_value(
    model: &ModelDocument,
    application: &ApplicationModel,
    core_sha: &str,
) -> EvaluatedViewV1 {
    let view_json = serde_json::to_value(&application.view).expect("owned View serializes");
    let view_id = content_id(&encode_value(&view_json).expect("owned View canonicalizes"));
    EvaluatedViewV1 {
        title: application.view.title.clone(),
        heading: application.view.heading.clone(),
        left_label: application.view.left_label.clone(),
        right_label: application.view.right_label.clone(),
        operation_label: application.view.operation_label.clone(),
        submit_label: application.view.submit_label.clone(),
        input_error: application.view.input_error.clone(),
        division_by_zero_error: application.view.division_error.clone(),
        overflow_error: application.view.overflow_error.clone(),
        operations: application
            .view
            .operations
            .iter()
            .map(|operation| ViewOperation {
                label: operation.label.clone(),
                request_name: operation.request_name.clone(),
                rust_variant: operation.rust_variant.clone(),
                discriminant: operation.discriminant,
            })
            .collect(),
        initial_operation: application.view.initial_operation,
        model_id: content_id(
            &encode_value(&serde_json::to_value(model).expect("model serializes"))
                .expect("model canonicalizes"),
        ),
        view_model_id: view_id,
        generated_core_sha256: core_sha.to_owned(),
    }
}

fn generate_browser_view_v1(
    module: &prod_ir::Module,
    application: &BrowserApplication,
    model_id: &str,
    view_model_id: &str,
    core_sha: &str,
    entry: &str,
) -> Result<GeneratedViewV1, PrismError> {
    let core_crate_name = application.cargo_name.clone();
    let core_crate_snake = core_crate_name.replace('-', "_");
    let package_name = format!("{core_crate_name}-browser");
    let package_version = application.cargo_version.clone();

    let cargo_toml = format!(
        "[package]\nname = \"{package_name}\"\nversion = \"{package_version}\"\nedition = \"2021\"\npublish = false\n\n[lib]\ncrate-type = [\"cdylib\"]\n\n[dependencies]\njs-sys = \"=0.3.99\"\nwasm-bindgen = \"=0.2.122\"\n{core_crate_name} = \"={package_version}\"\n"
    );
    let result_adapter = if byte_entry_is_fallible(module, entry)
        .map_err(|error| PrismError::new("PP5203", error.to_string()))?
    {
        ".map_err(|error| { let failure = js_sys::Error::new(&format!(\"{error:?}\")); failure.set_name(\"ComputeError\"); JsValue::from(failure) })?"
    } else {
        ""
    };
    let adapter_src = format!(
        "use wasm_bindgen::prelude::*;\n\n// Transport copies allocate only after their byte limits are checked.\n// The core's own allocation bound remains an application-model obligation.\n#[wasm_bindgen]\npub fn invoke_bytes(input: JsValue) -> Result<js_sys::Uint8Array, JsValue> {{\n    let input = input.dyn_into::<js_sys::Uint8Array>().map_err(|_| JsValue::from_str(\"expected Uint8Array\"))?;\n    if input.length() > {} {{ return Err(JsValue::from_str(\"input byte limit\")); }}\n    let bytes = input.to_vec();\n    let output = {}::{}(bytes){result_adapter};\n    if output.len() > {} {{ return Err(JsValue::from_str(\"output byte limit\")); }}\n    Ok(js_sys::Uint8Array::from(output.as_slice()))\n}}\n",
        application.guest_allocation_maximum, core_crate_snake, entry, application.response_maximum,
    );
    let mut adapter_files = vec![
        PackageFile {
            path: "Cargo.toml".into(),
            bytes: cargo_toml.into_bytes(),
        },
        PackageFile {
            path: "src/lib.rs".into(),
            bytes: adapter_src.into_bytes(),
        },
    ];
    let records = adapter_files
        .iter()
        .map(|f| {
            format!(
                "{{\"path\":{:?},\"sha256\":{:?}}}",
                f.path,
                sha256(&f.bytes)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let generation_manifest = format!(
        "{{\"core_crate\":{:?},\"core_function\":{:?},\"core_version\":{:?},\"files\":[{}],\"generated_core_sha256\":{:?},\"max_input_bytes\":{},\"max_output_bytes\":{},\"model_id\":{:?},\"profile\":\"prism.browser-view/1\",\"schema\":\"lean4-prod/browser-adapter/1\",\"view_model_id\":{:?}}}\n",
        core_crate_name, entry, package_version, records, core_sha, application.guest_allocation_maximum, application.response_maximum, model_id, view_model_id
    );
    adapter_files.push(PackageFile {
        path: "generation-manifest.json".into(),
        bytes: generation_manifest.into_bytes(),
    });
    adapter_files.sort_by(|a, b| a.path.cmp(&b.path));
    let browser_adapter = GeneratedPackage {
        files: adapter_files,
    };

    let css = "*{box-sizing:border-box}body{font-family:system-ui,sans-serif;margin:0;color:#172033;background:#f6f7fb}main{width:min(70rem,calc(100% - 2rem));margin:2rem auto;padding:1.5rem;background:white}\n";
    let html = format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>{}</title>\n<link rel=\"stylesheet\" href=\"app.css\">\n</head>\n<body>\n<main>\n<h1>{}</h1>\n<div id=\"app\"></div>\n</main>\n<script type=\"module\" src=\"app.js\"></script>\n</body>\n</html>\n",
        application.view.title, application.view.heading
    );
    let browser_js = format!(
        "const loadBinding=()=>import('./{core_crate_snake}.js');\nexport async function mount(root){{\n  const {{invoke_bytes}}=await loadBinding();\n  root.innerHTML='<h1>{}</h1>';\n}}\n",
        application.view.heading
    );
    let hologram_js = format!(
        "export function mount(root){{\n  root.innerHTML='<h1>{}</h1>';\n}}\n",
        application.view.heading
    );

    let browser_assets = vec![
        PackageFile {
            path: "app.css".into(),
            bytes: css.as_bytes().to_vec(),
        },
        PackageFile {
            path: "app.js".into(),
            bytes: browser_js.into_bytes(),
        },
        PackageFile {
            path: "index.html".into(),
            bytes: html.as_bytes().to_vec(),
        },
    ];
    let hologram_assets = vec![
        PackageFile {
            path: "app.css".into(),
            bytes: css.as_bytes().to_vec(),
        },
        PackageFile {
            path: "app.js".into(),
            bytes: hologram_js.into_bytes(),
        },
        PackageFile {
            path: "index.html".into(),
            bytes: html.into_bytes(),
        },
    ];

    let hologram_bundle = generate_holoview_bundle(&hologram_assets)
        .map_err(|error| PrismError::new("PP5203", error.to_string()))?;

    let target_records = |target: &str, files: &[PackageFile]| {
        let rows = files
            .iter()
            .map(|f| {
                format!(
                    "{{\"path\":{:?},\"sha256\":{:?}}}",
                    f.path,
                    sha256(&f.bytes)
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        format!("{{\"files\":[{}],\"target\":{:?}}}", rows, target)
    };

    let manifest = format!(
        "{{\"browser_adapter\":[{}],\"generated_core_sha256\":{:?},\"hologram_bundle\":{{\"path\":{:?},\"sha256\":{:?}}},\"max_input_bytes\":{},\"max_output_bytes\":{},\"model_id\":{:?},\"profile\":\"prism.browser-view/1\",\"projections\":[{},{}],\"schema\":\"lean4-prod/browser-view-projection/1\",\"view_model_id\":{:?}}}\n",
        records, core_sha, hologram_bundle.path, sha256(&hologram_bundle.bytes),
        application.guest_allocation_maximum, application.response_maximum, model_id,
        target_records("browser-wasm-bindgen", &browser_assets),
        target_records("hologram-intent-v1", &hologram_assets),
        view_model_id
    );

    let view_manifest = PackageFile {
        path: "view-manifest.json".into(),
        bytes: manifest.into_bytes(),
    };

    Ok(GeneratedViewV1 {
        hologram_assets,
        hologram_bundle,
        browser_assets,
        browser_adapter,
        view_manifest,
    })
}

fn application_view(
    module: &prod_ir::Module,
    model: &ModelDocument,
    application: &Application,
    core_sha: &str,
) -> Result<(GeneratedViewV1, String, String), PrismError> {
    let (generated, model_id, view_model_id) =
        match application {
            Application::Browser(application) => {
                let model_id = content_id(&encode_value(
                    &serde_json::to_value(model)
                        .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                )?);
                let view_model_id = content_id(&encode_value(
                    &serde_json::to_value(&application.view)
                        .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                )?);
                let entry = application.entry_root.rsplit('.').next().ok_or_else(|| {
                    PrismError::new("PP2001", "application entry root is malformed")
                })?;
                let generated = generate_browser_view_v1(
                    module,
                    application,
                    &model_id,
                    &view_model_id,
                    core_sha,
                    entry,
                );
                return Ok((generated?, model_id, view_model_id));
            }
            Application::Legacy(application) => {
                let evaluated = view_value(model, application, core_sha);
                let generated = generate_view_v1(
                    &evaluated,
                    &BrowserAdapterBinding {
                        package_name: format!("{}-browser", application.cargo_name),
                        package_version: application.cargo_version.clone(),
                        core_crate_name: application.cargo_name.clone(),
                        core_crate_version: application.cargo_version.clone(),
                        core_operation_type: application.operation_type.clone(),
                        core_error_type: application.error_type.clone(),
                        core_function: application.function_name.clone(),
                    },
                );
                (generated, evaluated.model_id, evaluated.view_model_id)
            }
            Application::Text(application) => {
                let model_id = content_id(&encode_value(
                    &serde_json::to_value(model)
                        .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                )?);
                let view_model_id = content_id(&encode_value(
                    &serde_json::to_value(&application.view)
                        .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
                )?);
                let entry = application.entry_root.rsplit('.').next().ok_or_else(|| {
                    PrismError::new("PP2001", "application entry root is malformed")
                })?;
                let evaluated = TextViewV1 {
                    title: application.view.title.clone(),
                    heading: application.view.heading.clone(),
                    input_label: application.view.input_label.clone(),
                    submit_label: application.view.submit_label.clone(),
                    output_label: application.view.output_label.clone(),
                    input_error: application.view.input_error.clone(),
                    response_error: application.view.response_error.clone(),
                    max_input_bytes: application.request_maximum,
                    max_output_bytes: application.response_maximum,
                    model_id: model_id.clone(),
                    view_model_id: view_model_id.clone(),
                    generated_core_sha256: core_sha.to_owned(),
                };
                let generated = generate_text_view_v1_for_module(
                    module,
                    &evaluated,
                    &TextBrowserAdapterBinding {
                        package_name: format!("{}-browser", application.cargo_name),
                        package_version: application.cargo_version.clone(),
                        core_crate_name: application.cargo_name.clone(),
                        core_crate_version: application.cargo_version.clone(),
                        core_function: entry.to_owned(),
                    },
                );
                (generated, model_id, view_model_id)
            }
        };
    Ok((
        generated.map_err(|error| PrismError::new("PP5203", error.to_string()))?,
        model_id,
        view_model_id,
    ))
}

fn source_manifest(
    model: &ModelDocument,
    lex_manifest: &[u8],
    kernel: &[u8],
    coverage: &[u8],
) -> Result<Vec<u8>, PrismError> {
    encode_value(&json!({
        "files": [
            {"kind":"lexlean-build-manifest","sha256":sha256(lex_manifest)},
            {"kind":"lean4-prod-coverage","sha256":sha256(coverage)},
            {"kind":"lean4-prod-kernel-ir","sha256":sha256(kernel)},
            {"kind":"model-document","sha256":content_id(&encode_value(&serde_json::to_value(model).map_err(|error| PrismError::new("PP9001", error.to_string()))?)?)}
        ],
        "semantic_id": model.provenance.semantic_id,
        "source_id": model.provenance.source_id,
        "version": 4
    }))
}

fn package_readme(
    module: &prod_ir::Module,
    application: &Application,
) -> Result<String, PrismError> {
    let entry = application
        .entry_root()
        .rsplit('.')
        .next()
        .expect("validated application entry root");
    let result_adapter = if !matches!(application, Application::Legacy(_))
        && byte_entry_is_fallible(module, entry)
            .map_err(|error| PrismError::new("PP4102", error.to_string()))?
    {
        ".expect(\"generated core entry failed\")"
    } else {
        ""
    };
    let example = application
        .acceptance_vectors()
        .first()
        .map(|vector| {
            format!(
                "use {}::{};\n\nassert_eq!({}(vec!{:?}){result_adapter}, vec!{:?});",
                application.cargo_name().replace('-', "_"),
                entry,
                entry,
                vector.request,
                vector.response
            )
        })
        .unwrap_or_else(|| {
            format!(
                "use {}::{};",
                application.cargo_name().replace('-', "_"),
                entry
            )
        });
    Ok(format!(
        "# {}\n\n{}\n\nThis package is generated from the authoritative Prism application model. Do not edit generated Rust.\n\n```rust\n{}\n```\n",
        application.name(),
        application.cargo_description(),
        example
    ))
}

fn cargo_home(workspace: &Path, registry: &Path) -> Result<PathBuf, PrismError> {
    let home = workspace.join("cargo-home");
    std::fs::create_dir(&home)
        .map_err(|error| PrismError::new("PP4002", format!("Cargo home: {error}")))?;
    let config = format!(
        "[net]\noffline = true\n\n[source.crates-io]\nreplace-with = \"prismpm-local\"\n\n[source.prismpm-local]\nlocal-registry = {:?}\n",
        registry.to_string_lossy()
    );
    write(&home.join("config.toml"), config.as_bytes())?;
    Ok(home)
}

fn stdlib_registry(workspace: &Path, stdlib: &StdlibRelease) -> Result<PathBuf, PrismError> {
    let registry = workspace.join("registry");
    std::fs::create_dir(&registry)
        .map_err(|error| PrismError::new("PP4101", format!("local registry: {error}")))?;
    tar::Archive::new(Cursor::new(REGISTRY_ARCHIVE))
        .unpack(&registry)
        .map_err(|error| PrismError::new("PP4101", format!("local registry: {error}")))?;
    let index = registry.join("index/pr/is");
    std::fs::create_dir_all(&index)
        .map_err(|error| PrismError::new("PP4101", format!("local registry: {error}")))?;
    write(&registry.join("prism-stdlib-0.2.0.crate"), STDLIB_CRATE)?;
    let row = format!(
        "{{\"name\":\"prism-stdlib\",\"vers\":\"0.2.0\",\"deps\":[],\"cksum\":\"{}\",\"features\":{{\"default\":[\"std\"],\"std\":[]}},\"yanked\":false}}\n",
        stdlib.crate_sha256
    );
    write(&index.join("prism-stdlib"), row.as_bytes())?;
    Ok(registry)
}

fn add_application_to_registry(
    registry: &Path,
    application: &Application,
    crate_bytes: &[u8],
    stdlib_sha256: &str,
) -> Result<(), PrismError> {
    write(
        &registry.join(format!(
            "{}-{}.crate",
            application.cargo_name(),
            application.cargo_version()
        )),
        crate_bytes,
    )?;
    let name = application.cargo_name();
    let index_path = if name.len() == 1 {
        registry.join("index/1").join(name)
    } else if name.len() == 2 {
        registry.join("index/2").join(name)
    } else if name.len() == 3 {
        registry.join("index/3").join(&name[0..1]).join(name)
    } else {
        registry
            .join("index")
            .join(&name[0..2])
            .join(&name[2..4])
            .join(name)
    };
    let row = json!({
        "cksum": sha256(crate_bytes),
        "deps": [{
            "default_features": false,
            "features": [],
            "kind": "normal",
            "name": "prism-stdlib",
            "optional": false,
            "registry": Value::Null,
            "req": "=0.2.0",
            "target": Value::Null
        }],
        "features": {"default":["std"],"std":["prism-stdlib/std"]},
        "name": name,
        "vers": application.cargo_version(),
        "yanked": false
    });
    let mut row =
        serde_json::to_vec(&row).map_err(|error| PrismError::new("PP9001", error.to_string()))?;
    row.push(b'\n');
    write(&index_path, &row)?;
    if stdlib_sha256.len() != 64 {
        return Err(PrismError::new(
            "PP4101",
            "stdlib registry checksum is invalid",
        ));
    }
    Ok(())
}

/// Materialize the embedded, checksum-pinned local registry plus one generated
/// application candidate and return an isolated offline Cargo home.
pub(crate) fn application_cargo_home(
    workspace: &Path,
    application: &Application,
    crate_bytes: &[u8],
) -> Result<PathBuf, PrismError> {
    let stdlib: StdlibRelease = serde_json::from_str(STDLIB_RELEASE_SOURCE)
        .map_err(|error| PrismError::new("PP4101", format!("stdlib release: {error}")))?;
    if sha256(STDLIB_CRATE) != stdlib.crate_sha256 {
        return Err(PrismError::new(
            "PP4101",
            "embedded stdlib crate checksum disagrees with its release metadata",
        ));
    }
    let registry = stdlib_registry(workspace, &stdlib)?;
    add_application_to_registry(&registry, application, crate_bytes, &stdlib.crate_sha256)?;
    cargo_home(workspace, &registry)
}

fn run(
    name: &str,
    program: &Path,
    args: &[&str],
    cwd: &Path,
    env: &BTreeMap<String, String>,
    replacements: &[(&Path, &str)],
    failure: &'static str,
) -> Result<(), PrismError> {
    let args = args
        .iter()
        .map(|argument| (*argument).to_owned())
        .collect::<Vec<_>>();
    run_process(name, program, &args, cwd, env, replacements, failure).map(|_| ())
}

pub(crate) fn application_export_arguments(
    modules: &BTreeSet<String>,
    application: &Application,
    export: &Path,
) -> Vec<String> {
    let mut arguments = vec!["exe".to_owned(), "prod-export".to_owned()];
    for module in modules {
        arguments.push("--module".to_owned());
        arguments.push(module.clone());
    }
    for root in application.library_roots() {
        arguments.push("--root".to_owned());
        arguments.push(root.clone());
    }
    arguments.extend([
        "--ir-module".to_owned(),
        match application {
            Application::Legacy(application) => application.name.clone(),
            // Display labels are not IR identifiers. Use the already validated
            // Cargo identity, preserving the legacy Calculator's exact output.
            Application::Text(application) => application.cargo_name.replace('-', "_"),
            Application::Browser(application) => application.cargo_name.replace('-', "_"),
        },
        "--out".to_owned(),
        export.to_string_lossy().into_owned(),
    ]);
    arguments
}

/// Produce every platform-independent target declared by an evaluated
/// application. The returned bytes are not visible until the controller's
/// normal atomic publication step succeeds.
pub(crate) fn generate(
    repository_root: &Path,
    model: &ModelDocument,
    model_bytes: &[u8],
    lex_root: &Path,
    lex_manifest_bytes: &[u8],
) -> Result<Vec<ApplicationArtifact>, PrismError> {
    generate_recorded(
        repository_root,
        model,
        model_bytes,
        lex_root,
        lex_manifest_bytes,
    )
    .map(|generated| generated.artifacts)
}

pub(crate) fn generate_recorded(
    repository_root: &Path,
    model: &ModelDocument,
    model_bytes: &[u8],
    lex_root: &Path,
    lex_manifest_bytes: &[u8],
) -> Result<GeneratedApplication, PrismError> {
    generate_in(
        repository_root,
        model,
        model_bytes,
        lex_root,
        lex_manifest_bytes,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn generate_owned(
    repository_root: &Path,
    model: &ModelDocument,
    model_bytes: &[u8],
    lex_root: &Path,
    lex_manifest_bytes: &[u8],
    owner: &mut crate::exporter::VerifyExporterOwner,
    phase: crate::exporter::Phase,
) -> Result<GeneratedApplication, PrismError> {
    owner.generate(
        repository_root,
        phase,
        model_bytes,
        lex_manifest_bytes,
        |package, acquisition| {
            generate_in(
                repository_root,
                model,
                model_bytes,
                lex_root,
                lex_manifest_bytes,
                Some((package, acquisition)),
            )
        },
    )
}

fn generate_in(
    repository_root: &Path,
    model: &ModelDocument,
    model_bytes: &[u8],
    lex_root: &Path,
    lex_manifest_bytes: &[u8],
    owned: Option<(&Path, &crate::exporter::GenerationContext<'_>)>,
) -> Result<GeneratedApplication, PrismError> {
    let application = model.application.as_ref().ok_or_else(|| {
        PrismError::new(
            "PP9001",
            "application generation was requested for a non-application",
        )
    })?;
    if matches!(application, Application::Browser(_)) {
        crate::holo::browser_application::require_runtime(application)?;
    }
    let stdlib: StdlibRelease = serde_json::from_str(STDLIB_RELEASE_SOURCE)
        .map_err(|error| PrismError::new("PP4101", format!("stdlib release: {error}")))?;
    if stdlib.schema != "prismpm/stdlib-release/1"
        || stdlib.semantic_id.len() != 64
        || stdlib.crate_sha256.len() != 64
    {
        return Err(PrismError::new(
            "PP4101",
            "stdlib release metadata is invalid",
        ));
    }
    if stdlib.crate_path != "stdlib/generated/prism-stdlib-0.2.0.crate"
        || sha256(STDLIB_CRATE) != stdlib.crate_sha256
    {
        return Err(PrismError::new(
            "PP4101",
            "stdlib crate checksum disagrees with its release metadata",
        ));
    }

    let dependency_register: DependencyRegister = toml::from_str(DEPENDENCY_REGISTER)
        .map_err(|error| PrismError::new("PP9001", format!("dependencies: {error}")))?;
    let lexlean = dependency(&dependency_register, "lexlean")?;
    let lean4_prod = dependency(&dependency_register, "lean4-prod")?;

    let mut work = crate::exporter::directory::Directory::temporary(
        "prismpm-application-",
        None,
        Default::default(),
    )?;
    let workspace_path = work.path().to_owned();
    let workspace = workspace_path.as_path();
    let first_build = owned.is_none();
    let mut seed_custody = None;
    let (lean_package, exporter_acquisition) = match owned {
        Some((package, acquisition)) => (package.to_owned(), acquisition.receipt().clone()),
        None => {
            let package = workspace.join("lean4-prod");
            let acquisition =
                crate::exporter::acquire_for_owned(repository_root, &package, work.scope())?;
            work.protect_package(&package, &acquisition.snapshot)?;
            seed_custody = Some(acquisition.snapshot);
            (package, acquisition.receipt)
        }
    };

    let lex_manifest: Value = serde_json::from_slice(lex_manifest_bytes)
        .map_err(|error| PrismError::new("PP4004", format!("LexLean manifest: {error}")))?;
    let outputs = lex_manifest
        .get("outputs")
        .and_then(Value::as_array)
        .ok_or_else(|| PrismError::new("PP4004", "LexLean output list is absent"))?;
    let mut modules = BTreeSet::new();
    for row in outputs {
        if row.get("kind").and_then(Value::as_str) != Some("lean") {
            continue;
        }
        let path = row
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| PrismError::new("PP4004", "LexLean Lean path is absent"))?;
        canonical_relative(path)?;
        let relative = Path::new(path)
            .strip_prefix("modules")
            .map_err(|_| PrismError::new("PP4004", "LexLean Lean path is outside modules"))?;
        let bytes = std::fs::read(lex_root.join(path))
            .map_err(|error| PrismError::new("PP4002", format!("{path}: {error}")))?;
        if row.get("sha256").and_then(Value::as_str) != Some(sha256(&bytes).as_str()) {
            return Err(PrismError::new(
                "PP4001",
                format!("generated Lean changed: {path}"),
            ));
        }
        write(&workspace.join(relative), &bytes)?;
        modules.insert(
            relative
                .with_extension("")
                .to_string_lossy()
                .replace(['/', '\\'], "."),
        );
    }
    if modules.is_empty() {
        return Err(PrismError::new(
            "PP4004",
            "application has no generated Lean module",
        ));
    }
    let lakefile = crate::lean_project::configuration(
        "prismpm_application",
        &modules.iter().cloned().collect::<Vec<_>>(),
    );
    write(&workspace.join("lakefile.toml"), lakefile.as_bytes())?;
    write(
        &workspace.join("lean-toolchain"),
        b"leanprover/lean4:v4.32.1\n",
    )?;

    let lake = executable("lake")?;
    let cargo = executable("cargo")?;
    let replacements = [
        (lean_package.as_path(), "$LEAN4_PROD"),
        (workspace, "$APPLICATION_WORK"),
        (repository_root, "$PROJECT"),
    ];
    let no_env = BTreeMap::new();
    let generated_process = run_native_compilation(
        NativeCompilation::Application,
        &lake,
        &["build".to_owned(), "PrismGenerated".to_owned()],
        workspace,
        &replacements,
        "PP5001",
    )?;
    if let Some((_, context)) = owned {
        context.before_build(repository_root, &lean_package)?;
    } else if first_build {
        crate::exporter::before_first_build(
            repository_root,
            &lean_package,
            &exporter_acquisition,
            seed_custody
                .as_ref()
                .expect("first build retains original custody"),
        )?;
    }
    let build_process = run_process(
        "application-exporter",
        &lake,
        &["build".to_owned(), "prod-export".to_owned()],
        &lean_package,
        &no_env,
        &replacements,
        "PP5004",
    )?;
    let export = workspace.join("export");
    let export_args = application_export_arguments(&modules, application, &export);
    let mut export_env = BTreeMap::new();
    export_env.insert(
        "LEAN_PATH".to_owned(),
        workspace
            .join(".lake/build/lib/lean")
            .to_string_lossy()
            .into_owned(),
    );
    let export_custody = match owned {
        Some((_, context)) => context.after_build(&lean_package)?,
        None => crate::exporter::after_build(
            &lean_package,
            &exporter_acquisition,
            seed_custody.as_ref().expect("original unowned custody"),
        )?,
    };
    let exporter_process = crate::exporter::run_export_with_custody(
        "application-export",
        &lake,
        &export_args,
        &lean_package,
        &export_env,
        &replacements,
        "PP5004",
        &exporter_acquisition,
        &export_custody,
    )?;
    let kernel_bytes = std::fs::read(export.join("kernel.ir"))
        .map_err(|error| PrismError::new("PP5004", format!("kernel.ir: {error}")))?;
    let roots_bytes = std::fs::read(export.join("roots.json"))
        .map_err(|error| PrismError::new("PP5004", format!("roots.json: {error}")))?;
    let coverage_bytes = std::fs::read(export.join("coverage.json"))
        .map_err(|error| PrismError::new("PP5004", format!("coverage.json: {error}")))?;
    let module = parse_kernel(&export.join("kernel.ir"))?;

    let package = generate_cargo_package(
        &module,
        &CargoPackageSpec {
            name: application.cargo_name().clone(),
            version: application.cargo_version().clone(),
            description: application.cargo_description().clone(),
            repository: application.cargo_repository().clone(),
            homepage: application.cargo_homepage().clone(),
            readme: package_readme(&module, application)?,
            license_mit: LICENSE_MIT.to_owned(),
            license_apache: LICENSE_APACHE.to_owned(),
            input_sha256: sha256(&kernel_bytes),
            dependencies: vec![CargoDependency {
                name: "prism-stdlib".to_owned(),
                version: "0.2.0".to_owned(),
                checksum: stdlib.crate_sha256.clone(),
                default_features: false,
                features: Vec::new(),
            }],
        },
    )
    .map_err(|error| PrismError::new("PP4102", error.to_string()))?;
    let package_root = workspace.join("cargo-package");
    publish_package(&package_root, &package)?;
    let registry = stdlib_registry(workspace, &stdlib)?;
    let cargo_home = cargo_home(workspace, &registry)?;
    let mut cargo_env = BTreeMap::new();
    cargo_env.insert(
        "CARGO_HOME".to_owned(),
        cargo_home.to_string_lossy().into_owned(),
    );
    cargo_env.insert("CARGO_NET_OFFLINE".to_owned(), "true".to_owned());
    cargo_env.insert(
        "RUSTFLAGS".to_owned(),
        format!(
            "--remap-path-prefix={}=$APPLICATION_WORK",
            workspace.to_string_lossy()
        ),
    );
    run(
        "application-cargo-check",
        &cargo,
        &["check", "--locked", "--offline"],
        &package_root,
        &cargo_env,
        &replacements,
        "PP4102",
    )?;
    run(
        "application-cargo-check-no-std",
        &cargo,
        &["check", "--locked", "--offline", "--no-default-features"],
        &package_root,
        &cargo_env,
        &replacements,
        "PP4102",
    )?;
    run(
        "application-cargo-package",
        &cargo,
        &["package", "--locked", "--offline", "--allow-dirty"],
        &package_root,
        &cargo_env,
        &replacements,
        "PP4102",
    )?;
    let crate_file = package_root.join("target/package").join(format!(
        "{}-{}.crate",
        application.cargo_name(),
        application.cargo_version()
    ));
    let crate_bytes = std::fs::read(&crate_file)
        .map_err(|error| PrismError::new("PP4102", format!("generated crate: {error}")))?;

    let registry_source_root = cargo_home.join("registry/src");
    let mut registry_sources = std::fs::read_dir(&registry_source_root)
        .map_err(|error| PrismError::new("PP4101", format!("Cargo registry source: {error}")))?
        .map(|entry| {
            entry
                .map_err(|error| PrismError::new("PP4101", error.to_string()))
                .and_then(|entry| {
                    if entry
                        .file_type()
                        .map_err(|error| PrismError::new("PP4101", error.to_string()))?
                        .is_dir()
                    {
                        Ok(entry.path())
                    } else {
                        Err(PrismError::new(
                            "PP4101",
                            "Cargo registry source contains a non-directory",
                        ))
                    }
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    registry_sources.sort();
    if registry_sources.len() != 1 {
        return Err(PrismError::new(
            "PP4101",
            "Cargo registry source closure is not exact",
        ));
    }
    cargo_env.insert(
        "RUSTFLAGS".to_owned(),
        format!(
            "--remap-path-prefix={}=$APPLICATION_WORK --remap-path-prefix={}=$CARGO_REGISTRY_SRC",
            workspace.to_string_lossy(),
            registry_sources[0].to_string_lossy()
        ),
    );

    let entry = application
        .entry_root()
        .rsplit('.')
        .next()
        .ok_or_else(|| PrismError::new("PP2001", "application entry root is malformed"))?;
    let core_spec = CoreWasmSpec {
        crate_name: format!("{}-core-wasm", application.cargo_name()),
        entry: entry.to_owned(),
        export_name: "holo_run".to_owned(),
        input_allocation_cap: application.guest_allocation_maximum(),
        output_allocation_cap: application.response_maximum(),
        maximum_pages: application.core_memory_pages(),
        input_ir_sha256: sha256(&kernel_bytes),
    };
    let core_package = match application.core_stack_bytes() {
        Some(stack) => generate_core_wasm_package_v2(&module, &core_spec, stack),
        None => generate_core_wasm_package(&module, &core_spec),
    }
    .map_err(|error| PrismError::new("PP5101", error.to_string()))?;
    let core_root = workspace.join("core-wasm");
    publish_package(&core_root, &core_package)?;
    let core_cargo_env =
        core_wasm_cargo_environment(&core_package, &cargo_env, workspace, &registry_sources[0])?;
    run(
        "application-core-wasm",
        &cargo,
        &["build", "--locked", "--offline", "--release"],
        &core_root,
        &core_cargo_env,
        &replacements,
        "PP5101",
    )?;
    let wasm_stem = format!("{}_core_wasm", application.cargo_name().replace('-', "_"));
    let wasm_path = core_root
        .join("target/wasm32-unknown-unknown/release")
        .join(format!("{wasm_stem}.wasm"));
    let wasm = std::fs::read(&wasm_path)
        .map_err(|error| PrismError::new("PP5101", format!("Core-Wasm output: {error}")))?;
    validate_core_wasm_resources(
        &wasm,
        application.core_memory_pages(),
        application.core_stack_bytes(),
    )
    .map_err(|error| PrismError::new("PP5103", error.to_string()))?;

    let generated_core_sha = sha256(
        package
            .files
            .iter()
            .find(|file| file.path == "generation-manifest.json")
            .ok_or_else(|| PrismError::new("PP4102", "generated core manifest is absent"))?
            .bytes
            .as_slice(),
    );
    let (generated_view, view_document_id, view_model_id) =
        application_view(&module, model, application, &generated_core_sha)?;
    add_application_to_registry(&registry, application, &crate_bytes, &stdlib.crate_sha256)?;
    let browser_root = workspace.join("browser-adapter");
    publish_package(&browser_root, &generated_view.browser_adapter)?;
    run(
        "browser-adapter-lock",
        &cargo,
        &["generate-lockfile", "--offline"],
        &browser_root,
        &cargo_env,
        &replacements,
        "PP5203",
    )?;
    run(
        "browser-adapter-wasm",
        &cargo,
        &[
            "build",
            "--locked",
            "--offline",
            "--release",
            "--target",
            "wasm32-unknown-unknown",
        ],
        &browser_root,
        &cargo_env,
        &replacements,
        "PP5203",
    )?;
    let wasm_bindgen = executable("wasm-bindgen")?;
    let browser_stem = application.cargo_name().replace('-', "_");
    let adapter_wasm = browser_root
        .join("target/wasm32-unknown-unknown/release")
        .join(format!("{browser_stem}_browser.wasm"));
    let browser_binding = workspace.join("browser-binding");
    std::fs::create_dir(&browser_binding)
        .map_err(|error| PrismError::new("PP5203", format!("browser binding: {error}")))?;
    let adapter_wasm_argument = adapter_wasm.to_string_lossy().into_owned();
    let browser_binding_argument = browser_binding.to_string_lossy().into_owned();
    run(
        "browser-wasm-bindgen",
        &wasm_bindgen,
        &[
            "--target",
            "web",
            "--no-typescript",
            "--out-name",
            &browser_stem,
            "--out-dir",
            &browser_binding_argument,
            &adapter_wasm_argument,
        ],
        &browser_root,
        &no_env,
        &replacements,
        "PP5203",
    )?;
    let browser_js_name = format!("{browser_stem}.js");
    let browser_wasm_name = format!("{browser_stem}_bg.wasm");
    let browser_js = std::fs::read(browser_binding.join(&browser_js_name))
        .map_err(|error| PrismError::new("PP5203", format!("browser JavaScript: {error}")))?;
    let browser_wasm = std::fs::read(browser_binding.join(&browser_wasm_name))
        .map_err(|error| PrismError::new("PP5203", format!("browser Wasm: {error}")))?;
    let browser_lock = std::fs::read(browser_root.join("Cargo.lock"))
        .map_err(|error| PrismError::new("PP5203", format!("browser lock: {error}")))?;
    let browser_provenance = encode_value(&json!({
        "adapter_lock_sha256": sha256(&browser_lock),
        "adapter_wasm_sha256": sha256(&browser_wasm),
        "binding_javascript_sha256": sha256(&browser_js),
        "generated_core_sha256": generated_core_sha,
        "model_id": view_document_id,
        "schema": "prismpm/browser-provenance/1",
        "view_manifest_sha256": sha256(&generated_view.view_manifest.bytes),
        "view_model_id": view_model_id
    }))?;
    let browser_projection_sha = sha256(&browser_provenance);
    // Text/3 applications also ship the modeled command line as static programs.
    let command_line = match application {
        Application::Text(text) if text.cli.is_some() => Some((
            text.as_ref(),
            crate::text_cli::build(text, workspace, &cargo_env, &replacements)?,
        )),
        _ => None,
    };
    let source_manifest =
        source_manifest(model, lex_manifest_bytes, &kernel_bytes, &coverage_bytes)?;
    let target_profile = encode_value(&application_target_profile(application))?;
    let lcnf_manifest = encode_value(&json!({
        "coverage_sha256": sha256(&coverage_bytes),
        "kernel_ir_sha256": sha256(&kernel_bytes),
        "roots_sha256": sha256(&roots_bytes),
        "schema": "prismpm/lcnf-manifest/1"
    }))?;
    let holo = compose_application(&ApplicationArchiveInput {
        application_name: application.name().clone(),
        guest_wasm: wasm.clone(),
        view_bundle: generated_view.hologram_bundle.bytes.clone(),
        model_document: model_bytes.to_vec(),
        source_manifest: source_manifest.clone(),
        provenance: ArchiveProvenance {
            source_id: model.provenance.source_id.clone(),
            semantic_id: model.provenance.semantic_id.clone(),
            compiler_semantics_id: model.provenance.compiler_semantics_id.clone(),
            snapshot_id: model.provenance.snapshot_id.clone(),
            stdlib_semantics_id: stdlib.semantic_id,
            prism_stdlib_crate_sha256: stdlib.crate_sha256,
            lexlean_commit: lexlean.revision.clone(),
            lexlean_package_sha256: artifact_sha(lexlean, ".crate")?,
            lean4_prod_commit: lean4_prod.revision.clone(),
            hologram_live_commit: HOLOGRAM_LIVE_COMMIT.to_owned(),
            uor_hologram_commit: UOR_HOLOGRAM_COMMIT.to_owned(),
            target_profile_id: sha256(&target_profile),
            lean_manifest_sha256: sha256(lex_manifest_bytes),
            lcnf_manifest_sha256: sha256(&lcnf_manifest),
            generated_core_sha256: generated_core_sha,
            cargo_name: application.cargo_name().clone(),
            cargo_version: application.cargo_version().clone(),
            cargo_crate_sha256: sha256(&crate_bytes),
            view_model_id,
            browser_projection_sha256: browser_projection_sha,
        },
    })?;

    let mut artifacts = vec![
        (
            "application/exporter-identity.json".to_owned(),
            encode_value(&{
                let execution = exporter_process.exporter.as_ref().ok_or_else(|| {
                    PrismError::new(
                        "PP9001",
                        "actual application exporter measurement is absent",
                    )
                })?;
                json!({"schema":"prismpm/exporter-identity/1","source_archive_sha256":execution.source_archive_sha256,
                    "executable":execution.executable})
            })?,
        ),
        (format!("{}.holo", application.name()), holo.bytes),
        (
            "application/application-manifest.bin".to_owned(),
            holo.application_manifest,
        ),
        (
            "application/capability-request.bin".to_owned(),
            holo.capability_request,
        ),
        ("application/directory.json".to_owned(), holo.directory),
        (
            "application/holo-identities.json".to_owned(),
            encode_value(
                &serde_json::to_value(holo.identities)
                    .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
            )?,
        ),
        ("application/lcnf-manifest.json".to_owned(), lcnf_manifest),
        (
            "application/model-provenance.json".to_owned(),
            holo.prism_extension,
        ),
        (
            "application/source-manifest.json".to_owned(),
            source_manifest,
        ),
        ("application/target-profile.json".to_owned(), target_profile),
        ("cargo/kernel.ir".to_owned(), kernel_bytes),
        ("cargo/roots.json".to_owned(), roots_bytes),
        ("cargo/coverage.json".to_owned(), coverage_bytes),
        (
            format!(
                "cargo/{}-{}.crate",
                application.cargo_name(),
                application.cargo_version()
            ),
            crate_bytes,
        ),
        (format!("core-wasm/{wasm_stem}.wasm"), wasm),
    ];
    artifacts.extend(
        package
            .files
            .into_iter()
            .map(|file| (format!("cargo/package/{}", file.path), file.bytes)),
    );
    artifacts.push(("view/browser-adapter/Cargo.lock".to_owned(), browser_lock));
    artifacts.push((format!("view/browser/{browser_js_name}"), browser_js));
    artifacts.push((format!("view/browser/{browser_wasm_name}"), browser_wasm));
    artifacts.push((
        "view/browser/provenance.json".to_owned(),
        browser_provenance,
    ));
    artifacts.extend(
        core_package
            .files
            .into_iter()
            .map(|file| (format!("core-wasm/package/{}", file.path), file.bytes)),
    );
    artifacts.extend(
        generated_view
            .hologram_assets
            .into_iter()
            .map(|file| (format!("view/hologram/{}", file.path), file.bytes)),
    );
    artifacts.push((
        "view/hologram/view.holoview".to_owned(),
        generated_view.hologram_bundle.bytes,
    ));
    artifacts.extend(
        generated_view
            .browser_assets
            .into_iter()
            .map(|file| (format!("view/browser/{}", file.path), file.bytes)),
    );
    artifacts.extend(
        generated_view
            .browser_adapter
            .files
            .into_iter()
            .map(|file| (format!("view/browser-adapter/{}", file.path), file.bytes)),
    );
    artifacts.push((
        "view/view-manifest.json".to_owned(),
        generated_view.view_manifest.bytes,
    ));
    if let Some((text, built)) = command_line {
        artifacts.extend(crate::text_cli::artifacts(text, built)?);
    }
    artifacts.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    if artifacts.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return Err(PrismError::new(
            "PP9001",
            "application generator produced duplicate paths",
        ));
    }
    if seed_custody.is_some() {
        work.protect_verified_package(&lean_package, &export_custody)?;
    }
    work.close()?;
    Ok(GeneratedApplication {
        artifacts,
        exporter_processes: vec![generated_process, build_process, exporter_process],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_entry_module() -> prod_ir::Module {
        prod_ir::parser::parse_module(
            "(module TextFixture (def dispatch ((input Bytes)) Bytes input))",
        )
        .unwrap()
        .1
    }

    fn text_model() -> ModelDocument {
        serde_json::from_slice(include_bytes!(
            "../../../tests/data/text-model-document.json"
        ))
        .unwrap()
    }

    #[test]
    fn application_export_imports_every_generated_module() {
        let model = text_model();
        let modules = [
            "PrismTextRequest.Foundation.View.Text.V1.Model".to_owned(),
            "PrismTextRequest.TextRequest".to_owned(),
        ]
        .into_iter()
        .collect();
        let arguments = application_export_arguments(
            &modules,
            model.application.as_ref().unwrap(),
            Path::new("export"),
        );
        let imported: BTreeSet<_> = arguments
            .windows(2)
            .filter(|pair| pair[0] == "--module")
            .map(|pair| pair[1].clone())
            .collect();
        assert_eq!(
            imported, modules,
            "exports must not load only the first module"
        );
    }

    #[test]
    fn application_text_ir_module_is_independent_of_display_name() {
        let mut model = text_model();
        for name in [
            "Text Request",
            "Text-Request",
            "Text.Request",
            "2026 Preview",
        ] {
            let Some(Application::Text(application)) = model.application.as_mut() else {
                panic!("text fixture");
            };
            application.name = name.to_owned();
            let arguments = application_export_arguments(
                &BTreeSet::new(),
                model.application.as_ref().unwrap(),
                Path::new("export"),
            );
            let module = &arguments[arguments
                .iter()
                .position(|arg| arg == "--ir-module")
                .unwrap()
                + 1];
            let source = format!("(module {module})");
            let (remaining, parsed) = prod_ir::parser::parse_module(&source).unwrap();
            assert!(remaining.is_empty());
            assert_eq!(parsed.name, "prism_text_request");
        }
    }

    #[test]
    fn application_single_module_export_arguments_bind_the_cargo_identity() {
        let model = text_model();
        let modules = ["PrismTextRequest.TextRequest".to_owned()]
            .into_iter()
            .collect();
        assert_eq!(
            application_export_arguments(
                &modules,
                model.application.as_ref().unwrap(),
                Path::new("export")
            ),
            [
                "exe",
                "prod-export",
                "--module",
                "PrismTextRequest.TextRequest",
                "--root",
                "PrismTextRequest.TextRequest.dispatch",
                "--ir-module",
                "prism_text_request",
                "--out",
                "export"
            ]
        );
    }

    #[test]
    fn text_view_binds_model_entry_limits_and_exact_core() {
        let model = text_model();
        let application = model.application.as_ref().unwrap();
        let core = "12".repeat(32);
        let (first, model_id, view_id) =
            application_view(&text_entry_module(), &model, application, &core).unwrap();
        let (second, _, _) =
            application_view(&text_entry_module(), &model, application, &core).unwrap();
        assert_eq!(first, second);
        assert_eq!(model_id, content_id(&encode_canonical_model(&model)));
        let manifest: Value = serde_json::from_slice(&first.view_manifest.bytes).unwrap();
        assert_eq!(manifest["profile"], "prism.text-view/1");
        assert_eq!(manifest["model_id"], model_id);
        assert_eq!(manifest["view_model_id"], view_id);
        assert_eq!(manifest["generated_core_sha256"], core);
        assert_eq!(manifest["max_input_bytes"], application.request_maximum());
        assert_eq!(manifest["max_output_bytes"], application.response_maximum());
        let binding = first
            .browser_adapter
            .files
            .iter()
            .find(|file| file.path == "generation-manifest.json")
            .unwrap();
        let binding: Value = serde_json::from_slice(&binding.bytes).unwrap();
        assert_eq!(binding["core_function"], "dispatch");
        assert_eq!(binding["core_crate"], "prism-text-request");
        let changed_core =
            application_view(&text_entry_module(), &model, application, &"34".repeat(32))
                .unwrap()
                .0;
        assert_ne!(changed_core.view_manifest, first.view_manifest);
        assert_ne!(changed_core.browser_adapter, first.browser_adapter);
    }

    fn encode_canonical_model(model: &ModelDocument) -> Vec<u8> {
        encode_value(&serde_json::to_value(model).unwrap()).unwrap()
    }

    #[test]
    fn text_view_rejects_invalid_evaluated_transport_metadata() {
        let mut model = text_model();
        let Some(Application::Text(application)) = model.application.as_mut() else {
            panic!("text fixture");
        };
        application.view.input_label.clear();
        assert_eq!(
            application_view(
                &text_entry_module(),
                &model,
                model.application.as_ref().unwrap(),
                &"12".repeat(32)
            )
            .unwrap_err()
            .code,
            "PP5203"
        );
    }
}

/// The model-owned target metadata, shared by generation and source-free
/// verification. V1 retains its original closed target/1 representation.
pub(crate) fn application_target_profile(application: &Application) -> Value {
    let mut target = json!({
        "contract": application.core_contract(),
        "export": "holo_run",
        "input_allocation_cap": application.guest_allocation_maximum(),
        "maximum_pages": application.core_memory_pages(),
        "response_maximum": application.response_maximum(),
        "schema": "lean4-prod/core-wasm-target/1"
    });
    if let Some(bytes) = application.core_stack_bytes() {
        target["schema"] = json!("lean4-prod/core-wasm-target/2");
        target["stack_bytes"] = json!(bytes);
    }
    target
}

/// Check both captured declarations and actual binary resources. This requires
/// no source workspace, compiler invocation, or regenerated acceptance record.
pub(crate) fn validate_application_core_resources(
    application: &Application,
    wasm: &[u8],
    target: &[u8],
    generation: &[u8],
) -> Result<(), PrismError> {
    let target: Value = serde_json::from_slice(target).map_err(|error| {
        PrismError::new("PP5103", format!("Core-Wasm target metadata: {error}"))
    })?;
    if target != application_target_profile(application) {
        return Err(PrismError::new(
            "PP5103",
            "Core-Wasm target metadata differs from the source-owned model",
        ));
    }
    let generation: Value = serde_json::from_slice(generation).map_err(|error| {
        PrismError::new("PP5103", format!("Core-Wasm generation metadata: {error}"))
    })?;
    let mut fields = vec![
        "entry",
        "export",
        "files",
        "input_allocation_cap",
        "input_ir_sha256",
        "maximum_pages",
        "output_allocation_cap",
        "schema",
    ];
    if application.core_stack_bytes().is_some() {
        fields.push("stack_bytes");
    }
    let exact = generation.as_object().is_some_and(|record| {
        record.keys().map(String::as_str).collect::<BTreeSet<_>>()
            == fields.into_iter().collect::<BTreeSet<_>>()
    });
    let schema = if application.core_stack_bytes().is_some() {
        "lean4-prod/core-wasm-target/2"
    } else {
        "lean4-prod/core-wasm-target/1"
    };
    if !exact
        || generation["schema"] != schema
        || generation["entry"] != application.entry_root().rsplit('.').next().unwrap_or("")
        || generation["export"] != "holo_run"
        || generation["maximum_pages"] != application.core_memory_pages()
        || generation["input_allocation_cap"] != application.guest_allocation_maximum()
        || generation["output_allocation_cap"] != application.response_maximum()
        || application
            .core_stack_bytes()
            .is_some_and(|bytes| generation["stack_bytes"] != bytes)
    {
        return Err(PrismError::new(
            "PP5103",
            "Core-Wasm generation bounds differ from the source-owned model",
        ));
    }
    validate_core_wasm_resources(
        wasm,
        application.core_memory_pages(),
        application.core_stack_bytes(),
    )
    .map_err(|error| PrismError::new("PP5103", error.to_string()))
}

#[cfg(test)]
mod resource_tests {
    use super::*;

    #[test]
    fn text_v2_resource_bounds_fallible_browser_entry_propagates_compute_error() {
        let ir = r#"(module BrowserEffect
          (def checked ((count Nat)) Nat (add count 18446744073709551615))
          (def dispatch ((input Bytes)) Bytes
            (if (eq (call checked (length input)) 18446744073709551615)
              (bytes 65) input)))"#;
        let (remaining, module) = prod_ir::parser::parse_module(ir).unwrap();
        assert!(remaining.trim().is_empty());
        let model: ModelDocument = serde_json::from_slice(include_bytes!(
            "../../../tests/data/text-model-document.json"
        ))
        .unwrap();
        let application = model.application.as_ref().unwrap();
        let stdlib: StdlibRelease = serde_json::from_str(STDLIB_RELEASE_SOURCE).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path();
        let package = generate_cargo_package(
            &module,
            &CargoPackageSpec {
                name: application.cargo_name().clone(),
                version: application.cargo_version().clone(),
                description: application.cargo_description().clone(),
                repository: application.cargo_repository().clone(),
                homepage: application.cargo_homepage().clone(),
                readme: "Generated checked-entry regression.\n".into(),
                license_mit: LICENSE_MIT.into(),
                license_apache: LICENSE_APACHE.into(),
                input_sha256: sha256(ir.as_bytes()),
                dependencies: vec![CargoDependency {
                    name: "prism-stdlib".into(),
                    version: "0.2.0".into(),
                    checksum: stdlib.crate_sha256.clone(),
                    default_features: false,
                    features: vec![],
                }],
            },
        )
        .unwrap();
        let core_root = workspace.join("core");
        publish_package(&core_root, &package).unwrap();
        let registry = stdlib_registry(workspace, &stdlib).unwrap();
        let home = cargo_home(workspace, &registry).unwrap();
        let env = BTreeMap::from([
            ("CARGO_HOME".into(), home.to_string_lossy().into_owned()),
            ("CARGO_NET_OFFLINE".into(), "true".into()),
        ]);
        let cargo = executable("cargo").unwrap();
        run(
            "application-cargo-package",
            &cargo,
            &["package", "--locked", "--offline", "--allow-dirty"],
            &core_root,
            &env,
            &[],
            "PP4102",
        )
        .unwrap();
        let crate_bytes = std::fs::read(core_root.join("target/package").join(format!(
            "{}-{}.crate",
            application.cargo_name(),
            application.cargo_version()
        )))
        .unwrap();
        add_application_to_registry(&registry, application, &crate_bytes, &stdlib.crate_sha256)
            .unwrap();
        let generated = application_view(&module, &model, application, &"12".repeat(32))
            .unwrap()
            .0;
        let browser = workspace.join("browser");
        publish_package(&browser, &generated.browser_adapter).unwrap();
        run(
            "browser-adapter-lock",
            &cargo,
            &["generate-lockfile", "--offline"],
            &browser,
            &env,
            &[],
            "PP5203",
        )
        .unwrap();
        run(
            "browser-adapter-wasm",
            &cargo,
            &[
                "build",
                "--locked",
                "--offline",
                "--release",
                "--target",
                "wasm32-unknown-unknown",
            ],
            &browser,
            &env,
            &[],
            "PP5203",
        )
        .unwrap();
        let wasm = browser
            .join("target/wasm32-unknown-unknown/release")
            .join(format!(
                "{}_browser.wasm",
                application.cargo_name().replace('-', "_")
            ));
        let binding = workspace.join("binding");
        run(
            "browser-adapter-bindgen",
            &executable("wasm-bindgen").unwrap(),
            &[
                wasm.to_str().unwrap(),
                "--target",
                "nodejs",
                "--out-dir",
                binding.to_str().unwrap(),
            ],
            workspace,
            &env,
            &[],
            "PP5203",
        )
        .unwrap();
        let script = workspace.join("check.cjs");
        std::fs::write(&script, format!(r#"
          const assert = require('node:assert/strict');
          const adapter = require('./binding/{}_browser.js');
          assert.deepEqual([...adapter.invoke_bytes(new Uint8Array())], [65]);
          assert.throws(() => adapter.invoke_bytes(Uint8Array.of(1)),
            error => error instanceof Error && error.name === 'ComputeError' && error.message === 'AddOverflow');
          assert.deepEqual([...adapter.invoke_bytes(new Uint8Array())], [65]);
        "#, application.cargo_name().replace('-', "_"))).unwrap();
        run(
            "browser-adapter-effect-runtime",
            &executable("node").unwrap(),
            &[script.to_str().unwrap()],
            workspace,
            &env,
            &[],
            "PP5203",
        )
        .unwrap();
    }

    #[test]
    fn text_v2_resource_bounds_normal_owner_preserves_package_linker_flags() {
        let ir = "(module ResourceFlags (def entry ((input Bytes)) Bytes input))";
        let (remaining, module) = prod_ir::parser::parse_module(ir).unwrap();
        assert!(remaining.trim().is_empty());
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("application work with spaces");
        let registry_source = directory.path().join("registry source with spaces");
        let mut base = BTreeMap::new();
        base.insert("CARGO_NET_OFFLINE".to_owned(), "true".to_owned());
        base.insert(
            "RUSTFLAGS".to_owned(),
            "--remap-path-prefix=/old=$OLD".to_owned(),
        );
        for (name, pages, stack) in [("legacy", 32, None), ("text-v2", 64, Some(131072))] {
            let spec = CoreWasmSpec {
                crate_name: format!("resource-flags-{name}"),
                entry: "entry".to_owned(),
                export_name: "holo_run".to_owned(),
                input_allocation_cap: 128,
                output_allocation_cap: 128,
                maximum_pages: pages,
                input_ir_sha256: sha256(ir.as_bytes()),
            };
            let package = match stack {
                Some(bytes) => generate_core_wasm_package_v2(&module, &spec, bytes),
                None => generate_core_wasm_package(&module, &spec),
            }
            .unwrap();
            let root = directory.path().join(name);
            publish_package(&root, &package).unwrap();
            let env =
                core_wasm_cargo_environment(&package, &base, &workspace, &registry_source).unwrap();
            assert!(!env.contains_key("RUSTFLAGS"));
            let flags = env["CARGO_ENCODED_RUSTFLAGS"]
                .split('\u{1f}')
                .collect::<Vec<_>>();
            assert!(flags.contains(
                &format!(
                    "--remap-path-prefix={}=$APPLICATION_WORK",
                    workspace.display()
                )
                .as_str()
            ));
            assert!(flags.contains(
                &format!(
                    "--remap-path-prefix={}=$CARGO_REGISTRY_SRC",
                    registry_source.display()
                )
                .as_str()
            ));
            run(
                "application-core-wasm",
                &executable("cargo").unwrap(),
                &["build", "--locked", "--offline", "--release"],
                &root,
                &env,
                &[],
                "PP5101",
            )
            .unwrap();
            let binary = root
                .join("target/wasm32-unknown-unknown/release")
                .join(format!("resource_flags_{}.wasm", name.replace('-', "_")));
            validate_core_wasm_resources(&std::fs::read(binary).unwrap(), pages, stack).unwrap();
            assert_eq!(base["RUSTFLAGS"], "--remap-path-prefix=/old=$OLD");
        }
    }

    #[test]
    fn text_v2_resource_bounds_normal_owner_rejects_malformed_owned_flags() {
        for config in [
            None,
            Some("[target]"),
            Some("not TOML"),
            Some("[target.wasm32-unknown-unknown]\nrustflags = []"),
            Some("[target.wasm32-unknown-unknown]\nrustflags = [1]"),
            Some("[target.wasm32-unknown-unknown]\nrustflags = [\"\"]"),
            Some("[target.wasm32-unknown-unknown]\nrustflags = [\"\\u001f\"]"),
            Some("[target.wasm32-unknown-unknown]\nrustflags = [\"\\u0000\"]"),
        ] {
            let package = GeneratedPackage {
                files: config
                    .into_iter()
                    .map(|text| PackageFile {
                        path: ".cargo/config.toml".into(),
                        bytes: text.as_bytes().to_vec(),
                    })
                    .collect(),
            };
            assert_eq!(
                core_wasm_cargo_environment(
                    &package,
                    &BTreeMap::new(),
                    Path::new("work"),
                    Path::new("registry")
                )
                .unwrap_err()
                .code,
                "PP5101"
            );
        }
    }

    #[test]
    fn text_v2_resource_bounds_source_free_binding_rejects_coherent_metadata_forgery() {
        let mut value: Value = serde_json::from_slice(include_bytes!(
            "../../../tests/data/text-model-document.json"
        ))
        .unwrap();
        value["schema"] = json!("prismpm/model-document/5");
        value["application"]["profile"] = json!("prismpm/text-application/2");
        value["application"]["core_memory_pages"] = json!(64);
        value["application"]["core_stack_bytes"] = json!(131072);
        let model: ModelDocument = serde_json::from_value(value).unwrap();
        crate::holo::validate::validate(&model).unwrap();
        let application = model.application.as_ref().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let wat = directory.path().join("guest.wat");
        let wasm = directory.path().join("guest.wasm");
        let source = r#"(module
          (memory (export "memory") 3 64)
          (global (export "__stack_low") i32 (i32.const 0))
          (global (export "__stack_high") i32 (i32.const 131072))
          (global $stack_pointer (mut i32) (i32.const 131072))
          (func (export "holo_alloc") (param i32) (result i32) i32.const 0)
          (func (export "holo_run") (param i32 i32) (result i64) i64.const 0))"#;
        let parse = |source: &str| {
            std::fs::write(&wat, source).unwrap();
            let output = std::process::Command::new("wasm-tools")
                .arg("parse")
                .arg(&wat)
                .arg("--output")
                .arg(&wasm)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            std::fs::read(&wasm).unwrap()
        };
        let binary = parse(source);
        let target = application_target_profile(application);
        let generation = json!({
            "entry": application.entry_root().rsplit('.').next().unwrap(), "export": "holo_run", "files": [],
            "input_allocation_cap": application.guest_allocation_maximum(), "input_ir_sha256": "0".repeat(64),
            "maximum_pages": 64, "output_allocation_cap": application.response_maximum(),
            "schema": "lean4-prod/core-wasm-target/2", "stack_bytes": 131072
        });
        let check = |binary: &[u8], target: &Value, generation: &Value| {
            validate_application_core_resources(
                application,
                binary,
                &serde_json::to_vec(target).unwrap(),
                &serde_json::to_vec(generation).unwrap(),
            )
        };
        check(&binary, &target, &generation).unwrap();
        for (key, replacement) in [
            ("maximum_pages", json!(65)),
            ("stack_bytes", json!(131088)),
            ("schema", json!("lean4-prod/core-wasm-target/1")),
            ("export", json!("other")),
        ] {
            let mut forged_target = target.clone();
            forged_target[key] = replacement.clone();
            let mut forged_generation = generation.clone();
            forged_generation[key] = replacement;
            assert_eq!(
                check(&binary, &forged_target, &forged_generation)
                    .unwrap_err()
                    .code,
                "PP5103"
            );
            assert_eq!(
                check(&binary, &target, &forged_generation)
                    .unwrap_err()
                    .code,
                "PP5103"
            );
        }
        // Hashes/inventories can be recomputed around these captured bytes;
        // the actual memory and stack sections must still match the model.
        for forged in [
            source.replace(
                "(global $stack_pointer (mut i32) (i32.const 131072))",
                "(global $stack_pointer (mut i32) (i32.const 4096))",
            ),
            source.replace("3 64", "3 63"),
            source.replace("3 64", "3 65"),
            source.replace("i32.const 131072", "i32.const 131088"),
        ] {
            assert_eq!(
                check(&parse(&forged), &target, &generation)
                    .unwrap_err()
                    .code,
                "PP5103"
            );
        }
        let mut unknown = generation.clone();
        unknown["unmodeled_override"] = json!(64);
        assert_eq!(
            check(&binary, &target, &unknown).unwrap_err().code,
            "PP5103"
        );
        let mut legacy = model.clone();
        if let Some(Application::Text(text)) = legacy.application.as_mut() {
            text.profile = "prismpm/text-application/1".into();
            text.core_memory_pages = None;
            text.core_stack_bytes = None;
        }
        let legacy_target = application_target_profile(legacy.application.as_ref().unwrap());
        assert_eq!(legacy_target["maximum_pages"], 32);
        assert_eq!(legacy_target["schema"], "lean4-prod/core-wasm-target/1");
        assert!(legacy_target.get("stack_bytes").is_none());
    }
}
