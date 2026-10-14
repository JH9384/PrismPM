// Internal image construction inputs, not SDK or application acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClosure, materializeClosure, verifyClosure } from './sdk-vv-inputs.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item) + '\n';
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.slice().sort());
const oid = value => assert.match(value, /^[0-9a-f]{40}$/);
const SOURCE_INPUTS = ['sdk/Dockerfile', 'sdk/vv-inputs.lock.json', 'tools.lock', 'scripts/sdk-vv-inputs.mjs', 'scripts/sdk-image-inputs.mjs'];

function removeOwned(path, identity) {
  const current = lstatSync(path);
  assert(current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino,
    'refusing cleanup of replaced image-input scratch');
  rmSync(path, { recursive: true });
}

function read(path, limit = 1024 * 1024) {
  assert.equal(realpathSync(path), resolve(path), 'input path must not be aliased');
  assert(lstatSync(path).isFile(), 'bounded regular input required');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert(before.isFile() && before.nlink === 1n && before.size <= BigInt(limit), 'bounded regular input required');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      assert(count > 0, 'input shortened'); offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0, 'input grew');
    const after = fstatSync(fd, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mode', 'nlink', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key], 'input changed');
    const current = lstatSync(path, {bigint: true});
    for (const key of ['dev', 'ino', 'size', 'mode', 'nlink', 'mtimeNs', 'ctimeNs']) assert.equal(current[key], before[key], 'input path changed');
    assert.equal(realpathSync(path), resolve(path), 'input path changed');
    return bytes;
  } finally { closeSync(fd); }
}

export function inputPolicy(source, revision) {
  oid(revision);
  const bytes = read(join(source, 'sdk/vv-inputs.lock.json'));
  const authority = JSON.parse(bytes);
  assert.equal(canonical(authority), bytes.toString(), 'canonical authority lock required');
  keys(authority, ['schema', 'advisory']);
  assert.equal(authority.schema, 'prismpm/sdk-image-input-authorities/1');
  keys(authority.advisory, ['url', 'revision', 'tree']);
  assert.equal(authority.advisory.url, 'https://github.com/RustSec/advisory-db');
  oid(authority.advisory.revision); oid(authority.advisory.tree);
  const sourceLock = read(join(source, 'tools.lock')).toString();
  const section = sourceLock.match(/^\[bootstrap-sdk\]\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  assert(section, 'bootstrap authority missing');
  const lines = section.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const fields = lines.map(line => {
    const field = /^([a-z][a-z0-9_]*) = "([^"\r\n]+)"$/.exec(line);
    assert(field, 'closed bootstrap authority syntax'); return field;
  });
  assert.equal(new Set(fields.map(row => row[1])).size, fields.length, 'duplicate bootstrap field');
  const bootstrap = Object.fromEntries(fields.map(row => [row[1], row[2]]));
  keys(bootstrap, ['version', 'source_commit', 'tag_object', 'url', 'sha256']);
  assert.equal(bootstrap.version, '0.2.0');
  assert.equal(bootstrap.url, 'https://github.com/UOR-Foundation/PrismPM/releases/download/v0.2.0/prismpm-0.2.0-x86_64-unknown-linux-gnu.tar.gz');
  oid(bootstrap.source_commit); oid(bootstrap.tag_object); assert.match(bootstrap.sha256, /^[0-9a-f]{64}$/);
  return { schema: 'prismpm/sdk-vv-input-policy/1', source_revision: revision,
    historical_revision: bootstrap.source_commit, historical_tag: bootstrap.tag_object,
    bootstrap_sha256: bootstrap.sha256, advisory_revision: authority.advisory.revision,
    advisory_tree: authority.advisory.tree };
}

function boundInputs(source, manifest) {
  for (const path of SOURCE_INPUTS) {
    const row = manifest.source.files.find(row => row.path === path);
    assert(row && row.mode === '100644', `committed image-input helper/policy required: ${path}`);
    const bytes = read(join(source, path));
    assert.equal(bytes.length, row.byte_length); assert.equal(sha(bytes), row.sha256, `image-input source differs: ${path}`);
  }
}

