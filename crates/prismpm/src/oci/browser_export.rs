//! Source-free browser projection export. Integrity is not deployment authority.

use super::*;

fn output_name(output: &Path) -> Result<&str, PrismError> {
    let name = output
        .to_str()
        .ok_or_else(|| unsafe_path("export name is not UTF-8"))?;
    if name.is_empty()
        || name.len() > 128
        || !name.as_bytes()[0].is_ascii_alphanumeric()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(unsafe_path(
            "export output must be one new portable directory name",
        ));
    }
    Ok(name)
}

fn unsafe_path(message: impl Into<String>) -> PrismError {
    PrismError::new("PP8001", message)
}

fn failure(message: impl Into<String>) -> PrismError {
    PrismError::new("PP6101", message)
}

#[cfg(target_os = "linux")]
use rustix::fs::{AtFlags, Mode, OFlags, RenameFlags};

#[cfg(target_os = "linux")]
fn filesystem_error(error: rustix::io::Errno) -> PrismError {
    if matches!(error, rustix::io::Errno::LOOP | rustix::io::Errno::NOTDIR) {
        unsafe_path("export path contains a link or a non-directory ancestor")
    } else {
        failure(format!("browser export filesystem operation: {error}"))
    }
}

#[cfg(target_os = "linux")]
fn directory_flags() -> OFlags {
    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC
}

#[cfg(target_os = "linux")]
fn child_directory(parent: &File, name: &std::ffi::OsStr) -> Result<File, PrismError> {
    rustix::fs::openat(parent, name, directory_flags(), Mode::empty())
        .map(File::from)
        .map_err(filesystem_error)
}

#[cfg(target_os = "linux")]
fn open_directory(path: &Path) -> Result<File, PrismError> {
    let start = if path.is_absolute() { "/" } else { "." };
    let mut directory = File::from(
        rustix::fs::open(start, directory_flags(), Mode::empty()).map_err(filesystem_error)?,
    );
    for component in path.components() {
        match component {
            Component::RootDir | Component::CurDir => {}
            Component::Normal(name) => directory = child_directory(&directory, name)?,
            _ => return Err(unsafe_path("export project path contains traversal")),
        }
    }
    Ok(directory)
}

#[cfg(target_os = "linux")]
pub(super) fn read_file(
    directory: &File,
    path: &Path,
    maximum: u64,
) -> Result<Vec<u8>, PrismError> {
    use std::io::Read;
    use std::os::unix::fs::MetadataExt;

    let parts = path.components().collect::<Vec<_>>();
    if parts.is_empty()
        || parts
            .iter()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(unsafe_path("OCI read path is not confined"));
    }
    let mut parent = directory
        .try_clone()
        .map_err(|error| failure(error.to_string()))?;
    for part in &parts[..parts.len() - 1] {
        parent = child_directory(&parent, part.as_os_str())?;
    }
    let name = parts.last().expect("nonempty path").as_os_str();
    let named =
        rustix::fs::statat(&parent, name, AtFlags::SYMLINK_NOFOLLOW).map_err(filesystem_error)?;
    if rustix::fs::FileType::from_raw_mode(named.st_mode) != rustix::fs::FileType::RegularFile
        || named.st_nlink != 1
    {
        return Err(unsafe_path(
            "OCI input must be a singly linked regular file",
        ));
    }
    let file = File::from(
        rustix::fs::openat(
            &parent,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(filesystem_error)?,
    );
    let before = file
        .metadata()
        .map_err(|error| failure(error.to_string()))?;
    if !before.is_file() || before.nlink() != 1 {
        return Err(unsafe_path(
            "OCI input must be a singly linked regular file",
        ));
    }
    if before.len() > maximum {
        return Err(failure("OCI input exceeds the byte limit"));
    }
    if before.dev() != named.st_dev || before.ino() != named.st_ino {
        return Err(failure("OCI input changed before being read"));
    }
    let mut bytes = Vec::new();
    (&file)
        .take(before.len() + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| failure(error.to_string()))?;
    let after = file
        .metadata()
        .map_err(|error| failure(error.to_string()))?;
    if !after.is_file() || after.nlink() != 1 {
        return Err(unsafe_path(
            "OCI input must remain a singly linked regular file",
        ));
    }
    if bytes.len() as u64 != before.len()
        || before.dev() != after.dev()
        || before.ino() != after.ino()
        || before.len() != after.len()
        || before.nlink() != after.nlink()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        return Err(failure("OCI input changed while being read"));
    }
    Ok(bytes)
}

