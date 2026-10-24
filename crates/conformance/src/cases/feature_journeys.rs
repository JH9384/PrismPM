//! FT-12, FT-13 and ST-19: features and user journeys of a product.

use std::path::Path;
use std::process::Command;

const ENTRIES: [&str; 3] = ["arch-feature", "arch-journey", "holo-normalized-features"];

const DECLARATIONS: [&str; 2] = ["Feature", "Journey"];

const VALIDATOR: [&str; 15] = [
    "NormalizedFeatures",
    "allPositive",
    "validateFeatureCalls",
    "validateFeatureAcceptance",
    "validateJourneyActors",
    "validateJourneySteps",
    "validateNormalizedFeatures",
    "featureCalls_sound_complete",
    "featureAcceptance_sound_complete",
    "journeyActors_sound_complete",
    "journeySteps_sound_complete",
    "normalizedFeatures_sound_complete",
    "featureWithoutCallRefused",
    "journeyStepUndeclaredFeatureRefused",
    "journeyActorNotStakeholderRefused",
];

/// FT-12: the feature and journey entries are mapped to ISO/IEC/IEEE 42010 and
/// each denotes a declared component, and Foundation.Arch declares both types.
pub(super) fn verify_entries(root: &Path) {
    let standards: toml::Value = super::read(root, "model/standards.toml")
        .parse()
        .expect("standards register");
    let row = standards["standard"]
        .as_array()
        .expect("standards rows")
        .iter()
        .find(|row| row["id"].as_str() == Some("ISO-42010-2022"))
        .expect("standards register lacks ISO-42010-2022");
    let owned: Vec<&str> = row["facet_entries"]
        .as_array()
        .expect("facet entries")
        .iter()
        .map(|entry| entry.as_str().expect("facet entry ID"))
        .collect();
    for entry in ENTRIES {
        assert!(owned.contains(&entry), "42010 row lacks {entry}");
        let source = super::read(root, &format!("language/prism.arch/entries/{entry}.toml"));
        let value: toml::Value = source.parse().expect("lexicon entry");
        assert_eq!(value["id"].as_str(), Some(entry));
        assert!(value["denotation"]["component"].as_str().is_some());
    }
    super::assert_declarations(root, "Foundation.Arch", &DECLARATIONS);
}

/// ST-19: Foundation.Holo declares the normalized validator, its soundness and
/// completeness theorems and the proved refusals of each defect.
pub(super) fn verify_validator(root: &Path) {
    super::assert_declarations(root, "Foundation.Holo", &VALIDATOR);
}

/// FT-13: the owning check suites pass, including the exhaustive agreement of
/// the check with the normalized validator, and the worked example and each
/// negative fixture match their declared outcome.
pub(super) fn verify_check(root: &Path) {
    let output = Command::new("cargo")
        .current_dir(root)
        .args([
            "test",
            "--locked",
            "--offline",
            "-p",
            "prismpm",
            "--lib",
            "features::",
        ])
        .args(["--", "--nocapture", "--test-threads=1"])
        // The outer conformance Cargo owner may retain its target lock; use a
        // disjoint target for the owning suites.
        .env("CARGO_TARGET_DIR", root.join("target/conformance-features"))
        .output()
        .expect("FT-13 executes its owning suites");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 owning stdout");
    let stderr = String::from_utf8(output.stderr).expect("UTF-8 owning stderr");
    assert!(output.status.success(), "FT-13: {stdout}\n{stderr}");
    for name in [
        "features::tests::a_complete_model_is_accepted",
        "features::tests::a_feature_without_a_call_is_refused_with_pp2014",
        "features::tests::a_feature_without_acceptance_is_refused_with_pp2015",
        "features::tests::a_journey_step_naming_an_undeclared_feature_is_refused_with_pp2016",
        "features::tests::a_journey_whose_actor_is_not_a_stakeholder_is_refused_with_pp2017",
        "features::tests::a_call_or_acceptance_row_that_names_nothing_is_refused_with_pp2018",
        "features::tests::the_normalized_validator_agrees_with_the_proved_vectors",
        "features::tests::the_check_and_the_normalized_validator_agree_on_every_small_model",
    ] {
        assert!(
            stdout
                .lines()
                .any(|line| line.ends_with(&format!("{name} ... ok"))),
            "FT-13 requires passing {name}"
        );
    }
    for fixture in [
        "tests/fixtures/features/fj-01-lexlean-mcp",
        "tests/negative/features/feature-without-call",
        "tests/negative/features/feature-without-acceptance",
        "tests/negative/features/journey-step-undeclared-feature",
        "tests/negative/features/journey-actor-not-stakeholder",
        "tests/negative/features/call-names-nothing",
    ] {
        crate::fixtures::check(&root.join(fixture))
            .expect("the feature and journey fixture matches its declared outcome");
    }
}
