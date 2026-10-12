import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  renameSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureCompilerArtifact, compilerReadBarrier, observeCompilerRuntimeFile,
  requireCompilerArtifact} from './compiler-artifact.mjs';

// This tests executable custody, not compiler provenance. Full component owners
// must construct their compiler from exact pinned source before capturing it.
function fixture(t, executable = '/bin/true') {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-compiler-artifact-test-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  const output = join(work, 'target'); mkdirSync(output);
  const original = join(output, 'tool'); copyFileSync(executable, original);
  chmodSync(original, 0o700);
  linkSync(original, join(output, 'dependency-output'));
  return {work, original};
}

function observedReads(action) {
  const read = fs.readSync, captures = new Map();
  try {
    fs.readSync = function(fd, buffer, offset, length, position) {
      assert.ok(buffer.length <= 65536, 'fresh measurement buffer is bounded');
      const inode = fs.fstatSync(fd, {bigint: true}).ino.toString();
      const row = captures.get(inode) ?? {bytes: 0, eof: 0};
      const count = read(fd, buffer, offset, length, position);
      row.bytes += count; if (count === 0) row.eof++;
      captures.set(inode, row); return count;
    };
    syncBuiltinESMExports(); action(); return captures;
  } finally {fs.readSync = read; syncBuiltinESMExports();}
}

test('one fresh barrier shares immutable complete measurements across runtime and artifact roles only', t => {
  const {work, original} = fixture(t);
  unlinkSync(join(work, 'target', 'dependency-output'));
  const owner = captureCompilerArtifact(work, original, 'driver');
  let previous;
  for (const runtimeFirst of [true, false, true]) {
    const captures = observedReads(() => compilerReadBarrier(() => {
      if (!runtimeFirst) owner.verify();
      const row = observeCompilerRuntimeFile(original);
      assert.equal(observeCompilerRuntimeFile(original), row);
      assert.notEqual(row, previous, 'no observation survives a previous barrier'); previous = row;
      assert.equal(row.sha256, owner.evidence.original.sha256);
      assert.equal(row.header, '7f454c46'); assert.equal(row.bytes, undefined);
      assert.ok(Object.isFrozen(row) && Object.isFrozen(row.stat));
      assert.throws(() => {row.sha256 = '0'.repeat(64);}, TypeError);
      assert.throws(() => {row.stat.mode = 0n;}, TypeError);
      owner.verify();
    }));
    assert.equal(captures.size, 2);
    for (const row of captures.values()) {
      assert.equal(row.bytes, owner.evidence.original.size, 'one complete fresh measurement per barrier');
      assert.equal(row.eof, 1);
    }
  }
});

test('same-barrier reuse refuses byte, inode, link, mode and pathname substitutions', t => {
  for (const kind of ['bytes', 'inode', 'link', 'mode', 'alias']) {
    const {work, original} = fixture(t);
    unlinkSync(join(work, 'target', 'dependency-output'));
    const owner = captureCompilerArtifact(work, original, 'driver');
    assert.throws(() => compilerReadBarrier(() => {
      observeCompilerRuntimeFile(original);
      if (kind === 'bytes') {const bytes = readFileSync(original); bytes[bytes.length - 1] ^= 1;
        writeFileSync(original, bytes);}
      if (kind === 'inode') {renameSync(original, original + '-old');
        copyFileSync(original + '-old', original); chmodSync(original, 0o700);}
      if (kind === 'link') linkSync(original, original + '-link');
      if (kind === 'mode') chmodSync(original, 0o740);
      if (kind === 'alias') {renameSync(original, original + '-old'); symlinkSync(original + '-old', original);}
      owner.verify();
    }), /stable compiler|unaliased|compiler replaced/);
  }
});

