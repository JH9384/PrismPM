// Every schema is well-formed, the repository copies have not drifted, and the schemas reject what they must.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { ATTESTATION, HOLO_SCHEMAS, PROOF_PREDICATE_TYPE, REPLAY_PREDICATE_TYPE, SCHEMAS } from '../index.mjs';
import { assertSupported, validate } from './json-schema.mjs';
import { here, loadReference, readJson, schema } from './reference.mjs';

const ref = loadReference();
const REGISTRY_SCHEMA = 'predicates/registry.schema.json';
const allSchemas = ['schemas', 'predicates']
  .flatMap((folder) =>
    readdirSync(here(`../${folder}/`), { recursive: true })
      .map((p) => `${folder}/${p.replaceAll('\\', '/')}`)
      .filter((p) => p.endsWith('.schema.json')),
  )
  .sort();

/** Package copies of the repository's schemas/ folder, registered in model/contracts.toml. */
const COPIES = {
  'schemas/documents/model-document-v1.schema.json': 'model-document.schema.json',
  'schemas/documents/model-document-v2.schema.json': 'model-document-v2.schema.json',
  'schemas/documents/model-document-v3.schema.json': 'model-document-v3.schema.json',
  'schemas/documents/model-document-v4.schema.json': 'model-document-v4.schema.json',
  'schemas/documents/model-document-v5.schema.json': 'model-document-v5.schema.json',
  'schemas/documents/model-document-v6.schema.json': 'model-document-v6.schema.json',
  'schemas/documents/sdk-lock-v1.schema.json': 'sdk-lock.schema.json',
  'schemas/documents/sdk-lock-v2.schema.json': 'sdk-lock-v2.schema.json',
  'schemas/documents/sdk-lock-v3.schema.json': 'sdk-lock-v3.schema.json',
};

test('every schema is draft 2020-12, uses only supported keywords and has a unique $id', () => {
  const ids = new Set();
  for (const path of allSchemas) {
    const s = schema(path);
    assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema', path);
    assert.doesNotThrow(() => assertSupported(s), path);
    assert.ok(typeof s.$id === 'string' && !ids.has(s.$id), `${path} $id`);
    ids.add(s.$id);
  }
});

test('the copied schemas equal the repository schemas byte for byte', () => {
  for (const [copy, source] of Object.entries(COPIES)) {
    const a = readFileSync(here(`../${copy}`));
    const b = readFileSync(here(`../../../../schemas/${source}`));
    assert.ok(a.equals(b), `${copy} differs from schemas/${source}`);
  }
});

test('every schema file is reachable from the package constants or the registry', () => {
  const named = new Set([
    ...Object.values(SCHEMAS),
    ...Object.values(HOLO_SCHEMAS),
    ATTESTATION.STATEMENT_SCHEMA,
    ATTESTATION.ENVELOPE_SCHEMA,
    REGISTRY_SCHEMA,
    ...readJson('../predicates/registry.json').predicates.map((p) => p.schema).filter(Boolean),
  ]);
  assert.deepEqual([...named].sort(), allSchemas);
});

test('each document schema fixes the `schema` member it is registered under', () => {
  for (const [name, path] of Object.entries(SCHEMAS)) {
    assert.equal(schema(path).properties.schema.const, name, path);
  }
});

test('the predicate registry validates, lists exactly the predicate constants and has a type file per row', () => {
  const registry = readJson('../predicates/registry.json');
  assert.deepEqual(validate(schema(REGISTRY_SCHEMA), registry), []);
  assert.deepEqual(registry.predicates.map((p) => p.predicateType), [PROOF_PREDICATE_TYPE, REPLAY_PREDICATE_TYPE]);
  for (const row of registry.predicates) {
    assert.equal(row.status === 'placeholder', row.schema === null, row.predicateType);
    const [, name, version] = /\/prism\/([a-z][a-z0-9-]*)\/(v[0-9]+)$/.exec(row.predicateType);
    const types = readFileSync(here(`../predicates/${name}-${version}.d.ts`), 'utf8');
    assert.ok(types.includes(`'${row.predicateType}'`), `predicates/${name}-${version}.d.ts names ${row.predicateType}`);
  }
});

const rejects = (path, value, why) => assert.notDeepEqual(validate(schema(path), value), [], `${path} accepted ${why}`);
const copy = (value) => JSON.parse(JSON.stringify(value));

