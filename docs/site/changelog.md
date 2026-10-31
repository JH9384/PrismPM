---
title: Changelog
description: What each Prism release makes available, newest first.
available_in: "0.2.0"
---
Each entry gives the release date, the version, a tag of Feature or Fix, and what became available. Read the newest entry first; older entries stay for the history. A release that has not shipped says so in place of a date, and [Release status](/docs/reference/release-status) is where each feature is placed. Each feature of a shipped release links the request it closed.

## 1.1

Date: not released. Tag: Feature.

### Python runtime and plugins

Prism runs from Python, and plugins extend the verifier and the host.

- `prism-code` on PyPI exposes the same API as the npm package and the Rust crate, and reports the format revision it accepts.
- Verifier plugins add checks to `check`.
- Host plugins pair a `prism-plugin-<name>` crate with an `@prism-code/plugin-<name>` package.

## 1.0

Date: not released. Tag: Feature.

### Stable

The CLI and the runtime API are Stable. From this release, anything Stable gets twelve months notice before removal, and a patch never breaks you.

- The sixteen verbs, their flags, `--json` on every verb and the exit codes 0, 1 and 2 are Stable.
- `load`, `inspect`, `verify`, `instantiate`, `dispatch`, `history`, `replay` and `asTool` are Stable; experimental calls carry the `experimental_` prefix.
- [Migrate to 1.0](/docs/migration/to-1-0) lists what you rewrite.

## 1.0-rc

Date: not released. Tag: Fix.

### Release candidates

Release candidates harden what 1.0-beta.1 froze. Nothing new is added.

## 1.0-beta.1

Date: not released. Tag: Feature.

### Ship, bridge, extend

Holos move through registries, GitHub Pages and Docker. Agents use them as tools, and you extend the CLI and the runtime without forking either.

- `push` and `pull` move holos and their attestations through any OCI registry, with attestations as referrers; a local directory store works offline.
- `deploy` publishes to a GitHub repository and GitHub Pages and serves the attestations alongside; `export --oci` writes an OCI image that `docker run` serves.
- `inspect --audit` prints the security view and exports the report.
- `asTool(holo)` returns a Vercel AI SDK tool, and `@prism-code/mcp` exposes a holo as an MCP server.
- `dispatch` streams its events.
- CLI plugins run as `prism <name>` from `prism-<name>` on PATH; provider services are declared in `prism.toml`; runtime middleware wraps verify, instantiate, dispatch and record.
- The `prism-code` Rust crate exposes the same API as the npm package.

## 0.6

Date: not released. Tag: Feature.

### World, capabilities and the run gate

A holo declares what it imports and exports, and runs with exactly the capability set you grant. The loop from examples to a running instance closes.

- `init` scaffolds `prism.toml`, `examples/`, `intent.md`, a default capability set and the lockfile; `npm create prism-code` does the same from npm.
- `build` writes the model from examples and intent through an agent, and fails by name on an unproved sentence.
- `run` starts an instance only after `check` passes at the policy's level; `--allow-unverified` prints a warning. `check` and `run` take a policy file.
- One run of a holo is a container, `created`, `running` or `exited`, with an exit code that follows the typed error and its output, kept until `--rm` or `rm` removes it. `prism.containers` is the same in the SDK.
- `replay <history>` re-executes recorded inputs and fails on divergence; `dev` watches, rebuilds, re-checks and serves the local studio.
- `generate` writes JS, Rust and Python bindings and the typed client from the world.
- `export` writes the six-file browser export or a tarball.
- `@prism-code/testing` drives a holo with a mock host, and `@prism-code/conformance` is the suite every runtime passes.

## 0.5

Date: not released. Tag: Feature.

### Check, proof and attestations

Every build carries a proof and a provenance attestation, and `check` verifies both against a policy. The lockfile pins everything the build depends on.

- `check` verifies digest, provenance, proof and lockfile pins and prints a verdict with its assurance level and reasons.
- `build` always emits provenance and the proof attestation and caches by spec digest.
- `lock` writes the lockfile; `update` bumps the SDK image and prints old and new digests.
- `attest` adds a signed statement and `verify` checks it, keyless by default with `--key` for air-gapped use.
- `inspect` prints manifest, section digests, format revision and attestations without running.
- `holo.verify()` returns a verdict, and the runtime throws typed errors.
- `@prism-code/spec` ships the types, JSON Schemas, world files and the format revision constant; `@prism-code/verify` checks a holo offline in the browser with no runtime attached.

## 0.2.0

Date: 2026-10-23. Tag: Feature.

### First runtime on npm

`prism-code` 0.2.0 is on npm for Node.js 22 and later and for browsers.

- `load` opens a holo from bytes, a `Blob`, a path or a URL, and checks its digest footer and every section label.
- `dispatch` sends one request to the program on a fresh instance and returns the response bytes.
- `acceptance` replays every example the holo carries and reports how many passed.
- `prism-code run` serves a holo, `prism-code vectors` replays its examples, and `prism-code inspect` prints what it says about itself.
- `prism-code check` and `prism-code build` run the build inside the SDK image pinned by `prismpm.lock`. Docker is required.

Closes [#249](https://github.com/UOR-Foundation/PrismPM/issues/249).
Closes [#250](https://github.com/UOR-Foundation/PrismPM/issues/250).

## Next steps

- [Release status](/docs/reference/release-status)
- [Migrate to 1.0](/docs/migration/to-1-0)
- [Quickstart](/docs/get-started/quickstart)
