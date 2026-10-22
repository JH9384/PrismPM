//! Repository audits for PrismPM.

use crate::Fail;
use repo_model::Model;
use sha2::Digest;
use std::collections::BTreeSet;
use std::path::Path;

/// Bind the shipped standards lock to the live embedded authority catalog.
/// This compares exact bytes without refreshing, writing, or executing oracles.
pub fn audit_shipped_standards_lock(root: &Path) -> Result<(), Fail> {
    prismpm::authority::resolve(root, true)
        .map_err(|error| format!("shipped standards.lock: {}: {}", error.code, error.message))?;
    Ok(())
}

#[cfg(test)]
mod shipped_standards_lock_tests {
    use super::audit_shipped_standards_lock;
    use repo_conformance::golden::platform::Platform;

    #[test]
    fn shipped_standards_lock_matches_live_catalog_and_rejects_drift_without_writes() {
        let source = repo_model::repo_root();
        let original = std::fs::read(source.join("standards.lock")).unwrap();
        audit_shipped_standards_lock(&source).unwrap();
        assert_eq!(
            std::fs::read(source.join("standards.lock")).unwrap(),
            original
        );

        let work = tempfile::tempdir().unwrap();
        for platform in [
            Platform::DevelopmentAmd64,
            Platform::SdkAmd64,
            Platform::SdkArm64,
        ] {
            for (relative, bytes) in crate::tree_files(&source.join(platform.directory())).unwrap()
            {
                let path = work.path().join(platform.directory()).join(relative);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, bytes).unwrap();
            }
        }
        let path = work.path().join("standards.lock");
        assert!(audit_shipped_standards_lock(work.path())
            .unwrap_err()
            .to_string()
            .contains("PP1101"));
        assert!(!path.exists(), "locked admission created a missing lock");
        assert!(crate::audit_all(work.path())
            .unwrap_err()
            .to_string()
            .starts_with("shipped standards.lock: PP1101:"));
        assert!(!path.exists(), "source audit created a missing lock");
        std::fs::write(&path, &original).unwrap();
        audit_shipped_standards_lock(work.path()).unwrap();
        for mutation in ["wrapper", "catalog", "noncanonical", "malformed"] {
            let mut value: serde_json::Value = serde_json::from_slice(&original).unwrap();
            match mutation {
                "wrapper" => {
                    value["oracles"][0]["wrapper_sha256"] = "0".repeat(64).into();
                }
                "catalog" => {
                    value["authorities"].as_array_mut().unwrap().pop();
                }
                "noncanonical" | "malformed" => {}
                _ => unreachable!(),
            }
            // A self-consistent lock is not authority for a different catalog.
            value.as_object_mut().unwrap().remove("lock_id");
            value["lock_id"] = format!(
                "sha256:{}",
                prismpm::holo::canonical::content_id(
                    &prismpm::holo::canonical::encode_value(&value).unwrap()
                )
            )
            .into();
            let bytes = match mutation {
                "wrapper" | "catalog" => prismpm::contracts::CanonicalDocument::from_value(
                    "prismpm/standards-lock/1",
                    value,
                )
                .unwrap()
                .bytes()
                .to_vec(),
                "noncanonical" => serde_json::to_vec_pretty(&value).unwrap(),
                "malformed" => b"{invalid}\n".to_vec(),
                _ => unreachable!(),
            };
            std::fs::write(&path, &bytes).unwrap();
            assert!(audit_shipped_standards_lock(work.path())
                .unwrap_err()
                .to_string()
                .contains("PP1101"));
            // This fixture intentionally has no Node suites: losing the early
            // admission must not turn their missing-input failure into a pass.
            assert!(crate::audit_all(work.path())
                .unwrap_err()
                .to_string()
                .starts_with("shipped standards.lock: PP1101:"));
            assert_eq!(
                std::fs::read(&path).unwrap(),
                bytes,
                "{mutation}: lock rewritten"
            );
        }
    }
}

/// Reject inconsistent retained native records before expensive execution.
/// This is source-review consistency, not fresh kernel or native execution.
pub fn audit_retained_native_profiles(root: &Path) -> Result<(), Fail> {
    use repo_conformance::golden::{self, platform::Platform};
    let base = golden::read(&root.join(Platform::DevelopmentAmd64.directory()))?;
    for platform in [Platform::SdkAmd64, Platform::SdkArm64] {
        let directory = platform.directory();
        let records = golden::read(&root.join(directory))
            .map_err(|error| format!("retained native profile {directory}: {error}"))?;
        golden::compose_native_records(&base, &records, platform)
            .map_err(|error| format!("retained native profile {directory}: {error}"))?;
    }
    Ok(())
}
const LEXLEAN_AUTHORITY_REVISION: &str = "0865df4e540ca643b090a29e9df6d319d6906da6";
const LEXLEAN_AUTHORITY_SOURCES: [&str; 18] = [
    "language/lcnf-1.2/extract.lean",
    "language/preservation-1.2/library/LexLeanPreservation/Compose.lean",
    "language/preservation-1.2/library/LexLeanPreservation/Core.lean",
    "language/preservation-1.2/library/LexLeanPreservation/Fixed.lean",
    "language/preservation-1.2/library/LexLeanPreservation/Keys.lean",
    "language/preservation-1.2/library/LexLeanPreservation/Primitives.lean",
    "language/preservation-1.2/library/LexLeanPreservation/RustBase.lean",
    "language/preservation-1.2/library/LexLeanPreservation/RustCorr.lean",
    "language/preservation-1.2/library/LexLeanPreservation/RustLemmas.lean",
    "language/preservation-1.2/library/LexLeanPreservation/RustMatches.lean",
    "language/preservation-1.2/library/LexLeanPreservation/RustSound.lean",
    "language/preservation-1.2/library/LexLeanPreservation/Templates.lean",
    "language/preservation-1.2/library/LexLeanPreservation/Validate.lean",
    "language/preservation-1.2/library/LexLeanPreservation/Values.lean",
    "language/preservation-1.2/modules/LexLeanTarget/RustSemantics.lean",
    "language/preservation-1.2/modules/LexLeanTarget/RustSyntax.lean",
    "language/preservation-1.2/modules/LexLeanTarget/TargetSemantics.lean",
    "language/preservation-1.2/modules/LexLeanTarget/TargetSyntax.lean",
];

