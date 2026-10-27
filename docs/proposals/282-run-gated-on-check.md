# Proposal 282: `prism run` gated on `check`

| | |
| --- | --- |
| Issue | [#282](https://github.com/UOR-Foundation/PrismPM/issues/282) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental |
| Depends on | #270 (`check <holo>`, the verdict), #279 (capability sets), #283 (world within the grant, purity) |
| Used by | #288 (`prism dev`), #350 (long-running holos) |

## Summary

`prism-code run <app.holo>` judges the holo with `check` before it instantiates anything.
The judgement uses the policy (`--policy`, default P2) and the capability set the holo will run under (`--capabilities`, `--capability-set`).
A failing verdict refuses to start: exit 1, with the verdict on stderr.
No verdict refuses with exit 2.
`--allow-unverified` starts it anyway and prints a warning on every start; it is never the default.
A policy gains `effects`, the impure effects the world may import; `effects: []` is the pure-world policy.

## Motivation

`run` instantiated any holo that compiled.
`check` (#270) now reaches a verdict, #279 grants capabilities and #283 judges the declared world against the grant and reports its purity.
The issue asks that `run` use all three: only a checked holo runs, only with the imports its grant allows, and a pure-world policy refuses a holo importing clock or random unless the policy grants it.

## Proposal

### The gate

| Situation | `run` does | Exit |
| --- | --- | --- |
| Verdict passes the policy | starts, and prints `check: passed, <level>, policy <name>` | serves |
| Verdict fails the policy | prints the verdict to stderr and refuses | 1 |
| No verdict (unreadable or invalid policy, not a holo, unknown format revision) | prints why and refuses | 2 |
| A closure directory | refuses: a closure has no section table, so `check` cannot judge it | 2 |
| Any of the three refusals, with `--allow-unverified` | prints `warning: …; running it unverified` and starts; the start line says `check: NOT PASSED, running unverified` | serves |

The verdict is `check`'s, so `run`, `check`, `holo.verify()` and `@prism-code/verify` cannot disagree.
`run` passes `check` the capability set it will run under, so `world.capabilities` (#283) judges the real grant.
A policy file never grants capabilities; only the caller does.

The capability set is still enforced at load (`capabilities.import`, `world.capabilities`), so `--allow-unverified` relaxes the verdict only.
It never grants an import the set does not allow.

### `effects`

A policy may list the impure effects the world may import, from the effect names of #283: `clock`, `random`, `socket`, `filesystem`, `unknown`.

- Absent: any effect is allowed. This is the default, so no existing policy changes meaning.
- `[]`: the pure-world policy. A world importing any impure effect fails it.
- `["clock"]`: the clock is granted; random, sockets, the filesystem and unknown imports are not.

A world importing an effect the list does not hold adds the reason `policy.effects` and fails the policy.
Like every policy rule, it withholds no level.
A malformed list (an unknown name, a repeat, not an array) gives no verdict: `policy.invalid`.

### What this breaks

Every holo is P0 until holos carry signed statements (#267, #268), and the default policy requires P2.
So under the default policy `run` refuses every holo today.
The remedy is explicit: `--policy` with a policy that accepts the holo (for example `{"minimum": "P0"}`), or `--allow-unverified`.
This is the issue's requirement ("an unchecked holo is refused"), and a default that silently ran unverified holos would be the hole the gate exists to close.

## Test plan

`sdk/npm/prism-code/test/run-gate.test.mjs`:

- The reference archive under the default policy is refused with exit 1, the verdict on stderr, and nothing on stdout.
- Under `{"minimum": "P0"}` it runs, and the start line says `check: passed, P0`.
- With `--allow-unverified` it runs, with the warning naming the failing checks, and the start line says it is unverified.
- An unreadable policy and an invalid `effects` exit 2.
- A closure is refused without the flag.
- `effects: []` passes the reference archive (no imports). On world rows with a clock and a random import, `worldWithinGrant` and `effectsOutsidePolicy` (the functions `verify()` uses) refuse each under `[]` and allow it when granted.
- `policy.effects` validation, and `run` judging the `--capabilities` set.

The two existing `run` tests now pass a P0 policy, or `--allow-unverified` for the import guest whose link refusal they assert.

No world with imports exists yet, so no holo that fails `policy.effects` can be built from the tree.
The negative cases run on world rows through the same functions; the end-to-end case lands with the first `@2` world, as for #283.

## Graduation criteria

- Experimental (M3): as described.
- Frozen (M3 freeze): #288 (`dev`) reuses the gate; `effects` and `policy.effects` unchanged.
- Stable (1.0): the gate's exit codes, `--allow-unverified` and `effects` are final.

## Precedent

- `docker run` with content trust: an unsigned image is refused unless trust is disabled.
- `wasmtime run --dir --env`: a component gets exactly the resources named on the command line.
- Deno: deny by default, an explicit flag per permission.

## Alternatives

- Warn but run by default. The issue says refused, and a warning nobody reads is not a gate.
- Default the policy to P0 for `run` only. Two defaults for one verdict would make `check` and `run` disagree about the same holo.
- Put purity in the capability set. Purity is about what a replay can reproduce, which is a policy question, not an operator grant; it stays beside `minimum` in the policy.

## Unresolved questions

1. Should `prism.toml` (#280) name a policy file, so `run` in a project picks it up without `--policy`?
2. Should `--allow-unverified` refuse to run in CI (`CI=true`) unless also forced, so a pipeline cannot ship an unverified holo by accident?
3. Should `policy.effects` get a `PP` diagnostic next to `PP5601` and `PP5602`?
