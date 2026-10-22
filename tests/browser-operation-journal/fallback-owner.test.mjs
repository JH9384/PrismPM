import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {sha} from './compile.mjs';
import {verifyInventory, verifyWire, verifyModelMutation, sourceClosure} from './checks.mjs';
import {verifyBrowser, verifyHostMutations} from './browser.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';

function retirement(receipt, owner) {
  assert.equal(receipt.scope, 'completed-private-tool-caches-only');
  assert.equal(receipt.owner, owner);
  assert.equal(receipt.records.length, 4);
  assert.equal(new Set(receipt.records.map(row => row.path)).size, 4);
  for (const row of receipt.records) {
    assert.ok(Number.isSafeInteger(row.byte_length) && row.byte_length > 0);
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
  }
}

test('DK-24 independent compiler construction owns complete journal/browser replay and all mutants', {timeout:3500000}, async t => {
  const before = sourceClosure(), mutants = [];
  let build, custody, passed = false;
  try {
    await prerequisite(t, 'registered errors and complete closed structural byte budgets', verifyInventory);
    await prerequisite(t, 'genuine independent source, kernel and generated operation-journal closure', async child => {
      build = await verifyWire(child, null); assert.equal(build.compilerOwner, null);
      retirement(build.cacheRetirement, 'operation-journal');
      assert.deepEqual(JSON.parse(readFileSync(join(build.work, 'compiler-cache-retirement.json'))), build.cacheRetirement);
      assert.equal(existsSync(join(build.work, 'exporter/.lake/build')), false);
    });
    await prerequisite(t, 'genuine independent source-owned custody dependency', async child => {
      const {verifyWire} = await import('../browser-custody/checks.mjs'); custody = await verifyWire(child, null);
      assert.equal(custody.compilerOwner, null); retirement(custody.cacheRetirement, 'custody');
      assert.deepEqual(JSON.parse(readFileSync(join(custody.work, 'compiler-cache-retirement.json'))), custody.cacheRetirement);
      assert.equal(existsSync(join(custody.work, 'exporter/.lake/build')), false);
    });
    await prerequisite(t, 'actual durable browser journal and authenticated native transcript replay', child => verifyBrowser(child, build, custody));
    await verifyHostMutations(t, build, custody);
    for (const kind of ['binding', 'trailing', 'reservation', 'payload', 'partition']) {
      const result = await prerequisite(t, 'independent actual source/kernel journal mutation ' + kind, () => verifyModelMutation(kind, null));
      assert.equal(result.compilerOwner, null); retirement(result.cacheRetirement, 'operation-journal');
      mutants.push(result); t.diagnostic(JSON.stringify(result));
    }
    assert.deepEqual(sourceClosure(), before);
    const evidence = {construction:'independent', wire:sha(readFileSync(join(build.work, 'operation-journal-wire-evidence.json'))),
      browser:sha(readFileSync(join(build.work, 'operation-journal-browser-evidence.json'))),
      custody:sha(readFileSync(join(custody.work, 'custody-wire-evidence.json'))), source:before,
      hostMutations:12, modelMutations:mutants, cacheRetirement:build.cacheRetirement,
      custodyCacheRetirement:custody.cacheRetirement, publicApplicationAccepted:false};
    writeFileSync(join(build.work, 'operation-journal-fallback-acceptance.json'), JSON.stringify(evidence, null, 2) + '\n', {flag:'wx'});
    t.diagnostic('retained exact independent acceptance evidence ' + build.work + ' and custody ' + custody.work);
    passed = true;
  } finally {
    if (!passed) t.diagnostic('incomplete independent journal gate retained its diagnostic source/build evidence');
  }
});
