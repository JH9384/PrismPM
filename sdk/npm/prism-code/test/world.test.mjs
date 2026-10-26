// The WIT world as the holo's contract (issue #278, docs/proposals/278-wit-world.md), seen from the runtime.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load, inspect, experimental_verify, WorldMismatchError, VerificationError, PrismError, classForCheck, ERROR_CLASSES } from '../src/index.mjs';
import { inspect as verifyInspect } from '../../verify/src/index.mjs';
import { reference, mutatedGuest, withGuest } from '../../verify/test/helpers.mjs';

const WORLD = {
  contract: 'hologram:guest/core-wasm@1',
  blake3: '0774a8ecbfa945a427712ee7d7ad406195b2d07492ceae15cca0067276c9ced8',
  sha256: 'a566c87a359cadf98f652747f1b3574aa307ff5f652a190c6d99c350db9cf369',
};
const CHANGES = ['extra import', 'extra export', 'renamed export', 'changed signature', 'changed kind'];

test('WorldMismatchError is a PrismError with its own code and maps both world checks', () => {
  assert.ok(new WorldMismatchError('x') instanceof PrismError);
  assert.equal(WorldMismatchError.code, 'world_mismatch');
  assert.equal(ERROR_CLASSES.world_mismatch, WorldMismatchError);
  assert.equal(classForCheck('world.contract'), WorldMismatchError);
  assert.equal(classForCheck('world.hash'), WorldMismatchError);
  assert.notEqual(classForCheck('world.capabilities'), WorldMismatchError, 'the capability check stays #283\'s');
});

test('inspect prints the world and equals @prism-code/verify for the reference archive and every changed guest', async () => {
  const archives = [reference(), ...CHANGES.map((change) => withGuest(mutatedGuest(change)))];
  for (const bytes of archives) assert.deepEqual(await inspect(bytes), verifyInspect(bytes));
  const { world } = await inspect(reference());
  assert.equal(world.conforms, true);
  assert.deepEqual(world.digest, { blake3: WORLD.blake3, sha256: WORLD.sha256 });
  assert.equal((await inspect(withGuest(mutatedGuest('extra import')))).world.conforms, false);
});

test('holo.experimental_verify passes the lock\'s inputs.world unchanged', async () => {
  const app = await load(reference());
  const verdict = await app.experimental_verify({ minimum: 'P0', world: WORLD, throw: true });
  assert.equal(verdict.passed, true);
});

test('a world hash that differs throws WorldMismatchError with the check, the verdict and every reason', async () => {
  const app = await load(reference());
  const pinned = { ...WORLD, sha256: '0'.repeat(64) };
  await assert.rejects(
    app.experimental_verify({ world: pinned, throw: true, env: {} }),
    (error) => {
      assert.ok(error instanceof WorldMismatchError);
      assert.equal(error.code, 'world_mismatch');
      assert.equal(error.check, 'world.hash');
      assert.match(error.message, /the policy pins sha256 0{64}/);
      assert.equal(error.verdict.passed, false);
      assert.ok(error.reasons.some((r) => r.check === 'provenance.statement'), 'the whole verdict travels with the error');
      return true;
    },
    'the pin is named before the missing attestations that also fail the default policy',
  );
  const verdict = await app.experimental_verify({ world: pinned, minimum: 'P0' });
  assert.equal(verdict.passed, false, 'without throw the verdict says so');
  assert.equal(verdict.level, 'P0');
});

test('a contract pin and a null pin throw WorldMismatchError too', async () => {
  for (const world of [{ contract: 'hologram:guest/core-wasm@2' }, null]) {
    await assert.rejects(experimental_verify(reference(), { world, minimum: 'P0', throw: true }), (e) => e instanceof WorldMismatchError && e.check === 'world.hash');
  }
});

for (const change of CHANGES) {
  test(`a guest with ${change} throws WorldMismatchError world.contract`, async () => {
    const bytes = withGuest(mutatedGuest(change));
    await assert.rejects(experimental_verify(bytes, { throw: true, env: {} }), (e) => e instanceof WorldMismatchError && e.check === 'world.contract' && /the world/.test(e.message));
    // The guest is wrong even where the level asks for nothing, because world.contract withholds P1 and a P1 floor sees it.
    await assert.rejects(experimental_verify(bytes, { minimum: 'P1', throw: true, env: {} }), (e) => e instanceof WorldMismatchError);
  });
}

test('an integrity failure is still a VerificationError, and a bad world pin gives no verdict', async () => {
  const bytes = reference();
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(experimental_verify(bytes, { throw: true, env: {} }), (e) => e instanceof VerificationError && e.check === 'holo.integrity');
  await assert.rejects(experimental_verify(reference(), { world: { sha256: 'xyz' } }), (e) => e instanceof VerificationError && e.check === 'policy.invalid');
});