test('final barrier sweep rejects late mutations on success and failure and always clears custody', t => {
  const {work, original} = fixture(t);
  unlinkSync(join(work, 'target', 'dependency-output'));
  const primary = new Error('unchanged primary failure');
  for (const fail of [false, true]) {
    assert.throws(() => compilerReadBarrier(() => {
      observeCompilerRuntimeFile(original); chmodSync(original, 0o740);
      if (fail) throw primary;
    }), /stable compiler source/);
    chmodSync(original, 0o700);
    const captures = observedReads(() => compilerReadBarrier(() => observeCompilerRuntimeFile(original)));
    assert.equal(captures.size, 1); assert.equal([...captures.values()][0].eof, 1);
  }
  assert.throws(() => compilerReadBarrier(() => {observeCompilerRuntimeFile(original); throw primary;}),
    error => error === primary);
  assert.throws(() => compilerReadBarrier(() => Promise.resolve()), /must be synchronous/);
  let entered = false;
  compilerReadBarrier(() => {
    const before = observeCompilerRuntimeFile(original); chmodSync(original, 0o740);
    assert.throws(() => compilerReadBarrier(() => {entered = true;}), /stable compiler source/);
    chmodSync(original, 0o700);
    assert.notEqual(observeCompilerRuntimeFile(original), before,
      'failed nested boundary permanently clears suspended observations');
  });
  assert.equal(entered, false, 'failed outer sweep cannot enter a nested action');
  compilerReadBarrier(() => observeCompilerRuntimeFile(original));
});

test('nested actual executions never revive pre-child measurements on success or failure', t => {
  const {work, original} = fixture(t, '/bin/sh');
  unlinkSync(join(work, 'target', 'dependency-output'));
  const owner = captureCompilerArtifact(work, original, 'driver');
  for (const status of ['0', '1']) {
    const captures = observedReads(() => compilerReadBarrier(() => {
      owner.verify();
      const execute = () => owner.run(['-c', 'exit "$1"', 'fresh-boundary', status], work);
      if (status === '0') assert.equal(execute(), ''); else assert.throws(execute);
      owner.verify();
    }));
    assert.equal(captures.size, 2);
    for (const row of captures.values()) {
      assert.equal(row.bytes, 4 * owner.evidence.original.size, 'outer, pre, post and resumed reads are independent');
      assert.equal(row.eof, 4, 'no execution boundary revives an earlier measurement');
    }
  }
});

test('fresh compiler capture retains original and separate singly linked private executable', t => {
  const {work, original} = fixture(t);
  const owner = captureCompilerArtifact(work, original, 'driver');
  assert.equal(requireCompilerArtifact(owner), owner);
  assert.equal(owner.evidence.original.links, '2');
  assert.equal(owner.evidence.private.links, '1');
  assert.equal(owner.run([], work), '');
  assert.equal(owner.run([], work), '');
  assert.throws(() => requireCompilerArtifact({...owner}), /actual captured compiler/);
  assert.throws(() => {owner.evidence.private.sha256 = '0'.repeat(64);}, TypeError);
  assert.throws(() => {owner.run = () => '';}, TypeError);
  assert.throws(() => captureCompilerArtifact(work, original, 'driver'), /EEXIST/);
});

test('private exporter keeps its guarded entrypoint without allowing driver environment overrides', t => {
  const {work, original} = fixture(t, '/bin/sh');
  const exporter = join(work, 'target', 'prod-export'); renameSync(original, exporter);
  const driver = captureCompilerArtifact(work, exporter, 'driver');
  assert.throws(() => driver.run(['-c', 'printf %s "$LEAN_PATH"'], work, {LEAN_PATH: work}),
    /LEAN_PATH belongs only to the exact generated exporter/);
  const owner = captureCompilerArtifact(work, exporter, 'exporter');
  assert.equal(owner.evidence.private.path, 'exporter-execution/prod-export');
  assert.equal(owner.run(['-c', 'printf %s "$LEAN_PATH"'], work, {LEAN_PATH: work}), work);
  const previousThreads = process.env.LEAN_NUM_THREADS;
  try {
    process.env.LEAN_NUM_THREADS = '9999';
    assert.equal(owner.run(['-c', 'printf %s "$LEAN_NUM_THREADS"'], work), '2');
  } finally {
    if (previousThreads === undefined) delete process.env.LEAN_NUM_THREADS;
    else process.env.LEAN_NUM_THREADS = previousThreads;
  }
  owner.verify();
});

test('changed original/private executable refuses before execution and cannot be adopted', t => {
  const {work, original} = fixture(t, '/bin/sh');
  const owner = captureCompilerArtifact(work, original, 'driver'), sentinel = join(work, 'executed');
  for (const [kind, path] of [['original', original], ['private', owner.path]]) {
    const bytes = readFileSync(path), mode = lstatSync(path).mode & 0o777;
    const changed = Buffer.concat([bytes, Buffer.from([0])]);
    chmodSync(path, 0o700); writeFileSync(path, changed);
    assert.throws(() => owner.run(['-c', ': > "$1"', 'artifact-custody-probe', sentinel], work),
      new RegExp('immutable ' + kind + ' compiler'));
    assert.equal(existsSync(sentinel), false, 'substituted executable refused before planted sentinel');
    writeFileSync(path, bytes); chmodSync(path, mode); owner.verify();
  }
});

