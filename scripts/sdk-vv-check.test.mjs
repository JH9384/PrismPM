// These unit adapters validate orchestration, never installed SDK acceptance.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import {createServer as createTlsServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {networkInterfaces} from 'node:os';
import test from 'node:test';
import {bootstrapFixture} from './sdk-bootstrap-retention-fixture.mjs';
import { selectPlatform, validateIsolation, validateLoadedImage, validateExecution,
  sdkContainerArguments, readRuntimeLock, runOuter, execute, acquireImageMetadata, inspectLoadedImage, validateOwningTests } from './sdk-vv-check.mjs';
import { inspectNativeExecutable, connect, connectivity, validateResolver, isolatedResolver } from './sdk-vv-probe.mjs';

const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const revision = 'a'.repeat(40), config = 'sha256:' + 'b'.repeat(64);
const image = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:' + 'c'.repeat(64);
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

test('platform selection binds actual index bytes and rejects duplicate or wrong native children', () => {
  const child = { digest: config, size: 123, mediaType: 'application/vnd.oci.image.manifest.v1+json', platform: { os: 'linux', architecture: 'amd64' } };
  const bytes = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [child]}));
  assert.deepEqual(selectPlatform(bytes, digest(bytes), 'amd64'), child);
  assert.throws(() => selectPlatform(bytes, digest(Buffer.from('other')), 'amd64'));
  assert.throws(() => selectPlatform(bytes, digest(bytes), 'arm64'));
  const duplicated = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [child, child]}));
  assert.throws(() => selectPlatform(duplicated, digest(duplicated), 'amd64'));
});

