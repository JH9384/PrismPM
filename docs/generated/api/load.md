---
title: Load a holo
description: Read a holo from a path, a URL or bytes and get an application you can inspect and run.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`.

## Signature

```ts
export function load(source: Uint8Array | ArrayBuffer | Blob | string | URL, options?: LoadOptions): Promise<Application>;

export interface LoadOptions {
  model?: Record<string, unknown> | Uint8Array | string | null;
  stem?: string;
  files?: string[];
}
```

## Returns

```ts
export interface Application {
  kind: 'holo' | 'closure';
  name: string | null;
  model: Record<string, unknown> | null;
  profile: string | null;
  limits: Limits | null;
  vectors: Vector[];
  provenance: { model: Record<string, unknown> | null; browser: Record<string, unknown> | null };
  directory: Record<string, unknown> | null;
  metadata: unknown;
  identities: ArchiveIdentities | ClosureIdentities;
  evidence: Evidence;
  view: View;
  dispatch(request: Uint8Array | ArrayBuffer): Promise<Uint8Array>;
  acceptance(): Promise<AcceptanceResult>;
  attestations(): Attestation[];
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

console.log(app.name);
console.log(app.identities.verified);
console.log(app.limits);
```

```text
Calculator
true
{ request: 52, response: 27, guestAllocation: 65536 }
```

## Next steps

- [Dispatch inputs](/docs/api/dispatch)
- [Inspect a holo](/docs/api/inspect)
- [Holo format](/docs/reference/holo-format)

Generated from prism-code 0.2.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.
