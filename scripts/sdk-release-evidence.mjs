// Preserve original SDK gate evidence. This is not an acceptance authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {constants, closeSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateExecution} from './sdk-vv-check.mjs';
import {assembleVvEvidence, vvParts} from './sdk-vv-run.mjs';
import {verifyResult as verifyProduct} from './product-sdk-check.mjs';
import {bootstrapNames, validateBootstrapRetention} from './sdk-bootstrap-retention.mjs';
import {assembleSourceEvidence, releaseContext, sourceEvidenceNames, validateNative} from './release-gate-evidence.mjs';

const MAX_FILE = 64 * 1024 * 1024, MAX_STDOUT = 256 * 1024 * 1024, MAX_TOTAL = 1024 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.slice().sort());
const productFiles = ['source.json', 'image.json', 'inventory.json', 'standards.lock', 'prismpm.lock',
  'acquire.stdout.json', 'acquire.stderr.txt', 'acquisition.json', 'build.stdout.json',
  'build.stderr.txt', 'build.json', 'result.json', 'receiver.stderr.txt'].sort();
const vvFiles = part => ['acceptance.json', 'execution.json', 'vv-part.json', 'image-plan.json', 'loaded-identities.json',
  ...(part === 'source' ? ['bootstrap.json', ...bootstrapNames.map(name => `run-1-${name}`)] : [])];
const MAX_COMMANDS = 9999;
const MAX_VV_ENTRIES = vvFiles('source').length + MAX_COMMANDS * 3 + 1; // Include excluded docker/.

function regular(path, maximum) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint: true});
    assert(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum), 'bounded unaliased evidence file');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      assert(count > 0, 'evidence shortened'); offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0, 'evidence grew');
    for (const after of [fstatSync(fd, {bigint: true}), lstatSync(path, {bigint: true})]) {
      assert(after.isFile() && !after.isSymbolicLink());
      for (const key of ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key], 'evidence changed');
    }
    return bytes;
  } finally { closeSync(fd); }
}

export function captureEvidence(directory, kind, context) {
  const originalGate = ['source-vv', 'native-equivalence'].includes(kind);
  keys(context, ['source_revision', 'image_reference', 'architecture', ...(originalGate ? ['run_id', 'run_attempt'] : []),
    ...(kind === 'full-sdk-vv' ? ['part'] : [])]);
  if (kind === 'full-sdk-vv') assert(vvParts.includes(context.part), 'closed V&V part');
  assert.match(context.source_revision, /^[0-9a-f]{40}$/);
  if (kind === 'source-vv') assert.equal(context.image_reference, null);
  else assert.match(context.image_reference, /^ghcr\.io\/uor-foundation\/prismpm-sdk@sha256:[0-9a-f]{64}$/);
  assert(['amd64', 'arm64'].includes(context.architecture));
  assert(['full-sdk-vv', 'product-cli', 'source-vv', 'native-equivalence'].includes(kind));
  if (originalGate) releaseContext(context.source_revision, context.architecture, context.image_reference, context.run_id, context.run_attempt);
  directory = resolve(directory);
  assert.equal(realpathSync(directory), directory, 'evidence directory cannot be aliased');
  const directoryIdentity = lstatSync(directory, {bigint: true}); assert(directoryIdentity.isDirectory());
  const names = readdirSync(directory).sort();
  assert(names.length <= (kind === 'product-cli' ? productFiles.length : MAX_VV_ENTRIES), 'evidence file-count limit');
  const files = new Map(); let total = 0;
  for (const name of names) {
    if (kind === 'full-sdk-vv' && name === 'docker') {
      const path = join(directory, name), stat = lstatSync(path);
      assert(stat.isDirectory() && !stat.isSymbolicLink());
      // Buildx also writes private transport configuration here. It is not
      // gate evidence; never inspect, copy or publish it (including credentials).
      continue;
    }
    assert(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name), 'closed flat evidence paths');
    // sdk-vv-check retains the genuine CLI binary in one raw stdout, whose
    // producer limit is 256 MiB. Do not truncate it to the metadata bound.
    const maximum = (kind === 'full-sdk-vv' && /^\d{4}\.stdout$/.test(name)) || (originalGate && name.endsWith('.stdout')) ? MAX_STDOUT : MAX_FILE;
    const bytes = regular(join(directory, name), Math.min(maximum, MAX_TOTAL - total));
    total += bytes.length; assert(total <= MAX_TOTAL, 'complete evidence exceeds one GiB');
    files.set(name, bytes);
  }
  for (const key of ['dev', 'ino', 'mtimeNs', 'ctimeNs']) assert.equal(lstatSync(directory, {bigint: true})[key], directoryIdentity[key], 'evidence directory changed');
  const json = name => JSON.parse(files.get(name));
  if (kind === 'source-vv') {
    assert.deepEqual([...files.keys()], sourceEvidenceNames());
    assert.deepEqual(files.get('source-vv.json'), assembleSourceEvidence(files, context), 'exact assembled source evidence');
  } else if (kind === 'native-equivalence') {
    assert.deepEqual([...files.keys()], ['native-result.json', ...['native-check', 'container-check', 'native-error', 'container-error']
      .flatMap(prefix => ['json', 'stdout', 'stderr'].map(suffix => `${prefix}.${suffix}`))].sort());
    validateNative(files, context);
  } else if (kind === 'product-cli') {
    assert.deepEqual([...files.keys()], productFiles, 'complete product CLI evidence required');
    verifyProduct(json('result.json'), context.image_reference);
    assert.equal(json('source.json').revision, context.source_revision);
    assert.equal(json('prismpm.lock').sdk_image, context.image_reference);
    assert.equal(json('build.json').sdk_image, context.image_reference);
    const images = json('image.json'); assert(Array.isArray(images) && images.length === 1);
    assert.equal(images[0].Architecture, context.architecture); assert.equal(images[0].Os, 'linux');
    assert.equal(images[0].Config.Labels['org.opencontainers.image.revision'], context.source_revision);
  } else {
    for (const name of vvFiles(context.part)) assert(files.has(name), 'missing original ' + name);
    const records = [...files.keys()].filter(name => /^\d{4}\.json$/.test(name));
    assert(records.length > 0 && records.length <= MAX_COMMANDS);
    const expected = [...vvFiles(context.part)];
    for (let index = 0; index < records.length; index++) {
      const number = String(index + 1).padStart(4, '0');
      for (const suffix of ['json', 'stdout', 'stderr']) expected.push(number + '.' + suffix);
      const row = json(number + '.json');
      keys(row, ['arguments', 'status', 'signal', 'stdout_sha256', 'stderr_sha256']);
      assert(Array.isArray(row.arguments) && row.arguments.every(value => typeof value === 'string'));
      assert(Number.isInteger(row.status) && row.status >= 0 && row.status <= 255); assert.equal(row.signal, null);
      for (const stream of ['stdout', 'stderr']) assert.equal(hash(files.get(number + '.' + stream)), row[stream + '_sha256']);
    }
    assert.deepEqual([...files.keys()], expected.sort(), 'complete original command transcript required');
    const execution = files.get('execution.json');
    validateExecution(execution, files.get('vv-part.json'),
      context.image_reference, context.source_revision, context.architecture, context.part);
    if (context.part === 'source') validateBootstrapRetention(files.get('bootstrap.json'), new Map(bootstrapNames.map(name => {
      const path = `run-1-${name}`; return [path, files.get(path)];
    })), context.source_revision);
    const result = json('acceptance.json');
    assert.equal(result.schema, 'prismpm/sdk-installed-vv-check/2'); assert.equal(result.status, 'passed');
    assert.equal(result.scope, 'isolated-installed-vv-part');
    for (const key of Object.keys(context)) assert.equal(result[key], context[key]);
    assert.equal(result.execution_sha256, hash(execution));
    assert.deepEqual(result.phases, ['exact-native-images-acquired', 'external-network-disconnected',
      'isolated-native-sdk-probed', 'vv-part-record-verified', 'owned-resources-removed']);
    assert.deepEqual(result.unclaimed, ['hardware-attestation', 'sdk-release', 'product-readiness']);
  }
  return {files, manifest: {schema: 'prismpm/sdk-gate-evidence/1', scope: 'original-gate-evidence-only',
    kind, ...context, excluded: kind === 'full-sdk-vv' ? ['docker/'] : [],
    files: [...files].map(([path, bytes]) => ({path, size: bytes.length, sha256: hash(bytes)})),
    unclaimed: ['sdk-acceptance', 'crates.io-publication', 'ecosystem-acceptance', 'foundry-readiness', 'deployment']}};
}

