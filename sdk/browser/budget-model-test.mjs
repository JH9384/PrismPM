import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {withCompilerOwner} from '../../tests/browser-view/serial-compiler-owner.mjs';
import {frozenInputs,assertFrozenInputs,prepare} from '../../tests/browser-budget/compile.mjs';
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
  const completed = await withCompilerOwner(t, 'budget', async (compiler, retain) => {
    const build = await verifyWire(t,inputs,compiler), mutants = []; retain(build);
    await prerequisite(t, 'independent complete budget corpus inventory', inventory);
    for (const kind of ['identity', 'policy', 'manifest', 'request', 'coverage', 'order', 'limit']) {
      mutants.push(await prerequisite(t, 'actual LexLean ' + kind + ' guard defect fails native and Wasm', () => verifyModelMutation(kind,inputs,compiler)));
    }
    assertFrozenInputs(inputs);
    return {build, mutants};
  });
  const {build, mutants} = completed.result;
  assertFrozenInputs(inputs);
  writeFileSync(join(build.work, 'budget-acceptance.json'), JSON.stringify({capability:'DK-27',
    scope:'conditional-per-resource-budget-only', source:build.verified.source_id,
    attestation:build.verified.attestation_id, maximum:build.maximum, inputs, mutants, compiler:completed.compiler, retirement:completed.retirement}, null, 2) + '\n', {flag:'wx'});
});
