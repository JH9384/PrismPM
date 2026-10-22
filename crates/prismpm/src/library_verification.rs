//! Source-bound native-library replay, complete declaration audit, and execution.

use crate::config::ProjectConfig;
use crate::controller::{BuildResult, VerifyResult};
use crate::error::PrismError;
use crate::holo::canonical::{content_id, encode_value};
use crate::holo::model_document::{ModelDocument, ModelLibrary};
use crate::library_build::{sha256, write};
use crate::verification::{executable, run_process, ProcessRecord};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub(crate) struct LibraryVerification<'a> {
    pub(crate) repository_root: &'a Path,
    pub(crate) config: &'a ProjectConfig,
    pub(crate) build: BuildResult,
    pub(crate) model: ModelDocument,
    pub(crate) model_bytes: Vec<u8>,
    pub(crate) build_manifest: Value,
    pub(crate) build_root: &'a Path,
    pub(crate) lex_attestation: Vec<u8>,
    pub(crate) lex_attestation_id: String,
    pub(crate) lex_snapshot: Value,
    pub(crate) processes: Vec<ProcessRecord>,
    pub(crate) exporter_owner: crate::exporter::VerifyExporterOwner,
}

/// Audit every selected source declaration, including imported namespaces.
pub(crate) fn audit_declarations(attestation: &Value, snapshot: &Value) -> Result<(), PrismError> {
    let invalid = |message| PrismError::new("PP5003", message);
    let modules = snapshot["modules"]
        .as_array()
        .ok_or_else(|| invalid("library snapshot modules are absent"))?;
    let mut expected = BTreeMap::new();
    for module in modules {
        let owner = module["lean_module"]
            .as_str()
            .ok_or_else(|| invalid("library snapshot module name is absent"))?;
        for declaration in module["declarations"]
            .as_array()
            .ok_or_else(|| invalid("library snapshot declarations are absent"))?
        {
            let name = declaration["lean_name"]
                .as_str()
                .ok_or_else(|| invalid("library snapshot declaration name is absent"))?;
            if expected
                .insert(format!("{owner}.{name}"), declaration)
                .is_some()
            {
                return Err(invalid("library snapshot declaration is duplicated"));
            }
        }
    }
    if expected.is_empty() {
        return Err(invalid("library snapshot has no declarations to audit"));
    }
    let mut observed = BTreeSet::new();
    for audit in attestation["declarations"]
        .as_array()
        .ok_or_else(|| invalid("library declaration audit is absent"))?
    {
        let name = audit["name"]
            .as_str()
            .ok_or_else(|| invalid("library audit declaration name is absent"))?;
        let declaration = expected
            .get(name)
            .ok_or_else(|| invalid("library audit names an undeclared source declaration"))?;
        if !observed.insert(name) {
            return Err(invalid("library declaration audit is duplicated"));
        }
        if audit["result"] != "ok" || audit["policy"] != declaration["axiom_policy"] {
            return Err(invalid(
                "library declaration failed its exact source axiom policy",
            ));
        }
        let names = |value: &Value| -> Result<Vec<String>, PrismError> {
            let names = value
                .as_array()
                .ok_or_else(|| invalid("library axiom names are absent"))?
                .iter()
                .map(|name| {
                    name.as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| invalid("library axiom name is malformed"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            if names.windows(2).any(|pair| pair[0] >= pair[1]) {
                return Err(invalid("library axiom names are not canonical"));
            }
            Ok(names)
        };
        let actual = names(&audit["observed"])?;
        let permitted = names(&audit["policy"]["axioms"])?;
        if declaration["kind"] == "theorem" && !actual.is_empty() {
            return Err(invalid("library theorem has a nonempty axiom audit"));
        }
        let valid = match audit["policy"]["kind"].as_str() {
            Some("none") => actual.is_empty() && permitted.is_empty(),
            Some("exact") => actual == permitted,
            Some("allow") => actual.iter().all(|name| permitted.contains(name)),
            _ => false,
        };
        if !valid {
            return Err(invalid("library declaration relies on an unapproved axiom"));
        }
    }
    if observed.len() != expected.len() {
        return Err(invalid(
            "library declaration audit does not cover the complete selected snapshot",
        ));
    }
    Ok(())
}

fn acceptance_harness(library: &ModelLibrary) -> Result<String, PrismError> {
    let mut source = String::from(
        "trait Acceptance { fn accepted(self) -> bool; }\nimpl Acceptance for bool { fn accepted(self) -> bool { self } }\nimpl<E: core::fmt::Debug> Acceptance for Result<bool, E> { fn accepted(self) -> bool { self.expect(\"modeled acceptance returned a computation error\") } }\nfn main() {\n",
    );
    for root in &library.acceptance_roots {
        let function = root.rsplit('.').next().ok_or_else(|| {
            PrismError::new("PP2001", "native acceptance root has no executable name")
        })?;
        source.push_str(&format!(
            "assert!(Acceptance::accepted(prism_native_model::r#{function}()), {root:?});\n"
        ));
    }
    let result = encode_value(&json!({"roots":library.acceptance_roots,"status":"passed"}))?;
    let result = std::str::from_utf8(&result)
        .map_err(|error| PrismError::new("PP9001", error.to_string()))?;
    source.push_str(&format!("println!(\"{{}}\", {result:?});\n}}\n"));
    Ok(source)
}

fn acceptance_manifest(library: &ModelLibrary, enabled_std: bool) -> String {
    let features = if enabled_std {
        ", features = [\"std\"]"
    } else {
        ""
    };
    // Package names may be Rust keywords or shadow sysroot crates. Keep their
    // exact registry identity while giving the consumer a fixed local name.
    format!(
        "[package]\nname = \"prism-native-acceptance\"\nversion = \"0.0.0\"\nedition = \"2021\"\npublish = false\n\n[dependencies]\nprism_native_model = {{ package = \"{}\", version = \"={}\", default-features = false{} }}\n",
        library.cargo_name, library.cargo_version, features,
    )
}

fn registry_cargo_home(
    workspace: &Path,
    library: &ModelLibrary,
    archive: &[u8],
) -> Result<PathBuf, PrismError> {
    let registry = workspace.join("registry");
    let name = &library.cargo_name;
    let index_path = match name.len() {
        1 => format!("index/1/{name}"),
        2 => format!("index/2/{name}"),
        3 => format!("index/3/{}/{name}", &name[..1]),
        _ => format!("index/{}/{}/{name}", &name[..2], &name[2..4]),
    };
    let archive_name = format!("{}-{}.crate", name, library.cargo_version);
    write(&registry.join(&archive_name), archive)?;
    let mut index = encode_value(&json!({
        "cksum":sha256(archive),"deps":[],"features":{"default":["std"],"std":[]},
        "name":name,"vers":library.cargo_version,"yanked":false
    }))?;
    index.push(b'\n');
    write(&registry.join(index_path), &index)?;
    let cargo_home = workspace.join("cargo-home");
    std::fs::create_dir(&cargo_home)
        .map_err(|error| PrismError::new("PP4002", error.to_string()))?;
    write(&cargo_home.join("config.toml"), format!(
        "[net]\noffline = true\n\n[source.crates-io]\nreplace-with = \"prism-native\"\n\n[source.prism-native]\nlocal-registry = {:?}\n", registry.to_string_lossy()
    ).as_bytes())?;
    Ok(cargo_home)
}

pub(crate) fn run(mut context: LibraryVerification<'_>) -> Result<VerifyResult, PrismError> {
    let library = context.model.library.as_ref().ok_or_else(|| {
        PrismError::new("PP9001", "native verification requires a library profile")
    })?;
    let attestation: Value = serde_json::from_slice(&context.lex_attestation)
        .map_err(|error| PrismError::new("PP4004", error.to_string()))?;
    audit_declarations(&attestation, &context.lex_snapshot)?;
    crate::verification::verify_application_build_closure(
        context.build_root,
        &context.build_manifest,
    )?;
    let lex_root = context.build_root.join("lexlean/build");
    let lex_manifest = std::fs::read(lex_root.join("manifest.json"))
        .map_err(|error| PrismError::new("PP4002", error.to_string()))?;
    // The controller build is export A. This independently exports and packages
    // the attested Lean closure as export B; both complete byte sets must agree.
    let replay = crate::library_build::generate_owned(
        context.repository_root,
        &context.model,
        &context.model_bytes,
        &lex_root,
        &lex_manifest,
        &mut context.exporter_owner,
        crate::exporter::Phase::Replay,
    )?;
    let expected_paths = context.build_manifest["files"]
        .as_array()
        .ok_or_else(|| PrismError::new("PP4004", "library build manifest files are absent"))?
        .iter()
        .filter_map(|row| row["path"].as_str())
        .filter(|path| path.starts_with("library/"))
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    let replay_paths = replay
        .artifacts
        .iter()
        .map(|(path, _)| path.clone())
        .collect::<BTreeSet<_>>();
    if expected_paths != replay_paths {
        return Err(PrismError::new(
            "PP5004",
            "library regeneration artifact closure differs",
        ));
    }
    for (path, bytes) in &replay.artifacts {
        let observed = std::fs::read(context.build_root.join(path))
            .map_err(|error| PrismError::new("PP4002", error.to_string()))?;
        if observed != *bytes {
            return Err(PrismError::new(
                "PP5004",
                format!("library regeneration differs: {path}"),
            ));
        }
    }
    context.processes.extend(replay.processes);
    let work = tempfile::Builder::new()
        .prefix("prismpm-native-verify-")
        .tempdir()
        .map_err(|error| PrismError::new("PP4002", error.to_string()))?;
    let archive_name = format!("{}-{}.crate", library.cargo_name, library.cargo_version);
    let archive = &replay
        .artifacts
        .iter()
        .find(|(path, _)| path == &format!("library/{archive_name}"))
        .ok_or_else(|| PrismError::new("PP4102", "generated library archive is absent"))?
        .1;
    let cargo_home = registry_cargo_home(work.path(), library, archive)?;
    let environment = BTreeMap::from([
        (
            "CARGO_HOME".to_owned(),
            cargo_home.to_string_lossy().into_owned(),
        ),
        ("CARGO_NET_OFFLINE".to_owned(), "true".to_owned()),
        (
            "RUSTFLAGS".to_owned(),
            format!(
                "--remap-path-prefix={}=$LIBRARY_VERIFY",
                work.path().display()
            ),
        ),
    ]);
    let replacements = [
        (work.path(), "$LIBRARY_VERIFY"),
        (context.repository_root, "$PROJECT"),
        (context.build_root, "$BUILD"),
    ];
    let cargo = executable("cargo")?;
    let expected_output =
        encode_value(&json!({"roots":library.acceptance_roots,"status":"passed"}))?;
    let mut executions = Vec::new();
    for (mode, enabled) in [("std", true), ("no_std", false)] {
        let consumer = work.path().join(format!("consumer-{mode}"));
        write(
            &consumer.join("Cargo.toml"),
            acceptance_manifest(library, enabled).as_bytes(),
        )?;
        write(
            &consumer.join("src/main.rs"),
            acceptance_harness(library)?.as_bytes(),
        )?;
        context.processes.push(run_process(
            &format!("native-library-{mode}-lock"),
            &cargo,
            &["generate-lockfile", "--offline"].map(str::to_owned),
            &consumer,
            &environment,
            &replacements,
            "PP4102",
        )?);
        let record = run_process(
            &format!("native-library-{mode}-acceptance"),
            &cargo,
            &["run", "--locked", "--offline", "--quiet"].map(str::to_owned),
            &consumer,
            &environment,
            &replacements,
            "PP5006",
        )?;
        if record.stdout.trim_end_matches('\n').as_bytes() != expected_output {
            return Err(PrismError::new(
                "PP5006",
                "native modeled acceptance transcript differs",
            ));
        }
        executions.push(json!({"mode":mode,"roots":library.acceptance_roots,"status":"passed"}));
        context.processes.push(record);
    }
    let bindings = replay
        .artifacts
        .iter()
        .map(|(path, bytes)| {
            json!({
                "byte_length": bytes.len(), "path":path, "sha256":sha256(bytes),
            })
        })
        .collect::<Vec<_>>();
    let acceptance = crate::contracts::CanonicalDocument::from_value(
        "prismpm/library-acceptance/1",
        json!({
            "build_id":context.build.build_id,
            "executions":executions,
            "export_roots":library.export_roots,
            "lexlean_attestation_id":context.lex_attestation_id,
            "model_id":content_id(&context.model_bytes),
            "profile":library.profile,
            "regeneration":"byte-identical",
            "schema":"prismpm/library-acceptance/1",
            "scope":"native-library-only",
            "status":"passed",
            "unclaimed":["application","browser","holo","production-release","deployment"]
        }),
    )?
    .bytes()
    .to_vec();
    let manifest = crate::contracts::CanonicalDocument::from_value(
        "prismpm/library-verification-manifest/2",
        {
            let owner = context.exporter_owner.finish()?;
            let lex: Value = serde_json::from_slice(&lex_manifest)
                .map_err(|error| PrismError::new("PP4004", error.to_string()))?;
            let modules = lex["outputs"]
                .as_array()
                .expect("generated manifest outputs")
                .iter()
                .filter(|row| row["kind"] == "lean")
                .map(|row| {
                    row["path"]
                        .as_str()
                        .expect("generated Lean path")
                        .strip_prefix("modules/")
                        .expect("generated modules root")
                        .strip_suffix(".lean")
                        .expect("generated Lean extension")
                        .replace('/', ".")
                })
                .collect::<BTreeSet<_>>();
            let processes = serde_json::to_value(&context.processes)
                .map_err(|error| PrismError::new("PP4004", error.to_string()))?;
            crate::exporter::validate_owner_binding(
                &owner,
                &sha256(&context.model_bytes),
                "library",
                &lex_manifest,
                &json!(bindings),
                processes.as_array().expect("serialized process array"),
                &crate::library_build::export_arguments(
                    &modules,
                    library,
                    Path::new("$LIBRARY_WORK/export"),
                ),
            )?;
            json!({
                "acceptance_sha256":sha256(&acceptance),
                "artifacts":bindings,
                "build_id":context.build.build_id,
                "exporter_owner":owner,
                "lexlean_attestation_sha256":sha256(&context.lex_attestation),
                "model_sha256":sha256(&context.model_bytes),
                "processes":context.processes,
                "schema":"prismpm/library-verification-manifest/2",
                "scope":"native-library-only"
            })
        },
    )?
    .bytes()
    .to_vec();
    let attestation_id = content_id(&manifest);
    let files = vec![
        ("library-acceptance.json".to_owned(), acceptance),
        (
            "lexlean-attestation.json".to_owned(),
            context.lex_attestation,
        ),
        ("manifest.json".to_owned(), manifest),
    ];
    crate::verification::publish(
        &context.config.output_root(context.repository_root)?,
        &attestation_id,
        &files,
    )?;
    Ok(VerifyResult {
        schema: "prismpm/verify-result/1".to_owned(),
        attestation_id: attestation_id.clone(),
        build_id: context.build.build_id,
        verified_root: format!("{}/verified/{attestation_id}", context.config.build_root),
    })
}

#[cfg(test)]
mod tests {
    use super::{acceptance_harness, acceptance_manifest, audit_declarations, registry_cargo_home};
    use crate::holo::model_document::ModelLibrary;
    use crate::library_build::{sha256, write};
    use crate::verification::{executable, run_process};
    use prod_codegen::{generate_cargo_package, CargoPackageSpec};
    use prod_ir::{Definition, Expr, Module, Type};
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn native_archive_consumers_alias_keywords_and_sysroot_names_in_both_modes() {
        let work = tempfile::tempdir().unwrap();
        let cargo = executable("cargo").unwrap();
        let package_home = work.path().join("package-cargo-home");
        std::fs::create_dir(&package_home).unwrap();
        let package_env = BTreeMap::from([
            (
                "CARGO_HOME".to_owned(),
                package_home.to_string_lossy().into_owned(),
            ),
            ("CARGO_NET_OFFLINE".to_owned(), "true".to_owned()),
        ]);
        let replacements = [(work.path(), "$NAME_PROBE")];
        let module = Module {
            name: "NativeNameProbe".to_owned(),
            types: Vec::new(),
            definitions: vec![Definition {
                name: "acceptance".to_owned(),
                params: Vec::new(),
                ret: Type::Bool,
                body: Expr::Bool(true),
            }],
        };
        for name in ["self", "crate", "super", "core", "std", "alloc", "match"] {
            let library = ModelLibrary {
                profile: "prismpm/native-library/1".to_owned(),
                name: "Native name probe".to_owned(),
                cargo_name: name.to_owned(),
                cargo_version: "0.1.0".to_owned(),
                cargo_description: "Native dependency alias regression".to_owned(),
                cargo_repository: "https://github.com/UOR-Foundation/PrismPM".to_owned(),
                cargo_homepage: "https://github.com/UOR-Foundation/PrismPM".to_owned(),
                export_roots: vec!["NativeNameProbe.acceptance".to_owned()],
                acceptance_roots: vec!["NativeNameProbe.acceptance".to_owned()],
            };
            crate::holo::library::validate(&library).unwrap();
            let package = generate_cargo_package(
                &module,
                &CargoPackageSpec {
                    name: library.cargo_name.clone(),
                    version: library.cargo_version.clone(),
                    description: library.cargo_description.clone(),
                    repository: library.cargo_repository.clone(),
                    homepage: library.cargo_homepage.clone(),
                    readme: library.name.clone(),
                    license_mit: include_str!("../LICENSE-MIT").to_owned(),
                    license_apache: include_str!("../LICENSE-APACHE").to_owned(),
                    input_sha256: sha256(format!("{module:?}").as_bytes()),
                    dependencies: Vec::new(),
                },
            )
            .unwrap();
            let case = work.path().join(name);
            let package_root = case.join("package");
            for file in package.files {
                write(&package_root.join(file.path), &file.bytes).unwrap();
            }
            run_process(
                "name-probe-package",
                &cargo,
                &["package", "--locked", "--offline", "--allow-dirty"].map(str::to_owned),
                &package_root,
                &package_env,
                &replacements,
                "PP4102",
            )
            .unwrap_or_else(|error| panic!("package {name}: {error}"));
            let archive =
                std::fs::read(package_root.join(format!("target/package/{name}-0.1.0.crate")))
                    .unwrap();
            let cargo_home = registry_cargo_home(&case, &library, &archive).unwrap();
            let environment = BTreeMap::from([
                (
                    "CARGO_HOME".to_owned(),
                    cargo_home.to_string_lossy().into_owned(),
                ),
                ("CARGO_NET_OFFLINE".to_owned(), "true".to_owned()),
            ]);
            for (mode, enabled) in [("std", true), ("no_std", false)] {
                let consumer = case.join(mode);
                let manifest = acceptance_manifest(&library, enabled);
                let parsed: toml::Value = toml::from_str(&manifest).unwrap();
                let dependency = &parsed["dependencies"]["prism_native_model"];
                assert_eq!(dependency["package"].as_str(), Some(name));
                assert_eq!(dependency["version"].as_str(), Some("=0.1.0"));
                assert!(dependency.get("path").is_none());
                write(&consumer.join("Cargo.toml"), manifest.as_bytes()).unwrap();
                write(
                    &consumer.join("src/main.rs"),
                    acceptance_harness(&library).unwrap().as_bytes(),
                )
                .unwrap();
                run_process(
                    "name-probe-lock",
                    &cargo,
                    &["generate-lockfile", "--offline"].map(str::to_owned),
                    &consumer,
                    &environment,
                    &replacements,
                    "PP4102",
                )
                .unwrap();
                let record = run_process(
                    "name-probe-acceptance",
                    &cargo,
                    &["run", "--locked", "--offline", "--quiet"].map(str::to_owned),
                    &consumer,
                    &environment,
                    &replacements,
                    "PP5006",
                )
                .unwrap_or_else(|error| panic!("consumer {name}/{mode}: {error}"));
                assert_eq!(
                    serde_json::from_str::<serde_json::Value>(&record.stdout).unwrap(),
                    json!({"roots":library.acceptance_roots,"status":"passed"}),
                    "{name}/{mode}",
                );
                let lock: toml::Value =
                    toml::from_str(&std::fs::read_to_string(consumer.join("Cargo.lock")).unwrap())
                        .unwrap();
                let selected = lock["package"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|row| row["name"].as_str() == Some(name))
                    .unwrap();
                assert_eq!(
                    selected["checksum"].as_str(),
                    Some(sha256(&archive).as_str())
                );
                assert_eq!(
                    selected["source"].as_str(),
                    Some("registry+https://github.com/rust-lang/crates.io-index"),
                );
            }
        }
    }

    #[test]
    fn complete_library_audit_covers_imported_namespaces_and_rejects_all_gaps() {
        let policy = json!({"kind":"none","axioms":[]});
        let snapshot = json!({"modules":[{"lean_module":"Outside.Prism","declarations":[
            {"lean_name":"fact","kind":"theorem","axiom_policy":policy},
            {"lean_name":"run","kind":"definition","axiom_policy":policy}
        ]}]});
        let valid = json!({"declarations":[
            {"name":"Outside.Prism.fact","result":"ok","policy":policy,"observed":[]},
            {"name":"Outside.Prism.run","result":"ok","policy":policy,"observed":[]}
        ]});
        audit_declarations(&valid, &snapshot).unwrap();
        for mutation in 0..7 {
            let mut value = valid.clone();
            match mutation {
                0 => {
                    value["declarations"].as_array_mut().unwrap().pop();
                }
                1 => {
                    let row = value["declarations"][0].clone();
                    value["declarations"].as_array_mut().unwrap().push(row);
                }
                2 => value["declarations"][0]["observed"] = json!(["sorryAx"]),
                3 => {
                    value["declarations"][1]["policy"] =
                        json!({"kind":"allow","axioms":["sorryAx"]})
                }
                4 => value["declarations"][1]["result"] = json!("failed"),
                5 => value["declarations"][1]["name"] = json!("Unselected.run"),
                _ => value["declarations"][1]["observed"] = json!([1]),
            }
            assert_eq!(
                audit_declarations(&value, &snapshot).unwrap_err().code,
                "PP5003"
            );
        }
    }
}
