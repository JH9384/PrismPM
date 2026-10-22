import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {frozenInputs, assertFrozenInputs} from './compile.mjs';
import {verifyWire, verifyModelMutation, inventory, prerequisite} from './checks.mjs';

const inputs = frozenInputs();
function retirement(receipt) {
  assert.equal(receipt.scope, 'completed-private-tool-caches-only');
  assert.equal(receipt.owner, 'budget');
  assert.equal(receipt.records.length, 4);
  assert.equal(new Set(receipt.records.map(row => row.path)).size, 4);
  for (const row of receipt.records) {
    assert.ok(Number.isSafeInteger(row.byte_length) && row.byte_length > 0);
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
  }
}

test('DK-27 independent compiler construction owns complete native/Wasm budgets and all source mutants', {timeout:3500000}, async t => {
  const build = await verifyWire(t, inputs, null), mutants = [];
  assert.equal(build.compilerOwner, null);
  retirement(build.cacheRetirement);
  assert.deepEqual(JSON.parse(readFileSync(join(build.work, 'compiler-cache-retirement.json'))), build.cacheRetirement);
  assert.equal(existsSync(join(build.work, 'exporter/.lake/build')), false);
  await prerequisite(t, 'independent complete budget corpus inventory', inventory);
  for (const kind of ['identity', 'policy', 'manifest', 'request', 'coverage', 'order', 'limit']) {
    const result = await prerequisite(t, 'independent actual LexLean ' + kind + ' guard defect fails native and Wasm', () =>
      verifyModelMutation(kind, inputs, null, diagnostic => {
        assert.equal(diagnostic.compilerOwner, null); t.diagnostic(JSON.stringify(diagnostic));
      }));
    retirement(result.cacheRetirement); mutants.push(result);
  }
  assertFrozenInputs(inputs);
  writeFileSync(join(build.work, 'budget-fallback-acceptance.json'), JSON.stringify({capability:'DK-27',
    construction:'independent', scope:'conditional-per-resource-budget-only', source:build.verified.source_id,
    attestation:build.verified.attestation_id, maximum:build.maximum, inputs, mutants,
    cacheRetirement:build.cacheRetirement, publicApplicationAccepted:false}, null, 2) + '\n', {flag:'wx'});
  t.diagnostic('retained independent budget acceptance evidence ' + build.work);
});
