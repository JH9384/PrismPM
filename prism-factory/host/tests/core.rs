//! Differential and behavioral checks of the certified factory core through
//! the host. The kernel proves the routing and graph theorems in the model;
//! these hold the byte-level parts the kernel cannot evaluate (SHA-256 over
//! `Bytes`, the text protocol) against an independent oracle.

use prism_factory_host::{delegate, plan, reweigh, workflow};

fn planned(request: &str) -> String {
    String::from_utf8(plan(request.as_bytes()).expect("no overflow")).expect("UTF-8")
}

fn route<'a>(plan: &'a str, name: &str) -> (&'a str, &'a str) {
    let prefix = format!("obligation {name} ");
    let line = plan.lines().find(|line| line.starts_with(&prefix)).expect("obligation in plan");
    let mut rest = line[prefix.len()..].split(' ');
    (rest.next().unwrap(), rest.next().unwrap())
}

const TREE: &str = "tree 100644:aaaa prism-factory/x\ntree 100644:bbbb docs/x.md\ntree 100644:cccc scripts/release-phases.mjs\n";

fn with(tree: &str, extra: &str) -> String {
    planned(&format!("{tree}{extra}"))
}

#[test]
fn identity_matches_an_independent_sha256() {
    // sha256 of the identity text of `factory-model` over TREE, computed with
    // Python's hashlib from the format in prism-factory/README.md:
    //   closure = sha256("file 100644:aaaa prism-factory/x\n")
    //   identity = sha256("prism-factory/obligation/1\nname factory-model\n...closure <closure>\n")
    let plan = planned(TREE);
    assert_eq!(route(&plan, "factory-model"), ("observe", "ff9493b7faff48e73275349edf0e6e545f1e4ff525a1f8550d62c16b08ab22f0"));
}

#[test]
fn a_change_outside_the_closure_keeps_the_identity() {
    let before = planned(TREE);
    let after = planned(&TREE.replace("bbbb docs", "dddd docs"));
    assert_eq!(route(&before, "factory-model").1, route(&after, "factory-model").1);
    // Source V&V and the build read docs/ too, so they change, and so does every dependent.
    for name in ["source-vv", "build", "gate", "release"] {
        assert_ne!(route(&before, name).1, route(&after, name).1, "{name}");
    }
}

#[test]
fn the_plumbing_is_outside_source_vv_and_the_build_reads_only_its_own() {
    let before = planned(TREE);
    // prism-factory/ is release plumbing: the factory model changes, source V&V does not.
    let factory = planned(&TREE.replace("aaaa prism-factory", "abcd prism-factory"));
    assert_ne!(route(&before, "factory-model").1, route(&factory, "factory-model").1);
    assert_eq!(route(&before, "source-vv").1, route(&factory, "source-vv").1);
    assert_eq!(route(&before, "build").1, route(&factory, "build").1);
    // release-phases.mjs is plumbing the build executes: a longer include wins over the exclusion.
    let phases = planned(&TREE.replace("cccc scripts", "cdef scripts"));
    assert_eq!(route(&before, "source-vv").1, route(&phases, "source-vv").1);
    assert_ne!(route(&before, "build").1, route(&phases, "build").1);
}

#[test]
fn a_context_reaches_only_the_obligations_that_declare_it() {
    let rehearsal = with(TREE, "tree context:rehearsal @mode\ntree context:7-1 @run\n");
    let publish = with(TREE, "tree context:publish @mode\ntree context:7-1 @run\n");
    let again = with(TREE, "tree context:rehearsal @mode\ntree context:8-1 @run\n");
    // Whole-source obligations read "" but never a context.
    for name in ["vv-sdk", "source-vv", "build", "factory-model"] {
        assert_eq!(route(&rehearsal, name).1, route(&publish, name).1, "{name}");
        assert_eq!(route(&rehearsal, name).1, route(&again, name).1, "{name}");
    }
    // A tag publishes what a rehearsal of the same tree proved, and re-runs only these.
    for name in ["policy", "oci-native", "crates", "release"] {
        assert_ne!(route(&rehearsal, name).1, route(&publish, name).1, "{name}");
    }
    for name in ["policy", "plumbing", "gate", "oci-native", "crates", "release"] {
        assert_ne!(route(&rehearsal, name).1, route(&again, name).1, "{name} attests its own run");
    }
}

