//! Actual corpus-byte capture. A matching SDK claim is not image authentication.

use super::*;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Arc;
use std::time::SystemTime;

const MAX_FILES: usize = 65_536;
const MAX_DIRECTORIES: usize = 65_536;
const MAX_CORPORA: usize = 4096;
const MAX_PATH_BYTES: usize = 2048;
const MAX_BYTES: u64 = 10_737_418_240;
// Preserve every formerly legal corpus combination. This explicit reservation
// bounds retained metadata, not practical RAM usage: the full Cartesian maximum
// still requires a future streaming/spooled owner before resource acceptance.
// File paths occur in both maps; directory paths occur in the inventory only.
const ENTRY_RESERVATION: u64 = MAX_PATH_BYTES as u64 + 128;
const MAX_METADATA_BYTES: u64 =
    MAX_CORPORA as u64 * (2 * MAX_FILES + MAX_DIRECTORIES) as u64 * ENTRY_RESERVATION;

#[cfg(test)]
thread_local! { static READ_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
#[cfg(test)]
thread_local! { static HASH_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

#[derive(Debug, Eq, PartialEq)]
struct Entry {
    directory: bool,
    size: u64,
    modified: SystemTime,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}

struct Corpus {
    path: String,
    digest: String,
    entries: BTreeMap<String, Entry>,
    files: BTreeMap<String, Vec<u8>>,
}

pub(super) struct CapturedCorpora {
    // No mutable or byte-bearing accessor escapes this module after sealing.
    values: BTreeMap<String, Arc<Corpus>>,
}

struct Budget {
    bytes: u64,
    metadata: u64,
}

fn metadata_reservation(path: &str, directory: bool) -> Result<u64, PrismError> {
    (path.len() as u64)
        .checked_add(128)
        .and_then(|size| size.checked_mul(if directory { 1 } else { 2 }))
        .ok_or_else(|| invalid("corpus metadata reservation overflow"))
}

fn reserve(total: &mut u64, amount: u64, remaining: u64) -> Result<(), PrismError> {
    *total = total
        .checked_add(amount)
        .filter(|size| *size <= remaining)
        .ok_or_else(|| {
            invalid("corpus inventory exceeds the remaining aggregate metadata budget")
        })?;
    Ok(())
}

fn declarations<'a>(
    captured: &'a VerifiedReleaseCapture,
    projection: &Projection,
) -> Result<BTreeMap<String, &'a Value>, PrismError> {
    let mut expected = BTreeMap::new();
    for requirement in rows(projection.value.field("requirements")?, 64, 4096)? {
        let Literal::Variant(_, 1, fields) = requirement.field("requirement")? else {
            continue;
        };
        let [execution] = fields.as_slice() else {
            return Err(invalid("execution requirement is not a closed payload"));
        };
        let id = identifier(execution.field("oracle")?)?;
        let matches = captured.standards_lock.value()["oracles"]
            .as_array()
            .ok_or_else(|| invalid("captured oracle contracts absent"))?
            .iter()
            .filter(|oracle| oracle["id"] == id)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(invalid(
                "execution requirement has no unique oracle corpus contract",
            ));
        }
        expected.insert(id, matches[0]);
    }
    Ok(expected)
}

fn tree_digest(files: &BTreeMap<String, Vec<u8>>) -> String {
    #[cfg(test)]
    HASH_COUNT.with(|count| count.set(count.get() + 1));
    // Existing SDK corpus framing; directories are retained separately, not silently
    // added to that established file-content identity format.
    let mut digest = Sha256::new();
    for (path, bytes) in files {
        digest.update((path.len() as u64).to_be_bytes());
        digest.update(path.as_bytes());
        digest.update((bytes.len() as u64).to_be_bytes());
        digest.update(bytes);
    }
    format!("{:x}", digest.finalize())
}

