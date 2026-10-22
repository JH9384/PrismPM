import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, readFileSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {assertCapturedRetentionSources, frozenInputs, repository, sourceClosure} from './compile.mjs';
import {retentionCorpus} from '../browser-session-journal/retention-corpus.mjs';
import {verifyNativeInventory} from './checks.mjs';
import {verifyRetentionInputSubstitutions} from './input-checks.mjs';

test('direct private-input entry refuses the original source before any substitution', () => {
  const input = join(repository, 'tests/browser-effects/corpus.mjs');
  const before = readFileSync(input);
  const child = spawnSync(process.execPath,
    [join(repository, 'tests/browser-session-journal-retention/input-checks.mjs'), '--private-input-checks'],
    {cwd: repository, encoding: 'utf8', timeout: 120000, maxBuffer: 1048576});
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /private input-copy parent/);
  assert.equal(child.stdout, '');
  assert.deepEqual(readFileSync(input), before);
  assert.equal(existsSync(input + '.retention-input-held'), false);
});

test('per-use input checks preserve five private defects and refuse a nonprivate mode or directory name', () => {
  const {work, cases} = verifyRetentionInputSubstitutions(frozenInputs());
  assert.deepEqual(cases, ['omitted-map', 'missing-file', 'changed-file', 'forged-matching-map', 'hard-linked-file']);
  const input = 'tests/browser-effects/corpus.mjs', before = readFileSync(join(work, input));
  function refused(directory, reason) {
    const child = spawnSync(process.execPath,
      [join(directory, 'tests/browser-session-journal-retention/input-checks.mjs'), '--private-input-checks'],
      {cwd: directory, encoding: 'utf8', timeout: 120000, maxBuffer: 1048576});
    assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.status, 1);
    assert.match(child.stderr, reason); assert.equal(child.stdout, '');
    assert.deepEqual(readFileSync(join(directory, input)), before);
    assert.equal(existsSync(join(directory, input + '.retention-input-held')), false);
  }
  chmodSync(work, 0o755);
  try {refused(work, /owned private input-copy directory/);}
  finally {chmodSync(work, 0o700);}
  const renamed = work + '-wrong-name';
  assert.equal(existsSync(renamed), false);
  renameSync(work, renamed);
  try {refused(renamed, /private input-copy directory name/);}
  finally {renameSync(renamed, work);}
});

test('retention compiler freezes complete source and transitive host/oracle inputs', () => {
  const inputs = frozenInputs(), sources = sourceClosure(); assertCapturedRetentionSources(inputs, sources);
  for (const path of ['sdk/browser/session-storage.mjs', 'sdk/browser/session-retention-wire.mjs',
    'tests/browser-session-journal/storage-browser.mjs', 'tests/browser-session-journal/retention-corpus.mjs',
    'tests/browser-session-journal/retention-mutations.mjs', 'tests/browser-view/local-module-inputs.mjs',
    'tests/browser-view/generated-wasm.mjs', 'tests/browser-session-journal/wasm-artifact-checks.mjs']) assert.ok(inputs[path], path);
  const name = 'Foundation.Browser.Application.V1.SessionJournalRetention';
  const changed = new Map(sources); changed.set(name, Buffer.concat([sources.get(name), Buffer.from('\n')]));
  assert.throws(() => assertCapturedRetentionSources(inputs, changed), /actual captured source/);
  const missing = new Map(sources); missing.delete(name);
  assert.throws(() => assertCapturedRetentionSources(inputs, missing), /complete captured source/);
});

test('retention native inventory refuses absent, repeated, partial and stale vectors', () => {
  const rows = retentionCorpus(), output = rows.map(row => 'PASS ' + row.id + '\n').join('')
    + 'PASS ' + rows.length + ' journal retention vectors twice\n';
  verifyNativeInventory(output, rows);
  for (const defect of ['', output.replace('PASS RetentionEmptySnapshot\n', ''), output + output,
    output.replace('RetentionEmptySnapshot', 'StaleFixture')]) assert.throws(() => verifyNativeInventory(defect, rows));
});
