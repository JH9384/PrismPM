//! Private package custody, never a reusable cache or an acceptance receipt.
use crate::PrismError;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Component, Path};

const FILES: usize = 4096;
const FILE_BYTES: u64 = 256 * 1024 * 1024;
const TREE_BYTES: u64 = 512 * 1024 * 1024;
const SOURCE_BYTES: u64 = 16 * 1024 * 1024;

fn failure() -> PrismError {
    PrismError::new(
        "PP5008",
        "exporter package source or build-tree custody changed",
    )
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Identity {
    directory: bool,
    length: u64,
    modified: Option<std::time::SystemTime>,
    #[cfg(unix)]
    native: (u64, u64, u32, u64, i64, i64, u32, u32),
}

fn identity(metadata: &std::fs::Metadata) -> Identity {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Identity {
        directory: metadata.is_dir(),
        length: metadata.len(),
        modified: metadata.modified().ok(),
        #[cfg(unix)]
        native: (
            metadata.dev(),
            metadata.ino(),
            metadata.mode(),
            metadata.nlink(),
            metadata.ctime(),
            metadata.ctime_nsec(),
            metadata.uid(),
            metadata.gid(),
        ),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Snapshot(BTreeMap<String, (Identity, Option<String>)>);

impl Snapshot {
    pub(super) fn same_source(&self, other: &Self) -> bool {
        let source = |name: &str| name != ".lake" && !name.starts_with(".lake/");
        if self
            .0
            .keys()
            .filter(|name| source(name))
            .ne(other.0.keys().filter(|name| source(name)))
        {
            return false;
        }
        self.0
            .iter()
            .filter(|(name, _)| source(name))
            .all(|(name, (before, hash))| {
                let (after, next_hash) = &other.0[name];
                if name.is_empty() {
                    #[cfg(unix)]
                    {
                        return before.directory
                            && after.directory
                            && before.native.0 == after.native.0
                            && before.native.1 == after.native.1
                            && before.native.2 == after.native.2
                            && before.native.6 == after.native.6
                            && before.native.7 == after.native.7;
                    }
                    #[cfg(not(unix))]
                    {
                        return before.directory && after.directory;
                    }
                }
                before == after && hash == next_hash
            })
    }
    #[cfg(unix)]
    pub(super) fn cleanup_nodes(&self) -> impl Iterator<Item = (&str, super::directory::Identity)> {
        self.0.iter().map(|(path, (node, _))| {
            (
                path.as_str(),
                super::directory::Identity(
                    node.native.0,
                    node.native.1,
                    node.native.6,
                    node.native.7,
                    node.native.2,
                ),
            )
        })
    }

    /// Relocation changes the .lake root's timestamps, not descendant custody.
    pub(super) fn same_relocated_seed(&self, other: &Self) -> bool {
        let seed = |name: &str| name == ".lake" || name.starts_with(".lake/");
        if self
            .0
            .keys()
            .filter(|name| seed(name))
            .ne(other.0.keys().filter(|name| seed(name)))
        {
            return false;
        }
        self.0
            .iter()
            .filter(|(name, _)| seed(name))
            .all(|(name, (before, hash))| {
                let (after, next_hash) = &other.0[name];
                if name == ".lake" {
                    #[cfg(unix)]
                    {
                        return before.directory
                            && after.directory
                            && before.native.0 == after.native.0
                            && before.native.1 == after.native.1
                            && before.native.2 == after.native.2
                            && before.native.6 == after.native.6
                            && before.native.7 == after.native.7;
                    }
                    #[cfg(not(unix))]
                    {
                        return before == after;
                    }
                }
                before == after && hash == next_hash
            })
    }
    fn seed_files(&self) -> serde_json::Value {
        serde_json::Value::Array(
            self.0
                .iter()
                .filter(|(name, _)| *name == ".lake" || name.starts_with(".lake/"))
                .map(|(name, (identity, hash))| {
                    #[cfg(unix)]
                    let mode = identity.native.2 & 0o777;
                    #[cfg(not(unix))]
                    let mode = 0;
                    if identity.directory {
                        serde_json::json!({"path":name,"kind":"directory","mode":mode})
                    } else {
                        serde_json::json!({"path":name,"kind":"file","mode":mode,
                            "byte_length":identity.length,"sha256":hash})
                    }
                })
                .collect(),
        )
    }

    /// Lake may legitimately refresh build traces. Source and executable
    /// identities may not change merely because a second phase builds again.
    pub(super) fn same_compiler(&self, other: &Self) -> bool {
        if self.0.keys().ne(other.0.keys()) {
            return false;
        }
        self.0.iter().all(|(name, (before, hash))| {
            let (after, next_hash) = &other.0[name];
            if !name.starts_with(".lake/") && name != ".lake" {
                return before == after && hash == next_hash;
            }
            // Only existing Lake trace bodies may refresh. Compiled libraries,
            // objects, launcher configuration and the executable remain exact.
            if name.ends_with(".trace") && !before.directory && !after.directory {
                #[cfg(unix)]
                {
                    return before.native.0 == after.native.0
                        && before.native.2 == after.native.2
                        && before.native.6 == after.native.6
                        && before.native.7 == after.native.7;
                }
                #[cfg(not(unix))]
                {
                    return before == after && hash == next_hash;
                }
            }
            if before.directory && after.directory {
                #[cfg(unix)]
                {
                    return before.native.0 == after.native.0
                        && before.native.1 == after.native.1
                        && before.native.2 == after.native.2
                        && before.native.3 == after.native.3
                        && before.native.6 == after.native.6
                        && before.native.7 == after.native.7;
                }
                #[cfg(not(unix))]
                {
                    return before == after;
                }
            }
            before == after && hash == next_hash
        })
    }
}

struct SourceMember {
    directory: bool,
    mode: Option<u32>,
    bytes: Vec<u8>,
}

fn member_name(path: &Path) -> Result<String, PrismError> {
    path.components()
        .map(|part| match part {
            Component::Normal(name) => name.to_str().ok_or_else(failure),
            _ => Err(failure()),
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|parts| parts.join("/"))
}

fn charge_build(entries: &mut usize, bytes: &mut u64, length: u64) -> Result<(), PrismError> {
    *entries = entries.checked_add(1).ok_or_else(failure)?;
    *bytes = bytes.checked_add(length).ok_or_else(failure)?;
    if *entries > FILES || length > FILE_BYTES || *bytes > TREE_BYTES {
        return Err(failure());
    }
    Ok(())
}

fn source_members() -> Result<BTreeMap<String, SourceMember>, PrismError> {
    let members = source_members_from(super::ARCHIVE)?;
    if !members.contains_key("Prod/Export.lean") || !members.contains_key("lean-toolchain") {
        return Err(failure());
    }
    Ok(members)
}

pub(super) fn validate_archive() -> Result<(), PrismError> {
    source_members().map(|_| ())
}

fn source_members_from(archive: impl Read) -> Result<BTreeMap<String, SourceMember>, PrismError> {
    let mut members = BTreeMap::new();
    let mut headers = std::collections::BTreeSet::new();
    let mut total = 0_u64;
    for entry in tar::Archive::new(archive)
        .entries()
        .map_err(|_| failure())?
    {
        let mut entry = entry.map_err(|_| failure())?;
        let path = entry.path().map_err(|_| failure())?.into_owned();
        let name = member_name(&path)?;
        if name == ".lake"
            || name.starts_with(".lake/")
            || name.is_empty()
            || name.len() > 4096
            || !headers.insert(name.clone())
        {
            return Err(failure());
        }
        let directory = entry.header().entry_type().is_dir();
        if !directory && !entry.header().entry_type().is_file() {
            return Err(failure());
        }
        let mode = entry.header().mode().map_err(|_| failure())?;
        if mode & 0o7000 != 0 {
            return Err(failure());
        }
        let length = entry.size();
        // Charge the source-only budget before allocating or reading a body.
        // It must never borrow the independent 512-MiB build-tree allowance.
        total = total.checked_add(length).ok_or_else(failure)?;
        if members.len() >= FILES || total > SOURCE_BYTES || (directory && length != 0) {
            return Err(failure());
        }
        let mut bytes = Vec::new();
        entry
            .by_ref()
            .take(length + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| failure())?;
        if bytes.len() as u64 != length {
            return Err(failure());
        }
        // Admit precisely missing parent directories, never arbitrary nodes.
        // File-only archives derive them without an invented header mode.
        // A later explicit directory header supplies its authoritative mode.
        for parent in path
            .ancestors()
            .skip(1)
            .filter(|path| !path.as_os_str().is_empty())
        {
            let parent = member_name(parent)?;
            if members
                .get(&parent)
                .is_some_and(|row: &SourceMember| !row.directory)
            {
                return Err(failure());
            }
            members.entry(parent).or_insert(SourceMember {
                directory: true,
                mode: None,
                bytes: Vec::new(),
            });
        }
        if members
            .get(&name)
            .is_some_and(|row| !directory || !row.directory || row.mode.is_some())
        {
            return Err(failure());
        }
        members.insert(
            name,
            SourceMember {
                directory,
                mode: Some(mode),
                bytes,
            },
        );
        if members.len() > FILES {
            return Err(failure());
        }
    }
    Ok(members)
}

pub(super) fn capture(root: &Path) -> Result<Snapshot, PrismError> {
    capture_members(root, source_members()?, true)
}

pub(super) fn capture_optional(root: &Path) -> Result<Snapshot, PrismError> {
    capture_members(root, source_members()?, false)
}

pub(super) fn require_executable(root: &Path) -> Result<(), PrismError> {
    let path = root.join(".lake/build/bin/prod-export");
    let metadata = std::fs::symlink_metadata(&path).map_err(|_| failure())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.mode() & 0o111 == 0 || metadata.nlink() != 1 {
            return Err(failure());
        }
    }
    capture_file(&path).map(|_| ())
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct FileWitness(Identity, String);

/// Full bounded bytes and all native fields, before and after the held read.
/// Trusted toolchain files can have existing hard links; their exact link
/// count is conserved, not adopted as a package-source permission.
pub(super) fn capture_file(path: &Path) -> Result<FileWitness, PrismError> {
    if path.canonicalize().ok().as_deref() != Some(path) {
        return Err(failure());
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|_| failure())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > FILE_BYTES {
        return Err(failure());
    }
    let before = identity(&metadata);
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(
            (rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32,
        );
    }
    let mut file = options.open(path).map_err(|_| failure())?;
    if identity(&file.metadata().map_err(|_| failure())?) != before {
        return Err(failure());
    }
    let mut digest = Sha256::new();
    let mut count = 0_u64;
    let mut buffer = [0_u8; 65536];
    loop {
        let length = file.read(&mut buffer).map_err(|_| failure())?;
        if length == 0 {
            break;
        }
        count += length as u64;
        if count > metadata.len() {
            return Err(failure());
        }
        digest.update(&buffer[..length]);
    }
    if count != metadata.len()
        || identity(&file.metadata().map_err(|_| failure())?) != before
        || identity(&std::fs::symlink_metadata(path).map_err(|_| failure())?) != before
        || path.canonicalize().ok().as_deref() != Some(path)
    {
        return Err(failure());
    }
    Ok(FileWitness(before, format!("{:x}", digest.finalize())))
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct LauncherWitness {
    selected: Identity,
    target: Option<std::path::PathBuf>,
    resolved: std::path::PathBuf,
    file: FileWitness,
}

/// Preserve the original executable selector's permitted proxy path rather
/// than changing the actual command to its resolution. Bind both that exact
/// path (including an existing symlink) and the complete resolved file.
pub(super) fn capture_launcher(path: &Path) -> Result<LauncherWitness, PrismError> {
    let selected = identity(&std::fs::symlink_metadata(path).map_err(|_| failure())?);
    let target = if std::fs::symlink_metadata(path)
        .map_err(|_| failure())?
        .file_type()
        .is_symlink()
    {
        Some(std::fs::read_link(path).map_err(|_| failure())?)
    } else {
        None
    };
    let resolved = path.canonicalize().map_err(|_| failure())?;
    let file = capture_file(&resolved)?;
    if identity(&std::fs::symlink_metadata(path).map_err(|_| failure())?) != selected
        || path.canonicalize().ok().as_deref() != Some(resolved.as_path())
        || (target.is_some() && std::fs::read_link(path).ok() != target)
    {
        return Err(failure());
    }
    Ok(LauncherWitness {
        selected,
        target,
        resolved,
        file,
    })
}

/// Hold actual cwd ancestry while the child runs. Build commands legitimately
/// add children, so size/link/timestamp changes are observed but do not replace
/// the original held directory's device/inode/owner/group/mode identity.
pub(super) struct Cwd {
    path: std::path::PathBuf,
    held: std::fs::File,
    original: Identity,
}

impl Cwd {
    pub(super) fn open(path: &Path) -> Result<Self, PrismError> {
        if path.canonicalize().ok().as_deref() != Some(path) {
            return Err(failure());
        }
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(
                (rustix::fs::OFlags::DIRECTORY
                    | rustix::fs::OFlags::NOFOLLOW
                    | rustix::fs::OFlags::CLOEXEC)
                    .bits() as i32,
            );
        }
        let held = options.open(path).map_err(|_| failure())?;
        let metadata = held.metadata().map_err(|_| failure())?;
        if !metadata.is_dir() {
            return Err(failure());
        }
        let original = identity(&metadata);
        let result = Self {
            path: path.to_owned(),
            held,
            original,
        };
        result.verify()?;
        Ok(result)
    }
    pub(super) fn verify(&self) -> Result<(), PrismError> {
        if self.path.canonicalize().ok().as_deref() != Some(self.path.as_path()) {
            return Err(failure());
        }
        for current in [
            self.held.metadata().map_err(|_| failure())?,
            std::fs::symlink_metadata(&self.path).map_err(|_| failure())?,
        ] {
            let after = identity(&current);
            #[cfg(unix)]
            if !after.directory
                || (
                    after.native.0,
                    after.native.1,
                    after.native.2,
                    after.native.6,
                    after.native.7,
                ) != (
                    self.original.native.0,
                    self.original.native.1,
                    self.original.native.2,
                    self.original.native.6,
                    self.original.native.7,
                )
            {
                return Err(failure());
            }
            #[cfg(not(unix))]
            if after != self.original {
                return Err(failure());
            }
        }
        Ok(())
    }
}

pub(super) fn capture_source(root: &Path) -> Result<Snapshot, PrismError> {
    let snapshot = capture_members(root, source_members()?, false)?;
    if snapshot.0.contains_key(".lake") {
        return Err(failure());
    }
    Ok(snapshot)
}

pub(super) fn authenticate_seed(
    root: &Path,
    sources: bool,
    expected: &serde_json::Value,
) -> Result<Snapshot, PrismError> {
    let observed = capture_members(
        root,
        if sources {
            source_members()?
        } else {
            BTreeMap::new()
        },
        true,
    )?;
    if observed.seed_files() != *expected {
        return Err(PrismError::new(
            "PP5008",
            "staged exporter differs from authenticated SDK manifest",
        ));
    }
    Ok(observed)
}

fn capture_members(
    root: &Path,
    mut sources: BTreeMap<String, SourceMember>,
    require_executable: bool,
) -> Result<Snapshot, PrismError> {
    if root.canonicalize().ok().as_deref() != Some(root) {
        return Err(failure());
    }
    // Seed bounds count .lake and its descendants, not the pinned source
    // members or the package root. Preserve that full admitted domain.
    let maximum_names = sources.len() + FILES + 1;
    let mut observed = BTreeMap::new();
    let mut build_entries = 0;
    let mut build_bytes = 0;
    // Bound names before buffering them. WalkDir may collect an unbounded
    // remainder of a directory when its open-descriptor limit is reached.
    let mut pending = vec![root.to_owned()];
    while let Some(owned_path) = pending.pop() {
        let path = owned_path.as_path();
        let relative = member_name(path.strip_prefix(root).map_err(|_| failure())?)?;
        let metadata = std::fs::symlink_metadata(path).map_err(|_| failure())?;
        if observed.len() >= maximum_names
            || path.canonicalize().ok().as_deref() != Some(path)
            || metadata.file_type().is_symlink()
            || !(metadata.is_file() || metadata.is_dir())
        {
            return Err(failure());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.uid() != rustix::process::geteuid().as_raw()
                || metadata.mode() & 0o7000 != 0
                || (metadata.is_file() && metadata.nlink() != 1)
            {
                return Err(failure());
            }
        }
        let before = identity(&metadata);
        if relative == ".lake" || relative.starts_with(".lake/") {
            charge_build(
                &mut build_entries,
                &mut build_bytes,
                if metadata.is_file() {
                    metadata.len()
                } else {
                    0
                },
            )?;
        }
        let mut digest = None;
        let source = sources.remove(&relative);
        if !relative.is_empty()
            && relative != ".lake"
            && !relative.starts_with(".lake/")
            && source.is_none()
        {
            return Err(failure());
        }
        if let Some(SourceMember {
            directory,
            mode: _mode,
            ..
        }) = &source
        {
            if *directory != metadata.is_dir() {
                return Err(failure());
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if _mode.is_some_and(|mode| metadata.mode() & 0o777 != mode & 0o777) {
                    return Err(failure());
                }
            }
        }
        if metadata.is_file() {
            if metadata.len() > FILE_BYTES {
                return Err(failure());
            }
            let mut options = std::fs::OpenOptions::new();
            options.read(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.custom_flags(
                    (rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32,
                );
            }
            let mut file = options.open(path).map_err(|_| failure())?;
            if identity(&file.metadata().map_err(|_| failure())?) != before {
                return Err(failure());
            }
            let mut hash = Sha256::new();
            let mut count = 0_u64;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let length = file.read(&mut buffer).map_err(|_| failure())?;
                if length == 0 {
                    break;
                }
                count += length as u64;
                if count > metadata.len() {
                    return Err(failure());
                }
                hash.update(&buffer[..length]);
            }
            if count != metadata.len()
                || identity(&file.metadata().map_err(|_| failure())?) != before
            {
                return Err(failure());
            }
            let actual = format!("{:x}", hash.finalize());
            if let Some(SourceMember {
                bytes: expected, ..
            }) = &source
            {
                if count != expected.len() as u64
                    || actual != format!("{:x}", Sha256::digest(expected))
                {
                    return Err(failure());
                }
            }
            digest = Some(actual);
        }
        observed.insert(relative, (before, digest));
        if metadata.is_dir() {
            // Read one entry at a time, retaining at most maximum_names names.
            // The directory identity was captured before opening its stream
            // and is checked again with every other member below.
            for entry in std::fs::read_dir(path).map_err(|_| failure())? {
                if observed.len() + pending.len() >= maximum_names {
                    return Err(failure());
                }
                pending.push(entry.map_err(|_| failure())?.path());
            }
        }
    }
    if !sources.is_empty()
        || (require_executable && !observed.contains_key(".lake/build/bin/prod-export"))
    {
        return Err(failure());
    }
    // Recheck all names and identities, including directories after traversal.
    // Hash equality alone cannot accept same-byte replacement or namespace drift.
    for (relative, (before, _)) in &observed {
        let path = root.join(relative);
        if path.canonicalize().ok().as_deref() != Some(path.as_path())
            || identity(&std::fs::symlink_metadata(path).map_err(|_| failure())?) != *before
        {
            return Err(failure());
        }
    }
    Ok(Snapshot(observed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_cold_build_checks_the_original_source_snapshot() {
        let project = tempfile::tempdir().unwrap();
        let package = project.path().join("package");
        super::super::acquire(&package).unwrap();
        let original = capture_source(&package).unwrap();
        super::super::before_first_build(
            project.path(),
            &package,
            &super::super::cold_acquisition(),
            &original,
        )
        .unwrap();
        std::fs::write(package.join("Prod/Export.lean"), b"changed in-place source").unwrap();
        assert!(
            super::super::before_first_build(
                project.path(),
                &package,
                &super::super::cold_acquisition(),
                &original
            )
            .is_err(),
            "unchanged inode cannot substitute source bytes before the first Lake build"
        );
    }

    #[cfg(unix)]
    #[test]
    fn permitted_trace_refresh_cannot_rebase_file_or_directory_ownership() {
        let owner = tempfile::tempdir().unwrap();
        let root = owner.path().join("package");
        super::super::acquire(&root).unwrap();
        std::fs::create_dir_all(root.join(".lake/build/bin")).unwrap();
        std::fs::write(
            root.join(".lake/build/bin/prod-export"),
            b"unaccepted fixture",
        )
        .unwrap();
        std::fs::write(root.join(".lake/build/compile.trace"), b"original trace").unwrap();
        let before = capture(&root).unwrap();
        std::fs::write(
            root.join(".lake/build/compile.trace"),
            b"legitimate body refresh",
        )
        .unwrap();
        let after = capture(&root).unwrap();
        assert!(before.same_compiler(&after));
        // Internal metadata-negative corpus, not fabricated SDK acceptance.
        // Every row originates from the real tree above; change one ownership
        // fact in the private comparison input without requiring root CI.
        for path in [".lake/build", ".lake/build/compile.trace"] {
            for ownership in ["uid", "gid"] {
                let mut changed = after.clone();
                let (node, _) = changed.0.get_mut(path).unwrap();
                if ownership == "uid" {
                    node.native.6 = node.native.6.checked_add(1).unwrap();
                } else {
                    node.native.7 = node.native.7.checked_add(1).unwrap();
                }
                assert!(
                    !before.same_compiler(&changed),
                    "accepted {ownership} drift at {path}"
                );
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn publication_transfers_original_descendant_custody_not_just_equal_bytes() {
        use std::os::unix::fs::PermissionsExt;
        let owner = tempfile::tempdir().unwrap();
        let stage = owner.path().join("stage");
        let destination = owner.path().join("package");
        super::super::acquire(&destination).unwrap();
        std::fs::create_dir_all(stage.join(".lake/build/bin")).unwrap();
        let executable = stage.join(".lake/build/bin/prod-export");
        let compiled = stage.join(".lake/build/member.olean");
        std::fs::write(&executable, b"unaccepted filesystem executable").unwrap();
        std::fs::set_permissions(executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(&compiled, b"admitted member").unwrap();
        let staged = capture_members(&stage, BTreeMap::new(), true).unwrap();
        std::fs::rename(stage.join(".lake"), destination.join(".lake")).unwrap();
        let published = capture(&destination).unwrap();
        assert!(
            staged.same_relocated_seed(&published),
            "ordinary rename must retain the whole admitted domain"
        );
        let selected = destination.join(".lake/build/member.olean");
        let replacement = selected.with_extension("replacement");
        std::fs::write(&replacement, std::fs::read(&selected).unwrap()).unwrap();
        std::fs::set_permissions(
            &replacement,
            std::fs::metadata(&selected).unwrap().permissions(),
        )
        .unwrap();
        std::fs::rename(replacement, selected).unwrap();
        let substituted = capture(&destination).unwrap();
        assert_eq!(
            staged.seed_files(),
            substituted.seed_files(),
            "hash/mode equality alone cannot detect replacement"
        );
        assert!(
            !staged.same_relocated_seed(&substituted),
            "same-byte replacement cannot become a new admitted baseline"
        );
    }

    #[cfg(unix)]
    #[test]
    fn seed_handoff_rejects_non_executable_drift_before_first_build() {
        use std::os::unix::fs::PermissionsExt;
        // Actual filesystem handoff, not installed-SDK or compiler acceptance.
        let owner = tempfile::tempdir().unwrap();
        let root = owner.path().join("package");
        super::super::acquire(&root).unwrap();
        std::fs::create_dir_all(root.join(".lake/build/bin")).unwrap();
        std::fs::create_dir_all(root.join(".lake/build/lib/lean")).unwrap();
        let executable = root.join(".lake/build/bin/prod-export");
        let object = root.join(".lake/build/lib/lean/Dependency.olean");
        std::fs::write(&executable, b"filesystem executable fixture").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(&object, b"admitted dependency bytes").unwrap();
        let expected = capture(&root).unwrap().seed_files();
        let measured = super::super::measure_executable(&executable).unwrap();
        authenticate_seed(&root, true, &expected).unwrap();
        for mutation in ["bytes", "mode", "extra", "missing"] {
            std::fs::write(&object, b"admitted dependency bytes").unwrap();
            std::fs::set_permissions(&object, std::fs::Permissions::from_mode(0o644)).unwrap();
            match mutation {
                "bytes" => std::fs::write(&object, b"substituted dependency bytes").unwrap(),
                "mode" => std::fs::set_permissions(&object, std::fs::Permissions::from_mode(0o600))
                    .unwrap(),
                "extra" => std::fs::write(root.join(".lake/extra"), b"extra").unwrap(),
                "missing" => std::fs::remove_file(&object).unwrap(),
                _ => unreachable!(),
            }
            assert_eq!(
                super::super::measure_executable(&executable).unwrap(),
                measured
            );
            assert!(
                authenticate_seed(&root, true, &expected).is_err(),
                "accepted {mutation}"
            );
            if mutation == "extra" {
                std::fs::remove_file(root.join(".lake/extra")).unwrap();
            }
        }
    }

    fn source_archive(rows: &[(&str, u64)]) -> Vec<u8> {
        let mut archive = tar::Builder::new(Vec::new());
        for (name, length) in rows {
            let mut header = tar::Header::new_gnu();
            header.set_mode(0o644);
            header.set_size(*length);
            header.set_cksum();
            archive
                .append_data(&mut header, name, std::io::repeat(0).take(*length))
                .unwrap();
        }
        archive.into_inner().unwrap()
    }

    #[test]
    fn source_inventory_has_its_own_exact_byte_budget() {
        assert_eq!(SOURCE_BYTES, 16 * 1024 * 1024, "SPEC source-only allowance");
        assert_eq!(TREE_BYTES, 512 * 1024 * 1024, "SPEC build-only allowance");
        let exact = source_archive(&[("first", SOURCE_BYTES - 1), ("last", 1)]);
        let members = source_members_from(exact.as_slice()).unwrap();
        assert_eq!(members.len(), 2);
        assert_eq!(members["first"].bytes.len() as u64, SOURCE_BYTES - 1);
        assert_eq!(members["last"].bytes, [0]);
        drop(members);
        drop(exact);
        let excess = source_archive(&[("first", SOURCE_BYTES), ("last", 1)]);
        assert!(source_members_from(excess.as_slice()).is_err());
        drop(excess);
        assert!(
            source_members_from(source_archive(&[("oversized", SOURCE_BYTES + 1)]).as_slice())
                .is_err()
        );
        // Neither the source allowance nor the package root consumes build
        // capacity. Keep the full independently admitted 512-MiB build budget.
        let (mut entries, mut bytes) = (0, 0);
        charge_build(&mut entries, &mut bytes, FILE_BYTES).unwrap();
        charge_build(&mut entries, &mut bytes, FILE_BYTES).unwrap();
        assert_eq!(bytes, TREE_BYTES);
    }

    #[test]
    fn source_inventory_has_its_own_exact_entry_budget() {
        assert_eq!(FILES, 4096, "SPEC independent inventory entry allowance");
        let names = (0..=FILES)
            .map(|index| format!("source-{index}"))
            .collect::<Vec<_>>();
        let rows = names
            .iter()
            .map(|name| (name.as_str(), 0))
            .collect::<Vec<_>>();
        assert_eq!(
            source_members_from(source_archive(&rows[..FILES]).as_slice())
                .unwrap()
                .len(),
            FILES
        );
        assert!(source_members_from(source_archive(&rows).as_slice()).is_err());
    }

    #[test]
    fn source_inventory_rejects_declared_oversize_before_reading_payload() {
        assert_header_rejected_before_body(tar::EntryType::Regular, SOURCE_BYTES + 1);
        assert_header_rejected_before_body(tar::EntryType::Regular, u64::MAX);
    }

    #[test]
    fn source_inventory_rejects_directory_payload_before_reading_it() {
        assert_header_rejected_before_body(tar::EntryType::Directory, 1);
    }

    fn assert_header_rejected_before_body(kind: tar::EntryType, length: u64) {
        // No payload exists. Refusal must come from the declared source bound,
        // not allocation or the tar reader's subsequent truncation error.
        let mut header = tar::Header::new_gnu();
        header.set_path("member").unwrap();
        header.set_entry_type(kind);
        header.set_mode(0o644);
        header.set_size(length);
        header.set_cksum();
        struct HeaderOnly<'a> {
            header: std::io::Cursor<&'a [u8]>,
            body_read: &'a std::cell::Cell<bool>,
        }
        impl Read for HeaderOnly<'_> {
            fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
                if self.header.position() < 512 {
                    self.header.read(output)
                } else {
                    self.body_read.set(true);
                    Err(std::io::Error::other("body must not be read"))
                }
            }
        }
        let body_read = std::cell::Cell::new(false);
        let result = source_members_from(HeaderOnly {
            header: std::io::Cursor::new(header.as_bytes().as_slice()),
            body_read: &body_read,
        });
        let Err(error) = result else {
            panic!("oversized source must be refused");
        };
        assert_eq!(error.code.as_str(), "PP5008");
        assert!(
            !body_read.get(),
            "source budget must be checked before reading the body"
        );
    }

    #[test]
    fn source_inventory_rejects_truncated_member_without_partial_admission() {
        let mut header = tar::Header::new_gnu();
        header.set_path("truncated").unwrap();
        header.set_mode(0o644);
        header.set_size(2);
        header.set_cksum();
        let mut truncated = header.as_bytes().to_vec();
        truncated.push(0);
        assert!(source_members_from(truncated.as_slice()).is_err());
    }

    fn fixture() -> (tempfile::TempDir, std::path::PathBuf) {
        let owner = tempfile::tempdir().unwrap();
        let root = owner.path().join("package");
        super::super::acquire(&root).unwrap();
        std::fs::create_dir_all(root.join(".lake/build/bin")).unwrap();
        // Capture-only fixture, never compiler or execution acceptance.
        std::fs::write(
            root.join(".lake/build/bin/prod-export"),
            b"measurement fixture",
        )
        .unwrap();
        assert!(capture(&root).is_ok());
        (owner, root)
    }

    #[test]
    fn actual_capture_preserves_full_build_budget_beside_pinned_source() {
        let (_owner, root) = fixture();
        let child_bytes = std::fs::metadata(root.join(".lake/build/bin/prod-export"))
            .unwrap()
            .len();
        for (name, length) in [
            ("first", FILE_BYTES),
            ("last", TREE_BYTES - FILE_BYTES - child_bytes),
        ] {
            std::fs::File::create(root.join(".lake").join(name))
                .unwrap()
                .set_len(length)
                .unwrap();
        }
        assert!(
            capture(&root).is_ok(),
            "pinned source must not consume build bytes"
        );
        std::fs::write(root.join(".lake/overflow"), [0]).unwrap();
        assert!(
            capture(&root).is_err(),
            "actual build aggregate excess refused"
        );
    }

    #[test]
    fn every_pinned_source_member_is_required_and_byte_bound() {
        let (_owner, root) = fixture();
        for (name, member) in source_members().unwrap() {
            if member.directory {
                continue;
            }
            let path = root.join(name);
            std::fs::remove_file(&path).unwrap();
            assert!(capture(&root).is_err(), "missing source member");
            std::fs::write(&path, b"changed").unwrap();
            assert!(capture(&root).is_err(), "changed source member");
            std::fs::write(&path, member.bytes).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(
                    &path,
                    std::fs::Permissions::from_mode(member.mode.expect("file header mode")),
                )
                .unwrap();
            }
            assert!(capture(&root).is_ok());
        }
        std::fs::write(root.join("unregistered-source"), b"extra").unwrap();
        assert!(capture(&root).is_err());
    }

    #[test]
    fn build_tree_replacement_and_capture_bounds_are_enforced() {
        let (_owner, root) = fixture();
        let member = root.join(".lake/build/input");
        std::fs::write(&member, b"same bytes").unwrap();
        let original = capture(&root).unwrap();
        let replacement = root.join(".lake/build/replacement");
        std::fs::write(&replacement, b"same bytes").unwrap();
        std::fs::rename(replacement, &member).unwrap();
        assert_ne!(capture(&root).unwrap(), original);
        std::fs::OpenOptions::new()
            .write(true)
            .open(&member)
            .unwrap()
            .set_len(FILE_BYTES + 1)
            .unwrap();
        assert!(capture(&root).is_err());
        std::fs::remove_file(member).unwrap();
        let mut nested = root.join(".lake");
        for _ in 0..64 {
            nested = nested.join("nested");
            std::fs::create_dir(&nested).unwrap();
        }
        let complete = capture(&root).unwrap();
        std::fs::write(nested.join("deep-member"), b"captured").unwrap();
        assert_ne!(
            capture(&root).unwrap(),
            complete,
            "deep members are not omitted"
        );
        let (_other_owner, other) = fixture();
        let mut wide = other.join(".lake");
        for _ in 0..12 {
            wide = wide.join("deep");
            std::fs::create_dir(&wide).unwrap();
        }
        for index in 0..FILES {
            std::fs::write(wide.join(format!("entry-{index}")), b"").unwrap();
        }
        assert!(capture(&other).is_err(), "deep and wide entry count bound");
        let (_maximum_owner, maximum) = fixture();
        // Existing .lake, build, bin and prod-export are four seed entries. The
        // source inventory and roots must not consume the seed's allowance.
        for index in 4..FILES {
            std::fs::write(maximum.join(format!(".lake/entry-{index}")), b"").unwrap();
        }
        assert!(capture(&maximum).is_ok(), "complete seed entry allowance");
        std::fs::write(maximum.join(".lake/overflow"), b"").unwrap();
        assert!(capture(&maximum).is_err());
        let (mut entries, mut bytes) = (0, 0);
        charge_build(&mut entries, &mut bytes, FILE_BYTES).unwrap();
        charge_build(&mut entries, &mut bytes, FILE_BYTES).unwrap();
        assert_eq!(bytes, TREE_BYTES);
        assert!(charge_build(&mut entries, &mut bytes, 1).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn aliases_links_special_files_and_permissions_are_refused() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let (owner, root) = fixture();
        let alias = owner.path().join("alias");
        symlink(&root, &alias).unwrap();
        assert!(capture(&alias).is_err());
        let member = root.join(".lake/alias");
        symlink(root.join("lean-toolchain"), &member).unwrap();
        assert!(capture(&root).is_err());
        std::fs::remove_file(&member).unwrap();
        std::fs::hard_link(root.join("lean-toolchain"), &member).unwrap();
        assert!(capture(&root).is_err());
        std::fs::remove_file(&member).unwrap();
        let source = root.join("lean-toolchain");
        let original = std::fs::metadata(&source).unwrap().permissions();
        std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(capture(&root).is_err());
        std::fs::set_permissions(&source, original).unwrap();
        assert!(std::process::Command::new("mkfifo")
            .arg(&member)
            .status()
            .unwrap()
            .success());
        assert!(capture(&root).is_err());
        std::fs::remove_file(&member).unwrap();
        assert!(capture(&root).is_ok());
    }
}

#[cfg(all(test, unix))]
mod cold_library_tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    fn fixture(compiled: bool) -> (tempfile::TempDir, std::path::PathBuf) {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("package");
        std::fs::create_dir(&path).unwrap();
        tar::Archive::new(std::io::Cursor::new(super::super::ARCHIVE))
            .unpack(&path)
            .unwrap();
        if compiled {
            // Unaccepted filesystem custody fixture, not exporter behavior.
            std::fs::create_dir_all(path.join(".lake/build/bin")).unwrap();
            std::fs::write(
                path.join(".lake/build/bin/prod-export"),
                b"unaccepted custody fixture",
            )
            .unwrap();
            std::fs::set_permissions(
                path.join(".lake/build/bin/prod-export"),
                std::fs::Permissions::from_mode(0o700),
            )
            .unwrap();
            std::fs::write(
                path.join(".lake/build/member.olean"),
                b"held compiled member",
            )
            .unwrap();
            std::fs::write(path.join(".lake/build/member.trace"), b"initial trace").unwrap();
        }
        (temporary, path)
    }

    // Unit variants retain only genuine selected archive headers and payloads;
    // neither these archives nor the filesystem fixture qualify an exporter.
    fn selected_archive_variant(include_directories: bool, duplicate_directory: bool) -> Vec<u8> {
        assert!(!duplicate_directory || include_directories);
        let mut files = Vec::new();
        let mut directories = Vec::new();
        for entry in tar::Archive::new(std::io::Cursor::new(super::super::ARCHIVE))
            .entries()
            .unwrap()
        {
            let mut entry = entry.unwrap();
            let header = entry.header().clone();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            if header.entry_type().is_file() {
                files.push((header, bytes));
            } else {
                assert!(header.entry_type().is_dir());
                assert!(bytes.is_empty());
                directories.push((header, bytes));
            }
        }
        let mut writer = tar::Builder::new(Vec::new());
        for (header, bytes) in &files {
            writer.append(header, bytes.as_slice()).unwrap();
        }
        if include_directories {
            // Reordering the real directories after their real descendants
            // exercises replacement of inferred parents by authoritative modes.
            for (header, bytes) in &directories {
                writer.append(header, bytes.as_slice()).unwrap();
            }
        }
        if duplicate_directory {
            let (header, bytes) = directories.first().unwrap();
            writer.append(header, bytes.as_slice()).unwrap();
        }
        writer.into_inner().unwrap()
    }

    #[test]
    fn original_file_only_archive_derives_exact_owned_parent_closure() {
        let (_temporary, path) = fixture(false);
        let expected = source_members().unwrap();
        assert!(expected["Prod"].directory);
        assert!(expected["Prod/Export.lean"].mode.is_some());
        // Compare every explicit member to its real selected header, including
        // directory modes; do not assume the donor's file-only archive shape.
        for entry in tar::Archive::new(std::io::Cursor::new(super::super::ARCHIVE))
            .entries()
            .unwrap()
        {
            let entry = entry.unwrap();
            let name = member_name(&entry.path().unwrap()).unwrap();
            let member = &expected[&name];
            assert_eq!(member.directory, entry.header().entry_type().is_dir());
            assert_eq!(member.mode, Some(entry.header().mode().unwrap()));
        }
        let snapshot = capture_source(&path).unwrap();
        assert_eq!(snapshot.0.len(), expected.len() + 1);

        let file_only = selected_archive_variant(false, false);
        let implicit = source_members_from(file_only.as_slice()).unwrap();
        assert!(implicit.keys().eq(expected.keys()));
        assert!(implicit["Prod"].directory && implicit["Prod"].mode.is_none());
        for (name, member) in &implicit {
            let original = &expected[name];
            assert_eq!(member.directory, original.directory);
            assert_eq!(member.bytes, original.bytes);
            if member.directory {
                assert!(member.mode.is_none());
            } else {
                assert_eq!(member.mode, original.mode);
            }
        }
        assert_eq!(
            capture_members(&path, implicit, false).unwrap().0.len(),
            expected.len() + 1
        );

        let directories_last = selected_archive_variant(true, false);
        let upgraded = source_members_from(directories_last.as_slice()).unwrap();
        assert!(upgraded.keys().eq(expected.keys()));
        for (name, member) in &upgraded {
            let original = &expected[name];
            assert_eq!(member.directory, original.directory);
            assert_eq!(member.mode, original.mode);
            assert_eq!(member.bytes, original.bytes);
        }
        assert_eq!(
            capture_members(&path, upgraded, false).unwrap().0.len(),
            expected.len() + 1
        );
        let duplicate = selected_archive_variant(true, true);
        assert!(source_members_from(duplicate.as_slice()).is_err());

        std::fs::create_dir(path.join("unexpected")).unwrap();
        assert!(capture_source(&path).is_err());
        let implicit = source_members_from(file_only.as_slice()).unwrap();
        assert!(capture_members(&path, implicit, false).is_err());
    }

    #[test]
    fn archive_duplicate_prefix_alias_and_build_state_refuse_before_extraction() {
        let archive = |paths: &[(&str, u8)]| {
            let mut writer = tar::Builder::new(Vec::new());
            for (path, kind) in paths {
                let mut header = tar::Header::new_gnu();
                header.set_entry_type(tar::EntryType::new(*kind));
                header.set_mode(0o644);
                header.set_size(0);
                header.set_cksum();
                writer
                    .append_data(&mut header, path, std::io::empty())
                    .unwrap();
            }
            writer.into_inner().unwrap()
        };
        for paths in [
            vec![("a", b'0'), ("a", b'0')],
            vec![("a", b'0'), ("a/b", b'0')],
            vec![("a/b", b'0'), ("a", b'0')],
            vec![("a", b'2')],
            vec![(".lake/state", b'0')],
        ] {
            assert!(source_members_from(archive(&paths).as_slice()).is_err());
        }
    }

    #[test]
    fn cold_source_hash_inode_link_mode_and_alias_are_original_custody() {
        for kind in ["bytes", "inode", "link", "mode", "alias"] {
            let (_temporary, root) = fixture(false);
            let before = capture_source(&root).unwrap();
            let path = root.join("Prod/Export.lean");
            match kind {
                "bytes" => std::fs::write(&path, b"altered actual compiler source").unwrap(),
                "inode" => {
                    let old = root.parent().unwrap().join("saved");
                    std::fs::rename(&path, &old).unwrap();
                    std::fs::copy(old, &path).unwrap();
                }
                "link" => std::fs::hard_link(&path, root.parent().unwrap().join("linked")).unwrap(),
                "mode" => {
                    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap()
                }
                "alias" => {
                    std::fs::remove_file(&path).unwrap();
                    symlink(root.join("lean-toolchain"), &path).unwrap();
                }
                _ => unreachable!(),
            }
            assert!(
                capture_source(&root).map_or(true, |after| before != after),
                "{kind}"
            );
        }
    }

    #[test]
    fn warm_runtime_accepts_only_original_trace_refresh_not_compiled_or_source_drift() {
        let (_temporary, root) = fixture(true);
        let before = capture(&root).unwrap();
        std::fs::write(
            root.join(".lake/build/member.trace"),
            b"normal refreshed trace",
        )
        .unwrap();
        assert!(before.same_compiler(&capture(&root).unwrap()));
        for name in [".lake/build/member.olean", ".lake/build/bin/prod-export"] {
            let (_temporary, root) = fixture(true);
            let before = capture(&root).unwrap();
            let path = root.join(name);
            let bytes = std::fs::read(&path).unwrap();
            std::fs::write(&path, &bytes).unwrap();
            std::fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_times(
                    std::fs::FileTimes::new()
                        .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1)),
                )
                .unwrap();
            assert!(
                !before.same_compiler(&capture(&root).unwrap()),
                "full metadata {name}"
            );
        }
        let (_temporary, root) = fixture(true);
        let before = capture(&root).unwrap();
        std::fs::write(root.join(".lake/added"), b"unexpected warm member").unwrap();
        assert!(!before.same_compiler(&capture(&root).unwrap()));
    }

    #[test]
    fn complete_build_entry_and_per_file_bounds_are_enforced_before_retention() {
        let (_temporary, root) = fixture(true);
        let initial = capture(&root)
            .unwrap()
            .0
            .keys()
            .filter(|name| name.as_str() == ".lake" || name.starts_with(".lake/"))
            .count();
        for index in initial..FILES {
            std::fs::write(root.join(format!(".lake/entry-{index}")), []).unwrap();
        }
        capture(&root).expect("complete original build entry allowance");
        std::fs::write(root.join(".lake/one-over"), []).unwrap();
        assert!(capture(&root).is_err());
        let (_temporary, root) = fixture(true);
        let file = std::fs::File::create(root.join(".lake/too-large")).unwrap();
        file.set_len(FILE_BYTES + 1).unwrap();
        assert!(capture(&root).is_err());
    }

    #[test]
    fn actual_cwd_and_launcher_witness_refuse_replacement_and_metadata_changes() {
        let temporary = tempfile::tempdir().unwrap();
        let cwd = temporary.path().join("cwd");
        std::fs::create_dir(&cwd).unwrap();
        let held = Cwd::open(&cwd).unwrap();
        // Real build growth is permitted, but never replacement of the cwd.
        std::fs::write(cwd.join("actual-child"), b"child").unwrap();
        held.verify().unwrap();
        std::fs::rename(&cwd, temporary.path().join("original")).unwrap();
        std::fs::create_dir(&cwd).unwrap();
        assert!(held.verify().is_err());
        let path = temporary.path().join("launcher");
        std::fs::write(&path, b"actual bounded bytes").unwrap();
        let original = capture_file(&path).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode ^ 0o040)).unwrap();
        assert_ne!(capture_file(&path).unwrap(), original);
        let alias = temporary.path().join("alias");
        symlink(&path, &alias).unwrap();
        assert!(capture_file(&alias).is_err());
        let selected = capture_launcher(&alias).unwrap();
        assert_eq!(capture_launcher(&alias).unwrap(), selected);
        let replacement = temporary.path().join("replacement");
        std::fs::copy(&path, &replacement).unwrap();
        std::fs::remove_file(&alias).unwrap();
        symlink(&replacement, &alias).unwrap();
        assert_ne!(
            capture_launcher(&alias).unwrap(),
            selected,
            "proxy redirection is not byte equality"
        );
    }
}
