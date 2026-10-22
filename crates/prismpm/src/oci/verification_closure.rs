//! Lossless proof transport. Replaying a closure reads bytes; it never executes them.

use super::*;
use crate::controller::{BuildResult, VerifyResult};
use crate::release_verification::{self, Binding};

pub(super) struct Captured {
    pub(super) manifest: Vec<u8>,
    pub(super) build_files: BTreeMap<String, Vec<u8>>,
    runtime: BTreeMap<String, Vec<u8>>,
    oracles: BTreeMap<String, Vec<u8>>,
    binding: Binding,
}

fn error(message: impl Into<String>) -> PrismError {
    PrismError::new("PP6101", message)
}

fn confined_file(root: &Path, path: &str) -> Result<Vec<u8>, PrismError> {
    confined_file_bounded(root, path, 10_737_418_240)
}

pub(super) fn confined_file_bounded(
    root: &Path,
    path: &str,
    maximum: u64,
) -> Result<Vec<u8>, PrismError> {
    use std::io::Read;
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;

    if maximum > 10_737_418_240 {
        return Err(error("verification byte bound cannot be increased"));
    }
    let same_identity = |left: &std::fs::Metadata, right: &std::fs::Metadata| {
        #[cfg(unix)]
        {
            left.dev() == right.dev() && left.ino() == right.ino()
        }
        #[cfg(not(unix))]
        {
            left.created().ok() == right.created().ok()
        }
    };
    relative(path)?;
    let mut current = root.to_owned();
    let parts = path.split('/').collect::<Vec<_>>();
    let mut observed = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        current.push(part);
        let metadata = std::fs::symlink_metadata(&current)
            .map_err(|reason| error(format!("verification file {path}: {reason}")))?;
        if metadata.file_type().is_symlink()
            || (index + 1 < parts.len() && !metadata.is_dir())
            || (index + 1 == parts.len() && (!metadata.is_file() || metadata.len() > maximum))
        {
            return Err(error("verification files must be confined regular files"));
        }
        observed.push((current.clone(), metadata));
    }
    #[cfg(unix)]
    let file = std::fs::File::from(
        rustix::fs::open(
            &current,
            rustix::fs::OFlags::RDONLY
                | rustix::fs::OFlags::NOFOLLOW
                | rustix::fs::OFlags::NONBLOCK
                | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .map_err(|reason| error(reason.to_string()))?,
    );
    #[cfg(not(unix))]
    let file = std::fs::File::open(&current).map_err(|reason| error(reason.to_string()))?;
    let before = file
        .metadata()
        .map_err(|reason| error(reason.to_string()))?;
    if !before.is_file()
        || before.len() > maximum
        || !same_identity(&before, &observed.last().expect("nonempty confined path").1)
        || before.len() != observed.last().expect("nonempty confined path").1.len()
    {
        return Err(error("verification file changed before reading"));
    }
    let mut bytes = Vec::new();
    (&file)
        .take(before.len() + 1)
        .read_to_end(&mut bytes)
        .map_err(|reason| error(reason.to_string()))?;
    let after = file
        .metadata()
        .map_err(|reason| error(reason.to_string()))?;
    if bytes.len() as u64 != before.len()
        || !same_identity(&before, &after)
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err(error("verification file changed while reading"));
    }
    #[cfg(unix)]
    if before.ctime() != after.ctime() || before.ctime_nsec() != after.ctime_nsec() {
        return Err(error("verification file changed while reading"));
    }
    for (path, metadata) in observed {
        let current =
            std::fs::symlink_metadata(path).map_err(|reason| error(reason.to_string()))?;
        if current.file_type().is_symlink()
            || !same_identity(&metadata, &current)
            || metadata.is_dir() != current.is_dir()
            || metadata.is_file() != current.is_file()
            || (metadata.is_file()
                && (current.len() != before.len()
                    || current.modified().ok() != before.modified().ok()))
        {
            return Err(error("verification path changed while reading"));
        }
    }
    Ok(bytes)
}

