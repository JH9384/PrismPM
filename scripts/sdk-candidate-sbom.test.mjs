import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { artifactManifest, describeSpdx, digest, emptyConfig, handleSbom, issuer,
  manifestType, repository, sbomRecord, signingArguments, trustRootDigest,
  releaseTransportPolicy, validateArtifact, verificationArguments, workflow } from './sdk-candidate-sbom.mjs';
import { releaseSbomRecord } from './release-phases.mjs';

const revision = 'a'.repeat(40);
const encode = value => Buffer.from(`${JSON.stringify(value)}\n`);
const rawSpdx = (license = 'fixture license') => encode({spdxVersion: 'SPDX-2.3',
  SPDXID: 'SPDXRef-DOCUMENT', dataLicense: 'CC0-1.0', name: 'sdk fixture',
  documentNamespace: 'https://example.test/spdx/sdk-fixture',
  creationInfo: {created: '1970-01-01T00:00:00Z', creators: ['Tool: fixture']},
  packages: [{SPDXID: 'SPDXRef-Package', name: 'fixture', downloadLocation: 'NOASSERTION'}],
  files: [{SPDXID: 'SPDXRef-File', fileName: './fixture', checksums: [{algorithm: 'SHA256', checksumValue: 'a'.repeat(64)}]}],
  relationships: [{spdxElementId: 'SPDXRef-Package', relatedSpdxElement: 'SPDXRef-File', relationshipType: 'CONTAINS'}],
  hasExtractedLicensingInfos: [{licenseId: 'LicenseRef-Fixture', extractedText: license}]});
function fixture(sbom = rawSpdx()) {
  const child = encode({schemaVersion: 2, mediaType: manifestType,
    config: {mediaType: 'application/vnd.oci.image.config.v1+json', digest: digest(emptyConfig), size: 2}, layers: []});
  const candidate = encode({source_revision: revision, platform: 'linux/amd64', manifest_digest: digest(child),
    inventory_digest: `sha256:${'b'.repeat(64)}`, standards_lock_digest: `sha256:${'c'.repeat(64)}`,
    development_only: true, production_accepted: false});
  const record = sbomRecord(candidate, child, sbom, 'amd64', revision, digest(child));
  const manifest = encode(artifactManifest(record));
  return {candidate, child, sbom, record, manifest};
}

function releaseFixture(sbom = rawSpdx(), architecture = 'amd64', imageName = 'sdk', ref = 'refs/heads/main') {
  const config = encode({architecture, os: 'linux', config: {Labels: {
    'org.opencontainers.image.created': '1970-01-01T00:00:00Z',
    'org.opencontainers.image.revision': revision,
    'org.opencontainers.image.source': 'https://github.com/UOR-Foundation/PrismPM',
    'org.opencontainers.image.version': '0.4.0'}}});
  const child = encode({schemaVersion: 2, mediaType: manifestType,
    config: {mediaType: 'application/vnd.oci.image.config.v1+json', digest: digest(config), size: config.length}, layers: []});
  const subject = {mediaType: manifestType, digest: digest(child), size: child.length};
  const index = encode({schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: ['amd64', 'arm64'].map(arch => ({...subject, platform: {os: 'linux', architecture: arch},
      digest: arch === architecture ? subject.digest : `sha256:${'b'.repeat(64)}`}))});
  const repository = `ghcr.io/uor-foundation/prismpm-${imageName}`;
  const options = releaseTransportPolicy(repository, ref);
  const record = releaseSbomRecord(`${repository}@${digest(index)}`, index, child, config, sbom, architecture, revision);
  return {child, sbom, record, options, manifest: encode(artifactManifest(record, options))};
}

