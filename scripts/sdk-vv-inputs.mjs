// Offline, image-owned verification inputs. This is transport closure, not VV,
// advisory freshness, signature verification, or SDK/application acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  constants,
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statfsSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  posix
} from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const MiB = 1024 * 1024;
const MAX_PACK = 256 * MiB;
const MAX_BLOB = 64 * MiB;
const MAX_METADATA = 32 * MiB;
const MAX_OBJECTS = 500000;

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]));
  }
  return v;
}) + '\n';

const keys = (value, names) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), 'closed input record fields');
};

const oid = value => {
  assert.equal(typeof value, 'string');
  assert.match(value, /^[0-9a-f]{40}$/);
  return value;
};

const sha = value => {
  assert.equal(typeof value, 'string');
  assert.match(value, /^[0-9a-f]{64}$/);
  return value;
};

const text = bytes => {
  const value = bytes.toString('utf8');
  assert.ok(Buffer.from(value).equals(bytes), 'UTF-8 input required');
  return value;
};

function policyCheck(policy) {
  keys(policy, [
    'schema', 'source_revision', 'historical_revision', 'historical_tag',
    'bootstrap_sha256', 'advisory_revision', 'advisory_tree'
  ]);
  assert.equal(policy.schema, 'prismpm/sdk-vv-input-policy/1');
  for (const name of [
    'source_revision', 'historical_revision', 'historical_tag',
    'advisory_revision', 'advisory_tree'
  ]) {
    oid(policy[name]);
  }
  sha(policy.bootstrap_sha256);
}

function safePath(path) {
  assert.equal(typeof path, 'string');
  assert.ok(path && !path.includes('\\') && !/[\x00-\x1f\x7f]/.test(path));
  assert.ok(!isAbsolute(path) && path.split('/').every(p => p && p !== '.' && p !== '..'), 'confined Git path required');
  assert.ok(!path.split('/').some(p => p.toLowerCase() === '.git'), 'Git metadata cannot be source files');
}

function regular(path, maximum) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd, { bigint: true });
    assert.ok(info.isFile() && info.nlink === 1n && info.size <= BigInt(maximum), 'bounded independent regular input required');
    const bytes = Buffer.alloc(Number(info.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      assert.ok(count > 0, 'input shrank during read');
      offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0, 'input grew during read');
    const after = fstatSync(fd, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mode', 'nlink', 'mtimeNs', 'ctimeNs']) {
      assert.equal(after[key], info[key], 'input changed during read');
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function git(root, args, { input, maxBuffer = MAX_METADATA } = {}) {
  const env = {
    PATH: process.env.PATH,
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'file'
  };
  const result = spawnSync('git', [
    '--no-replace-objects', '-c', `safe.directory=${realpathSync(root)}`,
    '-C', root, ...args
  ], {
    env,
    input,
    maxBuffer,
    timeout: 180000,
    stdio: 'pipe'
  });
  assert.equal(result.error, undefined, 'bounded Git operation failed');
  assert.equal(result.signal, null, 'Git operation interrupted');
  assert.equal(result.status, 0, `Git ${args[0]} failed (no credentials or repository configuration are exported)`);
  return result.stdout;
}

const line = (root, args) => text(git(root, args)).trim();

function removeOwned(path, identity) {
  const current = lstatSync(path);
  assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino,
    'refusing cleanup of replaced directory');
  rmSync(path, { recursive: true });
}

function repositoryPaths(root) {
  const marker = join(root, '.git');
  const metadata = lstatSync(marker);
  let directory;
  if (metadata.isDirectory()) {
    directory = realpathSync(marker);
  } else {
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
    const value = text(regular(marker, 4096)).trim();
    assert.ok(value.startsWith('gitdir: '));
    directory = realpathSync(resolve(root, value.slice(8)));
  }
  const commonFile = join(directory, 'commondir');
  const common = existsSync(commonFile)
    ? realpathSync(resolve(directory, text(regular(commonFile, 4096)).trim()))
    : directory;
  for (const forbidden of [
    join(common, 'info', 'grafts'),
    join(directory, 'info', 'grafts'),
    join(common, 'objects', 'info', 'alternates')
  ]) {
    assert.ok(!existsSync(forbidden), 'grafts and alternate object stores are not admitted');
  }
  const objects = join(common, 'objects');
  assert.equal(realpathSync(objects), objects, 'object store must not be aliased');
  return {
    directory,
    common,
    objects
  };
}

function headRevision(paths) {
  let value = text(regular(join(paths.directory, 'HEAD'), 4096)).trim();
  const visited = new Set();
  while (value.startsWith('ref: ')) {
    const ref = value.slice(5);
    safePath(ref);
    assert.ok(ref.startsWith('refs/') && !visited.has(ref) && visited.size < 16, 'invalid symbolic HEAD');
    visited.add(ref);
    let parent = paths.common;
    for (const part of ref.split('/').slice(0, -1)) {
      parent = join(parent, part);
      if (!existsSync(parent)) break;
      const metadata = lstatSync(parent);
      assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink(), 'reference parent must not be aliased');
    }
    const path = join(paths.common, ref);
    if (existsSync(path)) {
      value = text(regular(path, 4096)).trim();
    } else {
      const packed = text(regular(join(paths.common, 'packed-refs'), MAX_METADATA)).split('\n').filter(row => row.endsWith(' ' + ref));
      assert.equal(packed.length, 1, 'selected HEAD reference is absent');
      value = packed[0].split(' ')[0];
    }
  }
  return oid(value);
}

