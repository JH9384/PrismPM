# Prism Factory

The factory decides, for every obligation of a release, whether it is already
proved, must run, is refuted, or is blocked, and in what order to run what is
left. Those decisions are a Prism model checked by the Lean kernel and exported
by LexLean to certified Rust. Everything else is a thin host. The same certified
core runs on a laptop, on any CI runner, and in a browser (GitHub Pages).

GitHub Actions is only one place the host runs. It supplies a runner, a checkout
and a branch for receipts. It decides nothing.

## Why

From 2026-10-31 to 2026-11-10, `release.yml` ran 15 times on `release/v0.4`.
None of the runs passed, and together they took about 190 hours. Two causes
recur. Each fix invalidated whole stages, and each of the eight source V&V parts
rebuilt the SDK image for itself, so one 5xx from the Ubuntu snapshot failed a
part after an hour (run 42828359377 lost four parts this way).

The factory keys each obligation of the release on its own declared inputs,
builds the V&V SDK image once as its own retried obligation, and lets a tag
re-run only the stages that depend on the release mode. The routes are decided
by the certified core in every place it runs, including the release run itself.

## Layout

| Path | What it is |
| --- | --- |
| `model/src/Factory/Engine.lex.tex` | Obligations, identity, closures, routing, priority, and their theorems |
| `model/src/Factory/PrismPM.lex.tex` | The v0.4 release as 10 obligations, the jobs that carry each out, theorems over them |
| `model/src/Factory/Workflow.lex.tex` | The model-owned workflow text: the factory job, the receipts job, `factory.yml` |
| `model/src/Factory.lex.tex` | The production roots `plan`, `reweigh`, `workflow` and their text protocol |
| `jobs/` | The body of each release job; `release.yml` is the model's skeleton with these placed in it |
| `std/` | LexLean's standard library (`Buffer`, `Sha256`, `Text`), byte-identical to LexLean `e0b74b81` `stdlib/` |
| `certified/` | The production bundle: certified Rust packages, certificates, attestation |
| `host/` | The thin host: CLI (`prism-factory`), the Actions adapter, WebAssembly ABI, tests |
| `site/index.html` | The GitHub Pages page that runs the wasm core |
| `factory.sh`, `check.sh` | Entry points for a laptop or CI, and the `factory-model` obligation |
| `../.github/workflows/release.yml`, `factory.yml` | Generated. `check.sh` refuses drift |

## The release graph

| Obligation | Kind | Reads | Carried out by |
| --- | --- | --- | --- |
| `policy` | hermetic | release contracts, `@mode`, `@run` | `policy` |
| `factory-model` | hermetic, host | `prism-factory/`, `vendor/lexlean/`, both workflows | the `factory` job, hermetically |
| `plumbing` | hermetic | everything, `@run` | `devcontainer-image` |
| `vv-sdk` | fetch | the source without the plumbing, its job | `vv-sdk` |
| `source-vv` | fetch | the source without the plumbing, and `vv-sdk` | `source-vv` (8 parts) and `gate` |
| `build` | fetch | the source without the plumbing, the build plumbing and jobs | `image-platforms`, `images`, `reproducibility`, `installed-sdk`, `native` |
| `gate` | hermetic | everything, `@run` | `gate` |
| `oci-native`, `crates`, `release` | fetch | everything, `@mode`, `@run` | their jobs |

`@mode` (`rehearsal` or `publish`) and `@run` (the run id and attempt) are
contexts: they enter only the obligations that declare them, never a plain
prefix. So a tag of a rehearsed commit proves `vv-sdk`, `source-vv` and
`build` from the rehearsal's receipts and runs only the policy, the plumbing
checks, the gate and publication. The release plumbing (the list in
`scripts/factory.mjs`, plus `prism-factory/`) is excluded from source V&V and from
the build, except the three plumbing scripts the build executes and its own
job fragments, which a longer inclusion brings back.

## What the kernel proves

- **Routing.** A passing receipt proves its identity. A hermetic failure is
  refuted and not re-run on the same inputs. A failed fetch is observed again,
  because the network is not an input. A later pass outweighs an earlier
  failure. An obligation whose upstream is not proved is blocked, even when it
  has its own receipt.
- **Priority.** Weights are a 16-level type, so out-of-range weights can't be
  represented. A failure never lowers priority and a pass never raises it.
  Routing takes no weight: priority changes only the order.
- **The release graph.** Names are distinct. Every need is declared before it
  is needed, so the graph is acyclic. Every obligation declares its inputs and
  its run, and is carried out by named jobs, each named once in the workflow.
  No obligation is arbitrary: each one is needed, directly or transitively, by
  `release`. The theorems also record that 9 of the 10 obligations still run on
  the Actions adapter, 8 read the whole source, only the policy and the three
  publication stages depend on the release mode, and six stages attest their
  own run.

