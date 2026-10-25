//! Closed target-adapter descriptors and standard-native projection validation.

use crate::error::PrismError;
use crate::holo::canonical::encode_value;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::Path;

const COMPOSE: &[u8] = include_bytes!("../adapters/compose.json");
const GITHUB_PAGES: &[u8] = include_bytes!("../adapters/github-pages.json");
const GITHUB_PAGES_BROWSER: &[u8] = include_bytes!("../adapters/github-pages-browser.json");
const KUBERNETES: &[u8] = include_bytes!("../adapters/kubernetes.json");
const INGRESS_NGINX_KIND: &[u8] = include_bytes!("../adapters/ingress-nginx-kind-v1.15.1.yaml");

fn sha(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

pub(crate) fn descriptor(kind: &str) -> Result<(Value, &'static [u8]), PrismError> {
    let bytes = match kind {
        "compose" => COMPOSE,
        "github-pages" => GITHUB_PAGES,
        "github-pages-browser" => GITHUB_PAGES_BROWSER,
        "kubernetes" => KUBERNETES,
        _ => return Err(PrismError::new("PP7101", "unsupported target adapter")),
    };
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|error| PrismError::new("PP7101", format!("adapter descriptor: {error}")))?;
    let mut canonical = encode_value(&value)?;
    canonical.push(b'\n');
    if canonical != bytes
        || value["adapter_api"] != "prismpm/target-adapter/1"
        || value["id"] != kind
        || !value["executable"].is_string()
        || !value["target_api"].is_string()
        || (matches!(kind, "compose" | "kubernetes")
            && value["projection_policy"]
                .as_object()
                .is_none_or(|rows| rows.is_empty()))
    {
        return Err(PrismError::new(
            "PP7101",
            "target adapter descriptor is noncanonical or malformed",
        ));
    }
    if kind == "kubernetes"
        && value["projection_policy"]["ingress_controller_manifest_sha256"]
            != sha(INGRESS_NGINX_KIND).trim_start_matches("sha256:")
    {
        return Err(PrismError::new(
            "PP7101",
            "pinned ingress controller manifest changed",
        ));
    }
    Ok((value, bytes))
}

/// Exact target-profile choices consumed by the generic standard renderer.
pub fn projection_policy(kind: &str) -> Result<Value, PrismError> {
    let (descriptor, _) = descriptor(kind)?;
    descriptor
        .get("projection_policy")
        .cloned()
        .ok_or_else(|| PrismError::new("PP7101", "adapter projection policy is absent"))
}

/// Content identity of the exact built-in adapter descriptor.
pub fn digest(kind: &str) -> Result<String, PrismError> {
    descriptor(kind).map(|(_, bytes)| sha(bytes))
}

/// Verify that every modeled target is bound to the exact SDK adapter and API.
pub fn validate_targets(system: &Value) -> Result<(), PrismError> {
    let capabilities = system["capabilities"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| row["id"].as_str())
        .collect::<BTreeSet<_>>();
    for target in system["targets"].as_array().into_iter().flatten() {
        let kind = target["kind"].as_str().unwrap_or_default();
        let (adapter, bytes) = descriptor(kind)?;
        if target["adapter_digest"] != sha(bytes) || target["api_version"] != adapter["target_api"]
        {
            return Err(PrismError::new(
                "PP7101",
                format!(
                    "target {} is not bound to the locked {kind} adapter",
                    target["id"]
                ),
            ));
        }
        if !matches!(
            target["minimum_release_status"].as_str(),
            Some("development" | "candidate" | "accepted")
        ) {
            return Err(PrismError::new(
                "PP7101",
                "target minimum release status is absent or unsupported",
            ));
        }
        if target["capabilities"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|id| id.as_str().is_none_or(|id| !capabilities.contains(id)))
        {
            return Err(PrismError::new(
                "PP7101",
                "target capability binding is not closed",
            ));
        }
        if target["platform_requirements"]
            .as_array()
            .is_none_or(|requirements| requirements.is_empty())
        {
            return Err(PrismError::new(
                "PP7101",
                "target supported platform binding is absent",
            ));
        }
        let has_persistent_storage = system["topology"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|row| row["kind"] == "persistent-volume");
        let has_public_ingress = system["topology"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|row| row["kind"] == "port" && row["public"] == true);
        if kind == "kubernetes" {
            let policy = &adapter["projection_policy"];
            if has_persistent_storage
                && (target["storage_class"].is_null()
                    || target["storage_profile"] != policy["storage_profile"])
            {
                return Err(PrismError::new(
                    "PP7101",
                    "Kubernetes persistent storage has no explicit supported target binding",
                ));
            }
            if has_public_ingress
                && (target["ingress_class_name"].as_str() != Some("nginx")
                    || target["ingress_controller_artifact"].is_null())
            {
                return Err(PrismError::new(
                    "PP7101",
                    "Kubernetes public interface has no explicit ingress controller binding",
                ));
            }
            let artifacts = system["artifacts"].as_array().into_iter().flatten();
            let controller = artifacts
                .clone()
                .find(|artifact| artifact["id"] == target["ingress_controller_artifact"]);
            let controller_reference = policy["ingress_controller_image"]
                .as_str()
                .and_then(|reference| reference.rsplit_once('@'));
            if has_public_ingress
                && controller
                    .zip(controller_reference)
                    .is_none_or(|(artifact, (path, digest))| {
                        artifact["path"].as_str() != Some(path)
                            || artifact["digest"].as_str() != Some(digest)
                    })
            {
                return Err(PrismError::new(
                    "PP7101",
                    "modeled ingress controller artifact does not match the pinned adapter",
                ));
            }
            let admission_reference = policy["ingress_admission_image"]
                .as_str()
                .and_then(|reference| reference.rsplit_once('@'));
            if has_public_ingress
                && admission_reference.is_none_or(|(path, digest)| {
                    !artifacts.clone().any(|artifact| {
                        artifact["path"].as_str() == Some(path)
                            && artifact["digest"].as_str() == Some(digest)
                            && artifact["role"] == "ingress-admission-image"
                    })
                })
            {
                return Err(PrismError::new(
                    "PP7101",
                    "pinned ingress admission runtime is absent from the release model",
                ));
            }
        } else if !target["storage_class"].is_null()
            || !target["storage_profile"].is_null()
            || !target["ingress_class_name"].is_null()
            || !target["ingress_controller_artifact"].is_null()
        {
            return Err(PrismError::new(
                "PP7101",
                "non-Kubernetes target contains unused Kubernetes bindings",
            ));
        }
    }
    Ok(())
}

