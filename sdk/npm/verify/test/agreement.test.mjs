// The copies under src/vendor/ and the reader agree with their origins.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import * as spec from '../../spec/index.mjs';
import * as prismBlake3 from '../../prism-code/src/blake3.mjs';
import { parseArchive } from '../../prism-code/src/archive.mjs';
import * as vendoredSpec from '../src/vendor/spec.mjs';
import { blake3Hex } from '../src/vendor/blake3.mjs';
import { sha256Hex } from '../src/sha256.mjs';
import { readStructure } from '../src/reader.mjs';
import { FORMAT_REVISION, ASSURANCE, inspect } from '../src/index.mjs';
import { here, reference, assertVerdict } from './helpers.mjs';

test('the vendored files are what scripts/vendor.mjs makes from their origins today', () => {
  execFileSync(process.execPath, [here('../scripts/vendor.mjs'), '--check'], { stdio: 'pipe' });
});

test('FORMAT_REVISION and the vendored constants equal @prism-code/spec', () => {
  assert.equal(FORMAT_REVISION, spec.FORMAT_REVISION);
  assert.deepEqual(Object.keys(vendoredSpec), Object.keys(spec));
  assert.deepEqual({ ...vendoredSpec.FORMAT_REVISIONS }, { ...spec.FORMAT_REVISIONS });
});

test('BLAKE3 agrees with prism-code on the official vectors', () => {
  const { cases } = JSON.parse(readFileSync(here('../../prism-code/test/blake3-vectors.json'), 'utf8'));
  assert.ok(cases.length > 10);
  for (const { input_len: length, hash } of cases) {
    const input = Uint8Array.from({ length }, (_, i) => i % 251);
    assert.equal(blake3Hex(input), hash.slice(0, 64), `length ${length}`);
    assert.equal(blake3Hex(input), prismBlake3.blake3Hex(input));
  }
});

test('SHA-256 agrees with node:crypto across block boundaries', () => {
  for (const length of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 24801, 70000]) {
    const input = Uint8Array.from({ length }, (_, i) => (i * 131 + 7) & 0xff);
    assert.equal(sha256Hex(input), createHash('sha256').update(input).digest('hex'), `length ${length}`);
  }
  assert.equal(sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('the structural reader and prism-code parseArchive read the same table', () => {
  const bytes = reference();
  const structure = readStructure(bytes);
  const parsed = parseArchive(bytes);
  assert.equal(structure.ok, true);
  assert.deepEqual(
    structure.sections,
    parsed.sections.map(({ index, kind, offset, length }) => ({ index, kind, offset, length })),
  );
  assert.equal(structure.bodyEnd, parsed.body.length);
});

// Issue #269: @prism-code/spec carries the assurance levels and the verdict
// schema. This package vendors the constants and keeps a copy of the schema
// for its tests; these tests hold both to the spec.
const specAssurance = here('../../spec/assurance-levels.mjs');
const specVerdictSchema = here('../../spec/schemas/verdict/verdict-v1.schema.json');

test('ASSURANCE equals @prism-code/spec', async () => {
  const { ASSURANCE: fromSpec } = await import(pathToFileURL(specAssurance).href);
  assert.deepEqual(JSON.parse(JSON.stringify(ASSURANCE)), JSON.parse(JSON.stringify(fromSpec)));
});

test('the verdict schema copy equals @prism-code/spec', () => {
  assert.deepEqual(JSON.parse(readFileSync(here('fixtures/verdict-v1.schema.json'), 'utf8')), JSON.parse(readFileSync(specVerdictSchema, 'utf8')));
});

test('the verdict schema rejects a verdict that contradicts itself', () => {
  const good = { schema: 'prism/verdict/1', holo: `blake3:${'0'.repeat(64)}`, level: 'P0', policy: { name: 'default', minimum: 'P2' }, passed: false, reasons: [{ check: 'provenance.statement', withholds: 'P1', message: 'None.' }] };
  assertVerdict(good);
  assert.throws(() => assertVerdict({ ...good, passed: true }), /not a prism\/verdict\/1 object/);
  assert.throws(() => assertVerdict({ ...good, reasons: [] }), /not a prism\/verdict\/1 object/);
  assert.throws(() => assertVerdict({ ...good, level: 'P1' }), /not a prism\/verdict\/1 object/);
});

// Issue #271: prism-code has `inspect`. This package returns the same
// `prismpm/holo-inspection/1` object; these tests compare the two readers directly.
const prismInspect = here('../../prism-code/src/inspect.mjs');
const prismGolden = here('../../prism-code/test/fixtures/Calculator.inspect.json');

test('the inspection golden copy equals prism-code', () => {
  assert.deepEqual(JSON.parse(readFileSync(here('fixtures/Calculator.inspect.json'), 'utf8')), JSON.parse(readFileSync(prismGolden, 'utf8')));
});

test('inspect equals prism-code inspect, intact and damaged', async () => {
  const { inspect: prismCodeInspect } = await import(pathToFileURL(prismInspect).href);
  const intact = reference();
  const damaged = reference();
  damaged[4440 + 71 + 100] ^= 0x01;
  for (const bytes of [intact, damaged]) {
    assert.deepEqual(JSON.parse(JSON.stringify(inspect(bytes))), JSON.parse(JSON.stringify(await prismCodeInspect(bytes))));
  }
});
