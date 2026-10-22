//! Reviewed-golden comparison; never an acceptance attestation.

use lexlean::artifact::content_id as lex_ids;
use prismpm::holo::canonical::{content_id, decode_value, encode_value};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

pub mod platform;

/// The explicit comparison recipe; it never authorizes a release.
pub const PROFILE: &str = "prismpm/golden-comparison/1";
/// The complete, sorted set of original reviewed files.
pub type GoldenFiles = Vec<(String, Vec<u8>)>;

fn ensure(valid: bool, message: &str) -> Result<(), String> {
    valid.then_some(()).ok_or_else(|| message.to_owned())
}

fn keys(value: &Value, expected: &[&str]) -> Result<(), String> {
    let actual = value.as_object().ok_or("golden record is not an object")?;
    ensure(
        actual.len() == expected.len() && expected.iter().all(|key| actual.contains_key(*key)),
        "golden record fields are not closed",
    )
}

fn array(value: &Value) -> Result<&[Value], String> {
    value
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| "golden array is absent".to_owned())
}

fn text(value: &Value) -> Result<&str, String> {
    value
        .as_str()
        .ok_or_else(|| "golden string is absent".to_owned())
}

fn digest(value: &Value) -> Result<&str, String> {
    let value = text(value)?;
    lex_ids::Sha256Digest::from_hex(value)?;
    Ok(value)
}

fn canonical(bytes: &[u8], framed: bool) -> Result<Value, String> {
    let bytes = if framed {
        bytes
            .strip_suffix(b"\n")
            .ok_or("golden LexLean framing is absent")?
    } else {
        bytes
    };
    decode_value(bytes, "golden record").map_err(|error| error.to_string())
}

fn encoded(value: &Value) -> Result<Vec<u8>, String> {
    encode_value(value).map_err(|error| error.to_string())
}

fn safe_path(path: &str) -> Result<(), String> {
    ensure(
        !path.is_empty()
            && !path.contains('\\')
            && !path.chars().any(char::is_control)
            && path.split('/').all(|part| !matches!(part, "" | "." | "..")),
        "golden file path is not confined",
    )
}

fn descriptor(value: &Value, bytes: Option<&[u8]>) -> Result<(), String> {
    keys(value, &["byte_length", "sha256"])?;
    let length = value["byte_length"]
        .as_u64()
        .ok_or("golden byte length is invalid")?;
    let hash = digest(&value["sha256"])?;
    if let Some(bytes) = bytes {
        ensure(
            length == bytes.len() as u64 && hash == content_id(bytes),
            "golden file descriptor differs from its bytes",
        )?;
    }
    Ok(())
}

fn exporter_role(process: &Value) -> Result<bool, String> {
    let args = array(&process["argv"])?;
    let invocation = args.first().and_then(Value::as_str) == Some("exe")
        && args.get(1).and_then(Value::as_str) == Some("prod-export");
    let role = process["tool"] == "prod-export";
    ensure(
        role == invocation,
        "golden exporter role and invocation differ",
    )?;
    Ok(role)
}

fn exporter_record(value: &Value) -> Result<(), String> {
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
        "golden exporter schema differs",
    )?;
    ensure(
        digest(&value["source_archive_sha256"])?
            == content_id(include_bytes!("../../../vendor/lean4-prod/lean.tar")),
        "golden exporter archive differs from compiled authority",
    )?;
    let executable = &value["executable"];
    keys(executable, &["byte_length", "mode", "sha256"])?;
    digest(&executable["sha256"])?;
    ensure(
        executable["byte_length"]
            .as_u64()
            .is_some_and(|length| (1..=256 * 1024 * 1024).contains(&length))
            && executable["mode"]
                .as_u64()
                .is_some_and(|mode| mode & !0o777 == 0 && mode & 0o111 != 0),
        "golden exporter executable measurement differs",
    )?;
    // These source-review trees have no independently retained SDK lock.
    // Warm provenance cannot be admitted by merely accepting its hashes.
    ensure(
        value["acquisition"] == json!({"schema":"prismpm/exporter-acquisition/1","mode":"cold"}),
        "golden exporter requires cold source acquisition",
    )
}

fn current_exporters(manifest: &Value) -> Result<(), String> {
    let mut count = 0;
    let mut identity = None;
    for process in array(&manifest["processes"])? {
        if exporter_role(process)? {
            exporter_record(&process["exporter"])?;
            if let Some(first) = identity {
                ensure(
                    first == &process["exporter"],
                    "golden exports disagree on measured compiler identity",
                )?;
            } else {
                identity = Some(&process["exporter"]);
            }
            count += 1;
        }
    }
    ensure(
        count == 2,
        "golden current evidence requires both measured exports",
    )
}

fn file<'a>(files: &'a BTreeMap<&str, &[u8]>, path: &str) -> Result<&'a [u8], String> {
    files
        .get(path)
        .copied()
        .ok_or_else(|| format!("golden file is absent: {path}"))
}

