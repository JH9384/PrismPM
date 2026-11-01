---
title: Replay examples
description: Run every example a holo carries and count how many still give the expected answer.
available_in: "0.2.0"
---
A holo carries the examples it was built from. Replaying them is the quickest check that a file behaves as it did when it was built. The output below was captured by running the code.

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const result = await app.acceptance();

console.log(result);
```

```text
{ total: 22, passed: 22, failed: [] }
```

Run this from the directory that holds the sample holo, `node_modules/prism-code/fixtures`. Each example runs on a fresh instance of the program, so one cannot affect another.

## Next steps

- [Check a holo](/docs/examples/check-a-holo)
- [History and replay](/docs/api/history-and-replay)
- [Proof and assurance](/docs/concepts/proof-and-assurance)
