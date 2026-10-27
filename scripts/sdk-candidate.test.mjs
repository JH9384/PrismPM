import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateConfig, validateEnvironment, validateEvidence } from './sdk-candidate.mjs';
import { compilerRevision, encodeInventory, validateAuthorityMetadata } from '../sdk/inventory-metadata.mjs';
import './sdk-candidate-sbom.test.mjs';

const revision = 'a'.repeat(40);
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const standardsFixture = () => {
  const standards = Buffer.from(JSON.stringify({schema: 'prismpm/standards-lock/1',
    authorities: [{id: 'fixture-authority'}], oracles: [{id: 'fixture-oracle'}]}));
  const inventory = Buffer.from(JSON.stringify({schema: 'prismpm/sdk-inventory/1',
    commands: [{command: 'prismpm'}], artifacts: [{id: 'standards-and-oracles', digest: digest(standards)}]}));
  const authority = Buffer.from(`${JSON.stringify({schema: 'prismpm/authority-result/1',
    lock_digest: digest(standards), path: 'standards.lock', authorities: 1, oracles: 1, unchanged: true})}\n`);
  return {standards, inventory, authority};
};
const config = () => ({architecture: 'amd64', os: 'linux', rootfs: {type: 'layers', diff_ids: []},
  config: {Labels: {'org.opencontainers.image.revision': revision,
    'org.opencontainers.image.source': 'https://github.com/UOR-Foundation/PrismPM',
    'org.opencontainers.image.version': '0.4.0',
    'org.opencontainers.image.created': '1970-01-01T00:00:00Z'}}});

test('final runtime inventory is canonical after appending measured browser artifacts', () => {
  const artifact = {id: 'playwright-headless-shell', kind: 'oracle', version: '1.62.1',
    digest: `sha256:${'a'.repeat(64)}`};
  const command = {sha256: 'b'.repeat(64), executable: '/usr/local/bin/prismpm', command: 'prismpm'};
  const value = {schema: 'prismpm/sdk-inventory/1', commands: [command], artifacts: [artifact]};
  const expected = `{"artifacts":[{"digest":"sha256:${'a'.repeat(64)}","id":"playwright-headless-shell","kind":"oracle","version":"1.62.1"}],"commands":[{"command":"prismpm","executable":"/usr/local/bin/prismpm","sha256":"${'b'.repeat(64)}"}],"schema":"prismpm/sdk-inventory/1"}\n`;
  assert.equal(encodeInventory(value), expected);
  assert.deepEqual(JSON.parse(expected), value, 'canonicalization must not change measured facts');
  assert.equal(encodeInventory(JSON.parse(expected)), expected, 'encoding must be idempotent');
  assert.notEqual(`${JSON.stringify(value)}\n`, expected, 'the former insertion-order writer must fail');
  const generator = readFileSync(new URL('../sdk/generate-inventory.mjs', import.meta.url), 'utf8');
  assert.ok(generator.includes("await writeFile(output, encodeInventory(value), { flag: 'wx', mode: 0o444 })"),
    'both generator modes must use the checked canonical writer');
});

test('artifact-only inventory has the same canonical framing without reordering artifact arrays', () => {
  const artifacts = [{version: '2', kind: 'binary', id: 'z', digest: `sha256:${'c'.repeat(64)}`},
    {version: '1', kind: 'binary', id: 'a', digest: `sha256:${'d'.repeat(64)}`}];
  const value = {schema: 'prismpm/sdk-artifact-inventory/1', artifacts};
  const encoded = encodeInventory(value);
  assert.ok(encoded.startsWith('{"artifacts":[{"digest":'));
  assert.ok(encoded.endsWith('"schema":"prismpm/sdk-artifact-inventory/1"}\n'));
  assert.deepEqual(JSON.parse(encoded).artifacts, artifacts, 'array order is validated by the inventory gate, not repaired');
});

