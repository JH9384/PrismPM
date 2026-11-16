# Proposal 629: sessions, the `hologram:guest/core-wasm@2` world

| | |
| --- | --- |
| Issue | [#629](https://github.com/UOR-Foundation/PrismPM/issues/629) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental |
| Depends on | #278 (the world registry and its versioning rule), #284 (`prism/history/1`, `prism replay`), #283 (world within policy) |
| Used by | #630 (binary application profile, the first profile that declares this world), #631 (host effects for guests), #297 (streaming dispatch) |

## Summary

A second guest world, `hologram:guest/core-wasm@2`, in which one instance serves the ordered steps of one session.
The guest stays an import-free core module and its entry stays the `Bytes -> Bytes` function LexLean already exports.
A step calls the entry with a frame of the session state and the request, and the entry answers with the next state and zero or more responses.
The generated shim keeps the state inside the instance, never shows it to the host, and compacts its arena after every step, so the memory a step uses, and therefore any trap, is a function of the state and the request alone.
A session's responses are then a function of its ordered requests, which is what a history records and a replay checks.
`prism/history/2` records sessions; `prism/history/1` and `core-wasm@1` keep their meaning byte for byte.

## Motivation

`core-wasm@1` has a bump allocator that never frees, so a host runs every request on a fresh instance (SPEC section 3, "the bump allocator is cumulative per guest instance").
Nothing survives between two calls.
An application whose state is large and grows with use, an inference engine with its weights and key-value cache, a parser accumulating a document, a game, cannot be a holo: it would have to send its whole state out and back on every request, through a response limit that exists to keep responses small.

The model is already the right shape.
A LexLean function `step : State -> Request -> State × List Response` is pure, so a session is the left fold of `step` over its requests.
What is missing is a world in which the host does not have to hold the state, and an allocator that does not grow without bound across steps.

### Goals

1. A new world revision, `@2`, with its own WIT file and its own row in `WORLDS`. `@1`, its row, its WIT bytes and every existing holo are unchanged.
2. An explicit session lifetime. A session opens with an empty state on a fresh instance, takes ordered steps, and ends when it is closed or when a step traps.
3. Zero or more responses per step, so a step can answer with several messages (tokens, progress, a final result). The runtime offers them as a list and as an async iterable.
4. Determinism: the responses of a step are a function of the state and the request; the state after a step is a function of the state before it and the request. A trap is too.
5. Histories of sessions (`prism/history/2`), replayed by `prism-code replay` and `prismpm replay` with the same digests and the same statement, `prism/replay/v1`.
6. Acceptance vectors expressed as ordered histories, run by `vectors`, `check` and `prismpm verify`.

### Non-goals

- Host effects. They are #631, which uses this world's step as its turn.
- The profile that declares the world. That is #630 (`prismpm/binary-application/1`); the text profiles keep `@1`.
- Threads, shared memory and SIMD. #632 (speed of generated code) decides what is sound.
- Exposing the state to the host. The host never reads or writes it; see Alternatives.
- WASI 0.3 streams. #297 can map the async iterable onto them later; nothing here depends on the Component Model.

## Proposal

### The world

`sdk/npm/spec/worlds/core-wasm-2.wit`, package `hologram:guest@2.0.0`, world `core-wasm`:

```wit
package hologram:guest@2.0.0;

world core-wasm {
  /// Reserve `length` bytes for the next request. Discards the previous step's responses.
  export holo-alloc: func(length: u32) -> u32;

  /// Take one session step over the request at `offset`. Returns `offset << 32 | length` of the responses.
  export holo-step: func(offset: u32, length: u32) -> u64;
}
```

Its row in `WORLDS`:

```js
WORLDS['hologram:guest/core-wasm@2'] = {
  version: 1,
  package: 'hologram:guest@2.0.0',
  world: 'core-wasm',
  file: 'worlds/core-wasm-2.wit',
  digest: { blake3: '…', sha256: '…' },
  imports: [],
  exports: [
    { name: 'holo_alloc', kind: 'func', params: ['i32'], results: ['i32'] },
    { name: 'holo_step', kind: 'func', params: ['i32', 'i32'], results: ['i64'] },
    { name: 'memory', kind: 'memory' },
  ],
};
```

The entry is renamed from `holo_run` to `holo_step` on purpose.
A `@1` reader that meets a `@2` guest fails `world.contract` and `core.exports`; it can never run a step as a stateless request and get a plausible answer.
Because the world imports nothing, the world-within-policy check (#283) finds it pure and within every grant, as it does `@1`.

### The step

All integers are big-endian `u32`, as in `prismpm/host-effects/1` (SPEC 12.15).

| Frame | Layout |
| --- | --- |
| Turn, built by the shim and given to the entry | `stateLength`, `state`, then the request to the end |
| Answer, returned by the entry | `stateLength`, `state'`, `count`, then `count` times `length`, `response`, and nothing after |
| Responses, returned to the host | `count`, then `count` times `length`, `response` |

The entry is the model's root `Bytes -> Bytes`, generated exactly as today (`prod_codegen::generate_module`).
The shim, generated from a fixed template and the declared bounds alone, does four things around it:

1. builds the turn from the resident state and the request;
2. calls the entry; a checked failure traps, as in `@1`;
3. checks the answer: `state'` at most `stateMaximum`, `count` at most `responseCountMaximum`, each response at most `responseMaximum`, the total at most the declared answer bound, no trailing byte; any violation traps;
4. keeps `state'` and returns the responses.

The first step of a session sees an empty state.
The model gives that empty state its meaning (a counter at zero, an empty buffer, an unloaded engine); no initial-state root is needed, and a model whose state must never be empty after the first step says so in its own proofs.

### The arena

The guest's heap is one region that starts at `__heap_base`:

```text
[ state | responses of the last step | request | turn and the step's temporaries ... ]
```

- `holo_alloc(n)` discards the last step's responses, sets the bump pointer to the end of the state and reserves `n` bytes for the request. It traps when `n` is over the request maximum.
- `holo_step(offset, length)` requires the region `holo_alloc` just returned; any other offset, or a longer length, traps. It runs the step with the bump allocator, as `@1` does.
- After the entry returns, the shim moves `state'` to the start of the region and the responses right after it (`core::ptr::copy`, which allows overlap), and sets the bump pointer to the end of the responses. Everything else the step allocated is gone.

So at the start of every step the heap holds exactly the state and the request.
The memory a step needs, including the turn copy and every temporary, is a function of `(state, request)`, and a step that exceeds the declared pages traps on every replay of the same history, never on some hosts and not others because of what earlier steps left behind.
That is why this proposal compacts instead of linking a general allocator (#508): with a free-list allocator the heap's shape after step `n` depends on the whole history, and a replay from a different starting point could fail where the original did not.

The state is copied into the turn on every step, so a step costs at least `O(|state|)` in copying.
For a state of tens of megabytes this is milliseconds per step on current engines.
A borrowed-state entry signature in `prod-codegen` would remove the copy; it is a generic compiler change and is left to an upstream proposal (unresolved question 2).

### Bounds

The profile that declares the world (#630) declares these, and the shim is generated from them; none is a constant of the generator:

| Bound | Meaning |
| --- | --- |
| `requestMaximum` | The largest request `holo_alloc` reserves. |
| `stateMaximum` | The largest state the answer may carry. |
| `responseMaximum` | The largest single response. |
| `responseCountMaximum` | The most responses one step may return (1 to 65 535). |
| `coreMemoryPages`, `coreStackBytes` | As in text/2: the exact memory maximum and the LLVM stack. The stack is linked, not exported: the world has exactly three exports, so a `@2` guest carries no `__stack_low` or `__stack_high` export. |

The profile validator refuses bounds whose turn (`4 + stateMaximum + requestMaximum`) and answer (`8 + stateMaximum + responseCountMaximum × (4 + responseMaximum)`) do not fit a 32-bit length or the declared memory.

### The session lifetime

A session is an instance.

| Event | What happens |
| --- | --- |
| Open | The runtime instantiates the compiled guest. The state is empty. |
| Step | `holo_alloc`, copy the request in, `holo_step`, copy the responses out. |
| Trap | The step fails with `core.trap` (or `core.allocation` when the request is over the bound, before any guest code runs). The session ends; the instance is dropped. |
| Close | The runtime drops the instance. Nothing is flushed, because the guest has no effects. |

A later step on a closed session fails with `session.closed` and runs nothing.
Steps of one session are serialized: a step that starts while another is in flight fails with `session.busy`.
Two sessions never share an instance.

### Determinism

The guest imports nothing, so a step can observe only its turn.
The turn is the state and the request, and the state is the fold of the earlier steps over the same empty start.
WebAssembly without imports, threads or floating-point NaN payloads is deterministic, and the generated code has no floating point.
The arena makes resource use per step a function of the turn.
So the responses and the outcome of step `n` are a function of requests `1..n` of the same session, on every conforming engine.
One failure stays outside the model, as it does for `@1`: an engine that cannot grow memory to the declared maximum traps where another would not.
A runtime should reserve the declared maximum when it can; a replay records such a trap as `core.trap`, and the divergence it causes on a larger host is reported, not hidden.

### The runtime (`prism-code`)

`load` reads the world from the application directory as it does today.
For a `@2` guest:

```js
const app = await load(bytes);
app.world.contract;                 // 'hologram:guest/core-wasm@2'
app.world.session;                  // true
const session = await app.open();
await session.dispatch(request);    // Uint8Array[]: the step's responses, in order
for await (const r of session.stream(request)) {}  // the same responses, one at a time
session.steps;                      // steps taken so far
session.close();
app.dispatch(request);              // rejects: PrismCodeError session.required
stateless.open();                   // throws session.unsupported on a @1 application
```

`app.dispatch` is not given a meaning for a session world, because a one-step session would silently drop the state and a caller would not notice.
`stream` yields the responses of one step after the step has run: the guest returns them together, so the iterable is a view, not incremental delivery. Incremental delivery would need the host to call back into the guest mid-step, which this world does not have.

The middleware steps (#295) keep their names; `instantiate` runs once per session and `dispatch` once per step.

### Histories: `prism/history/2`

Schema `sdk/npm/spec/schemas/history/history-v2.schema.json`:

```json
{
  "schema": "prism/history/2",
  "application": "Counter",
  "recordedFrom": { "guest": { "blake3": "…", "sha256": "…" }, "model": { "blake3": "…", "sha256": "…" } },
  "sessions": [
    {
      "steps": [
        { "request": "61", "responses": ["00000001", "61"] },
        { "request": "62", "responses": ["00000002", "6162"] }
      ],
      "failure": { "request": "f4", "error": "core.trap" }
    }
  ]
}
```

- `sessions` holds at least one session, in the order they were recorded.
- A session holds `steps`, each a request and the responses it returned (lowercase hex, possibly none), and optionally `failure`: the request and stable error code of the step that ended it.
- A failure ends its session, so the schema places it after the steps instead of among them, and no prose rule is needed. A session records at least one step or a failure.
- A step refused because its session was already closed, or because another step was running, never reached the guest and is not recorded.
- Digests are as for `/1`: `sha256` and `blake3` over the canonical JSON.

`/1` keeps its meaning and is still read; it is the history of a `@1` holo.
A `/2` history replayed against a `@1` holo, or a `/1` history against a `@2` holo, fails with `ReplayError` `replay.history`, because a session history says nothing about a stateless guest.
`prism/replay/v1` is unchanged: `histories[].events` counts steps across all sessions of a history, and `divergences` counts events whose outcome differs.

### Acceptance

The profile carries its acceptance vectors as ordered histories: `acceptanceSessions`, a non-empty list of sessions, each a non-empty list of `{request, responses}`.
`app.acceptance()` runs each session on its own fresh instance and compares every step's responses byte for byte.
`app.history()` returns them as a `prism/history/2` history, so `prism-code record` writes it and `replay` replays it.
`prism-code vectors` prints one line per session and exits 0 only when every step of every session matches.
`prism-code run <holo> <input>...` runs its inputs as one session, in order, and prints each step's responses.

### What `check` and `verify` do

Nothing new.
The world row makes `world.contract` check the `@2` exports and `world.hash` pin the `@2` digest, and `inspect` prints the row.
`prismpm verify` of a `@2` application runs every acceptance session through the guest.

### Diagnostics and registration

| Code | Where | Meaning |
| --- | --- | --- |
| `session.required` | `prism-code` | `app.dispatch` on a session world. |
| `session.closed` | `prism-code` | A step on a session that was closed or ended by a trap. |
| `session.busy` | `prism-code` | A step while another step of the same session is in flight. The session stays open. |
| `session.unsupported` | `prism-code` | `app.open` on a stateless world. |
| `replay.history` | `prism-code`, `prismpm` | Extended: a history whose schema does not fit the guest's world. |

The capabilities are registered under `HO-44` (the world and its shim) and `HO-45` (session histories and replay), each with its conformance scenario, as AGENTS.md requires.

## Test plan

Tests come first; each failure below has its own negative test, and each guard its planted defect.

- `sdk/npm/spec/test/world.test.mjs`: the `@2` row's digests equal the WIT file's; its exports equal those parsed from the WIT file; the `@1` row and file are byte-identical to `main`.
- `sdk/npm/spec/test/history.test.mjs`: valid `/2` fixtures parse; invalid ones (no sessions, an empty session, an event with both members, an error event that is not last, upper-case hex) are refused, by the schema and by `parseHistory`.
- `sdk/npm/prism-code/test/session.test.mjs`, against an ABI probe guest (a test module that implements the `@2` exports over a trivial state, used only to test the runtime's handling of the ABI, never packaged in a holo):
  - a session keeps state across three steps; two sessions do not share it;
  - zero, one and many responses per step, through `dispatch` and `stream`;
  - `session.required`, `session.closed` after `close` and after a trap, `session.busy`;
  - a request over the bound fails `core.allocation` before the guest runs;
  - a malformed response frame fails `core.response`.
- `sdk/npm/prism-code/test/replay.test.mjs`: a recorded `/2` history replays green; a changed response is one divergence with `DeterminismViolationError`; a `/1` history against a `@2` guest and the reverse fail `replay.history`.
- `crates/prismpm/src/session_guest/tests.rs`: the generated package is a pure function of the declared bounds and the IR; the shim refuses each violated bound (planted defects: a shim with the answer check removed must fail the test that sends an oversized state); the compiled module has exactly the `@2` exports, no imports and the declared memory maximum.
- `crates/prismpm/src/replay/tests.rs`: the Rust replay of a `/2` history writes the same statement as the JavaScript one. This lands with #630, when `prismpm build` first produces a `@2` holo for the Rust CLI to read.
- The acceptance fixture: a generated holo from a LexLean project that keeps a counter and an accumulating buffer across three steps, with its acceptance as one ordered history, passing `prism-code run`, `vectors`, `replay` and `check`. It is built by `prismpm build` from its `.lex.tex` source and lands with #630, the first profile that can declare this world.

## Graduation criteria

- Experimental (M3). The world, its row, the shim generator, the runtime sessions and `prism/history/2` are merged, and the acceptance fixture passes in CI.
- Frozen (M3 freeze). #630 and #631 build on the world with no change to its row.
- Stable (1.0). The world, the frames and `prism/history/2` are final. A change is `@3` or `/3`.

## Precedent

- The Elm architecture and Redux reducers: state is the fold of a pure update over messages. Copied: the step's shape.
- Temporal workflows: deterministic replay of an ordered event history against new code. Copied, through #284: replay compares outcomes, not traces.
- Erlang `gen_server`: a process holds its state between calls, and a crash ends it. Copied: a trap ends the session; the state is never handed out.
- WASI 0.3 resources and streams: a handle with a lifetime, and multiple values over time. Not copied: they need the Component Model, which #278 keeps out.

## Alternatives

- Hand the state to the host on every step and back on the next. Rejected: it moves megabytes through the host per step, through response bounds meant to be small, and lets a host forge a state the model never produced.
- Link a general allocator (`std::alloc::System`, as #508 proposes for `@1`). Rejected for this world: the heap's layout after a step would depend on the whole history, so whether a step traps would too. Compaction keeps a trap a function of the turn.
- Keep `holo_run` as the entry name. Rejected: a `@1` reader would accept the guest's exports by name and run a step as a stateless request.
- A separate `open` root that builds the initial state. Rejected for now: the empty state already gives the model a start, and an extra root is an extra export, an extra frame and an extra failure mode. A profile can add one in a later world if a model needs configuration at open.
- Expose a digest of the state after each step. Deferred (unresolved question 3).

## Unresolved questions

1. `hologram-live` is the `.holo` format authority, and `prismpm verify` runs its independent oracle over every archive. Does its pinned executor accept a `@2` guest, or does the oracle need a `@2` mode upstream first? Until it does, a `@2` application cannot complete `prismpm verify`, though `prism-code check`, `vectors` and `replay` work.
2. The state is copied into each turn. Should `prod-codegen` offer a borrowed-state entry, `(&[u8], &[u8]) -> Bytes`, to remove the copy? It is a generic compiler change and belongs upstream.
3. Should the shim export a digest of the state after each step, so a history could record checkpoints and a replay could start mid-session? It would make a history longer and give the host a fact about the state it does not need today.
4. Proposal 278's first unresolved question reopens now that a second contract exists: should the world digest also be stored in the archive? This proposal keeps the contract name as the only declaration, because the registry still maps one name to one digest.
