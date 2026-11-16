/**
 * `verify-attestation`: check the in-toto statements of a holo's attestation
 * section, or one Sigstore bundle, against a signer policy (issue #272, design
 * in `docs/proposals/272-attest-verify.md`). This is the `verify` module's half
 * of attestation; writing a statement is `attest-write.mjs` (`images`) and
 * signing it is an `auth` identity (`signing.mjs`).
 *
 * Node only. The DSSE, certificate and log checks belong to the official
 * `sigstore` packages (`@sigstore/verify`, `@sigstore/tuf`); this module only
 * applies the identity policy and maps every refusal to a typed error. The
 * packages are optional dependencies and load on first use, so the rest of
 * `prism-code` keeps working, and stays browser-safe, without them.
 *
 * What runs on a verify, in order, for each bundle of the requested type:
 *   1. every statement subject is a content blob of this holo, both digests equal;
 *   2. `@sigstore/verify`: the DSSE signature, the certificate chain or the key,
 *      the log entries and the timestamps, against the pinned trusted root;
 *   3. the signer identity and issuer equal the policy's (exact, not a pattern);
 *   4. #275's `verifyTransparency`, offline, over the same bundle and root: the
 *      Rekor v2 inclusion proof, the signed checkpoint and the RFC 3161 time.
 *
 * Experimental until the v0.6 freeze, hence the `experimental_` prefix.
 */
import { readFile } from 'node:fs/promises';
import { createHash, createPublicKey, KeyObject } from 'node:crypto';
import { SignatureInvalidError, IdentityMismatchError, TransparencyError, SubjectMismatchError, AttestationNotFoundError, TrustRootError, VerificationError, PrismError } from './errors.mjs';
import { parseArchive, asBytes } from './archive.mjs';
import { blake3Hex } from './blake3.mjs';
import { readAttestations } from './attestations.mjs';
import { verifyTransparency } from './vendor/verify.mjs';

/** The Fulcio-issued certificates of GitHub Actions workflows name this issuer. */
export const GITHUB_ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com';

let loaded = null;

/** Load the optional sigstore packages once. Their absence is `attest.unavailable`, not a crash. */
async function sigstore() {
  loaded ??= (async () => {
    try {
      const [verify, tuf, bundle, specs] = await Promise.all([import('@sigstore/verify'), import('@sigstore/tuf'), import('@sigstore/bundle'), import('@sigstore/protobuf-specs')]);
      return { verify, tuf, bundle, specs };
    } catch (cause) {
      loaded = null;
      throw new PrismError(
        'verify-attestation needs the sigstore packages (@sigstore/verify, @sigstore/tuf, @sigstore/bundle, @sigstore/protobuf-specs), which are optional dependencies of prism-code and need Node 22.22.2 or newer: ' +
          cause.message,
        { code: 'attest.unavailable', cause },
      );
    }
  })();
  return loaded;
}

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A holo's bytes from bytes, a path, or an opened holo. */
export async function holoBytes(source) {
  if (source && typeof source === 'object' && source.kind === 'holo' && source.archive?.bytes) return source.archive.bytes;
  if (typeof source === 'string') return new Uint8Array(await readFile(source));
  return asBytes(source);
}

function publicKeyOf(key) {
  try {
    if (key instanceof KeyObject) return key.type === 'private' ? createPublicKey(key) : key;
    return createPublicKey(key);
  } catch (cause) {
    throw new VerificationError(`the verification key cannot be read: ${cause.message}; expected a PEM public key`, { check: 'policy.invalid', cause });
  }
}
async function readJsonFile(path, what, Error, check) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    throw new Error(`${what} ${path} cannot be read: ${cause.message}`, { check, cause });
  }
}

function tufOptions(options) {
  const out = {};
  if (options.tufMirrorUrl) out.mirrorURL = options.tufMirrorUrl;
  if (options.tufRoot) out.rootPath = options.tufRoot;
  if (options.tufCache) out.cachePath = options.tufCache;
  return out;
}

