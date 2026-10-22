//! One fresh acquisition boundary for the pinned Lean exporter package.

mod custody;
pub(crate) mod directory;
mod owner;

pub(crate) use owner::validate_binding as validate_owner_binding;
pub(crate) use owner::validate_record as validate_owner_record;
pub(crate) use owner::{GenerationContext, Phase, ProductEvidence, VerifyExporterOwner};

use crate::error::PrismError;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};
use std::path::Path;

const ARCHIVE: &[u8] = include_bytes!("../vendor/lean4-prod/lean.tar");

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ExecutableMeasurement {
    pub(crate) byte_length: u64,
    pub(crate) mode: u32,
    pub(crate) sha256: String,
}

/// Measure the actual child executable, not the Lake launcher. Reject aliases,
/// hard links, unbounded inputs and concurrent replacement before execution.
pub(crate) fn measure_executable(path: &Path) -> Result<ExecutableMeasurement, PrismError> {
    let fail = || {
        PrismError::new(
            "PP5008",
            "exporter executable is missing, aliased, oversized, non-executable, or changed",
        )
    };
    if path.canonicalize().map_err(|_| fail())? != path {
        return Err(fail());
    }
    let before = std::fs::symlink_metadata(path).map_err(|_| fail())?;
    if !before.is_file() || before.len() == 0 || before.len() > 256 * 1024 * 1024 {
        return Err(fail());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
        if before.nlink() != 1 || before.mode() & 0o111 == 0 || before.mode() & 0o7000 != 0 {
            return Err(fail());
        }
        options.custom_flags(
            (rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32,
        );
    }
    let mut file = options.open(path).map_err(|_| fail())?;
    let same = |metadata: &std::fs::Metadata| {
        let common = metadata.is_file()
            && metadata.len() == before.len()
            && metadata.modified().ok() == before.modified().ok();
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            common
                && metadata.dev() == before.dev()
                && metadata.ino() == before.ino()
                && metadata.nlink() == 1
                && metadata.mode() == before.mode()
                && metadata.ctime() == before.ctime()
                && metadata.ctime_nsec() == before.ctime_nsec()
        }
        #[cfg(not(unix))]
        {
            common
        }
    };
    if !same(&file.metadata().map_err(|_| fail())?) {
        return Err(fail());
    }
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut length = 0_u64;
    loop {
        let count = file.read(&mut buffer).map_err(|_| fail())?;
        if count == 0 {
            break;
        }
        length += count as u64;
        if length > before.len() {
            return Err(fail());
        }
        hash.update(&buffer[..count]);
    }
    if length != before.len()
        || !same(&file.metadata().map_err(|_| fail())?)
        || !same(&std::fs::symlink_metadata(path).map_err(|_| fail())?)
        || path.canonicalize().map_err(|_| fail())? != path
    {
        return Err(fail());
    }
    #[cfg(unix)]
    let mode = {
        use std::os::unix::fs::MetadataExt;
        before.mode() & 0o777
    };
    #[cfg(not(unix))]
    let mode = 0;
    Ok(ExecutableMeasurement {
        byte_length: length,
        mode,
        sha256: format!("{:x}", hash.finalize()),
    })
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ExporterExecution {
    pub(crate) schema: &'static str,
    pub(crate) source_archive_sha256: String,
    pub(crate) executable: ExecutableMeasurement,
    pub(crate) acquisition: serde_json::Value,
}

/// Every invocation still goes through actual `lake exe prod-export` after the
/// ordinary build. Measurement refuses an executable that changed across it.
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_export_with_custody(
    tool: &str,
    program: &Path,
    args: &[String],
    cwd: &Path,
    environment: &std::collections::BTreeMap<String, String>,
    replacements: &[(&Path, &str)],
    failure_code: &'static str,
    acquisition: &serde_json::Value,
    expected: &custody::Snapshot,
) -> Result<crate::verification::ProcessRecord, PrismError> {
    if args.first().map(String::as_str) != Some("exe")
        || args.get(1).map(String::as_str) != Some("prod-export")
    {
        return Err(PrismError::new(
            "PP9001",
            "exporter invocation must use the actual Lake executable path",
        ));
    }
    let child = cwd.join(".lake/build/bin/prod-export");
    let package_before = custody::capture(cwd)?;
    if &package_before != expected {
        return Err(PrismError::new(
            "PP5008",
            "original exporter custody changed before invocation",
        ));
    }
    let identity_before = std::fs::symlink_metadata(&child)
        .map_err(|error| PrismError::new("PP5008", error.to_string()))?;
    let before = measure_executable(&child)?;
    validate_acquisition(acquisition, &before.sha256)?;
    let result = crate::verification::run_process(
        tool,
        program,
        args,
        cwd,
        environment,
        replacements,
        failure_code,
    );
    if custody::capture(cwd)? != package_before {
        return Err(PrismError::new(
            "PP5008",
            "exporter package changed during execution",
        ));
    }
    if measure_executable(&child)? != before {
        return Err(PrismError::new(
            "PP5008",
            "exporter executable changed during execution",
        ));
    }
    let identity_after = std::fs::symlink_metadata(&child)
        .map_err(|error| PrismError::new("PP5008", error.to_string()))?;
    let same_identity = identity_before.modified().ok() == identity_after.modified().ok();
    #[cfg(unix)]
    let same_identity = {
        use std::os::unix::fs::MetadataExt;
        same_identity
            && identity_before.dev() == identity_after.dev()
            && identity_before.ino() == identity_after.ino()
            && identity_before.ctime() == identity_after.ctime()
            && identity_before.ctime_nsec() == identity_after.ctime_nsec()
    };
    if !same_identity {
        return Err(PrismError::new(
            "PP5008",
            "exporter executable identity changed during execution",
        ));
    }
    // Failure is not an exemption from custody. Preserve the original process
    // diagnostic only after the actual executable still passes both checks.
    let mut record = result?;
    record.exporter = Some(ExporterExecution {
        schema: "prismpm/exporter-execution/1",
        source_archive_sha256: format!("{:x}", Sha256::digest(ARCHIVE)),
        executable: before,
        acquisition: acquisition.clone(),
    });
    Ok(record)
}

/// Materialize the compiled-in source in a new, caller-owned private directory.
/// This is deliberately a cold acquisition: no caller-selected Lake cache is
/// consulted, and callers must still execute the actual exporter build.
pub(crate) fn acquire(destination: &Path) -> Result<(), PrismError> {
    custody::validate_archive()?;
    std::fs::create_dir(destination)
        .map_err(|error| PrismError::new("PP5008", format!("fresh exporter directory: {error}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(destination, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| PrismError::new("PP5008", error.to_string()))?;
    }
    tar::Archive::new(Cursor::new(ARCHIVE))
        .unpack(destination)
        .map_err(|error| PrismError::new("PP5008", format!("pinned exporter archive: {error}")))?;
    if !destination.join("Prod/Export.lean").is_file() || destination.join(".lake").exists() {
        return Err(PrismError::new(
            "PP5008",
            "pinned exporter source is incomplete or contains build state",
        ));
    }
    Ok(())
}

pub(crate) fn cold_acquisition() -> serde_json::Value {
    serde_json::json!({"schema":"prismpm/exporter-acquisition/1","mode":"cold"})
}

pub(crate) fn validate_acquisition(
    value: &serde_json::Value,
    executable: &str,
) -> Result<(), PrismError> {
    let fail = || PrismError::new("PP5008", "exporter acquisition evidence is invalid");
    if value == &cold_acquisition() {
        return Ok(());
    }
    let fields = [
        "archive_sha256",
        "compiler_revision",
        "executable_sha256",
        "inventory_sha256",
        "manifest_sha256",
        "mode",
        "platform",
        "schema",
        "toolchain",
    ];
    let object = value.as_object().ok_or_else(fail)?;
    if object.keys().map(String::as_str).ne(fields)
        || value["schema"] != "prismpm/exporter-acquisition/1"
        || value["mode"] != "sdk-seed"
        || value["archive_sha256"] != format!("{:x}", Sha256::digest(ARCHIVE))
        || value["executable_sha256"] != executable
    {
        return Err(fail());
    }
    for field in ["inventory_sha256", "manifest_sha256", "executable_sha256"] {
        let digest = value[field].as_str().ok_or_else(fail)?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(fail());
        }
    }
    let (revision, toolchain) = compiler_identity()?;
    if value["compiler_revision"] != revision
        || value["toolchain"] != toolchain
        || !matches!(
            value["platform"].as_str(),
            Some("linux/amd64" | "linux/arm64")
        )
    {
        return Err(fail());
    }
    Ok(())
}

fn compiler_identity() -> Result<(String, String), PrismError> {
    let register: toml::Value = toml::from_str(include_str!("../model/dependencies.toml"))
        .map_err(|error| PrismError::new("PP9001", error.to_string()))?;
    let row = register["dependency"]
        .as_array()
        .and_then(|rows| {
            rows.iter()
                .find(|row| row["id"].as_str() == Some("lean4-prod"))
        })
        .ok_or_else(|| PrismError::new("PP9001", "compiler dependency is missing"))?;
    Ok((
        row["revision"]
            .as_str()
            .ok_or_else(|| PrismError::new("PP9001", "compiler revision is missing"))?
            .to_owned(),
        format!(
            "leanprover/lean4:v{}",
            row["lean_version"]
                .as_str()
                .ok_or_else(|| PrismError::new("PP9001", "compiler toolchain is missing"))?
        ),
    ))
}

/// Source-free receipts need the independently retained SDK lock as context;
/// syntax-valid hashes in the receipt itself cannot authenticate a seed.
pub(crate) fn validate_acquisition_authority(
    value: &serde_json::Value,
    executable: &str,
    sdk_lock: &serde_json::Value,
) -> Result<(), PrismError> {
    validate_acquisition(value, executable)?;
    if value == &cold_acquisition() {
        return Ok(());
    }
    let fail = || {
        PrismError::new(
            "PP5008",
            "exporter receipt differs from independent SDK authority",
        )
    };
    let lock =
        crate::contracts::CanonicalDocument::from_value("prismpm/sdk-lock/2", sdk_lock.clone())?;
    let row = lock.value()["platforms"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["platform"] == value["platform"]))
        .ok_or_else(fail)?;
    if row["inventory_digest"]
        != format!(
            "sha256:{}",
            value["inventory_sha256"].as_str().ok_or_else(fail)?
        )
    {
        return Err(fail());
    }
    let artifacts = row["inventory"].as_array().ok_or_else(fail)?;
    for expected in [
        serde_json::json!({"id":"lean4-prod-exporter-seed","kind":"dependency-lock","version":"1",
            "digest":format!("sha256:{}",value["manifest_sha256"].as_str().ok_or_else(fail)?)}),
        serde_json::json!({"id":"lean4-prod-exporter","kind":"binary","version":value["compiler_revision"],
            "digest":format!("sha256:{executable}")}),
    ] {
        let matches: Vec<_> = artifacts
            .iter()
            .filter(|row| row["id"] == expected["id"])
            .collect();
        if matches.len() != 1 || matches[0] != &expected {
            return Err(fail());
        }
    }
    Ok(())
}

/// Only the independently bound installed SDK can seed a fresh exporter. A
/// private same-filesystem stage is published atomically without overwriting.
#[cfg(test)]
pub(crate) fn acquire_for(
    project: &Path,
    destination: &Path,
) -> Result<serde_json::Value, PrismError> {
    acquire_for_owned(project, destination, Default::default())
        .map(|acquisition| acquisition.receipt)
}

pub(crate) struct Acquisition {
    pub(crate) receipt: serde_json::Value,
    pub(crate) snapshot: custody::Snapshot,
}

pub(crate) fn before_first_build(
    project: &Path,
    package: &Path,
    receipt: &serde_json::Value,
    expected: &custody::Snapshot,
) -> Result<(), PrismError> {
    if receipt == &cold_acquisition() {
        if custody::capture_source(package)? != *expected {
            return Err(PrismError::new(
                "PP5008",
                "cold exporter custody changed before first build",
            ));
        }
        return Ok(());
    }
    let child = measure_executable(&package.join(".lake/build/bin/prod-export"))?;
    validate_acquisition_authority(
        receipt,
        &child.sha256,
        crate::sdk::execution_lock(project)?.value(),
    )?;
    let bytes = crate::sdk::exporter_seed_manifest_bytes()?;
    if receipt["manifest_sha256"] != format!("{:x}", Sha256::digest(&bytes)) {
        return Err(PrismError::new(
            "PP5008",
            "seed manifest changed before first build",
        ));
    }
    let manifest: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| PrismError::new("PP5008", error.to_string()))?;
    if custody::authenticate_seed(package, true, &manifest["files"])? != *expected {
        return Err(PrismError::new(
            "PP5008",
            "authenticated seed custody changed before first build",
        ));
    }
    Ok(())
}

