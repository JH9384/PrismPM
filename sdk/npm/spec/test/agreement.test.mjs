// prism-code's reader and this package state the same format. The reader is imported, not copied.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as archive from '../../prism-code/src/archive.mjs';
import { PROVENANCE_SCHEMA } from '../../prism-code/src/closure.mjs';
import { CORE_CONTRACT } from '../../prism-code/src/core.mjs';
import { spec } from './spec.mjs';
import { here, loadReference, schema, wasmExports } from './reference.mjs';

const ref = loadReference();

test('prism-code constants equal this package', () => {
  assert.equal(archive.MAGIC, spec.MAGIC);
  assert.equal(archive.VERSION, spec.PHYSICAL_VERSION);
  assert.deepEqual({ ...archive.KIND }, { ...spec.SECTION_KIND });
  assert.equal(archive.LABEL_LENGTH, spec.LABEL_LENGTH);
  assert.equal(archive.FOOTER_LENGTH, spec.FOOTER_LENGTH);
  assert.equal(archive.HEADER_LENGTH, spec.HEADER_LENGTH);
  assert.equal(archive.TABLE_ENTRY_LENGTH, spec.TABLE_ENTRY_LENGTH);
  assert.equal(archive.DIRECTORY_EXTENSION, spec.EXTENSION.APPLICATION_DIRECTORY);
  assert.equal(archive.MODEL_EXTENSION, spec.EXTENSION.PRISMPM_MODEL);
  assert.equal(archive.APP_MANIFEST_URI, spec.APP_MANIFEST.URI);
  assert.equal(archive.MANIFEST_LENGTH, spec.APP_MANIFEST.LENGTH);
  assert.equal(archive.MANIFEST_PREFIX_LENGTH, spec.APP_MANIFEST.PREFIX_LENGTH);
  assert.equal(archive.MANIFEST_SUFFIX_HEX, spec.APP_MANIFEST.SUFFIX_HEX);
  assert.equal(CORE_CONTRACT, spec.CORE_WASM.CONTRACT);
  assert.equal(PROVENANCE_SCHEMA, 'prismpm/browser-provenance/1');
  assert.ok(PROVENANCE_SCHEMA in spec.SCHEMAS);
});

test('the schema constants equal the package constants', () => {
  const manifest = schema(spec.HOLO_SCHEMAS.APP_MANIFEST);
  assert.equal(manifest.properties.suffix.const, spec.APP_MANIFEST.SUFFIX_HEX);
  assert.equal(manifest.properties.uri.const, spec.APP_MANIFEST.URI);
  const table = schema(spec.HOLO_SCHEMAS.ARCHIVE);
  assert.deepEqual(table.properties.sections.prefixItems.map((row) => row.properties.kind.const), [...spec.SECTION_ORDER]);
  assert.equal(table.properties.sections.prefixItems[0].properties.offset.const, spec.BODY_OFFSET);
  assert.equal(table.properties.version.const, spec.PHYSICAL_VERSION);
});

test('the parsed section table obeys the layout the schema cannot state', () => {
  const { sections } = ref.parsed;
  assert.equal(sections.length, spec.SECTION_COUNT);
  assert.equal(spec.HEADER_LENGTH + spec.SECTION_COUNT * spec.TABLE_ENTRY_LENGTH, spec.BODY_OFFSET);
  assert.deepEqual(sections.map((s) => s.kind), [...spec.SECTION_ORDER]);
  assert.equal(sections[0].offset, spec.BODY_OFFSET);
  for (let i = 1; i < sections.length; i++) assert.equal(sections[i].offset, sections[i - 1].offset + sections[i - 1].length);
  const last = sections.at(-1);
  assert.equal(last.offset + last.length, ref.bytes.length - spec.FOOTER_LENGTH);
  // Each table row's kind is one byte followed by seven zero bytes.
  for (let i = 0; i < sections.length; i++) {
    const at = spec.HEADER_LENGTH + i * spec.TABLE_ENTRY_LENGTH;
    assert.deepEqual([...ref.bytes.subarray(at + 1, at + 8)], [0, 0, 0, 0, 0, 0, 0]);
  }
  const labels = ref.parsed.blobs.map((b) => b.label);
  assert.deepEqual(labels, [...labels].sort());
  assert.equal(new Set(labels).size, labels.length);
});

test('the application manifest bytes are prefix, three labels and suffix', () => {
  const body = ref.parsed.sections[0].body;
  const hex = Buffer.from(body).toString('hex');
  assert.equal(body.length, spec.APP_MANIFEST.LENGTH);
  assert.equal(hex.slice(0, spec.APP_MANIFEST.PREFIX_LENGTH * 2), spec.APP_MANIFEST.PREFIX_HEX);
  assert.equal(hex.slice(-spec.APP_MANIFEST.SUFFIX_LENGTH * 2), spec.APP_MANIFEST.SUFFIX_HEX);
  assert.equal(spec.APP_MANIFEST.PREFIX_LENGTH + 3 * spec.LABEL_LENGTH + spec.APP_MANIFEST.SUFFIX_LENGTH, spec.APP_MANIFEST.LENGTH);
  const { directory } = ref;
  assert.deepEqual(ref.appManifest.labels, [directory.requires_kappa, directory.layers[0].content_kappa, directory.layers[1].content_kappa]);
});

test('extension rows are named in table order', () => {
  assert.deepEqual(
    ref.parsed.extensions.map((e) => e.name),
    [...spec.FORMAT_REVISIONS[spec.FORMAT_REVISION].extensions],
  );
});

test('worlds/core-wasm.wit states the reference guest exports exactly', () => {
  const wit = readFileSync(here(`../${spec.CORE_WASM.WORLD}`), 'utf8');
  assert.match(wit, /^package hologram:guest@1\.0\.0;$/m);
  const LOWER = { u32: 'i32', u64: 'i64' };
  const declared = [...wit.matchAll(/^\s*export ([a-z-]+): func\(([^)]*)\) -> (u32|u64);$/gm)].map(([, name, params, result]) => ({
    name: name.replaceAll('-', '_'),
    kind: 'func',
    params: params.split(',').map((p) => LOWER[p.split(':')[1].trim()]),
    results: [LOWER[result]],
  }));
  const actual = wasmExports(ref.guest);
  assert.deepEqual(
    actual.filter((e) => e.kind === 'func').sort((a, b) => a.name.localeCompare(b.name)),
    declared.sort((a, b) => a.name.localeCompare(b.name)),
  );
  assert.deepEqual(actual.map((e) => e.name).sort(), [...spec.CORE_WASM.EXPORTS]);
  assert.deepEqual(actual.find((e) => e.name === 'memory'), { name: 'memory', kind: 'memory' });
});
