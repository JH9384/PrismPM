//! Verification of lean4-prod external dependency tracking, artifact integrity,
//! and generic compiler isolation.

use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crate is below repository root")
        .to_path_buf()
}

fn compute_sha256(path: &Path) -> Result<String, std::io::Error> {
    let bytes = std::fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

#[derive(Debug, PartialEq, Eq)]
struct DependencyArtifact {
    kind: String,
    path: String,
    sha256: String,
    tree_root: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct DependencyRecord {
    id: String,
    lean_version: Option<String>,
    revision: String,
    source: String,
    artifacts: Vec<DependencyArtifact>,
}

fn parse_lean4_prod_dependency(toml_content: &str) -> Result<DependencyRecord, String> {
    let val: toml::Value = toml::from_str(toml_content).map_err(|e| e.to_string())?;
    let deps = val
        .get("dependency")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "missing [[dependency]] array".to_string())?;

    for dep in deps {
        let id = dep.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id == "lean4-prod" {
            let lean_version = dep
                .get("lean_version")
                .and_then(|v| v.as_str())
                .map(String::from);
            let revision = dep
                .get("revision")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing revision".to_string())?
                .to_string();
            let source = dep
                .get("source")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "missing source".to_string())?
                .to_string();

            let mut artifacts = Vec::new();
            if let Some(arts) = dep.get("artifact").and_then(|v| v.as_array()) {
                for art in arts {
                    let kind = art
                        .get("kind")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "missing artifact kind".to_string())?
                        .to_string();
                    let path = art
                        .get("path")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "missing artifact path".to_string())?
                        .to_string();
                    let sha256 = art
                        .get("sha256")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "missing artifact sha256".to_string())?
                        .to_string();
                    let tree_root = art
                        .get("tree_root")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    artifacts.push(DependencyArtifact {
                        kind,
                        path,
                        sha256,
                        tree_root,
                    });
                }
            }

            return Ok(DependencyRecord {
                id: id.to_string(),
                lean_version,
                revision,
                source,
                artifacts,
            });
        }
    }
    Err("lean4-prod dependency not found".to_string())
}

#[test]
fn lean4_prod_dependency_record_and_checksums_are_valid() {
    let repo_root = root();
    let deps_file = repo_root.join("model/dependencies.toml");
    let content = std::fs::read_to_string(&deps_file).expect("read dependencies.toml");
    let record = parse_lean4_prod_dependency(&content).expect("parse lean4-prod dependency");

    assert_eq!(record.id, "lean4-prod");
    assert_eq!(record.lean_version.as_deref(), Some("4.32.1"));
    assert_eq!(record.revision, "991956fe427bb646498fd0912c89b71be71e7beb");
    assert_eq!(record.source, "vendored");

    let expected_artifacts: HashMap<&str, (&str, Option<&str>)> = HashMap::from([
        (
            "vendor/lean4-prod/lean.tar",
            (
                "7a1a716a57040ea2307f7a34e895a75ebdca7438cf9d5d0364007acb594366bf",
                None,
            ),
        ),
        (
            "vendor/lean4-prod/rust/MANIFEST.sha256",
            (
                "15675cbaf5df13a032f29eab947dd34b7fcf9c52f7d9f9f08bed8718d7a01d42",
                Some("vendor/lean4-prod/rust"),
            ),
        ),
        (
            "vendor/lean4-prod/crates/prod-alloc-counter-0.1.0.crate",
            (
                "3072374800280030ab1f03db059676f93d7f3d62df431895e32fe8c9eae8229e",
                None,
            ),
        ),
        (
            "vendor/lean4-prod/crates/prod-codegen-0.1.0.crate",
            (
                "6bd6690fef4a453ad58ee8e8ea1378f53a151aeb2c3aa00b092b582fe89e07fc",
                None,
            ),
        ),
        (
            "vendor/lean4-prod/crates/prod-ir-0.1.0.crate",
            (
                "7cffc0251ee01ce97debe304a41a4e28f6be94ba41691fac1993c811919cdc21",
                None,
            ),
        ),
    ]);

    assert_eq!(
        record.artifacts.len(),
        expected_artifacts.len(),
        "unexpected artifact count"
    );

    for art in &record.artifacts {
        let (expected_digest, expected_tree_root) = expected_artifacts
            .get(art.path.as_str())
            .unwrap_or_else(|| panic!("unrecognized artifact path {}", art.path));

        assert_eq!(
            art.sha256, *expected_digest,
            "manifest digest mismatch for {}",
            art.path
        );
        assert_eq!(
            art.tree_root.as_deref(),
            *expected_tree_root,
            "tree_root mismatch for {}",
            art.path
        );

        let file_path = repo_root.join(&art.path);
        assert!(file_path.is_file(), "artifact file missing: {}", art.path);
        let actual_digest = compute_sha256(&file_path).expect("compute sha256");
        assert_eq!(
            actual_digest, *expected_digest,
            "actual file sha256 mismatch for {}",
            art.path
        );
    }
}

