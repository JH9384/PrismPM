//! Execute the conditional native-lane reducer, never claim OS-effect authority.

use prismpm::controller::{CheckRequest, VerifyRequest};
use prismpm::holo::canonical::content_id;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const DIRECTORY: &str = "stdlib/src/Foundation/Native/Application/V1";
const MODULE: &str = "LibraryProbe.Foundation.Native.Application.V1.Lease";
const COUNT: usize = 93;
const WASM_ENTRY: &str = "leaseCorpusBytes";
const METHODS: &[&str] = &[
    "nativeBindingEqual",
    "nativeLaneValid",
    "openNativeLane",
    "beginNativeLease",
    "cancelNativeLease",
    "closeNativeLane",
    "completeNativeLease",
    "retainUnknownNativeCleanup",
    "retireCancelledNativeLease",
];

fn semantic(source: &str) -> Value {
    crate::semantic_source::read(source)
}

fn rewrite(source: &str, value: &Value) -> String {
    crate::semantic_source::write(source, value)
}

fn root_list(values: &[String], prefix: &str, declarations: &mut Vec<Value>) -> Value {
    let mut chunks = Vec::new();
    for (index, values) in values.chunks(16).enumerate() {
        let name = format!("{prefix}{index}");
        let body = values.iter().rev().fold(
            json!({"kind":"nil","element":{"kind":"string"}}),
            |tail, value| json!({"kind":"cons","head":{"kind":"string","value":value},"tail":tail}),
        );
        declarations.push(json!({"kind":"definition","name":name,"parameters":[],
            "result":{"kind":"list","element":{"kind":"string"}},"body":body}));
        chunks.push(json!({"kind":"call","function":{"name":name},"arguments":[]}));
    }
    while chunks.len() > 1 {
        chunks = chunks.chunks(2).map(|pair| {
            if pair.len() == 1 { pair[0].clone() } else {
                json!({"kind":"primitive","operation":"append","result":{"kind":"list","element":{"kind":"string"}},"arguments":pair})
            }
        }).collect();
    }
    chunks.pop().unwrap()
}

// Only the case selector is serialized here. Every decision remains in the
// original LexLean corpus and is elaborated/exported by the normal verifier.
fn wasm_entries() -> Vec<Value> {
    let branch = |condition: Value, yes: Value, no: Value| {
        json!({"kind":"match","scrutinee":condition,"branches":[
            {"constructor":{"name":"Bool.false"},"binders":[],"body":no},
            {"constructor":{"name":"Bool.true"},"binders":[],"body":yes}
        ]})
    };
    let mut declarations = Vec::new();
    for chunk in (0..COUNT.div_ceil(16)).rev() {
        let mut body = if (chunk + 1) * 16 < COUNT {
            json!({"kind":"call","function":{"name":format!("{WASM_ENTRY}{}",chunk+1)},
                "arguments":[{"kind":"var","name":"request"}]})
        } else {
            json!({"kind":"bytes","hex":"ff"})
        };
        for index in (chunk * 16..((chunk + 1) * 16).min(COUNT)).rev() {
            let accepted = branch(
                json!({"kind":"call","function":{"module":"Foundation.Native.Application.V1.LeaseCorpus",
                "name":format!("probe{index:03}")},"arguments":[]}),
                json!({"kind":"bytes","hex":"01"}),
                json!({"kind":"bytes","hex":"00"}),
            );
            body = branch(
                json!({"kind":"primitive","operation":"equal","result":{"kind":"bool"},
                "arguments":[{"kind":"var","name":"request"},{"kind":"bytes","hex":format!("{index:02x}")}]}),
                accepted,
                body,
            );
        }
        declarations.push(json!({"kind":"definition","name":if chunk == 0 { WASM_ENTRY.into() } else { format!("{WASM_ENTRY}{chunk}") },
            "parameters":[{"name":"request","type":{"kind":"bytes"}}],
            "result":{"kind":"bytes"},"body":body,"axioms":[]}));
    }
    declarations
}

