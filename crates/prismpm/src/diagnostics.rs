//! Executable malformed-input probes for the complete public diagnostic contract.

use crate::error::PrismError;
use crate::holo::canonical::encode_value;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[path = "diagnostics/filesystem.rs"]
mod filesystem;

#[path = "diagnostics/configuration.rs"]
mod configuration;

#[derive(Clone, Copy)]
enum Rule {
    ArtifactIntegrity,
    ConfinedOutput,
    ImmutableLock,
    ConfigurationShape,
    ConfigurationRequired,
    ConfigurationLimits,
    Required,
    PositiveBound,
    Reference,
    Unique,
    Acyclic,
    Exact,
    Digest,
    Canonical,
    Complete,
    Authorized,
    Fresh,
    Offline,
    SecretFree,
    Internal,
    TextApplication,
    BrowserApplication,
    BrowserRuntime,
    DesignView,
    FeatureCall,
    FeatureAcceptance,
    FeatureStep,
    JourneyActor,
    FeatureDeclaration,
}

impl Rule {
    fn specimens(self) -> (Value, Value) {
        match self {
            Self::BrowserApplication => {
                let valid = browser_specimen();
                let mut invalid = valid.clone();
                invalid["durability"]["max_pending"] = json!(2);
                (valid, invalid)
            }
            Self::BrowserRuntime => (Self::TextApplication.specimens().0, browser_specimen()),
            Self::DesignView => (
                json!({"component": "Probe::component"}),
                json!({"component": "Probe::unknown"}),
            ),
            Self::FeatureCall
            | Self::FeatureAcceptance
            | Self::FeatureStep
            | Self::JourneyActor
            | Self::FeatureDeclaration => feature_specimens(self),
            Self::ArtifactIntegrity => filesystem::specimens("PP4001"),
            Self::ConfinedOutput => filesystem::specimens("PP8001"),
            Self::ImmutableLock => filesystem::specimens("PP1101"),
            Self::ConfigurationShape => configuration::specimens("PP1001"),
            Self::ConfigurationRequired => configuration::specimens("PP1002"),
            Self::ConfigurationLimits => configuration::specimens("PP1003"),
            Self::Required => (json!({"required":"present"}), json!({})),
            Self::PositiveBound => (
                json!({"maximum":1,"value":1}),
                json!({"maximum":1,"value":2}),
            ),
            Self::Reference => (
                json!({"declared":["a"],"selected":"a"}),
                json!({"declared":["a"],"selected":"missing"}),
            ),
            Self::Unique => (json!({"ids":["a","b"]}), json!({"ids":["a","a"]})),
            Self::Acyclic => (json!({"edges":[["a","b"]]}), json!({"edges":[["a","a"]]})),
            Self::Exact => (
                json!({"expected":"a","observed":"a"}),
                json!({"expected":"a","observed":"b"}),
            ),
            Self::Digest => (
                json!({"digest":format!("sha256:{}","a".repeat(64))}),
                json!({"digest":"sha256:bad"}),
            ),
            Self::Canonical => (
                json!({"bytes":"{\"a\":1}","canonical":"{\"a\":1}"}),
                json!({"bytes":"{ \"a\": 1 }","canonical":"{\"a\":1}"}),
            ),
            Self::Complete => (
                json!({"required":["a"],"observed":["a"]}),
                json!({"required":["a"],"observed":[]}),
            ),
            Self::Authorized => (json!({"authorized":true}), json!({"authorized":false})),
            Self::Fresh => (
                json!({"expires":2,"observed":1}),
                json!({"expires":1,"observed":2}),
            ),
            Self::Offline => (json!({"network":false}), json!({"network":true})),
            Self::SecretFree => (
                json!({"value":"secret://reference"}),
                json!({"value":"Authorization: Bearer planted"}),
            ),
            Self::Internal => (json!({"invariant":true}), json!({"invariant":false})),
            Self::TextApplication => {
                let valid = json!({
                    "profile":"prismpm/text-application/1",
                    "name":"Text Probe",
                    "cargo_name":"prism-text-probe",
                    "cargo_version":"0.1.0",
                    "cargo_description":"Executable text profile diagnostic specimen",
                    "cargo_repository":"https://github.com/UOR-Foundation/PrismPM",
                    "cargo_homepage":"https://github.com/UOR-Foundation/PrismPM",
                    "library_roots":["TextProbe.dispatch"],
                    "entry_root":"TextProbe.dispatch",
                    "acceptance_vectors":[{"request":[97],"response":[97]}],
                    "core_contract":"hologram:guest/core-wasm@1",
                    "request_maximum":1,"response_maximum":1,"guest_allocation_maximum":1,
                    "capabilities_empty":true,"fat_archive":true,"primary_layer":0,"view_layer":1,
                    "view":{"title":"Text probe","heading":"Text probe","input_label":"Request",
                        "submit_label":"Submit","output_label":"Response","input_error":"Invalid request",
                        "response_error":"Invalid response"}
                });
                let mut invalid = valid.clone();
                invalid["profile"] = json!("prismpm/text-application/2");
                (valid, invalid)
            }
        }
    }