fn file_rows(
    value: &Value,
    files: &BTreeMap<&str, &[u8]>,
    prefix: &str,
    kind: bool,
) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    for row in array(value)? {
        keys(
            row,
            if kind {
                &["byte_length", "kind", "path", "sha256"]
            } else {
                &["byte_length", "path", "sha256"]
            },
        )?;
        let relative = text(&row["path"])?;
        safe_path(relative)?;
        let path = format!("{prefix}{relative}");
        ensure(
            paths.last().is_none_or(|previous| previous < &path),
            "golden file order is not strict",
        )?;
        descriptor(
            &json!({"byte_length":row["byte_length"],"sha256":row["sha256"]}),
            Some(file(files, &path)?),
        )?;
        if kind {
            ensure(!text(&row["kind"])?.is_empty(), "golden file kind is empty")?;
        }
        paths.push(path);
    }
    Ok(paths)
}

/// Read a confined regular-file tree; do not follow symlinks or ignore special files.
pub fn read(root: &Path) -> Result<GoldenFiles, String> {
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root) {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().is_dir() {
            continue;
        }
        ensure(
            entry.file_type().is_file(),
            "golden tree contains a symlink or special file",
        )?;
        let path = entry
            .path()
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_str()
            .ok_or("golden path is not UTF-8")?
            .to_owned();
        safe_path(&path)?;
        files.push((
            path,
            std::fs::read(entry.path()).map_err(|error| error.to_string())?,
        ));
    }
    files.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(files)
}

