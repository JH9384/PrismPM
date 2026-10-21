//! Private directory retirement. Uncertain ownership is never recursive deletion.

use crate::PrismError;
#[cfg(unix)]
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[derive(Clone, Default)]
pub(crate) struct Scope(Arc<AtomicBool>);

impl Scope {
    pub(crate) fn uncertain(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

fn failure() -> PrismError {
    PrismError::new(
        "PP5008",
        "private exporter retirement identity is uncertain; cleanup refused",
    )
}

#[cfg(unix)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Identity(pub u64, pub u64, pub u32, pub u32, pub u32);

#[cfg(unix)]
fn identity(metadata: &std::fs::Metadata) -> Identity {
    use std::os::unix::fs::MetadataExt;
    Identity(
        metadata.dev(),
        metadata.ino(),
        metadata.uid(),
        metadata.gid(),
        metadata.mode(),
    )
}

pub(crate) struct Directory {
    path: PathBuf,
    scope: Scope,
    closed: bool,
    retire_on_drop: bool,
    #[cfg(unix)]
    held: std::fs::File,
    #[cfg(unix)]
    parent: std::fs::File,
    #[cfg(unix)]
    original: Identity,
    #[cfg(unix)]
    original_parent: Identity,
    #[cfg(unix)]
    nodes: Option<BTreeMap<PathBuf, Identity>>,
    #[cfg(unix)]
    protected: Option<(PathBuf, BTreeMap<PathBuf, Identity>)>,
    #[cfg(not(unix))]
    original: std::fs::Metadata,
    #[cfg(not(unix))]
    temporary: Option<tempfile::TempDir>,
}

impl Directory {
    pub(crate) fn temporary(
        prefix: &str,
        parent: Option<&Path>,
        scope: Scope,
    ) -> Result<Self, PrismError> {
        let mut builder = tempfile::Builder::new();
        builder.prefix(prefix);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            builder.permissions(std::fs::Permissions::from_mode(0o700));
        }
        let temporary = match parent {
            Some(path) => builder.tempdir_in(path),
            None => builder.tempdir(),
        }
        .map_err(|_| failure())?;
        // Disarm TempDir immediately: constructor and later errors must not
        // make its pathname destructor remove an unobserved replacement.
        #[cfg(unix)]
        let path = temporary.keep();
        #[cfg(not(unix))]
        let path = temporary.path().to_owned();
        let result = Self::hold(path, scope.clone(), true);
        #[cfg(not(unix))]
        let result = result.map(|mut directory| {
            directory.temporary = Some(temporary);
            directory
        });
        if result.is_err() {
            scope.uncertain();
        }
        result
    }

    pub(super) fn existing(path: &Path, scope: Scope) -> Result<Self, PrismError> {
        Self::hold(path.to_owned(), scope.clone(), false).inspect_err(|_| scope.uncertain())
    }

    fn hold(path: PathBuf, scope: Scope, retire_on_drop: bool) -> Result<Self, PrismError> {
        if path.canonicalize().ok().as_deref() != Some(path.as_path()) {
            return Err(failure());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
            let open = |path: &Path| {
                std::fs::OpenOptions::new()
                    .read(true)
                    .custom_flags(
                        (rustix::fs::OFlags::DIRECTORY
                            | rustix::fs::OFlags::NOFOLLOW
                            | rustix::fs::OFlags::CLOEXEC)
                            .bits() as i32,
                    )
                    .open(path)
                    .map_err(|_| failure())
            };
            let held = open(&path)?;
            let parent = open(path.parent().ok_or_else(failure)?)?;
            let metadata = held.metadata().map_err(|_| failure())?;
            let original = identity(&metadata);
            if metadata.uid() != rustix::process::geteuid().as_raw()
                || metadata.mode() & 0o7777 != 0o700
                || identity(&std::fs::symlink_metadata(&path).map_err(|_| failure())?) != original
            {
                return Err(failure());
            }
            let original_parent = identity(&parent.metadata().map_err(|_| failure())?);
            Ok(Self {
                path,
                scope,
                closed: false,
                retire_on_drop,
                held,
                parent,
                original,
                original_parent,
                nodes: None,
                protected: None,
            })
        }
        #[cfg(not(unix))]
        {
            let original = std::fs::symlink_metadata(&path).map_err(|_| failure())?;
            if !original.is_dir() || original.file_type().is_symlink() {
                return Err(failure());
            }
            Ok(Self {
                path,
                scope,
                closed: false,
                retire_on_drop,
                original,
                temporary: None,
            })
        }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
    pub(crate) fn scope(&self) -> Scope {
        self.scope.clone()
    }

    pub(crate) fn ready(&self) -> Result<(), PrismError> {
        let result = self.check_identity();
        if result.is_err() {
            self.scope.uncertain();
        }
        result
    }

    fn check_identity(&self) -> Result<(), PrismError> {
        if self.scope.0.load(Ordering::Relaxed)
            || self.closed
            || self.path.canonicalize().ok().as_deref() != Some(self.path.as_path())
        {
            return Err(failure());
        }
        #[cfg(unix)]
        {
            if identity(&self.held.metadata().map_err(|_| failure())?) != self.original
                || identity(&std::fs::symlink_metadata(&self.path).map_err(|_| failure())?)
                    != self.original
                || identity(&self.parent.metadata().map_err(|_| failure())?) != self.original_parent
                || identity(
                    &std::fs::symlink_metadata(self.path.parent().ok_or_else(failure)?)
                        .map_err(|_| failure())?,
                ) != self.original_parent
            {
                return Err(failure());
            }
        }
        #[cfg(not(unix))]
        {
            let current = std::fs::symlink_metadata(&self.path).map_err(|_| failure())?;
            if !current.is_dir()
                || current.file_type().is_symlink()
                || current.created().ok() != self.original.created().ok()
            {
                return Err(failure());
            }
        }
        Ok(())
    }

    pub(crate) fn close(mut self) -> Result<(), PrismError> {
        // Explicit close follows a successful operation. Drop must never adopt
        // a failed operation's unknown current descendants as cleanup authority.
        let result = self.seal().and_then(|()| self.retire());
        if result.is_err() {
            self.scope.uncertain();
        }
        result
    }

    pub(super) fn bind_package(
        &mut self,
        root: &Path,
        snapshot: &super::custody::Snapshot,
    ) -> Result<(), PrismError> {
        self.ready()?;
        #[cfg(unix)]
        {
            let prefix = root.strip_prefix(&self.path).map_err(|_| failure())?;
            if prefix.components().count() != 1 {
                return Err(failure());
            }
            self.nodes = Some(
                snapshot
                    .cleanup_nodes()
                    .map(|(path, node)| (prefix.join(path), node))
                    .collect(),
            );
            check_nodes(
                &self.held,
                self.nodes.as_ref().expect("bound package nodes"),
            )?;
        }
        #[cfg(not(unix))]
        {
            let _ = (root, snapshot);
            return Err(failure());
        }
        Ok(())
    }

    pub(crate) fn protect_package(
        &mut self,
        root: &Path,
        snapshot: &super::custody::Snapshot,
    ) -> Result<(), PrismError> {
        self.ready()?;
        #[cfg(unix)]
        {
            let prefix = root
                .strip_prefix(&self.path)
                .map_err(|_| failure())?
                .to_owned();
            if prefix.components().count() != 1 {
                return Err(failure());
            }
            let nodes = snapshot
                .cleanup_nodes()
                .map(|(path, node)| (prefix.join(path), node))
                .collect();
            self.protected = Some((prefix, nodes));
            self.check_protected(&collect_nodes(&self.held)?)
                .inspect_err(|_| self.scope.uncertain())?;
        }
        #[cfg(not(unix))]
        {
            let _ = (root, snapshot);
        }
        Ok(())
    }

    /// Only the original completed build/export witness can authorize final
    /// cleanup. Cold source-only build growth is not a retirement authority.
    pub(crate) fn protect_verified_package(
        &mut self,
        root: &Path,
        snapshot: &super::custody::Snapshot,
    ) -> Result<(), PrismError> {
        let result = (|| {
            if &super::custody::capture(root)? != snapshot {
                return Err(failure());
            }
            self.protect_package(root, snapshot)
        })();
        result.inspect_err(|_| self.scope.uncertain())
    }

    #[cfg(unix)]
    fn check_protected(&self, observed: &BTreeMap<PathBuf, Identity>) -> Result<(), PrismError> {
        if let Some((prefix, nodes)) = &self.protected {
            if observed
                .iter()
                .filter(|(path, _)| path.starts_with(prefix))
                .ne(nodes.iter())
            {
                return Err(failure());
            }
        }
        Ok(())
    }

    pub(super) fn expect_empty(&mut self) -> Result<(), PrismError> {
        self.ready()?;
        #[cfg(unix)]
        {
            self.nodes = Some(BTreeMap::new());
            check_nodes(&self.held, self.nodes.as_ref().expect("empty authority"))?;
        }
        Ok(())
    }

    pub(super) fn stage_identity(&self) -> Result<serde_json::Value, PrismError> {
        self.ready()?;
        #[cfg(unix)]
        {
            Ok(
                serde_json::json!({"dev":self.original.0.to_string(), "ino":self.original.1.to_string(),
            "uid":self.original.2.to_string(), "gid":self.original.3.to_string(), "mode":self.original.4.to_string()}),
            )
        }
        #[cfg(not(unix))]
        {
            Err(failure())
        }
    }

    pub(super) fn write_file(&mut self, name: &str, bytes: &[u8]) -> Result<(), PrismError> {
        self.ready()?;
        if Path::new(name).components().count() != 1
            || !matches!(
                Path::new(name).components().next(),
                Some(std::path::Component::Normal(_))
            )
        {
            return Err(failure());
        }
        #[cfg(unix)]
        {
            use rustix::fs::{Mode, OFlags};
            use std::io::Write;
            let mut file = std::fs::File::from(
                rustix::fs::openat(
                    &self.held,
                    name,
                    OFlags::WRONLY
                        | OFlags::CREATE
                        | OFlags::EXCL
                        | OFlags::NOFOLLOW
                        | OFlags::CLOEXEC,
                    Mode::RUSR | Mode::WUSR,
                )
                .map_err(|_| failure())?,
            );
            let original = identity(&file.metadata().map_err(|_| failure())?);
            self.nodes
                .get_or_insert_with(BTreeMap::new)
                .insert(PathBuf::from(name), original);
            file.write_all(bytes).map_err(|_| failure())?;
            if identity(&file.metadata().map_err(|_| failure())?) != original {
                return Err(failure());
            }
        }
        #[cfg(not(unix))]
        {
            use std::io::Write;
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(self.path.join(name))
                .map_err(|_| failure())?
                .write_all(bytes)
                .map_err(|_| failure())?;
        }
        self.ready()
    }

    fn seal(&mut self) -> Result<(), PrismError> {
        self.ready()?;
        #[cfg(unix)]
        if self.nodes.is_none() {
            let nodes = collect_nodes(&self.held)?;
            self.check_protected(&nodes)?;
            self.nodes = Some(nodes);
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    pub(super) fn publish_lake(&self, destination: &Self) -> Result<(), PrismError> {
        use rustix::fs::{AtFlags, Mode, OFlags, RenameFlags};
        self.ready()?;
        destination.ready()?;
        let child = std::fs::File::from(
            rustix::fs::openat(
                &self.held,
                ".lake",
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| failure())?,
        );
        let before = identity(&child.metadata().map_err(|_| failure())?);
        rustix::fs::renameat_with(
            &self.held,
            ".lake",
            &destination.held,
            ".lake",
            RenameFlags::NOREPLACE,
        )
        .map_err(|_| failure())?;
        self.ready()?;
        destination.ready()?;
        let after = rustix::fs::statat(&destination.held, ".lake", AtFlags::SYMLINK_NOFOLLOW)
            .map_err(|_| failure())?;
        if before != identity(&child.metadata().map_err(|_| failure())?)
            || before.0 != after.st_dev
            || before.1 != after.st_ino
            || before.2 != after.st_uid
            || before.3 != after.st_gid
            || before.4 != after.st_mode
        {
            return Err(failure());
        }
        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    pub(super) fn publish_lake(&self, _: &Self) -> Result<(), PrismError> {
        Err(failure())
    }

    fn retire(&mut self) -> Result<(), PrismError> {
        self.ready()?;
        #[cfg(unix)]
        {
            // Namespace operations are relative to held directories. A moved
            // original never redirects this traversal into a replacement.
            let empty = BTreeMap::new();
            let nodes = self.nodes.as_ref().unwrap_or(&empty);
            check_nodes(&self.held, nodes)?;
            remove_children(&self.held, nodes)?;
            self.ready()?;
            rustix::fs::unlinkat(
                &self.parent,
                self.path.file_name().ok_or_else(failure)?,
                rustix::fs::AtFlags::REMOVEDIR,
            )
            .map_err(|_| failure())?;
        }
        #[cfg(not(unix))]
        // Preserve the pre-existing non-Unix cold TempDir lifecycle. This is
        // not the descriptor-qualified Linux seed/owner retirement boundary.
        self.temporary
            .take()
            .ok_or_else(failure)?
            .close()
            .map_err(|_| failure())?;
        self.closed = true;
        Ok(())
    }
}

#[cfg(unix)]
fn open_directory(
    root: &std::fs::File,
    path: &Path,
    expected: Option<&BTreeMap<PathBuf, Identity>>,
) -> Result<std::fs::File, PrismError> {
    use rustix::fs::{Mode, OFlags};
    let mut directory = std::fs::File::from(
        rustix::fs::openat(
            root,
            ".",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| failure())?,
    );
    let mut prefix = PathBuf::new();
    for part in path.components() {
        let std::path::Component::Normal(name) = part else {
            return Err(failure());
        };
        prefix.push(name);
        let child = std::fs::File::from(
            rustix::fs::openat(
                &directory,
                name,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| failure())?,
        );
        if let Some(nodes) = expected {
            if nodes.get(&prefix) != Some(&identity(&child.metadata().map_err(|_| failure())?)) {
                return Err(failure());
            }
        }
        directory = child;
    }
    Ok(directory)
}

#[cfg(unix)]
fn stat_identity(stat: rustix::fs::Stat) -> Identity {
    Identity(
        stat.st_dev,
        stat.st_ino,
        stat.st_uid,
        stat.st_gid,
        stat.st_mode,
    )
}

#[cfg(unix)]
fn collect_nodes(root: &std::fs::File) -> Result<BTreeMap<PathBuf, Identity>, PrismError> {
    use rustix::fs::{AtFlags, Dir, FileType};
    let mut nodes = BTreeMap::new();
    let mut pending = vec![PathBuf::new()];
    while let Some(path) = pending.pop() {
        let parent = open_directory(root, &path, Some(&nodes))?;
        let mut entries = Dir::read_from(&parent).map_err(|_| failure())?;
        for entry in &mut entries {
            let entry = entry.map_err(|_| failure())?;
            let name = entry.file_name();
            if matches!(name.to_bytes(), b"." | b"..") {
                continue;
            }
            if nodes.len() >= 65_536 {
                return Err(failure());
            }
            use std::os::unix::ffi::OsStrExt;
            let child = path.join(std::ffi::OsStr::from_bytes(name.to_bytes()));
            let node = stat_identity(
                rustix::fs::statat(&parent, name, AtFlags::SYMLINK_NOFOLLOW)
                    .map_err(|_| failure())?,
            );
            if FileType::from_raw_mode(node.4) == FileType::Directory {
                pending.push(child.clone());
            }
            if nodes.insert(child, node).is_some() {
                return Err(failure());
            }
        }
    }
    Ok(nodes)
}

#[cfg(unix)]
fn check_nodes(
    root: &std::fs::File,
    nodes: &BTreeMap<PathBuf, Identity>,
) -> Result<(), PrismError> {
    if &collect_nodes(root)? != nodes {
        return Err(failure());
    }
    Ok(())
}

#[cfg(unix)]
fn remove_children(
    root: &std::fs::File,
    nodes: &BTreeMap<PathBuf, Identity>,
) -> Result<(), PrismError> {
    use rustix::fs::{AtFlags, FileType};
    // Reverse component ordering removes descendants before parents. Reopen
    // each ancestry from the held root with constant descriptor use; never
    // recurse or impose a narrower depth limit on an admitted seed.
    for (path, before) in nodes.iter().rev() {
        let parent = open_directory(root, path.parent().ok_or_else(failure)?, Some(nodes))?;
        let name = path.file_name().ok_or_else(failure)?;
        let directory = FileType::from_raw_mode(before.4) == FileType::Directory;
        let after = stat_identity(
            rustix::fs::statat(&parent, name, AtFlags::SYMLINK_NOFOLLOW).map_err(|_| failure())?,
        );
        if *before != after {
            return Err(failure());
        }
        rustix::fs::unlinkat(
            &parent,
            name,
            if directory {
                AtFlags::REMOVEDIR
            } else {
                AtFlags::empty()
            },
        )
        .map_err(|_| failure())?;
    }
    Ok(())
}

impl Drop for Directory {
    fn drop(&mut self) {
        if self.closed {
            return;
        }
        let result = if self.retire_on_drop {
            self.retire()
        } else {
            self.ready()
        };
        if result.is_err() {
            self.scope.uncertain();
            #[cfg(not(unix))]
            if let Some(temporary) = self.temporary.take() {
                temporary.keep();
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn final_cold_cleanup_cannot_rebase_a_completed_build_witness() {
        use std::os::unix::fs::PermissionsExt;
        let mut directory =
            Directory::temporary("prism-final-cold-custody-", None, Scope::default()).unwrap();
        let root = directory.path().to_owned();
        let package = root.join("package");
        super::super::acquire(&package).unwrap();
        let acquisition = super::super::custody::capture_source(&package).unwrap();
        directory.protect_package(&package, &acquisition).unwrap();
        std::fs::create_dir_all(package.join(".lake/build/bin")).unwrap();
        let executable = package.join(".lake/build/bin/prod-export");
        std::fs::write(&executable, b"unaccepted executable identity fixture").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let exported =
            super::super::after_build(&package, &super::super::cold_acquisition(), &acquisition)
                .unwrap();
        let displaced = package.join("original-lake");
        // Keep the displaced tree outside the package, preserving its source.
        std::fs::rename(package.join(".lake"), root.join("original-lake")).unwrap();
        std::fs::create_dir_all(package.join(".lake/build/bin")).unwrap();
        std::fs::copy(
            root.join("original-lake/build/bin/prod-export"),
            &executable,
        )
        .unwrap();
        let marker = package.join(".lake/foreign-marker");
        std::fs::write(&marker, b"foreign cold tree must survive").unwrap();
        assert!(!displaced.exists());
        assert!(directory
            .protect_verified_package(&package, &exported)
            .is_err());
        assert!(directory.close().is_err());
        assert_eq!(
            std::fs::read(marker).unwrap(),
            b"foreign cold tree must survive"
        );
        assert!(root.join("original-lake/build/bin/prod-export").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn successful_generic_close_cannot_adopt_a_substituted_exporter_subtree() {
        for target in ["package", "package/Prod"] {
            let mut directory =
                Directory::temporary("prism-protected-close-", None, Scope::default()).unwrap();
            let root = directory.path().to_owned();
            let package = root.join("package");
            super::super::acquire(&package).unwrap();
            let snapshot = super::super::custody::capture_source(&package).unwrap();
            std::fs::write(root.join("generated-artifact"), b"actual private artifact").unwrap();
            directory.protect_package(&package, &snapshot).unwrap();
            let substituted = root.join(target);
            let displaced = substituted.with_extension("test-original");
            std::fs::rename(&substituted, &displaced).unwrap();
            std::fs::create_dir(&substituted).unwrap();
            let marker = substituted.join("foreign-marker");
            std::fs::write(&marker, b"must survive final successful-path seal").unwrap();
            assert!(directory.close().is_err());
            assert_eq!(
                std::fs::read(marker).unwrap(),
                b"must survive final successful-path seal"
            );
            assert_eq!(
                std::fs::read(root.join("generated-artifact")).unwrap(),
                b"actual private artifact",
                "refusal must precede deletion of any workspace member"
            );
            assert!(displaced.exists());
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn retirement_keeps_constant_descriptors_for_deep_admitted_trees() {
        const CHILD: &str = "PRISM_PRIVATE_DEEP_RETIREMENT_TEST_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "exporter::directory::tests::retirement_keeps_constant_descriptors_for_deep_admitted_trees", "--nocapture"])
                .env(CHILD, "1").status().unwrap();
            assert!(
                status.success(),
                "actual descriptor-limited retirement failed"
            );
            return;
        }
        let limit = rustix::process::getrlimit(rustix::process::Resource::Nofile);
        rustix::process::setrlimit(
            rustix::process::Resource::Nofile,
            rustix::process::Rlimit {
                current: Some(1024),
                maximum: limit.maximum,
            },
        )
        .unwrap();
        assert_eq!(
            rustix::process::getrlimit(rustix::process::Resource::Nofile).current,
            Some(1024)
        );
        let directory =
            Directory::temporary("prism-deep-retirement-", None, Scope::default()).unwrap();
        let root = directory.path().to_owned();
        let mut path = root.clone();
        // 1,100 ancestors fit the unchanged 4,096-entry/4,096-byte seed
        // domain, but exhaust the former recursive two-descriptors-per-level
        // retirement under the ordinary 1,024-descriptor resource limit.
        for _ in 0..1100 {
            path.push("d");
            std::fs::create_dir(&path).unwrap();
        }
        std::fs::write(path.join("member"), b"real nested file").unwrap();
        directory.close().unwrap();
        assert!(!root.exists());
    }

    #[test]
    fn dropping_unsealed_nonempty_work_never_adopts_unknown_children() {
        let directory =
            Directory::temporary("prism-unsealed-retirement-", None, Scope::default()).unwrap();
        let root = directory.path().to_owned();
        std::fs::write(root.join("unknown-marker"), b"must remain").unwrap();
        drop(directory);
        assert_eq!(
            std::fs::read(root.join("unknown-marker")).unwrap(),
            b"must remain"
        );
        // Only the test-authored fixture is removed, after preservation proof.
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(all(test, unix))]
mod cold_library_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn bound(parent: &Path) -> (Directory, PathBuf) {
        let mut directory =
            Directory::temporary("cold-owner-retirement-", Some(parent), Scope::default()).unwrap();
        let package = directory.path().join("lean4-prod");
        std::fs::create_dir(&package).unwrap();
        std::fs::set_permissions(&package, std::fs::Permissions::from_mode(0o700)).unwrap();
        tar::Archive::new(std::io::Cursor::new(super::super::ARCHIVE))
            .unpack(&package)
            .unwrap();
        let source = super::super::custody::capture_source(&package).unwrap();
        directory.bind_package(&package, &source).unwrap();
        (directory, package)
    }

    #[test]
    fn complete_original_bound_source_nodes_retire_without_adopting_unknown_members() {
        let parent = tempfile::tempdir().unwrap();
        let (directory, _) = bound(parent.path());
        let path = directory.path().to_owned();
        directory.close().unwrap();
        assert!(!path.exists());
        let (directory, package) = bound(parent.path());
        let marker = package.join("foreign-marker");
        std::fs::write(&marker, b"retain unknown member").unwrap();
        assert!(directory.close().is_err());
        assert_eq!(std::fs::read(marker).unwrap(), b"retain unknown member");
    }

    #[test]
    fn actual_owner_root_and_source_subtree_replacements_are_never_deleted() {
        for target in ["", "lean4-prod", "lean4-prod/Prod"] {
            let parent = tempfile::tempdir().unwrap();
            let (directory, _) = bound(parent.path());
            let path = directory.path().join(target);
            let displaced = parent.path().join("original-displaced");
            std::fs::rename(&path, &displaced).unwrap();
            std::fs::create_dir(&path).unwrap();
            let marker = path.join("foreign-marker");
            std::fs::write(&marker, b"foreign namespace survives").unwrap();
            assert!(directory.close().is_err(), "{target}");
            assert_eq!(
                std::fs::read(marker).unwrap(),
                b"foreign namespace survives"
            );
            assert!(displaced.exists());
        }
    }

    #[test]
    fn directory_modes_and_failed_growth_cannot_authorize_retirement() {
        let parent = tempfile::tempdir().unwrap();
        let (directory, package) = bound(parent.path());
        let path = directory.path().to_owned();
        std::fs::set_permissions(&package, std::fs::Permissions::from_mode(0o750)).unwrap();
        assert!(directory.close().is_err());
        assert!(package.exists());
        assert!(Directory::existing(&package, Scope::default()).is_err());
        assert!(path.exists());
        let (directory, package) = bound(parent.path());
        std::fs::create_dir(package.join(".lake")).unwrap();
        // A failed compiler's new descendants are not silently sealed by Drop.
        drop(directory);
        assert!(package.join(".lake").exists());
    }
}
