import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync, linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {captureFile, capturedFile} from './file-custody.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'file-custody-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const path = join(root, 'input'), bytes = Buffer.from('actual capture\n');
  writeFileSync(path, bytes, {flag: 'wx'});
  return {root, path, bytes};
}
test('captured bytes and digest share a bounded stable descriptor', t => {
  const {path, bytes} = fixture(t), captured = captureFile(path, bytes.length);
  assert.deepEqual(captured.bytes, bytes);
  assert.equal(captured.evidence.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert(Object.isFrozen(captured.evidence));
  assert.deepEqual(capturedFile(path, captured.evidence), bytes);
  captured.bytes[0] ^= 1; assert.deepEqual(capturedFile(path, captured.evidence), bytes);
  assert.throws(() => captureFile(path, bytes.length - 1), /bounded single-link/);
});
test('same bytes cannot replace the original inode or mode', t => {
  const {root, path, bytes} = fixture(t), {evidence} = captureFile(path);
  renameSync(path, join(root, 'original')); writeFileSync(path, bytes);
  assert.throws(() => capturedFile(path, evidence), /custody/);
  unlinkSync(path); renameSync(join(root, 'original'), path); chmodSync(path, 0o600);
  assert.throws(() => capturedFile(path, evidence), /custody/);
});
test('changed content cannot borrow a captured digest', t => {
  const {path, bytes} = fixture(t), {evidence} = captureFile(path);
  const changed = Buffer.from(bytes); changed[0] ^= 1; writeFileSync(path, changed);
  assert.throws(() => capturedFile(path, evidence), /custody/);
});
test('leaf/ancestor aliases, hard links and FIFOs refuse before reading', t => {
  const {root, path} = fixture(t);
  for (const kind of ['alias', 'hardlink', 'fifo', 'directory']) {
    const target = join(root, kind);
    if (kind === 'alias') symlinkSync(path, target);
    if (kind === 'hardlink') linkSync(path, target);
    if (kind === 'fifo') execFileSync('mkfifo', [target]);
    if (kind === 'directory') mkdirSync(target);
    assert.throws(() => captureFile(target), /custody/);
    rmSync(target, {recursive: kind === 'directory'});
  }
  const alias = join(root, 'ancestor'); symlinkSync(root, alias);
  assert.throws(() => captureFile(join(alias, 'input')), /ancestry/);
});