fn directory(root: &Path, path: &str) -> Result<BTreeMap<String, Vec<u8>>, PrismError> {
    relative(path)?;
    let mut current = root.to_owned();
    for part in path.split('/') {
        current.push(part);
        let metadata =
            std::fs::symlink_metadata(&current).map_err(|reason| error(reason.to_string()))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(error("verification directory is not confined"));
        }
    }
    let mut files = BTreeMap::new();
    let mut total = 0_u64;
    for entry in walkdir::WalkDir::new(&current).follow_links(false) {
        let entry = entry.map_err(|reason| error(reason.to_string()))?;
        if entry.file_type().is_dir() {
            continue;
        }
        let name = entry
            .path()
            .strip_prefix(&current)
            .ok()
            .and_then(Path::to_str)
            .ok_or_else(|| error("verification path is not UTF-8"))?;
        if files.len() >= 65_536 {
            return Err(error("verification closure exceeds the file limit"));
        }
        let size = entry
            .metadata()
            .map_err(|reason| error(reason.to_string()))?
            .len();
        total = total
            .checked_add(size)
            .filter(|size| *size <= 10_737_418_240)
            .ok_or_else(|| error("verification closure exceeds the byte limit"))?;
        files.insert(name.to_owned(), confined_file(&current, name)?);
    }
    Ok(files)
}

pub(super) fn capture(
    root: &Path,
    build: &BuildResult,
    verified: &VerifyResult,
    validations: &[Value],
) -> Result<Captured, PrismError> {
    if build.schema != "prismpm/build-result/1" || verified.schema != "prismpm/verify-result/1" {
        return Err(error("unknown build or verification receipt schema"));
    }
    relative(&build.manifest_path)?;
    let (build_root, file) = build
        .manifest_path
        .rsplit_once('/')
        .ok_or_else(|| error("build manifest directory is absent"))?;
    if file != "manifest.json" || build.model_path != format!("{build_root}/model.prism.json") {
        return Err(error("build receipt has confused file paths"));
    }
    let mut build_files = directory(root, build_root)?;
    let manifest = build_files
        .remove("manifest.json")
        .ok_or_else(|| error("build manifest is absent"))?;
    let runtime = directory(root, &verified.verified_root)?;
    let binding =
        release_verification::validate_with_authority(&manifest, &build_files, &runtime, || {
            let sdk_bytes = confined_file(root, "prismpm.lock")?;
            Ok(crate::sdk::parse_lock(&sdk_bytes)?.value().clone())
        })?;
    if binding.build_id != build.build_id
        || binding.build_id != verified.build_id
        || binding.attestation_id != verified.attestation_id
    {
        return Err(error(
            "verification closure does not match the fresh build receipt",
        ));
    }
    let mut oracles = BTreeMap::new();
    for result in validations {
        CanonicalDocument::from_value("prismpm/validation-result/1", result.clone())
            .map_err(|reason| error(reason.to_string()))?;
        let name = result["oracle"]
            .as_str()
            .ok_or_else(|| error("oracle identity absent"))?;
        let path = result["evidence_path"]
            .as_str()
            .ok_or_else(|| error("oracle evidence is not retained"))?;
        if oracles
            .insert(format!("{name}.intoto.json"), confined_file(root, path)?)
            .is_some()
        {
            return Err(error("duplicate oracle result"));
        }
    }
    Ok(Captured {
        manifest,
        build_files,
        runtime,
        oracles,
        binding,
    })
}

fn binding_value(binding: &Binding) -> Result<Value, PrismError> {
    let mut value = serde_json::to_value(binding).map_err(|reason| error(reason.to_string()))?;
    value["schema"] = json!("prismpm/verification-closure/1");
    Ok(value)
}

pub(super) fn retain(
    store: &Store,
    root: &Descriptor,
    captured: &Captured,
) -> Result<Descriptor, PrismError> {
    let binding = CanonicalDocument::from_value(
        "prismpm/verification-closure/1",
        binding_value(&captured.binding)?,
    )?;
    let config = store.put(PRISM_VERIFICATION, binding.bytes())?;
    let mut layers = Vec::new();
    for (prefix, files) in [
        ("runtime", &captured.runtime),
        ("oracles", &captured.oracles),
    ] {
        for (path, bytes) in files {
            layers.push(file_descriptor(
                store,
                &format!("{prefix}/{path}"),
                "verification-artifact",
                bytes,
            )?);
        }
    }
    layers.sort_by(|left, right| left.annotations.cmp(&right.annotations));
    oci_manifest(
        store,
        PRISM_VERIFICATION,
        config,
        layers,
        Some(root.clone()),
    )
}

pub(super) struct Retained {
    pub(super) config: Value,
    runtime: BTreeMap<String, Vec<u8>>,
    oracles: BTreeMap<String, Vec<u8>>,
}