test('SDK inventory compiler metadata follows the exact authoritative register, never a stale literal', () => {
  const source = readFileSync(new URL('../model/dependencies.toml', import.meta.url), 'utf8');
  const revision = compilerRevision(source);
  const artifacts = [{id: 'lean4-prod', version: revision}, {id: 'conformance-corpus', version: 'prismpm/ids/1'}];
  validateAuthorityMetadata(artifacts, revision);
  assert.throws(() => validateAuthorityMetadata([{...artifacts[0], version: '2bda53877490e7dc032128b472a4a6e0ef07d7d2'}, artifacts[1]], revision));
  assert.throws(() => validateAuthorityMetadata([artifacts[0], {...artifacts[1], version: '148-features-83-diagnostics'}], revision));
  const changed = source.replace(`revision = "${revision}"`, `revision = "${'f'.repeat(40)}"`);
  assert.equal(compilerRevision(changed), 'f'.repeat(40));
  for (const invalid of [source.replace(`revision = "${revision}"`, 'revision = "main"'),
    source.replace('id = "lean4-prod"', 'id = "absent"'),
    source.replace(`revision = "${revision}"`, `revision = "${revision}"\nrevision = "${revision}"`),
    source.replace('spec = "prismpm/dependencies/1"', 'spec = "other/1"')]) {
    assert.throws(() => compilerRevision(invalid));
  }
  const generator = readFileSync(new URL('../sdk/generate-inventory.mjs', import.meta.url), 'utf8');
  assert.ok(generator.includes("compilerRevision(await readFile(dependencies, 'utf8'))"));
  assert.ok(generator.includes('validateAuthorityMetadata(artifacts, revision)'));
  assert.ok(generator.includes("version: id === 'lean4-prod' ? revision : version"));
  assert.ok(generator.includes("['conformance-corpus', 'test-corpus', 'prismpm/ids/1'"));
  assert.ok(!/\d+-features-\d+-diagnostics/.test(generator));
  const browserAdapter = readFileSync(new URL('../adapters/github-pages-browser.json', import.meta.url));
  const descriptor = JSON.parse(browserAdapter);
  assert.equal(descriptor.id, 'github-pages-browser');
  assert.equal(descriptor.model_api, 'prismpm/system-model/2');
  assert.equal(descriptor.target_api, 'github-pages-artifact@v4');
  assert.equal(generator.split("['adapter-github-pages-browser', 'adapter', 'github-pages-artifact@v4', 'adapters/github-pages-browser.json']").length, 2,
    'the exact browser-system target descriptor must be measured once in the installed SDK inventory');
});

test('candidate ORAS native pins match the production SDK and official 1.3.0 release checksums', () => {
  const helper = readFileSync(new URL('./sdk-candidate.sh', import.meta.url), 'utf8');
  const recipe = readFileSync(new URL('../sdk/Dockerfile', import.meta.url), 'utf8');
  for (const [machine, architecture, checksum] of [
    ['x86_64', 'amd64', '6cdc692f929100feb08aa8de584d02f7bcc30ec7d88bc2adc2054d782db57c64'],
    ['aarch64', 'arm64', '7649738b48fde10542bcc8b0e9b460ba83936c75fb5be01ee6d4443764a14352'],
  ]) {
    assert.ok(helper.includes(`${machine}) architecture=${architecture}; checksum=${checksum}`));
    assert.ok(recipe.includes(`${architecture}) oras_arch=${architecture}; oras_sha=${checksum};`));
  }
});

test('candidate source identity and native platform are exact', () => {
  validateConfig(config(), 'amd64', revision);
  assert.throws(() => validateConfig(config(), 'arm64', revision));
  assert.throws(() => validateConfig(config(), 'amd64', 'b'.repeat(40)));
  const changed = config(); changed.config.Labels['org.opencontainers.image.version'] = 'latest';
  assert.throws(() => validateConfig(changed, 'amd64', revision));
});

