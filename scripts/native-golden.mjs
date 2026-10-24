// Source-development baseline collection for PRs, main, tags and dispatch. Never SDK or release acceptance.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, constants, closeSync, copyFileSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readdirSync, readlinkSync, readSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireImageMetadata, execute, inspectLoadedImage } from './sdk-vv-check.mjs';
import { verifyTap } from './browser-api-sdk-check.mjs';

export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const RECORDS = ['golden-manifest.json', 'verified/lexlean-attestation.json', 'verified/manifest.json'];
const CARGO_STATE = '/tmp/prismpm-golden-state';
const CARGO_HOME = `${CARGO_STATE}/cargo`;
const CARGO_MANIFESTS = Object.freeze(['Cargo.toml', 'vendor/lexlean/Cargo.toml',
  'vendor/lean4-prod/rust/Cargo.toml', 'stdlib/generated/package/Cargo.toml']);
const architectures = Object.freeze({
  amd64: Object.freeze({node: 'x64', runner: 'X64', lock: 'sdk/golden-development-amd64.lock.json'}),
  arm64: Object.freeze({node: 'arm64', runner: 'ARM64', lock: 'sdk/golden-development.lock.json'}),
});
function platformProfile(architecture) {
  assert(Object.hasOwn(architectures, architecture), 'unsupported native source-review architecture');
  return `tests/golden/native/linux-${architecture}-ubuntu-24.04`;
}

// Explicit paths are a unit-test seam only. The CLI admits no operands or
// environment-selected source/destination for this image-owned cache copy.
export function seedCargoCache(source = '/opt/prismpm/cargo-home', destination = CARGO_HOME) {
  assert.equal(realpathSync(source), source, 'image cache cannot be aliased');
  assert.equal(realpathSync(dirname(destination)), dirname(destination), 'cache parent cannot be aliased');
  assert.equal(lstatSync(destination, {throwIfNoEntry: false}), undefined, 'private Cargo cache must be new');
  const rows = []; let bytes = 0;
  const walk = (path, relative, depth) => {
    assert(depth <= 32 && rows.length < 250000, 'cache tree bound exceeded');
    const stat = lstatSync(path);
    assert((stat.isFile() || stat.isDirectory()) && (stat.mode & 0o222) === 0,
      'image cache must contain only immutable regular files and directories');
    if (stat.isFile()) {
      assert(stat.size <= 256 * 1024 ** 2, 'cache file bound exceeded');
      bytes += stat.size; assert(bytes <= 2 * 1024 ** 3, 'cache byte bound exceeded');
    }
    rows.push({relative, directory: stat.isDirectory(), bytes: stat.size, executable: (stat.mode & 0o100) !== 0});
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name), relative ? `${relative}/${name}` : name, depth + 1);
  };
  walk(source, '', 0);
  assert(rows[0].directory && bytes > 0, 'nonempty image cache required');
  const space = statfsSync(dirname(destination));
  // Include conservative per-entry allocation/metadata overhead in addition
  // to the same 12 GiB reserve required by the outer source-review runner.
  if (destination === '/tmp/prismpm-golden-fetch/cache') {
    assert(space.bavail * space.bsize >= bytes + rows.length * 8192 + 512 * 1024 ** 2,
      'bounded acquisition tmpfs needs cache and download headroom');
  } else validateImageSpace(space.bavail * space.bsize, bytes + rows.length * 8192);
  for (const row of rows) {
    const target = join(destination, row.relative);
    if (row.directory) mkdirSync(target, {mode: 0o700});
    else {
      copyFileSync(join(source, row.relative), target, constants.COPYFILE_EXCL);
      assert.equal(lstatSync(target).size, row.bytes, 'cache copy size differs');
      chmodSync(target, row.executable ? 0o700 : 0o600);
    }
  }
  return {bytes, entries: rows.length};
}

