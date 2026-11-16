/**
 * `prism.verify`: check, policy, attestations and replay as one namespace
 * (issue #449, design proposal #440). Every trust decision is meant to live in
 * this module, and in no other.
 *
 * Each member is the existing code under a Docker-SDK shaped name, so a verdict
 * from here equals the one `experimental_verify`, `check` and `@prism-code/verify`
 * return. The one rule this file adds is `withoutEvidence`. Nothing that exists is
 * renamed; that is #347. `createPrism` does not expose this yet; that is #441.
 *
 * P2 means the Lean kernel accepted the listed theorems about the model, not that
 * the shipped program is proven; `limits` names what such a verdict trusts.
 *
 * Nothing here imports Node at load, so `createPrism` can expose this in a
 * browser. `check.mjs` and `attest.mjs` read files and need `node:crypto`, so the
 * members over them load them on first use and refuse outside Node.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
import { readAttestations, stripAttestations } from './attestations.mjs';
import { classForCheck, VerificationError } from './errors.mjs';
import {
  HISTORY_SCHEMA,
  REPLAY_PREDICATE_TYPE,
  acceptanceHistory,
  experimental_recorder,
  experimental_replay,
  historyDigest,
  historyJson,
  parseHistory,
} from './replay.mjs';
import { ASSURANCE, POLICIES, VerifyError, evaluatePolicy, parsePolicy, policyInput } from './vendor/verify.mjs';
import { MINIMUM_LEVEL_ENV, experimental_verify, resolveOptions } from './verify.mjs';

const isNode = () => typeof process !== 'undefined' && process.versions?.node != null;

/** Load a Node-only module, or refuse with a no-verdict error: a member that cannot run must never look like a pass. */
function nodeOnly(member, load) {
  if (!isNode()) {
    return Promise.reject(new VerificationError(`verify.${member} needs Node; in a browser, verify.verdict judges a holo's bytes`, { check: 'verify.kind' }));
  }
  return load();
}

const checkModule = (member) => nodeOnly(member, () => import('./check.mjs'));
const attestModule = (member) => nodeOnly(member, () => import('./attest.mjs'));
const closureModule = (member) => nodeOnly(member, () => import('./verify-closure.mjs'));

/**
 * Refuse `statements`, whose `envelope.verified` is the caller's own claim of a
 * signature check: it would raise the level with no signature anywhere. Evidence
 * comes from the holo, and `check` is what verifies it against a signer.
 */
function withoutEvidence(options) {
  if (options?.statements !== undefined) {
    throw new VerificationError('statements are not an option: a level comes from the signed statements in the holo; use verify.check with a signer', { check: 'policy.invalid' });
  }
  return options;
}

/** The typed error `experimental_verify` raises for the same failure, so `policy` refuses as a verdict does. */
function typed(error) {
  if (error instanceof VerifyError) return new (classForCheck(error.code))(error.message, { check: error.code, cause: error });
  return error;
}

function policyCall(call) {
  return (...args) => {
    try {
      return call(...args);
    } catch (error) {
      throw typed(error);
    }
  };
}

/** The policy half: what can be read and evaluated, without judging a holo. The verdict is `verify.check` or `verify.verdict`. */
const policy = Object.freeze({
  /** The shipped policies by name, the names `check` also takes. */
  names: Object.freeze(Object.keys(POLICIES)),
  /** The levels in order, lowest first. */
  levels: ASSURANCE.LEVELS,
  /** The environment variable that sets the minimum level when nothing else does. */
  minimumLevelEnv: MINIMUM_LEVEL_ENV,
  /** A shipped policy by name, a Rego file or a JSON file of options. Node only. */
  read: async (path) => (await checkModule('policy.read')).readPolicy(path),
  /** The options a verdict is judged under: environment, then client, then call. An environment variable cannot lower a Rego policy. */
  resolve: resolveOptions,
  /** Parse Rego source. Throws `PolicyParseError`. */
  parse: policyCall(parsePolicy),
  /** Evaluate a parsed policy against a `prism/policy-input/1` document. Throws `PolicyEvaluationError`. The level is the evidence's, never the policy's. */
  evaluate: policyCall(evaluatePolicy),
  /** The `prism/policy-input/1` document a policy judges for a holo. */
  input: async (source, options = undefined) => {
    try {
      return await policyInput(source, withoutEvidence(options));
    } catch (error) {
      throw typed(error);
    }
  },
});

