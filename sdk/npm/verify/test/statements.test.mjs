// The proof statement checks (issue #266, src/statements.mjs) against the reference archive and the spec's
// calculator statement: the statement supports P2, and each damage fails exactly its own check id.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { checkProofStatement, PROOF_CODES, TCB_COMPONENTS } from '../src/statements.mjs';
import { here, reference, table, ADR_015 } from './helpers.mjs';

const STATEMENT = JSON.parse(readFileSync(here('../../spec/test/fixtures/attestation/statement/calculator.json'), 'utf8'));
const SIGNED = { verified: true };

/** The reference archive's model provenance extension, decoded. */
function referenceProvenance() {
  const bytes = reference();
  const decoder = new TextDecoder();
  for (const row of table(bytes)) {
    if (row.kind !== 14) continue;
    const body = bytes.subarray(row.offset, row.offset + row.length);
    const nameLength = body[0] | (body[1] << 8);
    if (decoder.decode(body.subarray(2, 2 + nameLength)) === 'https://uor.foundation/extension/prismpm-model/v1') return JSON.parse(decoder.decode(body.subarray(2 + nameLength)));
  }
  throw new Error('the reference archive has no model provenance');
}

const HOLO = Object.freeze({ guest: ADR_015.guest, model: ADR_015.model, provenance: referenceProvenance() });
const statement = (edit = () => {}) => {
  const copy = structuredClone(STATEMENT);
  edit(copy);
  return copy;
};
const checks = (reasons) => reasons.map((r) => r.check);

test('the calculator statement supports P2 for the reference archive', () => {
  assert.deepEqual(checkProofStatement(STATEMENT, HOLO, SIGNED), []);
});

