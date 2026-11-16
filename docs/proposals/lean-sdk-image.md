# Proposal: A lean SDK image

| | |
| --- | --- |
| Issue | To be filed; this document is the design |
| Milestone | M5 v1.0-rc Hardening |
| Status | Proposed |
| Depends on | #539 (`prism-code setup`, verify tiers), the hosted LexLean verifier (`lexlean-mcp`, profile `prism-app`), the `cli-archive` stage of `sdk/Dockerfile` |
| Used by | `prism-code setup`, `prism-code verify --lean`, `prism dev` (#288), the authoring loop of #325, fast verified builds (`fast-verified-builds.md`) |

## Summary

The SDK image is 20.9 GB. A full `prismpm verify` of a small app reads at most 5 GB of it, `lexlean verify` reads 1.35 GB, and `prismpm check` reads 0.2 GB. About 16 GB is never touched by any tier, and 3.5 GB of what is there is the same bytes twice, duplicated by `chmod -R` and `cp -a` in later layers. This proposal turns the one image into a ladder of footprints, each opt-in over the last: a 40 MB native install with no Docker that checks locally and verifies through the hosted verifier; a 755 MB verify-only Lean toolchain for anyone who wants the proof checked on their own machine; and a build image of about 4.5 GB, split from an oracles image, for a full local `prismpm verify`. Nothing is proved less. Every kernel check, oracle and test still runs, over the same bytes, with the same attestation.

The principle is the one from [Hologram](https://github.com/Hologram-Technologies/hologram) that `fast-verified-builds.md` already adopts: address work by what it depends on. Applied to distribution it reads: bring the proof to the toolchain, not the toolchain to the proof. The attestation is the artifact an author needs; the toolchain that produced it is needed only by whoever wants to reproduce it.

## Motivation

### What the image is and what a build reads

Measured on 2026-11-05 with `prismpm-sdk-candidate@sha256:cd3b47d7…` on the chess move referee (3 LexLean modules), Docker inside WSL Ubuntu. The scripts and raw numbers are beside this document in `docs/proposals/lean-sdk-image/`.

| Tier | Command | Reads from the image | How measured |
| --- | --- | --- | --- |
| T0 | `prismpm check` | 0.2 GB needed (`prismpm` 88 MB, Node 125 MB); 0.75 GB mapped | files mapped or open, sampled from `/proc` |
| T1 | `lexlean verify` | 1.35 GB (Lean toolchain 1.30 GB, `lexlean` 46 MB) | resident pages per process, from `smaps`; exact |
| T2 | `prismpm verify` | at most 5.1 GB | page-cache residency after a cold start; shared with other containers, so an upper bound |

Where the 20.9 GB is:

| Part | Size | Needed by |
| --- | --- | --- |
| Lean toolchain (`/usr/local/elan`) | 2.84 GB | T1, T2. Of it: `lib/lean/Lean` 1.25 GB, `Init` 0.39, `Std` 0.34, `libleanshared.so` 0.15. `libLean.a` 0.30, `libLLVM.so` 0.08, `libclang-cpp.so` 0.07 and `src` 0.03 are for compiling Lean to native code; no tier reads them |
| `/opt/prismpm` | 2.71 GB | vendored Cargo registry 1.13 (T2), conformance share 0.73 (T2 in part), Java OpenID oracle 0.70 (oracles only) |
| Playwright base and Chromium | about 2.6 GB of base layers plus 1.52 GB `/ms-playwright` | the browser oracle in T2, which reads 148 MB of it |
| Rust toolchain (`/usr/local/rustup`) | 1.35 GB | T2, which reads 331 MB of it |
| 20 command-line tools (`/usr/local/bin`) | 1.09 GB | `prismpm`, `lexlean` and `node` by every tier; `otelcol-contrib` 342 MB, `cosign` 141, `kubectl` 60, `osv-scanner` 57, `kind`, `oras` and `slsa-verifier` by release and oracle workflows, not by a build |
| A second copy of the Cargo registry in `/home/vscode/.cargo` | about 1.13 GB | nothing; `cp -a` in the user-setup layer |
| `chmod -R a-w /ms-playwright` | 1.31 GB layer | nothing; a metadata change rewrites every file into a new layer |
| user-setup layer (`cp -a` and `chmod -R` on `/opt/prismpm/cargo-home`) | 2.19 GB layer | nothing beyond the files it duplicates |
| build-essential, browser engine install, self-check layer, two Node runtimes | about 0.9 GB | T2 in part |

Two facts set the floors. First, every `lean` and `leanchecker` process in a verify maps all 2,270 modules of the standard distribution, including the 1,192 modules of Lean's own compiler library, although no generated module imports `Lean`. There is no `Init`-only subset to ship; a local Lean verify needs the whole `lib/lean` tree, 2.27 GB on disk without the native-compilation files, 755 MB compressed with `gzip -1`. Second, T2 reads the vendored registry (838 MB in 14,441 files), the Rust toolchain and Chromium, so a local full build is a multi-gigabyte image whatever else changes.

### What this costs an author

`npx prism-code@latest setup` ends in a 21 GB pull before the first `check` can run. On a 100 Mbit connection that is half an hour; on a laptop with a 256 GB disk it is a tenth of the disk, and four times that when the adapter, oracle and runtime packages are pulled too, since they are byte-identical copies of this image. An agent whose first tier is a four-second `prismpm check` waits thirty minutes for it. The hosted verifier already checks a draft in 45 s with nothing installed; today an author cannot reach it from `prism-code`.

### Goals

1. `prism-code check` runs with no Docker daemon and no image, within a minute of `setup` finishing.
2. `prism-code verify --lean` runs with no image by default, and its attestation is byte-identical to the one a local toolchain produces for the same source.
3. A full local `prismpm verify` needs an image of 5 GB or less, with the same attestation as today.
4. Every byte in every published image is read by a tier of that image's job, measured by the scripts beside this document, and the measurement is a CI floor.

### Non-goals

- Changing what a verification is. Which processes run, which kernel checks, which oracles: unchanged. LexLean SPEC §9.4 and §21.8 stay as they are.
- Caching an acceptance. A hosted attestation is a verdict about a source hash; `prismpm verify` at publication still runs everything itself.
- Lazy image pulling (eStargz, SOCI, Nydus). Docker Desktop and GitHub runners do not support it, and T2 reads 5 GB regardless.
- Trimming the Lean standard library below the module set its own tools load.

## Proposal

### 1. Stop duplicating bytes across layers

`chmod -R a-w /ms-playwright`, `cp -a /opt/prismpm/cargo-home/. /home/vscode/.cargo/` and `chmod -R a+rX,a-w /opt/prismpm/cargo-home` each rewrite gigabytes into a new layer. Set modes in the layer that creates the files (`COPY --chmod`, `install -m`, or one `RUN` that downloads and sets modes), and point `CARGO_HOME` at `/opt/prismpm/cargo-home` instead of copying it; the only reason for the copy is write access, and a build writes to `/tmp` already (#539 gives it a volume). Drop `libLean.a`, `libStd.a`, `libInit.a`, `libLLVM.so`, `libclang-cpp.so` and `src` from the toolchain copy; no tier reads them. Drop the second Node and `otelcol-contrib` from the build image; telemetry has its own collector image in `lexlean-mcp`.

This step is about 5 GB off the image with no behaviour change and no new package. It ships first because every later step inherits it.

### 2. Native binaries in `prism-code`; `check` without Docker

`sdk/Dockerfile` already produces a native `prismpm` archive per Linux target (`cli-archive`). Publish it, and `lexlean`'s native builds for Linux, macOS and Windows, as platform packages that `prism-code` lists under `optionalDependencies`, the way it already lists the Sigstore packages: `npm` installs the one that matches the host, 38 MB compressed for both binaries. `prism-code check` and `prism-code axioms` run the native binaries; `setup` records them in `config.json` beside the Docker record, and `doctor` reports which path each verb takes. The Docker path stays as the fallback, and as the only path for T2 until step 5.

### 3. `verify --lean` through the hosted verifier by default

`prism-code verify --lean` sends the project's LexLean sources to the hosted verifier (`mcp.uor.foundation`, profile `prism-app`), which runs the same `lexlean verify` on the same pinned toolchain and returns the attestation and the audit records. `prism-code` stores them under the source hash in `.lexlean/verified/`, where a local run would put them, so `axioms` and the rest of the tooling see no difference. Nothing is installed; a verify of the chess referee returns in 45 s or less today. The attestation names the toolchain digest and the verifier's signing identity; `prism-code verify --lean --local` (step 4) reproduces it, and the acceptance test below checks that the two agree byte for byte.

### 4. A verify-only Lean toolchain, opt-in, no Docker

For an author who wants the proof checked on their own machine, `prism-code verify --lean --local` installs the toolchain that T1 reads and nothing else: `lib/lean` without the native-compilation files, `bin/lean`, `bin/leanchecker` and `bin/lake`. That is 2.27 GB on disk, 755 MB compressed with `gzip -1` and less with `zstd`. It is installed the way `elan` installs, under `PRISM_HOME`, keyed by the pinned toolchain digest, and verified by digest before first use. This is the floor for a local proof, since every Lean process loads the full module set. LexLean needs nothing new: `lexlean` already finds `lean` and `lake` under `ELAN_HOME/toolchains` with no `elan` present, as the hosted verifier image shows.

### 5. Split the image by job

Today four published packages (runtime, three adapters, oracles) are the same 20.9 GB bytes under different names. Build them as different images:

| Image | Contents | Size after step 1 |
| --- | --- | --- |
| `prismpm-sdk-build` | Ubuntu, build-essential, verify-only Lean, Rust toolchain, vendored registry, `prismpm`, `lexlean`, Node | about 4.5 GB |
| `prismpm-sdk-oracles` | the build image plus Chromium, the Java OpenID oracle, the conformance and supply-chain tools | about 8 GB |
| adapters | the build image plus `docker`, `kubectl`, `kind`, `oras`, `cosign` | about 5 GB |

`prism-code` pulls the build image for `prismpm verify`. A verify with the browser or OpenID oracles enabled pulls the oracles image, and says so before it does. Each image carries its own inventory and self-check as today.

### 6. Hold the gain

The samplers beside this document become a test in the release workflow: run each tier in its image, record the mapped set and the resident set, and fail when either grows past its budget or when a published image contains a top-level directory that no tier of its job reads. The image size itself gets a floor the way the npm package has one (`scripts/check-package.mjs`), with the number in the workflow.

## Budget

| Footprint | Today | After |
| --- | --- | --- |
| `setup` to first `check` | 20.9 GB pull | 38 MB in the npm install; no Docker |
| `verify --lean` | 20.9 GB pull | 0 bytes (hosted) or 755 MB once (local) |
| full `prismpm verify` | 20.9 GB | about 4.5 GB build image; about 8 GB with the oracles |
| all published packages pulled | 84 GB | about 18 GB |
| the monolith, step 1 alone | 20.9 GB | about 16 GB |

The 4.5 GB and 8 GB are sums of the measured parts, not builds of the change; step 6 replaces them with measured numbers.

## Acceptance

- `prism-code setup` on a machine with no Docker daemon ends with `check` and `axioms` working, and `doctor` naming the native path.
- The attestation of `verify --lean` through the hosted verifier and of `verify --lean --local` on the same source are byte-identical, for the chess referee and the `text-request` template.
- A full `prismpm verify` in the build image and in today's image gives byte-identical attestations, cold and warm.
- Every process of today's verify appears in the attestation after the split, exactly once, with its executable digest.
- Planted defects, each refused with a named diagnostic and a negative test:
  - a toolchain archive with a flipped byte is refused before first use;
  - a hosted attestation whose toolchain digest differs from the pin is refused by `prism-code`;
  - a build image missing a file that T2 reads fails the image's self-check at build time, not a user's verify;
  - a layer that rewrites more than a budgeted number of bytes already present in a lower layer fails the release workflow.
- The per-tier read sets, re-measured in CI, are within budget, and the image sizes are at or under the table above.

## Decisions for the owner

1. **Hosted verification as the default inner loop.** #69 draws the line at cached acceptance. A hosted attestation is a verdict about a source hash, produced by the same pinned toolchain, reproducible by anyone with step 4, and publication re-runs everything locally. Is that inside the line, or must the default stay local with the hosted path opt-in?
2. **How native `lexlean` ships.** Platform packages under `optionalDependencies` keep one entry point and one lockfile; a downloaded archive keyed by digest, as step 4 does for Lean, keeps the npm package small and the binaries out of npm's trust path. LexLean's release process decides which it can sign.
3. **Whether the oracles image is a product.** Splitting it changes what `prismpm verify` pulls when the browser oracle is on. Is a second pull, announced in advance, acceptable, or should the browser oracle move to the hosted side too?

## Relation to existing work

- `fast-verified-builds.md`: time. This document: bytes. Both rest on the same measurements of the same project and on #539's tiers; its step 3 (artifact reuse by content address) and this step 1 (no duplicate bytes) are one discipline applied to time and to space.
- #539: `prism-code setup`, the tiers and the cache volume. Steps 2 and 3 are new paths behind the verbs it defines.
- `lexlean-mcp`: the hosted verifier of step 3 exists; the proposal adds a client, not a service.
- `sdk/Dockerfile` `cli-archive`: the native `prismpm` archive of step 2 exists for Linux; macOS and Windows targets are additions.
- The measurements behind this document are beside it in `docs/proposals/lean-sdk-image/`: the samplers, the attribution of the Lean compiler library to every Lean process, and the raw numbers.
