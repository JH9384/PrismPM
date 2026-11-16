# `@prism-code/testing`

Issue [#286](https://github.com/UOR-Foundation/PrismPM/issues/286). Milestone M3 (v0.6).

## Problem

Every test of code that dispatches into a holo rebuilds the same scaffolding: a fixed clock, a fixed seed, a grant of what the holo may reach, a stand-in for `dispatch`, and a history fixture.
The reference archives' own tests each carry a private copy.
A test that calls `dispatch` with the wrong request passes silently against a hand-rolled stub.

## Decision

A new package, `@prism-code/testing`, Experimental, with `prism-code` as a peer dependency.

- **`createMockHost`.** A clock that moves only when the test moves it, a seeded random source, and `fetch`, `kv` and `variable` stubs. A guest of the core-wasm world imports nothing, so the host is what surrounds a dispatch, not something the guest calls. Each stub asks the same `grantOf` the runtime uses, so with no capability file nothing is granted and a test fails where production would. A granted resource with no stub is an `UnexpectedCallError`, never an invented answer. `host.load` opens a holo under the host's grant.
- **Time-skipping.** `clock.until(work)` moves the clock to the next timer whenever the work is waiting, so sleeping takes no real time. `advance`, `next` and `runAll` give finer control. When the work waits and no timer is left it rejects with `TestSetupError`, because a test that hangs teaches nothing.
- **`scriptedDispatch`.** A list of expected calls with a response or an error, matched in order. A call that is not the next one throws `UnexpectedCallError` and leaves the script where it was. `assertComplete()` throws `ScriptIncompleteError` while calls remain. A `prism/history/1` is accepted as a script.
- **History fixtures.** `readHistory`, `writeHistory`, `recordHistory`, `assertReplays`, and `referenceArchive`, all thin over `parseHistory`, `historyJson`, `experimental_recorder` and `experimental_replay`. Nothing of the format is copied, so a fixture cannot drift from what `prism-code replay` reads.
- **Errors** are `PrismError` subclasses with stable codes (`unexpected_call`, `script_incomplete`, `test_setup`), as every error in `prism-code` is (#276).

## How the precedents shaped it

| Precedent | What was taken |
| --- | --- |
| `@temporalio/testing` | A time-skipping environment, and a test that waits on a timer finishes at once. |
| Vercel `MockLanguageModelV4` | A stand-in with the same call shape as the real thing, so code under test does not know. |
| OpenAI `ScriptedModel` with `assert_complete` | A script of expected calls, and a separate check that all of them happened. |

## Decisions to check in review

- **Peer dependency, not a vendored copy.** The conformance and verify packages vendor because they must not import the runtime they judge or must run in a browser. This package exists to drive the runtime, and copying its history code is the duplication the issue forbids. The cost is that `prism-code` must be installed beside it, and a release of `prism-code` that includes histories must exist before this package is published.
- **The mock host is not injected into the guest.** The runtime has no hook that passes a clock or random source to a guest, because the world has no such import. The host is for the code that calls `dispatch`. If a world with a clock import lands, the host grows the matching function; nothing here would change.
- **Strict order.** A script matches calls in order. An unordered mode is easy to add and easy to misuse, and the precedents are ordered.
- **The reference archives' tests.** `prism-code`'s `reference-archives.test.mjs` loads archives, runs the command line, inspects, verifies, replays and scripts only through this package. For that it re-exports the runtime calls such a test needs (`load`, `inspect`, `formatInspection`, `canonicalJson`, `experimental_verify`, `resolveArchive`, the history and replay calls) and adds `runCli`. It still imports the exit-code table, which tests the runtime itself, and the verify and spec packages it cross-checks against.
- **`replay.test.mjs` stays on `prism-code` directly.** It is run by the HO-31 conformance gate (`cargo xtask`, with an exact test count) inside the devcontainer, which installs no npm packages; this package finds its peer `prism-code` through an installed link, so routing that file through it fails the gate. Changing the gate's environment is a Rust change outside this issue.
- **`@prism-code/verify` and `@prism-code/spec` tests stay as they are.** The verifier is the runtime-free second reader of a holo, and its reference-archive tests show it agrees with prism-code without importing it; prism-code already vendors the verifier, so a dependency through this package would be a cycle. The spec package is the base prism-code builds from, so it cannot depend upward.
- **`@prism-code/verify` and `@prism-code/spec` tests stay as they are.** The verifier is the runtime-free second reader of a holo, and its reference-archive tests are what show it agrees with prism-code without importing it; routing them through a package whose peer is prism-code would put the runtime under the verifier, and prism-code already vendors the verifier, so the dependency would be a cycle. The spec package is the base both build from (prism-code needs it built before it loads), so it cannot depend upward on a package that needs prism-code.

## Not in this change

- Publishing to npm. Like `@prism-code/spec`, `@prism-code/verify` and `@prism-code/conformance`, the package has no publish job yet.
- Injecting the host into a guest, and a Rust or Python equivalent.
