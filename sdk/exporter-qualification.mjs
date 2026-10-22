// Native installed-SDK compiler qualification; not application/release acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, readSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCapturedLock} from '../scripts/library-sdk-check.mjs';
import {decodeExporterSeed} from './inventory-metadata.mjs';
import {validateInventory} from './platform-lock.mjs';
import {readSmall, snapshotTree} from './exporter-seed.mjs';
import {constructSeeds} from './exporter-seed.integration.mjs';
import {measureRelocation} from './exporter-relocation.integration.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = (value, names) => assert.deepEqual(Object.keys(value).sort(), names.slice().sort());
const hex = value => { assert.equal(typeof value, 'string'); assert.match(value, /^[a-f0-9]{64}$/); };
const installed = '/opt/prismpm/share/conformance-root';
const installedSeed = '/opt/prismpm/share/exporter-seed';
const artifactNames = ['coverage.json', 'kernel.ir', 'roots.json'];

export function validateQualification(value, binding, authority, nativeInventory) {
  assert(Buffer.isBuffer(nativeInventory), 'captured native SDK inventory bytes required');
  assert.equal(sha(nativeInventory), binding.inventory_sha256, 'extraction authority differs from captured SDK inventory');
  const tar = validateInventory(nativeInventory).commands.find(row => row.command === 'tar');
  assert(tar && tar.executable === '/usr/bin/tar', 'qualification requires the inventoried native extraction tool');
  keys(value, ['schema', 'scope', 'binding', 'manifests', 'construction', 'relocation']);
  assert.equal(value.schema, 'prismpm/exporter-qualification/1');
  assert.equal(value.scope, 'installed-native-compiler-only');
  assert.deepEqual(value.binding, binding);
  assert.equal(value.manifests.length, 2);
  for (const bytes of value.manifests) {
    assert.equal(typeof bytes, 'string');
    assert.equal(sha(bytes), binding.seed_manifest_sha256, 'fresh seed differs from captured SDK authority');
  }
  assert.equal(value.manifests[0], value.manifests[1]);
  const manifest = decodeExporterSeed(Buffer.from(value.manifests[0]));
  assert.equal(manifest.platform, binding.platform);
  assert.equal(manifest.compiler_revision, binding.compiler_revision);
  assert.equal(manifest.archive_sha256, authority.archive_sha256);
  assert.equal(manifest.toolchain, authority.toolchain);
  assert.equal(manifest.files.find(row => row.path === '.lake/build/bin/prod-export').sha256, binding.exporter_sha256);
  const lake = manifest.configuration.environment.PATH.split(':')[0] + '/lake';
  const lakeHash = manifest.toolchain_files.find(row => row.path === 'bin/lake').sha256;
  const process = (record, argv, temporary) => {
    keys(record, ['argv', 'environment', 'executable_sha256', 'exit_code', 'stdout', 'stderr']);
    assert.deepEqual(record.argv, argv);
    assert.deepEqual(record.environment, {...manifest.configuration.environment, TMPDIR: temporary});
    assert.equal(record.exit_code, 0);
    hex(record.executable_sha256);
    assert([lake, tar.executable].includes(argv[0]), 'unknown qualification executable');
    assert.equal(record.executable_sha256, argv[0] === lake ? lakeHash : tar.sha256,
      'qualification executable differs from independent native authority');
    for (const stream of ['stdout', 'stderr']) {
      assert.equal(typeof record[stream], 'string');
      assert(Buffer.byteLength(record[stream]) <= 16 * 1024 ** 2);
    }
  };
  const construction = value.construction;
  keys(construction, ['scope', 'manifest_sha256', 'files', 'raw_construction']);
  assert.equal(construction.scope, 'exporter-construction-only');
  assert.equal(construction.manifest_sha256, binding.seed_manifest_sha256);
  assert.equal(construction.files, manifest.files.length);
  assert.equal(construction.raw_construction.length, 2);
  const roots = [];
  for (const record of construction.raw_construction) {
    keys(record, ['extraction', 'build']);
    const archive = record.extraction.argv[3];
    assert.match(archive, /^\/work\/prismpm-exporter-qualification-[A-Za-z0-9]+\/source-[ab]\/vendor\/lean4-prod\/lean\.tar$/);
    roots.push(archive);
    process(record.extraction, ['/usr/bin/tar', '--extract', '--file', archive, '--directory', '/proc/self/fd/3'], '/proc/self/fd/4');
    process(record.build, [lake, 'build', 'prod-export'], '/proc/self/fd/4');
  }
  assert.equal(new Set(roots).size, 2, 'distinct construction roots required');
  const relocation = value.relocation;
  keys(relocation, ['scope', 'manifest_sha256', 'construction', 'observations']);
  assert.equal(relocation.scope, 'compiler-relocation-measurement-only');
  assert.equal(relocation.manifest_sha256, binding.seed_manifest_sha256);
  keys(relocation.construction, ['manifest_sha256', 'construction']);
  assert.equal(relocation.construction.manifest_sha256, binding.seed_manifest_sha256);
  assert.deepEqual(relocation.construction.construction, construction.raw_construction[0]);
  assert.equal(relocation.observations.length, 4);
  let expected;
  const observedRoots = [];
  for (const [index, row] of relocation.observations.entries()) {
    keys(row, ['root', 'acquisition', 'invocation_milliseconds', 'changed_build_files', 'extraction', 'build', 'module', 'kernel', 'exports']);
    assert.match(row.root, /^\/work\/prismpm-exporter-qualification-[A-Za-z0-9]+\/exporter-relocation-check-[A-Za-z0-9]+\/(first-root|independent-second-root)\/(cold|relocated)$/);
    assert(row.root.endsWith((index < 2 ? 'first-root/' : 'independent-second-root/') + (index % 2 ? 'relocated' : 'cold')));
    observedRoots.push(row.root);
    assert.equal(row.acquisition, index % 2 ? 'relocated' : 'cold');
    assert(Number.isFinite(row.invocation_milliseconds) && row.invocation_milliseconds >= 0 && row.invocation_milliseconds <= 370000);
    assert(Array.isArray(row.changed_build_files));
    if (row.acquisition === 'relocated') assert.deepEqual(row.changed_build_files, []);
    for (const changed of row.changed_build_files) {
      keys(changed, ['path', 'change']);
      assert.match(changed.path, /^\.lake\/[A-Za-z0-9_.+/-]+$/);
      assert(!changed.path.split('/').includes('..'));
      assert(['added', 'removed', 'changed'].includes(changed.change));
    }
    const temporary = row.build.environment.TMPDIR;
    assert.match(temporary, /^\/tmp\/exporter-relocation-[A-Za-z0-9]+$/);
    process(row.extraction, ['/usr/bin/tar', '--extract', '--file', roots[0], '--directory', row.root], temporary);
    process(row.build, [lake, 'build', 'prod-export'], temporary);
    process(row.module, [lake, 'build', 'Conformance.LexLean11'], temporary);
    process(row.kernel, [lake, 'env', 'leanchecker', 'Conformance.LexLean11'], temporary);
    assert.equal(row.exports.length, 2);
    for (const [replay, exported] of row.exports.entries()) {
      keys(exported, ['process', 'artifacts']);
      process(exported.process, [lake, 'exe', 'prod-export', '--module', 'Conformance.LexLean11', '--root', 'SemanticFixture.Main.allConsecutive', '--ir-module', 'exporter_relocation', '--out', join(row.root, replay ? 'export-b' : 'export-a')], temporary);
      keys(exported.artifacts, artifactNames);
      for (const name of artifactNames) assert(typeof exported.artifacts[name] === 'string' && Buffer.byteLength(exported.artifacts[name]) > 0 && Buffer.byteLength(exported.artifacts[name]) <= 16 * 1024 ** 2);
      if (expected) assert.deepEqual(exported.artifacts, expected, 'exact cold/relocated export bytes differ');
      expected = exported.artifacts;
    }
  }
  assert.equal(new Set(observedRoots).size, 4);
}

