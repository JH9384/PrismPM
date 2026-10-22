//! Source-free integrity checks over retained build and execution evidence.
//!
//! This binds observed records to artifact bytes; it neither executes artifacts
//! nor authenticates their producer. OCI provenance supplies that separate trust
//! boundary. Imported LexLean documents retain their canonical final LF.

use crate::error::PrismError;
use crate::holo::canonical::{content_id, decode_canonical, encode_value};
use crate::holo::model_document::{Application, ModelDocument};
use lexlean::artifact::content_id as lex_ids;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Binding {
    pub build_id: String,
    pub build_digest: String,
    pub model_digest: String,
    pub attestation_id: String,
    pub family: String,
}

fn invalid(message: impl Into<String>) -> PrismError {
    PrismError::new("PP6101", message)
}

fn ensure(condition: bool, message: &str) -> Result<(), PrismError> {
    if condition {
        Ok(())
    } else {
        Err(invalid(message))
    }
}

fn hex(bytes: &[u8]) -> String {
    content_id(bytes)
}

fn digest(value: &Value) -> Result<&str, PrismError> {
    let text = string(value)?;
    ensure(
        text.len() == 64
            && text
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "evidence digest is not lowercase SHA-256",
    )?;
    Ok(text)
}

fn string(value: &Value) -> Result<&str, PrismError> {
    value
        .as_str()
        .ok_or_else(|| invalid("evidence string is absent"))
}

fn array(value: &Value) -> Result<&[Value], PrismError> {
    value
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| invalid("evidence array is absent"))
}

fn keys(value: &Value, fields: &[&str]) -> Result<(), PrismError> {
    let expected: BTreeSet<_> = fields.iter().copied().collect();
    ensure(
        value.as_object().is_some_and(|object| {
            object.keys().map(String::as_str).collect::<BTreeSet<_>>() == expected
        }),
        "evidence object fields are not closed",
    )
}

fn safe_path(path: &str) -> Result<(), PrismError> {
    ensure(
        !path.is_empty()
            && !path.contains('\\')
            && !path.chars().any(char::is_control)
            && path
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != ".." && !part.contains(':')),
        "evidence path is not confined and canonical",
    )
}

fn canonical_json(bytes: &[u8], lexlean_lf: bool) -> Result<Value, PrismError> {
    ensure(
        bytes.len() <= 64 * 1024 * 1024,
        "evidence JSON exceeds size bound",
    )?;
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|error| invalid(format!("evidence JSON: {error}")))?;
    let mut encoded = encode_value(&value).map_err(|error| invalid(error.message))?;
    if lexlean_lf {
        encoded.push(b'\n');
    }
    ensure(encoded == bytes, "evidence JSON framing is not canonical")?;
    Ok(value)
}

// lean4-prod's namedRootsJson/namedCoverageJson use an indented object with
// compact array values and one LF, not Prism's compact no-LF framing.
fn named_export_json(bytes: &[u8]) -> Result<Value, PrismError> {
    ensure(
        bytes.len() <= 64 * 1024 * 1024,
        "native export JSON exceeds size bound",
    )?;
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|error| invalid(format!("native export JSON: {error}")))?;
    let object = value
        .as_object()
        .ok_or_else(|| invalid("native export JSON is not an object"))?;
    let mut rows = Vec::new();
    for (name, array) in object {
        let name = serde_json::to_string(name).map_err(|error| invalid(error.to_string()))?;
        let array = String::from_utf8(encode_value(array).map_err(|error| invalid(error.message))?)
            .map_err(|error| invalid(error.to_string()))?;
        rows.push(format!("  {name}: {array}"));
    }
    ensure(
        format!("{{\n{}\n}}\n", rows.join(",\n")).as_bytes() == bytes,
        "native export JSON framing differs",
    )?;
    Ok(value)
}

fn descriptor(value: &Value, bytes: &[u8]) -> Result<(), PrismError> {
    keys(value, &["byte_length", "sha256"])?;
    ensure(
        value["byte_length"].as_u64() == u64::try_from(bytes.len()).ok()
            && digest(&value["sha256"])? == hex(bytes),
        "evidence descriptor size or hash differs",
    )
}

fn file<'a>(files: &'a BTreeMap<String, Vec<u8>>, name: &str) -> Result<&'a [u8], PrismError> {
    files
        .get(name)
        .map(Vec::as_slice)
        .ok_or_else(|| invalid(format!("verification closure lacks {name}")))
}

fn exact_files(
    files: &BTreeMap<String, Vec<u8>>,
    expected: &BTreeSet<String>,
) -> Result<(), PrismError> {
    ensure(
        files.keys().cloned().collect::<BTreeSet<_>>() == *expected,
        "verification file closure is not exact",
    )?;
    let mut total = 0_u64;
    for (name, bytes) in files {
        safe_path(name)?;
        ensure(
            !name
                .split('/')
                .scan(String::new(), |prefix, part| {
                    if !prefix.is_empty() {
                        prefix.push('/');
                    }
                    prefix.push_str(part);
                    Some(prefix.clone())
                })
                .any(|prefix| prefix != *name && files.contains_key(&prefix)),
            "verification path aliases a parent file",
        )?;
        total = total
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| invalid("verification size overflow"))?;
    }
    ensure(
        files.len() <= 65_536 && total <= 10 * 1024 * 1024 * 1024,
        "verification closure exceeds size bound",
    )
}

fn file_rows(
    value: &Value,
    files: &BTreeMap<String, Vec<u8>>,
    prefix: &str,
) -> Result<BTreeSet<String>, PrismError> {
    let mut expected = BTreeSet::new();
    for row in array(value)? {
        keys(row, &["byte_length", "kind", "path", "sha256"])?;
        let path = string(&row["path"])?;
        safe_path(path)?;
        ensure(
            !string(&row["kind"])?.is_empty(),
            "evidence file kind is empty",
        )?;
        let name = format!("{prefix}{path}");
        ensure(
            expected.insert(name.clone()),
            "verification file declaration is duplicated",
        )?;
        descriptor(
            &json!({"byte_length":row["byte_length"],"sha256":row["sha256"]}),
            file(files, &name)?,
        )
        .map_err(|error| invalid(format!("{name}: {}", error.message)))?;
    }
    Ok(expected)
}

