// The reference archive and its documents validate against this package's schemas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CAPABILITY_SET, FORMAT_REVISIONS, SCHEMAS } from '../index.mjs';
import { validate } from './json-schema.mjs';
import { REFERENCE_SHA256, here, loadReference, readJson, schema } from './reference.mjs';

const ref = loadReference();
const valid = (path, value) => assert.deepEqual(validate(schema(path), value), [], path);

test('the reference archive is the calculator-example artifact', () => {
  assert.equal(ref.sha256, REFERENCE_SHA256);
  assert.equal(ref.parsed.verification.footer, true);
  assert.equal(ref.parsed.verification.labels, true);
  assert.equal(ref.resolved.identities.verified, true);
});

test('header, section table and footer match schemas/holo/archive', () => {
  valid('schemas/holo/archive.schema.json', ref.archive);
});

test('application manifest matches schemas/holo/app-manifest', () => {
  valid('schemas/holo/app-manifest.schema.json', ref.appManifest);
});

test('metadata section matches schemas/holo/source-manifest', () => {
  valid('schemas/holo/source-manifest.schema.json', ref.sourceManifest);
});

test('directory extension matches schemas/holo/application-directory', () => {
  valid('schemas/holo/application-directory.schema.json', ref.directory);
});

test('model provenance extension matches prismpm/model-provenance/1', () => {
  assert.equal(ref.provenance.schema, 'prismpm/model-provenance/1');
  valid(SCHEMAS['prismpm/model-provenance/1'], ref.provenance);
});

test('the model document matches the schema its `schema` member names', () => {
  const name = ref.modelDocument.schema;
  assert.ok(FORMAT_REVISIONS['2026-10-23'].modelDocumentSchemas.includes(name), name);
  valid(SCHEMAS[name], ref.modelDocument);
});

test('the capability set blob is the empty capability constant', () => {
  assert.equal(ref.capabilitySetHex, CAPABILITY_SET.EMPTY_HEX);
});

test('calculator-example build-manifest.json matches prismpm/build-manifest/1 and binds the archive', () => {
  const manifest = readJson('fixtures/calculator-build-manifest.json');
  valid(SCHEMAS['prismpm/build-manifest/1'], manifest);
  const row = manifest.files.find((f) => f.path === 'Calculator.holo');
  assert.equal(row.sha256, REFERENCE_SHA256);
  assert.equal(row.byte_length, ref.bytes.length);
  const modelRow = manifest.files.find((f) => f.path === 'model.prism.json');
  assert.equal(modelRow.sha256, ref.provenance.model_id);
});

test('the browser closure provenance matches prismpm/browser-provenance/1 and binds the archive', () => {
  const path = '../../prism-code/test/fixtures/calculator-closure/provenance.json';
  const provenance = JSON.parse(readFileSync(here(path), 'utf8'));
  valid(SCHEMAS['prismpm/browser-provenance/1'], provenance);
  assert.equal(provenance.view_model_id, ref.provenance.view_binding.view_model_id);
  assert.equal(provenance.generated_core_sha256, ref.provenance.generated_core_sha256);
});

test('a statement about the reference archive carries blake3 and sha256 together', () => {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'Calculator.holo', digest: { blake3: ref.parsed.footer, sha256: ref.sha256 } }],
    predicateType: 'https://uor.foundation/prism/proof/v1',
    predicate: {},
  };
  valid('schemas/attestation/statement.schema.json', statement);
  const envelope = {
    payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
    payloadType: 'application/vnd.in-toto+json',
    signatures: [{ keyid: 'example', sig: Buffer.from('not a real signature').toString('base64') }],
  };
  valid('schemas/attestation/dsse-envelope.schema.json', envelope);
});