fn binds_inventory(lock: &Value, digest: &str) -> Result<(), PrismError> {
    let inventories = match lock["schema"].as_str() {
        Some("prismpm/sdk-lock/1") => vec![&lock["inventory"]],
        Some("prismpm/sdk-lock/2") => lock["platforms"]
            .as_array()
            .ok_or_else(|| invalid("SDK platform inventory absent"))?
            .iter()
            .map(|platform| &platform["inventory"])
            .collect(),
        _ => return Err(invalid("unsupported captured SDK lock")),
    };
    if inventories.is_empty() {
        return Err(invalid("SDK corpus inventory absent"));
    }
    let digest = format!("sha256:{digest}");
    for inventory in inventories {
        let rows = inventory
            .as_array()
            .ok_or_else(|| invalid("SDK corpus inventory absent"))?;
        if !rows
            .iter()
            .any(|row| row["kind"] == "test-corpus" && row["digest"] == digest)
        {
            return Err(invalid(
                "actual oracle corpus bytes are not bound by every captured SDK platform",
            ));
        }
        let mut ids = BTreeSet::new();
        for row in rows {
            let id = row["id"]
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| invalid("SDK corpus inventory member identity absent"))?;
            if !ids.insert(id) {
                return Err(invalid("duplicate SDK corpus inventory member identity"));
            }
        }
    }
    Ok(())
}

fn bounded_add(total: &mut u64, amount: u64) -> Result<(), PrismError> {
    *total = total
        .checked_add(amount)
        .filter(|total| *total <= MAX_BYTES)
        .ok_or_else(|| {
            invalid("complete captured corpus closure exceeds the evidence-byte bound")
        })?;
    Ok(())
}

fn inventory(root: &Path, budget: &Budget) -> Result<BTreeMap<String, Entry>, PrismError> {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    let mut entries = BTreeMap::new();
    let mut files = 0;
    let mut directories = 0;
    let mut total = 0;
    let mut metadata_total = 0;
    #[cfg(unix)]
    let mut identities = BTreeSet::new();
    for entry in walkdir::WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|error| invalid(error.to_string()))?;
        let path = entry
            .path()
            .strip_prefix(root)
            .ok()
            .and_then(Path::to_str)
            .ok_or_else(|| invalid("corpus inventory path is not UTF-8"))?;
        if path.len() > MAX_PATH_BYTES {
            return Err(invalid(
                "corpus inventory path exceeds its UTF-8 byte bound",
            ));
        }
        if !path.is_empty() {
            super::super::relative(path)?;
        }
        let metadata =
            std::fs::symlink_metadata(entry.path()).map_err(|error| invalid(error.to_string()))?;
        if metadata.file_type().is_symlink() || !(metadata.is_dir() || metadata.is_file()) {
            return Err(invalid(
                "corpus entries must be confined directories or regular files",
            ));
        }
        #[cfg(unix)]
        if (!metadata.is_dir() && metadata.nlink() != 1)
            || !identities.insert((metadata.dev(), metadata.ino()))
        {
            return Err(invalid("corpus entries must not be filesystem aliases"));
        }
        if metadata.is_dir() {
            directories += 1;
            if directories > MAX_DIRECTORIES {
                return Err(invalid("corpus directory limit exceeded"));
            }
        } else {
            files += 1;
            if files > MAX_FILES {
                return Err(invalid("corpus file limit exceeded"));
            }
            bounded_add(&mut total, metadata.len())?;
            if total > budget.bytes {
                return Err(invalid(
                    "corpus inventory exceeds the remaining aggregate byte budget",
                ));
            }
        }
        reserve(
            &mut metadata_total,
            metadata_reservation(path, metadata.is_dir())?,
            budget.metadata,
        )?;
        let value = Entry {
            directory: metadata.is_dir(),
            size: metadata.len(),
            modified: metadata
                .modified()
                .map_err(|error| invalid(error.to_string()))?,
            #[cfg(unix)]
            identity: (
                metadata.dev(),
                metadata.ino(),
                metadata.ctime(),
                metadata.ctime_nsec(),
            ),
        };
        if entries.insert(path.to_owned(), value).is_some() {
            return Err(invalid("duplicate corpus inventory path"));
        }
    }
    Ok(entries)
}

