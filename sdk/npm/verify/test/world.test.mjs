// The WIT world of a guest (issue #278, docs/proposals/278-wit-world.md): inspect prints it, verify checks it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect, verify, worldOf, VerifyError } from '../src/index.mjs';
import { readInterface, checkWorld } from '../src/world.mjs';
import * as spec from '../src/vendor/spec.mjs';
import { reference, referenceGuest, mutatedGuest, withGuest, editExtension, assertVerdict } from './helpers.mjs';

const CONTRACT = 'hologram:guest/core-wasm@1';
const WORLD = spec.WORLDS[CONTRACT];
const LOCK_WORLD = { blake3: WORLD.digest.blake3, contract: CONTRACT, sha256: WORLD.digest.sha256 };
const STATEMENTS = ['provenance.statement', 'proof.statement', 'replay.statement'];
const checks = (verdict) => verdict.reasons.map((r) => r.check);
const MUTATIONS = {
  'extra import': /the guest imports env\.g \(global\), which the world does not list/,
  'extra export': /the guest exports extra, which the world does not declare/,
  'renamed export': /the guest lacks the export holo_run; the guest exports holo_rux, which the world does not declare/,
  'changed signature': /the guest exports holo_alloc\(i64\) -> i32, the world declares holo_alloc\(i32\) -> i32/,
  'changed kind': /the guest exports memory as a global, the world declares a memory/,
};

test('the reference guest has exactly the interface of the registry', () => {
  const found = readInterface(referenceGuest());
  assert.equal(found.ok, true);
  assert.deepEqual(found.imports, []);
  const byName = (a, b) => a.name.localeCompare(b.name);
  assert.deepEqual([...found.exports].sort(byName), WORLD.exports.map((e) => ({ ...e })).sort(byName));
  assert.deepEqual(checkWorld(CONTRACT, referenceGuest()), { known: true, conforms: true, problems: [] });
});

test('the reference archive declares its world, with the digests of the WIT file', () => {
  const { world } = inspect(reference());
  assert.deepEqual(world, {
    contract: CONTRACT,
    package: 'hologram:guest@1.0.0',
    name: 'core-wasm',
    file: 'worlds/core-wasm.wit',
    digest: { blake3: WORLD.digest.blake3, sha256: WORLD.digest.sha256 },
    imports: [],
    exports: ['holo_alloc', 'holo_run', 'memory'],
    conforms: true,
    capability_set: { label: world.capability_set.label, empty: true },
  });
});

test('a repacked reference archive is still clean: the helper rebuilds every fingerprint', async () => {
  const verdict = await verify(withGuest(referenceGuest()), { minimum: 'P0' });
  assertVerdict(verdict);
  assert.deepEqual(checks(verdict), STATEMENTS);
  assert.equal(inspect(withGuest(referenceGuest())).world.conforms, true);
});

for (const [change, message] of Object.entries(MUTATIONS)) {
  test(`a guest with ${change} fails world.contract and nothing else`, async () => {
    const bytes = withGuest(mutatedGuest(change));
    const verdict = await verify(bytes, { minimum: 'P0' });
    assertVerdict(verdict);
    assert.deepEqual(checks(verdict), ['world.contract', ...STATEMENTS]);
    assert.equal(verdict.reasons[0].withholds, 'P1');
    assert.match(verdict.reasons[0].message, /^The guest does not match the hologram:guest\/core-wasm@1 world: /);
    assert.match(verdict.reasons[0].message, message);
    // The mismatch is the archive not being what it says, so even the lowest bar fails it.
    assert.equal(verdict.level, 'P0');
    const { world } = inspect(bytes);
    assert.equal(world.conforms, false);
    assert.deepEqual(world.digest, WORLD.digest, 'the declared world is unchanged; the guest is what differs');
  });
}

test('a pin of the lock\'s inputs.world is met by the reference archive', async () => {
  const verdict = await verify(reference(), { minimum: 'P0', world: LOCK_WORLD });
  assertVerdict(verdict);
  assert.equal(verdict.passed, true);
  assert.deepEqual(checks(verdict), STATEMENTS);
  assert.equal((await verify(reference(), { minimum: 'P0', world: { sha256: WORLD.digest.sha256 } })).passed, true, 'one digest may be pinned alone');
  assert.equal((await verify(reference(), { minimum: 'P0', world: { contract: CONTRACT } })).passed, true);
});

