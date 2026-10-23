// The proof predicate prism/proof/v1 (#266): the calculator statement validates, agrees with the reference archive,
// and the schema rejects what docs/proposals/266-proof-predicate.md forbids.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ATTESTATION, PROOF_PREDICATE_TYPE } from '../index.mjs';
import { validate } from './json-schema.mjs';
import { here, loadReference, readJson, schema } from './reference.mjs';

const PROOF_SCHEMA = 'predicates/proof-v1.schema.json';
const ref = loadReference();
const build = readJson('fixtures/calculator-build-manifest.json');
const fixture = readJson('fixtures/proof/calculator.statement.json');
const copy = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const unlabel = (label) => label.slice('blake3:'.length);

const statementErrors = (statement) => validate(schema(ATTESTATION.STATEMENT_SCHEMA), statement);
const predicateErrors = (predicate) => validate(schema(PROOF_SCHEMA), predicate);
const rejects = (predicate, why) => assert.notDeepEqual(predicateErrors(predicate), [], `${PROOF_SCHEMA} accepted ${why}`);

/** The offline `proof.subject` check: the one subject is the guest blob, by both digests and its build-manifest row. */
function subjectAgrees(statement) {
  if (statement.subject.length !== 1) return false;
  const [{ name, digest }] = statement.subject;
  const row = build.files.find((file) => file.path === name && file.kind === 'artifact');
  return (
    digest.blake3 === unlabel(ref.resolved.guest.label) &&
    digest.sha256 === sha256(ref.guest) &&
    row !== undefined &&
    row.sha256 === digest.sha256
  );
}

test('the schema $id is the reserved one and the registry row points at it', () => {
  assert.equal(schema(PROOF_SCHEMA).$id, `${PROOF_PREDICATE_TYPE}/schema.json`);
  const row = readJson('../predicates/registry.json').predicates.find((p) => p.predicateType === PROOF_PREDICATE_TYPE);
  assert.deepEqual({ status: row.status, schema: row.schema }, { status: 'experimental', schema: PROOF_SCHEMA });
});

test('the calculator statement validates as a statement and as a proof predicate', () => {
  assert.deepEqual(statementErrors(fixture), []);
  assert.equal(fixture.predicateType, PROOF_PREDICATE_TYPE);
  assert.equal(fixture.subject.length, 1);
  assert.deepEqual(predicateErrors(fixture.predicate), []);
});

test('the calculator statement agrees with the reference archive and its build manifest', () => {
  assert.ok(subjectAgrees(fixture), 'subject is the guest blob');
  const { model, verifier, tcb } = fixture.predicate;
  const { provenance } = ref;
  assert.equal(model.document.sha256, provenance.model_id);
  assert.equal(model.document.sha256, sha256(ref.resolved.model.content));
  assert.equal(model.document.blake3, unlabel(provenance.model_content_kappa));
  assert.equal(model.document.blake3, unlabel(ref.resolved.model.label));
  const ids = ref.modelDocument.provenance;
  assert.deepEqual(
    [model.sourceId, model.semanticId, model.snapshotId, model.compilerSemanticsId],
    [ids.source_id, ids.semantic_id, ids.snapshot_id, ids.compiler_semantics_id],
  );
  assert.equal(model.snapshotId, provenance.snapshot_id);
  assert.equal(fixture.predicate.policy.digest.sha256, model.snapshotId);
  assert.equal(model.leanManifestSha256, provenance.lean_manifest_sha256);
  const lean = build.files.filter((file) => file.kind === 'lean');
  assert.deepEqual(model.modules.map((m) => m.leanSha256), lean.map((file) => file.sha256));
  assert.equal(verifier.lexlean.commit, provenance.lexlean_commit);
  assert.equal(verifier.lexlean.crateSha256, provenance.lexlean_package_sha256);
  assert.equal(tcb.find((entry) => entry.component === 'lean4-prod').version, provenance.lean4_prod_commit);
});

test('a tampered subject is well formed but fails the subject check; a malformed one fails the schema', () => {
  const tampered = copy(fixture);
  const hex = tampered.subject[0].digest.sha256;
  tampered.subject[0].digest.sha256 = (hex[0] === '0' ? '1' : '0') + hex.slice(1);
  assert.deepEqual(statementErrors(tampered), []);
  assert.equal(subjectAgrees(tampered), false);

  const relabeled = copy(fixture);
  relabeled.subject[0].digest.blake3 = ref.parsed.footer;
  assert.equal(subjectAgrees(relabeled), false, 'the archive footer is not the guest blob');

  const prefixed = copy(fixture);
  prefixed.subject[0].digest.sha256 = `sha256:${hex}`;
  assert.notDeepEqual(statementErrors(prefixed), []);
  const upper = copy(fixture);
  upper.subject[0].digest.blake3 = upper.subject[0].digest.blake3.toUpperCase();
  assert.notDeepEqual(statementErrors(upper), []);
});