function regular(path, limit = 128 * 1024 ** 2) {
  assert.equal(realpathSync(dirname(path)), dirname(path), 'input ancestor is aliased');
  assert(lstatSync(path).isFile(), 'regular non-aliased input required');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint: true});
    assert(before.isFile() && before.size <= BigInt(limit), 'bounded regular input required');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      assert(count > 0, 'input shortened'); offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0, 'input grew');
    for (const after of [fstatSync(fd, {bigint: true}), lstatSync(path, {bigint: true})]) {
      for (const key of ['dev', 'ino', 'size', 'mode', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { closeSync(fd); }
}

function files(root, selected = () => true) {
  assert.equal(realpathSync(root), resolve(root), 'input directory ancestor is aliased');
  assert(lstatSync(root).isDirectory(), 'non-aliased input directory required');
  const result = []; let total = 0, count = 0;
  const walk = (directory, relative, depth) => {
    assert(depth <= 32, 'tree depth exceeded');
    for (const name of readdirSync(directory).sort()) {
      assert(++count <= 20000 && !/[\x00-\x1f\\]/.test(name), 'bounded confined tree required');
      const path = join(directory, name), rel = relative ? `${relative}/${name}` : name, stat = lstatSync(path);
      assert(stat.isDirectory() || stat.isFile(), 'aliased or special tree member');
      if (stat.isDirectory()) walk(path, rel, depth + 1);
      else if (selected(rel)) {
        total += stat.size; assert(total <= 1024 ** 3, 'aggregate evidence bound exceeded');
        result.push({path: rel, bytes: regular(path)});
      }
    }
  };
  walk(root, '', 0); return result;
}

export function readEnvironmentLock(bytes, architecture = 'arm64') {
  platformProfile(architecture);
  assert(Buffer.isBuffer(bytes) && bytes.length <= 8192);
  const value = JSON.parse(bytes);
  assert.equal(bytes.toString(), canonical(value) + '\n');
  assert.deepEqual(Object.keys(value).sort(), ['architecture', 'child_digest', 'config_digest', 'reference', 'schema', 'scope', 'source_revision']);
  assert.equal(value.schema, 'prismpm/golden-development-environment/1');
  assert.equal(value.scope, 'source-golden-review-only'); assert.equal(value.architecture, architecture);
  assert.match(value.reference, /^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/);
  for (const key of ['child_digest', 'config_digest']) assert.match(value[key], /^sha256:[0-9a-f]{64}$/);
  assert.match(value.source_revision, /^[0-9a-f]{40}$/);
  return value;
}

export function validateSourceBaseline(source) {
  regular(join(source, 'tests/golden/stdlib/golden-manifest.json'));
  const current = files(join(source, 'stdlib/src'), path => path.endsWith('.lex.tex'));
  const reviewed = files(join(source, 'tests/golden/stdlib/source'));
  assert(current.length > 0, 'stdlib source is absent');
  assert.deepEqual(current.map(row => row.path), reviewed.map(row => row.path), 'committed shared golden source path set is stale');
  for (const [index, row] of current.entries()) assert.equal(hash(row.bytes), hash(reviewed[index].bytes), `committed shared golden source bytes are stale: ${row.path}`);
  validateApplicationGenerator(source);
}

// Only an early source refusal. Never rewrite a baseline or normalize native
// records here. The reviewed active Rust owner fixes the exact concatenation;
// literals in comments/disabled code cannot authorize a different recipe.
export function validateApplicationGenerator(source) {
  const owner = regular(join(source, 'crates/prismpm/src/controller/mod.rs'), 1024 ** 2);
  assert.equal(hash(owner), 'e267731f7ca80ad3cb1fa67b11c2335e7b4015ae3d2f8122e6999e17ccc29c66',
    'application generator recipe owner requires independent source review');
  const parts = ['application_build.rs', 'lean_project.rs', 'holo/archive.rs']
    .map(path => regular(join(source, 'crates/prismpm/src', path), 16 * 1024 ** 2));
  const alias = join(source, 'crates/prismpm/src/embedded/lean4-prod-rust.MANIFEST.sha256');
  const before = lstatSync(alias, {bigint: true});
  assert(before.isSymbolicLink(), 'exact embedded compiler manifest alias required');
  assert.equal(readlinkSync(alias), '../../../../vendor/lean4-prod/rust/MANIFEST.sha256');
  assert.equal(realpathSync(dirname(alias)), dirname(alias), 'compiler manifest ancestor is aliased');
  const target = join(source, 'vendor/lean4-prod/rust/MANIFEST.sha256');
  assert.equal(realpathSync(alias), target, 'compiler manifest alias escaped captured source');
  parts.push(regular(target, 1024 ** 2), Buffer.from('prismpm/build-artifacts/2'));
  const after = lstatSync(alias, {bigint: true});
  for (const name of ['dev', 'ino', 'uid', 'gid', 'mode', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(after[name], before[name]);
  assert.equal(readlinkSync(alias), '../../../../vendor/lean4-prod/rust/MANIFEST.sha256');
  const baseline = JSON.parse(regular(join(source, 'tests/golden/stdlib/build/manifest.json'), 8 * 1024 ** 2));
  assert.equal(baseline.inputs?.application_generator_sha256, hash(Buffer.concat(parts)),
    'committed shared application generator source hash is stale');
}

export function collectProfile(source, architecture = 'arm64') {
  const profile = platformProfile(architecture);
  const rows = files(join(source, profile));
  assert.deepEqual(rows.map(row => row.path), RECORDS, 'exact three raw native records required');
  assert.deepEqual(readdirSync(join(source, profile)).sort(), ['golden-manifest.json', 'verified'], 'extra native record directory');
  assert.deepEqual(readdirSync(join(source, profile, 'verified')).sort(), ['lexlean-attestation.json', 'manifest.json'], 'extra native verification directory');
  return rows;
}

export function validateImageSpace(available, compressedBytes) {
  assert(Number.isSafeInteger(available) && available >= 0 && Number.isSafeInteger(compressedBytes) && compressedBytes >= 0);
  assert(available >= 12 * 1024 ** 3 + compressedBytes, '12 GiB reserve plus independently measured image payload required');
}

function success(result, label) {
  assert.equal(result.signal, null, `${label} interrupted`);
  assert.equal(result.status, 0, `${label} failed: ${result.stderr.toString().slice(-4096)}`);
  return result.stdout;
}

// The events native-golden.yml can start: pull_request, push to main or a tag, and dispatch.
export const NATIVE_REVIEW_EVENTS = Object.freeze(['pull_request', 'push', 'workflow_dispatch']);

// Transport/context injection is a unit seam, never available from CLI or env.
export async function runReview({source, revision, destination}, transport = execute,
  context = {architecture: process.arch, uid: process.getuid(), gid: process.getgid(), environment: process.env}) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  const environment = context.environment;
  const selected = Object.entries(architectures).find(([, value]) => value.node === context.architecture);
  assert(selected, 'unsupported native source-review architecture');
  const [architecture, platformPolicy] = selected, profile = platformProfile(architecture);
  assert.equal(environment.GITHUB_ACTIONS, 'true');
  assert.equal(environment.RUNNER_ENVIRONMENT, 'github-hosted'); assert.equal(environment.RUNNER_OS, 'Linux');
  assert.equal(environment.RUNNER_ARCH, platformPolicy.runner);
  assert(NATIVE_REVIEW_EVENTS.includes(environment.GITHUB_EVENT_NAME), 'native source review runs only for the workflow events');
  for (const name of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) assert.match(environment[name], /^[1-9][0-9]*$/);
  source = realpathSync(source); destination = resolve(destination);
  assert(!/[\x00-\x1f,]/.test(source), 'source path cannot alter Docker mount options');
  assert(destination !== source && !destination.startsWith(source + '/'), 'evidence must be outside the source');
  assert.equal(realpathSync(dirname(destination)), dirname(destination));
  mkdirSync(destination, {mode: 0o700});
  const runtime = mkdtempSync(join(tmpdir(), 'prismpm-native-golden-'));
  const commandEnvironment = {PATH: environment.PATH, HOME: runtime, DOCKER_CONFIG: runtime,
    DOCKER_HOST: 'unix:///var/run/docker.sock', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0'};
  const {uid, gid} = context;
  assert(Number.isSafeInteger(uid) && uid > 0 && Number.isSafeInteger(gid) && gid >= 0, 'unprivileged host UID required');
  const name = `prismpm-native-golden-${randomBytes(12).toString('hex')}`, owner = 'org.uor.prismpm.golden-review';
  const acquisition = `${name}-dependencies`, supplement = join(runtime, 'dependencies');
  mkdirSync(supplement, {mode: 0o700});
  const cacheState = join(runtime, 'cargo-state'); mkdirSync(cacheState, {mode: 0o700});
  let sequence = 0, created = false, offlineAttempted = false, offlineId,
    acquisitionAttempted = false, acquisitionCreated = false, acquisitionId, imageId, failure, result, interrupted;
  const cleanupErrors = [];
  const handlers = ['SIGHUP', 'SIGINT', 'SIGTERM'].map(signal => [signal, () => { interrupted ??= Error(`interrupted by ${signal}`); }]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const call = async (command, args, options = {}) => {
    const stem = String(++sequence).padStart(3, '0'); let value;
    try { value = await transport(command, args, {environment: commandEnvironment, timeout: 120000, limit: 16 * 1024 ** 2, ...options}); }
    catch (error) { value = error.result; throw error; }
    finally {
      writeFileSync(join(destination, `${stem}.command.json`), canonical({command, args, status: value?.status ?? null, signal: value?.signal ?? null}), {flag: 'wx'});
      if (value) for (const stream of ['stdout', 'stderr']) writeFileSync(join(destination, `${stem}.${stream}`), value[stream], {flag: 'wx'});
    }
    return value;
  };
  const docker = args => call('docker', args);
  const git = async args => success(await call('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.quotePath=false', '-C', source, ...args]), 'source Git check').toString();
  const run = async (args, options) => success(await call('docker', args, options), 'development container command');
  const checkRevision = async () => assert.equal((await git(['rev-parse', 'HEAD'])).trim(), revision, 'source revision changed');
  const requireSpace = (compressedBytes = 0) => { const space = statfsSync(destination); validateImageSpace(space.bavail * space.bsize, compressedBytes); };
  const inputPaths = [...CARGO_MANIFESTS.flatMap(path => [path, path.replace(/Cargo\.toml$/, 'Cargo.lock')]), '.cargo/config.toml'];
  let inputIdentity;
  const checkInputs = () => {
    const observed = inputPaths.map(path => ({path, sha256: hash(regular(join(source, path)))}));
    if (inputIdentity) assert.deepEqual(observed, inputIdentity, 'locked Cargo input source changed');
    else inputIdentity = observed;
    // No project-controlled registry/proxy/credential redirection during acquisition.
    assert.equal(regular(join(source, '.cargo/config.toml')).toString(),
      '[alias]\nxtask = "run --package xtask --"\nvv = "run --package xtask -- validate"\n\n');
    for (const manifest of CARGO_MANIFESTS) {
      for (let directory = dirname(manifest); ; directory = dirname(directory)) {
        for (const config of ['.cargo/config', '.cargo/config.toml']) {
          if (directory === '.' && config === '.cargo/config.toml') continue;
          assert.equal(lstatSync(join(source, directory, config), {throwIfNoEntry: false}), undefined, 'unexpected Cargo configuration refused');
        }
        if (directory === '.') break;
      }
      const lock = regular(join(source, manifest.replace(/Cargo\.toml$/, 'Cargo.lock'))).toString();
      for (const match of lock.matchAll(/^source = "([^"]+)"$/gm))
        assert.equal(match[1], 'registry+https://github.com/rust-lang/crates.io-index', 'only official locked registry inputs admitted');
    }
  };
  const cacheInventory = () => {
    const root = join(cacheState, 'cargo'), rows = []; let bytes = 0, entries = 0;
    assert(lstatSync(root, {throwIfNoEntry: false})?.isDirectory(), 'unseeded cache');
    const walk = (path, relative, depth) => {
      assert(depth <= 32 && ++entries <= 250000, 'Cargo input cache entry bound exceeded');
      assert.equal(realpathSync(path), path, 'Cargo input cache alias refused');
      const stat = lstatSync(path);
      assert.equal(stat.uid, process.getuid());
      assert.equal(stat.mode & 0o7022, 0, 'private Cargo input cache permissions required');
      assert(stat.isDirectory() || stat.isFile(), 'regular Cargo input cache required');
      if (stat.isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name), relative ? `${relative}/${name}` : name, depth + 1);
      else {
        assert.equal(stat.nlink, 1, 'single-link Cargo input cache required');
        bytes += stat.size; assert(bytes <= 2 * 1024 ** 3, 'Cargo input cache byte bound exceeded');
        assert(!['config', 'config.toml', 'credentials', 'credentials.toml'].includes(relative), 'Cargo home redirection or credentials refused');
        if (/^registry\/index\/[^/]+\/config.json$/.test(relative))
          assert.deepEqual(JSON.parse(regular(path)), {dl: 'https://static.crates.io/crates', api: 'https://crates.io'}, 'official crate transport configuration required');
        // Cargo mutates only its own bookkeeping during offline use; these
        // records are not registry/compiler input authority.
        if (!['.global-cache', '.global-cache-journal', '.global-cache-wal', '.global-cache-shm',
          '.package-cache', '.package-cache-mutate'].includes(relative))
          rows.push({path: relative, byte_length: stat.size, sha256: hash(regular(path, 256 * 1024 ** 2))});
      }
    };
    walk(root, '', 0); assert(rows.length > 0, 'nonempty Cargo input cache required');
    return rows;
  };
  const retireActor = async (actor, cid) => {
    assert.match(cid, /^[a-f0-9]{64}$/, 'cleanup requires authenticated actor CID');
    const rows = JSON.parse(await run(['inspect', cid]));
    assert(Array.isArray(rows) && rows.length === 1);
    assert.equal(rows[0].Id, cid); assert.equal(rows[0].Name, '/' + actor);
    assert.equal(rows[0].Image, imageId); assert.equal(rows[0].Config.Labels[owner], actor);
    await run(['rm', '--force', '--volumes', cid]);
    for (const value of [cid, actor]) {
      const absent = await docker(['inspect', value]);
      assert.equal(absent.status, 1); assert.equal(absent.signal, null);
      assert.match(absent.stderr.toString(), /No such (?:object|container)/);
    }
  };
  try {
    // Include the bounded supplement and conservative per-entry filesystem
    // overhead in addition to the unchanged verifier reserve.
    requireSpace(256 * 1024 ** 2); await checkRevision(); assert.equal(await git(['status', '--porcelain=v1', '--untracked-files=all']), '', 'clean committed source required');
    validateSourceBaseline(source);
    for (const kind of ['build', 'verified']) assert.equal(lstatSync(join(source, '.prism', kind), {throwIfNoEntry: false}), undefined, 'fresh source outputs required');
    const lock = readEnvironmentLock(regular(join(source, platformPolicy.lock), 8192), architecture);
    const chain = await acquireImageMetadata(docker, lock.reference, architecture);
    assert.equal(chain.child_digest, lock.child_digest); assert.equal(chain.config_digest, lock.config_digest);
    // Exact compressed layers are measured from the hashed immutable manifest;
    // this is not an estimate of expanded layers or subsequent compiler use.
    requireSpace(chain.compressed_bytes);
    writeFileSync(join(destination, 'environment.json'), canonical({lock, chain}), {flag: 'wx'});
    await run(['pull', '--platform', `linux/${architecture}`, lock.reference], {timeout: 1200000}); requireSpace();
    const identity = await inspectLoadedImage(docker, chain, architecture, lock.source_revision);
    imageId = identity.id;
    checkInputs();
    const bridge = JSON.parse(await run(['network', 'inspect', 'bridge']));
    assert(Array.isArray(bridge) && bridge.length === 1 && bridge[0].Name === 'bridge'
      && bridge[0].Driver === 'bridge' && bridge[0].Scope === 'local' && bridge[0].Internal === false);
    assert.match(bridge[0].Id, /^[a-f0-9]{64}$/);
    const isolatedNetwork = JSON.parse(await run(['network', 'inspect', 'none']));
    assert(Array.isArray(isolatedNetwork) && isolatedNetwork.length === 1 && isolatedNetwork[0].Name === 'none'
      && isolatedNetwork[0].Driver === 'null' && isolatedNetwork[0].Scope === 'local');
    assert.match(isolatedNetwork[0].Id, /^[a-f0-9]{64}$/);
    const assertActor = async (actor, cid, readonlySource) => {
      const network = readonlySource ? 'bridge' : 'none';
      const rows = JSON.parse(await run(['inspect', cid]));
      assert(Array.isArray(rows) && rows.length === 1);
      const row = rows[0];
      assert.equal(row.Id, cid); assert.equal(row.Name, '/' + actor);
      assert.equal(row.Image, identity.id); assert.equal(row.Config.Labels[owner], actor);
      assert.equal(row.State.Running, true);
      assert.equal(row.Config.User, `${uid}:${gid}`);
      assert.deepEqual(Object.keys(row.NetworkSettings.Networks).sort(), [network]);
      assert.equal(row.HostConfig.NetworkMode, network);
      assert.deepEqual(row.HostConfig.CapDrop, ['ALL']);
      assert(row.HostConfig.SecurityOpt.includes('no-new-privileges'));
      assert.equal(row.HostConfig.Privileged, false); assert.equal(row.HostConfig.PidsLimit, readonlySource ? 256 : 4096);
      assert.equal(row.HostConfig.Init, true);
      assert.equal(row.HostConfig.ReadonlyRootfs, readonlySource);
      assert.equal(row.HostConfig.Binds, null); assert.deepEqual(row.HostConfig.Devices ?? [], []);
      assert.deepEqual(row.Config.Entrypoint, ['/bin/bash']);
      assert.deepEqual(row.Config.Cmd, ['-ec', readonlySource
        ? 'mkdir -p /tmp/prismpm-golden-fetch/home; exec sleep infinity'
        : 'mkdir -p /tmp/prismpm-golden-home; exec sleep infinity']);
      assert.equal(row.Mounts.length, readonlySource ? 2 : 3);
      if (readonlySource) {
        assert.equal(row.Id, acquisitionId); assert.equal(row.NetworkSettings.Networks.bridge.NetworkID, bridge[0].Id);
        assert.deepEqual(row.HostConfig.Tmpfs, {'/tmp/prismpm-golden-fetch':
          `rw,noexec,nosuid,nodev,size=3221225472,mode=0700,uid=${uid},gid=${gid}`});
        assert.equal(row.HostConfig.Memory, 2 * 1024 ** 3);
        assert.equal(row.HostConfig.MemorySwap, row.HostConfig.Memory);
        assert.equal(row.HostConfig.NanoCpus, 2 * 10 ** 9);
        const environment = Object.fromEntries(row.Config.Env.map(value => {
          const offset = value.indexOf('='); assert(offset > 0); return [value.slice(0, offset), value.slice(offset + 1)];
        }));
        assert.equal(Object.keys(environment).length, row.Config.Env.length, 'duplicate acquisition environment refused');
        const allowed = new Set(['PATH', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH', 'CARGO_HOME', 'RUSTUP_HOME',
          'ELAN_HOME', 'ELAN_TOOLCHAIN', 'PRISMPM_SDK_INVENTORY', 'HOME', 'TMPDIR', 'CARGO_NET_OFFLINE', 'CARGO_HTTP_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']);
        assert.equal(environment.CARGO_HOME, '/tmp/prismpm-golden-fetch/cache');
        assert.equal(environment.HOME, '/tmp/prismpm-golden-fetch/home');
        assert.equal(environment.TMPDIR, '/tmp/prismpm-golden-fetch');
        assert.equal(environment.CARGO_NET_OFFLINE, 'false');
        for (const [key, value] of Object.entries(environment)) {
          assert(allowed.has(key), 'unregistered acquisition environment refused');
          assert(!/TOKEN|SECRET|PASSWORD|CREDENTIAL|CARGO_REGISTR|GIT_|SSH_/i.test(key), 'acquisition credential or registry environment refused');
          if (/PROXY/i.test(key)) assert.equal(value, '', 'acquisition proxy refused');
        }
      } else assert.equal(row.NetworkSettings.Networks.none.NetworkID, isolatedNetwork[0].Id);
      const sourceMount = row.Mounts.filter(mount => mount.Destination === '/workspace');
      assert.equal(sourceMount.length, 1); assert.equal(sourceMount[0].Source, source);
      assert.equal(sourceMount[0].RW, !readonlySource);
      const cacheMount = row.Mounts.filter(mount => mount.Destination === CARGO_STATE);
      assert.equal(cacheMount.length, readonlySource ? 0 : 1);
      if (!readonlySource) {assert.equal(cacheMount[0].Source, cacheState); assert.equal(cacheMount[0].RW, true);}
      const handoff = row.Mounts.filter(mount => mount.Destination === '/tmp/prismpm-dependency-supplement');
      assert.equal(handoff.length, 1); assert.equal(handoff[0].Source, supplement);
      assert.equal(handoff[0].RW, readonlySource);
      return row;
    };
    if (interrupted) throw interrupted;
    requireSpace(256 * 1024 ** 2);
    // Acquisition has network access but cannot compile or alter source. Its
    // data-only handoff is revalidated after this owner has been destroyed.
    acquisitionAttempted = true;
    acquisitionId = (await run(['create', '--name', acquisition, '--label', `${owner}=${acquisition}`, '--pull=never', '--platform', `linux/${architecture}`,
      '--network', 'bridge', '--read-only', '--user', `${uid}:${gid}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '256', '--cpus', '2', '--memory', '2g', '--memory-swap', '2g', '--init',
      '--tmpfs', `/tmp/prismpm-golden-fetch:rw,noexec,nosuid,nodev,size=3221225472,mode=0700,uid=${uid},gid=${gid}`,
      '--mount', `type=bind,source=${source},target=/workspace,readonly`, '--workdir', '/workspace',
      '--mount', `type=bind,source=${supplement},target=/tmp/prismpm-dependency-supplement`,
      '--env', 'HOME=/tmp/prismpm-golden-fetch/home', '--env', 'CARGO_HOME=/tmp/prismpm-golden-fetch/cache',
      '--env', 'TMPDIR=/tmp/prismpm-golden-fetch',
      '--env', 'CARGO_NET_OFFLINE=false',
      '--env', 'CARGO_HTTP_PROXY=', '--env', 'HTTP_PROXY=', '--env', 'HTTPS_PROXY=', '--env', 'ALL_PROXY=',
      '--entrypoint', '/bin/bash', lock.reference,
      '-ec', 'mkdir -p /tmp/prismpm-golden-fetch/home; exec sleep infinity'])).toString().trim();
    assert.match(acquisitionId, /^[a-f0-9]{64}$/); acquisitionCreated = true;
    await run(['start', acquisition]);
    await assertActor(acquisition, acquisitionId, true); checkInputs();
    await run(['exec', acquisition, 'node', '/workspace/scripts/native-golden.mjs', 'seed-download-cache']);
    const dependencyTests = JSON.parse(await run(['exec', acquisition, '/usr/bin/python3', '-I', '-B', '/workspace/scripts/native-golden-dependencies.test.py']));
    assert.deepEqual(dependencyTests, {tests: 22, status: 'passed'}, 'complete dependency test inventory required');
    await run(['exec', acquisition, '/usr/bin/python3', '-I', '-B', '/workspace/scripts/native-golden-dependencies.py', 'prepare'], {timeout: 660000});
    await assertActor(acquisition, acquisitionId, true); checkInputs();
    await retireActor(acquisition, acquisitionId); acquisitionCreated = false; acquisitionAttempted = false;
    if (interrupted) throw interrupted;
    await checkRevision(); requireSpace();
    assert.equal(await git(['status', '--porcelain=v1', '--untracked-files=all']), '', 'acquisition changed source');
    offlineAttempted = true;
    offlineId = (await run(['create', '--name', name, '--label', `${owner}=${name}`, '--pull=never', '--platform', `linux/${architecture}`, '--network', 'none',
      '--user', `${uid}:${gid}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '4096', '--init',
      '--mount', `type=bind,source=${source},target=/workspace`, '--workdir', '/workspace',
      '--mount', `type=bind,source=${supplement},target=/tmp/prismpm-dependency-supplement,readonly`,
      '--mount', `type=bind,source=${cacheState},target=${CARGO_STATE}`,
      '--env', 'HOME=/tmp/prismpm-golden-home', '--env', 'CARGO_NET_OFFLINE=true', '--env', 'CARGO_TARGET_DIR=/workspace/target/native-golden',
      '--env', `CARGO_HOME=${CARGO_HOME}`,
      '--env', 'CARGO_BUILD_JOBS=2', '--env', 'CARGO_PROFILE_DEV_DEBUG=0', '--env', 'CARGO_PROFILE_TEST_DEBUG=0',
      '--env', `PRISMPM_GOLDEN_REASON=Review original Ubuntu 24.04 ${platformPolicy.runner} source-development records against the committed shared baseline.`, '--entrypoint', '/bin/bash', lock.reference,
      '-ec', 'mkdir -p /tmp/prismpm-golden-home; exec sleep infinity'])).toString().trim();
    assert.match(offlineId, /^[a-f0-9]{64}$/); created = true;
    await run(['start', name]);
    await assertActor(name, offlineId, false); checkInputs();
    const platform = JSON.parse(await run(['exec', name, 'node', '-e',
      'console.log(JSON.stringify({architecture:process.arch,os:process.platform,release:require("node:fs").readFileSync("/etc/os-release","utf8")}))']));
    assert.equal(platform.architecture, platformPolicy.node); assert.equal(platform.os, 'linux');
    assert.match(platform.release, /^ID=ubuntu$/m); assert.match(platform.release, /^VERSION_ID="24\.04"$/m);
    if (interrupted) throw interrupted;
    // Exercise the actual architecture's Python/glibc no-replace publication
    // and admission boundary before any expensive compiler construction.
    const publicationTests = await run(['exec', name, 'node', '--test', '--test-reporter=tap', '--test-timeout=120000', '/workspace/sdk/exporter-seed.test.mjs']);
    const publicationTap = publicationTests.toString();
    assert.equal(verifyTap(publicationTap, 38), 38);
    assert.match(publicationTap, /^1\.\.38\r?$/m);
    if (interrupted) throw interrupted;
    await run(['exec', name, 'node', '/workspace/scripts/native-golden.mjs', 'seed-cache']);
    const seededInputs = cacheInventory();
    writeFileSync(join(destination, 'cargo-seeded-inputs.json'), canonical(seededInputs), {flag: 'wx'});
    const preparation = JSON.parse(await run(['exec', name, '/usr/bin/python3', '-I', '-B', '/workspace/scripts/native-golden-dependencies.py', 'install']));
    assert.match(preparation.preparation_sha256, /^[0-9a-f]{64}$/);
    assert.equal(preparation.preparation_sha256, hash(Buffer.from(canonical(preparation.preparation))));
    writeFileSync(join(destination, 'dependency-preparation.json'), canonical(preparation), {flag: 'wx'});
    requireSpace();
    for (const manifest of CARGO_MANIFESTS) {
      if (interrupted) throw interrupted;
      checkInputs(); await assertActor(name, offlineId, false);
      await run(['exec', name, 'cargo', 'fetch', '--locked', '--offline', '--manifest-path', '/workspace/' + manifest]);
    }
    checkInputs(); await checkRevision();
    const cacheInputs = cacheInventory(), acquiredMap = new Map(cacheInputs.map(row => [row.path, row]));
    for (const row of seededInputs) if (!row.path.startsWith('registry/index/'))
      assert.deepEqual(acquiredMap.get(row.path), row, 'acquisition replaced an existing Cargo input');
    writeFileSync(join(destination, 'cargo-inputs.json'), canonical({scope: 'locked-registry-input-acquisition-only',
      source_revision: revision, identity_basis: 'sha256-content', manifests: CARGO_MANIFESTS,
      inputs: inputIdentity, cache_inputs: cacheInputs}), {flag: 'wx'});
    let records;
    for (const write of [true, false]) {
      if (interrupted) throw interrupted;
      await assertActor(name, offlineId, false); checkInputs();
      assert.deepEqual(cacheInventory(), cacheInputs, 'acquired Cargo input bytes changed');
      await run(['exec', name, 'cargo', 'run', '--locked', '--offline', '-p', 'xtask', '--', 'check-golden', ...(write ? ['--write'] : [])], {timeout: 7200000});
      requireSpace();
      const observed = collectProfile(source, architecture);
      if (write) records = observed;
      else for (const [index, row] of observed.entries()) assert.equal(hash(row.bytes), hash(records[index].bytes), `repeat changed original native record: ${row.path}`);
    }
    checkInputs(); assert.deepEqual(cacheInventory(), cacheInputs, 'repeat changed acquired Cargo input bytes');
    await checkRevision(); validateSourceBaseline(source);
    for (const command of [['diff', '--name-only', 'HEAD'], ['ls-files', '--others', '--exclude-standard']]) {
      const changed = (await git(command)).trim().split('\n').filter(Boolean);
      assert(changed.every(path => RECORDS.some(record => path === `${profile}/${record}`)), 'generation modified unrelated source');
    }
    for (const row of records) {
      const output = join(destination, 'records', row.path); mkdirSync(dirname(output), {recursive: true});
      writeFileSync(output, row.bytes, {flag: 'wx'});
    }
    result = {schema: 'prismpm/native-golden-review/1', scope: 'source-golden-review-only', status: 'review-required',
      source_revision: revision, environment_revision: lock.source_revision, environment_image: lock.reference, identity,
      dependency_preparation_sha256: preparation.preparation_sha256,
      platform: `linux-${architecture}-ubuntu-24.04`, native_basis: `github-hosted-${platformPolicy.runner}-runner-selection`,
      run_id: environment.GITHUB_RUN_ID, run_attempt: environment.GITHUB_RUN_ATTEMPT,
      records: records.map(({path, bytes}) => ({path, byte_length: bytes.length, sha256: hash(bytes)})),
      unclaimed: ['hardware-attestation', 'reviewed-baseline', 'current-sdk-acceptance', 'sdk-release', 'product-readiness']};
  } catch (error) { failure = error; }
  finally {
    if (acquisitionCreated) try {
      await retireActor(acquisition, acquisitionId); acquisitionCreated = false; acquisitionAttempted = false;
    } catch (error) { cleanupErrors.push(error.message); failure ??= error; }
    if (!acquisitionCreated) try {
      const receipt = join(supplement, 'preparation.json');
      if (lstatSync(receipt, {throwIfNoEntry: false})) {
        writeFileSync(join(destination, 'unaccepted-dependency-preparation.json'), regular(receipt, 4 * 1024 ** 2), {flag: 'wx'});
      }
    } catch (error) { failure ??= error; }
    // Stop the owned container before retaining evidence. A timed-out Docker
    // exec client can leave its in-container compiler running and writing.
    if (created) try {
      await retireActor(name, offlineId); created = false; offlineAttempted = false;
    } catch (error) { cleanupErrors.push(error.message); failure ??= error; }
    try {
      for (const kind of offlineAttempted ? [] : ['build', 'verified']) {
        const directory = join(source, '.prism', kind);
        if (lstatSync(directory, {throwIfNoEntry: false})) for (const row of files(directory)) {
          const output = join(destination, 'generated', kind, row.path); mkdirSync(dirname(output), {recursive: true});
          writeFileSync(output, row.bytes, {flag: 'wx'});
        }
      }
    } catch (error) { failure ??= error; }
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    if (!offlineAttempted && !acquisitionAttempted) rmSync(runtime, {recursive: true});
    else process.stderr.write(`Retained unresolved native review cache ${runtime}\n`);
  }
  failure ??= interrupted;
  if (failure) { writeFileSync(join(destination, 'failure.json'), canonical({scope: 'source-golden-review-only', message: failure.message,
    cleanup_errors: cleanupErrors, ...(offlineAttempted || acquisitionAttempted ? {retained_runtime: runtime,
      ...(acquisitionAttempted ? {acquisition_name: acquisition, acquisition_cid: acquisitionId ?? null} : {}),
      ...(offlineAttempted ? {offline_name: name, offline_cid: offlineId ?? null} : {})} : {})}), {flag: 'wx'}); throw failure; }
  writeFileSync(join(destination, 'review.json'), canonical(result), {flag: 'wx'});
  return result;
}

export const NATIVE_INPUT_PATHS = Object.freeze(["stdlib/**", "tests/golden/**", "vendor/lexlean/**", "crates/prismpm/src/**", "model/**", "schemas/**", "sdk/**", "lexlean.toml", "lexlean.lock", "lean-toolchain", "rust-toolchain.toml", "Cargo.toml", "Cargo.lock", "scripts/native-golden.mjs", "scripts/ci-observe.mjs", ".github/workflows/native-golden.yml"]);

export function validateWorkflow(text) {
  assert.match(text, /^  pull_request:\n(?:    #.*\n)+    paths:\n((?:      - '.*'\n)+)  push:\n    branches: \[main\]\n    tags: \['v\*'\]\n  workflow_dispatch:\n/m);
  assert.deepEqual(text.match(/^    paths:\n((?:      - '.*'\n)+)/m)[1].split('\n').filter(Boolean).map(line => line.slice(9, -1)), NATIVE_INPUT_PATHS);
  assert(!/environment:|packages:|id-token:|attestations:|pull_request_target:/.test(text));
  assert.match(text, /^    runs-on: \$\{\{ matrix\.os \}\}$/m);
  assert.equal(text.match(/^    strategy:\n((?:      .*\n|        .*\n|          .*\n|            .*\n)+)/m)?.[1],
    '      fail-fast: false\n      max-parallel: 2\n      matrix:\n        include:\n          - os: ubuntu-24.04\n            arch: amd64\n          - os: ubuntu-24.04-arm\n            arch: arm64\n');
  assert.match(text, /^      contents: read$/m); assert(!/: write\b/.test(text));
  assert.match(text, /^          node-version: 22\.23\.2$/m);
  assert.match(text, /^          ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}$/m);
  assert.match(text, /^          persist-credentials: false$/m);
  const run = text.match(/      - name: Generate review-only native records\n        env:\n          SOURCE_REVISION: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\n        run: \|\n((?:          .*\n)+)/)?.[1];
  assert.equal(run, '          node scripts/native-golden.mjs tests\n          node scripts/native-golden.mjs run "$SOURCE_REVISION" "$RUNNER_TEMP/native-golden"\n');
  assert.match(text, /      - name: Start bounded native review diagnostics\n        run: node scripts\/ci-observe\.mjs start "\$RUNNER_TEMP\/native-observer"\n/);
  assert.match(text, /      - name: Stop native review diagnostics\n        if: always\(\)\n        run: node scripts\/ci-observe\.mjs stop "\$RUNNER_TEMP\/native-observer"\n/);
  for (const [name, path] of [['native-golden-review', 'native-golden'], ['native-golden-diagnostics', 'native-observer']]) {
    assert(text.includes('      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n'
      + '        if: always()\n        with:\n'
      + `          name: ${name}-\${{ matrix.arch }}-\${{ github.event.pull_request.head.sha || github.sha }}\n`
      + `          path: \${{ runner.temp }}/${path}/\n`), 'each native review artifact must upload on failure');
  }
  assert.match(text, /path: \$\{\{ runner\.temp \}\}\/native-golden\/\n          if-no-files-found: error\n          compression-level: 6\n/,
    'compress the complete raw evidence without filtering files');
  assert(!/setup-qemu|docker\/login-action|sdk-candidate.mjs|sdk-image-inputs.mjs/.test(text));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, revision, destination, ...extra] = process.argv.slice(2);
  if (operation === 'seed-cache' || operation === 'seed-download-cache') {
    assert.equal(process.argv.length, 3, 'seed-cache admits no path operands');
    const destination = operation === 'seed-cache' ? CARGO_HOME : '/tmp/prismpm-golden-fetch/cache';
    assert.equal(process.env.CARGO_HOME, destination, 'fixed private Cargo home required');
    process.stdout.write(canonical(seedCargoCache('/opt/prismpm/cargo-home', destination)) + '\n');
  } else if (operation === 'tests' && process.argv.length === 3) {
    const environment = {...process.env}; delete environment.NODE_TEST_CONTEXT;
    const result = await execute(process.execPath, ['--test', '--test-reporter=tap', '--test-timeout=120000', join(dirname(process.argv[1]), 'native-golden.test.mjs')], {environment});
    process.stdout.write(result.stdout); process.stderr.write(result.stderr); success(result, 'owning source-review tests');
    assert.equal(verifyTap(result.stdout.toString(), 18), 18);
  } else {
    assert.equal(operation, 'run'); assert(revision && destination && extra.length === 0, 'usage: native-golden.mjs tests | run SOURCE_COMMIT FRESH_OUTPUT');
    await runReview({source: process.cwd(), revision, destination});
  }
}