/** Read what a holo says about itself, and check who signed it. A statement read here is a claim until `verify` passes. */
const attestations = Object.freeze({
  /** Every bundle in the attestation section, in order. Reading verifies nothing. */
  read: readAttestations,
  /** The archive without its attestation section, which is what reproducibility checks compare. */
  strip: stripAttestations,
  /** Check a holo's attestations against a signer policy; see `experimental_verifyAttestations`. Node only. */
  verify: async (source, options = undefined) => (await attestModule('attestations.verify')).experimental_verifyAttestations(source, options),
  /** Check one Sigstore bundle against a signer policy, with no reference to a holo; see `experimental_verifyBundle`. Node only. */
  verifyBundle: async (bundle, options = undefined) => (await attestModule('attestations.verifyBundle')).experimental_verifyBundle(bundle, options),
});

/** Re-execute recorded dispatches. Every member takes an application already opened, so this module never loads an image. */
const replay = Object.freeze({
  historySchema: HISTORY_SCHEMA,
  predicateType: REPLAY_PREDICATE_TYPE,
  /** Re-execute histories against an application; see `experimental_replay`. */
  run: experimental_replay,
  /** Record dispatches as they run; see `experimental_recorder`. */
  record: experimental_recorder,
  /** An application's acceptance vectors as its first history. */
  acceptance: acceptanceHistory,
  /** Read a history. Throws `ReplayError` (`replay.history`). */
  parse: parseHistory,
  /** Both digests of a history. */
  digest: historyDigest,
  /** A history as a file: canonical JSON and one LF. */
  json: historyJson,
});

export const verify = Object.freeze({
  /**
   * Judge a holo file, its attestation section included. See `check`. Node only.
   *
   * @param {string} path the holo
   * @param {{ policy?: string, capabilities?: object | null, replay?: string, env?: object, signer?: object }} [options]
   */
  check: async (path, options = undefined) => (await checkModule('check')).check(path, options),
  /**
   * Judge a holo's bytes, anywhere. See `experimental_verify`. A holo with an
   * attestation section gets no verdict here, because the signature check needs
   * Node: use `check`, which judges its statements.
   *
   * @param {Uint8Array | ArrayBuffer | Blob | object} source
   * @param {object} [options]
   */
  verdict: async (source, options = undefined) => experimental_verify(source, withoutEvidence(options)),
  /** A verdict as text for a person. A message is never part of the contract. Node only. */
  format: async (verdict, path = undefined) => (await checkModule('format')).formatVerdict(verdict, path),
  /** What a verdict at P2 or above trusts the signer for, because no check can know it. Node only. */
  limits: async () => (await checkModule('limits')).LIMITS,
  /**
   * Judge what a pull fetched, before anything is written: the holo's bytes and
   * the claims about them, its attestation subjects, the verdict under `policy`,
   * and with a signer at least one passing bundle of the holo or the registry.
   * `images.pull` gets its answer only from here. See `verifyPullClosure`. Node only.
   *
   * @param {{ holo: Uint8Array, manifestDigest: string, claims?: object, asked?: object, referrers?: Array<{ digest: string, line: Uint8Array }> }} closure
   * @param {object} [options]
   */
  pullClosure: async (closure, options = undefined) => (await closureModule('pullClosure')).verifyPullClosure(closure, withoutEvidence(options) ?? {}),
  policy,
  attestations,
  replay,
});
