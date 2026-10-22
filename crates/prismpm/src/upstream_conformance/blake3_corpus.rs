//! Finite, immutable upstream vector qualification, not a hash specification.
use super::CorpusEvidence;
use crate::PrismError;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

const SOURCE: &[u8] = include_bytes!("../../standards/corpora/blake3-1.5.5/source.json");
const SOURCE_SHA: &str = "535385898217fa0a03233c6c0ec43a94935d177f732eb96484e8c9e47848b97b";
const CORPUS_SHA: &str = "f8ffc0176af3fed9ce66b92f60c424d96f413fa044d7b341fc63b896428037c9";
const LENGTHS: [usize; 35] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 63, 64, 65, 127, 128, 129, 1023, 1024, 1025, 2048, 2049, 3072, 3073,
    4096, 4097, 5120, 5121, 6144, 6145, 7168, 7169, 8192, 8193, 16384, 31744, 102400,
];
const PARTITIONS: [usize; 9] = [1, 63, 64, 65, 1023, 1024, 1025, 4096, usize::MAX];
const XOF: usize = 131;

fn fail(message: impl Into<String>) -> PrismError {
    PrismError::new("PP5004", message)
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    input_len: usize,
    hash: String,
    keyed_hash: String,
    derive_key: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Corpus {
    _comment: String,
    key: String,
    context_string: String,
    cases: Vec<Case>,
}

#[derive(Debug, PartialEq, Eq)]
struct Identity {
    length: u64,
    modified: Option<std::time::SystemTime>,
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
    #[cfg(unix)]
    mode: u32,
    #[cfg(unix)]
    links: u64,
    #[cfg(unix)]
    ctime: (i64, i64),
}
fn identity(m: &std::fs::Metadata) -> Identity {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Identity {
        length: m.len(),
        modified: m.modified().ok(),
        #[cfg(unix)]
        dev: m.dev(),
        #[cfg(unix)]
        ino: m.ino(),
        #[cfg(unix)]
        mode: m.mode(),
        #[cfg(unix)]
        links: m.nlink(),
        #[cfg(unix)]
        ctime: (m.ctime(), m.ctime_nsec()),
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Capture {
    bytes: BTreeMap<String, Vec<u8>>,
    identities: BTreeMap<String, Identity>,
}

fn capture(root: &Path) -> Result<Capture, PrismError> {
    if root.canonicalize().ok().as_deref() != Some(root) {
        return Err(fail("aliased corpus root"));
    }
    let source: serde_json::Value =
        serde_json::from_slice(SOURCE).map_err(|e| fail(e.to_string()))?;
    if hash(SOURCE) != SOURCE_SHA {
        return Err(fail("compiled corpus manifest differs from pin"));
    }
    let files = source["files"]
        .as_array()
        .ok_or_else(|| fail("corpus file manifest absent"))?;
    let mut expected = BTreeMap::from([(
        "source.json".to_owned(),
        (SOURCE.len() as u64, SOURCE_SHA.to_owned()),
    )]);
    for row in files {
        let name = row["path"]
            .as_str()
            .ok_or_else(|| fail("corpus path absent"))?;
        let size = row["byte_length"]
            .as_u64()
            .ok_or_else(|| fail("corpus length absent"))?;
        let digest = row["sha256"]
            .as_str()
            .ok_or_else(|| fail("corpus digest absent"))?;
        if expected
            .insert(name.to_owned(), (size, digest.to_owned()))
            .is_some()
        {
            return Err(fail("duplicate corpus file"));
        }
    }
    if expected.len() != 7 {
        return Err(fail("incomplete corpus file manifest"));
    }
    let mut result = Capture {
        bytes: BTreeMap::new(),
        identities: BTreeMap::new(),
    };
    for entry in walkdir::WalkDir::new(root).follow_links(false).max_depth(4) {
        let entry = entry.map_err(|e| fail(e.to_string()))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|e| fail(e.to_string()))?
            .to_str()
            .ok_or_else(|| fail("non-UTF8 corpus path"))?
            .to_owned();
        let before = std::fs::symlink_metadata(path).map_err(|e| fail(e.to_string()))?;
        if path.canonicalize().ok().as_deref() != Some(path) || before.file_type().is_symlink() {
            return Err(fail("corpus alias refused"));
        }
        if before.is_dir() {
            if !["", "test_vectors", "test_vectors/src"].contains(&relative.as_str()) {
                return Err(fail("unexpected corpus directory"));
            }
        } else {
            let (length, digest) = expected
                .get(&relative)
                .ok_or_else(|| fail("unexpected corpus member"))?;
            if !before.is_file() || before.len() != *length || *length > 65536 {
                return Err(fail("invalid corpus file bound"));
            }
            let mut options = std::fs::OpenOptions::new();
            options.read(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
                if before.nlink() != 1 || before.mode() & 0o7000 != 0 {
                    return Err(fail("corpus hardlink or special permissions"));
                }
                options.custom_flags(
                    (rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32,
                );
            }
            let mut file = options.open(path).map_err(|e| fail(e.to_string()))?;
            if identity(&file.metadata().map_err(|e| fail(e.to_string()))?) != identity(&before) {
                return Err(fail("corpus file replaced before read"));
            }
            let mut bytes = Vec::new();
            file.by_ref()
                .take(length + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| fail(e.to_string()))?;
            if bytes.len() as u64 != *length
                || hash(&bytes) != *digest
                || identity(&file.metadata().map_err(|e| fail(e.to_string()))?) != identity(&before)
            {
                return Err(fail("corpus bytes or custody changed"));
            }
            result.bytes.insert(relative.clone(), bytes);
        }
        if identity(&std::fs::symlink_metadata(path).map_err(|e| fail(e.to_string()))?)
            != identity(&before)
        {
            return Err(fail("corpus entry changed"));
        }
        result.identities.insert(relative, identity(&before));
    }
    if result.bytes.len() != expected.len() || result.identities.len() != 10 {
        return Err(fail("incomplete corpus tree"));
    }
    Ok(result)
}

fn expected(hex: &str) -> Result<Vec<u8>, PrismError> {
    if hex.len() != XOF * 2
        || !hex
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(fail("invalid imported digest encoding"));
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| fail(e.to_string())))
        .collect()
}
fn case(corpus: &Corpus, row: &Case, changed_pattern: bool) -> Result<(), PrismError> {
    if row.input_len > 102400 {
        return Err(fail("corpus input bound exceeded"));
    }
    let mut input: Vec<u8> = (0..row.input_len).map(|i| (i % 251) as u8).collect();
    // The construction is independently checked before any negative control.
    for (i, byte) in input.iter().enumerate() {
        if usize::from(*byte) != i % 251 {
            return Err(fail("upstream input pattern differs"));
        }
    }
    if changed_pattern {
        let byte = input
            .get_mut(0)
            .ok_or_else(|| fail("empty pattern mutant"))?;
        *byte ^= 1;
    }
    let key: &[u8; 32] = corpus
        .key
        .as_bytes()
        .try_into()
        .map_err(|_| fail("invalid key length"))?;
    for (mode, encoded) in [&row.hash, &row.keyed_hash, &row.derive_key]
        .into_iter()
        .enumerate()
    {
        let want = expected(encoded)?;
        let one_shot = match mode {
            0 => *blake3::hash(&input).as_bytes(),
            1 => *blake3::keyed_hash(key, &input).as_bytes(),
            _ => blake3::derive_key(&corpus.context_string, &input),
        };
        if one_shot != want[..32] {
            return Err(fail(format!(
                "BLAKE3 one-shot mismatch: {} mode {mode}",
                row.input_len
            )));
        }
        if mode == 0
            && crate::holo::archive::content_kappa(&input) != format!("blake3:{}", &encoded[..64])
        {
            return Err(fail("archive content identity differs from upstream"));
        }
        for partition in PARTITIONS {
            let mut state = match mode {
                0 => blake3::Hasher::new(),
                1 => blake3::Hasher::new_keyed(key),
                _ => blake3::Hasher::new_derive_key(&corpus.context_string),
            };
            let mut count = 0;
            for chunk in input.chunks(partition) {
                state.update(chunk);
                count += chunk.len();
                if state.count() != count as u64 {
                    return Err(fail("streaming count mismatch"));
                }
            }
            let mut output = [0; XOF];
            state.finalize_xof().fill(&mut output);
            if output.as_slice() != want || state.finalize().as_bytes() != &want[..32] {
                return Err(fail("streaming BLAKE3 differs from upstream"));
            }
            let mut segmented = [0; XOF];
            let mut reader = state.finalize_xof();
            for output in segmented.chunks_mut(63) {
                reader.fill(output);
            }
            if segmented != output {
                return Err(fail("segmented extended output mismatch"));
            }
        }
    }
    Ok(())
}

pub(super) fn verify(root: &Path) -> Result<CorpusEvidence, PrismError> {
    let before = capture(root)?;
    let package: toml::Value = toml::from_str(
        std::str::from_utf8(&before.bytes["upstream-Cargo.toml"])
            .map_err(|e| fail(e.to_string()))?,
    )
    .map_err(|e| fail(e.to_string()))?;
    if package["package"]["name"].as_str() != Some("blake3")
        || package["package"]["version"].as_str() != Some("1.5.5")
        || package["package"]["license"].as_str()
            != Some("CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception")
    {
        return Err(fail("upstream edition or license binding differs"));
    }
    let corpus: Corpus = serde_json::from_slice(&before.bytes["test_vectors/test_vectors.json"])
        .map_err(|e| fail(e.to_string()))?;
    if corpus
        .cases
        .iter()
        .map(|row| row.input_len)
        .collect::<Vec<_>>()
        != LENGTHS
    {
        return Err(fail("incomplete upstream vector inventory"));
    }
    for row in &corpus.cases {
        case(&corpus, row, false)?;
    }
    let original = &corpus.cases[17];
    let mut wrong_digest = original.clone();
    wrong_digest.hash.replace_range(
        ..1,
        if wrong_digest.hash.starts_with('0') {
            "1"
        } else {
            "0"
        },
    );
    let mut wrong_length = original.clone();
    wrong_length.input_len += 1;
    let mut wrong_key = corpus.clone();
    wrong_key.key.replace_range(..1, "x");
    let mut wrong_context = corpus.clone();
    wrong_context.context_string.push('!');
    for result in [
        case(&corpus, &wrong_digest, false),
        case(&corpus, &wrong_length, false),
        case(&corpus, original, true),
        case(&wrong_key, original, false),
        case(&wrong_context, original, false),
    ] {
        if result.is_ok() {
            return Err(fail("BLAKE3 planted defect accepted"));
        }
    }
    if capture(root)? != before {
        return Err(fail("BLAKE3 corpus changed during execution"));
    }
    let mut digest = Sha256::new();
    for (path, bytes) in &before.bytes {
        digest.update((path.len() as u64).to_be_bytes());
        digest.update(path.as_bytes());
        digest.update((bytes.len() as u64).to_be_bytes());
        digest.update(bytes);
    }
    let corpus_sha256 = format!("{:x}", digest.finalize());
    if corpus_sha256 != CORPUS_SHA {
        return Err(fail("complete BLAKE3 corpus differs from pin"));
    }
    Ok(CorpusEvidence {
        corpus_sha256: format!("sha256:{corpus_sha256}"),
        positive: 35,
        negative: 0,
        planted_rejections: 5,
        runner: "blake3-1.5.5 / upstream-81f772a4cd70dc0325047a6a737d2f6f4b92180e",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn original() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("standards/corpora/blake3-1.5.5")
            .canonicalize()
            .unwrap()
    }
    fn copy() -> tempfile::TempDir {
        let source = capture(&original()).unwrap();
        let temp = tempfile::tempdir().unwrap();
        for (name, bytes) in source.bytes {
            let path = temp.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        temp
    }
    #[test]
    fn complete_imported_corpus_and_actual_content_adapter_agree() {
        let result = verify(&original()).unwrap();
        assert_eq!((result.positive, result.planted_rejections), (35, 5));
    }
    #[test]
    fn every_packaged_corpus_member_is_required_and_bound() {
        for name in capture(&original()).unwrap().bytes.keys() {
            let root = copy();
            let path = root.path().join(name);
            let original = std::fs::read(&path).unwrap();
            let mut altered = original.clone();
            altered[0] ^= 1;
            std::fs::write(&path, altered).unwrap();
            assert!(capture(root.path()).is_err(), "altered {name}");
            std::fs::remove_file(&path).unwrap();
            assert!(capture(root.path()).is_err(), "missing {name}");
            std::fs::write(path, original).unwrap();
            capture(root.path()).unwrap();
        }
        let root = copy();
        std::fs::write(root.path().join("extra"), b"x").unwrap();
        assert!(capture(root.path()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn aliases_hardlinks_and_same_byte_replacements_cannot_preserve_custody() {
        use std::os::unix::fs::symlink;
        let root = copy();
        let path = root.path().join("LICENSE_CC0");
        let before = capture(root.path()).unwrap();
        let replacement = root.path().join("replacement");
        std::fs::write(&replacement, std::fs::read(&path).unwrap()).unwrap();
        std::fs::rename(&replacement, &path).unwrap();
        assert_ne!(capture(root.path()).unwrap(), before);
        std::fs::hard_link(&path, &replacement).unwrap();
        assert!(capture(root.path()).is_err());
        std::fs::remove_file(&replacement).unwrap();
        let alias = root.path().join("alias");
        symlink(&path, &alias).unwrap();
        assert!(capture(root.path()).is_err());
        std::fs::remove_file(alias).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let alias = directory.path().join("root");
        symlink(root.path(), &alias).unwrap();
        assert!(capture(&alias).is_err());
    }
}
