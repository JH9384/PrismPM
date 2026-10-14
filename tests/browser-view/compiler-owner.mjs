// One freshly compiled tool closure per serial verification owner. This never
// adopts a prior Cargo target, on-disk receipt, caller executable or model output.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, opendirSync,
  readSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {createPrivateDriverTarget, ensureProdExport, repository, run, sha} from './compile.mjs';
import {captureCompilerArtifact, compilerReadBarrier, observeCompilerRuntimeFile} from './compiler-artifact.mjs';

const families = Object.freeze({
  view: Object.freeze({directory: 'browser-view', executable: 'browser-workspace-view-driver'}),
  effects: Object.freeze({directory: 'browser-effects', executable: 'browser-effects-driver'}),
  presentation: Object.freeze({directory: 'browser-presentation', executable: 'browser-presentation-driver'}),
  'operation-journal': Object.freeze({directory: 'browser-operation-journal', executable: 'browser-operation-journal-driver'}),
  budget: Object.freeze({directory: 'browser-budget', executable: 'browser-budget-driver'}),
  custody: Object.freeze({directory: 'browser-custody', executable: 'browser-custody-driver'}),
  publication: Object.freeze({directory: 'publication-admission', executable: 'publication-admission-driver'}),
});
const owners = new WeakMap();
function family(name) {
  assert.ok(typeof name === 'string' && Object.hasOwn(families, name), 'registered compiler family required');
  return families[name];
}
function requiredInputs(name) {
  const selected = family(name), manifest = 'tests/' + selected.directory + '/driver/Cargo.toml';
  const paths = new Set([manifest, manifest.replace('Cargo.toml', 'Cargo.lock'), manifest.replace('Cargo.toml', 'src/main.rs'),
    'lean-toolchain', 'rust-toolchain.toml', 'model/dependencies.toml', 'model/authorities.toml',
    'vendor/lean4-prod/lean.tar', 'tests/browser-view/compile.mjs', 'tests/browser-view/driver-cache.mjs',
    'tests/browser-view/compiler-owner.mjs', 'tests/browser-view/compiler-artifact.mjs',
    'tests/browser-view/compiler-owner-checks.mjs', 'tests/browser-view/serial-compiler-owner.mjs',
    'tests/browser-view/verification-products.mjs']);
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    const manifestPath = tree + '/MANIFEST.sha256'; paths.add(manifestPath);
    for (const line of file(join(repository, manifestPath)).toString().trimEnd().split('\n')) {
      const row = /^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row, 'registered compiler manifest row');
      assert(!row[2].startsWith('/') && !row[2].split('/').some(part => !part || part === '.' || part === '..'));
      const path = tree + '/' + row[2]; assert(!paths.has(path), 'duplicate compiler input'); paths.add(path);
    }
  }
  return [...paths].sort();
}
export function captureCompilerInputs(name) {
  return inputMap(Object.fromEntries(requiredInputs(name).map(path => [path, sha(file(join(repository, path)))])));
}
function inputMap(value) {
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, 'compiler input map required');
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  assert.ok(keys.every(key => typeof key === 'string' && 'value' in fields[key]), 'compiler input map must contain data');
  return Object.freeze(Object.fromEntries(keys.sort().map(path => {
    assert.ok(/^[A-Za-z0-9_./-]+$/.test(path)
      && !path.split('/').some(part => part === '' || part === '.' || part === '..'), 'compiler input path refused');
    const digest = fields[path].value;
    assert.ok(typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest), 'compiler input digest refused');
    return [path, digest];
  })));
}
function unchanged(before, after) {
  for (const key of ['dev', 'ino', 'uid', 'gid', 'mode', 'size', 'nlink', 'mtimeNs', 'ctimeNs'])
    assert.equal(after[key], before[key], 'stable compiler source');
}
function observeFile(path, retain = false) {
  assert.equal(realpathSync(path), path, 'unaliased compiler source required');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint: true});
    assert(before.isFile() && before.nlink === 1n && before.size <= 268435456n, 'bounded single-link compiler source required');
    const bytes = retain ? Buffer.alloc(Number(before.size)) : undefined;
    const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, Number(before.size)))), hash = createHash('sha256');
    let offset = 0;
    while (BigInt(offset) < before.size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, Number(before.size) - offset), null);
      assert(count > 0, 'compiler source shortened');
      hash.update(buffer.subarray(0, count));
      if (bytes) buffer.copy(bytes, offset, 0, count);
      offset += count;
    }
    assert.equal(readSync(fd, buffer, 0, 1, null), 0, 'compiler source grew');
    for (const after of [fstatSync(fd, {bigint: true}), lstatSync(path, {bigint: true})])
      unchanged(before, after);
    assert.equal(realpathSync(path), path, 'compiler source ancestry changed');
    return {bytes, sha256: hash.digest('hex'), stat: before};
  } finally {closeSync(fd);}
}
function file(path, expected, retain = true) {
  const captured = observeFile(path, retain);
  if (expected !== undefined) assert.equal(captured.sha256, expected, 'captured compiler source ' + path);
  return captured.bytes;
}

