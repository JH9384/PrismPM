import assert from 'node:assert/strict';
import test from 'node:test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha} from '../../tests/browser-custody/compile.mjs';
import {credentialPublicBindings, signCredential, checkCredentialSigning, closeCredentialCustody} from './credential-custody.mjs';
import {verifyWire, verifyModelMutation, verifyInventory, prerequisite} from '../../tests/browser-custody/checks.mjs';
import {verifyJourneys, verifyHostMutants} from '../../tests/browser-custody/browser.mjs';
import {createCompilerOwner, requireCompilerOwner} from '../../tests/browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../../tests/browser-view/compiler-owner-checks.mjs';

test('private custody rejects forged handles before invoking cryptography or inspecting payloads', async () => {
  const forged = Object.freeze({});
  assert.throws(() => credentialPublicBindings(forged), {code: 'invalid-input'});
  assert.throws(() => closeCredentialCustody(forged), {code: 'invalid-input'});
  let inspected = false;
  const payload = new Proxy({}, {get() { inspected = true; throw new Error('caller getter'); }});
  assert.throws(() => checkCredentialSigning(forged, 'sign', payload), {code: 'invalid-input'});
  await assert.rejects(signCredential(forged, 'sign', payload), {code: 'invalid-input'});
  assert.equal(inspected, false);
});

test('DK-25 generated custody and actual atomic browser key storage', {timeout: 3500000}, async t => {
  const owner = createCompilerOwner('custody');
  const substitutions = verifyCompilerOwnerSubstitutions(owner);
  const build = await verifyWire(t, owner);
  assert.equal(build.compilerOwner, owner.identity);
  const browser = await prerequisite(t, 'actual browser custody and exact std/no_std native transcript', child => verifyJourneys(child, build));
  const hostMutants = await prerequisite(t, 'planted private custody defects fail actual browser execution', child => verifyHostMutants(child, build));
  await prerequisite(t, 'closed custody diagnostics and independent structural bounds', verifyInventory);
  const modelMutants = [];
  for (const kind of ['policy', 'limit', 'trailing']) modelMutants.push(await prerequisite(t,
    'actual LexLean ' + kind + ' mutation fails native and Wasm assertions', () => {
      const {compilerOwner, preparationMs, ...result} = verifyModelMutation(kind, owner);
      assert.equal(compilerOwner, owner.identity);
      t.diagnostic(JSON.stringify({kind, compilerOwner, preparationMs}));
      return result;
    }));
  assert.equal(hostMutants.length, 8); assert.equal(modelMutants.length, 3);
  const retirement = owner.close();
  assert.throws(() => requireCompilerOwner(owner, 'custody'), /compiler owner closed/);
  assert.throws(() => owner.close(), /compiler owner closed/);
  t.diagnostic(JSON.stringify({compiler: owner.evidence, substitutions, retirement}));
  writeFileSync(join(build.work, 'custody-acceptance.json'), JSON.stringify({capability: 'DK-25',
    source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: sha(build.wasmBytes), maximum: build.maximum,
    browser, hostMutants, modelMutants}, null, 2) + '\n', {flag: 'wx'});
});