// Explicit paths are lower-level data inputs, never authority overrides. The
// production CLI acquires the independently pinned official sources below.
export function captureImageInputs({ source, revision, advisory, bootstrap, destination }) {
  const policy = inputPolicy(source, revision);
  const manifest = buildClosure({ source, advisory, bootstrap, policy, destination });
  boundInputs(source, manifest);
  verifyClosure(destination, policy);
  return policy;
}

function acquisition(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'https' } });
  assert.equal(result.error, undefined, 'input acquisition failed');
  assert.equal(result.signal, null, 'input acquisition interrupted');
  assert.equal(result.status, 0, `official input acquisition failed: ${command}`);
}

export function prepareImageInputs(source, revision, destination) {
  const policy = inputPolicy(source, revision);
  const work = mkdtempSync(join(tmpdir(), 'prismpm-image-acquire-'));
  const identity = lstatSync(work);
  try {
    const advisory = join(work, 'advisory'); mkdirSync(advisory);
    acquisition('git', ['init', '--quiet', '--template='], advisory);
    acquisition('git', ['fetch', '--quiet', '--depth=1', 'https://github.com/RustSec/advisory-db', policy.advisory_revision], advisory);
    acquisition('git', ['checkout', '--quiet', '--detach', policy.advisory_revision], advisory);
    const bootstrap = join(work, 'bootstrap.tar.gz');
    acquisition('curl', ['--disable', '--proto', '=https', '--proto-redir', '=https', '--tlsv1.2', '--fail', '--location',
      '--silent', '--show-error', '--max-time', '240', '--max-filesize', '67108864',
      'https://github.com/UOR-Foundation/PrismPM/releases/download/v0.2.0/prismpm-0.2.0-x86_64-unknown-linux-gnu.tar.gz', '--output', bootstrap], work);
    return captureImageInputs({ source, revision, advisory, bootstrap, destination });
  } finally { removeOwned(work, identity); }
}

export function stageImageInputs(closure, policyRoot, revision, destination) {
  const policy = inputPolicy(policyRoot, revision);
  const manifest = verifyClosure(closure, policy);
  boundInputs(policyRoot, manifest);
  const materialized = materializeClosure(closure, policy, destination);
  assert.deepEqual(materialized, manifest);
  // Only this newly created Git store is removed. Raw tracked source remains
  // byte-exact; history is retained independently in the sealed source pack.
  const git = join(destination, 'source/.git');
  assert(lstatSync(git).isDirectory() && !lstatSync(git).isSymbolicLink());
  rmSync(git, { recursive: true });
  rmSync(join(destination, 'advisory'), { recursive: true });
  rmSync(join(destination, 'bootstrap.tar.gz'));
  writeFileSync(join(destination, 'policy.json'), canonical(policy), { flag: 'wx', mode: 0o444 });
  return manifest;
}

const TARGETS = ['runtime', 'adapter-compose', 'adapter-kubernetes', 'adapter-github-pages', 'oracles', 'cli-archive'];
export function dockerArguments(source, revision, target, closure, args) {
  oid(revision); assert(TARGETS.includes(target), 'closed SDK build target');
  assert(Array.isArray(args));
  const values = new Set(['--platform', '--output', '--tag', '--metadata-file', '--label']);
  for (let i = 0; i < args.length; i++) {
    assert.equal(typeof args[i], 'string'); assert(!args[i].includes('\0'));
    if (values.has(args[i])) {
      assert(typeof args[++i] === 'string' && args[i].length > 0 && !args[i].startsWith('-') && !args[i].includes('\0'));
      continue;
    }
    if (args[i] === '--build-arg') {
      assert.match(args[++i] ?? '', /^(?:SOURCE_DATE_EPOCH=0|SDK_VERSION=[0-9]+\.[0-9]+\.[0-9]+)$/); continue;
    }
    assert(['--no-cache', '--load', '--provenance=false', '--sbom=false'].includes(args[i]), `unsupported SDK build argument: ${args[i]}`);
  }
  return ['buildx', 'build', '--build-context', `vv-inputs=${resolve(closure)}`,
    '--build-arg', `SDK_SOURCE_REVISION=${revision}`, '--file', join(resolve(source), 'sdk/Dockerfile'),
    '--target', target, ...args, resolve(source)];
}