#[test]
fn receipts_route_by_kind() {
    let first = planned(TREE);
    let sdk = route(&first, "vv-sdk").1.to_string();
    let policy = route(&first, "policy").1.to_string();
    let model = route(&first, "factory-model").1.to_string();
    let passed = with(TREE, &format!("receipt {sdk} pass\nreceipt {model} pass\n"));
    assert_eq!(route(&passed, "vv-sdk").0, "proved");
    assert_eq!(route(&passed, "factory-model").0, "proved");
    // source-vv waits for vv-sdk; with vv-sdk proved it is observed.
    assert_eq!(route(&first, "source-vv").0, "blocked");
    assert_eq!(route(&passed, "source-vv").0, "observe");
    let failed = with(TREE, &format!("receipt {sdk} fail\nreceipt {policy} fail\n"));
    // A fetch reaches the network, so a failure is observed again; a hermetic
    // failure on the same inputs is refuted and not re-run.
    assert_eq!(route(&failed, "vv-sdk").0, "observe");
    assert_eq!(route(&failed, "policy").0, "refuted");
    assert!(failed.contains("releasable no"));
}

#[test]
fn a_cut_needs_exactly_the_run_independent_receipts() {
    // The cut asks the plan in mode `publish`: it may proceed once the model,
    // the V&V SDK, source V&V and the build are proved, while the policy, the
    // gate and publication (which read the mode or the run) still have to run.
    let context = "tree context:publish @mode\ntree context:cut @run\n";
    let first = with(TREE, context);
    assert!(first.contains("cuttable no"));
    let mut receipts = String::new();
    let mut plan = first.clone();
    for name in ["factory-model", "vv-sdk", "source-vv", "build"] {
        receipts.push_str(&format!("receipt {} pass\n", route(&plan, name).1));
        plan = with(TREE, &format!("{context}{receipts}"));
        let done = name == "build";
        assert_eq!(plan.contains("cuttable yes"), done, "{name}");
    }
    assert!(plan.contains("releasable no"));
    for name in ["policy", "gate", "oci-native", "crates", "release"] {
        assert_ne!(route(&plan, name).0, "proved", "{name}");
    }
}

#[test]
fn the_cut_workflow_is_the_models() {
    let cut = String::from_utf8(workflow(b"cut").unwrap()).expect("UTF-8");
    assert!(cut.starts_with("# Generated by the Prism factory from prism-factory/model/src/Factory/Workflow.lex.tex.\n"));
    assert!(cut.contains("name: Release cut\n"));
    assert!(cut.contains("    workflows: [PrismPM OCI/native and Cargo publication]\n"));
    assert!(cut.ends_with("        run: bash prism-factory/factory.sh actions-cut\n"));
}

#[test]
fn only_observed_host_obligations_carry_their_files() {
    let plan = planned(TREE);
    assert!(plan.contains("file factory-model prism-factory/x\n"));
    assert!(!plan.contains("file factory-model docs/x.md"));
    assert!(!plan.lines().any(|line| line.starts_with("file source-vv ")));
}

#[test]
fn the_schedule_follows_learned_priority() {
    let plan = with(TREE, "weight factory-model 9\n");
    let order: Vec<&str> = plan.lines().filter_map(|line| line.strip_prefix("schedule ")).collect();
    assert_eq!(order.first(), Some(&"factory-model"));
}

#[test]
fn reweighing_raises_failures_and_lowers_passes() {
    let out = String::from_utf8(reweigh(b"weight gate 4\noutcome gate fail\noutcome vv-sdk pass\n").unwrap()).unwrap();
    assert!(out.contains("weight gate 6\n"));
    assert!(out.contains("weight vv-sdk 3\n"));
    assert!(out.contains("weight release 4\n"));
}

#[test]
fn the_committed_pull_request_workflow_is_the_projection() {
    assert_eq!(workflow(b"").unwrap(), include_bytes!("../../../.github/workflows/factory.yml"));
}

#[test]
fn the_release_skeleton_places_every_job_once_in_the_model_order() {
    let skeleton = String::from_utf8(workflow(b"release").unwrap()).unwrap();
    let placed: Vec<&str> = skeleton
        .lines()
        .filter_map(|line| line.strip_prefix("#fragment ").or_else(|| (line == "  factory:").then_some("factory")))
        .collect();
    assert_eq!(
        placed,
        [
            "header", "policy", "factory", "devcontainer-image", "vv-sdk", "source-vv", "gate", "image-platforms", "images",
            "reproducibility", "installed-sdk", "native", "oci-native", "crates", "release"
        ]
    );
    assert!(skeleton.contains("            source-vv ${{ needs.source-vv.result }} ${{ needs.gate.result }}\n"));
    assert!(skeleton.ends_with("        run: bash prism-factory/factory.sh actions-receipts\n"));
}

