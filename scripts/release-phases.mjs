// Release transport policy, not application semantics or SDK acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { constants, closeSync, createReadStream, fstatSync, lstatSync, mkdtempSync, openSync,
  readFileSync, readSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateConfig } from './sdk-candidate.mjs';
import { describeSpdx, releaseTransportPolicy, transportSbom, trustRootDigest, verificationArguments } from './sdk-candidate-sbom.mjs';

const repository = 'UOR-Foundation/PrismPM';
const imageNames = ['sdk', 'runtime', 'adapter-compose', 'adapter-kubernetes', 'adapter-github-pages', 'oracles'];
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const ociNeeds = ['gate', 'images', 'native', 'reproducibility', 'installed-sdk'];

export function publicationPolicy(value) {
  assert.deepEqual(Object.keys(value).sort(), ['event', 'publishCrates', 'ref', 'repository', 'revision', 'version']);
  assert.equal(value.repository, repository);
  assert.equal(value.version, '0.3.0');
  assert.match(value.revision, /^[0-9a-f]{40}$/);
  let publishCrates;
  if (value.event === 'workflow_dispatch') {
    assert.equal(value.ref, 'refs/heads/main');
    assert.equal(typeof value.publishCrates, 'boolean', 'Cargo publication choice must be explicit');
    publishCrates = value.publishCrates;
  } else {
    assert.equal(value.event, 'push');
    assert.equal(value.ref, 'refs/tags/v0.3.0');
    assert.equal(value.publishCrates, null);
    publishCrates = true;
  }
  return {version: value.version, publishCrates};
}

function policyFromEnvironment(environment) {
  const event = environment.GITHUB_EVENT_NAME;
  return publicationPolicy({repository: environment.GITHUB_REPOSITORY, ref: environment.GITHUB_REF,
    event, version: environment.DISPATCH_VERSION || environment.GITHUB_REF_NAME?.replace(/^v/, ''),
    publishCrates: event === 'push' ? null : JSON.parse(environment.PUBLISH_CRATES), revision: environment.GITHUB_SHA});
}

function publicationTag(environment) {
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'publication requires GitHub Actions context');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) {
    const value = environment[key];
    assert(typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && !/\D/.test(value),
      'publication requires a canonical decimal ' + key);
  }
  // Gate transcripts and signature bundles are specific to an execution, not
  // deterministic functions of source alone. Never overwrite an earlier run.
  return `sdk-oci-${environment.GITHUB_SHA}-${environment.GITHUB_RUN_ID}-${environment.GITHUB_RUN_ATTEMPT}`;
}

export function requirePrerequisites(phase, needs) {
  assert.ok(['oci-native', 'release'].includes(phase));
  const expected = phase === 'oci-native' ? ociNeeds : [...ociNeeds, 'oci-native', 'crates'];
  assert.deepEqual(Object.keys(needs).sort(), [...expected].sort());
  for (const name of expected) assert.equal(needs[name]?.result, 'success', `${name} did not succeed`);
}

const metadataLimit = 16 * 1024 ** 2;
const layerLimit = 32 * 1024 ** 3;
const layoutLimit = 128 * 1024 ** 3;
const identityFields = ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'];
const layerTypes = new Set(['', '+gzip', '+zstd'].flatMap(compression =>
  ['', '.nondistributable'].map(kind => `application/vnd.oci.image.layer${kind}.v1.tar${compression}`)));

function sameIdentity(actual, expected) {
  for (const key of identityFields) assert.equal(actual[key], expected[key], 'OCI input changed during read');
}

function verifyObservations(observations) {
  for (const {path, identity} of observations) {
    assert.equal(realpathSync(path), path, 'OCI input path changed during read');
    sameIdentity(lstatSync(path, {bigint: true}), identity);
  }
}

