# @prism-code/testing

Test the code around a Prism holo without a network, a real clock or a running guest: a mock host, a clock that skips time, a dispatch that follows a script and throws on a call it did not expect, and histories you record and replay.

This is 0.1.0 and Experimental (see [STABILITY.md](../../../STABILITY.md)). The design is in [docs/proposals/286-testing.md](../../../docs/proposals/286-testing.md); the guide, with executed examples, is [Test your application](../../../docs/site/guides/test-your-application.md). Node 22 or later.

## Install

```bash
npm install --save-dev @prism-code/testing prism-code
```

`prism-code` is a peer dependency. The history reader, writer and recorder, the typed errors and the capability model are its own, imported and not copied, so a history written here is the file `prism-code replay` reads. The history calls need a `prism-code` release that includes histories (the release after 0.3.0).

## Use

```js
import { createMockHost, scriptedDispatch, recordHistory, assertReplays, referenceArchive } from '@prism-code/testing';

const host = createMockHost({ seed: 'a', capabilities: { schema: 'prism/capabilities/1', sets: { default: { 'allow-variables': ['region'] } } }, variables: { region: 'eu' } });
await host.clock.until(host.clock.sleep(60_000)); // no real time passes
host.variable('region'); // 'eu'; any other name is a CapabilityDeniedError

const dispatch = scriptedDispatch([{ request: 'add 1 2', response: 'ok 3' }]);
await dispatch('add 1 2');
dispatch.assertComplete(); // ScriptIncompleteError if a listed call never happened
```

## API

| Export | What it does |
| --- | --- |
| `createMockHost(options)` | A host with `clock`, `random`, `fetch`, `kv`, `variable`, `calls` and `load`. Every resource is checked against the capability file you pass, and with none nothing is granted, as in `load`. |
| `createClock({ start })` | The clock alone: `now`, `date`, `setTimeout`, `clearTimeout`, `sleep`, `advance`, `next`, `runAll` and `until`, which skips to each timer the work waits on. |
| `createRandom({ seed })` | A seeded generator: `next`, `int`, `bytes`, `getRandomValues`, `uuid`. The sequence for a seed is fixed on every platform. |
| `scriptedDispatch(script)` | A stand-in for `app.dispatch`. Calls match in order; anything else throws `UnexpectedCallError`. `assertComplete()`, `remaining()` and `calls`. A `prism/history/1` is also a script. |
| `readHistory`, `writeHistory` | Read and write a history file in the canonical form `prism-code` writes. |
| `recordHistory(app, run)` | The history of the dispatches `run` makes, refusals included. |
| `assertReplays(app, histories)` | Replay against the build; `DeterminismViolationError` on a divergence. |
| `referenceArchive(name)`, `referenceArchives()` | Calculator and Payment Approval with their committed histories, read from the installed `prism-code`'s fixtures. |
| `runCli(args, { env })` | Run the installed `prism-code` command line: `{ code, out, err }`. The runtime calls a reference-archive test needs (`load`, `fromFile`, `inspect`, `experimental_verify`, the history and replay calls) are re-exported, so such a test imports this package only. |
| `UnexpectedCallError`, `ScriptIncompleteError`, `TestSetupError` | Typed errors, all `PrismError`s with stable `code`s: `unexpected_call`, `script_incomplete`, `test_setup`. |

`index.d.ts` has the types.

## Develop

```bash
cd sdk/npm/spec && npm run build              # the spec package's generated entry point
cd ../prism-code && npm install --no-package-lock --no-audit --no-fund --ignore-scripts
cd ../testing && npm install --no-package-lock --no-audit --no-fund --ignore-scripts && npm test
```