fn validate(files: &[(String, Vec<u8>)]) -> Result<(Value, Value, Value), String> {
    ensure(
        files.windows(2).all(|rows| rows[0].0 < rows[1].0),
        "golden tree paths are not strict",
    )?;
    let files = files
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
        .collect::<BTreeMap<_, _>>();
    let golden = canonical(file(&files, "golden-manifest.json")?, false)?;
    keys(
        &golden,
        &[
            "attestation_id",
            "build_id",
            "comparison_profile",
            "compiler_semantics_id",
            "files",
            "generated_lean",
            "review_reason",
            "schema",
            "sources",
        ],
    )?;
    ensure(
        golden["schema"] == "prismpm/golden-manifest/2" && golden["comparison_profile"] == PROFILE,
        "unknown golden comparison profile",
    )?;
    ensure(
        !text(&golden["review_reason"])?.trim().is_empty(),
        "golden review reason is empty",
    )?;
    let declared = file_rows(&golden["files"], &files, "", false)?;
    ensure(
        declared.iter().map(String::as_str).eq(files
            .keys()
            .copied()
            .filter(|path| *path != "golden-manifest.json")),
        "golden tree closure is not exact",
    )?;
    ensure(
        declared.iter().all(|path| {
            path.starts_with("source/")
                || path.starts_with("build/")
                || path.starts_with("verified/")
        }),
        "golden tree has an unknown section",
    )?;
    let sources = array(&golden["files"])?
        .iter()
        .filter(|row| {
            row["path"]
                .as_str()
                .is_some_and(|path| path.starts_with("source/"))
        })
        .cloned()
        .collect::<Vec<_>>();
    ensure(
        golden["sources"] == json!(sources),
        "golden source descriptors differ",
    )?;
    let mut lean_paths = Vec::new();
    for row in array(&golden["generated_lean"])? {
        keys(
            row,
            &[
                "byte_length",
                "path",
                "sha256",
                "source_path",
                "source_sha256",
            ],
        )?;
        let path = text(&row["path"])?;
        let logical = path
            .strip_prefix("build/lexlean/build/modules/PrismPM/")
            .and_then(|path| path.strip_suffix(".lean"))
            .ok_or("golden Lean mapping path is invalid")?;
        let source = format!("source/{logical}.lex.tex");
        ensure(
            row["source_path"] == source
                && digest(&row["source_sha256"])? == content_id(file(&files, &source)?),
            "golden generated Lean source binding differs",
        )?;
        descriptor(
            &json!({"byte_length":row["byte_length"],"sha256":row["sha256"]}),
            Some(file(&files, path)?),
        )?;
        lean_paths.push(path);
    }
    ensure(
        !lean_paths.is_empty()
            && lean_paths.into_iter().eq(files
                .keys()
                .copied()
                .filter(|path| path.starts_with("build/") && path.ends_with(".lean"))),
        "golden generated Lean closure differs",
    )?;

    let build = canonical(file(&files, "build/manifest.json")?, false)?;
    keys(&build, &["files", "inputs", "schema"])?;
    ensure(
        build["schema"] == "prismpm/build-manifest/1"
            && digest(&golden["build_id"])? == content_id(&encoded(&build["inputs"])?),
        "golden build identity differs",
    )?;
    let paths = file_rows(&build["files"], &files, "build/", true)?;
    ensure(
        paths.iter().map(String::as_str).eq(files
            .keys()
            .copied()
            .filter(|path| path.starts_with("build/") && *path != "build/manifest.json")),
        "golden build closure differs",
    )?;
    let model_bytes = file(&files, "build/model.prism.json")?;
    let model = prismpm::holo::canonical::decode_canonical(model_bytes)
        .map_err(|error| error.to_string())?;
    ensure(
        golden["compiler_semantics_id"] == model.provenance.compiler_semantics_id
            && build["inputs"]["model_id"] == content_id(model_bytes),
        "golden model identity differs",
    )?;

    let lex_bytes = file(&files, "verified/lexlean-attestation.json")?;
    let lex = canonical(lex_bytes, true)?;
    let schema: Value = serde_json::from_str(include_str!(
        "../../../vendor/lexlean/schemas/attestation.schema.json"
    ))
    .map_err(|error| error.to_string())?;
    jsonschema::validator_for(&schema)
        .map_err(|error| error.to_string())?
        .validate(&lex)
        .map_err(|error| format!("golden LexLean shape: {error}"))?;
    let mut body = lex.clone();
    body.as_object_mut()
        .ok_or("golden LexLean body is absent")?
        .remove("attestation_id");
    let body = encoded(&body)?;
    ensure(
        digest(&lex["attestation_id"])?
            == lex_ids::attestation_id(
                std::str::from_utf8(&body).map_err(|error| error.to_string())?,
            )
            .to_hex(),
        "golden LexLean attestation identity differs",
    )?;
    ensure(
        lex["source_id"] == model.provenance.source_id
            && lex["semantic_id"] == model.provenance.semantic_id
            && lex["lexlean"]["compiler_semantics"] == model.provenance.compiler_semantics_id
            && lex["build_id"] == build["inputs"]["lexlean_build_id"],
        "golden LexLean/model identities differ",
    )?;
    descriptor(
        &lex["build_manifest"],
        Some(file(&files, "build/lexlean/build/manifest.json")?),
    )?;

    let manifest_bytes = file(&files, "verified/manifest.json")?;
    let manifest = canonical(manifest_bytes, false)?;
    keys(
        &manifest,
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
            && digest(&golden["attestation_id"])? == content_id(manifest_bytes)
            && manifest["build_id"] == golden["build_id"]
            && manifest["lexlean_attestation_id"] == lex["attestation_id"],
        "golden verification identity differs",
    )?;
    keys(
        &manifest["artifacts"],
        &[
            "coverage",
            "executable",
            "execution_corpus",
            "execution_evidence",
            "generated_rust",
            "kernel_ir",
            "lexlean_attestation",
            "model",
            "roots",
            "stdlib_exports",
        ],
    )?;
    for (key, path) in [
        ("coverage", "verified/coverage.json"),
        ("execution_corpus", "verified/execution-corpus.toml"),
        ("execution_evidence", "verified/execution.json"),
        ("lexlean_attestation", "verified/lexlean-attestation.json"),
        ("model", "build/model.prism.json"),
        ("roots", "verified/roots.json"),
        ("stdlib_exports", "verified/stdlib-exports.toml"),
    ] {
        descriptor(&manifest["artifacts"][key], Some(file(&files, path)?))?;
    }
    for key in ["executable", "generated_rust", "kernel_ir"] {
        descriptor(&manifest["artifacts"][key], None)?;
    }
    for process in array(&manifest["processes"])? {
        let mut fields = vec![
            "argv",
            "executable_sha256",
            "exit_code",
            "stderr",
            "stdout",
            "tool",
        ];
        let exporter = exporter_role(process)?;
        // Historical records remain inspectable, not current acceptance. Both
        // current_caller and native_records require complete measurements.
        if let Some(measurement) = process.get("exporter") {
            ensure(exporter, "golden non-export process has exporter metadata")?;
            exporter_record(measurement)?;
            fields.push("exporter");
        }
        keys(process, &fields)?;
        digest(&process["executable_sha256"])?;
        ensure(
            process["exit_code"] == 0 && !text(&process["tool"])?.is_empty(),
            "golden verification process did not pass",
        )?;
        text(&process["stderr"])?;
        text(&process["stdout"])?;
        for arg in array(&process["argv"])? {
            text(arg)?;
        }
    }
    ensure(
        manifest["execution"] == canonical(file(&files, "verified/execution.json")?, false)?
            && manifest["execution"]["status"] == "passed",
        "golden execution evidence differs",
    )?;
    Ok((golden, lex, manifest))
}

