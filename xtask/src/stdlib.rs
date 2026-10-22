//! Development-only packaging of the freshly verified standard-library export.

use crate::Fail;
use prismpm::controller::{BuildResult, VerifyRequest, VerifyResult};
use prod_codegen::{CargoPackageSpec, GeneratedPackage};
use sha2::{Digest, Sha256};
use std::path::{Component, Path};

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn regular_file(root: &Path, relative: &Path) -> Result<Vec<u8>, Fail> {
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("stdlib input path must be a confined relative path".into());
    }
    let mut path = root.to_path_buf();
    for part in relative.components() {
        path.push(part);
        if std::fs::symlink_metadata(&path)?.file_type().is_symlink() {
            return Err(format!("stdlib input is a symlink: {}", path.display()).into());
        }
    }
    if !path.is_file() {
        return Err(format!("stdlib input is not a regular file: {}", path.display()).into());
    }
    Ok(std::fs::read(path)?)
}

fn verified_exports(
    root: &Path,
    directory: &Path,
    manifest: &serde_json::Value,
) -> Result<(), Fail> {
    let source = regular_file(root, Path::new("model/stdlib-exports.toml"))?;
    let published = regular_file(root, &directory.join("stdlib-exports.toml"))?;
    if source != published {
        return Err("stdlib export register changed since verification".into());
    }
    let artifact = &manifest["artifacts"]["stdlib_exports"];
    if artifact.get("sha256").and_then(serde_json::Value::as_str) != Some(&sha256(&source))
        || artifact
            .get("byte_length")
            .and_then(serde_json::Value::as_u64)
            != Some(source.len() as u64)
    {
        return Err("stdlib export register disagrees with the verified artifact".into());
    }
    let exports: repo_model::StdlibExports = toml::from_str(std::str::from_utf8(&source)?)?;
    exports.check()?;
    let runtime: repo_model::RuntimeRoots = toml::from_str(std::str::from_utf8(&regular_file(
        root,
        Path::new("model/runtime-roots.toml"),
    )?)?)?;
    if runtime.spec != "prismpm/runtime-roots/1"
        || runtime.lean_module != exports.lean_module
        || runtime.ir_module != exports.ir_module
        || runtime.roots.is_empty()
        || runtime.roots.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err("stdlib runtime root register is invalid".into());
    }
    let union = exports.union_with_runtime(&runtime.roots)?;
    let package_roots = exports
        .export
        .iter()
        .map(|row| row.lean_name.as_str())
        .collect::<Vec<_>>();
    for (field, expected) in [
        ("runtime_roots", serde_json::to_value(&runtime.roots)?),
        ("package_export_roots", serde_json::to_value(package_roots)?),
        ("export_roots", serde_json::to_value(union)?),
    ] {
        if manifest.get(field) != Some(&expected) {
            return Err(
                format!("stdlib verified {field} disagree with the current registers").into(),
            );
        }
    }
    Ok(())
}

fn verified_kernel(
    root: &Path,
    verified: &VerifyResult,
    build: &BuildResult,
) -> Result<Vec<u8>, Fail> {
    if verified.schema != "prismpm/verify-result/1"
        || build.schema != "prismpm/build-result/1"
        || verified.build_id != build.build_id
        || verified.attestation_id.len() != 64
        || !verified
            .attestation_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("stdlib verification is invalid or stale for the current build".into());
    }
    let directory = Path::new(&verified.verified_root);
    if directory.file_name().and_then(|name| name.to_str())
        != Some(verified.attestation_id.as_str())
        || directory
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            != Some("verified")
    {
        return Err("stdlib verified root does not name its attestation".into());
    }
    let manifest_bytes = regular_file(root, &directory.join("manifest.json"))?;
    if sha256(&manifest_bytes) != verified.attestation_id {
        return Err("stdlib verification manifest does not match its attestation".into());
    }
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)?;
    if manifest.get("schema").and_then(serde_json::Value::as_str)
        != Some("prismpm/verification-manifest/2")
        || manifest.get("build_id").and_then(serde_json::Value::as_str)
            != Some(build.build_id.as_str())
    {
        return Err("stdlib verification manifest is not for the current runtime build".into());
    }
    verified_exports(root, directory, &manifest)?;
    let model_bytes = regular_file(root, Path::new(&build.model_path))?;
    let model: serde_json::Value = serde_json::from_slice(&model_bytes)?;
    let model_artifact = &manifest["artifacts"]["model"];
    if model_artifact
        .get("sha256")
        .and_then(serde_json::Value::as_str)
        != Some(&sha256(&model_bytes))
        || model_artifact
            .get("byte_length")
            .and_then(serde_json::Value::as_u64)
            != Some(model_bytes.len() as u64)
        || model
            .pointer("/provenance/semantic_id")
            .and_then(serde_json::Value::as_str)
            != Some(build.semantic_id.as_str())
    {
        return Err("stdlib semantic identity disagrees with the verified model".into());
    }
    let kernel = regular_file(root, &directory.join("kernel.ir"))?;
    let artifact = &manifest["artifacts"]["kernel_ir"];
    if artifact.get("sha256").and_then(serde_json::Value::as_str) != Some(&sha256(&kernel))
        || artifact
            .get("byte_length")
            .and_then(serde_json::Value::as_u64)
            != Some(kernel.len() as u64)
    {
        return Err("stdlib LCNF bytes disagree with the verified artifact".into());
    }
    Ok(kernel)
}

