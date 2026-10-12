// Build-time projection of one pinned upstream document, not a general YAML API.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readSync,
  realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const requireOracle = createRequire('/opt/prismpm/oracles/package.json');
const yaml = requireOracle('js-yaml');
const yamlPackage = requireOracle('js-yaml/package.json');
assert.equal(yamlPackage.version, '4.3.2', 'the installed locked js-yaml oracle is required');
const NAME = 'ingress-nginx-kind-v1.15.1';
const LIMIT = 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = stat => ['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs'].map(key => stat[key]);
const directoryIdentity = stat => ['dev', 'ino', 'mode', 'nlink', 'uid', 'gid'].map(key => stat[key]);

function parent(path) {
  const directory = dirname(path);
  assert.equal(realpathSync(directory), directory, 'aliased input parent');
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, {bigint: true}); assert(before.isDirectory());
    const held = '/proc/self/fd/' + fd;
    const stable = () => {
      assert.equal(realpathSync(held), directory, 'parent namespace changed');
      assert.deepEqual(directoryIdentity(lstatSync(directory, {bigint: true})), directoryIdentity(before), 'parent identity changed');
      assert.deepEqual(directoryIdentity(fstatSync(fd, {bigint: true})), directoryIdentity(before), 'held parent changed');
    };
    stable(); return {fd, held, directory, native: directoryIdentity(before), stable};
  } catch (error) { closeSync(fd); throw error; }
}

function regular(path) {
  const directory = parent(path); let fd;
  try {
    fd = openSync(join(directory.held, path.slice(dirname(path).length + 1)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd, {bigint: true});
    assert(before.isFile() && before.size <= BigInt(LIMIT), 'bounded regular input required');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, Math.min(65536, bytes.length - offset), null);
      assert(count > 0, 'input truncated'); offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0, 'input grew');
    for (const after of [fstatSync(fd, {bigint: true}), lstatSync(path, {bigint: true})]) {
      assert.deepEqual(identity(after), identity(before), 'input changed');
    }
    directory.stable();
    return {path, bytes, native: identity(before), parent: directory.directory, parent_native: directory.native};
  } finally { if (fd !== undefined) closeSync(fd); closeSync(directory.fd); }
}

// Preserve array order and values. Reject lossy YAML-to-JSON conversions rather
// than silently stringify Date, aliases/cycles, nonfinite or unsafe numbers.
export function canonical(value) {
  const active = new Set(); let nodes = 0;
  const encode = (item, depth) => {
    assert(++nodes <= 100000 && depth <= 64, 'projection structure exceeds bound');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      assert(Number.isSafeInteger(item) && !Object.is(item, -0), 'lossless integer required');
      return JSON.stringify(item);
    }
    assert(item && typeof item === 'object' && !active.has(item), 'non-JSON or cyclic value');
    assert(Array.isArray(item) || [Object.prototype, null].includes(Object.getPrototypeOf(item)), 'non-JSON object');
    const keys = Reflect.ownKeys(item);
    assert(keys.every(key => typeof key === 'string'), 'symbol keys are not JSON');
    if (Array.isArray(item)) {
      assert(item.length <= 100000 && keys.length === item.length + 1
        && keys.slice(0, -1).every((key, index) => key === String(index)) && keys.at(-1) === 'length', 'dense array without extra properties required');
    }
    for (const key of keys) assert(Object.hasOwn(Object.getOwnPropertyDescriptor(item, key), 'value'), 'accessor is not JSON data');
    active.add(item);
    const result = Array.isArray(item)
      ? '[' + item.map(child => encode(child, depth + 1)).join(',') + ']'
      : '{' + Object.keys(item).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map(key => JSON.stringify(key) + ':' + encode(item[key], depth + 1)).join(',') + '}';
    active.delete(item); return result;
  };
  const bytes = Buffer.from(encode(value, 0) + '\n');
  assert(bytes.length <= LIMIT, 'projection byte bound exceeded'); return bytes;
}

export function project(bytes) {
  // Internal conversion/test seam. The normal producer admits the exact fixed
  // YAML digest before calling it; this is not an arbitrary-input YAML service.
  assert(Buffer.isBuffer(bytes) && bytes.length <= LIMIT, 'bounded YAML bytes required');
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes), documents = [];
  yaml.loadAll(text, value => {
    if (value === null || value === undefined) return; // same original empty-document policy
    assert(value && typeof value === 'object' && !Array.isArray(value), 'resource object required');
    assert(documents.length < 64, 'document count bound exceeded'); documents.push(value);
  });
  assert(documents.length > 0, 'resource stream is empty');
  return canonical(documents); // deliberately retain ConfigMap data:null here
}