The kernel can't evaluate `Bytes` equality, so SHA-256 and the text protocol
are held by a differential instead. `host/tests/core.rs` checks an identity
against Python's `hashlib`, byte for byte, the same way LexLean's stdlib holds
its byte functions.

## Identity

An obligation's identity is the SHA-256 (in hex) of:

```text
prism-factory/obligation/1
name <name>
kind hermetic|fetch
environment <environment>
run <run>
input <prefix>                 one line per declared input, in order (`!prefix` excludes, `@key` is a context)
needs <name> <identity>        one line per need, in order
closure <sha256 of the closure>
```

The closure is one line `file <mode>:<object> <path>` for each tracked entry
covered by the declared inputs, in Git tree order, then one line
`file context:<value> @<key>` for each context it declares. An entry is covered
when the longest inclusion it starts with is longer than the longest exclusion
(`!prefix`) it starts with; a context `@key` is reached only by an input that
starts with `@`. Changing a file,
an input, the command, the environment or any upstream identity changes the
identity. Nothing else does.

## Cutting a release

A release is one decision, merging the release-please pull request, and the
rest is the factory's:

1. `release-please` (mode `open-pr`) opens the release pull request: the
   workspace version in `Cargo.toml` and the changelog entry. Merging it
   bumps `main`. release-please tags only the npm packages; the root package
   sets `skip-github-release`, because its tag is the cut's.
2. Dispatch `release.yml` on `main` (or push `release/vMAJOR.MINOR`). Every
   branch run is a rehearsal: it establishes each obligation and records a
   receipt for it. `scripts/release-phases.mjs` holds every ref to the workspace
   version (`main`, `release/vMAJOR.MINOR`, the tag `vVERSION`).
3. When that run passes, `release-cut.yml` (generated from `Workflow.lex.tex`)
   asks the certified plan about the rehearsed commit in mode `publish`. It cuts
   only when the plan says `cuttable yes`: every obligation that reads neither
   the release mode nor the run (`factory-model`, `vv-sdk`, `source-vv`,
   `build`; the theorem
   `a_cut_rests_only_on_the_model_the_vv_sdk_the_source_vv_and_the_build`
   pins that set) has a passing receipt. For a `.0` release, the open milestone
   that names `vMAJOR.MINOR` must also have no open issue.
4. The cut creates the annotated tag `vVERSION` at the rehearsed commit and its
   GitHub Release (body: the changelog entry), dispatches `release.yml` at the
   tag, and closes the milestone. That run proves the build and source V&V from
   the rehearsal's receipts, so it runs only the policy, the gate and
   publication, about an hour.

The tag is created with `GITHUB_TOKEN`, which starts no workflow, so the cut
dispatches the publication run itself; its signatures name
`release.yml@refs/tags/vVERSION` like a tag push does. A pushed tag still
publishes too.

## Running it

```sh
prism-factory/factory.sh plan --context mode=rehearsal --context run=local   # the certified plan for HEAD
prism-factory/factory.sh run                # run every `observe` obligation of environment `host`
prism-factory/factory.sh request > r.txt    # the request, to plan offline (`plan-request`) or in the page
prism-factory/factory.sh site out/          # the Pages site: index.html + factory.wasm
```

`run` copies each obligation's closure, and nothing else, into a fresh
directory outside any repository and runs it there. An undeclared input
therefore fails the run instead of producing a false receipt. The plan is
repeated until it reaches a fixed point, and a second run on the same tree
runs nothing.

In a release run, the `factory` job runs the host obligations and then
`actions-route`: the certified plan, iterated to its fixed point with every
runnable obligation assumed to pass, becomes the job outputs. An obligation
proved by a receipt is skipped and its evidence is downloaded from the run that
proved it. Any obligation that is refuted or blocked stops the run there. The
`receipts` job appends a receipt for each obligation the run established to the
`factory-receipts` branch, with the run that holds its evidence (receipts expire
a day before that evidence does), and reweighs the schedule by what passed and
failed. `gate` writes `factory-route.json` (schema `prismpm/factory-route/3`)
with `route-record`, which checks every receipt against the identities again.

The page takes a repository and a revision. It reads the tree from the GitHub
API and the receipts from the `factory-receipts` branch, and plans in the
browser in about 0.2 s. It also accepts a request file. To publish it, set
Pages to deploy from GitHub Actions, set the repository variable
`FACTORY_PAGES` to `true`, and run the Factory workflow by hand.

## Changing the model

```sh
cd prism-factory/model
lexlean verify --all                                         # kernel-check every theorem
lexlean production build --request ../production-request.json
rm -rf ../certified && cp -r .lexlean/production/<result> ../certified
cd ../host && cargo test --release
./target/release/prism-factory workflow --name factory --write ../../.github/workflows/factory.yml
./target/release/prism-factory workflow --name release --jobs ../jobs --write ../../.github/workflows/release.yml
```