fn selector_mapping_valid(entries: &[Value]) -> bool {
    if entries.len() != COUNT.div_ceil(16) {
        return false;
    }
    for (position, declaration) in entries.iter().enumerate() {
        let chunk = entries.len() - position - 1;
        let name = if chunk == 0 {
            WASM_ENTRY.into()
        } else {
            format!("{WASM_ENTRY}{chunk}")
        };
        if declaration["name"] != name
            || declaration["parameters"] != json!([{"name":"request","type":{"kind":"bytes"}}])
        {
            return false;
        }
        let mut body = &declaration["body"];
        for index in chunk * 16..((chunk + 1) * 16).min(COUNT) {
            if body["kind"] != "match"
                || body["branches"].as_array().map(Vec::len) != Some(2)
                || body["scrutinee"]
                    != json!({"kind":"primitive","operation":"equal","result":{"kind":"bool"},
                    "arguments":[{"kind":"var","name":"request"},{"kind":"bytes","hex":format!("{index:02x}")}]})
                || body["branches"][0]["constructor"]["name"] != "Bool.false"
                || body["branches"][1]["constructor"]["name"] != "Bool.true"
            {
                return false;
            }
            let selected = &body["branches"][1]["body"];
            if selected
                != &json!({"kind":"match","scrutinee":{"kind":"call","function":{
                "module":"Foundation.Native.Application.V1.LeaseCorpus","name":format!("probe{index:03}")},"arguments":[]},
                "branches":[
                    {"constructor":{"name":"Bool.false"},"binders":[],"body":{"kind":"bytes","hex":"00"}},
                    {"constructor":{"name":"Bool.true"},"binders":[],"body":{"kind":"bytes","hex":"01"}}
                ]})
            {
                return false;
            }
            body = &body["branches"][0]["body"];
        }
        let terminal = if (chunk + 1) * 16 < COUNT {
            json!({"kind":"call","function":{"name":format!("{WASM_ENTRY}{}",chunk+1)},
                "arguments":[{"kind":"var","name":"request"}]})
        } else {
            json!({"kind":"bytes","hex":"ff"})
        };
        if body != &terminal {
            return false;
        }
    }
    true
}

struct Fixture {
    project: tempfile::TempDir,
    roots: Vec<String>,
    exports: Vec<String>,
    declarations: BTreeSet<String>,
    inputs: BTreeMap<String, Vec<u8>>,
}