test('unchanged compiler bytes and inode cannot conceal changed executable permissions', t => {
  const {work, original} = fixture(t, '/bin/sh');
  const owner = captureCompilerArtifact(work, original, 'driver'), sentinel = join(work, 'executed');
  for (const [kind, path] of [['original', original], ['private', owner.path]]) {
    const before = lstatSync(path), bytes = readFileSync(path), mode = before.mode & 0o777;
    try {
      chmodSync(path, mode ^ 0o040);
      assert.equal(lstatSync(path).ino, before.ino);
      assert.deepEqual(readFileSync(path), bytes);
      assert.throws(() => owner.verify(), new RegExp('immutable ' + kind + ' compiler'));
      assert.throws(() => owner.run(['-c', ': > "$1"', 'artifact-mode-probe', sentinel], work),
        new RegExp('immutable ' + kind + ' compiler'));
      assert.equal(existsSync(sentinel), false, 'metadata drift refused before execution');
    } finally {chmodSync(path, mode);}
    owner.verify();
  }
});

test('same bytes in a new inode or an added hard link are not the captured compiler', t => {
  const {work, original} = fixture(t);
  const owner = captureCompilerArtifact(work, original, 'driver');
  for (const path of [original, owner.path]) {
    const alias = join(work, 'alias'); linkSync(path, alias);
    assert.throws(() => owner.verify(), /link count/);
    unlinkSync(alias); owner.verify();
  }
  // Keep the old inode alive so a filesystem cannot reuse it for this probe.
  const old = join(work, 'old-private'); renameSync(owner.path, old);
  copyFileSync(old, owner.path); chmodSync(owner.path, lstatSync(old).mode & 0o777);
  assert.notEqual(lstatSync(owner.path).ino, lstatSync(old).ino);
  assert.equal(lstatSync(owner.path).mode, lstatSync(old).mode);
  assert.deepEqual(readFileSync(owner.path), readFileSync(old));
  assert.throws(() => owner.run([], work), /immutable private compiler/);
});

test('successful and failed actual executions both check compiler identity afterward', t => {
  const {work, original} = fixture(t, '/bin/sh');
  const owner = captureCompilerArtifact(work, original, 'driver'), bytes = readFileSync(original);
  for (const status of ['0', '1']) {
    assert.throws(() => owner.run(['-c', 'printf x >> "$1"; exit "$2"',
      'artifact-custody-probe', original, status], work), /immutable original compiler/);
    writeFileSync(original, bytes); owner.verify();
    try {
      assert.throws(() => owner.run(['-c', 'chmod 740 "$1"; exit "$2"',
        'artifact-mode-probe', original, status], work), /immutable original compiler/);
    } finally {chmodSync(original, 0o700);}
    owner.verify();
  }
});

test('compiler custody refuses writable parents and loss of private-owner isolation', t => {
  const {work, original} = fixture(t), output = join(work, 'target');
  chmodSync(output, 0o757);
  assert.throws(() => captureCompilerArtifact(work, original, 'driver'), /group\/other writable/);
  chmodSync(output, 0o755);
  const owner = captureCompilerArtifact(work, original, 'driver');
  for (const [path, changed, restored] of [[output, 0o757, 0o755], [work, 0o755, 0o700]]) {
    chmodSync(path, changed);
    assert.throws(() => owner.run([], work), /group\/other writable|private compiler owner/);
    chmodSync(path, restored); owner.verify();
  }
});

