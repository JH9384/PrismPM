/**
 * `attest` and `verify-attestation`: sign an in-toto statement into a holo's
 * attestation section and check it again (issue #272, design in
 * `docs/proposals/272-attest-verify.md`).
 *
 * Node only. The signing and the DSSE, certificate and log checks belong to the
 * official `sigstore` packages (`@sigstore/sign`, `@sigstore/verify`,
 * `@sigstore/tuf`); this module only builds the statement, picks the key or the
 * keyless signer, applies the identity policy and maps every refusal to a typed
 * error. The packages are optional dependencies and load on first use, so the
 * rest of `prism-code` keeps working, and stays browser-safe, without them.
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
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, KeyObject } from 'node:crypto';
import { SigningError, SignatureInvalidError, IdentityMismatchError, TransparencyError, SubjectMismatchError, AttestationNotFoundError, TrustRootError, VerificationError, PrismError } from './errors.mjs';
import { parseArchive, resolveArchive, asBytes } from './archive.mjs';
import { blake3Hex } from './blake3.mjs';
import { readAttestations, appendAttestations, STATEMENT_TYPE, DSSE_PAYLOAD_TYPE } from './attestations.mjs';
import { verifyTransparency } from './vendor/verify.mjs';

/** The Fulcio-issued certificates of GitHub Actions workflows name this issuer. */
export const GITHUB_ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com';

const SIGNING_CONFIG_TARGET = 'signing_config.v0.2.json';
const ROLES = ['guest', 'view', 'model', 'capabilities'];
const encoder = new TextEncoder();
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/;

let loaded = null;

