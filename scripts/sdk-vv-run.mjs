// Internal one-part executor. Native-host, network and OCI-image identity checks
// belong to the independent outer job; this file cannot attest those facts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync, closeSync, constants, copyFileSync, cpSync, fstatSync, lstatSync,
  mkdirSync, openSync, readdirSync, readlinkSync, readSync,
  realpathSync, renameSync, statfsSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parts as vvParts } from './vv-assemble.mjs';
import { materializeClosure, verifyClosure } from './sdk-vv-inputs.mjs';
import {bootstrapNames, captureBootstrap, readOriginal, validateBootstrapRetention} from './sdk-bootstrap-retention.mjs';

const SHARED = '/opt/prismpm/share';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

function regular(path, limit) {
  assert(lstatSync(path).isFile(), 'expected a regular, non-symlink file');
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    assert(before.isFile() && before.size <= BigInt(limit), 'bounded regular evidence required');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      assert(count > 0, 'evidence shortened while reading'); offset += count;
    }
    assert.equal(readSync(descriptor, Buffer.alloc(1), 0, 1, null), 0, 'evidence grew while reading');
    for (const after of [fstatSync(descriptor, { bigint: true }), lstatSync(path, { bigint: true })]) {
      assert(after.isFile(), 'evidence path replaced');
      for (const key of ['dev', 'ino', 'size', 'mode', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key], 'evidence changed while reading');
    }
    return bytes;
  } finally { closeSync(descriptor); }
}

export function validateVvEvidence(bytes, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  assert(Buffer.isBuffer(bytes) && bytes.length <= 4096);
  const value = JSON.parse(bytes.toString('utf8'));
  assert.equal(bytes.toString('utf8'), canonical(value), 'original canonical VV bytes required');
  assert.deepEqual(value, {
    commit: revision,
    gates: Array.from({ length: 15 }, (_, index) => index + 1),
    schema: 'prismpm/vv-evidence/1', status: 'passed',
  }, 'complete exact-commit VV evidence required');
  return value;
}

// The part list lives only in vv-assemble.mjs (a live-binding cycle: nothing
// here reads it while modules evaluate).
export { vvParts };

export function validateVvPart(bytes, revision, part) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  assert(vvParts.includes(part), 'closed V&V part');
  assert(Buffer.isBuffer(bytes) && bytes.length <= 4096);
  const value = JSON.parse(bytes.toString('utf8'));
  assert.equal(bytes.toString('utf8'), canonical(value), 'original canonical V&V part bytes required');
  assert.deepEqual(value, {commit: revision, part, schema: 'prismpm/vv-part/1', status: 'passed'},
    'complete exact-commit V&V part required');
  return value;
}

// The evidence for all 15 gates exists only when every listed part passed.
export function assembleVvEvidence(records, revision) {
  assert(records instanceof Map);
  assert.deepEqual([...records.keys()].sort(), [...vvParts].sort(), 'exactly the part records required');
  for (const part of vvParts) validateVvPart(records.get(part), revision, part);
  const evidence = Buffer.from(canonical({
    commit: revision,
    gates: Array.from({ length: 15 }, (_, index) => index + 1),
    schema: 'prismpm/vv-evidence/1', status: 'passed',
  }));
  validateVvEvidence(evidence, revision);
  return evidence;
}

export function gateInvocation(source, output, part) {
  assert(vvParts.includes(part), 'closed V&V part');
  return {
    command: '/usr/local/bin/node',
    args: [join(source, 'scripts/ci-observe.mjs'), 'run', join(output, 'diagnostics'), '--', '/usr/local/bin/just', 'vv-part', part],
    cwd: source,
  };
}

