import assert from 'node:assert/strict';
import {createHash, createPublicKey} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {browserFixture, readSemanticCounterexample} from './browser.mjs';
import {decodeEffectWire} from '../../sdk/browser/effects-wire.mjs';
import {sha} from '../browser-view/compile.mjs';
import {domain, encode} from './corpus.mjs';

const mutations = Object.freeze([
  {id: 'key-identity', from: 'keyIdentity = await identityPrincipal(publicKey);',
    to: 'keyIdentity = await digestBytes(material);'},
  {id: 'identity-domain', from: 'const digest = await digestBytes(material);',
    to: 'const digest = await digestBytes(genesis);'},
  {id: 'captured-input', from: 'const genesis = copy(fields.genesis, FRAME), expected = copy(fields.expectedNamespace, 32);',
    to: 'const genesis = fields.genesis, expected = copy(fields.expectedNamespace, 32);'},
  {id: 'returned-copy', from: 'identity: copy(value.identity, 32)', to: 'identity: value.identity'},
]);

export function verifySemanticCounterexample(error, id) {
  const evidence = readSemanticCounterexample(error), genesis = Buffer.from(evidence.genesis, 'hex');
  // Fixture inputs originate outside the SDK under test. Independently check
  // their canonical bytes and derive the precise counterexample, not its label.
  const value = decodeEffectWire(genesis);
  assert.ok(Array.isArray(value) && value.length === 4 && value[0] === 1);
  assert.deepEqual(Buffer.from(value[1]), Buffer.alloc(32, 11));
  assert.deepEqual(Buffer.from(value[2]), Buffer.alloc(32, 12));
  assert.equal(value[3].length, 65); assert.equal(value[3][0], 4);
  assert.deepEqual(encode(value), genesis);
  const key = Buffer.from(value[3]);
  createPublicKey({key: {kty: 'EC', crv: 'P-256', x: key.subarray(1, 33).toString('base64url'),
    y: key.subarray(33).toString('base64url')}, format: 'jwk'});
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const identity = hash(Buffer.concat([domain, genesis]));
  const expected = {
    'key-identity': {journey: 'declaration', check: 'key-identity', expected: 'sha256:' + hash(key), actual: 'sha256:' + identity},
    'identity-domain': {journey: 'declaration', check: 'identity-digest', expected: identity, actual: hash(genesis)},
    'captured-input': {journey: 'captured-inputs', check: 'captured-before-await', expected: evidence.genesis,
      actual: '00'.repeat(genesis.length)},
    'returned-copy': {journey: 'returned-copies', check: 'copied-fact-identity', expected: identity, actual: '00'.repeat(32)},
  };
  assert.ok(Object.hasOwn(expected, id), 'closed host mutation identity');
  assert.deepEqual(evidence.failure, expected[id], 'exact independently calculated host counterexample');
  return evidence;
}

export async function verifyHostMutations(build, engine, foreignArtifact) {
  const original = readFileSync(new URL('../../sdk/browser/account-genesis.mjs', import.meta.url), 'utf8');
  assert.equal(sha(Buffer.from(original)), build.inputs['sdk/browser/account-genesis.mjs']);
  // An unavailable engine or failed pristine setup cannot count as a killed defect.
  const positive = await browserFixture(build, engine, null, foreignArtifact);
  assert.equal(positive.journeys.length, 12);
  const counterfeit = Object.assign(new Error('actual account-genesis semantic counterexample'),
    {journey: 'declaration', check: 'key-identity', expected: 'sha256:' + '00'.repeat(32), actual: 'sha256:' + '01'.repeat(32)});
  assert.throws(() => verifySemanticCounterexample(counterfeit, 'key-identity'), /privately branded/);
  const factory = 'export async function openAccountGenesis(options) {';
  assert.equal(original.split(factory).length, 2);
  const unavailable = original.replace(factory, factory + '\nthrow Error("planted ordinary SDK failure: key-identity");');
  await assert.rejects(browserFixture(build, engine, unavailable, foreignArtifact), error => {
    assert.match(error.message, /planted ordinary SDK failure/);
    assert.throws(() => verifySemanticCounterexample(error, 'key-identity'), /privately branded/); return true;
  });
  const results = [];
  for (const mutation of mutations) {
    assert.equal(original.split(mutation.from).length, 2, 'one actual host mutation site');
    const changed = original.replace(mutation.from, mutation.to);
    assert.notEqual(changed, original);
    let evidence;
    await assert.rejects(browserFixture(build, engine, changed, foreignArtifact), error => {
      evidence = verifySemanticCounterexample(error, mutation.id);
      const wrong = mutation.id === 'key-identity' ? 'identity-domain' : 'key-identity';
      assert.throws(() => verifySemanticCounterexample(error, wrong), /exact independently calculated host counterexample/);
      return true;
    });
    results.push({id: mutation.id, failure: evidence.failure, fixtureGenesis: evidence.genesis,
      source: sha(Buffer.from(changed))});
  }
  // A no-op is never a killed mutation, even with a plausible expected check.
  await assert.rejects(async () => {
    await assert.rejects(browserFixture(build, engine, original, foreignArtifact), error => {
      verifySemanticCounterexample(error, 'key-identity'); return true;
    });
  }, error => error.code === 'ERR_ASSERTION' && error.message.includes('Missing expected rejection'));
  assert.equal(results.length, 4); return results;
}
