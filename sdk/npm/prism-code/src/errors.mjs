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
 * - `CapabilityDeniedError`: the declared world exceeds the granted capabilities,
 *   or the runtime denied a guest import or a resource (`capabilities.*`, issue #279).
 * - `WorldMismatchError`: the guest does not have the interface of the WIT world it declares,
 *   or the world is not the one the caller pinned (issue #278).
 * - `DeterminismViolationError`: a replay diverged from its recorded history.
 * - `ReplayError`: a replay could not be carried out or its statement failed.
 * - `SigningError`: `attest` could not produce a signature (#272).
 * - `SignatureInvalidError`, `IdentityMismatchError`, `TransparencyError`,
 *   `SubjectMismatchError`, `AttestationNotFoundError`, `TrustRootError`: the
 *   reasons `verify-attestation` can refuse a bundle (#272).
 * - `ProviderNotFoundError`, `ProviderReplyError`, `ProviderFailedError`: the
 *   ways running a provider service can fail (#294). `ProviderError` is their base.
 *
 * The last five map one-to-one to the check ids of a `prism/verdict/1`
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

/**
 * The world the holo declares exceeds the capabilities granted to it
 * (`world.capabilities`), or the runtime denied what the grant does not allow:
 * a guest import (`capabilities.import`) or a resource
 * (`capabilities.outbound-hosts`, `capabilities.key-value-stores`,
 * `capabilities.variables`). `details` names the import or resource and the set.
 */
export class CapabilityDeniedError extends PrismError {}
CapabilityDeniedError.code = 'capability_denied';

/**
 * The guest does not have the imports and exports of its declared world
 * (`world.contract`), or the declared world differs from the world hash the
 * caller pinned (`world.hash`). `check` says which.
 */
export class WorldMismatchError extends PrismError {}
WorldMismatchError.code = 'world_mismatch';

/** A replay produced output that differs from the recorded history. */
export class DeterminismViolationError extends PrismError {}
DeterminismViolationError.code = 'determinism_violation';

/** A replay could not be carried out, or the holo's replay statement failed. */
export class ReplayError extends PrismError {}
ReplayError.code = 'replay_failed';

/**
 * `attest` could not produce a signature: the key is unusable, no identity token
 * was available, or Fulcio, Rekor or the timestamp authority refused. `check`
 * is `sign.key`, `sign.identity`, `sign.service`, `sign.config`, `sign.predicate`
 * or `sign.subject`.
 */
export class SigningError extends PrismError {}
SigningError.code = 'signing_failed';

/** The DSSE signature, the signing key or the certificate chain of a bundle does not verify. */
export class SignatureInvalidError extends PrismError {}
SignatureInvalidError.code = 'signature_invalid';

/** The signer is valid but is not the identity (or issuer) the policy names. */
export class IdentityMismatchError extends PrismError {}
IdentityMismatchError.code = 'identity_mismatch';

/** A transparency log entry or signed timestamp is missing, untrusted or not about this bundle. `reasons` lists each one. */
export class TransparencyError extends PrismError {}
TransparencyError.code = 'transparency_failed';

/** A statement subject is not a content blob of this holo, or its digests differ from the blob's. */
export class SubjectMismatchError extends PrismError {}
SubjectMismatchError.code = 'subject_mismatch';

/** The holo carries no attestation, or none of the requested predicate type. */
export class AttestationNotFoundError extends PrismError {}
AttestationNotFoundError.code = 'attestation_not_found';

/** The pinned trusted root cannot be read or is not a usable root. */
export class TrustRootError extends PrismError {}
TrustRootError.code = 'trust_root_invalid';

/** Running a provider service failed (#294). `details` names the capability and the provider type. */
export class ProviderError extends PrismError {}
ProviderError.code = 'provider_error';

/** No `prism-provider-<type>` is on the PATH. Check `provider.not-found`. */
export class ProviderNotFoundError extends ProviderError {}
ProviderNotFoundError.code = 'provider_not_found';

/**
 * A provider broke the protocol (`provider.reply`), or a variable it returned
 * has a second source (`provider.collision`). The message never quotes the
 * reply, because a reply may hold a secret.
 */
export class ProviderReplyError extends ProviderError {}
ProviderReplyError.code = 'provider_reply_invalid';

/** A provider exited non-zero or sent an `error` message (`provider.failed`), would not start (`provider.spawn`) or ran out of time (`provider.timeout`). */
export class ProviderFailedError extends ProviderError {}
ProviderFailedError.code = 'provider_failed';

/** Every class with a code of its own, by code. */
export const ERROR_CLASSES = Object.freeze({
  [VerificationError.code]: VerificationError,
  [ProofMismatchError.code]: ProofMismatchError,
  [CapabilityDeniedError.code]: CapabilityDeniedError,
  [WorldMismatchError.code]: WorldMismatchError,
  [DeterminismViolationError.code]: DeterminismViolationError,
  [ReplayError.code]: ReplayError,
  [SigningError.code]: SigningError,
  [SignatureInvalidError.code]: SignatureInvalidError,
  [IdentityMismatchError.code]: IdentityMismatchError,
  [TransparencyError.code]: TransparencyError,
  [SubjectMismatchError.code]: SubjectMismatchError,
  [AttestationNotFoundError.code]: AttestationNotFoundError,
  [TrustRootError.code]: TrustRootError,
  [ProviderNotFoundError.code]: ProviderNotFoundError,
  [ProviderReplyError.code]: ProviderReplyError,
  [ProviderFailedError.code]: ProviderFailedError,
});

/**
 * The class a verdict reason maps to, by its check id. `replay.divergence` is
 * the one replay check that is a determinism violation; every other `replay.*`
 * check is a replay error. Anything else, `holo.*`, `provenance.*` and
 * `policy.*`, is a verification error.
 */
export function classForCheck(check) {
  if (check.startsWith('proof.')) return ProofMismatchError;
  if (check === 'world.capabilities' || check.startsWith('capabilities.')) return CapabilityDeniedError;
  if (check === 'world.contract' || check === 'world.hash') return WorldMismatchError;
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
 * The error that explains a failed verdict, or null for one that passed. A
 * rule the caller pinned and the holo broke (a digest, the world) comes
 * first: the caller asked for that fact by name, and it holds whatever the
 * level is. A world outside the granted capabilities (`world.capabilities`)
 * comes next: the default policy requires it at every level (#283). Otherwise, when the level is below the policy's minimum, it is
 * the first reason that withholds a level up to the minimum, which is what
 * kept the holo down. The error carries the whole verdict and every reason.
 */
export function errorFromVerdict(verdict, ranks) {
  if (verdict.passed) return null;
  const minimum = ranks[verdict.policy.minimum];
  const pinned = verdict.reasons.find((r) => r.withholds === null && r.check !== 'policy.level');
  // The default policy requires the world within the grant at every level (#269, #283), so it is named before a level shortfall.
  const outside = verdict.reasons.find((r) => r.check === 'world.capabilities');
  const blocking = verdict.reasons.find((r) => r.withholds && ranks[r.withholds] <= minimum);
  const reason = pinned ?? outside ?? blocking ?? verdict.reasons.find((r) => r.check !== 'policy.level') ?? verdict.reasons[0];
  return errorForReason(reason, verdict);
}

export function fail(code, message, details) {
  throw new PrismCodeError(code, message, details);
}