export function executionEnvironment(work, image, socket) {
  assert.match(image, /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/);
  assert.match(socket, /^unix:\/\/\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/);
  assert(socket.slice(7).split('/').every(part => part !== '.' && part !== '..'), 'confined Docker socket path');
  assert(isAbsolute(work) && resolve(work) === work);
  return {
    PATH: '/usr/local/elan/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin',
    RUSTUP_HOME: '/usr/local/rustup',
    ELAN_HOME: '/usr/local/elan', ELAN_TOOLCHAIN: 'leanprover/lean4:v4.32.1',
    CARGO_HOME: join(work, 'cargo'), CARGO_TARGET_DIR: join(work, 'inputs/source/target/vv-driver'),
    CARGO_NET_OFFLINE: 'true', CARGO_BUILD_JOBS: '2',
    PRISMPM_SDK_INVENTORY: join(SHARED, 'inventory.json'), PRISMPM_TEST_SDK_IMAGE: image,
    PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
    DOCKER_HOST: socket, DOCKER_CONFIG: join(work, 'docker'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    // Firefox under the read-only installed container hangs at launch without a
    // writable HOME (rehearsal 42219829101). This fresh owned path is never the caller's.
    HOME: join(work, 'home'), XDG_CACHE_HOME: join(work, 'cache'), TMPDIR: join(work, 'tmp'),
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', SOURCE_DATE_EPOCH: '0',
  };
}

export function verifyRetainedPart(output, revision, part, record) {
  const path = 'part/vv-part.json';
  assert(lstatSync(join(output, 'part')).isDirectory(), 'retained part directory cannot be aliased');
  const bytes = readOriginal(join(output, path), 4096);
  validateVvPart(bytes, revision, part);
  assert.deepEqual(record, { part, path, byte_length: bytes.length, sha256: hash(bytes) }, 'retained V&V part bytes changed');
}

// The CLI supplies the fixed executor below. An injected executor is solely a
// unit-test seam; it is not accepted through arguments, configuration or env.
// Only the source part runs the bootstrap gate, so only it retains bootstrap outputs.
export async function retainPart(source, output, revision, part, execute) {
  assert(vvParts.includes(part), 'closed V&V part');
  const evidencePath = join(source, `target/vv-part-${part}.json`);
  const bootstrapPaths = part === 'source' ? bootstrapNames.map(name => join(source, 'target', name)) : [];
  const directory = join(output, 'part');
  mkdirSync(directory, { mode: 0o700 });
  for (const path of [evidencePath, ...bootstrapPaths]) {
    const stale = lstatSync(path, { throwIfNoEntry: false });
    if (stale) {
      assert(stale.isFile() && stale.nlink === 1, 'refusing aliased or non-file stale evidence');
      unlinkSync(path);
    }
  }
  assert.equal(await execute(directory), 0, `V&V part ${part} failed`);
  const bytes = readOriginal(evidencePath, 4096);
  validateVvPart(bytes, revision, part);
  const path = 'part/vv-part.json';
  writeFileSync(join(output, path), bytes, { flag: 'wx', mode: 0o444 });
  const record = { part, path, byte_length: bytes.length, sha256: hash(bytes) };
  if (part === 'source') {
    const bootstrap = captureBootstrap(source, output, 1);
    const bootstrapBytes = Buffer.from(canonical({schema: 'prismpm/bootstrap-retention/1', source_revision: revision, runs: [bootstrap]}));
    validateBootstrapRetention(bootstrapBytes, new Map(bootstrap.files.map(file =>
      [file.path, readOriginal(join(output, file.path))])), revision);
    writeFileSync(join(output, 'bootstrap.json'), bootstrapBytes, {flag: 'wx', mode: 0o444});
  }
  verifyRetainedPart(output, revision, part, record);
  return record;
}

export function executeGate(invocation, environment) {
  return new Promise((accept, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd, env: environment, stdio: 'inherit',
    });
    let cancelled;
    const handlers = ['SIGHUP', 'SIGINT', 'SIGTERM'].map(signal => [signal, () => {
      cancelled = signal;
      // ci-observe owns its detached gate/monitor and handles INT/TERM. Let it
      // perform cooperative cleanup on HUP instead of killing its supervisor.
      child.kill(signal === 'SIGHUP' ? 'SIGTERM' : signal);
    }]);
    for (const [signal, handler] of handlers) process.on(signal, handler);
    const clean = () => { for (const [signal, handler] of handlers) process.removeListener(signal, handler); };
    child.once('error', error => { clean(); reject(error); });
    child.once('close', (code, signal) => {
      clean();
      if (cancelled) reject(Error(`VV execution cancelled by ${cancelled}`));
      else if (signal) reject(Error(`VV child terminated by ${signal}`));
      else accept(code);
    });
  });
}

function cacheEntries(root, writable = false) {
  assert(lstatSync(root).isDirectory() && realpathSync(root) === root, 'non-aliased cache required');
  let bytes = 0, entries = 0;
  const walk = path => {
    assert(++entries <= 1_000_000, 'cache entry bound exceeded');
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const target = resolve(dirname(path), readlinkSync(path));
      assert(target.startsWith(root + sep) && realpathSync(path).startsWith(root + sep), 'cache alias escaped');
    } else if (stat.isDirectory()) {
      if (writable) chmodSync(path, stat.mode | 0o700);
      for (const name of readdirSync(path)) walk(join(path, name));
    } else {
      assert(stat.isFile(), 'cache special files prohibited');
      bytes += stat.size;
      assert(Number.isSafeInteger(bytes), 'cache byte count overflow');
      if (writable) chmodSync(path, stat.mode | 0o600);
    }
  };
  walk(root); return bytes;
}