test('the actual outer shell refuses foreign ownership and reconciles only authenticated creation files', async t => {
  // Explicit Docker boundary units, not image/SDK/full-VV qualification. The
  // shipped wrapper itself executes in Bash; only the daemon is a fixture.
  const docker = String.raw`#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$UNIT_ROOT/docker.commands"
cid=$(printf 'd%.0s' {1..64}); iid=sha256:$(printf 'e%.0s' {1..64})
case "$1:$2" in
  container:inspect)
    reference=$3
    if test "$UNIT_MODE" = create-renamed && test "$reference" != "$cid"; then
      echo "Error: No such container: $reference" >&2; exit 1
    fi
    if test -f "$UNIT_ROOT/container.exists"; then
      format=; if test "$#" -ge 5; then format=$5; fi
      case "$format" in
        '{{.Id}}') printf '%s\n' "$cid" ;;
        '{{index .Config.Labels "org.uor.prismpm.sdk-outer"}}')
          if test "$UNIT_MODE" = wrong-label; then echo foreign
          elif test "$UNIT_MODE" = foreign-matching-label; then cat "$UNIT_ROOT/sdk-$UNIT_ARCH-full-sdk-vv-outer-owner/owner.name"
          else cat "$UNIT_ROOT/owner"; fi ;;
        '{{.State.Running}}') echo false ;;
        '{{.State.ExitCode}}') echo 0 ;;
        '{{.State.OOMKilled}}') echo false ;;
        '') echo '[{"unit_only":true}]' ;;
        *) exit 99 ;;
      esac
    else echo "Error: No such container: $reference" >&2; exit 1; fi ;;
  image:inspect)
    if test -f "$UNIT_ROOT/image.exists"; then
      if test "$UNIT_MODE" = build-wrong-tag; then printf 'sha256:'; printf 'f%.0s' {1..64}; printf '\n'; else printf '%s\n' "$iid"; fi
    else echo "Error: No such image: $3" >&2; exit 1; fi ;;
  buildx:build)
    shift 2; file= tag=
    while test "$#" -gt 0; do
      case "$1" in --iidfile) file=$2; shift 2 ;; --tag) tag=$2; shift 2 ;; *) shift ;; esac
    done
    test -n "$file"; test -n "$tag"; touch "$UNIT_ROOT/image.exists"
    case "$UNIT_MODE" in
      build-missing-id|build-success-missing-id) ;;
      build-malformed-id) echo malformed > "$file" ;;
      *) printf '%s\n' "$iid" > "$file" ;;
    esac
    case "$UNIT_MODE" in build-partial|build-missing-id) echo partial; exit 1 ;; esac ;;
  container:create)
    shift 2; file= owner=
    while test "$#" -gt 0; do
      case "$1" in --cidfile) file=$2; shift 2 ;; --name) owner=$2; shift 2 ;; *) shift ;; esac
    done
    printf '%s\n' "$owner" > "$UNIT_ROOT/owner"; touch "$UNIT_ROOT/container.exists"
    if test "$UNIT_MODE" != create-missing-id; then
      if test "$UNIT_MODE" = wrong-id; then printf 'f%.0s' {1..64} > "$file"; printf '\n' >> "$file"
      else printf '%s\n' "$cid" > "$file"; fi
    fi
    case "$UNIT_MODE" in create-partial|create-missing-id|create-renamed) echo partial; exit 1 ;; esac
    printf '%s\n' "$cid" ;;
  container:start) test "$3" = --attach ;;
  container:rm)
    test "$3" = --force; test "$4" = --volumes; test "$5" = "$cid"
    rm "$UNIT_ROOT/container.exists" ;;
  image:rm) rm "$UNIT_ROOT/image.exists" ;;
  *) exit 99 ;;
esac
`;
  const script = String.raw`set -euo pipefail
cd "$UNIT_ROOT"
git() { case "$*" in *'rev-parse HEAD') printf '%s\n' "$UNIT_REVISION" ;; *'status --porcelain') ;; *) return 99 ;; esac; }
df() { printf 'Avail\n30064771072\n'; }
stat() { printf '1000\n'; }
cat() { if test "$*" = /proc/sys/kernel/random/uuid; then echo 01234567-89ab-cdef-0123-456789abcdef; else command cat "$@"; fi; }
export -f git df stat cat
/bin/bash root-a/scripts/sdk-vv-outer.sh "$UNIT_IMAGE" "$UNIT_REVISION" "$UNIT_ARCH" "sdk-$UNIT_ARCH-full-sdk-vv"
`;
  for (const mode of ['complete', 'foreign-container', 'foreign-matching-label', 'foreign-tag', 'create-partial', 'create-renamed', 'create-missing-id',
    'wrong-label', 'wrong-id', 'build-partial', 'build-missing-id', 'build-success-missing-id',
    'build-malformed-id', 'build-wrong-tag']) {
    const dir = mkdtempSync(join(tmpdir(), 'prismpm-outer-lifecycle-unit-'));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    mkdirSync(join(dir, 'bin')); mkdirSync(join(dir, 'root-a/scripts'), {recursive: true});
    writeFileSync(join(dir, 'bin/docker'), docker, {mode: 0o700});
    writeFileSync(join(dir, 'root-a/scripts/sdk-vv-outer.sh'), readFileSync(new URL('./sdk-vv-outer.sh', import.meta.url)));
    if (['foreign-container', 'foreign-matching-label'].includes(mode)) {writeFileSync(join(dir, 'container.exists'), ''); writeFileSync(join(dir, 'owner'), 'foreign');}
    if (mode === 'foreign-tag') writeFileSync(join(dir, 'image.exists'), '');
    const architecture = process.arch === 'x64' ? 'amd64' : 'arm64';
    const result = await execute('/bin/bash', ['--noprofile', '--norc', '-c', script], {timeout: 10000,
      environment: {...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, UNIT_ROOT: dir,
        UNIT_MODE: mode, UNIT_REVISION: revision, UNIT_IMAGE: image, UNIT_ARCH: architecture,
        GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1'}});
    assert.equal(result.signal, null, mode);
    assert.equal(result.status, mode === 'complete' ? 0 : 1, mode + ': ' + result.stderr);
    const commands = readFileSync(join(dir, 'docker.commands'), 'utf8');
    const containerRemoved = /^container rm /m.test(commands), imageRemoved = /^image rm /m.test(commands);
    assert.equal(containerRemoved, ['complete', 'create-partial', 'create-renamed'].includes(mode), mode + ': immutable container authority');
    assert.equal(imageRemoved, ['complete', 'create-partial', 'create-renamed', 'build-partial'].includes(mode), mode + ': immutable image authority');
    if (mode.startsWith('foreign-')) assert(!/^buildx build /m.test(commands), 'collision must be refused before building');
    if (['foreign-container', 'foreign-matching-label'].includes(mode)) assert(existsSync(join(dir, 'container.exists')), 'rejected foreign container must survive');
    if (mode === 'foreign-tag') assert(existsSync(join(dir, 'image.exists')), 'rejected foreign tag must survive');
    const evidence = join(dir, `sdk-${architecture}-full-sdk-vv-outer-owner`);
    assert.equal(readFileSync(join(evidence, 'cleanup.status'), 'utf8').trim(), String(result.status));
    if (['complete', 'create-partial', 'create-renamed', 'build-partial'].includes(mode)) {
      assert.equal(readFileSync(join(evidence, 'cleanup-owned.status'), 'utf8').trim(), '0');
      assert(!existsSync(join(dir, 'container.exists'))); assert(!existsSync(join(dir, 'image.exists')));
    } else {
      assert.equal(readFileSync(join(evidence, 'cleanup-owned.status'), 'utf8').trim(), '1');
    }
  }
});

test('isolation refuses uplinks and all IPv4 or IPv6 egress routes', () => {
  const isolated = { identity: 'net:[123]', interfaces: ['lo', 'docker0', 'br-123456789abc'], ipv4: 'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\ndocker0 000011AC 00000000 0001 0 0 0 0000FFFF 0 0 0\n', ipv6: '00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 ffffffff 00000001 00000000 00200200 lo\n' };
  validateIsolation(isolated);
  for (const mutated of [
    { ...isolated, interfaces: [...isolated.interfaces, 'eth0'] },
    { ...isolated, ipv4: isolated.ipv4 + 'docker0 00000000 010011AC 0003 0 0 0 00000000 0 0 0\n' },
    { ...isolated, ipv6: isolated.ipv6.replace('00200200 lo', '00000001 docker0') },
    { ...isolated, ipv4: 'malformed' }, { ...isolated, interfaces: [] }, { ...isolated, identity: 'unknown' },
  ]) assert.throws(() => validateIsolation(mutated));
});

test('loaded-image checks bind distribution reference, native configuration and current source', async () => {
  const value = { Id: config, Os: 'linux', Architecture: 'amd64', RepoDigests: [image],
    Config: { Labels: { 'org.opencontainers.image.revision': revision }, Volumes: null } };
  validateLoadedImage(value, image, 'amd64', config, revision);
  // Docker's containerd image store returns descriptor IDs, not config IDs.
  // These are unit metadata fixtures; the independently captured Docker 29
  // transcript is diagnostic evidence, not installed SDK acceptance.
  const chain = {reference: image, architecture: 'amd64', config_digest: config,
    index_descriptor: {mediaType: 'application/vnd.oci.image.index.v1+json', digest: image.split('@')[1], size: 493},
    child_descriptor: {mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: 'sha256:' + 'e'.repeat(64), size: 4045}};
  for (const descriptor of [chain.index_descriptor, chain.child_descriptor]) {
    const modern = {...value, Id: descriptor.digest, Descriptor: descriptor};
    validateLoadedImage(modern, image, 'amd64', config, revision, chain);
    for (const changed of [
      {...modern, Id: config}, {...modern, Descriptor: {...descriptor, mediaType: 'unknown'}},
      {...modern, Descriptor: {...descriptor, digest: config}}, {...modern, Descriptor: {...descriptor, size: descriptor.size + 1}},
      {...modern, Descriptor: {...descriptor, platform: {os: 'linux', architecture: 'arm64'}}},
      {...modern, Architecture: 'arm64'}, {...modern, Descriptor: null},
    ]) assert.throws(() => validateLoadedImage(changed, image, 'amd64', config, revision, chain));
    assert.throws(() => validateLoadedImage(modern, image, 'amd64', config, revision));
    assert.throws(() => validateLoadedImage(modern, image, 'amd64', config, revision, {...chain, config_digest: descriptor.digest}));
  }
  for (const store of ['classic', 'containerd']) {
    const inspect = async fault => {
      let requests = 0;
      const result = await inspectLoadedImage(async args => {
        const repeated = requests++ === 1, platform = repeated && store === 'containerd';
        // Docker 28.0/API 1.48 rejects this flag before talking to the daemon.
        if (store === 'classic' && args.includes('--platform')) return {status: 125, signal: null,
          stdout: Buffer.alloc(0), stderr: Buffer.from('unknown flag: --platform')};
        assert.deepEqual(args, ['image', 'inspect', ...(platform ? ['--platform', 'linux/amd64'] : []), image]);
        const descriptor = platform ? chain.child_descriptor : chain.index_descriptor;
        let response = store === 'classic' ? value : {...value, Id: descriptor.digest, Descriptor: descriptor};
        if (fault === 'wrong-config') response = {...value, Id: 'sha256:' + 'f'.repeat(64)};
        if (fault === 'mixed-store' && repeated) response = store === 'classic' ? {...value, Id: descriptor.digest, Descriptor: descriptor} : value;
        if (fault === 'wrong-selected-descriptor' && repeated) response = {...value, Id: chain.index_descriptor.digest, Descriptor: chain.index_descriptor};
        if (fault === 'second-config' && repeated) response = {...response, Id: 'sha256:' + 'f'.repeat(64)};
        if (fault === 'second-platform' && repeated) response = {...response, Architecture: 'arm64'};
        if (fault === 'second-reference' && repeated) response = {...response, RepoDigests: []};
        if (fault === 'second-revision' && repeated) response = {...response, Config: {...response.Config, Labels: {'org.opencontainers.image.revision': 'd'.repeat(40)}}};
        if (fault === 'unsupported-inspection' && repeated) return {status: 125, signal: null,
          stdout: Buffer.alloc(0), stderr: Buffer.from('unknown flag: --platform')};
        return {status: 0, signal: null, stderr: Buffer.alloc(0), stdout: Buffer.from(JSON.stringify(fault === 'multiple-results' ? [response, response] : [response]))};
      }, chain, 'amd64', revision);
      assert.equal(requests, 2);
      assert.deepEqual(result, {id: store === 'classic' ? config : chain.index_descriptor.digest,
        platform_id: store === 'classic' ? config : chain.child_descriptor.digest, store});
    };
    await inspect();
    for (const fault of ['wrong-config', 'mixed-store', 'wrong-selected-descriptor', 'multiple-results',
      'second-config', 'second-platform', 'second-reference', 'second-revision', 'unsupported-inspection']) await assert.rejects(inspect(fault));
  }
  const hub = 'docker.io/library/registry@sha256:' + 'c'.repeat(64);
  validateLoadedImage({...value, RepoDigests: [hub.slice('docker.io/library/'.length)]}, hub, 'amd64', config);
  validateLoadedImage({...value, RepoDigests: [hub]}, hub, 'amd64', config);
  assert.throws(() => validateLoadedImage({...value, RepoDigests: ['evil.example/registry@sha256:' + 'c'.repeat(64)]}, hub, 'amd64', config));
  for (const authority of ['other.example', 'localhost', 'localhost:5000']) {
    assert.throws(() => validateLoadedImage({...value, RepoDigests: [`${authority}/model@sha256:${'c'.repeat(64)}`]},
      `docker.io/${authority}/model@sha256:${'c'.repeat(64)}`, 'amd64', config));
  }
  for (const changed of [{...value, RepoDigests: []}, {...value, Architecture: 'arm64'}, {...value, Id: digest(Buffer.from('other'))},
    {...value, Config: {...value.Config, Labels: {'org.opencontainers.image.revision': 'd'.repeat(40)}}}]) {
    assert.throws(() => validateLoadedImage(changed, image, 'amd64', config, revision));
  }
});

test('SDK execution is same-daemon, read-only and unprivileged with only owned path mounts', () => {
  const args = sdkContainerArguments('prismpm-unit-sdk', image, 2375, '/workspace');
  assert.equal(args[args.indexOf('--network') + 1], 'host');
  assert.equal(args[args.indexOf('--user') + 1], '1000:1000');
  assert.equal(args[args.indexOf('--group-add') + 1], '2375');
  assert(args.includes('--read-only')); assert(args.includes('--pull=never'));
  assert(!args.includes('--privileged'));
  assert.deepEqual(args.filter((_, index) => args[index - 1] === '--mount'), [
    'type=bind,source=/workspace,target=/workspace',
    'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
  ]);
  assert.throws(() => sdkContainerArguments('../escape', image, 2375, '/workspace'));
  assert.throws(() => sdkContainerArguments('prismpm-unit-sdk', image, -1, '/workspace'));
  assert.throws(() => sdkContainerArguments('prismpm-unit-sdk', image, 2375, '/'));
});

test('both original full-VV records and execution identity are independently required', () => {
  const raw = Buffer.from(canonical({schema: 'prismpm/vv-evidence/1', commit: revision, gates: Array.from({length: 15}, (_, index) => index + 1), status: 'passed'}));
  const runs = [1, 2].map(run => ({run, path: `run-${run}/vv-evidence.json`, byte_length: raw.length, sha256: digest(raw).slice(7)}));
  const record = {schema: 'prismpm/sdk-vv-execution/1', scope: 'two-full-vv-executions-only', source_revision: revision,
    image_reference: image, process_architecture: 'x64', inventory_sha256: 'd'.repeat(64), cli_sha256: 'e'.repeat(64),
    input_policy_sha256: 'f'.repeat(64), input_manifest_sha256: '1'.repeat(64), advisory_revision: '2'.repeat(40), runs,
    unclaimed: ['native-host', 'network-isolation', 'oci-image-identity', 'sdk-release', 'product-readiness']};
  validateExecution(Buffer.from(canonical(record)), [raw, raw], image, revision, 'amd64');
  for (const changed of [{...record, runs: runs.slice(1)}, {...record, source_revision: '3'.repeat(40)},
    {...record, process_architecture: 'arm64'}, {...record, unclaimed: []}, {...record, extra: true}]) {
    assert.throws(() => validateExecution(Buffer.from(canonical(changed)), [raw, raw], image, revision, 'amd64'));
  }
  assert.throws(() => validateExecution(Buffer.from(canonical(record)), [raw, Buffer.from('{}')], image, revision, 'amd64'));
});

test('runtime image authority has exact fixed members and no floating references', () => {
  const bytes = readFileSync(new URL('../sdk/vv-runtime.lock.json', import.meta.url));
  const lock = readRuntimeLock(bytes);
  assert.deepEqual(Object.keys(lock.images).sort(), ['buildkit', 'dind', 'distribution', 'zot']);
  for (const image of Object.values(lock.images)) assert.match(image.reference, /@sha256:[a-f0-9]{64}$/);
  const changed = structuredClone(lock); changed.images.dind.reference = 'docker:latest';
  assert.throws(() => readRuntimeLock(Buffer.from(canonical(changed) + '\n')));
});

function orchestrationFixture(t, fault, store = 'classic', registryEndpoint) {
  const root = mkdtempSync(join(tmpdir(), 'prismpm-vv-orchestration-unit-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const source = join(root, 'source'); mkdirSync(source); mkdirSync(join(source, 'scripts')); mkdirSync(join(source, 'sdk'));
  const images = {}, metadata = new Map(), loaded = new Set(), resources = new Map(), calls = [];
  const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
  // Actual filesystem pressure, not a replaced statfs result. Docker/OCI
  // metadata below remains an explicit orchestration unit, not an SDK image.
  const pressure = ['late-space-pressure', 'space-bound-positive'].includes(fault);
  const current = pressure ? statfsSync(root) : undefined;
  const compressed = pressure ? Math.floor((current.bavail * current.bsize - 12 * 1024 ** 3 - 16 * 1024 ** 2) / 4) : 0;
  if (pressure) assert(compressed > 0, 'original12GiB reserve and positive boundary headroom required');
  for (const name of ['dind', 'zot', 'buildkit', 'distribution', 'sdk']) {
    const configuration = digest(Buffer.from(`unit-only ${name} config`));
    const layers = name === 'sdk' && pressure ? [{digest: digest(Buffer.from('unit-only compressed layer descriptor')),
      size: compressed, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip'}] : [];
    const manifest = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: {digest: configuration, size: 100}, layers}));
    const annotation = name === 'dind' ? {'org.opencontainers.image.revision': revision, 'org.opencontainers.image.version': '28.4.0-dind'} : {};
    const index = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{digest: digest(manifest), size: manifest.length, mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: {os: 'linux', architecture: arch}, annotations: annotation}]}));
    const reference = `${name === 'sdk' && registryEndpoint ? registryEndpoint.authority : 'fixture.invalid'}/${name}@${digest(index)}`;
    images[name] = {reference, configuration,
      index_descriptor: {mediaType: 'application/vnd.oci.image.index.v1+json', digest: digest(index), size: index.length},
      child_descriptor: {mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: digest(manifest), size: manifest.length}};
    metadata.set(reference, index); metadata.set(reference.split('@')[0] + '@' + digest(manifest), manifest);
  }
  const lock = {schema: 'prismpm/sdk-vv-runtime-inputs/1', images: Object.fromEntries(Object.entries(images).filter(([name]) => name !== 'sdk').map(([name, row]) =>
    [name, name === 'dind' ? {reference: row.reference, source: 'https://github.com/docker-library/docker', source_revision: revision, version: '28.4.0-dind'} : {reference: row.reference}]))};
  writeFileSync(join(source, 'sdk/vv-runtime.lock.json'), canonical(lock) + '\n');
  for (const name of ['sdk-vv-run', 'sdk-vv-probe', 'sdk-vv-check', 'sdk-bootstrap-retention', 'bootstrap-evidence', 'sdk-registry-reader']) writeFileSync(join(source, `scripts/${name}.mjs`), `// unit-only source-binding fixture: ${name}\n`);
  for (const name of ['sdk-command-owner.mjs', 'sdk-command-owner.py', 'sdk-vv-outer.sh']) writeFileSync(join(source, 'scripts', name), `# unit-only binding fixture: ${name}\n`);
  const policy = Buffer.from(canonical({source_revision: revision, advisory_revision: '2'.repeat(40)})), inventory = Buffer.from('unit inventory'), inputManifest = Buffer.from('unit input manifest'), cli = Buffer.from('unit CLI bytes');
  const raw = Buffer.from(canonical({schema: 'prismpm/vv-evidence/1', commit: revision, gates: Array.from({length: 15}, (_, i) => i + 1), status: 'passed'}));
  const record = {schema: 'prismpm/sdk-vv-execution/1', scope: 'two-full-vv-executions-only', source_revision: revision, image_reference: images.sdk.reference,
    process_architecture: process.arch, inventory_sha256: digest(inventory).slice(7), cli_sha256: digest(cli).slice(7), input_policy_sha256: digest(policy).slice(7),
    input_manifest_sha256: digest(inputManifest).slice(7), advisory_revision: '2'.repeat(40),
    runs: [1, 2].map(run => ({run, path: `run-${run}/vv-evidence.json`, byte_length: raw.length, sha256: digest(raw).slice(7)})),
    unclaimed: ['native-host', 'network-isolation', 'oci-image-identity', 'sdk-release', 'product-readiness']};
  const namespace = {identity: 'net:[123]', interfaces: ['docker0', 'lo'], ipv4: 'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\ndocker0 000011AC 00000000 0001 0 0 0 0000FFFF 0 0 0\n', ipv6: ''};
  const ok = value => ({status: 0, signal: null, stdout: Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), stderr: Buffer.alloc(0)});
  const bad = status => ({...ok(''), status, stderr: Buffer.from('unit-only controlled failure')});
  const loadedImage = (reference, platform = false) => {
    const row = Object.values(images).find(row => row.reference === reference); assert(row);
    const descriptor = platform ? row.child_descriptor : row.index_descriptor;
    return [{Id: store === 'classic' ? row.configuration : descriptor.digest,
      ...(store === 'classic' ? {} : {Descriptor: descriptor}),
      Os: 'linux', Architecture: fault === 'wrong-platform' ? 'other' : arch, RepoDigests: [reference],
      Config: {Labels: {'org.opencontainers.image.revision': revision}, Volumes: null}}];
  };
  let disconnected = false, executed = false, daemon, sdk;
  const inner = args => {
    if (args[0] === 'info') return ok({ServerVersion: '28.4.0', DefaultRuntime: 'runc', Containers: 0, Images: 0});
    if (args[0] === 'pull') {
      assert.deepEqual(args, ['pull', '--platform', `linux/${arch}`, args.at(-1)]);
      if (!args.at(-1).includes('distribution') || fault !== 'missing-image') loaded.add(args.at(-1)); return ok('pulled');
    }
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (store === 'classic' && args.includes('--platform')) return bad(125);
      assert.deepEqual(args.slice(2, -1), args.includes('--platform') ? ['--platform', `linux/${arch}`] : []);
      return loaded.has(args.at(-1)) ? ok(loadedImage(args.at(-1), args.includes('--platform'))) : bad(1);
    }
    if (args[0] === 'image' && args[1] === 'ls') return ok([...loaded].map(ref => loadedImage(ref)[0].Id).join('\n'));
    if (args[0] === 'create') {
      assert(disconnected, 'SDK must not start during online acquisition');
      sdk = args[args.indexOf('--name') + 1];
      assert.deepEqual(args, sdkContainerArguments(sdk, images.sdk.reference, 2375, '/workspace')); return ok('unit-sdk');
    }
    if (args[0] === 'start') { assert.equal(args[1], sdk); return ok('started'); }
    assert.deepEqual(args.slice(0, 2), ['exec', sdk]);
    const command = args.slice(2);
    if (command[0] === 'docker') return ok((fault === 'wrong-container-image' ? images.sdk.child_descriptor.digest : loadedImage(images.sdk.reference)[0].Id) + '\n');
    if (command[0] === 'node' && command[1].endsWith('/sdk-vv-probe.mjs')) {
      if (command[2] === 'native') return ok({architecture: arch, process_architecture: process.arch});
      if (command[2] === 'namespace') return ok(fault === 'wrong-namespace' ? {...namespace, identity: 'net:[456]'} : namespace);
      assert.equal(command[2], 'connectivity');
      return fault === 'egress' ? bad(1) : ok({local_tcp: 'passed', bootstrap_tcp: 'blocked', external_dns: 'blocked'});
    }
    if (command[0] === 'node' && command[1].endsWith('/sdk-vv-run.mjs')) {
      assert.deepEqual(command.slice(2), ['run', images.sdk.reference, revision, '/workspace/run']);
      if (fault === 'run-one' || fault === 'run-two') return bad(42);
      executed = fault !== 'omitted-execution'; return ok('unit-only execution transcript');
    }
    assert.equal(command[0], 'cat'); const path = command[1];
    if (path === '/etc/resolv.conf') return ok(fault === 'dns' ? 'nameserver 8.8.8.8\n' : isolatedResolver);
    if (path.startsWith('/opt/prismpm/share/conformance-root/')) return ok(fault === 'source-mutation' ? 'changed' : readFileSync(join(source, path.slice('/opt/prismpm/share/conformance-root/'.length))));
    if (path.startsWith('/workspace/run/evidence/')) {
      if (!executed) return bad(1);
      const bootstrap = bootstrapFixture(revision), name = path.split('/').at(-1);
      if (name === 'bootstrap.json') return ok(bootstrap.manifest);
      if (bootstrap.retained.has(name)) return fault === 'bootstrap-missing' ? bad(1)
        : ok(fault === 'bootstrap-changed' ? '{}' : bootstrap.retained.get(name));
      if (path.endsWith('execution.json')) return ok(Buffer.from(canonical(fault === 'stale-evidence' ? {...record, source_revision: '9'.repeat(40)} : record)));
      return ok(fault === 'partial-evidence' && path.includes('run-2') ? '{}' : raw);
    }
    const payload = {'/opt/prismpm/share/inventory.json': inventory, '/opt/prismpm/share/vv-input-policy.json': policy,
      '/opt/prismpm/share/vv-inputs/manifest.json': inputManifest, '/usr/local/bin/prismpm': cli}[path];
    assert(payload, path); return ok(fault === 'inventory-mutation' && path.endsWith('/inventory.json') ? 'changed inventory' : payload);
  };
  const transport = async (command, arguments_, options) => {
    assert.equal(command, 'docker'); assert.deepEqual(arguments_.slice(0, 3), ['--host', 'unix:///var/run/docker.sock', '--config']);
    assert.deepEqual(Object.keys(options.environment).sort(), ['DOCKER_CONFIG', 'HOME', 'LANG', 'LC_ALL', 'PATH']);
    const args = arguments_.slice(4); calls.push(args);
    if (args[0] === 'buildx') {
      const bytes = metadata.get(args.at(-1)); assert(bytes);
      if (fault === 'late-space-pressure' && args.at(-1) === images.sdk.reference.split('@')[0] + '@' + images.sdk.child_descriptor.digest) {
        writeFileSync(join(root, 'actual-filesystem-pressure'), Buffer.alloc(32 * 1024 ** 2), {flag: 'wx'});
      }
      return ok(bytes);
    }
    if (args[0] === 'pull') { assert.deepEqual(args, ['pull', '--platform', `linux/${arch}`, images.dind.reference]); return ok('pulled'); }
    if (args[0] === 'image') return store === 'classic' && args.includes('--platform') ? bad(125) : ok(loadedImage(args.at(-1), args.includes('--platform')));
    if (args[1] === 'inspect') {
      const entry = resources.get(args[2]); if (!entry) return bad(1);
      return ok([{Labels: entry.labels, Config: {Labels: entry.labels}}]);
    }
    if (args[1] === 'rm') {
      const name = args.at(-1); assert(resources.has(name));
      if (args[0] === 'container') assert(args.includes('--volumes'), 'owned anonymous volumes must not survive removal');
      if (fault === 'cleanup') return bad(1); resources.delete(name); return ok(name);
    }
    if (args[1] === 'create' || args[0] === 'create') {
      const label = args[args.indexOf('--label') + 1], name = args[0] === 'create' ? args[args.indexOf('--name') + 1] : args.at(-1);
      const [key, value] = label.split('='); resources.set(name, {labels: {[key]: value}});
      if (name.endsWith('-daemon')) daemon = name;
      if (name.endsWith('-daemon') && registryEndpoint) {
        const trust = args.filter((_, index) => args[index - 1] === '--mount').filter(value => value.includes('/etc/docker/certs.d/'));
        assert.deepEqual(trust, [`type=bind,source=${destination}/docker/registry-trust,target=/etc/docker/certs.d/${registryEndpoint.authority},readonly`]);
        assert(!args.some(value => value.includes('insecure-registry')));
      }
      if (name.endsWith('-control')) assert.equal(args[args.indexOf('--tmpfs') + 1], '/var/lib/docker:rw,nosuid,nodev,size=16777216,mode=0700');
      if (fault === 'interrupted' && name.endsWith('-daemon')) process.emit('SIGHUP');
      if (fault === 'create-timeout' && name.endsWith('-daemon')) {
        const error = Error('unit-only create response timeout'); error.result = {...bad(1), signal: 'SIGKILL'}; throw error;
      }
      return ok(name);
    }
    if (args[0] === 'start') return ok('started');
    if (args[0] === 'inspect') {
      if (args[1] === daemon) return ok([{NetworkSettings: {Networks: fault === 'connected' ? {bootstrap: {}} : {}}}]);
      const network = [...resources.keys()].find(name => name.endsWith('-bootstrap'));
      return ok([{NetworkSettings: {Networks: {[network]: {IPAddress: '192.0.2.4'}}}}]);
    }
    if (args[0] === 'network' && args[1] === 'disconnect') { disconnected = true; return ok(''); }
    if (args[0] === 'exec' && args[1].endsWith('-control')) return fault === 'dead-control' ? bad(1) : ok('prismpm-network-control');
    assert.deepEqual(args.slice(0, 2), ['exec', daemon]);
    if (args[2] === 'docker') { assert.deepEqual(args.slice(3, 5), ['--host', 'unix:///var/run/docker.sock']); return inner(args.slice(5)); }
    if (args[2] === 'find' || args[2] === 'chown' || args[2] === 'sh') return ok('');
    if (args[2] === 'stat') return ok('2375\n');
    if (args[2] === 'readlink') return ok(namespace.identity + '\n');
    if (args[2] === 'wget') {
      if (fault === 'probe-timeout' && disconnected) { const error = Error('unit-only probe transport timed out'); error.result = bad(1); throw error; }
      return disconnected ? bad(1) : ok('prismpm-network-control');
    }
    assert.equal(args[2], 'cat');
    if (registryEndpoint && args[3] === `/etc/docker/certs.d/${registryEndpoint.authority}/ca.crt`)
      return ok(fault === 'registry-ca' ? Buffer.from('wrong CA') : registryEndpoint.ca);
    if (args[3] === '/etc/resolv.conf') return ok(isolatedResolver);
    return ok(args[3] === '/proc/net/dev' ? 'header\nheader\nlo: 0\ndocker0: 0\n' : args[3] === '/proc/net/route' ? namespace.ipv4 : namespace.ipv6);
  };
  const destination = join(root, 'output');
  const environment = {PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_SHA: revision, RUNNER_ENVIRONMENT: 'github-hosted',
    RUNNER_OS: 'Linux', RUNNER_ARCH: arch === 'amd64' ? 'X64' : 'ARM64', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1'};
  return {destination, calls, resources, metadata, images, run: (run = runOuter) => run({image: images.sdk.reference, revision, arch, source, destination,
    ...(registryEndpoint ? {registryCertificate: registryEndpoint.ca} : {})}, transport, environment)};
}

