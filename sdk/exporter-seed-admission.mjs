// Internal SDK acquisition helper. The caller must supply an inventory digest
// from the independently validated consumer lock, never from this filesystem.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, readlinkSync, realpathSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readSmall, snapshotFile, snapshotTree, stageSeedFiles} from './exporter-seed.mjs';
export {stageSeedFiles} from './exporter-seed.mjs';
import {decodeExporterSeed, encodeInventory} from './inventory-metadata.mjs';

const installedInventory = '/opt/prismpm/share/inventory.json';
const installedSeed = '/opt/prismpm/share/exporter-seed';
const sha = value => createHash('sha256').update(value).digest('hex');
const seedBounds = {files: 4097, file: 256 * 1024 ** 2, total: 520 * 1024 ** 2};
const sourceBounds = {files: 4096, file: 16 * 1024 ** 2, total: 16 * 1024 ** 2};

export function bindSeedInventory(bytes, expectedDigest, revision) {
  assert.match(expectedDigest, /^[0-9a-f]{64}$/);
  assert(bytes.length <= 8 * 1024 ** 2 && sha(bytes) === expectedDigest, 'SDK inventory differs from the independent lock');
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes), inventory = JSON.parse(text);
  assert.equal(encodeInventory(inventory), text, 'canonical SDK inventory required');
  assert.equal(inventory.schema, 'prismpm/sdk-inventory/1');
  assert(Array.isArray(inventory.artifacts));
  const select = id => {
    const rows = inventory.artifacts.filter(row => row.id === id);
    assert(rows.length <= 1, 'duplicate SDK exporter artifact'); return rows[0];
  };
  const manifest = select('lean4-prod-exporter-seed'), executable = select('lean4-prod-exporter');
  if (!manifest && !executable) return null;
  assert(manifest && executable, 'incomplete SDK exporter advertisement');
  for (const [row, kind, version] of [[manifest, 'dependency-lock', '1'], [executable, 'binary', revision]]) {
    assert.deepEqual(Object.keys(row).sort(), ['digest', 'id', 'kind', 'version']);
    assert.equal(row.kind, kind); assert.equal(row.version, version); assert.match(row.digest, /^sha256:[0-9a-f]{64}$/);
  }
  return {manifest_sha256: manifest.digest.slice(7), executable_sha256: executable.digest.slice(7)};
}

export function bindSeedManifest(bytes, authority, identity) {
  assert.equal(sha(bytes), authority.manifest_sha256, 'exporter manifest differs from the independent SDK inventory');
  const manifest = decodeExporterSeed(bytes);
  assert.equal(manifest.compiler_revision, identity.compiler_revision);
  assert.equal(manifest.archive_sha256, identity.archive_sha256);
  assert.equal(manifest.toolchain, identity.toolchain);
  assert.equal(manifest.platform, identity.platform);
  assert.equal(manifest.files.find(row => row.path === '.lake/build/bin/prod-export').sha256, authority.executable_sha256);
  return manifest;
}

// Ownership supplements the external digest binding; it is not provenance.
export function immutablePath(path) {
  assert(typeof path === 'string' && path.startsWith('/') && path.length <= 4096);
  let current = '/', links = 0, steps = 0;
  const parts = path.split('/').filter(Boolean);
  const root = lstatSync('/'); assert(root.uid === 0 && (root.mode & 0o022) === 0);
  while (parts.length) {
    assert(++steps <= 16384, 'runtime path resolution exceeded bound');
    const part = parts.shift();
    if (part === '.') continue;
    if (part === '..') { current = dirname(current); continue; }
    const candidate = join(current, part), entry = lstatSync(candidate);
    assert(entry.uid === 0 && (entry.isSymbolicLink() || (entry.mode & 0o022) === 0),
      'SDK compiler custody must be root-owned and not group/world writable');
    if (entry.isSymbolicLink()) {
      assert(++links <= 40, 'runtime alias cycle or depth exceeded');
      const target = readlinkSync(candidate); assert(target.length <= 4096);
      if (target.startsWith('/')) current = '/';
      parts.unshift(...target.split('/').filter(Boolean));
    } else current = candidate;
  }
  assert.equal(realpathSync(path), current, 'runtime path changed while resolving');
  return current;
}

function immutableTree(root, rows) {
  immutablePath(root);
  for (const row of rows) {
    const entry = lstatSync(join(root, row.path));
    assert(entry.uid === 0 && (entry.isSymbolicLink() || (entry.mode & 0o022) === 0), 'mutable SDK compiler entry refused');
  }
}