test('capture refuses aliases, unowned paths, nonexecutables and out-of-bound files', t => {
  const {work, original} = fixture(t), other = fixture(t);
  assert.throws(() => captureCompilerArtifact(work, other.original, 'driver'), /belongs to/);
  for (const name of ['', '../escape', 'UPPER', 'a'.repeat(97)])
    assert.throws(() => captureCompilerArtifact(work, original, name), /artifact name/);
  const alias = join(work, 'alias'); symlinkSync(original, alias);
  assert.throws(() => captureCompilerArtifact(work, alias, 'driver'), /unaliased/);
  chmodSync(original, 0o600);
  assert.throws(() => captureCompilerArtifact(work, original, 'driver'), /executable/);
  for (const mode of [0o4700, 0o2700, 0o1700]) {
    chmodSync(original, mode);
    assert.throws(() => captureCompilerArtifact(work, original, 'driver'), /executable/);
  }
  chmodSync(original, 0o700);
  const bytes = readFileSync(original), wrong = Buffer.from(bytes); wrong[0] = 0;
  writeFileSync(original, wrong);
  assert.throws(() => captureCompilerArtifact(work, original, 'driver'), /native Linux/);
  writeFileSync(original, bytes);
  for (const size of [0, 3, 268435457]) {
    truncateSync(original, size);
    assert.throws(() => captureCompilerArtifact(work, original, 'driver'), /bounded owned/);
  }
});

test('each verification freshly streams both complete artifacts with bounded buffers and short reads', t => {
  const {work, original} = fixture(t);
  const bytes = Buffer.concat([readFileSync(original), Buffer.alloc(131089, 0xa5)]);
  writeFileSync(original, bytes);
  const owner = captureCompilerArtifact(work, original, 'driver');
  const expected = createHash('sha256').update(bytes).digest('hex');
  assert.equal(owner.evidence.original.sha256, expected);
  assert.equal(owner.evidence.private.sha256, expected);
  const read = fs.readSync, allocate = Buffer.alloc;
  let captures = new Map(), allocations = [];
  try {
    Buffer.alloc = function(size, ...args) {allocations.push(size); return allocate(size, ...args);};
    fs.readSync = function(fd, buffer, offset, length, position) {
      assert.ok(buffer.length <= 65536, 'verification read buffer is bounded');
      const inode = fs.fstatSync(fd, {bigint: true}).ino.toString();
      const capture = captures.get(inode) ?? {bytes: 0, reads: 0, eof: 0};
      // Split the ELF header across real reads, then exercise chunk boundaries.
      const count = read(fd, buffer, offset, capture.reads++ < 2 ? Math.min(length, 3) : length, position);
      capture.bytes += count; if (count === 0) capture.eof++;
      captures.set(inode, capture); return count;
    };
    syncBuiltinESMExports();
    for (let barrier = 0; barrier < 2; barrier++) {
      captures = new Map(); allocations = []; owner.verify();
      assert.equal(captures.size, 2, 'original and private executable independently read');
      for (const capture of captures.values()) {
        assert.equal(capture.bytes, bytes.length, 'every byte freshly read at each barrier');
        assert.equal(capture.eof, 1, 'EOF checked at each barrier');
        assert.ok(capture.reads > 4, 'short reads and chunk boundaries actually exercised');
      }
      assert.ok(allocations.length > 0);
      assert.ok(allocations.every(size => size <= 65536), 'no whole executable verification allocation');
    }
  } finally {fs.readSync = read; Buffer.alloc = allocate; syncBuiltinESMExports();}
  for (const [kind, path] of [['original', original], ['private', owner.path]]) {
    const mode = lstatSync(path).mode & 0o777;
    for (const offset of [65536, bytes.length - 1]) {
      const changed = Buffer.from(bytes); changed[offset] ^= 1;
      chmodSync(path, 0o700); writeFileSync(path, changed);
      chmodSync(path, mode);
      try {assert.throws(() => owner.verify(), new RegExp('immutable ' + kind + ' compiler'));}
      finally {chmodSync(path, 0o700); writeFileSync(path, bytes); chmodSync(path, mode);}
      owner.verify();
    }
  }
  for (const [change, refusal] of [
    [() => fs.appendFileSync(original, Buffer.from([1])), /compiler grew during capture/],
    [() => truncateSync(original, 65536), /compiler shortened during capture/],
    [() => {const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
      writeFileSync(original, changed);}, /stable compiler capture (?:mtimeNs|ctimeNs)/],
  ]) {
    let changed = false;
    try {
      fs.readSync = function(fd, ...args) {
        const count = read(fd, ...args);
        if (!changed && fs.fstatSync(fd, {bigint: true}).ino.toString() === owner.evidence.original.inode) {
          changed = true; change();
        }
        return count;
      };
      syncBuiltinESMExports();
      assert.throws(() => owner.verify(), refusal);
      assert.equal(changed, true, 'real file changed during the actual streaming read');
    } finally {fs.readSync = read; syncBuiltinESMExports(); writeFileSync(original, bytes);}
    owner.verify();
  }
});