pub(crate) fn after_build(
    package: &Path,
    receipt: &serde_json::Value,
    before: &custody::Snapshot,
) -> Result<custody::Snapshot, PrismError> {
    let after = custody::capture(package)?;
    let unchanged = if receipt == &cold_acquisition() {
        before.same_source(&after)
    } else {
        before.same_compiler(&after)
    };
    if !unchanged {
        return Err(PrismError::new(
            "PP5008",
            "original exporter source or seed custody changed during build",
        ));
    }
    Ok(after)
}

pub(crate) fn acquire_for_owned(
    project: &Path,
    destination: &Path,
    scope: directory::Scope,
) -> Result<Acquisition, PrismError> {
    acquire_for_owned_inner(project, destination, scope.clone()).inspect_err(|_| scope.uncertain())
}

fn acquire_for_owned_inner(
    project: &Path,
    destination: &Path,
    scope: directory::Scope,
) -> Result<Acquisition, PrismError> {
    acquire(destination)?;
    let Some(inventory) = crate::sdk::exporter_seed_inventory(project)? else {
        return Ok(Acquisition {
            receipt: cold_acquisition(),
            snapshot: custody::capture_source(destination)?,
        });
    };
    let parent = destination
        .parent()
        .ok_or_else(|| PrismError::new("PP5008", "exporter parent is absent"))?;
    let lock = crate::sdk::execution_lock(project)?;
    let target = directory::Directory::existing(destination, scope.clone())?;
    let mut stage =
        directory::Directory::temporary(".exporter-seed-", Some(parent), scope.clone())?;
    let mut helper =
        directory::Directory::temporary("prismpm-exporter-admission-", None, scope.clone())?;
    for (name, bytes) in [
        (
            "exporter-seed-admission.mjs",
            include_bytes!("../sdk/exporter-seed-admission.mjs").as_slice(),
        ),
        (
            "exporter-seed.mjs",
            include_bytes!("../sdk/exporter-seed.mjs").as_slice(),
        ),
        (
            "inventory-metadata.mjs",
            include_bytes!("../sdk/inventory-metadata.mjs").as_slice(),
        ),
    ] {
        helper.write_file(name, bytes)?;
    }
    let (revision, toolchain) = compiler_identity()?;
    let result = crate::verification::run_process_limited(
        "exporter-seed-admission",
        &crate::sdk::executable("node")?,
        &[
            helper
                .path()
                .join("exporter-seed-admission.mjs")
                .to_string_lossy()
                .into_owned(),
            destination.to_string_lossy().into_owned(),
            stage.path().to_string_lossy().into_owned(),
            inventory.clone(),
            revision,
            format!("{:x}", Sha256::digest(ARCHIVE)),
            toolchain,
            serde_json::to_string(&stage.stage_identity()?)
                .map_err(|error| PrismError::new("PP5008", error.to_string()))?,
        ],
        helper.path(),
        &std::collections::BTreeMap::new(),
        &[],
        "PP5008",
        "180s",
        16 * 1024 * 1024,
    );
    // A failed or interrupted copy may have uncertain namespace custody. All
    // enclosing directory owners share this conservative retirement latch.
    let result = result.inspect_err(|_| scope.uncertain())?;
    let handoff: serde_json::Value = serde_json::from_str(&result.stdout).map_err(|error| {
        scope.uncertain();
        PrismError::new("PP5008", error.to_string())
    })?;
    if handoff.as_object().is_none_or(|object| {
        object
            .keys()
            .map(String::as_str)
            .ne(["acquisition", "manifest_document"])
    }) {
        scope.uncertain();
        return Err(PrismError::new("PP5008", "exporter handoff is not closed"));
    }
    let receipt = handoff["acquisition"].clone();
    if receipt == cold_acquisition() {
        if !handoff["manifest_document"].is_null() {
            scope.uncertain();
            return Err(PrismError::new(
                "PP5008",
                "cold exporter supplied seeded evidence",
            ));
        }
        stage.expect_empty()?;
        stage.close()?;
        helper.close()?;
        return Ok(Acquisition {
            receipt,
            snapshot: custody::capture_source(destination)?,
        });
    }
    let publish = || {
        stage.ready()?;
        target.ready()?;
        let child = measure_executable(&stage.path().join(".lake/build/bin/prod-export"))?;
        validate_acquisition_authority(&receipt, &child.sha256, lock.value())?;
        if receipt["inventory_sha256"] != inventory
            || crate::sdk::execution_lock(project)?.digest() != lock.digest()
        {
            return Err(PrismError::new(
                "PP5008",
                "seed inventory authority changed",
            ));
        }
        let bytes = handoff["manifest_document"]
            .as_str()
            .filter(|bytes| bytes.len() <= 8 * 1024 * 1024)
            .ok_or_else(|| {
                PrismError::new("PP5008", "bounded original seed manifest is missing")
            })?;
        if receipt["manifest_sha256"] != format!("{:x}", Sha256::digest(bytes.as_bytes())) {
            return Err(PrismError::new(
                "PP5008",
                "seed handoff manifest differs from SDK authority",
            ));
        }
        let manifest: serde_json::Value = serde_json::from_str(bytes)
            .map_err(|error| PrismError::new("PP5008", error.to_string()))?;
        let mut canonical = crate::holo::canonical::encode_value(&manifest)?;
        canonical.push(b'\n');
        if canonical != bytes.as_bytes() || manifest["schema"] != "prismpm/exporter-seed/1" {
            return Err(PrismError::new(
                "PP5008",
                "seed handoff manifest is not original canonical metadata",
            ));
        }
        let before = custody::authenticate_seed(stage.path(), false, &manifest["files"])?;
        stage.ready()?;
        target.ready()?;
        if custody::authenticate_seed(stage.path(), false, &manifest["files"])? != before {
            return Err(PrismError::new(
                "PP5008",
                "seed custody changed before publication",
            ));
        }
        stage.publish_lake(&target)?;
        let after = custody::authenticate_seed(destination, true, &manifest["files"])?;
        if !before.same_relocated_seed(&after) {
            return Err(PrismError::new(
                "PP5008",
                "authenticated seed descendant custody changed across publication",
            ));
        }
        stage.ready()?;
        target.ready()?;
        Ok::<_, PrismError>(after)
    };
    let snapshot = publish().inspect_err(|_| scope.uncertain())?;
    stage.expect_empty()?;
    stage.close()?;
    helper.close()?;
    Ok(Acquisition { receipt, snapshot })
}