const FORGE: &str = "UOR-Foundation/PrismPM/.github/workflows/prism-delegation.yml";

fn delegated(extra: &str) -> String {
    let request = format!("{TREE}trust-repository {FORGE}\nevent pull_request\n{extra}");
    String::from_utf8(delegate(request.as_bytes()).expect("no overflow")).expect("UTF-8")
}

fn kappa_of(plan: &str, name: &str) -> String {
    route(plan, name).1.to_string()
}

#[test]
fn a_request_establishes_only_the_carried_obligation_until_a_trusted_receipt_counts() {
    let open = delegated("");
    let established: Vec<&str> = open.lines().filter(|line| line.starts_with("establish ")).collect();
    assert_eq!(
        established,
        ["establish factory-model", "establish lint", "establish model-audits", "establish fixtures-golden"]
    );
    assert!(open.ends_with("check pending\n"));
    // The delegated identity carries the sandbox, so it differs from the plain plan's.
    let kappa = kappa_of(&open, "factory-model");
    assert_ne!(kappa, route(&planned(TREE), "factory-model").1);

    let passed = delegated(&format!("signed factory-model {kappa} pass workflow runner {FORGE}\n"));
    assert_eq!(route(&passed, "factory-model").0, "proved");
    assert!(!passed.contains("establish factory-model\n"));
    // The pull request checks still have no receipt, so the check waits for them.
    assert!(passed.ends_with("check pending\n"));
    let mut all = String::new();
    for name in ["factory-model", "lint", "model-audits", "fixtures-golden"] {
        let kappa = kappa_of(&passed, name);
        all.push_str(&format!("signed {name} {kappa} pass workflow runner {FORGE}\n"));
    }
    let complete = delegated(&all);
    assert!(!complete.contains("establish "));
    assert!(complete.ends_with("check success\n"));

    let failed = delegated(&format!("signed factory-model {kappa} fail workflow runner {FORGE}\n"));
    assert_eq!(route(&failed, "factory-model").0, "refuted");
    assert!(failed.ends_with("check failure\n"));
}

#[test]
fn a_receipt_from_another_workflow_or_for_other_content_never_counts() {
    let kappa = kappa_of(&delegated(""), "factory-model");
    for extra in [
        format!("signed factory-model {kappa} pass workflow runner fork/PrismPM/.github/workflows/prism-delegation.yml\n"),
        format!("signed factory-model {} pass workflow runner {FORGE}\n", "0".repeat(64)),
        format!("signed factory-model {kappa} pass anyone runner {FORGE}\n"),
    ] {
        let plan = delegated(&extra);
        assert!(plan.contains("establish factory-model\n"), "{extra}");
        assert!(plan.ends_with("check pending\n"), "{extra}");
    }
}

#[test]
fn the_pull_request_checks_read_the_whole_tree_and_the_factory_model_keeps_its_closure() {
    // The pull request checks read the whole tree, so any change re-identifies them;
    // the release obligations keep their own closures.
    let before = delegated("");
    let after = String::from_utf8(
        delegate(format!("{}trust-repository {FORGE}\nevent pull_request\n", TREE.replace("bbbb docs", "dddd docs")).as_bytes())
            .expect("no overflow"),
    )
    .expect("UTF-8");
    for name in ["lint", "model-audits", "fixtures-golden"] {
        assert_ne!(kappa_of(&before, name), kappa_of(&after, name), "{name}");
    }
    assert_eq!(kappa_of(&before, "factory-model"), kappa_of(&after, "factory-model"));
}

#[test]
fn a_counted_failure_of_a_fetch_obligation_fails_the_check_and_is_established_again() {
    // model-audits fetches, so a failure is observed again rather than taken as
    // a refutation, but the check it reports is a failure, never pending.
    let kappa = kappa_of(&delegated(""), "model-audits");
    let plan = delegated(&format!("signed model-audits {kappa} fail workflow runner {FORGE}\n"));
    assert_eq!(route(&plan, "model-audits").0, "observe");
    assert!(plan.contains("status model-audits failure\n"));
    assert!(plan.contains("establish model-audits\n"));
    assert!(plan.ends_with("check failure\n"));
    // A later pass for the same identity outweighs it.
    let later = delegated(&format!(
        "signed model-audits {kappa} fail workflow runner {FORGE}\nsigned model-audits {kappa} pass workflow runner {FORGE}\n"
    ));
    assert!(later.contains("status model-audits success\n"));
}