/// Integrity-replayed records, retained from the same reads that were checked.
/// This private value is not evidence of producer authentication or readiness.
#[derive(Debug)]
pub(super) struct Replayed {
    #[cfg(test)]
    pub(super) runtime: BTreeMap<String, Vec<u8>>,
    #[cfg(test)]
    pub(super) oracles: BTreeMap<String, Vec<u8>>,
    #[cfg(test)]
    pub(super) provenance: Value,
    #[cfg(test)]
    pub(super) provenance_bytes: Vec<u8>,
    #[cfg(test)]
    pub(super) validation_bytes: Vec<u8>,
}

pub(super) fn read(store: &Store, descriptor: &Descriptor) -> Result<Retained, PrismError> {
    let value = manifest(store, descriptor)?;
    let config: Descriptor = serde_json::from_value(value["config"].clone())
        .map_err(|reason| error(reason.to_string()))?;
    if value["artifactType"] != PRISM_VERIFICATION
        || config.media_type != PRISM_VERIFICATION
        || config.artifact_type.is_some()
        || config.annotations.is_some()
    {
        return Err(error(
            "verification closure configuration has an invalid role",
        ));
    }
    let config = CanonicalDocument::parse("prismpm/verification-closure/1", &store.read(&config)?)
        .map_err(|reason| error(reason.to_string()))?
        .value()
        .clone();
    let mut runtime = BTreeMap::new();
    let mut oracles = BTreeMap::new();
    let mut previous: Option<String> = None;
    let mut total = 0_u64;
    for layer in value["layers"]
        .as_array()
        .ok_or_else(|| error("verification layers absent"))?
    {
        let layer: Descriptor =
            serde_json::from_value(layer.clone()).map_err(|reason| error(reason.to_string()))?;
        let annotations = layer
            .annotations
            .as_ref()
            .ok_or_else(|| error("verification file title absent"))?;
        let title = annotations
            .get("org.opencontainers.image.title")
            .ok_or_else(|| error("verification file title absent"))?;
        relative(title)?;
        if layer.artifact_type.is_some()
            || layer.media_type != file_media(title)
            || annotations.len() != 2
            || annotations.get("org.prismpm.role").map(String::as_str)
                != Some("verification-artifact")
            || previous.as_ref().is_some_and(|last| last >= title)
        {
            return Err(error(
                "verification file descriptors are not canonical and unique",
            ));
        }
        previous = Some(title.clone());
        let (prefix, path) = title
            .split_once('/')
            .ok_or_else(|| error("verification file namespace absent"))?;
        let files = match prefix {
            "runtime" => &mut runtime,
            "oracles" => &mut oracles,
            _ => return Err(error("unknown verification file namespace")),
        };
        total = total
            .checked_add(layer.size)
            .filter(|size| *size <= 10_737_418_240)
            .ok_or_else(|| error("verification closure exceeds the byte limit"))?;
        if files.len() >= 65_536 || files.insert(path.to_owned(), store.read(&layer)?).is_some() {
            return Err(error("duplicate or excessive verification files"));
        }
    }
    Ok(Retained {
        config,
        runtime,
        oracles,
    })
}

fn single<'a>(referrers: &'a [Descriptor], role: &str) -> Result<&'a Descriptor, PrismError> {
    let rows = referrers
        .iter()
        .filter(|row| row.artifact_type.as_deref() == Some(role))
        .collect::<Vec<_>>();
    if rows.len() != 1 {
        return Err(error(format!("release requires one {role} referrer")));
    }
    Ok(rows[0])
}