// ---------------------------------------------------------------------------

const EMPTY_ROOT = { mediaType: 'application/vnd.dev.sigstore.trustedroot+json;version=0.1', tlogs: [], certificateAuthorities: [], ctlogs: [], timestampAuthorities: [] };

async function trustedRootOf(m, options, needed) {
  const given = options.trustedRoot;
  try {
    if (typeof given === 'string') return await readJsonFile(given, 'the trusted root', TrustRootError, 'trustedroot.invalid');
    if (isObject(given)) return given;
    if (!needed) return EMPTY_ROOT;
    return m.specs.TrustedRoot.toJSON(await m.tuf.getTrustedRoot(tufOptions(options)));
  } catch (cause) {
    if (cause instanceof TrustRootError) throw cause;
    throw new TrustRootError(`the Sigstore trusted root is unavailable: ${cause.message}; pass --trusted-root to pin one`, { check: 'trustedroot.invalid', cause });
  }
}

/** A pinned root must carry what the policy relies on; an empty root would fail every bundle with a misleading reason. */
function checkRoot(root, policy) {
  const need = [];
  if (!policy.keyed) need.push('certificateAuthorities');
  if (policy.entries > 0) need.push('tlogs');
  if (policy.timestamps > 0) need.push('timestampAuthorities');
  const missing = need.filter((member) => !Array.isArray(root?.[member]) || root[member].length === 0);
  if (missing.length > 0) throw new TrustRootError(`the trusted root has no ${missing.join(', ')}`, { check: 'trustedroot.invalid' });
}

function policyOf(options) {
  const invalid = (message) => new VerificationError(message, { check: 'policy.invalid' });
  const keyed = options.key !== undefined;
  const { certificateIdentity, certificateIdentityRegexp, certificateOidcIssuer } = options;
  if (certificateIdentity !== undefined && certificateIdentityRegexp !== undefined) throw invalid('name the signer with either certificateIdentity or certificateIdentityRegexp, not both');
  if (certificateIdentityRegexp !== undefined && !(certificateIdentityRegexp instanceof RegExp)) {
    try {
      new RegExp(certificateIdentityRegexp);
    } catch (cause) {
      throw invalid(`certificateIdentityRegexp is not a regular expression: ${cause.message}`);
    }
  }
  if (keyed) {
    if (certificateIdentity !== undefined || certificateIdentityRegexp !== undefined || certificateOidcIssuer !== undefined) throw invalid('a key policy has no certificate identity or issuer');
  } else {
    if (certificateIdentity === undefined && certificateIdentityRegexp === undefined) throw invalid('a keyless policy needs certificateIdentity or certificateIdentityRegexp: without it any signer would pass');
    if (certificateOidcIssuer === undefined) throw invalid('a keyless policy needs certificateOidcIssuer');
  }
  const count = (name, fallback) => {
    const value = options[name] ?? fallback;
    if (!Number.isInteger(value) || value < 0) throw invalid(`${name} is a count, 0 or more`);
    return value;
  };
  const entries = count('entries', keyed ? 0 : 1);
  const timestamps = count('timestamps', keyed ? 0 : 1);
  if (keyed && (entries > 0 || timestamps > 0) && options.trustedRoot === undefined) throw invalid('requiring log entries or timestamps of a keyed bundle needs a trustedRoot');
  return { keyed, entries, timestamps };
}

/** The objects a bundle's subjects name must be in this holo, named by their κ; otherwise a typed error. */
export function checkSubjects(parsed, attestation) {
  for (const subject of attestation.subjects) {
    const blob = subject.blob === null ? null : parsed.blobs.find((b) => b.label === subject.blob);
    if (!blob) throw new SubjectMismatchError(`subject ${subject.name} is not a content blob of this holo`, { check: 'attestation.subject' });
    if (sha256Hex(blob.content) !== subject.digest.sha256 || (subject.digest.blake3 !== undefined && blake3Hex(blob.content) !== subject.digest.blake3)) {
      throw new SubjectMismatchError(`subject ${subject.name} names ${subject.blob} but its digests are not the blob's`, { check: 'attestation.subject' });
    }
  }
}

