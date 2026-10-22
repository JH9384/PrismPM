import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createPkceS256, PkceError} from '../../sdk/browser/pkce.mjs';
import {corpus, officialExample, RFC_SHA256} from './corpus.mjs';
import {frozenInputs, verifyFrozenInputs, sourceClosure, assertCapturedPkceSources,
  assertPkceCompilerInputs} from './compile.mjs';

test('RFC source and exact independent corpus cannot be omitted', () => {
  assert.equal(officialExample().verifier, 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  const rows = corpus(); assert.equal(rows.length, 33930);
  assert.ok(rows.some(row => row.request.length === 131));
  assert.equal(rows.filter(row => row.id.startsWith('octet-128-')).length, 32768);
  const authority = readFileSync(new URL('../../model/authorities.toml', import.meta.url), 'utf8')
    .split('[[authority]]').filter(row => row.includes('id = "IETF-RFC-7636"'));
  assert.equal(authority.length, 1);
  assert.ok(authority[0].includes('acquired_sha256 = "' + RFC_SHA256 + '"'));
  assert.ok(authority[0].includes('immutable_url = "https://www.rfc-editor.org/rfc/rfc7636.txt"'));
  assert.ok(authority[0].includes('realized_by = ["ST-17"]'));
});
test('private PKCE artifact options reject aliases, accessors and extra authority', async () => {
  const options = () => ({bytes: new Uint8Array(8), sha256: new Uint8Array(32)});
  for (const value of [null, [], Object.create(null), {...options(), accepted: true}, {...options(), profile: 'trusted'}])
    await assert.rejects(createPkceS256(value), /invalid-input/);
  let calls = 0;
  const value = options(); Object.defineProperty(value, 'bytes', {get() {calls++; throw Error('private');}});
  await assert.rejects(createPkceS256(value), /invalid-input/); assert.equal(calls, 0);
  await assert.rejects(createPkceS256(options(), true), /invalid-input/);
  await assert.rejects(createPkceS256(options()), /artifact-mismatch/);
  for (const bytes of [new Uint8Array(new SharedArrayBuffer(8)), new ArrayBuffer(8), [], 'bytes']) {
    await assert.rejects(createPkceS256({...options(), bytes}), error => error instanceof PkceError && error.code === 'invalid-input');
  }
  const detached = new Uint8Array(8); structuredClone(detached.buffer, {transfer: [detached.buffer]});
  await assert.rejects(createPkceS256({...options(), bytes: detached}), error => error instanceof PkceError && error.code === 'invalid-input');
});
test('source custody captures the exact complete module and oracle graph', () => {
  const inputs = frozenInputs(), sources = sourceClosure(); assertCapturedPkceSources(inputs, sources);
  for (const name of ['sdk/browser/pkce.mjs', 'sdk/browser/identity.mjs', 'tests/browser-pkce/oracles/rfc7636.txt',
    'tests/browser-view/kernel-provenance.mjs', 'tests/browser-view/compiler-artifact.mjs']) assert.ok(inputs[name]);
  sources.delete('Foundation.Bytes'); assert.throws(() => assertCapturedPkceSources(inputs, sources), /source module inventory/);
});

test('PKCE input custody refuses copied maps and missing transitive inputs', () => {
  const inputs = frozenInputs(); verifyFrozenInputs(inputs);
  assert.throws(() => verifyFrozenInputs(Object.freeze({...inputs})), /actual complete captured PKCE inputs/);
  const missing = {...inputs}; delete missing['tests/browser-view/compiler-owner.mjs'];
  assert.throws(() => verifyFrozenInputs(Object.freeze(missing)), /actual complete captured PKCE inputs/);
  assert.ok(Object.isFrozen(inputs));
});

test('PKCE compiler binding refuses fabricated and copied owner handles before execution', () => {
  for (const owner of [null, {}, {evidence: {family: 'pkce', inputs: {}}},
    {runDriver() {throw Error('caller compiler executed');}}])
    assert.throws(() => assertPkceCompilerInputs(owner, {}), /actual fresh compiler owner/);
});
