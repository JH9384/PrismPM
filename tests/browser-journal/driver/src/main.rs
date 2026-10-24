//! Generic compiler orchestration for the modeled byte-reducer corpus.
use camino::Utf8Path;
use lexlean::{Engine, LockRequest, Selection, VerifyRequest};
use prod_codegen::{
    generate_cargo_package, generate_core_wasm_package, CargoPackageSpec, CoreWasmSpec,
};
use prod_ir::parser::parse_module;
use sha2::{Digest, Sha256};
use std::{error::Error, fs, path::Path};

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match args.as_slice() {
        [mode, project] if mode == "verify" => {
            let engine = Engine::load(Utf8Path::new(project))?;
            engine.lock(LockRequest {
                check_only: false,
                allow_network: false,
            })?;
            let result = engine.verify(VerifyRequest {
                selection: Selection::All,
            })?;
            let mut texts = Vec::new();
            for unit in result.units.values() {
                let relative = format!("modules/{}.lean", unit.lean_module.replace('.', "/"));
                texts.push(std::fs::read_to_string(result.root.join(relative))?);
            }
            let runtime = lexlean::backend::runtime::imported_by(texts.iter().map(String::as_str))
                .map_err(|diagnostic| diagnostic.message)?
                .into_iter()
                .map(|module| serde_json::json!({"name": module.name, "text": module.text}))
                .collect::<Vec<_>>();
            println!(
                "{}",
                serde_json::json!({
                    "attestation_id": result.attestation_id.to_string(),
                    "build_id": result.build_id.to_string(),
                    "semantic_id": result.semantic_id.to_string(),
                    "source_id": result.source_id.to_string(),
                    "root": result.root.as_str(),
                    "modules": result.units.keys().collect::<Vec<_>>(),
                    "runtime": runtime,
                })
            );
        }
        [mode, input, output, licenses] if mode == "generate" || mode == "generate-wasm" => {
            let root = Path::new(output);
            fs::create_dir(root)?;
            let source = fs::read_to_string(input)?;
            let (remaining, module) = parse_module(&source).map_err(|e| format!("IR: {e}"))?;
            if !remaining.trim().is_empty() {
                return Err("trailing IR".into());
            }
            let package = if mode == "generate-wasm" {
                generate_core_wasm_package(
                    &module,
                    &CoreWasmSpec {
                        crate_name: "browser-workspace-journal-wasm-probe".into(),
                        entry: "workspaceJournalBytes".into(),
                        export_name: "holo_run".into(),
                        input_allocation_cap: 1_235_980,
                        output_allocation_cap: 1_166_008,
                        maximum_pages: 640,
                        input_ir_sha256: format!("{:x}", Sha256::digest(source.as_bytes())),
                    },
                )
            } else {
                generate_cargo_package(
                    &module,
                    &CargoPackageSpec {
                        name: "browser-workspace-journal-core-probe".into(),
                        version: "0.1.0".into(),
                        description:
                            "Generated verification fixture for the modeled workspace reducer"
                                .into(),
                        repository: "https://github.com/UOR-Foundation/PrismPM".into(),
                        homepage: "https://github.com/UOR-Foundation/PrismPM".into(),
                        readme: "Generated verification fixture; not an application release.\n"
                            .into(),
                        license_mit: fs::read_to_string(Path::new(licenses).join("LICENSE-MIT"))?,
                        license_apache: fs::read_to_string(
                            Path::new(licenses).join("LICENSE-APACHE"),
                        )?,
                        input_sha256: format!("{:x}", Sha256::digest(source.as_bytes())),
                        dependencies: vec![],
                    },
                )
            }
            .map_err(|e| format!("code generation: {e}"))?;
            for file in package.files {
                let path = root.join(file.path);
                fs::create_dir_all(path.parent().ok_or("generated parent")?)?;
                fs::write(path, file.bytes)?;
            }
            println!(
                "{}",
                serde_json::json!({"ir_sha256": format!("{:x}", Sha256::digest(source.as_bytes()))})
            );
        }
        _ => {
            return Err(
                "expected verify PROJECT or generate[-wasm] IR ABSENT_OUTPUT LICENSE_ROOT".into(),
            )
        }
    }
    Ok(())
}