test('release transport has exact repository/ref/signer policies without pretending candidate or SDK acceptance', () => {
  for (const ref of ['refs/heads/main', 'refs/tags/v0.3.0']) {
    for (const name of ['sdk', 'runtime', 'adapter-compose', 'adapter-kubernetes', 'adapter-github-pages', 'oracles']) {
      for (const architecture of ['amd64', 'arm64']) {
        const {record, sbom, manifest, options} = releaseFixture(rawSpdx(), architecture, name, ref);
        validateArtifact(manifest, digest(manifest), record, sbom, options);
        const subject = `ghcr.io/uor-foundation/prismpm-${name}@${digest(manifest)}`;
        const args = verificationArguments(record, digest(manifest), '/trusted-root', options);
        assert.deepEqual(args, ['verify', '--trusted-root', '/trusted-root', '--certificate-identity',
          `https://github.com/UOR-Foundation/PrismPM/.github/workflows/release.yml@${ref}`,
          '--certificate-oidc-issuer', issuer, '--certificate-github-workflow-repository', 'UOR-Foundation/PrismPM',
          '--certificate-github-workflow-ref', ref, '--certificate-github-workflow-sha', revision,
          '--certificate-github-workflow-trigger', ref === 'refs/heads/main' ? 'workflow_dispatch' : 'push',
          '--certificate-github-workflow-name', 'PrismPM OCI/native and Cargo publication', subject]);
        assert.equal(signingArguments(digest(manifest), '/trusted-root', '/bundle', options).at(-1), subject);
        const annotation = JSON.parse(manifest).annotations;
        assert.equal(annotation['com.prismpm.sdk.production-accepted'], 'false');
        assert.equal(annotation['com.prismpm.sdk.publication-phase'], 'oci-native-verification');
        assert.equal(annotation['com.prismpm.sdk.inventory-digest'], undefined);
        assert.equal(annotation['com.prismpm.sdk.candidate-evidence-digest'], undefined);
        assert.equal(annotation['com.prismpm.sdk.development-only'], undefined);
      }
    }
  }
  const {record, manifest, options, sbom} = releaseFixture();
  for (const bad of [{...options, repository: 'registry.attacker.test/sdk'}, {...options, ref: 'refs/heads/feature'},
    {...options, kind: 'candidate'}, {...options, skipTransparency: true}, {...options, ref: 'refs/tags/v0.4.0'}]) {
    assert.throws(() => artifactManifest(record, bad));
    assert.throws(() => verificationArguments(record, digest(manifest), '/root', bad));
    assert.throws(() => signingArguments(digest(manifest), '/root', '/bundle', bad));
  }
  for (const field of ['image_reference', 'image_index_digest', 'image_config_digest', 'platform', 'source_revision']) {
    const changed = {...record, [field]: 'changed'};
    const bytes = encode(artifactManifest(changed, options));
    assert.throws(() => validateArtifact(bytes, digest(bytes), record, sbom, options));
  }
  assert.throws(() => artifactManifest({...record, production_accepted: true}, options));
  execFileSync('cosign', [...verificationArguments(record, digest(manifest), '/root', options), '--help'], {stdio: 'pipe'});
});