fn fixture(root: &Path) -> Fixture {
    let inputs = [
        format!("{DIRECTORY}/Lease.lex.tex"),
        format!("{DIRECTORY}/LeaseCorpus.lex.tex"),
        format!("{DIRECTORY}/lease-corpus.json"),
        "tests/native-lease/corpus.mjs".into(),
        "tests/native-lease/corpus.test.mjs".into(),
        "tests/native-lease/rust-corpus.mjs".into(),
        "tests/native-lease/rust-corpus.test.mjs".into(),
        "tests/native-lease/package.mjs".into(),
        "tests/native-lease/wasm.mjs".into(),
        "scripts/product-sdk-check.mjs".into(),
        "scripts/library-sdk-check.mjs".into(),
        "scripts/browser-api-sdk-check.mjs".into(),
        "scripts/sdk-command-owner.mjs".into(),
        "scripts/sdk-command-owner.py".into(),
        "sdk/inventory-metadata.mjs".into(),
        "sdk/platform-lock.mjs".into(),
        "sdk/migration-qualification.mjs".into(),
        "sdk/metadata-cli.mjs".into(),
        "sdk/metadata-capture.mjs".into(),
        "sdk/metadata-evidence.mjs".into(),
        "sdk/metadata-evidence-cli.mjs".into(),
        "scripts/library-sdk-metadata-evidence.mjs".into(),
        "sdk/metadata-credentials.mjs".into(),
        "sdk/metadata-helper.mjs".into(),
        "sdk/metadata-layer.mjs".into(),
        "sdk/metadata-transport.mjs".into(),
        "rust-toolchain.toml".into(),
        "stdlib/generated/package/Cargo.lock".into(),
        "stdlib/generated/package/Cargo.toml".into(),
        "stdlib/generated/package/LICENSE-APACHE".into(),
        "stdlib/generated/package/LICENSE-MIT".into(),
        "stdlib/generated/package/README.md".into(),
        "stdlib/generated/package/generation-manifest.json".into(),
        "stdlib/generated/package/src/lib.rs".into(),
    ]
    .into_iter()
    .map(|name| {
        let bytes = std::fs::read(root.join(&name)).unwrap();
        (name, bytes)
    })
    .collect::<BTreeMap<_, _>>();
    // This only serializes explicit cases; it never interprets the reducer.
    let status = std::process::Command::new("node")
        .arg("tests/native-lease/corpus.mjs")
        .current_dir(root)
        .status()
        .unwrap();
    assert!(status.success(), "complete JSON/LexLean corpus linkage");
    let index: Value =
        serde_json::from_slice(&inputs[&format!("{DIRECTORY}/lease-corpus.json")]).unwrap();
    assert_eq!(index["cases"].as_array().unwrap().len(), COUNT);
    let model =
        semantic(std::str::from_utf8(&inputs[&format!("{DIRECTORY}/Lease.lex.tex")]).unwrap());
    let corpus = semantic(
        std::str::from_utf8(&inputs[&format!("{DIRECTORY}/LeaseCorpus.lex.tex")]).unwrap(),
    );
    let roots = corpus["declarations"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(index, declaration)| {
            assert_eq!(declaration["name"], format!("probe{index:03}"));
            assert_eq!(declaration["parameters"], json!([]));
            assert_eq!(declaration["axioms"], json!([]));
            assert_eq!(declaration["result"], json!({"kind":"bool"}));
            format!("{MODULE}Corpus.probe{index:03}")
        })
        .collect::<Vec<_>>();
    assert_eq!(roots.len(), COUNT);
    let mut exports = roots.clone();
    exports.extend(METHODS.iter().map(|method| format!("{MODULE}.{method}")));
    exports.push(format!("LibraryProbe.Probe.{WASM_ENTRY}"));
    exports.sort();
    let project = tempfile::Builder::new()
        .prefix("prismpm-native-lease-")
        .tempdir()
        .unwrap();
    crate::fixtures::copy_dir_recursive(
        &root.join("tests/fixtures/library/native-library/project"),
        project.path(),
    )
    .unwrap();
    let target = project.path().join("src/Foundation/Native/Application/V1");
    std::fs::create_dir_all(&target).unwrap();
    for name in ["Lease.lex.tex", "LeaseCorpus.lex.tex"] {
        std::fs::write(target.join(name), &inputs[&format!("{DIRECTORY}/{name}")]).unwrap();
    }
    let probe_path = project.path().join("src/Probe.lex.tex");
    let probe_source = std::fs::read_to_string(&probe_path).unwrap();
    let mut probe = semantic(&probe_source);
    let mut descriptor = probe["declarations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|declaration| declaration["name"] == "probeLibrary")
        .unwrap()
        .clone();
    let declarations = probe["declarations"].as_array_mut().unwrap();
    declarations.clear();
    let entries = wasm_entries();
    assert!(selector_mapping_valid(&entries));
    declarations.extend(entries);
    let exported = root_list(&exports, "exported", declarations);
    let accepted = root_list(&roots, "accepted", declarations);
    for field in descriptor["body"]["fields"].as_array_mut().unwrap() {
        match field["field"].as_str().unwrap() {
            "exportRoots" => field["value"] = exported.clone(),
            "acceptanceRoots" => field["value"] = accepted.clone(),
            "name" => field["value"]["value"] = json!("Conditional native operation lease"),
            "cargoName" => field["value"]["value"] = json!("prism-native-lease-conformance"),
            _ => {}
        }
    }
    declarations.push(descriptor);
    let probe_source = probe_source.replace(
        "\\importmodule{Foundation.Library.V1.Model}\n",
        "\\importmodule{Foundation.Library.V1.Model}\n\\importmodule{Foundation.Native.Application.V1.LeaseCorpus}\n",
    );
    std::fs::write(&probe_path, rewrite(&probe_source, &probe)).unwrap();
    let library_source = std::fs::read_to_string(
        project
            .path()
            .join("src/Foundation/Library/V1/Model.lex.tex"),
    )
    .unwrap();
    let mut declarations = BTreeSet::new();
    for (namespace, module) in [
        (MODULE.to_owned(), model),
        (format!("{MODULE}Corpus"), corpus),
        ("LibraryProbe.Probe".into(), probe),
        (
            "LibraryProbe.Foundation.Library.V1.Model".into(),
            semantic(&library_source),
        ),
    ] {
        for declaration in module["declarations"].as_array().unwrap() {
            assert!(declarations.insert(format!(
                "{namespace}.{}",
                declaration["name"].as_str().unwrap()
            )));
        }
    }
    Fixture {
        project,
        roots,
        exports,
        declarations,
        inputs,
    }
}

fn accepted(fixture: &Fixture, verified: &prismpm::controller::VerifyResult) {
    let output = fixture.project.path().join(&verified.verified_root);
    let manifest_bytes = std::fs::read(output.join("manifest.json")).unwrap();
    let manifest: Value = serde_json::from_slice(&manifest_bytes).unwrap();
    let acceptance_bytes = std::fs::read(output.join("library-acceptance.json")).unwrap();
    let acceptance: Value = serde_json::from_slice(&acceptance_bytes).unwrap();
    assert_eq!(verified.attestation_id, content_id(&manifest_bytes));
    assert_eq!(manifest["acceptance_sha256"], content_id(&acceptance_bytes));
    assert_eq!(
        manifest["schema"],
        "prismpm/library-verification-manifest/2"
    );
    assert_eq!(acceptance["schema"], "prismpm/library-acceptance/1");
    assert_eq!(acceptance["profile"], "prismpm/native-library/1");
    assert_eq!(acceptance["scope"], "native-library-only");
    assert_eq!(acceptance["status"], "passed");
    assert_eq!(acceptance["regeneration"], "byte-identical");
    assert_eq!(acceptance["build_id"], verified.build_id);
    assert_eq!(acceptance["export_roots"], json!(fixture.exports));
    assert_eq!(
        acceptance["unclaimed"],
        json!([
            "application",
            "browser",
            "holo",
            "production-release",
            "deployment"
        ])
    );
    assert_eq!(
        acceptance["executions"],
        json!([
            {"mode":"std","roots":fixture.roots,"status":"passed"},
            {"mode":"no_std","roots":fixture.roots,"status":"passed"}
        ])
    );
    let attestation_bytes = std::fs::read(output.join("lexlean-attestation.json")).unwrap();
    assert_eq!(
        manifest["lexlean_attestation_sha256"],
        content_id(&attestation_bytes)
    );
    let attestation: Value = serde_json::from_slice(&attestation_bytes).unwrap();
    assert_eq!(attestation["status"], "verified");
    let mut observed = BTreeSet::new();
    for row in super::owned_audits(&attestation) {
        assert_eq!(row["result"], "ok");
        assert_eq!(row["observed"], json!([]));
        assert!(observed.insert(row["name"].as_str().unwrap().to_owned()));
    }
    assert_eq!(observed, fixture.declarations);
    for mode in ["std", "no_std"] {
        let rows = manifest["processes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["tool"] == format!("native-library-{mode}-acceptance"))
            .collect::<Vec<_>>();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["exit_code"], 0);
        let stdout: Value = serde_json::from_str(rows[0]["stdout"].as_str().unwrap()).unwrap();
        assert_eq!(stdout, json!({"roots":fixture.roots,"status":"passed"}));
    }
}

fn mutate(value: &mut Value, kind: &str) -> usize {
    if kind == "binding" || kind == "state" {
        let condition = value["body"].clone();
        value["body"] = json!({"kind":"match","scrutinee":condition,"branches":[
            {"constructor":{"name":"Bool.false"},"binders":[],"body":{"kind":"bool","value":true}},
            {"constructor":{"name":"Bool.true"},"binders":[],"body":{"kind":"bool","value":true}}
        ]});
        return 1;
    }
    fn change(value: &mut Value, kind: &str) -> usize {
        if value["kind"] == "record" && value["type"]["name"] == "NativeLease" {
            for field in value["fields"].as_array_mut().unwrap() {
                if field["field"] == kind && field["value"] == json!({"kind":"bool","value":true}) {
                    field["value"]["value"] = json!(false);
                    return 1;
                }
            }
        }
        match value {
            Value::Object(fields) => fields.values_mut().map(|value| change(value, kind)).sum(),
            Value::Array(values) => values.iter_mut().map(|value| change(value, kind)).sum(),
            _ => 0,
        }
    }
    change(&mut value["body"], kind)
}

fn verified_names(project: &Path) -> BTreeSet<String> {
    std::fs::read_dir(project.join(".prism/verified"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect()
}

fn verify_wasm(root: &Path, fixture: &Fixture, verified: &prismpm::controller::VerifyResult) {
    let build = fixture
        .project
        .path()
        .join(".prism/build")
        .join(&verified.build_id);
    let kernel = std::fs::read(build.join("library/kernel.ir")).unwrap();
    let manifest: Value = serde_json::from_slice(
        &std::fs::read(
            fixture
                .project
                .path()
                .join(&verified.verified_root)
                .join("manifest.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let bindings = manifest["artifacts"].as_array().unwrap();
    let rows = bindings
        .iter()
        .filter(|row| row["path"] == "library/kernel.ir")
        .collect::<Vec<_>>();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["sha256"], content_id(&kernel));
    assert_eq!(rows[0]["byte_length"], kernel.len());
    let (remaining, module) =
        prod_ir::parser::parse_module(std::str::from_utf8(&kernel).unwrap()).unwrap();
    assert!(remaining.trim().is_empty());
    let generated = prod_codegen::generate_core_wasm_package(
        &module,
        &prod_codegen::CoreWasmSpec {
            crate_name: "native-lease-wasm".into(),
            entry: WASM_ENTRY.into(),
            export_name: "holo_run".into(),
            input_allocation_cap: 2,
            output_allocation_cap: 1,
            maximum_pages: 32,
            input_ir_sha256: content_id(&kernel),
        },
    )
    .unwrap();
    let package = tempfile::tempdir().unwrap();
    for file in generated.files {
        let path = package.path().join(&file.path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, file.bytes).unwrap();
    }
    let output = std::process::Command::new("node")
        .arg(root.join("tests/native-lease/wasm.mjs"))
        .arg(package.path())
        .output()
        .unwrap();
    let stderr = String::from_utf8(output.stderr).unwrap();
    eprintln!("{stderr}");
    assert!(output.status.success(), "{stderr}");
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(receipt["scope"], "generated-lease-wasm-corpus-only");
    assert_eq!(receipt["cases"], COUNT);
    assert_eq!(receipt["invalid_selectors"], 3);
    assert_eq!(receipt["runtime_mutants"], 1);
    assert_eq!(receipt["imports"], 0);
    assert_eq!(
        receipt
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        [
            "cases",
            "imports",
            "invalid_selectors",
            "runtime_mutants",
            "scope",
            "wasm_sha256"
        ]
    );
    let digest = receipt["wasm_sha256"].as_str().unwrap();
    assert_eq!(digest.len(), 64);
    assert!(digest
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
    eprintln!("DK-30: {COUNT} compiled Wasm probes, three invalid selectors, runtime expectation mutant; Wasm {digest}");
}

pub(super) fn verify(root: &Path) {
    super::verify_node_suite(
        root,
        "DK-30",
        &[
            "tests/native-lease/corpus.test.mjs",
            "tests/native-lease/rust-corpus.test.mjs",
        ],
        8,
        "120000",
    );
    let fixture = fixture(root);
    let controller = prismpm::Controller::load(fixture.project.path()).unwrap();
    controller
        .check(CheckRequest { config_path: None })
        .expect("the actual native lease model checks");
    let verified = match controller.verify(VerifyRequest { config_path: None }) {
        Ok(value) => value,
        Err(error) => {
            let retained = fixture.project.keep();
            panic!(
                "native lease verification failed; retained {}: {error:?}",
                retained.display()
            );
        }
    };
    accepted(&fixture, &verified);
    verify_wasm(root, &fixture, &verified);
    let output = std::process::Command::new("node")
        .arg("tests/native-lease/package.mjs")
        .current_dir(root)
        .output()
        .expect("generated stdlib consumer executes");
    let stderr = String::from_utf8(output.stderr).unwrap();
    eprintln!("{stderr}");
    assert!(output.status.success(), "{stderr}");
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        receipt,
        json!({
            "scope": "generated-package-corpus-only", "cases": COUNT,
            "signatures": METHODS.len(), "modes": ["std", "no_std"], "runtime_mutants": 1,
            "package_manifest_sha256": content_id(&fixture.inputs["stdlib/generated/package/generation-manifest.json"]),
            "corpus_sha256": content_id(&fixture.inputs[&format!("{DIRECTORY}/lease-corpus.json")]),
        })
    );
    let original_path = fixture
        .project
        .path()
        .join("src/Foundation/Native/Application/V1/Lease.lex.tex");
    let original = std::fs::read_to_string(&original_path).unwrap();
    let before = verified_names(fixture.project.path());
    for (name, kind, rejected) in [
        ("nativeBindingEqual", "binding", 41),
        ("nativeLaneValid", "state", 77),
        ("cancelNativeLease", "cancelled", 26),
        ("retainUnknownNativeCleanup", "uncertain", 42),
    ] {
        let mut module = semantic(&original);
        let declaration = module["declarations"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|declaration| declaration["name"] == name)
            .unwrap();
        assert_eq!(mutate(declaration, kind), 1, "one actual lifecycle defect");
        std::fs::write(&original_path, rewrite(&original, &module)).unwrap();
        let controller = prismpm::Controller::load(fixture.project.path()).unwrap();
        controller
            .check(CheckRequest { config_path: None })
            .expect("mutant remains well typed");
        let error = controller
            .verify(VerifyRequest { config_path: None })
            .unwrap_err();
        assert_eq!(error.code, "PP5006");
        assert!(
            error
                .message
                .starts_with("native-library-std-acceptance exited 101:"),
            "{error:?}"
        );
        assert!(
            error.message.contains("panicked at src/main.rs:"),
            "{error:?}"
        );
        assert!(
            error
                .message
                .contains(&format!("\\n{MODULE}Corpus.probe{rejected:03}\\n")),
            "{error:?}"
        );
        assert!(!error.message.contains("could not compile"));
        assert_eq!(verified_names(fixture.project.path()), before);
        std::fs::write(&original_path, &original).unwrap();
        eprintln!("DK-30: actual {kind} mutant rejected by probe{rejected:03}");
    }
    for (path, bytes) in &fixture.inputs {
        assert_eq!(std::fs::read(root.join(path)).unwrap(), *bytes);
    }
    eprintln!("DK-30: {COUNT} std/no_std and Wasm probes, complete source/axiom audit, four runtime mutants; attestation {}", verified.attestation_id);
}

#[cfg(test)]
mod selector_tests {
    use super::*;

    #[test]
    fn generated_wasm_selector_mapping_rejects_every_misroute_and_constant_result() {
        let original = wasm_entries();
        assert!(selector_mapping_valid(&original));
        for index in 0..COUNT {
            for kind in ["misroute", "constant", "wrong-selector"] {
                let mut changed = original.clone();
                let mut body = &mut changed[COUNT.div_ceil(16) - index / 16 - 1]["body"];
                for _ in 0..index % 16 {
                    body = &mut body["branches"][0]["body"];
                }
                match kind {
                    "misroute" => {
                        body["branches"][1]["body"]["scrutinee"]["function"]["name"] =
                            json!(format!("probe{:03}", (index + 1) % COUNT))
                    }
                    "constant" => body["branches"][1]["body"] = json!({"kind":"bytes","hex":"01"}),
                    "wrong-selector" => {
                        body["scrutinee"]["arguments"][1]["hex"] =
                            json!(format!("{:02x}", (index + 1) % COUNT))
                    }
                    _ => unreachable!(),
                }
                assert!(!selector_mapping_valid(&changed), "{index}: {kind}");
            }
        }
        let mut changed = original.clone();
        changed.reverse();
        assert!(!selector_mapping_valid(&changed));
        changed = original;
        changed.pop();
        assert!(!selector_mapping_valid(&changed));
    }
}