/** Load the optional sigstore packages once. Their absence is `attest.unavailable`, not a crash. */
async function sigstore() {
  loaded ??= (async () => {
    try {
      const [sign, verify, tuf, bundle, specs] = await Promise.all([
        import('@sigstore/sign'),
        import('@sigstore/verify'),
        import('@sigstore/tuf'),
        import('@sigstore/bundle'),
        import('@sigstore/protobuf-specs'),
      ]);
      return { sign, verify, tuf, bundle, specs };
    } catch (cause) {
      loaded = null;
      throw new PrismError(
        'attest and verify-attestation need the sigstore packages (@sigstore/sign, @sigstore/verify, @sigstore/tuf, @sigstore/bundle, @sigstore/protobuf-specs), which are optional dependencies of prism-code and need Node 22.22.2 or newer: ' +
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

async function holoBytes(source) {
  if (source && typeof source === 'object' && source.kind === 'holo' && source.archive?.bytes) return source.archive.bytes;
  if (typeof source === 'string') return new Uint8Array(await readFile(source));
  return asBytes(source);
}

function keyId(publicKey) {
  return createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
}

function privateKeyOf(key) {
  try {
    if (key instanceof KeyObject) return key;
    return createPrivateKey(key);
  } catch (cause) {
    throw new SigningError(`the signing key cannot be read: ${cause.message}; expected an unencrypted PKCS#8 or SEC1 PEM`, { check: 'sign.key', cause });
  }
}

function publicKeyOf(key) {
  try {
    if (key instanceof KeyObject) return key.type === 'private' ? createPublicKey(key) : key;
    return createPublicKey(key);
  } catch (cause) {
    throw new VerificationError(`the verification key cannot be read: ${cause.message}; expected a PEM public key`, { check: 'policy.invalid', cause });
  }
}

function predicateOf(predicate) {
  let value = predicate;
  if (value instanceof Uint8Array || typeof value === 'string') {
    try {
      value = JSON.parse(typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value));
    } catch (cause) {
      throw new SigningError(`the predicate is not JSON: ${cause.message}`, { check: 'sign.predicate', cause });
    }
  }
  if (value === undefined || value === null) throw new SigningError('a predicate is required', { check: 'sign.predicate' });
  return value;
}

/**
 * The subjects of a statement, as `{ name, digest: { sha256, blake3 } }` over
 * content blobs of the holo. A request is a role (`guest`, `view`, `model`,
 * `capabilities`), a blob label (`blake3:<hex>`), or `name=<role or label>`.
 * Without a request the subject is the guest, which is what the proof and
 * provenance predicates describe (#266, #268).
 */
export function resolveSubjects(parsed, requests = []) {
  const wanted = requests.length === 0 ? ['guest'] : requests;
  let roles = null;
  const subjects = wanted.map((request) => {
    if (typeof request !== 'string' || request === '') throw new SigningError('a subject is a role or a blob label', { check: 'sign.subject' });
    const eq = request.indexOf('=');
    const name = eq > 0 ? request.slice(0, eq) : null;
    const target = eq > 0 ? request.slice(eq + 1) : request;
    let label;
    if (ROLES.includes(target)) {
      roles ??= resolveArchive(parsed).identities;
      label = roles[`${target}Kappa`];
    } else if (/^blake3:[0-9a-f]{64}$/.test(target)) label = target;
    else throw new SigningError(`subject ${JSON.stringify(request)} is neither a role (${ROLES.join(', ')}) nor a blake3 label`, { check: 'sign.subject' });
    const blob = parsed.blobs.find((b) => b.label === label);
    if (!blob) throw new SigningError(`subject ${label} is not a content blob of this holo`, { check: 'sign.subject' });
    return { name: name ?? (ROLES.includes(target) ? target : label), digest: { sha256: sha256Hex(blob.content), blake3: blake3Hex(blob.content) } };
  });
  if (new Set(subjects.map((s) => s.name)).size !== subjects.length) throw new SigningError('two subjects have the same name', { check: 'sign.subject' });
  return subjects;
}

/** The in-toto Statement v1 bytes that get signed. */
export function buildStatement(parsed, { type, predicate, subjects }) {
  if (typeof type !== 'string' || !URI.test(type)) throw new SigningError('the predicate type must be a URI, such as https://slsa.dev/provenance/v1', { check: 'sign.predicate' });
  const statement = { _type: STATEMENT_TYPE, subject: resolveSubjects(parsed, subjects), predicateType: type, predicate: predicateOf(predicate) };
  return { statement, bytes: encoder.encode(JSON.stringify(statement)) };
}

async function keyedBuilder(m, key) {
  const privateKey = privateKeyOf(key);
  const publicKey = createPublicKey(privateKey);
  const hint = keyId(publicKey);
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  // Ed25519 signs the message itself; every other scheme signs its SHA-256 digest.
  const digest = privateKey.asymmetricKeyType === 'ed25519' ? null : 'sha256';
  const signer = {
    sign: async (data) => ({ signature: cryptoSign(digest, data, privateKey), key: { $case: 'publicKey', publicKey: pem, hint } }),
  };
  return new m.sign.DSSEBundleBuilder({ signer, witnesses: [] });
}

async function readJsonFile(path, what, Error = SigningError, check = 'sign.config') {
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

// sigstore's default is 5 s. A log entry can take longer than that to answer after it is stored, and the
// client then sends the same request again, which the log refuses as a duplicate.
const KEYLESS_FETCH = Object.freeze({ timeout: 30_000, retry: Object.freeze({ retries: 2 }) });

/**
 * The log already holds this exact entry. Only a re-sent request can do that, because each signature is new:
 * an earlier attempt was stored, and its answer was lost or was a 5xx. `bundleBuilderFromSigningConfig` does
 * not expose `fetchOnConflict`, which would read that entry back.
 */
const isLogConflict = (error) => error?.code === 'TLOG_CREATE_ENTRY_ERROR' && error.cause?.statusCode === 409;

async function keylessBuilder(m, options) {
  let signingConfig = options.signingConfig;
  try {
    if (typeof signingConfig === 'string') signingConfig = await readJsonFile(signingConfig, 'the signing configuration');
    if (!signingConfig) {
      const tuf = await m.tuf.initTUF(tufOptions(options));
      signingConfig = JSON.parse(await tuf.getTarget(SIGNING_CONFIG_TARGET));
    }
    signingConfig = m.specs.SigningConfig.fromJSON(signingConfig);
    const identityProvider = options.identityToken ? { getToken: async () => options.identityToken } : new m.sign.CIContextProvider('sigstore');
    return m.sign.bundleBuilderFromSigningConfig({ signingConfig, identityProvider, bundleType: 'dsseEnvelope', fetchOptions: KEYLESS_FETCH });
  } catch (cause) {
    if (cause instanceof SigningError) throw cause;
    throw new SigningError(`the Sigstore signing configuration is unavailable or unusable:${cause.message}`, { check: 'sign.config', cause });
  }
}

/**
 * Sign statement bytes into a Sigstore bundle v0.3, with `key` or keyless. The
 * bundle's JSON is returned; nothing else is written. `attest` stores it in the
 * holo, and `push` (#292) stores it as a referrer.
 *
 * @param {Uint8Array} bytes the in-toto Statement v1 exactly as it is to be signed
 * @param {{ key?: string | KeyObject, identityToken?: string, signingConfig?: object | string, tufMirrorUrl?: string, tufRoot?: string, tufCache?: string }} options
 * @returns {Promise<object>}
 */
export async function signStatement(bytes, options = {}) {
  const m = await sigstore();
  const builder = options.key !== undefined ? await keyedBuilder(m, options.key) : await keylessBuilder(m, options);
  try {
    const artifact = { data: Buffer.from(bytes), type: DSSE_PAYLOAD_TYPE };
    const signed = await builder.create(artifact).catch((error) => {
      if (isLogConflict(error)) return builder.create(artifact);
      throw error;
    });
    const bundle = m.bundle.bundleToJSON(signed);
    // A DSSE verifier skips a signature whose keyid is not its own, and cosign's is not this hash, so a keyed bundle with one
    // verifies nowhere but here. The keyid is not signed, and the hint in the verification material still names the key.
    if (options.key !== undefined) for (const signature of bundle.dsseEnvelope.signatures) signature.keyid = '';
    return bundle;
  } catch (cause) {
    if (cause instanceof PrismError) throw cause;
    const message = cause?.message ?? String(cause);
    // The CI identity provider rejects with a plain string; sigstore's own errors carry a code.
    const identity = typeof cause === 'string' || /^IDENTITY_TOKEN/.test(cause?.code ?? '');
    throw new SigningError(
      typeof cause === 'string' || cause?.code === 'IDENTITY_TOKEN_READ_ERROR'
        ? `no OIDC identity token is available: set SIGSTORE_ID_TOKEN, pass identityToken, or run in GitHub Actions with id-token: write (${message})`
        : identity
          ? `the OIDC identity token cannot be used: ${message}`
          : `signing failed: ${message}`,
      { check: identity ? 'sign.identity' : 'sign.service', cause },
    );
  }
}

/**
 * Sign a statement about a holo and return the holo with the bundle appended to
 * its attestation section. The input holo is not modified.
 *
 * With `key`, the statement is signed by that private key (PEM or KeyObject)
 * and no network is used. Without it the signing is keyless: an OIDC identity
 * token (`identityToken`, else GitHub Actions or `SIGSTORE_ID_TOKEN`) is
 * exchanged for a Fulcio certificate, and the Rekor v2 entry and RFC 3161
 * timestamp of the signing configuration (`signingConfig`, else the public
 * instance's, from TUF) are embedded in the bundle. If the log refuses the entry
 * as a duplicate of a re-sent request, the statement is signed once more, which
 * makes a new entry; the first one stays in the log, unused.
 *
 * @param {Uint8Array | ArrayBuffer | string | object} source the holo as bytes, a path, or an opened holo
 * @param {{ type: string, predicate: unknown, subjects?: string[], key?: string | KeyObject, identityToken?: string, signingConfig?: object | string, tufMirrorUrl?: string, tufRoot?: string, tufCache?: string }} options
 * @returns {Promise<{ holo: Uint8Array, bundle: object, statement: object, attestations: number }>} `attestations` counts the bundles now in the holo
 */
export async function experimental_attest(source, options) {
  if (!isObject(options)) throw new SigningError('attest takes an options object with a type and a predicate', { check: 'sign.predicate' });
  const parsed = parseArchive(await holoBytes(source));
  const { statement, bytes } = buildStatement(parsed, options);
  const bundle = await signStatement(bytes, options);
  const holo = appendAttestations(parsed, [bundle]);
  return { holo, bundle, statement, attestations: readAttestations(holo).length };
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

/** The blobs a bundle's subjects name must be in this holo with both digests equal; otherwise a typed error. */
export function checkSubjects(parsed, attestation) {
  for (const subject of attestation.subjects) {
    const blob = subject.blob === null ? null : parsed.blobs.find((b) => b.label === subject.blob);
    if (!blob) throw new SubjectMismatchError(`subject ${subject.name} is not a content blob of this holo`, { check: 'attestation.subject' });
    if (sha256Hex(blob.content) !== subject.digest.sha256 || blake3Hex(blob.content) !== subject.digest.blake3) {
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