export function verifySeedFiles(seed, source, manifest) {
  assert.deepEqual(snapshotTree(source, {bounds: sourceBounds}), manifest.source_files, 'fresh compiled-in exporter sources differ');
  const files = snapshotTree(seed, {bounds: seedBounds}).filter(row => row.path !== 'manifest.json');
  assert.deepEqual(files, manifest.files, 'actual SDK seed closure differs');
  return files;
}

export function stageInstalledSeed(source, staging, inventoryDigest, identity, {rootIdentity} = {}) {
  immutablePath(installedInventory);
  assert.equal(lstatSync(installedInventory).mode & 0o222, 0, 'SDK inventory must be read-only');
  const inventory = Buffer.from(readSmall(installedInventory, 8 * 1024 ** 2));
  const authority = bindSeedInventory(inventory, inventoryDigest, identity.compiler_revision);
  if (authority === null) {
    assert.equal(lstatSync(installedSeed, {throwIfNoEntry: false}), undefined, 'unadvertised installed seed refused');
    return {schema: 'prismpm/exporter-acquisition/1', mode: 'cold'};
  }
  immutablePath(installedSeed);
  const manifestBytes = Buffer.from(readSmall(join(installedSeed, 'manifest.json'), 8 * 1024 ** 2));
  const manifest = bindSeedManifest(manifestBytes, authority, identity);
  const verify = () => {
    const files = verifySeedFiles(installedSeed, source, manifest);
    immutableTree(installedSeed, [...files, {path: 'manifest.json'}]);
    const toolchain = '/usr/local/elan/toolchains/' + identity.toolchain.replace('/', '--').replace(':', '---');
    assert.deepEqual(snapshotTree(toolchain, {toolchainAliases: true}), manifest.toolchain_files, 'installed toolchain differs');
    immutableTree(toolchain, manifest.toolchain_files);
    for (const row of manifest.runtime_files) {
      assert.equal(realpathSync(row.selected), row.path, 'runtime selection changed');
      immutablePath(row.selected); immutablePath(row.path);
      assert.deepEqual(snapshotFile(row.path), {byte_length: row.byte_length, mode: row.mode, sha256: row.sha256},
        'installed runtime differs');
    }
    assert.equal(readSmall(installedInventory, 8 * 1024 ** 2), inventory.toString('utf8'), 'SDK inventory changed during acquisition');
    assert.equal(readSmall(join(installedSeed, 'manifest.json'), 8 * 1024 ** 2), manifestBytes.toString('utf8'), 'seed manifest changed');
  };
  verify();
  stageSeedFiles(installedSeed, staging, manifest, {rootIdentity});
  verify();
  return {schema: 'prismpm/exporter-acquisition/1', mode: 'sdk-seed', inventory_sha256: inventoryDigest,
    manifest_sha256: authority.manifest_sha256, executable_sha256: authority.executable_sha256,
    compiler_revision: identity.compiler_revision, archive_sha256: identity.archive_sha256,
    platform: identity.platform, toolchain: identity.toolchain};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 9, 'internal seed admission requires source, staging and independently bound SDK identity');
  const [source, staging, inventory, revision, archive, toolchain, originalStage] = process.argv.slice(2);
  assert(originalStage.length <= 1024, 'bounded original staging identity required');
  const encodedStage = JSON.parse(originalStage);
  assert.deepEqual(Object.keys(encodedStage).sort(), ['dev','gid','ino','mode','uid']);
  const rootIdentity = Object.fromEntries(Object.entries(encodedStage).map(([name,value]) => {
    assert(typeof value === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(value));
    const parsed = BigInt(value); assert(parsed <= 0xffffffffffffffffn); return [name,parsed];
  }));
  const platform = `linux/${{x64: 'amd64', arm64: 'arm64'}[process.arch]}`;
  assert.equal(process.platform, 'linux');
  const acquisition = stageInstalledSeed(resolve(source), resolve(staging), inventory,
    {compiler_revision: revision, archive_sha256: archive, toolchain, platform}, {rootIdentity});
  // Private handoff only. The unchanged acquisition receipt remains the public
  // evidence; Rust independently binds the complete original manifest bytes.
  const manifest_document = acquisition.mode === 'sdk-seed'
    ? readSmall(join(installedSeed, 'manifest.json'), 8 * 1024 ** 2) : null;
  process.stdout.write(encodeInventory({acquisition, manifest_document}));
}
