# Proposal 283: the static world-within-policy check

| | |
| --- | --- |
| Issue | [#283](https://github.com/UOR-Foundation/PrismPM/issues/283) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental |
| Depends on | #278 (`WORLDS`, the world as contract), #279 (capability sets), #269 (verdict, `world.capabilities`, `PP5602`) |
| Used by | #270 (`prism check`), #282 (`prism run` gated on check), #284 (replay; the purity flag, VER-09) |

## Summary

Before a guest is instantiated, compare the imports of the world it declares with the capability set it is granted and with the policy.
A world importing a capability kind the grant gives none of fails `world.capabilities` (`PP5602`), the check #269 reserved for this issue.
A world with no clock, random, socket or filesystem import is pure, and so replayable; the check reports that next to its result.
The check is one function in `@prism-code/verify`, `worldPolicy`, which `verify()`, `holo.verify()` and the runtime's load all call.

## Motivation

#279 made the grant data and enforces it at link time, one import at a time.
That enforcement is dynamic: it needs a compiled module, and it cannot be judged by `check` without running anything.
#269 defined `world.capabilities` and made it part of the default policy ("P2 or above, and the declared world within the granted capabilities"), but nothing computes it.
#284 needs to know, before it records a history, whether the world can see anything a replay cannot reproduce.

### Goals

1. One static check, from the world's declared imports and the grant, before any instance exists.
2. The verdict's `world.capabilities` reason with `PP5602`, withholding P3, failing the default policy at every level (#269).
3. The same check in `@prism-code/verify` (`verify`), in `holo.verify()`, and in the runtime before compiling a guest (the gate `prism run` reuses, #282).
4. A purity flag with the effects that stop it, readable by #284.

### Non-goals

- The holo's own requested capability set (the `capability-set` blob). Every holo today carries the empty constant; comparing the requested set with the granted one needs a decoded format, which does not exist yet (unresolved question 2).
- A `prism check` verb. #270 owns it (open PR #368) and will call `verify()` with `policy.capabilities`.
- A verdict member for purity. That needs `prism/verdict/2` (#269 unresolved question 2); purity is reported by `worldPolicy`, `app.world` and `inspect`.
- Per-resource static checks. A world names interfaces, not hosts; whether a given host is allowed stays a run-time check (#279's `assert`).

## Proposal

### The rule

A `WORLDS` row (#278) lists the world's imports.
Each import names the capability kind it uses in a `capability` member (`outbound-hosts`, `key-value-stores` or `variables`), as #279 proposed for the first world with imports.
The world is within the grant when, for every import:

- the import names a kind, and
- the set grants at least one resource of that kind: an `allow-` entry that no `deny-` entry names, and no `deny-` entry matching everything (`*` or `*://*`).

This is #279's link rule, applied to the declared world instead of the compiled module, so the static and dynamic answers agree.
An import that names no kind can never be granted.
`hologram:guest/core-wasm@1` has no imports, so it is within every grant, including none.

### Purity

Each import is classified by its interface:

| Effect | Imports |
| --- | --- |
| `clock` | `wasi:clocks/*`; WASI 0.1 `clock_*` |
| `random` | `wasi:random/*`; WASI 0.1 `random_get` |
| `socket` | `wasi:sockets/*`, `wasi:http/*`; WASI 0.1 `sock_*`, `poll_oneoff` |
| `filesystem` | `wasi:filesystem/*`; WASI 0.1 `fd_*`, `path_*` |
| `none` | WASI 0.1 `proc_exit`, `proc_raise`, `sched_yield`, `args_*`, `environ_*` |
| `unknown` | anything else |

A world is pure when no import is `clock`, `random`, `socket`, `filesystem` or `unknown`.
`unknown` counts as impure because nothing says what the host behind it returns: assuming purity would let a replay pass on a world that reads the time through a custom interface.
`effects` lists the impure effects, sorted and without repeats.

### Where it runs

| Place | Input | Result |
| --- | --- | --- |
| `@prism-code/verify` `verify(bytes, policy)` | `policy.capabilities`: one capability set, or `null` (default) | a `world.capabilities` reason, `PP5602`, withholds P3, `passed: false` |
| `@prism-code/verify` `worldPolicy(contract, set)` | contract and set | `{ known, within, problems, pure, effects }` |
| `prism-code` `load` / `loadArchive` / `fromFile` | the grant the holo is loaded with | `CapabilityDeniedError` (`world.capabilities`) before `compileGuest`; `app.world` on success |
| `holo.experimental_verify(options)` | defaults `capabilities` to the loaded grant | as `verify` |
| `inspect` | none | `world.pure`, `world.effects` (additive members of `prismpm/holo-inspection/1`) |

`errorFromVerdict` names `world.capabilities` before a level shortfall, because the default policy requires it at every level.
`policy.capabilities` takes one set, not a file: the caller (the runtime, `prism check`, `prism run`) has already chosen the set, by `--capability-set` or by `prism.toml` (#280).
A set of the wrong shape (an unknown member, a list that is not strings) gives no verdict: `VerifyError` `policy.invalid`.
The entries' syntax stays the runtime's to check (`parseCapabilities`), so the browser verifier does not grow a second copy of it.

## Test plan

- `sdk/npm/verify/test/world-policy.test.mjs`: each classification; purity with repeats and `unknown`; a world with no imports within every grant; a kind granted, denied wholesale, and cancelled by a deny; an import with no kind; the set shape check; `worldPolicy` on the reference contract and an unknown one; the reference archive's verdict unchanged under any grant; `policy.capabilities` of the wrong shape refused.
- `sdk/npm/verify/test/world.test.mjs` and the inspection goldens of both packages: `pure: true`, `effects: []` for the reference archive; null for an unknown contract.
- `sdk/npm/prism-code/test/world-policy.test.mjs`: `app.world` for the reference archive under several grants; `CapabilityGrant.members`; `holo.experimental_verify` using the loaded grant; `world.capabilities` mapping to `CapabilityDeniedError` and taking precedence in `errorFromVerdict`; the `prism-code run` world line.

No world with imports exists, so a holo that fails `world.capabilities` cannot be built from the tree today.
The negative cases run against `worldWithinGrant` with world rows built in the test; the verdict and load paths that raise the reason share that function.
When the first `@2` world lands, its reference archive adds the end-to-end negative case.

## Graduation criteria

- Experimental (M3): merged as described.
- Frozen (M3 freeze): #270 and #282 call `verify()` and the load gate with no change; #284 reads `pure`.
- Stable (1.0): `world.capabilities`, `PP5602`, `policy.capabilities` and the effect names are final.

## Precedent

- Component Model static analysability: a component's imports are known before instantiation, and components cannot export memory.
- Spin and wasmCloud: a component's declared interfaces are matched against granted capabilities before it runs.
- Deno and Tauri: deny by default, and a deny entry always wins.

## Alternatives

- Check at link time only (#279). It needs a compiled module, and `check` could not judge a holo without compiling it.
- Treat `unknown` imports as pure. A custom interface could read the clock and replay would still pass.
- Put purity in the verdict now. It needs `prism/verdict/2`; #284 can read it from `worldPolicy` until then.

## Unresolved questions

1. Should `PP5601` and `PP5602` be registered in `model/errors.toml` now, with the reason that raises `PP5602` merged here, or wait for the Rust `prism check`? (#269 question 1.)
2. When the `capability-set` blob carries a real set, should the check also require the world's imports to be within what the holo requests, not only what is granted?
3. Should purity become a verdict member (`prism/verdict/2`) or stay in `inspect` and `worldPolicy`? (#269 question 2.)
4. Which WIT interfaces carry the three capability kinds in the first `@2` world (#279 question 1)? The classification table assumes the WASI 0.2 names.