test('owned-registry orchestration uses real TLS metadata and bound daemon CA without changing unrelated acquisition or installed gates', async t => {
  // Docker/SDK responses below remain explicit orchestration units, never real
  // installed SDK acceptance. Only the HTTPS metadata transport is actual.
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-outer-tls-unit-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const cert = join(directory, 'ca.pem'), key = join(directory, 'ca.key');
  const host = Object.values(networkInterfaces()).flat().find(row => row.family === 'IPv4' && !row.internal)?.address;
  assert(host, 'actual private container address required');
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=SDK outer unit CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'subjectAltName=IP:' + host, '-keyout', key, '-out', cert],
  {timeout: 15000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe']});
  const ca = readFileSync(cert); let fixture, requests = 0;
  const sockets = new Set(), server = createTlsServer({key: readFileSync(key), cert: ca}, (req, res) => {
    requests++; assert.equal(req.headers.authorization, undefined);
    const reference = `${host}:${server.address().port}/sdk@` + req.url.split('/').at(-1);
    const bytes = fixture.metadata.get(reference); assert(bytes, 'fixed original SDK graph endpoint'); res.end(bytes);
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, host, resolve));
  t.after(async () => {
    const closed = [...sockets].map(socket => new Promise(resolve => socket.once('close', resolve)));
    for (const socket of sockets) socket.destroy();
    let deadline;
    try {
      await Promise.race([Promise.all([...closed, new Promise(resolve => server.close(resolve))]),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('outer TLS unit server retirement deadline exceeded')), 5000); })]);
    } finally { clearTimeout(deadline); }
    assert.equal(sockets.size, 0);
  });
  const authority = host + ':' + server.address().port;
  for (const fault of [undefined, 'registry-ca']) {
    fixture = orchestrationFixture(t, fault, 'classic', {authority, ca});
    if (fault) {
      await assert.rejects(fixture.run(), /isolated daemon SDK registry CA differs/);
      assert(!existsSync(join(fixture.destination, 'acceptance.json')));
      assert.equal(fixture.calls.filter(args => args.includes('pull') && args.at(-1).startsWith(authority + '/')).length, 0);
    } else {
      const result = await fixture.run(), evidence = result.sdk_registry_transport;
      assert.equal(evidence.authority, authority); assert.equal(evidence.ca_pem, ca.toString());
      assert.equal(evidence.ca_sha256, digest(ca).slice(7)); assert.equal(evidence.daemon_ca_sha256, evidence.ca_sha256);
      assert.equal(evidence.daemon_ca_path, `/etc/docker/certs.d/${authority}/ca.crt`);
      assert.equal(evidence.outer_roots, 'explicit-ca-only'); assert.equal(evidence.daemon_roots, 'system-roots-plus-exact-authority-ca');
      assert.equal(evidence.transport.requests, 2); assert(evidence.transport.agent_retired);
      assert.equal(digest(Buffer.from(evidence.original_index_base64, 'base64')), fixture.images.sdk.reference.split('@')[1]);
      assert.equal(digest(Buffer.from(evidence.original_manifest_base64, 'base64')), fixture.images.sdk.child_descriptor.digest);
      const buildx = fixture.calls.filter(args => args[0] === 'buildx');
      assert.equal(buildx.length, 8); assert(buildx.every(args => !args.at(-1).startsWith(authority + '/')));
      assert.deepEqual(result.phases, ['exact-native-images-acquired', 'external-network-disconnected', 'isolated-native-sdk-probed',
        'both-full-vv-records-verified', 'owned-resources-removed']);
    }
    assert.equal(fixture.resources.size, 0);
  }
  assert.equal(requests, 4);
});

