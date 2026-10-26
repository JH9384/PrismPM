// Build provenance (#268): the SLSA predicate schema, its fixtures, and agreement with prism-code's generator.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as provenance from '../../prism-code/src/provenance.mjs';
import { blake3Hex } from '../../prism-code/src/blake3.mjs';
import { spec } from './spec.mjs';
import { validate } from './json-schema.mjs';
import { here, loadReference, readJson, schema } from './reference.mjs';

const { ASSURANCE, ATTESTATION, ATTESTATION_BUNDLE, PROVENANCE } = spec;

const ref = loadReference();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const min = readJson('fixtures/attestation/statement/provenance-min.json');
const max = readJson('fixtures/attestation/statement/provenance-max.json');
const lockBytes = readFileSync(here('fixtures/documents/sdk-lock-v3/calculator.json'));
const lock = JSON.parse(lockBytes);
const valid = (path, value) => assert.deepEqual(validate(schema(path), value), [], path);

test('the constants are the ones every other table already says, and prism-code agrees', () => {
  assert.equal(PROVENANCE.PREDICATE_TYPE, ATTESTATION_BUNDLE.PROVENANCE_PREDICATE_TYPE);
  assert.equal(PROVENANCE.PREDICATE_TYPE, ASSURANCE.PREDICATES.provenance);
  assert.equal(provenance.PROVENANCE_PREDICATE_TYPE, PROVENANCE.PREDICATE_TYPE);
  assert.equal(provenance.HOLO_BUILD_TYPE, PROVENANCE.BUILD_TYPE);
  assert.deepEqual({ ...provenance.PROVENANCE_MODES }, { ...PROVENANCE.MODES });
  assert.equal(PROVENANCE.DEFAULT_MODE, PROVENANCE.MODES.MIN);
  assert.equal(provenance.LOCK_URI, PROVENANCE.DEPENDENCIES.LOCK);
  assert.equal(provenance.STANDARDS_LOCK_URI, PROVENANCE.DEPENDENCIES.STANDARDS_LOCK);
  assert.equal(provenance.TOOLCHAIN_URI, PROVENANCE.DEPENDENCIES.TOOLCHAIN);
  assert.equal(provenance.GENERATOR_URI, PROVENANCE.DEPENDENCIES.GENERATOR);
});

test('the predicate schema fixes the build type and is the schema the constant names', () => {
  const s = schema(PROVENANCE.SCHEMA);
  assert.equal(s.$defs.MinPredicate.properties.buildDefinition.properties.buildType.const, PROVENANCE.BUILD_TYPE);
  assert.equal(s.$defs.MaxPredicate.properties.buildDefinition.properties.buildType.const, PROVENANCE.BUILD_TYPE);
  // A SLSA build type is a URL that names the document defining it; the package's own predicate URIs keep to /prism/.
  assert.match(PROVENANCE.BUILD_TYPE, /^https:\/\/uor\.foundation\/prism\/[a-z-]+\/v[0-9]+$/);
});

test('the min and max statements validate, and their predicates validate against the predicate schema', () => {
  for (const statement of [min, max]) {
    valid(ATTESTATION.STATEMENT_SCHEMA, statement);
    valid(PROVENANCE.SCHEMA, statement.predicate);
    assert.equal(statement.predicateType, PROVENANCE.PREDICATE_TYPE);
  }
});

test('min records nothing that varies between machines or runs; max adds exactly the opt-in members', () => {
  const m = min.predicate;
  assert.deepEqual(Object.keys(m.runDetails), ['builder']);
  assert.deepEqual(m.buildDefinition.internalParameters, {});
  assert.equal(m.buildDefinition.externalParameters.arguments, undefined);
  const x = max.predicate;
  assert.deepEqual(Object.keys(x.runDetails).sort(), ['builder', 'metadata']);
  assert.deepEqual(Object.keys(x.buildDefinition.internalParameters), ['platform']);
  assert.ok(Array.isArray(x.buildDefinition.externalParameters.arguments));
  // Everything else is shared: the opt-in members are the whole difference.
  assert.deepEqual(x.buildDefinition.resolvedDependencies, m.buildDefinition.resolvedDependencies);
  assert.deepEqual(x.runDetails.builder, m.runDetails.builder);
  assert.deepEqual(min.subject, max.subject);
});

