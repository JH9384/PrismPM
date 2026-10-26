# Proposal 268: provenance on by default at `prismpm build`

| | |
| --- | --- |
| Issue | [#268](https://github.com/UOR-Foundation/PrismPM/issues/268) |
| Milestone | M2 v0.5 Lock, check, proof |
| Status | Proposed, Experimental |
| Statement | in-toto Statement v1, predicate type `https://slsa.dev/provenance/v1`, build type `https://uor.foundation/prism/holo-build/v1` |
| Modes | `min` (default, always written), `max` (`--provenance=max`, opt-in), none (`--no-provenance`, unsafe) |
| Depends on | #264 (input lock), #267 (attestation bundle), #274 (dual digests, ADR-015) |
| Blocks | #269 (P1 needs a provenance statement), #270 (`prism check`), #272 (`prism attest` signs it) |
| Reference implementation | JavaScript: `sdk/npm/prism-code/src/provenance.mjs` (this change). Rust: the second change, after the wire model change of #267 merges. |

## Summary

Every holo that `prismpm build` writes carries a SLSA provenance v1 statement about itself, with no flag.
The statement is stored in the holo's attestation section (#267), so it travels with the file.
Its subjects are the four content blobs.
Its `resolvedDependencies` are derived from `prismpm.lock`, its `builder.id` is the SDK image the lock pins, and its `buildType` is `https://uor.foundation/prism/holo-build/v1`.
Minimum mode records only what the lock and the model already say, so two builds of the same inputs write the same statement bytes.
Maximum mode, `--provenance=max`, adds the build arguments, the platform, an invocation id and timestamps, and is opt-in because those leak.
`--no-provenance` exists and is documented as unsafe.
The statement is written unsigned; `prism attest` (#272) signs it.

## Motivation

Provenance that must be asked for is provenance that is mostly absent.
PyPI turned trusted-publishing attestations on by default and had 17% of uploads attested by December 2025; npm kept them opt-in and stalled.
BuildKit made `mode=min` the default and `mode=max` an opt-in for the same reason this proposal does: the rich form can contain secrets passed as build arguments.
Prism's assurance level P1 (#269) means "you know which toolchain built the holo and from which inputs".
That is only a useful promise if every holo has the evidence.

The pieces already exist.
The lock (#264) pins the SDK image, the toolchain, the model, the spec digest, the guest world and the generators.
The bundle section (#267) stores statements inside the holo.
The proof predicate (#266) already names the guest blob as its subject, using both digests.
What is missing is the statement that ties them together, and the rule that every build writes it.

### Goals

- Every built holo carries a provenance statement with no flag.
- The statement is a standard SLSA v1 predicate that SLSA tooling can read, with Prism's build type defining what each member means.
- `resolvedDependencies` is the lock: a verifier reads one statement, not the repository.
- The default statement is deterministic, so the unsigned archive stays reproducible and the statement bytes are testable.
- Nothing that can leak is written unless the user asks for it.
- Turning provenance off is possible, visible and documented as unsafe.

### Non-goals

- Signing. `prism attest` (#272) signs; this proposal writes the statement the signer will sign.
- Verifying. `prism verify` and `@prism-code/verify` (#272, #273) decide what a statement proves.
- Changing the product release provenance of an OCI release (`urn:prismpm:*` rows, `https://uor.foundation/prismpm/build/v1`). That statement is about a different artifact and keeps its format.
- The registry-facing statement signed at push (#267). It names the OCI manifest and is never written into the holo.

## Proposal

1. `prismpm build` appends one provenance statement to the attestation section of every holo it writes, unless `--no-provenance` is given.
2. The statement is an in-toto Statement v1 with `predicateType` `https://slsa.dev/provenance/v1`.
3. Its `subject` is the four content blobs, in this order, named by their build-manifest paths: the guest `core-wasm/<cargo_name with - as _>_core_wasm.wasm`, the view `view/hologram/view.holoview`, the model document `model.prism.json`, and the capability set `application/capability-request.bin`.
   Each digest is exactly `{blake3, sha256}` over the blob content (ADR-015).
4. `predicate.buildDefinition.buildType` is `https://uor.foundation/prism/holo-build/v1`.
5. `predicate.buildDefinition.externalParameters` holds `model`, the model document's digest set, and `spec`, the lock's `inputs.spec`.
6. `predicate.buildDefinition.resolvedDependencies` is derived from `prismpm.lock` by the table below.
7. `predicate.runDetails.builder.id` is the lock's `sdk_image`, an OCI reference pinned by `@sha256:`.
8. Mode `min` is the default. It writes nothing else: `internalParameters` is `{}` and `runDetails` holds only `builder`.
9. Mode `max`, selected by `--provenance=max`, adds `externalParameters.arguments`, `internalParameters.platform`, and `runDetails.metadata` with `invocationId`, `startedOn` and `finishedOn`.
10. `--no-provenance` writes no statement. The command prints a warning that the holo cannot reach P1.
11. The statement is serialized as canonical JSON (keys sorted, no whitespace) and wrapped in an unsigned bundle line, described below.
12. The statement is checked against the lock before it is written: the lock's `inputs.model` must equal the model blob of the archive being described.

## Design details

### Where each member comes from

| Statement member | Source |
| --- | --- |
| `subject[]` | the four content blobs of the archive: BLAKE3 from the blob label's content, sha256 over the same bytes |
| `externalParameters.model` | the model blob's digest set; equal to the lock's `inputs.model` |
| `externalParameters.spec` | the lock's `inputs.spec`, `{basis, blake3}`; absent for a `/2` lock |
| `resolvedDependencies`, `sdk-lock` | the bytes of `prismpm.lock`: `{blake3, sha256}` of the whole file, `mediaType` `application/vnd.prismpm.sdk-lock.v3+json` (`.v2+json` for a `/2` lock) |
| `resolvedDependencies`, `sdk-image` | the lock's `sdk_image`, `uri` the reference, `digest` its sha256 |
| `resolvedDependencies`, `standards-lock` | the lock's `standards_lock`, sha256 |
| `resolvedDependencies`, `world` | `inputs.world`, `uri` the contract, both digests; absent when the model has no application |
| `resolvedDependencies`, one row per tool | `inputs.toolchain`: `lean`, `lexlean`, `prismpm`, `rustc`, `wasm-bindgen`, each `urn:prismpm:toolchain:<name>:<version>` with no digest, because the SDK image digest already pins the bytes |
| `resolvedDependencies`, two generators | `inputs.generation`: `urn:prismpm:generator:application` and `...:library`, sha256 |
| `runDetails.builder.id` | the lock's `sdk_image` |
| `runDetails.builder.version.prismpm` | `inputs.toolchain.prismpm`; absent for a `/2` lock |

The model and the spec are the build's external parameters, so they appear once, not again as dependencies.
Rows are sorted by `uri`, then `name`.
A `/2` lock gives the first three rows and no more; a `/3` lock gives all of them.

The lock row carries both digests.
This answers the fourth unresolved question of #264: rows of this statement are digest sets, because the lock leaves the repository inside the holo.
The product release provenance keeps one digest per row until its verifiers accept two.

### The build type

SLSA says a build type is a URI that resolves to the document defining `externalParameters`, `internalParameters` and `resolvedDependencies` for it.
This document, and `schemas/attestation/provenance-v1.schema.json`, are that definition for `https://uor.foundation/prism/holo-build/v1`.
The existing `https://uor.foundation/prismpm/build/v1` describes an OCI product release and stays as it is.
A holo build and a release build are different procedures with different parameters, so they get different types.

### Minimum and maximum mode

| Member | `min` | `max` |
| --- | --- | --- |
| `externalParameters.model`, `.spec` | yes | yes |
| `externalParameters.arguments` | no | the command line after `prismpm`, as the process received it |
| `internalParameters` | `{}` | `{ "platform": "linux/amd64" }` |
| `resolvedDependencies`, `builder` | yes | yes, identical |
| `runDetails.metadata` | no | `invocationId`, `startedOn`, `finishedOn` (UTC RFC 3339, whole seconds) |

Minimum mode records no path, no name, no time and no argument.
Everything in it comes from the lock, the model and the archive, so it is the same on every machine and on every run.
Maximum mode records the command line because a reviewer sometimes needs it, and a command line can hold a path, a user name or a token passed as a flag; that is why it is opt-in.
`prismpm build` records no environment variable in either mode.

The JavaScript generator refuses to record a max-only member in min mode (`provenance.mode`), so passing arguments without asking for max cannot leak them.

### The unsigned placeholder

A build has no signing identity.
Keyless signing needs an OIDC token and the network; keyed signing needs a key the build does not have.
The statement is therefore written unsigned, and it is written in a form the existing readers already accept.

The bundle line is a Sigstore bundle v0.3 whose `verificationMaterial` is `{ "publicKey": {} }` and whose DSSE envelope carries the statement as payload and one signature with an empty `sig`.
An empty signature verifies against nothing, so no verifier mistakes the placeholder for a signed statement.
`readAttestations` reports it as `signed: false`.
`prism attest` (#272) replaces the line with a signed bundle over the same payload bytes.

This needs one relaxation of the #267 schemas: `signatures[].sig` may be empty.
`dsse-envelope.schema.json` and `sigstore-bundle.schema.json` drop `minLength: 1` on `sig` and say why; every bundle that was valid stays valid, and the test that keeps the two schemas equal still holds.

Consequence for assurance levels (#269): a holo with only the placeholder has a provenance statement but no signed one, so no verifier can say the statement verifies, and the holo reports P0, never P1.
The default build is therefore as strong as the build can make it without a signing identity, and one `prism attest` away from P1.

### Reproducibility

RP-09 compares byte-identical builds, using the unsigned archive that #267's strip rule recovers.
A min-mode statement has no timestamp and no host data, so even the archive that carries the placeholder is byte-identical across builds of the same inputs.
A max-mode archive is not, because of its timestamps; RP-09 compares the stripped archive in both cases.

### The statement is derived from the lock, so a stale lock fails first

`prismpm build` already refuses a stale `inputs` lock (#264, `PP5401`).
The statement adds a second guard: it refuses to describe an archive whose model blob differs from the lock's `inputs.model` (`provenance.lock`).
The two guards agree today and cannot be made to disagree by editing the lock after the model is built.

### Check ids

Failures of statement generation use these ids, raised as `PrismCodeError` in JavaScript:

| Id | Meaning |
| --- | --- |
| `provenance.archive` | the archive footer or a blob label does not verify; nothing is described |
| `provenance.lock` | the lock is missing, is not `/2` or `/3`, names an image not pinned by `@sha256:`, or its `inputs.model` is not this archive's model |
| `provenance.mode` | an unknown mode, or a max-only member given in min mode |
| `provenance.input` | a max member is missing or malformed, or subject names collide |
| `provenance.duplicate` | the archive already carries a provenance statement |

### Command line (second change)

```
prismpm build                      min provenance, written unsigned
prismpm build --provenance=min     the same
prismpm build --provenance=max     adds arguments, platform, invocation id and timestamps
prismpm build --no-provenance      no statement; prints a warning; unsafe
```

`--provenance` and `--no-provenance` conflict.
`--no-provenance` is documented as unsafe because a holo without a statement can never reach P1, and because a pipeline that disables it once has no record of which inputs produced the file.

### Delivery in two changes

This change defines the statement and implements it in JavaScript: the schema and types in `@prism-code/spec`, `provenanceStatement`, `provenanceBundle`, `attachProvenance` and `readProvenance` in `prism-code`, and the golden bytes the Rust side must reproduce (`sdk/npm/prism-code/test/fixtures/Calculator.provenance-min.bundle.jsonl`).
The second change wires emission into the Rust `prismpm build` path once #267's Rust half (the wire model change) lets a holo carry a ninth row, and closes #268.
It cannot start earlier: PrismPM's Rust reader refuses a nine-row archive until that change merges.

### Test plan

In this change, run with `node --test`:

- `sdk/npm/prism-code/test/provenance.test.mjs`: the min statement is SLSA v1 over four blobs with the lock as its dependencies; min is the default, deterministic and records no argument, platform, time or invocation; max adds exactly those members; min refuses max-only members; max refuses missing members; a `/3` lock is read fully and a `/2` lock as far as it goes; a lock that does not match the archive, or is not a lock, is refused with `provenance.lock`; a broken footer is refused with `provenance.archive`; the bundle line equals the stored golden bytes and has an empty signature; attaching adds one last Extension row and leaves rows 0 to 7 byte-identical and stripping returns the original; the statement reads back as min, unsigned, with every subject resolved; attaching is deterministic and a second statement is refused; the stamped holo still loads and replays.
- `sdk/npm/spec/test/provenance.test.mjs`: the constants equal every other table that names the predicate type; the schema fixes the build type; the min and max statements validate; min has none of the opt-in members and max adds exactly them; the subjects equal the calculator's blobs with both digests; every dependency row follows from a member of the `/3` lock fixture; the fixtures equal what prism-code generates; the bundle fixture equals what prism-code writes.
- Fixtures for the predicate schema: valid `min` and `max`; invalid cases for a min with arguments, a max without metadata or platform, a wrong build type, a single-digest model, no dependencies, no builder id, an unknown member and a fractional timestamp.

Conformance scenarios are registered with the Rust change, which is the first that can run them against `prismpm build`.
Reserved: `HO-29` every built holo carries a provenance statement with no flag; `HO-30` the statement's subjects, build type and dependencies equal the lock and the archive; `HO-31` `--provenance=max` adds exactly the members of max mode and min adds none; `HO-32` `--no-provenance` writes no statement and warns.
`HO-23` to `HO-28` are #267's.

### Graduation criteria

- Experimental (M2). This proposal is merged, `@prism-code/spec` carries the schema, and `prism-code` generates and reads the statement with the tests above.
- Frozen (M3). The Rust change is merged: every holo `prismpm build` writes carries the statement, the calculator reference archive is regenerated with it, and HO-29 to HO-32 pass. `prism attest` signs the placeholder in place.
- Stable (1.0). The build type and the min and max member lists are final; a change becomes `holo-build/v2`.

## Precedent

- BuildKit provenance. `mode=min` is the default and `mode=max` is the opt-in that adds build arguments. Copied: the names, the default, and the reason for it. Differs: Prism's `min` is deterministic, because it has no timestamps.
- PyPI trusted-publishing attestations. Default-on attestations reached 17% of uploads by December 2025; npm's opt-in stalled. Copied: on by default, with an explicit way out.
- SLSA provenance v1. Copied exactly: `buildDefinition`, `externalParameters`, `internalParameters`, `resolvedDependencies`, `runDetails.builder`. Differs: the build type is Prism's own, and it fixes what each member holds.
- The existing product release provenance (`crates/prismpm/src/supply_chain.rs`). Copied: builder is the SDK image, the lock is a resolved dependency. Differs: this statement's subjects are the holo's blobs, not an OCI release, and its rows are digest sets.

## Alternatives

- A new Prism predicate type instead of SLSA. Rejected: SLSA tooling reads SLSA v1, and #269 already names `https://slsa.dev/provenance/v1` as the P1 evidence.
- Sign at build with an ephemeral key. Rejected: the key is thrown away, so the signature can never be checked against anything, and a valid-looking signature on an unverifiable statement is worse than an honest empty one.
- Make the statement optional until signing exists. Rejected: the point of default-on is that the statement exists whether or not anyone has set up signing.
- Write the full lock into `externalParameters`. Rejected: the lock's digest already binds every byte of it, and the dependency rows give a verifier what it needs without parsing the lock.
- One mode that always includes arguments. Rejected: arguments can hold secrets, and BuildKit's experience is that `max` as the default leaks them.
- Name subjects by role (`guest`, `view`) instead of build-manifest paths. Rejected: the proof statement (#266) names the guest by its build-manifest path, and a verifier matches subjects across statements by name and digest.

## Prior art

- SLSA Provenance v1 and the BuildKit attestation storage documentation.
- in-toto Attestation Framework, Statement v1.
- PyPI attestations (PEP 740) and trusted publishing.
- `docs/proposals/264-input-lock.md`, `docs/proposals/266-proof-predicate.md`, `docs/proposals/267-attestation-bundle.md`, ADR-015.

## Unresolved questions

1. A build without a committed lock, or with a `/1` lock, has nothing to derive `resolvedDependencies` from. #264 lets such a build proceed. Recommendation: once this ships, `prismpm build` requires a `/2` or `/3` lock to write provenance, and a build without one either binds the SDK first or passes `--no-provenance`; the JavaScript generator already refuses with `provenance.lock`. This changes #264's "builds, as today" row.
2. Is relaxing `sig` in the #267 schemas the right way to carry an unsigned statement, or should the placeholder be a distinct, non-Sigstore line? Recommendation: the relaxation, because it keeps one reader, one line format and one replace-in-place path for `prism attest`.
3. Should `--provenance=max` redact absolute paths in `arguments`? Recommendation: no. Max is for people who accept the leak; redacting would make the record less true.
4. Should the statement name the registry-facing OCI manifest too? No: #267 settles that the statement signed at push does, and the in-holo one never can.
5. Which `invocationId` does max write when the build runs outside CI? Recommendation: a random UUID URN, since the field only has to distinguish runs.