export function qualify(binding, root = installed) {
  assert.equal(process.getuid(), 1000, 'compiler qualification must run non-root');
  const work = mkdtempSync('/work/prismpm-exporter-qualification-');
  const before = snapshotTree(installedSeed);
  try {
    for (const location of ['source-a', 'source-b']) for (const name of ['model/dependencies.toml', 'vendor/lean4-prod/lean.tar', 'lean-toolchain']) {
      const target = join(work, location, name); mkdirSync(dirname(target), {recursive: true});
      copyFileSync(join(root, name), target);
    }
    const constructionRoot = join(work, 'construction'); mkdirSync(constructionRoot);
    const construction = constructSeeds(join(work, 'source-a'), join(work, 'source-b'), constructionRoot);
    const manifests = ['first', 'second'].map(name => readSmall(join(constructionRoot, name, 'manifest.json'), 8 * 1024 ** 2));
    for (const manifest of manifests) assert.equal(sha(manifest), binding.seed_manifest_sha256, 'fresh seed differs from installed inventory');
    const relocation = measureRelocation(join(work, 'source-a'), work, join(constructionRoot, 'first'),
      {manifest_sha256: construction.manifest_sha256, construction: construction.raw_construction[0]});
    assert.deepEqual(snapshotTree(installedSeed), before, 'qualification mutated installed seed');
    return {schema: 'prismpm/exporter-qualification/1', scope: 'installed-native-compiler-only', binding, manifests, construction, relocation};
  } finally { rmSync(work, {recursive: true}); }
}

function capturedBinding(bytes, image, root, inventory) {
  return validateCapturedLock(bytes, image, {x64: 'amd64', arm64: 'arm64'}[process.arch],
    readFileSync(join(root, 'standards.lock')), inventory);
}
const authority = root => ({archive_sha256: sha(readFileSync(join(root, 'vendor/lean4-prod/lean.tar'))),
  toolchain: readSmall(join(root, 'lean-toolchain'), 256).trim()});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, ...args] = process.argv.slice(2);
  if (operation === 'run' && args.length === 1) {
    const bytes = Buffer.alloc(64 * 1024 ** 2 + 1); let offset = 0;
    while (offset < bytes.length) { const count = readSync(0, bytes, offset, bytes.length - offset, null); if (!count) break; offset += count; }
    assert(offset > 0 && offset < bytes.length);
    const inventory = readFileSync('/opt/prismpm/share/inventory.json');
    const binding = capturedBinding(bytes.subarray(0, offset), args[0], installed, inventory);
    const result = qualify(binding); validateQualification(result, binding, authority(installed), inventory);
    process.stdout.write(JSON.stringify(result) + '\n');
  } else if (operation === 'result' && args.length === 5) {
    const [result, lock, image, root, inventory] = args;
    const inventoryBytes = readFileSync(inventory);
    validateQualification(JSON.parse(readSmall(result, 64 * 1024 ** 2)),
      capturedBinding(Buffer.from(readSmall(lock, 64 * 1024 ** 2)), image, root, inventoryBytes), authority(root), inventoryBytes);
  } else throw Error('closed exporter qualification operation');
}
