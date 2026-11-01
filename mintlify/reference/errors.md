---
title: Errors reference
description: Every error code the runtime raises and every CLI exit code.
available_in: "0.5"
---

<Note>This page describes Prism 0.5, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>


Source: `prism-code` 0.3.0 source and type declarations, `sdk/docs/cli.json` 2026-10-30.

## Runtime errors

Status: the typed error classes are in the prism-code source and are not in the published 0.2.0. The table lists every code the source raises.

```ts
export class PrismError extends Error {
  static readonly code: string;
  code: string;
  check?: string;
  diagnostic?: string;
  details?: unknown;
  verdict?: Verdict;
  reasons?: VerdictReason[];
  constructor(
    message: string,
    options?: { code?: string; check?: string; diagnostic?: string; details?: unknown; verdict?: Verdict; reasons?: VerdictReason[]; cause?: unknown },
  );
}

export class PrismCodeError extends PrismError {
  code: string;
  constructor(code: string, message: string, details?: unknown);
}
```

The typed errors, their codes and the verdict checks that map to them are on the error types page.

| Code                    | Raised in                                 |
| ----------------------- | ----------------------------------------- |
| `archive.blob`          | `src/archive.mjs`                         |
| `archive.bounds`        | `src/archive.mjs`, `src/attestations.mjs` |
| `archive.directory`     | `src/archive.mjs`                         |
| `archive.extension`     | `src/archive.mjs`                         |
| `archive.flags`         | `src/archive.mjs`                         |
| `archive.input`         | `src/archive.mjs`                         |
| `archive.kind`          | `src/archive.mjs`                         |
| `archive.magic`         | `src/archive.mjs`                         |
| `archive.manifest`      | `src/archive.mjs`                         |
| `archive.metadata`      | `src/archive.mjs`                         |
| `archive.model`         | `src/archive.mjs`, `src/index.mjs`        |
| `archive.provenance`    | `src/archive.mjs`                         |
| `archive.version`       | `src/archive.mjs`                         |
| `attestation.bundle`    | `src/attestations.mjs`                    |
| `attestation.duplicate` | `src/attestations.mjs`                    |
| `attestation.envelope`  | `src/attestations.mjs`                    |
| `attestation.footer`    | `src/attestations.mjs`                    |
| `attestation.input`     | `src/attestations.mjs`                    |
| `attestation.lines`     | `src/attestations.mjs`                    |
| `attestation.position`  | `src/attestations.mjs`                    |
| `attestation.statement` | `src/attestations.mjs`                    |
| `attestation.subject`   | `src/attestations.mjs`                    |
| `capabilities.invalid`  | `src/capabilities.mjs`, `src/index.mjs`   |
| `capabilities.kind`     | `src/capabilities.mjs`                    |
| `capabilities.path`     | `src/node.mjs`                            |
| `closure.files`         | `src/browser.mjs`, `src/closure.mjs`      |
| `closure.glue`          | `src/closure.mjs`                         |
| `closure.model`         | `src/closure.mjs`                         |
| `closure.provenance`    | `src/closure.mjs`                         |
| `container.ambiguous`   | `src/containers.mjs`                      |
| `container.input`       | `src/containers.mjs`                      |
| `container.missing`     | `src/containers.mjs`                      |
| `container.running`     | `src/containers.mjs`                      |
| `container.state`       | `src/containers.mjs`                      |
| `container.store`       | `src/node.mjs`                            |
| `core.allocation`       | `src/closure.mjs`, `src/core.mjs`         |
| `core.compile`          | `src/core.mjs`                            |
| `core.exports`          | `src/core.mjs`                            |
| `core.request`          | `src/core.mjs`                            |
| `core.response`         | `src/core.mjs`                            |
| `dev.path`              | `src/dev-cli.mjs`                         |
| `dev.port`              | `src/dev-server.mjs`                      |
| `dev.project`           | `src/dev-cli.mjs`                         |
| `init.template`         | `src/init.mjs`                            |
| `inspect.kind`          | `src/index.mjs`                           |
| `inspect.selector`      | `src/inspect.mjs`                         |
| `load.fetch`            | `src/browser.mjs`                         |
| `load.path`             | `src/node.mjs`                            |
| `load.source`           | `src/index.mjs`                           |
| `lock.image`            | `src/docker.mjs`, `src/init.mjs`          |
| `manifest.env`          | `src/manifest.mjs`                        |
| `manifest.invalid`      | `src/manifest.mjs`                        |
| `manifest.overlay`      | `src/manifest.mjs`                        |
| `manifest.path`         | `src/node.mjs`                            |
| `manifest.secret`       | `src/manifest.mjs`                        |
| `manifest.toml`         | `src/toml.mjs`                            |
| `middleware.name`       | `src/middleware.mjs`                      |
| `middleware.relative`   | `src/middleware.mjs`                      |
| `middleware.shape`      | `src/middleware.mjs`, `src/tracing.mjs`   |
| `middleware.step`       | `src/middleware.mjs`                      |
| `mount.environment`     | `src/browser.mjs`                         |
| `provenance.archive`    | `src/provenance.mjs`                      |
| `provenance.duplicate`  | `src/provenance.mjs`                      |
| `provenance.input`      | `src/provenance.mjs`                      |
| `provenance.lock`       | `src/provenance.mjs`                      |
| `provenance.mode`       | `src/provenance.mjs`                      |
| `view.bounds`           | `src/view.mjs`                            |
| `view.entry`            | `src/view.mjs`                            |
| `view.magic`            | `src/view.mjs`                            |
| `view.order`            | `src/view.mjs`                            |
| `view.version`          | `src/view.mjs`                            |

## CLI exit codes

| Code | Name          | Meaning                                                                                               |
| ---- | ------------- | ----------------------------------------------------------------------------------------------------- |
| 0    | pass          | The verb did what you asked and every check it ran passed.                                            |
| 1    | fail          | A check failed, an intent sentence is unproved, or a replay diverged.                                 |
| 2    | cannot verify | No verdict was reached: a missing attestation, an unreachable registry or an unknown format revision. |

## Next steps

- [CLI reference](/reference/cli)
- [Error types](/api/errors)
- [Load a holo](/api/load)

Generated from prism-code 0.3.0, sdk/docs/cli.json 2026-10-30, @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.