/// Audit that no handwritten .lean or lakefile.lean exists in source paths.
pub fn audit_no_handwritten_lean(root: &Path) -> Result<(), Fail> {
    let golden_root = root.join("tests/golden/stdlib");
    let mut allowed = std::collections::BTreeSet::new();
    if root.join("vendor/lexlean").exists() {
        // These are the selected dependency's closed compiler authorities,
        // never PrismPM-authored models or an exemption for its entire tree.
        audit_lexlean_adapter_provenance(root)?;
        for relative in LEXLEAN_AUTHORITY_SOURCES {
            allowed.insert(root.join("vendor/lexlean").join(relative));
        }
    }
    let golden_manifest = golden_root.join("golden-manifest.json");
    if golden_manifest.is_file() {
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&golden_manifest)?)?;
        let compiler = value
            .get("compiler_semantics_id")
            .and_then(serde_json::Value::as_str)
            .ok_or("golden manifest lacks compiler_semantics_id")?;
        if compiler.len() != 64 || !compiler.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("golden manifest has an invalid compiler_semantics_id".into());
        }
        let generated = value
            .get("generated_lean")
            .and_then(serde_json::Value::as_array)
            .ok_or("golden manifest lacks generated_lean")?;
        if generated.is_empty() {
            return Err("golden manifest attests no generated Lean".into());
        }
        for row in generated {
            let relative = row
                .get("path")
                .and_then(serde_json::Value::as_str)
                .ok_or("golden Lean row lacks path")?;
            let source_relative = row
                .get("source_path")
                .and_then(serde_json::Value::as_str)
                .ok_or("golden Lean row lacks source_path")?;
            let expected = row
                .get("sha256")
                .and_then(serde_json::Value::as_str)
                .ok_or("golden Lean row lacks sha256")?;
            let source_expected = row
                .get("source_sha256")
                .and_then(serde_json::Value::as_str)
                .ok_or("golden Lean row lacks source_sha256")?;
            if !relative.starts_with("build/lexlean/build/modules/")
                || !relative.ends_with(".lean")
                || !source_relative.starts_with("source/")
                || !source_relative.ends_with(".lex.tex")
            {
                return Err(format!("invalid generated Lean golden mapping {relative}").into());
            }
            let path = golden_root.join(relative);
            let source = golden_root.join(source_relative);
            let actual = format!("{:x}", sha2::Sha256::digest(std::fs::read(&path)?));
            let source_actual = format!("{:x}", sha2::Sha256::digest(std::fs::read(&source)?));
            if actual != expected || source_actual != source_expected {
                return Err(
                    format!("generated Lean golden mapping is stale for {relative}").into(),
                );
            }
            if !allowed.insert(path) {
                return Err(format!("duplicate generated Lean golden path {relative}").into());
            }
        }
    }
    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0
                || !entry.file_type().is_dir()
                || !matches!(
                    entry.file_name().to_str(),
                    Some(".prism" | ".lexlean" | ".git" | "target" | "node_modules")
                )
        })
    {
        let entry = entry?;
        let path = entry.path();
        let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy();
        if Path::new(rel.as_ref()).components().any(|component| {
            matches!(
                component.as_os_str().to_str(),
                Some(".prism" | ".lexlean" | ".git" | "target" | "node_modules")
            )
        }) {
            continue;
        }
        if !entry.file_type().is_file() {
            if rel.ends_with(".lean") || rel.ends_with(".ir") || rel.ends_with("/generated.rs") {
                return Err(format!(
                    "no-handwritten-lean audit failed: nonregular source {}",
                    path.display()
                )
                .into());
            }
            continue;
        }
        if rel.ends_with(".lean") && !allowed.contains(path) {
            return Err(
                format!("no-handwritten-lean audit failed: found {}", path.display()).into(),
            );
        }
        if rel.ends_with("lakefile.lean") {
            return Err(
                format!("no-handwritten-lean audit failed: found {}", path.display()).into(),
            );
        }
        if rel.ends_with(".ir") {
            let vendor_root = root.join("vendor/lean4-prod/rust");
            if let Ok(vendor_relative) = path.strip_prefix(&vendor_root) {
                let digest = format!("{:x}", sha2::Sha256::digest(std::fs::read(path)?));
                let manifest = std::fs::read_to_string(vendor_root.join("MANIFEST.sha256"))?;
                let row = format!(
                    "{digest}  {}",
                    vendor_relative.to_string_lossy().replace('\\', "/")
                );
                if manifest.lines().any(|line| line == row) {
                    continue;
                }
                return Err(
                    format!(
                        "generated-output audit failed: vendored generated fixture {rel} is not hash-pinned"
                    )
                    .into(),
                );
            }
            return Err(format!(
                "generated-output audit failed: source tree contains {rel}; retain its normalized hash record instead"
            )
            .into());
        }
        if rel.ends_with("/generated.rs") {
            return Err(format!(
                "generated-output audit failed: source tree contains {rel}; retain its normalized hash record instead"
            )
            .into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod retained_native_tests {
    use super::audit_retained_native_profiles;
    use repo_conformance::golden::platform::Platform;

    #[test]
    fn retained_native_admission_is_first_and_rejects_each_platform_fault() {
        let source = repo_model::repo_root();
        let work = tempfile::tempdir().unwrap();
        for platform in [
            Platform::DevelopmentAmd64,
            Platform::SdkAmd64,
            Platform::SdkArm64,
        ] {
            for (relative, bytes) in crate::tree_files(&source.join(platform.directory())).unwrap()
            {
                let path = work.path().join(platform.directory()).join(relative);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, bytes).unwrap();
            }
        }
        audit_retained_native_profiles(work.path()).unwrap();
        for (platform, other) in [
            (Platform::SdkAmd64, Platform::SdkArm64),
            (Platform::SdkArm64, Platform::SdkAmd64),
        ] {
            let directory = work.path().join(platform.directory());
            let original = crate::tree_files(&directory).unwrap();
            for mutation in ["missing", "extra", "changed", "other-platform"] {
                let manifest = directory.join("golden-manifest.json");
                let extra = directory.join("unreviewed.json");
                match mutation {
                    "missing" => std::fs::remove_file(&manifest).unwrap(),
                    "extra" => std::fs::write(&extra, b"{}\n").unwrap(),
                    "changed" => {
                        let mut value: serde_json::Value =
                            serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
                        value["schema"] = "unreviewed".into();
                        std::fs::write(&manifest, serde_json::to_vec(&value).unwrap()).unwrap();
                    }
                    "other-platform" => {
                        for (relative, bytes) in
                            crate::tree_files(&source.join(other.directory())).unwrap()
                        {
                            std::fs::write(directory.join(relative), bytes).unwrap();
                        }
                    }
                    _ => unreachable!(),
                }
                // This fixture has no Node suites: if ordering regresses,
                // their missing-input failure must not masquerade as this audit.
                let error = crate::audit_all(work.path()).unwrap_err().to_string();
                assert!(
                    error.starts_with(&format!(
                        "retained native profile {}:",
                        platform.directory()
                    )),
                    "{mutation}: {error}"
                );
                if extra.exists() {
                    std::fs::remove_file(extra).unwrap();
                }
                for (relative, bytes) in &original {
                    std::fs::write(directory.join(relative), bytes).unwrap();
                }
                audit_retained_native_profiles(work.path()).unwrap();
            }
        }
        let artifact = work
            .path()
            .join(Platform::DevelopmentAmd64.directory())
            .join("build/model.prism.json");
        let original = std::fs::read(&artifact).unwrap();
        std::fs::write(&artifact, b"{}\n").unwrap();
        assert!(crate::audit_all(work.path())
            .unwrap_err()
            .to_string()
            .contains("golden file descriptor differs from its bytes"));
        std::fs::write(artifact, original).unwrap();
        audit_retained_native_profiles(work.path()).unwrap();
    }
}

fn audit_lexlean_adapter_provenance(root: &Path) -> Result<(), Fail> {
    for directory in [
        root.to_path_buf(),
        root.join("vendor"),
        root.join("vendor/lexlean"),
    ] {
        let metadata = std::fs::symlink_metadata(&directory)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(format!(
                "LexLean extraction adapter has a non-directory or symlink ancestor: {}",
                directory.display()
            )
            .into());
        }
    }
    audit_dependencies(root)?;
    let register: toml::Value = toml::from_str(&std::fs::read_to_string(
        root.join("model/dependencies.toml"),
    )?)?;
    let dependency = register
        .get("dependency")
        .and_then(toml::Value::as_array)
        .and_then(|rows| {
            rows.iter()
                .find(|row| row.get("id").and_then(toml::Value::as_str) == Some("lexlean"))
        })
        .ok_or("LexLean extraction adapter lacks its dependency registration")?;
    let version = dependency
        .get("version")
        .and_then(toml::Value::as_str)
        .ok_or("LexLean extraction adapter lacks its package version")?;
    let archive = format!("vendor/lexlean/lexlean-{version}.crate");
    let has_archive = dependency
        .get("artifact")
        .and_then(toml::Value::as_array)
        .is_some_and(|rows| {
            rows.iter().any(|row| {
                row.get("kind").and_then(toml::Value::as_str) == Some("file")
                    && row.get("path").and_then(toml::Value::as_str) == Some(archive.as_str())
            })
        });
    let has_tree = dependency
        .get("artifact")
        .and_then(toml::Value::as_array)
        .is_some_and(|rows| {
            rows.iter().any(|row| {
                row.get("kind").and_then(toml::Value::as_str) == Some("tree-manifest")
                    && row.get("path").and_then(toml::Value::as_str)
                        == Some("vendor/lexlean/MANIFEST.sha256")
                    && row.get("tree_root").and_then(toml::Value::as_str) == Some("vendor/lexlean")
            })
        });
    if !has_tree || !has_archive {
        return Err("LexLean extraction adapter lacks its closed package tree".into());
    }
    let provenance: serde_json::Value = serde_json::from_slice(&std::fs::read(
        root.join("vendor/lexlean/.cargo_vcs_info.json"),
    )?)?;
    if provenance["git"]["sha1"].as_str()
        != dependency.get("revision").and_then(toml::Value::as_str)
        || dependency.get("revision").and_then(toml::Value::as_str)
            != Some(LEXLEAN_AUTHORITY_REVISION)
        || version != "0.3.0"
        || provenance["path_in_vcs"] != "crates/lexlean"
        || provenance["git"]
            .get("dirty")
            .is_some_and(|dirty| dirty.as_bool() != Some(false))
    {
        return Err(
            "LexLean extraction adapter package provenance differs from its revision".into(),
        );
    }
    let archive_sha = dependency["artifact"]
        .as_array()
        .and_then(|rows| {
            rows.iter()
                .find(|row| row["path"].as_str() == Some(&archive))
        })
        .and_then(|row| row.get("sha256"))
        .and_then(toml::Value::as_str)
        .ok_or("LexLean authority archive checksum is absent")?;
    audit_lexlean_authority_archive(root, &archive, archive_sha, version)
}

fn audit_lexlean_authority_archive(
    root: &Path,
    archive_path: &str,
    expected_sha: &str,
    version: &str,
) -> Result<(), Fail> {
    use std::io::Read;
    const COMPRESSED: u64 = 32 * 1024 * 1024;
    const EXPANDED: u64 = 128 * 1024 * 1024;
    const MEMBER: u64 = 32 * 1024 * 1024;
    let mut raw = Vec::new();
    std::fs::File::open(root.join(archive_path))?
        .take(COMPRESSED + 1)
        .read_to_end(&mut raw)?;
    if raw.len() as u64 > COMPRESSED || format!("{:x}", sha2::Sha256::digest(&raw)) != expected_sha
    {
        return Err(
            "LexLean authority archive bytes exceed their bound or registered checksum".into(),
        );
    }
    let prefix = format!("lexlean-{version}/");
    let expected = LEXLEAN_AUTHORITY_SOURCES
        .into_iter()
        .collect::<BTreeSet<_>>();
    let tree = root.join("vendor/lexlean");
    let archive_name = format!("lexlean-{version}.crate");
    // The normal package writer adds only these two root-level files after
    // extraction. Every other tree file must be a byte-identical crate member.
    let mut manifest_bytes = Vec::new();
    std::fs::File::open(tree.join("MANIFEST.sha256"))?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut manifest_bytes)?;
    if manifest_bytes.len() > 1024 * 1024 {
        return Err("LexLean package tree manifest exceeds its bound".into());
    }
    let manifest = std::str::from_utf8(&manifest_bytes)?;
    if !manifest.ends_with('\n') || manifest.contains('\r') {
        return Err("LexLean package tree manifest is not canonical text".into());
    }
    let mut declared = std::collections::BTreeMap::new();
    for line in manifest.lines() {
        let (digest, relative) = line
            .split_once("  ")
            .ok_or("LexLean package tree manifest has a malformed row")?;
        if declared.len() >= 4096
            || digest.len() != 64
            || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            || relative.len() > 4096
            || relative.contains('\\')
            || relative.split('/').count() > 128
            || relative
                .split('/')
                .any(|part| matches!(part, "" | "." | ".."))
            || relative == "MANIFEST.sha256"
            || declared
                .insert(relative.to_owned(), digest.to_owned())
                .is_some()
        {
            return Err("LexLean package tree manifest has an invalid or duplicate row".into());
        }
    }
    if declared.remove(&archive_name).is_none() {
        return Err("LexLean package tree manifest omits its owning archive".into());
    }
    let mut tree_names = BTreeSet::new();
    for (index, entry) in walkdir::WalkDir::new(&tree)
        .min_depth(1)
        .into_iter()
        .enumerate()
    {
        let entry = entry?;
        if index >= 8192 || entry.depth() > 128 || entry.file_type().is_symlink() {
            return Err("LexLean package tree exceeds its bounds or contains an alias".into());
        }
        if entry.file_type().is_dir() {
            continue;
        }
        if !entry.file_type().is_file() || entry.metadata()?.len() > MEMBER {
            return Err("LexLean package tree contains a nonregular or oversized file".into());
        }
        let relative = entry
            .path()
            .strip_prefix(&tree)?
            .to_str()
            .ok_or("LexLean package tree path is not UTF-8")?;
        if !matches!(relative, "MANIFEST.sha256") && relative != archive_name {
            tree_names.insert(relative.to_owned());
        }
    }
    if tree_names != declared.keys().cloned().collect() {
        return Err("LexLean package tree membership differs from its complete manifest".into());
    }
    let mut names = BTreeSet::new();
    let mut package_names = BTreeSet::new();
    let mut sources = BTreeSet::new();
    let mut total = 0_u64;
    let mut vcs_seen = false;
    let decoder = flate2::bufread::GzDecoder::new(raw.as_slice());
    let mut bounded = decoder.take(EXPANDED + 1);
    let mut expanded = Vec::new();
    bounded.read_to_end(&mut expanded)?;
    if expanded.len() as u64 > EXPANDED || !bounded.into_inner().get_ref().is_empty() {
        return Err("LexLean authority archive exceeds its bound or has trailing gzip data".into());
    }
    // Admit physical extents before tar may buffer GNU long-name metadata.
    // Memory is explicitly bounded, not claimed to be constant-streaming.
    let mut offset = 0_usize;
    let mut headers = 0_usize;
    loop {
        let header_bytes = expanded
            .get(offset..offset + 512)
            .ok_or("LexLean archive has a truncated tar header")?;
        if header_bytes.iter().all(|byte| *byte == 0) {
            if expanded.len() - offset < 1024 || expanded[offset..].iter().any(|byte| *byte != 0) {
                return Err("LexLean authority archive has invalid terminal tar padding".into());
            }
            break;
        }
        let header = tar::Header::from_byte_slice(header_bytes);
        headers += 1;
        let size = header.entry_size()?;
        if headers > 8192
            || size > MEMBER
            || !(header.entry_type().is_file() || header.entry_type().is_gnu_longname())
        {
            return Err(
                "LexLean archive has unsupported or oversized physical tar metadata".into(),
            );
        }
        let padded = usize::try_from(size.div_ceil(512) * 512)?;
        offset = offset
            .checked_add(512)
            .and_then(|n| n.checked_add(padded))
            .ok_or("LexLean tar extent overflow")?;
        if offset > expanded.len() {
            return Err("LexLean archive has a truncated tar member".into());
        }
    }
    {
        let mut archive = tar::Archive::new(expanded.as_slice());
        for entry in archive.entries()? {
            let mut entry = entry?;
            let path_bytes = entry.path_bytes().into_owned();
            let name = std::str::from_utf8(&path_bytes)?;
            if names.len() >= 4096
                || !entry.header().entry_type().is_file()
                || entry.size() > MEMBER
                || name.len() > 4096
                || name.split('/').count() > 128
                || name.contains('\\')
                || name.split('/').any(|part| matches!(part, "" | "." | ".."))
                || !names.insert(name.to_owned())
            {
                return Err(
                    "LexLean authority archive has an invalid, duplicate or oversized member"
                        .into(),
                );
            }
            let relative = name
                .strip_prefix(&prefix)
                .ok_or("LexLean archive has a foreign package root")?;
            total = total
                .checked_add(entry.size())
                .ok_or("LexLean archive size overflow")?;
            if total > EXPANDED {
                return Err("LexLean authority archive exceeds its expanded bound".into());
            }
            if relative.ends_with(".lean") && !expected.contains(relative) {
                return Err(format!(
                    "no-handwritten-lean audit failed: unregistered package source {relative}"
                )
                .into());
            }
            let digest = declared.get(relative).ok_or_else(|| {
                format!(
                    "LexLean archive member is absent from its complete tree manifest: {relative}"
                )
            })?;
            package_names.insert(relative.to_owned());
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;
            let source = tree.join(relative);
            let metadata = std::fs::symlink_metadata(&source)?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() != bytes.len() as u64
            {
                return Err(format!("LexLean authority archive member differs from its regular tree source {relative}").into());
            }
            let mut actual = Vec::new();
            std::fs::File::open(source)?
                .take(MEMBER + 1)
                .read_to_end(&mut actual)?;
            if actual != bytes || format!("{:x}", sha2::Sha256::digest(&bytes)) != *digest {
                return Err(format!(
                    "LexLean authority archive bytes differ from tree source {relative}"
                )
                .into());
            }
            if relative == ".cargo_vcs_info.json" {
                vcs_seen = true;
            } else if relative.ends_with(".lean") {
                sources.insert(relative.to_owned());
            }
        }
    }
    if package_names != tree_names {
        return Err("LexLean archive membership differs from its complete extracted tree".into());
    }
    if !vcs_seen || sources != expected.into_iter().map(str::to_owned).collect() {
        return Err("LexLean authority archive does not contain the exact selected 18-source closure and VCS identity".into());
    }
    Ok(())
}