fn capture_bounded(
    root: &Path,
    contract: &Value,
    lock: &Value,
    budget: &Budget,
) -> Result<Corpus, PrismError> {
    if budget.bytes > MAX_BYTES || budget.metadata > MAX_METADATA_BYTES {
        return Err(invalid("corpus aggregate budget exceeds the fixed bound"));
    }
    if root.canonicalize().ok().as_deref() != Some(root) {
        return Err(invalid(
            "installed SDK corpus root is absent or noncanonical",
        ));
    }
    let (path, expected) = identity(contract)?;
    let directory = root.join(path);
    if directory.canonicalize().ok().as_deref() != Some(directory.as_path()) {
        return Err(invalid("SDK corpus directory is absent or aliased"));
    }
    let entries = inventory(&directory, budget)?;
    let mut files = BTreeMap::new();
    for (name, entry) in &entries {
        if !entry.directory {
            #[cfg(test)]
            READ_COUNT.with(|count| count.set(count.get() + 1));
            let bytes = super::super::verification_closure::confined_file_bounded(
                &directory, name, entry.size,
            )?;
            if bytes.len() as u64 != entry.size {
                return Err(invalid("corpus file size changed during capture"));
            }
            files.insert(name.clone(), bytes);
        }
    }
    if files.is_empty() {
        return Err(invalid("execution requirement corpus is empty"));
    }
    if inventory(&directory, budget)? != entries
        || directory.canonicalize().ok().as_deref() != Some(directory.as_path())
    {
        return Err(invalid(
            "corpus file/directory inventory changed during capture",
        ));
    }
    let observed = tree_digest(&files);
    if observed != expected {
        return Err(invalid(
            "actual SDK corpus bytes differ from the captured oracle contract",
        ));
    }
    binds_inventory(lock, &observed)?;
    Ok(Corpus {
        path: path.to_owned(),
        digest: observed,
        entries,
        files,
    })
}

#[cfg(test)]
fn capture(root: &Path, contract: &Value, lock: &Value) -> Result<Corpus, PrismError> {
    capture_bounded(
        root,
        contract,
        lock,
        &Budget {
            bytes: MAX_BYTES,
            metadata: MAX_METADATA_BYTES,
        },
    )
}

fn identity(contract: &Value) -> Result<(&str, &str), PrismError> {
    let path = contract
        .pointer("/corpus/path")
        .and_then(Value::as_str)
        .filter(|path| path.starts_with("standards/") && path.len() <= MAX_PATH_BYTES)
        .ok_or_else(|| invalid("execution requirement has no exact retained SDK corpus path"))?;
    super::super::relative(path)?;
    let digest = contract
        .pointer("/corpus/sha256")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("execution requirement corpus identity absent"))?;
    hex_bytes(digest, 32)?;
    Ok((path, digest))
}

fn capture_batch(
    root: &Path,
    declarations: BTreeMap<String, &Value>,
    lock: &Value,
    limit: u64,
) -> Result<CapturedCorpora, PrismError> {
    capture_batch_bounded(
        root,
        declarations,
        lock,
        Budget {
            bytes: limit,
            metadata: MAX_METADATA_BYTES,
        },
    )
}

fn capture_batch_bounded(
    root: &Path,
    declarations: BTreeMap<String, &Value>,
    lock: &Value,
    mut budget: Budget,
) -> Result<CapturedCorpora, PrismError> {
    if budget.bytes > MAX_BYTES || budget.metadata > MAX_METADATA_BYTES {
        return Err(invalid("corpus aggregate budget exceeds the fixed bound"));
    }
    if declarations.len() > MAX_CORPORA {
        return Err(invalid(
            "captured corpus contract inventory exceeds the requirement bound",
        ));
    }
    let mut values = BTreeMap::new();
    let mut unique = BTreeMap::<String, Arc<Corpus>>::new();
    for (id, contract) in declarations {
        let (path, digest) = identity(contract)?;
        if let Some(corpus) = unique.get(path) {
            if corpus.digest != digest {
                return Err(invalid(
                    "one captured corpus path has conflicting identities",
                ));
            }
            values.insert(id, Arc::clone(corpus));
            continue;
        }
        // Inventory the entire next corpus against remaining capacity before
        // any of its file bytes can be read or allocated. Aliased contracts
        // retain a shared immutable capture, never another read or allocation.
        let corpus = capture_bounded(root, contract, lock, &budget)?;
        let mut total = 0;
        for bytes in corpus.files.values() {
            bounded_add(&mut total, bytes.len() as u64)?;
        }
        let mut metadata = 0;
        for (path, entry) in &corpus.entries {
            reserve(
                &mut metadata,
                metadata_reservation(path, entry.directory)?,
                budget.metadata,
            )?;
        }
        budget.bytes = budget
            .bytes
            .checked_sub(total)
            .ok_or_else(|| invalid("captured corpus byte accounting overflow"))?;
        budget.metadata = budget
            .metadata
            .checked_sub(metadata)
            .ok_or_else(|| invalid("captured corpus metadata accounting overflow"))?;
        let corpus = Arc::new(corpus);
        unique.insert(path.to_owned(), Arc::clone(&corpus));
        values.insert(id, corpus);
    }
    CapturedCorpora::seal(values)
}

