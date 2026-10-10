//! Generic source generation for the mandatory bounded raw-file CLI.
use crate::error::PrismError;
use crate::holo::binary_program::BinaryProgram;
use prod_codegen::{GeneratedPackage, PackageFile};

pub(crate) fn generate(program: &BinaryProgram) -> Result<GeneratedPackage, PrismError> {
    crate::holo::binary_program::validate(program)?;
    let entry = program.entry_root.rsplit('.').next().ok_or_else(|| PrismError::new("PP2001", "binary entry is absent"))?;
    let manifest = format!(
        "[package]\nname = \"{}-cli\"\nversion = \"{}\"\nedition = \"2021\"\npublish = false\n\n[dependencies]\nprism_binary_core = {{ package = \"{}\", version = \"={}\", default-features = false, features = [\"std\"] }}\n",
        program.cargo_name,program.cargo_version,program.cargo_name,program.cargo_version,
    );
    let source = include_str!("binary_cli/main.rs.in")
        .replace("@REQUEST_MAXIMUM@", &program.request_maximum.to_string())
        .replace("@RESPONSE_MAXIMUM@", &program.response_maximum.to_string())
        .replace("@ENTRY@", entry);
    Ok(GeneratedPackage { files: vec![
        PackageFile {path:"Cargo.toml".into(), bytes:manifest.into_bytes()},
        PackageFile {path:"src/main.rs".into(), bytes:source.into_bytes()},
    ] })
}

#[cfg(test)]
mod tests {
    #[test]
    fn raw_cli_template_has_typed_failures_and_no_text_protocol() {
        let source = include_str!("binary_cli/main.rs.in");
        for name in ["InvalidArguments","InputOpen","InputType","InputRead","InputLimit","AdapterAllocation","ComputeFailure","OutputLimit","OutputExists","OutputOpen","OutputWrite"] {
            assert!(source.contains(name),"{name}");
        }
        assert!(source.contains("try_reserve_exact"));
        assert!(source.contains("create_new(true)"));
        for forbidden in ["from_utf8","read_to_string","Command::new","std::env::var","UORC"] { assert!(!source.contains(forbidden),"{forbidden}"); }
    }
}

#[cfg(test)]
mod execution_tests {
    use super::*;
    use crate::library_build::{sha256,write};
    use crate::verification::{executable,run_process};
    use prod_codegen::{generate_cargo_package,CargoPackageSpec};
    use prod_ir::{Definition,Expr,Module,Type};
    use serde_json::{json,Value};
    use std::collections::BTreeMap;

    fn program()->BinaryProgram {
        serde_json::from_value(json!({
            "profile":"prismpm/binary-program/1","name":"Adapter failure probe", "cargo_name":"prism-binary-failure", "cargo_version":"0.1.0",
            "cargo_description":"Real generated raw adapter failure regression", "cargo_repository":"https://github.com/UOR-Foundation/PrismPM", "cargo_homepage":"https://github.com/UOR-Foundation/PrismPM",
            "export_roots":["Probe.entry"],"entry_root":"Probe.entry","request_maximum":256,"response_maximum":256,"memory_pages":32,
            "acceptance_vectors":[{"request":[],"response":[]}],"cli":{"profile":"prismpm/raw-file-cli/1"}
        })).unwrap()
    }