test('negative controls: the proof schema rejects what the proposal forbids', () => {
  const p = fixture.predicate;
  const without = (key) => {
    const value = copy(p);
    delete value[key];
    return value;
  };
  for (const key of schema(PROOF_SCHEMA).required) rejects(without(key), `a predicate without ${key}`);
  rejects({ ...copy(p), extra: 1 }, 'an unknown member');
  rejects({ ...copy(p), tcb: [] }, 'an empty tcb');
  rejects({ ...copy(p), tcb: p.tcb.map((e, i) => (i === 0 ? { ...e, trust: 'verified' } : e)) }, 'a verified tcb entry');
  rejects({ ...copy(p), tcb: p.tcb.map((e, i) => (i === 0 ? { ...e, digest: `sha256:${e.digest}` } : e)) }, 'a prefixed tcb digest');
  rejects({ ...copy(p), theorems: [] }, 'no theorems');
  rejects({ ...copy(p), theorems: [{ ...p.theorems[0], verdict: 'ok' }] }, 'a verdict outside PASSED and FAILED');
  rejects({ ...copy(p), verificationResult: 'passed' }, 'a lowercase result');
  for (const levels of [[], ['P3'], ['P1'], ['P1', 'P2'], ['P2', 'P2'], 'P2']) {
    rejects({ ...copy(p), verifiedLevels: levels }, `verifiedLevels ${JSON.stringify(levels)}, not exactly ["P2"]`);
  }
  rejects({ ...copy(p), verifier: { ...p.verifier, id: 'lean4' } }, 'a bare verifier id');
  rejects({ ...copy(p), verifier: { ...p.verifier, sdkImage: 'ghcr.io/uor-foundation/prismpm:0.3.0' } }, 'an SDK image by tag');
  rejects({ ...copy(p), verifier: { ...p.verifier, lean: { ...p.verifier.lean, commit: 'main' } } }, 'a branch for a commit');
  rejects({ ...copy(p), model: { ...p.model, document: { sha256: p.model.document.sha256 } } }, 'a model document without blake3');
  rejects({ ...copy(p), model: { ...p.model, modules: [] } }, 'no modules');
  rejects({ ...copy(p), timeVerified: '2026-10-23T00:00:00+02:00' }, 'a non-UTC time');

  const failed = copy(p);
  failed.verificationResult = 'FAILED';
  failed.theorems[0].verdict = 'FAILED';
  assert.deepEqual(predicateErrors(failed), [], 'a FAILED statement is well formed; the verdict check rejects it');
});

test('the PrismDigestSet definition equals the statement schema', () => {
  assert.deepEqual(schema(PROOF_SCHEMA).$defs.PrismDigestSet, schema(ATTESTATION.STATEMENT_SCHEMA).$defs.PrismDigestSet);
});

/**
 * Every member of every object in the schema, as `name` when required and `name?` when optional.
 * PrismDigestSet is imported from types/attestation.d.ts, not redeclared, so it is not walked.
 */
function schemaMembers(root) {
  const members = new Set();
  const walk = (node) => {
    if (node.$ref === '#/$defs/PrismDigestSet') return;
    if (node.$ref) return walk(root.$defs[node.$ref.slice('#/$defs/'.length)]);
    if (node.items) walk(node.items);
    for (const [name, inner] of Object.entries(node.properties ?? {})) {
      members.add((node.required ?? []).includes(name) ? name : `${name}?`);
      walk(inner);
    }
  };
  walk(root);
  return members;
}

test('the ProofPredicateV1 type and the schema declare the same members', () => {
  const source = readFileSync(here('../predicates/proof-v1.d.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/export interface ProofStatementV1 \{[\s\S]*?\n\}/, '')
    .replace(/^(import|export declare const) .*$/gm, '')
    .replace(/'[^']*'/g, "''");
  const typed = new Set([...source.matchAll(/([A-Za-z_][A-Za-z0-9_]*)(\??):/g)].map((m) => m[1] + m[2]));
  assert.deepEqual([...typed].sort(), [...schemaMembers(schema(PROOF_SCHEMA))].sort());
});