// A bounded filesystem observation, never compiler-source provenance. Only a
// fresh owner can bind this result to actual construction and execute its tool.
export function captureCompilerRuntime(root) {
  const entries = new Map(), observed = [];
  const counts = {source: 0, build: 0}, totals = {source: 0n, build: 0n};
  const pending = [{path: root, relative: '.', stat: lstatSync(root, {bigint: true})}];
  assert(pending[0].stat.isDirectory(), 'exporter runtime root must be a directory');
  function capture(path, relative, stat) {
    assert.equal(realpathSync(path), path, 'unaliased exporter runtime closure');
    unchanged(stat, lstatSync(path, {bigint: true}));
    assert.equal(stat.uid, BigInt(process.getuid()), 'owned exporter runtime closure');
    assert.equal(stat.mode & 0o7022n, 0n,
      'exporter runtime cannot have special permissions or be group/other writable: ' + relative);
    if (relative !== '.' && relative !== './.source-lean.tar') {
      const kind = relative === './.lake' || relative.startsWith('./.lake/') ? 'build' : 'source';
      assert(counts[kind] < 4096, 'exporter runtime ' + kind + ' entry count exceeded');
      counts[kind]++;
      if (stat.isFile()) {
        totals[kind] += stat.size;
        assert(totals[kind] <= BigInt(kind === 'build' ? 512 : 16) * 1024n ** 2n,
          'exporter runtime ' + kind + ' byte count exceeded');
      }
    }
    const identity = {device: stat.dev.toString(), inode: stat.ino.toString(),
      uid: stat.uid.toString(), gid: stat.gid.toString(), mode: Number(stat.mode)};
    if (stat.isDirectory()) {
      assert.notEqual(relative, './.source-lean.tar', 'captured exporter archive must be a regular file');
      entries.set(relative, Object.freeze({kind: 'directory', ...identity}));
    } else {
      assert.ok(stat.isFile() && stat.size <= 268435456n, 'bounded regular exporter runtime input');
      const captured = observeCompilerRuntimeFile(path);
      unchanged(stat, captured.stat);
      entries.set(relative, Object.freeze({kind: 'file', ...identity, links: stat.nlink.toString(),
        size: Number(stat.size), sha256: captured.sha256}));
    }
    unchanged(stat, lstatSync(path, {bigint: true}));
    observed.push({path, stat});
  }
  capture(root, '.', pending[0].stat);
  while (pending.length) {
    const {path, relative, stat} = pending.pop();
    unchanged(stat, lstatSync(path, {bigint: true}));
    assert.equal(realpathSync(path), path, 'unaliased exporter runtime closure');
    const stream = opendirSync(path, {bufferSize: 1});
    try { for (let entry; (entry = stream.readSync()) !== null;) {
      const child = join(path, entry.name), name = relative + '/' + entry.name;
      const metadata = lstatSync(child, {bigint: true});
      capture(child, name, metadata);
      // Count and retain the row before queueing a child; only one directory
      // iterator is live and pending paths cannot exceed the entry budgets.
      if (metadata.isDirectory()) pending.push({path: child, relative: name, stat: metadata});
    } } finally {stream.closeSync();}
    unchanged(stat, lstatSync(path, {bigint: true}));
  }
  for (const {path, stat} of observed) {
    unchanged(stat, lstatSync(path, {bigint: true}));
    assert.equal(realpathSync(path), path, 'compiler source ancestry changed');
  }
  return Object.freeze(Object.fromEntries([...entries].sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b)))));
}

