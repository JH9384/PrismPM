# Proposal: Fast verified builds

| | |
| --- | --- |
| Issue | To be filed; this document is the design |
| Milestone | M5 v1.0-rc Hardening |
| Status | Proposed |
| Depends on | ADR-016 (canonical `.holo` bytes), LexLean #391 (the kernel checks a replayed module once), LexLean #343 (proof blocks, tracking), #69 (exporter seed reuse) |
| Used by | #539 (`prism-code setup`, `verify --lean`, `axioms`), #288 (`prism dev`), the authoring loop of #325 |

## Summary

A full `prismpm verify` of a small app takes about five minutes, and the proofs are a tenth of it. The rest is Rust compilation, a second elaboration of the same Lean, a fresh build of the exporter, and work PrismPM does between processes that nothing records. This proposal cuts a warm edit-to-verified-holo cycle from about 280 s to under 60 s without changing what is proved: every kernel check, every oracle and every test still runs, in the same run, over the same bytes. The levers are, in order of size: run the independent checks at once instead of one after another; elaborate each Lean module once per run, as a part of the verification rather than a prelude to it; reuse compiled Rust artifacts by the content address of their inputs, recorded as evidence; and keep timing telemetry so the next lever is measured rather than guessed.

The content-addressing ideas come from [Hologram](https://github.com/Hologram-Technologies/hologram), the runtime the `.holo` format is built for. Its principle is the right one: address work by what it depends on, and reuse it instead of redoing it. Its implementation also shows three mistakes to avoid, listed under *What not to copy*.

## Motivation

### Where a verify spends its time

A chess move referee (3 LexLean modules, 60 declarations, text application, no production root) was verified on 2026-11-05 with SDK image `prismpm-sdk-candidate@sha256:cd3b47d7…`, Windows 11, Docker inside WSL Ubuntu, 12 CPUs, 16 GB. A clean run takes 284 s with `/tmp` on a volume. A run sampled once a second with `ps` took 679 s under load; the shares below are from that sample and the proportions, not the seconds, are the finding.

| Work | Seconds | Share | What it is |
| --- | --- | --- | --- |
| Rust compilation | 276 | 41% | `cargo build` of the generated crate; `cargo build` and `run` of the Hologram oracle harness (`CARGO_INCREMENTAL=0`, two jobs); `cargo test` and `cargo check --no-default-features` of the generated package |
| Lean inside the build | 150 | 22% | `lake build PrismGenerated` elaborates the generated modules; `lake build prod-export` constructs the exporter; `lake exe prod-export` runs it |
| PrismPM's own work | 137 | 20% | Time with no child process alive: hashing, staging, custody checks, composition. Nothing records which |
| LexLean verify | 77 | 11% | Elaboration of the same modules again (25 s), `leanchecker` replay (48 s), the axiom audit |
| Browser and Node oracles | 12 | 2% | The portable view through headless Chromium, the browser projection |
| Setup and composition | 27 | 4% | The first 11 s and the last 6 s |

LexLean's own telemetry (`LEXLEAN_CI_TELEMETRY`) for the verify stage of the same project: 44 s in all, elaboration 14 s, replay 21 s, audit 4 s. The app's module elaborates in 8.4 s; the three Foundation modules it imports take 5.7 s together and are byte-identical to every other app's.

Two more measurements frame the targets:

- `/tmp` as a 2 GB in-memory tmpfs against a disk volume: 814 s against 317 s on an empty volume and 284 s warm, with the same attestation each time. The SDK seeds a 1.2 GB Cargo home into `/tmp` on every run, and in memory that copy competes with the build. #539 ships the volume.
- `lexlean verify` alone on the same project: 26 to 61 s. `prism-code verify --lean` (#539) exposes it as the inner loop.

### What this costs an author

An agent writing a model runs the full verify after every change it cannot judge by the cheaper tiers. At five minutes a run, a day of authoring is an hour or two of waiting, and the agent fills the gap by guessing. The chess referee took three full verifies to settle its axiom policies before `prism-code axioms` existed. A sub-minute verify changes what an agent does: it runs the whole gate after every edit, and the proof becomes the editor's red squiggle rather than a nightly job.

### Goals

1. A warm edit-to-verified-holo cycle under 60 s for a template-sized app, with the same attestation a cold run produces.
2. Nothing proved less. Every kernel check, oracle, test and process record of today still runs, once, in the run that publishes.
3. Every reuse is evidence, not trust: keyed by the complete inputs, verified by digest on read, recorded in the attestation, and refused on a planted defect.
4. Timing is recorded so the next bottleneck is measured.

### Non-goals

- Caching an acceptance. A verdict is never carried across runs; LexLean SPEC §9.4 and §21.8 stay as they are, and #69's line holds: no speedup is accepted until its evidence is.
- Changing the LexLean toolchain pin or any SPEC rule about what a verification is. The LexLean items this depends on are proposals of their own.
- Faster proofs. Certificates for production roots (63% of a large project's verify, LexLean #391) are LexLean #353 and #355.

## Proposal

### 1. Run the independent checks at once

After the build, these steps depend on the build output and on nothing else of each other: LexLean verify; the Hologram oracle build and run; `wasm-tools validate`; `cargo test` of the generated package; `cargo check --no-default-features`; the browser projection; the Text/3 command-line acceptance. Today they run in sequence. The wall time becomes the longest of them instead of their sum.

The oracle harness and the package test are each a `cargo` invocation with its own target directory, so they already do not share state. LexLean verify takes `LEXLEAN_VERIFY_WIDTH` and a memory budget (§22.11); the same budget bounds how many of these run together, with the oracle build's 4 GB peak counted. Process records keep their order in the attestation by stage name, as §22.11 keeps LexLean's, so the attestation is unchanged.

Expected: Rust and LexLean overlap, and the 276 s of Rust compilation stops being serial with the 77 s of Lean. On the measured run the longest branch is the oracle build at about 110 s.

### 2. Elaborate each Lean module once per run

The build elaborates the generated modules with Lake, and the verify elaborates them again. LexLean already has the mechanism to share elaboration inside one run: a shard elaborates modules, uploads their `.olean` files and process records, and the join reads them, requires each record to name the executable the join itself hashed (`LLI9001` otherwise), and judges each as the stage that produced it. The build is that shard. PrismPM hands the verify the `.olean` files and records its Lake build produced under the same toolchain and executable digests, and the verify runs replay and audit on them. Nothing crosses runs; the join rule is the one §9.4 already states.

With LexLean #391, the in-process kernel pass is off for every module that `leanchecker` replays, so the kernel checks each declaration exactly once. Together: the 150 s of Lean inside the build and the 25 s of re-elaboration become one elaboration of about 100 s, and the replay stays.

### 3. Reuse compiled Rust artifacts by content address

The compiled generated crate, the oracle harness binary and the package-test binary are pure functions of their inputs: the crate source bytes, `Cargo.lock`, the vendored registry, the `rustc` and `cargo` executables, the target triple and the profile. PrismPM already requires this (RP-09: two clean builds are byte-identical). So an artifact can be keyed by a DigestSet over exactly those inputs, as LexLean #338 keys a replayed declaration, and reused when the key matches.

What is reused is the compiled artifact, never its verdict. The test still runs; the oracle still runs; the process record says the binary was taken from the store under key κ, lists every input digest, and the binary is re-hashed on read. A reuse is therefore more evidence than a fresh compile, not less: it names what the compile depended on.

Rules, from Hologram's experience and LexLean's #338:

- The key covers the toolchain. Hologram's derivation key leaves out the kernel version; a cache keyed that way serves stale results after an upgrade. Here `rustc`, `cargo`, the registry digest and the profile are in the key.
- Look up before the work, not after. Hologram's compiler cache runs `build_unit` unconditionally and consults the cache afterwards, so a hit saves nothing (`crates/hologram-compiler/src/compiler.rs:251-292`).
- Verify on read. Every artifact is `[blake3 ‖ bytes]` and re-hashed before use, as Hologram's `FileWarmStore` and `get_with_fetch` do. A failed check is a miss and a fresh compile, never a wrong artifact.
- The store is local and per SDK image: one directory under the cache volume #539 creates, written atomically. Sharing across machines is a later step that needs a signed statement binding inputs to result, which the DSSE bundles in a `.holo` can carry.

Expected: a verify after an edit that changes only the model, not the generated crate's interface, still recompiles the crate (its source changed). A verify with no change, or a change to the model's proofs only, skips all 276 s. The oracle harness never changes between SDK releases, so its 110 s is skipped from the second verify on.

### 4. Build the exporter and the shared modules once

`lake build prod-export` constructs the exporter in every build, about 60 s here. #69 specifies the seeded exporter and the custody checks it needs; this proposal needs it and adds nothing to it.

The Foundation modules every text application imports are byte-identical across apps and elaborate in 5.7 s here; the preservation library an app with a production root needs is 173 to 201 s (LexLean #352). Both are LexLean's proof blocks (#343): verified once per compiler and toolchain, replayed and bound inside the consumer's verify. PrismPM's part is to ship the blocks of the stdlib and the template's Foundation modules in the SDK image, so a new project never elaborates them.

### 5. Record where the time goes

PrismPM's process records hold argv, exit code and output but no duration, and 20% of a verify has no process at all. Add a wall time to every process record and a stage record around every step PrismPM performs itself, written the way LexLean §22.12 writes telemetry: to a file the operator names, outside the project and the build root, never into an artifact, with every key refused inside a verified directory. `prism-code verify` prints the stage table at the end of a run. Without this the 137 s stays a guess; with it the next proposal has its number.

### 6. Hold the gain

A floor, as #288 holds `prism dev` to one: the warm verify of the `text-request` template on the gate runner stays under a budget, and a planted regression (a second elaboration added back, or the oracle rebuilt on a hit) fails the gate. Hologram's `just vv` has a `perf` class with per-part budgets for the same reason.

## What not to copy from Hologram

- Its cache keys leave out the compiler and kernel versions, and its memo soundness rests on an assumption that kernels are deterministic (ADR-030 there), not on a check.
- Its compiler cache is a no-op: the work runs first, the lookup after.
- Its archive writer emits weights in hash-map order, so identical inputs get different addresses and every downstream cache misses. ADR-016 makes PrismPM's bytes canonical; that is the prerequisite for any of this.
- Its Certificates section is copied into the archive and never checked. A PrismPM reuse record is checked on read and planted-defect tested.

Lookup tables over finite domains and suspend-to-a-κ, Hologram's two headline features, do not apply to verification.

## Budget

| Step | Today, warm | After | Lever |
| --- | --- | --- | --- |
| Rust compilation | 276 s, serial | 0 to 110 s, overlapped | 3, then 1 |
| Lean inside the build | 150 s | about 100 s, once | 2, 4 |
| LexLean verify | 77 s | about 50 s, overlapped with Rust | 2, LexLean #391 |
| PrismPM's own work | 137 s | measured first | 5 |
| Oracles | 12 s | 12 s, overlapped | 1 |

Whole: about 280 s today on a clean machine. With 1 and 2, the longest branch is the Rust compilation, about 110 s plus setup. With 3, a no-change or proof-only verify is bounded by the Lean replay and audit, under 60 s. These are arithmetic on the measured shares, not runs of the change; each step reports its measured number against this table.

## Acceptance

- Two consecutive full verifies of the chess referee and of the `text-request` template give byte-identical attestations before and after each step, cold and warm, with the times recorded.
- Every process of today's verify appears in the attestation after the change, exactly once, with its executable digest, so no check was dropped or run twice.
- Planted defects, each refused with a named diagnostic and a negative test:
  - a changed byte in the generated crate's source gives a different key and a fresh compile;
  - a different `rustc` or registry digest gives a miss;
  - a stored artifact with a flipped byte is refused on read and recompiled;
  - an honest artifact of another build stored under this key is refused by the input digests in its record;
  - a build-produced `.olean` whose record names another executable fails the join (`LLI9001`);
  - a second elaboration of a module in one run fails the once-per-run check.
- The floor of step 6 fails on its planted regression and passes on the change.
- The telemetry of step 5 accounts for at least 95% of the wall time of a verify by stage.

## Decisions for the owner

1. **Artifact reuse against #69's line.** #69 accepts no speedup until its evidence is complete, and names "cached acceptance" as the thing that must not become the trust path. Step 3 reuses compiled artifacts, keyed and verified as above, and never a verdict. Is that inside the line, and should the oracle harness, which is SDK-owned and never changes between releases, be prebuilt in the image instead?
2. **The build as a shard of the verify.** Step 2 uses §9.4's join rule inside one `prismpm verify`. Is it acceptable for PrismPM to be the part that elaborates, or should LexLean expose the part-import so that PrismPM only hands over paths?
3. **Concurrency and memory.** Step 1 needs a budget per host as §22.11 has. Default to LexLean's, or measure the oracle build's peak and set one?

## Relation to existing work

- LexLean #343 and its items #350 to #355, #338, #391, #352: the proof side. This proposal is the PrismPM side and the runtime of the pipeline around the proofs; it adds no caching of Lean results of its own.
- #69: the exporter seed. Step 4 needs it.
- ADR-016: canonical bytes, the prerequisite of every content address here.
- #539: the cache volume, the tiers and the axiom report; step 6's floor and step 5's table surface in `prism-code`.
- #288: the floor pattern.
- The measurements behind this document are beside it in `docs/proposals/fast-verified-builds/`: the sampler, its tool-seconds table, and the LexLean telemetry of the same project.
