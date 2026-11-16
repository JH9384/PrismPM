//! SDK advisory coverage and security disposition.
//!
//! These are trust and policy decisions over advisory evidence, so they belong
//! to `verify` (docs/proposals/440-nine-modules.md). `supply_chain` scans and
//! promotes, and calls these to decide.

use crate::error::PrismError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

fn digest_hex(value: &str) -> Option<&str> {
    value.strip_prefix("sha256:").filter(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

/// One immutable vulnerability/advisory scan result supplied by a pinned scanner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdvisoryScanFact {
    /// Exact `sha256:` digest of the scanned component, SDK, or dependency set.
    pub subject_digest: String,
    /// Closed caller-defined subject class, such as `component-image` or `sdk-image`.
    pub subject_kind: String,
    /// Locked advisory database identity.
    pub database_id: String,
    /// Exact digest of the advisory database bytes.
    pub database_digest: String,
    /// Unix time at which the external scanner ran.
    pub scanned_at_unix: u64,
    /// Unix time after which the locked database cannot satisfy this policy.
    pub database_expires_unix: u64,
    /// Count of findings rejected by policy; it must be zero for acceptance.
    pub rejected_findings: u64,
    /// Digest of the canonical, redacted scanner result.
    pub result_digest: String,
}

/// Closed advisory coverage and freshness policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdvisoryPolicy {
    /// Exact subject digests that must each have one scan fact.
    pub required_subjects: Vec<String>,
    /// Required advisory database identity.
    pub database_id: String,
    /// Required advisory database digest.
    pub database_digest: String,
    /// Maximum permitted age of the scan execution.
    pub max_age_seconds: u64,
}

/// Validate complete component/SDK scan coverage without upgrading offline facts.
pub fn validate_advisory_coverage(
    facts: &[AdvisoryScanFact],
    policy: &AdvisoryPolicy,
    now_unix: u64,
) -> Result<Value, PrismError> {
    let required = policy
        .required_subjects
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if required.len() != policy.required_subjects.len()
        || required.iter().any(|digest| digest_hex(digest).is_none())
    {
        return Err(PrismError::new(
            "PP7801",
            "advisory policy subjects are duplicated or malformed",
        ));
    }
    let mut observed = BTreeSet::new();
    for fact in facts {
        if digest_hex(&fact.subject_digest).is_none()
            || digest_hex(&fact.database_digest).is_none()
            || digest_hex(&fact.result_digest).is_none()
            || fact.subject_kind.is_empty()
            || fact.database_id != policy.database_id
            || fact.database_digest != policy.database_digest
            || fact.scanned_at_unix > now_unix
            || now_unix.saturating_sub(fact.scanned_at_unix) > policy.max_age_seconds
            || now_unix >= fact.database_expires_unix
            || fact.rejected_findings != 0
            || !observed.insert(fact.subject_digest.as_str())
        {
            return Err(PrismError::new(
                "PP7801",
                "advisory scan is malformed, stale, duplicated, wrong-database, or rejected",
            ));
        }
    }
    if observed != required {
        return Err(PrismError::new(
            "PP7801",
            "advisory scans do not cover every required component and SDK subject",
        ));
    }
    Ok(json!({
        "database_digest":policy.database_digest,
        "database_id":policy.database_id,
        "result":"passed",
        "scan_count":facts.len(),
        "schema":"prismpm/advisory-policy-result/1",
        "subjects":policy.required_subjects
    }))
}

/// Locked source configuration binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LockBinding {
    /// Relative path of the lock within the repository root.
    pub path: String,
    /// Exact `sha256:` digest of the lockfile bytes.
    pub digest: String,
}

/// Installed dependency graph binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphBinding {
    /// Path to the dependency graph manifest or lock.
    pub lockfile_path: String,
    /// Exact `sha256:` digest of the dependency lockfile bytes.
    pub lockfile_digest: String,
    /// Exact `sha256:` digest of the resolved dependency graph or installed tree.
    pub installed_tree_digest: String,
}

/// Runtime executable and module tree binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeBinding {
    /// Locked parser version or runtime descriptor.
    pub parser_version: String,
    /// Exact `sha256:` digest of the owned runtime lock.
    pub runtime_lock_digest: String,
    /// Length-framed canonical tree digest of installed runtime modules.
    pub tree_digest: String,
}

/// Bound launcher script or executable identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LauncherBinding {
    /// Target system path of the launcher script or executable.
    pub path: String,
    /// Exact `sha256:` digest of the launcher executable bytes.
    pub digest: String,
}