test('a tampered guest fails proof.subject with PP5503, the ProofMismatch of #270', () => {
  const tampered = { ...HOLO, guest: { sha256: 'f'.repeat(64), blake3: 'e'.repeat(64) } };
  const reasons = checkProofStatement(STATEMENT, tampered, SIGNED);
  assert.deepEqual(checks(reasons), ['proof.subject']);
  assert.deepEqual({ ...reasons[0], message: undefined }, { check: 'proof.subject', code: 'PP5503', withholds: 'P2', message: undefined });
  assert.match(reasons[0].message, /not this holo's guest/);
});

test('every check withholds P2 and has its own diagnostic', () => {
  const unsigned = checkProofStatement(STATEMENT, HOLO, { verified: false, message: 'The signature is not valid.' });
  assert.deepEqual(unsigned, [{ check: 'proof.envelope', code: 'PP5501', withholds: 'P2', message: 'The signature is not valid.' }]);
  assert.deepEqual(Object.values(PROOF_CODES), ['PP5501', 'PP5502', 'PP5503', 'PP5504', 'PP5505', 'PP5506', 'PP5507']);
});

test('a statement of the wrong shape fails proof.statement and nothing after it', () => {
  const cases = [
    (s) => (s.predicateType = 'https://slsa.dev/provenance/v1'),
    (s) => (s._type = 'https://in-toto.io/Statement/v0.1'),
    (s) => s.subject.push(s.subject[0]),
    (s) => (s.predicate.verifiedLevels = ['P3']),
    (s) => delete s.predicate.tcb,
    (s) => (s.predicate.tcb[0].trust = 'verified'),
  ];
  for (const edit of cases) {
    const reasons = checkProofStatement(statement(edit), { ...HOLO, guest: null }, SIGNED);
    assert.deepEqual(checks(reasons), ['proof.statement'], edit.toString());
    assert.equal(reasons[0].code, 'PP5502');
  }
});

test('a statement about another model fails proof.model', () => {
  for (const edit of [(s) => (s.predicate.model.snapshotId = '0'.repeat(64)), (s) => (s.predicate.model.document.blake3 = '0'.repeat(64))]) {
    assert.deepEqual(checks(checkProofStatement(statement(edit), HOLO, SIGNED)), ['proof.model']);
  }
  const otherExtension = { ...HOLO, provenance: { ...HOLO.provenance, compiler_semantics_id: '1'.repeat(64) } };
  assert.deepEqual(checks(checkProofStatement(STATEMENT, otherExtension, SIGNED)), ['proof.model']);
});

test('the verifier pins are compared only with a lock', () => {
  const image = STATEMENT.predicate.verifier.sdkImage;
  assert.deepEqual(checkProofStatement(STATEMENT, { ...HOLO, lock: { sdkImage: image, lean: 'v4.32.1' } }, SIGNED), []);
  const other = checkProofStatement(STATEMENT, { ...HOLO, lock: { sdkImage: image.replace(/0{64}$/, '1'.repeat(64)) } }, SIGNED);
  assert.deepEqual(checks(other), ['proof.verifier']);
  assert.equal(other[0].code, 'PP5505');
});

test('a failed verdict or an axiom outside its policy fails proof.verdict', () => {
  const failed = (s) => {
    s.predicate.verificationResult = 'FAILED';
    s.predicate.theorems[0].verdict = 'FAILED';
  };
  const reasons = checkProofStatement(statement(failed), HOLO, SIGNED);
  assert.deepEqual(checks(reasons), ['proof.verdict']);
  assert.match(reasons[0].message, /verificationResult is FAILED; PrismCalculator\.Calculator\.addCorrect is FAILED/);
  const axiom = (s) => (s.predicate.theorems[1].axioms.observed = ['Classical.choice']);
  assert.match(checkProofStatement(statement(axiom), HOLO, SIGNED)[0].message, /subtractCorrect uses axioms outside its policy/);
});

test('a TCB without one of the seven components fails proof.tcb', () => {
  assert.deepEqual(STATEMENT.predicate.tcb.map((e) => e.component), TCB_COMPONENTS);
  const reasons = checkProofStatement(statement((s) => s.predicate.tcb.splice(1, 1)), HOLO, SIGNED);
  assert.deepEqual(checks(reasons), ['proof.tcb']);
  assert.match(reasons[0].message, /lacks leanchecker/);
});

// verify() with statements (#270): the caller hands in decoded statements and the outcome of their signature check.
import { verify } from '../src/index.mjs';
import { checkProvenanceStatement } from '../src/statements.mjs';

const provenanceOf = (subject) => ({ _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1', subject: [{ name: 'guest', digest: subject }], predicate: {} });

test('verify reaches P2 from a verified provenance statement and a verified proof statement, and no lower than they allow', async () => {
  const provenance = provenanceOf(ADR_015.guest);
  const statements = (envelope, proof = STATEMENT) => ({ provenance: { statement: provenance, envelope }, proof: { statement: proof, envelope } });
  const passed = await verify(reference(), { statements: statements(SIGNED) });
  assert.deepEqual([passed.level, passed.passed], ['P2', true]);
  assert.deepEqual(checks(passed.reasons), ['replay.statement']);

  const unverified = await verify(reference(), { statements: statements({ verified: false }) });
  assert.equal(unverified.level, 'P0');
  assert.deepEqual(checks(unverified.reasons), ['provenance.envelope', 'proof.envelope', 'replay.statement', 'policy.level']);

  const other = statement((s) => (s.subject[0].digest.blake3 = 'e'.repeat(64)));
  const mismatch = await verify(reference(), { statements: statements(SIGNED, other) });
  assert.equal(mismatch.level, 'P1');
  assert.deepEqual(checks(mismatch.reasons), ['proof.subject', 'replay.statement', 'policy.level']);
  assert.equal(mismatch.reasons[0].code, 'PP5503');
});

test('the policy input shows a statement as verified only when its envelope was', async () => {
  const { policyInput } = await import('../src/index.mjs');
  const proof = { statement: STATEMENT, envelope: SIGNED };
  const input = await policyInput(reference(), { statements: { proof } });
  assert.deepEqual([input.predicates.proof.verified, input.predicates.provenance], [true, null]);
  const unsigned = await policyInput(reference(), { statements: { proof: { ...proof, envelope: { verified: false } } } });
  assert.equal(unsigned.predicates.proof.verified, false);
});

test('statements that are not { statement, envelope } are an invalid policy, not a pass', async () => {
  for (const statements of [[], { replay: {} }, { proof: { statement: STATEMENT } }, { proof: { statement: STATEMENT, envelope: { verified: 'yes' } } }]) {
    await assert.rejects(verify(reference(), { statements }), (error) => error.code === 'policy.invalid');
  }
});

test('a provenance statement fails provenance.subject when a subject is not a blob of the holo, or is the wrong shape', () => {
  const holo = { blobs: [{ digests: ADR_015.guest }] };
  assert.deepEqual(checkProvenanceStatement(provenanceOf(ADR_015.guest), holo, SIGNED), []);
  const wrongBlob = checkProvenanceStatement(provenanceOf({ ...ADR_015.guest, sha256: '0'.repeat(64) }), holo, SIGNED);
  assert.deepEqual(wrongBlob.map((r) => [r.check, r.withholds]), [['provenance.subject', 'P1']]);
  const wrongType = checkProvenanceStatement({ ...provenanceOf(ADR_015.guest), predicateType: 'https://example.org/x' }, holo, SIGNED);
  assert.deepEqual(wrongType.map((r) => r.check), ['provenance.subject']);
  assert.deepEqual(checkProvenanceStatement(provenanceOf(ADR_015.guest), holo, { verified: false }).map((r) => r.check), ['provenance.envelope']);
});
