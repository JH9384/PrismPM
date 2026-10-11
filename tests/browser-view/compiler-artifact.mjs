// Test infrastructure: executable custody is not compiler-source provenance.
// Only an owning fresh, pinned compilation may supply an actual compiler here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync,
  realpathSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {run} from './compile.mjs';

const maximum = 268435456, owners = new WeakSet(), driverOwners = new WeakSet();
let observations;

function sweep(rows) {
  for (const [path, row] of rows) {
    stable(row.stat, lstatSync(path, {bigint: true}), row.native);
    assert.equal(realpathSync(path), path, 'compiler source ancestry changed');
  }
}

function stable(before, after, native) {
  assert.ok(after.isFile(), 'compiler replaced during capture');
  for (const key of ['dev', 'ino', 'uid', 'gid', 'nlink', 'size', 'mode', 'mtimeNs', 'ctimeNs'])
    assert.equal(after[key], before[key], native ? 'stable compiler capture ' + key : 'stable compiler source');
}

// One synchronous, freshly read filesystem barrier. This is not an acceptance
// cache: no observation survives the call, and every name is rechecked even
// when the action fails. A child always receives distinct pre/post barriers.
export function compilerReadBarrier(action) {
  assert.equal(typeof action, 'function');
  const previous = observations, current = new Map();
  // A nested execution boundary must never revive pre-child observations.
  // Check the suspended scope, then permanently discard its measurements.
  if (previous) {try {sweep(previous);} finally {previous.clear();}}
  observations = current;
  try {
    const result = action();
    assert.ok(!result || typeof result.then !== 'function', 'compiler read barrier must be synchronous');
    return result;
  } finally {
    try {sweep(current);} finally {current.clear(); observations = previous;}
  }
}
function directory(path, privateOwner = false) {
  assert.equal(resolve(path), path, 'normalized absolute compiler directory');
  assert.equal(realpathSync(path), path, 'unaliased compiler directory');
  const stat = lstatSync(path);
  assert.ok(stat.isDirectory() && stat.uid === process.getuid(), 'owned compiler directory');
  assert.equal(stat.mode & (privateOwner ? 0o077 : 0o022), 0,
    privateOwner ? 'private compiler owner directory required' : 'compiler directory cannot be group/other writable');
}

function observe(path, links, retainBytes, native) {
  if (native) directory(dirname(path));
  assert.equal(realpathSync(path), path, native ? 'unaliased compiler executable' : 'unaliased compiler source required');
  function admit(before) {
    if (native) {
      assert.ok(before.isFile() && before.uid === BigInt(process.getuid())
        && before.size >= 4n && before.size <= BigInt(maximum), 'bounded owned regular compiler required');
      assert.ok((before.mode & 0o100n) !== 0n && (before.mode & 0o7022n) === 0n,
        'owned executable without group/other write access required');
      if (links !== null) assert.equal(before.nlink, links, 'compiler link count');
    } else {
      assert.ok(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum),
        'bounded single-link compiler source required');
    }
  }
  if (!retainBytes && observations?.has(path)) {
    const row = observations.get(path);
    stable(row.stat, lstatSync(path, {bigint: true}), native);
    assert.equal(realpathSync(path), path, 'compiler source ancestry changed');
    admit(row.stat);
    return row;
  }
  if (!retainBytes && observations) assert.ok(observations.size < 16384, 'compiler observation barrier entry bound');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint: true});
    admit(before);
    // Verification still freshly hashes every byte. Only initial capture needs
    // a complete buffer for the separately owned exclusive executable copy.
    const size = Number(before.size), bytes = retainBytes ? Buffer.alloc(size) : undefined;
    const chunk = Buffer.alloc(Math.min(Math.max(1, size), 65536)), header = Buffer.alloc(4);
    const digest = createHash('sha256');
    for (let offset = 0; offset < size;) {
      const count = readSync(fd, chunk, 0, Math.min(chunk.length, size - offset), null);
      assert.ok(count > 0, native ? 'compiler shortened during capture' : 'compiler source shortened');
      if (offset < 4) chunk.copy(header, offset, 0, Math.min(count, 4 - offset));
      if (bytes) chunk.copy(bytes, offset, 0, count);
      digest.update(chunk.subarray(0, count)); offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0,
      native ? 'compiler grew during capture' : 'compiler source grew');
    for (const after of [fstatSync(fd, {bigint: true}), lstatSync(path, {bigint: true})]) stable(before, after, native);
    assert.equal(realpathSync(path), path, 'compiler source ancestry changed');
    const row = Object.freeze({bytes, stat: Object.freeze(before), header: header.toString('hex'),
      sha256: digest.digest('hex'), native});
    if (!retainBytes && observations) observations.set(path, row);
    return row;
  } finally {closeSync(fd);}
}