/// Audit the generated-Lean-only formal contract at its LexLean source.
///
/// This is deliberately structural: LexLean and Lean establish typing and
/// proofs, while this gate prevents the registered validator theorems from
/// drifting into vacuous statements or undeclared axiom policies.
pub fn audit_formal_contract(root: &Path) -> Result<(), Fail> {
    if std::fs::read(root.join("crates/prismpm/src/prod_alloc_counter.rs.inc"))?
        != std::fs::read(root.join("vendor/lean4-prod/rust/prod-alloc-counter/src/lib.rs"))?
    {
        return Err("embedded allocation counter differs from the pinned upstream source".into());
    }
    let path = root.join("stdlib/src/Foundation/Holo.lex.tex");
    let source = std::fs::read_to_string(&path)?;
    let payload = source
        .lines()
        .find_map(|line| {
            line.strip_prefix("\\semanticdata{")
                .and_then(|value| value.strip_suffix('}'))
        })
        .ok_or("Foundation.Holo has no semantic module payload")?;
    let value: serde_json::Value = serde_json::from_str(payload)?;
    let declarations = value
        .get("declarations")
        .and_then(serde_json::Value::as_array)
        .ok_or("Foundation.Holo has no semantic declarations")?;
    let by_name = declarations
        .iter()
        .filter_map(|row| Some((row.get("name")?.as_str()?, row)))
        .collect::<std::collections::BTreeMap<_, _>>();

    for theorem in declarations
        .iter()
        .filter(|row| row.get("kind").and_then(serde_json::Value::as_str) == Some("theorem"))
    {
        if theorem
            .get("axioms")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|axioms| !axioms.is_empty())
        {
            return Err(format!(
                "Prism theorem {} declares a nonempty axiom policy",
                theorem
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("<unnamed>")
            )
            .into());
        }
    }

    let pairs = [
        ("componentIndexes_sound_complete", "componentIndexesValid"),
        ("edgeEndpoints_sound_complete", "edgeEndpointsValid"),
        ("riskLinks_sound_complete", "riskLinksValid"),
        ("controlLinks_sound_complete", "controlLinksValid"),
        ("viewpointLinks_sound_complete", "viewpointLinksValid"),
        ("qualityLinks_sound_complete", "qualityLinksValid"),
        ("flattenedBounds_sound_complete", "flattenedBoundsValid"),
        ("standardsProfile_sound_complete", "standardsProfileValid"),
    ];
    for (theorem_name, proposition_name) in pairs {
        let theorem = by_name
            .get(theorem_name)
            .ok_or_else(|| format!("missing formal theorem {theorem_name}"))?;
        let statement = theorem
            .get("statement")
            .ok_or_else(|| format!("{theorem_name} has no statement"))?;
        let right_function = statement
            .get("right")
            .and_then(|right| right.get("function"))
            .and_then(|function| function.get("name"))
            .and_then(serde_json::Value::as_str);
        if statement.get("kind").and_then(serde_json::Value::as_str) != Some("iff")
            || right_function != Some(proposition_name)
        {
            return Err(format!("{theorem_name} is not an iff with {proposition_name}").into());
        }
    }

    let assignment = by_name
        .get("canonicalIndexAssignment")
        .ok_or("missing canonical index-assignment proposition")?;
    let assignment_body = assignment
        .get("body")
        .ok_or("canonical index-assignment proposition has no body")?;
    if assignment
        .get("result")
        .and_then(|result| result.get("kind"))
        != Some(&serde_json::Value::String("prop".to_owned()))
        || assignment_body
            .get("kind")
            .and_then(serde_json::Value::as_str)
            != Some("eq")
        || assignment_body
            .get("right")
            .and_then(|right| right.get("function"))
            .and_then(|function| function.get("name"))
            .and_then(serde_json::Value::as_str)
            != Some("canonicalIndexes")
    {
        return Err("canonical index assignment is not equality to canonicalIndexes".into());
    }
    let uniqueness = by_name
        .get("canonicalIndexAssignmentUnique")
        .ok_or("missing canonical index uniqueness theorem")?;
    let statement = uniqueness
        .get("statement")
        .ok_or("canonical index uniqueness theorem has no statement")?;
    if statement.get("kind").and_then(serde_json::Value::as_str) != Some("iff")
        || statement
            .get("left")
            .and_then(|left| left.get("function"))
            .and_then(|function| function.get("name"))
            .and_then(serde_json::Value::as_str)
            != Some("canonicalIndexAssignment")
        || statement
            .get("right")
            .and_then(|right| right.get("right"))
            .and_then(|right| right.get("function"))
            .and_then(|function| function.get("name"))
            .and_then(serde_json::Value::as_str)
            != Some("canonicalIndexes")
    {
        return Err("canonical index uniqueness theorem is not the exact characterization".into());
    }

    let corpus_source =
        std::fs::read_to_string(root.join("stdlib/src/Production/SystemValidationCorpus.lex.tex"))?;
    let corpus_payload = corpus_source
        .lines()
        .find_map(|line| {
            line.strip_prefix("\\semanticdata{")
                .and_then(|value| value.strip_suffix('}'))
        })
        .ok_or("Production.SystemValidationCorpus has no semantic module payload")?;
    let corpus: serde_json::Value = serde_json::from_str(corpus_payload)?;
    let corpus_declarations = corpus["declarations"]
        .as_array()
        .ok_or("Production.SystemValidationCorpus has no semantic declarations")?;
    let corpus_by_name = corpus_declarations
        .iter()
        .filter_map(|row| Some((row.get("name")?.as_str()?, row)))
        .collect::<std::collections::BTreeMap<_, _>>();
    for family in [
        "CapabilitySatisfaction",
        "Closure",
        "Compatibility",
        "DeploymentOrder",
        "EvidenceClosure",
        "LicenseClosure",
        "MigrationOrder",
        "ReferentialIntegrity",
        "ReleaseCompleteness",
        "RollbackSafety",
        "SecretFlow",
        "Uniqueness",
    ] {
        for (suffix, model, expected) in [
            ("Sound", "corpusValidModel".to_owned(), true),
            (
                "RejectsMutation",
                format!("corpusInvalid{family}Model"),
                false,
            ),
        ] {
            let theorem_name = format!("corpus{family}{suffix}");
            let theorem = corpus_by_name
                .get(theorem_name.as_str())
                .ok_or_else(|| format!("missing direct model theorem {theorem_name}"))?;
            let statement = &theorem["statement"];
            if theorem["kind"] != "theorem"
                || theorem["axioms"]
                    .as_array()
                    .is_none_or(|rows| !rows.is_empty())
                || statement["kind"] != "eq"
                || statement["left"]["function"]["module"] != "Production.SystemValidation"
                || statement["left"]["function"]["name"] != format!("validateModel{family}")
                || statement["left"]["arguments"][0]["function"]["name"] != model
                || statement["left"]["arguments"][1]["function"]["name"] != "corpusManifest"
                || statement["right"]["value"] != expected
            {
                return Err(format!(
                    "{theorem_name} does not prove its exact typed model predicate"
                )
                .into());
            }
        }
    }
    let aggregate = corpus_by_name
        .get("corpusManifestSound")
        .ok_or("missing aggregate typed model theorem")?;
    if aggregate["kind"] != "theorem"
        || aggregate["axioms"]
            .as_array()
            .is_none_or(|rows| !rows.is_empty())
        || aggregate["statement"]["left"]["function"]["module"] != "Production.SystemValidation"
        || aggregate["statement"]["left"]["function"]["name"] != "validateManifest"
        || aggregate["statement"]["left"]["arguments"][0]["function"]["name"] != "corpusValidModel"
        || aggregate["statement"]["left"]["arguments"][1]["function"]["name"] != "corpusManifest"
        || aggregate["statement"]["right"]["value"] != true
    {
        return Err("aggregate typed model theorem is not the exact direct predicate".into());
    }
    Ok(())
}

