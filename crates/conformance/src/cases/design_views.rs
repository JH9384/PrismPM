//! FT-11, ST-18 and HO-18: OPM and UML design views as 42010 views.

use std::path::Path;
use std::process::Command;

const OPM_ENTRIES: [&str; 6] = [
    "arch-opm-link",
    "arch-opm-link-kind",
    "arch-opm-state",
    "arch-opm-thing",
    "arch-opm-thing-kind",
    "arch-opm-zoom",
];

const UML_ENTRIES: [&str; 7] = [
    "arch-uml-component",
    "arch-uml-connector",
    "arch-uml-lifeline",
    "arch-uml-message",
    "arch-uml-message-kind",
    "arch-uml-state",
    "arch-uml-transition",
];

const VIEW_ENTRIES: [&str; 4] = [
    "arch-design-diagram",
    "arch-design-view",
    "arch-system-process",
    "arch-system-state",
];

const PRIMITIVES: [&str; 17] = [
    "DesignDiagram",
    "DesignView",
    "OpmLink",
    "OpmLinkKind",
    "OpmState",
    "OpmThing",
    "OpmThingKind",
    "OpmZoom",
    "SystemProcess",
    "SystemState",
    "UmlComponent",
    "UmlConnector",
    "UmlLifeline",
    "UmlMessage",
    "UmlMessageKind",
    "UmlState",
    "UmlTransition",
];

fn row<'a>(standards: &'a toml::Value, id: &str) -> &'a toml::Value {
    standards["standard"]
        .as_array()
        .expect("standards rows")
        .iter()
        .find(|row| row["id"].as_str() == Some(id))
        .unwrap_or_else(|| panic!("standards register lacks {id}"))
}

fn entries(row: &toml::Value) -> Vec<&str> {
    row["facet_entries"]
        .as_array()
        .expect("facet entries")
        .iter()
        .map(|entry| entry.as_str().expect("facet entry ID"))
        .collect()
}

/// FT-11: the prism.arch design entries are mapped to exactly the standards
/// that own them, and each entry denotes a declared Foundation.Arch component.
pub(super) fn verify_entries(root: &Path) {
    let standards: toml::Value = super::read(root, "model/standards.toml")
        .parse()
        .expect("standards register");
    for (id, owned) in [
        ("ISO-19450-2015", OPM_ENTRIES.as_slice()),
        ("OMG-UML-2-5-1", UML_ENTRIES.as_slice()),
    ] {
        let row = row(&standards, id);
        assert_eq!(row["facet_package"].as_str(), Some("prism.arch"), "{id}");
        assert_eq!(row["coverage_state"].as_str(), Some("implemented"), "{id}");
        assert_eq!(row["release_scope"].as_bool(), Some(true), "{id}");
        assert_eq!(entries(row), owned, "{id} owns exactly its entries");
        let scope = row["scope"].as_str().expect("scope");
        assert!(scope.contains("covered subset"), "{id} states its subset");
    }
    let architecture = entries(row(&standards, "ISO-42010-2022"));
    for entry in VIEW_ENTRIES {
        assert!(architecture.contains(&entry), "42010 row lacks {entry}");
    }
    for entry in OPM_ENTRIES.iter().chain(&UML_ENTRIES).chain(&VIEW_ENTRIES) {
        let source = super::read(root, &format!("language/prism.arch/entries/{entry}.toml"));
        let value: toml::Value = source.parse().expect("lexicon entry");
        assert_eq!(value["id"].as_str(), Some(*entry));
        assert_eq!(
            value["denotation"]["module"].as_str(),
            Some("Foundation.Arch")
        );
        assert!(value["denotation"]["component"].as_str().is_some());
    }
}

/// ST-18: Foundation.Arch declares every design primitive.
pub(super) fn verify_primitives(root: &Path) {
    super::assert_declarations(root, "Foundation.Arch", &PRIMITIVES);
}

/// HO-18: the owning check and render suites pass, including the planted
/// unknown-name defect, and both project-level fixtures match their outcome.
pub(super) fn verify_views(root: &Path) {
    let output = Command::new("cargo")
        .current_dir(root)
        .args([
            "test",
            "--locked",
            "--offline",
            "-p",
            "prismpm",
            "--lib",
            "design::",
        ])
        .args(["--", "--nocapture", "--test-threads=1"])
        // The outer conformance Cargo owner may retain its target lock; use a
        // disjoint target for the owning suites.
        .env(
            "CARGO_TARGET_DIR",
            root.join("target/conformance-design-views"),
        )
        .output()
        .expect("HO-18 executes its owning suites");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 owning stdout");
    let stderr = String::from_utf8(output.stderr).expect("UTF-8 owning stderr");
    assert!(output.status.success(), "HO-18: {stdout}\n{stderr}");
    for name in [
        "design::tests::opm_view_renders_opl_text",
        "design::tests::uml_component_view_renders_plantuml",
        "design::tests::uml_sequence_view_renders_plantuml",
        "design::tests::uml_state_machine_view_renders_plantuml",
        "design::tests::planted_unknown_component_is_refused",
        "design::tests::unknown_names_are_refused_in_every_notation",
        "design::project_tests::a_project_builds_every_view_into_the_build_output",
        "design::project_tests::a_project_naming_an_unknown_component_is_refused",
    ] {
        assert!(
            stdout
                .lines()
                .any(|line| line.ends_with(&format!("{name} ... ok"))),
            "HO-18 requires passing {name}"
        );
    }
    for fixture in [
        "tests/fixtures/design/dv-01-system-views",
        "tests/negative/design/unknown-component",
    ] {
        crate::fixtures::check(&root.join(fixture))
            .expect("the complete design-view fixture matches its declared outcome");
    }
}
