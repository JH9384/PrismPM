import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArchive } from '../../prism-code/src/archive.mjs';
import { inspect, VerifyError, FORMAT_REVISION } from '../src/index.mjs';
import { reference, table, ADR_015 } from './helpers.mjs';

test('inspect lists every section in table order, with kinds, offsets, names and roles', () => {
  const bytes = reference();
  const inspection = inspect(bytes);
  const parsed = parseArchive(bytes);
  assert.equal(inspection.sections.length, parsed.sections.length);
  assert.deepEqual(
    inspection.sections.map(({ index, kind, offset, length }) => ({ index, kind, offset, length })),
    parsed.sections.map(({ index, kind, offset, length }) => ({ index, kind, offset, length })),
  );
  assert.deepEqual(
    inspection.sections.map((s) => [s.kindName, s.role ?? s.name ?? null]),
    [
      ['app-manifest', null],
      ['metadata', null],
      ['extension', 'https://hologram.foundation/extension/application-directory/v1'],
      ['extension', 'https://uor.foundation/extension/prismpm-model/v1'],
      ['content-blob', 'guest'],
      ['content-blob', 'view'],
      ['content-blob', 'capabilities'],
      ['content-blob', 'model'],
    ],
  );
  for (const blob of inspection.sections.filter((s) => s.kindName === 'content-blob')) {
    assert.equal(blob.label, `blake3:${blob.digests.blake3}`);
    assert.equal(blob.labelMatches, true);
    assert.match(blob.digests.sha256, /^[0-9a-f]{64}$/);
  }
});

test('inspect reports both digests of the archive and of each part, as ADR-015 records them', () => {
  const inspection = inspect(reference());
  assert.deepEqual(inspection.digests.archive, ADR_015.archive);
  assert.deepEqual(inspection.digests.guest, ADR_015.guest);
  assert.deepEqual(inspection.digests.model, ADR_015.model);
  assert.deepEqual(Object.keys(inspection.digests), ['archive', 'capabilities', 'guest', 'view', 'model']);
  assert.deepEqual(inspection.footer, { stored: ADR_015.footer, computed: ADR_015.footer, matches: true });
});

test('inspect names the format revision and summarizes the documents', () => {
  const inspection = inspect(reference());
  assert.equal(inspection.formatRevision, FORMAT_REVISION);
  assert.equal(inspection.size, 24801);
  assert.equal(inspection.manifest.labels.guest, `blake3:${ADR_015.guest.blake3}`);
  assert.equal(inspection.sourceManifest.version, 4);
  assert.deepEqual(inspection.directory.layers.map((l) => l.kind), ['wasm', 'view']);
  assert.equal(inspection.provenance.schema, 'prismpm/model-provenance/1');
  assert.equal(inspection.provenance.modelId, ADR_015.model.sha256);
  assert.deepEqual(
    { ...inspection.modelDocument },
    {
      schema: 'prismpm/model-document/1',
      name: 'Calculator',
      cargoName: 'prism-calculator',
      cargoVersion: '0.1.0',
      coreContract: 'hologram:guest/core-wasm@1',
      kappa: `blake3:${ADR_015.model.blake3}`,
      sha256: ADR_015.model.sha256,
      acceptanceVectors: inspection.modelDocument.acceptanceVectors,
    },
  );
  assert.ok(inspection.modelDocument.acceptanceVectors > 0);
  assert.deepEqual(inspection.attestation, { present: false, section: null });
});

test('inspect reports damage after the table instead of throwing', () => {
  const bytes = reference();
  bytes[table(bytes)[4].offset + 71 + 100] ^= 0x01;
  const inspection = inspect(bytes);
  assert.equal(inspection.footer.matches, false);
  assert.equal(inspection.sections[4].labelMatches, false);
  assert.equal(inspection.sections[5].labelMatches, true);
});

test('inspect throws VerifyError when the header or table cannot be read', () => {
  const magic = reference();
  magic[1] = 0;
  assert.throws(() => inspect(magic), (e) => e instanceof VerifyError && e.code === 'archive.magic');
  assert.throws(() => inspect(reference().subarray(0, 24800)), (e) => e instanceof VerifyError && e.code === 'archive.table');
  assert.throws(() => inspect([1, 2, 3]), (e) => e instanceof VerifyError && e.code === 'input');
});