/// Audit that unsafe code is forbidden across workspace Rust crates.
pub fn audit_no_unsafe(root: &Path) -> Result<(), Fail> {
    for entry in walkdir::WalkDir::new(root.join("crates"))
        .into_iter()
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "rs") {
            let text = std::fs::read_to_string(path)?;
            if text.contains("unsafe ") && !path.to_string_lossy().contains("tests") {
                return Err(
                    format!("unsafe audit failed: found unsafe in {}", path.display()).into(),
                );
            }
        }
    }
    Ok(())
}

/// Audit that only crates/prismpm is publishable and repo crates are private.
pub fn audit_shipped(root: &Path) -> Result<(), Fail> {
    let internal_crates = ["crates/model", "crates/conformance", "xtask"];
    for cr in internal_crates {
        let manifest_path = root.join(cr).join("Cargo.toml");
        let content = std::fs::read_to_string(&manifest_path)?;
        if !content.contains("publish = false") {
            return Err(format!(
                "{}: internal crate must have publish = false",
                manifest_path.display()
            )
            .into());
        }
    }
    let workspace = std::fs::read_to_string(root.join("Cargo.toml"))?;
    for forbidden in ["../LexLean", "../lean4-prod"] {
        if workspace.contains(forbidden) {
            return Err(format!("workspace contains adjacent dependency path {forbidden}").into());
        }
    }
    let container = std::fs::read_to_string(root.join(".devcontainer/devcontainer.json"))?;
    if container.contains("../LexLean") || container.contains("../lean4-prod") {
        return Err("devcontainer depends on a host-specific adjacent mount".into());
    }
    let value: serde_json::Value = serde_json::from_str(&container)?;
    if value
        .get("mounts")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|mounts| {
            mounts.iter().any(|mount| {
                mount.as_str()
                    != Some("source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind")
            })
        })
    {
        return Err("devcontainer contains a host-specific non-Docker mount".into());
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<String, Fail> {
    Ok(format!("{:x}", sha2::Sha256::digest(std::fs::read(path)?)))
}

fn audit_tree_manifest(root: &Path, manifest: &Path, tree_root: &Path) -> Result<(), Fail> {
    let source = std::fs::read_to_string(root.join(manifest))?;
    if !source.ends_with('\n') || source.contains('\r') {
        return Err(format!("{} is not canonical text", manifest.display()).into());
    }
    let mut declared = std::collections::BTreeMap::new();
    for line in source.lines() {
        let (sha256, relative) = line
            .split_once("  ")
            .ok_or_else(|| format!("malformed tree-manifest row in {}", manifest.display()))?;
        if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(format!("invalid tree-manifest checksum for {relative}").into());
        }
        let relative_path = Path::new(relative);
        if relative_path.is_absolute()
            || relative
                .split('/')
                .any(|component| component.is_empty() || matches!(component, "." | ".."))
            || declared
                .insert(relative.to_owned(), sha256.to_owned())
                .is_some()
        {
            return Err(format!("invalid tree-manifest path {relative}").into());
        }
    }
    let tree = root.join(tree_root);
    let metadata = std::fs::symlink_metadata(&tree)?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(format!(
            "vendored dependency root is not a directory: {}",
            tree.display()
        )
        .into());
    }
    let mut observed = std::collections::BTreeMap::new();
    for entry in walkdir::WalkDir::new(&tree)
        .min_depth(1)
        .into_iter()
        .filter_entry(|entry| !(entry.file_type().is_dir() && entry.file_name() == "target"))
    {
        let entry = entry?;
        if entry.file_type().is_symlink() {
            return Err(format!(
                "vendored dependency tree has symlink {}",
                entry.path().display()
            )
            .into());
        }
        if !entry.file_type().is_file() || entry.path() == root.join(manifest) {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(&tree)?
            .to_string_lossy()
            .replace('\\', "/");
        observed.insert(relative, hash_file(entry.path())?);
    }
    if declared != observed {
        return Err(format!(
            "vendored dependency tree {} differs from {}",
            tree_root.display(),
            manifest.display()
        )
        .into());
    }
    Ok(())
}

/// Audit immutable dependency revisions, source modes, and vendored checksums.
pub fn audit_dependencies(root: &Path) -> Result<(), Fail> {
    let path = root.join("model/dependencies.toml");
    let source = std::fs::read_to_string(&path)?;
    for forbidden in ["pending", "placeholder", "branch", "../"] {
        if source.to_ascii_lowercase().contains(forbidden) {
            return Err(format!("dependency register contains forbidden token {forbidden}").into());
        }
    }
    let value: toml::Value = toml::from_str(&source)?;
    if value.get("spec").and_then(toml::Value::as_str) != Some("prismpm/dependencies/1") {
        return Err("dependency register has the wrong schema".into());
    }
    let rows = value
        .get("dependency")
        .and_then(toml::Value::as_array)
        .ok_or("dependency register has no rows")?;
    let ids = rows
        .iter()
        .filter_map(|row| row.get("id").and_then(toml::Value::as_str))
        .collect::<Vec<_>>();
    if ids != ["lean4-prod", "lexlean", "hologram-live", "uor-hologram"] {
        return Err("dependency rows are not the exact canonical set/order".into());
    }
    for row in rows {
        let id = row
            .get("id")
            .and_then(toml::Value::as_str)
            .ok_or("dependency row lacks id")?;
        if matches!(id, "hologram-live" | "uor-hologram")
            && row.get("role").and_then(toml::Value::as_str) != Some("validation-oracle")
        {
            return Err(format!("{id} must be registered as a validation-only oracle").into());
        }
        let revision = row
            .get("revision")
            .and_then(toml::Value::as_str)
            .ok_or("dependency row lacks revision")?;
        if revision.len() != 40 || !revision.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(format!("{id} revision is not a full commit").into());
        }
        let expected_source = if id == "uor-hologram" {
            "git"
        } else {
            "vendored"
        };
        if row.get("source").and_then(toml::Value::as_str) != Some(expected_source) {
            return Err(format!("{id} does not use canonical source {expected_source}").into());
        }
        let artifacts = row.get("artifact").and_then(toml::Value::as_array);
        if expected_source == "git" {
            if artifacts.is_some_and(|values| !values.is_empty()) {
                return Err(format!("Git-only dependency {id} declares local artifacts").into());
            }
            continue;
        }
        let artifacts = artifacts.ok_or_else(|| format!("{id} has no artifact checksums"))?;
        if artifacts.is_empty() {
            return Err(format!("{id} has no artifact checksums").into());
        }
        for artifact in artifacts {
            let kind = artifact
                .get("kind")
                .and_then(toml::Value::as_str)
                .ok_or("dependency artifact lacks kind")?;
            let relative = artifact
                .get("path")
                .and_then(toml::Value::as_str)
                .ok_or("dependency artifact lacks path")?;
            let expected = artifact
                .get("sha256")
                .and_then(toml::Value::as_str)
                .ok_or("dependency artifact lacks sha256")?;
            if Path::new(relative).is_absolute()
                || relative
                    .split('/')
                    .any(|component| component.is_empty() || component == ".." || component == ".")
                || !relative.starts_with("vendor/")
            {
                return Err(format!("invalid vendored artifact path {relative}").into());
            }
            if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(format!("invalid checksum for {relative}").into());
            }
            let actual = hash_file(&root.join(relative))?;
            if actual != expected {
                return Err(format!("vendored artifact checksum drifted for {relative}").into());
            }
            match kind {
                "file" => {
                    if artifact.get("tree_root").is_some() {
                        return Err(format!("file artifact {relative} declares tree_root").into());
                    }
                }
                "tree-manifest" => {
                    let tree_root = artifact
                        .get("tree_root")
                        .and_then(toml::Value::as_str)
                        .ok_or("tree-manifest artifact lacks tree_root")?;
                    if Path::new(tree_root).is_absolute()
                        || !tree_root.starts_with("vendor/")
                        || tree_root.split('/').any(|component| {
                            component.is_empty() || matches!(component, "." | "..")
                        })
                    {
                        return Err(format!("invalid vendored tree root {tree_root}").into());
                    }
                    audit_tree_manifest(root, Path::new(relative), Path::new(tree_root))?;
                }
                _ => return Err(format!("unknown dependency artifact kind {kind}").into()),
            }
        }
    }
    Ok(())
}