    fn accepts(self, value: &Value) -> bool {
        match self {
            Self::BrowserApplication => validate_browser_specimen(value).is_ok(),
            Self::BrowserRuntime => validate_browser_runtime(value).is_ok(),
            Self::DesignView => crate::design::probe(value).is_ok(),
            Self::FeatureCall
            | Self::FeatureAcceptance
            | Self::FeatureStep
            | Self::JourneyActor
            | Self::FeatureDeclaration => crate::features::probe(value).is_ok(),
            Self::ArtifactIntegrity | Self::ConfinedOutput | Self::ImmutableLock => {
                filesystem::validate(value).is_ok()
            }
            Self::ConfigurationShape | Self::ConfigurationRequired | Self::ConfigurationLimits => {
                configuration::validate(value).is_ok()
            }
            Self::Required => value
                .get("required")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty()),
            Self::PositiveBound => value["value"]
                .as_u64()
                .zip(value["maximum"].as_u64())
                .is_some_and(|(value, maximum)| maximum > 0 && value <= maximum),
            Self::Reference => value["selected"].as_str().is_some_and(|selected| {
                value["declared"].as_array().is_some_and(|declared| {
                    declared.iter().any(|item| item.as_str() == Some(selected))
                })
            }),
            Self::Unique => value["ids"].as_array().is_some_and(|ids| {
                ids.iter()
                    .filter_map(Value::as_str)
                    .collect::<BTreeSet<_>>()
                    .len()
                    == ids.len()
            }),
            Self::Acyclic => value["edges"]
                .as_array()
                .is_some_and(|edges| edges.iter().all(|edge| edge[0] != edge[1])),
            Self::Exact => value["expected"].is_string() && value["expected"] == value["observed"],
            Self::Digest => value["digest"].as_str().is_some_and(|digest| {
                digest.strip_prefix("sha256:").is_some_and(|hex| {
                    hex.len() == 64
                        && hex
                            .bytes()
                            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                })
            }),
            Self::Canonical => value["bytes"]
                .as_str()
                .zip(value["canonical"].as_str())
                .is_some_and(|(bytes, canonical)| bytes == canonical),
            Self::Complete => value["required"]
                .as_array()
                .zip(value["observed"].as_array())
                .is_some_and(|(required, observed)| {
                    required.iter().all(|item| observed.contains(item))
                }),
            Self::Authorized => value["authorized"] == true,
            Self::Fresh => value["observed"]
                .as_u64()
                .zip(value["expires"].as_u64())
                .is_some_and(|(observed, expires)| observed <= expires),
            Self::Offline => value["network"] == false,
            Self::SecretFree => value["value"]
                .as_str()
                .is_some_and(|value| !value.to_ascii_lowercase().contains("bearer ")),
            Self::Internal => value["invariant"] == true,
            Self::TextApplication => validate_text_specimen(value).is_ok(),
        }
    }
}

#[derive(Clone, Copy)]
struct ProbeSpec {
    code: &'static str,
    trigger: &'static str,
    rule: Rule,
}

macro_rules! probes {
    ($(($code:literal, $trigger:literal, $rule:ident)),+ $(,)?) => {
        const PROBES: &[ProbeSpec] = &[$(ProbeSpec { code: $code, trigger: $trigger, rule: Rule::$rule }),+];
    };
}

