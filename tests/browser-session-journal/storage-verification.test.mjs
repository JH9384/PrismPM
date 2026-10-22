import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {mutateStorageHost, storageHostMutations} from './storage-verification.mjs';
import {captureStorageSources} from './storage-browser.mjs';

test('all storage host defects alter exactly one real guard and name a unique browser counterexample', () => {
  const source = readFileSync(new URL('../../sdk/browser/session-storage.mjs', import.meta.url), 'utf8');
  const fixture = readFileSync(new URL('./storage-browser.mjs', import.meta.url), 'utf8');
  assert.equal(storageHostMutations.length, 6);
  assert.equal(new Set(storageHostMutations.map(row => row.id)).size, 6);
  for (const mutation of storageHostMutations) {
    const changed = mutateStorageHost(source, mutation);
    assert.notEqual(changed, source);
    assert.equal(fixture.split("t.test('" + mutation.case).length, 2);
    assert.throws(() => mutateStorageHost(changed, mutation));
  }
});

test('served SDK source is an immutable original snapshot, never a later filesystem reread', t => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-storage-source-snapshot-')), files = new Map(), inputs = {};
  t.after(() => rmSync(directory, {recursive: true}));
  for (const name of ['session-storage.mjs', 'session-retention-wire.mjs', 'identity.mjs', 'effects-module.mjs', 'effects-wire.mjs']) {
    const bytes = readFileSync(new URL('../../sdk/browser/' + name, import.meta.url));
    files.set(name, bytes); writeFileSync(join(directory, name), bytes, {flag: 'wx'});
    inputs['sdk/browser/' + name] = createHash('sha256').update(bytes).digest('hex');
  }
  const location = pathToFileURL(directory + '/'), captured = captureStorageSources(inputs, location);
  assert.ok(Object.isFrozen(captured)); assert.equal(Object.keys(captured).length, 5);
  for (const [name, bytes] of files) {
    writeFileSync(join(directory, name), Buffer.concat([bytes, Buffer.from('\n// changed after snapshot\n')]));
    assert.equal(captured[name], bytes.toString('utf8'), 'served source cannot adopt a changed on-disk file');
    assert.throws(() => captureStorageSources(inputs, location), /actual served storage source must match original frozen input/);
    writeFileSync(join(directory, name), bytes);
  }
  assert.deepEqual(captureStorageSources(inputs, location), captured);
});