test('negative controls: each schema rejects a mutated reference value', () => {
  const archive = copy(ref.archive);
  [archive.sections[2], archive.sections[4]] = [archive.sections[4], archive.sections[2]];
  rejects(HOLO_SCHEMAS.ARCHIVE, archive, 'a reordered section table');
  rejects(HOLO_SCHEMAS.ARCHIVE, { ...ref.archive, version: 5 }, 'physical version 5');
  rejects(HOLO_SCHEMAS.ARCHIVE, { ...ref.archive, sections: ref.archive.sections.slice(0, 7) }, 'seven sections');

  rejects(HOLO_SCHEMAS.APP_MANIFEST, { ...ref.appManifest, labels: [...ref.appManifest.labels.slice(0, 2), 'sha256:00'] }, 'a non-blake3 label');
  rejects(HOLO_SCHEMAS.APP_MANIFEST, { ...ref.appManifest, suffix: '00' }, 'a different suffix');

  rejects(HOLO_SCHEMAS.SOURCE_MANIFEST, { ...ref.sourceManifest, version: 3 }, 'source manifest version 3');
  rejects(HOLO_SCHEMAS.APPLICATION_DIRECTORY, { ...ref.directory, children: [{}] }, 'a child application');

  const provenance = copy(ref.provenance);
  provenance.extra = 1;
  rejects(SCHEMAS['prismpm/model-provenance/1'], provenance, 'an unknown member');
  rejects(SCHEMAS['prismpm/model-provenance/1'], { ...ref.provenance, lexlean_commit: 'main' }, 'a branch name for a commit');
  rejects(SCHEMAS['prismpm/model-provenance/1'], { ...ref.provenance, view_binding: { tag: 'present' } }, 'a present binding without fields');

  rejects(SCHEMAS['prismpm/model-document/1'], { ...ref.modelDocument, schema: 'prismpm/model-document/2' }, 'the wrong schema name');
  const model = copy(ref.modelDocument);
  delete model.provenance;
  rejects(SCHEMAS['prismpm/model-document/1'], model, 'a missing provenance');
  const vectors = copy(ref.modelDocument);
  delete vectors.application.acceptance_vectors;
  rejects(SCHEMAS['prismpm/model-document/1'], vectors, 'an application without acceptance vectors');

  const build = readJson('fixtures/calculator-build-manifest.json');
  rejects(SCHEMAS['prismpm/build-manifest/1'], { ...build, files: [{ ...build.files[0], path: '../escape' }] }, 'a dot-dot path');
  rejects(SCHEMAS['prismpm/build-manifest/1'], { ...build, inputs: { ...build.inputs, schema: 'prismpm/build-inputs/2' } }, 'inputs /2 without the artifact binding');

  const guest = ref.resolved.guest.label.slice('blake3:'.length);
  const sha = 'dcf53677'.padEnd(64, '0');
  const statement = (subject) => ({ _type: ATTESTATION.STATEMENT_TYPE, subject, predicateType: PROOF_PREDICATE_TYPE, predicate: {} });
  const blob = (digest, name = 'core-wasm/guest.wasm') => [{ name, digest }];
  rejects(ATTESTATION.STATEMENT_SCHEMA, statement(blob({})), 'an empty PrismDigestSet');
  rejects(ATTESTATION.STATEMENT_SCHEMA, statement(blob({ blake3: guest })), 'a blob subject without sha256');
  rejects(ATTESTATION.STATEMENT_SCHEMA, statement(blob({ blake3: guest, sha256: sha, sha512: sha })), 'a third digest');
  rejects(ATTESTATION.STATEMENT_SCHEMA, statement(blob({ blake3: `blake3:${guest}`, sha256: sha })), 'a prefixed blake3 digest');
  rejects(ATTESTATION.STATEMENT_SCHEMA, statement(blob({ blake3: guest, sha256: sha }, 'oci-manifest')), 'a blob named oci-manifest');
  rejects(ATTESTATION.STATEMENT_SCHEMA, statement([{ name: 'oci-manifest', digest: { sha256: sha, blake3: guest } }]), 'blake3 on the OCI manifest');
  rejects(ATTESTATION.STATEMENT_SCHEMA, statement([]), 'no subject');
  rejects(ATTESTATION.ENVELOPE_SCHEMA, { payload: '', payloadType: 'text/plain', signatures: [{ sig: 'AA==' }] }, 'a foreign payload type');
});

test('the validator refuses keywords it does not implement', () => {
  assert.throws(() => validate({ patternProperties: {} }, {}), /unsupported keyword patternProperties/);
  assert.throws(() => validate({ properties: { a: { dependentRequired: {} } } }, {}), /unsupported keyword dependentRequired/);
});