test('complete orchestration executes acquisition, disconnection, owning runner and cleanup in order', async t => {
  for (const store of ['classic', 'containerd']) {
    const f = orchestrationFixture(t, undefined, store); const value = await f.run();
    assert.deepEqual(value.phases, ['exact-native-images-acquired', 'external-network-disconnected', 'isolated-native-sdk-probed', 'both-full-vv-records-verified', 'owned-resources-removed']);
    assert.equal(f.resources.size, 0); assert(existsSync(join(f.destination, 'acceptance.json')));
    const loaded = JSON.parse(readFileSync(join(f.destination, 'loaded-identities.json')));
    assert.equal(Object.keys(loaded).length, 4); assert(Object.values(loaded).every(row => row.store === store));
    assert.equal(f.calls.filter(args => args.includes('inspect') && args.includes('--platform')).length, store === 'classic' ? 0 : 5);
    assert.equal(f.calls.filter(args => args.some((arg, index) => arg.endsWith('/sdk-vv-run.mjs') && args[index - 1] === 'node')).length, 1);
    const wrong = orchestrationFixture(t, 'wrong-container-image', store);
    await assert.rejects(wrong.run()); assert.equal(wrong.resources.size, 0);
    assert(!existsSync(join(wrong.destination, 'acceptance.json')));
  }
});

