// Actual guard defects must make the complete independent guard suite fail.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const source = readFileSync(new URL('./generated-wasm.mjs', import.meta.url), 'utf8');
const suite = readFileSync(new URL('./generated-wasm.test.mjs', import.meta.url));
for (const field of ['sha256', 'inode']) test('actual original-artifact ' + field + ' guard defect is caught', t => {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-artifact-mutant-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  const before = 'assert.deepEqual(read(original, BigInt(captured.identity.links)).identity, captured.identity,';
  const after = 'assert.deepEqual({...read(original, BigInt(captured.identity.links)).identity, '
    + field + ': captured.identity.' + field + '}, captured.identity,';
  assert.equal(source.split(before).length, 2, 'one exact guard planted');
  writeFileSync(join(work, 'generated-wasm.mjs'), source.replace(before, after), {flag: 'wx'});
  writeFileSync(join(work, 'generated-wasm.test.mjs'), suite, {flag: 'wx'});
  // Start an actual independent test coordinator, not a parent-runner worker.
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', join(work, 'generated-wasm.test.mjs')],
    {env, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024});
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 1);
  assert.match(result.stdout, field === 'sha256'
    ? /not ok 2 - original, private output and exposed buffer substitution refuse before executing/
    : /not ok 4 - new original\/private aliases and changed original file identities refuse/);
  assert.match(result.stdout, /Missing expected exception/);
  assert.match(result.stdout, /# tests 6\n/); assert.match(result.stdout, /# fail 1\n/);
  assert.match(result.stdout, /# skipped 0\n/); assert.match(result.stdout, /# todo 0\n/);
});