export async function runInstalled(image, revision, part, destination, socket) {
  assert(vvParts.includes(part), 'closed V&V part');
  assert.equal(process.platform, 'linux');
  assert.equal(process.getuid(), 1000, 'installed SDK gate must run unprivileged');
  assert.match(revision, /^[a-f0-9]{40}$/);
  destination = resolve(destination);
  assert.equal(realpathSync(dirname(destination)), dirname(destination), 'output parent cannot be aliased');
  assert(!lstatSync(destination, { throwIfNoEntry: false }), 'fresh output destination required');
  const environment = executionEnvironment(destination, image, socket);
  assert(lstatSync(socket.slice(7)).isSocket(), 'isolated Docker socket required');
  const policyBytes = regular(join(SHARED, 'vv-input-policy.json'), 16384);
  const policy = JSON.parse(policyBytes);
  assert.equal(policy.source_revision, revision, 'installed source differs from independent expected revision');
  const manifestBytes = regular(join(SHARED, 'vv-inputs/manifest.json'), 32 * 1024 * 1024);
  const inventory = regular(join(SHARED, 'inventory.json'), 64 * 1024 * 1024);
  const cli = regular('/usr/local/bin/prismpm', 256 * 1024 * 1024);
  // This installed CLI enforces its actual immutable inventory. Success alone
  // is not proof of the independently selected OCI image or physical CPU.
  const check = spawnSync('/usr/local/bin/prismpm', ['--json', 'completion', 'bash'], {
    cwd: SHARED, env: environment, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(check.status, 0, 'installed SDK inventory preflight failed');
  assert.equal(JSON.parse(check.stdout).schema, 'prismpm/completion-result/1');
  const cache = '/opt/prismpm/cargo-home', cacheSize = cacheEntries(cache);
  const space = statfsSync(dirname(destination));
  assert(space.bavail * space.bsize >= cacheSize + 64 * 1024 * 1024, 'insufficient space for isolated cache');
  mkdirSync(destination, { mode: 0o700 });
  // Failed runs deliberately retain only this newly created diagnostic tree.
  // Existing caller directories and installed inputs are never overwritten.
  const manifest = materializeClosure(join(SHARED, 'vv-inputs'), policy, join(destination, 'inputs'));
  assert.equal(manifestBytes.toString('utf8'), `${canonical(manifest)}\n`, 'captured and materialized input manifests differ');
  const source = join(destination, 'inputs/source');
  for (const name of ['home', 'docker', 'cache', 'tmp', 'evidence']) mkdirSync(join(destination, name), { mode: 0o700 });
  cpSync(cache, join(destination, 'cargo'), { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  cacheEntries(join(destination, 'cargo'), true);
  // Cargo deny 0.20.2 resolves this exact RustSec URL directory below CARGO_HOME.
  const advisoryParent = join(destination, 'cargo/advisory-dbs');
  assert(!lstatSync(advisoryParent, { throwIfNoEntry: false }), 'image Cargo cache cannot smuggle an advisory database');
  mkdirSync(advisoryParent, { mode: 0o700 });
  renameSync(join(destination, 'inputs/advisory'), join(advisoryParent, 'advisory-db-3157b0e258782691'));
  const bootstrap = join(source, '.prism/cache/bootstrap');
  mkdirSync(bootstrap, { recursive: true, mode: 0o700 });
  copyFileSync(join(destination, 'inputs/bootstrap.tar.gz'), join(bootstrap, 'prismpm-0.2.0-x86_64-unknown-linux-gnu.tar.gz'), constants.COPYFILE_EXCL);
  const output = join(destination, 'evidence');
  const run = await retainPart(source, output, revision, part, async directory =>
    executeGate(gateInvocation(source, directory, part), environment));
  assert.deepEqual(regular(join(SHARED, 'inventory.json'), 64 * 1024 * 1024), inventory, 'installed inventory changed');
  assert.deepEqual(regular('/usr/local/bin/prismpm', 256 * 1024 * 1024), cli, 'installed CLI changed');
  assert.deepEqual(regular(join(SHARED, 'vv-input-policy.json'), 16384), policyBytes, 'installed input policy changed');
  assert.deepEqual(regular(join(SHARED, 'vv-inputs/manifest.json'), 32 * 1024 * 1024), manifestBytes, 'installed input manifest changed');
  assert.deepEqual(verifyClosure(join(SHARED, 'vv-inputs'), policy), manifest, 'installed verification input bytes changed');
  verifyRetainedPart(output, revision, part, run);
  const record = {
    schema: 'prismpm/sdk-vv-execution/2', scope: 'one-vv-part-execution-only', part,
    source_revision: revision, image_reference: image, process_architecture: process.arch,
    inventory_sha256: hash(inventory), cli_sha256: hash(cli),
    input_policy_sha256: hash(policyBytes), input_manifest_sha256: hash(manifestBytes),
    advisory_revision: manifest.policy.advisory_revision, run,
    unclaimed: ['native-host', 'network-isolation', 'oci-image-identity', 'sdk-release', 'product-readiness'],
  };
  writeFileSync(join(output, 'execution.json'), canonical(record), { flag: 'wx', mode: 0o444 });
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, image, revision, part, destination, ...extra] = process.argv.slice(2);
  assert(operation === 'run' && image && revision && part && destination && extra.length === 0,
    'usage: sdk-vv-run.mjs run IMAGE@sha256:DIGEST SOURCE_COMMIT PART FRESH_DESTINATION');
  console.log(canonical(await runInstalled(image, revision, part, destination, process.env.DOCKER_HOST ?? 'unix:///var/run/docker.sock')));
}
