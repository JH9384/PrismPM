---
title: Call a holo
description: Load the sample holo, send it one request and replay its examples from JavaScript.
available_in: "0.2.0"
---
This example loads the sample calculator, sends it one request and replays the examples it carries. Every output on this page was captured by running the code.

Install the runtime, then run the script from the directory that holds the sample holo, `node_modules/prism-code/fixtures`:

```bash
npm install prism-code
```

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');
console.log(app.name, app.identities.verified);

const response = await app.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
console.log(JSON.stringify(new TextDecoder().decode(response)));

const result = await app.acceptance();
console.log(result.passed, 'of', result.total, 'examples replayed');
```

```text
Calculator true
"1\tok\t42"
22 of 22 examples replayed
```

The request is bytes, because the runtime moves bytes and leaves the encoding to you. This application takes tab-separated text: a leading `1`, the operation and its arguments. Its response has the same leading `1`, then `ok` and the answer.

## Next steps

- [Replay examples](/docs/examples/replay-examples)
- [Load a holo](/docs/api/load)
- [Dispatch inputs](/docs/api/dispatch)
