# Proposal 440: PrismPM as nine Docker-named modules

| | |
| --- | --- |
| Issue | [#440](https://github.com/UOR-Foundation/PrismPM/issues/440) |
| Milestone | M2 v0.5 Lock, check, proof |
| Status | Agreed, Experimental. The owner agreed this design on 2026-11-01, [recorded on #440](https://github.com/UOR-Foundation/PrismPM/issues/440#issuecomment-6564002251). Phases 1 and 2 are done; see [Migration phases](#migration-phases). |
| Depends on | #346 (stakeholder views), #347 (developer view) |
| Used by | #441 to #449 (one issue per module) |
| Measured at | Commit `b5c83187`, unless a number names another. `check-modules` confirmed the 14 Rust baseline entries at `8b7d7f40`. |

## Summary

PrismPM is made up of nine modules: `client`, `images`, `containers`, `networks`, `volumes`, `system`, `auth`, `errors` and `verify`.
Eight use the names of the Docker SDK, and `verify` is Prism's one addition.
A developer who knows the Docker SDK can find any Prism capability by its Docker name.
This proposal fixes the names, their boundaries, which code belongs to each, the check that keeps them apart, and the order in which the code moves.
It moves no code.

The first draft in #440 did not fit the code: its Rust ownership has 13 forbidden module pairs and its JavaScript ownership leaves files without an owner, so this proposal corrects the table and settles the open questions.

## What this settles

| Question | Decision |
| --- | --- |
| Where does `.holo` format reading live? | In `verify`. It does not go in `errors`, and there is no tenth library. |
| How do `prismpm/system-model/*` volumes and networks relate to `networks` and `volumes`? | They are deployment topology, owned by `images` and applied by `containers`. They never grant anything, and the two modules never read them. |
| Do providers belong only in `volumes`? | No. The runner belongs to `client`, and `volumes` receives it from `client`. |
| Does `exec` in #350 keep that word? | No. It becomes `dispatch`, Prism's existing word for that behaviour. |
| What must be true of an edge host before one is named? | The six conditions under [Edge to cloud](#edge-to-cloud). No host is named. |
| What is the schedule? | Left open. The facts are under [Unresolved questions](#unresolved-questions). |

## Motivation

The Docker SDK is familiar because it has few modules with predictable names.
PrismPM has 39 top-level Rust modules and a separate JavaScript runtime, and nothing states how they relate.

A textual scan of non-test code puts 19 of the 39 Rust modules into one dependency cycle:
`acceptance`, `application_build`, `authority`, `browser_oracle`, `contracts`, `controller`, `deployment`, `exporter`, `input_lock`, `library_build`, `library_verification`, `oci`, `release_verification`, `sdk`, `supply_chain`, `system`, `text_cli`, `verification` and `workbench`.
They hold 44,316 of the crate's 73,306 lines outside test files, or 52,910 of 88,165 with test files.

### Goals

- PrismPM is clearly made up of these nine modules, in its docs, SDK namespaces, CLI groups and code ownership.
- All code has one owning module, and the modules depend on each other without cycles.
- If Docker parity conflicts with verification, verification wins.
- One image digest gives the same verdict and the same outputs on every target, from edge to cloud.

### Non-goals

- Renaming canonical model terms, schema identifiers, predicate URIs or error codes. #346 keeps them unchanged; the nine names belong to the developer view.
- Making LexLean, Lean, lean4-prod, `prism-stdlib` or Hologram Live into modules. They are dependencies.
- Docker wire compatibility for the runtime (#346).
- Rewriting everything at once. The code moves in phases.
- Claiming that the modules or the toolchain are proven. As #312 says: every application ships with machine-checked proofs of its model; the toolchain is attested and reproducible, not proven.

## Proposal

| Module | Docker equivalent | Surface | Prism difference |
|---|---|---|---|
| `client` | Client | `Prism.fromEnv()`, `createPrism()` | Reads local configuration; no daemon required |
| `images` | Images | `build`, `pull`, `push`, `tag`, `list`, `inspect`, `remove`, `verify` | `pull` verifies before writing; `.holo` stays the file format |
| `containers` | Containers | `run`, `create`, `start`, `stop`, `logs`, `list`, `inspect`, `remove`, `dispatch` | `run` refuses an image that fails `check`; there is no `exec` |
| `networks` | Networks | `create`, `list`, `inspect`, `remove`, `connect`, `disconnect` | A network is a named, deny-by-default grant of outbound hosts |
| `volumes` | Volumes | `create`, `list`, `inspect`, `remove` | A volume is a named, declared store from a provider; host-folder mounts are refused |
| `system` | System | `info`, `version`, `events`, `df`, `prune` | Also reports the pinned toolchain |
| `auth` | Auth and credentials | `login`, `logout`, credential stores | Also holds signing identities |
| `errors` | Errors and types | Typed errors, stable codes, shared schemas | Types come from `@prism-code/spec` |
| `verify` | None | `check`, policy, attestations, replay, conformance | Names what the verdict trusts |

### User stories

- A developer writes `prism.images.pull(ref)` and `prism.containers.run(ref, input)` from Docker habit, without reading Prism docs, and an image that fails its check does not run.
- A security officer finds every trust decision about an image in one module, `verify`.
- A contributor adding a feature can tell which module owns it and which modules it may depend on, and CI tells them if they got it wrong.

### Rules for `networks` and `volumes`

- Both are views over the capability system (#279, #294). The capability file stays the canonical form.
- Neither may grant access outside the image's declared world and the active policy.
- Any attempt to widen access is refused with a typed error and recorded on the container.
- Today's guest contract has no imports, so these modules depend on host effects (#216, #217).
- Until then, unsupported calls raise a typed error that names the dependency. They must never appear to succeed.
- Docker's `network` joins containers on a virtual network and its `volume` mounts a filesystem; Prism's are narrower. This is a stated difference from #346's rule that a Docker word keeps its Docker meaning, and the owner chose these names knowing that.

### Risks and mitigations

- **The names promise more than the behaviour.** Docker users may expect full networking. Mitigation: typed errors, the stated differences above, and the glossary check of #346.
- **The move destabilizes verified code.** Mitigation: move in phases, with `just vv` passing after each one.
- **Agents and people read "verified" as "proven".** Mitigation: the wording from #312 and the named trust list in the verdict.
- **`images` becomes the place everything goes.** 15 of the 19 cycle modules land there, because they are one release pipeline. The module table can be satisfied while that pipeline stays tangled inside `images`. Mitigation: the check keeps measuring the old cycle (rule 5), so the tangle stays visible and cannot grow.
- **A split weakens a guarantee.** Today `CanonicalDocument::from_value` runs semantic checks by calling up into `acceptance`, `oci`, `sdk` and others, so no caller can skip them. Moving those checks to their owners must not let anyone hold a document whose checks did not run. Mitigation: the existing refusal fixtures stay unchanged through the split.

## Design details

### Allowed dependencies

Each module may depend only on the modules listed, which leaves no cycles:

| Module | May depend on |
|---|---|
| `errors` | nothing |
| `auth` | `errors` |
| `verify` | `errors` |
| `networks` | `errors`, `verify` |
| `volumes` | `errors`, `verify` |
| `images` | `errors`, `auth`, `verify` |
| `containers` | `errors`, `verify`, `images`, `networks`, `volumes` |
| `system` | `errors`, `verify`, `images`, `containers`, `networks`, `volumes` |
| `client` | all of the above |

There is one change from #440: `system` may depend on `verify`.
`system` reports the pinned toolchain, and that inventory moves to `verify` (see below).

### Where `.holo` format reading lives

**Decision: in `verify`, with shared bytes rules in `errors` and composition in `images`.**

#440 asked for the reader to sit "below both `images` and `verify`".
What the table needs is for both to reach it, and `images` already reaches `verify`.
So the reader can live in `verify` with no new module and no new edge.

- **The reader is a trust decision.** What a run of bytes means decides what the verdict is about, and the goal is one module for trust decisions.
- **The JavaScript side already works this way.** `sdk/npm/verify/src/reader.mjs` reads the header, table and footer itself, against constants from `@prism-code/spec`. Its browser build has no imports.
- **Nothing below `verify` needs it.** `errors` does not, once `contracts` is split, and `auth` signs bytes it is given.
- **`errors` stays a leaf.** `errors.mjs` and `error.rs` import nothing from the crate or package today, and #448 requires that to stay true. The JavaScript reader needs `blake3.mjs`, and the Rust reader needs `prism_stdlib`'s wire codec and `holo/attestation.rs`.

Each piece of the format goes here:

| Piece | Module | Today |
|---|---|---|
| Layout constants | `errors` | `@prism-code/spec` |
| Canonical value encoding: `encode_value`, `decode_value`, `content_id`, `canonicalJson` | `errors` | `holo/canonical.rs`, `archive.mjs` |
| Reading and validating an archive, attestation lines | `verify` | `holo/archive.rs` (`parse_application`, `validate_application`, `read_attestations`), `holo/attestation.rs`, `archive.mjs`, `blake3.mjs`, `sha256.mjs` |
| The inspection reader | `verify` | `inspect/mod.rs`, because `inspect/verdict.rs` calls it |
| Composing an archive and attaching attestations | `images` | `holo/archive.rs` (`compose_application`, `attach_attestations`) |
| The model document, its validation and projection | `images` | `holo/model_document.rs`, `validate.rs`, `projector.rs` and the rest of `holo` |

`prism.verify` does not export the reader; `prism.images.inspect` remains the public way to read an image.
Composition already validates its output through the reader (`holo/archive.rs:426`), so that call becomes an allowed `images` to `verify` edge.

`holo/canonical.rs` has to split for this to work.
`encode_value`, `decode_value` and `content_id` are leaves, but `encode_canonical` and `decode_canonical` call `holo/validate.rs`, which reaches most of `holo`.

### Deployment volumes and networks

**Decision: they are not grants and not part of the `networks` and `volumes` modules. They are deployment topology, they keep Docker's meaning, and they can only narrow what a grant allows.**

There are two deployment layers, not the one #440 named:

| Schema | Where they are declared | Target |
|---|---|---|
| `prismpm/system-model/1` | `topology` rows of kind `network`, `persistent-volume` and `ephemeral-volume` | Compose and Kubernetes |
| `prismpm/system-model/3` | `volumes` as `{id, mount_path}`, `networks` as `{id, internal}` | Compose only; a Kubernetes target is refused |

#440 said these and the grants "must use one meaning".
They cannot.
A deployment network is a boolean with no host list, and a grant is a host list with no topology.
A deployment volume has a mount path, and a grant names a store that is mounted nowhere.
The code emits exactly Docker's objects: named Compose networks, `{"type":"volume"}` mounts and Kubernetes volumes.
So one rule replaces one meaning:

1. **Topology never grants.** The capability file is the only source of what a guest may reach. A component on an open network (`internal: false`) gains nothing for its guest: a host serving effects (#216) checks the grant on every effect.
2. **Effective reach is an intersection:** the grant, the active policy and what the topology can route. Topology can only narrow it.
3. **`prism.networks` and `prism.volumes` never read or write a system model.** They work on the capability file alone.
4. **Each word has one meaning per surface.** In the developer view, `network` and `volume` mean the grants. Topology is reached through `plan` and is reported as "deployment network" and "deployment volume". Schema fields keep their names (#346).
5. **The host-folder refusal applies to grants.** `system-model/1` projects a fixed read-only bind of `./release` for its runtime components (`system.rs:2093`). No image or caller chooses that path, so it does not breach the rule.

When #216 connects the two, `plan` should report a grant that the topology makes unreachable.
That is a report and not a refusal, because narrowing is safe.

Topology goes to `images`, whole.
`controller`, `verification` and `release_verification` call `system::projections` or `system::parse`, and the build writes `projections/compose.json` into the release.
`lifecycle`, in `containers`, then applies it.

### Providers

**Decision: not only in `volumes`. The runner goes to `client`, the grant check to `verify`, and the one store to `volumes`.**

`providers.mjs` has no store-specific code.
It runs any `prism-provider-<type>` and returns environment variables, and #294 describes a provider as provisioning "something the holo needs".
It imports `manifest.mjs`, `plugins.mjs` and `node:child_process`, so it cannot sit in `volumes` as #440 placed it, or in any module that must load without Node.
It already behaves like `client`: it takes the project's manifest, runs what it declares and returns the variables, and neither `run` nor `containers` calls it.

| Piece | Module |
|---|---|
| `resolveProviders`, `releaseProviders` and the `providers` verb | `client` |
| `allow-providers` and `deny-providers` | `verify`, in `capabilities.mjs` |
| What a provider returns reaching a guest | `containers`, through the `variables` kind beside `-e/--env` (#346) |
| `bin/prism-provider-kv` | `volumes`, the only code here that is about a store |

`prism.volumes.create` keeps Docker's meaning, in which `create` provisions the store.
`client` passes the runner in when it builds `prism.volumes`, so `volumes` gains no new dependency.
Where there is no runner, as in a browser, the call raises a typed error.
`up` is already idempotent (#294), so running it again later is safe.
`networks` can receive the same runner if a provider ever serves it.

### `exec`

**Decision: drop `exec` from the developer view and use `dispatch`: `prism dispatch <container> [input]` and `prism.containers.dispatch`.**

#346's rule is that a Docker word keeps its Docker meaning, and that Prism builds the behaviour before taking the word.
`docker exec` starts a new process inside a running container.
Prism cannot build that: a guest is an import-free core module, and `core-wasm.wit` requires each request to run on a fresh instance, so there is no process to enter.

`dispatch` is already the word for what #350 describes.
It is on the public API (`app.dispatch`, `types/index.d.ts:413`), in the history schema ("the dispatches of one application"), and in the conformance suite (`scenarios/dispatch.json`).
A new verb such as `call` would add a term with no gain, and #346 already keeps words that are novel to Prism unchanged.

The cost is that a Docker user will type `exec` first.
The CLI's usage error for `exec` names `dispatch`; no `exec` alias exists, since nothing has shipped under that name.
`exec` is not one of #347's ten familiarity tasks, so that test is unaffected.

### Code ownership

This table is corrected against the code.
"Forbidden" below means an edge the dependency table disallows.
#440's Rust rows, with their own splits granted, have 13 forbidden module pairs and 135 forbidden symbol references, and its JavaScript rows have 4 forbidden imports.
This table has none once the splits it names are made.
That count is at the level of named symbols, so making a split may reveal more; each module issue confirms its row.

Paths are under `crates/prismpm/src` and `sdk/npm/prism-code/src`.

| Module | Rust today | JavaScript today |
|---|---|---|
| `client` | `lib`, `main`, `cli`, `template`, `diagnostics` | `index`, `node`, `browser`, `manifest`, `toml`, `init*`, `dev*`, `providers`, `middleware`, `tracing`, `generate/`, `studio/`, `author/`, `canonical/`, `bin/prism-code`, plus `create-prism-code` |
| `images` | `controller`, `config`, `holo` (model document, projection, composition), `application_build`, `library_build`, `browser_build`, `browser_oracle`, `lean_project`, `exporter`, `verification` (export chain), `release_verification`, `library_verification`, `acceptance`, `supply_chain` (evidence, scanning, promotion), `upstream_conformance`, `system` (rename below), `deployment`, `design`, `features`, `workbench`, `threat_model`, `lock_command`, `oci`, `text_cli`, `binary_cli`, `sdk` (project inputs, lock proposals), `attest` (the command that writes the section) | `closure`, `view`, `inspect`, `export`, `docker`, `oci-manifest`, `oci-reference`, `oci-registry`, `oci-store`, `push-pull*`, `provenance`, `attest-cli` |
| `containers` | `lifecycle`, `operations` | `containers`, `core` |
| `networks` | None today | None today |
| `volumes` | None today | `bin/prism-provider-kv` |
| `system` | `sdk::verify_environment` | `plugins`, `bin/prism-doctor` |
| `auth` | `SigningKey` in `attest/crypto.rs` | `auth`, `oci-auth`, signing parts of `attest` |
| `errors` | `error`, `contracts` (schema table and closed-shape checks), `holo/canonical` (value encoding) | `errors`, `errors-namespace`, `version`, `vendor/spec/`, `canonicalJson` from `archive`, plus `@prism-code/spec` |
| `verify` | `inspect`, `attest` (verification), `holo/archive` (reading), `holo/attestation`, `replay`, `authority`, `input_lock`, `sdk` (inventory, lock reading, pinned executables), `process_resources`, process helpers from `verification`, reference syntax from `oci`, `supply_chain` (trust and policy decisions) | `check`, `verify`, `attestations`, `archive`, `blake3`, `sha256`, `capabilities`, `replay*`, `attest` (verification), `vendor/verify`, plus `@prism-code/verify`, `@prism-code/conformance` |

Test code follows its directory and needs no row; that covers `test_compiler`, which `lib.rs` declares under `#[cfg(test)]`.

`attest/crypto.rs` stays with `verify` until `SigningKey` splits out, because the rest of the file checks signatures and `certificate.rs` and `transparency.rs` call it.
`SigningKey` itself reaches nothing in `der.rs`, but its one caller is the signing command in `attest/mod.rs`, and `verify` may not depend on `auth`, so the two move together.
Until then, `auth` owns no Rust file in `model/modules.toml`.

`crates/prismpm/src/holo/provenance.rs` is not on `main` or on any fetched branch at the measured commit, so it has no row.
When it lands, it follows `provenance.mjs`: writing a statement is `images`, and any reading used by the verdict is `verify`.

What changed from #440, and why:

| Change | Evidence |
|---|---|
| `sdk`, `process_resources` and the process helpers leave `system` | Only `client` may depend on `system`, but `images`, `verify` and `containers` call `sdk` and the process helpers such as `sdk::executable` and `verification::run_process`: 55 forbidden references. The pinned toolchain is part of what the verdict trusts, so they go to `verify`. |
| `release_verification`, `library_verification`, `acceptance` and `upstream_conformance` go to `images` | They rebuild or re-project: `release_verification` calls `application_build`, `exporter`, `system` and `text_cli`, and `library_verification` calls `controller` and `library_build`. `verify` may depend only on `errors`, and `images` must depend on `verify`. |
| `verify` answers one question | It judges bytes in hand, and it never builds or walks a registry. Release acceptance is a producer's gate that gathers evidence in `images` and takes signature and policy decisions from `verify`. This narrows #449's "all trust decisions" to decisions about an image. |
| `system` and `deployment` go to `images` | `oci`, `verification` and `release_verification` call them, which #440 forbids, and `system/browser.rs` calls `oci` and `text_cli`, so they cannot sit above `images`. They are release content. `lifecycle` and `operations` stay in `containers`. |
| `controller` and `config` go to `images` | `oci`, `verification` and `library_verification` call them. `client` keeps `cli` and `template`. |
| `diagnostics` goes to `client` | It is a probe of the whole public surface: it calls `controller`, `authority`, `config`, `design`, `features` and `holo`. Nothing in the crate calls it; `crates/conformance` does. |
| `contracts` splits | It calls up into `acceptance`, `exporter`, `oci`, `release_verification`, `sdk` and `holo::validate`. The schema table stays in `errors`, and each semantic check moves to its owner. |
| `networks` and `volumes` lose `system/host_effect` | That file imports `crate::deployment`, which neither may depend on, and no separable network part exists: the lines are woven through `validate` and `compose`. Rust has no grant code today beyond the verdict's check of a capability set in `inspect/verdict.rs`. |
| `capabilities.mjs` stays whole, in `verify` | It is one evaluator over four kinds (`CAPABILITY_KINDS`, `grantOf`). `networks` and `volumes` are new, thin views over it. |
| `provenance.mjs` goes to `images` | It writes statements (`provenanceStatement`, `attachProvenance`). |
| `canonical/` goes to `client` | It is the 0.1.0 source-text hashing API at `prism-code/canonical`, not `.holo` encoding, and it imports `node:crypto`. |
| `version` goes to `errors` | `replay.mjs` imports it, and `verify` may not depend on `system`. `system.version` reads it from there. |
| `plugins` goes to `system` | `bin/prism-doctor` imports it, and `system` may not depend on `client`. `docker info` also lists plugins. |
| New rows | `author/`, `attest-cli`, `blake3`, `sha256`, `vendor/`, `bin/prism-code`, `bin/prism-provider-kv` and `create-prism-code` had no owner. |
| `vendor/` splits by source | Each vendored file belongs to the package it was copied from, so `vendor/spec/` is `errors` and `vendor/verify.mjs` is `verify`. `errors-namespace.mjs` imports `vendor/spec/constants.mjs`. |
| Rows added after `b5c83187` | `threat_model` (#209) is `images`: it reads the model document through `holo`. `errors-namespace` (#448) is `errors`. `lib` and `main` are `client`: they hold declarations and the entry point. |

Points that still need care:

- **Name collision.** The Rust `system` module means the production-system model, which collides with Docker's `system`. Rename it, for example to `production_system`. The canonical `Production.System` model keeps its name. `prismpm::system` is public, so it keeps a deprecated alias.
- **`plan` and `deploy`.** The Docker SDK has no equivalent, since Compose handles this for Docker. They stay in `containers` until #313 settles their shape.
- **Environment variables.** The `variables` capability belongs on `containers`, next to `-e/--env` from #346.
- **Duplicate logic.** Rust and JavaScript both implement verify, push and pull, and JavaScript has two `.holo` readers held together by `test/agreement.test.mjs`. Trust decisions should move to one verified core compiled to Rust and Wasm, extending #312 beyond types to the verdict and policy. Transport and storage stay per language.
- **Registration.** As `AGENTS.md` requires, each public capability and diagnostic is registered in `model/*.toml` and covered by conformance fixtures.

### The dependency check

A CI check fails on a dependency the table forbids and on any cycle.
This section specifies it, and `xtask/src/modules.rs` implements it.

**Where it runs.** It is `cargo xtask check-modules`, called from `cargo xtask validate`.
The delegated `model-audits` obligation (`prism-factory`) runs `validate` on every pull request, with the base's `model/modules.toml` as `origin/main`.
`just vv` is not enough on its own, because `vv.yml` runs on pushes to `main` and takes hours.

**What it reads.** One file, `model/modules.toml`, holds the table, the owners and the migration baseline:

```toml
spec = "prismpm/modules/1"

[[module]]
name = "verify"
may_depend_on = ["errors"]

[[owner]]
path = "crates/prismpm/src/inspect/"
module = "verify"

[[pending]]
from = "crates/prismpm/src/replay/mod.rs"
to = "crates/prismpm/src/verification.rs"
cut = "process helpers move to verify"

[legacy_cycle]
members = ["acceptance", "application_build", "..."]
```

An owner is a file or a directory, and the longest match wins.
A file has one owner at a time.
A file that will split keeps its current owner until it does, and its forbidden edges stay in `[[pending]]` until then.

**What it scans.**

| Language | Files | What counts as an edge |
|---|---|---|
| Rust | Every file reached from `crates/prismpm/src/lib.rs` through `mod` declarations, following `#[path]`, plus `main.rs` | After removing comments and string literals, every path starting with `crate::`, `super::` or `self::`, including nested `use` groups. It resolves to the longest matching module file, and a path that stops at the crate root follows the root's `pub use` to the module it names. A bare `use child::x` is not read: it can reach only a module that this file declares. |
| JavaScript | `sdk/npm/prism-code/{src,bin}`, and `sdk/npm/{spec,verify,conformance,create-prism-code}` | `import`, `export ... from`, and `import()` with a literal specifier. A non-literal `import()` is not an edge: `browser.mjs:50` and `node.mjs:63` load a closure's own files. A literal specifier that names no file is reported and is not an edge: `studio/studio.mjs:10` imports `./verify.mjs`, a path `dev-server.mjs` serves from `vendor/verify.mjs`. A package has one owner, and a vendored copy (`src/vendor/`) belongs to the package it was copied from. |

It does not scan `xtask`, `crates/conformance`, `crates/model`, `scripts/`, `sdk/*.mjs`, `stdlib/` or `vendor/`, which are tooling and dependencies, or external crates and packages.
Files embedded as data, such as `replay/runner.mjs`, belong to the Rust file that embeds them.
Rust and JavaScript are never linked by an edge, since neither imports the other.

The scan is textual on purpose.
`xtask` has no parser dependency. At `8b7d7f40` the check walks 125 Rust files, 94 of them production, and 105 JavaScript files. It finds 394 Rust and 268 JavaScript file edges, and the 19-module cycle.
It sees names and not generated code; `crates/prismpm/src` has two `macro_rules!` definitions, so that gap is small and stays visible.

**How it treats tests.**

- These are test code: `#[cfg(test)]` items, files declared under one, `tests.rs`, `*_tests.rs`, `crates/prismpm/tests/**` and `sdk/npm/*/test/**`.
- `#[cfg(not(test))]` and `#[cfg(any(test, ...))]` count as production.
- Test code is left out of every failing rule. It adds 14 module edges and grows the cycle from 19 to 21 (`design`, `lean_project`), and an end-to-end test is supposed to cross modules.
- Unit tests under `src/` are printed as a report during migration. Once the baseline is empty they are held to the table, because a test that reaches upward would stop a module becoming its own crate.
- Integration tests stay exempt for good.

**The rules.** Each failure prints the file, the line, the symbol and the rule.

1. The module table has no cycle.
2. Every scanned file has exactly one owner, and every owner entry matches a file. New code therefore declares its module.
3. A production edge between files with different owners must be allowed by the table or listed in `[[pending]]`.
4. A `[[pending]]` entry that no longer occurs fails. Entries are deleted as cuts land.
5. The cycle in the old top-level Rust modules must be a subset of `legacy_cycle.members`. A member that has left must be removed from the list, so the list only shrinks.
6. `[[pending]]` and `legacy_cycle.members` may not hold more entries than at the merge base with `origin/main`. A move that renames paths keeps the count, a new edge cannot be added to get past rule 3, and a new cycle cannot be listed to get past rule 5. A checkout with no `origin/main` prints that this rule did not run. Model & Audits fetches full history so that it always runs there, and `ci-capacity.test.mjs` holds that setting.

The table is acyclic, so every cycle between the nine modules contains a forbidden edge, and rules 1 and 3 together forbid all of them.
Rule 5 covers something different: the old 19-module cycle, most of which ends up inside one module.

**The existing cycle during migration.** On day one the corrected table needs 15 `[[pending]]` entries: 14 in Rust, and one in JavaScript that #451 added after the measurement:

| Entries | Cut |
|---|---|
| `contracts.rs` to `acceptance.rs`, `exporter.rs`, `holo/library.rs`, `holo/validate.rs`, `oci.rs`, `release_verification.rs`, `sdk.rs` | Semantic checks move to their owners |
| `holo/canonical.rs` to `holo/model_document.rs`, `holo/validate.rs` | `encode_canonical` and `decode_canonical` leave `errors` |
| `replay/mod.rs` to `verification.rs`, and `sdk.rs` to `verification.rs` | Process helpers move to `verify` |
| `authority.rs` to `oci.rs`, and `sdk.rs` to `oci.rs` | Reference syntax moves to `verify` |
| `sdk.rs` to `supply_chain.rs` | SDK bindings and advisory disposition move to `verify` |
| `auth.mjs` to `attest.mjs` | `signStatement` and the other signing parts of `attest` move to `auth` |

Simulating the cuts on the symbol graph gives a measure of the old cycle:

| After | Cycle size | Who leaves |
|---|---|---|
| Today | 19 | |
| `contracts` up-calls removed | 17 | `contracts`, `workbench` |
| Helpers and reference syntax moved | 13 | `authority`, `browser_oracle`, `input_lock`, `sdk` |

All 13 that remain are in `images`, so the 14 Rust cuts give the nine modules no cycle between them.
The JavaScript cut breaks no cycle: it removes a forbidden edge from `auth` to `verify`, and nothing in `verify` reaches `auth`.
The 13-module tangle is real and stays measured by rule 5, but it does not block the goal.
The simulation removes edges by name, and does not show that each function can be lifted out without its helpers.

When `[[pending]]` and `legacy_cycle` are both empty, the check deletes them and rule 6, and the table is all that remains.

**Its own tests.** A fixture tree in `xtask` holds one case for each rule, plus: a forbidden edge inside `use crate::{a::{b}}`, one through `super::super::`, a path in a comment and in a string (no edge), a path under `#[cfg(test)]` (no edge) and under `#[cfg(not(test))]` (edge), `export ... from`, and literal and non-literal `import()`.

### Migration phases

1. **Contract (M2).** Done on 2026-11-01. This proposal is agreed, and the nine module issues carry the row corrections listed below.
2. **Check.** Done. `model/modules.toml` and `check-modules` hold the baseline above. Nothing has moved, and nothing can get worse from here.
3. **Developer surface.** Add the SDK namespaces and CLI groups through #347 and #349, with deprecated aliases. Existing exports keep working.
4. **Modules outside the cycle.** Move `error`, `holo`, `attest` and `inspect` first. They already sit outside the cycle: `holo` imports only `error`, `attest` only `error` and `holo`, and `inspect` only `attest`, `error` and `holo`.
5. **Clear the baseline.** Make the 15 cuts a piece at a time, with `just vv` passing after each one.
6. **Untangle `images`.** Shrink `legacy_cycle` to nothing. This follows the goal but is not needed for it.
7. **Shared core.** Move trust decisions to the verified core before the Python runtime (#307) adds another copy.

Moving code changes no schema, predicate URI or error code, so #346's non-goals hold through every phase.

### Edge to cloud

"Edge to cloud" means that one image digest gives the same verdict and the same outputs on every target.

| Target | Route | Status |
|---|---|---|
| Browser | `prism-code`, `@prism-code/verify` | Exists, with the gap below |
| Edge Wasm host | Not chosen | New work; no support or roadmap item exists today |
| Node | `prism-code` | Exists |
| Rust runtime | #298 | Planned |
| Docker | `prism export --oci` (#314) | Planned |
| Compose, Kubernetes | `plan` and `deploy` adapters | Exists for release-level deployment; `system-model/3` is Compose only |

Conformance (#287) is the test of this claim.

**No edge host is named here.** None has been shown to run the guest.
A host may be named when a committed conformance run shows all of these on it:

1. **It runs the guest contract as written.** It compiles an import-free wasm32 core module from bytes, calls `holo_alloc` and `holo_run` including the `i64` return, and uses a fresh instance per request (`core-wasm.wit`). A host that takes only WASI commands or components needs an adapter, and the adapter then joins what the verdict trusts.
2. **The bytes that run are the bytes that were checked.** A host that compiles only at deploy time must show that the deployed module has the digest of the guest that passed.
3. **It verifies on the host itself.** The refusal of a failing image happens there, and is not assumed from somewhere else.
4. **It gets the same answers.** The scenarios in `sdk/npm/conformance/scenarios/` pass through a shim, with a row in `runtimes.json` and a column in `COMPLIANCE.md`. A shim is one local process per request (`prism/conformance-shim/1`), so an edge host needs one that forwards the request.
5. **Its limits are stated and fail cleanly.** Request size, memory and time limits are written down, and hitting one gives a typed failure and never a truncated response.
6. **It adds nothing to the guest.** It links no imports beyond the grant. Today's world has none.

One finding bears on this, and on the browser row above.
With every `node:` import refused, under Node 22.21:

- `prism-code` and `prism-code/browser` **fail to load**, because `index.mjs` statically imports `canonical/index.js`, which imports `node:crypto`.
- `check.mjs` also fails to load, on `node:fs/promises`.
- `archive.mjs`, `core.mjs` and the browser build of `@prism-code/verify` load, and together they ran `Calculator.holo` and returned `1\tok\t42`.

So the pieces a host without Node needs exist, but the published entry points do not reach them without a bundler or import map, although the README says "or a browser".
This was measured in Node with those imports refused, not in a browser or on an edge host.

### Row corrections on agreement

The owner agreed this proposal on 2026-11-01, and the bodies of #441 to #449 were corrected that day to match this file.
#346 and #350 still need their change.

| Issue | Change |
|---|---|
| #346 | Replace `exec` with `dispatch` in the glossary row and the SDK shape. Add the deployment network and volume terms. |
| #350 | Replace `exec` with `dispatch` in the title, shape and done criteria. |
| #441 | Apply the `client` row: add `diagnostics`, `providers`, `author/`, `canonical/` and `bin/prism-code`; remove `config`, `controller` and `plugins`. |
| #442 | Apply the `images` row, including `system`, `deployment` and release acceptance. Remove `inspect` (reader) and `input_lock`. |
| #443 | Reduce to `lifecycle` and `operations`. Add `dispatch` to the surface. |
| #444, #445 | Remove `system/host_effect`. Move `providers` out of #445 and add `bin/prism-provider-kv`. |
| #446 | Remove `sdk`, `process_resources`, `test_compiler` and the process helpers. Add `plugins`. Allow a dependency on `verify`. |
| #447 | Name `SigningKey` in `attest/crypto.rs`, which stays with `verify` until it splits. |
| #448 | Remove `diagnostics`, `archive`, `canonical/` and `holo` format reading. Add `version` and value encoding. Split `contracts`. |
| #449 | Apply the `verify` row, and narrow "all trust decisions" to decisions about an image. |

### Test plan

- `check-modules` as specified above, with its fixtures.
- The glossary check of #346 covers module names, CLI groups and SDK namespaces.
- The familiarity test of #347 keeps its ten tasks, and gains network and volume tasks once they are real.
- Tests for `networks` and `volumes` show that a call outside the declared world or policy is refused and recorded, that unsupported calls raise a typed error, and that neither module reads a system model.
- A test shows that `prism exec` names `dispatch`.
- A conformance scenario runs one digest on each available target and compares verdicts and outputs.

### Graduation criteria

- **Experimental:** when this proposal is agreed.
- **Beta:** when the module exists in the SDK and the CLI, and passes its conformance scenarios.
- **Stable:** per module, and only when its behaviour exists. A module that still raises "unsupported" errors stays Experimental at 1.0.

## Precedent

- docker-py and dockerode: the module names and SDK shape, as in #346.
- Podman: separate libraries (`containers/image`, `containers/storage`, `buildah`) under one Docker-shaped surface. What differs: Podman is in one language and runs Linux containers.
- Spin: named, deny-by-default outbound hosts and key-value stores for Wasm apps, already the precedent for #279.
- Docker Compose: provider services (#294), and the `networks` and `volumes` of a Compose project, which the deployment layer already projects.

There is no row for this yet in the roadmap's feature-to-precedent table.

## Alternatives

- **Format reading in `errors`.** The first draft. It makes every import of an error pull in hashing, the wire codec and attestation parsing, it hides a trust surface under a name that promises none, and it breaks #448's rule that the module imports nothing.
- **A small tenth internal library for format reading.** It satisfies the table, but `verify` satisfies it too, and "nine modules" would need a footnote.
- **`verify` depending on `images` so `release_verification` can stay in it.** Then `pull` could not verify before writing without a cycle. Verification beats parity, but it needs the lower position.
- **Lower `system` so everything can use `sdk`.** `df` and `prune` have to read images, containers and volumes, so `system` has to stay near the top.
- **Providers in `containers`.** `containers.mjs` reads no manifest and `core.mjs` must load without Node, while `providers.mjs` needs both. It can move if #294's question about `run` calling `up` is answered yes.
- **`call` in place of `dispatch`.** Friendlier, but it adds a term for a behaviour that already has a public name.
- **One `capabilities` module instead of `networks` and `volumes`.** It is closer to how Prism works, but it gives up the Docker names. Rejected by the owner in favour of matching the names.
- **Keep the current module layout and document a mapping.** It costs less, but the code stays tangled and the structure stays unclear.
- **A daemon and REST API, as Docker has.** Rejected for now, since running in a browser with no service behind it is a strength. Add one only when remote management needs it.

## Prior art

#346 and #347 (developer view), #348, #349 and #350 (image and container verbs), #279 and #294 (capabilities and providers), #216 and #217 (host effects), #287 (conformance), #312 (contracts in LexLean).
`docs/proposals/278-wit-world.md` and `docs/proposals/294-provider-services.md`.

## Unresolved questions

**Schedule.** This proposal does not settle it. The facts at the time of writing, on 2026-11-01:

| Item | Milestone | Due |
|---|---|---|
| #440 and #441 to #449 | M2 v0.5, 13 issues open | 2026-10-31, passed |
| #346, #347, #287 | M3 v0.6 | 2026-11-03 |
| #298, #313, #314, #349 | M4 v1.0-beta.1 | 2026-11-06 |
| v1.0 | M6 | 2026-11-10 |
| #307, #350 | M7 v1.1 | 2026-11-25 |
| #216, #217 | No GitHub milestone; the roadmap board's build milestone field says M7 | 2026-11-25 |

- #347's familiarity test has ten tasks. `logs` and "list containers" need #350 (M7), and `tag` and "list images" need #349 (M4), while #347 itself is in M3. `containers.mjs` has no `list` or `logs` today.
- `networks` and `volumes` depend on #216 and #217, so real traffic and stores come after 1.0 on the dates above. Those modules would stay Experimental at 1.0 under the graduation criteria.
- Phases 3 to 7 are not scheduled.
