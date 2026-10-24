import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseArchive } from '../../prism-code/src/archive.mjs';
import { inspect, VerifyError, FORMAT_REVISION, INSPECTION_SCHEMA } from '../src/index.mjs';
import { here, reference, table, ADR_015 } from './helpers.mjs';

/**
 * prism-code's golden inspection of the reference archive, from PR #335
 * (issue #271). Canonical JSON with sorted keys. test/agreement.test.mjs holds
 * this copy to prism-code's once that PR has merged.
 */
const GOLDEN = JSON.parse(readFileSync(here('fixtures/Calculator.inspect.json'), 'utf8'));
const plain = (value) => JSON.parse(JSON.stringify(value));

test('inspect returns the prismpm/holo-inspection/1 object prism-code returns for the reference archive', () => {
  const inspection = inspect(reference());
  assert.equal(inspection.schema, INSPECTION_SCHEMA);
  assert.deepEqual(plain(inspection), GOLDEN);
});

test('inspect lists every section in table order, with kinds, offsets, names and roles', () => {
  const bytes = reference();
  const inspection = inspect(bytes);
  assert.deepEqual(
    inspection.sections.map(({ index, kind, offset, length }) => ({ index, kind, offset, length })),
    parseArchive(bytes).sections.map(({ index, kind, offset, length }) => ({ index, kind, offset, length })),
  );
  assert.deepEqual(
    inspection.sections.map((s) => [s.kind_name, s.role, s.name ?? null]),
    [
      ['app-manifest', 'app-manifest', null],
      ['metadata', 'source-manifest', null],
      ['extension', 'application-directory', 'https://hologram.foundation/extension/application-directory/v1'],
      ['extension', 'model-provenance', 'https://uor.foundation/extension/prismpm-model/v1'],
      ['content-blob', 'guest', null],
      ['content-blob', 'view', null],
      ['content-blob', 'capability-set', null],
      ['content-blob', 'model-document', null],
    ],
  );
  for (const section of inspection.sections) {
    assert.match(section.digest.sha256, /^[0-9a-f]{64}$/);
    if (section.kind_name !== 'content-blob') continue;
    assert.equal(section.label, `blake3:${section.content.digest.blake3}`);
    assert.equal(section.content.label_matches, true);
    assert.equal(section.content.length, section.length - 71);
  }
});

test('inspect reports both digests of the archive and of its parts, as ADR-015 records them', () => {
  const inspection = inspect(reference());
  assert.deepEqual(inspection.digest, ADR_015.archive);
  assert.equal(inspection.footer, ADR_015.footer);
  assert.deepEqual(inspection.sections[4].content.digest, ADR_015.guest);
  assert.deepEqual(inspection.sections[7].content.digest, ADR_015.model);
  assert.deepEqual(inspection.model.digest, ADR_015.model);
  assert.equal(inspection.provenance.model_id, ADR_015.model.sha256);
});

test('inspect names the format revision, the world and no attestations', () => {
  const inspection = inspect(reference());
  assert.equal(inspection.revision, FORMAT_REVISION);
  assert.deepEqual(inspection.world.exports, ['holo_alloc', 'holo_run', 'memory']);
  assert.equal(inspection.world.capability_set.empty, true);
  assert.deepEqual(inspection.attestations, []);
  assert.deepEqual(inspection.verification, { footer: true, labels: true, cross_references: true });
});

test('inspect reports damage after the table instead of throwing', () => {
  const bytes = reference();
  bytes[table(bytes)[4].offset + 71 + 100] ^= 0x01;
  const inspection = inspect(bytes);
  assert.deepEqual(inspection.verification, { footer: false, labels: false, cross_references: true });
  assert.equal(inspection.sections[4].content.label_matches, false);
  assert.equal(inspection.sections[5].content.label_matches, true);
  assert.equal(inspection.footer, ADR_015.footer);
});

test('inspect throws VerifyError when the header or table cannot be read', () => {
  const magic = reference();
  magic[1] = 0;
  assert.throws(() => inspect(magic), (e) => e instanceof VerifyError && e.code === 'archive.magic');
  assert.throws(() => inspect(reference().subarray(0, 24800)), (e) => e instanceof VerifyError && e.code === 'archive.table');
  assert.throws(() => inspect([1, 2, 3]), (e) => e instanceof VerifyError && e.code === 'input');
});