function mapSigstoreError(error) {
  const code = error?.code;
  const message = error?.message ?? String(error);
  if (/^(TLOG|TIMESTAMP)/.test(code ?? '')) return new TransparencyError(message, { check: `transparency.${String(code).toLowerCase()}`, cause: error });
  if (code === 'UNTRUSTED_SIGNER_ERROR') return new IdentityMismatchError(message, { check: 'identity.signer', cause: error });
  return new SignatureInvalidError(message, { check: `signature.${String(code ?? 'unknown').toLowerCase()}`, cause: error });
}

function matches(policy, value) {
  if (value === undefined) return false;
  if (policy.certificateIdentity !== undefined) return value === policy.certificateIdentity;
  const re = policy.certificateIdentityRegexp;
  return (re instanceof RegExp ? re : new RegExp(re)).test(value);
}

/** Signature, signer and transparency evidence of one bundle, with no reference to a holo. */
async function verifyEvidence(m, bundle, options, policy, root, keyFinder) {
  const trust = m.verify.toTrustMaterial(m.specs.TrustedRoot.fromJSON(root), keyFinder);
  const verifier = new m.verify.Verifier(trust, { tlogThreshold: policy.entries, timestampThreshold: policy.timestamps, ctlogThreshold: policy.keyed ? 0 : 1 });
  let signer;
  try {
    signer = verifier.verify(m.verify.toSignedEntity(m.bundle.bundleFromJSON(bundle)));
  } catch (error) {
    throw mapSigstoreError(error);
  }
  let identity = null;
  let issuer = null;
  if (!policy.keyed) {
    identity = signer.identity?.subjectAlternativeName ?? null;
    issuer = signer.identity?.extensions?.issuer ?? null;
    if (!matches(options, identity ?? undefined)) {
      throw new IdentityMismatchError(`the signer is ${identity ?? 'unnamed'}, which is not the certificate identity the policy names`, { check: 'identity.signer' });
    }
    if (issuer !== options.certificateOidcIssuer) {
      throw new IdentityMismatchError(`the signer's OIDC issuer is ${issuer ?? 'unnamed'}, expected ${options.certificateOidcIssuer}`, { check: 'identity.issuer' });
    }
  }
  let time = null;
  if (policy.entries > 0 || policy.timestamps > 0) {
    const transparency = await verifyTransparency(bundle, root, { entries: policy.entries, timestamps: policy.timestamps });
    if (!transparency.passed) {
      throw new TransparencyError(transparency.reasons.map((r) => r.message).join(' '), { check: `transparency.${transparency.reasons[0].check}`, reasons: transparency.reasons });
    }
    time = transparency.time;
  }
  return { identity, issuer, keyId: policy.keyed ? bundle.verificationMaterial?.publicKey?.hint ?? null : null, time };
}

async function verifyBundle(m, parsed, attestation, options, policy, root, keyFinder) {
  checkSubjects(parsed, attestation);
  return verifyEvidence(m, attestation.bundle, options, policy, root, keyFinder);
}

/**
 * Check one Sigstore bundle on its own: the signature, the signer against the
 * policy, and the log entries and timestamps. It does not look at what the
 * statement is about. Same policy options as `experimental_verifyAttestations`.
 * Resolves to `{ identity, issuer, keyId, time }` and rejects with the typed error.
 *
 * @param {object} bundle a Sigstore bundle v0.3 with a DSSE envelope
 */