function descriptorSize(descriptor, maximum) {
  assert.match(descriptor.digest, /^sha256:[0-9a-f]{64}$/);
  assert.ok(Number.isSafeInteger(descriptor.size) && descriptor.size >= 0 && descriptor.size <= maximum,
    'OCI descriptor exceeds its byte bound');
}

// Layer bodies are never buffered. Every invocation opens and reads every
// declared byte through EOF; metadata and path identities are checked again
// before closing. This is observed custody, not atomic filesystem isolation.
function readLayoutFile(path, maximum, descriptor = null, retain = true, observations = []) {
  assert.equal(realpathSync(path), path, 'OCI file path is aliased');
  const before = lstatSync(path, {bigint: true});
  assert.ok(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum),
    'OCI input must be a bounded independent regular file');
  if (descriptor) {
    descriptorSize(descriptor, maximum);
    assert.equal(before.size, BigInt(descriptor.size), 'OCI blob size differs from its descriptor');
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    sameIdentity(fstatSync(fd, {bigint: true}), before);
    const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024), chunks = [];
    let length = 0;
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      length += count;
      assert.ok(length <= maximum && BigInt(length) <= before.size, 'OCI input grew during read');
      hash.update(buffer.subarray(0, count));
      if (retain) chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    assert.equal(BigInt(length), before.size, 'OCI input shortened during read');
    sameIdentity(fstatSync(fd, {bigint: true}), before);
    sameIdentity(lstatSync(path, {bigint: true}), before);
    assert.equal(realpathSync(path), path, 'OCI file path changed during read');
    const digest = `sha256:${hash.digest('hex')}`;
    if (descriptor) assert.equal(digest, descriptor.digest, 'OCI blob digest differs from its descriptor');
    observations.push({path, identity: before});
    return retain ? Buffer.concat(chunks, length) : null;
  } finally { closeSync(fd); }
}

function readBlob(directory, descriptor, observations, maximum = metadataLimit, retain = true) {
  descriptorSize(descriptor, maximum);
  const bytes = readLayoutFile(join(directory, 'blobs/sha256', descriptor.digest.slice(7)), maximum, descriptor, retain, observations);
  return retain ? JSON.parse(bytes) : null;
}

function parseBlob(bytes, descriptor) {
  assert.equal(sha(bytes), descriptor.digest);
  assert.equal(bytes.length, descriptor.size);
  return JSON.parse(bytes);
}

function rebuiltManifest(directory, architecture, revision) {
  directory = resolve(directory);
  const parents = [directory, join(directory, 'blobs'), join(directory, 'blobs/sha256')].map(path => {
    assert.equal(realpathSync(path), path, 'OCI directory path is aliased');
    const identity = lstatSync(path, {bigint: true});
    assert.ok(identity.isDirectory() && !identity.isSymbolicLink(), 'OCI directory required');
    return {path, identity};
  });
  const observations = [];
  const index = JSON.parse(readLayoutFile(join(directory, 'index.json'), metadataLimit, null, true, observations));
  assert.equal(index.schemaVersion, 2);
  assert.equal(index.manifests.length, 1);
  const descriptor = index.manifests[0];
  assert.equal(descriptor.mediaType, 'application/vnd.oci.image.manifest.v1+json');
  const manifest = readBlob(directory, descriptor, observations);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.mediaType, descriptor.mediaType);
  assert.equal(manifest.config.mediaType, 'application/vnd.oci.image.config.v1+json');
  validateConfig(readBlob(directory, manifest.config, observations), architecture, revision);
  assert.ok(Array.isArray(manifest.layers) && manifest.layers.length <= 4096, 'bounded OCI layer inventory required');
  let total = 0;
  for (const layer of manifest.layers) {
    assert.ok(layerTypes.has(layer.mediaType), 'OCI image layer media type required');
    descriptorSize(layer, layerLimit);
    total += layer.size;
    assert.ok(total <= layoutLimit, 'OCI layer closure exceeds its byte bound');
  }
  for (const layer of manifest.layers) readBlob(directory, layer, observations, layerLimit, false);
  const verify = () => verifyObservations([...parents, ...observations]);
  verify();
  return {descriptor, verify};
}