#[cfg(target_os = "linux")]
fn absent(directory: &File, name: &str) -> Result<(), PrismError> {
    match rustix::fs::statat(directory, name, AtFlags::SYMLINK_NOFOLLOW) {
        Err(rustix::io::Errno::NOENT) => Ok(()),
        Ok(_) => Err(unsafe_path("export output already exists")),
        Err(error) => Err(filesystem_error(error)),
    }
}

#[cfg(target_os = "linux")]
fn publication_parent(directory: &File) -> Result<(), PrismError> {
    let metadata = rustix::fs::fstat(directory).map_err(filesystem_error)?;
    if metadata.st_uid != rustix::process::geteuid().as_raw() || metadata.st_mode & 0o022 != 0 {
        return Err(unsafe_path(
            "export parent must be owned by the effective user and not group- or world-writable",
        ));
    }
    Ok(())
}

pub(crate) fn browser_files<T: AsRef<[u8]>>(
    build_files: &BTreeMap<String, T>,
) -> Result<BTreeMap<String, &[u8]>, PrismError> {
    let model: crate::holo::model_document::ModelDocument = serde_json::from_slice(
        build_files
            .get("model.prism.json")
            .ok_or_else(|| failure("verified model is absent"))?
            .as_ref(),
    )
    .map_err(|error| failure(format!("verified model: {error}")))?;
    let application = model
        .application
        .ok_or_else(|| failure("release has no browser application"))?;
    let stem = application.cargo_name().replace('-', "_");
    let files = build_files
        .iter()
        .filter_map(|(path, bytes)| {
            path.strip_prefix("view/browser/")
                .map(|name| (name.to_owned(), bytes.as_ref()))
        })
        .collect::<BTreeMap<_, _>>();
    // Closure v1 (the six-file page) or closure v2 (v1 plus the brand files), exactly.
    if crate::brand::closure_version(&files.keys().cloned().collect::<BTreeSet<_>>(), &stem)
        .is_none()
    {
        return Err(failure(
            "verified browser projection is neither the exact six-file nor the exact closure v2 profile",
        ));
    }
    Ok(files)
}

#[cfg(target_os = "linux")]
struct Staging<'a> {
    parent: &'a File,
    directory: File,
    name: String,
    files: Vec<String>,
    committed: bool,
}

#[cfg(target_os = "linux")]
impl Staging<'_> {
    fn identity_matches(&self) -> bool {
        let Ok(held) = rustix::fs::fstat(&self.directory) else {
            return false;
        };
        let Ok(named) = rustix::fs::statat(self.parent, &self.name, AtFlags::SYMLINK_NOFOLLOW)
        else {
            return false;
        };
        held.st_dev == named.st_dev && held.st_ino == named.st_ino
    }

    fn ready(&self) -> Result<(), PrismError> {
        publication_parent(self.parent)?;
        let metadata = rustix::fs::fstat(&self.directory).map_err(filesystem_error)?;
        if metadata.st_uid != rustix::process::geteuid().as_raw()
            || metadata.st_mode & 0o022 != 0
            || !self.identity_matches()
        {
            return Err(unsafe_path(
                "browser export staging identity or ownership changed",
            ));
        }
        Ok(())
    }

    // Keep the actual name-based commit step separate so its post-rename
    // identity boundary can be exercised with deterministic substitutions.
    fn rename_and_finish(&mut self, output: &str) -> Result<(), PrismError> {
        rustix::fs::renameat_with(
            self.parent,
            &self.name,
            self.parent,
            output,
            RenameFlags::NOREPLACE,
        )
        .map_err(|error| {
            if error == rustix::io::Errno::EXIST {
                unsafe_path("export output already exists")
            } else {
                filesystem_error(error)
            }
        })?;
        self.name = output.to_owned();
        self.ready()?;
        self.parent
            .sync_all()
            .map_err(|error| failure(error.to_string()))?;
        self.ready()?;
        self.committed = true;
        Ok(())
    }
}