export async function experimental_verifyBundle(bundle, options = {}) {
  if (!isObject(options)) throw new VerificationError('verify options must be an object', { check: 'policy.invalid' });
  const policy = policyOf(options);
  const publicKey = policy.keyed ? publicKeyOf(options.key) : null;
  const m = await sigstore();
  const root = await trustedRootOf(m, options, !policy.keyed || policy.entries > 0 || policy.timestamps > 0);
  checkRoot(root, policy);
  return verifyEvidence(m, bundle, options, policy, root, publicKey ? () => ({ publicKey, validFor: () => true }) : undefined);
}

/**
 * Check the attestations of a holo against a signer policy.
 *
 * Keyless policy: `certificateIdentity` (exact) or `certificateIdentityRegexp`,
 * and `certificateOidcIssuer`; both are required, because a signature by an
 * unnamed signer proves nothing. Keyed policy: `key`, a PEM public key.
 * `trustedRoot` (a `trusted_root.json` object or path) is pinned by the caller;
 * without one a keyless call fetches the public instance's root over TUF.
 * `entries` and `timestamps` are the least number of Rekor v2 entries and RFC
 * 3161 timestamps that must verify: 1 each keyless, 0 each keyed.
 *
 * The result passes when at least one bundle of the requested `type` passes
 * every check. With `throw: true`, a result that did not pass is thrown as the
 * typed error of the first failing bundle (or `AttestationNotFoundError`).
 *
 * @param {Uint8Array | ArrayBuffer | string | object} source the holo as bytes, a path, or an opened holo
 * @param {{ type?: string, certificateIdentity?: string, certificateIdentityRegexp?: string | RegExp, certificateOidcIssuer?: string, key?: string | KeyObject, trustedRoot?: object | string, entries?: number, timestamps?: number, tufMirrorUrl?: string, tufRoot?: string, tufCache?: string, throw?: boolean }} options
 */
export async function experimental_verifyAttestations(source, options = {}) {
  if (!isObject(options)) throw new VerificationError('verify options must be an object', { check: 'policy.invalid' });
  const policy = policyOf(options);
  const publicKey = policy.keyed ? publicKeyOf(options.key) : null;
  const parsed = parseArchive(await holoBytes(source));
  if (!parsed.verification.footer || !parsed.verification.labels) {
    throw new VerificationError('the holo does not verify: its footer or a content label differs from the bytes', { check: 'holo.integrity' });
  }
  const m = await sigstore();
  const all = readAttestations(parsed);
  const matching = options.type === undefined ? all : all.filter((a) => a.predicateType === options.type);
  const results = [];
  let error = null;
  if (matching.length === 0) {
    error = new AttestationNotFoundError(
      all.length === 0 ? 'the holo has no attestation section' : `none of the ${all.length} attestations has predicate type ${options.type}; found ${[...new Set(all.map((a) => a.predicateType))].join(', ')}`,
      { check: all.length === 0 ? 'attestation.none' : 'attestation.type' },
    );
  } else {
    const root = await trustedRootOf(m, options, !policy.keyed || policy.entries > 0 || policy.timestamps > 0);
    checkRoot(root, policy);
    const keyFinder = publicKey ? () => ({ publicKey, validFor: () => true }) : undefined;
    for (const attestation of matching) {
      const entry = { index: attestation.index, predicateType: attestation.predicateType, subjects: attestation.subjects.map((s) => s.name), passed: false, signer: null, time: null, error: null };
      try {
        const outcome = await verifyBundle(m, parsed, attestation, options, policy, root, keyFinder);
        entry.passed = true;
        entry.signer = { identity: outcome.identity, issuer: outcome.issuer, keyId: outcome.keyId };
        entry.time = outcome.time;
      } catch (caught) {
        if (!(caught instanceof PrismError)) throw caught;
        entry.error = caught;
        error ??= caught;
      }
      results.push(entry);
    }
    if (results.some((r) => r.passed)) error = null;
  }
  const result = { passed: error === null, results, error };
  if (options.throw && error) throw error;
  return result;
}