test('a pin with another digest fails world.hash, names both values, and leaves the level alone', async () => {
  for (const algorithm of ['blake3', 'sha256']) {
    const pinned = '0'.repeat(64);
    const verdict = await verify(reference(), { minimum: 'P0', world: { ...LOCK_WORLD, [algorithm]: pinned } });
    assertVerdict(verdict);
    assert.equal(verdict.passed, false);
    assert.equal(verdict.level, 'P0');
    assert.deepEqual(checks(verdict), [...STATEMENTS, 'world.hash']);
    const reason = verdict.reasons.at(-1);
    assert.equal(reason.withholds, null);
    assert.match(reason.message, new RegExp(`the policy pins ${algorithm} ${pinned}, the world ${CONTRACT} has ${WORLD.digest[algorithm]}`));
  }
});

test('a pin of another contract, or of no world, fails world.hash', async () => {
  const other = await verify(reference(), { minimum: 'P0', world: { ...LOCK_WORLD, contract: 'hologram:guest/core-wasm@2' } });
  assert.equal(other.passed, false);
  assert.match(other.reasons.at(-1).message, /the policy pins contract hologram:guest\/core-wasm@2, the holo declares hologram:guest\/core-wasm@1/);
  const none = await verify(reference(), { minimum: 'P0', world: null });
  assertVerdict(none);
  assert.equal(none.passed, false);
  assert.equal(none.reasons.at(-1).check, 'world.hash');
  assert.match(none.reasons.at(-1).message, /expects no world/);
});

test('a world pin does not hide world.contract, and both are reported', async () => {
  const verdict = await verify(withGuest(mutatedGuest('extra export')), { minimum: 'P0', world: { ...LOCK_WORLD, sha256: 'f'.repeat(64) } });
  assert.deepEqual(checks(verdict), ['world.contract', ...STATEMENTS, 'world.hash']);
});

test('an invalid world pin gives no verdict: VerifyError policy.invalid', async () => {
  const bad = [
    'blake3',
    [],
    {},
    { contract: 7 },
    { sha256: 'ABC' },
    { blake3: 'a'.repeat(63) },
    { kind: 'core-wasm' },
  ];
  for (const world of bad) await assert.rejects(verify(reference(), { world }), (e) => e instanceof VerifyError && e.code === 'policy.invalid', JSON.stringify(world));
});

test('a contract this package has no world for: documents fail, conformance is not claimed', async () => {
  // The document schemas fix the contract today, so a holo of another contract fails holo.documents and prints no world.
  const swap = (text) => text.replaceAll('core-wasm@1', 'core-wasm@2');
  let bytes = editExtension(reference(), 'https://hologram.foundation/extension/application-directory/v1', swap);
  bytes = editExtension(bytes, 'https://uor.foundation/extension/prismpm-model/v1', swap);
  assert.equal(inspect(bytes).world, null);
  const verdict = await verify(bytes, { minimum: 'P0', world: { contract: 'hologram:guest/core-wasm@2', sha256: WORLD.digest.sha256 } });
  assert.ok(!checks(verdict).includes('world.contract'), 'an unknown world is not a conformance failure');
  assert.ok(checks(verdict).includes('holo.documents'));
  assert.equal(verdict.passed, false);
});

test('a world the registry lacks prints null members and pins nothing', () => {
  const world = worldOf('hologram:guest/core-wasm@2', referenceGuest());
  assert.deepEqual(world, { contract: 'hologram:guest/core-wasm@2', package: null, name: null, file: null, digest: null, imports: null, exports: null, conforms: null });
  assert.deepEqual(checkWorld('hologram:guest/core-wasm@2', referenceGuest()), { known: false, conforms: null, problems: [] });
});

test('worldOf is the one function that prints a world', () => {
  const { capability_set: _capabilitySet, ...printed } = inspect(reference()).world;
  assert.deepEqual(worldOf(CONTRACT, referenceGuest()), printed);
  assert.equal(worldOf(CONTRACT, null).conforms, null);
  assert.equal(worldOf('hologram:guest/other@9', referenceGuest()).conforms, null);
});

test('a module that is not wasm does not conform, and nothing throws', () => {
  for (const bytes of [new Uint8Array(0), Uint8Array.of(1, 2, 3), referenceGuest().subarray(0, 40), Uint8Array.from(referenceGuest(), (b, i) => (i > 20 ? 0xff : b))]) {
    const found = checkWorld(CONTRACT, bytes);
    assert.equal(found.conforms, false);
    assert.equal(found.problems.length, 1);
  }
});