export function observeCompilerRuntimeFile(path) {
  return observe(path, null, false, false);
}

function read(path, links = null, retainBytes = false) {
  const row = observe(path, links, retainBytes, true), before = row.stat;
  assert.equal(row.header, '7f454c46', 'native Linux compiler artifact required');
  return {bytes: row.bytes, identity: Object.freeze({device: before.dev.toString(), inode: before.ino.toString(),
    uid: before.uid.toString(), gid: before.gid.toString(), mode: Number(before.mode),
    links: before.nlink.toString(), size: Number(before.size), sha256: row.sha256})};
}

export function captureCompilerArtifact(work, original, name) {
  directory(work, true);
  assert.equal(resolve(original), original, 'absolute original compiler path required');
  const child = relative(work, original);
  assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !child.startsWith(sep),
    'original compiler belongs to the private owner');
  function ancestors() {
    directory(work, true);
    let path = work;
    for (const part of child.split(sep).slice(0, -1)) {path = join(path, part); directory(path);}
  }
  ancestors();
  assert.match(name, /^[a-z][a-z0-9-]{0,95}$/, 'closed compiler artifact name');
  const {bytes, identity: originalIdentity} = read(original, null, true);
  // The tool runner confines LEAN_PATH to the generated prod-export entrypoint.
  // Preserve that basename in the separately owned private execution directory;
  // do not widen the environment guard to arbitrary captured executables.
  let path = join(work, name + '-execution');
  if (name === 'exporter') {
    assert.ok(original.endsWith('/prod-export'), 'exact generated exporter basename required');
    mkdirSync(path, {mode: 0o700}); path = join(path, 'prod-export');
  }
  assert.notEqual(original, path, 'separate compiler execution artifact required');
  writeFileSync(path, bytes, {flag: 'wx', mode: 0o500});
  const private_ = read(path, 1n);
  assert.equal(private_.identity.sha256, originalIdentity.sha256);
  const evidence = Object.freeze({original: Object.freeze({path: child, ...originalIdentity}),
    private: Object.freeze({path: relative(work, path), ...private_.identity})});
  function verify() {
    ancestors();
    assert.deepEqual(read(original, BigInt(originalIdentity.links)).identity, originalIdentity,
      'immutable original compiler');
    assert.deepEqual(read(path, 1n).identity, private_.identity, 'immutable private compiler');
  }
  const owner = Object.freeze({path, evidence, verify,
    run(arguments_, cwd, environment = {}) {
      compilerReadBarrier(verify);
      try {return run(path, arguments_, cwd, environment, owner);} finally {compilerReadBarrier(verify);}
    }});
  owners.add(owner); if (name === 'driver') driverOwners.add(owner); verify(); return owner;
}

// Numeric diagnostics only. This identity never grants execution authority or
// replaces requireCompilerArtifact, fresh source reads, or pre/post barriers.
export function isCapturedCompilerDriver(owner, path) {
  return driverOwners.has(owner) && owner.path === path;
}

export function requireCompilerArtifact(owner) {
  assert.ok(owners.has(owner), 'actual captured compiler artifact required');
  owner.verify(); return owner;
}