probes!(
    ("PP1001", "unknown-configuration-field", ConfigurationShape),
    (
        "PP1002",
        "missing-required-configuration",
        ConfigurationRequired
    ),
    ("PP1003", "invalid-project-limit", ConfigurationLimits),
    ("PP2001", "unresolved-document-reference", Reference),
    ("PP2002", "ambiguous-facet-term", Unique),
    ("PP2003", "duplicate-component-id", Unique),
    ("PP2004", "dangling-component-edge", Reference),
    ("PP2005", "unresolved-risk-link", Reference),
    ("PP2006", "unsatisfied-security-control", Complete),
    ("PP2007", "invalid-quality-mapping", Reference),
    ("PP2008", "cyclic-lexicon-import", Acyclic),
    (
        "PP2009",
        "invalid-text-application-profile",
        TextApplication
    ),
    ("PP3001", "malformed-holo-header", Exact),
    (
        "PP2010",
        "invalid-browser-application-declaration",
        BrowserApplication
    ),
    (
        "PP2011",
        "browser-application-runtime-unavailable",
        BrowserRuntime
    ),
    ("PP2012", "unknown-design-view-name", DesignView),
    ("PP2014", "feature-without-call", FeatureCall),
    ("PP2015", "feature-without-acceptance", FeatureAcceptance),
    ("PP2016", "journey-step-undeclared-feature", FeatureStep),
    ("PP2017", "journey-actor-not-stakeholder", JourneyActor),
    (
        "PP2018",
        "invalid-feature-or-journey-declaration",
        FeatureDeclaration
    ),
    ("PP3002", "malformed-holo-section-table", PositiveBound),
    ("PP3003", "invalid-holo-section-closure", Complete),
    ("PP3004", "holo-footer-mismatch", Digest),
    ("PP3005", "application-manifest-disagreement", Exact),
    ("PP3006", "capability-request-disagreement", Exact),
    ("PP3007", "hologram-identity-disagreement", Digest),
    ("PP3008", "content-blob-disagreement", Digest),
    ("PP3009", "incomplete-fat-archive", Complete),
    ("PP3010", "invalid-application-layer", Reference),
    ("PP3011", "holo-application-projection-disagreement", Exact),
    ("PP3012", "application-directory-disagreement", Exact),
    ("PP3013", "extension-disagreement", Complete),
    ("PP3014", "source-manifest-disagreement", Exact),
    ("PP3015", "prism-provenance-disagreement", Exact),
    ("PP3016", "attestation-section-disagreement", Exact),
    ("PP3017", "attestation-bundle-disagreement", Exact),
    ("PP4001", "artifact-checksum-mismatch", ArtifactIntegrity),
    ("PP4002", "missing-published-artifact", Required),
    ("PP4003", "emitter-input-digest-drift", Digest),
    ("PP4004", "invalid-manifest-structure", Canonical),
    ("PP4101", "stdlib-runtime-mismatch", Exact),
    ("PP4102", "application-code-mismatch", Exact),
    ("PP4103", "cargo-publication-failure", Complete),
    ("PP4104", "archive-publication-failure", Complete),
    ("PP4105", "browser-publication-failure", Exact),
    ("PP5001", "lean-elaboration-failure", Complete),
    ("PP5002", "leanchecker-replay-failure", Exact),
    ("PP5003", "unaudited-lean-axiom", Complete),
    ("PP5004", "lean4-prod-export-failure", Complete),
    ("PP5005", "rust-validator-compilation-failure", Complete),
    ("PP5006", "validator-execution-mismatch", Exact),
    ("PP5007", "child-process-resource-limit", PositiveBound),
    ("PP5008", "verification-executable-unavailable", Required),
    ("PP5101", "guest-abi-disagreement", Exact),
    ("PP5102", "forbidden-guest-import", Complete),
    ("PP5103", "guest-export-disagreement", Complete),
    ("PP5104", "guest-memory-contract-failure", PositiveBound),
    ("PP5201", "portable-view-bundle-disagreement", Canonical),
    ("PP5202", "view-model-disagreement", Exact),
    ("PP5203", "view-projection-disagreement", Exact),
    ("PP5204", "view-intent-disagreement", Exact),
    ("PP5205", "view-surface-disagreement", Complete),
    ("PP5301", "upstream-hologram-oracle-disagreement", Exact),
    ("PP6001", "reference-model-identity-drift", Digest),
    ("PP6002", "incomplete-application-acceptance", Complete),
    ("PP6003", "application-execution-disagreement", Exact),
    ("PP6004", "ecosystem-release-incomplete", Complete),
    ("PP8001", "path-traversal", ConfinedOutput),
    ("PP8002", "offline-network-access", Offline),
    ("PP1101", "immutable-lock-invalid", ImmutableLock),
    ("PP2101", "production-system-closure-invalid", Complete),
    (
        "PP2102",
        "environment-or-secret-binding-invalid",
        SecretFree
    ),
    ("PP2103", "unsafe-lifecycle-transition", Authorized),
    ("PP5401", "authority-resolution-failure", Required),
    ("PP5402", "authority-bytes-mismatch", Digest),
    ("PP5403", "oracle-invocation-failure", Complete),
    ("PP5404", "standards-coverage-insufficient", Complete),
    ("PP5405", "authority-evidence-stale", Fresh),
    ("PP6101", "product-release-unverified", Complete),
    ("PP6201", "registry-operation-failure", Exact),
    ("PP6301", "oci-release-graph-invalid", Acyclic),
    ("PP6401", "supply-chain-policy-rejected", Complete),
    ("PP7001", "target-capability-mismatch", Complete),
    ("PP7101", "deployment-plan-invalid", Fresh),
    ("PP7901", "backup-or-recovery-failure", Complete),
    ("PP7201", "deployment-health-failure", Exact),
    ("PP7301", "deployment-drift", Exact),
    ("PP7401", "rollback-safety-failure", Authorized),
    ("PP7501", "operation-authorization-failure", Authorized),
    ("PP7601", "operation-resource-exhaustion", PositiveBound),
    ("PP7701", "retirement-refused", Authorized),
    ("PP7801", "secret-material-detected", SecretFree),
    ("PP9001", "internal-invariant-failure", Internal),
);

