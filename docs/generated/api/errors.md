---
title: Error types
description: Every error the runtime throws and the code it carries.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`.

## Signature

```ts
export class PrismCodeError extends Error {
  code: string;
  details?: unknown;
}
```

## Codes

| Code                 | Raised in                            |
| -------------------- | ------------------------------------ |
| `archive.blob`       | `src/archive.mjs`                    |
| `archive.bounds`     | `src/archive.mjs`                    |
| `archive.directory`  | `src/archive.mjs`                    |
| `archive.extension`  | `src/archive.mjs`                    |
| `archive.flags`      | `src/archive.mjs`                    |
| `archive.input`      | `src/archive.mjs`                    |
| `archive.kind`       | `src/archive.mjs`                    |
| `archive.magic`      | `src/archive.mjs`                    |
| `archive.manifest`   | `src/archive.mjs`                    |
| `archive.metadata`   | `src/archive.mjs`                    |
| `archive.model`      | `src/archive.mjs`, `src/index.mjs`   |
| `archive.provenance` | `src/archive.mjs`                    |
| `archive.version`    | `src/archive.mjs`                    |
| `closure.files`      | `src/browser.mjs`, `src/closure.mjs` |
| `closure.glue`       | `src/closure.mjs`                    |
| `closure.model`      | `src/closure.mjs`                    |
| `closure.provenance` | `src/closure.mjs`                    |
| `core.allocation`    | `src/closure.mjs`, `src/core.mjs`    |
| `core.compile`       | `src/core.mjs`                       |
| `core.exports`       | `src/core.mjs`                       |
| `core.imports`       | `src/core.mjs`                       |
| `core.request`       | `src/core.mjs`                       |
| `core.response`      | `src/core.mjs`                       |
| `load.fetch`         | `src/browser.mjs`                    |
| `load.path`          | `src/node.mjs`                       |
| `load.source`        | `src/index.mjs`                      |
| `lock.image`         | `src/docker.mjs`                     |
| `mount.environment`  | `src/browser.mjs`                    |
| `view.bounds`        | `src/view.mjs`                       |
| `view.entry`         | `src/view.mjs`                       |
| `view.magic`         | `src/view.mjs`                       |
| `view.order`         | `src/view.mjs`                       |
| `view.version`       | `src/view.mjs`                       |

## Example

Status: the typed error classes of the v1.0 runtime are not in prism-code 0.2.0, which throws one class whose `code` names the check that failed.

## Next steps

- [Errors reference](/docs/reference/errors)
- [Load a holo](/docs/api/load)
- [Dispatch inputs](/docs/api/dispatch)

Generated from prism-code 0.2.0.
