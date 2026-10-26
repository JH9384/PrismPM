# Proposal 278: the WIT world as the holo's contract

| | |
| --- | --- |
| Issue | [#278](https://github.com/UOR-Foundation/PrismPM/issues/278) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental |
| Depends on | #263 (`@prism-code/spec`, `worlds/core-wasm.wit`), #264 (`inputs.world` in the lock), #269 (verdict), #271 (`inspect`), #273 (`@prism-code/verify`) |
| Used by | #270 (`prism check`), #279, #283 (world check), #284 (replay) |

## Summary

A holo's guest is a Core-Wasm module, and its contract is a WIT world.
The world says which imports the guest may have and which exports it must offer.
This proposal makes that statement checkable.
`@prism-code/spec` gains a registry of worlds, one row per guest contract, with the world's file, its digests and its imports and exports spelled out.
`inspect` prints the world with its digests.
`holo.verify()` and `@prism-code/verify` check that the guest module really has the declared imports and exports, and that the world matches a pinned world hash.
A mismatch is a typed error, `WorldMismatchError`.
No holo byte changes.

## Motivation

Today the world is a file nobody reads.
`hologram:guest/core-wasm@1` is named in the app manifest, the application directory and the provenance, and `worlds/core-wasm.wit` states it.
The lock pins the file's digests (`inputs.world`, #264).
But no reader compares the guest against the world, and no reader compares the world against the lock.
`inspect` prints a world from a table inside each package that nothing ties to the WIT file.
#283 (is the world within the granted capabilities) and #284 (replay) both need a world they can trust to be what the guest does.
This is the root of M3, so the shape has to be explicit and versioned before they build on it.

### Goals

1. One registry of worlds in `@prism-code/spec`, keyed by guest contract, with the digests of each world file.
2. `inspect` prints the world: contract, WIT package and name, digests, imports, exports, and whether the guest conforms.
3. `holo.verify()` and `@prism-code/verify` fail, with a typed error, when the guest does not conform to its declared world.
4. They also fail when the world's digests differ from a world hash the caller pins, in the shape of the lock's `inputs.world`.
5. A rule for versioning a world, so #279, #283 and #284 can add to it without breaking readers.

### Non-goals

- No change to holo bytes, the app manifest, or any identity. The reference archive stays byte for byte.
- No HTTP, retry or auth semantics. WIT does not carry them; they stay in the outer JavaScript layer.
- No capability checks. A world's imports against granted capabilities is #283.
- No `prism check` verb. #270 will call the functions added here.
- No WebAssembly Component Model. The guest stays an import-free core module; the WIT file describes its core exports through the canonical ABI.

## Proposal

### Where a holo declares its world

A holo declares its world by naming its contract.
The name `hologram:guest/core-wasm@1` already sits in three places the footer covers: the manifest suffix, the directory's wasm layer and `core_wasm_contract` in the provenance.
The world's hash is then a function of that name through the registry.
It is not stored a second time.
With one contract in existence, a stored hash would say nothing the name does not, and it would cost a new format revision and a regenerated reference archive.
The first time a second contract exists, the question reopens (see unresolved questions).

### The registry

`@prism-code/spec` exports one frozen constant, `WORLDS`, by contract:

```js
WORLDS['hologram:guest/core-wasm@1'] = {
  version: 1,
  package: 'hologram:guest@1.0.0',
  world: 'core-wasm',
  file: 'worlds/core-wasm.wit',
  digest: { blake3: '0774a8ec…', sha256: 'a566c87a…' },
  imports: [],
  exports: [
    { name: 'holo_alloc', kind: 'func', params: ['i32'], results: ['i32'] },
    { name: 'holo_run', kind: 'func', params: ['i32', 'i32'], results: ['i64'] },
    { name: 'memory', kind: 'memory' },
  ],
};
```

`version` is the version of this row's shape, not of the world.
`digest` is `{blake3, sha256}` over the bytes of the WIT file, as #264 already fixes; it is the lock's `inputs.world` minus `contract`.
`exports` is in core-module terms a reader can check: the names the canonical ABI gives (`holo-run` is `holo_run`) and the lowered signatures.
`memory` is listed because WIT cannot name an exported memory; the file's header comment states it and the registry makes it data.
The existing `CORE_WASM` constant stays, and a test checks it against the row.

### Versioning a world

A contract name ends in `@N`.
`N` is the world's major version.
Adding an import or an export, removing one, or changing a signature makes a new contract `@N+1` with its own WIT file and its own row.
The row for `@N` is never edited, so a holo built against it keeps verifying.
Any edit to a WIT file, even to a comment, changes its digest and therefore the lock.
That is stricter than needed, and deliberate: the digest names bytes, and a reader never has to decide what a meaningless edit is.

### What `inspect` prints

The `world` member of `prismpm/holo-inspection/1` gains members.
They are additive; no existing member changes.

```json
"world": {
  "contract": "hologram:guest/core-wasm@1",
  "package": "hologram:guest@1.0.0",
  "name": "core-wasm",
  "file": "worlds/core-wasm.wit",
  "digest": { "blake3": "0774a8ec…", "sha256": "a566c87a…" },
  "imports": [],
  "exports": ["holo_alloc", "holo_run", "memory"],
  "conforms": true,
  "capability_set": { "label": "blake3:cf46…", "empty": true }
}
```

For a contract the reader does not know, `package`, `name`, `file`, `digest`, `imports`, `exports` and `conforms` are null.
Today the document schemas fix the contract to `@1`, so a holo of another contract fails `holo.documents` and prints no world at all; the null members are for the day a second schema admits another contract.
`conforms` is read from the guest module's import and export sections alone.
The text output gains the same facts in its World block.
`prism-code` and `@prism-code/verify` print equal inspections, as the agreement test requires today.

### What `verify` checks

Two new checks join the verdict's reasons.

| Check | When it fails | Withholds | Typed error |
| --- | --- | --- | --- |
| `world.contract` | The guest module has an import the world does not list, lacks an export, has an extra export, or an export has another kind or signature. | P1 | `WorldMismatchError` |
| `world.hash` | The caller pinned a world and the holo's world differs from it. | none; `passed` becomes false | `WorldMismatchError` |

`world.contract` is about the archive being what it says it is, like `holo.documents`, so it withholds P1.
`world.hash` is a policy, like `policy.digests.*`, so it never changes the level.
A new policy member `world` carries the pin.
Its shape is exactly the lock's `inputs.world`, so a caller passes `lock.inputs.world` unchanged:

```js
await holo.experimental_verify({ world: lock.inputs.world });
// { world: { contract, blake3, sha256 } }; either digest may be left out
// { world: null } means "no world expected"; a holo always has one, so it fails
```

The pin fails on a different contract, a different digest, or `null`.
The reason's message names the pinned and the actual value.
`WorldMismatchError` has the code `world_mismatch`, carries `check`, and carries the whole verdict, like the other typed errors.
With `throw: true` it is thrown; without it the verdict lists the reason.
Which error a failed verdict throws changes in one place.
Today it is the reason that kept the level down, and every holo is P0, so a pin mismatch would always be hidden behind `provenance.statement`.
A rule the caller pinned and the holo broke, a digest or the world, now comes first: the caller asked for that fact by name.
A level shortfall alone still throws the reason that withholds the level.
`prism check` (#270) will call the same function and map the reason to exit 1, as for every verdict reason.

### Check ids and diagnostics

`world.contract` and `world.hash` are added to the check-id table of `docs/proposals/269-assurance-levels.md` under owner #278.
This proposal registers no `PPxxxx` code; the reasons carry none.
Whether they should is an unresolved question.

### What does not move

`CapabilityDeniedError` and `world.capabilities` stay as #269 defines them, owned by #283.
The Rust code is unchanged.
Its test that recomputes the world digests from the WIT file keeps `inputs.world` honest; a new JavaScript test ties the registry to the same file and to the lock fixture, so the three cannot drift.

## Test plan

In `sdk/npm/spec/test/world.test.mjs`:

- The registry row's digests equal the digests of `worlds/core-wasm.wit`, and equal `inputs.world` in the lock fixture.
- The registry's exports equal the exports parsed from the WIT file.
- The registry's imports and exports equal the reference guest's, read from its binary.
- `CORE_WASM` agrees with the row.

In `sdk/npm/verify/test/world.test.mjs` and `sdk/npm/prism-code/test/world.test.mjs`:

- The reference archive conforms, reports `world.conforms: true`, and passes a pin of `lock.inputs.world`.
- A guest with an extra import, a missing export, an extra export, a changed signature and an export of another kind each fail `world.contract`. These archives are built by rewriting the guest and recomputing every fingerprint, so the only failure is the world.
- A pin with another digest, another contract or `null` fails `world.hash` and leaves the level unchanged.
- `throw: true` throws `WorldMismatchError` with the check id and the verdict, for a pin mismatch even when the level also fails.
- The two packages return equal inspections and equal verdicts for every case.
- A holo of an unknown contract prints no world and fails `holo.documents`; the registry returns null members for it.

Conformance scenarios are registered once #270 exists, in the `AL` family next to AL-04.

## Graduation criteria

- Experimental (M3). The registry, the two checks, `WorldMismatchError` and the `inspect` members are merged. Every reference archive in the tree declares a world and conforms.
- Frozen (M3 freeze). #283 and #284 have built on the registry with no change to a row.
- Stable (1.0). The row shape and the two check ids are final. A change becomes a new row `version`.

## Precedent

- WIT worlds in the Component Model: a world lists imports and exports and nothing else.
- wasmCloud interfaces, which bind a provider to a world by name.
- Cargo's `Cargo.lock` `checksum` field: the file is named by its digest, and a mismatch is a hard error.

## Alternatives

- Store the world digest in the model provenance (`prismpm/model-provenance/2`). It makes the digest self-describing, but it changes the archive's identity, regenerates the reference archive, and repeats what the contract name already determines.
- Make `world.hash` withhold a level. A pin comes from the caller, not from the holo, so it is policy; the level must stay a function of the holo alone (#269).
- Parse the WIT file in the verifier. It would put a WIT parser in every browser build for a file that is one fixed text today. The registry is data that a test checks against the file.
- Use the Component Model's own `wasm-tools component wit` for the guest check. The guest is a core module, not a component.

## Unresolved questions

1. Should the digest also be stored in the archive, once a second contract exists? If yes, in the provenance extension, which needs `prismpm/model-provenance/2`.
2. Should `world.contract` and `world.hash` get `PP56xx` diagnostics, like `PP5602`?
3. The WIT digest covers raw bytes. A Windows checkout can turn LF into CRLF (the Rust and JavaScript tests already normalise). Should the world digest be defined over a normalised form?
4. The issue says both reference archives declare a world. The tree holds one, calculator-example's `Calculator.holo`; the second, from a text application profile, is not here. Is it on a branch, or should this issue close with the second as a follow-up?
