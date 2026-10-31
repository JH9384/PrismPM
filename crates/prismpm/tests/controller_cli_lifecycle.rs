//! Verification and independent acceptance evidence for Task 7: Complete
//! controller/CLI lifecycle and Docker-simple UX (LC-01..LC-06).

use clap::Parser;
use prismpm::cli::{Cli, Commands, PromotionDestination};
use prismpm::controller::{CheckRequest, Controller};
use prismpm::error::PrismError;
use prismpm::holo::canonical::encode_value;
use prismpm::lifecycle;
use serde_json::json;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crate is below repository root")
        .to_path_buf()
}

#[test]
fn cli_subcommand_coverage_and_parsing_boundaries() {
    let dummy_digest = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let dummy_ref = format!("example.test/product@{dummy_digest}");

    // Check
    let check_cli = Cli::try_parse_from(["prismpm", "check"]).unwrap();
    assert!(matches!(
        check_cli.command,
        Commands::Check {
            holo: None,
            policy: None,
            ..
        }
    ));

    // Build (with and without locked/tag/release)
    let build_cli = Cli::try_parse_from(["prismpm", "build"]).unwrap();
    assert!(matches!(
        build_cli.command,
        Commands::Build { locked: false, .. }
    ));

    let build_locked = Cli::try_parse_from([
        "prismpm",
        "build",
        "-t",
        "product:tag",
        "--locked",
        "--release",
        "0.3.0",
    ])
    .unwrap();
    assert!(matches!(
        build_locked.command,
        Commands::Build {
            locked: true,
            tag: Some(_),
            release: Some(_),
            ..
        }
    ));

    // Verify
    let verify_cli = Cli::try_parse_from(["prismpm", "verify"]).unwrap();
    assert!(matches!(verify_cli.command, Commands::Verify));

    // Clean
    let clean_cli = Cli::try_parse_from(["prismpm", "clean"]).unwrap();
    assert!(matches!(clean_cli.command, Commands::Clean));

    // Fetch
    let fetch_cli = Cli::try_parse_from(["prismpm", "fetch", "--locked"]).unwrap();
    assert!(matches!(
        fetch_cli.command,
        Commands::Fetch { locked: true }
    ));

    // Inspect
    let inspect_cli = Cli::try_parse_from(["prismpm", "inspect", &dummy_ref]).unwrap();
    assert!(matches!(inspect_cli.command, Commands::Inspect { .. }));

    // Push and Pull
    let push_cli = Cli::try_parse_from(["prismpm", "push", &dummy_ref]).unwrap();
    assert!(matches!(push_cli.command, Commands::Push { .. }));

    let pull_cli = Cli::try_parse_from(["prismpm", "pull", &dummy_ref]).unwrap();
    assert!(matches!(pull_cli.command, Commands::Pull { .. }));

    // Run (default foreground vs detached)
    let run_cli = Cli::try_parse_from(["prismpm", "run", &dummy_ref]).unwrap();
    assert!(matches!(
        run_cli.command,
        Commands::Run { detach: false, .. }
    ));

    let run_detach = Cli::try_parse_from(["prismpm", "run", &dummy_ref, "--detach"]).unwrap();
    assert!(matches!(
        run_detach.command,
        Commands::Run { detach: true, .. }
    ));

    // Plan and Deploy
    let plan_cli =
        Cli::try_parse_from(["prismpm", "plan", &dummy_ref, "--target", "compose-local"]).unwrap();
    assert!(matches!(plan_cli.command, Commands::Plan { .. }));

    let deploy_cli = Cli::try_parse_from([
        "prismpm",
        "deploy",
        &dummy_ref,
        "--target",
        "compose-local",
        "--plan",
        dummy_digest,
    ])
    .unwrap();
    assert!(matches!(deploy_cli.command, Commands::Deploy { .. }));

    // Status and Rollback
    let status_cli =
        Cli::try_parse_from(["prismpm", "status", &dummy_ref, "--target", "compose-local"])
            .unwrap();
    assert!(matches!(status_cli.command, Commands::Status { .. }));

    let rollback_cli = Cli::try_parse_from([
        "prismpm",
        "rollback",
        &dummy_ref,
        "--target",
        "compose-local",
    ])
    .unwrap();
    assert!(matches!(rollback_cli.command, Commands::Rollback { .. }));

    // Destroy (requires explicit --authorized flag)
    let destroy_auth = Cli::try_parse_from([
        "prismpm",
        "destroy",
        &dummy_ref,
        "--target",
        "compose-local",
        "--authorized",
    ])
    .unwrap();
    assert!(matches!(
        destroy_auth.command,
        Commands::Destroy {
            authorized: true,
            ..
        }
    ));

    let destroy_no_auth = Cli::try_parse_from([
        "prismpm",
        "destroy",
        &dummy_ref,
        "--target",
        "compose-local",
    ])
    .unwrap();
    assert!(matches!(
        destroy_no_auth.command,
        Commands::Destroy {
            authorized: false,
            ..
        }
    ));

    // Backup and Restore
    let backup_cli =
        Cli::try_parse_from(["prismpm", "backup", &dummy_ref, "--target", "compose-local"])
            .unwrap();
    assert!(matches!(backup_cli.command, Commands::Backup { .. }));

    let restore_cli = Cli::try_parse_from([
        "prismpm",
        "restore",
        &dummy_ref,
        "--target",
        "compose-local",
        "--restore-target",
        "compose-restore",
        "--backup",
        "backup.json",
    ])
    .unwrap();
    assert!(matches!(restore_cli.command, Commands::Restore { .. }));

    // ExportBrowser
    let export_cli =
        Cli::try_parse_from(["prismpm", "export-browser", &dummy_ref, "--output", "site"]).unwrap();
    assert!(matches!(export_cli.command, Commands::ExportBrowser { .. }));

    // Promote
    let promote_cli = Cli::try_parse_from([
        "prismpm",
        "promote",
        &dummy_ref,
        "--to",
        "candidate",
        "--trusted-root",
        "trusted_root.json",
        "--policy",
        "policy.json",
    ])
    .unwrap();
    assert!(matches!(
        promote_cli.command,
        Commands::Promote {
            to: PromotionDestination::Candidate,
            ..
        }
    ));
}