function publishedPlatform(image, indexBytes, architecture) {
  assert.ok(['amd64', 'arm64'].includes(architecture));
  const [name, digest, extra] = image.trim().split('@');
  assert.equal(extra, undefined);
  assert.ok(imageNames.some(suffix => name === `ghcr.io/uor-foundation/prismpm-${suffix}`));
  assert.equal(sha(indexBytes), digest, 'downloaded index differs from published immutable reference');
  const index = JSON.parse(indexBytes);
  assert.equal(index.schemaVersion, 2);
  assert.equal(index.mediaType, 'application/vnd.oci.image.index.v1+json');
  assert.equal(index.manifests.length, 2);
  assert.deepEqual(index.manifests.map(row => row.platform?.architecture).sort(), ['amd64', 'arm64']);
  for (const row of index.manifests) {
    assert.equal(row.platform.os, 'linux');
    assert.equal(row.mediaType, 'application/vnd.oci.image.manifest.v1+json');
    assert.match(row.digest, /^sha256:[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(row.size) && row.size > 0);
  }
  return index.manifests.find(row => row.platform.architecture === architecture);
}

export function verifyReproducibility(image, indexBytes, architecture, revision, first, second) {
  assert.match(revision, /^[0-9a-f]{40}$/);
  const published = publishedPlatform(image, indexBytes, architecture);
  const owners = [];
  for (const directory of [first, second]) {
    const {descriptor: rebuilt, verify} = rebuiltManifest(directory, architecture, revision);
    owners.push(verify);
    assert.equal(rebuilt.digest, published.digest, 'rebuilt bytes differ from the shipped platform manifest');
    assert.equal(rebuilt.size, published.size);
  }
  for (const owner of owners) owner();
  return published.digest;
}

export function releaseSbomRecord(image, indexBytes, childBytes, configBytes, spdxBytes, architecture, revision) {
  assert.match(revision, /^[0-9a-f]{40}$/);
  const child = publishedPlatform(image, indexBytes, architecture);
  const manifest = parseBlob(childBytes, child);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.mediaType, child.mediaType);
  assert.equal(manifest.config.mediaType, 'application/vnd.oci.image.config.v1+json');
  validateConfig(parseBlob(configBytes, manifest.config), architecture, revision);
  return {source_revision: revision, platform: `linux/${architecture}`, image_reference: image,
    image_index_digest: sha(indexBytes), image_config_digest: sha(configBytes),
    subject: {mediaType: child.mediaType, digest: child.digest, size: child.size},
    spdx: describeSpdx(spdxBytes), production_accepted: false};
}

export function imageVerificationArguments(image, revision, ref, trustedRoot) {
  const [name, digest, extra] = image.split('@');
  assert.equal(extra, undefined);
  return verificationArguments({source_revision: revision}, digest, trustedRoot,
    releaseTransportPolicy(name, ref));
}

export function verifyExistingRelease(release, expected, downloaded, tagCommit, draft = false) {
  assert.equal(release.tag_name, expected.tag);
  assert.equal(release.target_commitish, expected.revision);
  assert.equal(tagCommit, expected.revision, 'publication tag resolves to a different source');
  assert.equal(release.prerelease, true);
  assert.equal(release.draft, draft);
  assert.equal(release.body, expected.notes);
  const metadata = values => values.map(({name, size}) => ({name, size})).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(metadata(release.assets), metadata(expected.files));
  assert.deepEqual(downloaded, expected.files, 'existing publication bytes cannot be overwritten');
}

function run(args) {
  const result = spawnSync('gh', args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 300_000});
  if (result.error) throw result.error;
  assert.equal(result.signal, null, 'GitHub operation terminated');
  return result;
}

function checked(args) {
  const result = run(args);
  assert.equal(result.status, 0, `GitHub operation failed: ${result.stderr}`);
  return result.stdout;
}