test('candidate publication requires a main-only environment and respects optional reviewers', () => {
  const environment = {name: 'sdk-candidate', deployment_branch_policy: {
    custom_branch_policies: true, protected_branches: false}, protection_rules: [
    {type: 'required_reviewers', prevent_self_review: true, reviewers: [{id: 1}]}]};
  const branches = {total_count: 1, branch_policies: [{name: 'main', type: 'branch'}]};
  validateEnvironment(environment, branches);
  validateEnvironment({...environment, protection_rules: []}, branches);
  assert.throws(() => validateEnvironment({...environment, deployment_branch_policy: null}, branches));
  assert.throws(() => validateEnvironment(environment, {...branches,
    branch_policies: [{name: 'main', type: 'tag'}]}));
  assert.throws(() => validateEnvironment(environment, {...branches,
    total_count: 2, branch_policies: [...branches.branch_policies, {name: '*', type: 'branch'}]}));
});

test('candidate evidence refuses stale, swapped, incomplete or accepted claims', () => {
  const {inventory, standards, authority} = standardsFixture();
  const subject = `sha256:${'b'.repeat(64)}`;
  const evidence = {source_revision: revision, platform: 'linux/amd64', manifest_digest: subject,
    inventory_digest: digest(inventory), development_only: true, production_accepted: false,
    standards_lock_digest: digest(standards), authority_result_digest: digest(authority),
    checks: ['non-root', 'inventory', 'standards-lock', 'model-check', 'shadowed-tool-rejected']};
  const check = value => validateEvidence(value, 'amd64', revision, subject, inventory, standards, authority);
  check(evidence);
  for (const mutation of [{platform: 'linux/arm64'}, {source_revision: 'c'.repeat(40)},
    {inventory_digest: digest(Buffer.from('other'))}, {authority_result_digest: digest(Buffer.from('other'))},
    {standards_lock_digest: digest(Buffer.from('other'))}, {production_accepted: true},
    {checks: ['non-root']}, {extra: true}]) assert.throws(() => check({...evidence, ...mutation}));
});