/// One successfully exercised public diagnostic trigger.
#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticProbeResult {
    /// Registered code actually returned by the malformed-input validator.
    pub code: String,
    /// Stable trigger fixture identity.
    pub trigger: String,
    /// Digest of the accepted control specimen and its outcome.
    pub positive_digest: String,
    /// Digest of the rejected specimen and exact observed diagnostic.
    pub negative_digest: String,
}

fn digest(value: &Value) -> Result<String, PrismError> {
    Ok(format!("sha256:{:x}", Sha256::digest(encode_value(value)?)))
}

fn validate_text_specimen(value: &Value) -> Result<(), PrismError> {
    let application = serde_json::from_value(value.clone()).map_err(|error| {
        PrismError::new("PP2009", format!("text application specimen: {error}"))
    })?;
    crate::holo::validate::validate_text_application(&application)
}

/// The control and malformed specimens of the feature and journey rules: a
/// stakeholder, a call and an acceptance row that exist, one feature and one
/// journey, with the single defect each rule names.
fn feature_specimens(rule: Rule) -> (Value, Value) {
    let valid = json!({
        "stakeholders": ["Probe::stakeholder"],
        "definitions": ["Probe::call", "Probe::acceptance"],
        "features": {"Probe::feature": {"calls": ["Probe::call"], "acceptance": ["Probe::acceptance"]}},
        "journeys": {"Probe::journey": {"actor": "Probe::stakeholder", "steps": ["Probe::feature"]}},
    });
    let mut invalid = valid.clone();
    match rule {
        Rule::FeatureCall => invalid["features"]["Probe::feature"]["calls"] = json!([]),
        Rule::FeatureAcceptance => invalid["features"]["Probe::feature"]["acceptance"] = json!([]),
        Rule::FeatureStep => {
            invalid["journeys"]["Probe::journey"]["steps"] = json!(["Probe::unknown"])
        }
        Rule::JourneyActor => {
            invalid["journeys"]["Probe::journey"]["actor"] = json!("Probe::unknown")
        }
        _ => invalid["definitions"] = json!(["Probe::acceptance"]),
    }
    (valid, invalid)
}

