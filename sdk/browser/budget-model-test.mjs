import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {frozenInputs,assertFrozenInputs,prepare} from '../../tests/browser-budget/compile.mjs';
import {createCompilerOwner,requireCompilerOwner} from '../../tests/browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../../tests/browser-view/compiler-owner-checks.mjs';
import {captureVerificationProducts} from '../../tests/browser-view/verification-products.mjs';
const inputs=frozenInputs();

test('DK-27 owns actual imported request admission without public runtime enablement', () => {
  const fixture = readFileSync(new URL('../../tests/browser-budget/src/Fixture.lex.tex', import.meta.url), 'utf8');
  assert.match(fixture, /effectiveRequestFits/);
  assert.match(fixture, /readEffectWireEffectRequest/);
  assert.match(readFileSync(new URL('../../crates/prismpm/src/holo/browser_application.rs', import.meta.url), 'utf8'), /PP2011/);
  for(const path of ['stdlib/src/Foundation/Browser/Application/V1/Effects.lex.tex','tests/browser-view/driver-cache.mjs','tests/browser-budget/driver/src/main.rs','model/dependencies.toml']) {
    assert.ok(Object.hasOwn(inputs,path));
    assert.throws(()=>prepare(null,{...inputs,[path]:'0'.repeat(64)}),/complete frozen budget owner inputs/);
  }
});

test('DK-27 generated per-resource budgets retain exact source, maxima and negative admission', {timeout:3500000}, async t => {
  const {verifyWire, verifyModelMutation, inventory, prerequisite} = await import('../../tests/browser-budget/checks.mjs');
  const owner = createCompilerOwner('budget'), substitutions = verifyCompilerOwnerSubstitutions(owner);
  const build = await verifyWire(t,inputs,owner), mutants = [];
  assert.equal(build.compilerOwner,owner.identity);
  await prerequisite(t, 'independent complete budget corpus inventory', inventory);
  for (const kind of ['identity', 'policy', 'manifest', 'request', 'coverage', 'order', 'limit']) {
    mutants.push(await prerequisite(t, 'actual LexLean ' + kind + ' guard defect fails native and Wasm', () => verifyModelMutation(kind,inputs,owner,result=>{
      assert.equal(result.compilerOwner,owner.identity);t.diagnostic(JSON.stringify(result));
    })));
  }
  assertFrozenInputs(inputs);
  const products=captureVerificationProducts(build.work,'budget');
  const retirement=owner.close();
  assert.deepEqual(captureVerificationProducts(build.work,'budget'),products,
    'complete generated products unchanged through compiler retirement');
  assertFrozenInputs(inputs);
  build.verifyEvidence();
  assert.throws(()=>requireCompilerOwner(owner,'budget'),/compiler owner closed/);
  assert.throws(()=>owner.close(),/compiler owner closed/);
  t.diagnostic(JSON.stringify({compiler:owner.evidence,substitutions,retirement}));
  writeFileSync(join(build.work, 'budget-acceptance.json'), JSON.stringify({capability:'DK-27',
    scope:'conditional-per-resource-budget-only', source:build.verified.source_id,
    attestation:build.verified.attestation_id, maximum:build.maximum, inputs, mutants,
    compiler:owner.identity, retirement}, null, 2) + '\n', {flag:'wx'});
});
