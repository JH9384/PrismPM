---
title: Release status
description: What you can use today and which release each Prism feature lands in.
available_in: "0.2.0"
---
These docs describe Prism 1.0. Use this page to see what works today and what each release adds. Every other page names the release it needs in its `available_in` field, and that value comes from the table below.

Today `prism-code` 0.2.0 is on npm. It loads a holo, dispatches a request to it, and replays the examples it carries. Its command serves a holo and runs the build in the pinned SDK image. The `prism` CLI has not shipped.

## What is published

<!-- generated:distribution:begin -->
| What                     | Today         | Note                                                                                     |
| ------------------------ | ------------- | ---------------------------------------------------------------------------------------- |
| Documented API           | 1.0           | These docs describe Prism 1.0. Every page says which release it needs in `available_in`. |
| `prism-code` on npm      | 0.2.0         | `load`, `dispatch` and `acceptance`, and the `prism-code` command.                       |
| `prism` CLI              | not shipped   | Today `prism-code check` and `prism-code build` run the build in the pinned SDK image.   |
| `@prism-code/*` packages | not published | `@prism-code/spec` and `@prism-code/verify` are written and publish with 0.5.            |
| Rust crates              | not published | The `prism-code` crate ships with 1.0-beta.1.                                            |
| Python package           | not published | The `prism-code` package ships with 1.1.                                                 |
<!-- generated:distribution:end -->

## Releases

<!-- generated:releases:begin -->
| Release    | Status             | What it brings                                                                                   |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| 0.2.0      | shipped 2026-10-23 | The prism-code runtime and command on npm: load a holo, dispatch a request, replay its examples. |
| 0.5        | planned            | Lock, check, proof and attestations.                                                             |
| 0.6        | planned            | The world, capability sets, the run gate, replay and conformance.                                |
| 1.0-beta.1 | planned            | Push, pull, deploy, Docker export, agent bridges, plugins, the Rust runtime and these docs.      |
| 1.0-rc     | planned            | Release candidates and hardening.                                                                |
| 1.0        | planned            | The CLI and the runtime API become Stable.                                                       |
| 1.1        | planned            | The Python runtime, verifier plugins and host plugins.                                           |
<!-- generated:releases:end -->

## Feature by release

<!-- generated:features:begin -->
| Feature                                                                                                                          | Available in |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `prism-code` library: `load`, `dispatch`, and `acceptance`, which replays the examples a holo carries                            | 0.2.0        |
| `prism-code run` serves a holo, `prism-code vectors` replays its examples, `prism-code inspect` prints what it says about itself | 0.2.0        |
| `prism-code check` and `prism-code build` run the build in the SDK image pinned by the lockfile                                  | 0.2.0        |
| The holo format: section table, sha256 and BLAKE3 digests, digest footer                                                         | 0.2.0        |
| `prism lock`, `prism update` and the full input lock                                                                             | 0.5          |
| `prism check` with a verdict, an assurance level and exit codes                                                                  | 0.5          |
| Provenance on by default at `prism build`                                                                                        | 0.5          |
| Proof at build, checked at `check`                                                                                               | 0.5          |
| Attestation bundle inside the holo                                                                                               | 0.5          |
| `prism attest` and `prism verify`, keyless signing, transparency log entries and signed timestamps                               | 0.5          |
| `prism inspect`                                                                                                                  | 0.5          |
| `holo.verify()` and typed errors in `prism-code`                                                                                 | 0.5          |
| `@prism-code/spec` and `@prism-code/verify` on npm                                                                               | 0.5          |
| The world as the holo's contract                                                                                                 | 0.6          |
| Capability sets, deny by default                                                                                                 | 0.6          |
| The `prism.toml` manifest and its overlays                                                                                       | 0.6          |
| Authoring from examples and intent                                                                                               | 0.6          |
| `prism init` and `npm create prism-code`                                                                                         | 0.6          |
| The `run` gate and `--allow-unverified`                                                                                          | 0.6          |
| Containers: `prism.containers`, `run --rm`, `rm` and exit codes from typed errors                                                | 0.6          |
| Policy files for `check` and `run`                                                                                               | 0.6          |
| Histories, `prism replay` and the replay attestation                                                                             | 0.6          |
| `prism dev` and the local studio                                                                                                 | 0.6          |
| `prism generate` bindings and typed client                                                                                       | 0.6          |
| `prism export` browser export and tarball                                                                                        | 0.6          |
| `@prism-code/testing` and `@prism-code/conformance`                                                                              | 0.6          |
| `prism push` and `prism pull` with attestations as referrers                                                                     | 1.0-beta.1   |
| `prism deploy` to GitHub and GitHub Pages                                                                                        | 1.0-beta.1   |
| `prism export --oci`                                                                                                             | 1.0-beta.1   |
| `prism inspect --audit` and the audit report                                                                                     | 1.0-beta.1   |
| Streaming dispatch                                                                                                               | 1.0-beta.1   |
| Vercel AI SDK tool and MCP server bridges                                                                                        | 1.0-beta.1   |
| CLI plugins, provider services and runtime middleware                                                                            | 1.0-beta.1   |
| Rust runtime, the `prism-code` crate                                                                                             | 1.0-beta.1   |
| The CLI and the runtime API are Stable                                                                                           | 1.0          |
| Python runtime, the `prism-code` package                                                                                         | 1.1          |
| Verifier plugins                                                                                                                 | 1.1          |
| Host plugins                                                                                                                     | 1.1          |
<!-- generated:features:end -->

## Next steps

- [Quickstart](/docs/get-started/quickstart)
- [TypeScript SDK](/docs/sdks/typescript)
- [Changelog](/docs/changelog)