/// Compare a complete reviewed tree without modifying its raw evidence.
pub fn comparison(files: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let (mut golden, mut lex, mut manifest) = validate(files)?;
    lex.as_object_mut()
        .ok_or("golden LexLean body is absent")?
        .remove("attestation_id");
    lex["lexlean"]
        .as_object_mut()
        .ok_or("golden caller is absent")?
        .remove("executable_sha256");
    manifest
        .as_object_mut()
        .ok_or("golden verification body is absent")?
        .remove("lexlean_attestation_id");
    manifest["artifacts"]["lexlean_attestation"]
        .as_object_mut()
        .ok_or("golden LexLean descriptor is absent")?
        .remove("sha256");
    let mut rows = golden["files"].clone();
    for row in rows.as_array_mut().ok_or("golden file rows are absent")? {
        let projection = match text(&row["path"])? {
            "verified/lexlean-attestation.json" => Some(&lex),
            "verified/manifest.json" => Some(&manifest),
            _ => None,
        };
        if let Some(projection) = projection {
            let row = row.as_object_mut().ok_or("golden row is absent")?;
            row.remove("sha256");
            row.insert(
                "comparison_sha256".to_owned(),
                json!(content_id(&encoded(projection)?)),
            );
        }
    }
    let metadata = golden.as_object_mut().ok_or("golden metadata is absent")?;
    metadata.remove("attestation_id");
    metadata.remove("files");
    encoded(&json!({"schema":PROFILE,"scope":"regression-only","metadata":golden,"files":rows}))
}

/// Reject any difference beyond the declared caller-identity equivalence.
pub fn compare(expected: &[(String, Vec<u8>)], actual: &[(String, Vec<u8>)]) -> Result<(), String> {
    ensure(
        comparison(expected)? == comparison(actual)?,
        "golden artifact tree drifted outside caller identity",
    )
}

/// Check freshly produced evidence against the actual executing verifier bytes.
pub fn current_caller(files: &[(String, Vec<u8>)], executable: &[u8]) -> Result<(), String> {
    let (_, lex, manifest) = validate(files)?;
    current_exporters(&manifest)?;
    ensure(
        lex["lexlean"]["executable_sha256"] == content_id(executable),
        "golden current verifier executable identity differs",
    )
}

const NATIVE_RECORDS: [&str; 3] = [
    "golden-manifest.json",
    "verified/lexlean-attestation.json",
    "verified/manifest.json",
];

/// Extract complete, unmodified native records after validating shared semantics.
/// This does not normalize evidence or accept a newly generated baseline.
pub fn native_records(
    base: &GoldenFiles,
    actual: &GoldenFiles,
    platform: platform::Platform,
) -> Result<GoldenFiles, String> {
    let (base_golden, base_lex, base_manifest) = validate(base)?;
    let (golden, lex, manifest) = validate(actual)?;
    current_exporters(&base_manifest)?;
    current_exporters(&manifest)?;
    ensure(
        lex["host"] == json!({"arch":platform.architecture(),"os":"linux"}),
        "golden raw host differs from selected process platform",
    )?;
    let shared = |files: &GoldenFiles| {
        files
            .iter()
            .filter(|(path, _)| !NATIVE_RECORDS.contains(&path.as_str()))
            .cloned()
            .collect::<GoldenFiles>()
    };
    ensure(
        shared(base) == shared(actual),
        "native golden changes platform-independent file bytes",
    )?;
    for key in [
        "build_id",
        "comparison_profile",
        "compiler_semantics_id",
        "generated_lean",
        "schema",
        "sources",
    ] {
        ensure(
            base_golden[key] == golden[key],
            "native golden changes shared model identity",
        )?;
    }
    for key in [
        "build_id",
        "build_manifest",
        "declarations",
        "lake_workspace",
        "semantic_id",
        "source_id",
        "spec",
        "status",
    ] {
        ensure(
            base_lex[key] == lex[key],
            "native golden changes source or declaration audit",
        )?;
    }
    for key in ["compiler_semantics", "version"] {
        ensure(
            base_lex["lexlean"][key] == lex["lexlean"][key],
            "native golden changes compiler identity",
        )?;
    }
    for key in [
        "build_id",
        "execution",
        "export_roots",
        "package_export_roots",
        "runtime_roots",
        "schema",
    ] {
        ensure(
            base_manifest[key] == manifest[key],
            "native golden changes execution or roots",
        )?;
    }
    for (key, descriptor) in base_manifest["artifacts"]
        .as_object()
        .ok_or("golden artifacts absent")?
    {
        if !matches!(key.as_str(), "executable" | "lexlean_attestation") {
            ensure(
                descriptor == &manifest["artifacts"][key],
                "native golden changes portable artifact descriptor",
            )?;
        }
    }
    // Recorded tool bytes/output may be platform-specific. Their invocation,
    // order and successful outcome remain exactly the same; a future run still
    // compares EVERY raw byte against its reviewed platform's records.
    for (base, actual) in [(&base_lex, &lex), (&base_manifest, &manifest)] {
        let before = array(&base["processes"])?;
        let after = array(&actual["processes"])?;
        ensure(
            before.len() == after.len(),
            "native golden changes process closure",
        )?;
        for (before, after) in before.iter().zip(after) {
            for key in ["argv", "exit_code", "module", "tool"] {
                ensure(
                    before[key] == after[key],
                    "native golden changes process invocation",
                )?;
            }
            if let Some(exporter) = before.get("exporter") {
                let actual = &after["exporter"];
                for key in ["schema", "source_archive_sha256", "acquisition"] {
                    ensure(
                        exporter[key] == actual[key],
                        "native golden changes exporter provenance",
                    )?;
                }
                ensure(
                    exporter["executable"]["mode"] == actual["executable"]["mode"],
                    "native golden changes exporter executable mode",
                )?;
            }
        }
    }
    Ok(actual
        .iter()
        .filter(|(path, _)| NATIVE_RECORDS.contains(&path.as_str()))
        .cloned()
        .collect())
}