/// Closed SDK-owned projection/oracle plan shared with source-free OCI replay.
pub(crate) fn required_oracles(
    system: &Value,
) -> Result<&'static [(&'static str, &'static str, &'static str)], PrismError> {
    match system["schema"].as_str() {
        Some("prismpm/system-model/1") => Ok(&[
            ("openapi", "openapi.json", "openapi-3.2-schema"),
            ("asyncapi", "asyncapi.json", "asyncapi-3.1-schema"),
            ("spdx", "spdx.json", "spdx-3.0.1-model"),
            (
                "otel",
                "opentelemetry-collector.json",
                "otel-collector-0.136.0",
            ),
            ("compose", "compose.json", "compose-fee041b3"),
            ("kubernetes", "kubernetes.json", "kubernetes-1.36.4"),
            ("cloudevents", "", "cloudevents-1.0-json"),
        ]),
        Some("prismpm/system-model/2") => Ok(&[("spdx", "spdx.json", "spdx-3.0.1-model")]),
        Some("prismpm/system-model/3") => Ok(&[
            ("spdx", "spdx.json", "spdx-3.0.1-model"),
            ("compose", "compose.json", "compose-fee041b3"),
        ]),
        _ => Err(PrismError::new(
            "PP7101",
            "unsupported system projection oracle profile",
        )),
    }
}

/// Validate every standard projection required by the exact system profile.
pub fn validate_build(root: &Path, build_id: &str) -> Result<Vec<Value>, PrismError> {
    let base = root.join(".prism/build").join(build_id).join("projections");
    let system_bytes = std::fs::read(
        base.parent()
            .expect("build parent")
            .join("system.prism.json"),
    )
    .map_err(|error| PrismError::new("PP7101", format!("system oracle profile: {error}")))?;
    let system = crate::system::parse(&system_bytes)?;
    let mut results = Vec::new();
    for (profile, path, _) in required_oracles(system.value())? {
        let event_file;
        let subject = if path.is_empty() {
            event_file = tempfile::NamedTempFile::new_in(&base).map_err(|error| {
                PrismError::new("PP5404", format!("CloudEvents fixture: {error}"))
            })?;
            std::fs::write(event_file.path(), cloud_event_validation_fixture()?).map_err(
                |error| PrismError::new("PP5404", format!("CloudEvents fixture: {error}")),
            )?;
            event_file.path().to_owned()
        } else {
            base.join(path)
        };
        let result = crate::authority::run_oracle_in_project(root, profile, &subject)?;
        results.push(
            serde_json::to_value(result)
                .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
        );
    }
    results.sort_by(|left, right| left["oracle"].as_str().cmp(&right["oracle"].as_str()));
    Ok(results)
}

pub(crate) fn cloud_event_validation_fixture() -> Result<Vec<u8>, PrismError> {
    crate::holo::canonical::encode_value(&serde_json::json!({
        "data":{},
        "id":"prismpm-validation-fixture",
        "source":"https://uor.foundation/prismpm/validation",
        "specversion":"1.0",
        "subject":"validation-fixture",
        "type":"org.uor.prismpm.validation.v1"
    }))
}

#[cfg(test)]
mod tests {
    #[test]
    fn adapter_descriptors_are_canonical_and_distinct() {
        let compose = super::digest("compose").unwrap();
        let github_pages = super::digest("github-pages").unwrap();
        let browser_pages = super::digest("github-pages-browser").unwrap();
        let kubernetes = super::digest("kubernetes").unwrap();
        assert_ne!(compose, kubernetes);
        assert_ne!(compose, github_pages);
        assert_ne!(browser_pages, github_pages);
        assert!(super::digest("shell").is_err());
    }
}
