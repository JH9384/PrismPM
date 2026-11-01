---
title: Check a holo
description: Check digest, provenance, proof and world against a policy and get a verdict.
available_in: "0.5"
---

Source: `prism-code` 0.3.0, `types/index.d.ts`.

Status: `experimental_verify()` is in the prism-code source and not in the published 0.2.0, which checks the digest footer and every section label on load. It is experimental until the v0.6 freeze. No holo carries an attestation bundle yet, so every holo is P0 and the default policy fails it.

## Signature

```ts
export function experimental_verify(source: Uint8Array | ArrayBuffer | Blob | Application, options?: VerifyOptions): Promise<Verdict>;

experimental_verify(options?: VerifyOptions): Promise<Verdict>;

export interface VerifyOptions {
  name?: string;
  minimum?: AssuranceLevel;
  digests?: Partial<Record<'archive' | 'capabilities' | 'guest' | 'view' | 'model', Partial<DigestSet>>>;
  world?: { contract?: string; blake3?: string; sha256?: string } | null;
  capabilities?: CapabilitySet | null;
  effects?: Array<'clock' | 'random' | 'socket' | 'filesystem' | 'unknown'>;
  replay?: unknown;
  throw?: boolean;
  env?: Record<string, string | undefined>;
}

export function experimental_createClient(options?: VerifyOptions): Client;
```

## Returns

```ts
export interface Verdict {
  schema: 'prism/verdict/1';
  holo: string;
  level: AssuranceLevel;
  policy: { name: string; minimum: AssuranceLevel };
  passed: boolean;
  reasons: VerdictReason[];
}

export interface VerdictReason {
  check: string;
  code?: string;
  withholds: AssuranceLevel | null;
  message: string;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const verdict = await app.experimental_verify({ minimum: 'P0' });
console.log({ level: verdict.level, passed: verdict.passed });

try {
  await app.experimental_verify({ throw: true });
} catch (error) {
  console.log(error.name, error.code, error.check);
}
```

```text
{ level: 'P0', passed: true }
VerificationError verification_failed provenance.statement
```

## Next steps

- [Instantiate a holo](/docs/api/instantiate)
- [Attestations reference](/docs/reference/attestations)
- [Load a holo](/docs/api/load)

Generated from prism-code 0.3.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.