/// Verify the exact original build outputs and their retained verification
/// closure without a source checkout, filesystem access, subprocess, or network.
pub(crate) fn validate(
    build_manifest_bytes: &[u8],
    build_files: &BTreeMap<String, Vec<u8>>,
    verification_files: &BTreeMap<String, Vec<u8>>,
) -> Result<Binding, PrismError> {
    let build = canonical_json(build_manifest_bytes, false)?;
    keys(&build, &["files", "inputs", "schema"])?;
    ensure(
        build["schema"] == "prismpm/build-manifest/1",
        "unknown build evidence schema",
    )?;
    let declared = file_rows(&build["files"], build_files, "")?;
    exact_files(build_files, &declared)?;
    let order = array(&build["files"])?;
    ensure(
        order
            .windows(2)
            .all(|pair| pair[0]["path"].as_str() < pair[1]["path"].as_str()),
        "build file order is not canonical",
    )?;
    let model_bytes = file(build_files, "model.prism.json")?;
    let model = decode_canonical(model_bytes)
        .map_err(|error| invalid(format!("release model: {}", error.message)))?;
    ensure(
        model.library.is_none(),
        "native-library evidence cannot authorize a product release",
    )?;
    let inputs = &build["inputs"];
    let mut input_fields = vec![
        "application_generator_sha256",
        "dependency_register_sha256",
        "emitter_semantics_id",
        "lexlean_build_id",
        "lexlean_semantic_id",
        "lexlean_source_id",
        "model_id",
        "schema",
        "system_id",
    ];
    if model.application.is_some() {
        if inputs["schema"] == "prismpm/build-inputs/1" {
            keys(inputs, &input_fields)?;
            return Err(invalid(
                "legacy application build inputs lack artifact closure; rebuild and verify with prismpm/build-inputs/2",
            ));
        }
        input_fields.push("application_artifacts_sha256");
    }
    keys(inputs, &input_fields)?;
    ensure(
        inputs["schema"]
            == if model.application.is_some() {
                "prismpm/build-inputs/2"
            } else {
                "prismpm/build-inputs/1"
            },
        "unknown build inputs schema",
    )?;
    for key in [
        "application_generator_sha256",
        "dependency_register_sha256",
        "emitter_semantics_id",
        "lexlean_build_id",
        "lexlean_semantic_id",
        "lexlean_source_id",
        "model_id",
    ] {
        digest(&inputs[key])?;
    }
    if model.application.is_some() {
        ensure(
            digest(&inputs["application_artifacts_sha256"])?
                == hex(&encode_value(&build["files"]).map_err(|error| invalid(error.message))?),
            "application artifact closure differs from build inputs",
        )?;
    }
    let build_id = hex(&encode_value(inputs).map_err(|error| invalid(error.message))?);
    ensure(
        inputs["model_id"] == hex(model_bytes),
        "model identity differs from build inputs",
    )?;
    ensure(
        inputs["system_id"]
            == build_files
                .get("system.prism.json")
                .map_or(Value::Null, |bytes| json!(format!("sha256:{}", hex(bytes)))),
        "system identity differs from build inputs",
    )?;
    let manifest_bytes = file(verification_files, "manifest.json")?;
    let manifest = canonical_json(manifest_bytes, false)?;
    let family = if model.application.is_some() {
        "application"
    } else {
        "native"
    };
    let names: &[&str] = if family == "application" {
        &[
            "manifest.json",
            "application-acceptance.json",
            "lexlean-attestation.json",
        ]
    } else {
        &[
            "manifest.json",
            "coverage.json",
            "execution-corpus.toml",
            "execution.json",
            "generated.rs",
            "kernel.ir",
            "lexlean-attestation.json",
            "stdlib-exports.toml",
            "roots.json",
            "validator",
        ]
    };
    exact_files(
        verification_files,
        &names.iter().map(|name| (*name).to_owned()).collect(),
    )?;
    ensure(
        manifest["build_id"] == build_id,
        "verification build identity differs",
    )?;
    let processes = process_records(&manifest["processes"], false)?;
    if model.application.is_none() {
        // Reject malformed native transcripts before reconstructing the full
        // source graph. These untrusted declarations authorize no success:
        // lexlean_binding and native_binding still verify every proof and
        // artifact binding below, including this module and execution closure.
        let lex_manifest = canonical_json(file(build_files, "lexlean/build/manifest.json")?, true)?;
        let modules = lexlean_modules(&lex_manifest)?;
        let execution = canonical_json(file(verification_files, "execution.json")?, false)?;
        native_processes(&manifest, &modules, &execution, processes)?;
    }
    let lex = canonical_json(file(verification_files, "lexlean-attestation.json")?, true)?;
    let snapshot = canonical_json(file(build_files, "lexlean/snapshot.json")?, true)?;
    lexlean_binding(&build, build_files, &model, &lex, &snapshot)?;
    if let Some(application) = &model.application {
        application_binding(
            &manifest,
            &lex,
            &model,
            application,
            &build_id,
            build_files,
            verification_files,
            processes,
        )?;
    } else {
        native_binding(&manifest, &lex, &snapshot, build_files, verification_files)?;
    }
    Ok(Binding {
        build_id,
        build_digest: format!("sha256:{}", hex(build_manifest_bytes)),
        model_digest: format!("sha256:{}", hex(model_bytes)),
        attestation_id: hex(manifest_bytes),
        family: family.to_owned(),
    })
}

fn lexlean_binding(
    build: &Value,
    files: &BTreeMap<String, Vec<u8>>,
    model: &ModelDocument,
    lex: &Value,
    snapshot: &Value,
) -> Result<(), PrismError> {
    let lex_manifest_bytes = file(files, "lexlean/build/manifest.json")?;
    let manifest = canonical_json(lex_manifest_bytes, true)?;
    keys(
        &manifest,
        &[
            "build_id",
            "compiler",
            "inputs",
            "language",
            "lean_toolchain",
            "modules",
            "outputs",
            "project",
            "selection",
            "semantic_id",
            "source_id",
            "spec",
        ],
    )?;
    let mut fields = vec![
        "attestation_id",
        "build_id",
        "build_manifest",
        "declarations",
        "host",
        "lake_workspace",
        "lexlean",
        "oleans",
        "processes",
        "semantic_id",
        "source_id",
        "spec",
        "status",
        "toolchain",
    ];
    if lex.get("pdf").is_some() {
        fields.push("pdf");
    }
    keys(lex, &fields)?;
    ensure(
        lex["spec"] == "lexlean/attestation/1"
            && lex["status"] == "verified"
            && manifest["spec"] == "lexlean/build-manifest/1"
            && snapshot["spec"] == "lexlean/semantic-snapshot/1",
        "LexLean evidence schema or status differs",
    )?;
    let typed: lexlean::artifact::snapshot::SemanticSnapshot =
        serde_json::from_value(snapshot.clone())
            .map_err(|error| invalid(format!("LexLean snapshot: {error}")))?;
    descriptor(&lex["build_manifest"], lex_manifest_bytes)?;
    let p = &model.provenance;
    for key in ["source_id", "semantic_id"] {
        let expected = digest(&build["inputs"][format!("lexlean_{key}")])?;
        ensure(
            digest(&lex[key])? == expected
                && manifest[key] == expected
                && snapshot[key] == expected,
            "LexLean source or semantic identity differs",
        )?;
    }
    ensure(
        snapshot["compiler_semantics_id"] == p.compiler_semantics_id
            && manifest["compiler"]["semantics_id"] == p.compiler_semantics_id
            && lex["lexlean"]["compiler_semantics"] == p.compiler_semantics_id
            && build["inputs"]["emitter_semantics_id"] == p.emitter_semantics_id,
        "LexLean compiler or snapshot identity differs",
    )?;
    let source =
        lex_ids::Sha256Digest::from_hex(digest(&snapshot["source_id"])?).map_err(invalid)?;
    let semantic =
        lex_ids::Sha256Digest::from_hex(digest(&snapshot["semantic_id"])?).map_err(invalid)?;
    let lex_build_id = lex_ids::build_id(source, semantic).to_hex();
    ensure(
        lex["build_id"] == lex_build_id
            && manifest["build_id"] == lex_build_id
            && build["inputs"]["lexlean_build_id"] == lex_build_id,
        "LexLean build identity differs",
    )?;
    let mut body = lex.clone();
    body.as_object_mut()
        .ok_or_else(|| invalid("LexLean attestation is not an object"))?
        .remove("attestation_id");
    let body_bytes = encode_value(&body).map_err(|error| invalid(error.message))?;
    let body_text = std::str::from_utf8(&body_bytes).map_err(|error| invalid(error.to_string()))?;
    ensure(
        digest(&lex["attestation_id"])? == lex_ids::attestation_id(body_text).to_hex(),
        "LexLean attestation identity differs",
    )?;

    let mut output_files = file_rows(&manifest["outputs"], files, "lexlean/build/")?;
    output_files.insert("lexlean/build/manifest.json".to_owned());
    ensure(
        output_files
            == files
                .keys()
                .filter(|name| name.starts_with("lexlean/build/"))
                .cloned()
                .collect(),
        "LexLean output closure is not exact",
    )?;
    let modules = lexlean_modules(&manifest)?;
    let snapshot_modules = array(&snapshot["modules"])?;
    ensure(
        snapshot_modules
            .iter()
            .map(|row| string(&row["lean_module"]).map(str::to_owned))
            .collect::<Result<BTreeSet<_>, _>>()?
            == modules
            && snapshot_modules.len() == modules.len(),
        "LexLean snapshot module closure differs",
    )?;
    snapshot_semantics(snapshot)?;
    // The retained system is a projection of this same proved full source
    // graph. A digest copied into build inputs alone cannot establish that.
    let systems = crate::system::project_all(&typed)
        .map_err(|error| invalid(format!("system snapshot projection: {}", error.message)))?;
    let projected_system = if let Some(bytes) = files.get("system.prism.json") {
        let projected = systems
            .iter()
            .find(|system| system.bytes() == bytes)
            .ok_or_else(|| invalid("retained system is not an exact full snapshot projection"))?;
        ensure(
            projected.value()["application_profile"]["application_model_digest"]
                == format!("sha256:{}", hex(file(files, "model.prism.json")?)),
            "system application model binding differs",
        )?;
        Some(projected)
    } else {
        ensure(
            systems.is_empty(),
            "verification build omitted modeled system projection",
        )?;
        None
    };
    if model.application.is_none() {
        let projected = crate::holo::projector::project_snapshot(&typed)
            .map_err(|error| invalid(format!("native snapshot projection: {}", error.message)))?;
        ensure(
            &projected == model,
            "native model is not the exact full snapshot projection",
        )?;
        ensure(
            snapshot["source_id"] == p.source_id
                && snapshot["semantic_id"] == p.semantic_id
                && p.snapshot_id == hex(file(files, "lexlean/snapshot.json")?),
            "native model snapshot identity differs",
        )?;
    } else {
        selected_application_snapshot(model, snapshot, &manifest, files)?;
    }
    if let Some(projected) =
        projected_system.filter(|system| system.schema() == "prismpm/system-model/2")
    {
        crate::system::browser::validate_application(projected.value(), model)
            .and_then(|_| crate::system::browser::replay(projected, files))
            .map_err(|error| invalid(format!("browser system replay: {}", error.message)))?;
    }
    declaration_audits(lex, snapshot_modules)?;
    lexlean_processes(lex, &modules)?;
    Ok(())
}