// Every part directory must validate before the architecture's 15 gates count.
export function assembleInstalled(root, output, context) {
  const records = new Map(vvParts.map(part => {
    const {files} = captureEvidence(join(root, `sdk-${context.architecture}-full-sdk-vv-${part}`), 'full-sdk-vv', {...context, part});
    return [part, files.get('vv-part.json')];
  }));
  writeFileSync(output, assembleVvEvidence(records, context.source_revision), {flag: 'wx', mode: 0o644});
}

export function packEvidence(directory, kind, output, context) {
  const captured = captureEvidence(directory, kind, context);
  output = resolve(output); const parent = dirname(output);
  assert.equal(realpathSync(parent), parent); assert(!lstatSync(output, {throwIfNoEntry: false}), 'fresh archive required');
  const stage = mkdtempSync(join(parent, '.sdk-evidence-'));
  try {
    const root = join(stage, 'evidence'); mkdirSync(root, {mode: 0o700});
    for (const [name, bytes] of captured.files) writeFileSync(join(root, name), bytes, {flag: 'wx', mode: 0o444});
    writeFileSync(join(root, 'evidence-manifest.json'), canonical(captured.manifest) + '\n', {flag: 'wx', mode: 0o444});
    const archive = join(stage, 'evidence.tar');
    execFileSync('tar', ['--format=ustar', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
      '--mode=0444', '-cf', archive, '-C', root, ...[...captured.files.keys(), 'evidence-manifest.json'].sort()],
    {timeout: 120000, maxBuffer: 1024 * 1024});
    // No caller-controlled tar input is executed or extracted by this command.
    linkSync(archive, output); // Atomic create-only publication; never overwrite.
    return captured.manifest;
  } finally { rmSync(stage, {recursive: true, force: true}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [kind, directory, output, image, source_revision, architecture, ...extra] = process.argv.slice(2);
  const context = {image_reference: image === '-' ? null : image, source_revision, architecture};
  if (kind === 'assemble-installed') {
    assert.equal(extra.length, 0);
    assembleInstalled(directory, output, context);
  } else {
    const original = ['source-vv', 'native-equivalence'].includes(kind);
    assert.equal(extra.length, original ? 2 : kind === 'full-sdk-vv' ? 1 : 0);
    packEvidence(directory, kind, output, {...context,
      ...(original ? {run_id: extra[0], run_attempt: extra[1]} : {}), ...(kind === 'full-sdk-vv' ? {part: extra[0]} : {})});
  }
}
