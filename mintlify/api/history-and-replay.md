---
title: History and replay
description: Replay the examples a holo carries and prove its behaviour unchanged.
available_in: "0.6"
---

<Note>This page describes Prism 0.6, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>


Source: `prism-code` 0.3.0, `types/index.d.ts`.

Status: `acceptance()` is in prism-code 0.2.0. `history()`, `experimental_replay()` and `experimental_recorder()` are in this checkout and are experimental until the 0.6 freeze; both examples below are executed.

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

## Signature

```ts
history(): Promise<History>;

export interface History {
  schema: 'prism/history/1';
  application: string | null;
  recordedFrom?: { guest: DigestSet; model: DigestSet };
  events: HistoryEvent[];
}

export type HistoryEvent = { request: string; response: string; error?: never } | { request: string; error: string; response?: never };

export function experimental_replay(app: Application, histories: HistorySource | HistorySource[], options?: ReplayOptions): Promise<ReplayResult>;

export interface ReplayOptions {
  throw?: boolean;
  runtime?: { name: string; version: string };
}

export interface ReplayResult {
  application: string | null;
  runtime: { name: string; version: string };
  events: number;
  divergenceCount: number;
  histories: ReplayedHistoryResult[];
  statement: ReplayStatement | null;
}

export interface ReplayDivergence {
  index: number;
  request: string;
  expected: ReplayOutcome;
  actual: ReplayOutcome;
}

export interface ReplayStatement {
  _type: 'https://in-toto.io/Statement/v1';
  subject: [{ name: string; digest: DigestSet }];
  predicateType: 'https://uor.foundation/prism/replay/v1';
  predicate: {
    runtime: { name: string; version: string };
    model: DigestSet;
    histories: Array<{ digest: DigestSet; events: number; divergences: number }>;
    divergenceCount: number;
  };
}

export function experimental_recorder(app: Application): Recorder;

export interface Recorder {
  dispatch(request: Uint8Array | ArrayBuffer): Promise<Uint8Array>;
  history(): Promise<History>;
  events(): number;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const history = await app.history();
const result = await app.experimental_replay(history);

console.log(result.events, 'events,', result.divergenceCount, 'divergences');
console.log(result.statement.predicateType);
console.log(result.statement.predicate.histories);
```

```text
22 events, 0 divergences
https://uor.foundation/prism/replay/v1
[
  {
    digest: {
      blake3: '507d9bdf6de96117e3823f6614ed3f24544d6a4224e2ef0637f2057dfbafce98',
      sha256: '56d4c9c4bcf9f5c26fecd78d9709f9e3caef761d76f9a13ab94d7c31fe92ad1a'
    },
    events: 22,
    divergences: 0
  }
]
```

## Next steps

- [Dispatch inputs](/api/dispatch)
- [CLI reference](/reference/cli)
- [Check a holo](/api/verify)

Generated from prism-code 0.3.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.