fn lexlean_modules(manifest: &Value) -> Result<BTreeSet<String>, PrismError> {
    let mut modules = BTreeSet::new();
    for row in array(&manifest["outputs"])? {
        if row["kind"] == "lean" {
            let module = string(&row["path"])?
                .strip_prefix("modules/")
                .and_then(|path| path.strip_suffix(".lean"))
                .ok_or_else(|| invalid("LexLean module path is not canonical"))?
                .replace('/', ".");
            ensure(modules.insert(module), "duplicate LexLean module")?;
        }
    }
    ensure(!modules.is_empty(), "LexLean evidence has no modules")?;
    Ok(modules)
}

fn snapshot_semantics(snapshot: &Value) -> Result<(), PrismError> {
    let modules = array(&snapshot["modules"])?;
    ensure(
        modules
            .windows(2)
            .all(|pair| pair[0]["name"].as_str() < pair[1]["name"].as_str()),
        "LexLean snapshot module order differs",
    )?;
    let linked = json!({"modules":modules.iter().map(|module| module["linked_ir"].clone()).collect::<Vec<_>>(),"spec":"lexlean/linked-ir/1"});
    let compiler = lex_ids::Sha256Digest::from_hex(digest(&snapshot["compiler_semantics_id"])?)
        .map_err(invalid)?;
    let linked = String::from_utf8(encode_value(&linked).map_err(|error| invalid(error.message))?)
        .map_err(|error| invalid(error.to_string()))?;
    let closure = String::from_utf8(
        encode_value(&snapshot["lexicon_closure"]).map_err(|error| invalid(error.message))?,
    )
    .map_err(|error| invalid(error.to_string()))?;
    ensure(
        lex_ids::semantic_id_for(compiler, string(&snapshot["language"])?, &linked, &closure)
            .to_hex()
            == digest(&snapshot["semantic_id"])?,
        "LexLean snapshot semantic recipe differs",
    )?;
    Ok(())
}

