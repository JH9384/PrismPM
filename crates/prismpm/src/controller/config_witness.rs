//! Descriptor-backed bounded observations, not an atomic compiler constructor.

use crate::error::PrismError;
use std::fs::{File, Metadata, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[cfg(unix)]
#[derive(Clone, PartialEq, Eq)]
struct Identity {
    dev: u64,
    ino: u64,
    mode: u32,
    size: u64,
    uid: u32,
    gid: u32,
    nlink: u64,
    mtime_ns: i128,
    ctime_ns: i128,
}

#[cfg(unix)]
impl Identity {
    fn of(metadata: &Metadata) -> Self {
        use std::os::unix::fs::MetadataExt;
        Self {
            dev: metadata.dev(),
            ino: metadata.ino(),
            mode: metadata.mode(),
            size: metadata.size(),
            uid: metadata.uid(),
            gid: metadata.gid(),
            nlink: metadata.nlink(),
            mtime_ns: i128::from(metadata.mtime()) * 1_000_000_000
                + i128::from(metadata.mtime_nsec()),
            ctime_ns: i128::from(metadata.ctime()) * 1_000_000_000
                + i128::from(metadata.ctime_nsec()),
        }
    }
}

#[cfg(not(unix))]
#[derive(Clone, PartialEq, Eq)]
struct Identity {
    size: u64,
    readonly: bool,
    modified: Option<std::time::SystemTime>,
    created: Option<std::time::SystemTime>,
}

#[cfg(not(unix))]
impl Identity {
    fn of(metadata: &Metadata) -> Self {
        Self {
            size: metadata.len(),
            readonly: metadata.permissions().readonly(),
            modified: metadata.modified().ok(),
            created: metadata.created().ok(),
        }
    }
}

#[derive(Clone)]
pub(super) struct Witness {
    path: PathBuf,
    resolved: PathBuf,
    identity: Identity,
    bytes: Arc<Vec<u8>>,
    held: Arc<File>,
}

impl PartialEq for Witness {
    fn eq(&self, other: &Self) -> bool {
        self.path == other.path
            && self.resolved == other.resolved
            && self.identity == other.identity
            && self.bytes == other.bytes
    }
}

impl Eq for Witness {}

fn changed() -> PrismError {
    PrismError::new("PP9001", "model configuration changed during execution")
}

fn read_at(file: &File, bytes: &mut [u8], offset: u64) -> std::io::Result<usize> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        file.read_at(bytes, offset)
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        file.seek_read(bytes, offset)
    }
    #[cfg(not(any(unix, windows)))]
    {
        use std::io::{Read, Seek, SeekFrom};
        let mut reader = file.try_clone()?;
        reader.seek(SeekFrom::Start(offset))?;
        reader.read(bytes)
    }
}

fn complete_bytes(file: &File, size: u64) -> Result<Vec<u8>, PrismError> {
    let size = usize::try_from(size).map_err(|_| changed())?;
    let mut bytes = Vec::new();
    bytes.try_reserve_exact(size).map_err(|_| changed())?;
    bytes.resize(size, 0);
    let mut offset = 0;
    while offset < size {
        let end = size.min(offset.saturating_add(65_536));
        let count = read_at(file, &mut bytes[offset..end], offset as u64).map_err(|_| changed())?;
        if count == 0 {
            return Err(changed());
        }
        offset += count;
    }
    if read_at(file, &mut [0], size as u64).map_err(|_| changed())? != 0 {
        return Err(changed());
    }
    Ok(bytes)
}

impl Witness {
    pub(super) fn capture(path: &Path) -> Result<Self, PrismError> {
        let resolved = path.canonicalize().map_err(|_| changed())?;
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(
                (rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32,
            );
        }
        let held = options.open(path).map_err(|_| changed())?;
        let metadata = held.metadata().map_err(|_| changed())?;
        if !metadata.is_file() {
            return Err(changed());
        }
        let identity = Identity::of(&metadata);
        let bytes = complete_bytes(&held, metadata.len())?;
        let witness = Self {
            path: path.to_owned(),
            resolved,
            identity,
            bytes: Arc::new(bytes),
            held: Arc::new(held),
        };
        witness.check()?;
        Ok(witness)
    }

    pub(super) fn bytes(&self) -> &[u8] {
        self.bytes.as_slice()
    }

    pub(super) fn check(&self) -> Result<(), PrismError> {
        let observe = || {
            let descriptor = self.held.metadata().map_err(|_| changed())?;
            let selected = std::fs::symlink_metadata(&self.path).map_err(|_| changed())?;
            if !descriptor.is_file()
                || !selected.is_file()
                || Identity::of(&descriptor) != self.identity
                || Identity::of(&selected) != self.identity
                || self.path.canonicalize().map_err(|_| changed())? != self.resolved
            {
                return Err(changed());
            }
            Ok(descriptor.len())
        };
        let size = observe()?;
        if complete_bytes(&self.held, size)?.as_slice() != self.bytes.as_slice() {
            return Err(changed());
        }
        observe()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacement_with_equal_bytes_cannot_replace_the_held_file() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("configuration");
        std::fs::write(&path, b"original bytes").unwrap();
        let witness = Witness::capture(&path).unwrap();
        let replacement = temporary.path().join("replacement");
        std::fs::write(&replacement, b"original bytes").unwrap();
        std::fs::rename(replacement, path).unwrap();
        assert_eq!(witness.check().unwrap_err().code, "PP9001");
    }

    #[cfg(unix)]
    #[test]
    fn initial_readonly_hardlinks_are_valid_but_write_restore_is_not() {
        use std::os::unix::fs::PermissionsExt;
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("configuration");
        let alias = temporary.path().join("selected-hardlink");
        std::fs::write(&path, b"original bytes").unwrap();
        std::fs::hard_link(&path, &alias).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o400)).unwrap();
        let witness = Witness::capture(&alias).unwrap();
        witness.check().unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::write(&path, b"modified bytes").unwrap();
        std::fs::write(&path, b"original bytes").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o400)).unwrap();
        assert_eq!(std::fs::read(&alias).unwrap(), witness.bytes());
        assert_eq!(witness.check().unwrap_err().code, "PP9001");
    }

    #[cfg(unix)]
    #[test]
    fn restoring_bytes_and_mtime_does_not_restore_native_custody() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("configuration");
        std::fs::write(&path, b"original bytes").unwrap();
        let witness = Witness::capture(&path).unwrap();
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        std::fs::write(&path, b"modified bytes").unwrap();
        std::fs::write(&path, b"original bytes").unwrap();
        let writer = OpenOptions::new().write(true).open(&path).unwrap();
        writer
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        let mut after = Identity::of(&writer.metadata().unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), witness.bytes());
        assert_eq!(after.mtime_ns, witness.identity.mtime_ns);
        assert_ne!(after.ctime_ns, witness.identity.ctime_ns);
        after.ctime_ns = witness.identity.ctime_ns;
        assert!(
            after == witness.identity,
            "only ctime must distinguish this restore"
        );
        assert_eq!(witness.check().unwrap_err().code, "PP9001");
    }
}