test('candidate publication requires a successful exact shipped standards-lock result', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-candidate-standards-'));
  try {
    const {inventory, standards, authority} = standardsFixture();
    const subject = `sha256:${'b'.repeat(64)}`;
    writeFileSync(join(directory, 'inventory.json'), inventory);
    writeFileSync(join(directory, 'standards.lock'), standards);
    writeFileSync(join(directory, 'cli.json'), JSON.stringify({schema: 'prismpm/completion-result/1'}));
    writeFileSync(join(directory, 'model-check.json'), JSON.stringify({schema: 'prismpm/check-result/1',
      model_id: 'c'.repeat(64), semantic_id: 'd'.repeat(64), snapshot_id: 'e'.repeat(64)}));
    const invoke = command => execFileSync(process.execPath, [
      new URL('./sdk-candidate.mjs', import.meta.url).pathname, command, directory, 'amd64', revision, subject], {stdio: 'pipe'});
    // Missing evidence must prevent both initial recording and publication.
    assert.throws(() => invoke('record'));
    writeFileSync(join(directory, 'authority-result.json'), authority);
    invoke('record'); invoke('verify');
    const evidence = JSON.parse(readFileSync(join(directory, 'candidate.json'), 'utf8'));
    assert.equal(evidence.authority_result_digest, digest(authority));
    assert.equal(evidence.standards_lock_digest, digest(standards));
    rmSync(join(directory, 'standards.lock'));
    assert.throws(() => invoke('record')); assert.throws(() => invoke('verify'));
    writeFileSync(join(directory, 'standards.lock'), standards);
    rmSync(join(directory, 'authority-result.json'));
    assert.throws(() => invoke('verify'));
    const passed = JSON.parse(authority);
    for (const value of [
      {schema: 'prismpm/error-result/1', diagnostic: {code: 'PP1101'}},
      {...passed, unchanged: false}, {...passed, lock_digest: `sha256:${'0'.repeat(64)}`},
      {...passed, path: 'other.lock'}, {...passed, authorities: 2}, {...passed, oracles: 0},
      {...passed, extra: true},
    ]) {
      writeFileSync(join(directory, 'authority-result.json'), JSON.stringify(value));
      assert.throws(() => invoke('record'));
      assert.throws(() => invoke('verify'));
    }
    writeFileSync(join(directory, 'authority-result.json'), authority);
    writeFileSync(join(directory, 'standards.lock'), Buffer.concat([standards, Buffer.from('\n')]));
    assert.throws(() => invoke('record')); assert.throws(() => invoke('verify'));
    writeFileSync(join(directory, 'standards.lock'), standards);
    const changed = JSON.parse(inventory); changed.artifacts[0].digest = `sha256:${'0'.repeat(64)}`;
    writeFileSync(join(directory, 'inventory.json'), JSON.stringify(changed));
    assert.throws(() => invoke('record')); assert.throws(() => invoke('verify'));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('real ORAS inspection accepts exact OCI bytes and rejects blob tampering', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-candidate-test-'));
  try {
    const layout = join(directory, 'layout');
    mkdirSync(join(layout, 'blobs', 'sha256'), {recursive: true});
    const put = value => {
      const bytes = Buffer.from(JSON.stringify(value));
      const hash = digest(bytes);
      writeFileSync(join(layout, 'blobs', 'sha256', hash.slice(7)), bytes);
      return {digest: hash, size: bytes.length};
    };
    const cfg = put(config());
    const manifest = put({schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {...cfg, mediaType: 'application/vnd.oci.image.config.v1+json'}, layers: []});
    writeFileSync(join(layout, 'oci-layout'), JSON.stringify({imageLayoutVersion: '1.0.0'}));
    writeFileSync(join(layout, 'index.json'), JSON.stringify({schemaVersion: 2, manifests: [
      {...manifest, mediaType: 'application/vnd.oci.image.manifest.v1+json'}]}));
    const archive = join(directory, 'fixture.tar');
    const pack = () => execFileSync('tar', ['-cf', archive, '-C', layout, 'index.json', 'oci-layout', 'blobs']);
    const inspect = architecture => execFileSync(process.execPath, [
      new URL('./sdk-candidate.mjs', import.meta.url).pathname, 'inspect', archive,
      architecture, revision, join(directory, 'evidence')], {stdio: 'pipe'});
    pack(); inspect('amd64');
    assert.equal(readFileSync(join(directory, 'evidence', 'digest.txt'), 'utf8').trim(), manifest.digest);
    const arm = config(); arm.architecture = 'arm64';
    const armConfig = put(arm);
    const armManifest = put({schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {...armConfig, mediaType: 'application/vnd.oci.image.config.v1+json'}, layers: []});
    const originalIndex = readFileSync(join(layout, 'index.json'));
    writeFileSync(join(layout, 'index.json'), JSON.stringify({schemaVersion: 2, manifests: [manifest, armManifest]
      .map(value => ({...value, mediaType: 'application/vnd.oci.image.manifest.v1+json'}))}));
    const indexPath = join(directory, 'multiarch.json');
    execFileSync('oras', ['manifest', 'index', 'create', '--oci-layout', layout,
      manifest.digest, armManifest.digest, '--output', indexPath], {stdio: 'pipe'});
    execFileSync(process.execPath, [new URL('./sdk-candidate.mjs', import.meta.url).pathname,
      'index', indexPath, manifest.digest, armManifest.digest], {stdio: 'pipe'});
    assert.throws(() => execFileSync(process.execPath, [new URL('./sdk-candidate.mjs', import.meta.url).pathname,
      'index', indexPath, armManifest.digest, manifest.digest], {stdio: 'pipe'}));
    const copy = join(directory, 'copy');
    execFileSync('oras', ['cp', '--from-oci-layout', '--to-oci-layout',
      `${archive}@${manifest.digest}`, `${copy}:candidate`], {stdio: 'pipe'});
    assert.deepEqual(readFileSync(join(copy, 'blobs', 'sha256', manifest.digest.slice(7))),
      readFileSync(join(layout, 'blobs', 'sha256', manifest.digest.slice(7))));
    assert.throws(() => inspect('arm64'));
    writeFileSync(join(layout, 'index.json'), originalIndex);
    writeFileSync(join(layout, 'blobs', 'sha256', cfg.digest.slice(7)), '{}');
    pack(); assert.throws(() => inspect('amd64'));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
