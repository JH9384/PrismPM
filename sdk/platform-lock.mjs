// SDK-owned bootstrap transport validation. Inventory facts come from the
// actual digest-selected images; this does not grant release acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {boundedPositiveInteger, caseKeys, descriptor as ociDescriptor, limits, parseJson} from './metadata-layer.mjs';

const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const digest = /^sha256:[0-9a-f]{64}$/;
const image = /^[a-z0-9.-]+(?::[0-9]{1,5})?\/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/;
const architectures = ['amd64', 'arm64'];
const kinds = ['adapter', 'base-image', 'binary', 'crate', 'dependency-lock', 'image',
  'oracle', 'schema', 'test-corpus', 'trust-root', 'workflow'];
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

async function boundedFile(file, maximum = 8 * 1024 * 1024) {
  const path=resolve(file);
  assert.equal(await realpath(path),path,'SDK evidence ancestry is aliased');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let failure;
  try {
    const before=await handle.stat({bigint:true});
    assert(before.isFile()&&before.nlink===1n,'SDK evidence must be a single-link regular file');
    assert(before.size<=BigInt(maximum),'SDK evidence exceeds its byte bound');
    const bytes=Buffer.alloc(Number(before.size));let offset=0;
    while(offset<bytes.length) {
      const {bytesRead}=await handle.read(bytes,offset,Math.min(65536,bytes.length-offset),null);
      assert(bytesRead>0,'SDK evidence shortened');offset+=bytesRead;
    }
    assert.equal((await handle.read(Buffer.alloc(1),0,1,null)).bytesRead,0,'SDK evidence grew');
    for(const after of [await handle.stat({bigint:true}),await lstat(path,{bigint:true})])
      for(const key of ['dev','ino','uid','gid','mode','nlink','size','mtimeNs','ctimeNs'])
        assert.equal(after[key],before[key],'SDK evidence descriptor or name changed');
    assert.equal(await realpath(path),path,'SDK evidence ancestry changed');
    return bytes;
  } catch(error) {failure=error;throw error;}
  finally {
    try {await handle.close();}catch(error) {
      throw new AggregateError(failure?[failure,error]:[error],
        'SDK evidence read or descriptor retirement failed',{cause:failure});
    }
  }
}

async function boundedIndexInput() {
  const chunks=[];let length=0;
  for await(const chunk of process.stdin) {
    assert(Buffer.isBuffer(chunk),'raw SDK index input required');
    length+=chunk.length;assert(length<=limits.document,'SDK index exceeds its byte bound');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,length);
}

export function parseSdkIndex(bytes, reference) {
  assert.ok(bytes.length <= 1024 * 1024, 'SDK index exceeds its byte bound');
  assert.match(reference, image);
  const port = reference.split('/', 1)[0].split(':', 2)[1];
  assert.ok(port === undefined || (Number(port) >= 1 && Number(port) <= 65535));
  assert.equal(sha(bytes), reference.split('@')[1], 'SDK index bytes disagree with pinned digest');
  const index = parseJson(bytes, (token, path) => {
    if (path.length === 1 && path[0] === 'schemaVersion')
      assert.equal(boundedPositiveInteger(token, 2), 2, 'OCI schema version differs');
    if (path.length === 3 && path[0] === 'manifests' && Number.isInteger(path[1]) && path[2] === 'size')
      boundedPositiveInteger(token, limits.document);
  });
  caseKeys(index, ['schemaVersion', 'mediaType', 'manifests', 'annotations', 'subject', 'artifactType']);
  assert.equal(index.schemaVersion, 2);
  assert.equal(index.mediaType, 'application/vnd.oci.image.index.v1+json');
  assert.equal(index.manifests.length, 2, 'SDK index must have exactly the two supported native platforms');
  const children = architectures.map(architecture => {
    const matching = index.manifests.filter(row => row.platform?.os === 'linux'
      && row.platform.architecture === architecture);
    assert.equal(matching.length, 1, `SDK index must contain exactly one linux/${architecture}`);
    const descriptor = matching[0];
    ociDescriptor(descriptor, limits.document, 'application/vnd.oci.image.manifest.v1+json');
    caseKeys(descriptor.platform, ['architecture', 'os', 'os.version', 'os.features', 'variant']);
    assert.ok(descriptor.platform['os.version'] === undefined && descriptor.platform['os.features'] === undefined,
      'SDK platform requirements are unsupported');
    assert.ok(descriptor.platform.variant === undefined
      || (architecture === 'arm64' && descriptor.platform.variant === 'v8'));
    return {architecture, reference: `${reference.split('@')[0]}@${descriptor.digest}`, descriptor};
  });
  assert.notEqual(children[0].descriptor.digest, children[1].descriptor.digest);
  return children;
}

