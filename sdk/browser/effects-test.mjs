import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompilerOwner,requireCompilerOwner} from '../../tests/browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../../tests/browser-view/compiler-owner-checks.mjs';
import {captureVerificationProducts} from '../../tests/browser-view/verification-products.mjs';
import {sourceClosure, verifyWire, verifyModelMutation, verifyInventory, prerequisite} from '../../tests/browser-effects/checks.mjs';
import {verifyJourneys, verifyHostMutants} from '../../tests/browser-effects/browser.mjs';

test('DK-20 generated bounded byte effects and real private browser execution', {timeout: 3500000}, async t => {
  const inputs = sourceClosure();
  const owner = createCompilerOwner('effects');
  let retirementAttempted = false;
  t.after(() => {
    if (!retirementAttempted) {retirementAttempted = true; owner.close();}
  });
  const substitutions = verifyCompilerOwnerSubstitutions(owner);
  const build = await verifyWire(t, owner); assert.equal(build.compilerOwner, owner.identity);
  await prerequisite(t, 'actual browser effects and exact std/no_std native transcripts', child => verifyJourneys(child, build));
  await prerequisite(t, 'planted private host boundary defects fail real browser execution', child => verifyHostMutants(child, build));
  await prerequisite(t, 'closed host/model diagnostic inventory', verifyInventory);
  for (const kind of ['binding', 'trailing', 'unknown']) {
    await prerequisite(t, 'actual LexLean ' + kind + ' mutation fails generated native and Wasm assertions', () => {t.diagnostic(JSON.stringify(verifyModelMutation(kind, owner)));});
  }
  const products = captureVerificationProducts(build.work, 'effects');
  retirementAttempted = true;
  const retirement = owner.close();
  assert.deepEqual(captureVerificationProducts(build.work, 'effects'), products,
    'complete generated products unchanged through compiler retirement');
  assert.deepEqual(sourceClosure(), inputs, 'complete effects inputs unchanged through compiler retirement');
  build.verifyEvidence();
  assert.throws(() => requireCompilerOwner(owner, 'effects'), /compiler owner closed/);
  assert.throws(() => owner.close(), /compiler owner closed/);
  t.diagnostic(JSON.stringify({compiler: owner.evidence, substitutions, retirement}));
});