function privateView(root, revision, source, work) {
  const paths = repositoryPaths(root);
  assert.equal(headRevision(paths), revision, 'current checkout differs from selected revision');
  assert.ok(!/[\r\n]/.test(paths.objects), 'object store path cannot frame multiple alternates');
  const shallow = join(paths.common, 'shallow');
  if (source) assert.ok(!existsSync(shallow), 'full source history required');
  const view = join(work, source ? 'source-view' : 'advisory-view');
  mkdirSync(view);
  git(view, ['init', '--bare', '--quiet']);
  // Only immutable object lookup is borrowed. Caller config, hooks, replace
  // refs, grafts, credentials and environment never enter this private Git view.
  writeFileSync(join(view, 'objects', 'info', 'alternates'), paths.objects + '\n');
  writeFileSync(join(view, 'HEAD'), revision + '\n');
  if (!source) writeFileSync(join(view, 'shallow'), revision + '\n');
  writeFileSync(join(view, 'index'), regular(join(paths.directory, 'index'), MAX_METADATA));
  return {
    view,
    paths,
    root
  };
}

function checkWorktree(input, revision, rows) {
  assert.equal(headRevision(input.paths), revision);
  writeFileSync(join(input.view, 'index'), regular(join(input.paths.directory, 'index'), MAX_METADATA));
  const actual = text(git(input.view, ['ls-files', '--stage', '-z'])).split('\0');
  assert.equal(actual.pop(), '');
  assert.deepEqual(actual.sort(), rows.map(row => `${row.mode} ${row.oid} 0\t${row.path}`).sort(),
    'index differs from selected committed tree');
  for (const row of rows) {
    let parent = input.root;
    for (const part of row.path.split('/').slice(0, -1)) {
      parent = join(parent, part);
      const info = lstatSync(parent);
      assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'tracked parent is not an ordinary directory');
    }
    const path = join(input.root, row.path);
    const info = lstatSync(path);
    let bytes;
    if (row.mode === '120000') {
      assert.ok(info.isSymbolicLink());
      bytes = Buffer.from(readlinkSync(path));
    } else {
      assert.ok(info.isFile() && !info.isSymbolicLink());
      assert.equal(Boolean(info.mode & 0o111), row.mode === '100755', 'tracked executable mode changed');
      bytes = regular(path, MAX_BLOB);
    }
    assert.equal(bytes.length, row.byte_length);
    assert.equal(hash(bytes), row.sha256, 'tracked bytes differ from selected committed tree');
  }
}

function object(root, id, maximum = MAX_BLOB) {
  oid(id);
  const size = Number(line(root, ['cat-file', '-s', id]));
  assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= maximum, 'Git object exceeds size limit');
  const bytes = git(root, ['cat-file', 'blob', id], {
    maxBuffer: maximum
  });
  assert.equal(bytes.length, size);
  return bytes;
}

