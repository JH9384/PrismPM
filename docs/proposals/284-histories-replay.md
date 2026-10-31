# Proposal 284: histories and `prism replay`

| | |
| --- | --- |
| Issue | [#284](https://github.com/UOR-Foundation/PrismPM/issues/284) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental |
| Predicate type | `https://uor.foundation/prism/replay/v1` |
| Depends on | #266 (`prism/proof/v1`, the statement shape), #269 (levels, `replay.*`), #274 (dual digests), #283 (world within policy) |
| Used by | #286 (`@prism-code/testing`), #287 (conformance), #291 (feature freeze), #325 (authoring front door) |

## Summary

A history is the dispatches of one application, in order, each with its recorded outcome.
It generalises the acceptance vectors a holo already carries: a vector is an event with a response.
`prism replay` re-executes a history against a build and compares every outcome byte for byte.
A difference is a `DeterminismViolationError`.
A replay also writes one in-toto statement, `prism/replay/v1`, naming the histories by digest, the divergence count and the runtime.
That statement is the evidence P3 requires, so a changed model cannot reach P3.

## Motivation

Acceptance vectors are written by the model's author and travel inside the model.
Change the model and you change its vectors, so a holo always agrees with itself.
Nothing today says that a new build still does what the old one did.
A history is held outside the build, so it can.

### Goals

1. One format, a superset of acceptance vectors, that both runtimes read and digest the same way.
2. One replay in the JavaScript runtime and the Rust CLI, comparing the same outcomes.
3. A typed failure on divergence, reporting every divergence at once.
4. A deterministic statement in the shape `prism/proof/v1` set, checked by a pure function beside the proof check.

### Non-goals

- Signing. `prism-code attest` already signs any statement into a holo (#272).
- Reading signed statements from the holo inside `check`. That needs `verify` to read the attestation section and the proof and provenance joins, which this issue does not own. See "What P3 needs next".
- Replay of a world with imports. Every world today is pure, and a history records no effect. An effectful world needs its effects in the history, which is a new schema version.
- Which histories a policy requires. #285 owns the policy file.

## Proposal

### The history: `prism/history/1`

Schema: `sdk/npm/spec/schemas/history/history-v1.schema.json`. Types: `sdk/npm/spec/types/history.d.ts`.

```json
{
  "schema": "prism/history/1",
  "application": "Calculator",
  "recordedFrom": { "guest": { "blake3": "...", "sha256": "..." }, "model": { "blake3": "...", "sha256": "..." } },
  "events": [
    { "request": "3109616464093230093232", "response": "31096f6b093432" },
    { "request": "00000000", "error": "core.allocation" }
  ]
}
```

| Member | Meaning |
| --- | --- |
| `events` | At least one, in the order they ran. A history of nothing proves nothing. |
| `events[].request` | The request bytes, lowercase hex. |
| `events[].response` | The response bytes, lowercase hex. An event holds this or `error`, never both. |
| `events[].error` | The stable code a failed dispatch ended in, such as `core.allocation`. A guest trap has no stable message, so it is `core.trap`. |
| `application` | The name when it was recorded, or null. Information for a person. |
| `recordedFrom` | The build it was recorded from. Absent for a closure. Information for a person. |

Bytes are hex because hex has one spelling per value, so a digest has one meaning.
Replay never compares `application` or `recordedFrom`: the point of a replay is to run a different build.

The superset is exact.
Every acceptance vector is an event with a response, and `prism-code history` writes them as the holo's first history.
A history adds what vectors cannot say: a recorded refusal, a recording from a live run (`prism-code run --record`), and a place outside the model.

### Digests

A history's digests are `sha256` and `blake3` over its canonical JSON with no trailing newline, the same encoding as the model document (ADR-015).
They do not cover the file, so reordered members and a CRLF checkout are the same history.

### The statement: `prism/replay/v1`

Schema: `sdk/npm/spec/predicates/replay-v1.schema.json`. Types: `sdk/npm/spec/predicates/replay-v1.d.ts`.

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "guest", "digest": { "blake3": "2adca3e7...", "sha256": "dcf53677..." } }],
  "predicateType": "https://uor.foundation/prism/replay/v1",
  "predicate": {
    "runtime": { "name": "prism-code", "version": "0.3.0" },
    "model": { "blake3": "e7654483...", "sha256": "07492189..." },
    "histories": [{ "digest": { "blake3": "507d9bdf...", "sha256": "56d4c9c4..." }, "events": 22, "divergences": 0 }],
    "divergenceCount": 0
  }
}
```

| Member | Meaning |
| --- | --- |
| `subject` | Exactly one, the Core-Wasm guest blob, as in `prism/proof/v1`. ADR-015 digests. |
| `predicate.runtime` | The runtime that re-executed the histories: `prism-code` or `prismpm`, and its version. |
| `predicate.model` | The model blob of the build. A guest can stay the same while the model changes, so the model is named too. |
| `predicate.histories` | Every history by digest, with its event and divergence counts. At least one. |
| `predicate.divergenceCount` | The sum of `histories[].divergences`. |

It holds no clock.
The same histories against the same build with the same runtime write the same bytes, and the two runtimes write the same statement but for `runtime`.
A statement is written on a divergence too, because a failed replay is evidence, and the check below refuses it.

There is no `verifiedLevels` claim.
A checker computes the level from evidence, so `prism/replay/v1` does not carry a value nothing reads.

### How the statement is checked

`checkReplayStatement(statement, holo, envelope)` in `sdk/npm/verify/src/statements.mjs` is pure, like `checkProofStatement`.
Each failure is a verdict reason that withholds P3.

| Check id | Code | Fails when |
| --- | --- | --- |
| `replay.divergence` | `PP5701` | `divergenceCount` is not zero. This is the one check that maps to `DeterminismViolationError`. |
| `replay.envelope` | `PP5702` | The DSSE signature does not verify against the trust root. |
| `replay.statement` | `PP5703` | The statement is absent, has the wrong shape, or its count disagrees with its histories. |
| `replay.subject` | `PP5704` | The subject is not this holo's guest, by either digest. |
| `replay.model` | `PP5705` | The model is not this holo's model blob, by either digest. |

So a changed model cannot reach P3 by either route.
The statement from before the change names another guest and model, and fails `replay.subject` and `replay.model`.
A statement from after the change records divergences, and fails `replay.divergence`.

`PP5706` is the one code no statement check uses: the replay could not be carried out.

### The runtime API (`prism-code`)

| Export | Meaning |
| --- | --- |
| `experimental_replay(app, histories, options)`, `app.experimental_replay(histories, options)` | Re-execute one or more histories; every event runs. Rejects with `DeterminismViolationError`, whose `details` is the result, unless `throw: false`. |
| `experimental_recorder(app)`, `app.experimental_recorder()` | `dispatch` behaves as `app.dispatch` does and records the outcome; `history()` returns what finished. |
| `acceptanceHistory(app)`, `app.history()` | The acceptance vectors as a history. |
| `parseHistory`, `historyBytes`, `historyDigest`, `historyJson`, `HISTORY_SCHEMA`, `REPLAY_PREDICATE_TYPE` | The format. |

A replay that cannot be carried out always rejects with `ReplayError`: `replay.history`, `replay.holo`, `replay.options` or `replay.statement`.
A closure replays too; it has no guest blob to name, so its `statement` is null.
This is the surface `@prism-code/testing` and the conformance suite call.

### The commands

```text
prism-code history <app.holo> [--output <file>]
prism-code replay <history | dir>... --holo <app.holo> [--statement <file>] [--json]
prism-code run <app.holo> --record <file>
prismpm replay <history | dir>... --holo <app.holo> [--statement <file>]
```

| Exit | Meaning |
| --- | --- |
| 0 | Every event replayed unchanged. |
| 1 | A divergence: `replay.divergence`, `PP5701`. |
| 2 | The replay could not be carried out: `PP5706`. |

`--json` prints `prismpm/replay-result/1`: the application, the runtime, the event and divergence counts, every divergence, and the statement.
In `prismpm`, a divergence prints the registered error envelope instead, because that is the contract of every failure in that CLI; `--statement` still writes the statement.

The Rust crate has no Wasm engine, so `prismpm replay` runs the guest through Node, as command-line acceptance does (`text_cli/acceptance.rs`).
Node only executes the requests. Rust reads the archive, compares the outcomes and writes the statement.

### What P3 needs next

This change makes the replay evidence real and the check that judges it real.
It does not make P3 reachable through `check`, and no change here pretends to.

`prism-code check <holo> --replay <file>` and the `replay` option of `verify` are as far as the check goes today.
They run `checkReplayStatement` on a statement from beside the holo, so its reasons replace `replay.statement` in the verdict, and `predicates.replay` in the policy input holds it with `verified: false`.
A policy can deny on what it says.
The statement is unsigned and no option claims otherwise, so `replay.envelope` is always among the reasons and the check can only withhold P3.

- What remains for #270: read signed statements from the attestation section instead of refusing it. `attestationBlocker` still gives such a holo no verdict, and `verify()` does not read that section.
- `checkProofStatement` and the provenance statement wait on the same join, and P3 needs P1 and P2 first.
- Until then every holo is P0. The tests that hold this are in `sdk/npm/prism-code/test/replay.test.mjs`.

When `verify` reads the section, `checkReplayStatement` is the function it calls for `replay.*`, with the outcome of the real signature check in place of `DETACHED`, and `levelOf` in `sdk/npm/verify/src/level.mjs` already decides the level for both.

### Test plan

| Where | What it holds |
| --- | --- |
| `sdk/npm/prism-code/test/replay.test.mjs` | The reference archive replays green; the changed model fails with the typed error; every field of the statement; both routes to P3 refused; every failure of the command. |
| `sdk/npm/verify/test/replay-statement.test.mjs` | Each check fails exactly its own id, and `levelOf` is P2 for each failure. |
| `sdk/npm/spec/test/replay.test.mjs` | The fixtures validate and agree with the reference archive; the types and schemas name the same members. |
| `crates/prismpm/src/replay/tests.rs` | The Rust replay writes the JavaScript half's statement, digest and divergences. |
| `.github/workflows/npm-prism-code.yml` | Every committed history replays on Node 22 and 24 on three systems; the changed model must exit 1. |

The negative fixture is `sdk/npm/prism-code/test/fixtures/Calculator.changed-model.holo`, derived by `scripts/derive-changed-model.mjs`.
Its guest answers `OK` where the reference answers `ok`, and its acceptance vectors changed with it, so it passes its own 22 vectors and diverges on 7 recorded events.
It is a rewrite, not a rebuild: its Lean identities still describe the original sources, and it is a test input, never reference evidence.

Conformance scenario `HO-31` runs these suites as the owning acceptance.

### Graduation criteria

- Experimental (M3). This document, the schemas and both commands are merged, and the reference archives replay in CI.
- Beta (v0.6 freeze, #291). `verify` joins `checkReplayStatement`, a signed replay statement reaches P3 end to end, and the shape has gone one release without change.
- Stable (1.0). Any change to the statement or the history is `prism/replay/v2` or `prism/history/2`.

## Precedent

- Temporal `Worker.runReplayHistory` and Event History: replay against new code and fail on a determinism violation. Copied: the error's name, and replaying a history against a build it did not come from.
- in-toto runtime-trace predicate: a statement about what happened at run time. Copied: the statement envelope. Prism states the outcome of a comparison, not a trace.
- `crewai replay -t`: replay from a recorded task. Not copied: it resumes work, where Prism only compares.

## Alternatives

- Bind a history to one guest digest. Rejected: a replay against the build it came from proves nothing, and the point is the next build.
- Stop at the first divergence. Rejected: the statement must count them all, and the second divergence is often the useful one.
- Add a timestamp, as `prism/proof/v1` has `timeVerified`. Rejected: it would make the two runtimes and two runs disagree for a value no check reads.
- Base64 for bytes. Rejected: several spellings per value, so a history's digest would depend on its encoder.
- Add a Wasm engine to the Rust crate. Rejected for now: a large new dependency for a loop Node already runs in the SDK image.
- Put a `verifiedLevels` claim in the predicate. Rejected: nothing reads it, as #269 says of claims.

## Unresolved questions

1. `prism replay <history>` in the issue names no build. Both commands take `--holo` and require it, because a default needs a stable path to the current build, which `prismpm build` does not write yet. Should it default to the build tree's holo once one exists?
2. Should a policy be able to require named histories, by digest? Recommendation: yes, in #285 or its successor, since `predicate.histories` already names them.
3. The site guide `run-and-gate` says a run under `--allow-unverified` marks its history unverified and that `replay` refuses it as evidence. This format has no such mark, because a replay's evidence is the comparison, not where the history came from. Should the mark exist, or should the guide change when the `prism` CLI ships?