// Dependency injection is confined to unit transport tests, which execute a
// recording Docker executable. The CLI always performs real acquisition.
function constructImage(source, revision, target, args, prepare) {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-sdk-image-'));
  const identity = lstatSync(work);
  try {
    const closure = join(work, 'inputs');
    // Validate caller options before acquisition; only the later private
    // recipe context is ever handed to Docker.
    dockerArguments(source, revision, target, closure, args);
    const policy = prepare(source, revision, closure);
    assert.deepEqual(policy, inputPolicy(source, revision), 'independent source policy differs');
    const materialized = join(work, 'materialized');
    const manifest = materializeClosure(closure, policy, materialized);
    boundInputs(source, manifest);
    const context = join(work, 'recipe'); mkdirSync(context, {mode: 0o700});
    for (const path of SOURCE_INPUTS) {
      const destination = join(context, path);
      mkdirSync(dirname(destination), {recursive: true, mode: 0o700});
      writeFileSync(destination, read(join(materialized, 'source', path)), {flag: 'wx', mode: 0o400});
    }
    boundInputs(context, manifest);
    // The verified full checkout is not a Docker context. Only the five
    // independently bound bootstrap files cross the raw recipe boundary.
    removeOwned(materialized, lstatSync(materialized));
    const nodes = [context, join(context, 'sdk'), join(context, 'scripts'), ...SOURCE_INPUTS.map(path => join(context, path))]
      .map(path => ({path, identity: lstatSync(path, {bigint: true})}));
    const verify = () => {
      for (const {path, identity} of nodes) {
        assert.equal(realpathSync(path), path, 'recipe context path changed');
        const current = lstatSync(path, {bigint: true});
        for (const key of ['dev', 'ino', 'size', 'mode', 'nlink', 'mtimeNs', 'ctimeNs'])
          assert.equal(current[key], identity[key], 'recipe context custody changed');
      }
      assert.deepEqual(readdirSync(context).sort(), ['scripts', 'sdk', 'tools.lock']);
      assert.deepEqual(readdirSync(join(context, 'sdk')).sort(), ['Dockerfile', 'vv-inputs.lock.json']);
      assert.deepEqual(readdirSync(join(context, 'scripts')).sort(), ['sdk-image-inputs.mjs', 'sdk-vv-inputs.mjs']);
      boundInputs(context, manifest);
      assert.deepEqual(verifyClosure(closure, policy), manifest, 'image input closure changed');
    };
    verify();
    const argv = dockerArguments(context, revision, target, closure, args);
    let result;
    try { result = spawnSync('docker', argv, { stdio: 'inherit' }); }
    finally { verify(); }
    if (result.error) throw result.error;
    assert.equal(result.signal, null, 'SDK image construction interrupted');
    return {status: result.status,
      input_policy: Buffer.from(canonical(policy)),
      input_manifest: Buffer.from(canonical(manifest))};
  } finally { removeOwned(work, identity); }
}

export function buildImage(source, revision, target, args, prepare = prepareImageInputs) {
  return constructImage(source, revision, target, args, prepare).status;
}

// A separate source-CI constructor exposes only the actual complete verified
// inputs of this construction. No caller-provided receipt can replace them.
// It does not qualify the built SDK or any consuming gate.
export function buildImageWithInputs(source, revision, args, prepare = prepareImageInputs) {
  const result = constructImage(source, revision, 'runtime', args, prepare);
  assert.equal(result.status, 0, 'source-CI SDK input construction failed');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'build' && args.length >= 3) {
    const [source, revision, target, ...buildArgs] = args;
    process.exitCode = buildImage(source, revision, target, buildArgs);
  } else if (command === 'stage' && args.length === 4) {
    const [closure, policyRoot, revision, destination] = args;
    stageImageInputs(closure, policyRoot, revision, destination);
  } else if (command === 'digest' && args.length === 1) {
    const value = JSON.parse(read(args[0]));
    assert.match(value['containerimage.digest'], /^sha256:[0-9a-f]{64}$/);
    process.stdout.write(value['containerimage.digest'] + '\n');
  } else throw Error('usage: sdk-image-inputs.mjs build SOURCE REVISION TARGET [DOCKER_OPTIONS...] | stage CLOSURE POLICY_ROOT REVISION DEST | digest METADATA');
}