#[allow(clippy::too_many_arguments)]
pub(super) fn validate(
    store: &Store,
    root: &Descriptor,
    release: &Value,
    build_manifest: &[u8],
    build_files: &BTreeMap<String, Vec<u8>>,
    referrers: &[Descriptor],
    standards_lock: &Value,
    sdk_lock: &Value,
) -> Result<Replayed, PrismError> {
    let descriptor = single(referrers, PRISM_VERIFICATION)?;
    let retained = read(store, descriptor)?;
    // Reject inconsistent metadata before replaying the retained proof. The
    // schema-validated config is only a claim here: successful replay below
    // must independently reproduce it before this function can accept.
    if release["model_digest"] != retained.config["model_digest"] {
        return Err(error(
            "verification configuration does not match the retained build and proof",
        ));
    }
    let (validation, _validation_bytes) = captured_referrer_evidence(
        store,
        &manifest(store, single(referrers, PRISM_VALIDATION)?)?,
    )?;
    CanonicalDocument::from_value("prismpm/release-validation/1", validation.clone())
        .map_err(|reason| error(reason.to_string()))?;
    if validation["subject"] != root.digest
        || validation["build_digest"] != retained.config["build_digest"]
        || validation["verification_digest"] != descriptor.digest
    {
        return Err(error(
            "release validation does not bind its build and verification closure",
        ));
    }
    validate_oracles(
        &validation["oracle_results"],
        &retained.oracles,
        build_files,
        standards_lock,
        sdk_lock,
    )?;
    let (provenance, _provenance_bytes) =
        captured_referrer_evidence(store, &manifest(store, single(referrers, INTOTO)?)?)?;
    let subjects = provenance["subject"]
        .as_array()
        .ok_or_else(|| error("provenance subject absent"))?;
    let model: Value = serde_json::from_slice(
        build_files
            .get("model.prism.json")
            .ok_or_else(|| error("release model absent"))?,
    )
    .map_err(|reason| error(reason.to_string()))?;
    if subjects.len() != 1
        || subjects[0]["digest"]["sha256"].as_str() != Some(digest_hex(&root.digest)?)
        || subjects[0]["name"] != release["product"]
        || provenance["_type"] != "https://in-toto.io/Statement/v1"
        || provenance["predicateType"] != "https://slsa.dev/provenance/v1"
        || provenance["predicate"]["runDetails"]["metadata"]["invocationId"]
            != retained.config["build_id"]
        || provenance["predicate"]["runDetails"]["builder"]["id"] != sdk_lock["sdk_image"]
        || provenance["predicate"]["buildDefinition"]["buildType"]
            != crate::supply_chain::PRISM_BUILD_TYPE
        || provenance["predicate"]["buildDefinition"]["internalParameters"] != json!({})
        || provenance["predicate"]["buildDefinition"]["externalParameters"]
            != json!({
                "model_digest":retained.config["model_digest"],
                "product_release":release["release"],
                "semantic_source_id":model["provenance"]["source_id"],
                "standards_lock":release["standards_lock"]
            })
    {
        return Err(error(
            "provenance subject or invocation does not bind the verified build",
        ));
    }
    let dependencies = provenance
        .pointer("/predicate/buildDefinition/resolvedDependencies")
        .and_then(Value::as_array)
        .ok_or_else(|| error("provenance dependencies absent"))?;
    let required = [
        (
            "urn:prismpm:build-manifest",
            retained.config["build_digest"]
                .as_str()
                .ok_or_else(|| error("verification build digest absent"))?,
        ),
        (
            "urn:prismpm:verification-closure",
            descriptor.digest.as_str(),
        ),
        (
            "urn:prismpm:sdk-lock",
            release["sdk_lock"]
                .as_str()
                .ok_or_else(|| error("SDK lock digest absent"))?,
        ),
        (
            "urn:prismpm:standards-lock",
            release["standards_lock"]
                .as_str()
                .ok_or_else(|| error("standards lock digest absent"))?,
        ),
        (
            sdk_lock["sdk_image"]
                .as_str()
                .ok_or_else(|| error("SDK image absent"))?,
            release["sdk_digest"]
                .as_str()
                .ok_or_else(|| error("SDK digest absent"))?,
        ),
    ];
    for (uri, digest) in required {
        let rows = dependencies
            .iter()
            .filter(|row| row["uri"] == uri)
            .collect::<Vec<_>>();
        if rows.len() != 1 || rows[0]["digest"] != json!({"sha256":digest_hex(digest)?}) {
            return Err(error(
                "provenance omits or confuses an immutable verification dependency",
            ));
        }
    }
    let binding = release_verification::validate_with_authority(
        build_manifest,
        build_files,
        &retained.runtime,
        || Ok(sdk_lock.clone()),
    )?;
    if binding_value(&binding)? != retained.config
        || release["model_digest"] != binding.model_digest
    {
        return Err(error(
            "verification configuration does not match the retained build and proof",
        ));
    }
    Ok(Replayed {
        #[cfg(test)]
        runtime: retained.runtime,
        #[cfg(test)]
        oracles: retained.oracles,
        #[cfg(test)]
        provenance,
        #[cfg(test)]
        provenance_bytes: _provenance_bytes,
        #[cfg(test)]
        validation_bytes: _validation_bytes,
    })
}

