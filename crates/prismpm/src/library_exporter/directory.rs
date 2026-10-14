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
        let result = self.retire();
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
            Ok(())
        }
        #[cfg(not(unix))]
        {
            let _ = (root, snapshot);
            Err(failure())
        }
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
        // not the descriptor-qualified Linux owner retirement boundary.
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
    // recurse or impose a narrower depth limit on the admitted package.
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
