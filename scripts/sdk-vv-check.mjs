// Independent installed-SDK orchestration. Unit transports are not acceptance.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync,
  realpathSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateVvEvidence } from './sdk-vv-run.mjs';
import {bootstrapNames, validateBootstrapRetention} from './sdk-bootstrap-retention.mjs';
import {executeOwnedSdkCommand} from './sdk-command-owner.mjs';
import { validateResolver, isolatedResolver } from './sdk-vv-probe.mjs';
import { verifyTap } from './browser-api-sdk-check.mjs';
import {createSdkRegistryReader, sdkRegistryCertificate, readSdkRegistryManifest,
  closeSdkRegistryReader} from './sdk-registry-reader.mjs';

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.slice().sort());
const oid = value => assert.match(value, /^[0-9a-f]{40}$/);
const digest = value => assert.match(value, /^sha256:[0-9a-f]{64}$/);
const reference = value => assert.match(value, /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/);
const architecture = value => assert(['amd64', 'arm64'].includes(value));
const SHARED = '/opt/prismpm/share';
const SOCKET = 'unix:///var/run/docker.sock';

function regular(path, limit = 1024 * 1024) {
  assert.equal(realpathSync(path), resolve(path), 'unaliased evidence path required');
  assert(lstatSync(path).isFile(), 'regular evidence required');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert(before.isFile() && before.nlink === 1n && before.size <= BigInt(limit), 'bounded singly linked evidence required');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      assert(count > 0, 'evidence shortened'); offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0, 'evidence grew');
    for (const after of [fstatSync(fd, { bigint: true }), lstatSync(path, { bigint: true })]) {
      for (const key of ['dev', 'ino', 'size', 'mode', 'nlink', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { closeSync(fd); }
}

export function readRuntimeLock(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length < 16384);
  const lock = JSON.parse(bytes);
  assert.equal(bytes.toString(), canonical(lock) + '\n');
  keys(lock, ['images', 'schema']); assert.equal(lock.schema, 'prismpm/sdk-vv-runtime-inputs/1');
  keys(lock.images, ['buildkit', 'dind', 'distribution', 'zot']);
  for (const [name, image] of Object.entries(lock.images)) {
    keys(image, name === 'dind' ? ['reference', 'source', 'source_revision', 'version'] : ['reference']);
    reference(image.reference);
  }
  assert.equal(lock.images.dind.source, 'https://github.com/docker-library/docker');
  assert.equal(lock.images.dind.version, '28.4.0-dind'); oid(lock.images.dind.source_revision);
  return lock;
}

export function selectPlatform(bytes, expectedDigest, arch) {
  architecture(arch); digest(expectedDigest);
  assert(Buffer.isBuffer(bytes) && bytes.length <= 4 * 1024 * 1024);
  assert.equal('sha256:' + hash(bytes), expectedDigest, 'OCI index bytes differ');
  const value = JSON.parse(bytes);
  assert.equal(value.schemaVersion, 2);
  assert(['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'].includes(value.mediaType));
  assert(Array.isArray(value.manifests) && value.manifests.length > 0 && value.manifests.length <= 64);
  const found = value.manifests.filter(row => row.platform?.os === 'linux' && row.platform.architecture === arch);
  assert.equal(found.length, 1, 'exactly one native OCI child required');
  digest(found[0].digest); assert(Number.isSafeInteger(found[0].size) && found[0].size > 0 && found[0].size <= 4 * 1024 * 1024);
  assert(found[0].platform.variant === undefined || (arch === 'arm64' && found[0].platform.variant === 'v8'));
  return found[0];
}

export function validateLoadedImage(value, image, arch, configuration, revision, chain) {
  reference(image); architecture(arch); digest(configuration);
  assert.equal(value.Os, 'linux'); assert.equal(value.Architecture, arch);
  let store = 'classic';
  if (value.Descriptor !== undefined && value.Descriptor !== null) {
    assert(chain, 'descriptor image requires independently hashed OCI chain');
    assert.equal(chain.reference, image); assert.equal(chain.architecture, arch); assert.equal(chain.config_digest, configuration);
    const descriptor = value.Descriptor;
    assert(Object.keys(descriptor).every(key => ['digest', 'mediaType', 'size', 'platform', 'annotations'].includes(key)));
    const expected = [chain.index_descriptor, chain.child_descriptor].find(row => row.digest === descriptor.digest);
    assert(expected, 'image descriptor is outside the exact OCI chain');
    for (const key of ['digest', 'mediaType', 'size']) assert.equal(descriptor[key], expected[key]);
    assert.equal(value.Id, descriptor.digest, 'descriptor image ID differs');
    if (descriptor.platform !== undefined) {
      assert(Object.keys(descriptor.platform).every(key => ['os', 'architecture', 'variant'].includes(key)));
      assert.equal(descriptor.platform.os, 'linux'); assert.equal(descriptor.platform.architecture, arch);
      assert(descriptor.platform.variant === undefined || (arch === 'arm64' && descriptor.platform.variant === 'v8'));
    }
    if (descriptor.annotations !== undefined) {
      assert(descriptor.annotations && typeof descriptor.annotations === 'object' && !Array.isArray(descriptor.annotations));
      assert(Object.values(descriptor.annotations).every(value => typeof value === 'string'));
    }
    store = 'containerd';
  } else assert.equal(value.Id, configuration, 'classic image ID differs from OCI configuration');
  // Docker persists Hub references in familiar form. Only the implicit Hub
  // authority and its official-library namespace may be shortened; the exact
  // repository and digest remain bound, and no other registry is an alias.
  const identity = value => {
    reference(value);
    const [name, digest] = value.split('@'), parts = name.split('/');
    const explicit = parts.length > 1 && (/[.:]/.test(parts[0]) || parts[0] === 'localhost');
    const authority = explicit ? parts.shift() : 'docker.io';
    if (authority === 'docker.io' && parts.length === 1) parts.unshift('library');
    return `${authority}/${parts.join('/')}@${digest}`;
  };
  assert(Array.isArray(value.RepoDigests) && value.RepoDigests.some(row => identity(row) === identity(image)), 'distribution identity not preserved');
  if (revision !== undefined) {
    oid(revision); assert.equal(value.Config.Labels['org.opencontainers.image.revision'], revision);
    assert(value.Config.Volumes === null || value.Config.Volumes === undefined, 'SDK anonymous volumes prohibited');
  }
  return {id: value.Id, store};
}

// Moby 28.4 returns the index ID for default containerd inspection and
// container.Image, but the selected child ID for explicit platform inspection.
// A classic store has one configuration, already bound to the selected child
// and native architecture. Reinspect it without the API 1.49-only platform flag.
export async function inspectLoadedImage(call, chain, arch, revision) {
  const inspect = async platform => {
    const args = ['image', 'inspect', ...(platform ? ['--platform', `linux/${arch}`] : []), chain.reference];
    const rows = JSON.parse(successful(await call(args), 'inspect exact native image'));
    assert(Array.isArray(rows) && rows.length === 1);
    const result = validateLoadedImage(rows[0], chain.reference, arch, chain.config_digest, revision, chain);
    if (result.store === 'containerd') assert.equal(result.id, platform ? chain.child_descriptor.digest : chain.index_descriptor.digest);
    return result;
  };
  const stored = await inspect(false), selected = await inspect(stored.store === 'containerd');
  assert.equal(stored.store, selected.store, 'image store changed during inspection');
  return {id: stored.id, platform_id: selected.id, store: stored.store};
}

export function validateIsolation(value) {
  keys(value, ['interfaces', 'ipv4', 'ipv6', 'identity']);
  assert.match(value.identity, /^net:\[[1-9][0-9]*\]$/);
  assert(Array.isArray(value.interfaces) && value.interfaces.includes('lo'));
  assert.equal(new Set(value.interfaces).size, value.interfaces.length);
  for (const name of value.interfaces) assert(/^(?:lo|docker0|br-[a-f0-9]{12}|veth[a-f0-9]+)$/.test(name), `external interface ${name}`);
  const routes = value.ipv4.trim().split('\n');
  assert.match(routes.shift(), /^Iface\s+Destination\s+Gateway\s+Flags\s+/);
  for (const line of routes) {
    const fields = line.trim().split(/\s+/); assert.equal(fields.length, 11);
    assert(value.interfaces.includes(fields[0])); assert.match(fields[1], /^[0-9A-Fa-f]{8}$/);
    assert.match(fields[2], /^[0-9A-Fa-f]{8}$/); assert.notEqual(fields[1], '00000000', 'IPv4 default route prohibited');
    assert.equal(fields[2], '00000000', 'IPv4 gateway prohibited');
  }
  for (const line of value.ipv6.trim().split('\n').filter(Boolean)) {
    const fields = line.trim().split(/\s+/); assert.equal(fields.length, 10);
    assert.match(fields[0], /^[0-9a-f]{32}$/); assert.match(fields[1], /^[0-9a-f]{2}$/);
    assert.match(fields[4], /^[0-9a-f]{32}$/); assert.match(fields[8], /^[0-9a-f]{8}$/);
    assert(value.interfaces.includes(fields[9])); assert.equal(fields[4], '0'.repeat(32), 'IPv6 gateway prohibited');
    if (fields[0] === '0'.repeat(32) && fields[1] === '00') {
      assert(fields[9] === 'lo' && (parseInt(fields[8], 16) & 0x200) !== 0, 'IPv6 default route prohibited');
    }
  }
  return value;
}

export function sdkContainerArguments(name, image, socketGroup, workspace) {
  assert.match(name, /^prismpm-[a-z0-9-]{1,80}$/); reference(image);
  assert(Number.isSafeInteger(socketGroup) && socketGroup >= 0 && socketGroup <= 4294967294);
  assert.equal(workspace, '/workspace');
  return ['create', '--name', name, '--hostname', name, '--pull=never', '--network', 'host',
    '--dns', '127.0.0.1',
    '--user', '1000:1000', '--group-add', String(socketGroup), '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--pids-limit', '4096', '--init',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456,mode=1777',
    '--mount', 'type=bind,source=/workspace,target=/workspace',
    '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
    '--entrypoint', '/bin/sh', image, '-c', 'exec sleep infinity'];
}

export function validateExecution(bytes, originals, image, revision, arch) {
  reference(image); oid(revision); architecture(arch);
  assert(Buffer.isBuffer(bytes) && bytes.length <= 65536); const value = JSON.parse(bytes);
  assert.equal(bytes.toString(), canonical(value), 'original canonical execution bytes required');
  keys(value, ['schema', 'scope', 'source_revision', 'image_reference', 'process_architecture', 'inventory_sha256',
    'cli_sha256', 'input_policy_sha256', 'input_manifest_sha256', 'advisory_revision', 'runs', 'unclaimed']);
  assert.equal(value.schema, 'prismpm/sdk-vv-execution/1'); assert.equal(value.scope, 'two-full-vv-executions-only');
  assert.equal(value.image_reference, image); assert.equal(value.source_revision, revision);
  assert.equal(value.process_architecture, arch === 'amd64' ? 'x64' : 'arm64'); oid(value.advisory_revision);
  for (const key of ['inventory_sha256', 'cli_sha256', 'input_policy_sha256', 'input_manifest_sha256']) assert.match(value[key], /^[0-9a-f]{64}$/);
  assert.deepEqual(value.unclaimed, ['native-host', 'network-isolation', 'oci-image-identity', 'sdk-release', 'product-readiness']);
  assert(Array.isArray(value.runs) && value.runs.length === 2); assert.equal(originals.length, 2);
  for (const [index, raw] of originals.entries()) {
    validateVvEvidence(raw, revision);
    assert.deepEqual(value.runs[index], {run: index + 1, path: `run-${index + 1}/vv-evidence.json`, byte_length: raw.length, sha256: hash(raw)});
  }
  return value;
}

// Fixed CLI transport. Injection below is available only to owning unit tests.
export function execute(command, args, {environment, timeout = 120000, limit = 8 * 1024 * 1024} = {}) {
  return executeOwnedSdkCommand(command, args, {profile: 'vv', environment, timeout, limit, interruptions: true});
}
function successful(result, label) {
  assert.equal(result.signal, null, `${label} interrupted`);
  assert.equal(result.status, 0, `${label} failed: ${result.stderr.toString().slice(-4096)}`);
  return result.stdout;
}

export async function acquireImageMetadata(call, image, arch) {
  reference(image); architecture(arch);
  const index = successful(await call(['buildx', 'imagetools', 'inspect', '--raw', image]), 'read OCI index');
  const child = selectPlatform(index, image.split('@')[1], arch);
  const referenceChild = image.split('@')[0] + '@' + child.digest;
  const manifest = successful(await call(['buildx', 'imagetools', 'inspect', '--raw', referenceChild]), 'read OCI child');
  return validateImageMetadata(index, manifest, image, arch);
}

// Shared by the real installed-SDK orchestrator and native transport qualifier.
// This is acquisition only: the caller must separately retire the actual reader.
export async function acquireOwnedImageMetadata(reader, image, arch) {
  const index = await readSdkRegistryManifest(reader, image);
  const child = selectPlatform(index, image.split('@')[1], arch);
  const manifest = await readSdkRegistryManifest(reader, image.split('@')[0] + '@' + child.digest);
  return {index, manifest, metadata: validateImageMetadata(index, manifest, image, arch)};
}

export function validateImageMetadata(index, manifest, image, arch) {
  reference(image); architecture(arch);
  const child = selectPlatform(index, image.split('@')[1], arch);
  assert(Buffer.isBuffer(manifest) && manifest.length <= 4 * 1024 * 1024);
  assert.equal(manifest.length, child.size); assert.equal('sha256:' + hash(manifest), child.digest);
  const parsed = JSON.parse(manifest); assert.equal(parsed.schemaVersion, 2); digest(parsed.config?.digest);
  assert(['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'].includes(parsed.mediaType));
  assert.equal(child.mediaType, parsed.mediaType, 'OCI child descriptor media type differs');
  assert(Number.isSafeInteger(parsed.config.size) && parsed.config.size > 0 && parsed.config.size <= 4 * 1024 * 1024);
  assert(Array.isArray(parsed.layers) && parsed.layers.length <= 256);
  let compressed = 0;
  for (const layer of parsed.layers) { digest(layer.digest); assert(Number.isSafeInteger(layer.size) && layer.size >= 0); compressed += layer.size; }
  assert(Number.isSafeInteger(compressed) && compressed <= 64 * 1024 ** 3);
  return {reference: image, child_digest: child.digest, config_digest: parsed.config.digest, architecture: arch,
    index_descriptor: {digest: image.split('@')[1], mediaType: JSON.parse(index).mediaType, size: index.length},
    child_descriptor: {digest: child.digest, mediaType: child.mediaType, size: child.size},
    compressed_bytes: compressed, index_sha256: hash(index), manifest_sha256: hash(manifest), annotations: child.annotations ?? {}};
}

function nativeBasis(arch, environment) {
  architecture(arch);
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'acceptance requires the independently selected hosted CI runner');
  assert.equal(environment.RUNNER_ENVIRONMENT, 'github-hosted'); assert.equal(environment.RUNNER_OS, 'Linux');
  assert.equal(environment.RUNNER_ARCH, arch === 'amd64' ? 'X64' : 'ARM64');
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, arch === 'amd64' ? 'x64' : 'arm64');
  assert.match(environment.GITHUB_RUN_ID, /^[0-9]+$/); assert.match(environment.GITHUB_RUN_ATTEMPT, /^[0-9]+$/);
  return {basis: 'trusted-hosted-ci-runner-and-matching-native-executable', runner_os: environment.RUNNER_OS,
    runner_architecture: environment.RUNNER_ARCH, run_id: environment.GITHUB_RUN_ID, run_attempt: environment.GITHUB_RUN_ATTEMPT,
    hardware_attestation: 'not-established'};
}