test('orchestration refuses each missing authority, isolation, execution, evidence and cleanup prerequisite', async t => {
  for (const fault of ['wrong-platform', 'missing-image', 'connected', 'egress', 'run-one', 'run-two', 'omitted-execution', 'stale-evidence', 'partial-evidence', 'bootstrap-missing', 'bootstrap-changed', 'cleanup', 'create-timeout', 'probe-timeout', 'dns', 'dead-control', 'source-mutation', 'inventory-mutation', 'interrupted', 'wrong-namespace']) {
    const f = orchestrationFixture(t, fault); await assert.rejects(f.run(), undefined, fault);
    assert(!existsSync(join(f.destination, 'acceptance.json')), fault);
    if (fault !== 'cleanup') assert.equal(f.resources.size, 0, fault);
  }
});

test('actual process transport preserves failures and rejects timeout or oversized output', async () => {
  const options = {environment: {PATH: process.env.PATH}, timeout: 3000, limit: 1024};
  const value = await execute(process.execPath, ['-e', 'process.stdout.write("ok"); process.exitCode=7'], options);
  assert.equal(value.status, 7); assert.equal(value.stdout.toString(), 'ok');
  await assert.rejects(execute(process.execPath, ['-e', 'process.stdout.write("x".repeat(4096))'], options), /output exceeded/);
  await assert.rejects(execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {...options, timeout: 50}), /timed out/);
  const started = Date.now();
  await assert.rejects(execute(process.execPath, ['-e',
    'require("node:child_process").spawn(process.execPath,["-e","setTimeout(()=>{},1200)"],{stdio:["ignore",1,2]});process.exit(0)'],
  {...options, timeout: 100}), /timed out/);
  assert(Date.now() - started < 900, 'descendant-held pipes must not defeat bounded cleanup');
  const root = mkdtempSync(join(tmpdir(), 'prismpm-sdk-escaped-pipes-'));
  const marker = join(root, 'child.json'), token = randomBytes(16).toString('hex');
  const holder = 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,token:process.argv[2]}),{flag:"wx"});process.stdout.write("escaped-ready\\n");setTimeout(()=>{},15000);';
  const parent = `const fs=require("node:fs");const child=require("node:child_process").spawn(process.execPath,["-e",${JSON.stringify(holder)},${JSON.stringify(marker)},${JSON.stringify(token)}],{detached:true,stdio:["ignore",1,2]});const ready=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(ready);child.unref();process.exit(0);}},10);setTimeout(()=>process.exit(98),3000).unref();`;
  const escapedStarted = Date.now();
  try {
    let failure;
    try { await execute(process.execPath, ['-e', parent], {...options, timeout: 1000}); }
    catch (error) { failure = error; }
    assert(failure, 'escaped pipe holder must prohibit acceptance');
    assert.match(failure.message, /bounded process timed out/);
    assert(Date.now() - escapedStarted < 7500, 'a new session retaining pipes must not defeat the fixed five-second retirement bound');
    assert.equal(failure.result.status, 0, 'retain the actual observed leader exit, not a fabricated timeout status');
    assert.equal(failure.result.signal, null);
    assert.equal(failure.result.retirement.close_observed, true);
    assert.equal(failure.result.retirement.descendants_absent, true, 'actual subreaper exhaustion must include the escaped pipe holder');
    assert.equal(failure.result.retirement.scope, 'private-linux-subreaper-exhaustion');
    assert.equal(failure.result.retirement.uncertainty, null);
    assert.equal(failure.result.stdout.toString(), 'escaped-ready\n');
    assert(!existsSync(`/proc/${JSON.parse(readFileSync(marker)).pid}`), 'escaped fixture must already have been adopted and reaped by production owner');
  } finally {
    // The production owner must prove absence BEFORE this safety cleanup.
    const child = JSON.parse(readFileSync(marker));
    assert.deepEqual(Object.keys(child).sort(), ['pid', 'token']);
    assert.equal(child.token, token); assert(Number.isSafeInteger(child.pid) && child.pid > 1);
    const processPath = `/proc/${child.pid}`;
    if (existsSync(processPath)) {
      const command = readFileSync(processPath + '/cmdline', 'utf8').split('\0');
      assert.deepEqual(command, [process.execPath, '-e', holder, marker, token, '']);
      process.kill(child.pid, 'SIGKILL');
      const deadline = Date.now() + 5000;
      while (existsSync(processPath) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert(!existsSync(processPath), 'test-owned escaped fixture must actually retire');
    }
    rmSync(root, {recursive: true});
  }
});

