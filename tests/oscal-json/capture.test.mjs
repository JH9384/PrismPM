import assert from 'node:assert/strict';
import {chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync,
  rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {captureFile, captureTree} from './capture.mjs';

for (const mutation of ['bytes', 'same-byte-inode', 'mode', 'hard-link', 'leaf-alias', 'parent-alias'])
  test('captured oracle input refuses ' + mutation, t => {
    const root = mkdtempSync(join(tmpdir(), 'oscal-capture-check-'));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    const directory = join(root, 'source'); mkdirSync(directory);
    const path = join(directory, 'input'); writeFileSync(path, 'source');
    const capture = captureFile(path); capture.verify();
    if (mutation === 'bytes') writeFileSync(path, 'change');
    if (mutation === 'same-byte-inode') {
      const replacement = join(root, 'replacement'); writeFileSync(replacement, 'source');
      renameSync(replacement, path);
    }
    if (mutation === 'mode') chmodSync(path, 0o400);
    if (mutation === 'hard-link') linkSync(path, join(root, 'alias'));
    if (mutation === 'leaf-alias') {renameSync(path, join(root, 'moved')); symlinkSync(join(root, 'moved'), path);}
    if (mutation === 'parent-alias') {
      renameSync(directory, join(root, 'moved')); symlinkSync(join(root, 'moved'), directory);
    }
    assert.throws(() => capture.verify());
  });

test('oracle inventory includes unlisted additions and same-byte directory replacement', t => {
  const root = mkdtempSync(join(tmpdir(), 'oscal-tree-check-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const source = join(root, 'source'); mkdirSync(source); writeFileSync(join(source, 'a'), 'a');
  const initial = captureTree(source); initial.verify();
  writeFileSync(join(source, 'added'), 'new'); assert.throws(() => initial.verify());
  const next = captureTree(source); renameSync(source, join(root, 'old')); mkdirSync(source);
  for (const name of ['a', 'added']) writeFileSync(join(source, name), readFileSync(join(root, 'old', name)));
  assert.throws(() => next.verify());
});

test('oracle capture refuses oversized and nonregular files before payload allocation', t => {
  const root = mkdtempSync(join(tmpdir(), 'oscal-bound-check-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const path = join(root, 'subject'); writeFileSync(path, 'bytes');
  assert.throws(() => captureFile(path, 4), /bounded regular/);
  assert.throws(() => captureFile(root), /bounded regular/);
});