fn validate_oracles(
    results: &Value,
    evidence: &BTreeMap<String, Vec<u8>>,
    files: &BTreeMap<String, Vec<u8>>,
    standards: &Value,
    sdk: &Value,
) -> Result<(), PrismError> {
    let mut expected = BTreeMap::new();
    if let Some(bytes) = files.get("system.prism.json") {
        let system = crate::system::parse(bytes)?;
        for (_, path, id) in crate::deployment::required_oracles(system.value())? {
            if path.is_empty() {
                expected.insert(
                    *id,
                    sha(&crate::deployment::cloud_event_validation_fixture()?),
                );
                continue;
            }
            let bytes = files
                .get(&format!("projections/{path}"))
                .ok_or_else(|| error("oracle projection absent"))?;
            expected.insert(*id, sha(bytes));
        }
    }
    let results = results
        .as_array()
        .ok_or_else(|| error("oracle results absent"))?;
    if results.len() != expected.len() || evidence.len() != expected.len() {
        return Err(error(
            "release validation does not close over all required projection oracles",
        ));
    }
    let mut previous = None;
    for result in results {
        CanonicalDocument::from_value("prismpm/validation-result/1", result.clone())
            .map_err(|reason| error(reason.to_string()))?;
        let id = result["oracle"]
            .as_str()
            .ok_or_else(|| error("oracle id absent"))?;
        if previous.is_some_and(|last: &str| last >= id)
            || expected.get(id).map(String::as_str) != result["subject"].as_str()
        {
            return Err(error(
                "oracle result subject, ordering, or coverage changed",
            ));
        }
        previous = Some(id);
        let bytes = evidence
            .get(&format!("{id}.intoto.json"))
            .ok_or_else(|| error("oracle attestation missing"))?;
        let attestation =
            CanonicalDocument::parse("prismpm/oracle-validation-attestation/1", bytes)
                .map_err(|reason| error(reason.to_string()))?;
        let document = attestation.value();
        let predicate = &document["predicate"];
        let locked = standards["oracles"]
            .as_array()
            .and_then(|rows| rows.iter().find(|row| row["id"] == id))
            .ok_or_else(|| error("oracle is not declared in the retained standards lock"))?;
        let runner = if locked["executable"] == "prismpm" {
            Value::Null
        } else {
            sdk["sdk_image"].clone()
        };
        let subject = result["subject"]
            .as_str()
            .ok_or_else(|| error("oracle subject absent"))?;
        if result["attestation_digest"] != sha(bytes)
            || result["oracle_digest"] != sha(&encode_value(locked)?)
            || predicate["oracle_digest"] != result["oracle_digest"]
            || predicate["oracle"] != result["oracle"]
            || predicate["normalized_result"] != "valid"
            || predicate["covered"] != result["covered"]
            || predicate["covered"] != locked["covers"]
            || predicate["uncovered"] != result["uncovered"]
            || predicate["uncovered"] != locked["does_not_cover"]
            || predicate["authority_ids"] != locked["authority_ids"]
            || predicate["edition"] != locked["edition"]
            || predicate["runner_image"] != runner
            || result["evidence_path"]
                != format!(
                    ".prism/evidence/oracle-{id}-{}-valid.intoto.json",
                    digest_hex(subject)?
                )
            || document["subject"][0]["digest"]["sha256"].as_str()
                != result["subject"]
                    .as_str()
                    .and_then(|s| s.strip_prefix("sha256:"))
        {
            return Err(error(
                "oracle attestation does not bind its locked contract, result, and projection",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn assert_oracle_mutations_rejected(
    results: &Value,
    evidence: &BTreeMap<String, Vec<u8>>,
    files: &BTreeMap<String, Vec<u8>>,
    standards: &Value,
    sdk: &Value,
) {
    validate_oracles(results, evidence, files, standards, sdk).unwrap();
    assert!(!results.as_array().unwrap().is_empty());
    for mode in [
        "missing-result",
        "extra-result",
        "missing-attestation",
        "extra-attestation",
        "wrong-subject",
    ] {
        let mut changed_results = results.clone();
        let mut changed_evidence = evidence.clone();
        match mode {
            "missing-result" => {
                changed_results.as_array_mut().unwrap().pop();
            }
            "extra-result" => {
                let row = changed_results[0].clone();
                changed_results.as_array_mut().unwrap().push(row);
            }
            "missing-attestation" => {
                changed_evidence.pop_first();
            }
            "extra-attestation" => {
                changed_evidence.insert("unmodeled.intoto.json".to_owned(), Vec::new());
            }
            "wrong-subject" => {
                changed_results[0]["subject"] = json!(format!("sha256:{}", "f".repeat(64)));
            }
            _ => unreachable!(),
        }
        let error = validate_oracles(&changed_results, &changed_evidence, files, standards, sdk)
            .unwrap_err();
        assert_eq!(error.code, "PP6101", "{mode}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Deliberately unreplayable proof with coherently bound metadata. No native
    // build, trusted producer, or successful execution is fabricated here.
    struct Unreplayable {
        _directory: tempfile::TempDir,
        store: Store,
        root: Descriptor,
        release: Value,
        files: BTreeMap<String, Vec<u8>>,
        referrers: Vec<Descriptor>,
        sdk: Value,
    }

    impl Unreplayable {
        const MANIFEST: &'static [u8] = b"deliberately invalid proof JSON";

        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            let store = Store::open(directory.path()).unwrap();
            let files = BTreeMap::from([(
                "model.prism.json".into(),
                encode_value(&json!({"provenance":{"source_id":"unverified-test-source"}}))
                    .unwrap(),
            )]);
            let binding = Binding {
                build_id: content_id(Self::MANIFEST),
                build_digest: sha(Self::MANIFEST),
                model_digest: sha(&files["model.prism.json"]),
                attestation_id: content_id(b"unverified-test-attestation"),
                family: "native".into(),
            };
            let sdk_digest = sha(b"unverified-test-sdk");
            let sdk = json!({"sdk_image":format!("example.invalid/sdk@{sdk_digest}")});
            let release = json!({
                "model_digest":binding.model_digest,
                "product":"unreplayable-test",
                "release":"1.0.0",
                "sdk_digest":sdk_digest,
                "sdk_lock":sha(&encode_value(&sdk).unwrap()),
                "standards_lock":sha(b"unverified-test-standards")
            });
            let root = oci_manifest(
                &store,
                PRISM_RELEASE,
                store
                    .put(PRISM_RELEASE, &encode_value(&release).unwrap())
                    .unwrap(),
                vec![],
                None,
            )
            .unwrap();
            let header = CanonicalDocument::from_value(
                "prismpm/verification-closure/1",
                binding_value(&binding).unwrap(),
            )
            .unwrap();
            let verification = oci_manifest(
                &store,
                PRISM_VERIFICATION,
                store.put(PRISM_VERIFICATION, header.bytes()).unwrap(),
                vec![],
                Some(root.clone()),
            )
            .unwrap();
            let dependencies = [
                ("urn:prismpm:build-manifest", binding.build_digest.as_str()),
                (
                    "urn:prismpm:verification-closure",
                    verification.digest.as_str(),
                ),
                (
                    "urn:prismpm:sdk-lock",
                    release["sdk_lock"].as_str().unwrap(),
                ),
                (
                    "urn:prismpm:standards-lock",
                    release["standards_lock"].as_str().unwrap(),
                ),
                (sdk["sdk_image"].as_str().unwrap(), sdk_digest.as_str()),
            ]
            .into_iter()
            .map(|(uri, digest)| json!({"uri":uri,"digest":{"sha256":digest_hex(digest).unwrap()}}))
            .collect::<Vec<_>>();
            let provenance = json!({
                "_type":"https://in-toto.io/Statement/v1",
                "predicateType":"https://slsa.dev/provenance/v1",
                "subject":[{"name":release["product"],"digest":{"sha256":digest_hex(&root.digest).unwrap()}}],
                "predicate":{
                    "runDetails":{"metadata":{"invocationId":binding.build_id},"builder":{"id":sdk["sdk_image"]}},
                    "buildDefinition":{
                        "buildType":crate::supply_chain::PRISM_BUILD_TYPE,
                        "internalParameters":{},
                        "externalParameters":{
                            "model_digest":binding.model_digest,
                            "product_release":release["release"],
                            "semantic_source_id":"unverified-test-source",
                            "standards_lock":release["standards_lock"]
                        },
                        "resolvedDependencies":dependencies
                    }
                }
            });
            let validation = json!({
                "schema":"prismpm/release-validation/1",
                "subject":root.digest,
                "build_digest":binding.build_digest,
                "verification_digest":verification.digest,
                "oracle_results":[],
                "result":"passed"
            });
            let mut fixture = Self {
                _directory: directory,
                store,
                root,
                release,
                files,
                referrers: vec![verification],
                sdk,
            };
            fixture.set_referrer(INTOTO, provenance);
            fixture.set_referrer(PRISM_VALIDATION, validation);
            fixture
        }

        fn set_referrer(&mut self, role: &str, evidence: Value) {
            let descriptor = oci_manifest(
                &self.store,
                role,
                self.store.put(OCI_EMPTY, b"{}").unwrap(),
                vec![self
                    .store
                    .put(role, &encode_value(&evidence).unwrap())
                    .unwrap()],
                Some(self.root.clone()),
            )
            .unwrap();
            self.referrers
                .retain(|row| row.artifact_type.as_deref() != Some(role));
            self.referrers.push(descriptor);
        }

        fn reject(&self) -> PrismError {
            for descriptor in &self.referrers {
                verify_graph(&self.store, &descriptor.digest).unwrap();
            }
            validate(
                &self.store,
                &self.root,
                &self.release,
                Self::MANIFEST,
                &self.files,
                &self.referrers,
                &json!({}),
                &self.sdk,
            )
            .unwrap_err()
        }
    }

    #[test]
    fn inconsistent_provenance_is_rejected_before_real_proof_replay() {
        for (pointer, changed, message) in [
            (
                "/subject/0/name",
                json!("substituted"),
                "provenance subject or invocation",
            ),
            (
                "/subject/0/digest/sha256",
                json!("0".repeat(64)),
                "provenance subject or invocation",
            ),
            (
                "/predicate/runDetails/metadata/invocationId",
                json!("0".repeat(64)),
                "provenance subject or invocation",
            ),
            (
                "/predicate/runDetails/builder/id",
                json!("substituted"),
                "provenance subject or invocation",
            ),
            (
                "/predicate/buildDefinition/buildType",
                json!("substituted"),
                "provenance subject or invocation",
            ),
            (
                "/predicate/buildDefinition/externalParameters/model_digest",
                json!(sha(b"substituted")),
                "provenance subject or invocation",
            ),
            (
                "/predicate/buildDefinition/resolvedDependencies/0/digest/sha256",
                json!("0".repeat(64)),
                "provenance omits or confuses",
            ),
            (
                "/predicate/buildDefinition/resolvedDependencies/1/digest/sha256",
                json!("0".repeat(64)),
                "provenance omits or confuses",
            ),
        ] {
            let mut fixture = Unreplayable::new();
            let mut provenance =
                referrer_evidence(&fixture.store, single(&fixture.referrers, INTOTO).unwrap())
                    .unwrap();
            let slot = provenance.pointer_mut(pointer).unwrap();
            assert_ne!(*slot, changed);
            *slot = changed;
            fixture.set_referrer(INTOTO, provenance);
            let rejected = fixture.reject();
            assert_eq!(rejected.code, "PP6101");
            // Actual replay must fail on the sentinel manifest first. Getting
            // this different failure proves that replay has not been entered.
            assert!(
                rejected.message.starts_with(message),
                "{pointer}: {rejected:?}"
            );
        }
    }

    #[test]
    fn inconsistent_validation_is_rejected_before_real_proof_replay() {
        for field in ["subject", "build_digest", "verification_digest"] {
            let mut fixture = Unreplayable::new();
            let mut validation = referrer_evidence(
                &fixture.store,
                single(&fixture.referrers, PRISM_VALIDATION).unwrap(),
            )
            .unwrap();
            validation[field] = json!(sha(b"substituted"));
            fixture.set_referrer(PRISM_VALIDATION, validation);
            let rejected = fixture.reject();
            assert_eq!(rejected.code, "PP6101");
            assert_eq!(
                rejected.message,
                "release validation does not bind its build and verification closure"
            );
        }
        let mut fixture = Unreplayable::new();
        fixture.release["model_digest"] = json!(sha(b"substituted"));
        assert_eq!(
            fixture.reject().message,
            "verification configuration does not match the retained build and proof"
        );
    }

    #[test]
    fn coherent_unverified_metadata_still_requires_real_proof_replay() {
        let fixture = Unreplayable::new();
        let expected = release_verification::validate(
            Unreplayable::MANIFEST,
            &fixture.files,
            &BTreeMap::new(),
        )
        .unwrap_err();
        assert!(expected.message.starts_with("evidence JSON:"));
        let rejected = fixture.reject();
        assert_eq!(rejected.code, expected.code);
        assert_eq!(rejected.message, expected.message);
    }

    #[test]
    fn confined_readers_accept_nested_files_and_reject_path_aliases() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("proof/nested")).unwrap();
        std::fs::write(
            project.path().join("proof/nested/evidence.json"),
            b"retained bytes",
        )
        .unwrap();
        assert_eq!(
            confined_file(project.path(), "proof/nested/evidence.json").unwrap(),
            b"retained bytes"
        );
        assert_eq!(
            directory(project.path(), "proof").unwrap(),
            BTreeMap::from([("nested/evidence.json".into(), b"retained bytes".to_vec())])
        );
        for path in [
            "",
            "/proof",
            "../proof",
            "./proof",
            "proof/",
            "proof//nested",
            "proof/./nested",
            "proof/nested/../nested",
            "proof\\nested",
            "proof\0nested",
            "proof\nnested",
            "proof\tnested",
            "proof/nested/evidence.json/child",
        ] {
            assert!(
                confined_file(project.path(), path).is_err(),
                "accepted file {path:?}"
            );
            assert!(
                directory(project.path(), path).is_err(),
                "accepted directory {path:?}"
            );
        }
        assert!(confined_file(project.path(), "proof/nested").is_err());
        assert!(directory(project.path(), "proof/nested/evidence.json").is_err());
        assert!(confined_file(project.path(), "proof/missing.json").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn confined_readers_reject_symlinked_files_directories_and_parents() {
        use std::os::unix::fs::symlink;

        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir(project.path().join("proof")).unwrap();
        std::fs::write(outside.path().join("evidence.json"), b"outside bytes").unwrap();
        symlink(outside.path(), project.path().join("alias")).unwrap();
        symlink(outside.path(), project.path().join("proof/nested")).unwrap();
        symlink(
            outside.path().join("evidence.json"),
            project.path().join("proof/file.json"),
        )
        .unwrap();
        symlink(
            outside.path().join("missing"),
            project.path().join("proof/dangling"),
        )
        .unwrap();
        for path in [
            "alias/evidence.json",
            "proof/nested/evidence.json",
            "proof/file.json",
            "proof/dangling",
        ] {
            assert!(
                confined_file(project.path(), path).is_err(),
                "accepted {path}"
            );
        }
        for path in ["alias", "proof/nested", "proof"] {
            assert!(directory(project.path(), path).is_err(), "accepted {path}");
        }
    }

    #[test]
    fn confined_readers_reject_oversized_sparse_files_without_reading_them() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir(project.path().join("proof")).unwrap();
        let file = std::fs::File::create(project.path().join("proof/oversized")).unwrap();
        file.set_len(10_737_418_241).unwrap();
        drop(file);
        assert!(confined_file(project.path(), "proof/oversized").is_err());
        assert!(directory(project.path(), "proof").is_err());
    }

    #[test]
    fn closure_header_is_closed_typed_and_canonical_not_execution_acceptance() {
        // These scalar identifiers test only the header contract. They are not
        // runtime evidence and are never submitted as a verified release.
        let header = binding_value(&Binding {
            build_id: "1".repeat(64),
            build_digest: format!("sha256:{}", "2".repeat(64)),
            model_digest: format!("sha256:{}", "3".repeat(64)),
            attestation_id: "4".repeat(64),
            family: "native".into(),
        })
        .unwrap();
        let contract = "prismpm/verification-closure/1";
        let document = CanonicalDocument::from_value(contract, header.clone()).unwrap();
        assert_eq!(document.value(), &header);
        for (key, invalid) in [
            (
                "attestation_id",
                json!(format!("sha256:{}", "4".repeat(64))),
            ),
            ("attestation_id", json!(["4".repeat(64)])),
            ("build_id", json!(1)),
            ("build_id", json!("A".repeat(64))),
            ("build_digest", json!("2".repeat(64))),
            ("model_digest", Value::Null),
            ("family", json!("unknown")),
            ("family", json!(["native"])),
            ("schema", json!("prismpm/verification-closure/2")),
            ("passed", json!(true)),
        ] {
            let mut changed = header.clone();
            changed[key] = invalid;
            assert!(
                CanonicalDocument::from_value(contract, changed).is_err(),
                "accepted {key}"
            );
        }
        for key in header.as_object().unwrap().keys() {
            let mut changed = header.clone();
            changed.as_object_mut().unwrap().remove(key);
            assert!(
                CanonicalDocument::from_value(contract, changed).is_err(),
                "omitted {key}"
            );
        }
        let mut newline = document.bytes().to_vec();
        newline.push(b'\n');
        assert!(CanonicalDocument::parse(contract, &newline).is_err());
        let mut duplicate = document.bytes().to_vec();
        duplicate.pop();
        duplicate.extend_from_slice(b",\"family\":\"native\"}");
        assert!(CanonicalDocument::parse(contract, &duplicate).is_err());
        assert!(CanonicalDocument::parse(contract, b"true").is_err());
        assert!(CanonicalDocument::parse(contract, b"[]").is_err());
    }
}