function files(root, revision) {
  const rows = text(git(root, ['ls-tree', '-rz', '--full-tree', revision])).split('\0');
  assert.equal(rows.pop(), '');
  assert.ok(rows.length <= 100000, 'source file count exceeds limit');
  const result = rows.map(row => {
    const tab = row.indexOf('\t');
    assert.ok(tab > 0);
    const [mode, type, id] = row.slice(0, tab).split(' ');
    const path = row.slice(tab + 1);
    safePath(path);
    assert.equal(type, 'blob', 'gitlinks are not source closure');
    assert.ok(['100644', '100755', '120000'].includes(mode));
    const bytes = object(root, id);
    const value = {
      path,
      mode,
      oid: id,
      sha256: hash(bytes),
      byte_length: bytes.length
    };
    if (mode === '120000') {
      const target = text(bytes);
      assert.ok(target && !isAbsolute(target) && !target.includes('\\') && !/[\x00-\x1f\x7f]/.test(target),
        'confined symlink required');
      const expanded = posix.normalize(posix.join(posix.dirname(path), target));
      assert.ok(expanded !== '.' && expanded !== '..' && !expanded.startsWith('../'), 'escaping source symlink');
      value.target = target;
    }
    return value;
  });
  result.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  assert.equal(new Set(result.map(row => row.path)).size, result.length);
  // Resolve aliases lexically through the declared tree, not through caller files.
  const paths = new Map(result.map(row => [row.path, row]));
  const dirs = new Set(['.']);
  for (const row of result) {
    for (let dir = posix.dirname(row.path); dir !== '.'; dir = posix.dirname(dir)) {
      dirs.add(dir);
    }
  }
  for (const row of result.filter(row => row.mode === '120000')) {
    let pending = row.path.split('/');
    const resolved = [];
    let expansions = 0;
    while (pending.length) {
      const part = pending.shift();
      if (part === '' || part === '.') continue;
      if (part === '..') {
        assert.ok(resolved.length, 'source alias escapes root');
        resolved.pop();
        continue;
      }
      const name = [...resolved, part].join('/');
      const entry = paths.get(name);
      if (entry?.mode === '120000') {
        assert.ok(++expansions <= 64, 'cyclic or excessive source alias expansion');
        pending = [...entry.target.split('/'), ...pending];
        continue;
      }
      assert.ok(entry || dirs.has(name), 'dangling source symlink');
      if (pending.length) assert.ok(dirs.has(name), 'regular file is not a directory');
      resolved.push(part);
    }
  }
  return result;
}

