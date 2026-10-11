// Source-development orchestration tests, not generated baseline acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, existsSync, chmodSync, lstatSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from './sdk-vv-check.mjs';
import test from 'node:test';
import { canonical, readEnvironmentLock, validateSourceBaseline, collectProfile, validateImageSpace, seedCargoCache, runReview, validateWorkflow } from './native-golden.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const revision = 'a'.repeat(40), environmentRevision = 'b'.repeat(40);
const recordPaths = ['golden-manifest.json', 'verified/lexlean-attestation.json', 'verified/manifest.json'];
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'prism-native-golden-unit-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const source = join(root, 'source'); mkdirSync(source);
  const put = (path, bytes) => { mkdirSync(join(source, path, '..'), {recursive: true}); writeFileSync(join(source, path), bytes); };
  put('stdlib/src/Probe.lex.tex', 'unit-only source\n'); put('tests/golden/stdlib/source/Probe.lex.tex', 'unit-only source\n');
  put('tests/golden/stdlib/golden-manifest.json', '{}');
  return {root, source, put};
}

test('environment locks are closed immutable native development-only authorities', () => {
  const manifest = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');
  const hashProfiles = value => {
    const sections = [...value.matchAll(/^\[([^\]]+)\]\n([^[]*)/gm)];
    assert.deepEqual(sections.filter(row => /^profile\.(?:dev|test)(?:\.|$)/.test(row[1]))
      .map(row => row[1]).sort(), ['profile.dev.package.sha2', 'profile.test.package.sha2']);
    for (const profile of ['dev', 'test']) {
      const section = `[profile.${profile}.package.sha2]`;
      const matches = sections.filter(row => `[${row[1]}]` === section);
      assert.equal(matches.length, 1, `exact source-owned ${section}`);
      assert.equal(matches[0][2].trim(), 'opt-level = 3', `closed ${section} settings`);
    }
  };
  hashProfiles(manifest);
  for (const profile of ['dev', 'test']) {
    const selected = `[profile.${profile}.package.sha2]\nopt-level = 3`;
    for (const replacement of ['', selected.replace('3', '0'), `${selected}\n${selected}`,
      `${selected}\ndebug-assertions = false`, `${selected}\n[profile.${profile}]\nopt-level = 3`]) {
      const changed = manifest.replace(selected, replacement);
      assert.notEqual(changed, manifest); assert.throws(() => hashProfiles(changed));
    }
  }
  for (const architecture of ['amd64', 'arm64']) {
    const raw = readFileSync(new URL(architecture === 'arm64' ? '../sdk/golden-development.lock.json' : '../sdk/golden-development-amd64.lock.json', import.meta.url));
    const lock = readEnvironmentLock(raw, architecture);
    assert.equal(lock.scope, 'source-golden-review-only'); assert.equal(lock.architecture, architecture);
    for (const changed of [{...lock, reference: 'example.invalid/sdk:latest'}, {...lock, architecture: architecture === 'amd64' ? 'arm64' : 'amd64'},
      {...lock, source_revision: 'current'}, {...lock, extra: true}, {...lock, scope: 'sdk-acceptance'}]) {
      assert.throws(() => readEnvironmentLock(Buffer.from(canonical(changed) + '\n'), architecture));
    }
    assert.throws(() => readEnvironmentLock(Buffer.from(JSON.stringify(lock)), architecture));
    assert.throws(() => readEnvironmentLock(raw, 'riscv64'));
  }
  const measured = 4107752353, reserve = 12 * 1024 ** 3;
  validateImageSpace(reserve + measured, measured);
  assert.throws(() => validateImageSpace(reserve + measured - 1, measured));
  for (const invalid of [-1, NaN, Infinity, 1.5]) assert.throws(() => validateImageSpace(reserve, invalid));
});

test('current shared source baseline is byte-exact before expensive generation', t => {
  const {source, put} = workspace(t); validateSourceBaseline(source);
  put('stdlib/src/Probe.lex.tex', 'changed'); assert.throws(() => validateSourceBaseline(source));
  put('stdlib/src/Probe.lex.tex', 'unit-only source\n'); put('stdlib/src/New.lex.tex', 'new');
  assert.throws(() => validateSourceBaseline(source));
  rmSync(join(source, 'stdlib/src/New.lex.tex')); put('tests/golden/stdlib/source/Extra.lex.tex', 'extra');
  assert.throws(() => validateSourceBaseline(source));
  rmSync(join(source, 'tests/golden/stdlib/source/Extra.lex.tex'));
  rmSync(join(source, 'stdlib/src/Probe.lex.tex')); symlinkSync('../other', join(source, 'stdlib/src/Probe.lex.tex'));
  assert.throws(() => validateSourceBaseline(source));
});

