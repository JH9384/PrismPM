import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseArchive,
  resolveArchive,
  canonicalJson,
  KIND,
  MODEL_EXTENSION,
  DIRECTORY_EXTENSION,
} from '../src/archive.mjs';
import { decodeHoloview, encodeHoloview } from '../src/view.mjs';
import { compileGuest, runGuest } from '../src/core.mjs';
import { load, loadArchive, PrismCodeError } from '../src/index.mjs';

const fixture = new URL('../fixtures/Calculator.holo', import.meta.url);
const bytes = new Uint8Array(readFileSync(fixture));

// Published facts about the reference archive (calculator-example main,
// `artifacts/application-acceptance.json`): size, fingerprint, vector count.
const CALCULATOR = {
  size: 24801,
  fingerprint: '8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba',
  vectors: 22,
  guestKappa: 'blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380',
};

test('the reference archive has the documented header and eight sections', () => {
  assert.equal(bytes.length, CALCULATOR.size);
  const parsed = parseArchive(bytes);
  assert.equal(parsed.version, 4);
  assert.equal(parsed.flags, 0);
  assert.equal(parsed.sections.length, 8);
  assert.deepEqual(
    parsed.sections.map((s) => s.kind),
    [KIND.APP_MANIFEST, KIND.METADATA, KIND.EXTENSION, KIND.EXTENSION, KIND.CONTENT_BLOB, KIND.CONTENT_BLOB, KIND.CONTENT_BLOB, KIND.CONTENT_BLOB],
  );
  assert.equal(parsed.manifest.labels.length, 3);
  assert.deepEqual(
    parsed.extensions.map((e) => e.name),
    [DIRECTORY_EXTENSION, MODEL_EXTENSION],
  );
  assert.equal(parsed.blobs.length, 4);
  // Blobs are sorted by label bytes.
  const labels = parsed.blobs.map((b) => b.label);
  assert.deepEqual(labels, [...labels].sort());
});

test('footer and every blob label verify with BLAKE3', () => {
  const parsed = parseArchive(bytes);
  assert.equal(parsed.footer, CALCULATOR.fingerprint);
  assert.equal(parsed.fingerprint, CALCULATOR.fingerprint);
  assert.equal(parsed.verification.footer, true);
  assert.equal(parsed.verification.labels, true);
  assert.deepEqual(parsed.verification.labelMismatches, []);
});

test('the directory and model extensions resolve every blob and agree with the manifest', () => {
  const resolved = resolveArchive(parseArchive(bytes));
  assert.equal(resolved.identities.guestKappa, CALCULATOR.guestKappa);
  assert.equal(resolved.identities.verified, true);
  assert.equal(resolved.identities.consistent, true);
  assert.equal(resolved.modelDocument.schema, 'prismpm/model-document/1');
  assert.equal(resolved.provenance.schema, 'prismpm/model-provenance/1');
  assert.equal(resolved.provenance.cargo_name, 'prism-calculator');
  assert.equal(resolved.directory.layers[0].contract, 'hologram:guest/core-wasm@1');
  assert.equal(resolved.capabilities.content.length, 104);
});

test('the model extension is canonical JSON (sorted keys, no whitespace)', () => {
  const parsed = parseArchive(bytes);
  const model = parsed.extensions.find((e) => e.name === MODEL_EXTENSION);
  assert.equal(canonicalJson(JSON.parse(model.text)), model.text);
  // The application directory is Hologram's own extension and keeps its field order.
  const directory = parsed.extensions.find((e) => e.name === DIRECTORY_EXTENSION);
  assert.deepEqual(Object.keys(JSON.parse(directory.text)), ['schema_version', 'primary_layer', 'requires_kappa', 'layers', 'children', 'blobs']);
});

test('the guest has no imports and exactly the three Core-Wasm exports', async () => {
  const resolved = resolveArchive(parseArchive(bytes));
  const module = await compileGuest(resolved.guest.content);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.deepEqual(
    WebAssembly.Module.exports(module).map((e) => e.name).sort(),
    ['holo_alloc', 'holo_run', 'memory'],
  );
  const response = runGuest(module, new TextEncoder().encode('1\tadd\t20\t22'));
  assert.equal(new TextDecoder().decode(response), '1\tok\t42');
});

test('every acceptance vector is byte-identical through holo_run', async () => {
  const app = await loadArchive(bytes);
  assert.equal(app.kind, 'holo');
  assert.equal(app.name, 'Calculator');
  assert.equal(app.vectors.length, CALCULATOR.vectors);
  assert.deepEqual(app.limits, { request: 52, response: 27, guestAllocation: 65536 });
  const result = await app.acceptance();
  assert.deepEqual(result, { total: CALCULATOR.vectors, passed: CALCULATOR.vectors, failed: [] });
});

test('dispatch answers a modeled refusal above the request maximum and refuses above the allocation maximum', async () => {
  const app = await loadArchive(bytes);
  const long = new Uint8Array(app.limits.request + 1).fill(0x31);
  const refused = new TextDecoder().decode(await app.dispatch(long));
  assert.match(refused, /^1\terror\t/);
  await assert.rejects(app.dispatch(new Uint8Array(app.limits.guestAllocation + 1)), (error) => error instanceof PrismCodeError && error.code === 'core.allocation');
});

test('the HOLOVIEW decodes to three files with entry index.html and re-encodes byte for byte', () => {
  const resolved = resolveArchive(parseArchive(bytes));
  const view = decodeHoloview(resolved.view.content);
  assert.equal(view.entry, 'index.html');
  assert.deepEqual([...view.files.keys()], ['app.css', 'app.js', 'index.html']);
  assert.deepEqual(encodeHoloview(view), resolved.view.content);
  const html = new TextDecoder().decode(view.files.get('index.html'));
  assert.match(html, /<html/);
});

test('load() accepts bytes, an ArrayBuffer and a file URL', async () => {
  const fromBytes = await load(bytes);
  const fromBuffer = await load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const fromUrl = await load(fixture);
  for (const app of [fromBytes, fromBuffer, fromUrl]) {
    assert.equal(app.identities.archiveFingerprint, CALCULATOR.fingerprint);
    assert.equal(app.evidence.hologramLiveCommit, 'd8208266d8abdc2445b7bbc0cef412a566adfaf1');
  }
});

function corrupt(at, value) {
  const copy = Uint8Array.from(bytes);
  copy[at] = value;
  return copy;
}

test('the reader names what it refuses', () => {
  const expect = (input, code) => {
    assert.throws(() => parseArchive(input), (error) => error instanceof PrismCodeError && error.code === code, code);
  };
  expect(corrupt(0, 0x58), 'archive.magic');
  expect(corrupt(4, 3), 'archive.version');
  expect(corrupt(6, 1), 'archive.flags');
  expect(corrupt(8, 9), 'archive.bounds');
  expect(bytes.subarray(0, 20), 'archive.bounds');
});

test('a flipped content byte is reported as a label mismatch and an unverified footer, not hidden', () => {
  const parsed = parseArchive(bytes);
  const guest = parsed.blobs.find((b) => b.label === CALCULATOR.guestKappa);
  const at = guest.content.byteOffset - bytes.byteOffset + 8;
  const damaged = parseArchive(corrupt(at, bytes[at] ^ 0xff));
  assert.equal(damaged.verification.footer, false);
  assert.equal(damaged.verification.labels, false);
  assert.equal(damaged.verification.labelMismatches[0].label, CALCULATOR.guestKappa);
  assert.equal(resolveArchive(damaged).identities.verified, false);
});