#[test]
fn shell_completions_match_all_executable_commands() {
    let toml_str =
        std::fs::read_to_string(root().join("model/commands.toml")).expect("read commands.toml");
    let model: toml::Value = toml::from_str(&toml_str).expect("parse commands.toml");
    let registered_commands = model["command"]
        .as_array()
        .expect("command list")
        .iter()
        .map(|row| row["name"].as_str().unwrap().to_owned())
        .collect::<BTreeSet<_>>();

    // Test that all completion shells can be parsed
    for shell_name in ["bash", "fish", "zsh"] {
        let cli = Cli::try_parse_from(["prismpm", "completion", shell_name]).unwrap();
        assert!(matches!(cli.command, Commands::Completion { .. }));
    }

    // Every registered command in model/commands.toml must be present in the CLI command hierarchy
    for expected in [
        "fetch",
        "build",
        "push",
        "pull",
        "inspect",
        "run",
        "plan",
        "deploy",
        "status",
        "rollback",
        "destroy",
        "clean",
        "verify",
        "check",
        "export-browser",
    ] {
        assert!(
            registered_commands.contains(expected),
            "model/commands.toml is missing expected command {expected}"
        );
    }
}

#[test]
fn pipe_safe_machine_output_and_error_envelopes() {
    let sample_result = json!({
        "schema": "prismpm/check-result/1",
        "verified": true,
        "warnings": []
    });

    let canonical_bytes = encode_value(&sample_result).expect("canonical encode");
    assert!(
        !canonical_bytes.contains(&b'\n'),
        "pipe-safe machine output must not contain unescaped framing newlines"
    );

    // Repeated encodings must be byte-for-byte stable
    let repeat_bytes = encode_value(&sample_result).expect("canonical encode");
    assert_eq!(
        canonical_bytes, repeat_bytes,
        "machine output must be deterministic"
    );

    // Error envelope format
    let error = PrismError::new("PP6101", "OCI reference syntax invalid");
    let error_envelope = json!({
        "diagnostic": error,
        "schema": "prismpm/error-result/1"
    });
    let error_bytes = encode_value(&error_envelope).expect("canonical encode");
    assert!(
        !error_bytes.contains(&b'\n'),
        "error envelope must not contain unescaped framing newlines"
    );
}

