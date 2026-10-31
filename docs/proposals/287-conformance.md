# `@prism-code/conformance` and `COMPLIANCE.md`

Issue [#287](https://github.com/UOR-Foundation/PrismPM/issues/287). Milestone M3, whose exit criterion is that the JS runtime passes conformance.

## Problem

The runtime contract is stated in `SPEC.md`, `@prism-code/spec` and `prism-code`'s own tests.
Those tests import JavaScript, so they cannot judge a second runtime.
A Rust or Python runtime would drift from the first with nothing to show it.

## Decision

A suite of data, a harness, and one small program per runtime.

- **Scenarios are JSON.** A check is an operation, an input and an expected answer. Any language can be judged by them, and reading one needs no code.
- **The harness owns the archives.** Damaged holos come from recipes on one reference archive, pinned by sha256. A runtime only ever receives a path, so it needs nothing from this package and cannot shape what it is tested on.
- **A shim is one process per request**, JSON on stdin and stdout. This is the `sigstore-conformance` shape. It costs a process per check, about 11 seconds for the whole suite on one Windows machine, and buys isolation: a crash fails one check, and a shim needs only JSON and a process in any language. A throwaway Python shim was run against the harness to test this.
- **Expected digests are pinned from ADR-015**, and the dispatch vectors are written into the scenario and held to the model document by a test. Neither is read from a runtime at run time.

The shim contract is specified in [`sdk/npm/conformance/README.md`](../../sdk/npm/conformance/README.md).

## How the precedents shaped it

| Precedent | What was taken |
| --- | --- |
| `sigstore-conformance` | The entrypoint shim, and one invocation per test. |
| LangChain `standard-tests` | Expected failures declared by the implementation under test. |
| LangGraph `checkpoint-conformance` | A suite published as its own package, apart from any implementation. |
| OpenTelemetry spec-compliance-matrix | A feature by language table with `+`, `-` and `N/A`. Here every cell comes from a run, as the issue asks. |

## Decisions to check in review

- **`N/A` for a runtime with no shim.** The issue defines three cells and no fourth for "not measured". `-` would claim a failure nobody observed, so an unmeasured column reads `N/A`, and the legend says it means nothing was measured.
- **Placeholders.** Replay checks are named with no body and report `xfail` for every runtime. A body written before #284 merges would be a guess at an API. They read `-` in the matrix, and the suite still passes, because the milestone's criterion is that what is on main conforms.
- **Exemptions in the gate.** The issue says a format change cannot merge without a scenario. A pure refactor of the writer changes no format, and without a way out it would force a meaningless edit to a scenario, which teaches people to game the gate. So `format-gate.json` takes an entry with a reason, in the same change, visible in review. If that is too loose, delete the mechanism; nothing else depends on it.
- **`load` reports damage, it does not refuse it.** A holo with a wrong footer, or a guest that differs from its label, opens with `verified: false` and still dispatches. The checks `load.damage.*` pin this, because `prism-code`'s tests pin it as intended and `prism-code run` is gated on `check`. A second runtime must do the same. Whether a bare `load` should refuse is a question for the v0.6 freeze, and changing the answer means changing those checks.
- **Error codes are compared exactly.** A Rust runtime must report `archive.magic`, not a code of its own. That is the point of stable codes, and it makes today's `prism-code` codes part of the contract.
- **No conformance id in `model/ids.toml`.** `CONFORMANCE.md` registers what the Rust tests cover, and neither `@prism-code/spec` nor `@prism-code/verify` has an entry. This suite is test tooling, not a `prismpm` capability.

## Not in this change

- Replay scenarios: they fill in when #284 merges.
- A Rust or Python shim. Both columns read `N/A` until one exists.
- Making the gate a required status check. That is a repository setting, and the `main` ruleset is disabled today.
- Publishing to npm. Like `@prism-code/spec` and `@prism-code/verify`, the package has no publish job yet.
- A reusable GitHub Action. The CLI is one command, so an Action waits for a runtime outside this repository to need one.