export function validateInventory(bytes) {
  assert.ok(bytes.length <= 8 * 1024 * 1024, 'SDK inventory exceeds its byte bound');
  const inventory = JSON.parse(bytes);
  const encoded = JSON.stringify(canonical(inventory));
  assert.ok(bytes.toString() === encoded || bytes.toString() === `${encoded}\n`, 'SDK inventory is not canonical');
  assert.deepEqual(Object.keys(inventory).sort(), ['artifacts', 'commands', 'schema']);
  assert.equal(inventory.schema, 'prismpm/sdk-inventory/1');
  assert.ok(Array.isArray(inventory.commands) && inventory.commands.length > 0);
  assert.ok(Array.isArray(inventory.artifacts) && inventory.artifacts.length > 0);
  let previousCommand = '';
  for (const row of inventory.commands) {
    assert.deepEqual(Object.keys(row).sort(), ['command', 'executable', 'sha256']);
    assert.equal(typeof row.command, 'string');
    assert.ok(row.command.length > 0);
    assert.ok(Buffer.from(previousCommand).compare(Buffer.from(row.command)) < 0, 'commands must be unique and sorted');
    assert.equal(typeof row.executable, 'string');
    assert.ok(row.executable.startsWith('/'));
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    previousCommand = row.command;
  }
  let previous = '';
  for (const row of inventory.artifacts) {
    assert.deepEqual(Object.keys(row).sort(), ['digest', 'id', 'kind', 'version']);
    assert.match(row.id, /^[^\n]{1,128}$/);
    assert.match(row.version, /^[^\n]{1,128}$/);
    assert.match(row.digest, digest);
    assert.ok(kinds.includes(row.kind));
    assert.ok(Buffer.from(previous).compare(Buffer.from(row.id)) < 0, 'inventory IDs must be unique and sorted');
    assert.notEqual(row.id, 'sdk-manifest');
    previous = row.id;
  }
  // The SDK index is the enclosing image artifact; other classes must be real
  // image-local inventory entries, not rows synthesized by the consumer.
  for (const kind of kinds.filter(kind => kind !== 'image')) {
    assert.ok(inventory.artifacts.some(row => row.kind === kind), `SDK lacks ${kind} artifacts`);
  }
  for (const command of ['cargo', 'devcontainer', 'docker', 'just', 'prismpm']) {
    assert.ok(inventory.commands.some(row => row.command === command), `SDK lacks ${command}`);
  }
  return inventory;
}

// Shared target-image validation. Unlike bootstrap, an update deliberately
// selects a different SDK and must not compare it to the currently running one.
export async function validatePlatformBundle(directory, reference, standardsBytes) {
  const indexBytes = await boundedFile(`${directory}/index.json`, 1024 * 1024);
  const children = parseSdkIndex(indexBytes, reference);
  const platforms = [];
  let expectedIdentities;
  for (const child of children) {
    const path = `${directory}/${child.architecture}`;
    const inspected = JSON.parse(await boundedFile(`${path}/image.json`));
    assert.equal(inspected.Os, 'linux');
    assert.equal(inspected.Architecture, child.architecture);
    assert.ok(inspected.RepoDigests.includes(child.reference), 'copied inventory image is not the exact indexed child');
    const bytes = await boundedFile(`${path}/inventory.json`);
    const inventory = validateInventory(bytes);
    assert.deepEqual(await boundedFile(`${path}/standards.lock`, 16 * 1024 * 1024), standardsBytes, 'SDK platform standards locks differ');
    const identities = inventory.artifacts.map(row => [row.id, row.kind, row.version]);
    if (expectedIdentities) assert.deepEqual(identities, expectedIdentities, 'SDK platform artifact identities differ');
    expectedIdentities = identities;
    platforms.push({platform: `linux/${child.architecture}`, manifest_digest: child.descriptor.digest,
      inventory_digest: sha(bytes), inventory_document: bytes.toString('utf8'), inventory: inventory.artifacts});
  }
  return {schema: 'prismpm/sdk-lock/2', sdk_image: reference, sdk_index: indexBytes.toString('utf8'),
    sdk_version: '0.3.0', standards_lock: sha(standardsBytes), platforms};
}

export async function createPlatformLock(directory, reference, nativeInventoryBytes, standardsBytes, architecture) {
  const nativeArchitecture = {x64: 'amd64', arm64: 'arm64'}[architecture];
  assert.ok(nativeArchitecture, 'unsupported bootstrap host architecture');
  const lock = await validatePlatformBundle(directory, reference, standardsBytes);
  assert.deepEqual(await boundedFile(`${directory}/${nativeArchitecture}/inventory.json`), nativeInventoryBytes,
    'bootstrap runs a different native SDK inventory');
  return lock;
}

// The transport seam is used only by acquisition-negative tests. Production
// reads exact OCI graph bytes, never pulls images or starts foreign containers.
export async function capturePlatformLock(reference, standardsDigest, transport) {
  const {captureMetadataLock} = await import('./metadata-capture.mjs');
  if (transport !== undefined) return captureMetadataLock(reference, standardsDigest, transport);
  const {captureSdkMetadata, verifiedCommands} = await import('./metadata-cli.mjs');
  const inventory = '/opt/prismpm/share/inventory.json';
  const commands = existsSync(inventory) ? verifiedCommands(inventory) : [];
  return JSON.parse(await captureSdkMetadata(reference, standardsDigest, commands));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, reference, standardsDigest] = process.argv.slice(2);
  if (command === 'index') {
    assert.equal(process.argv.length, 4);
    for (const child of parseSdkIndex(await boundedIndexInput(), reference)) {
      process.stdout.write(`${child.architecture} ${child.reference}\n`);
    }
  } else {
    assert.equal(command, 'capture');
    assert.equal(process.argv.length, 5);
    // SDK lock files are exact canonical JSON; unlike inventory files, they
    // do not permit a trailing newline outside the canonical value.
    capturePlatformLock(reference, standardsDigest).then(lock => process.stdout.write(JSON.stringify(canonical(lock))))
      .catch(error => {process.stderr.write(String(error) + '\n'); process.exitCode = 1;});
  }
}
