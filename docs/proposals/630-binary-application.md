# Proposal 630: the binary application profile, with inputs referenced by digest

| | |
| --- | --- |
| Issue | [#630](https://github.com/UOR-Foundation/PrismPM/issues/630) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental. Two maintainer decisions are open (unresolved questions 1 and 2). |
| Depends on | #629 (the session world), #278 (worlds), #284 (histories), SPEC section 3 (Holo/1) |
| Used by | #631 (host effects for guests) |
| Coordinates with | #530 and #516 (`prismpm/binary-program/1`, a raw-file command line, draft) |

## Summary

A profile beside the text profiles, `prismpm/binary-application/1`, for applications whose requests and responses are bytes with no UTF-8 rule.
A request may name large inputs by content address instead of carrying them.
The runtime resolves each name to bytes from a store, checks both digests, and only then gives the guest the bytes; a mismatch is a typed error and the guest never runs.
The model declares every bound, the request, the response, the number and size of inputs and their total, the guest's memory pages and stack, and the session bounds when the profile declares the session world of #629.
Acceptance vectors keep their discipline: each names its inputs by digest, and the model carries the input bytes the vectors need, so `vectors`, `check` and `replay` run offline.

## Motivation

The text profiles carry one bounded UTF-8 line each way and grant nothing else.
A model runner takes tensors in and gives tensors out, and its largest inputs (weights, vocabularies) are hundreds of megabytes.
Carrying them in every request would make histories as large as the model and replays as slow as downloads.
Named by digest, an input is a few dozen bytes in the history and the same bytes on every replay, because a digest names exactly one byte string.

### Goals

1. Binary requests and responses with model-declared bounds.
2. Inputs by content address, BLAKE3 and SHA-256 together as everywhere in Prism (ADR-015), resolved and checked by the host before the guest sees them.
3. Memory limits declared in the model and checked in the guest binary, as text/2 does.
4. One profile for both worlds: `core-wasm@1` (one request, one response) and `core-wasm@2` (sessions).
5. Acceptance vectors and histories that name inputs by digest.

### Non-goals

- Fetching inputs from the network. #631 adds `net.fetch-range`; here inputs come from a store the caller fills.
- A browser workbench for binary data (see unresolved question 2).
- The command-line program of #530. That profile is a raw-file CLI around a native library; this one is a holo guest. They can share the `Bytes -> Bytes` root.

## Proposal

### The declaration

`Foundation.Binary.Application.V1.Model.BinaryApplication`, profile `prismpm/binary-application/1`, projected as `prismpm/model-document/8`.
It keeps the package metadata, library roots, entry root, layers and fat-archive intent of a text application and replaces the text-specific fields:

| Field | Meaning |
| --- | --- |
| `coreContract` | `hologram:guest/core-wasm@1` or `hologram:guest/core-wasm@2`. |
| `requestMaximum`, `responseMaximum` | Bytes of the request payload and of one response, 1 to 64 MiB. |
| `inputCountMaximum` | Inputs one request may name, 0 to 64. |
| `inputMaximum`, `inputTotalMaximum` | Bytes of one input and of all inputs of a request, up to 1 GiB. |
| `coreMemoryPages`, `coreStackBytes` | As in text/2; required here. The resolved frame (below) must fit. |
| `session` | `none` for `@1`; for `@2`, `stateMaximum`, `responseCountMaximum` (#629). |
| `acceptanceVectors` | For `@1`: `{request, inputs, response}`; `inputs` lists digests. |
| `acceptanceSessions` | For `@2`: ordered sessions of `{request, inputs, responses}` steps. |
| `acceptanceInputs` | The bytes of every input a vector names, each at most 1 MiB, so acceptance runs offline. |

Every bound is model data; none is a constant of the generator.
The validator (`PP2027`, a new code) refuses a declaration whose resolved frame cannot fit the declared memory, a vector that names an input `acceptanceInputs` does not hold, an input whose bytes do not hash to the digest that names it, and a session member that disagrees with the contract.

### Requests and the resolved frame

A request is a reference table and a payload, all integers big-endian `u32`:

```text
request  = count, count × (blake3[32], sha256[32]), payload
resolved = count, count × (blake3[32], length, bytes),  payload
```

The runtime turns `request` into `resolved` before the guest sees anything:

1. it parses the table, refusing more than `inputCountMaximum` names (`input.count`) or a payload over `requestMaximum` (`core.allocation`);
2. it looks each BLAKE3 digest up in the store and refuses an absent one (`input.missing`);
3. it computes both digests of the bytes it found and refuses a mismatch in either (`input.digest`, a `DigestMismatchError`);
4. it refuses an input over `inputMaximum` or a total over `inputTotalMaximum` (`input.limit`).

Only then is the resolved frame written into the guest.
The guest sees each input's BLAKE3 digest beside its bytes, so a model can key a cache by it, and it can trust that the bytes are the ones named, because the host checked them and the history names them.
A history records the request, references and all, never the input bytes: replay resolves the same names from a store and gets the same bytes or a refusal.

### Stores

`load(bytes, { inputs })` takes a store: a map from BLAKE3 digest to bytes, or an object with `get(digest)`.
`prism-code/node` provides a file store, `$PRISM_HOME/blobs/blake3/<hex>`, written by `prism-code inputs add <file>`, which prints the reference.
The model's `acceptanceInputs` form a store of their own, used by `vectors`, `check`, `history` and `record`.
A store is not trusted: every read is checked against both digests.

### The holo

The format revision that admits this profile is a new dated revision.
It admits `prismpm/model-document/8`, the `@2` contract in the application directory and the provenance, and nothing else; every existing archive keeps its revision and its bytes.
Its conformance scenario holds the new document schema, the contract in both places, and the refusal of a `@2` contract under the old revision.

### The acceptance fixture

`tests/fixtures/holo/ho-46-binary-dot/project`, a LexLean 1.2 project whose root reads two inputs as signed bytes and answers their dot product as a big-endian `i32`, with checked arithmetic.
Its vectors name two 4 KiB tensors by digest; `acceptanceInputs` carries them.
A test flips one byte of one tensor in a copy of the store and requires the vector to fail with `input.digest` before the guest runs.
Until LexLean has arrays (in progress in the LexLean repository), the root reads the inputs as `Bytes` with indexed access and a fuel-bounded loop; the switch to arrays changes the root's source and nothing in this profile.

## Test plan

- `sdk/npm/spec`: `model-document-v8` with valid and invalid fixtures; the new format revision; a scenario in `@prism-code/conformance` for the revision.
- `crates/prismpm/src/holo/binary_application/tests.rs`: every refusal of `PP2027`, each with a negative fixture under `tests/negative/binary-application/`.
- `sdk/npm/prism-code/test/inputs.test.mjs`: resolution, both digests, every `input.*` refusal, a store that lies is caught, the guest never runs on a refused request (a counting middleware proves it), histories name inputs and replay from a store.
- The fixture, built by `prismpm build`, passing `prism-code run`, `vectors`, `replay` and `check`; the flipped byte fails.
- Planted defect: a resolver that checks only BLAKE3 must fail the test whose reference carries the right BLAKE3 and a wrong SHA-256.

## Graduation criteria

- Experimental: the profile, the revision, the resolver and the fixture are merged; `prismpm verify` accepts the fixture.
- Frozen: #631 declares its effects in this profile with no change to it.
- Stable: the declaration, the frames and the `input.*` codes are final.

## Precedent

- OCI and Git: content named by digest, verified on read, never trusted because of where it came from.
- Bazel remote execution: actions name their inputs by digest; a cache lookup is verified.
- The text profiles of this repository: every bound is model data and acceptance vectors are part of the model.

## Alternatives

- Inputs as content blobs of the holo. Rejected for large inputs: the holo would be as large as the model and could not be shared without it. The fixture's small inputs are carried in the model document instead, which needs no format change beyond the new document schema.
- One digest. Rejected: Prism names everything by BLAKE3 and SHA-256 (ADR-015), and the second digest is what keeps a collision in one algorithm from being enough.
- Let the guest verify digests. Rejected: it would put a hash in every guest, and a guest cannot refuse before it runs.
- Extend `prismpm/binary-program/1` (#530). It is a native command-line profile with no guest and no holo; they solve different problems and can share a root.

## Unresolved questions

1. **Maintainer decision: the format authority.** `hologram-live` defines the `.holo` format, and `prismpm verify` runs its independent oracle over every archive. Does its pinned executor accept a `@2` guest and a `model-document/8` application, or must it change first? Until it does, a binary application can be built, run, replayed and checked, but not verified.
2. **Maintainer decision: the View.** Holo/1 has a View layer. A binary application has no text to show. Options: (a) a generated static View that describes the application and its acceptance and runs nothing (keeps the archive's shape; recommended); (b) an archive without a View layer, which the composer and possibly `hologram-live` would have to admit.
3. Should the file store be shared across applications (one `$PRISM_HOME/blobs`), as proposed, or scoped per application?
4. The document number: `model-document/8` assumes no other open pull request lands a `/8` first (#530, #495 and #201 each add their own `/7`, already taken on `main` by the server profile).