for (const detached of [false, true]) test(`normal leader exit cannot accept an unreaped ${detached ? 'escaped-session' : 'same-group'} descendant`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'prismpm-sdk-normal-descendant-'));
  const marker = join(root, 'child.json'), token = randomBytes(16).toString('hex');
  const holder = 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,token:process.argv[2]}),{flag:"wx"});setTimeout(()=>{},15000);';
  const parent = `const fs=require("node:fs");const child=require("node:child_process").spawn(process.execPath,["-e",${JSON.stringify(holder)},${JSON.stringify(marker)},${JSON.stringify(token)}],{detached:${detached},stdio:"ignore"});const ready=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(ready);child.unref();process.exit(0);}},10);setTimeout(()=>process.exit(98),3000).unref();`;
  const started = Date.now();
  try {
    let result, failure;
    try { result = await execute(process.execPath, ['-e', parent], {timeout:1000, limit:1024}); }
    catch (error) { failure = error; result = error.result; }
    assert(failure, 'a still-running descendant must cause rejection at the original command deadline');
    assert.match(failure.message, /bounded process timed out/);
    assert(result, 'retain original process result even if supervision rejects');
    assert.equal(result.status, 0, 'do not fabricate the observed normal leader status');
    assert.equal(result.signal, null);
    assert(Date.now() - started < 7500, 'normal-close supervision must remain bounded');
    const child = JSON.parse(readFileSync(marker));
    assert.deepEqual(Object.keys(child).sort(), ['pid', 'token']);
    assert.equal(child.token, token); assert(Number.isSafeInteger(child.pid) && child.pid > 1);
    assert(!existsSync(`/proc/${child.pid}`), 'normal-close completion must actually retire the original descendant');
    assert.equal(result.retirement?.descendants_absent, true, 'require genuine descendant retirement, not leader/pipes/group absence alone');
  } finally {
    // This fallback retires only the independently identified test fixture. It
    // cannot qualify production adoption, reaping or process-group authority.
    if (existsSync(marker)) {
      const child = JSON.parse(readFileSync(marker));
      assert.deepEqual(Object.keys(child).sort(), ['pid', 'token']);
      assert.equal(child.token, token); assert(Number.isSafeInteger(child.pid) && child.pid > 1);
      const processPath = `/proc/${child.pid}`;
      if (existsSync(processPath)) {
        assert.deepEqual(readFileSync(processPath + '/cmdline', 'utf8').split('\0'),
          [process.execPath, '-e', holder, marker, token, '']);
        process.kill(child.pid, 'SIGKILL');
        const end = Date.now() + 5000;
        while (existsSync(processPath) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
        assert(!existsSync(processPath), 'test-owned descendant fixture must actually retire');
      }
    }
    rmSync(root, {recursive:true});
  }
});