/// Compose only the three closed native-record replacements with shared bytes.
pub fn compose_native_records(
    base: &GoldenFiles,
    records: &GoldenFiles,
    platform: platform::Platform,
) -> Result<GoldenFiles, String> {
    ensure(
        records
            .iter()
            .map(|(path, _)| path.as_str())
            .eq(NATIVE_RECORDS),
        "native golden record set is not exact",
    )?;
    let mut result = base
        .iter()
        .filter(|(path, _)| !NATIVE_RECORDS.contains(&path.as_str()))
        .cloned()
        .collect::<GoldenFiles>();
    result.extend(records.iter().cloned());
    result.sort_by(|left, right| left.0.cmp(&right.0));
    ensure(
        native_records(base, &result, platform)? == *records,
        "native golden records changed during composition",
    )?;
    Ok(result)
}

/// Read the selected reviewed records; never fall back to another platform.
pub fn read_platform(root: &Path, platform: platform::Platform) -> Result<GoldenFiles, String> {
    let base = read(&root.join(platform::Platform::DevelopmentAmd64.directory()))?;
    if platform == platform::Platform::DevelopmentAmd64 {
        native_records(&base, &base, platform)?;
        return Ok(base);
    }
    let records = read(&root.join(platform.directory()))?;
    compose_native_records(&base, &records, platform)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lexlean::artifact::content_id::attestation_id;
    use prismpm::holo::canonical::content_id;
    use serde_json::Value;

    fn fixture() -> Vec<(String, Vec<u8>)> {
        let root = repo_model::repo_root().join("tests/golden/stdlib");
        let mut files = walkdir::WalkDir::new(&root)
            .into_iter()
            .map(Result::unwrap)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| {
                (
                    entry
                        .path()
                        .strip_prefix(&root)
                        .unwrap()
                        .to_str()
                        .unwrap()
                        .to_owned(),
                    std::fs::read(entry.path()).unwrap(),
                )
            })
            .collect::<Vec<_>>();
        files.sort_by(|left, right| left.0.cmp(&right.0));
        files
    }

    fn value(files: &[(String, Vec<u8>)], path: &str) -> Value {
        serde_json::from_slice(&files.iter().find(|(name, _)| name == path).unwrap().1).unwrap()
    }

    fn replace(files: &mut [(String, Vec<u8>)], path: &str, value: &Value, framed: bool) {
        let mut bytes = encode_value(value).unwrap();
        if framed {
            bytes.push(b'\n');
        }
        files.iter_mut().find(|(name, _)| name == path).unwrap().1 = bytes;
    }

    fn rebind(files: &mut [(String, Vec<u8>)]) {
        let lex_path = "verified/lexlean-attestation.json";
        let mut lex = value(files, lex_path);
        lex.as_object_mut().unwrap().remove("attestation_id");
        lex["attestation_id"] = json!(attestation_id(
            std::str::from_utf8(&encode_value(&lex).unwrap()).unwrap()
        )
        .to_hex());
        replace(files, lex_path, &lex, true);
        let lex_bytes = &files.iter().find(|(name, _)| name == lex_path).unwrap().1;
        let mut manifest = value(files, "verified/manifest.json");
        manifest["lexlean_attestation_id"] = lex["attestation_id"].clone();
        manifest["artifacts"]["lexlean_attestation"] =
            json!({"byte_length":lex_bytes.len(),"sha256":content_id(lex_bytes)});
        replace(files, "verified/manifest.json", &manifest, false);
        let mut golden = value(files, "golden-manifest.json");
        golden["attestation_id"] = json!(content_id(&encode_value(&manifest).unwrap()));
        for row in golden["files"].as_array_mut().unwrap() {
            let bytes = &files
                .iter()
                .find(|(name, _)| Some(name.as_str()) == row["path"].as_str())
                .unwrap()
                .1;
            row["byte_length"] = json!(bytes.len());
            row["sha256"] = json!(content_id(bytes));
        }
        golden["sources"] = json!(golden["files"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["path"].as_str().unwrap().starts_with("source/"))
            .cloned()
            .collect::<Vec<_>>());
        for row in golden["generated_lean"].as_array_mut().unwrap() {
            let bytes = &files
                .iter()
                .find(|(path, _)| Some(path.as_str()) == row["source_path"].as_str())
                .unwrap()
                .1;
            row["source_sha256"] = json!(content_id(bytes));
        }
        replace(files, "golden-manifest.json", &golden, false);
    }

    #[test]
    fn current_goldens_require_closed_actual_exporter_measurements() {
        let original = fixture();
        let manifest = value(&original, "verified/manifest.json");
        current_exporters(&manifest).unwrap();
        for mutation in [
            "missing",
            "null",
            "unknown",
            "schema",
            "archive",
            "acquisition",
            "size",
            "zero",
            "mode",
            "hash",
            "role",
            "argv",
            "disagreement",
        ] {
            let mut changed = manifest.clone();
            let rows = changed["processes"].as_array_mut().unwrap();
            let index = rows
                .iter()
                .position(|row| row["tool"] == "prod-export")
                .unwrap();
            let row = &mut rows[index];
            match mutation {
                "missing" => {
                    row.as_object_mut().unwrap().remove("exporter");
                }
                "null" => row["exporter"] = Value::Null,
                "unknown" => row["exporter"]["extra"] = json!(true),
                "schema" => row["exporter"]["schema"] = json!("other"),
                "archive" => row["exporter"]["source_archive_sha256"] = json!("0".repeat(64)),
                "acquisition" => row["exporter"]["acquisition"]["mode"] = json!("sdk-seed"),
                "size" => row["exporter"]["executable"]["byte_length"] = json!(268435457_u64),
                "zero" => row["exporter"]["executable"]["byte_length"] = json!(0),
                "mode" => row["exporter"]["executable"]["mode"] = json!(0o4755),
                "hash" => row["exporter"]["executable"]["sha256"] = json!("invalid"),
                "role" => row["tool"] = json!("not-an-export"),
                "argv" => row["argv"] = json!(["--version"]),
                "disagreement" => row["exporter"]["executable"]["sha256"] = json!("0".repeat(64)),
                _ => unreachable!(),
            }
            assert!(current_exporters(&changed).is_err(), "{mutation}");
        }
        for extra in [false, true] {
            let mut changed = manifest.clone();
            let rows = changed["processes"].as_array_mut().unwrap();
            let index = rows
                .iter()
                .position(|row| row["tool"] == "prod-export")
                .unwrap();
            if extra {
                rows.push(rows[index].clone());
            } else {
                rows.remove(index);
            }
            assert!(
                current_exporters(&changed).is_err(),
                "both and only both exports required"
            );
        }
        let mut historical = original.clone();
        let mut legacy = manifest.clone();
        for row in legacy["processes"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("exporter");
        }
        replace(&mut historical, "verified/manifest.json", &legacy, false);
        rebind(&mut historical);
        comparison(&historical).unwrap(); // Inspection is not current admission.
        assert!(current_caller(&historical, b"caller").is_err());
        assert!(native_records(&historical, &original, platform::Platform::SdkAmd64).is_err());
        assert!(native_records(&original, &historical, platform::Platform::SdkAmd64).is_err());

        let mut changed = original.clone();
        let mut native = manifest;
        for row in native["processes"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .filter(|row| row["tool"] == "prod-export")
        {
            row["exporter"]["executable"]["sha256"] = json!("a".repeat(64));
            row["exporter"]["executable"]["byte_length"] = json!(1234);
        }
        replace(&mut changed, "verified/manifest.json", &native, false);
        rebind(&mut changed);
        assert!(
            compare(&original, &changed).is_err(),
            "raw measured compiler changes require review"
        );
        native_records(&original, &changed, platform::Platform::SdkAmd64).unwrap();
        for row in native["processes"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .filter(|row| row["tool"] == "prod-export")
        {
            row["exporter"]["executable"]["mode"] = json!(0o700);
        }
        replace(&mut changed, "verified/manifest.json", &native, false);
        rebind(&mut changed);
        assert!(native_records(&original, &changed, platform::Platform::SdkAmd64).is_err());
    }

    #[test]
    fn native_records_preserve_exact_bytes_and_reject_semantic_or_closure_changes() {
        let original = fixture();
        let selected = platform::Platform::SdkAmd64;
        let records = native_records(&original, &original, selected).unwrap();
        assert_eq!(records.len(), 3);
        assert_eq!(
            compose_native_records(&original, &records, selected).unwrap(),
            original
        );
        for index in 0..records.len() {
            let mut missing = records.clone();
            missing.remove(index);
            assert!(compose_native_records(&original, &missing, selected).is_err());
        }
        let mut duplicate = records.clone();
        duplicate.push(records[0].clone());
        assert!(compose_native_records(&original, &duplicate, selected).is_err());
        assert!(native_records(&original, &original, platform::Platform::SdkArm64).is_err());
        let mut changed = original.clone();
        let mut lex = value(&changed, "verified/lexlean-attestation.json");
        lex["declarations"][0]["policy"]["axioms"] = json!(["sorryAx"]);
        replace(
            &mut changed,
            "verified/lexlean-attestation.json",
            &lex,
            true,
        );
        rebind(&mut changed);
        validate(&changed).unwrap();
        assert!(native_records(&original, &changed, selected)
            .unwrap_err()
            .contains("declaration audit"));
        for pointer in [
            "/artifacts/kernel_ir/sha256",
            "/artifacts/generated_rust/sha256",
        ] {
            let mut changed = original.clone();
            let mut manifest = value(&changed, "verified/manifest.json");
            *manifest.pointer_mut(pointer).unwrap() = json!("a".repeat(64));
            replace(&mut changed, "verified/manifest.json", &manifest, false);
            rebind(&mut changed);
            validate(&changed).unwrap();
            assert!(native_records(&original, &changed, selected)
                .unwrap_err()
                .contains("portable artifact"));
        }
        let mut changed = original.clone();
        changed
            .iter_mut()
            .find(|(path, _)| path.starts_with("source/"))
            .unwrap()
            .1
            .push(b' ');
        rebind(&mut changed);
        validate(&changed).unwrap();
        assert!(native_records(&original, &changed, selected)
            .unwrap_err()
            .contains("platform-independent"));
    }

    #[test]
    fn native_record_review_does_not_relax_later_raw_evidence_comparison() {
        let original = fixture();
        let selected = platform::Platform::SdkAmd64;
        let mut changed = original.clone();
        let mut manifest = value(&changed, "verified/manifest.json");
        manifest["processes"][0]["executable_sha256"] = json!("a".repeat(64));
        replace(&mut changed, "verified/manifest.json", &manifest, false);
        rebind(&mut changed);
        let records = native_records(&original, &changed, selected).unwrap();
        assert_eq!(
            compose_native_records(&original, &records, selected).unwrap(),
            changed
        );
        assert!(
            compare(&original, &changed).is_err(),
            "platform composition cannot normalize raw tool bytes"
        );
        assert!(compare(&changed, &original).is_err());
        assert_eq!(fixture(), original);
    }

    #[test]
    fn committed_native_profiles_preserve_the_shared_portable_outputs() {
        // Inspect retained source-review records only. Reading another native
        // profile does not execute that architecture or establish SDK acceptance.
        let root = repo_model::repo_root();
        let base = fixture();
        for platform in [platform::Platform::SdkAmd64, platform::Platform::SdkArm64] {
            let records = read(&root.join(platform.directory())).unwrap();
            let composed = read_platform(&root, platform).unwrap();
            assert_eq!(composed.len(), base.len());
            assert_eq!(native_records(&base, &composed, platform).unwrap(), records);
        }
    }

    #[test]
    fn missing_native_records_never_fall_back_to_development_records() {
        let work = tempfile::tempdir().unwrap();
        let base = fixture();
        for (path, bytes) in &base {
            let path = work
                .path()
                .join(platform::Platform::DevelopmentAmd64.directory())
                .join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        assert_eq!(
            read_platform(work.path(), platform::Platform::DevelopmentAmd64).unwrap(),
            base
        );
        for platform in [platform::Platform::SdkAmd64, platform::Platform::SdkArm64] {
            assert!(
                read_platform(work.path(), platform).is_err(),
                "missing {platform:?} records accepted"
            );
        }
    }

    #[test]
    fn golden_comparison_accepts_only_coherent_caller_identity_variation() {
        let original = fixture();
        let mut changed = original.clone();
        let mut lex = value(&changed, "verified/lexlean-attestation.json");
        lex["lexlean"]["executable_sha256"] = json!(content_id(b"fixture caller executable"));
        replace(
            &mut changed,
            "verified/lexlean-attestation.json",
            &lex,
            true,
        );
        rebind(&mut changed);
        assert_ne!(
            original, changed,
            "raw evidence must remain distinguishable"
        );
        assert!(
            comparison(&original).unwrap() == comparison(&changed).unwrap(),
            "authentic caller identity is not a semantic golden difference"
        );
        assert!(current_caller(&original, b"not the verifier binary").is_err());
        current_caller(&changed, b"fixture caller executable").unwrap();
        assert_eq!(
            original,
            fixture(),
            "comparison never edits reviewed raw evidence"
        );
    }

    #[test]
    fn golden_comparison_rejects_coherently_rehashed_semantic_mutations() {
        let original = fixture();
        let baseline = comparison(&original).unwrap();
        for (pointer, replacement) in [
            ("/lexlean/compiler_semantics", json!("a".repeat(64))),
            ("/source_id", json!("a".repeat(64))),
            ("/declarations/0/observed", json!(["sorryAx"])),
            ("/declarations/0/policy/axioms", json!(["sorryAx"])),
            ("/processes/0/executable_sha256", json!("a".repeat(64))),
            ("/processes/0/exit_code", json!(1)),
            ("/processes/0/stdout", json!("substituted process output")),
            ("/host/arch", json!("different-architecture")),
        ] {
            let mut changed = original.clone();
            let mut lex = value(&changed, "verified/lexlean-attestation.json");
            *lex.pointer_mut(pointer).unwrap() = replacement;
            replace(
                &mut changed,
                "verified/lexlean-attestation.json",
                &lex,
                true,
            );
            rebind(&mut changed);
            assert!(
                !comparison(&changed).is_ok_and(|value| value == baseline),
                "accepted coherent semantic mutation {pointer}"
            );
        }
        let mut changed = original.clone();
        changed
            .iter_mut()
            .find(|(path, _)| path.starts_with("source/"))
            .unwrap()
            .1
            .push(b' ');
        rebind(&mut changed);
        assert!(
            compare(&original, &changed)
                .unwrap_err()
                .contains("outside caller identity"),
            "coherently rebound source bytes still require golden review"
        );
        for (pointer, replacement) in [
            ("/processes/0/executable_sha256", json!("a".repeat(64))),
            ("/processes/0/exit_code", json!(1)),
            ("/runtime_roots", json!([])),
            ("/artifacts/executable/sha256", json!("a".repeat(64))),
            ("/artifacts/generated_rust/sha256", json!("a".repeat(64))),
            ("/artifacts/kernel_ir/sha256", json!("a".repeat(64))),
            ("/execution/status", json!("failed")),
        ] {
            let mut changed = original.clone();
            let mut manifest = value(&changed, "verified/manifest.json");
            *manifest.pointer_mut(pointer).unwrap() = replacement;
            replace(&mut changed, "verified/manifest.json", &manifest, false);
            rebind(&mut changed);
            assert!(
                !comparison(&changed).is_ok_and(|value| value == baseline),
                "accepted coherent verification mutation {pointer}"
            );
        }
    }

    #[test]
    fn golden_comparison_rejects_malformed_closures_before_projection() {
        let original = fixture();
        for path in [
            "golden-manifest.json",
            "verified/manifest.json",
            "verified/lexlean-attestation.json",
        ] {
            let mut changed = original.clone();
            let mut record = value(&changed, path);
            record["unreviewed"] = json!(true);
            replace(
                &mut changed,
                path,
                &record,
                path.ends_with("lexlean-attestation.json"),
            );
            rebind(&mut changed);
            assert!(
                comparison(&changed).is_err(),
                "accepted extra field in {path}"
            );
        }
        for mutation in 0..7 {
            let mut changed = original.clone();
            match mutation {
                0 => {
                    changed.pop();
                }
                1 => {
                    changed.push(("unreviewed.json".into(), b"{}".to_vec()));
                    changed.sort_by(|a, b| a.0.cmp(&b.0));
                }
                2 => {
                    let mut row = changed[0].clone();
                    row.0 = "../escape".into();
                    changed.insert(0, row);
                }
                3 => {
                    changed.insert(0, changed[0].clone());
                }
                4 => {
                    changed
                        .iter_mut()
                        .find(|(path, _)| path == "verified/lexlean-attestation.json")
                        .unwrap()
                        .1
                        .push(b' ');
                }
                5 => {
                    changed
                        .iter_mut()
                        .find(|(path, _)| path.starts_with("source/"))
                        .unwrap()
                        .1
                        .push(b' ');
                }
                _ => {
                    let mut lex = value(&changed, "verified/lexlean-attestation.json");
                    lex["lexlean"]["executable_sha256"] = json!("not-a-digest");
                    replace(
                        &mut changed,
                        "verified/lexlean-attestation.json",
                        &lex,
                        true,
                    );
                    rebind(&mut changed);
                }
            }
            assert!(
                comparison(&changed).is_err(),
                "accepted malformed closure {mutation}"
            );
        }
        // Rehashing outer file rows cannot hide an invalid inner attestation ID.
        let mut changed = original.clone();
        let mut lex = value(&changed, "verified/lexlean-attestation.json");
        lex["attestation_id"] = json!("a".repeat(64));
        replace(
            &mut changed,
            "verified/lexlean-attestation.json",
            &lex,
            true,
        );
        let mut golden = value(&changed, "golden-manifest.json");
        for row in golden["files"].as_array_mut().unwrap() {
            if row["path"] == "verified/lexlean-attestation.json" {
                let bytes = &changed
                    .iter()
                    .find(|(path, _)| path == "verified/lexlean-attestation.json")
                    .unwrap()
                    .1;
                row["sha256"] = json!(content_id(bytes));
            }
        }
        replace(&mut changed, "golden-manifest.json", &golden, false);
        assert!(comparison(&changed)
            .unwrap_err()
            .contains("LexLean attestation identity differs"));
    }
}