#[test]
fn lean4_prod_rust_manifest_is_exhaustive_and_valid() {
    let repo_root = root();
    let vendor_rust = repo_root.join("vendor/lean4-prod/rust");
    let manifest_path = vendor_rust.join("MANIFEST.sha256");
    let manifest_content = std::fs::read_to_string(&manifest_path).expect("read MANIFEST.sha256");

    let mut manifested_files = HashMap::new();
    for line in manifest_content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        assert_eq!(parts.len(), 2, "invalid line in MANIFEST.sha256: {trimmed}");
        let digest = parts[0];
        let rel_path = parts[1];
        manifested_files.insert(rel_path.to_string(), digest.to_string());
    }

    assert!(
        manifested_files.len() >= 30,
        "expected at least 30 manifested files, got {}",
        manifested_files.len()
    );

    // Verify every manifested file exists and has the expected digest.
    for (rel_path, expected_digest) in &manifested_files {
        let full_path = vendor_rust.join(rel_path);
        assert!(
            full_path.is_file(),
            "manifested file missing on disk: {rel_path}"
        );
        let actual_digest = compute_sha256(&full_path).expect("compute sha256");
        assert_eq!(
            actual_digest, *expected_digest,
            "checksum mismatch for {rel_path}"
        );
    }

    // Verify exhaustive inclusion: all relevant source and test files in vendor/lean4-prod/rust
    // must be listed in MANIFEST.sha256.
    let mut walked_files = HashSet::new();
    for entry in walkdir::WalkDir::new(&vendor_rust) {
        let entry = entry.expect("walkdir entry");
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        let rel = path
            .strip_prefix(&vendor_rust)
            .expect("prefix")
            .to_string_lossy()
            .replace('\\', "/");
        if rel == "MANIFEST.sha256"
            || rel.starts_with("target/")
            || rel.ends_with(".git")
            || rel == ".gitignore"
        {
            continue;
        }
        walked_files.insert(rel);
    }

    for walked in &walked_files {
        assert!(
            manifested_files.contains_key(walked),
            "unmanifested file in vendor/lean4-prod/rust: {walked}"
        );
    }
}

#[test]
fn lean4_prod_crates_preserve_strict_generic_compiler_isolation() {
    let repo_root = root();
    let vendor_rust = repo_root.join("vendor/lean4-prod/rust");

    // Generic compiler code generator and IR should not embed Prism-specific or
    // application-specific target architectures.
    let forbidden_domain_terms = [
        "CalculatorSystem",
        "FoundryPortal",
        "KubernetesDeployment",
        "ComposeService",
        "OpenTelemetryProvider",
    ];

    for entry in walkdir::WalkDir::new(&vendor_rust) {
        let entry = entry.expect("walk entry");
        let path = entry.path();
        if path.is_file() {
            let rel = path
                .strip_prefix(&vendor_rust)
                .expect("prefix")
                .to_string_lossy()
                .replace('\\', "/");
            if rel.starts_with("target/") {
                continue;
            }
            if rel.ends_with(".rs") || rel.ends_with(".ir") || rel.ends_with(".js") {
                let content = std::fs::read_to_string(path).unwrap_or_default();
                for term in forbidden_domain_terms {
                    assert!(
                        !content.contains(term),
                        "forbidden application domain term '{term}' found in generic compiler file: {rel}"
                    );
                }
            }
        }
    }
}

#[test]
fn lean4_prod_dependency_falsification_probes() {
    let valid_toml = r#"
spec = "prismpm/dependencies/1"

[[dependency]]
id = "lean4-prod"
lean_version = "4.32.1"
revision = "991956fe427bb646498fd0912c89b71be71e7beb"
source = "vendored"

[[dependency.artifact]]
kind = "file"
path = "vendor/lean4-prod/lean.tar"
sha256 = "7a1a716a57040ea2307f7a34e895a75ebdca7438cf9d5d0364007acb594366bf"
"#;

    let parsed = parse_lean4_prod_dependency(valid_toml).expect("valid parse");
    assert_eq!(parsed.revision, "991956fe427bb646498fd0912c89b71be71e7beb");

    // Probe 1: Missing lean4-prod section
    let missing_toml = r#"
spec = "prismpm/dependencies/1"

[[dependency]]
id = "lexlean"
revision = "12345"
source = "vendored"
"#;
    assert!(parse_lean4_prod_dependency(missing_toml).is_err());

    // Probe 2: Tampered artifact digest detection
    let mut tampered_record = parsed;
    tampered_record.artifacts[0].sha256 =
        "0000000000000000000000000000000000000000000000000000000000000000".to_string();
    let file_path = root().join(&tampered_record.artifacts[0].path);
    let real_digest = compute_sha256(&file_path).expect("digest");
    assert_ne!(real_digest, tampered_record.artifacts[0].sha256);
}
