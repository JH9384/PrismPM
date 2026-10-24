// The error hierarchy (#276): one class per failure kind, a stable code per class, and the map from a verdict's reasons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PrismError,
  PrismCodeError,
  VerificationError,
  ProofMismatchError,
  CapabilityDeniedError,
  DeterminismViolationError,
  ReplayError,
  ERROR_CLASSES,
  classForCheck,
  errorForReason,
  errorFromVerdict,
} from '../src/index.mjs';

const RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

test('every class is a PrismError with its own stable code', () => {
  const classes = [VerificationError, ProofMismatchError, CapabilityDeniedError, DeterminismViolationError, ReplayError];
  const codes = classes.map((C) => C.code);
  assert.deepEqual(codes, ['verification_failed', 'proof_mismatch', 'capability_denied', 'determinism_violation', 'replay_failed']);
  assert.equal(new Set(codes).size, codes.length);
  for (const C of classes) {
    const error = new C('message');
    assert.ok(error instanceof PrismError && error instanceof Error);
    assert.equal(error.code, C.code);
    assert.equal(error.name, C.name);
    assert.equal(ERROR_CLASSES[C.code], C);
  }
  assert.equal(new PrismError('x').code, 'prism_error');
});

test('PrismCodeError keeps its code-first signature and is a PrismError', () => {
  const error = new PrismCodeError('archive.magic', 'not a holo', { at: 0 });
  assert.ok(error instanceof PrismError);
  assert.equal(error.name, 'PrismCodeError');
  assert.equal(error.code, 'archive.magic');
  assert.deepEqual(error.details, { at: 0 });
});

test('a check id maps to one class', () => {
  const expected = {
    'holo.integrity': VerificationError,
    'holo.documents': VerificationError,
    'provenance.statement': VerificationError,
    'policy.level': VerificationError,
    'policy.digests.guest': VerificationError,
    'proof.statement': ProofMismatchError,
    'proof.subject': ProofMismatchError,
    'world.capabilities': CapabilityDeniedError,
    'replay.divergence': DeterminismViolationError,
    'replay.statement': ReplayError,
    'replay.history': ReplayError,
  };
  for (const [check, Class] of Object.entries(expected)) assert.equal(classForCheck(check), Class, check);
});

test('an error for a reason carries the check, the diagnostic and the verdict', () => {
  const reason = { check: 'world.capabilities', code: 'PP5602', withholds: 'P3', message: 'The world asks for a socket.' };
  const verdict = { passed: false, policy: { minimum: 'P3' }, reasons: [reason] };
  const error = errorForReason(reason, verdict);
  assert.ok(error instanceof CapabilityDeniedError);
  assert.equal(error.code, 'capability_denied');
  assert.equal(error.check, 'world.capabilities');
  assert.equal(error.diagnostic, 'PP5602');
  assert.equal(error.message, reason.message);
  assert.equal(error.verdict, verdict);
  assert.deepEqual(error.reasons, [reason]);
});

test('a failed verdict is explained by the reason that kept the level down', () => {
  const reasons = [
    { check: 'provenance.statement', withholds: 'P1', message: 'No provenance.' },
    { check: 'proof.subject', code: 'PP5503', withholds: 'P2', message: 'The proof is about another guest.' },
    { check: 'replay.divergence', withholds: 'P3', message: 'Output differs.' },
    { check: 'policy.level', code: 'PP5601', withholds: null, message: 'Level P0, policy P2.' },
  ];
  const at = (minimum) => errorFromVerdict({ passed: false, level: 'P0', policy: { minimum }, reasons }, RANK);
  assert.ok(at('P2') instanceof VerificationError);
  assert.equal(at('P2').check, 'provenance.statement');
  assert.equal(at('P2').reasons.length, 4);
  // Only the reasons that withhold a level up to the minimum can explain the failure.
  const proofOnly = { passed: false, level: 'P1', policy: { minimum: 'P2' }, reasons: reasons.slice(1) };
  assert.ok(errorFromVerdict(proofOnly, RANK) instanceof ProofMismatchError);
  assert.equal(errorFromVerdict(proofOnly, RANK).diagnostic, 'PP5503');
  const replayOnly = { passed: false, level: 'P2', policy: { minimum: 'P3' }, reasons: [reasons[2], reasons[3]] };
  assert.ok(errorFromVerdict(replayOnly, RANK) instanceof DeterminismViolationError);
});

test('a digest the policy pins is a verification error, and a passed verdict is none', () => {
  const pinned = { check: 'policy.digests.guest', withholds: null, message: 'The guest does not match the policy.' };
  const failed = { passed: false, level: 'P3', policy: { minimum: 'P0' }, reasons: [pinned] };
  const error = errorFromVerdict(failed, RANK);
  assert.ok(error instanceof VerificationError);
  assert.equal(error.check, 'policy.digests.guest');
  assert.equal(errorFromVerdict({ passed: true, level: 'P3', policy: { minimum: 'P0' }, reasons: [] }, RANK), null);
});