fn metadata(root: &Path, kernel: &[u8]) -> Result<CargoPackageSpec, Fail> {
    let register: repo_model::StdlibPackage = toml::from_str(std::str::from_utf8(&regular_file(
        root,
        Path::new("model/stdlib-package.toml"),
    )?)?)?;
    register.check()?;
    let text = |path: &str| -> Result<String, Fail> {
        Ok(String::from_utf8(regular_file(root, Path::new(path))?)?)
    };
    Ok(CargoPackageSpec {
        name: register.name,
        version: register.version,
        description: register.description,
        repository: register.repository,
        homepage: register.homepage,
        readme: text("stdlib/README.md")?,
        license_mit: text("stdlib/LICENSE-MIT")?,
        license_apache: text("stdlib/LICENSE-APACHE")?,
        input_sha256: sha256(kernel),
        dependencies: Vec::new(),
    })
}

fn generate(kernel: &[u8], spec: &CargoPackageSpec) -> Result<GeneratedPackage, Fail> {
    if spec.input_sha256 != sha256(kernel) {
        return Err("stdlib package metadata does not bind these LCNF bytes".into());
    }
    let (remaining, module) = prod_ir::parser::parse_module(std::str::from_utf8(kernel)?)
        .map_err(|_| "stdlib LCNF is malformed")?;
    if !remaining.trim().is_empty() {
        return Err("stdlib LCNF has trailing syntax".into());
    }
    if module.name != "PrismPM" {
        return Err("stdlib LCNF must name the PrismPM runtime module".into());
    }
    prod_codegen::generate_cargo_package(&module, spec)
        .map_err(|error| format!("stdlib package generation: {error}").into())
}

fn package_files(package: &GeneratedPackage) -> Vec<(String, Vec<u8>)> {
    package
        .files
        .iter()
        .map(|file| (file.path.clone(), file.bytes.clone()))
        .collect()
}