#[cfg(target_os = "linux")]
impl Drop for Staging<'_> {
    fn drop(&mut self) {
        if !self.committed {
            // Only operation-created flat files are removed through the held
            // directory descriptor. Never recursively remove a caller path.
            for file in &self.files {
                let _ = rustix::fs::unlinkat(&self.directory, file, AtFlags::empty());
            }
            if self.identity_matches() {
                let _ = rustix::fs::unlinkat(self.parent, &self.name, AtFlags::REMOVEDIR);
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn publish<T: AsRef<[u8]>>(
    parent: &File,
    output: &str,
    files: &BTreeMap<String, T>,
) -> Result<(), PrismError> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SERIAL: AtomicU64 = AtomicU64::new(0);

    publication_parent(parent)?;
    absent(parent, output)?;
    for name in files.keys() {
        if name.is_empty()
            || name.len() > 256
            || !name.as_bytes()[0].is_ascii_alphanumeric()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
        {
            return Err(unsafe_path("browser file is not a portable basename"));
        }
    }
    let mut created = None;
    for _ in 0..32 {
        let name = format!(
            ".prismpm-browser-export-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        );
        match rustix::fs::mkdirat(parent, &name, Mode::RWXU) {
            Ok(()) => {
                created = Some(name);
                break;
            }
            Err(rustix::io::Errno::EXIST) => {}
            Err(error) => return Err(filesystem_error(error)),
        }
    }
    let name = created.ok_or_else(|| failure("browser export staging names are exhausted"))?;
    let directory = match child_directory(parent, std::ffi::OsStr::new(&name)) {
        Ok(directory) => directory,
        Err(error) => {
            let _ = rustix::fs::unlinkat(parent, &name, AtFlags::REMOVEDIR);
            return Err(error);
        }
    };
    let mut staging = Staging {
        parent,
        directory,
        name,
        files: Vec::new(),
        committed: false,
    };
    staging.ready()?;
    for (name, bytes) in files {
        let mut file = File::from(
            rustix::fs::openat(
                &staging.directory,
                name,
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(filesystem_error)?,
        );
        staging.files.push(name.clone());
        file.write_all(bytes.as_ref())
            .map_err(|error| failure(error.to_string()))?;
        rustix::fs::fchmod(&file, Mode::RUSR | Mode::WUSR | Mode::RGRP | Mode::ROTH)
            .map_err(filesystem_error)?;
        file.sync_all()
            .map_err(|error| failure(error.to_string()))?;
    }
    rustix::fs::fchmod(
        &staging.directory,
        Mode::RWXU | Mode::RGRP | Mode::XGRP | Mode::ROTH | Mode::XOTH,
    )
    .map_err(filesystem_error)?;
    staging
        .directory
        .sync_all()
        .map_err(|error| failure(error.to_string()))?;
    staging.ready()?;
    staging.rename_and_finish(output)
}

pub(super) fn export(root: &Path, reference: &str, output: &Path) -> Result<Value, PrismError> {
    let output = output_name(output)?;
    let digest = validate_reference(reference, true)?;
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (root, output, digest);
        Err(failure(
            "browser export requires the Linux SDK filesystem boundary",
        ))
    }
    #[cfg(target_os = "linux")]
    {
        let directory = open_directory(root)?;
        publication_parent(&directory)?;
        absent(&directory, output)?;
        let captured = capture_directory(root, &directory, digest)?;
        let browser = browser_files(&captured.build_files)?;
        let files = browser
            .iter()
            .map(|(path, bytes)| json!({"path":path,"digest":sha(bytes),"size":bytes.len()}))
            .collect::<Vec<_>>();
        let tree_digest = sha(&encode_value(&json!(files))?);
        let result = json!({
            "schema":"prismpm/browser-export/2", "reference":reference,
            "release_digest":captured.state.root.digest,
            "model_digest":sha(&captured.build_files["model.prism.json"]),
            "build_digest":sha(&captured.build_manifest), "output":output,
            "files":files, "tree_digest":tree_digest
        });
        crate::oci::contract_from_value("prismpm/browser-export/2", result.clone())?;
        publish(&directory, output, &browser)?;
        Ok(result)
    }
}

#[cfg(target_os = "linux")]
fn capture_directory(
    root: &Path,
    directory: &File,
    digest: &str,
) -> Result<VerifiedReleaseCapture, PrismError> {
    let prism = child_directory(directory, std::ffi::OsStr::new(".prism"))?;
    let layout = child_directory(&prism, std::ffi::OsStr::new("oci"))?;
    let store = Store {
        root: root.join(".prism/oci"),
        read_root: Some(std::sync::Arc::new(layout)),
    };
    if store.layout_file(Path::new("oci-layout"), 128)? != b"{\"imageLayoutVersion\":\"1.0.0\"}" {
        return Err(failure("OCI layout version changed"));
    }
    require_verified_capture(&store, digest, true)
}

pub(super) fn capture(root: &Path, reference: &str) -> Result<VerifiedReleaseCapture, PrismError> {
    let digest = validate_reference(reference, true)?;
    #[cfg(target_os = "linux")]
    {
        capture_directory(root, &open_directory(root)?, digest)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (root, digest);
        Err(failure(
            "browser publication requires the Linux SDK filesystem boundary",
        ))
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn browser_export_receipt_binds_exact_identity_and_order_without_authority_claims() {
        let files = [
            "app.css",
            "app.js",
            "core.js",
            "core_bg.wasm",
            "index.html",
            "provenance.json",
        ]
        .map(|path| json!({"path":path,"digest":format!("sha256:{}","1".repeat(64)),"size":1}));
        let files = json!(files);
        let digest = format!("sha256:{}", "2".repeat(64));
        let id = "prismpm/browser-export/1";
        let receipt = json!({
            "schema":id,
            "reference":format!("example.test/product@{digest}"),
            "release_digest":digest,
            "model_digest":format!("sha256:{}","3".repeat(64)),
            "build_digest":format!("sha256:{}","4".repeat(64)),
            "tree_digest":format!("sha256:{}",crate::holo::canonical::content_id(&crate::holo::canonical::encode_value(&files).unwrap())),
            "output":"site",
            "files":files,
        });
        crate::oci::contract_from_value(id, receipt.clone()).unwrap();
        for (field, replacement) in [
            ("reference", json!("example.test/product:main")),
            (
                "release_digest",
                json!(format!("sha256:{}", "5".repeat(64))),
            ),
            ("tree_digest", json!(format!("sha256:{}", "6".repeat(64)))),
            ("output", json!("../site")),
            ("output", json!("site/child")),
            ("output", json!(".prism")),
            ("output", json!("")),
            ("authorized", json!(true)),
            ("accepted", json!(true)),
        ] {
            let mut changed = receipt.clone();
            changed[field] = replacement;
            assert!(
                crate::oci::contract_from_value(id, changed).is_err(),
                "accepted changed {field}"
            );
        }
        for field in receipt.as_object().unwrap().keys() {
            let mut changed = receipt.clone();
            changed.as_object_mut().unwrap().remove(field);
            assert!(
                crate::oci::contract_from_value(id, changed).is_err(),
                "accepted missing {field}"
            );
        }
        for mutation in 0..4 {
            let mut changed = receipt.clone();
            let files = changed["files"].as_array_mut().unwrap();
            match mutation {
                0 => {
                    files.swap(0, 1);
                }
                1 => {
                    files[1]["path"] = files[0]["path"].clone();
                }
                2 => {
                    files.remove(0);
                }
                3 => {
                    files[0]["path"] = json!("../app.css");
                }
                _ => unreachable!(),
            }
            changed["tree_digest"] = json!(format!(
                "sha256:{}",
                crate::holo::canonical::content_id(
                    &crate::holo::canonical::encode_value(&changed["files"]).unwrap()
                )
            ));
            assert!(
                crate::oci::contract_from_value(id, changed).is_err(),
                "accepted file mutation {mutation}"
            );
        }
    }

    #[test]
    fn output_names_are_one_explicit_portable_directory() {
        for name in ["site", "Foundry-1", "a_b", &"a".repeat(128)] {
            assert_eq!(output_name(Path::new(name)).unwrap(), name);
        }
        for name in [
            "",
            ".",
            "..",
            ".prism",
            "_site",
            "a/b",
            "a\\b",
            "/site",
            "a.b",
            "a\n",
            "é",
            &"a".repeat(129),
        ] {
            assert_eq!(
                output_name(Path::new(name)).unwrap_err().code,
                "PP8001",
                "{name:?}"
            );
        }
    }

    #[test]
    fn nonexistent_store_is_never_created_by_export() {
        let root = tempfile::tempdir().unwrap();
        let reference = format!("example.invalid/app@sha256:{}", "a".repeat(64));
        assert!(export(root.path(), &reference, Path::new("site")).is_err());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }

    #[test]
    fn export_paths_reject_links_existing_destinations_and_missing_stores() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let reference = format!("example.invalid/app@sha256:{}", "a".repeat(64));
        std::os::unix::fs::symlink(outside.path(), root.path().join(".prism")).unwrap();
        assert_eq!(
            export(root.path(), &reference, Path::new("site"))
                .unwrap_err()
                .code,
            "PP8001"
        );
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
        std::fs::create_dir(root.path().join("site")).unwrap();
        std::fs::write(root.path().join("site/keep"), b"owned").unwrap();
        assert_eq!(
            export(root.path(), &reference, Path::new("site"))
                .unwrap_err()
                .code,
            "PP8001"
        );
        assert_eq!(
            std::fs::read(root.path().join("site/keep")).unwrap(),
            b"owned"
        );
        assert!(!root.path().join("site/index.html").exists());
    }

    #[test]
    fn descriptor_reads_reject_links_and_nonregular_files() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), b"outside").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("link")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret"), root.path().join("file"))
            .unwrap();
        let directory = open_directory(root.path()).unwrap();
        for path in ["link/secret", "file", "..", "/etc/passwd"] {
            assert_eq!(
                read_file(&directory, Path::new(path), 1024)
                    .unwrap_err()
                    .code,
                "PP8001",
                "{path}"
            );
        }
        std::fs::create_dir(root.path().join("directory")).unwrap();
        assert_eq!(
            read_file(&directory, Path::new("directory"), 1024)
                .unwrap_err()
                .code,
            "PP8001"
        );
        rustix::fs::mknodat(
            &directory,
            "fifo",
            rustix::fs::FileType::Fifo,
            rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
            0,
        )
        .unwrap();
        assert_eq!(
            read_file(&directory, Path::new("fifo"), 1024)
                .unwrap_err()
                .code,
            "PP8001"
        );
        let _socket = std::os::unix::net::UnixListener::bind(root.path().join("socket")).unwrap();
        assert_eq!(
            read_file(&directory, Path::new("socket"), 1024)
                .unwrap_err()
                .code,
            "PP8001"
        );
        std::fs::write(root.path().join("large"), b"too large").unwrap();
        assert_eq!(
            read_file(&directory, Path::new("large"), 3)
                .unwrap_err()
                .code,
            "PP6101"
        );
        std::fs::hard_link(outside.path().join("secret"), root.path().join("hardlink")).unwrap();
        assert_eq!(
            read_file(&directory, Path::new("hardlink"), 1024)
                .unwrap_err()
                .code,
            "PP8001"
        );
    }

    #[test]
    fn publication_refuses_shared_writable_parents_without_changing_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let parent = open_directory(root.path()).unwrap();
        let files = BTreeMap::from([("index.html".into(), b"owned".to_vec())]);
        for mode in [0o775, 0o707, 0o1777] {
            std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(mode)).unwrap();
            assert_eq!(publish(&parent, "site", &files).unwrap_err().code, "PP8001");
            assert_eq!(
                std::fs::metadata(root.path()).unwrap().permissions().mode() & 0o7777,
                mode
            );
            assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        }
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        publication_parent(&parent).unwrap();
    }

    #[test]
    fn post_rename_rejects_directory_and_symlink_substitution_without_deleting_foreign_content() {
        for symlink in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let outside = tempfile::tempdir().unwrap();
            let parent = open_directory(root.path()).unwrap();
            rustix::fs::mkdirat(&parent, ".staging", Mode::RWXU).unwrap();
            let directory = child_directory(&parent, std::ffi::OsStr::new(".staging")).unwrap();
            std::fs::write(root.path().join(".staging/index.html"), b"verified").unwrap();
            let mut staging = Staging {
                parent: &parent,
                directory,
                name: ".staging".into(),
                files: vec!["index.html".into()],
                committed: false,
            };
            staging.ready().unwrap();
            // Reproduce a substitution after the pre-rename check. The private
            // commit helper is the actual production continuation, not a flag.
            std::fs::rename(root.path().join(".staging"), root.path().join("displaced")).unwrap();
            if symlink {
                std::fs::write(outside.path().join("keep"), b"foreign").unwrap();
                std::os::unix::fs::symlink(outside.path(), root.path().join(".staging")).unwrap();
            } else {
                std::fs::create_dir(root.path().join(".staging")).unwrap();
                std::fs::write(root.path().join(".staging/keep"), b"foreign").unwrap();
            }
            assert_eq!(
                staging.rename_and_finish("site").unwrap_err().code,
                "PP8001"
            );
            assert!(!staging.committed);
            drop(staging);
            assert!(!root.path().join("displaced/index.html").exists());
            assert_eq!(
                std::fs::read(root.path().join("site/keep")).unwrap(),
                b"foreign"
            );
            if symlink {
                assert_eq!(
                    std::fs::read_link(root.path().join("site")).unwrap(),
                    outside.path()
                );
                assert_eq!(
                    std::fs::read(outside.path().join("keep")).unwrap(),
                    b"foreign"
                );
            }
        }
    }

    #[test]
    fn descriptor_reads_remain_anchored_when_parent_names_change() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("original")).unwrap();
        std::fs::write(root.path().join("original/value"), b"owned").unwrap();
        std::fs::write(outside.path().join("value"), b"outside").unwrap();
        let directory = open_directory(&root.path().join("original")).unwrap();
        std::fs::rename(root.path().join("original"), root.path().join("moved")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("original")).unwrap();
        assert_eq!(
            read_file(&directory, Path::new("value"), 1024).unwrap(),
            b"owned"
        );
        assert!(open_directory(&root.path().join("original")).is_err());
    }

    #[test]
    fn incomplete_staging_is_removed_without_touching_other_files() {
        let root = tempfile::tempdir().unwrap();
        let parent = open_directory(root.path()).unwrap();
        std::fs::write(root.path().join("keep"), b"user-owned").unwrap();
        rustix::fs::mkdirat(&parent, ".staging", Mode::RWXU).unwrap();
        let directory = child_directory(&parent, std::ffi::OsStr::new(".staging")).unwrap();
        let mut file = File::from(
            rustix::fs::openat(
                &directory,
                "index.html",
                OFlags::CREATE | OFlags::EXCL | OFlags::WRONLY,
                Mode::RUSR | Mode::WUSR,
            )
            .unwrap(),
        );
        file.write_all(b"partial").unwrap();
        drop(file);
        drop(Staging {
            parent: &parent,
            directory,
            name: ".staging".into(),
            files: vec!["index.html".into()],
            committed: false,
        });
        assert!(!root.path().join(".staging").exists());
        assert_eq!(
            std::fs::read(root.path().join("keep")).unwrap(),
            b"user-owned"
        );
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn publication_is_byte_exact_and_never_replaces_existing_output() {
        let root = tempfile::tempdir().unwrap();
        let directory = open_directory(root.path()).unwrap();
        // Filesystem primitive fixture only; no verification claim is minted.
        let files = BTreeMap::from([
            ("app.js".into(), b"exact\0bytes".to_vec()),
            ("index.html".into(), b"<html/>".to_vec()),
        ]);
        publish(&directory, "site", &files).unwrap();
        for (path, bytes) in &files {
            assert_eq!(
                &std::fs::read(root.path().join("site").join(path)).unwrap(),
                bytes
            );
        }
        assert_eq!(
            publish(&directory, "site", &files).unwrap_err().code,
            "PP8001"
        );
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
        assert_eq!(
            std::fs::read_dir(root.path().join("site")).unwrap().count(),
            files.len()
        );
    }

    #[test]
    fn concurrent_publishers_have_one_atomic_winner() {
        let root = tempfile::tempdir().unwrap();
        let mut workers = Vec::new();
        for n in 0..8 {
            let path = root.path().to_owned();
            workers.push(std::thread::spawn(move || {
                let directory = open_directory(&path).unwrap();
                let files = BTreeMap::from([("index.html".into(), vec![n; 1024])]);
                publish(&directory, "site", &files)
            }));
        }
        let mut winners = 0;
        for worker in workers {
            match worker.join().unwrap() {
                Ok(()) => winners += 1,
                Err(error) => assert_eq!(error.code, "PP8001"),
            }
        }
        assert_eq!(winners, 1);
        let bytes = std::fs::read(root.path().join("site/index.html")).unwrap();
        assert_eq!(bytes.len(), 1024);
        assert!(bytes.iter().all(|byte| *byte == bytes[0]));
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }
}