/// Shipped platform SDK image and inventory binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlatformInventoryBinding {
    /// Target OCI platform, e.g. `linux/amd64` or `linux/arm64`.
    pub platform: String,
    /// Exact `sha256:` digest of the shipped platform SDK image manifest.
    pub sdk_image_digest: String,
    /// Exact `sha256:` digest of the platform SDK inventory JSON document.
    pub inventory_digest: String,
}

/// Policy governing acceptable SDK security disposition and scan freshness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SdkAdvisoryPolicy {
    /// Required advisory database identifier.
    pub database_id: String,
    /// Required advisory database digest.
    pub database_digest: String,
    /// Unix timestamp after which the database is considered expired.
    pub database_expires_unix: u64,
    /// Maximum allowable age of scan facts in seconds.
    pub max_age_seconds: u64,
    /// Require full SDK image scans on all platforms; component-only evidence fails closed.
    pub require_full_sdk_scan: bool,
    /// Maximum allowed rejected findings (must be 0 for production acceptance).
    pub allowed_rejected_findings: u64,
}

/// Complete security and vulnerability disposition for the shipped SDK identities.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SdkSecurityDisposition {
    /// Closed schema identifier (`prismpm/sdk-security-disposition/1`).
    pub schema: String,
    /// Bound source locks.
    pub source_locks: Vec<LockBinding>,
    /// Bound installed dependency graph.
    pub installed_graph: GraphBinding,
    /// Bound runtime bytes and modules.
    pub runtime_bytes: RuntimeBinding,
    /// Bound launcher script.
    pub launcher: LauncherBinding,
    /// Bound platform inventories for shipped architectures.
    pub platform_inventories: Vec<PlatformInventoryBinding>,
    /// Observed vulnerability and advisory scan facts.
    pub scan_facts: Vec<AdvisoryScanFact>,
    /// Policy under which the disposition is validated.
    pub policy: SdkAdvisoryPolicy,
}