    #[test]
    fn generated_raw_cli_executes_real_output_limit_and_compute_failures_before_publication() {
        let cargo=executable("cargo").unwrap();
        for (name,body) in [
            ("OutputLimit",Expr::Bytes(vec![0xff;257])),
            ("ComputeFailure",Expr::Let("checked".into(),Box::new(Expr::Add(Box::new(Expr::Nat(u64::MAX)),Box::new(Expr::Nat(1)))),Box::new(Expr::Bytes(vec![])))),
        ] {
            let work=tempfile::tempdir().unwrap();let program=program();
            let module=Module{name:"BinaryFailure".into(),types:vec![],definitions:vec![Definition{name:"entry".into(),params:vec![("value".into(),Type::Bytes)],ret:Type::Bytes,body}]};
            let package=generate_cargo_package(&module,&CargoPackageSpec {
                name:program.cargo_name.clone(),version:program.cargo_version.clone(),description:program.cargo_description.clone(),repository:program.cargo_repository.clone(),homepage:program.cargo_homepage.clone(),readme:program.name.clone(),
                license_mit:include_str!("../LICENSE-MIT").into(),license_apache:include_str!("../LICENSE-APACHE").into(),input_sha256:sha256(format!("{module:?}").as_bytes()),dependencies:vec![],
            }).unwrap();
            let package_root=work.path().join("package");
            for file in package.files {write(&package_root.join(file.path),&file.bytes).unwrap();}
            let package_home=work.path().join("package-home");std::fs::create_dir(&package_home).unwrap();
            let environment=BTreeMap::from([("CARGO_HOME".into(),package_home.to_string_lossy().into_owned()),("CARGO_NET_OFFLINE".into(),"true".into())]);
            let replacements=[(work.path(),"$BINARY_FAILURE")];
            run_process("binary-failure-package",&cargo,&["package","--locked","--offline","--allow-dirty"].map(str::to_owned),&package_root,&environment,&replacements,"PP4102").unwrap();
            let archive=std::fs::read(package_root.join("target/package/prism-binary-failure-0.1.0.crate")).unwrap();
            let cargo_home=crate::library_verification::registry_cargo_home(work.path(),&program.metadata(),&archive).unwrap();
            let environment=BTreeMap::from([("CARGO_HOME".into(),cargo_home.to_string_lossy().into_owned()),("CARGO_NET_OFFLINE".into(),"true".into())]);
            let cli_root=work.path().join("cli");for file in generate(&program).unwrap().files {write(&cli_root.join(file.path),&file.bytes).unwrap();}
            for args in [vec!["generate-lockfile","--offline"],vec!["build","--locked","--offline"]] {
                run_process("binary-failure-cli",&cargo,&args.into_iter().map(str::to_owned).collect::<Vec<_>>(),&cli_root,&environment,&replacements,"PP4102").unwrap();
            }
            let input=work.path().join("input");std::fs::write(&input,[]).unwrap();let destination=work.path().join("output");
            let actual=std::process::Command::new(cli_root.join("target/debug/prism-binary-failure-cli")).env_clear()
                .arg("--input").arg(input).arg("--output").arg(&destination).output().unwrap();
            assert_eq!(actual.status.code(),Some(1));assert!(actual.stdout.is_empty());assert_eq!(actual.stderr,format!("{name}:NotPublished\n").as_bytes());
            assert!(!destination.exists(),"failure must precede destination creation");
            // Exercise the same real IR failure through the generated Core-Wasm adapter.
            // Both checked computation errors and overlong output are traps, with no detailed trap claim.
            let wasm = prod_codegen::generate_core_wasm_package(&module,&prod_codegen::CoreWasmSpec {
                crate_name:"prism-binary-failure-core-wasm".into(),entry:"entry".into(),export_name:"binary_run".into(),
                input_allocation_cap:256,output_allocation_cap:256,maximum_pages:32,
                input_ir_sha256:sha256(format!("{module:?}").as_bytes()),
            }).unwrap();
            let wasm_root=work.path().join("wasm");for file in wasm.files {write(&wasm_root.join(file.path),&file.bytes).unwrap();}
            run_process("binary-failure-wasm",&cargo,&["build","--locked","--offline","--release"].map(str::to_owned),&wasm_root,&environment,&replacements,"PP5101").unwrap();
            let runner=work.path().join("failure.mjs");
            write(&runner,b"import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';const module=await WebAssembly.compile(readFileSync(process.argv[2]));assert.deepEqual(WebAssembly.Module.imports(module),[]);const {exports:e}=new WebAssembly.Instance(module,{});const at=e.holo_alloc(0);assert.throws(()=>e.binary_run(at,0),WebAssembly.RuntimeError);console.log('passed actual generated failure');\n").unwrap();
            let record=run_process("binary-failure-wasm-execute",&executable("node").unwrap(),&[
                runner.to_string_lossy().into_owned(),wasm_root.join("target/wasm32-unknown-unknown/release/prism_binary_failure_core_wasm.wasm").to_string_lossy().into_owned(),
            ],work.path(),&BTreeMap::new(),&replacements,"PP5006").unwrap();
            assert_eq!(record.stdout,"passed actual generated failure\n");assert!(record.stderr.is_empty());
        }
    }

    #[test]
    fn raw_cli_failures_match_exact_source_model_and_diagnostic_registry() {
        let source=include_str!("../stdlib/src/Foundation/Binary/V1/Model.lex.tex");
        let line=source.lines().find_map(|line|line.strip_prefix("\\semanticdata{")).unwrap().strip_suffix('}').unwrap();
        let module:Value=serde_json::from_str(line).unwrap();
        let declaration=module["declarations"].as_array().unwrap().iter().find(|d|d["name"]=="AdapterFailure").unwrap();
        let names=declaration["constructors"].as_array().unwrap().iter().map(|c|c["name"].as_str().unwrap()).collect::<Vec<_>>();
        let registry:toml::Value=toml::from_str(include_str!("../model/binary-adapter-diagnostics.toml")).unwrap();
        let registered=registry["error"].as_array().unwrap().iter().map(|r|r["code"].as_str().unwrap()).collect::<Vec<_>>();
        assert_eq!(names,registered);
        let template=include_str!("binary_cli/main.rs.in");
        let generated=template.split("enum AdapterFailure {").nth(1).unwrap().split('}').next().unwrap().split(',').map(str::trim).filter(|v|!v.is_empty()).collect::<Vec<_>>();
        assert_eq!(generated,names);
        assert_eq!(registry["capability"].as_str(),Some("DK-29"));
        let semantics=module["declarations"].as_array().unwrap().iter().find(|d|d["name"]=="failurePublication").unwrap();
        for (row,branch) in registry["error"].as_array().unwrap().iter().zip(semantics["body"]["branches"].as_array().unwrap()) {
            let outcome=if row["code"].as_str()==Some("OutputWrite") {"Unknown"} else {"NotPublished"};
            assert_eq!(row["publication"].as_str(),Some(outcome));
            assert_eq!(branch["constructor"]["name"],format!("AdapterFailure.{}",row["code"].as_str().unwrap()));
            assert_eq!(branch["body"]["constructor"]["name"],format!("PublicationOutcome.{outcome}"));
        }
    }
}
