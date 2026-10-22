import assert from 'node:assert/strict';
import {browserFixture, captureSources, isSemanticCounterexample} from './browser.mjs';
import {bytes, encode} from './corpus.mjs';

const expectedContext = encode([Array.from({length: 6}, (_, index) => bytes(32, index)), bytes(32, 6), 0,
  bytes(32, 7), bytes(32, 8), bytes(32, 9), bytes(32, 10), 0xffffffff, bytes(32, 11)]).toString('hex');
const erasedContext = '00'.repeat(expectedContext.length / 2);

const mutations = [
  ['signature', 'if (valid !== true)', 'if (false)', {journey: 'bad-signature', check: 'changed signature refused', expected: 'signature-rejected', actual: 'accepted'}],
  ['expected-context', 'if (run(module, request([1, 2, capturedContext, expectedKey, capturedEnvelope])) !== true)', 'if (false)',
    {journey: 'binding-0', check: 'binding mismatch refused', expected: 'model-rejected', actual: 'accepted'}],
  ['captured-context', 'expectedContext = copy(fields.expectedContext, FRAME)', 'expectedContext = fields.expectedContext',
    {journey: 'captured-inputs', check: 'context captured before suspension', expected: expectedContext, actual: erasedContext}],
  ['returned-context', 'context: copy(value.expectedContext, FRAME)', 'context: value.expectedContext',
    {journey: 'returned-copies', check: 'returned evidence copy context', expected: expectedContext, actual: erasedContext}],
  ['instance-brand', 'const evidence = new WeakMap();', 'const evidence = sharedEvidence;',
    {journey: 'opaque-instance', check: 'cross-instance handle refused', expected: 'invalid-evidence', actual: 'accepted'}],
  ['frozen-verifier', 'return Object.freeze(Object.assign(Object.create(null), {authenticate, readEvidence}));',
    'return Object.assign(Object.create(null), {authenticate, readEvidence});',
    {journey: 'opaque-instance', check: 'constructorless verifier', expected: true, actual: false}],
];
export async function verifyHostMutations(build, engine) {
  const original = captureSources(build.inputs)['signed-context.mjs'], results = [];
  const expectedSignature = mutations[0][3];
  const counterfeit = Object.assign(new Error('actual signed-context semantic counterexample'), expectedSignature);
  assert.equal(isSemanticCounterexample(counterfeit, expectedSignature), false);
  const factory = 'export async function openSignedContext(options) {';
  assert.equal(original.split(factory).length, 2);
  const unavailable = original.replace(factory, factory + '\nthrow Error("planted ordinary SDK failure: changed signature refused");');
  await assert.rejects(browserFixture(build, engine, unavailable), error => {
    assert.match(error.message, /planted ordinary SDK failure/);
    assert.equal(isSemanticCounterexample(error, expectedSignature), false); return true;
  });
  await assert.rejects(async () => {
    await assert.rejects(browserFixture(build, engine, original), error => isSemanticCounterexample(error, expectedSignature));
  }, /Missing expected rejection/, 'surviving no-op source cannot count as a killed mutant');
  for (const [id, before, after, expected] of mutations) {
    assert.equal(original.split(before).length, 2, 'exact host mutation ' + id);
    let source = original.replace(before, after);
    if (id === 'instance-brand') source = 'const sharedEvidence = new WeakMap();\n' + source;
    await assert.rejects(browserFixture(build, engine, source), error => {
      if (id !== 'signature') assert.equal(isSemanticCounterexample(error, expectedSignature), false,
        'wrong journey/check is not interchangeable mutation evidence');
      return isSemanticCounterexample(error, expected);
    },
      'assertion-owned exact semantic counterexample ' + id);
    results.push(id);
  }
  assert.equal(results.length, 6); return results;
}
