//! Finite native/Wasm oracle for the internal bounded CBOR primitive profile.

use prismpm::controller::{CheckRequest, VerifyRequest};
use prismpm::holo::canonical::{content_id, encode_value};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const DIRECTORY: &str = "stdlib/src/Foundation/Codec/Cbor/V1";
const ROOT_COUNT: usize = 194;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CorpusIndex {
    schema: String,
    roots: Vec<String>,
    errors: Vec<String>,
    cases: Vec<CorpusCase>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CorpusCase {
    root: String,
    id: String,
    kind: String,
    source: Option<String>,
    hex: Option<String>,
    error: Option<String>,
    count: Option<u64>,
    bytes: Option<u64>,
}

struct Fixture {
    project: tempfile::TempDir,
    roots: Vec<String>,
    exports: Vec<String>,
    declarations: BTreeSet<String>,
}

fn semantic(source: &str) -> Value {
    let line = source
        .lines()
        .find_map(|line| line.strip_prefix("\\semanticdata{"))
        .unwrap();
    serde_json::from_str(line.strip_suffix('}').unwrap()).unwrap()
}

fn rewrite(source: &str, value: &Value) -> String {
    let payload = String::from_utf8(encode_value(value).unwrap()).unwrap();
    source
        .lines()
        .map(|line| {
            if line.starts_with("\\semanticdata{") {
                format!("\\semanticdata{{{payload}}}\n")
            } else {
                format!("{line}\n")
            }
        })
        .collect()
}

fn strings(values: &[String]) -> Value {
    values.iter().rev().fold(
        json!({"kind":"nil","element":{"kind":"string"}}),
        |tail, value| json!({"kind":"cons","head":{"kind":"string","value":value},"tail":tail}),
    )
}

fn root_chunks(values: &[String], prefix: &str, declarations: &mut Vec<Value>) -> Value {
    let mut chunks = Vec::new();
    for (index, values) in values.chunks(16).enumerate() {
        let name = format!("{prefix}{index}");
        declarations.push(json!({"kind":"definition","name":name,"parameters":[],
            "result":{"kind":"list","element":{"kind":"string"}},"body":strings(values)}));
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

fn fixture(root: &Path) -> Fixture {
    let source = root.join(DIRECTORY);
    for name in [
        "Primitive.lex.tex",
        "PrimitiveCorpus.lex.tex",
        "primitive-corpus.json",
    ] {
        assert!(
            source.join(name).is_file(),
            "ST-16 requires its actual model and finite oracle: {name}"
        );
    }
    let index: CorpusIndex =
        serde_json::from_slice(&std::fs::read(source.join("primitive-corpus.json")).unwrap())
            .unwrap();
    assert_eq!(index.schema, "prismpm/cbor-primitive-corpus/1");
    assert_eq!(index.roots.len(), ROOT_COUNT);
    assert_eq!(
        index
            .cases
            .iter()
            .map(|row| row.root.clone())
            .collect::<Vec<_>>(),
        index.roots
    );
    for row in &index.cases {
        assert!(!row.id.is_empty() && row.root.ends_with(&format!(".probe{}", row.id)));
        assert!(!row.kind.is_empty());
        if let Some(source) = &row.source {
            assert!(!source.is_empty());
        }
        if let Some(hex) = &row.hex {
            assert!(
                hex.len() % 2 == 0
                    && hex
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            );
        }
        if let Some(error) = &row.error {
            assert!(index.errors.contains(error));
        }
        for number in [row.count, row.bytes].into_iter().flatten() {
            assert!(number <= u32::MAX.into());
        }
    }
    assert!(index.roots.windows(2).all(|pair| pair[0] < pair[1]));
    let model = semantic(&std::fs::read_to_string(source.join("Primitive.lex.tex")).unwrap());
    let errors = model["declarations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == "CborError")
        .unwrap()["constructors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["name"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert_eq!(errors.len(), 9);
    assert_eq!(index.errors, errors);
    let corpus =
        semantic(&std::fs::read_to_string(source.join("PrimitiveCorpus.lex.tex")).unwrap());
    let actual = corpus["declarations"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|row| {
            let name = row["name"].as_str().unwrap();
            name.starts_with("probe").then(|| {
                assert_eq!(row["parameters"], json!([]));
                assert_eq!(row["result"], json!({"kind":"bool"}));
                format!("LibraryProbe.Foundation.Codec.Cbor.V1.PrimitiveCorpus.{name}")
            })
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(actual, index.roots.iter().cloned().collect());
    assert_eq!(actual.len(), ROOT_COUNT);

    let project = tempfile::Builder::new()
        .prefix("prismpm-cbor-primitive-")
        .tempdir()
        .unwrap();
    crate::fixtures::copy_dir_recursive(
        &root.join("tests/fixtures/library/native-library/project"),
        project.path(),
    )
    .unwrap();
    let target = project.path().join("src/Foundation/Codec/Cbor/V1");
    std::fs::create_dir_all(&target).unwrap();
    for name in ["Primitive.lex.tex", "PrimitiveCorpus.lex.tex"] {
        let bytes = std::fs::read(source.join(name)).unwrap();
        std::fs::write(target.join(name), &bytes).unwrap();
        assert_eq!(std::fs::read(target.join(name)).unwrap(), bytes);
    }
    for name in ["Bytes.lex.tex", "Codec.lex.tex"] {
        std::fs::copy(
            root.join("stdlib/src/Foundation").join(name),
            project.path().join("src/Foundation").join(name),
        )
        .unwrap();
    }
    let probe_path = project.path().join("src/Probe.lex.tex");
    let probe_source = std::fs::read_to_string(&probe_path).unwrap();
    let mut probe = semantic(&probe_source);
    probe["declarations"]
        .as_array_mut()
        .unwrap()
        .retain(|row| row["name"] == "probeLibrary");
    let mut exports = index.roots.clone();
    exports.extend(
        [
            "readCborPrimitive",
            "readCborArrayHead",
            "writeCborPrimitive",
            "writeCborArrayHead",
            "finishCborCursor",
            "canonicalCborPrimitiveBytes",
        ]
        .map(|name| format!("LibraryProbe.Foundation.Codec.Cbor.V1.Primitive.{name}")),
    );
    exports.push(
        "LibraryProbe.Foundation.Codec.Cbor.V1.PrimitiveCorpus.cborCorpusProbeBytes".to_owned(),
    );
    exports.sort();
    let declarations = probe["declarations"].as_array_mut().unwrap();
    let mut descriptor = declarations.pop().unwrap();
    let export_roots = root_chunks(&exports, "exportChunk", declarations);
    let acceptance_roots = root_chunks(&index.roots, "acceptanceChunk", declarations);
    for field in descriptor["body"]["fields"].as_array_mut().unwrap() {
        match field["field"].as_str().unwrap() {
            "exportRoots" => field["value"] = export_roots.clone(),
            "acceptanceRoots" => field["value"] = acceptance_roots.clone(),
            "name" => field["value"]["value"] = json!("Internal CBOR primitive profile"),
            "cargoName" => field["value"]["value"] = json!("prism-cbor-primitive-conformance"),
            _ => {}
        }
    }
    declarations.push(descriptor);
    let probe_source = probe_source.replace(
        "\\importmodule{Foundation.Library.V1.Model}\n",
        "\\importmodule{Foundation.Library.V1.Model}\n\\importmodule{Foundation.Codec.Cbor.V1.PrimitiveCorpus}\n",
    );
    std::fs::write(probe_path, rewrite(&probe_source, &probe)).unwrap();

    // Bind the audit to every authored declaration, not only exported roots.
    let mut declarations = BTreeSet::new();
    for name in [
        "Probe.lex.tex",
        "Foundation/Library/V1/Model.lex.tex",
        "Foundation/Bytes.lex.tex",
        "Foundation/Codec.lex.tex",
        "Foundation/Codec/Cbor/V1/Primitive.lex.tex",
        "Foundation/Codec/Cbor/V1/PrimitiveCorpus.lex.tex",
    ] {
        let source = std::fs::read_to_string(project.path().join("src").join(name)).unwrap();
        let module = source
            .lines()
            .find_map(|line| line.strip_prefix("\\begin{lexlean}{"))
            .unwrap()
            .strip_suffix('}')
            .unwrap();
        for row in semantic(&source)["declarations"].as_array().unwrap() {
            assert!(declarations.insert(format!(
                "LibraryProbe.{module}.{}",
                row["name"].as_str().unwrap()
            )));
        }
    }
    Fixture {
        project,
        roots: index.roots,
        exports,
        declarations,
    }
}

fn verified_names(project: &Path) -> BTreeSet<String> {
    let root = project.join(".prism/verified");
    if !root.exists() {
        return BTreeSet::new();
    }
    std::fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect()
}

fn accepted(fixture: &Fixture, verified: &prismpm::controller::VerifyResult) {
    let project = fixture.project.path();
    let output = project.join(&verified.verified_root);
    let acceptance_bytes = std::fs::read(output.join("library-acceptance.json")).unwrap();
    let acceptance: Value = serde_json::from_slice(&acceptance_bytes).unwrap();
    let manifest_bytes = std::fs::read(output.join("manifest.json")).unwrap();
    let manifest: Value = serde_json::from_slice(&manifest_bytes).unwrap();
    assert_eq!(verified.attestation_id, content_id(&manifest_bytes));
    assert_eq!(manifest["acceptance_sha256"], content_id(&acceptance_bytes));
    assert_eq!(acceptance["scope"], "native-library-only");
    assert_eq!(acceptance["profile"], "prismpm/native-library/1");
    assert_eq!(acceptance["build_id"], verified.build_id);
    assert_eq!(acceptance["status"], "passed");
    assert_eq!(acceptance["regeneration"], "byte-identical");
    assert_eq!(acceptance["export_roots"], json!(fixture.exports));
    assert_eq!(
        acceptance["executions"],
        json!([
            {"mode":"std","roots":fixture.roots,"status":"passed"},
            {"mode":"no_std","roots":fixture.roots,"status":"passed"}
        ])
    );
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
    for mode in ["std", "no_std"] {
        let tool = format!("native-library-{mode}-acceptance");
        let processes = manifest["processes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["tool"] == tool)
            .collect::<Vec<_>>();
        assert_eq!(processes.len(), 1);
        assert_eq!(processes[0]["exit_code"], 0);
        let stdout: Value = serde_json::from_str(processes[0]["stdout"].as_str().unwrap()).unwrap();
        assert_eq!(stdout, json!({"roots":fixture.roots,"status":"passed"}));
    }
    let build = project.join(".prism/build").join(&verified.build_id);
    let model = super::json(&build.join("model.prism.json"));
    assert!(model.get("application").is_none());
    assert!(model.get("system").is_none());
    assert_eq!(model["library"]["acceptance_roots"], json!(fixture.roots));
    let snapshot = super::json(&build.join("lexlean/snapshot.json"));
    let mut expected = BTreeMap::new();
    for module in snapshot["modules"].as_array().unwrap() {
        for declaration in module["declarations"].as_array().unwrap() {
            let name = format!(
                "{}.{}",
                module["lean_module"].as_str().unwrap(),
                declaration["lean_name"].as_str().unwrap()
            );
            assert!(expected.insert(name, declaration).is_none());
        }
    }
    assert_eq!(
        expected.keys().cloned().collect::<BTreeSet<_>>(),
        fixture.declarations
    );
    let attestation_bytes = std::fs::read(output.join("lexlean-attestation.json")).unwrap();
    assert_eq!(
        manifest["lexlean_attestation_sha256"],
        content_id(&attestation_bytes)
    );
    let attestation: Value = serde_json::from_slice(&attestation_bytes).unwrap();
    assert_eq!(attestation["status"], "verified");
    let audits = attestation["declarations"].as_array().unwrap();
    assert_eq!(audits.len(), expected.len());
    let mut audited = BTreeSet::new();
    for audit in audits {
        let name = audit["name"].as_str().unwrap();
        assert!(audited.insert(name.to_owned()));
        assert_eq!(audit["result"], "ok");
        assert_eq!(audit["policy"], expected.get(name).unwrap()["axiom_policy"]);
        let axioms = &expected.get(name).unwrap()["axiom_policy"]["axioms"];
        assert!(
            axioms == &json!([])
                || axioms == &json!(["Quot.sound", "propext"])
                || axioms == &json!(["Classical.choice", "Quot.sound", "propext"])
                || (name == "LibraryProbe.Foundation.Bytes.compareBytes"
                    && axioms == &json!(["propext"]))
        );
        assert_eq!(audit["observed"], *axioms);
    }
    assert_eq!(audited, fixture.declarations);
    eprintln!("ST-16: {} modeled roots passed std/no_std; {} exact declaration audits; build {}; attestation {}", fixture.roots.len(), audited.len(), verified.build_id, verified.attestation_id);
}

fn weakened_body(name: &str, body: &Value) -> Value {
    if matches!(name, "cborOctetBytes" | "cborOctetBytesAbove") {
        let input = if name == "cborOctetBytes" {
            "234"
        } else {
            "256"
        };
        return json!({"kind":"match","scrutinee":{"kind":"beq",
        "left":{"kind":"var","name":"value"},
        "right":{"kind":"nat","value":input}},
        "branches":[
            {"constructor":{"name":"Bool.false"},"binders":[],"body":body},
            {"constructor":{"name":"Bool.true"},"binders":[],"body":{"kind":"bytes","hex":"00"}}
        ]});
    }
    fn true_after(condition: Value) -> Value {
        json!({"kind":"match","scrutinee":condition,"branches":[
            {"constructor":{"name":"Bool.false"},"binders":[],"body":{"kind":"bool","value":true}},
            {"constructor":{"name":"Bool.true"},"binders":[],"body":{"kind":"bool","value":true}}
        ]})
    }
    if name == "cborReadPayload" {
        let mut changed = body.clone();
        assert_eq!(changed["scrutinee"]["kind"], "ble");
        changed["scrutinee"] = true_after(changed["scrutinee"].clone());
        return changed;
    }
    fn walk(value: &mut Value, name: &str) -> usize {
        if name == "cborReadHeadArgument"
            && value["kind"] == "match"
            && value["scrutinee"]["kind"] == "ble"
            && value["scrutinee"]["left"] == json!({"kind":"nat","value":"24"})
        {
            value["scrutinee"] = true_after(value["scrutinee"].clone());
            return 1;
        }
        if name == "cborReadString"
            && value["kind"] == "constructor"
            && value["constructor"]["name"] == "Result.error"
            && value["arguments"][0]["constructor"]["name"] == "CborError.InvalidUtf8"
        {
            *value = json!({"kind":"constructor","constructor":{"name":"Result.ok"},
            "type_arguments":[{"kind":"named","member":{"name":"CborDecoded"},"arguments":[]},
                {"kind":"named","member":{"name":"CborError"},"arguments":[]}],
            "arguments":[{"kind":"record","type":{"name":"CborDecoded"},"fields":[
                {"field":"value","value":{"kind":"constructor","constructor":{"name":"CborValue.TextString"},"arguments":[{"kind":"string","value":""}]}},
                {"field":"cursor","value":{"kind":"project","field":"cursor","value":{"kind":"var","name":"payload"}}}
            ]}]});
            return 1;
        }
        match value {
            Value::Object(fields) => fields.values_mut().map(|value| walk(value, name)).sum(),
            Value::Array(values) => values.iter_mut().map(|value| walk(value, name)).sum(),
            _ => 0,
        }
    }
    assert!(matches!(name, "cborReadHeadArgument" | "cborReadString"));
    let mut changed = body.clone();
    assert_eq!(walk(&mut changed, name), 1, "exact codec guard mutant");
    changed
}

fn runtime_rejection(error: &prismpm::PrismError, root: &str) -> bool {
    let main_panic = error
        .message
        .split_once("\\nthread 'main' ")
        .is_some_and(|(_, suffix)| {
            let suffix = if let Some(pid) = suffix.strip_prefix('(') {
                let Some((pid, rest)) = pid.split_once(") ") else {
                    return false;
                };
                if pid.is_empty() || !pid.bytes().all(|byte| byte.is_ascii_digit()) {
                    return false;
                }
                rest
            } else {
                suffix
            };
            suffix.starts_with("panicked at src/main.rs:")
        });
    error.code == "PP5006"
        && error
            .message
            .starts_with("native-library-std-acceptance exited 101: stdout=\"\"; stderr=\"")
        && main_panic
        && error.message.contains(&format!("\\n{root}\\n"))
        && !error.message.contains("could not compile")
        && !error.message.contains("error[E")
}

fn valid_wasm_receipt(receipt: &Value, modules: &Value) -> bool {
    receipt.as_object().is_some_and(|fields| fields.len() == 9)
        && receipt["schema"] == "prismpm/cbor-primitive-wasm/1"
        && receipt["typed_roots"] == ROOT_COUNT
        && receipt["byte_vectors"] == 71
        && receipt["invocations"] == ROOT_COUNT + 71 + 5 + 4
        && receipt["maximum_payload"] == 4_202_612
        && receipt["maximum_pages"] == 1024
        && receipt["observed_pages"]
            .as_u64()
            .is_some_and(|pages| (65..=1024).contains(&pages))
        && receipt["modules"] == *modules
        && receipt["status"] == "passed"
}

fn wasm_acceptance(root: &Path, fixture: &Fixture, verified: &prismpm::controller::VerifyResult) {
    let ir_path = fixture
        .project
        .path()
        .join(".prism/build")
        .join(&verified.build_id)
        .join("library/kernel.ir");
    let ir = std::fs::read_to_string(&ir_path).unwrap();
    let (remaining, module) = prod_ir::parser::parse_module(&ir).unwrap();
    assert!(remaining.is_empty());
    let work = tempfile::Builder::new()
        .prefix("prismpm-cbor-wasm-")
        .tempdir()
        .unwrap();
    for (name, entry, input, output) in [
        (
            "primitive",
            "canonicalCborPrimitiveBytes",
            4_202_618,
            4_202_617,
        ),
        ("corpus", "cborCorpusProbeBytes", 5, 1),
    ] {
        let spec = prod_codegen::CoreWasmSpec {
            crate_name: format!("cbor-{name}-conformance"),
            entry: entry.to_owned(),
            export_name: "holo_run".to_owned(),
            input_allocation_cap: input,
            output_allocation_cap: output,
            maximum_pages: 1024,
            input_ir_sha256: content_id(ir.as_bytes()),
        };
        let package = prod_codegen::generate_core_wasm_package(&module, &spec)
            .expect("actual pinned generated CBOR Core-Wasm package");
        for file in package.files {
            let relative = std::path::Path::new(&file.path);
            assert!(relative
                .components()
                .all(|part| matches!(part, std::path::Component::Normal(_))));
            let path = work.path().join(name).join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, file.bytes).unwrap();
        }
    }
    std::fs::copy(
        root.join("rust-toolchain.toml"),
        work.path().join("rust-toolchain.toml"),
    )
    .unwrap();
    let output = std::process::Command::new("node")
        .env_remove("LD_LIBRARY_PATH")
        .arg(root.join("tests/codec-cbor/wasm.mjs"))
        .arg(work.path())
        .current_dir(root)
        .output()
        .expect("execute bounded complete CBOR Wasm oracle");
    assert!(
        output.status.success(),
        "CBOR Wasm oracle failed: {}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let modules: serde_json::Map<String, Value> = ["primitive", "corpus"]
        .into_iter()
        .map(|name| {
            let path = work.path().join(name).join(format!(
                "target/wasm32-unknown-unknown/release/cbor_{name}_conformance.wasm"
            ));
            (
                name.to_owned(),
                json!(content_id(&std::fs::read(path).unwrap())),
            )
        })
        .collect();
    assert!(
        valid_wasm_receipt(&receipt, &Value::Object(modules)),
        "{receipt}"
    );
    assert_eq!(std::fs::read_to_string(ir_path).unwrap(), ir);
    eprintln!("ST-16: {receipt}");
}

pub(super) fn verify(root: &Path) {
    super::verify_node_suite(
        root,
        "ST-16-source",
        &["tests/codec-cbor/source.test.mjs"],
        3,
        "10000",
    );
    let fixture = fixture(root);
    let controller = prismpm::Controller::load(fixture.project.path()).unwrap();
    controller
        .check(CheckRequest { config_path: None })
        .expect("actual CBOR primitive profile model checks");
    let verified = match controller.verify(VerifyRequest { config_path: None }) {
        Ok(verified) => verified,
        Err(error) => {
            let retained = fixture.project.keep();
            panic!(
                "complete CBOR primitive profile corpus failed; retained {}: {error:?}",
                retained.display()
            );
        }
    };
    accepted(&fixture, &verified);
    wasm_acceptance(root, &fixture, &verified);
    let path = fixture
        .project
        .path()
        .join("src/Foundation/Codec/Cbor/V1/Primitive.lex.tex");
    let source = std::fs::read_to_string(&path).unwrap();
    let before = verified_names(fixture.project.path());
    for (name, rejected) in [
        ("cborReadHeadArgument", "probeArrayRejected9800"),
        ("cborReadPayload", "probeLimitBytes"),
        ("cborReadString", "probeUtf8Invalid80"),
        ("cborOctetBytes", "probeOctetLookup"),
        ("cborOctetBytesAbove", "probeOctetLookup"),
    ] {
        let rejected = format!("LibraryProbe.Foundation.Codec.Cbor.V1.PrimitiveCorpus.{rejected}");
        assert!(fixture.roots.contains(&rejected));
        let mut mutant = semantic(&source);
        let declaration = mutant["declarations"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|row| row["name"] == name.strip_suffix("Above").unwrap_or(name))
            .unwrap();
        declaration["body"] = weakened_body(name, &declaration["body"]);
        std::fs::write(&path, rewrite(&source, &mutant)).unwrap();
        let error = controller
            .verify(VerifyRequest { config_path: None })
            .expect_err("actual CBOR primitive profile defect must fail generated execution");
        assert!(
            runtime_rejection(&error, &rejected),
            "{name}: exact modeled runtime root must reject, not compilation: {error:?}"
        );
        assert_eq!(verified_names(fixture.project.path()), before);
        eprintln!("ST-16: {name} rejected at {rejected} (generated runtime exit 101)");
        std::fs::write(&path, &source).unwrap();
        let restored = controller
            .verify(VerifyRequest { config_path: None })
            .expect("restored protocol passes the identical gate");
        accepted(&fixture, &restored);
        assert_eq!(restored.build_id, verified.build_id);
        assert_eq!(restored.attestation_id, verified.attestation_id);
        assert_eq!(verified_names(fixture.project.path()), before);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cbor_primitive_wasm_receipt_rejects_incomplete_execution() {
        let modules = json!({"primitive":"a".repeat(64),"corpus":"b".repeat(64)});
        let receipt = json!({"schema":"prismpm/cbor-primitive-wasm/1", "typed_roots":194,
            "byte_vectors":71, "invocations":274, "maximum_payload":4_202_612,
            "maximum_pages":1024, "observed_pages":964, "modules":modules, "status":"passed"});
        assert!(valid_wasm_receipt(&receipt, &modules));
        for (field, value) in [
            ("byte_vectors", json!(70)),
            ("invocations", json!(273)),
            ("typed_roots", json!(193)),
            ("maximum_payload", json!(4_202_611)),
            ("maximum_pages", json!(2048)),
            ("observed_pages", json!(0)),
            ("observed_pages", json!(64)),
            ("observed_pages", json!(1025)),
            ("observed_pages", json!(1.5)),
            ("status", json!("skipped")),
            ("modules", json!({})),
            ("schema", json!("prismpm/cbor-primitive-wasm/2")),
        ] {
            let mut changed = receipt.clone();
            changed[field] = value;
            assert!(
                !valid_wasm_receipt(&changed, &modules),
                "admitted changed {field}"
            );
        }
        for field in receipt.as_object().unwrap().keys() {
            let mut changed = receipt.clone();
            changed.as_object_mut().unwrap().remove(field);
            assert!(
                !valid_wasm_receipt(&changed, &modules),
                "admitted absent {field}"
            );
        }
        let mut changed = receipt.clone();
        changed["extra"] = json!(true);
        assert!(!valid_wasm_receipt(&changed, &modules));
        let mut changed = receipt;
        changed["modules"]["primitive"] = json!("c".repeat(64));
        assert!(!valid_wasm_receipt(&changed, &modules));
    }

    #[test]
    fn cbor_primitive_fixture_rejects_missing_modeled_implementation() {
        let absent = tempfile::tempdir().unwrap();
        let failure = std::panic::catch_unwind(|| fixture(absent.path()))
            .err()
            .expect("missing modeled implementation must not admit an empty oracle");
        let message = failure
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| failure.downcast_ref::<&str>().copied())
            .unwrap();
        assert_eq!(
            message,
            "ST-16 requires its actual model and finite oracle: Primitive.lex.tex"
        );
    }

    #[test]
    fn cbor_primitive_authored_fixture_checks_without_native_acceptance() {
        let fixture = fixture(&repo_model::repo_root());
        let controller = prismpm::Controller::load(fixture.project.path()).unwrap();
        let checked = controller
            .check(CheckRequest { config_path: None })
            .unwrap();
        assert_eq!(checked.entity_count, u64::try_from(ROOT_COUNT + 7).unwrap());
        assert!(!fixture.project.path().join(".prism").exists());
        assert!(verified_names(fixture.project.path()).is_empty());
    }

    #[test]
    fn cbor_primitive_mutants_preserve_parameters_and_change_real_guards() {
        fn references(value: &Value, name: &str) -> bool {
            if value["kind"] == "var" && value["name"] == name {
                return true;
            }
            match value {
                Value::Object(fields) => fields.values().any(|value| references(value, name)),
                Value::Array(values) => values.iter().any(|value| references(value, name)),
                _ => false,
            }
        }
        let model = semantic(
            &std::fs::read_to_string(
                repo_model::repo_root()
                    .join(DIRECTORY)
                    .join("Primitive.lex.tex"),
            )
            .unwrap(),
        );
        for name in ["cborReadHeadArgument", "cborReadPayload", "cborReadString"] {
            let declaration = model["declarations"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["name"] == name)
                .unwrap();
            let changed = weakened_body(name, &declaration["body"]);
            assert_ne!(changed, declaration["body"]);
            for parameter in declaration["parameters"].as_array().unwrap() {
                assert!(references(&changed, parameter["name"].as_str().unwrap()));
            }
        }
    }

    #[test]
    fn cbor_primitive_runtime_guard_rejects_nonbehavioral_failure() {
        let root = "LibraryProbe.Foundation.Codec.Cbor.V1.PrimitiveCorpus.probeUtf8Invalid80";
        let message = format!("native-library-std-acceptance exited 101: stdout=\"\"; stderr=\"\\nthread 'main' (123) panicked at src/main.rs:12:1:\\n{root}\\n\"");
        assert!(runtime_rejection(
            &prismpm::PrismError::new("PP5006", &message),
            root
        ));
        for changed in [
            message.replace("exited 101", "exited 0"),
            message.replace("std-acceptance", "std-lock"),
            message.replace("(123)", "(not-a-pid)"),
            message.replace(root, "anotherRoot"),
            format!("{message} error[E0308]: could not compile"),
        ] {
            assert!(!runtime_rejection(
                &prismpm::PrismError::new("PP5006", changed),
                root
            ));
        }
        assert!(!runtime_rejection(
            &prismpm::PrismError::new("PP5001", message),
            root
        ));
    }
}
