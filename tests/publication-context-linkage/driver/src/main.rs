//! Test-only orchestration of the real LexLean and lean4-prod toolchains.
use camino::Utf8Path;
use lexlean::{CheckRequest, Engine, LockRequest, Selection, VerifyRequest};
use prod_codegen::{
    generate_cargo_package, generate_core_wasm_package, CargoPackageSpec, CoreWasmSpec,
};
use prod_ir::parser::parse_module;
use sha2::{Digest, Sha256};
use std::{error::Error, fs, path::Path};

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match args.as_slice() {
        [mode, project] if mode == "check" => {
            let engine = Engine::load(Utf8Path::new(project))?;
            engine.lock(LockRequest {
                check_only: false,
                allow_network: false,
            })?;
            let checked = engine.check(CheckRequest {
                selection: Selection::All,
            })?;
            println!(
                "{}",
                serde_json::json!({"modules":checked.units.keys().collect::<Vec<_>>(),"source_id":checked.source_id.to_string()})
            );
        }
        [mode, project] if mode == "verify" => {
            let engine = Engine::load(Utf8Path::new(project))?;
            engine.lock(LockRequest {
                check_only: false,
                allow_network: false,
            })?;
            let result = engine.verify(VerifyRequest {
                selection: Selection::All,
            })?;
            println!(
                "{}",
                serde_json::json!({
                    "attestation_id":result.attestation_id.to_string(),
                    "build_id":result.build_id.to_string(),
                    "semantic_id":result.semantic_id.to_string(),
                    "source_id":result.source_id.to_string(),
                    "root":result.root.as_str(),
                    "modules":result.units.keys().collect::<Vec<_>>()
                })
            );
        }
        [mode, input, output, licenses]
            if ["native", "wasm", "context-fields-wasm", "admission-wasm"]
                .contains(&mode.as_str()) =>
        {
            let root = Path::new(output);
            fs::create_dir(root)?;
            let source = fs::read_to_string(input)?;
            let (remaining, module) =
                parse_module(&source).map_err(|error| format!("IR: {error}"))?;
            if !remaining.trim().is_empty() {
                return Err("trailing IR".into());
            }
            let input_sha256 = format!("{:x}", Sha256::digest(source.as_bytes()));
            let package = if mode == "native" {
                generate_cargo_package(
                    &module,
                    &CargoPackageSpec {
                        name: "publication-context-linkage-core-probe".into(),
                        version: "0.1.0".into(),
                        description: "Generated internal publication verification fixture".into(),
                        repository: "https://github.com/UOR-Foundation/PrismPM".into(),
                        homepage: "https://github.com/UOR-Foundation/PrismPM".into(),
                        readme:
                            "Internal generated verification fixture; not an application release.\n"
                                .into(),
                        license_mit: fs::read_to_string(Path::new(licenses).join("LICENSE-MIT"))?,
                        license_apache: fs::read_to_string(
                            Path::new(licenses).join("LICENSE-APACHE"),
                        )?,
                        input_sha256: input_sha256.clone(),
                        dependencies: vec![],
                    },
                )
            } else {
                generate_core_wasm_package(
                    &module,
                    &CoreWasmSpec {
                        crate_name: "publication-context-linkage-wire-probe".into(),
                        entry: match mode.as_str() {
                            "context-fields-wasm" => "publicationContextFieldsWireBytes",
                            "admission-wasm" => "publicationWireBytes",
                            _ => "publicationLinkageWireBytes",
                        }
                        .into(),
                        export_name: "holo_run".into(),
                        input_allocation_cap: 67_108_864,
                        output_allocation_cap: 67_108_864,
                        maximum_pages: 16_384,
                        input_ir_sha256: input_sha256.clone(),
                    },
                )
            }
            .map_err(|error| format!("code generation: {error}"))?;
            for file in package.files {
                let destination = root.join(file.path);
                fs::create_dir_all(destination.parent().ok_or("missing parent")?)?;
                fs::write(destination, file.bytes)?;
            }
            println!("{}", serde_json::json!({"ir_sha256":input_sha256}));
        }
        _ => {
            return Err(
                "expected verify PROJECT or native|wasm|context-fields-wasm|admission-wasm IR ABSENT_OUTPUT LICENSE_ROOT".into(),
            )
        }
    }
    Ok(())
}
