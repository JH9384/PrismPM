/**
 * Every error the package throws is a `PrismError`. Each failure kind has its
 * own subclass with a stable `code`, so a caller branches on the class or the
 * code and never parses a message.
 *
 * - `PrismCodeError`: load, dispatch and archive failures. Its `code` names
 *   the check that failed (`archive.magic`, `core.exports`, `closure.provenance`, ...).
 * - `VerificationError`: no verdict could be reached, or the holo failed a
 *   check that is about the archive itself, its documents or its provenance.
 * - `ProofMismatchError`: a `proof.*` check of a verdict failed.
 * - `CapabilityDeniedError`: the declared world exceeds the granted capabilities.
 * - `DeterminismViolationError`: a replay diverged from its recorded history.
 * - `ReplayError`: a replay could not be carried out or its statement failed.
 *
 * The last four map one-to-one to the check ids of a `prism/verdict/1`
 * reason (docs/proposals/269-assurance-levels.md); `errorForReason` is the map.
 */
export class PrismError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, check?: string, diagnostic?: string, details?: unknown, verdict?: object, reasons?: object[], cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? new.target.code;
    if (options.check !== undefined) this.check = options.check;
    if (options.diagnostic !== undefined) this.diagnostic = options.diagnostic;
    if (options.details !== undefined) this.details = options.details;
    if (options.verdict !== undefined) this.verdict = options.verdict;
    if (options.reasons !== undefined) this.reasons = options.reasons;
  }
}
PrismError.code = 'prism_error';

/**
 * One error type for load, dispatch and archive failures. `code` names the
 * check that failed (`archive.magic`, `core.exports`, `closure.provenance`, ...).
 */
export class PrismCodeError extends PrismError {
  constructor(code, message, details = undefined) {
    super(message, { code, details });
  }
}

/** No verdict was reached, or an archive, document or provenance check failed. `check` names it. */
export class VerificationError extends PrismError {}
VerificationError.code = 'verification_failed';

/** A `proof.*` check failed: the proof statement is absent, malformed, or does not belong to this holo. */
export class ProofMismatchError extends PrismError {}
ProofMismatchError.code = 'proof_mismatch';

/** The world the holo declares exceeds the capabilities granted to it. */
export class CapabilityDeniedError extends PrismError {}
CapabilityDeniedError.code = 'capability_denied';

/** A replay produced output that differs from the recorded history. */
export class DeterminismViolationError extends PrismError {}
DeterminismViolationError.code = 'determinism_violation';

/** A replay could not be carried out, or the holo's replay statement failed. */
export class ReplayError extends PrismError {}
ReplayError.code = 'replay_failed';

/** Every class with a code of its own, by code. */
export const ERROR_CLASSES = Object.freeze({
  [VerificationError.code]: VerificationError,
  [ProofMismatchError.code]: ProofMismatchError,
  [CapabilityDeniedError.code]: CapabilityDeniedError,
  [DeterminismViolationError.code]: DeterminismViolationError,
  [ReplayError.code]: ReplayError,
});

/**
 * The class a verdict reason maps to, by its check id. `replay.divergence` is
 * the one replay check that is a determinism violation; every other `replay.*`
 * check is a replay error. Anything else, `holo.*`, `provenance.*` and
 * `policy.*`, is a verification error.
 */
export function classForCheck(check) {
  if (check.startsWith('proof.')) return ProofMismatchError;
  if (check === 'world.capabilities') return CapabilityDeniedError;
  if (check === 'replay.divergence') return DeterminismViolationError;
  if (check.startsWith('replay.')) return ReplayError;
  return VerificationError;
}

/** The typed error for one reason of a verdict, carrying the reason's check id and diagnostic code. */
export function errorForReason(reason, verdict = undefined) {
  const Class = classForCheck(reason.check);
  return new Class(reason.message, {
    check: reason.check,
    diagnostic: reason.code,
    verdict,
    reasons: verdict ? verdict.reasons : [reason],
  });
}

/**
 * The error that explains a failed verdict, or null for one that passed. When
 * the level is below the policy's minimum, it is the first reason that
 * withholds a level up to the minimum, which is what kept the holo down;
 * otherwise it is the first reason (a pinned digest that differs). The error
 * carries the whole verdict and every reason.
 */
export function errorFromVerdict(verdict, ranks) {
  if (verdict.passed) return null;
  const minimum = ranks[verdict.policy.minimum];
  const blocking = verdict.reasons.find((r) => r.withholds && ranks[r.withholds] <= minimum);
  const reason = blocking ?? verdict.reasons.find((r) => r.check !== 'policy.level') ?? verdict.reasons[0];
  return errorForReason(reason, verdict);
}

export function fail(code, message, details) {
  throw new PrismCodeError(code, message, details);
}