function api(path, missingAllowed = false) {
  const response = run(['api', '--include', path]);
  const match = response.stdout.match(/^HTTP\/[^ ]+ (\d{3})[^\r\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/);
  assert.ok(match, 'GitHub API did not return a status and body');
  if (missingAllowed && match[1] === '404' && response.status !== 0) return null;
  assert.equal(response.status, 0, 'GitHub API request failed');
  assert.equal(match[1], '200');
  return JSON.parse(match[2]);
}

async function filesIn(directory) {
  const result = [];
  for (const name of readdirSync(directory).sort()) {
    assert.match(name, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    const path = join(directory, name), stat = lstatSync(path);
    assert.ok(stat.isFile(), 'release assets must be regular files');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    result.push({name, size: stat.size, digest: `sha256:${digest.digest('hex')}`});
  }
  assert.ok(result.length > 0);
  return result;
}

export function publicationNotes(revision) {
  assert.match(revision, /^[0-9a-f]{40}$/);
  return `# PrismPM OCI/native verification candidate\n\nSource: ${repository}@${revision}\n\n` +
    'These immutable OCI/native assets passed the workflow prerequisites and are published for verification.\n' +
    'This phase does not publish Cargo packages, versioned discovery aliases, or an accepted SDK/ecosystem release.\n' +
    'Each platform has complete raw SPDX in a separately signed OCI artifact, not an inline SPDX attestation.\n' +
    'Original native installed-SDK two-run evidence is retained; independent SDK acceptance remains separate.\n' +
    'Public Cargo qualification and ecosystem acceptance are separate later phases.\n';
}

export function assetNames() {
  return [
    'SHA256SUMS', 'source-vv.tar', 'sdk-metadata-native-join.json',
    ...['amd64', 'arm64'].flatMap(architecture => [
      `sdk-${architecture}-full-sdk-vv.tar`, `sdk-${architecture}-product-cli.tar`,
      `sdk-${architecture}-native-equivalence.tar`,
      `sdk-${architecture}-native-metadata.tar`,
      `sdk-${architecture}-browser-sdk.log`, `sdk-${architecture}-library-sdk.log`,
    ]),
    ...['x86_64', 'aarch64'].flatMap(architecture => [
      `prismpm-0.3.0-${architecture}-unknown-linux-gnu.tar.gz`,
      `prismpm-0.3.0-${architecture}-unknown-linux-gnu.tar.gz.sha256`,
    ]),
    ...imageNames.flatMap(name => [
      `${name}-image.txt`, `${name}-image-index.json`, `${name}-provenance.sigstore.json`,
      ...['amd64', 'arm64'].flatMap(architecture => [
        `${name}-linux-${architecture}.spdx.json`, `${name}-linux-${architecture}.sbom.sigstore.json`,
        `${name}-linux-${architecture}.sbom-record.json`, `${name}-linux-${architecture}.sbom-manifest.json`,
        `${name}-linux-${architecture}.sbom-artifact.json`, `${name}-linux-${architecture}.sbom-signature-verification.json`,
        `${name}-linux-${architecture}.image-manifest.json`, `${name}-linux-${architecture}.image-config.json`,
        `${name}-${architecture}-reproducibility.txt`,
      ]),
    ]),
  ].sort();
}

export async function publishOci(directory, revision, client = {api, checked, environment: process.env}) {
  policyFromEnvironment(client.environment);
  assert.equal(client.environment.GITHUB_SHA, revision);
  const tag = publicationTag(client.environment), notes = publicationNotes(revision);
  const expected = {tag, revision, notes, files: await filesIn(directory)};
  assert.deepEqual(expected.files.map(file => file.name), assetNames(), 'publication asset closure is incomplete');
  const endpoint = `repos/${repository}/releases/tags/${tag}`;
  const existing = client.api(endpoint, true);
  const tagEndpoint = `repos/${repository}/commits/${tag}`;
  const tagRecord = client.api(tagEndpoint, true);
  if (tagRecord !== null) assert.equal(tagRecord.sha, revision, 'existing tag targets a different source');
  if (existing !== null) {
    assert.equal(typeof existing.draft, 'boolean');
    assert.ok(tagRecord !== null || existing.draft, 'published release tag is absent');
    verifyExistingRelease(existing, expected, expected.files, tagRecord?.sha ?? revision, existing.draft);
  }
  if (existing === null) {
    // Draft staging prevents publication of a partially uploaded asset closure.
    client.checked(['release', 'create', tag, '--repo', repository, '--target', revision, '--draft', '--prerelease',
      '--title', `PrismPM OCI/native ${revision}`, '--notes', notes]);
    client.checked(['release', 'upload', tag, '--repo', repository, ...expected.files.map(file => join(directory, file.name))]);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'prismpm-oci-download-'));
  try {
    client.checked(['release', 'download', tag, '--repo', repository, '--dir', scratch]);
    const release = client.api(endpoint);
    // A draft release may not create its tag until publication. Its exact
    // target_commitish is checked before publication, then the real tag after.
    const staged = existing === null || existing.draft;
    const currentTag = client.api(tagEndpoint, true);
    assert.ok(currentTag !== null || staged, 'published release tag is absent');
    verifyExistingRelease(release, expected, await filesIn(scratch), currentTag?.sha ?? revision, staged);
    if (staged) {
      client.checked(['release', 'edit', tag, '--repo', repository, '--draft=false']);
      verifyExistingRelease(client.api(endpoint), expected, await filesIn(scratch), client.api(tagEndpoint).sha);
    }
  } finally { rmSync(scratch, {recursive: true, force: true}); }
  return `https://github.com/${repository}/releases/tag/${tag}`;
}

async function main([command, ...args]) {
  if (command === 'policy') {
    assert.equal(args.length, 0);
    const policy = policyFromEnvironment(process.env);
    process.stdout.write(`version=${policy.version}\npublish-crates=${policy.publishCrates}\n`);
  } else if (command === 'prerequisites') {
    assert.equal(args.length, 1);
    requirePrerequisites(args[0], JSON.parse(process.env.RELEASE_NEEDS));
  } else if (command === 'reproducibility') {
    assert.equal(args.length, 6);
    const [reference, index, architecture, revision, first, second] = args;
    const image = readFileSync(reference, 'utf8').trim();
    const digest = verifyReproducibility(image, readFileSync(index), architecture, revision, first, second);
    process.stdout.write(`${revision} linux/${architecture} ${image} ${digest}\n`);
  } else if (command === 'publish-oci') {
    assert.equal(args.length, 1);
    requirePrerequisites('oci-native', JSON.parse(process.env.RELEASE_NEEDS));
    process.stdout.write(`${await publishOci(resolve(args[0]), process.env.GITHUB_SHA)}\n`);
  } else if (command === 'image-verify') {
    assert.equal(args.length, 4);
    const verification = imageVerificationArguments(...args);
    assert.equal(sha(readFileSync(args[3])), trustRootDigest);
    process.stdout.write(execFileSync('cosign', verification,
      {stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 8 * 1024 * 1024, timeout: 300_000}));
  } else if (['sbom-record', 'sbom-publish', 'sbom-verify'].includes(command)) {
    assert.equal(args.length, command === 'sbom-record' ? 5 : 6);
    const [directory, architecture, revision, image, ref, trustedRoot] = args;
    const read = name => readFileSync(join(directory, name));
    const record = releaseSbomRecord(image, read('index.json'), read('manifest.json'), read('config.json'),
      read('sbom.spdx.json'), architecture, revision);
    const options = releaseTransportPolicy(image.split('@')[0], ref);
    if (command === 'sbom-publish') policyFromEnvironment(process.env);
    transportSbom(command, directory, record, trustedRoot, options);
  } else throw new Error('unsupported release phase operation');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
