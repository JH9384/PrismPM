---
title: TypeScript SDK
description: Install prism-code from npm and run a holo from Node.js or the browser.
available_in: "0.2.0"
---
`prism-code` is the runtime for Node.js 22 and later and for browsers with WebAssembly. It ships its own types and has no dependencies. Version 0.2.0 is on npm and its API is Experimental, so pin the exact version.

## Install

```bash
npm install prism-code@0.2.0
```

## Load, dispatch, replay

Three calls cover what 0.2.0 does. `load` opens a holo and checks its digest footer and every section label. `dispatch` sends one request to the program on a fresh instance and returns the response. `acceptance` replays every example the holo carries:

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

The calculator holo speaks a line-based text protocol, so the request and the response are bytes you encode and decode yourself. `load` also takes a `Uint8Array`, a `Blob`, or a URL ending in `.holo`.

## Use it in the browser

The same import works in a bundled browser page. Fetch the holo and pass the bytes:

```ts
import { load } from "prism-code";

const bytes = new Uint8Array(await (await fetch("./Calculator.holo")).arrayBuffer());
const app = await load(bytes);
```

## What comes next

`verify` with a verdict and an assurance level, the typed errors, `instantiate` with a capability set, streaming `dispatch`, `history`, `replay` and `asTool` arrive in later releases. [Release status](/reference/release-status) says which one brings each call. To check a holo without the runtime, use `@prism-code/verify`.

## Next steps

- [Run a holo](/guides/run-a-holo)
- [API reference](/api)
- [Release status](/reference/release-status)
- [Check in the browser](/api/verify-package)