function sourcePins(root, policy) {
  const lockId = line(root, ['rev-parse', `${policy.source_revision}:tools.lock`]);
  const lock = text(object(root, lockId));
  const section = lock.match(/^\[bootstrap-sdk\]\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  assert.ok(section, 'source bootstrap pin is absent');
  for (const [key, expected] of [
    ['version', '0.2.0'],
    ['source_commit', policy.historical_revision],
    ['tag_object', policy.historical_tag],
    ['sha256', policy.bootstrap_sha256],
    ['url', 'https://github.com/UOR-Foundation/PrismPM/releases/download/v0.2.0/prismpm-0.2.0-x86_64-unknown-linux-gnu.tar.gz']
  ]) {
    const matches = [...section.matchAll(new RegExp('^' + key + ' = "([^"\\r\\n]+)"\\r?$', 'gm'))];
    assert.equal(matches.length, 1, 'one explicit bootstrap pin required');
    assert.equal(matches[0][1], expected, 'bootstrap policy differs from committed tools.lock');
  }
  assert.equal(line(root, ['cat-file', '-t', policy.historical_tag]), 'tag');
  assert.equal(line(root, ['rev-parse', `${policy.historical_tag}^{commit}`]), policy.historical_revision);
}

function objectSet(root, roots, snapshot = false) {
  let ids;
  if (snapshot) {
    const revision = roots[0];
    const tree = line(root, ['rev-parse', `${revision}^{tree}`]);
    const entries = text(git(root, ['ls-tree', '-rtz', revision])).split('\0').filter(Boolean);
    ids = [revision, tree, ...entries.map(row => row.slice(0, row.indexOf('\t')).split(' ')[2])];
  } else {
    ids = text(git(root, ['rev-list', '--objects', '--no-object-names', ...roots])).trim().split('\n');
  }
  ids = [...new Set(ids)].sort();
  assert.ok(ids.length && ids.length <= MAX_OBJECTS, 'Git object count exceeds limit');
  ids.forEach(oid);
  const sizes = text(git(root, ['cat-file', '--batch-check=%(objectsize)'], {
    input: ids.join('\n') + '\n'
  })).trim().split('\n').map(Number);
  assert.equal(sizes.length, ids.length);
  assert.ok(sizes.every(n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_BLOB));
  assert.ok(sizes.reduce((a, b) => a + b, 0) <= 4 * 1024 * MiB, 'Git uncompressed closure exceeds resource limit');
  return ids;
}

function pack(root, ids, path, maximum) {
  const bytes = git(root, [
    'pack-objects', '--stdout', '--threads=1', '--window=10', '--depth=50',
    '--compression=9', '--no-reuse-object', '--no-reuse-delta'
  ], {
    input: ids.join('\n') + '\n',
    maxBuffer: maximum
  });
  assert.ok(bytes.length <= maximum, 'Git pack exceeds resource limit');
  writeFileSync(path, bytes, {
    flag: 'wx',
    mode: 0o600
  });
}

// Check declared expanded resources before Git writes an index/object store.
// Git subsequently owns object/delta validation; this does not reinterpret ASTs.
function packShape(bytes) {
  assert.ok(bytes.length >= 32 && bytes.subarray(0, 4).equals(Buffer.from('PACK')), 'Git pack header');
  assert.ok([2, 3].includes(bytes.readUInt32BE(4)));
  const count = bytes.readUInt32BE(8);
  assert.ok(count > 0 && count <= MAX_OBJECTS);
  assert.ok(createHash('sha1').update(bytes.subarray(0, -20)).digest().equals(bytes.subarray(-20)),
    'Git pack checksum');
  let offset = 12;
  let total = 0;
  const end = bytes.length - 20;
  const deadline = performance.now() + 180000;

  function next() {
    assert.ok(offset < end, 'truncated pack');
    return bytes[offset++];
  }

  function deltaSize(data, start) {
    let value = 0;
    let multiplier = 1;
    let index = start;
    let byte;
    do {
      assert.ok(index < data.length && multiplier <= 2 ** 49, 'bounded delta size');
      byte = data[index++];
      value += (byte & 127) * multiplier;
      multiplier *= 128;
    } while (byte & 128);
    assert.ok(Number.isSafeInteger(value) && value <= MAX_BLOB, 'oversized delta object');
    return [value, index];
  }

  for (let index = 0; index < count; index++) {
    assert.ok(performance.now() < deadline, 'bounded pack validation time exceeded');
    let byte = next();
    let size = byte & 15;
    let multiplier = 16;
    const kind = (byte >> 4) & 7;
    assert.ok([1, 2, 3, 4, 6, 7].includes(kind), 'unknown pack object');
    while (byte & 128) {
      assert.ok(multiplier <= 2 ** 49, 'bounded pack size');
      byte = next();
      size += (byte & 127) * multiplier;
      multiplier *= 128;
    }
    assert.ok(Number.isSafeInteger(size) && size <= MAX_BLOB, 'oversized pack object');
    if (kind === 6) {
      let length = 0;
      do {
        byte = next();
        assert.ok(++length <= 10, 'bounded delta offset');
      } while (byte & 128);
    }
    if (kind === 7) {
      assert.ok(offset + 20 <= end);
      offset += 20;
    }
    const inflated = inflateSync(bytes.subarray(offset, end), {
      info: true,
      maxOutputLength: MAX_BLOB
    });
    assert.equal(inflated.buffer.length, size, 'pack object size differs');
    assert.ok(inflated.engine.bytesWritten > 0);
    offset += inflated.engine.bytesWritten;
    let expanded = size;
    if (kind === 6 || kind === 7) {
      const [, cursor] = deltaSize(inflated.buffer, 0);
      [expanded] = deltaSize(inflated.buffer, cursor);
    }
    total += expanded;
    assert.ok(total <= 4 * 1024 * MiB, 'expanded pack exceeds resource limit');
  }
  assert.equal(offset, end, 'extra or omitted packed objects');
  return total;
}

function inspectRepository(root, policy, source) {
  if (source) {
    sourcePins(root, policy);
    const ids = objectSet(root, [policy.source_revision, policy.historical_tag]);
    return {
      revision: policy.source_revision,
      tree: line(root, ['rev-parse', `${policy.source_revision}^{tree}`]),
      files: files(root, policy.source_revision),
      historical: {
        revision: policy.historical_revision,
        tree: line(root, ['rev-parse', `${policy.historical_revision}^{tree}`]),
        files: files(root, policy.historical_revision)
      },
      objects_sha256: hash(canonical(ids)),
      object_count: ids.length,
      ids
    };
  }
  assert.equal(line(root, ['rev-parse', `${policy.advisory_revision}^{tree}`]), policy.advisory_tree,
    'advisory tree differs from reviewed identity');
  const ids = objectSet(root, [policy.advisory_revision], true);
  return {
    authority: 'https://github.com/RustSec/advisory-db',
    revision: policy.advisory_revision,
    tree: policy.advisory_tree,
    files: files(root, policy.advisory_revision),
    objects_sha256: hash(canonical(ids)),
    object_count: ids.length,
    ids
  };
}

function descriptor(directory, path) {
  const bytes = regular(join(directory, path), MAX_PACK);
  return {
    path,
    byte_length: bytes.length,
    sha256: hash(bytes)
  };
}

function safeDestination(destination) {
  const path = resolve(destination);
  const parent = dirname(path);
  assert.notEqual(path, parent);
  assert.equal(realpathSync(parent), parent, 'destination parent must not alias another path');
  assert.ok(!existsSync(path), 'destination must not exist');
  const space = statfsSync(parent);
  assert.ok(space.bavail * space.bsize >= 2 * MAX_PACK + MAX_BLOB + 64 * MiB,
    'insufficient space for bounded closure output');
  return path;
}

export function buildClosure({
  source,
  advisory,
  bootstrap,
  policy,
  destination,
  maxPackBytes = MAX_PACK
}) {
  assert.ok(Number.isSafeInteger(maxPackBytes) && maxPackBytes > 0 && maxPackBytes <= MAX_PACK,
    'operational pack budget can only lower the hard bound');
  policyCheck(policy);
  source = realpathSync(source);
  advisory = realpathSync(advisory);
  const output = safeDestination(destination);
  assert.ok(relative(source, output).startsWith('..' + sep) || isAbsolute(relative(source, output)),
    'destination must be outside source');
  const work = mkdtempSync(join(tmpdir(), 'prismpm-sdk-input-build-'));
  const workIdentity = lstatSync(work);
  let outputIdentity;
  try {
    const sourceInput = privateView(source, policy.source_revision, true, work);
    const advisoryInput = privateView(advisory, policy.advisory_revision, false, work);
    sourcePins(sourceInput.view, policy);
    const bootstrapBytes = regular(bootstrap, MAX_BLOB);
    assert.equal(hash(bootstrapBytes), policy.bootstrap_sha256, 'bootstrap archive differs from source pin');
    const sourceData = inspectRepository(sourceInput.view, policy, true);
    const advisoryData = inspectRepository(advisoryInput.view, policy, false);
    checkWorktree(sourceInput, policy.source_revision, sourceData.files);
    checkWorktree(advisoryInput, policy.advisory_revision, advisoryData.files);
    mkdirSync(output, {
      mode: 0o700
    });
    outputIdentity = lstatSync(output);
    pack(sourceInput.view, sourceData.ids, join(output, 'source.pack'), maxPackBytes);
    pack(advisoryInput.view, advisoryData.ids, join(output, 'advisory.pack'), maxPackBytes);
    delete sourceData.ids;
    delete advisoryData.ids;
    writeFileSync(join(output, 'bootstrap.tar.gz'), bootstrapBytes, {
      flag: 'wx',
      mode: 0o600
    });
    const manifest = {
      schema: 'prismpm/sdk-vv-input-closure/1',
      scope: 'sdk-vv-inputs-only',
      policy,
      source: sourceData,
      advisory: advisoryData,
      artifacts: ['advisory.pack', 'bootstrap.tar.gz', 'source.pack']
        .map(path => descriptor(output, path))
    };
    writeFileSync(join(output, 'manifest.json'), canonical(manifest), {
      flag: 'wx',
      mode: 0o600
    });
    verifyClosure(output, policy);
    checkWorktree(sourceInput, policy.source_revision, sourceData.files);
    checkWorktree(advisoryInput, policy.advisory_revision, advisoryData.files);
    return manifest;
  } catch (error) {
    if (outputIdentity) removeOwned(output, outputIdentity);
    throw error;
  } finally {
    removeOwned(work, workIdentity);
  }
}

function unpack(bytes, root, shallow) {
  const expanded = packShape(bytes);
  const space = statfsSync(dirname(root));
  assert.ok(space.bavail * space.bsize >= expanded + bytes.length + 64 * MiB,
    'insufficient space for bounded Git verification');
  mkdirSync(root);
  git(root, ['init', '--bare', '--quiet']);
  if (shallow) writeFileSync(join(root, 'shallow'), shallow + '\n');
  git(root, ['index-pack', '--stdin', '--strict'], {
    input: bytes
  });
  git(root, ['fsck', '--strict', '--no-reflogs', '--no-dangling']);
}

function withVerifiedClosure(directory, expectedPolicy, consume) {
  policyCheck(expectedPolicy);
  directory = resolve(directory);
  assert.ok(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  assert.deepEqual(readdirSync(directory).sort(), [
    'advisory.pack', 'bootstrap.tar.gz', 'manifest.json', 'source.pack'
  ], 'exact input artifact set required');
  const manifestBytes = regular(join(directory, 'manifest.json'), MAX_METADATA);
  const manifest = JSON.parse(text(manifestBytes));
  assert.ok(manifestBytes.equals(Buffer.from(canonical(manifest))), 'canonical input manifest required');
  keys(manifest, ['schema', 'scope', 'policy', 'source', 'advisory', 'artifacts']);
  assert.equal(manifest.schema, 'prismpm/sdk-vv-input-closure/1');
  assert.equal(manifest.scope, 'sdk-vv-inputs-only');
  assert.deepEqual(manifest.policy, expectedPolicy, 'external input policy differs');
  const payloads = new Map(['advisory.pack', 'bootstrap.tar.gz', 'source.pack'].map(path => [
    path, regular(join(directory, path), path === 'bootstrap.tar.gz' ? MAX_BLOB : MAX_PACK)
  ]));
  assert.deepEqual(manifest.artifacts, [...payloads].map(([path, bytes]) => ({
    path,
    byte_length: bytes.length,
    sha256: hash(bytes)
  })), 'artifact bytes differ');
  assert.equal(manifest.artifacts[1].sha256, expectedPolicy.bootstrap_sha256);
  const work = mkdtempSync(join(tmpdir(), 'prismpm-sdk-input-verify-'));
  const identity = lstatSync(work);
  try {
    for (const [name, source] of [['source', true], ['advisory', false]]) {
      const root = join(work, name);
      unpack(payloads.get(name + '.pack'), root, source ? undefined : expectedPolicy.advisory_revision);
      const actual = inspectRepository(root, expectedPolicy, source);
      const packed = text(git(root, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'])).trim().split('\n').sort();
      assert.deepEqual(packed, actual.ids, 'undeclared or missing Git objects');
      delete actual.ids;
      assert.deepEqual(manifest[name], actual, 'complete committed file/mode/history closure differs');
    }
    return consume({ manifest, payloads, work });
  } finally {
    removeOwned(work, identity);
  }
}

export function verifyClosure(directory, expectedPolicy) {
  return withVerifiedClosure(directory, expectedPolicy, ({ manifest }) => manifest);
}

// Reconstruct only data. No checked-out script, filter, hook, bootstrap binary
// or acceptance command executes here, and no caller cache is copied.
export function materializeClosure(directory, expectedPolicy, destination, {
  maxCheckoutBytes = 4 * 1024 * MiB
} = {}) {
  assert.ok(Number.isSafeInteger(maxCheckoutBytes) && maxCheckoutBytes > 0 && maxCheckoutBytes <= 4 * 1024 * MiB,
    'operational checkout budget can only lower the hard bound');
  assert.ok(!lstatSync(directory).isSymbolicLink(), 'input closure must not be aliased');
  directory = realpathSync(directory);
  const output = safeDestination(destination);
  const within = relative(directory, output);
  assert.ok(within.startsWith('..' + sep) || isAbsolute(within), 'destination must be outside input closure');
  return withVerifiedClosure(directory, expectedPolicy, ({ manifest, payloads, work }) => {
    const fileBytes = [...manifest.source.files, ...manifest.advisory.files]
      .reduce((sum, row) => sum + row.byte_length, payloads.get('bootstrap.tar.gz').length);
    assert.ok(Number.isSafeInteger(fileBytes) && fileBytes <= maxCheckoutBytes, 'checkout exceeds resource limit');
    const space = statfsSync(dirname(output));
    const packedBytes = [...payloads.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    assert.ok(space.bavail * space.bsize >= fileBytes + packedBytes + 64 * MiB,
      'insufficient space for materialized inputs');
    mkdirSync(output, { mode: 0o700 });
    const identity = lstatSync(output);
    try {
      for (const [name, source] of [['source', true], ['advisory', false]]) {
        const root = join(output, name);
        const data = manifest[name];
        mkdirSync(root, { mode: 0o700 });
        git(root, ['init', '--quiet', '--template=']);
        if (!source) writeFileSync(join(root, '.git', 'shallow'), data.revision + '\n', { flag: 'wx', mode: 0o600 });
        git(root, ['index-pack', '--stdin', '--strict'], { input: payloads.get(name + '.pack') });
        git(root, ['update-ref', '--no-deref', 'HEAD', data.revision]);
        if (source) git(root, ['update-ref', 'refs/tags/v0.2.0', expectedPolicy.historical_tag]);
        git(root, ['read-tree', data.revision]);
        // Git checkout can rewrite blobs through attributes. Restore their
        // authenticated raw bytes directly, installing aliases last.
        for (const row of data.files) mkdirSync(dirname(join(root, row.path)), { recursive: true });
        for (const row of data.files.filter(row => row.mode !== '120000')) {
          const bytes = object(root, row.oid);
          assert.equal(bytes.length, row.byte_length);
          assert.equal(hash(bytes), row.sha256);
          const mode = row.mode === '100755' ? 0o755 : 0o644;
          writeFileSync(join(root, row.path), bytes, { flag: 'wx', mode });
          chmodSync(join(root, row.path), mode);
        }
        for (const row of data.files.filter(row => row.mode === '120000')) {
          symlinkSync(row.target, join(root, row.path));
        }
        checkWorktree(privateView(root, data.revision, source, work), data.revision, data.files);
        assert.equal(line(root, ['remote']), '', 'materialized inputs cannot depend on a remote');
        if (source) assert.equal(line(root, ['rev-parse', 'refs/tags/v0.2.0']), expectedPolicy.historical_tag);
      }
      writeFileSync(join(output, 'bootstrap.tar.gz'), payloads.get('bootstrap.tar.gz'), { flag: 'wx', mode: 0o600 });
      assert.deepEqual(readdirSync(output).sort(), ['advisory', 'bootstrap.tar.gz', 'source']);
      return manifest;
    } catch (error) {
      removeOwned(output, identity);
      throw error;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'build' && args.length === 5) {
    const [source, advisory, bootstrap, policyPath, destination] = args;
    console.log(canonical(buildClosure({
      source,
      advisory,
      bootstrap,
      policy: JSON.parse(text(regular(policyPath, MiB))),
      destination
    })).trimEnd());
  } else if (command === 'verify' && args.length === 2) {
    const [directory, policyPath] = args;
    console.log(canonical(verifyClosure(directory, JSON.parse(text(regular(policyPath, MiB))))).trimEnd());
  } else if (command === 'materialize' && args.length === 3) {
    const [directory, policyPath, destination] = args;
    console.log(canonical(materializeClosure(directory, JSON.parse(text(regular(policyPath, MiB))), destination)).trimEnd());
  } else throw Error('usage: sdk-vv-inputs.mjs build SOURCE ADVISORY BOOTSTRAP POLICY DEST | verify CLOSURE POLICY | materialize CLOSURE POLICY DEST');
}
