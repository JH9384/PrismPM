// Component evidence only. The owning gate additionally supplies generated
// source fixtures/codecs and replays every observed ordinary frame natively.
import assert from 'node:assert/strict';
import test from 'node:test';
import {openPresentation} from '../../sdk/browser/presentation-dom.mjs';
import {PresentationError} from '../../sdk/browser/presentation-wire.mjs';
import {journey, verifyMutants} from './browser.mjs';

test('private DOM API rejects accessor options without invoking caller code', () => {
  let called = 0;
  const options = Object.defineProperty({}, 'root', {get() { called++; throw Error('raw payload'); }});
  assert.throws(() => openPresentation(options), error => error instanceof PresentationError && error.code === 'options');
  assert.equal(called, 0);
  assert.throws(() => openPresentation(null), PresentationError);
  assert.throws(() => openPresentation({}, true), PresentationError);
});

test('actual Chromium executes all private DOM component journeys', async () => {
  const result = await journey(null);
  assert.equal(result.modelChecked, false);
  assert.deepEqual(result.calls, [], 'component evidence never fabricates source execution');
});

for (const engine of ['firefox', 'webkit']) test(engine + ' executes every private DOM component journey', async () => {
  const result = await journey(null, {}, engine);
  assert.equal(result.modelChecked, false);
  assert.deepEqual(result.calls, [], 'component evidence never fabricates source execution');
});

test('actual Chromium kills focused DOM implementation mutants', async t => {
  await verifyMutants(t, null);
});
