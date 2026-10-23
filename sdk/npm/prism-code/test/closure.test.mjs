import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromFile, readClosureDirectory } from '../src/node.mjs';
import { verifyClosure } from '../src/closure.mjs';
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