impl CapturedCorpora {
    fn seal(values: BTreeMap<String, Arc<Corpus>>) -> Result<Self, PrismError> {
        let mut seen = BTreeSet::new();
        for corpus in values.values() {
            if !seen.insert(Arc::as_ptr(corpus)) {
                continue;
            }
            if tree_digest(&corpus.files) != corpus.digest
                || corpus
                    .entries
                    .iter()
                    .filter(|(_, entry)| !entry.directory)
                    .count()
                    != corpus.files.len()
                || corpus.files.iter().any(|(name, bytes)| {
                    !corpus
                        .entries
                        .get(name)
                        .is_some_and(|entry| !entry.directory && entry.size == bytes.len() as u64)
                })
            {
                return Err(invalid(
                    "retained corpus bytes or inventory changed before sealing",
                ));
            }
        }
        Ok(Self { values })
    }

    /// Fixed installed SDK location only; the caller cannot substitute a search root.
    pub(super) fn from_installed(
        captured: &VerifiedReleaseCapture,
        projection: &Projection,
    ) -> Result<Self, PrismError> {
        Self::read(Path::new("/opt/prismpm/share"), captured, projection)
    }

    fn read(
        root: &Path,
        captured: &VerifiedReleaseCapture,
        projection: &Projection,
    ) -> Result<Self, PrismError> {
        capture_batch(
            root,
            declarations(captured, projection)?,
            captured.sdk_lock.value(),
            MAX_BYTES,
        )
    }

