# Proposal 264: full input lock in `prismpm.lock`

| | |
| --- | --- |
| Issue | [#264](https://github.com/UOR-Foundation/PrismPM/issues/264) |
| Milestone | M2 v0.5 Lock, check, proof |
| Status | Proposed, Experimental |
| Lock schema | `prismpm/sdk-lock/3` (bump from `/2`) |
| Depends on | #263 (`@prism-code/spec`), #274 (dual digests, ADR-015) |
| Feeds | #267 (attestation bundle), #268 (provenance at build) |

## Summary

`prismpm.lock` today pins one thing: the SDK image, by digest, with its platform inventories.
It does not say which model was built, from which sources, against which guest world, by which generator.
This proposal adds one object, `inputs`, to the lock and bumps its schema to `prismpm/sdk-lock/3`.
`inputs` pins the toolchain versions inside the image, the model document digest, a spec digest over the authored sources, the Core-Wasm world hash and the generator identities.
`prismpm build` recomputes `inputs` and refuses to run when the committed lock disagrees, unless the user passes `--update`.
Because the product release provenance already names the lock file by digest, every pinned input becomes part of the attestation subject's dependency closure with no new provenance field.

## Motivation

A lock exists to answer one question without running anything: what exactly went into this build?
Today's lock answers it for the SDK and nothing else.
Two builds with the same lock can come from different models, and nobody can tell from the repository.

The Prism SDK roadmap needs that answer in three places.
First, a build should be skippable when nothing changed, and a committed fingerprint of the inputs is what tells it so.
Second, the attestation bundle (#267) and build provenance (#268) need a single committed document that binds the inputs, so a verifier can check one digest instead of rebuilding.
Third, a reviewer reading a pull request should see in the lock diff that the model changed, the way a reviewer sees a `Cargo.lock` change.

### Goals

- Pin every input that changes the generated artifacts: SDK, toolchain, model, authored sources, guest world, generator.
- Make a stale lock a hard error on `prismpm build`, with an explicit `--update` to refresh it.
- Keep every existing SDK-lock rule, reader and digest unchanged for the SDK fields.
- Keep `/1` and `/2` locks readable, with a clear upgrade path.
- Put the lock digest where provenance consumes it.

### Non-goals

- Skipping the LexLean compile when inputs match. Outputs are already reused by content address (`.prism/build/<id>`); skipping the compile itself is a follow-up once the build id can be predicted from `inputs`.
- Changing how SDK updates are proposed and reviewed. `prismpm lock update` and `lock migrate` keep their proposal-only behavior.
- Defining `prism.toml`, the intent format or the examples format. This proposal only reserves how the spec digest covers them.

## Proposal

The lock keeps every `/2` field byte for byte and gains one required object:

```json
{
  "inputs": {
    "generation": { "application_generator_sha256": "…", "library_generator_sha256": "…" },
    "model": { "blake3": "…", "sha256": "…" },
    "spec": { "basis": "model-sources", "blake3": "…" },
    "toolchain": { "lean": "v4.32.1", "lexlean": "0.3.0", "prismpm": "0.3.0", "rustc": "1.97.1", "wasm_bindgen": "0.2.122" },
    "world": { "blake3": "…", "contract": "hologram:guest/core-wasm@1", "sha256": "…" }
  },
  "platforms": [ "… unchanged from /2 …" ],
  "schema": "prismpm/sdk-lock/3",
  "sdk_image": "… unchanged …",
  "sdk_index": "… unchanged …",
  "sdk_version": "0.3.0",
  "standards_lock": "… unchanged …"
}
```

A `/3` lock minus `inputs`, with `schema` set to `prismpm/sdk-lock/2`, is a valid `/2` lock.
PrismPM reads a `/3` lock by validating it as `/3`, then validating that `/2` projection with every existing platform and OCI index rule.
Every SDK consumer (inventory comparison, exporter seed authority, product release, publication context) receives the projection and is unchanged.

The build computes `inputs` from the project and compares it with the lock.
On a match it proceeds.
On a mismatch it fails with `PP5401` and names the changed fields, for example `inputs.model, inputs.spec`.
`prismpm build --update` writes the recomputed `inputs` into `prismpm.lock` and continues.

## Design details

### Field reference

| Field | Value | Source | Digest rule |
| --- | --- | --- | --- |
| `sdk_image`, `sdk_index`, `platforms`, `standards_lock`, `sdk_version` | As in `/2` | `prismpm lock update` | sha256 only (OCI identity) |
| `inputs.toolchain.lean` | `v4.32.1` | LexLean's pinned Lean toolchain (`tools.lock` `[lean]`) | version string |
| `inputs.toolchain.lexlean` | `0.3.0` | the vendored LexLean compiler version | version string |
| `inputs.toolchain.prismpm` | `0.3.0` | the running PrismPM version | version string |
| `inputs.toolchain.rustc` | `1.97.1` | `tools.lock` `[rust]` | version string |
| `inputs.toolchain.wasm_bindgen` | `0.2.122` | `tools.lock` `[sdk-tools]` `wasm_bindgen_cli` | version string |
| `inputs.model` | `{blake3, sha256}` | the model document `model.prism.json` the build writes | dual |
| `inputs.spec` | `{basis, blake3}` | the authored sources, defined below | BLAKE3 only |
| `inputs.world` | `{blake3, contract, sha256}` or `null` | the WIT world of the application's `core_contract`; `null` for a model with no application | dual |
| `inputs.generation` | two sha256 hex identities | the application and library generator identities the build manifest already records | sha256, as in `prismpm/build-inputs` |

The toolchain versions are not new trust: the SDK image digest already pins their bytes.
They are recorded so a reader, a reviewer and an attestation consumer can see the compilers without decoding the image inventory.
PrismPM compiles these strings in; a Rust test checks them against `tools.lock` and the vendored LexLean, so they cannot drift.

PrismPM has no user-set generation options today.
Every generation choice is fixed by the generator, so `generation` records the generator identities.
They change whenever PrismPM's generator code changes, even at the same version number, which is exactly when regeneration is needed.
When `prism.toml` gains generation options, they join this object under a further schema bump.

### Digest rules

ADR-015 fixes the rule this lock follows: a digest that names an artifact leaving the repository is a DigestSet, exactly `{blake3, sha256}` in lowercase hex over the same bytes.
The model document leaves the repository inside the build tree, the `.holo` extension and the OCI release, so `inputs.model` is dual.
The world file is published in `@prism-code/spec`, so `inputs.world` is dual.
The spec digest names a set of files that never leaves the repository as one artifact, so it is BLAKE3 only.
The SDK image is an OCI index; registries identify it by sha256, so it stays sha256 as in `/2`.

One place does not yet follow the rule: the provenance dependency row for the lock itself is sha256 only.
PrismPM's provenance verifiers accept exactly one digest per `resolvedDependencies` row today.
Making that row dual belongs to #268, which owns the provenance format.

### Spec digest

The spec digest fingerprints what a human authored, as opposed to the model document, which is what the compiler produced.
It is computed over a file set chosen by one rule.

When `prism.toml` exists at the project root, `basis` is `prism-toml` and the set is `prism.toml`, `intent.md`, and every regular file under `examples/` and `types/`, where those exist. #325 settled this set, replacing the `intent/` directory reserved here.
Otherwise `basis` is `model-sources` and the set is the model's own sources: `prismpm.toml`, the LexLean project file it names, the LexLean lock that file names, and every `*.lex.tex` file under each LexLean source root that does not start with `.`.
Source roots under `.prism/` hold SDK-installed standard library inputs; the SDK lock already binds those.

The digest is BLAKE3 over a framed encoding.
The hasher first absorbs the ASCII string `prismpm/spec-inputs/1` followed by one line feed, 22 bytes in all.
Then, for each file in bytewise order of its project-relative path with `/` separators: the path length as a big-endian u32, the path bytes, the content length as a big-endian u64, the content bytes.
Symlinks, paths that escape the root, and non-UTF-8 paths are refused.

For the calculator example (five files, `basis` `model-sources`) the spec digest is `981eff9742ded9005be7b324263b097a7d47b03783274faa8cc58c121ccb8e1f`.
Its model document digests are BLAKE3 `e76544838a98c46341ed8807f72897ec68de5a8a9bf28721738a76761c9df90e` and sha256 `074921890f5c372c89f4ed794d26dd550231d5e9bf99bf9474cc1a78923292c6`; the sha256 equals the `model_id` in its build manifest.

### World hash

The world is the WIT file that defines the guest contract named by the model's `application.core_contract`.
Today there is one contract, `hologram:guest/core-wasm@1`, and its world is `worlds/core-wasm.wit` in `@prism-code/spec`.
PrismPM compiles in the digests of that file, and a Rust test reads the file and checks them.
For the file as committed today they are BLAKE3 `0774a8ecbfa945a427712ee7d7ad406195b2d07492ceae15cca0067276c9ced8` and sha256 `a566c87a359cadf98f652747f1b3574aa307ff5f652a190c6d99c350db9cf369`.
A model with no application (a library or a system model alone) has `world: null`.

### Staleness and `--update`

Every command that builds checks the lock: `prismpm build`, `prismpm build -t` and `prismpm verify`.
The check runs after the model is projected and before LexLean compiles, so a stale lock fails fast and writes nothing.

| Committed lock | `prismpm build` | `prismpm build --update` |
| --- | --- | --- |
| absent | builds, as today | refused: bind the SDK first |
| `/1` | builds, as today | refused: run `prismpm lock migrate` first |
| `/2` | builds, as today | adds `inputs`, writes a `/3` lock |
| `/3`, inputs match | builds | builds, lock unchanged |
| `/3`, inputs differ | refused with `PP5401`, changed fields named | rewrites `inputs` only |

`--update` is accepted only without `-t` and conflicts with `--locked`.
A product release build must come from a committed lock, so it never rewrites one.
`--update` changes `inputs` and the `schema` field and nothing else; the SDK fields keep their proposal-and-review flow.
The write is atomic: a temporary file in the project root is renamed over `prismpm.lock` after the original bytes are confirmed unchanged since they were read.

SPEC section 12 says ordinary commands never update locks.
That rule stands: `--update` is an explicit request, and it never touches the reviewed SDK fields.
SPEC gains one paragraph saying so.

### Reading old locks and migration

`/1` and `/2` stay valid exactly as before; no reader silently promotes them.
The upgrade path is `/1` to `/2` through `prismpm lock migrate` (unchanged), then `/2` to `/3` through `prismpm build --update`.
`prismpm lock check` prints the full `/3` value.
`prismpm lock update` on a `/3` lock proposes against its `/2` projection; adopting that proposal yields a `/2` lock, and the next `prismpm build --update` pins the inputs again under the new SDK.

### Provenance

The product release already stores `prismpm.lock` as an OCI layer and names it in the SLSA provenance as `urn:prismpm:sdk-lock` with the sha256 of the file's bytes.
With a `/3` lock those bytes include `inputs`, so the provenance `resolvedDependencies` binds the full input lock with no format change.
The lock digest is therefore where #268 will consume it.

### Contract registration

`prismpm/sdk-lock/3` is a new closed contract: `schemas/sdk-lock-v3.schema.json`, media type `application/vnd.prismpm.sdk-lock.v3+json`, the same size bounds as `/2`, `exact-major`.
It is registered in `model/contracts.toml`, the runtime contract table, `CONTRACTS.md` and `@prism-code/spec`, where `schemas/documents/sdk-lock-v3.schema.json` is a byte-identical copy and `SdkLockV3` is generated from it.

### Relationship to sibling work

#267 and #268 consume the lock digest; neither needs a new lock field.
#266's proof predicate names the model by digest; `inputs.model` uses the same `{blake3, sha256}` shape over the same bytes, so the two can be compared directly.
#269 (assurance levels) may later require a `/3` lock for its higher levels.

### Test plan

- `@prism-code/spec`: a sample `/3` lock validates; its `/2` projection validates against the `/2` schema; every `/2` property of the `/3` schema equals the `/2` schema's; negative controls reject a missing `inputs`, a single-digest model, a prefixed digest, an unknown spec basis and an unknown member.
- Rust unit tests: the spec digest matches the reference vector above and ignores file order; a symlink in the set is refused; `prism.toml` switches the basis; the toolchain constants equal `tools.lock` and the vendored LexLean; the world digests equal the committed WIT file; a `/3` lock parses to a `/2` projection with an unchanged SDK digest; staleness names exactly the changed fields; `--update` upgrades `/2`, refuses `/1` and an absent lock; the CLI rejects `--update` with `-t` and with `--locked`.
- The existing contract parity tests (`runtime_contracts_are_exactly_the_modeled_contracts`, the model registry check) cover the new registration.

### Graduation criteria

- The calculator example commits a `/3` lock; an unchanged tree builds; an edit to `Calculator.lex.tex` is refused with `inputs.model, inputs.spec` named, and `--update` restores the build.
- A product release built from a `/3` lock verifies with `prismpm verify-release`, and its provenance names the `/3` lock bytes.
- `@prism-code/verify` checks the lock digest offline.

## Precedent

Kiota's `kiota-lock.json` is the closest model.
It records the generation parameters (language, class name, include and exclude patterns) and a hash of the API description, and it is committed.
Kiota skips generation when the description hash and parameters match the lock, and `kiota update` regenerates from it.
Here `inputs.spec` plays the description hash and `inputs.generation` the parameters.

Lake's `lake-manifest.json` pins every Lean dependency by revision next to the input revision the user asked for. When the manifest no longer matches the lakefile's requirements, Lake stops and tells the user to run `lake update`.
That is the refuse-then-update shape adopted here.

Nix's `flake.lock` pins every input transitively by content hash (`narHash`) as well as by revision, so the lock alone determines the build.
The SDK fields already do this for the image; `inputs` extends it to the project's own sources.

## Alternatives

**A separate `prism.inputs.lock` file.**
It would leave the SDK lock untouched.
It was rejected because provenance, the exporter and review would then need two documents to describe one build, and the issue asks for one lock.

**Nesting the `/2` document inside `/3` as a field.**
It would make the projection trivial, but every human reader and every JSON Pointer into the lock would change.
The flat form keeps `/2` paths valid in `/3`.

**Recording the LexLean source identity instead of a spec digest.**
`lexlean_source_id` already fingerprints the closed source graph.
It is sha256 over canonicalized text and includes SDK-installed inputs, so it cannot cover `prism.toml`, intent or examples when those arrive, and it would not follow the BLAKE3-native rule.

**Letting ordinary builds rewrite the lock.**
That is how Cargo treats `Cargo.lock` without `--locked`.
It was rejected because a lock that changes silently cannot serve as an attestation subject.

## Unresolved questions

1. Should a stale input lock get its own diagnostic code instead of `PP5401`? A dedicated code (for example in the `PP54xx` authority block) would let tooling distinguish "rebuild with `--update`" from SDK custody failures.
2. `prismpm build` is modeled as mutating `local-content-store`. With `--update` it also writes a project file. Does `model/commands.toml` need a separate mutation class for that?
3. Should `prismpm lock update` gain an `sdk-lock-update/3` proposal that carries `inputs` forward, instead of proposing against the `/2` projection?
4. The provenance row for the lock is sha256 only. #268 should decide whether rows become DigestSets, which needs every PrismPM verifier to accept two digests per row.
5. Settled by #325: the file set under `prism.toml` is `intent.md`, `examples/` and `types/` (`docs/proposals/325-authoring-front-door.md`).
6. Should `prismpm check` also report a stale input lock? Today it stays read-only and silent on inputs.
