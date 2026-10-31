# Proposal 288: `prism dev` with a local studio

| | |
| --- | --- |
| Issue | [#288](https://github.com/UOR-Foundation/PrismPM/issues/288) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental |
| Depends on | #270 (`check <holo>`), #273 (`@prism-code/verify`), #280 (`prism.toml`), #282 (the same judgement as `run`) |
| Used by | #284 (the Replay tab's source), #325 (the authoring loop) |

## Summary

`prism-code dev [<dir>]` watches a project's sources, rebuilds when their bytes change, judges the new holo with the `check` the command line runs, and serves a studio on `http://localhost:4100`.
The studio has a Check tab and a Replay tab, is a plain page with no framework, and reaches nothing outside its own origin.

## Motivation

Today the loop is three commands and a reading of terminal text.
An author who edits a model wants one number: does this source still earn its verdict.
`langgraph dev`, `adk web` and `tauri dev` each make their loop one command.

### Goals

1. One command from a save to a verdict, with the same verdict `check` prints.
2. A verdict on old source is never shown as if it were current.
3. A port that does not move, and a page that works with the network off.
4. A Replay tab that wires to #284 by changing one file.

### Non-goals

- The replay itself (#284), the conformance suite (#287) and the authoring front door (#325).
- A faster build. `dev` runs the project's build as it is; incremental reuse is the build's own (`AR-06` in `CONFORMANCE.md`).
- A public JavaScript API. The verb is the surface; the modules are not exported.

## Proposal

### The loop

```text
save ─ fs.watch or a 1 s scan ─ hash the watched files ─ bytes changed? ─ build ─ check ─ replay source ─ studio
```

The watcher hashes the watched files, so a change is a change of bytes, not of a time.
The defaults include `language/**/*.toml`, the pattern `prism-code init` declares, because an edit to a lexicon changes the model. A lexicon elsewhere needs `[model].watch`.
`fs.watch` carries the latency and the scan carries the guarantee, because some file systems deliver no events (a network mount, a Windows path seen from WSL).

One cycle runs at a time and everything saved during it becomes exactly one more cycle.
An edit to the `--policy` file re-checks with no build.

Each cycle ends in one of three outcomes:

| Outcome | Means | The studio shows |
| --- | --- | --- |
| `verdict` | The build wrote a holo and `check` judged it. | The verdict and its reasons. |
| `no-verdict` | The build named no holo, or `check` could not judge the one it named. | The reason, and the last verdict labeled as old. |
| `build-failed` | The build exited non-zero. | The end of its output, and the last verdict labeled as old. |

### Which holo

The build reports its result as JSON and `dev` reads the `.holo` beside its `manifest_path`.
Taking the newest file would be wrong: a rebuild of source that went back to an earlier state reuses its old directory, so the newest file describes the state the developer just left.
A custom build that prints no result must write a holo during the run or name it with `--holo`; otherwise the outcome is `no-verdict`.

### The lock

The default build is `prism-code build --update`. A plain `prismpm build` refuses a lock whose model pin is stale (`PP5401`), and every edit to a model makes it stale, so a plain build would fail on every save. The lock therefore follows the model during `dev`, and `dev` says so when it starts. The developer commits it with the source, and a plain `prismpm build` in CI still refuses a lock that was not.

### The port

The port is 4100, which the guides and `sdk/docs/cli.json` already promised.
Nothing in this repository uses it: the ports in use are 1234, 3000, 4317, 4318, 5000, 5432, 5556, 5672, 8080, 8443, 8765, 15001, 38129, 43210 and 43567, and `prism-code run` takes an ephemeral port.
A port in use is the error `dev.port`, never a silent move.

### The server

The server binds `127.0.0.1` and refuses any `Host` that is not `localhost` or `127.0.0.1` at its port, which closes DNS rebinding.
It answers only `GET` and `HEAD`. Its files come from a closed table, so no request path reaches the file system.
Every response carries `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.

| Path | Answer |
| --- | --- |
| `/` and the page's files | The page, its style and scripts, and `/verify.mjs`, the vendored `@prism-code/verify`. |
| `/api/state` | The current `prism/dev-state/1` as JSON. |
| `/api/events` | The same state as server-sent events, on connect and on every change. |
| `/holo` | The bytes the current verdict judged; 404 while no verdict describes the source. |

### The page

The page is HTML, one stylesheet and two modules, with no framework and no build step.
`src/studio/tabs.mjs` holds what each tab shows as pure functions of the state, so a test reads exactly what the page renders.
Text from the state reaches the page only as text nodes, so a build log cannot become markup.

The generated SDK workbench (`crates/prismpm/src/workbench`) is not reused. It renders a holo's own typed operations for its end users and is emitted by the Rust build, and it does not ship in `prism-code`. The studio reuses its color tokens and takes its verifier from `@prism-code/verify`.

The page runs that verifier on the same bytes and says whether its verdict agrees with the command line's.
Both are the same code, so a difference means the bytes or the policy differ, which is the failure a developer needs to see.

### The Replay tab

`src/dev-replay.mjs` is the tab's one source. `readReplay` returns a `ReplayVerdict`: a `state` of `unavailable`, `no-histories`, `passed`, `diverged` or `no-verdict`, and for the two with a result `events`, `divergences` and `histories`.
It returns `unavailable` until #284 merges. Wiring it replaces that function's body, and the header of the file holds the mapping from `experimental_replay`.
The tab and its tests already handle every state.

### The floor

The issue's bar is edit to verdict "under the SDK image's rebuild floor". No document in the repository defines that floor. There are two readings, and they give very different numbers.

**A rebuild of the image.** The fastest of 18 successful `build` jobs of `sdk-candidate.yml` from 2026-10-21 to 2026-10-29 took 49.7 minutes. Any working loop clears that by a factor of forty, so it proves nothing, and it is not a gate.

**A rebuild in the image.** This is the floor used here: one `prismpm build` of the project in the SDK image. It is a true floor, because `prismpm build` is hermetic: every run starts from a fresh workspace and a fresh exporter acquisition, and reuses no compiled work. A verdict on new source needs a holo, and a holo costs one build. On Calculator on a standard runner that is about 70 s.

By this reading, edit to verdict cannot be strictly under the floor, because it contains the floor. Getting under it would take reuse inside `prismpm build`, which must be designed against that build's custody rules, not bypassed from `dev`. So the issue's bar is met only under the first reading, and this proposal says so rather than choosing a number that passes.

`dev-e2e.yml` therefore gates on what `dev` controls, and both limits fail on a real regression:

| Gate | Limit | Why this value | Catches |
| --- | --- | --- | --- |
| Time outside the build and check | 2 s per edit | One 1 s scan, the debounce and the page's update, with room for a loaded runner | A slower watcher, state or page |
| Edit to verdict | 1.25 times this run's cold build | Above the 7% spread of builds seen on one runner, and well below the 2 times of a build that runs twice | A second build, or a build triggering itself |

The cold build is measured in the same job, so the limit moves with the runner and with the build, and the gate needs no number that goes stale.

### Measured

`sdk/npm/prism-code/scripts/dev-measure.mjs` starts the clock in its own process just before an atomic save, and stops it when a headless browser shows the new digest.

`dev-e2e.yml` runs it on Calculator with the real build in the candidate SDK image, and on the stand-in build inside a network namespace with only loopback. Its step summary is the record for each pull request. On a standard `ubuntu-24.04` runner, in the run that set these limits:

| Calculator, real build, 4 edits | Seconds |
| --- | --- |
| Cold build | 70.72 |
| Median edit to verdict in the browser | 70.62 |
| Slowest | 71.11 |
| Fastest | 66.26 |
| Most any edit spent outside its build and check | 0.08 |
| Most any edit spent in `check` | 0.01 |


The stand-in build copies the reference archive, so it times the loop alone. On a Windows 11 developer machine with Chrome, over six edits:

| | Seconds |
| --- | --- |
| Median edit to verdict in the browser | 0.31 |
| Slowest | 0.73 |
| Of the median, the stand-in build | 0.20 |
| Of the median, `check` | 0.02 |

## Test plan

- `test/dev.test.mjs`, on every host `npm-prism-code.yml` runs: the patterns; bytes against times; ignored directories; the watcher with and without file system events; an atomic save; a plain write; single-flight and coalescing; every outcome; the policy re-check with no build; the holo the build reports over the newest; the Check tab's data against the verdict `check --json` prints; the page verifier's agreement; every Replay state; the server's headers, Host check, read-only rule and closed file table; the page naming no outside address; the port in use; and the verb end to end through four model edits and a policy edit.
- `dev-e2e.yml`: the real build and the real browser.

## Graduation criteria

- Beta (the v0.6 feature freeze, #291). `prism-code dev` runs on the reference archives, and the Replay tab reads #284.
- Stable (1.0). The Rust CLI's `prism` verb and the port are final, and `prism/dev-state/1` is either published or declared private.

## Precedent

- `langgraph dev`: one command, a fixed port (2024), a studio beside the server.
- `adk web`: an Eval tab next to the agent, the model for the Check tab.
- `tauri dev`: rebuild on save against a fixed development address.

## Alternatives

- **A UI framework.** Rejected. Two tabs of text do not need one, and a framework adds a dependency to a package that has none.
- **Verify only in the page.** Rejected. `run` and `check` judge with the capability grant and the policy file, which are local inputs; the command line's verdict is the contract and the page's run is the cross-check.
- **Kill a running build on a new save.** Rejected for now. `docker run` does not stop its container when its client dies, so a killed build would race the next one for the build root.
- **Pick a free port.** Rejected. The issue asks for a fixed port, and a bookmark should keep working.

## Unresolved questions

1. Payment Approval, the second reference archive, reached main after these measurements. `dev` has not been run on it yet. `dev` holds no assumption about a project beyond `prism.toml` or `prismpm.toml`, so it should run there unchanged, and that is untested until the archive exists.
2. Whether `prism/dev-state/1` should be a published schema. It is private to the studio today, which is why it is not in `@prism-code/spec`.
3. The Rust CLI has no `dev` verb. `prism dev` in the guides is `prism-code dev` until the binary is renamed.