test('release OCI artifact preserves every byte of a >16 MiB SPDX payload through real ORAS', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-release-sbom-layout-'));
  try {
    const {child, sbom, record, manifest, options} = releaseFixture(rawSpdx('full release license\n'.repeat(1_000_000)));
    assert.ok(sbom.length > 16 * 1024 * 1024);
    const layout = join(directory, 'layout');
    const execute = args => execFileSync('oras', args, {stdio: 'pipe'});
    for (const [name, bytes] of [['config.json', emptyConfig], ['sbom.spdx.json', sbom], ['child.json', child], ['manifest.json', manifest]]) {
      writeFileSync(join(directory, name), bytes);
    }
    for (const [name, hash] of [['config.json', digest(emptyConfig)], ['sbom.spdx.json', record.spdx.digest]]) {
      execute(['blob', 'push', '--oci-layout', `${layout}@${hash}`, join(directory, name)]);
    }
    for (const [name, bytes] of [['child.json', child], ['manifest.json', manifest]]) {
      execute(['manifest', 'push', '--oci-layout', `${layout}@${digest(bytes)}`, join(directory, name)]);
    }
    execute(['manifest', 'fetch', '--oci-layout', `${layout}@${digest(manifest)}`, '--output', join(directory, 'received.json')]);
    execute(['blob', 'fetch', '--oci-layout', `${layout}@${record.spdx.digest}`, '--output', join(directory, 'received.spdx.json')]);
    const received = readFileSync(join(directory, 'received.spdx.json'));
    assert.deepEqual(received, sbom);
    validateArtifact(readFileSync(join(directory, 'received.json')), digest(manifest), record, received, options);
    assert.throws(() => validateArtifact(manifest, digest(manifest), record, received.subarray(0, -1), options));
    const bad = JSON.parse(manifest); bad.subject.digest = `sha256:${'f'.repeat(64)}`;
    const wrongSubject = encode(bad);
    assert.throws(() => validateArtifact(wrongSubject, digest(wrongSubject), record, received, options));
    assert.throws(() => validateArtifact(manifest, digest(manifest), record, received,
      releaseTransportPolicy(options.repository, 'refs/tags/v0.3.0')));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('complete SPDX artifact binds exact child, all raw bytes, source and development-only evidence', () => {
  const {candidate, child, sbom, record, manifest} = fixture();
  validateArtifact(manifest, digest(manifest), record, sbom);
  assert.deepEqual(record.spdx.counts, {packages: 1, files: 1, relationships: 1, hasExtractedLicensingInfos: 1});
  for (const alter of [
    value => { value.subject.digest = `sha256:${'0'.repeat(64)}`; },
    value => { value.subject.size++; },
    value => { value.layers[0].digest = `sha256:${'0'.repeat(64)}`; },
    value => { value.layers[0].size--; },
    value => { value.layers[0].mediaType = 'application/json'; },
    value => { value.layers = []; },
    value => { value.config.digest = `sha256:${'0'.repeat(64)}`; },
    value => { value.annotations['org.opencontainers.image.revision'] = 'b'.repeat(40); },
    value => { value.annotations['com.prismpm.sdk.workflow'] = 'other'; },
    value => { value.annotations['com.prismpm.sdk.production-accepted'] = 'true'; },
    value => { value.annotations['com.prismpm.sdk.inventory-digest'] = `sha256:${'0'.repeat(64)}`; },
  ]) {
    const changed = JSON.parse(manifest); alter(changed);
    const bytes = encode(changed);
    // Even a correctly signed but mismatched manifest must not be accepted.
    assert.throws(() => validateArtifact(bytes, digest(bytes), record, sbom));
  }
  assert.throws(() => validateArtifact(manifest, `sha256:${'0'.repeat(64)}`, record, sbom));
  for (const bytes of [sbom.subarray(0, -2), Buffer.concat([sbom, Buffer.from(' ')]), rawSpdx('changed license')]) {
    assert.throws(() => validateArtifact(manifest, digest(manifest), record, bytes));
  }
  for (const [key, value] of [['source_revision', 'b'.repeat(40)], ['platform', 'linux/arm64'],
    ['production_accepted', true], ['development_only', false]]) {
    assert.throws(() => sbomRecord(encode({...JSON.parse(candidate), [key]: value}), child, sbom,
      'amd64', revision, digest(child)));
  }
  assert.throws(() => sbomRecord(candidate, child.subarray(1), sbom, 'amd64', revision, digest(child)));
  assert.throws(() => describeSpdx(encode({...JSON.parse(sbom), files: undefined})));
  assert.throws(() => describeSpdx(Buffer.concat([sbom.subarray(0, -1), Buffer.from([0xff])])));
});

test('real ORAS layout-only roundtrip preserves complete >16 MiB SPDX and rejects missing or corrupted contents', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-sbom-layout-'));
  try {
    const {child, sbom, record, manifest} = fixture(rawSpdx('licensed text\n'.repeat(1_400_000)));
    assert.ok(sbom.length > 16 * 1024 * 1024);
    const layout = join(directory, 'layout');
    const execute = args => execFileSync('oras', args, {stdio: 'pipe'});
    for (const [name, bytes] of [['config.json', emptyConfig], ['sbom.spdx.json', sbom], ['child.json', child], ['manifest.json', manifest]]) {
      writeFileSync(join(directory, name), bytes);
    }
    execute(['blob', 'push', '--oci-layout', `${layout}@${digest(emptyConfig)}`, join(directory, 'config.json')]);
    execute(['blob', 'push', '--oci-layout', `${layout}@${record.spdx.digest}`, join(directory, 'sbom.spdx.json')]);
    execute(['manifest', 'push', '--oci-layout', `${layout}@${digest(child)}`, join(directory, 'child.json')]);
    execute(['manifest', 'push', '--oci-layout', `${layout}@${digest(manifest)}`, join(directory, 'manifest.json')]);
    execute(['manifest', 'fetch', '--oci-layout', `${layout}@${digest(manifest)}`, '--output', join(directory, 'received.json')]);
    execute(['blob', 'fetch', '--oci-layout', `${layout}@${record.spdx.digest}`, '--output', join(directory, 'received.spdx.json')]);
    const received = readFileSync(join(directory, 'received.spdx.json'));
    assert.deepEqual(received, sbom);
    validateArtifact(readFileSync(join(directory, 'received.json')), digest(manifest), record, received);
    assert.throws(() => execute(['manifest', 'fetch', '--oci-layout', `${layout}@sha256:${'0'.repeat(64)}`]));
    const blob = join(layout, 'blobs', 'sha256', record.spdx.digest.slice(7));
    chmodSync(blob, 0o600); // Deliberately corrupt our own read-only fixture blob.
    writeFileSync(blob, sbom.subarray(0, -1));
    assert.throws(() => execute(['blob', 'fetch', '--oci-layout', `${layout}@${record.spdx.digest}`, '--output', join(directory, 'corrupt.spdx.json')]));
    rmSync(blob);
    assert.throws(() => execute(['blob', 'fetch', '--oci-layout', `${layout}@${record.spdx.digest}`, '--output', join(directory, 'missing.spdx.json')]));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('SBOM recording and verification fail closed on missing or tampered smoke/artifact evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-sbom-record-'));
  try {
    const {candidate, child, sbom} = fixture();
    const invoke = command => handleSbom(command, directory, 'amd64', revision, digest(child), '/absent-trust-root');
    assert.throws(() => invoke('sbom-record'));
    for (const [name, bytes] of [['candidate.json', candidate], ['manifest.json', child], ['sbom.spdx.json', sbom]]) {
      writeFileSync(join(directory, name), bytes);
    }
    assert.throws(() => invoke('sbom-verify')); // Missing recorded input evidence.
    invoke('sbom-record');
    const record = JSON.parse(readFileSync(join(directory, 'sbom-record.json')));
    for (const change of [{...record, production_accepted: true}, {...record, spdx: {...record.spdx, size: record.spdx.size - 1}}]) {
      writeFileSync(join(directory, 'sbom-record.json'), encode(change));
      assert.throws(() => invoke('sbom-verify'));
    }
    invoke('sbom-record');
    rmSync(join(directory, 'sbom.spdx.json'));
    assert.throws(() => invoke('sbom-verify'));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('candidate signature policy is exact and never disables identity or transparency verification', () => {
  const {record, manifest} = fixture();
  const args = verificationArguments(record, digest(manifest), '/trusted-root.json');
  assert.deepEqual(args, ['verify', '--trusted-root', '/trusted-root.json',
    '--certificate-identity', workflow, '--certificate-oidc-issuer', issuer,
    '--certificate-github-workflow-repository', 'UOR-Foundation/PrismPM',
    '--certificate-github-workflow-ref', 'refs/heads/main',
    '--certificate-github-workflow-sha', revision,
    '--certificate-github-workflow-trigger', 'workflow_dispatch',
    '--certificate-github-workflow-name', 'PrismPM development SDK candidate', `${repository}@${digest(manifest)}`]);
  assert.throws(() => verificationArguments({...record, source_revision: 'main'}, digest(manifest), '/root'));
  assert.throws(() => verificationArguments(record, 'latest', '/root'));
  const shell = readFileSync(new URL('./sdk-candidate.sh', import.meta.url), 'utf8');
  const recipe = readFileSync(new URL('../sdk/Dockerfile', import.meta.url), 'utf8');
  const checksums = readFileSync(new URL('../standards/corpora/cosign-3.1.3/cosign_checksums.txt', import.meta.url), 'utf8');
  for (const [architecture, hash] of [['amd64', '4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71'],
    ['arm64', 'c5d324e091826b0d7a78eb16fef316450b4eb9aaec045611c08ba06f5e73220a']]) {
    assert.ok(shell.includes(`architecture=${architecture}; checksum=${hash}`));
    assert.ok(recipe.includes(`cosign_sha=${hash};`));
    assert.ok(checksums.includes(`${hash}  cosign-linux-${architecture}\n`));
  }
  // Parse the real pinned CLI's sign flags without requesting a certificate or
  // publishing anything. End-to-end GitHub OIDC is a hosted workflow gate.
  const sign = signingArguments(digest(manifest), '/trusted-root.json', '/bundle.json');
  assert.deepEqual(sign, ['sign', '--yes', '--oidc-provider', 'github-actions',
    '--trusted-root', '/trusted-root.json', '--bundle', '/bundle.json', `${repository}@${digest(manifest)}`]);
  execFileSync('cosign', [...sign, '--help'], {stdio: 'pipe'});
  execFileSync('cosign', [...args, '--help'], {stdio: 'pipe'});
});

test('pinned real Sigstore verification rejects wrong identity, issuer, digest and absent evidence offline', () => {
  // Existing authoritative signed upstream fixture: this exercises real
  // cryptography, not a mocked success JSON. Hosted candidate OIDC issuance is
  // separately exercised only by the actual protected publication workflow.
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-sbom-signature-'));
  try {
    const corpus = new URL('../standards/corpora/cosign-3.1.3/', import.meta.url);
    const root = new URL('../standards/trust/sigstore-trusted-root-cosign-3.1.3.json', import.meta.url).pathname;
    assert.equal(digest(readFileSync(root)), trustRootDigest);
    const blob = new URL('cosign_checksums.txt', corpus).pathname;
    const args = ['verify-blob', '--bundle', new URL('cosign_checksums.txt.sigstore.json', corpus).pathname,
      '--trusted-root', root, '--certificate-identity', 'keyless@projectsigstore.iam.gserviceaccount.com',
      '--certificate-oidc-issuer', 'https://accounts.google.com', blob];
    const verify = value => execFileSync('cosign', value, {stdio: 'pipe'});
    verify(args);
    for (const [key, value] of [['--certificate-identity', workflow],
      ['--certificate-identity', 'https://github.com/UOR-Foundation/PrismPM/.github/workflows/release.yml@refs/heads/main'],
      ['--certificate-oidc-issuer', issuer],
      ['--bundle', join(directory, 'missing.sigstore.json')]]) {
      const changed = [...args]; changed[changed.indexOf(key) + 1] = value;
      assert.throws(() => verify(changed));
    }
    const changed = join(directory, 'changed-checksums');
    writeFileSync(changed, Buffer.concat([readFileSync(blob), Buffer.from('changed')]));
    assert.throws(() => verify([...args.slice(0, -1), changed]));
    const slsa = new URL('../standards/corpora/slsa-verifier-2.7.1/binary-linux-amd64-workflow_dispatch', import.meta.url).pathname;
    const github = ['verify-blob-attestation', '--bundle', `${slsa}.intoto.sigstore`, '--trusted-root', root,
      '--certificate-identity', 'https://github.com/slsa-framework/slsa-github-generator/.github/workflows/builder_container-based_slsa3.yml@refs/tags/v1.7.0',
      '--certificate-oidc-issuer', issuer, '--certificate-github-workflow-sha', '62cb1f1e485829bafe8bbec8b9900c0cb7624fe7',
      '--type', 'https://slsa.dev/provenance/v1', slsa];
    verify(github);
    const wrongSha = [...github]; wrongSha[wrongSha.indexOf('--certificate-github-workflow-sha') + 1] = '0'.repeat(40);
    assert.throws(() => verify(wrongSha));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