fn selected_application_snapshot(
    model: &ModelDocument,
    full_snapshot: &Value,
    full_manifest: &Value,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), PrismError> {
    let bytes = file(files, "application/lexlean-snapshot.json")?;
    let snapshot = canonical_json(bytes, true)?;
    let typed: lexlean::SemanticSnapshot = serde_json::from_value(snapshot.clone())
        .map_err(|error| invalid(format!("application snapshot: {error}")))?;
    snapshot_semantics(&snapshot)?;
    let p = &model.provenance;
    ensure(
        p.snapshot_id == hex(bytes)
            && snapshot["source_id"] == p.source_id
            && snapshot["semantic_id"] == p.semantic_id
            && snapshot["compiler_semantics_id"] == p.compiler_semantics_id,
        "application selected snapshot identity differs",
    )?;
    let projected = crate::holo::application::project_application(&typed).map_err(|error| {
        invalid(format!(
            "application snapshot projection: {}",
            error.message
        ))
    })?;
    ensure(
        projected.as_ref() == Some(model),
        "application model is not the exact selected snapshot projection",
    )?;
    let manifest = canonical_json(
        file(files, "application/lexlean-build-manifest.json")?,
        true,
    )?;
    keys(
        &manifest,
        &[
            "build_id",
            "compiler",
            "inputs",
            "language",
            "lean_toolchain",
            "modules",
            "outputs",
            "project",
            "selection",
            "semantic_id",
            "source_id",
            "spec",
        ],
    )?;
    ensure(
        manifest["spec"] == "lexlean/build-manifest/1"
            && manifest["source_id"] == p.source_id
            && manifest["semantic_id"] == p.semantic_id
            && manifest["compiler"] == full_manifest["compiler"]
            && manifest["language"] == snapshot["language"]
            && manifest["language"] == full_manifest["language"]
            && manifest["lean_toolchain"] == full_manifest["lean_toolchain"]
            && manifest["project"] == full_manifest["project"],
        "application selected build identity differs",
    )?;
    let source = lex_ids::Sha256Digest::from_hex(&p.source_id).map_err(invalid)?;
    let semantic = lex_ids::Sha256Digest::from_hex(&p.semantic_id).map_err(invalid)?;
    ensure(
        manifest["build_id"] == lex_ids::build_id(source, semantic).to_hex(),
        "application selected build recipe differs",
    )?;
    let modules = array(&snapshot["modules"])?;
    let full_modules = array(&full_snapshot["modules"])?;
    ensure(
        !modules.is_empty() && modules.iter().all(|module| full_modules.contains(module)),
        "application selected modules differ from attested full snapshot",
    )?;
    let module_rows = modules.iter().map(|module| json!({"lean_module":module["lean_module"],"module":module["name"],"source_path":module["source"]["path"]})).collect::<Vec<_>>();
    ensure(
        manifest["modules"] == json!(module_rows)
            && manifest["selection"]
                == json!(modules
                    .iter()
                    .map(|module| module["name"].clone())
                    .collect::<Vec<_>>()),
        "application selected manifest module closure differs",
    )?;
    let full_inputs = array(&full_manifest["inputs"])?;
    let source_paths = modules
        .iter()
        .map(|module| string(&module["source"]["path"]))
        .collect::<Result<BTreeSet<_>, _>>()?;
    let expected_inputs = full_inputs
        .iter()
        .filter(|row| {
            row["kind"] != "source"
                || row["path"]
                    .as_str()
                    .is_some_and(|path| source_paths.contains(path))
        })
        .cloned()
        .collect::<Vec<_>>();
    ensure(
        manifest["inputs"] == json!(expected_inputs),
        "application selected source inputs differ from attested full build",
    )?;
    // Source maps carry selection-specific identities, so retain and validate
    // the actual selected closure separately. Only Lean code must be byte-
    // identical to the modules covered by the full build's kernel replay.
    let selected_files = file_rows(&manifest["outputs"], files, "application/lexlean-build/")?;
    ensure(
        selected_files
            == files
                .keys()
                .filter(|name| name.starts_with("application/lexlean-build/"))
                .cloned()
                .collect(),
        "application selected output file closure differs",
    )?;
    let mut expected_rows = Vec::new();
    for module in modules {
        let lean = string(&module["lean_module"])?.replace('.', "/");
        let name = string(&module["name"])?;
        expected_rows.extend([
            ("lean".to_owned(), format!("modules/{lean}.lean")),
            ("tex".to_owned(), format!("modules/{lean}.tex")),
            ("map".to_owned(), format!("maps/{lean}.map.json")),
            (
                "coverage".to_owned(),
                format!("coverage/{lean}.coverage.json"),
            ),
            (
                "lexicon-closure".to_owned(),
                format!("lexicons/{name}.closure.json"),
            ),
        ]);
        ensure(
            file(
                files,
                &format!("application/lexlean-build/modules/{lean}.lean"),
            )? == file(files, &format!("lexlean/build/modules/{lean}.lean"))?,
            "application selected Lean code differs from attested full build",
        )?;
        let map = canonical_json(
            file(
                files,
                &format!("application/lexlean-build/maps/{lean}.map.json"),
            )?,
            true,
        )?;
        ensure(
            map["spec"] == "lexlean/source-map/1"
                && map["source_id"] == p.source_id
                && map["semantic_id"] == p.semantic_id
                && map["module"] == name,
            "application selected source map identity differs",
        )?;
    }
    expected_rows.sort();
    let observed_rows = array(&manifest["outputs"])?
        .iter()
        .map(|row| {
            Ok((
                string(&row["kind"])?.to_owned(),
                string(&row["path"])?.to_owned(),
            ))
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    ensure(
        observed_rows == expected_rows,
        "application selected module output closure differs",
    )
}

fn declaration_audits(lex: &Value, modules: &[Value]) -> Result<(), PrismError> {
    let mut expected = BTreeMap::new();
    for module in modules {
        for declaration in array(&module["declarations"])? {
            let name = format!(
                "{}.{}",
                string(&module["lean_module"])?,
                string(&declaration["lean_name"])?
            );
            ensure(
                expected
                    .insert(name, &declaration["axiom_policy"])
                    .is_none(),
                "duplicate LexLean declaration",
            )?;
        }
    }
    let mut seen = BTreeSet::new();
    for row in array(&lex["declarations"])? {
        keys(row, &["name", "observed", "policy", "result"])?;
        let name = string(&row["name"])?;
        ensure(
            seen.insert(name.to_owned())
                && expected
                    .get(name)
                    .is_some_and(|policy| **policy == row["policy"])
                && row["result"] == "ok",
            "LexLean declaration audit closure or policy differs",
        )?;
        keys(&row["policy"], &["axioms", "kind"])?;
        let observed = strings(&row["observed"])?;
        let allowed = strings(&row["policy"]["axioms"])?;
        let permitted = match string(&row["policy"]["kind"])? {
            "none" => observed.is_empty() && allowed.is_empty(),
            "exact" => observed == allowed,
            "allow" => observed.iter().all(|item| allowed.contains(item)),
            _ => false,
        };
        ensure(permitted, "LexLean declaration has unapproved axioms")?;
    }
    ensure(
        seen == expected.keys().cloned().collect(),
        "LexLean declaration audit is incomplete",
    )
}

fn strings(value: &Value) -> Result<Vec<&str>, PrismError> {
    array(value)?.iter().map(string).collect()
}

pub(crate) fn process_records(value: &Value, lexlean: bool) -> Result<&[Value], PrismError> {
    let rows = array(value)?;
    ensure(!rows.is_empty(), "verification process evidence is empty")?;
    for row in rows {
        let mut fields = vec![
            "argv",
            "executable_sha256",
            "exit_code",
            "stderr",
            "stdout",
            "tool",
        ];
        if lexlean {
            fields.extend(["stderr_sha256", "stdout_sha256"]);
            if row.get("module").is_some() {
                fields.push("module");
            }
        } else if row["argv"].as_array().is_some_and(|args| {
            args.first().and_then(Value::as_str) == Some("exe")
                && args.get(1).and_then(Value::as_str) == Some("prod-export")
        }) {
            fields.push("exporter");
            validate_exporter_execution(&row["exporter"])?;
        }
        keys(row, &fields).map_err(|error| invalid(format!("process: {}", error.message)))?;
        ensure(
            row["exit_code"].as_i64() == Some(0),
            "verification process did not succeed",
        )?;
        digest(&row["executable_sha256"])?;
        ensure(
            !string(&row["tool"])?.is_empty(),
            "verification process tool is absent",
        )?;
        strings(&row["argv"])?;
        for stream in ["stdout", "stderr"] {
            let bytes = string(&row[stream])?.as_bytes();
            ensure(
                bytes.len() <= 16_777_216 && !bytes.contains(&b'\r'),
                "verification process output is unbounded or unnormalized",
            )?;
            if lexlean {
                ensure(
                    digest(&row[format!("{stream}_sha256")])? == hex(bytes),
                    "LexLean process output digest differs",
                )?;
            }
        }
    }
    Ok(rows)
}

fn validate_exporter_execution(value: &Value) -> Result<(), PrismError> {
    keys(
        value,
        &[
            "schema",
            "source_archive_sha256",
            "executable",
            "acquisition",
        ],
    )?;
    ensure(
        value["schema"] == "prismpm/exporter-execution/1",
        "exporter evidence schema differs",
    )?;
    validate_exporter_measurement(value)?;
    crate::exporter::validate_acquisition(
        &value["acquisition"],
        string(&value["executable"]["sha256"])?,
    )
    .map_err(|error| invalid(error.message))
}

fn validate_exporter_measurement(value: &Value) -> Result<(), PrismError> {
    ensure(
        digest(&value["source_archive_sha256"])?
            == hex(include_bytes!("../vendor/lean4-prod/lean.tar")),
        "exporter source archive differs from the compiled authority",
    )?;
    let executable = &value["executable"];
    keys(executable, &["byte_length", "mode", "sha256"])?;
    digest(&executable["sha256"])?;
    ensure(
        executable["byte_length"]
            .as_u64()
            .is_some_and(|size| size > 0 && size <= 256 * 1024 * 1024)
            && executable["mode"]
                .as_u64()
                .is_some_and(|mode| mode <= 0o777 && mode & 0o111 != 0),
        "bounded actual exporter executable measurement required",
    )
}

/// OCI admission binds the original artifacts before authenticating every
/// original exporter execution against the independently retained SDK lock.
/// The authority-only helper is private: production callers cannot bypass the
/// source-free semantic and artifact checks.
pub(crate) fn validate_with_authority(
    build_manifest_bytes: &[u8],
    build_files: &BTreeMap<String, Vec<u8>>,
    verification_files: &BTreeMap<String, Vec<u8>>,
    sdk_lock: impl FnOnce() -> Result<Value, PrismError>,
) -> Result<Binding, PrismError> {
    let binding = validate(build_manifest_bytes, build_files, verification_files)?;
    validate_exporter_authority(verification_files, &sdk_lock()?)?;
    Ok(binding)
}

fn validate_exporter_authority(
    verification_files: &BTreeMap<String, Vec<u8>>,
    sdk_lock: &Value,
) -> Result<(), PrismError> {
    let manifest = canonical_json(file(verification_files, "manifest.json")?, false)?;
    let processes = process_records(&manifest["processes"], false)?;
    let platform = process_platform(processes)?;
    let mut executions: Vec<Value> = processes
        .iter()
        .filter_map(|row| row.get("exporter").cloned())
        .collect();
    if manifest["schema"] == "prismpm/application-verification-manifest/2" {
        crate::exporter::validate_owner_record(
            &manifest["exporter_owner"],
            string(&manifest["model_sha256"])?,
            "application",
        )
        .map_err(|error| invalid(error.message))?;
        for phase in array(&manifest["exporter_owner"]["phases"])? {
            for row in process_records(&phase["processes"], false)? {
                if let Some(execution) = row.get("exporter") {
                    executions.push(execution.clone());
                }
            }
        }
    }
    for execution in executions {
        validate_exporter_execution(&execution)?;
        ensure(
            execution["acquisition"]["mode"] == "cold"
                || execution["acquisition"]["platform"] == platform,
            "exporter acquisition platform differs from retained native execution",
        )?;
        crate::exporter::validate_acquisition_authority(
            &execution["acquisition"],
            string(&execution["executable"]["sha256"])?,
            sdk_lock,
        )
        .map_err(|error| invalid(error.message))?;
    }
    Ok(())
}

fn lexlean_processes(lex: &Value, modules: &BTreeSet<String>) -> Result<(), PrismError> {
    keys(&lex["toolchain"], &["lake", "lean", "leanchecker"])?;
    for name in ["lake", "lean", "leanchecker"] {
        keys(
            &lex["toolchain"][name],
            &["executable_sha256", "version_output"],
        )?;
        digest(&lex["toolchain"][name]["executable_sha256"])?;
        ensure(
            !string(&lex["toolchain"][name]["version_output"])?.is_empty(),
            "LexLean toolchain evidence is absent",
        )?;
    }
    let processes = process_records(&lex["processes"], true)?;
    let mut compiled = BTreeSet::new();
    let mut replayed = BTreeSet::new();
    let mut audited = BTreeSet::new();
    let semantic = string(&lex["semantic_id"])?;
    let prefix = &semantic[..32];
    let mut probe = false;
    for row in processes {
        let module = string(&row["module"])?;
        let argv = strings(&row["argv"])?;
        match string(&row["tool"])? {
            "leanchecker" => {
                ensure(
                    modules.contains(module)
                        && replayed.insert(module.to_owned())
                        && argv == ["env", "$TOOLCHAIN/bin/leanchecker", module],
                    "LexLean replay process identity differs",
                )?;
            }
            "lean" if modules.contains(module) => {
                let path = module.replace('.', "/");
                ensure(
                    compiled.insert(module.to_owned())
                        && row["argv"]
                            == json!([
                                "env",
                                "lean",
                                "-R",
                                "$STAGING/lean-src",
                                "-o",
                                format!("$STAGING/oleans/{path}.olean"),
                                format!("$STAGING/lean-src/{path}.lean")
                            ]),
                    "LexLean compilation process identity differs",
                )?;
            }
            "lean" if module == format!("LexLeanProbe.P{prefix}") => {
                ensure(
                    !probe
                        && row["argv"]
                            == json!(["env", "lean", format!("$STAGING/probe/{module}.lean")]),
                    "LexLean probe process identity differs",
                )?;
                probe = true;
            }
            "lean" => {
                let original = module
                    .strip_prefix(&format!("LexLeanAudit.A{prefix}."))
                    .ok_or_else(|| invalid("LexLean audit process identity differs"))?;
                ensure(
                    modules.contains(original)
                        && audited.insert(original.to_owned())
                        && row["argv"]
                            == json!(["env", "lean", format!("$STAGING/audit/{module}.lean")]),
                    "LexLean audit process closure differs",
                )?;
            }
            _ => return Err(invalid("unknown LexLean verification process")),
        }
        ensure(
            row["executable_sha256"]
                == lex["toolchain"][string(&row["tool"])?]["executable_sha256"],
            "LexLean process executable identity differs",
        )?;
    }
    ensure(
        probe && compiled == *modules && replayed == *modules && audited == *modules,
        "LexLean process closure is incomplete",
    )?;
    let mut oleans = BTreeSet::new();
    for row in array(&lex["oleans"])? {
        keys(row, &["byte_length", "module", "sha256"])?;
        digest(&row["sha256"])?;
        ensure(
            row["byte_length"].as_u64().is_some_and(|length| length > 0)
                && oleans.insert(string(&row["module"])?.to_owned()),
            "LexLean olean descriptor is invalid",
        )?;
    }
    ensure(oleans == *modules, "LexLean olean closure differs")?;
    if let Some(pdf) = lex.get("pdf") {
        for row in array(pdf)? {
            keys(
                row,
                &[
                    "byte_length",
                    "compile",
                    "module",
                    "pdf_sha256",
                    "recipe_id",
                    "version",
                ],
            )?;
            digest(&row["pdf_sha256"])?;
            digest(&row["recipe_id"])?;
            ensure(
                row["byte_length"].as_u64().is_some_and(|length| length > 0)
                    && modules.contains(string(&row["module"])?),
                "LexLean PDF descriptor differs",
            )?;
            for key in ["compile", "version"] {
                process_records(&json!([row[key]]), true)?;
            }
        }
    }
    Ok(())
}

const PREFLIGHT: [&str; 5] = [
    "lean-version",
    "lake-version",
    "rustfmt-version",
    "rustc-version",
    "timeout-version",
];

fn process_order(rows: &[Value], tools: &[&str]) -> Result<(), PrismError> {
    ensure(
        rows.len() == tools.len()
            && rows
                .iter()
                .zip(tools)
                .all(|(row, tool)| row["tool"] == *tool),
        "verification process closure or order differs",
    )?;
    process_platform(rows).map(|_| ())
}

// Retained execution determines the platform, not the reader's current host
// and not a receipt's self-selected SDK inventory row.
fn process_platform(rows: &[Value]) -> Result<&'static str, PrismError> {
    let preflight = rows
        .get(..PREFLIGHT.len())
        .ok_or_else(|| invalid("verification native preflight is incomplete"))?;
    ensure(
        preflight
            .iter()
            .zip(PREFLIGHT)
            .all(|(row, tool)| row["tool"] == tool),
        "verification native preflight order differs",
    )?;
    for row in preflight {
        let expected = if row["tool"] == "rustc-version" {
            json!(["--version", "--verbose"])
        } else {
            json!(["--version"])
        };
        ensure(
            row["argv"] == expected
                && !string(&row["stdout"])?.trim().is_empty()
                && row["stderr"] == "",
            "verification preflight process differs",
        )?;
    }
    let (host, platform) = [("x86_64-unknown-linux-gnu", "linux/amd64"), ("aarch64-unknown-linux-gnu", "linux/arm64")].into_iter().find(|(host, _)| rows[0]["stdout"] == format!("Lean (version 4.32.1, {host}, commit f054605aea4b840552cca2e725580bffd1e1b704, Release)\n")).ok_or_else(|| invalid("verification process Lean version differs"))?;
    ensure(
        rows[1]["stdout"] == "Lake version 5.0.0-src+f054605 (Lean version 4.32.1)\n"
            && rows[2]["stdout"] == "rustfmt 1.9.0-stable (8bab26f4f6 2026-07-14)\n",
        "verification process tool version differs",
    )?;
    let rustc = string(&rows[3]["stdout"])?;
    for line in [
        "commit-hash: 8bab26f4f68e0e26f0bb7960be334d5b520ea452".to_owned(),
        format!("host: {host}"),
        "release: 1.97.1".to_owned(),
    ] {
        ensure(
            rustc.lines().any(|observed| observed == line),
            "verification process rustc identity differs",
        )?;
    }
    let timeout = string(&rows[4]["stdout"])?;
    ensure(
        ["9.1", "9.4"]
            .iter()
            .any(|version| timeout.starts_with(&format!("timeout (GNU coreutils) {version}\n"))),
        "verification process timeout version differs",
    )?;
    Ok(platform)
}

#[allow(clippy::too_many_arguments)]
fn application_binding(
    manifest: &Value,
    lex: &Value,
    model: &ModelDocument,
    application: &Application,
    build_id: &str,
    build_files: &BTreeMap<String, Vec<u8>>,
    files: &BTreeMap<String, Vec<u8>>,
    processes: &[Value],
) -> Result<(), PrismError> {
    let owned = manifest["schema"] == "prismpm/application-verification-manifest/2";
    let mut fields = vec![
        "acceptance_sha256",
        "build_id",
        "lexlean_attestation_sha256",
        "model_sha256",
        "processes",
        "schema",
    ];
    if owned {
        fields.push("exporter_owner");
    }
    keys(manifest, &fields)?;
    ensure(
        owned || manifest["schema"] == "prismpm/application-verification-manifest/1",
        "application verification family differs",
    )?;
    for (key, bytes) in [
        (
            "acceptance_sha256",
            file(files, "application-acceptance.json")?,
        ),
        (
            "lexlean_attestation_sha256",
            file(files, "lexlean-attestation.json")?,
        ),
        ("model_sha256", file(build_files, "model.prism.json")?),
    ] {
        ensure(
            digest(&manifest[key])? == hex(bytes),
            "application verification evidence digest differs",
        )?;
    }
    let crate_name = format!(
        "cargo/{}-{}.crate",
        application.cargo_name(),
        application.cargo_version()
    );
    let stem = application.cargo_name().replace('-', "_");
    let guest_name = format!("core-wasm/{stem}_core_wasm.wasm");
    let guest = file(build_files, &guest_name)?;
    let identities = application_archive(application, model, build_files, guest)?;
    let acceptance = canonical_json(file(files, "application-acceptance.json")?, false)?;
    ensure(
        acceptance
            == json!({
                    "application":application.name(), "artifact_closure":"verified", "browser_projection":"verified",
                    "build_id":build_id, "cargo_package":{"name":application.cargo_name(),"sha256":hex(file(build_files, &crate_name)?),"version":application.cargo_version()},
                    "core_wasm":{"sha256":hex(guest),"status":"verified"}, "holo":identities,
                    "hologram_oracle":"verified", "lexlean_attestation_id":lex["attestation_id"],
                    "modeled_vectors":application.acceptance_vectors().len(), "regeneration":"byte-identical", "schema":"prismpm/application-acceptance/1",
            "source_id":lex["source_id"], "status":"verified"
                }),
        "application acceptance differs from actual model or artifacts",
    )?;
    let mut expected = PREFLIGHT.to_vec();
    expected.extend([
        "hologram-browser-node-version",
        "hologram-oracle-build",
        "hologram-oracle",
        "core-wasm-validate",
        "core-wasm-inspect",
        "application-package-test",
        "application-package-no-std",
        "application-consumer-lock",
        "application-generated-rust-corpus",
        "application-lean",
        "application-exporter",
        "application-export",
    ]);
    process_order(processes, &expected)?;
    let identity = canonical_json(
        file(build_files, "application/exporter-identity.json")?,
        false,
    )?;
    let execution = &processes
        .last()
        .ok_or_else(|| invalid("application regeneration export is absent"))?["exporter"];
    let application_manifest = canonical_json(
        file(build_files, "application/lexlean-build-manifest.json")?,
        true,
    )?;
    let modules = lexlean_modules(&application_manifest)?;
    let arguments = crate::application_build::application_export_arguments(
        &modules,
        application,
        std::path::Path::new("$APPLICATION_WORK/export"),
    );
    if owned {
        let projections = if let Some(bytes) = build_files.get("system.prism.json") {
            let system = crate::system::parse(bytes)?;
            let artifacts = build_files
                .iter()
                .map(|(path, bytes)| (path.clone(), bytes.clone()))
                .collect::<Vec<_>>();
            crate::system::projections(&system, &artifacts)?
                .into_iter()
                .map(|row| row.path)
                .collect::<BTreeSet<_>>()
        } else {
            BTreeSet::new()
        };
        let artifacts = build_files
            .iter()
            .filter(|(path, _)| {
                !(path.starts_with("lexlean/")
                    || path.starts_with("application/lexlean-build/")
                    || projections.contains(path.as_str())
                    || matches!(
                        path.as_str(),
                        "model.prism.json"
                            | "system.prism.json"
                            | "application/lexlean-snapshot.json"
                            | "application/lexlean-build-manifest.json"
                    ))
            })
            .map(|(path, bytes)| json!({"path":path,"byte_length":bytes.len(),"sha256":hex(bytes)}))
            .collect::<Vec<_>>();
        crate::exporter::validate_owner_binding(
            &manifest["exporter_owner"],
            string(&manifest["model_sha256"])?,
            "application",
            file(build_files, "application/lexlean-build-manifest.json")?,
            &json!(artifacts),
            processes,
            &arguments,
        )
        .map_err(|error| invalid(error.message))?;
    }
    ensure(
        processes.last().unwrap()["argv"] == json!(arguments),
        "application regeneration export process arguments differ",
    )?;
    ensure(
        identity["executable"] == execution["executable"]
            && identity["source_archive_sha256"] == execution["source_archive_sha256"],
        "application regeneration exporter identity differs",
    )?;
    for row in &processes[14..] {
        ensure(
            row["executable_sha256"] == processes[1]["executable_sha256"],
            "application regeneration Lake identity differs",
        )?;
    }
    ensure(
        processes[5]["stdout"] == "v22.23.2\n" && processes[5]["stderr"] == "",
        "application oracle Node identity differs",
    )?;
    for index in [7, 10, 11, 12, 13] {
        ensure(
            processes[index]["executable_sha256"] == processes[6]["executable_sha256"],
            "application process Cargo identity differs",
        )?;
    }
    ensure(
        processes[8]["executable_sha256"] == processes[9]["executable_sha256"],
        "application process Core-Wasm tool identity differs",
    )?;
    for (tool, args) in [
        ("hologram-browser-node-version", vec!["--version"]),
        (
            "hologram-oracle-build",
            vec![
                "build",
                "--manifest-path",
                "$ORACLE_WORK/harness/Cargo.toml",
                "--locked",
                "--offline",
            ],
        ),
        (
            "application-package-test",
            vec!["test", "--locked", "--offline"],
        ),
        (
            "application-package-no-std",
            vec!["check", "--locked", "--offline", "--no-default-features"],
        ),
        (
            "application-consumer-lock",
            vec!["generate-lockfile", "--offline"],
        ),
        (
            "application-generated-rust-corpus",
            vec!["run", "--locked", "--offline"],
        ),
        ("application-lean", vec!["build", "PrismGenerated"]),
        ("application-exporter", vec!["build", "prod-export"]),
    ] {
        let row = processes
            .iter()
            .find(|row| row["tool"] == tool)
            .ok_or_else(|| invalid("application process missing"))?;
        ensure(
            row["argv"] == json!(args),
            "application process arguments differ",
        )?;
    }
    let oracle = &processes[7];
    let args = strings(&oracle["argv"])?;
    ensure(
        args.len() == 12
            && args[..6]
                == [
                    "run",
                    "--manifest-path",
                    "$ORACLE_WORK/harness/Cargo.toml",
                    "--locked",
                    "--offline",
                    "--",
                ]
            && args[9] == "$ORACLE_WORK/harness/browser.mjs",
        "application oracle process arguments differ",
    )?;
    ensure(
        args[10]
            .strip_prefix('/')
            .is_some_and(|path| safe_path(path).is_ok())
            && args[10].ends_with("/node"),
        "application oracle Node path differs",
    )?;
    let browser = match lex["host"]["arch"].as_str() {
        Some("x86_64") => {
            "/ms-playwright/chromium_headless_shell-cft-157.0.8099.0/chrome-headless-shell-linux64/chrome-headless-shell"
        }
        Some("aarch64") => {
            "/ms-playwright/chromium_headless_shell-cft-157.0.8099.0/chrome-headless-shell-linux-arm64/chrome-headless-shell"
        }
        _ => return Err(invalid("application oracle host architecture differs")),
    };
    ensure(
        args[11] == browser,
        "application oracle browser path differs",
    )?;
    // These arguments name the actual immutable build, not another release.
    for (argument, relative) in [
        (args[6], format!("{}.holo", application.name())),
        (args[7], "model.prism.json".to_owned()),
        (args[8], guest_name.clone()),
    ] {
        ensure(
            argument.ends_with(&format!("/{build_id}/{relative}"))
                || argument == format!("$BUILD/{relative}"),
            "application oracle process build identity differs",
        )?;
    }
    let report: Value = serde_json::from_str(string(&oracle["stdout"])?.trim())
        .map_err(|error| invalid(format!("application oracle: {error}")))?;
    crate::verification::validate_hologram_oracle_report(&report, application, &identities)
        .map_err(|error| invalid(format!("application oracle: {}", error.message)))?;
    for (offset, command) in [(8, "validate"), (9, "print")] {
        let args = strings(&processes[offset]["argv"])?;
        ensure(
            args.len() == 2
                && args[0] == command
                && (args[1].ends_with(&format!("/{build_id}/{guest_name}"))
                    || args[1] == format!("$BUILD/{guest_name}")),
            "application Core-Wasm process identity differs",
        )?;
    }
    let printed = string(&processes[9]["stdout"])?;
    ensure(
        !printed.contains("(import ")
            && ["memory", "holo_alloc", "holo_run"]
                .iter()
                .all(|name| printed.contains(&format!("(export \"{name}\""))),
        "application Core-Wasm ABI evidence differs",
    )
}

fn application_archive(
    application: &Application,
    model: &ModelDocument,
    files: &BTreeMap<String, Vec<u8>>,
    guest: &[u8],
) -> Result<Value, PrismError> {
    crate::application_build::validate_application_core_resources(
        application,
        guest,
        file(files, "application/target-profile.json")?,
        file(files, "core-wasm/package/generation-manifest.json")?,
    )
    .map_err(|error| {
        invalid(format!(
            "application Core-Wasm resources: {}",
            error.message
        ))
    })?;
    let bytes = file(files, &format!("{}.holo", application.name()))?;
    let archive = crate::holo::archive::parse_application(bytes)
        .map_err(|error| invalid(format!("application archive: {}", error.message)))?;
    let model_bytes = file(files, "model.prism.json")?;
    ensure(
        archive.blobs.values().any(|content| content == model_bytes)
            && archive.blobs.values().any(|content| content == guest)
            && archive.application_manifest == file(files, "application/application-manifest.bin")?
            && archive.metadata == file(files, "application/source-manifest.json")?
            && archive.identities.guest_content_kappa == crate::holo::archive::content_kappa(guest)
            && archive.identities.model_content_kappa
                == crate::holo::archive::content_kappa(model_bytes),
        "application archive content differs from release artifacts",
    )?;
    let identities = serde_json::to_value(&archive.identities)
        .map_err(|error| invalid(format!("application identities: {error}")))?;
    ensure(
        identities == canonical_json(file(files, "application/holo-identities.json")?, false)?,
        "application Holo identities differ",
    )?;
    ensure(
        archive.directory == file(files, "application/directory.json")?
            && archive.prism_extension == file(files, "application/model-provenance.json")?,
        "application archive extension bytes differ",
    )?;
    let provenance = canonical_json(&archive.prism_extension, false)?;
    for (key, expected) in [
        ("source_id", &model.provenance.source_id),
        ("semantic_id", &model.provenance.semantic_id),
        ("snapshot_id", &model.provenance.snapshot_id),
        (
            "compiler_semantics_id",
            &model.provenance.compiler_semantics_id,
        ),
    ] {
        ensure(
            provenance[key] == *expected,
            "application archive provenance identity differs",
        )?;
    }
    for (key, path) in [
        (
            "lean_manifest_sha256",
            "application/lexlean-build-manifest.json".to_owned(),
        ),
        (
            "cargo_crate_sha256",
            format!(
                "cargo/{}-{}.crate",
                application.cargo_name(),
                application.cargo_version()
            ),
        ),
        (
            "target_profile_id",
            "application/target-profile.json".to_owned(),
        ),
        (
            "lcnf_manifest_sha256",
            "application/lcnf-manifest.json".to_owned(),
        ),
        (
            "generated_core_sha256",
            "cargo/package/generation-manifest.json".to_owned(),
        ),
    ] {
        ensure(
            provenance[key] == hex(file(files, &path)?),
            "application archive artifact link differs",
        )?;
    }
    let lcnf = canonical_json(file(files, "application/lcnf-manifest.json")?, false)?;
    let identity = canonical_json(file(files, "application/exporter-identity.json")?, false)?;
    keys(
        &identity,
        &["schema", "source_archive_sha256", "executable"],
    )?;
    ensure(
        identity["schema"] == "prismpm/exporter-identity/1",
        "application exporter identity schema differs",
    )?;
    validate_exporter_measurement(&identity)?;
    ensure(
        lcnf == json!({"coverage_sha256":hex(file(files,"cargo/coverage.json")?),"kernel_ir_sha256":hex(file(files,"cargo/kernel.ir")?),"roots_sha256":hex(file(files,"cargo/roots.json")?),"schema":"prismpm/lcnf-manifest/1"}),
        "application LCNF evidence differs",
    )?;
    let stem = application.cargo_name().replace('-', "_");
    let expected_browser: BTreeSet<_> = [
        "app.css".to_owned(),
        "app.js".to_owned(),
        "index.html".to_owned(),
        format!("{stem}.js"),
        format!("{stem}_bg.wasm"),
        "provenance.json".to_owned(),
    ]
    .into_iter()
    .map(|name| format!("view/browser/{name}"))
    .collect();
    ensure(
        files
            .keys()
            .filter(|name| name.starts_with("view/browser/"))
            .cloned()
            .collect::<BTreeSet<_>>()
            == expected_browser,
        "application browser closure differs",
    )?;
    let browser_bytes = file(files, "view/browser/provenance.json")?;
    let browser = canonical_json(browser_bytes, false)?;
    ensure(
        provenance["view_binding"]["browser_projection"]["sha256"] == hex(browser_bytes)
            && browser["adapter_lock_sha256"]
                == hex(file(files, "view/browser-adapter/Cargo.lock")?)
            && browser["adapter_wasm_sha256"]
                == hex(file(files, &format!("view/browser/{stem}_bg.wasm"))?)
            && browser["binding_javascript_sha256"]
                == hex(file(files, &format!("view/browser/{stem}.js"))?)
            && browser["view_manifest_sha256"] == hex(file(files, "view/view-manifest.json")?)
            && browser["generated_core_sha256"] == provenance["generated_core_sha256"]
            && browser["view_model_id"] == provenance["view_binding"]["view_model_id"],
        "application browser provenance differs",
    )?;
    Ok(identities)
}

fn native_binding(
    manifest: &Value,
    lex: &Value,
    snapshot: &Value,
    build_files: &BTreeMap<String, Vec<u8>>,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), PrismError> {
    keys(
        manifest,
        &[
            "artifacts",
            "build_id",
            "execution",
            "export_roots",
            "lexlean_attestation_id",
            "package_export_roots",
            "processes",
            "runtime_roots",
            "schema",
        ],
    )?;
    ensure(
        manifest["schema"] == "prismpm/verification-manifest/2"
            && manifest["lexlean_attestation_id"] == lex["attestation_id"],
        "native verification identity differs",
    )?;
    let names = [
        ("coverage", "coverage.json"),
        ("executable", "validator"),
        ("execution_corpus", "execution-corpus.toml"),
        ("execution_evidence", "execution.json"),
        ("generated_rust", "generated.rs"),
        ("kernel_ir", "kernel.ir"),
        ("lexlean_attestation", "lexlean-attestation.json"),
        ("roots", "roots.json"),
        ("stdlib_exports", "stdlib-exports.toml"),
    ];
    let mut artifacts = names.iter().map(|(key, _)| *key).collect::<Vec<_>>();
    artifacts.push("model");
    keys(&manifest["artifacts"], &artifacts)?;
    for (key, name) in names {
        descriptor(&manifest["artifacts"][key], file(files, name)?)?;
    }
    descriptor(
        &manifest["artifacts"]["model"],
        file(build_files, "model.prism.json")?,
    )?;
    ensure(
        file(files, "execution-corpus.toml")? == include_bytes!("../model/execution-corpus.toml")
            && file(files, "stdlib-exports.toml")?
                == include_bytes!("../model/stdlib-exports.toml"),
        "native execution register differs from authoritative SDK register",
    )?;
    let execution = canonical_json(file(files, "execution.json")?, false)?;
    let coverage = named_export_json(file(files, "coverage.json")?)?;
    crate::verification::validate_release_native_evidence(
        manifest, &execution, &coverage, lex, snapshot,
    )
    .map_err(|error| invalid(format!("native execution: {}", error.message)))?;
    let roots = named_export_json(file(files, "roots.json")?)?;
    ensure(
        roots
            == json!({"erased_proof_dependencies":coverage["erased_proof_dependencies"],"included_definitions":coverage["included_definitions"],"requested_roots":coverage["requested_roots"]}),
        "native coverage root evidence differs",
    )?;
    Ok(())
}

fn native_processes(
    manifest: &Value,
    modules: &BTreeSet<String>,
    execution: &Value,
    processes: &[Value],
) -> Result<(), PrismError> {
    let mut expected = PREFLIGHT.to_vec();
    expected.push("lake-build-generated");
    expected.extend(std::iter::repeat_n("leanchecker", modules.len()));
    expected.extend([
        "lean4-prod-build",
        "prod-export",
        "prod-export",
        "rustfmt",
        "rustc-allocation-counter",
        "rustc",
        "generated-validator",
        "generated-validator",
    ]);
    process_order(processes, &expected)?;
    ensure(
        processes[5]["argv"] == json!(["build", "PrismGenerated"]),
        "native generated build process differs",
    )?;
    for (row, module) in processes[6..6 + modules.len()].iter().zip(modules) {
        ensure(
            row["argv"] == json!(["env", "leanchecker", module]),
            "native replay process module differs",
        )?;
    }
    let suffix = &processes[6 + modules.len()..];
    ensure(
        suffix[0]["argv"] == json!(["build", "prod-export"]),
        "native exporter build process differs",
    )?;
    let register: toml::Value = toml::from_str(include_str!("../model/runtime-roots.toml"))
        .map_err(|error| invalid(error.to_string()))?;
    for (row, directory) in suffix[1..3].iter().zip(["export-a", "export-b"]) {
        let mut argv = vec![
            "exe".to_owned(),
            "prod-export".to_owned(),
            "--module".to_owned(),
            register["lean_module"]
                .as_str()
                .ok_or_else(|| invalid("native module register missing"))?
                .to_owned(),
        ];
        for root in strings(&manifest["export_roots"])? {
            argv.extend(["--root".to_owned(), root.to_owned()]);
        }
        argv.extend([
            "--ir-module".to_owned(),
            register["ir_module"]
                .as_str()
                .ok_or_else(|| invalid("native IR register missing"))?
                .to_owned(),
            "--out".to_owned(),
            format!("$STAGING/{directory}"),
        ]);
        ensure(
            row["argv"] == json!(argv),
            "native export process arguments differ",
        )?;
    }
    ensure(
        suffix[3]["argv"]
            == json!([
                "--edition",
                "2021",
                "$STAGING/generated.rs",
                "$STAGING/harness.rs"
            ]),
        "native formatter process arguments differ",
    )?;
    ensure(
        suffix[4]["argv"]
            == json!([
                "--edition",
                "2021",
                "--crate-name",
                "prod_alloc_counter",
                "--crate-type",
                "lib",
                "-C",
                "codegen-units=1",
                "-C",
                "debuginfo=0",
                "--remap-path-prefix=$STAGING=$STAGING",
                "$STAGING/prod_alloc_counter.rs",
                "-o",
                "$STAGING/libprod_alloc_counter.rlib"
            ]),
        "native allocation-counter process arguments differ",
    )?;
    ensure(
        suffix[5]["argv"]
            == json!([
                "--edition",
                "2021",
                "-C",
                "opt-level=3",
                "-C",
                "debug-assertions=yes",
                "-C",
                "codegen-units=1",
                "-C",
                "debuginfo=0",
                "-C",
                "strip=symbols",
                "-C",
                "link-arg=-Wl,--build-id=none",
                "--remap-path-prefix=$STAGING=$STAGING",
                "--extern",
                "prod_alloc_counter=$STAGING/libprod_alloc_counter.rlib",
                "$STAGING/harness.rs",
                "-o",
                "$STAGING/validator"
            ]),
        "native compiler process arguments differ",
    )?;
    for row in &processes[5..6 + modules.len() + 3] {
        ensure(
            row["executable_sha256"] == processes[1]["executable_sha256"],
            "native process Lake identity differs",
        )?;
    }
    ensure(
        suffix[3]["executable_sha256"] == processes[2]["executable_sha256"]
            && suffix[4]["executable_sha256"] == processes[3]["executable_sha256"]
            && suffix[5]["executable_sha256"] == processes[3]["executable_sha256"],
        "native compiler process executable identity differs",
    )?;
    for row in &suffix[6..8] {
        let output: Value = serde_json::from_str(string(&row["stdout"])?.trim())
            .map_err(|error| invalid(format!("native execution: {error}")))?;
        ensure(
            row["argv"] == json!([])
                && row["executable_sha256"] == manifest["artifacts"]["executable"]["sha256"]
                && &output == execution,
            "native execution process evidence differs",
        )?;
    }
    ensure(
        suffix[6]["stdout"] == suffix[7]["stdout"] && suffix[6]["stderr"] == suffix[7]["stderr"],
        "native execution is not deterministic",
    )
}

#[cfg(test)]
pub(crate) mod tests;
