---
title: History and replay
description: Replay the examples a holo carries and prove its behaviour unchanged.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`.

Status: `history()` and `replay()` are not in prism-code 0.2.0. `acceptance()` replays the examples the holo carries and is executed below.

## Signature

```ts
acceptance(): Promise<AcceptanceResult>;

export interface AcceptanceResult {
  total: number;
  passed: number;
  failed: AcceptanceFailure[];
}

export interface AcceptanceFailure {
  index: number;
  request: Uint8Array;
  expected: Uint8Array;
  actual?: Uint8Array;
  error?: unknown;
}

export interface Vector {
  request: Uint8Array;
  response: Uint8Array;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const result = await app.acceptance();

console.log(result);
```

```text
{ total: 22, passed: 22, failed: [] }
```

## Next steps

- [Dispatch inputs](/docs/api/dispatch)
- [CLI reference](/docs/reference/cli)
- [Check a holo](/docs/api/verify)

Generated from prism-code 0.2.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.
