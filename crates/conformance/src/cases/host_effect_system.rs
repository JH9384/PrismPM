//! SY-09: host-effect service system, loopback Compose projection, locked oracle.

use std::collections::BTreeSet;
use std::path::Path;
use std::process::Command;

pub(super) fn verify(root: &Path) {
    let output = Command::new("cargo")
        .current_dir(root)
        .args([
            "test",
            "--locked",
            "--offline",
            "-p",
            "prismpm",
            "--lib",
            "host_effect_system_",
            "--",
            "--nocapture",
            "--test-threads=1",
        ])
        .output()
        .expect("host-effect system owning tests execute");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 owning stdout");
    let stderr = String::from_utf8(output.stderr).expect("UTF-8 owning stderr");
    assert!(output.status.success(), "{stdout}\n{stderr}");
    let actual = stdout
        .lines()
        .filter_map(|line| {
            line.strip_prefix("test ")
                .and_then(|line| line.strip_suffix(" ... ok"))
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        actual,
        BTreeSet::from([
            "controller::release_tests::host_effect_system_named_release_selects_and_binds_its_source",
            "authority::tests::host_effect_system_compose_passes_the_locked_oracle",
            "system::host_effect::tests::host_effect_system_compose_publishes_loopback_only",
            "system::host_effect::tests::host_effect_system_contract_is_registered_and_closed",
            "system::host_effect::tests::host_effect_system_refuses_every_non_loopback_port_binding",
            "system::host_effect::tests::host_effect_system_refuses_open_or_inconsistent_declarations",
            "system::host_effect::tests::host_effect_system_validates_the_loopback_example_and_binds_its_manifest",
        ])
    );
    assert!(
        stdout.contains("test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured;"),
        "{stdout}"
    );
    assert_eq!(
        stdout
            .lines()
            .filter(|line| line.starts_with("test result:"))
            .count(),
        1
    );
}