    pub(super) fn require(&self, id: &str, contract: &Value) -> Result<(), PrismError> {
        let corpus = self
            .values
            .get(id)
            .ok_or_else(|| invalid("execution requirement has no captured corpus bytes"))?;
        let (path, digest) = identity(contract)?;
        if path != corpus.path || digest != corpus.digest {
            return Err(invalid(
                "oracle contract differs from the sealed immutable corpus identity",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (tempfile::TempDir, Value, Value, BTreeMap<String, Vec<u8>>) {
        let root = tempfile::tempdir().unwrap();
        let files = BTreeMap::from([
            ("z.txt".to_owned(), b"last ASCII".to_vec()),
            ("nested/é.txt".to_owned(), b"two UTF-8 bytes".to_vec()),
            ("🙂.txt".to_owned(), b"four UTF-8 bytes".to_vec()),
        ]);
        std::fs::create_dir_all(root.path().join("standards/corpus/empty")).unwrap();
        // Deliberately opposite traversal/creation order from the canonical byte order.
        for (path, bytes) in files.iter().rev() {
            let path = root.path().join("standards/corpus").join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        let digest = tree_digest(&files);
        let contract =
            json!({"id":"fixture-oracle","corpus":{"path":"standards/corpus","sha256":digest}});
        let inventory = json!([{"id":"fixture-corpus","kind":"test-corpus","digest":format!("sha256:{digest}")}]);
        let lock = json!({"schema":"prismpm/sdk-lock/2","platforms":[
            {"platform":"linux/amd64","inventory":inventory},
            {"platform":"linux/arm64","inventory":inventory}
        ]});
        (root, contract, lock, files)
    }

    #[test]
    fn actual_corpus_bytes_and_complete_tree_are_retained_in_utf8_order() {
        let (root, contract, lock, files) = fixture();
        let corpus = capture(root.path(), &contract, &lock).unwrap();
        assert_eq!(corpus.files, files);
        assert_eq!(
            corpus
                .entries
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["", "empty", "nested", "nested/é.txt", "z.txt", "🙂.txt"]
        );
        assert!(corpus.entries["empty"].directory);
        let captured = CapturedCorpora::seal(BTreeMap::from([(
            "fixture-oracle".to_owned(),
            Arc::new(corpus),
        )]))
        .unwrap();
        captured.require("fixture-oracle", &contract).unwrap();
        assert!(captured.require("unknown", &contract).is_err());
        // Exact framing is also constructed independently of tree_digest.
        let mut input = Vec::new();
        for (path, bytes) in &files {
            input.extend_from_slice(&(path.len() as u64).to_be_bytes());
            input.extend_from_slice(path.as_bytes());
            input.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
            input.extend_from_slice(bytes);
        }
        assert_eq!(tree_digest(&files), format!("{:x}", Sha256::digest(input)));
    }

    #[test]
    fn actual_changed_extra_and_missing_corpus_files_are_rejected() {
        for mutation in 0..3 {
            let (root, contract, lock, _) = fixture();
            let directory = root.path().join("standards/corpus");
            match mutation {
                0 => std::fs::write(directory.join("z.txt"), b"changed!!").unwrap(),
                1 => std::fs::write(directory.join("unregistered.txt"), b"extra").unwrap(),
                2 => std::fs::remove_file(directory.join("z.txt")).unwrap(),
                _ => unreachable!(),
            }
            assert!(
                capture(root.path(), &contract, &lock).is_err(),
                "mutation {mutation}"
            );
        }
    }

    #[test]
    fn actual_corpus_must_match_every_platform_and_unique_inventory_identity() {
        for mutation in 0..5 {
            let (root, contract, mut lock, _) = fixture();
            match mutation {
                0 => lock["platforms"][1]["inventory"] = json!([]),
                1 => {
                    lock["platforms"][1]["inventory"][0]["digest"] =
                        json!(format!("sha256:{}", "0".repeat(64)))
                }
                2 => lock["platforms"][1]["inventory"][0]["kind"] = json!("binary"),
                3 => {
                    let row = lock["platforms"][1]["inventory"][0].clone();
                    lock["platforms"][1]["inventory"]
                        .as_array_mut()
                        .unwrap()
                        .push(row);
                }
                4 => lock["platforms"] = json!([]),
                _ => unreachable!(),
            }
            assert!(
                capture(root.path(), &contract, &lock).is_err(),
                "mutation {mutation}"
            );
        }
    }

    #[test]
    fn corpus_path_cannot_escape_or_substitute_another_share() {
        let (root, contract, lock, _) = fixture();
        for path in [
            "standards/../standards/corpus",
            "/standards/corpus",
            "standards//corpus",
            "standards/./corpus",
            "other/corpus",
            "standards/missing",
        ] {
            let mut changed = contract.clone();
            changed["corpus"]["path"] = json!(path);
            assert!(
                capture(root.path(), &changed, &lock).is_err(),
                "path {path}"
            );
        }
        let aliased_root = root.path().join("standards").join("..");
        assert!(capture(&aliased_root, &contract, &lock).is_err());
    }

    #[test]
    fn retained_corpus_rejects_postcapture_bytes_inventory_and_contract_changes() {
        for mutation in 0..5 {
            let (root, mut contract, lock, _) = fixture();
            let mut corpus = capture(root.path(), &contract, &lock).unwrap();
            match mutation {
                0 => {
                    corpus.files.get_mut("z.txt").unwrap()[0] ^= 1;
                }
                1 => {
                    corpus.entries.remove("z.txt");
                }
                2 => {
                    corpus.entries.get_mut("z.txt").unwrap().size += 1;
                }
                3 => contract["corpus"]["sha256"] = json!("0".repeat(64)),
                4 => contract["corpus"]["path"] = json!("standards/other"),
                _ => unreachable!(),
            }
            let captured = CapturedCorpora::seal(BTreeMap::from([(
                "fixture-oracle".to_owned(),
                Arc::new(corpus),
            )]));
            if mutation < 3 {
                assert!(captured.is_err(), "mutation {mutation}");
            } else {
                assert!(
                    captured
                        .unwrap()
                        .require("fixture-oracle", &contract)
                        .is_err(),
                    "mutation {mutation}"
                );
            }
        }
    }

    #[test]
    fn aggregate_corpus_bytes_accept_exact_limit_and_refuse_one_over_or_overflow() {
        let mut total = MAX_BYTES - 1;
        bounded_add(&mut total, 1).unwrap();
        assert_eq!(total, MAX_BYTES);
        assert!(bounded_add(&mut total, 1).is_err());
        assert_eq!(total, MAX_BYTES);
        total = u64::MAX;
        assert!(bounded_add(&mut total, 1).is_err());
        assert_eq!(total, u64::MAX);
    }

    #[test]
    fn second_actual_corpus_is_not_read_when_aggregate_inventory_exceeds_capacity() {
        let root = tempfile::tempdir().unwrap();
        let mut contracts = BTreeMap::new();
        let mut rows = Vec::new();
        for (id, body) in [("a", b"123456".as_slice()), ("b", b"12345678".as_slice())] {
            let path = format!("standards/{id}");
            std::fs::create_dir_all(root.path().join(&path)).unwrap();
            std::fs::write(root.path().join(&path).join("data"), body).unwrap();
            let digest = tree_digest(&BTreeMap::from([("data".to_owned(), body.to_vec())]));
            contracts.insert(
                id.to_owned(),
                json!({"corpus":{"path":path,"sha256":digest}}),
            );
            rows.push(json!({"id":id,"kind":"test-corpus","digest":format!("sha256:{digest}")}));
        }
        let lock = json!({"schema":"prismpm/sdk-lock/1","inventory":rows});
        READ_COUNT.with(|count| count.set(0));
        let result = capture_batch(
            root.path(),
            contracts
                .iter()
                .map(|(id, value)| (id.clone(), value))
                .collect(),
            &lock,
            13,
        );
        assert!(result
            .err()
            .unwrap()
            .message
            .contains("remaining aggregate byte budget"));
        READ_COUNT
            .with(|count| assert_eq!(count.get(), 1, "second corpus refused before any file read"));
        READ_COUNT.with(|count| count.set(0));
        let result = capture_batch(
            root.path(),
            contracts
                .iter()
                .map(|(id, value)| (id.clone(), value))
                .collect(),
            &lock,
            14,
        )
        .unwrap();
        assert_eq!(result.values.len(), 2);
        READ_COUNT.with(|count| assert_eq!(count.get(), 2));
        assert!(
            super::super::super::verification_closure::confined_file_bounded(
                &root.path().join("standards/b"),
                "data",
                7
            )
            .is_err()
        );
    }

    #[test]
    fn exact_corpus_identity_is_captured_and_hashed_once_for_all_requirements() {
        let (root, contract, lock, files) = fixture();
        let contracts = (0..MAX_CORPORA)
            .map(|index| (format!("oracle-{index:04}"), &contract))
            .collect();
        READ_COUNT.with(|count| count.set(0));
        HASH_COUNT.with(|count| count.set(0));
        let captured = capture_batch(root.path(), contracts, &lock, MAX_BYTES).unwrap();
        READ_COUNT.with(|count| assert_eq!(count.get(), files.len()));
        HASH_COUNT.with(|count| assert_eq!(count.get(), 2, "one capture hash and one seal hash"));
        let first = captured.values.values().next().unwrap();
        for (id, corpus) in &captured.values {
            assert!(
                Arc::ptr_eq(first, corpus),
                "exact identity must share retained bytes and inventory"
            );
            captured.require(id, &contract).unwrap();
        }
        READ_COUNT.with(|count| assert_eq!(count.get(), files.len()));
        HASH_COUNT.with(|count| {
            assert_eq!(
                count.get(),
                2,
                "requirement binding must not rescan or rehash"
            )
        });
        let mut conflicting = contract.clone();
        conflicting["corpus"]["sha256"] = json!("0".repeat(64));
        READ_COUNT.with(|count| count.set(0));
        let error = capture_batch(
            root.path(),
            BTreeMap::from([("a".to_owned(), &contract), ("b".to_owned(), &conflicting)]),
            &lock,
            MAX_BYTES,
        )
        .err()
        .unwrap();
        assert!(error.message.contains("conflicting identities"));
        READ_COUNT.with(|count| {
            assert_eq!(
                count.get(),
                files.len(),
                "conflict refused before a second read"
            )
        });
    }

    #[test]
    fn empty_file_metadata_is_charged_before_read_without_narrowing_declared_maxima() {
        assert_eq!(
            MAX_METADATA_BYTES,
            MAX_CORPORA as u64
                * (2 * MAX_FILES + MAX_DIRECTORIES) as u64
                * (MAX_PATH_BYTES as u64 + 128)
        );
        let root = tempfile::tempdir().unwrap();
        let mut contracts = BTreeMap::new();
        let digest = tree_digest(&BTreeMap::from([("empty".to_owned(), Vec::new())]));
        for id in ["a", "b"] {
            let path = format!("standards/{id}");
            std::fs::create_dir_all(root.path().join(&path)).unwrap();
            std::fs::write(root.path().join(&path).join("empty"), []).unwrap();
            contracts.insert(
                id.to_owned(),
                json!({"corpus":{"path":path,"sha256":digest}}),
            );
        }
        let lock = json!({"schema":"prismpm/sdk-lock/1","inventory":[{
            "id":"empty-fixture","kind":"test-corpus","digest":format!("sha256:{digest}")
        }]});
        let exact = 2
            * (metadata_reservation("", true).unwrap()
                + metadata_reservation("empty", false).unwrap());
        let declarations = || {
            contracts
                .iter()
                .map(|(id, contract)| (id.clone(), contract))
                .collect()
        };
        READ_COUNT.with(|count| count.set(0));
        let error = capture_batch_bounded(
            root.path(),
            declarations(),
            &lock,
            Budget {
                bytes: 0,
                metadata: exact - 1,
            },
        )
        .err()
        .unwrap();
        assert!(error
            .message
            .contains("remaining aggregate metadata budget"));
        READ_COUNT.with(|count| {
            assert_eq!(
                count.get(),
                1,
                "next metadata inventory must refuse before reads"
            )
        });
        let captured = capture_batch_bounded(
            root.path(),
            declarations(),
            &lock,
            Budget {
                bytes: 0,
                metadata: exact,
            },
        )
        .unwrap();
        assert_eq!(captured.values.len(), 2);
        let mut metadata = u64::MAX;
        assert!(reserve(&mut metadata, 1, u64::MAX).is_err());
        assert_eq!(metadata, u64::MAX);
        let mut metadata = MAX_METADATA_BYTES;
        assert!(reserve(&mut metadata, 1, MAX_METADATA_BYTES).is_err());
        assert_eq!(metadata, MAX_METADATA_BYTES);
    }

    #[cfg(unix)]
    #[test]
    fn actual_corpus_file_directory_root_and_hardlink_aliases_are_rejected() {
        use std::os::unix::fs::symlink;
        for mutation in 0..4 {
            let (root, contract, lock, _) = fixture();
            let directory = root.path().join("standards/corpus");
            match mutation {
                0 => symlink("z.txt", directory.join("alias")).unwrap(),
                1 => symlink("nested", directory.join("alias-directory")).unwrap(),
                2 => {
                    std::fs::hard_link(directory.join("z.txt"), directory.join("hardlink")).unwrap()
                }
                3 => {
                    std::fs::rename(&directory, root.path().join("original")).unwrap();
                    symlink(root.path().join("original"), &directory).unwrap();
                }
                _ => unreachable!(),
            }
            assert!(
                capture(root.path(), &contract, &lock).is_err(),
                "mutation {mutation}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn actual_non_utf8_path_and_sparse_overlimit_file_are_rejected_before_reading() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        let (root, contract, lock, _) = fixture();
        let directory = root.path().join("standards/corpus");
        let invalid_path = directory.join(OsString::from_vec(vec![0xff]));
        std::fs::write(&invalid_path, b"invalid name").unwrap();
        assert!(capture(root.path(), &contract, &lock).is_err());
        std::fs::remove_file(invalid_path).unwrap();
        let oversized = std::fs::File::create(directory.join("sparse")).unwrap();
        oversized.set_len(MAX_BYTES + 1).unwrap();
        assert!(capture(root.path(), &contract, &lock).is_err());
    }
}