export function createCompilerOwner(name, selectedInputs = captureCompilerInputs(name)) {
  const selected = family(name), inputs = inputMap(selectedInputs);
  assert.deepEqual(Object.keys(inputs), requiredInputs(name), 'complete closed compiler input closure required');
  const manifest = 'tests/' + selected.directory + '/driver/Cargo.toml';
  const driverFiles = [manifest, manifest.replace('Cargo.toml', 'Cargo.lock'), manifest.replace('Cargo.toml', 'src/main.rs')];
  for (const path of [...driverFiles, 'lean-toolchain', 'rust-toolchain.toml', 'model/dependencies.toml',
    'model/authorities.toml', 'vendor/lean4-prod/lean.tar', 'vendor/lean4-prod/rust/MANIFEST.sha256',
      'vendor/lexlean/MANIFEST.sha256', 'tests/browser-view/compile.mjs', 'tests/browser-view/compiler-owner.mjs',
    'tests/browser-view/compiler-artifact.mjs']) assert.ok(Object.hasOwn(inputs, path), 'compiler input closure missing ' + path);
  const captured = new Map(Object.entries(inputs).map(([path, digest]) => [path, file(join(repository, path), digest)]));
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    for (const line of captured.get(tree + '/MANIFEST.sha256').toString().trimEnd().split('\n')) {
      const match = /^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(match);
      assert.equal(inputs[tree + '/' + match[2]], match[1], 'complete registered compiler source inventory');
    }
  }
  const work = mkdtempSync(join(tmpdir(), 'prismpm-compiler-owner-')), staged = new Map();
  function stage(path, bytes) {
    const target = join(work, path); mkdirSync(dirname(target), {recursive: true, mode: 0o700});
    writeFileSync(target, bytes, {flag: 'wx', mode: 0o600}); staged.set(path, sha(bytes));
  }
  for (const [path, bytes] of captured) if (path.startsWith('vendor/lexlean/')
    || path.startsWith('vendor/lean4-prod/rust/') || driverFiles.includes(path)
    || ['lean-toolchain', 'rust-toolchain.toml'].includes(path)) stage(path, bytes);
  const began = performance.now();
  let constructed = false;
  try {
    const exporterStarted = performance.now(), exporter = ensureProdExport(repository, work);
    const exporterBuildMs = performance.now() - exporterStarted;
    const runtime = captureCompilerRuntime(exporter.dir);
    const exportArtifact = captureCompilerArtifact(work, exporter.bin, 'exporter');
    const target = createPrivateDriverTarget(work), driverStarted = performance.now();
    run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0',
      '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3',
      '--manifest-path', join(work, manifest)], work, {CARGO_TARGET_DIR: target});
    const driverBuildMs = performance.now() - driverStarted;
    const driver = captureCompilerArtifact(work, join(target, 'debug', selected.executable), 'driver');
    const evidence = Object.freeze({scope: 'fresh-owner-scoped-compiler-tools', family: name, work, inputs,
      exporter: exportArtifact.evidence, driver: driver.evidence, exporterRuntime: runtime,
      exporterBuildMs, driverBuildMs, preparationMs: performance.now() - began});
    let closed = false, busy = false;
    function verify() {
      return compilerReadBarrier(() => {
        assert.equal(closed, false, 'compiler owner closed');
        assert.equal(realpathSync(work), work, 'unaliased private compiler owner');
        assert.equal(lstatSync(work).mode & 0o077, 0, 'private compiler owner directory required');
        for (const [path, digest] of Object.entries(inputs)) file(join(repository, path), digest, false);
        for (const [path, digest] of staged) file(join(work, path), digest, false);
        assert.deepEqual(captureCompilerRuntime(exporter.dir), runtime, 'immutable complete exporter runtime closure');
        exportArtifact.verify(); driver.verify();
      });
    }
    function execute(artifact, args, cwd, environment) {
      assert.equal(busy, false, 'serial compiler owner required'); verify(); busy = true;
      try {return artifact.run(args, cwd, environment);} finally {busy = false; verify();}
    }
    const identity = sha(Buffer.from(JSON.stringify(evidence)));
    const owner = Object.freeze({evidence, identity, verify,
      runDriver(args, cwd) {return execute(driver, args, cwd, {});},
      runExporter(args, leanPath) {return execute(exportArtifact, args, exporter.dir, {LEAN_PATH: leanPath});},
      close() {
        assert.equal(busy, false, 'compiler owner still executing'); verify(); closed = true;
        // Retire only this completed owner's reconstructible tool caches.
        // Private executables, input sources and immutable evidence remain.
        writeFileSync(join(work, 'compiler-owner-retirement-intent.json'),
          JSON.stringify({status: 'requested', compiler: identity}) + '\n', {flag: 'wx'});
        run('cargo', ['clean', '--manifest-path', join(work, manifest), '--target-dir', target], work);
        run('lake', ['clean'], exporter.dir);
        assert.equal(lstatSync(join(target, 'debug', selected.executable), {throwIfNoEntry: false}), undefined);
        assert.equal(lstatSync(join(exporter.dir, '.lake/build'), {throwIfNoEntry: false}), undefined);
        for (const artifact of [driver, exportArtifact]) {
          const before = lstatSync(artifact.path, {bigint: true});
          const bytes = file(artifact.path, artifact.evidence.private.sha256);
          const after = lstatSync(artifact.path, {bigint: true});
          for (const stat of [before, after]) assert.deepEqual({
            path: artifact.evidence.private.path, device: stat.dev.toString(), inode: stat.ino.toString(),
            uid: stat.uid.toString(), gid: stat.gid.toString(), mode: Number(stat.mode),
            links: stat.nlink.toString(), size: Number(stat.size), sha256: sha(bytes),
          }, artifact.evidence.private, 'retired compiler executable custody');
        }
        const receipt = Object.freeze({scope: 'completed-owner-compiler-caches', status: 'retired', compiler: identity});
        writeFileSync(join(work, 'compiler-owner-retirement.json'), JSON.stringify(receipt) + '\n', {flag: 'wx'});
        return receipt;
      }});
    owners.set(owner, {inputs, family: name}); verify(); constructed = true;
    return owner;
  } finally {
    if (!constructed) process.stderr.write('Retained failed compiler owner ' + work + '\n');
  }
}

export function requireCompilerOwner(owner, name) {
  const state = owners.get(owner);
  assert.ok(state, 'actual fresh compiler owner required');
  assert.equal(name, state.family, 'same registered compiler family required');
  owner.verify(); return owner;
}
