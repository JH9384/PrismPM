// Every schema in the package is checked by walking its directories. Nothing here, and nothing in the
// package, lists a schema file: adding a schema means adding the schema and its fixture.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { discover, pascal } from '../scripts/discover.mjs';
import { spec } from './spec.mjs';
import { assertSupported, validate } from './json-schema.mjs';
import { fixtureProblems } from './fixtures.mjs';
import { here, loadReference, readJson, schema } from './reference.mjs';

const { ATTESTATION, HOLO_SCHEMAS, PROOF_PREDICATE_TYPE, SCHEMAS } = spec;

const ref = loadReference();
const found = discover();
const REPO_SCHEMAS = here('../../../../schemas/');

test('every schema is draft 2020-12, uses only supported keywords and has a unique $id', () => {
  assert.ok(found.schemas.length >= 20, 'schemas were found');
  const ids = new Set();
  for (const { path, schema: s } of found.schemas) {
    assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema', path);
    assert.doesNotThrow(() => assertSupported(s), path);
    assert.ok(typeof s.$id === 'string' && !ids.has(s.$id), `${path} $id`);
    ids.add(s.$id);
  }
});

test('a document schema equal to a repository schema, by $id or by name, is a byte-for-byte copy of it', () => {
  // schemas/model-document.schema.json is the /1 schema; /N is schemas/model-document-vN.schema.json.
  const repo = new Map(readdirSync(REPO_SCHEMAS).filter((f) => f.endsWith('.schema.json')).map((f) => [f, readFileSync(join(REPO_SCHEMAS, f))]));
  const ids = new Map([...repo].map(([name, bytes]) => [JSON.parse(bytes).$id, name]));
  let copies = 0;
  for (const doc of found.documents) {
    const names = new Set([ids.get(doc.id), doc.version === 1 ? `${doc.family}.schema.json` : `${doc.family}-v${doc.version}.schema.json`].filter((n) => repo.has(n)));
    for (const name of names) {
      copies++;
      assert.ok(readFileSync(here(`../${doc.path}`)).equals(repo.get(name)), `${doc.path} differs from schemas/${name}`);
    }
  }
  assert.ok(copies >= 9, 'the model document and lock schemas were compared');
});

test('each document schema fixes the `schema` member it is registered under, and every document is registered', () => {
  assert.deepEqual(Object.keys(SCHEMAS).sort(), found.documents.map((d) => d.name).sort());
  for (const [name, path] of Object.entries(SCHEMAS)) {
    assert.equal(schema(path).properties.schema.const, name, path);
  }
  assert.deepEqual(Object.values(HOLO_SCHEMAS).sort(), found.holo.map((h) => h.path).sort());
});

test('the generated predicate registry validates, and each row has its type file, constant and schema', () => {
  const registry = readJson('../predicates/registry.json');
  assert.deepEqual(validate(schema('predicates/registry.schema.json'), registry), []);
  assert.deepEqual(registry.predicates.map((p) => p.predicateType), found.predicates.map((p) => p.predicateType));
  assert.ok(registry.predicates.length >= 2);
  for (const row of registry.predicates) {
    assert.equal(row.status === 'placeholder', row.schema === null, row.predicateType);
    const p = found.predicates.find((x) => x.predicateType === row.predicateType);
    assert.equal(spec[p.constant], row.predicateType, `${p.constant} is exported`);
    const types = readFileSync(here(`../${p.types}`), 'utf8');
    assert.ok(types.includes(`export declare const ${p.constant}: '${row.predicateType}'`), `${p.types} declares ${p.constant}`);
    assert.ok(new RegExp(String.raw`export (?:type|interface) ${pascal(p.name)}PredicateV${p.version}\b`).test(types), `${p.types} declares the predicate type`);
    if (row.schema) assert.equal(schema(row.schema).$id, `${row.predicateType}/schema.json`, row.schema);
  }
});

// The rule is in fixtures.mjs: a schema without a fixture, or with an invalid one, fails here by name.
for (const record of found.schemas) {
  test(`fixtures of ${record.path}`, () => {
    if (record.path === 'predicates/registry.schema.json') {
      assert.deepEqual(validate(record.schema, readJson('../predicates/registry.json')), []);
      return;
    }
    assert.deepEqual(fixtureProblems(record), []);
  });
}

test('the calculator fixtures of the holo schemas are what the reference archive decodes to', () => {
  const same = (path, value) => assert.deepEqual(readJson(path), value, path);
  same('fixtures/holo/archive/calculator.json', ref.archive);
  same('fixtures/holo/app-manifest/calculator.json', ref.appManifest);
  same('fixtures/holo/source-manifest/calculator.json', ref.sourceManifest);
  same('fixtures/holo/application-directory/calculator.json', ref.directory);
  same('fixtures/documents/model-provenance-v1/calculator.json', ref.provenance);
  same('fixtures/documents/model-document-v1/calculator.json', ref.modelDocument);
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

  const build = readJson('fixtures/documents/build-manifest-v1/calculator.json');
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