// All callers get the same fixed operations; there is no configurable command,
// acceptance shortcut, alternate evidence path or public unit-transport option.
export async function runOuter({image, revision, arch, destination, source, registryCertificate}, transport = execute, environment = process.env) {
  reference(image); oid(revision); architecture(arch);
  const native = nativeBasis(arch, environment);
  assert.equal(environment.GITHUB_SHA, revision); source = realpathSync(source); destination = resolve(destination);
  assert.equal(realpathSync(dirname(destination)), dirname(destination));
  assert(!lstatSync(destination, {throwIfNoEntry: false}), 'fresh evidence directory required');
  const lockBytes = regular(join(source, 'sdk/vv-runtime.lock.json')), lock = readRuntimeLock(lockBytes);
  const space = statfsSync(dirname(destination));
  assert(space.bavail * space.bsize >= 12 * 1024 ** 3, '12 GiB reserve required before image planning');
  mkdirSync(destination, {mode: 0o700}); mkdirSync(join(destination, 'docker'), {mode: 0o700});
  const nonce = randomBytes(12).toString('hex'), prefix = `prismpm-vv-${nonce}`, owner = 'org.uor.prismpm.vv-owner';
  const names = {daemon: `${prefix}-daemon`, control: `${prefix}-control`, sdk: `${prefix}-sdk`, network: `${prefix}-bootstrap`,
    data: `${prefix}-data`, socket: `${prefix}-socket`, work: `${prefix}-work`};
  const sanitized = {PATH: environment.PATH, HOME: join(destination, 'docker'), DOCKER_CONFIG: join(destination, 'docker'), LANG: 'C', LC_ALL: 'C'};
  let sequence = 0, interrupted, cleaning = false, registryReader, registryRetired = false, registryEvidence, registryCa, registryDirectory;
  const registryController = new AbortController();
  const handlers = ['SIGHUP', 'SIGINT', 'SIGTERM'].map(signal => [signal, () => {
    interrupted ??= Error(`outer verification interrupted by ${signal}`); registryController.abort(interrupted);
  }]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const call = async (args, options = {}) => {
    if (interrupted && !cleaning) throw interrupted;
    const number = String(++sequence).padStart(4, '0'); let result, failure;
    try { result = await transport('docker', ['--host', SOCKET, '--config', join(destination, 'docker'), ...args], {environment: sanitized, ...options}); }
    catch (error) { failure = error; result = error.result; if (!result) throw error; }
    writeFileSync(join(destination, `${number}.stdout`), result.stdout, {flag: 'wx', mode: 0o600});
    writeFileSync(join(destination, `${number}.stderr`), result.stderr, {flag: 'wx', mode: 0o600});
    writeFileSync(join(destination, `${number}.json`), canonical({arguments: args, status: result.status, signal: result.signal,
      stdout_sha256: hash(result.stdout), stderr_sha256: hash(result.stderr),
      ...(result.retirement ? {process_retirement: result.retirement} : {})}), {flag: 'wx', mode: 0o600});
    if (failure) throw failure;
    if (interrupted && !cleaning) throw interrupted;
    assert.equal(result.signal, null, 'Docker transport interrupted');
    return result;
  };
  const owned = [], phases = []; let resultRecord, failure;
  const own = async (kind, name, args) => {
    // A random name is not a substitute for proving fresh ownership.
    const prior = await call([kind, 'inspect', name]); assert.notEqual(prior.status, 0, 'resource already exists');
    // A create response can be lost after Docker has created the resource.
    owned.push({kind, name});
    const result = await call(args); successful(result, `create ${kind}`);
    return result.stdout.toString().trim();
  };
  const outer = async (args, options) => successful(await call(args, options), args.slice(0, 2).join(' '));
  const inside = (args, options) => call(['exec', names.daemon, 'docker', '--host', SOCKET, ...args], options);
  const inner = async (args, options) => successful(await inside(args, options), `isolated ${args.slice(0, 2).join(' ')}`);
  const sdk = async (args, options) => successful(await inside(['exec', names.sdk, ...args], options), 'SDK probe');
  const probePath = `${SHARED}/conformance-root/scripts/sdk-vv-probe.mjs`;
  const namespace = async () => {
    const interfaces = (await outer(['exec', names.daemon, 'cat', '/proc/net/dev'])).toString().split('\n').slice(2)
      .filter(line => line.includes(':')).map(line => line.split(':')[0].trim()).sort();
    return validateIsolation({interfaces, ipv4: (await outer(['exec', names.daemon, 'cat', '/proc/net/route'])).toString(),
      ipv6: (await outer(['exec', names.daemon, 'cat', '/proc/net/ipv6_route'])).toString(),
      identity: (await outer(['exec', names.daemon, 'readlink', '/proc/self/ns/net'])).toString().trim()});
  };
  try {
    if (registryCertificate !== undefined) {
      registryReader = createSdkRegistryReader(image, registryCertificate, {signal: registryController.signal});
      registryCa = sdkRegistryCertificate(registryReader);
      registryDirectory = join(destination, 'docker', 'registry-trust'); mkdirSync(registryDirectory, {mode: 0o700});
      writeFileSync(join(registryDirectory, 'ca.crt'), registryCa, {flag: 'wx', mode: 0o444});
      assert.deepEqual(regular(join(registryDirectory, 'ca.crt'), 65536), registryCa);
    }
    const ownedMetadata = async () => {
      const {index, manifest, metadata} = await acquireOwnedImageMetadata(registryReader, image, arch);
      registryEvidence = {authority: registryReader.authority, ca_sha256: registryReader.ca_sha256,
        ca_pem: registryCa.toString('ascii'), original_index_base64: index.toString('base64'),
        original_manifest_base64: manifest.toString('base64'),
        outer_roots: 'explicit-ca-only', daemon_roots: 'system-roots-plus-exact-authority-ca',
        provenance: 'TLS identity only; independently admitted construction digest remains required'};
      return metadata;
    };
    const metadata = await Promise.allSettled(Object.entries({...lock.images, sdk: {reference: image}}).map(async ([id, row]) =>
      [id, await (id === 'sdk' && registryReader ? ownedMetadata() : acquireImageMetadata(call, row.reference, arch))]));
    if (registryReader) {
      const retirement = closeSdkRegistryReader(registryReader); registryRetired = true;
      if (registryEvidence) registryEvidence.transport = retirement;
    }
    for (const result of metadata) if (result.status === 'rejected') throw result.reason;
    const expected = Object.fromEntries(metadata.map(result => result.value));
    assert.equal(expected.dind.annotations['org.opencontainers.image.revision'], lock.images.dind.source_revision);
    assert.equal(expected.dind.annotations['org.opencontainers.image.version'], lock.images.dind.version);
    // Expanded layers and independent Cargo/build roots need additional space;
    // this deliberately conservative bound is not permission to exhaust disk.
    const imageBytes = Object.values(expected).reduce((sum, row) => sum + row.compressed_bytes, 0);
    // Metadata acquisition is asynchronous; its earlier admission cannot
    // authorize image expansion after another writer consumes this filesystem.
    const imageSpace = statfsSync(dirname(destination));
    assert(imageSpace.bavail * imageSpace.bsize >= imageBytes * 4 + 12 * 1024 ** 3, 'insufficient disk for isolated image closure and reserve');
    writeFileSync(join(destination, 'image-plan.json'), canonical(expected), {flag: 'wx'});
    await outer(['pull', '--platform', `linux/${arch}`, lock.images.dind.reference], {timeout: 1200000});
    await inspectLoadedImage(call, expected.dind, arch);
    for (const name of [names.data, names.socket, names.work]) await own('volume', name, ['volume', 'create', '--label', `${owner}=${nonce}`, name]);
    await own('network', names.network, ['network', 'create', '--label', `${owner}=${nonce}`, names.network]);
    await own('container', names.daemon, ['create', '--name', names.daemon, '--label', `${owner}=${nonce}`, '--privileged',
      '--network', names.network, '--env', 'DOCKER_TLS_CERTDIR=', '--mount', `type=volume,source=${names.data},target=/var/lib/docker`,
      '--mount', `type=volume,source=${names.socket},target=/var/run`, '--mount', `type=volume,source=${names.work},target=/workspace`,
      ...(registryReader ? ['--mount', `type=bind,source=${registryDirectory},target=/etc/docker/certs.d/${registryReader.authority},readonly`] : []),
      lock.images.dind.reference, 'dockerd', '--host=' + SOCKET, '--data-root=/var/lib/docker', '--dns=127.0.0.1']);
    await outer(['start', names.daemon]);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const response = await inside(['info', '--format', '{{json .}}']);
      if (response.status === 0) {
        const info = JSON.parse(response.stdout); assert.equal(info.ServerVersion, '28.4.0'); assert.equal(info.DefaultRuntime, 'runc');
        assert.equal(info.Containers, 0); assert.equal(info.Images, 0); ready = true; break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert(ready, 'fresh isolated daemon unavailable');
    assert.equal((await outer(['exec', names.daemon, 'find', '/workspace', '-mindepth', '1', '-maxdepth', '1', '-print', '-quit'])).length, 0);
    await outer(['exec', names.daemon, 'chown', '1000:1000', '/workspace']);
    const loadedIdentities = {};
    for (const id of ['sdk', 'zot', 'buildkit', 'distribution']) {
      if (id === 'sdk' && registryReader) {
        assert.deepEqual(regular(join(registryDirectory, 'ca.crt'), 65536), registryCa, 'held SDK registry CA changed');
        const path = `/etc/docker/certs.d/${registryReader.authority}/ca.crt`;
        assert.deepEqual(await outer(['exec', names.daemon, 'cat', path]), registryCa, 'isolated daemon SDK registry CA differs');
        registryEvidence.daemon_ca_path = path;
        registryEvidence.daemon_ca_sha256 = hash(registryCa);
      }
      await inner(['pull', '--platform', `linux/${arch}`, expected[id].reference], {timeout: 1200000});
      loadedIdentities[id] = await inspectLoadedImage(inside, expected[id], arch, id === 'sdk' ? revision : undefined);
    }
    const loaded = (await inner(['image', 'ls', '--quiet', '--no-trunc'])).toString().trim().split('\n');
    assert.deepEqual([...new Set(loaded)].sort(), Object.values(loadedIdentities).map(row => row.id).sort());
    writeFileSync(join(destination, 'loaded-identities.json'), canonical(loadedIdentities), {flag: 'wx'});
    phases.push('exact-native-images-acquired');
    await own('container', names.control, ['create', '--name', names.control, '--label', `${owner}=${nonce}`, '--network', names.network,
      '--tmpfs', '/var/lib/docker:rw,nosuid,nodev,size=16777216,mode=0700',
      '--entrypoint', '/bin/sh', lock.images.dind.reference, '-ec', 'mkdir /tmp/control; printf prismpm-network-control >/tmp/control/index.html; exec httpd -f -p 8080 -h /tmp/control']);
    await outer(['start', names.control]);
    const control = JSON.parse(await outer(['inspect', names.control]))[0].NetworkSettings.Networks[names.network].IPAddress;
    assert.match(control, /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/);
    const url = `http://${control}:8080/`;
    let controlReady = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await call(['exec', names.daemon, 'wget', '-T', '2', '-q', '-O', '-', url]);
      if (response.status === 0 && response.stdout.toString() === 'prismpm-network-control') { controlReady = true; break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert(controlReady, 'online egress control must be independently reachable before disconnect');
    await outer(['network', 'disconnect', names.network, names.daemon]);
    const disconnected = JSON.parse(await outer(['inspect', names.daemon]))[0];
    assert.deepEqual(disconnected.NetworkSettings.Networks, {});
    // Only this owned daemon's runtime resolver changes. Prevent Docker's
    // embedded resolver from retaining an outer-daemon forwarding path.
    await outer(['exec', names.daemon, 'sh', '-ec',
      "printf '%s\\n' 'nameserver 127.0.0.1' 'options timeout:1 attempts:1' > /etc/resolv.conf"]);
    assert.equal((await outer(['exec', names.daemon, 'cat', '/etc/resolv.conf'])).toString(), isolatedResolver);
    const firstNamespace = await namespace(); phases.push('external-network-disconnected');
    const group = Number((await outer(['exec', names.daemon, 'stat', '-c', '%g', '/var/run/docker.sock'])).toString().trim());
    await inner(sdkContainerArguments(names.sdk, image, group, '/workspace')); await inner(['start', names.sdk]);
    const ownImage = (await sdk(['docker', '--host', SOCKET, 'inspect', names.sdk, '--format', '{{.Image}}'])).toString().trim();
    assert.equal(ownImage, loadedIdentities.sdk.id);
    const boundPaths = ['scripts/sdk-vv-run.mjs', 'scripts/sdk-vv-probe.mjs', 'scripts/sdk-vv-check.mjs',
      'scripts/sdk-command-owner.mjs', 'scripts/sdk-command-owner.py',
      'scripts/sdk-vv-outer.sh',
      'scripts/sdk-bootstrap-retention.mjs', 'scripts/bootstrap-evidence.mjs', 'scripts/sdk-registry-reader.mjs', 'sdk/vv-runtime.lock.json'];
    for (const path of boundPaths) assert.deepEqual(await sdk(['cat', `${SHARED}/conformance-root/${path}`]), regular(join(source, path)), 'installed outer/inner source differs');
    const elf = JSON.parse(await sdk(['node', probePath, 'native']));
    assert.deepEqual(elf, {architecture: arch, process_architecture: arch === 'amd64' ? 'x64' : 'arm64'});
    const checkNetwork = async () => {
      assert.equal((await outer(['exec', names.control, 'wget', '-T', '2', '-q', '-O', '-', 'http://127.0.0.1:8080/'])).toString(),
        'prismpm-network-control', 'external control must remain alive');
      const state = await namespace();
      const sdkState = validateIsolation(JSON.parse(await sdk(['node', probePath, 'namespace'])));
      assert.deepEqual(sdkState, state, 'SDK must share isolated daemon namespace');
      const daemonResolver = (await outer(['exec', names.daemon, 'cat', '/etc/resolv.conf'])).toString();
      assert.equal(daemonResolver, isolatedResolver);
      const sdkResolver = (await sdk(['cat', '/etc/resolv.conf'])).toString(); validateResolver(sdkResolver);
      const denied = await call(['exec', names.daemon, 'wget', '-T', '2', '-q', '-O', '-', url]);
      assert.equal(denied.signal, null); assert.notEqual(denied.status, 0); assert.notEqual(denied.stdout.toString(), 'prismpm-network-control');
      const connectivity = JSON.parse(await sdk(['node', probePath, 'connectivity', control, '8080']));
      assert.deepEqual(connectivity, {local_tcp: 'passed', bootstrap_tcp: 'blocked', external_dns: 'blocked'});
      return {namespace: state, sdk: connectivity, daemon_bootstrap_tcp: 'blocked',
        resolver: {daemon: daemonResolver, sdk: sdkResolver, daemon_sha256: hash(daemonResolver), sdk_sha256: hash(sdkResolver)}};
    };
    const before = await checkNetwork();
    phases.push('isolated-native-sdk-probed');
    const run = await inside(['exec', names.sdk, 'node', `${SHARED}/conformance-root/scripts/sdk-vv-run.mjs`,
      'run', image, revision, '/workspace/run'], {timeout: 14400000, limit: 64 * 1024 * 1024});
    successful(run, 'two installed full VV runs');
    const after = await checkNetwork();
    const bytes = await sdk(['cat', '/workspace/run/evidence/execution.json']);
    const originals = [];
    for (const run of [1, 2]) originals.push(await sdk(['cat', `/workspace/run/evidence/run-${run}/vv-evidence.json`]));
    const execution = validateExecution(bytes, originals, image, revision, arch);
    const bootstrap = await sdk(['cat', '/workspace/run/evidence/bootstrap.json']);
    const bootstrapFiles = new Map();
    for (const run of [1, 2]) for (const name of bootstrapNames) {
      const path = `run-${run}-${name}`;
      bootstrapFiles.set(path, await sdk(['cat', `/workspace/run/evidence/${path}`], {limit: 64 * 1024 * 1024}));
    }
    validateBootstrapRetention(bootstrap, bootstrapFiles, revision);
    for (const [path, original] of [...bootstrapFiles, ['bootstrap.json', bootstrap]]) {
      writeFileSync(join(destination, path), original, {flag: 'wx', mode: 0o444});
    }
    for (const [key, path] of [['inventory_sha256', 'inventory.json'], ['input_policy_sha256', 'vv-input-policy.json'], ['input_manifest_sha256', 'vv-inputs/manifest.json']]) {
      assert.equal(hash(await sdk(['cat', `${SHARED}/${path}`], {limit: 64 * 1024 * 1024})), execution[key]);
    }
    assert.equal(hash(await sdk(['cat', '/usr/local/bin/prismpm'], {limit: 256 * 1024 * 1024})), execution.cli_sha256);
    const policy = JSON.parse(await sdk(['cat', `${SHARED}/vv-input-policy.json`]));
    assert.equal(policy.source_revision, revision); assert.equal(policy.advisory_revision, execution.advisory_revision);
    for (const [index, original] of originals.entries()) writeFileSync(join(destination, `run-${index + 1}.json`), original, {flag: 'wx', mode: 0o444});
    writeFileSync(join(destination, 'execution.json'), bytes, {flag: 'wx', mode: 0o444});
    phases.push('both-full-vv-records-verified');
    if (registryReader) {
      assert.deepEqual(regular(join(registryDirectory, 'ca.crt'), 65536), registryCa, 'held SDK registry CA changed after execution');
      assert.deepEqual(await outer(['exec', names.daemon, 'cat', registryEvidence.daemon_ca_path]), registryCa,
        'isolated daemon SDK registry CA changed after execution');
    }
    resultRecord = {schema: 'prismpm/sdk-installed-vv-check/1', status: 'passed', scope: 'isolated-installed-two-run-vv',
      source_revision: revision, image_reference: image, architecture: arch, native_execution: native,
      images: expected, runtime_lock_sha256: hash(lockBytes), before, after, initial_namespace: firstNamespace,
      execution_sha256: hash(bytes), phases, ...(registryEvidence ? {sdk_registry_transport: registryEvidence} : {}),
      unclaimed: ['hardware-attestation', 'sdk-release', 'product-readiness']};
  } catch (error) { failure = error; }
  finally {
    cleaning = true;
    if (registryReader && !registryRetired) {
      try { closeSdkRegistryReader(registryReader); registryRetired = true; } catch (error) { failure ??= error; }
    }
    for (const resource of owned.reverse()) {
      try {
        const inspection = JSON.parse(await outer([resource.kind, 'inspect', resource.name]))[0];
        const labels = resource.kind === 'container' ? inspection.Config.Labels : inspection.Labels;
        assert.equal(labels[owner], nonce, 'resource ownership changed; cleanup refused');
        await outer([resource.kind, 'rm', ...(resource.kind === 'container' ? ['--force', '--volumes'] : []), resource.name]);
      } catch (error) { failure ??= error; }
    }
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
  failure ??= interrupted;
  if (failure) throw failure;
  phases.push('owned-resources-removed');
  writeFileSync(join(destination, 'acceptance.json'), canonical(resultRecord), {flag: 'wx', mode: 0o444});
  return resultRecord;
}

export function validateOwningTests(result) {
  successful(result, 'owning orchestrator tests');
  assert.equal(verifyTap(result.stdout.toString(), 20), 20, 'exact complete owning test set');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, image, revision, arch, destination, ...extra] = process.argv.slice(2);
  if (operation === 'tests' && process.argv.length === 3) {
    const environment = {...process.env}; delete environment.NODE_TEST_CONTEXT;
    const result = await execute(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-timeout=120000',
      resolve(dirname(process.argv[1]), 'sdk-vv-check.test.mjs')], {environment, timeout: 150000, limit: 16 * 1024 * 1024});
    process.stdout.write(result.stdout); process.stderr.write(result.stderr); validateOwningTests(result);
    const supervision = await execute(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-timeout=120000',
      resolve(dirname(process.argv[1]), 'sdk-command-owner.test.mjs')], {environment, timeout: 150000, limit: 16 * 1024 * 1024});
    process.stdout.write(supervision.stdout); process.stderr.write(supervision.stderr); successful(supervision, 'SDK command supervisor owning tests');
    assert.equal(verifyTap(supervision.stdout.toString(), 12), 12, 'complete SDK command supervisor owning test set');
    const tls = await execute(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-timeout=120000',
      resolve(dirname(process.argv[1]), 'sdk-registry-reader.test.mjs')], {environment, timeout: 150000, limit: 16 * 1024 * 1024});
    process.stdout.write(tls.stdout); process.stderr.write(tls.stderr); successful(tls, 'SDK registry transport owning tests');
    assert.equal(verifyTap(tls.stdout.toString(), 10), 10, 'complete SDK registry transport owning test set');
    const qualification = await execute(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-timeout=120000',
      resolve(dirname(process.argv[1]), 'sdk-registry-qualification.test.mjs')], {environment, timeout: 150000, limit: 16 * 1024 * 1024});
    process.stdout.write(qualification.stdout); process.stderr.write(qualification.stderr); successful(qualification, 'SDK registry qualification owning tests');
    assert.equal(verifyTap(qualification.stdout.toString(), 17), 17, 'complete SDK registry qualification owning test set');
  } else {
    assert(['run', 'run-owned-registry'].includes(operation));
    assert(image && revision && arch && destination && extra.length === (operation === 'run' ? 0 : 1),
      'usage: sdk-vv-check.mjs tests | run IMAGE@sha256:DIGEST SOURCE_COMMIT ARCH FRESH_OUTPUT | run-owned-registry IMAGE@sha256:DIGEST SOURCE_COMMIT ARCH FRESH_OUTPUT CA_PEM');
    const registryCertificate = operation === 'run-owned-registry' ? regular(resolve(extra[0]), 65536) : undefined;
    console.log(canonical(await runOuter({image, revision, arch, destination, registryCertificate,
      source: resolve(dirname(process.argv[1]), '..')})));
  }
}