export function generate(root, write = false) {
  root = realpathSync(root);
  const input = regular(join(root, 'adapters', NAME + '.yaml'));
  const policy = regular(join(root, 'adapters/kubernetes.json'));
  const tools = regular(join(root, 'tools.lock'));
  const packageJson = regular(join(root, 'sdk/oracles/package.json'));
  const packageLock = regular(join(root, 'sdk/oracles/package-lock.json'));
  const installedLock = regular('/opt/prismpm/oracles/package-lock.json');
  const expected = JSON.parse(policy.bytes).projection_policy.ingress_controller_manifest_sha256;
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(hash(input.bytes), expected, 'pinned upstream YAML digest differs');
  const toolsText = tools.bytes.toString();
  const pins = [...toolsText.matchAll(/^[ \t]*ingress_nginx_kind_manifest\s*=.*$/gm)];
  assert.equal(pins.length, 1, 'exactly one ingress manifest tool pin required');
  assert.equal(pins[0][0], `ingress_nginx_kind_manifest = "sha256:${expected}"`);
  const headers = [...toolsText.matchAll(/^\[([^\]\r\n]+)\]\s*$/gm)];
  assert.equal(headers.filter(row => row[1] === 'target-adapters').length, 1, 'exact target-adapters table required');
  assert.equal(headers.filter(row => row.index < pins[0].index).at(-1)?.[1], 'target-adapters', 'manifest pin is outside target-adapters');
  const start = headers.findIndex(row => row[1] === 'target-adapters');
  const table = toolsText.slice(headers[start].index + headers[start][0].length, headers[start + 1]?.index ?? toolsText.length);
  const keys = new Set();
  for (const line of table.split('\n').filter(line => line.trim() && !line.trimStart().startsWith('#'))) {
    const match = /^([a-z_]+) = "[^"\r\n]*"$/.exec(line);
    assert(match && !keys.has(match[1]), 'noncanonical or duplicate target-adapter key'); keys.add(match[1]);
  }
  assert.equal(JSON.parse(packageJson.bytes).dependencies['js-yaml'], yamlPackage.version);
  const packageData = JSON.parse(packageLock.bytes), installedData = JSON.parse(installedLock.bytes);
  const selected = packageData.packages['node_modules/js-yaml'];
  assert.equal(selected.version, yamlPackage.version);
  assert.equal(selected.resolved, 'https://registry.npmjs.org/js-yaml/-/js-yaml-4.3.2.tgz');
  assert.match(selected.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  assert.equal(packageData.packages[''].dependencies['js-yaml'], yamlPackage.version);
  assert.deepEqual(selected, installedData.packages['node_modules/js-yaml'], 'source and installed npm lock differ');
  const bytes = project(input.bytes), documents = JSON.parse(bytes);
  assert.equal(documents.length, 19, 'complete fixed upstream resource inventory required');
  assert.equal(documents.filter(row => row.apiVersion === 'v1' && row.kind === 'ConfigMap' && row.data === null).length, 1);
  const destination = join(root, 'adapters', NAME + '.json');
  const before = lstatSync(destination, {bigint: true, throwIfNoEntry: false});
  if (before) assert(before.isFile() && before.nlink === 1n, 'projection destination must be a single regular file');
  const stable = () => {
    for (const row of [input, policy, tools, packageJson, packageLock, installedLock]) {
      assert.deepEqual(identity(lstatSync(row.path, {bigint: true})), row.native, 'generator input changed');
      assert.equal(realpathSync(row.parent), row.parent);
      assert.deepEqual(directoryIdentity(lstatSync(row.parent, {bigint: true})), row.parent_native, 'generator input parent changed');
    }
  };
  stable();
  if (write) {
    // This is a serialized source-generation operation in the owned checkout;
    // rename is atomic, not a claim of kernel compare-and-replace exclusion.
    const directory = parent(destination), target = join(directory.held, NAME + '.json');
    const temporary = target + '.' + randomBytes(12).toString('hex') + '.tmp';
    let fd, failure, created = false, published = false;
    try {
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
      created = true; const owned = identity(fstatSync(fd, {bigint: true}));
      for (let offset = 0; offset < bytes.length;) {
        const count = writeSync(fd, bytes, offset, Math.min(65536, bytes.length - offset));
        assert(count > 0, 'projection write made no progress'); offset += count;
      }
      fsyncSync(fd); stable(); directory.stable();
      const completed = identity(fstatSync(fd, {bigint: true}));
      assert.deepEqual(completed.slice(0, 6), owned.slice(0, 6));
      assert.deepEqual(identity(lstatSync(temporary, {bigint: true})), completed, 'owned temporary changed');
      const current = lstatSync(target, {bigint: true, throwIfNoEntry: false});
      assert.deepEqual(current && identity(current), before && identity(before), 'projection destination changed');
      renameSync(temporary, target); published = true;
      assert.deepEqual(identity(lstatSync(target, {bigint: true})), identity(fstatSync(fd, {bigint: true})), 'published inode differs');
      fsyncSync(directory.fd); directory.stable();
    } catch (error) { failure = error; }
    finally {
      if (fd !== undefined) try { closeSync(fd); } catch (error) { failure ??= error; }
      if (created && !published) try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') failure ??= error; }
      try { closeSync(directory.fd); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }
  const output = regular(destination); assert(output.bytes.equals(bytes), 'generated ingress projection is stale'); stable();
  assert.deepEqual(identity(lstatSync(destination, {bigint: true})), output.native, 'projection changed after readback');
  return {source_sha256: hash(input.bytes), projection_sha256: hash(bytes), resources: documents.length, bytes: bytes.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert(process.argv.length === 3 && ['--check', '--write'].includes(process.argv[2]), 'usage: ingress-nginx-projection.mjs --check|--write');
  console.log(JSON.stringify(generate(resolve(dirname(fileURLToPath(import.meta.url)), '..'), process.argv[2] === '--write')));
}