`check.sh` (the `factory-model` obligation) replays the bundle without Lean.
Where the pinned Lean is installed, it also re-verifies the model and requires
the re-export to equal `certified/`.

## Delegation: GitHub as the forge, Prism on every peer

`model/src/Factory/Delegation.lex.tex` models the next relationship with
GitHub. Nothing in it is a hosted server. The model follows the approach of
Prism AI Foundry (build anywhere, verify locally) and Stitch (exact objects
kept by whichever peers are present). GitHub is the *forge*. It triggers a run,
computes each obligation's identity with the certified core, verifies
receipts and reports the check. *Peers* do the work: a runner the forge lends
(the PrismPM Action in the immutable SDK image, so no toolchain is rebuilt)
or a contributor's workstation (the devcontainer on the same image). A
receipt counts wherever it was established, as long as a workflow of this
repository or a listed maintainer signed it keylessly for exactly that
identity. So a contributor who establishes an obligation before pushing gets a
check that only verifies. Receipts are kept by content in two independent
free stores: GitHub's attestation store, whose Sigstore bundles also enter the
public transparency log, and the receipts branch.
Browsers verify and keep copies, and establish nothing.

| Facet | What the model fixes | Theorems |
| --- | --- | --- |
| Places, peers and duties | Forge: trigger, checkout, identify, verify, report. Peer: execute, fetch, sign. Store: keep. Runners and workstations establish. Browsers verify and keep | `execution_fetching_and_signing_happen_only_on_a_peer`, `a_browser_verifies_and_keeps_but_never_establishes`, `every_job_does_only_the_duties_of_its_place` |
| Sandbox | Each obligation's image (`@sdk`, the pinned SDK image, or an upstream obligation's output such as `@vv-sdk`), plus its user, umask, home, scratch and access (`sealed`; `pinned` by digest; `daemon`, which is pinned plus the lent runner's own container daemon with scratch on the runner's disk; or `live`). The whole sandbox, with `@sdk` resolved to its digest, is the environment line of the obligation's identity (`identified`) | `every_delegated_obligation_has_a_declared_sandbox`, `no_sandbox_reaches_the_live_network`, `source_vv_and_the_gate_run_sealed`, `only_the_model_audits_drive_the_lent_runners_container_daemon` |
| Graph | The release graph moved off the legacy adapter, keeping its names, inputs and needs. `carried` names what a peer carries today | `after_delegation_no_obligation_runs_on_the_legacy_adapter`, `delegation_keeps_every_obligation`, `delegation_keeps_every_input_and_need`, `every_carried_obligation_is_in_the_graph`, `nine_obligations_are_still_carried_by_their_release_jobs`, `the_delegated_graph_still_needs_every_need_first`, `the_delegated_graph_has_no_arbitrary_obligation` |
| Pull request checks | `lint`, `model-audits` and `fixtures-golden` (`Factory.PrismPM::checks`) are carried obligations with no needs. They read the whole tree and run in the pinned SDK image. `lint` and `fixtures-golden` have pinned access; `model-audits` drives OCI registries and builders, so it has `daemon` access and runs `scripts/fetch.sh` first, as the devcontainer does. The delegated graph is the release graph followed by these checks | `the_pull_request_checks_need_nothing_and_are_all_carried`, `the_pull_request_checks_run_in_the_pinned_sdk_image`, `the_whole_delegated_graph_needs_every_need_first_and_names_each_obligation_once` |
| Lanes | A pull request establishes everything a cut rests on, plus the pull request checks, so a release run only assembles receipts | `a_pull_request_establishes_everything_a_cut_rests_on`, `a_release_run_covers_the_whole_graph` |
| Stores | Each receipt is kept in the attestation store and on the receipts branch, and peers add copies | `every_receipt_is_kept_in_two_independent_stores` |
| Signers | A receipt counts only when it is bound to the forge's own identity for the obligation, and was signed by a workflow of this repository or a listed maintainer. Anyone else's receipt, a fork's, or one for other content is a hint and never counts. Identity is content, so a receipt counts in any repository with the same identity | `a_receipt_from_a_workflow_of_this_repository_counts`, `a_receipt_from_a_maintainers_workstation_counts`, `a_receipt_counts_wherever_it_was_established`, `anyone_elses_receipt_is_a_hint_and_never_counts`, `a_fork_workflows_receipt_never_counts`, `a_receipt_for_other_content_never_counts`, `a_receipt_is_found_by_content_not_by_repository` |
| Check | Counted receipts for every obligation pass, with nothing to establish. One counted failure fails, also for a fetch obligation, which is still established again because a fetch failure is never a refutation. A later pass outweighs an earlier failure. A missing receipt is pending, and only pending obligations are established | `counted_receipts_for_everything_pass_the_check_with_nothing_to_establish`, `one_counted_failure_fails_the_whole_check`, `a_later_pass_outweighs_an_earlier_failure`, `a_missing_receipt_keeps_the_check_pending`, `an_obligation_with_only_a_hint_is_established_not_assumed` |
| Dispatch | Only `observe` routes run | `a_proved_route_dispatches_nothing`, `a_refuted_route_is_not_rerun`, `a_blocked_route_waits_for_its_upstream`, `a_new_identity_is_dispatched` |
| Forge jobs | `plan` (forge), `establish` (one lent runner per obligation left to establish, through `./action`), `report` (forge), `keep` (store). No secrets. The forge reads contents and writes statuses, and a peer adds `id-token` and `attestations` (keyless signing), and only `keep` writes contents. At most 20 forge minutes per event | `no_job_holds_a_secret`, `the_forge_reads_contents_and_writes_statuses_and_a_peer_also_signs_and_keeps`, `the_forge_spends_at_most_twenty_runner_minutes_of_its_own_per_event`, `every_lent_runner_runs_the_prismpm_action`, `a_lent_runner_starts_only_for_obligations_left_to_establish`, `every_job_is_named_once_and_needs_only_earlier_jobs` |
| Projection | The workflow text is rendered from the job records | `prism-factory workflow --name delegate` |

