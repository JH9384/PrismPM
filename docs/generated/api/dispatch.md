---
title: Dispatch inputs
description: Send one request to the holo and get its response.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`.

## Signature

```ts
dispatch(request: Uint8Array | ArrayBuffer): Promise<Uint8Array>;

export interface Limits {
  request: number;
  response: number;
  guestAllocation: number;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const request = new TextEncoder().encode('1\tadd\t20\t22');
const response = await app.dispatch(request);

console.log(JSON.stringify(new TextDecoder().decode(response)));
```

```text
"1\tok\t42"
```

## Next steps

- [History and replay](/docs/api/history-and-replay)
- [Error types](/docs/api/errors)
- [Load a holo](/docs/api/load)

Generated from prism-code 0.2.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.
