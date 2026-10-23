---
title: Errors reference
description: Every error code the runtime raises and every CLI exit code.
---

Source: `prism-code` 0.2.0 source and type declarations, `sdk/docs/cli.json` 2026-10-23.

## Runtime errors

Status: the typed error classes of the v1.0 runtime are not in prism-code 0.2.0, which raises one class with a code. The table lists every code its source raises.

```ts
export class PrismCodeError extends Error {
  code: string;
  details?: unknown;
}
```

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
| `closure.files`         | `src/browser.mjs`, `src/closure.mjs`      |
| `closure.glue`          | `src/closure.mjs`                         |
| `closure.model`         | `src/closure.mjs`                         |
| `closure.provenance`    | `src/closure.mjs`                         |
| `core.allocation`       | `src/closure.mjs`, `src/core.mjs`         |
| `core.compile`          | `src/core.mjs`                            |
| `core.exports`          | `src/core.mjs`                            |
| `core.imports`          | `src/core.mjs`                            |
| `core.request`          | `src/core.mjs`                            |
| `core.response`         | `src/core.mjs`                            |
| `load.fetch`            | `src/browser.mjs`                         |
| `load.path`             | `src/node.mjs`                            |
| `load.source`           | `src/index.mjs`                           |
| `lock.image`            | `src/docker.mjs`                          |
| `mount.environment`     | `src/browser.mjs`                         |
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

- [CLI reference](/docs/reference/cli)
- [Error types](/docs/api/errors)
- [Load a holo](/docs/api/load)

Generated from prism-code 0.2.0, sdk/docs/cli.json 2026-10-23, @prism-code/spec 2026-10-23 at 31b61e31c986041a4667e2143680fdd9c3f7b812.
