// The reference archive and its documents validate against this package's schemas.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { blake3Hex } from '../../prism-code/src/blake3.mjs';
import { spec } from './spec.mjs';
import { validate } from './json-schema.mjs';
import { REFERENCE_SHA256, here, loadReference, readJson, schema } from './reference.mjs';

const { ATTESTATION, CAPABILITY_SET, FORMAT_REVISIONS, LABEL_PREFIX, PROOF_PREDICATE_TYPE, SCHEMAS } = spec;

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
  const manifest = readJson('fixtures/documents/build-manifest-v1/calculator.json');
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

test('a statement about the guest blob carries sha256 and blake3 over the same bytes (ADR-015)', () => {
  const guest = ref.resolved.guest;
  const digest = { blake3: blake3Hex(guest.content), sha256: createHash('sha256').update(guest.content).digest('hex') };
  assert.equal(`${LABEL_PREFIX}${digest.blake3}`, guest.label);
  assert.notEqual(digest.blake3, ref.parsed.footer);
  const statement = {
    _type: ATTESTATION.STATEMENT_TYPE,
    subject: [{ name: 'core-wasm/prism_calculator_core_wasm.wasm', digest }],
    predicateType: PROOF_PREDICATE_TYPE,
    predicate: {},
  };
  valid(ATTESTATION.STATEMENT_SCHEMA, statement);
  const registryFacing = {
    ...statement,
    subject: [{ name: ATTESTATION.OCI_MANIFEST_SUBJECT, digest: { sha256: ref.sha256 } }, ...statement.subject],
  };
  valid(ATTESTATION.STATEMENT_SCHEMA, registryFacing);
  const envelope = {
    payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
    payloadType: 'application/vnd.in-toto+json',
    signatures: [{ keyid: 'example', sig: Buffer.from('not a real signature').toString('base64') }],
  };
  valid('schemas/attestation/dsse-envelope.schema.json', envelope);
});