test('the four subjects are the content blobs of the calculator, with both digests over the same bytes (ADR-015)', () => {
  const { guest, view, model, capabilities } = ref.resolved;
  assert.deepEqual(
    min.subject.map((s) => s.name),
    ['core-wasm/prism_calculator_core_wasm.wasm', PROVENANCE.SUBJECTS.VIEW, PROVENANCE.SUBJECTS.MODEL, PROVENANCE.SUBJECTS.CAPABILITIES],
  );
  [guest, view, model, capabilities].forEach((blob, i) => {
    assert.deepEqual(min.subject[i].digest, { blake3: blake3Hex(blob.content), sha256: sha256(blob.content) });
    assert.equal(`blake3:${min.subject[i].digest.blake3}`, blob.label);
  });
  for (const s of min.subject) {
    assert.notEqual(s.digest.blake3, ref.parsed.footer, 'a subject never names the footer');
    assert.notEqual(s.digest.sha256, ref.sha256, 'a subject never names the whole file');
  }
});

test('resolvedDependencies is the lock: every row follows from a member of the sdk-lock/3 fixture', () => {
  const rows = new Map(min.predicate.buildDefinition.resolvedDependencies.map((r) => [r.name, r]));
  assert.deepEqual(rows.get('sdk-lock').digest, { blake3: blake3Hex(lockBytes), sha256: sha256(lockBytes) });
  assert.equal(rows.get('sdk-lock').uri, PROVENANCE.DEPENDENCIES.LOCK);
  assert.equal(rows.get('sdk-lock').mediaType, PROVENANCE.DEPENDENCIES.LOCK_MEDIA_TYPES[lock.schema]);
  assert.equal(rows.get('sdk-image').uri, lock.sdk_image);
  assert.equal(`sha256:${rows.get('sdk-image').digest.sha256}`, lock.sdk_image.slice(lock.sdk_image.indexOf('@') + 1));
  assert.equal(`sha256:${rows.get('standards-lock').digest.sha256}`, lock.standards_lock);
  assert.deepEqual(rows.get('world').digest, { blake3: lock.inputs.world.blake3, sha256: lock.inputs.world.sha256 });
  assert.equal(rows.get('world').uri, lock.inputs.world.contract);
  for (const [tool, version] of Object.entries(lock.inputs.toolchain)) {
    const name = tool.replaceAll('_', '-');
    assert.equal(rows.get(name).uri, `${PROVENANCE.DEPENDENCIES.TOOLCHAIN}${name}:${version}`);
  }
  assert.equal(rows.get('application-generator').digest.sha256, lock.inputs.generation.application_generator_sha256);
  assert.equal(rows.get('library-generator').digest.sha256, lock.inputs.generation.library_generator_sha256);
  // The model and the spec are the build's external parameters, not dependencies, so each appears once.
  assert.deepEqual(min.predicate.buildDefinition.externalParameters, { model: lock.inputs.model, spec: lock.inputs.spec });
  assert.equal(min.predicate.runDetails.builder.id, lock.sdk_image);
  assert.equal(rows.size, min.predicate.buildDefinition.resolvedDependencies.length, 'row names are unique');
});

test('the fixtures are what prism-code generates from the calculator and the lock fixture', async () => {
  const bytes = new Uint8Array(ref.bytes);
  assert.deepEqual(await provenance.provenanceStatement(bytes, { lock: lockBytes }), min);
  assert.deepEqual(
    await provenance.provenanceStatement(bytes, {
      lock: lockBytes,
      mode: 'max',
      arguments: ['build', '--provenance=max', '--model', 'prismpm.toml'],
      platform: 'linux/amd64',
      invocationId: 'urn:prismpm:invocation:0f1e2d3c',
      startedOn: '2026-10-25T14:00:00Z',
      finishedOn: '2026-10-25T14:03:12Z',
    }),
    max,
  );
});

test('the unsigned bundle fixture is the bundle prism-code writes for the min statement', () => {
  const bundle = readJson('fixtures/attestation/sigstore-bundle/provenance-unsigned.json');
  assert.deepEqual(JSON.parse(Buffer.from(provenance.provenanceBundle(min)).toString('utf8')), bundle);
  assert.deepEqual(Buffer.from(bundle.dsseEnvelope.payload, 'base64'), Buffer.from(provenance.statementBytes(min)));
  assert.deepEqual(bundle.dsseEnvelope.signatures, [{ sig: PROVENANCE.UNSIGNED.SIGNATURE }]);
  assert.deepEqual(bundle.verificationMaterial, { publicKey: {} });
});
