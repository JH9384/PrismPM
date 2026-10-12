import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const original = readFileSync(join(directory, 'compiler-artifact.mjs'), 'utf8');
const suite = readFileSync(join(directory, 'compiler-artifact.test.mjs'));
const mutations = [
  ['pre-execution-check', '      compilerReadBarrier(verify);\n      try {return run(', '      try {return run(',
    'changed original/private executable refuses before execution'],
  ['post-execution-check', '} finally {compilerReadBarrier(verify);}', '} finally {}',
    'successful and failed actual executions both check compiler identity afterward'],
  ['opaque-handle', "assert.ok(owners.has(owner), 'actual captured compiler artifact required');",
    "assert.ok(owner, 'actual captured compiler artifact required');", 'fresh compiler capture retains original'],
  ['persistent-permissions', 'mode: Number(before.mode)', 'mode: 0',
    'unchanged compiler bytes and inode cannot conceal changed executable permissions'],
  ['final-barrier-sweep', 'for (const [path, row] of rows) {', 'for (const [path, row] of []) {',
    'final barrier sweep rejects late mutations'],
  ['fresh-execution-barriers',
    'compilerReadBarrier(verify);\n      try {return run(path, arguments_, cwd, environment, owner);} finally {compilerReadBarrier(verify);}',
    'verify();\n      try {return run(path, arguments_, cwd, environment, owner);} finally {verify();}',
    'nested actual executions never revive pre-child measurements'],
];

for (const [id, before, after, witness] of mutations) test('actual compiler custody defect ' + id, t => {
  assert.equal(original.split(before).length, 2, 'one exact real guard site');
  const work = mkdtempSync(join(tmpdir(), 'prismpm-compiler-guard-mutant-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  const changed = original.replace(before, after); assert.notEqual(changed, original);
  // Import the real pinned tool runner from its unchanged owning source root.
  writeFileSync(join(work, 'compiler-artifact.mjs'), changed.replace("'./compile.mjs'",
    JSON.stringify(new URL('./compile.mjs', import.meta.url).href)), {flag: 'wx'});
  writeFileSync(join(work, 'compiler-artifact.test.mjs'), suite, {flag: 'wx'});
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', join(work, 'compiler-artifact.test.mjs')],
    {env, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024});
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 1, 'changed guard must fail its behavioral test');
  assert.ok(result.stdout.split('\n').some(line => line.startsWith('not ok ') && line.includes(witness)),
    'failure must name the intended behavioral witness, not import/tool failure');
  assert.match(result.stdout, id === 'pre-execution-check'
    ? /substituted executable refused before planted sentinel/ : id === 'fresh-execution-barriers'
      ? /outer, pre, post and resumed reads are independent/ : /Missing expected exception/);
  assert.match(result.stdout, /# tests 13\n/);
  assert.match(result.stdout, /# skipped 0\n/); assert.match(result.stdout, /# todo 0\n/);
  assert.doesNotMatch(result.stdout + result.stderr, /ERR_MODULE_NOT_FOUND|SyntaxError/);
});