fn browser_specimen() -> Value {
    serde_json::from_str(r#"{"profile":"prismpm/browser-application/1","name":"Browser Contract","cargo_name":"prism-browser-contract","cargo_version":"0.1.0","cargo_description":"Source projection fixture, not an executable application.","cargo_repository":"https://github.com/UOR-Foundation/PrismPM","cargo_homepage":"https://github.com/UOR-Foundation/PrismPM","library_roots":["BrowserContract.Probe.dispatch","BrowserContract.Probe.present","BrowserContract.Probe.replay"],"acceptance_vectors":[{"request":[0],"response":[0]}],"entry_root":"BrowserContract.Probe.dispatch","core_contract":"hologram:guest/core-wasm@1","request_maximum":1,"response_maximum":1,"guest_allocation_maximum":1,"memory_pages":32,"capabilities_empty":true,"fat_archive":true,"primary_layer":0,"view_layer":1,"protocol":"prismpm/browser-application-session/1","requested_effects":[{"resource":"digest","adapter":{"kind":"digest","maximum":1048576}},{"resource":"guest","adapter":{"kind":"guest","entry_root":"BrowserContract.Probe.dispatch","protocol":"fixture/1","input_maximum":1,"output_maximum":1,"memory_pages":32}},{"resource":"random","adapter":{"kind":"random","maximum":65536}},{"resource":"sign","adapter":{"kind":"sign","credential_slot":"selected","context":"prismpm/fixture/1","maximum":1048576}},{"resource":"store","adapter":{"kind":"store","namespace":"browser-contract","max_object_bytes":1048576,"max_objects":4096,"max_heads":64}},{"resource":"verify","adapter":{"kind":"verify","context":"prismpm/fixture/1","maximum":1048576}}],"durability":{"protocol":"prismpm/browser-operation-journal/1","resource":"journal","head":"operations","replay_root":"BrowserContract.Probe.replay","max_pending":1,"namespace":"browser-contract-journal","staging_head":"staging","signing_resource":"journal-sign","credential_slot":"selected","maximum_records":1024},"view":{"surface":"prismpm-browser/1","protocol":"prismpm/browser-presentation/1","title":"Browser Contract","heading":"Declaration fixture","presentation_root":"BrowserContract.Probe.present","maximum":1,"labels":[{"id":"status","text":"Runtime unavailable"}]}}"#).expect("closed browser diagnostic fixture")
}

fn validate_browser_specimen(value: &Value) -> Result<(), PrismError> {
    let declaration = serde_json::from_value(value.clone())
        .map_err(|_| PrismError::new("PP2010", "invalid browser declaration specimen"))?;
    crate::holo::browser_application::validate(&declaration)
}

fn validate_browser_runtime(value: &Value) -> Result<(), PrismError> {
    let declaration = serde_json::from_value(value.clone())
        .map_err(|_| PrismError::new("PP2010", "invalid application runtime specimen"))?;
    crate::holo::browser_application::require_runtime(&declaration)
}

fn validate(spec: ProbeSpec, value: &Value) -> Result<(), PrismError> {
    if matches!(spec.rule, Rule::BrowserApplication) {
        return validate_browser_specimen(value);
    }
    if matches!(spec.rule, Rule::BrowserRuntime) {
        return validate_browser_runtime(value);
    }
    if matches!(
        spec.rule,
        Rule::ConfigurationShape | Rule::ConfigurationRequired | Rule::ConfigurationLimits
    ) {
        return configuration::validate(value);
    }
    if matches!(
        spec.rule,
        Rule::ConfigurationShape | Rule::ConfigurationRequired | Rule::ConfigurationLimits
    ) {
        return configuration::validate(value);
    }
    if matches!(
        spec.rule,
        Rule::ArtifactIntegrity | Rule::ConfinedOutput | Rule::ImmutableLock
    ) {
        return filesystem::validate(value);
    }
    if matches!(spec.rule, Rule::TextApplication) {
        return validate_text_specimen(value);
    }
    if matches!(spec.rule, Rule::DesignView) {
        return crate::design::probe(value);
    }
    if matches!(
        spec.rule,
        Rule::FeatureCall
            | Rule::FeatureAcceptance
            | Rule::FeatureStep
            | Rule::JourneyActor
            | Rule::FeatureDeclaration
    ) {
        return crate::features::probe(value);
    }
    if spec.rule.accepts(value) {
        Ok(())
    } else {
        Err(PrismError::new(
            spec.code,
            format!(
                "diagnostic trigger `{}` rejected its malformed specimen",
                spec.trigger
            ),
        ))
    }
}

/// Execute every compiled control/malformed specimen through its validator.
pub fn exercise_all() -> Result<Vec<DiagnosticProbeResult>, PrismError> {
    let mut results = Vec::with_capacity(PROBES.len());
    let mut codes = BTreeSet::new();
    let mut triggers = BTreeSet::new();
    for spec in PROBES {
        if !codes.insert(spec.code) || !triggers.insert(spec.trigger) {
            return Err(PrismError::new(
                "PP9001",
                "diagnostic probe registry is duplicated",
            ));
        }
        let (valid, invalid) = spec.rule.specimens();
        validate(*spec, &valid)?;
        let error = validate(*spec, &invalid).expect_err("malformed probe must be rejected");
        if error.code.as_str() != spec.code {
            return Err(PrismError::new(
                "PP6002",
                "diagnostic trigger emitted a different code",
            ));
        }
        results.push(DiagnosticProbeResult {
            code: spec.code.to_owned(),
            trigger: spec.trigger.to_owned(),
            positive_digest: digest(&json!({"input":valid,"status":"accepted","trigger":spec.trigger}))?,
            negative_digest: digest(&json!({"diagnostic":error,"input":invalid,"status":"rejected","trigger":spec.trigger}))?,
        });
    }
    results.sort_by(|left, right| left.code.cmp(&right.code));
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{exercise_all, validate, Rule, PROBES};
    use std::collections::BTreeSet;

    #[test]
    fn configuration_dispatch_preserves_the_real_loader_diagnostic() {
        let control = "spec = \"prismpm/project/1\"\nproject = \"Diagnostic\"\nlexlean_project = \"lexlean.toml\"\nbuild_root = \".prism\"\n[limits]\nmax_holo_bytes = 1\nmax_entities = 1\nmax_diagnostics = 1\n";
        for (code, malformed) in [
            ("PP1001", format!("unknown = true\n{control}")),
            ("PP1002", control.replace("project = \"Diagnostic\"\n", "")),
            (
                "PP1003",
                control.replace("max_entities = 1", "max_entities = 0"),
            ),
        ] {
            let spec = *PROBES.iter().find(|row| row.code == code).unwrap();
            let project = tempfile::tempdir().unwrap();
            std::fs::write(project.path().join("prismpm.toml"), &malformed).unwrap();
            let expected = crate::config::ProjectConfig::load(project.path(), None).unwrap_err();
            assert_eq!(expected.code.as_str(), code);
            validate(spec, &serde_json::json!({"configuration": control})).unwrap();
            let actual =
                validate(spec, &serde_json::json!({"configuration": malformed})).unwrap_err();
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                serde_json::to_value(expected).unwrap()
            );
        }
    }

    #[test]
    fn filesystem_dispatch_preserves_the_real_public_owner_diagnostic() {
        for code in ["PP4001", "PP8001", "PP1101"] {
            let spec = *PROBES.iter().find(|row| row.code == code).unwrap();
            let (valid, invalid) = super::filesystem::specimens(code);
            validate(spec, &valid).unwrap();
            let expected = super::filesystem::validate(&invalid).unwrap_err();
            let actual = validate(spec, &invalid).unwrap_err();
            assert_eq!(expected.code.as_str(), code);
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                serde_json::to_value(expected).unwrap()
            );
        }
    }

    #[test]
    fn every_registered_diagnostic_has_an_executable_trigger() {
        let results = exercise_all().unwrap();
        assert_eq!(results.first().unwrap().code, "PP1001");
        assert_eq!(results.last().unwrap().code, "PP9001");
        let registered: toml::Value = include_str!("../model/errors.toml").parse().unwrap();
        let expected = registered["error"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["code"].as_str().unwrap().to_owned())
            .collect::<BTreeSet<_>>();
        assert_eq!(results.len(), expected.len());
        let observed = results
            .iter()
            .map(|row| row.code.clone())
            .collect::<BTreeSet<_>>();
        assert_eq!(observed, expected);
    }

    #[test]
    fn text_profile_probe_returns_the_real_application_validator_diagnostic() {
        let spec = *PROBES.iter().find(|spec| spec.code == "PP2009").unwrap();
        let (valid, invalid) = Rule::TextApplication.specimens();
        validate(spec, &valid).unwrap();
        let application = serde_json::from_value(invalid.clone()).unwrap();
        let expected = crate::holo::validate::validate_text_application(&application).unwrap_err();
        let actual = validate(spec, &invalid).unwrap_err();
        assert_eq!(actual.code, "PP2009");
        assert_eq!(actual.message, expected.message);
        assert_eq!(
            actual.message,
            "text application declaration violates its closed byte-request profile"
        );
    }
}