fn check_runtime_oracle_separation(source: &str) -> Result<(), Fail> {
    let lock: toml::Value = toml::from_str(source)?;
    let packages = lock
        .get("package")
        .and_then(toml::Value::as_array)
        .ok_or("runtime Cargo lock has no packages")?;
    for package in packages {
        let name = package
            .get("name")
            .and_then(toml::Value::as_str)
            .ok_or("runtime Cargo package has no name")?;
        let origin = match package.get("source") {
            Some(value) => value.as_str().ok_or("runtime Cargo source is malformed")?,
            None => "",
        };
        if matches!(name, "hologram" | "uor-hologram")
            || name.starts_with("hologram-")
            || origin
                .to_ascii_lowercase()
                .contains("github.com/hologram-technologies/hologram")
        {
            return Err(
                format!("runtime Cargo graph includes validation-only oracle {name}").into(),
            );
        }
    }
    Ok(())
}

/// Keep independent Holo oracles outside the production dependency graph.
pub fn audit_runtime_oracle_separation(root: &Path) -> Result<(), Fail> {
    check_runtime_oracle_separation(&std::fs::read_to_string(root.join("Cargo.lock"))?)?;
    let dependencies: toml::Value = toml::from_str(&std::fs::read_to_string(
        root.join("model/dependencies.toml"),
    )?)?;
    let revision = dependencies
        .get("dependency")
        .and_then(toml::Value::as_array)
        .ok_or("dependency rows absent")?
        .iter()
        .find(|row| row.get("id").and_then(toml::Value::as_str) == Some("uor-hologram"))
        .and_then(|row| row.get("revision").and_then(toml::Value::as_str))
        .ok_or("Holo oracle revision absent")?;
    for path in [
        "tests/hologram-oracle/Cargo.toml",
        "tests/holo-codec-oracle/Cargo.toml",
    ] {
        let manifest: toml::Value = toml::from_str(&std::fs::read_to_string(root.join(path))?)?;
        if manifest
            .get("dependencies")
            .and_then(|value| value.get("hologram"))
            .and_then(|value| value.get("rev"))
            .and_then(toml::Value::as_str)
            != Some(revision)
            || manifest
                .get("workspace")
                .and_then(toml::Value::as_table)
                .is_none()
        {
            return Err(
                format!("{path} is not an isolated oracle at the registered revision").into(),
            );
        }
    }
    Ok(())
}

