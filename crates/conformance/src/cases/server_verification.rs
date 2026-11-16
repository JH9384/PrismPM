//! HO-39 to HO-42: the verification of a server application, the exercise of
//! every declared effect, its build bound and its source-free release replay;
//! CT-13: the LexLean build root of the controller.

use super::server_serving::{require, run};
use std::path::Path;

/// HO-39: `prismpm verify` of the example server, and its refusals.
pub(super) fn verify_verify(root: &Path) {
    let library = run(root, "HO-39", &["--lib", "server_host::verify_tests"]);
    require(
        "HO-39",
        &library,
        &[
            "a_replayed_vector_with_a_wrong_effect_result_is_refused",
            "a_served_exchange_whose_response_differs_is_refused",
            "a_workspace_without_the_declared_binding_or_its_lock_is_refused",
            "host_packages_equal_to_their_regeneration_are_accepted",
            "host_packages_that_differ_from_their_regeneration_are_refused",
            "staging_lays_the_consumers_files_beside_the_build_and_nothing_else",
        ],
    );
    let contract = run(root, "HO-39", &["--test", "server_verification"]);
    require(
        "HO-39",
        &contract,
        &["verify_of_the_example_server_runs_the_application_acceptance"],
    );
}

/// HO-40: every declared effect is exercised, as observed.
pub(super) fn verify_exercise(root: &Path) {
    let library = run(root, "HO-40", &["--lib", "server_host::exercise_tests"]);
    require(
        "HO-40",
        &library,
        &[
            "a_core_effect_no_vector_reaches_is_refused_with_pp2021",
            "a_frame_effect_no_served_exchange_reaches_is_refused_with_pp2021",
            "the_record_names_every_effect_with_what_reached_it",
        ],
    );
}

/// HO-41: the build bound of the verification is model data.
pub(super) fn verify_build_bound(root: &Path) {
    let contract = run(root, "HO-41", &["--test", "server_application_contract"]);
    require(
        "HO-41",
        &contract,
        &["a_verification_build_bound_outside_its_range_is_refused"],
    );
    let library = run(root, "HO-41", &["--lib", "server_host::verify_tests"]);
    require(
        "HO-41",
        &library,
        &["the_workspace_build_runs_under_the_declared_bound"],
    );
}

/// HO-42: a server application is released and replayed without its source.
pub(super) fn verify_release_replay(root: &Path) {
    let contract = run(root, "HO-42", &["--test", "server_release"]);
    require(
        "HO-42",
        &contract,
        &[
            "a_released_server_application_is_checked_and_replayed_without_its_source",
            "a_tampered_released_core_package_is_refused",
            "a_tampered_released_host_package_is_refused",
            "a_tampered_released_consumer_workspace_is_refused",
            "recorded_bounds_that_differ_from_the_model_are_refused",
            "a_release_without_the_acceptance_evidence_is_refused",
            "a_replay_of_a_release_that_is_not_a_server_application_is_refused",
            "the_retired_diagnostic_is_not_registered",
        ],
    );
    let library = run(root, "HO-42", &["--lib", "server_release::tests"]);
    require(
        "HO-42",
        &library,
        &["a_release_in_a_receiver_without_the_source_is_replayed_by_reference"],
    );
}

/// CT-13: the controller reads the build root from `lexlean.toml`.
pub(super) fn verify_build_root(root: &Path) {
    let library = run(root, "CT-13", &["--lib", "controller::model_worker"]);
    require(
        "CT-13",
        &library,
        &["the_build_root_is_read_from_lexlean_toml"],
    );
    let contract = run(root, "CT-13", &["--test", "controller_build_root"]);
    require(
        "CT-13",
        &contract,
        &[
            "a_project_with_another_build_root_builds_through_it",
            "a_lexlean_toml_without_a_build_root_is_refused",
        ],
    );
}