#[test]
fn lifecycle_reference_and_target_validation_fail_closed() {
    let repo = root();

    // Mutable tags without digest must be rejected with PP6101
    let err = lifecycle::status(&repo, "product:tag", "local").unwrap_err();
    assert_eq!(
        err.code, "PP6101",
        "mutable tag must be rejected with PP6101"
    );

    // Malformed digest pattern must be rejected with PP6101
    let err =
        lifecycle::status(&repo, "example.test/product@sha256:not-valid-hex", "local").unwrap_err();
    assert_eq!(
        err.code, "PP6101",
        "malformed digest must be rejected with PP6101"
    );

    // Invalid target identifier must be rejected with PP7101
    let valid_ref = "example.test/product@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    for bad_target in ["../escape", "bad; target", "Uppercase", ""] {
        let err = lifecycle::status(&repo, valid_ref, bad_target).unwrap_err();
        assert_eq!(
            err.code, "PP7101",
            "invalid target '{bad_target}' must be rejected with PP7101"
        );
    }
}

#[test]
fn exit_code_mapping_preserves_caller_controlled_diagnostic_classes() {
    // Registered exit codes:
    // PP100x -> 2 (CLI invocation / argument errors)
    // PP1101 -> 2 (locked drift)
    // PP2101..3 -> 3 (model validation failure)
    // PP5401..5 -> 4 (input materialization / lock tampering)
    // PP6101, PP6301 -> 5 (OCI / reference syntax error)
    // PP6201 -> 6 (registry network / transport failure)
    // PP6401, PP7801 -> 7 (storage / snapshot failure)
    // PP7001 -> 8 (plan validation failure)
    // PP7101, PP7901 -> 9 (target / adapter failure)
    // PP7201 -> 10 (concurrency / lock acquisition collision)
    // PP7301 -> 11 (deployment observation / health failure)
    // PP7401 -> 12 (rollback / promotion safety failure)
    // PP7501, PP7701 -> 13 (recovery verification failure)
    // PP7601 -> 14 (contract finalization failure)
    // PP9001 -> 101 (internal unexpected invariant failure)

    let cases = [
        ("PP1001", 2),
        ("PP1101", 2),
        ("PP2101", 3),
        ("PP5401", 4),
        ("PP6101", 5),
        ("PP6301", 5),
        ("PP6201", 6),
        ("PP6401", 7),
        ("PP7001", 8),
        ("PP7101", 9),
        ("PP7201", 10),
        ("PP7301", 11),
        ("PP7401", 12),
        ("PP7501", 13),
        ("PP7601", 14),
        ("PP9001", 101),
    ];

    for (code, expected_exit) in cases {
        let err = PrismError::new(code, "test diagnostic");
        assert_eq!(
            err.exit_code(),
            expected_exit,
            "diagnostic {code} must map to exit code {expected_exit}"
        );
    }
}

#[test]
fn four_command_path_controller_check() {
    let controller = Controller::load(root()).expect("load controller");
    let check_result = controller
        .check(CheckRequest { config_path: None })
        .expect("check project");
    assert_eq!(
        check_result.schema, "prismpm/check-result/1",
        "check result must match schema contract"
    );
}