test('real native-header and TCP controls execute rather than accepting command success alone', async () => {
  assert.equal(inspectNativeExecutable(process.execPath).process_architecture, process.arch);
  const server = createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal(await connect('127.0.0.1', server.address().port), true);
    await assert.rejects(connectivity('127.0.0.1', server.address().port), /bootstrap control is reachable/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('resolver boundary admits only the recorded isolated loopback authority', () => {
  validateResolver(isolatedResolver); validateResolver('# Generated by Docker\n' + isolatedResolver);
  for (const text of ['', 'nameserver 127.0.0.11\n', 'nameserver 8.8.8.8\n', isolatedResolver + 'nameserver 8.8.4.4\n',
    isolatedResolver + 'search example.org\n', isolatedResolver + isolatedResolver, isolatedResolver + 'options rotate\n']) {
    assert.throws(() => validateResolver(text), undefined, text);
  }
});

test('image metadata binds the child bytes, media type, config and bounded layers', async () => {
  const child = {schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: {digest: config, size: 100}, layers: [{digest: config, size: 123}]};
  const check = async (changed, corrupt = false) => {
    const bytes = Buffer.from(JSON.stringify(changed));
    const index = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [
      {digest: digest(bytes), size: bytes.length, mediaType: 'application/vnd.oci.image.manifest.v1+json', platform: {os: 'linux', architecture: 'amd64'}}]}));
    let calls = 0;
    const result = await acquireImageMetadata(async () => ({status: 0, signal: null, stderr: Buffer.alloc(0),
      stdout: calls++ === 0 ? index : corrupt ? Buffer.from('{}') : bytes}), `fixture.invalid/sdk@${digest(index)}`, 'amd64');
    assert.equal(calls, 2); assert.equal(result.compressed_bytes, 123);
  };
  await check(child);
  for (const changed of [{...child, mediaType: 'text/plain'}, {...child, config: {...child.config, size: -1}},
    {...child, layers: [{digest: config, size: Number.MAX_SAFE_INTEGER}]}, {...child, layers: [{digest: config, size: -1}]}]) {
    await assert.rejects(check(changed));
  }
  await assert.rejects(check(child, true));
});

test('actual interruption rejects a running process instead of treating it as an expected failure', async () => {
  const module = new URL('./sdk-vv-check.mjs', import.meta.url).href;
  const code = `import {execute} from ${JSON.stringify(module)};
    try { await execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {timeout:3000}); process.exitCode=99; }
    catch (error) { if (!/interrupted by SIGHUP/.test(error.message)) throw error; console.log('interrupted'); }
    setTimeout(()=>{},0);`;
  // The subprocess signals itself while its real owned child is running.
  const result = await execute(process.execPath, ['--input-type=module', '-e',
    `setTimeout(()=>process.kill(process.pid,'SIGHUP'),100);\n${code}`], {timeout: 5000, limit: 4096});
  assert.equal(result.status, 0); assert.equal(result.stdout.toString(), 'interrupted\n');
});

test('executed omission mutants cannot satisfy the owning orchestration contract', async t => {
  const original = readFileSync(new URL('./sdk-vv-check.mjs', import.meta.url), 'utf8');
  const absoluteImports = text => text.replace(/from '(\.[^']+)'/g, (_, path) => `from '${new URL(path, import.meta.url).href}'`);
  const mutants = [
    text => text.replace("await outer(['network', 'disconnect', names.network, names.daemon]);", '/* unit mutant: omitted disconnect */'),
    text => text.replace(/const run = await inside\(\['exec', names.sdk, 'node', `\$\{SHARED\}\/conformance-root\/scripts\/sdk-vv-run.mjs`,\s*'run', image, revision, '\/workspace\/run'\], \{timeout: 14400000, limit: 64 \* 1024 \* 1024\}\);/,
      "const run = {status:0,signal:null,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};"),
    text => text.replace('for (const resource of owned.reverse()) {', 'for (const resource of []) {'),
  ];
  for (const [index, mutate] of mutants.entries()) {
    const changed = mutate(original); assert.notEqual(changed, original, `mutant ${index} must be planted`);
    const module = await import('data:text/javascript;base64,' + Buffer.from(absoluteImports(changed)).toString('base64'));
    const f = orchestrationFixture(t);
    await assert.rejects(async () => {
      await f.run(module.runOuter); assert.equal(f.resources.size, 0, 'all owned resources must actually be removed');
    }, undefined, `omission mutant ${index}`);
  }
  const positive = orchestrationFixture(t, 'space-bound-positive');
  await positive.run(); assert.equal(positive.resources.size, 0);
  const pressure = orchestrationFixture(t, 'late-space-pressure');
  await assert.rejects(pressure.run(), /insufficient disk for isolated image closure and reserve/);
  assert(!pressure.calls.some(args => args.includes('pull')), 'late reserve loss must refuse before any image acquisition');
  assert.equal(pressure.resources.size, 0);
  assert(!existsSync(join(pressure.destination, 'acceptance.json')));
  const stale = original.replace('const imageSpace = statfsSync(dirname(destination));', 'const imageSpace = space;');
  assert.notEqual(stale, original, 'actual stale-admission mutant must be planted');
  const module = await import('data:text/javascript;base64,' + Buffer.from(absoluteImports(stale)).toString('base64'));
  const bypass = orchestrationFixture(t, 'late-space-pressure');
  await assert.rejects(async () => {
    await assert.rejects(bypass.run(module.runOuter), /insufficient disk for isolated image closure and reserve/);
  }, /Missing expected rejection/, 'the executed stale-sample mutant must fail its owning late-pressure check');
  assert.equal(bypass.resources.size, 0);
});