/// A repository-backed verifier must use the same pinned source as builders.
pub(crate) fn verify_source(repository_root: &Path) -> Result<(), PrismError> {
    let fail = || {
        PrismError::new("PP5008", "repository exporter archive is missing, aliased, changed, or differs from the compiled pin")
    };
    let path = repository_root.join("vendor/lean4-prod/lean.tar");
    if path.canonicalize().map_err(|_| fail())? != path {
        return Err(fail());
    }
    let before = std::fs::symlink_metadata(&path).map_err(|_| fail())?;
    if !before.is_file() || before.len() != ARCHIVE.len() as u64 {
        return Err(fail());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
        if before.nlink() != 1 {
            return Err(fail());
        }
        options.custom_flags(
            (rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32,
        );
    }
    let mut file = options.open(&path).map_err(|_| fail())?;
    let same = |metadata: &std::fs::Metadata| {
        let common = metadata.is_file()
            && metadata.len() == before.len()
            && metadata.modified().ok() == before.modified().ok();
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            common
                && metadata.dev() == before.dev()
                && metadata.ino() == before.ino()
                && metadata.nlink() == 1
                && metadata.mode() == before.mode()
                && metadata.ctime() == before.ctime()
                && metadata.ctime_nsec() == before.ctime_nsec()
        }
        #[cfg(not(unix))]
        {
            common
        }
    };
    if !same(&file.metadata().map_err(|_| fail())?) {
        return Err(fail());
    }
    let mut bytes = Vec::with_capacity(ARCHIVE.len());
    file.by_ref()
        .take(ARCHIVE.len() as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| fail())?;
    if !same(&file.metadata().map_err(|_| fail())?)
        || !same(&std::fs::symlink_metadata(&path).map_err(|_| fail())?)
        || path.canonicalize().map_err(|_| fail())? != path
    {
        return Err(fail());
    }
    if bytes != ARCHIVE {
        return Err(PrismError::new(
            "PP5008",
            "repository exporter archive differs from the compiled pin",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unlocked_acquisition_is_fresh_and_cold() {
        let root = tempfile::tempdir().unwrap();
        let package = root.path().join("compiler");
        assert_eq!(
            acquire_for(root.path(), &package).unwrap(),
            cold_acquisition()
        );
        assert!(!package.join(".lake").exists());
        assert!(acquire_for(root.path(), &package).is_err());
        assert!(package.join("Prod/Export.lean").is_file());
    }

    #[test]
    fn warm_exporter_receipts_bind_the_independent_platform_inventory() {
        use serde_json::json;
        // Parser fixtures, never compiler execution or SDK acceptance.
        let (revision, toolchain) = compiler_identity().unwrap();
        let child = "a".repeat(64);
        let artifacts = json!([
            {"id":"lean4-prod-exporter","kind":"binary","version":revision,"digest":format!("sha256:{child}")},
            {"id":"lean4-prod-exporter-seed","kind":"dependency-lock","version":"1","digest":format!("sha256:{}","b".repeat(64))}
        ]);
        let document = String::from_utf8(crate::holo::canonical::encode_value(&json!({
            "schema":"prismpm/sdk-inventory/1","artifacts":artifacts,
            "commands":[{"command":"lake","executable":"/usr/local/bin/lake","sha256":"c".repeat(64)}]
        })).unwrap()).unwrap();
        let inventory = format!("{:x}", Sha256::digest(document.as_bytes()));
        let manifests: Vec<_> = ["amd64","arm64"].iter().enumerate().map(|(i, arch)| json!({
            "digest":format!("sha256:{}",(i+1).to_string().repeat(64)),"size":100,
            "mediaType":"application/vnd.oci.image.manifest.v1+json","platform":{"os":"linux","architecture":arch}
        })).collect();
        let index = String::from_utf8(crate::holo::canonical::encode_value(&json!({
            "schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":manifests
        })).unwrap()).unwrap();
        let platforms: Vec<_> = ["amd64","arm64"].iter().enumerate().map(|(i,arch)|json!({
            "platform":format!("linux/{arch}"),"manifest_digest":manifests[i]["digest"],
            "inventory_digest":format!("sha256:{inventory}"),"inventory_document":document,"inventory":artifacts
        })).collect();
        let lock = json!({"schema":"prismpm/sdk-lock/2","sdk_version":"0.3.0",
            "sdk_image":format!("example.invalid/fixture@sha256:{:x}",Sha256::digest(index.as_bytes())),
            "sdk_index":index,"standards_lock":format!("sha256:{}","d".repeat(64)),"platforms":platforms});
        let receipt = json!({"schema":"prismpm/exporter-acquisition/1","mode":"sdk-seed",
            "compiler_revision":revision,"toolchain":toolchain,"platform":"linux/amd64",
            "archive_sha256":format!("{:x}",Sha256::digest(ARCHIVE)),"inventory_sha256":inventory,
            "manifest_sha256":"b".repeat(64),"executable_sha256":child});
        validate_acquisition_authority(&receipt, &child, &lock).unwrap();
        for key in [
            "inventory_sha256",
            "manifest_sha256",
            "executable_sha256",
            "archive_sha256",
            "compiler_revision",
            "toolchain",
            "platform",
            "mode",
            "schema",
        ] {
            let mut changed = receipt.clone();
            changed[key] = json!("e".repeat(64));
            assert!(
                validate_acquisition_authority(&changed, &child, &lock).is_err(),
                "accepted {key}"
            );
        }
        let mut changed = receipt.clone();
        changed["extra"] = json!(true);
        assert!(validate_acquisition_authority(&changed, &child, &lock).is_err());
        assert!(validate_acquisition_authority(&receipt, &child, &json!({})).is_err());
        for (index, key, value) in [
            (0, "kind", "crate"),
            (0, "version", "wrong"),
            (1, "kind", "binary"),
            (1, "version", "2"),
        ] {
            let mut changed = lock.clone();
            for row in changed["platforms"].as_array_mut().unwrap() {
                row["inventory"][index][key] = json!(value);
                let mut doc: serde_json::Value =
                    serde_json::from_str(row["inventory_document"].as_str().unwrap()).unwrap();
                doc["artifacts"] = row["inventory"].clone();
                let bytes = crate::holo::canonical::encode_value(&doc).unwrap();
                row["inventory_digest"] = json!(format!("sha256:{:x}", Sha256::digest(&bytes)));
                row["inventory_document"] = json!(String::from_utf8(bytes).unwrap());
            }
            let mut resealed = receipt.clone();
            resealed["inventory_sha256"] = json!(changed["platforms"][0]["inventory_digest"]
                .as_str()
                .unwrap()
                .strip_prefix("sha256:")
                .unwrap());
            assert!(
                validate_acquisition_authority(&resealed, &child, &changed).is_err(),
                "accepted resealed {index}/{key}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn invocation_refuses_preexisting_compiled_replacement_without_launching_child() {
        use std::os::unix::fs::PermissionsExt;
        // Actual filesystem and process-boundary refusal, not compiler acceptance.
        let work = tempfile::tempdir().unwrap();
        let root = work.path().join("exporter");
        acquire(&root).unwrap();
        std::fs::create_dir_all(root.join(".lake/build/bin")).unwrap();
        std::fs::create_dir_all(root.join(".lake/build/lib/lean")).unwrap();
        let executable = root.join(".lake/build/bin/prod-export");
        std::fs::write(&executable, b"#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let compiled = root.join(".lake/build/lib/lean/Prod.olean");
        let bytes = b"compiled identity fixture, never accepted as Lean output";
        std::fs::write(&compiled, bytes).unwrap();
        let expected = custody::capture(&root).unwrap();
        let original_executable = measure_executable(&executable).unwrap();
        let retired = work.path().join("original-compiled");
        std::fs::rename(&compiled, &retired).unwrap();
        std::fs::write(&compiled, bytes).unwrap();
        let launcher = work.path().join("lake");
        std::fs::write(
            &launcher,
            b"#!/bin/sh\nprintf executed > ../child-executed\n",
        )
        .unwrap();
        std::fs::set_permissions(&launcher, std::fs::Permissions::from_mode(0o755)).unwrap();
        let error = run_export_with_custody(
            "exporter-preinvocation-test",
            &launcher,
            &["exe".to_owned(), "prod-export".to_owned()],
            &root,
            &std::collections::BTreeMap::new(),
            &[],
            "PP5004",
            &cold_acquisition(),
            &expected,
        )
        .unwrap_err();
        assert_eq!(error.code, "PP5008");
        assert!(!work.path().join("child-executed").exists());
        assert_eq!(
            measure_executable(&executable).unwrap(),
            original_executable
        );
        assert_eq!(std::fs::read(&compiled).unwrap(), bytes);
        assert_eq!(std::fs::read(&retired).unwrap(), bytes);
    }

    #[cfg(unix)]
    #[test]
    fn invocation_guard_rejects_actual_child_mutation_and_same_bytes_replacement() {
        use std::os::unix::fs::PermissionsExt;
        // Real process boundary fixture, not Lean/compiler acceptance. The
        // production conformance cases separately execute actual Lake exports.
        let work = tempfile::tempdir().unwrap();
        let root = work.path().join("exporter");
        acquire(&root).unwrap();
        std::fs::create_dir_all(root.join(".lake/build/bin")).unwrap();
        let child = root.join(".lake/build/bin/prod-export");
        let launcher = work.path().join("lake");
        std::fs::write(&launcher, b"#!/bin/sh\n./.lake/build/bin/prod-export\n").unwrap();
        std::fs::set_permissions(&launcher, std::fs::Permissions::from_mode(0o755)).unwrap();
        let original = b"#!/bin/sh\nexit 0\n";
        std::fs::write(&child, original).unwrap();
        std::fs::set_permissions(&child, std::fs::Permissions::from_mode(0o755)).unwrap();
        let invoke = || {
            let snapshot = custody::capture(&root)?;
            run_export_with_custody(
                "exporter-identity-test",
                &launcher,
                &["exe".to_owned(), "prod-export".to_owned()],
                &root,
                &std::collections::BTreeMap::new(),
                &[],
                "PP5004",
                &cold_acquisition(),
                &snapshot,
            )
        };
        let record = invoke().unwrap();
        assert_eq!(
            record.exporter.unwrap().executable,
            measure_executable(&child).unwrap()
        );
        std::fs::write(
            &launcher,
            b"#!/bin/sh\n./.lake/build/bin/prod-export\nprintf genuine-failure >&2\nexit 7\n",
        )
        .unwrap();
        let error = invoke().unwrap_err();
        assert_eq!(error.code, "PP5004");
        assert!(error.message.contains("exited 7"));
        assert!(error.message.contains("genuine-failure"));
        for exit in [0, 7] {
            for mutation in [
                "printf changed > .lake/build/bin/prod-export",
                "cp -p .lake/build/bin/prod-export replacement\nmv replacement .lake/build/bin/prod-export",
                "rm .lake/build/bin/prod-export",
                "chmod 644 .lake/build/bin/prod-export",
            ] {
                std::fs::write(&child, original).unwrap();
                std::fs::set_permissions(&child, std::fs::Permissions::from_mode(0o755)).unwrap();
                std::fs::write(&launcher, format!(
                    "#!/bin/sh\n./.lake/build/bin/prod-export\n{mutation}\nexit {exit}\n"
                )).unwrap();
                assert_eq!(invoke().unwrap_err().code, "PP5008", "exit {exit}: {mutation}");
            }
        }
        // The selected executable is not the whole Lake execution input. A
        // changed configuration, source or build input must also fail even
        // when the executable stays byte-for-byte and inode-for-inode intact.
        std::fs::write(&child, original).unwrap();
        std::fs::set_permissions(&child, std::fs::Permissions::from_mode(0o755)).unwrap();
        let toolchain = std::fs::read(root.join("lean-toolchain")).unwrap();
        for exit in [0, 7] {
            for mutation in [
                "printf changed >> lean-toolchain",
                "cp -p lean-toolchain replacement\nmv replacement lean-toolchain",
                "printf added > .lake/build/extra",
            ] {
                std::fs::write(root.join("lean-toolchain"), &toolchain).unwrap();
                let extra = root.join(".lake/build/extra");
                if extra.exists() {
                    std::fs::remove_file(extra).unwrap();
                }
                std::fs::write(
                    &launcher,
                    format!("#!/bin/sh\n./.lake/build/bin/prod-export\n{mutation}\nexit {exit}\n"),
                )
                .unwrap();
                let result = invoke();
                assert!(
                    result.is_err(),
                    "accepted package mutation exit {exit}: {mutation}"
                );
                assert_eq!(
                    result.unwrap_err().code,
                    "PP5008",
                    "package exit {exit}: {mutation}"
                );
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn exporter_measurement_binds_the_actual_file_and_refuses_unsafe_inputs() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("prod-export");
        std::fs::write(&path, b"measurement fixture, not executed").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let before = measure_executable(&path).unwrap();
        assert_eq!(before.byte_length, 33);
        assert_eq!(before.mode, 0o755);
        std::fs::write(&path, b"different measurement fixture...").unwrap();
        assert_ne!(measure_executable(&path).unwrap(), before);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(measure_executable(&path).unwrap_err().code, "PP5008");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o4755)).unwrap();
        assert!(measure_executable(&path).is_err());
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let alias = root.path().join("alias");
        symlink(&path, &alias).unwrap();
        assert!(measure_executable(&alias).is_err());
        std::fs::remove_file(&alias).unwrap();
        std::fs::hard_link(&path, &alias).unwrap();
        assert!(measure_executable(&path).is_err());
        std::fs::remove_file(&alias).unwrap();
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_len(8 * 1024 * 1024 * 1024).unwrap();
        assert!(measure_executable(&path).is_err());
        file.set_len(0).unwrap();
        assert!(measure_executable(&path).is_err());
        std::fs::remove_file(&path).unwrap();
        assert!(measure_executable(&path).is_err());
    }

    #[test]
    fn fresh_acquisition_has_sources_but_no_cached_acceptance() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("first");
        let second = root.path().join("second");
        acquire(&first).unwrap();
        acquire(&second).unwrap();
        assert_eq!(
            std::fs::read(first.join("Prod/Export.lean")).unwrap(),
            std::fs::read(second.join("Prod/Export.lean")).unwrap()
        );
        assert!(!first.join(".lake").exists());
        assert!(!second.join(".lake").exists());
        std::fs::write(first.join("sentinel"), b"retain").unwrap();
        assert!(acquire(&first).is_err());
        assert_eq!(std::fs::read(first.join("sentinel")).unwrap(), b"retain");
    }

    #[test]
    fn repository_source_must_equal_compiled_pin() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("vendor/lean4-prod")).unwrap();
        let archive = root.path().join("vendor/lean4-prod/lean.tar");
        std::fs::write(&archive, ARCHIVE).unwrap();
        verify_source(root.path()).unwrap();
        let mut changed = ARCHIVE.to_vec();
        changed[0] ^= 1;
        std::fs::write(&archive, changed).unwrap();
        assert_eq!(verify_source(root.path()).unwrap_err().code, "PP5008");
        std::fs::write(&archive, b"not the registered compiler").unwrap();
        assert_eq!(verify_source(root.path()).unwrap_err().code, "PP5008");
        let file = std::fs::File::create(&archive).unwrap();
        file.set_len(8 * 1024 * 1024 * 1024).unwrap();
        assert_eq!(verify_source(root.path()).unwrap_err().code, "PP5008");
        std::fs::remove_file(&archive).unwrap();
        assert_eq!(verify_source(root.path()).unwrap_err().code, "PP5008");
    }

    #[cfg(unix)]
    #[test]
    fn repository_source_rejects_aliases_and_hard_links() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("vendor/lean4-prod")).unwrap();
        let archive = root.path().join("vendor/lean4-prod/lean.tar");
        let retained = root.path().join("retained");
        std::fs::write(&retained, ARCHIVE).unwrap();
        std::os::unix::fs::symlink(&retained, &archive).unwrap();
        assert_eq!(verify_source(root.path()).unwrap_err().code, "PP5008");
        std::fs::remove_file(&archive).unwrap();
        std::fs::hard_link(&retained, &archive).unwrap();
        assert_eq!(verify_source(root.path()).unwrap_err().code, "PP5008");
    }

    #[cfg(unix)]
    #[test]
    fn acquisition_refuses_existing_alias_or_file() {
        let root = tempfile::tempdir().unwrap();
        let actual = root.path().join("actual");
        std::fs::create_dir(&actual).unwrap();
        let alias = root.path().join("alias");
        std::os::unix::fs::symlink(&actual, &alias).unwrap();
        assert!(acquire(&alias).is_err());
        assert_eq!(std::fs::read_dir(&actual).unwrap().count(), 0);
        let file = root.path().join("file");
        std::fs::write(&file, b"retain").unwrap();
        assert!(acquire(&file).is_err());
        assert_eq!(std::fs::read(file).unwrap(), b"retain");
    }
}
