import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromFile, readClosureDirectory } from '../src/node.mjs';
import { BRAND_FILES, closureProfiles, PROVENANCE_SCHEMA_V2, verifyClosure } from '../src/closure.mjs';
import { loadArchive, loadClosure } from '../src/index.mjs';
import { sha256Hex } from '../src/sha256.mjs';

// calculator-example main `public/`, the `export-browser` output of the same
// release as `fixtures/Calculator.holo`.
const directory = new URL('./fixtures/calculator-closure/', import.meta.url);
const archive = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));

test('the closure is anchored on provenance.json and its digests are checked, not trusted', async () => {
  const files = await readClosureDirectory(fileURLToPath(directory));
  const { stem, provenance, verification } = await verifyClosure(files);
  assert.equal(stem, 'prism_calculator');
  assert.equal(provenance.schema, 'prismpm/browser-provenance/1');
  // Whatever the files say, the verdict must equal a direct recomputation.
  const wasm = await sha256Hex(files.get('prism_calculator_bg.wasm'));
  const glue = await sha256Hex(files.get('prism_calculator.js'));
  const expectedMismatches = [];
  if (provenance.adapter_wasm_sha256 !== wasm) expectedMismatches.push('adapter_wasm_sha256');
  if (provenance.binding_javascript_sha256 !== glue) expectedMismatches.push('binding_javascript_sha256');
  assert.deepEqual(verification.mismatches.map((m) => m.field), expectedMismatches);
  assert.equal(verification.verified, expectedMismatches.length === 0);
  assert.ok(verification.unverifiable.includes('model_id'));
});

test('the closure dispatches the archive\'s 22 vectors identically through calculate()', async () => {
  const holo = await loadArchive(archive);
  const app = await fromFile(directory, { model: holo.model });
  assert.equal(app.kind, 'closure');
  assert.equal(app.profile, 'prismpm/model-document/1');
  assert.equal(app.vectors.length, 22);
  const result = await app.acceptance();
  assert.deepEqual(result.failed, []);
  assert.equal(result.passed, 22);
  // The generated core and the adapter carry the same core digest.
  assert.equal(app.provenance.browser.generated_core_sha256, holo.provenance.model.generated_core_sha256);
});

test('a numeric closure without the model document refuses to guess the wire format', async () => {
  const files = await readClosureDirectory(fileURLToPath(directory));
  await assert.rejects(
    loadClosure(files, (name) => import(new URL(name, directory).href)),
    (error) => error.code === 'closure.model',
  );
});

test('a closure missing a fixed file is refused by name', async () => {
  const files = await readClosureDirectory(fileURLToPath(directory));
  files.delete('provenance.json');
  await assert.rejects(verifyClosure(files), (error) => error.code === 'closure.files');
});

test('a closure v2 provenance names every other file, and a changed or unlisted file is a mismatch', async () => {
  const files = await readClosureDirectory(fileURLToPath(directory));
  const brand = new URL('../../../../vendor/hologram-brand/', import.meta.url);
  const sources = {'icon.svg': 'icon.svg', 'icon-512.png': 'icon-512.png', 'manifest.webmanifest': null};
  for (const name of BRAND_FILES) {
    const source = name in sources ? sources[name] : (name.endsWith('.woff2') || name.startsWith('OFL-') ? `fonts/${name}` : null);
    files.set(name, source === null ? new TextEncoder().encode('{"name":"Calculator"}\n') : new Uint8Array(readFileSync(new URL(source, brand))));
  }
  const v1 = JSON.parse(new TextDecoder().decode(files.get('provenance.json')));
  const listed = {};
  for (const [name, bytes] of files) if (name !== 'provenance.json') listed[name] = await sha256Hex(bytes);
  const provenance = {...v1, schema: PROVENANCE_SCHEMA_V2, files: listed,
    adapter_wasm_sha256: listed['prism_calculator_bg.wasm'], binding_javascript_sha256: listed['prism_calculator.js']};
  files.set('provenance.json', new TextEncoder().encode(JSON.stringify(provenance)));
  assert.deepEqual([...files.keys()].sort(), closureProfiles('prism_calculator')[2]);
  const verified = await verifyClosure(files);
  assert.equal(verified.provenance.schema, 'prismpm/browser-provenance/2');
  assert.deepEqual(verified.verification.mismatches, []);
  assert.equal(verified.verification.verified, true);

  const changed = new Map(files);
  changed.set('Geist-Regular.woff2', Uint8Array.of(0));
  const result = await verifyClosure(changed);
  assert.deepEqual(result.verification.mismatches.map((m) => m.field), ['files.Geist-Regular.woff2']);

  const partial = new Map(files);
  partial.delete('GeistMono-Regular.woff2');
  const fetched = await verifyClosure(partial);
  assert.equal(fetched.verification.verified, true);
  assert.ok(fetched.verification.unverifiable.includes('files.GeistMono-Regular.woff2'));

  const extra = new Map(files);
  extra.set('unlisted.js', Uint8Array.of(1));
  assert.deepEqual((await verifyClosure(extra)).verification.mismatches.map((m) => m.field), ['files.unlisted.js']);
});