/// Validate the complete security and vulnerability disposition for shipped SDK identities.
///
/// Enforces:
/// - Exact schema `prismpm/sdk-security-disposition/1`.
/// - Complete binding of source locks, installed graph, runtime bytes, launcher, and platform inventories.
/// - Both `linux/amd64` and `linux/arm64` platform coverage.
/// - Strict rejection of component-only advisory evidence as a substitute for full shipped SDK disposition.
/// - Enforced freshness bounds (scan age within `max_age_seconds`, database not expired).
/// - Zero unresolved rejected findings.
pub fn validate_sdk_security_disposition(
    disposition: &SdkSecurityDisposition,
    now_unix: u64,
) -> Result<Value, PrismError> {
    if disposition.schema != "prismpm/sdk-security-disposition/1" {
        return Err(PrismError::new(
            "PP7801",
            "SDK security disposition schema differs or is unsupported",
        ));
    }

    if disposition.source_locks.is_empty() {
        return Err(PrismError::new(
            "PP7801",
            "SDK security disposition source locks are empty",
        ));
    }
    for lock in &disposition.source_locks {
        if lock.path.trim().is_empty() || digest_hex(&lock.digest).is_none() {
            return Err(PrismError::new(
                "PP7801",
                "SDK security disposition source lock path or digest is malformed",
            ));
        }
    }

    if disposition.installed_graph.lockfile_path.trim().is_empty()
        || digest_hex(&disposition.installed_graph.lockfile_digest).is_none()
        || digest_hex(&disposition.installed_graph.installed_tree_digest).is_none()
    {
        return Err(PrismError::new(
            "PP7801",
            "SDK security disposition installed graph binding is malformed",
        ));
    }

    if disposition.runtime_bytes.parser_version.trim().is_empty()
        || digest_hex(&disposition.runtime_bytes.runtime_lock_digest).is_none()
        || digest_hex(&disposition.runtime_bytes.tree_digest).is_none()
    {
        return Err(PrismError::new(
            "PP7801",
            "SDK security disposition runtime bytes binding is malformed",
        ));
    }

    if disposition.launcher.path.trim().is_empty()
        || digest_hex(&disposition.launcher.digest).is_none()
    {
        return Err(PrismError::new(
            "PP7801",
            "SDK security disposition launcher binding is malformed",
        ));
    }

    if disposition.platform_inventories.is_empty() {
        return Err(PrismError::new(
            "PP7801",
            "SDK security disposition platform inventories are empty",
        ));
    }

    let mut platforms = BTreeSet::new();
    for inv in &disposition.platform_inventories {
        if digest_hex(&inv.sdk_image_digest).is_none()
            || digest_hex(&inv.inventory_digest).is_none()
            || !platforms.insert(inv.platform.as_str())
        {
            return Err(PrismError::new(
                "PP7801",
                "SDK security disposition platform inventory has invalid or duplicate platform entry",
            ));
        }
    }

    for required in ["linux/amd64", "linux/arm64"] {
        if !platforms.contains(required) {
            return Err(PrismError::new(
                "PP7801",
                format!("SDK security disposition omits required platform {required}"),
            ));
        }
    }

    if !disposition.policy.require_full_sdk_scan {
        return Err(PrismError::new(
            "PP7801",
            "SDK security disposition policy must require full SDK image scan",
        ));
    }
    if disposition.policy.allowed_rejected_findings != 0 {
        return Err(PrismError::new(
            "PP7801",
            "SDK security disposition policy cannot allow rejected findings for production release",
        ));
    }
    if digest_hex(&disposition.policy.database_digest).is_none() {
        return Err(PrismError::new(
            "PP7801",
            "SDK security disposition policy database digest is malformed",
        ));
    }
    if now_unix >= disposition.policy.database_expires_unix {
        return Err(PrismError::new(
            "PP7801",
            "advisory database has expired under production freshness policy",
        ));
    }

    let required_sdk_images = disposition
        .platform_inventories
        .iter()
        .map(|inv| inv.sdk_image_digest.as_str())
        .collect::<BTreeSet<_>>();

    let observed_sdk_images = disposition
        .scan_facts
        .iter()
        .filter(|fact| fact.subject_kind == "sdk-image")
        .map(|fact| fact.subject_digest.as_str())
        .collect::<BTreeSet<_>>();

    if observed_sdk_images.is_empty() {
        return Err(PrismError::new(
            "PP7801",
            "component-only advisory evidence cannot substitute for full shipped SDK disposition",
        ));
    }
    if observed_sdk_images != required_sdk_images {
        return Err(PrismError::new(
            "PP7801",
            "advisory scans do not cover every shipped SDK platform identity",
        ));
    }

    let mut observed_subjects = BTreeSet::new();
    for fact in &disposition.scan_facts {
        if digest_hex(&fact.subject_digest).is_none()
            || digest_hex(&fact.database_digest).is_none()
            || digest_hex(&fact.result_digest).is_none()
            || fact.subject_kind.is_empty()
            || fact.database_id != disposition.policy.database_id
            || fact.database_digest != disposition.policy.database_digest
        {
            return Err(PrismError::new(
                "PP7801",
                "advisory scan fact has malformed digest or database mismatch",
            ));
        }
        if fact.scanned_at_unix > now_unix {
            return Err(PrismError::new(
                "PP7801",
                "advisory scan timestamp is in the future",
            ));
        }
        if now_unix.saturating_sub(fact.scanned_at_unix) > disposition.policy.max_age_seconds {
            return Err(PrismError::new(
                "PP7801",
                "advisory scan evidence exceeds maximum permitted age under freshness policy",
            ));
        }
        if now_unix >= fact.database_expires_unix {
            return Err(PrismError::new(
                "PP7801",
                "advisory database was expired at evaluation time",
            ));
        }
        if fact.rejected_findings > disposition.policy.allowed_rejected_findings {
            return Err(PrismError::new(
                "PP7801",
                "advisory scan contains unresolved rejected findings",
            ));
        }
        if !observed_subjects.insert((fact.subject_kind.as_str(), fact.subject_digest.as_str())) {
            return Err(PrismError::new(
                "PP7801",
                "duplicate advisory scan subject fact",
            ));
        }
    }

    let platform_list = platforms.into_iter().map(str::to_owned).collect::<Vec<_>>();
    let scanned_subjects = disposition
        .scan_facts
        .iter()
        .map(|f| f.subject_digest.clone())
        .collect::<Vec<_>>();

    Ok(json!({
        "database_digest": disposition.policy.database_digest,
        "database_id": disposition.policy.database_id,
        "platform_count": disposition.platform_inventories.len(),
        "platforms": platform_list,
        "result": "verified",
        "scanned_subjects": scanned_subjects,
        "schema": "prismpm/sdk-security-disposition-receipt/1",
        "unresolved_findings": 0,
        "verified_at_unix": now_unix
    }))
}