fn update_package(root: &Path, package: &GeneratedPackage, write: bool) -> Result<(), Fail> {
    let parent = root.join("stdlib/generated");
    let destination = parent.join("package");
    // Check the owned parent and any existing tree before moving or reading it.
    for relative in ["stdlib", "stdlib/generated", "stdlib/generated/package"] {
        match std::fs::symlink_metadata(root.join(relative)) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err(
                    format!("stdlib package path is not a regular directory: {relative}").into(),
                );
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    let observed = if destination.exists() {
        crate::tree_files(&destination)?
    } else {
        Vec::new()
    };
    if observed == package_files(package) {
        return Ok(());
    }
    if !write {
        return Err("stdlib package drifted; review `just stdlib-package-write` output".into());
    }
    std::fs::create_dir_all(&parent)?;
    let staging = tempfile::Builder::new()
        .prefix("stdlib-package-")
        .tempdir_in(parent)?;
    let next = staging.path().join("next");
    std::fs::create_dir(&next)?;
    for file in &package.files {
        let path = next.join(&file.path);
        std::fs::create_dir_all(path.parent().ok_or("package file has no parent")?)?;
        std::fs::write(path, &file.bytes)?;
    }
    let previous = staging.path().join("previous");
    if destination.exists() {
        std::fs::rename(&destination, &previous)?;
    }
    if let Err(error) = std::fs::rename(next, &destination) {
        if previous.exists() {
            if let Err(restore) = std::fs::rename(&previous, &destination) {
                let retained = staging.keep();
                return Err(format!(
                    "stdlib publication failed ({error}); rollback failed ({restore}); previous package retained at {}",
                    retained.join("previous").display()
                ).into());
            }
        }
        return Err(error.into());
    }
    Ok(())
}

fn verify_current(root: &Path) -> Result<(BuildResult, VerifyResult), Fail> {
    let controller =
        prismpm::Controller::load(root).map_err(|error| crate::diagnostic_failure(&error))?;
    let before =
        crate::build_on_worker(&controller).map_err(|error| crate::diagnostic_failure(&error))?;
    let verified = controller
        .verify(VerifyRequest { config_path: None })
        .map_err(|error| crate::diagnostic_failure(&error))?;
    let after =
        crate::build_on_worker(&controller).map_err(|error| crate::diagnostic_failure(&error))?;
    current_results(&before, &verified, after)
}

fn current_results(
    before: &BuildResult,
    verified: &VerifyResult,
    after: BuildResult,
) -> Result<(BuildResult, VerifyResult), Fail> {
    if before.build_id != after.build_id
        || verified.build_id != after.build_id
        || before.source_id != after.source_id
        || before.semantic_id != after.semantic_id
    {
        return Err("stdlib source changed during verification".into());
    }
    Ok((after, verified.clone()))
}

fn check_release_binding(root: &Path, build: &BuildResult) -> Result<(), Fail> {
    let spec = metadata(root, &[])?;
    let release: serde_json::Value =
        serde_json::from_slice(&regular_file(root, Path::new("stdlib/release.json"))?)?;
    let fields = release
        .as_object()
        .ok_or("stdlib release must be an object")?;
    let expected_fields = ["crate_path", "crate_sha256", "schema", "semantic_id"];
    let crate_path = format!("stdlib/generated/{}-{}.crate", spec.name, spec.version);
    if fields.len() != expected_fields.len()
        || expected_fields
            .iter()
            .any(|field| !fields.contains_key(*field))
        || release["schema"].as_str() != Some("prismpm/stdlib-release/1")
        || release["semantic_id"].as_str() != Some(build.semantic_id.as_str())
        || release["crate_path"].as_str() != Some(crate_path.as_str())
    {
        return Err(
            "stdlib release metadata does not bind the verified runtime and modeled package".into(),
        );
    }
    let archive = regular_file(root, Path::new(&crate_path))?;
    if release["crate_sha256"].as_str() != Some(&sha256(&archive)) {
        return Err("stdlib release checksum does not bind the committed crate archive".into());
    }
    Ok(())
}

/// Gate the shipped source package and release seal using this run's verification.
/// Reuses only the in-process verification result, then rechecks current sources;
/// no persisted success marker or caller-selected export bypasses verification.
pub fn check_acceptance(root: &Path) -> Result<(), Fail> {
    crate::audit::audit_dependencies(root)?;
    let before = crate::build_once(root)?;
    let verified = crate::verify_once(root)?;
    let current = crate::build_on_worker(&prismpm::Controller::load(root)?)?;
    let (build, verified) = current_results(before, verified, current)?;
    run_verified(root, false, || Ok((build.clone(), verified)))?;
    check_release_binding(root, &build)
}

fn run_verified(
    root: &Path,
    write: bool,
    verify: impl FnOnce() -> Result<(BuildResult, VerifyResult), Fail>,
) -> Result<(), Fail> {
    let (build, verified) = verify()?;
    let kernel = verified_kernel(root, &verified, &build)?;
    let spec = metadata(root, &kernel)?;
    let package = generate(&kernel, &spec)?;
    update_package(root, &package, write)?;
    println!(
        "stdlib-package: {} {} {} from attestation {} (semantic_id {}, input_ir_sha256 {}); crate archive and release metadata unchanged",
        if write { "generated" } else { "checked" },
        spec.name,
        spec.version,
        verified.attestation_id,
        build.semantic_id,
        spec.input_sha256
    );
    Ok(())
}

fn write_mode(arguments: &[String]) -> Result<bool, Fail> {
    match arguments {
        [] => Ok(false),
        [argument] if argument == "--write" => Ok(true),
        _ => Err("usage: cargo xtask stdlib-package [--write]".into()),
    }
}

/// Check or regenerate the source package only after current native verification.
pub fn run(root: &Path, arguments: &[String]) -> Result<(), Fail> {
    let write = write_mode(arguments)?;
    crate::audit::audit_dependencies(root)?;
    run_verified(root, write, || verify_current(root))
}

#[cfg(test)]
mod tests {
    use super::*;

    const IR: &[u8] = b"(module PrismPM (def identity ((value Bool)) Bool value))\n";

    fn copy_fixture_source(source: &Path, destination: &Path) {
        // Earlier gates may have built this fixture. Do not import compiler
        // scratch state into a test that deliberately constructs its own lock.
        for entry in walkdir::WalkDir::new(source)
            .into_iter()
            .filter_entry(|entry| {
                entry.depth() != 1
                    || !matches!(
                        entry.file_name().to_str(),
                        Some(".lexlean" | ".prism" | ".lake")
                    )
            })
        {
            let entry = entry.unwrap();
            let destination = destination.join(entry.path().strip_prefix(source).unwrap());
            if entry.file_type().is_dir() {
                std::fs::create_dir_all(destination).unwrap();
            } else {
                assert!(entry.file_type().is_file());
                std::fs::copy(entry.path(), destination).unwrap();
            }
        }
    }

    #[test]
    fn stdlib_fixture_copy_excludes_only_root_scratch() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        for name in [".lexlean", ".prism", ".lake"] {
            std::fs::create_dir(source.path().join(name)).unwrap();
            std::fs::write(source.path().join(name).join(".lock"), b"stale").unwrap();
            let nested = source.path().join("nested").join(name);
            std::fs::create_dir_all(&nested).unwrap();
            std::fs::write(nested.join("source"), b"authored").unwrap();
        }
        std::fs::write(source.path().join("lexlean.lock"), b"authored lock").unwrap();
        copy_fixture_source(source.path(), destination.path());
        for name in [".lexlean", ".prism", ".lake"] {
            assert!(!destination.path().join(name).exists());
            assert_eq!(
                std::fs::read(destination.path().join("nested").join(name).join("source")).unwrap(),
                b"authored"
            );
        }
        assert_eq!(
            std::fs::read(destination.path().join("lexlean.lock")).unwrap(),
            b"authored lock"
        );
    }

    #[test]
    fn stdlib_package_preserves_real_nested_build_diagnostics() {
        let temporary = tempfile::tempdir().unwrap();
        let source =
            repo_model::repo_root().join("tests/fixtures/holo/ho-10-minimal-model/project");
        copy_fixture_source(&source, temporary.path());
        // A directory cannot be the compiler's lock file. This exercises a
        // real nested build failure without relying on UID-specific permissions.
        std::fs::create_dir_all(temporary.path().join(".lexlean/.lock")).unwrap();
        let error = verify_current(temporary.path()).unwrap_err();
        let diagnostic: serde_json::Value = serde_json::from_str(&error.to_string()).unwrap();
        assert_eq!(diagnostic["code"], "PP4002");
        assert_eq!(diagnostic["causes"][0]["subsystem"], "lexlean");
        assert_eq!(diagnostic["causes"][0]["code"], "LLV7010");
        assert!(diagnostic["causes"][0]["message"]
            .as_str()
            .unwrap()
            .contains(".lexlean/.lock"));
        assert!(!temporary.path().join(".prism/verified").exists());
    }

    fn build() -> BuildResult {
        BuildResult {
            schema: "prismpm/build-result/1".to_owned(),
            build_id: "current".to_owned(),
            semantic_id: "current-semantic".to_owned(),
            source_id: "current-source".to_owned(),
            model_path: ".prism/build/current/model.prism.json".to_owned(),
            manifest_path: ".prism/build/current/manifest.json".to_owned(),
        }
    }

    fn fixture() -> (tempfile::TempDir, VerifyResult) {
        let root = tempfile::tempdir().unwrap();
        let exports_source = include_str!("../../model/stdlib-exports.toml");
        let exports: repo_model::StdlibExports = toml::from_str(exports_source).unwrap();
        let runtime: repo_model::RuntimeRoots =
            toml::from_str(include_str!("../../model/runtime-roots.toml")).unwrap();
        let model = serde_json::to_vec(&serde_json::json!({
            "provenance": {"semantic_id": build().semantic_id}
        }))
        .unwrap();
        let model_path = root.path().join(build().model_path);
        std::fs::create_dir_all(model_path.parent().unwrap()).unwrap();
        std::fs::write(model_path, &model).unwrap();
        let manifest = serde_json::json!({
            "schema": "prismpm/verification-manifest/2",
            "build_id": "current",
            "artifacts": {
                "kernel_ir": {"byte_length": IR.len(), "sha256": sha256(IR)},
                "model": {"byte_length": model.len(), "sha256": sha256(&model)},
                "stdlib_exports": {
                    "byte_length": exports_source.len(),
                    "sha256": sha256(exports_source.as_bytes())
                }
            },
            "export_roots": exports.union_with_runtime(&runtime.roots).unwrap(),
            "package_export_roots": exports.export.iter().map(|row| &row.lean_name).collect::<Vec<_>>(),
            "runtime_roots": runtime.roots
        });
        let manifest = serde_json::to_vec(&manifest).unwrap();
        let attestation_id = sha256(&manifest);
        let verified_root = format!(".prism/verified/{attestation_id}");
        let directory = root.path().join(&verified_root);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("manifest.json"), manifest).unwrap();
        std::fs::write(directory.join("kernel.ir"), IR).unwrap();
        std::fs::write(directory.join("stdlib-exports.toml"), exports_source).unwrap();
        for (path, bytes) in [
            (
                "model/stdlib-package.toml",
                include_bytes!("../../model/stdlib-package.toml").as_slice(),
            ),
            ("model/stdlib-exports.toml", exports_source.as_bytes()),
            (
                "model/runtime-roots.toml",
                include_bytes!("../../model/runtime-roots.toml").as_slice(),
            ),
            ("stdlib/README.md", b"# Readme\r\n".as_slice()),
            ("stdlib/LICENSE-MIT", b"MIT\n".as_slice()),
            ("stdlib/LICENSE-APACHE", b"Apache\n".as_slice()),
            ("LICENSE-MIT", b"Different repository MIT text\n".as_slice()),
            (
                "LICENSE-APACHE",
                b"Different repository Apache text\n".as_slice(),
            ),
        ] {
            let path = root.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        (
            root,
            VerifyResult {
                schema: "prismpm/verify-result/1".to_owned(),
                attestation_id,
                build_id: "current".to_owned(),
                verified_root,
            },
        )
    }

    fn reseal_manifest(
        root: &Path,
        verified: &mut VerifyResult,
        change: impl FnOnce(&mut serde_json::Value),
    ) {
        let previous = root.join(&verified.verified_root);
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(previous.join("manifest.json")).unwrap())
                .unwrap();
        change(&mut manifest);
        let bytes = serde_json::to_vec(&manifest).unwrap();
        verified.attestation_id = sha256(&bytes);
        verified.verified_root = format!(".prism/verified/{}", verified.attestation_id);
        let next = root.join(&verified.verified_root);
        std::fs::rename(previous, &next).unwrap();
        std::fs::write(next.join("manifest.json"), bytes).unwrap();
    }

    #[test]
    fn stdlib_package_rejects_current_or_published_export_register_drift() {
        for published in [false, true] {
            let (root, verified) = fixture();
            let path = root.path().join(if published {
                format!("{}/stdlib-exports.toml", verified.verified_root)
            } else {
                "model/stdlib-exports.toml".to_owned()
            });
            let mut source = std::fs::read(&path).unwrap();
            // The current binary and its embedded verifier register remain
            // unchanged: even a valid comment-only source edit must be rejected.
            source.extend_from_slice(b"\n# changed after verification\n");
            std::fs::write(&path, source).unwrap();
            assert_eq!(
                verified_kernel(root.path(), &verified, &build())
                    .unwrap_err()
                    .to_string(),
                "stdlib export register changed since verification"
            );
            std::fs::remove_file(path).unwrap();
            assert!(verified_kernel(root.path(), &verified, &build()).is_err());
        }
    }

    #[test]
    fn stdlib_package_rejects_resealed_export_artifact_and_root_set_tampering() {
        let (root, mut verified) = fixture();
        reseal_manifest(root.path(), &mut verified, |manifest| {
            manifest["schema"] = "prismpm/verification-manifest/1".into();
        });
        assert_eq!(
            verified_kernel(root.path(), &verified, &build())
                .unwrap_err()
                .to_string(),
            "stdlib verification manifest is not for the current runtime build"
        );
        for field in ["sha256", "byte_length"] {
            let (root, mut verified) = fixture();
            reseal_manifest(root.path(), &mut verified, |manifest| {
                manifest["artifacts"]["stdlib_exports"][field] = if field == "sha256" {
                    "0".repeat(64).into()
                } else {
                    0.into()
                };
            });
            assert_eq!(
                verified_kernel(root.path(), &verified, &build())
                    .unwrap_err()
                    .to_string(),
                "stdlib export register disagrees with the verified artifact"
            );
        }
        for field in ["runtime_roots", "package_export_roots", "export_roots"] {
            for omitted in [false, true] {
                let (root, mut verified) = fixture();
                reseal_manifest(root.path(), &mut verified, |manifest| {
                    if omitted {
                        manifest.as_object_mut().unwrap().remove(field);
                    } else {
                        manifest[field][0] = "PrismPM.Substituted.root".into();
                    }
                });
                assert_eq!(
                    verified_kernel(root.path(), &verified, &build())
                        .unwrap_err()
                        .to_string(),
                    format!("stdlib verified {field} disagree with the current registers")
                );
            }
        }
    }

    #[test]
    fn stdlib_package_rejects_invalid_exports_even_with_resealed_matching_bytes() {
        let (root, mut verified) = fixture();
        let source = include_str!("../../model/stdlib-exports.toml").replace(
            "PrismPM.Foundation.Bytes.appendBytes",
            "PrismPM.Foundation.Bytes.changed",
        );
        for path in [
            "model/stdlib-exports.toml".to_owned(),
            format!("{}/stdlib-exports.toml", verified.verified_root),
        ] {
            std::fs::write(root.path().join(path), &source).unwrap();
        }
        reseal_manifest(root.path(), &mut verified, |manifest| {
            manifest["artifacts"]["stdlib_exports"] = serde_json::json!({
                "byte_length": source.len(), "sha256": sha256(source.as_bytes())
            });
        });
        assert!(verified_kernel(root.path(), &verified, &build())
            .unwrap_err()
            .to_string()
            .contains("invalid standard-library package exports"));
    }

    #[test]
    fn stdlib_package_rejects_runtime_register_changes_after_verification() {
        let (root, verified) = fixture();
        let path = root.path().join("model/runtime-roots.toml");
        let source = std::fs::read_to_string(&path).unwrap().replace(
            "PrismPM.Foundation.Holo.canonicalIndexes",
            "PrismPM.Foundation.Holo.canonicalIndexesChanged",
        );
        std::fs::write(&path, source).unwrap();
        assert_eq!(
            verified_kernel(root.path(), &verified, &build())
                .unwrap_err()
                .to_string(),
            "stdlib verified runtime_roots disagree with the current registers"
        );
        std::fs::remove_file(path).unwrap();
        assert!(verified_kernel(root.path(), &verified, &build()).is_err());
    }

    #[test]
    fn stdlib_package_exact_verified_ir_and_file_hashes() {
        let (root, verified) = fixture();
        let kernel = verified_kernel(root.path(), &verified, &build()).unwrap();
        let spec = metadata(root.path(), &kernel).unwrap();
        let package = generate(&kernel, &spec).unwrap();
        assert_eq!(package, generate(&kernel, &spec).unwrap());
        let manifest: serde_json::Value = serde_json::from_slice(
            &package
                .files
                .iter()
                .find(|file| file.path == "generation-manifest.json")
                .unwrap()
                .bytes,
        )
        .unwrap();
        assert_eq!(manifest["input_ir_sha256"], sha256(IR));
        for record in manifest["files"].as_array().unwrap() {
            let file = package
                .files
                .iter()
                .find(|file| file.path == record["path"].as_str().unwrap())
                .unwrap();
            assert_eq!(record["sha256"], sha256(&file.bytes));
        }
        for (source, output) in [
            ("stdlib/README.md", "README.md"),
            ("stdlib/LICENSE-MIT", "LICENSE-MIT"),
            ("stdlib/LICENSE-APACHE", "LICENSE-APACHE"),
        ] {
            assert_eq!(
                package
                    .files
                    .iter()
                    .find(|file| file.path == output)
                    .unwrap()
                    .bytes,
                std::fs::read(root.path().join(source)).unwrap()
            );
        }
    }

    #[test]
    fn stdlib_package_license_inputs_are_independent_of_repository_licenses() {
        let (root, _) = fixture();
        let package = generate(IR, &metadata(root.path(), IR).unwrap()).unwrap();
        for name in ["LICENSE-MIT", "LICENSE-APACHE"] {
            std::fs::write(root.path().join(name), b"different repository text again").unwrap();
        }
        assert_eq!(
            package,
            generate(IR, &metadata(root.path(), IR).unwrap()).unwrap()
        );
        std::fs::remove_file(root.path().join("stdlib/LICENSE-MIT")).unwrap();
        assert!(
            metadata(root.path(), IR).is_err(),
            "must not fall back to the repository license"
        );
    }

    #[test]
    fn stdlib_package_rejects_stale_tampered_missing_and_escaping_evidence() {
        let (root, mut verified) = fixture();
        let mut stale = build();
        stale.build_id = "other".to_owned();
        assert!(verified_kernel(root.path(), &verified, &stale).is_err());
        let mut wrong_semantic = build();
        wrong_semantic.semantic_id = "other-semantic".to_owned();
        assert!(verified_kernel(root.path(), &verified, &wrong_semantic).is_err());
        let path = root.path().join(&verified.verified_root).join("kernel.ir");
        std::fs::write(&path, b"tampered").unwrap();
        assert!(verified_kernel(root.path(), &verified, &build()).is_err());
        std::fs::remove_file(path).unwrap();
        assert!(verified_kernel(root.path(), &verified, &build()).is_err());
        verified.verified_root = format!("../verified/{}", verified.attestation_id);
        assert!(verified_kernel(root.path(), &verified, &build()).is_err());
        let (root, verified) = fixture();
        std::fs::write(
            root.path()
                .join(&verified.verified_root)
                .join("manifest.json"),
            b"{}",
        )
        .unwrap();
        assert!(verified_kernel(root.path(), &verified, &build()).is_err());
    }

    #[test]
    fn stdlib_package_rejects_malformed_trailing_and_wrong_module_ir() {
        let (root, _) = fixture();
        for (kernel, expected) in [
            (b"malformed".as_slice(), "malformed"),
            (
                b"(module PrismPM (def identity ((value Bool)) Bool value)) trailing".as_slice(),
                "trailing syntax",
            ),
            (
                b"(module Other (def identity ((value Bool)) Bool value))".as_slice(),
                "PrismPM runtime module",
            ),
        ] {
            let spec = metadata(root.path(), kernel).unwrap();
            let error = generate(kernel, &spec).unwrap_err().to_string();
            assert!(error.contains(expected), "expected {expected}, got {error}");
        }
        let mut spec = metadata(root.path(), IR).unwrap();
        spec.input_sha256 = "0".repeat(64);
        assert!(generate(IR, &spec).is_err());
    }

    #[test]
    fn stdlib_package_arguments_cannot_select_unverified_inputs() {
        assert!(!write_mode(&[]).unwrap());
        assert!(write_mode(&["--write".to_owned()]).unwrap());
        for arguments in [
            vec!["--skip-verify"],
            vec!["--from", "old/kernel.ir"],
            vec!["--write", "--write"],
        ] {
            assert!(
                write_mode(&arguments.into_iter().map(str::to_owned).collect::<Vec<_>>()).is_err()
            );
        }
    }

    #[test]
    fn stdlib_package_rejects_changed_pinned_compiler_before_verification() {
        let (root, _) = fixture();
        let pinned = b"pinned dependency bytes";
        let mut register = String::from("spec = \"prismpm/dependencies/1\"\n");
        for id in ["lean4-prod", "lexlean", "hologram-live", "uor-hologram"] {
            let source = if id == "uor-hologram" {
                "git"
            } else {
                "vendored"
            };
            register.push_str(&format!(
                "\n[[dependency]]\nid = {id:?}\nrevision = {:?}\nsource = {source:?}\n",
                "1".repeat(40)
            ));
            if matches!(id, "hologram-live" | "uor-hologram") {
                register.push_str("role = \"validation-oracle\"\n");
            }
            if source == "vendored" {
                let relative = format!("vendor/{id}/source.tar");
                let path = root.path().join(&relative);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, pinned).unwrap();
                register.push_str(&format!(
                    "\n[[dependency.artifact]]\nkind = \"file\"\npath = {relative:?}\nsha256 = {:?}\n",
                    sha256(pinned)
                ));
            }
        }
        std::fs::write(root.path().join("model/dependencies.toml"), register).unwrap();
        crate::audit::audit_dependencies(root.path()).unwrap();
        std::fs::write(
            root.path().join("vendor/lean4-prod/source.tar"),
            b"changed compiler",
        )
        .unwrap();
        let expected = "vendored artifact checksum drifted for vendor/lean4-prod/source.tar";
        assert_eq!(
            run(root.path(), &["--write".to_owned()])
                .unwrap_err()
                .to_string(),
            expected
        );
        assert_eq!(
            check_acceptance(root.path()).unwrap_err().to_string(),
            expected
        );
        assert!(!root.path().join("stdlib/generated").exists());
    }

    #[test]
    fn stdlib_package_shared_verification_rechecks_current_source_identity() {
        let (_, verified) = fixture();
        assert!(current_results(&build(), &verified, build()).is_ok());
        for field in ["build", "source", "semantic"] {
            let mut changed = build();
            match field {
                "build" => changed.build_id = "changed".to_owned(),
                "source" => changed.source_id = "changed".to_owned(),
                "semantic" => changed.semantic_id = "changed".to_owned(),
                _ => unreachable!(),
            }
            assert!(current_results(&build(), &verified, changed).is_err());
        }
        let mut stale = verified;
        stale.build_id = "old-build".to_owned();
        assert!(current_results(&build(), &stale, build()).is_err());
    }

    #[test]
    fn stdlib_package_acceptance_binds_release_semantics_metadata_and_archive() {
        let (root, _) = fixture();
        let archive = b"exact archive bytes";
        let crate_path = "stdlib/generated/prism-stdlib-0.2.0.crate";
        std::fs::create_dir_all(root.path().join("stdlib/generated")).unwrap();
        std::fs::write(root.path().join(crate_path), archive).unwrap();
        let release = serde_json::json!({
            "schema": "prismpm/stdlib-release/1",
            "crate_path": crate_path,
            "crate_sha256": sha256(archive),
            "semantic_id": build().semantic_id
        });
        let write_release = |value: &serde_json::Value| {
            std::fs::write(
                root.path().join("stdlib/release.json"),
                serde_json::to_vec(value).unwrap(),
            )
            .unwrap();
        };
        write_release(&release);
        check_release_binding(root.path(), &build()).unwrap();
        for (key, value) in [
            ("semantic_id", "old"),
            ("crate_path", "../foreign.crate"),
            ("crate_sha256", "wrong"),
            ("schema", "other/1"),
            ("unknown", "field"),
        ] {
            let mut changed = release.clone();
            changed[key] = value.into();
            write_release(&changed);
            assert!(
                check_release_binding(root.path(), &build()).is_err(),
                "accepted modified {key}"
            );
        }
        write_release(&release);
        std::fs::write(root.path().join(crate_path), b"different archive").unwrap();
        assert!(check_release_binding(root.path(), &build()).is_err());
    }

    #[test]
    fn stdlib_package_check_is_read_only_and_write_replaces_only_package() {
        let (root, _) = fixture();
        let package = generate(IR, &metadata(root.path(), IR).unwrap()).unwrap();
        assert!(update_package(root.path(), &package, false).is_err());
        assert!(!root.path().join("stdlib/generated").exists());
        update_package(root.path(), &package, true).unwrap();
        update_package(root.path(), &package, false).unwrap();
        let stale = root.path().join("stdlib/generated/package/stale.txt");
        std::fs::write(&stale, b"stale").unwrap();
        let archive = root
            .path()
            .join("stdlib/generated/prism-stdlib-0.2.0.crate");
        std::fs::write(&archive, b"existing archive").unwrap();
        assert!(update_package(root.path(), &package, false).is_err());
        assert!(stale.exists());
        update_package(root.path(), &package, true).unwrap();
        assert!(!stale.exists());
        assert_eq!(std::fs::read(archive).unwrap(), b"existing archive");
        update_package(root.path(), &package, false).unwrap();
    }

    #[test]
    fn stdlib_package_failed_verification_never_changes_existing_output() {
        let (root, _) = fixture();
        let package = generate(IR, &metadata(root.path(), IR).unwrap()).unwrap();
        update_package(root.path(), &package, true).unwrap();
        let before = crate::tree_files(&root.path().join("stdlib/generated/package")).unwrap();
        assert!(run_verified(root.path(), true, || Err(
            "native verification failed".into()
        ))
        .is_err());
        assert_eq!(
            before,
            crate::tree_files(&root.path().join("stdlib/generated/package")).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn stdlib_package_rejects_symlinked_evidence_and_destination() {
        let (root, verified) = fixture();
        let file = root.path().join(&verified.verified_root).join("kernel.ir");
        std::fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink(root.path().join("LICENSE-MIT"), &file).unwrap();
        assert!(verified_kernel(root.path(), &verified, &build()).is_err());
        let package = generate(IR, &metadata(root.path(), IR).unwrap()).unwrap();
        std::fs::create_dir_all(root.path().join("stdlib/generated")).unwrap();
        std::os::unix::fs::symlink(
            root.path().join("model"),
            root.path().join("stdlib/generated/package"),
        )
        .unwrap();
        assert!(update_package(root.path(), &package, true).is_err());
        assert!(root.path().join("model/stdlib-package.toml").exists());
    }
}
