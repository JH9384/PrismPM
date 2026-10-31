// Both reference archives (#278) and their documents validate against this package's schemas. reference.test.mjs
// holds the Calculator to its published digests; this file holds every archive to the format.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spec } from './spec.mjs';
import { validate } from './json-schema.mjs';
import { REFERENCE_ARCHIVES, loadReference, schema, wasmExports } from './reference.mjs';

const { CAPABILITY_SET, CORE_WASM, FORMAT_REVISION, FORMAT_REVISIONS, SCHEMAS } = spec;
const valid = (path, value, name) => assert.deepEqual(validate(schema(path), value), [], `${name}: ${path}`);

test('the reference archives are Calculator and Payment Approval', () => {
  assert.deepEqual(Object.keys(REFERENCE_ARCHIVES).sort(), ['Calculator', 'PaymentApproval']);
});

for (const [name, path] of Object.entries(REFERENCE_ARCHIVES)) {
  const ref = loadReference(path);

  test(`${name} is intact and every document matches its schema`, () => {
    assert.equal(ref.parsed.verification.footer, true);
    assert.equal(ref.parsed.verification.labels, true);
    assert.equal(ref.resolved.identities.verified, true);
    valid('schemas/holo/archive.schema.json', ref.archive, name);
    valid('schemas/holo/app-manifest.schema.json', ref.appManifest, name);
    valid('schemas/holo/source-manifest.schema.json', ref.sourceManifest, name);
    valid('schemas/holo/application-directory.schema.json', ref.directory, name);
    assert.equal(ref.provenance.schema, 'prismpm/model-provenance/1');
    valid(SCHEMAS['prismpm/model-provenance/1'], ref.provenance, name);
    const document = ref.modelDocument.schema;
    assert.ok(FORMAT_REVISIONS[FORMAT_REVISION].modelDocumentSchemas.includes(document), document);
    valid(SCHEMAS[document], ref.modelDocument, name);
    assert.equal(ref.capabilitySetHex, CAPABILITY_SET.EMPTY_HEX);
  });

  test(`${name} declares the core-wasm world and its guest exports exactly what the world states`, () => {
    assert.equal(ref.directory.layers[0].contract, CORE_WASM.CONTRACT);
    const actual = wasmExports(ref.guest);
    assert.deepEqual(actual.map((e) => e.name).sort(), [...CORE_WASM.EXPORTS]);
    const world = spec.WORLDS[CORE_WASM.CONTRACT];
    assert.deepEqual(world.imports, []);
    for (const declared of world.exports) {
      const found = actual.find((e) => e.name === declared.name);
      assert.ok(found, `${name}: ${declared.name}`);
      assert.equal(found.kind, declared.kind);
      if (declared.kind === 'func') assert.deepEqual({ params: found.params, results: found.results }, { params: declared.params, results: declared.results });
    }
  });
}