The projection is `.github/workflows/prism-delegation.yml`, and `check.sh`
refuses drift. On every pull request and push it runs:

1. `plan` (forge). `factory.sh forge-plan` fetches the kept receipts from the
   `prism-receipts` branch and keeps only those whose Sigstore bundle
   `gh attestation verify` accepts for this repository's delegation workflow.
   The certified `delegate` root then decides each obligation's identity, its
   route, and which carried obligations a lent runner establishes.
2. `establish` (peer, one runner per obligation). `forge-prepare` materializes
   exactly the obligation's closure. The PrismPM Action's `factory` command
   runs the obligation's command in the immutable SDK image with only that
   closure mounted, and with no network when the sandbox is sealed. Then
   `forge-receipt` writes the receipt, and `actions/attest-build-provenance`
   signs it keylessly.
3. `report` (forge). `forge-report` verifies every receipt again, plans, and
   sets the `prism/delegation` commit status from the root's check.
4. `keep` (store). `forge-keep` commits each verified receipt and its bundle
   to `prism-receipts`. It runs for pushes and same-repository pull requests.

The obligations a peer carries are the model's `carried` list. Today that is
`factory-model`, which `factory.yml` used to run on every pull request
(`factory.yml` now runs only on dispatch), and the three pull request checks
`lint`, `model-audits` and `fixtures-golden`, which replaced PR Fast Checks
(`ci-parallel.yml`, retired). Each runs the old job's command in the SDK image,
which carries the same toolchain, after a locked `cargo fetch`. One step is
left out: `bootstrap-verify.sh --check-source` only checks that a full-history
checkout contains the pinned bootstrap commit, and a closure has no history by
design (`vv.yml` still runs it on every push to `main`).

A closure is its own Git repository with one commit that tracks exactly the
closure, so `git ls-files` there lists what the identity covers. A ratchet
compares the tree with its *base*, the revision's first parent (for a pull
request's merge commit, the tip it merges into). The request carries the base
as `@base:PATH` entries, and an obligation reads only the ones it declares:
`model-audits` declares `@base:model/modules.toml`, so the module baseline
(rule 6 of `check-modules`) may not grow, and its identity changes only when
that manifest does. Its closure commit then has a parent holding exactly those
entries, named `origin/main` as a full checkout names the base.
Each release obligation moves into `carried` in the change that
retires its `release.yml` job, so nothing runs twice.

## Limits

- `host` obligations run with the runner's network and user. The closure is
  enforced. Network and uid isolation are not enforced yet.
- `actions` obligations are carried out by their jobs in `release.yml`. The
  factory identifies and routes them and records their receipts; it does not
  run their commands itself yet.
- A receipt is trusted because of who can write the `factory-receipts` branch.
  Signing receipts with the release identity is a follow-up.
- The published evidence binds each stage to one run, so the unit of reuse is
  the obligation (all eight source parts, all build jobs), not a single job.

## Next

1. **Split the SDK image** into toolchain and oracle stages keyed only on the
   lock files and oracle sources they read, so `vv-sdk` and `build` stop
   reading the whole source.
2. **Move each `actions` obligation to a hermetic `host` command**, one at a
   time, so that the legacy-adapter count falls to zero.
3. **Ship the component through the template**, so every repository Prism is
   installed into gets its own graph and its own receipts.