fn audit_chromium_input(root: &Path, lock: &toml::Value) -> Result<(), Fail> {
    let table = lock
        .get("chromium-headless-input")
        .and_then(toml::Value::as_table)
        .ok_or("tools.lock has no chromium-headless-input table")?;
    let keys: BTreeSet<&str> = table.keys().map(String::as_str).collect();
    if keys
        != BTreeSet::from([
            "authority",
            "authority_sha256",
            "channel",
            "installer",
            "installer_sha256",
            "version",
        ])
    {
        return Err("Chromium input fields differ from the closed lock profile".into());
    }
    for (key, expected) in [
        ("version", "157.0.8099.0"),
        ("channel", "Canary"),
        ("authority", "sdk/browser-engine/authority.json"),
        ("installer", "sdk/browser-engine/install.py"),
    ] {
        if table.get(key).and_then(toml::Value::as_str) != Some(expected) {
            return Err(format!("Chromium input {key} differs").into());
        }
    }
    for (key, path) in [
        ("authority_sha256", "sdk/browser-engine/authority.json"),
        ("installer_sha256", "sdk/browser-engine/install.py"),
    ] {
        let digest = format!(
            "{:x}",
            sha2::Sha256::digest(std::fs::read(root.join(path))?)
        );
        if table.get(key).and_then(toml::Value::as_str) != Some(digest.as_str()) {
            return Err(format!("Chromium input {key} differs from actual source bytes").into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod chromium_input_tests {
    use super::audit_chromium_input;

    #[test]
    fn actual_toml_parser_and_source_joins_refuse_lock_substitutions() {
        let root = repo_model::repo_root();
        let original = std::fs::read_to_string(root.join("tools.lock")).unwrap();
        let lock: toml::Value = toml::from_str(&original).unwrap();
        audit_chromium_input(&root, &lock).unwrap();
        for change in 0..10 {
            let mut value = lock.clone();
            let table = value["chromium-headless-input"].as_table_mut().unwrap();
            match change {
                0 => {
                    table.remove("authority_sha256");
                }
                1 => {
                    table.insert("extra".into(), "not admitted".into());
                }
                2 => {
                    table.insert("version".into(), "151.0.7922.34".into());
                }
                3 => {
                    table.insert("channel".into(), "Stable".into());
                }
                4 => {
                    table.insert("authority".into(), "sdk/browser-engine/install.py".into());
                }
                5 => {
                    table.insert(
                        "installer".into(),
                        "sdk/browser-engine/authority.json".into(),
                    );
                }
                6 => {
                    table.insert("authority_sha256".into(), "0".repeat(64).into());
                }
                7 => {
                    table.insert("installer_sha256".into(), "0".repeat(64).into());
                }
                8 => {
                    table.insert("version".into(), 157_i64.into());
                }
                _ => {
                    value
                        .as_table_mut()
                        .unwrap()
                        .remove("chromium-headless-input");
                }
            }
            assert!(
                audit_chromium_input(&root, &value).is_err(),
                "change {change}"
            );
        }
        for changed in [
            original.replace("[chromium-headless-input]", "[other-input]"),
            original.replace("[chromium-headless-input]", "# [chromium-headless-input]"),
            original.replace(
                "[chromium-headless-input]",
                "[chromium-headless-input]\nversion = \"duplicate\"",
            ),
        ] {
            assert_ne!(changed, original);
            assert!(toml::from_str::<toml::Value>(&changed)
                .map(|value| audit_chromium_input(&root, &value).is_err())
                .unwrap_or(true));
        }
    }
}

/// Audit pinned tool installers and full-SHA CI actions.
pub fn audit_tools_ci(root: &Path) -> Result<(), Fail> {
    let tools = std::fs::read_to_string(root.join("tools.lock"))?;
    let lock: toml::Value = toml::from_str(&tools)?;
    audit_chromium_input(root, &lock)?;
    let dockerfile = std::fs::read_to_string(root.join(".devcontainer/Dockerfile"))?;
    let hosts = lock
        .get("support")
        .and_then(|value| value.get("hosts"))
        .and_then(toml::Value::as_array)
        .ok_or("tools.lock has no supported-host array")?;
    let claimed_hosts = hosts
        .iter()
        .map(|host| host.as_str().ok_or("supported host is not a string"))
        .collect::<Result<Vec<_>, _>>()?;
    if claimed_hosts != repo_model::release::HOST_TARGETS
        || claimed_hosts != ["aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu"]
    {
        return Err("supported host claims differ between tools.lock and release policy".into());
    }
    let sdk_dockerfile = std::fs::read_to_string(root.join("sdk/Dockerfile"))?;
    for (name, value) in lock
        .get("sdk-bases")
        .and_then(toml::Value::as_table)
        .ok_or("tools.lock has no sdk-bases table")?
    {
        let value = value
            .as_str()
            .ok_or_else(|| format!("sdk-bases.{name} is not a string"))?;
        let (source, source_name) = if name == "devcontainer" {
            (&dockerfile, ".devcontainer/Dockerfile")
        } else {
            (&sdk_dockerfile, "sdk/Dockerfile")
        };
        if !source.contains(value) {
            return Err(format!("sdk-bases.{name} is not bound by {source_name}").into());
        }
    }
    let adapters = lock
        .get("target-adapters")
        .and_then(toml::Value::as_table)
        .ok_or("tools.lock has no target-adapters table")?;
    for (name, relative) in [
        ("compose", "adapters/compose.json"),
        ("github_pages", "adapters/github-pages.json"),
        ("kubernetes", "adapters/kubernetes.json"),
        (
            "ingress_nginx_kind_manifest",
            "adapters/ingress-nginx-kind-v1.15.1.yaml",
        ),
    ] {
        let expected = adapters
            .get(name)
            .and_then(toml::Value::as_str)
            .ok_or_else(|| format!("target-adapters.{name} is absent"))?;
        let actual = format!(
            "sha256:{:x}",
            sha2::Sha256::digest(std::fs::read(root.join(relative))?)
        );
        if expected != actual {
            return Err(format!("target-adapters.{name} digest is stale").into());
        }
    }
    let kubernetes_adapter = std::fs::read_to_string(root.join("adapters/kubernetes.json"))?;
    for name in ["ingress_nginx_controller", "ingress_nginx_admission"] {
        let value = adapters
            .get(name)
            .and_then(toml::Value::as_str)
            .ok_or_else(|| format!("target-adapters.{name} is absent"))?;
        if !kubernetes_adapter.contains(value) {
            return Err(format!("target-adapters.{name} is not bound by kubernetes.json").into());
        }
    }
    for architecture in ["amd64", "arm64"] {
        let downloads = lock
            .get("sdk-downloads")
            .and_then(|value| value.get(architecture))
            .and_then(toml::Value::as_table)
            .ok_or_else(|| format!("tools.lock has no sdk-downloads.{architecture} table"))?;
        for (name, digest) in downloads {
            let digest = digest
                .as_str()
                .ok_or_else(|| format!("sdk-downloads.{architecture}.{name} is not a string"))?;
            if digest.len() != 64
                || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
                || !sdk_dockerfile.contains(digest)
            {
                return Err(format!(
                    "sdk-downloads.{architecture}.{name} is not checksum-bound by sdk/Dockerfile"
                )
                .into());
            }
        }
    }
    let sdk_sources = format!(
        "{}{}{}{}{}",
        sdk_dockerfile,
        std::fs::read_to_string(root.join("sdk/generate-inventory.mjs"))?,
        std::fs::read_to_string(root.join("sdk/devcontainer-cli/package-lock.json"))?,
        std::fs::read_to_string(root.join("sdk/oracles/package-lock.json"))?,
        std::fs::read_to_string(root.join("sdk/runtime/package-lock.json"))?
    );
    for table in ["sdk-tools", "runtime-libraries"] {
        for (name, version) in lock
            .get(table)
            .and_then(toml::Value::as_table)
            .ok_or_else(|| format!("tools.lock has no {table} table"))?
        {
            let version = version
                .as_str()
                .ok_or_else(|| format!("{table}.{name} is not a string"))?;
            if !sdk_sources.contains(version) {
                return Err(
                    format!("{table}.{name} is not version-bound by the SDK inputs").into(),
                );
            }
        }
    }
    for value in [
        "1.97.1",
        "leanprover/lean4:v4.32.1",
        "4.2.3",
        "1.57.0",
        "0.20.2",
    ] {
        if !tools.contains(value) || !dockerfile.contains(value) {
            return Err(
                format!("tool pin {value} is not shared by tools.lock and Dockerfile").into(),
            );
        }
    }
    for name in ["rustup", "elan", "just", "cargo-deny"] {
        let row = lock
            .get(name)
            .and_then(toml::Value::as_table)
            .ok_or_else(|| format!("tools.lock has no {name} installer row"))?;
        let platform = row
            .get("platform")
            .and_then(toml::Value::as_str)
            .ok_or_else(|| format!("{name} installer platform is absent"))?;
        let url = row
            .get("url")
            .and_then(toml::Value::as_str)
            .ok_or_else(|| format!("{name} installer URL is absent"))?;
        let sha256 = row
            .get("sha256")
            .and_then(toml::Value::as_str)
            .ok_or_else(|| format!("{name} installer checksum is absent"))?;
        if !platform.starts_with("x86_64-unknown-linux-")
            || !url.starts_with("https://")
            || sha256.len() != 64
            || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !dockerfile.contains(url)
            || !dockerfile.contains(sha256)
        {
            return Err(format!("{name} installer is not source/checksum pinned").into());
        }
    }
    let verification = lock
        .get("verification-executables")
        .and_then(toml::Value::as_table)
        .ok_or("tools.lock has no verification-executables row")?;
    let verification_source =
        std::fs::read_to_string(root.join("crates/prismpm/src/verification.rs"))?;
    for name in ["elan_proxy_sha256", "rustup_proxy_sha256", "timeout_sha256"] {
        let digest = verification
            .get(name)
            .and_then(toml::Value::as_str)
            .ok_or_else(|| format!("verification executable {name} has no checksum"))?;
        if digest.len() != 64
            || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !verification_source.contains(digest)
        {
            return Err(format!("verification executable {name} is not preflight-pinned").into());
        }
    }
    if verification
        .get("timeout_package")
        .and_then(toml::Value::as_str)
        != Some("coreutils=9.1-1")
        || !dockerfile.contains("coreutils=9.1-1")
    {
        return Err("the timeout provider package is not version-pinned".into());
    }
    if !dockerfile.contains("FROM docker.io/library/debian:bookworm-slim@sha256:") {
        return Err("devcontainer base image is not digest-pinned".into());
    }
    for workflow in [
        ".github/actions/devcontainer-cache/action.yml",
        ".github/workflows/ci-parallel.yml",
        ".github/workflows/bootstrap.yml",
        ".github/workflows/native-golden.yml",
        ".github/workflows/reproducibility.yml",
        ".github/workflows/vv.yml",
    ] {
        let source = std::fs::read_to_string(root.join(workflow))?;
        for line in source.lines().map(str::trim) {
            let Some(value) = line
                .strip_prefix("- uses: ")
                .or_else(|| line.strip_prefix("uses: "))
            else {
                continue;
            };
            if value.starts_with("./") {
                continue;
            }
            let reference = value
                .split('#')
                .next()
                .and_then(|value| value.trim().rsplit_once('@').map(|pair| pair.1))
                .ok_or_else(|| format!("{workflow} has malformed action reference"))?;
            if reference.len() != 40 || !reference.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(format!("{workflow} action is not pinned to a full commit").into());
            }
        }
    }
    Ok(())
}

/// Audit that every diagnostic code used in crates/ is registered in model/errors.toml.
pub fn audit_errors(root: &Path, model: &Model) -> Result<(), Fail> {
    let registered: BTreeSet<&str> = model.errors.error.iter().map(|e| e.code.as_str()).collect();
    for entry in walkdir::WalkDir::new(root.join("crates"))
        .into_iter()
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "rs") {
            let text = std::fs::read_to_string(path)?;
            for word in text.split(|c: char| !c.is_alphanumeric()) {
                if word.starts_with("PP")
                    && word.len() == 6
                    && word.chars().skip(2).all(|c| c.is_ascii_digit())
                    && !registered.contains(word)
                {
                    return Err(format!(
                        "{}: references unregistered error code `{word}`",
                        path.display()
                    )
                    .into());
                }
            }
        }
    }
    Ok(())
}

/// Audit the exact Holo emitter input closure and its stored semantics digest.
pub fn audit_emitter_inputs(root: &Path, model: &Model) -> Result<(), Fail> {
    const EXPECTED: [&str; 18] = [
        "crates/prismpm/src/holo/application.rs",
        "crates/prismpm/src/holo/browser_application.rs",
        "crates/prismpm/src/holo/browser_application/model.rs",
        "crates/prismpm/src/holo/browser_application/source.rs",
        "crates/prismpm/src/holo/canonical.rs",
        "crates/prismpm/src/holo/library.rs",
        "crates/prismpm/src/holo/library/roots.rs",
        "crates/prismpm/src/holo/model_document.rs",
        "crates/prismpm/src/holo/mod.rs",
        "crates/prismpm/src/holo/projector.rs",
        "crates/prismpm/src/holo/validate.rs",
        "model/projection.toml",
        "model/standards.toml",
        "schemas/model-document-v2.schema.json",
        "schemas/model-document-v3.schema.json",
        "schemas/model-document-v4.schema.json",
        "schemas/model-document-v5.schema.json",
        "schemas/model-document.schema.json",
    ];
    if model.emitter_inputs.spec != "prismpm/emitter-inputs/1"
        || model.emitter_inputs.inputs != EXPECTED
    {
        return Err("emitter input list is not the exact canonical closure".into());
    }
    for relative in &model.emitter_inputs.inputs {
        let path = root.join(relative);
        if !path.is_file()
            || relative.starts_with(".prism")
            || relative.starts_with(".lexlean")
            || relative.contains("generated")
        {
            return Err(format!("invalid emitter input {relative}").into());
        }
    }
    let actual = prismpm::holo::projector::compute_emitter_semantics_id();
    if model.emitter_inputs.digest != actual {
        return Err(format!(
            "emitter digest is stale: registered {}, actual {actual}",
            model.emitter_inputs.digest
        )
        .into());
    }
    Ok(())
}

/// Audit that release-scope standards and facet entries form an exact map.
pub fn audit_standards_map(root: &Path, model: &Model) -> Result<(), Fail> {
    let mut mapped = BTreeSet::new();
    for row in &model.standards.standard {
        if row.release_scope
            && (row.coverage_state != "implemented" || row.facet_entries.is_empty())
        {
            return Err(format!("{} is not implemented by a facet entry", row.id).into());
        }
        for entry in &row.facet_entries {
            if !mapped.insert(entry.clone()) {
                return Err(format!("facet entry {entry} maps to multiple standards").into());
            }
            let path = root
                .join("language")
                .join(&row.facet_package)
                .join("entries")
                .join(format!("{entry}.toml"));
            if !path.is_file() {
                return Err(format!("{} references missing facet entry {entry}", row.id).into());
            }
            let source = std::fs::read_to_string(&path)?;
            if !source.contains(&format!("id = \"{entry}\"")) {
                return Err(format!("{} does not declare ID {entry}", path.display()).into());
            }
        }
    }
    for package in ["prism.arch", "prism.qual", "prism.sec"] {
        for entry in walkdir::WalkDir::new(root.join("language").join(package).join("entries"))
            .min_depth(1)
            .max_depth(1)
            .into_iter()
            .flatten()
            .filter(|entry| entry.file_type().is_file())
        {
            let source = std::fs::read_to_string(entry.path())?;
            let id = source
                .lines()
                .find_map(|line| {
                    line.strip_prefix("id = \"")
                        .and_then(|v| v.strip_suffix('"'))
                })
                .ok_or_else(|| format!("{} lacks an entry ID", entry.path().display()))?;
            if !mapped.contains(id) {
                return Err(format!("facet entry {id} has no standards row").into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod oracle_separation_tests {
    use super::check_runtime_oracle_separation;

    #[test]
    fn runtime_lock_rejects_oracle_packages_and_renamed_upstream_crates() {
        check_runtime_oracle_separation(
            "version = 4\n[[package]]\nname = 'prism-stdlib'\nversion = '0.2.0'\n",
        )
        .unwrap();
        for row in [
            "name = 'hologram'", "name = 'uor-hologram'", "name = 'hologram-archive'",
            "name = 'renamed-codec'\nsource = 'git+https://github.com/Hologram-Technologies/hologram?rev=abc#abc'",
            "name = 'invalid'\nsource = false",
        ] {
            assert!(check_runtime_oracle_separation(&format!("version = 4\n[[package]]\n{row}\n")).is_err());
        }
        assert!(check_runtime_oracle_separation("version = 4").is_err());
    }
}

#[cfg(test)]
mod lean_source_audit_tests {
    use super::{
        audit_lexlean_authority_archive, audit_no_handwritten_lean, hash_file,
        LEXLEAN_AUTHORITY_REVISION,
    };
    use std::path::Path;

    const ADAPTER: &str = "vendor/lexlean/language/lcnf-1.2/extract.lean";
    const PRESERVATION: [&str; 17] = [
        "library/LexLeanPreservation/Compose.lean",
        "library/LexLeanPreservation/Core.lean",
        "library/LexLeanPreservation/Fixed.lean",
        "library/LexLeanPreservation/Keys.lean",
        "library/LexLeanPreservation/Primitives.lean",
        "library/LexLeanPreservation/RustBase.lean",
        "library/LexLeanPreservation/RustCorr.lean",
        "library/LexLeanPreservation/RustLemmas.lean",
        "library/LexLeanPreservation/RustMatches.lean",
        "library/LexLeanPreservation/RustSound.lean",
        "library/LexLeanPreservation/Templates.lean",
        "library/LexLeanPreservation/Validate.lean",
        "library/LexLeanPreservation/Values.lean",
        "modules/LexLeanTarget/RustSemantics.lean",
        "modules/LexLeanTarget/RustSyntax.lean",
        "modules/LexLeanTarget/TargetSemantics.lean",
        "modules/LexLeanTarget/TargetSyntax.lean",
    ];

    fn seal(root: &Path) {
        let vendor = root.join("vendor/lexlean");
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut archive = tar::Builder::new(encoder);
        for entry in walkdir::WalkDir::new(&vendor).sort_by_file_name() {
            let entry = entry.unwrap();
            if !entry.file_type().is_file()
                || matches!(
                    entry.file_name().to_str(),
                    Some("MANIFEST.sha256" | "lexlean-0.3.0.crate")
                )
            {
                continue;
            }
            let bytes = std::fs::read(entry.path()).unwrap();
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            archive
                .append_data(
                    &mut header,
                    Path::new("lexlean-0.3.0").join(entry.path().strip_prefix(&vendor).unwrap()),
                    bytes.as_slice(),
                )
                .unwrap();
        }
        let bytes = archive.into_inner().unwrap().finish().unwrap();
        std::fs::write(vendor.join("lexlean-0.3.0.crate"), bytes).unwrap();
        seal_tree(root);
    }

    fn seal_tree(root: &Path) {
        let vendor = root.join("vendor/lexlean");
        let mut files = std::collections::BTreeMap::new();
        for entry in walkdir::WalkDir::new(&vendor) {
            let entry = entry.unwrap();
            if entry.file_type().is_file() && entry.file_name() != "MANIFEST.sha256" {
                let relative = entry.path().strip_prefix(&vendor).unwrap();
                files.insert(
                    relative.to_string_lossy().replace('\\', "/"),
                    hash_file(entry.path()).unwrap(),
                );
            }
        }
        let manifest = files
            .iter()
            .map(|(path, digest)| format!("{digest}  {path}\n"))
            .collect::<String>();
        std::fs::write(vendor.join("MANIFEST.sha256"), manifest).unwrap();
        let manifest_digest = hash_file(&vendor.join("MANIFEST.sha256")).unwrap();
        let other_digest = hash_file(&root.join("vendor/fixture.bin")).unwrap();
        let archive_digest = hash_file(&vendor.join("lexlean-0.3.0.crate")).unwrap();
        let revision = LEXLEAN_AUTHORITY_REVISION;
        let source = format!(
            "spec = 'prismpm/dependencies/1'\n\n\
             [[dependency]]\nid = 'lean4-prod'\nrevision = '{revision}'\nsource = 'vendored'\n\
             [[dependency.artifact]]\nkind = 'file'\npath = 'vendor/fixture.bin'\nsha256 = '{other_digest}'\n\n\
             [[dependency]]\nid = 'lexlean'\nversion = '0.3.0'\nrevision = '{revision}'\nsource = 'vendored'\n\
             [[dependency.artifact]]\nkind = 'tree-manifest'\npath = 'vendor/lexlean/MANIFEST.sha256'\nsha256 = '{manifest_digest}'\ntree_root = 'vendor/lexlean'\n\
             [[dependency.artifact]]\nkind = 'file'\npath = 'vendor/lexlean/lexlean-0.3.0.crate'\nsha256 = '{archive_digest}'\n\n\
             [[dependency]]\nid = 'hologram-live'\nrevision = '{revision}'\nsource = 'vendored'\nrole = 'validation-oracle'\n\
             [[dependency.artifact]]\nkind = 'file'\npath = 'vendor/fixture.bin'\nsha256 = '{other_digest}'\n\n\
             [[dependency]]\nid = 'uor-hologram'\nrevision = '{revision}'\nsource = 'git'\nrole = 'validation-oracle'\n"
        );
        std::fs::write(root.join("model/dependencies.toml"), source).unwrap();
    }

    fn fixture() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("vendor/lexlean/language/lcnf-1.2")).unwrap();
        std::fs::create_dir(root.path().join("model")).unwrap();
        std::fs::write(root.path().join(ADAPTER), "namespace ImportedAdapter\n").unwrap();
        std::fs::write(root.path().join("vendor/fixture.bin"), "fixture\n").unwrap();
        std::fs::write(
            root.path().join("vendor/lexlean/Cargo.toml"),
            "[package]\nname='lexlean'\n",
        )
        .unwrap();
        std::fs::write(
            root.path().join("vendor/lexlean/lexlean-0.3.0.crate"),
            "synthetic archive for dependency-gate testing\n",
        )
        .unwrap();
        let provenance = serde_json::json!({
            "git": {"sha1": LEXLEAN_AUTHORITY_REVISION}, "path_in_vcs": "crates/lexlean"
        });
        std::fs::write(
            root.path().join("vendor/lexlean/.cargo_vcs_info.json"),
            serde_json::to_vec(&provenance).unwrap(),
        )
        .unwrap();
        for relative in PRESERVATION {
            let path = root
                .path()
                .join("vendor/lexlean/language/preservation-1.2")
                .join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(
                path,
                "-- upstream package authority fixture, not a Prism model\n",
            )
            .unwrap();
        }
        seal(root.path());
        root
    }

    fn preservation_fixture() -> tempfile::TempDir {
        let root = fixture();
        for relative in PRESERVATION {
            let path = root
                .path()
                .join("vendor/lexlean/language/preservation-1.2")
                .join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(
                path,
                "-- upstream package authority fixture, not a Prism model\n",
            )
            .unwrap();
        }
        seal(root.path());
        root
    }

    #[test]
    fn exact_preservation_package_sources_are_admitted_with_archive_custody() {
        let root = preservation_fixture();
        audit_no_handwritten_lean(root.path()).unwrap();
    }

    #[test]
    fn current_selected_package_has_no_unregistered_lean_authority() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        audit_no_handwritten_lean(root).unwrap();
    }

    #[test]
    fn source_walk_errors_cannot_be_silently_omitted() {
        let root = tempfile::tempdir().unwrap();
        assert!(audit_no_handwritten_lean(&root.path().join("missing-source-root")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn nonregular_lean_sources_cannot_hide_behind_aliases() {
        for target in ["missing", "../vendor/fixture.bin", "../vendor"] {
            let root = fixture();
            std::os::unix::fs::symlink(target, root.path().join("model/Hidden.lean")).unwrap();
            let error = audit_no_handwritten_lean(root.path()).unwrap_err();
            assert!(error.to_string().contains("nonregular source"));
        }
        let root = fixture();
        std::fs::create_dir(root.path().join("model/Hidden.lean")).unwrap();
        assert!(audit_no_handwritten_lean(root.path())
            .unwrap_err()
            .to_string()
            .contains("nonregular source"));
        // Existing non-Lean packaging/embedded-manifest aliases are not a
        // handwritten-Lean exception and keep their separately owned audits.
        std::os::unix::fs::symlink(
            "../vendor/fixture.bin",
            root.path().join("model/embedded.MANIFEST.sha256"),
        )
        .unwrap();
        std::fs::remove_dir(root.path().join("model/Hidden.lean")).unwrap();
        audit_no_handwritten_lean(root.path()).unwrap();
    }

    #[test]
    fn preservation_member_substitution_or_deletion_cannot_be_resealed_as_the_archive() {
        for delete in [false, true] {
            let root = preservation_fixture();
            let path = root
                .path()
                .join("vendor/lexlean/language/preservation-1.2")
                .join(PRESERVATION[0]);
            if delete {
                std::fs::remove_file(path).unwrap();
            } else {
                std::fs::write(path, "substituted authority\n").unwrap();
            }
            seal_tree(root.path());
            assert!(audit_no_handwritten_lean(root.path()).is_err());
        }
    }

    #[test]
    fn an_unlisted_preservation_member_is_rejected_even_in_the_sealed_archive() {
        let root = preservation_fixture();
        std::fs::write(root.path().join("vendor/lexlean/language/preservation-1.2/library/LexLeanPreservation/Unlisted.lean"), "unlisted\n").unwrap();
        seal(root.path());
        assert!(audit_no_handwritten_lean(root.path()).is_err());
    }

    #[test]
    fn every_non_lean_package_member_requires_exact_tree_bytes_and_membership() {
        for mutation in ["substitute", "delete", "extra", "nested-manifest", "target"] {
            let root = preservation_fixture();
            let vendor = root.path().join("vendor/lexlean");
            match mutation {
                "substitute" => {
                    std::fs::write(vendor.join("Cargo.toml"), "[package]\nname='changed'\n")
                        .unwrap()
                }
                "delete" => std::fs::remove_file(vendor.join("Cargo.toml")).unwrap(),
                "extra" => std::fs::write(vendor.join("unlisted.rs"), "// unlisted\n").unwrap(),
                "nested-manifest" => {
                    std::fs::create_dir(vendor.join("nested")).unwrap();
                    std::fs::write(
                        vendor.join("nested/MANIFEST.sha256"),
                        "not a root exclusion\n",
                    )
                    .unwrap();
                }
                "target" => {
                    std::fs::create_dir(vendor.join("target")).unwrap();
                    std::fs::write(
                        vendor.join("target/unlisted.rs"),
                        "not a package exclusion\n",
                    )
                    .unwrap();
                }
                _ => unreachable!(),
            }
            seal_tree(root.path());
            // Exercise the decoder after the ordinary manifest itself is
            // resealed, rather than accepting a generic dependency-hash error.
            let error = audit_lexlean_authority_archive(
                root.path(),
                "vendor/lexlean/lexlean-0.3.0.crate",
                &hash_file(&vendor.join("lexlean-0.3.0.crate")).unwrap(),
                "0.3.0",
            )
            .unwrap_err()
            .to_string();
            let expected = match mutation {
                "substitute" => "archive bytes differ from tree source Cargo.toml",
                "delete" => "archive member is absent from its complete tree manifest: Cargo.toml",
                "nested-manifest" => "tree membership differs from its complete manifest",
                _ => "archive membership differs from its complete extracted tree",
            };
            assert!(error.contains(expected), "{mutation}: {error}");
            assert!(
                audit_no_handwritten_lean(root.path()).is_err(),
                "{mutation}"
            );
        }
    }

    #[test]
    fn physical_archive_mutations_cannot_bypass_the_registered_source_boundary() {
        use std::io::{Read, Write};
        for mutation in [
            "duplicate",
            "traversal",
            "symlink",
            "oversized",
            "trailing-gzip",
            "hidden-tar",
        ] {
            let root = preservation_fixture();
            audit_no_handwritten_lean(root.path()).unwrap();
            let path = root.path().join("vendor/lexlean/lexlean-0.3.0.crate");
            let original = std::fs::read(&path).unwrap();
            let mut tar_bytes = Vec::new();
            flate2::read::GzDecoder::new(original.as_slice())
                .read_to_end(&mut tar_bytes)
                .unwrap();
            let mut header = tar::Header::new_gnu();
            header.as_mut_bytes().copy_from_slice(&tar_bytes[..512]);
            match mutation {
                "duplicate" => {
                    let extent = 512 + header.size().unwrap().div_ceil(512) as usize * 512;
                    tar_bytes.splice(0..0, tar_bytes[..extent].to_vec());
                }
                "traversal" => {
                    header.as_mut_bytes()[..100].fill(0);
                    let name = b"lexlean-0.3.0/../foreign.lean";
                    header.as_mut_bytes()[..name.len()].copy_from_slice(name);
                    header.set_cksum();
                    tar_bytes[..512].copy_from_slice(header.as_bytes());
                }
                "symlink" => {
                    header.set_entry_type(tar::EntryType::Symlink);
                    header.set_cksum();
                    tar_bytes[..512].copy_from_slice(header.as_bytes());
                }
                "oversized" => {
                    header.set_entry_type(tar::EntryType::GNULongName);
                    header.set_size(32 * 1024 * 1024 + 1);
                    header.set_cksum();
                    tar_bytes[..512].copy_from_slice(header.as_bytes());
                }
                "hidden-tar" => tar_bytes.extend_from_slice(header.as_bytes()),
                "trailing-gzip" => {}
                _ => unreachable!(),
            }
            let mut encoder =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            encoder.write_all(&tar_bytes).unwrap();
            let mut changed = encoder.finish().unwrap();
            if mutation == "trailing-gzip" {
                changed.push(1);
            }
            std::fs::write(&path, changed).unwrap();
            let manifest = root.path().join("vendor/lexlean/MANIFEST.sha256");
            let original_manifest = std::fs::read(&manifest).unwrap();
            // Deliberately exercise the decoder directly with the actual
            // mutated archive hash. The untouched manifest cannot turn this
            // into a vacuous rejection by the outer dependency checksum gate.
            let error = audit_lexlean_authority_archive(
                root.path(),
                "vendor/lexlean/lexlean-0.3.0.crate",
                &hash_file(&path).unwrap(),
                "0.3.0",
            )
            .unwrap_err()
            .to_string();
            let expected = match mutation {
                "duplicate" | "traversal" => "invalid, duplicate or oversized member",
                "symlink" | "oversized" => "unsupported or oversized physical tar metadata",
                "trailing-gzip" => "trailing gzip data",
                "hidden-tar" => "invalid terminal tar padding",
                _ => unreachable!(),
            };
            assert!(error.contains(expected), "{mutation}: {error}");
            assert_eq!(std::fs::read(manifest).unwrap(), original_manifest);
        }
    }

    #[test]
    fn exact_dependency_adapter_is_admitted_only_with_its_complete_tree() {
        let root = fixture();
        audit_no_handwritten_lean(root.path()).unwrap();
        std::fs::write(root.path().join(ADAPTER), "changed adapter\n").unwrap();
        assert!(audit_no_handwritten_lean(root.path()).is_err());
    }

    #[test]
    fn an_additional_pinned_vendor_lean_file_is_still_rejected() {
        for name in ["extra.lean", "lakefile.lean"] {
            let root = fixture();
            std::fs::write(root.path().join("vendor/lexlean").join(name), "extra\n").unwrap();
            seal(root.path());
            let error = audit_no_handwritten_lean(root.path()).unwrap_err();
            assert!(error.to_string().contains("no-handwritten-lean"));
        }
    }

    #[test]
    fn prismpm_owned_lean_is_never_dependency_authority() {
        let root = fixture();
        std::fs::create_dir(root.path().join("stdlib")).unwrap();
        std::fs::write(root.path().join("stdlib/Proof.lean"), "def model := true\n").unwrap();
        let error = audit_no_handwritten_lean(root.path()).unwrap_err();
        assert!(error.to_string().contains("no-handwritten-lean"));
    }

    #[test]
    fn package_revision_path_and_dirty_provenance_are_checked_after_resealing() {
        for provenance in [
            serde_json::json!({"git": {"sha1": "2".repeat(40)}, "path_in_vcs": "crates/lexlean"}),
            serde_json::json!({"git": {"sha1": LEXLEAN_AUTHORITY_REVISION}, "path_in_vcs": "crates/other"}),
            serde_json::json!({"git": {"sha1": LEXLEAN_AUTHORITY_REVISION, "dirty": true}, "path_in_vcs": "crates/lexlean"}),
        ] {
            let root = fixture();
            std::fs::write(
                root.path().join("vendor/lexlean/.cargo_vcs_info.json"),
                serde_json::to_vec(&provenance).unwrap(),
            )
            .unwrap();
            seal(root.path());
            let error = audit_no_handwritten_lean(root.path()).unwrap_err();
            assert!(error.to_string().contains("package provenance"));
        }
    }

    #[test]
    fn both_archive_and_tree_registrations_are_required() {
        for kind in ["file", "tree-manifest"] {
            let root = fixture();
            let path = root.path().join("model/dependencies.toml");
            let mut register: toml::Value =
                toml::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            register["dependency"][1]["artifact"]
                .as_array_mut()
                .unwrap()
                .retain(|row| row["kind"].as_str() != Some(kind));
            std::fs::write(path, toml::to_string(&register).unwrap()).unwrap();
            let error = audit_no_handwritten_lean(root.path()).unwrap_err();
            assert!(error.to_string().contains("closed package tree"));
        }
    }

    #[test]
    fn missing_pinned_manifest_cannot_grant_the_adapter_exception() {
        let root = fixture();
        std::fs::remove_file(root.path().join("vendor/lexlean/MANIFEST.sha256")).unwrap();
        assert!(audit_no_handwritten_lean(root.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_repository_or_vendor_ancestor_cannot_grant_the_exception() {
        let root = fixture();
        let outside = tempfile::tempdir().unwrap();
        let alias = outside.path().join("repository");
        std::os::unix::fs::symlink(root.path(), &alias).unwrap();
        let error = audit_no_handwritten_lean(&alias).unwrap_err();
        assert!(error.to_string().contains("symlink ancestor"));

        let vendor = root.path().join("vendor");
        let external_vendor = outside.path().join("vendor");
        std::fs::rename(&vendor, &external_vendor).unwrap();
        std::os::unix::fs::symlink(&external_vendor, &vendor).unwrap();
        let error = audit_no_handwritten_lean(root.path()).unwrap_err();
        assert!(error.to_string().contains("symlink ancestor"));
    }
}