test('native profile collection retains exactly three original raw files', t => {
  for (const architecture of ['amd64', 'arm64']) {
  const {source, put} = workspace(t), profile = `tests/golden/native/linux-${architecture}-ubuntu-24.04`;
  for (const path of recordPaths) put(`${profile}/${path}`, Buffer.from(`raw ${path}\n`));
  const actual = collectProfile(source, architecture);
  assert.deepEqual(actual.map(row => row.path), recordPaths);
  for (const row of actual) assert.deepEqual(row.bytes, readFileSync(join(source, profile, row.path)));
  for (const directory of ['extra', 'verified/empty']) {
    mkdirSync(join(source, profile, directory)); assert.throws(() => collectProfile(source, architecture));
    rmSync(join(source, profile, directory), {recursive: true});
  }
  put(`${profile}/extra.json`, '{}'); assert.throws(() => collectProfile(source, architecture));
  rmSync(join(source, profile, 'extra.json')); rmSync(join(source, profile, recordPaths[0]));
  assert.throws(() => collectProfile(source, architecture));
  }
});

function fixture(t, fault, store = 'containerd', architecture = 'arm64') {
  const work = workspace(t), calls = [];
  const profile = `tests/golden/native/linux-${architecture}-ubuntu-24.04`;
  const nodeArchitecture = architecture === 'amd64' ? 'x64' : 'arm64';
  if (fault === 'stale-base') work.put('stdlib/src/Probe.lex.tex', 'changed current model\n');
  if (fault === 'stale-artifact') work.put('.prism/build/prior/result.json', '{}');
  const config = 'sha256:' + 'c'.repeat(64);
  const manifest = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: {digest: config, size: 100}, layers: []}));
  const child = {mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: 'sha256:' + hash(manifest), size: manifest.length, platform: {os: 'linux', architecture}};
  const index = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [child]}));
  const image = `fixture.invalid/sdk@sha256:${hash(index)}`;
  const lock = {schema: 'prismpm/golden-development-environment/1', scope: 'source-golden-review-only', architecture,
    reference: image, child_digest: child.digest, config_digest: config, source_revision: environmentRevision};
  work.put(architecture === 'arm64' ? 'sdk/golden-development.lock.json' : 'sdk/golden-development-amd64.lock.json', canonical(lock) + '\n');
  const ok = value => ({status: 0, signal: null, stdout: Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), stderr: Buffer.alloc(0)});
  const bad = () => ({...ok(''), status: 1, stderr: Buffer.from('unit-only genuine command failure')});
  let created, label, generations = 0, seeded = false;
  const transport = async (command, args, options) => {
    calls.push([command, args]);
    for (const name of ['CARGO_PROFILE_DEV_OPT_LEVEL', 'CARGO_PROFILE_TEST_OPT_LEVEL',
      'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER']) {
      assert.equal(options.environment[name], undefined, `caller ${name} must not enter the source gate`);
      assert(!args.some(arg => arg.startsWith(name + '=')), `caller ${name} must not enter the container`);
    }
    if (command === 'git') {
      if (args.includes('rev-parse')) return ok((fault === 'source-revision' ? environmentRevision : revision) + '\n');
      if (args.includes('status')) return ok(fault === 'dirty-source' ? ' M source.lex.tex\n' : '');
      if (args.includes('diff')) return ok(fault === 'source-changed' ? 'stdlib/src/Probe.lex.tex\n' : '');
      if (args.includes('ls-files')) return ok('');
      assert.fail(args.join(' '));
    }
    assert.equal(command, 'docker');
    if (args[0] === 'buildx') return ok(args.at(-1) === image ? index : manifest);
    if (args[0] === 'pull') { assert.deepEqual(args, ['pull', '--platform', `linux/${architecture}`, image]); return ok('pulled'); }
    if (args[0] === 'image') {
      const selected = args.includes('--platform');
      if (store === 'classic' && selected) return {...bad(), status: 125, stderr: Buffer.from('unknown flag: --platform')};
      const descriptor = selected ? child : {digest: 'sha256:' + hash(index), size: index.length, mediaType: 'application/vnd.oci.image.index.v1+json'};
      return ok([{Id: store === 'classic' ? config : descriptor.digest, ...(store === 'classic' ? {} : {Descriptor: descriptor}),
        RepoDigests: [image], Os: 'linux', Architecture: fault === 'wrong-platform' ? (architecture === 'amd64' ? 'arm64' : 'amd64') : architecture,
        Config: {Labels: {'org.opencontainers.image.revision': environmentRevision}, Volumes: null}}]);
    }
    if (args[0] === 'create') {
      created = args[args.indexOf('--name') + 1]; label = args[args.indexOf('--label') + 1];
      assert.equal(args[args.indexOf('--network') + 1], 'none'); assert(args.includes('--pull=never'));
      assert.equal(args[args.indexOf('--platform') + 1], `linux/${architecture}`);
      assert(args.includes('CARGO_HOME=/tmp/prismpm-golden-cargo'), 'UID 1001 requires an explicit private Cargo home');
      assert.equal(args[args.indexOf('--user') + 1], '1001:1001');
      assert.equal(args.filter(arg => arg.startsWith('CARGO_HOME=')).length, 1);
      assert(!args.includes('--privileged')); assert(!args.some(arg => arg.includes('docker.sock')));
      return ok('created');
    }
    if (args[0] === 'start') return ok('started');
    if (args[0] === 'inspect') return ok([{Image: fault === 'wrong-container-image' ? 'sha256:' + 'f'.repeat(64) : store === 'classic' ? config : 'sha256:' + hash(index), Config: {Labels: Object.fromEntries([label.split('=')])}}]);
    if (args[0] === 'rm') { if (fault === 'cleanup') return bad(); created = undefined; return ok('removed'); }
    assert.deepEqual(args.slice(0, 2), ['exec', created]);
    if (args[2] === 'node' && args[3] === '-e') return ok({architecture: fault === 'wrong-executable' ? 'riscv64' : nodeArchitecture, os: 'linux', release: 'ID=ubuntu\nVERSION_ID="24.04"\n'});
    if (args[2] === 'node') {
      assert.deepEqual(args.slice(2), ['node', '/workspace/scripts/native-golden.mjs', 'seed-cache']);
      assert.equal(options.timeout, 120000); assert.equal(options.limit, 16 * 1024 ** 2);
      assert.equal(generations, 0, 'cache preparation precedes every golden command');
      if (fault === 'cache-failure') return bad();
      if (fault === 'cache-signal') return {...ok(''), status: null, signal: 'SIGTERM'};
      if (fault === 'cache-cancel') process.emit('SIGTERM');
      seeded = true; return ok({bytes: 128, entries: 2});
    }
    assert(seeded, 'golden generation cannot use an unseeded cache');
    assert.equal(options.timeout, 7200000, 'native generation keeps its two-hour bound');
    assert.deepEqual(args.slice(2), ['cargo', 'run', '--locked', '--offline', '-p', 'xtask', '--', 'check-golden', ...(generations === 0 ? ['--write'] : [])]);
    generations++;
    work.put('.prism/build/unit/build-artifact.json', '{"diagnostic":"unit-only"}');
    if (fault === 'write-failure' && generations === 1 || fault === 'repeat-failure' && generations === 2) return bad();
    if (fault !== 'missing-profile') for (const path of recordPaths) work.put(`${profile}/${path}`, `raw ${path}\n`);
    if (fault === 'repeat-mutation' && generations === 2) work.put(`${profile}/golden-manifest.json`, 'changed');
    return ok('unit-only generation transcript');
  };
  const context = {architecture: nodeArchitecture, uid: 1001, gid: 1001, environment: {PATH: process.env.PATH, CARGO_HOME: '/caller/cache',
    CARGO_PROFILE_DEV_OPT_LEVEL: '0', CARGO_PROFILE_TEST_OPT_LEVEL: '0', RUSTFLAGS: '--cfg caller_override',
    CARGO_ENCODED_RUSTFLAGS: '--cfg\u001fcaller_override', RUSTC_WRAPPER: '/caller/wrapper', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
    RUNNER_OS: 'Linux', RUNNER_ARCH: architecture === 'amd64' ? 'X64' : 'ARM64', GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1'}};
  const destination = join(work.root, 'output');
  return {...work, calls, destination, context, run: (implementation = runReview) => implementation({source: work.source, revision, destination}, transport, context),
    generations: () => generations, remaining: () => created};
}

test('source review executes exact image, both unchanged golden commands and byte-preserving export', async t => {
  for (const architecture of ['amd64', 'arm64']) for (const store of ['classic', 'containerd']) {
    const f = fixture(t, undefined, store, architecture); const result = await f.run();
    assert.equal(result.scope, 'source-golden-review-only'); assert.equal(result.status, 'review-required');
    assert.equal(f.generations(), 2); assert.equal(f.remaining(), undefined);
    assert.equal(result.source_revision, revision); assert.equal(result.identity.store, store);
    assert.equal(result.platform, `linux-${architecture}-ubuntu-24.04`);
    assert.equal(result.native_basis, `github-hosted-${architecture === 'amd64' ? 'X64' : 'ARM64'}-runner-selection`);
    assert.equal(f.calls.filter(([command, args]) => command === 'docker' && args[0] === 'image' && args.includes('--platform')).length, store === 'classic' ? 0 : 1);
    for (const row of result.records) assert.equal(hash(readFileSync(join(f.destination, 'records', row.path))), row.sha256);
    assert(existsSync(join(f.destination, 'generated/build/unit/build-artifact.json')));
  }
});

test('failure and missing evidence never become a reviewed or accepted SDK baseline', async t => {
  for (const architecture of ['amd64', 'arm64']) for (const store of ['classic', 'containerd']) for (const fault of ['source-revision', 'dirty-source', 'stale-base', 'stale-artifact', 'wrong-platform', 'wrong-executable', 'wrong-container-image', 'write-failure', 'repeat-failure',
    'missing-profile', 'repeat-mutation', 'source-changed', 'cleanup']) {
    const f = fixture(t, fault, store, architecture); await assert.rejects(f.run(), undefined, fault);
    assert(!existsSync(join(f.destination, 'review.json')), fault);
    if (fault !== 'cleanup') assert.equal(f.remaining(), undefined, fault);
    if (fault === 'write-failure') {
      assert.equal(f.generations(), 1); assert(existsSync(join(f.destination, 'generated/build/unit/build-artifact.json')));
    }
  }
});

test('native source review rejects unsupported, mismatched and untrusted runner architecture before transport', async t => {
  for (const architecture of ['amd64', 'arm64']) for (const change of [
    context => {context.architecture = 'riscv64';},
    context => {context.environment.RUNNER_ARCH = architecture === 'amd64' ? 'ARM64' : 'X64';},
    context => {context.environment.RUNNER_ENVIRONMENT = 'self-hosted';},
    context => {context.environment.RUNNER_OS = 'Windows';},
    context => {context.environment.GITHUB_ACTIONS = 'false';},
  ]) {
    const f = fixture(t, undefined, 'classic', architecture); change(f.context);
    await assert.rejects(f.run()); assert.equal(f.calls.length, 0); assert.equal(f.generations(), 0);
    assert(!existsSync(f.destination));
  }
});

test('private cache initialization failure, signal and cancellation stop generation and clean owned resources', async t => {
  for (const fault of ['cache-failure', 'cache-signal', 'cache-cancel']) {
    const f = fixture(t, fault); await assert.rejects(f.run());
    assert.equal(f.generations(), 0); assert.equal(f.remaining(), undefined);
    assert(!existsSync(join(f.destination, 'review.json')));
    assert(existsSync(join(f.destination, 'failure.json')));
  }
});

test('image cache seeding preserves bytes in a new private writable tree', t => {
  const {root} = workspace(t), source = join(root, 'cache'), destination = join(root, 'private');
  mkdirSync(source); mkdirSync(join(source, 'registry'));
  const sourceFile = join(source, 'registry', 'package.crate');
  writeFileSync(sourceFile, Buffer.from([0, 1, 2, 255])); chmodSync(sourceFile, 0o444);
  const executable = join(source, 'registry', 'helper');
  writeFileSync(executable, Buffer.from([7, 8, 9])); chmodSync(executable, 0o555);
  chmodSync(join(source, 'registry'), 0o555); chmodSync(source, 0o555);
  try {
    assert.deepEqual(seedCargoCache(source, destination), {bytes: 7, entries: 4});
    assert.deepEqual(readFileSync(join(destination, 'registry', 'package.crate')), readFileSync(sourceFile));
    assert.equal(lstatSync(destination).mode & 0o777, 0o700);
    assert.equal(lstatSync(join(destination, 'registry', 'package.crate')).mode & 0o777, 0o600);
    assert.equal(lstatSync(sourceFile).mode & 0o777, 0o444);
    assert.deepEqual(readFileSync(join(destination, 'registry', 'helper')), readFileSync(executable));
    assert.equal(lstatSync(join(destination, 'registry', 'helper')).mode & 0o777, 0o700);
    assert.equal(lstatSync(executable).mode & 0o777, 0o555);
    assert.throws(() => seedCargoCache(source, destination), /must be new/);
  } finally { chmodSync(source, 0o700); chmodSync(join(source, 'registry'), 0o700); }
});

test('image cache seeding rejects aliases, writable inputs, empty caches and exceeded bounds before copying', t => {
  const {root} = workspace(t), source = join(root, 'cache'), destination = join(root, 'private');
  mkdirSync(source); const input = join(source, 'input'); writeFileSync(input, 'input');
  const directories = [source];
  chmodSync(source, 0o555);
  try {
    assert.throws(() => seedCargoCache(source, destination), /immutable regular files/);
    assert(!existsSync(destination)); chmodSync(source, 0o700); rmSync(input);
    symlinkSync('/etc/passwd', input); chmodSync(source, 0o555);
    assert.throws(() => seedCargoCache(source, destination), /immutable regular files/);
    assert(!existsSync(destination)); chmodSync(source, 0o700); rmSync(input);
    writeFileSync(input, ''); truncateSync(input, 256 * 1024 ** 2 + 1); chmodSync(input, 0o444); chmodSync(source, 0o555);
    assert.throws(() => seedCargoCache(source, destination), /file bound exceeded/);
    assert(!existsSync(destination));
    chmodSync(source, 0o700); rmSync(input); chmodSync(source, 0o555);
    assert.throws(() => seedCargoCache(source, destination), /nonempty image cache required/);
    assert(!existsSync(destination));
    chmodSync(source, 0o700);
    for (let depth = 1; depth <= 33; depth++) {
      const path = join(directories.at(-1), 'nested'); mkdirSync(path); directories.push(path);
    }
    for (const path of directories) chmodSync(path, 0o555);
    assert.throws(() => seedCargoCache(source, destination), /cache tree bound exceeded/);
    assert(!existsSync(destination));
    for (const path of directories) chmodSync(path, 0o700);
    rmSync(directories[1], {recursive: true}); directories.splice(1);
    for (let index = 0; index < 9; index++) {
      const path = join(source, `sparse-${index}`); writeFileSync(path, '');
      truncateSync(path, index < 8 ? 256 * 1024 ** 2 : 1); chmodSync(path, 0o444);
    }
    chmodSync(source, 0o555);
    assert.throws(() => seedCargoCache(source, destination), /cache byte bound exceeded/);
    assert(!existsSync(destination));
  } finally { for (const path of directories) chmodSync(path, 0o700); }
});

test('PR workflow has no publication policy bypass and keeps exact native generation and failure uploads', () => {
  const raw = readFileSync(new URL('../.github/workflows/native-golden.yml', import.meta.url), 'utf8');
  validateWorkflow(raw);
  for (const changed of [raw.replace('ubuntu-24.04-arm', 'ubuntu-24.04'), raw.replace('pull_request:', 'workflow_dispatch:'),
    raw.replace('contents: read', 'contents: write'), raw.replace('22.23.2', 'latest'), raw.replace('if: always()', 'if: success()'),
    raw.replace('node scripts/native-golden.mjs run', 'true # node scripts/native-golden.mjs run'),
    raw.replace('          - os: ubuntu-24.04\n            arch: amd64\n', ''),
    raw.replace('          - os: ubuntu-24.04-arm\n            arch: arm64\n', ''),
    raw.replace('arch: amd64', 'arch: arm64'),
    raw.replace('fail-fast: false', 'fail-fast: true'),
    raw.replace('max-parallel: 2', 'max-parallel: 12'),
    raw.replace('      max-parallel: 2\n', ''),
    raw.replace('runs-on: ${{ matrix.os }}', 'runs-on: ubuntu-24.04-arm'),
    raw.replace('native-golden-review-${{ matrix.arch }}', 'native-golden-review-arm64'),
  ]) { assert.notEqual(changed, raw); assert.throws(() => validateWorkflow(changed)); }
  for (const name of ['native-golden-review', 'native-golden-diagnostics']) {
    const changed = raw.replace(`if: always()\n        with:\n          name: ${name}`, `if: success()\n        with:\n          name: ${name}`);
    assert.notEqual(changed, raw); assert.throws(() => validateWorkflow(changed));
  }
  const runtime = JSON.parse(readFileSync(new URL('../sdk/vv-runtime.lock.json', import.meta.url)));
  assert(raw.includes(`driver-opts: image=${runtime.images.buildkit.reference}`));
});

test('actual workflow shell executes both commands and propagates either failure', async t => {
  const raw = readFileSync(new URL('../.github/workflows/native-golden.yml', import.meta.url), 'utf8');
  validateWorkflow(raw);
  const shell = raw.match(/        run: \|\n((?:          .*\n)+)/)[1].split('\n').filter(Boolean).map(line => line.slice(10)).join('\n');
  const {root} = workspace(t), binary = join(root, 'node'), log = join(root, 'calls');
  writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$GOLDEN_CALL_LOG"\nif [ "$2" = "$GOLDEN_FAIL_OPERATION" ]; then exit 37; fi\n`); chmodSync(binary, 0o755);
  for (const fault of ['', 'tests', 'run']) {
    rmSync(log, {force: true});
    const result = await execute('/bin/bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', shell],
      {environment: {PATH: `${root}:/usr/bin:/bin`, SOURCE_REVISION: revision, RUNNER_TEMP: root, GOLDEN_CALL_LOG: log, GOLDEN_FAIL_OPERATION: fault}});
    assert.equal(result.status, fault ? 37 : 0);
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    assert.deepEqual(calls, ['scripts/native-golden.mjs tests', ...(fault === 'tests' ? [] : [`scripts/native-golden.mjs run ${revision} ${root}/native-golden`])]);
  }
});