test('owning TAP completeness rejects skipped, reduced and failed successful-shell output', () => {
  const tap = ['TAP version 13', ...Array.from({length: 20}, (_, index) => `ok ${index + 1} - case ${index + 1}`),
    '1..20', '# tests 20', '# suites 0', '# pass 20', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0'].join('\n');
  const value = stdout => ({status: 0, signal: null, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0)});
  validateOwningTests(value(tap));
  for (const text of ['', tap.replace('# skipped 0', '# skipped 1'), tap.replace('# tests 20', '# tests 19'),
    tap.replace('ok 1 - case 1', 'ok 1 - case 1 # SKIP'), tap.replace('# fail 0', '# fail 1')]) assert.throws(() => validateOwningTests(value(text)));
  assert.throws(() => validateOwningTests({...value(tap), status: 1}));
});

test('native release matrix executes the additional exact-image gate and preserves prior gates', async t => {
  // Deliberately extract only this fixed, owned workflow fragment. General
  // YAML validation remains in the existing source-VV workflow tests; this
  // host test requires no SDK-only parser installation.
  const source = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const extract = name => {
    const jobs = [...source.matchAll(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:\\n)`, 'gm'))];
    assert.equal(jobs.length, 1); return jobs[0][1];
  };
  const job = extract('installed-sdk'), repro = extract('reproducibility');
  assert.match(job, /^    runs-on: \$\{\{ matrix.os \}\}$/m);
  assert.match(job, /^    needs: \[gate, images\]$/m);
  assert(!/^    (?:if|continue-on-error):/m.test(job));
  const setupNode = '      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38\n        with:\n          node-version: 22.23.2\n';
  const hostPrerequisite = (job, command) => {
    assert.equal(job.split(setupNode).length, 2, 'exactly one pinned host Node setup required');
    const firstNode = job.indexOf(command);
    assert(firstNode > job.indexOf(setupNode), 'pinned Node must precede the first source helper');
  };
  for (const [text, command] of [[job, 'node root-a/scripts/product-sdk-check.mjs tests'], [repro, 'node "$root/scripts/sdk-image-inputs.mjs"']]) {
    hostPrerequisite(text, command);
    assert.throws(() => hostPrerequisite(text.replace(setupNode, ''), command));
    assert.throws(() => hostPrerequisite(text.replace('node-version: 22.23.2', 'node-version: 20'), command));
  }
  const sdkRows = [...job.matchAll(/          - os: ([^\n]+)\n            arch: ([^\n]+)\n/g)];
  assert.equal([...job.matchAll(/^            arch: /gm)].length, 2);
  assert.deepEqual(sdkRows.map(row => row.slice(1)),
    [['ubuntu-24.04', 'amd64'], ['ubuntu-24.04-arm', 'arm64']]);
  const steps = [...job.matchAll(/^      - name: Verify both complete installed-SDK runs on the native isolated runner\n([\s\S]*?)(?=^      - )/gm)]; assert.equal(steps.length, 1);
  const step = /^        shell: bash\n        env:\n          RESULT_NAME: sdk-\$\{\{ matrix.arch \}\}\n          NATIVE_PLATFORM: linux\/\$\{\{ matrix.arch \}\}\n        run: \|\n((?:          .*\n)+)$/.exec(steps[0][1]);
  assert(step, 'closed mandatory SDK step required');
  const run = step[1].split('\n').map(line => line.slice(10)).join('\n');
  const wrapper = readFileSync(new URL('./sdk-vv-outer.sh', import.meta.url), 'utf8');
  const inner = /  '(node root-a\/scripts\/sdk-vv-check\.mjs tests; node root-a\/scripts\/sdk-vv-check\.mjs run [^'\n]+)'/.exec(wrapper);
  assert(inner, 'both original owning and installed operations must execute inside the pinned image');
  assert(wrapper.includes('--target registry_qualification_tools'));
  assert(wrapper.includes('--read-only --user "$(id -u):$(id -g)"'));
  assert(wrapper.includes('test "$(controlled actor-running 10 container inspect "$container_id" --format'));
  assert(wrapper.includes('absent id-absence "$container_id"'));
  assert(repro.includes('browser-api-sdk-check.sh')); assert(repro.includes('library-sdk-check.sh'));
  const dir = mkdtempSync(join(tmpdir(), 'prismpm-vv-workflow-unit-')); t.after(() => rmSync(dir, {recursive:true, force:true}));
  mkdirSync(join(dir, '.shipped-image')); writeFileSync(join(dir, '.shipped-image/sdk-image.txt'), image + '\n');
  // Explicit workflow units, not real Docker/image/SDK acceptance. Execute the
  // actual job command and its exact image-owned inner command in real shells.
  const script = `cd "$UNIT_ROOT"\nnode() { printf '%s\\n' "$*" >> "$UNIT_ROOT/commands"; [ "\${UNIT_FAIL:-}" != "$2" ]; }; export -f node\nbash() { test "$1" = root-a/scripts/sdk-vv-outer.sh; shift; test "$#" = 4; /bin/bash --noprofile --norc -euo pipefail -c ${JSON.stringify(inner[1])} sdk-outer "$@"; }\n` + run;
  const env = {PATH:process.env.PATH, UNIT_ROOT:dir, RESULT_NAME:'sdk-unit', NATIVE_PLATFORM:'linux/amd64', GITHUB_SHA:revision};
  const result = await execute('/bin/bash', ['-c', script], {environment:env}); assert.equal(result.status,0);
  assert.deepEqual(readFileSync(join(dir, 'commands'), 'utf8').trim().split('\n'), [
    'root-a/scripts/sdk-vv-check.mjs tests', `root-a/scripts/sdk-vv-check.mjs run ${image} ${revision} amd64 sdk-unit-full-sdk-vv`]);
  for (const mode of ['tests', 'run']) assert.notEqual((await execute('/bin/bash', ['-c', script], {environment:{...env,UNIT_FAIL:mode}})).status,0);
});
