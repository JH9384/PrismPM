---
title: Error types
description: Every error the runtime throws and the code it carries.
available_in: "0.5"
---

<Note>This page describes Prism 0.5, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>


Source: `prism-code` 0.3.0, `types/index.d.ts`.

Status: the classes are in the prism-code source and not in the published 0.2.0. `DeterminismViolationError` and `ReplayError` are defined and mapped, and nothing raises them until replay ships.

## Signature

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

export class VerificationError extends PrismError {
  static readonly code: 'verification_failed';
}

export class ProofMismatchError extends PrismError {
  static readonly code: 'proof_mismatch';
}

export class CapabilityDeniedError extends PrismError {
  static readonly code: 'capability_denied';
}

export class WorldMismatchError extends PrismError {
  static readonly code: 'world_mismatch';
}

export class DeterminismViolationError extends PrismError {
  static readonly code: 'determinism_violation';
}

export class ReplayError extends PrismError {
  static readonly code: 'replay_failed';
}

export class MiddlewareError extends PrismError {
  static readonly code: 'middleware_failed';
  details: { name: string | null; step: MiddlewareStep; tags: string[] };
}
```

## Classes

| Class                       | Code                    | Verdict checks                                                |
| --------------------------- | ----------------------- | ------------------------------------------------------------- |
| `VerificationError`         | `verification_failed`   | `holo.*`, `provenance.*`, `policy.*`, and no verdict reached  |
| `ProofMismatchError`        | `proof_mismatch`        | `proof.*`                                                     |
| `CapabilityDeniedError`     | `capability_denied`     | `world.capabilities`, and the runtime's `capabilities.*`      |
| `WorldMismatchError`        | `world_mismatch`        | `world.contract`, `world.hash`                                |
| `DeterminismViolationError` | `determinism_violation` | `replay.divergence`                                           |
| `ReplayError`               | `replay_failed`         | every other `replay.*`                                        |
| `MiddlewareError`           | `middleware_failed`     | none: a middleware threw something that is not a `PrismError` |

## Codes of load and archive failures

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

## Next steps

- [Errors reference](/reference/errors)
- [Load a holo](/api/load)
- [Dispatch inputs](/api/dispatch)

Generated from prism-code 0.3.0.
