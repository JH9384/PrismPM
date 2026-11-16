import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {canonical, validateVvEvidence} from './sdk-vv-run.mjs';
import {assemble, parts} from './vv-assemble.mjs';

const revision = 'a'.repeat(40);
const record = (part, fields = {}) => canonical({commit: revision, part, schema: 'prismpm/vv-part/1', status: 'passed', ...fields});
const fixture = t => {
  const directory = mkdtempSync(join(tmpdir(), 'vv-assemble-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  for (const part of parts) writeFileSync(join(directory, `vv-part-${part}.json`), record(part));
  return directory;
};

test('every passed part of one commit produces the unchanged 15-gate evidence', t => {
  validateVvEvidence(assemble(fixture(t), revision), revision);
});

test('assembly refuses a missing, extra, failed, foreign or altered part', t => {
  const altered = [
    ['missing part', directory => unlinkSync(join(directory, 'vv-part-dk-2.json'))],
    ['extra record', directory => writeFileSync(join(directory, 'vv-part-other.json'), record('other'))],
    ['failed part', directory => writeFileSync(join(directory, 'vv-part-source.json'), record('source', {status: 'failed'}))],
    ['other commit', directory => writeFileSync(join(directory, 'vv-part-conformance.json'), record('conformance', {commit: 'b'.repeat(40)}))],
    ['wrong part name', directory => writeFileSync(join(directory, 'vv-part-dk-2.json'), record('source'))],
    ['extra field', directory => writeFileSync(join(directory, 'vv-part-source.json'), record('source', {gates: [1]}))],
    ['noncanonical bytes', directory => writeFileSync(join(directory, 'vv-part-source.json'), `${record('source')}\n`)],
  ];
  for (const [name, alter] of altered) {
    const directory = fixture(t);
    alter(directory);
    assert.throws(() => assemble(directory, revision), undefined, name);
  }
  assert.throws(() => assemble(fixture(t), 'b'.repeat(40)));
  assert.throws(() => assemble(fixture(t), 'not-a-revision'));
});

test('the part list is the one source of truth for every consumer', async () => {
  const {vvParts} = await import('./sdk-vv-run.mjs');
  assert.deepEqual([...vvParts], [...parts]);
  assert.equal(parts.length, 8);
  assert.deepEqual([...parts], [...parts].sort());
  assert.equal(new Set(parts).size, parts.length);
  assert.deepEqual(execFileSync(process.execPath, [fileURLToPath(new URL('./vv-assemble.mjs', import.meta.url)), '--list']).toString().split('\n').filter(Boolean), [...parts]);
});
