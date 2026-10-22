// Actual cold construction, not source/SDK/application acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSeed, readSmall, snapshotFile} from './exporter-seed.mjs';
import {exporterArtifactBindings} from './inventory-metadata.mjs';

export function constructSeeds(source, other, output) {
assert.notEqual(source, other, 'two source roots required');
const temporary = mkdtempSync(join(tmpdir(), 'exporter-invalid-source-'));
try {
  const first = buildSeed(source, join(output, 'first'));
  const second = buildSeed(other, join(output, 'second'));
  for (const receipt of [first, second]) {
    assert.equal(receipt.construction.build.exit_code, 0);
    assert.match(receipt.construction.build.stdout, /Build completed successfully/);
    assert.equal(receipt.construction.build.environment.TMPDIR, receipt.construction.extraction.environment.TMPDIR);
    assert.equal(receipt.construction.build.environment.TMPDIR, '/proc/self/fd/4');
  }
  assert.notEqual(first.construction.extraction.argv[3], second.construction.extraction.argv[3]);
  const firstManifest = readFileSync(join(output, 'first/manifest.json'));
  const secondManifest = readFileSync(join(output, 'second/manifest.json'));
  assert(firstManifest.equals(secondManifest),
    'independent cold construction must yield an identical seed manifest without rewriting traces');
  const manifest = JSON.parse(firstManifest);
  const bindings = exporterArtifactBindings(firstManifest, manifest.compiler_revision, manifest.platform,
    snapshotFile(join(output, 'first/.lake/build/bin/prod-export')));
  assert.equal(bindings[1].digest, `sha256:${first.manifest_sha256}`);
  const before = readdirSync(tmpdir()).filter(name => name.startsWith('prismpm-exporter-construction')).sort();
  mkdirSync(join(temporary, 'model')); mkdirSync(join(temporary, 'vendor/lean4-prod'), {recursive: true});
  const invalid = Buffer.alloc(1024); // A real empty archive cannot build an exporter.
  const original = createHash('sha256').update(readFileSync(join(source, 'vendor/lean4-prod/lean.tar'))).digest('hex');
  const replacement = createHash('sha256').update(invalid).digest('hex');
  writeFileSync(join(temporary, 'vendor/lean4-prod/lean.tar'), invalid);
  writeFileSync(join(temporary, 'model/dependencies.toml'), readSmall(join(source, 'model/dependencies.toml'), 1024 * 1024).replace(original, replacement));
  writeFileSync(join(temporary, 'lean-toolchain'), readSmall(join(source, 'lean-toolchain'), 256));
  assert.throws(() => buildSeed(temporary, join(output, 'failed')), /exporter construction failed/);
  assert(!existsSync(join(output, 'failed')));
  assert.deepEqual(readdirSync(tmpdir()).filter(name => name.startsWith('prismpm-exporter-construction')).sort(), before,
    'failed real construction must remove only its owned staging');
  assert.deepEqual(readdirSync(output).sort(), ['first', 'second']);
  return {scope: 'exporter-construction-only', manifest_sha256: first.manifest_sha256,
    files: first.files, raw_construction: [first.construction, second.construction]};
} finally {
  rmSync(temporary, {recursive: true});
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 5, 'usage: exporter-seed.integration.mjs SOURCE OTHER OUTPUT_PARENT');
  const output = mkdtempSync(join(resolve(process.argv[4]), 'exporter-construction-check-'));
  try { process.stdout.write(JSON.stringify(constructSeeds(resolve(process.argv[2]), resolve(process.argv[3]), output)) + '\n'); }
  finally { rmSync(output, {recursive: true}); }
}