test('executed source-baseline and second-run omission mutants fail owning behavioral checks', async t => {
  const source = readFileSync(new URL('./native-golden.mjs', import.meta.url), 'utf8');
  const load = async text => {
    for (const dependency of ['./sdk-vv-check.mjs', './browser-api-sdk-check.mjs']) text = text.replace(JSON.stringify(dependency), JSON.stringify(new URL(dependency, import.meta.url).href))
      .replace(`'${dependency}'`, JSON.stringify(new URL(dependency, import.meta.url).href));
    return import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
  };
  const noRepeat = await load(source.replace('for (const write of [true, false])', 'for (const write of [true])'));
  await assert.rejects(async () => { const f = fixture(t); await f.run(noRepeat.runReview); assert.equal(f.generations(), 2); }, /1 !== 2/);
  const noBaseline = await load(source.replaceAll('validateSourceBaseline(source);', ''));
  await assert.rejects(async () => { const f = fixture(t, 'stale-base'); await assert.rejects(f.run(noBaseline.runReview), /golden source bytes are stale/); }, /Missing expected rejection/);
  const noSeed = await load(source.replace("await run(['exec', name, 'node', '/workspace/scripts/native-golden.mjs', 'seed-cache']);", ''));
  await assert.rejects(fixture(t).run(noSeed.runReview), /unseeded cache/);
  const noRunnerBinding = await load(source.replace('assert.equal(environment.RUNNER_ARCH, platformPolicy.runner);', ''));
  for (const architecture of ['amd64', 'arm64']) {
    await assert.rejects(async () => {
      const f = fixture(t, undefined, 'classic', architecture);
      f.context.environment.RUNNER_ARCH = architecture === 'amd64' ? 'ARM64' : 'X64';
      await assert.rejects(f.run(noRunnerBinding.runReview));
    }, /Missing expected rejection/);
  }
});
