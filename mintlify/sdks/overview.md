---
title: SDK overview
description: The runtime for each language, where it is published, its stability tier and the one spec they share.
available_in: "0.2.0"
---
Prism has one runtime per language. Each one loads, checks, instantiates and dispatches holos with the same calls and the same errors. Pick the language your application already uses.

## Choose a language

| Language | Package | Install | Published | Tier |
|---|---|---|---|---|
| TypeScript | `prism-code` on npm | `npm install prism-code` | 0.2.0 | Experimental |
| Rust | `prism-code` on crates.io | `cargo add prism-code` | not yet, ships with 1.0-beta.1 | none yet |
| Python | `prism-code` on PyPI | `pip install prism-code` | not yet, ships with 1.1 | none yet |

Every public surface carries one of four tiers. Experimental may change in any release, including a patch, so pin the exact version. Beta is feature-complete and changes only with a changelog entry. Stable gets twelve months notice before removal, from 1.0. Deprecated keeps working through the current major. Nothing is Stable today.

## One spec, one suite

Every runtime is built from `@prism-code/spec`. The types, the JSON Schemas, the world files and the section layout come from that one package. A runtime adds no field the spec does not name.

Every runtime passes `@prism-code/conformance` before release. The suite loads the same holos and applies the same policies. It dispatches the same inputs and expects the same verdicts, outputs and errors. A runtime that fails one case does not ship.

## Format revision

Holo format revisions are named by date. The current revision is `2026-10-23`. Every runtime states which revisions it accepts and refuses the rest by name. `@prism-code/spec` exports the current one as `FORMAT_REVISION`, and [Spec package](/api/spec-package) shows it printed.

## What every runtime shares at 1.0

- `load`, `inspect`, `verify`, `instantiate`, `dispatch`, `history` and `replay`, with the same names.
- The error set: `PrismError`, `VerificationError`, `ProofMismatchError`, `CapabilityDeniedError`, `DeterminismViolationError`, `ReplayError`.
- Configuration from `PRISM_*` environment variables, overridden by options passed to the client, overridden by options passed to one call.
- The default policy: assurance level P2 or above and a declared world within the granted capabilities.

`asTool` ships in TypeScript only, because the Vercel AI SDK is a TypeScript library. Rust and Python expose a holo to agents through `@prism-code/mcp` instead. [Release status](/reference/release-status) says which release brings each call.

## Next steps

- [TypeScript](/sdks/typescript)
- [Rust](/sdks/rust)
- [Python](/sdks/python)
