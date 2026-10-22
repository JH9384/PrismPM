import assert from 'node:assert/strict';
import test from 'node:test';
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {localModuleInputs} from './local-module-inputs.mjs';

const capture = files => localModuleInputs('/owned', ['tests/a.mjs'], path => {
  assert.ok(Object.hasOwn(files, path), 'missing local module ' + path);
  return Buffer.from(files[path]);
});
test('actual ESM parser captures reexports, multiline imports and cycles without executing source', () => {
  const files = {'tests/a.mjs': 'import\n {x} from "./b.mjs"; export * from "../sdk/c.mjs"; throw Error("must not execute");',
    'tests/b.mjs': 'import "node:fs"; import "./a.mjs"; export const x=1;',
    'sdk/c.mjs': 'export const c=2;'};
  assert.deepEqual([...capture(files).keys()], ['sdk/c.mjs', 'tests/a.mjs', 'tests/b.mjs']);
});
test('closure rejects missing dependencies, escapes, remote/package imports and malformed modules', () => {
  for (const source of ['import "./missing.mjs";', 'import "../../escape.mjs";',
    'import "https://example.invalid/module.mjs";', 'import "package";', 'export const =;',
    'im' + 'port("./dynamic.mjs");', 'im' + 'port/* comment */("./dynamic.mjs");'])
    assert.throws(() => capture({'tests/a.mjs': source}));
});

test('fresh closures reread actual source, imports, missing files and the complete inventory', () => {
  const files = {'tests/a.mjs': 'import "./b.mjs";', 'tests/b.mjs': 'export const value=1;'};
  assert.deepEqual([...capture(files).keys()], ['tests/a.mjs', 'tests/b.mjs']);
  const reads = [];
  const repeated = localModuleInputs('/owned', ['tests/a.mjs'], path => {reads.push(path); return Buffer.from(files[path]);});
  assert.deepEqual(reads, ['tests/a.mjs', 'tests/b.mjs']);
  repeated.get('tests/a.mjs').fill(0);
  files['tests/b.mjs'] = 'export const value=2;';
  assert.equal(capture(files).get('tests/b.mjs').toString(), files['tests/b.mjs']);
  delete files['tests/b.mjs'];
  assert.throws(() => capture(files), /missing local module tests\/b.mjs/);
  files['tests/a.mjs'] = 'import "./c.mjs";'; files['tests/c.mjs'] = 'export const next=3;';
  assert.deepEqual([...capture(files).keys()], ['tests/a.mjs', 'tests/c.mjs']);
  files['tests/c.mjs'] += ' export * from "./d.mjs";'; files['tests/d.mjs'] = 'export const last=4;';
  assert.deepEqual([...capture(files).keys()], ['tests/a.mjs', 'tests/c.mjs', 'tests/d.mjs']);
  files['tests/c.mjs'] += ' im' + 'port("./d.mjs");';
  assert.throws(() => capture(files), /dynamic imports require/);
});

test('identical import specifiers resolve relative to each actual owning module', () => {
  const files = {'one/a.mjs': 'import "./b.mjs";', 'one/b.mjs': 'export const one=1;',
    'two/a.mjs': 'import "./b.mjs";', 'two/b.mjs': 'export const two=2;'};
  const read = path => {assert.ok(Object.hasOwn(files, path)); return Buffer.from(files[path]);};
  assert.deepEqual([...localModuleInputs('/owned', ['one/a.mjs'], read).keys()], ['one/a.mjs', 'one/b.mjs']);
  assert.deepEqual([...localModuleInputs('/owned', ['two/a.mjs'], read).keys()], ['two/a.mjs', 'two/b.mjs']);
});

test('a changed or nonexecutable actual parser cannot borrow earlier parse success', () => {
  const files = {'tests/a.mjs': 'export const parserIdentityProbe=42;'};
  assert.equal(capture(files).size, 1);
  const directory = mkdtempSync(join(tmpdir(), 'static-parser-negative-')), executable = join(directory, 'refuse-parser');
  const original = process.execPath;
  try {
    // Consume the actual source input before intentionally refusing it. An
    // immediate exit can race the parent's write and test EPIPE instead.
    writeFileSync(executable, '#!/bin/sh\nwhile IFS= read -r line; do :; done\nexit 37\n', {flag: 'wx', mode: 0o700});
    const refusal = childProcess.spawnSync(executable, [], {input: Buffer.from(files['tests/a.mjs']),
      encoding: 'utf8', env: {NODE_NO_WARNINGS: '1', TZ: 'UTC'}, timeout: 10000, maxBuffer: 1048576});
    assert.equal(refusal.error, undefined); assert.equal(refusal.signal, null);
    assert.equal(refusal.status, 37, 'actual substituted parser deliberately refuses consumed input');
    process.execPath = executable;
    assert.throws(() => capture(files), /actual static ESM parsing/);
    chmodSync(executable, 0o600);
    assert.throws(() => capture(files), /bounded executable static ESM parser/);
  } finally {process.execPath = original; rmSync(directory, {recursive: true});}
  assert.equal(capture(files).size, 1);
});

test('larger legal closures and repeated inputs always invoke the actual parser afresh', () => {
  const files = Object.fromEntries(Array.from({length: 257}, (_, index) =>
    ['modules/e' + index + '.mjs', Buffer.from('export const eviction' + index + '=' + index + ';')]));
  const entries = Object.keys(files), original = childProcess.spawnSync;
  let calls = 0;
  childProcess.spawnSync = (...arguments_) => {calls++; return Reflect.apply(original, childProcess, arguments_);};
  syncBuiltinESMExports();
  try {
    assert.equal(localModuleInputs('/owned', entries, path => files[path]).size, 257);
    assert.equal(calls, 257, 'each unique source is parsed by the actual executable');
    assert.equal(localModuleInputs('/owned', [entries.at(-1)], path => files[path]).size, 1);
    assert.equal(calls, 258, 'even the identical source is really reparsed');
  } finally {childProcess.spawnSync = original; syncBuiltinESMExports();}
});
