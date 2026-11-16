/**
 * Signing: in-toto statement bytes into a Sigstore bundle v0.3, with a private
 * key or keyless (issue #447, the signing cut of #440). This is the `auth`
 * module's: an identity signs, and whether that signer is acceptable is for
 * `verify` to say. Callers reach it through `auth.identities`, never directly.
 *
 * It may depend only on `errors`. The sigstore packages are optional
 * dependencies and load on first use, so nothing else needs them. Node only.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
import { readFile } from 'node:fs/promises';
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, KeyObject } from 'node:crypto';
import { PrismError, SigningError } from './errors.mjs';

/** `attestations.mjs` names the same type; it is a constant of DSSE, not something this module reads from `verify`. */
const DSSE_PAYLOAD_TYPE = 'application/vnd.in-toto+json';
const SIGNING_CONFIG_TARGET = 'signing_config.v0.2.json';

let loaded = null;

/** Load the optional sigstore signing packages once. Their absence is `attest.unavailable`, not a crash. */
async function sigstore() {
  loaded ??= (async () => {
    try {
      const [sign, tuf, bundle, specs] = await Promise.all([import('@sigstore/sign'), import('@sigstore/tuf'), import('@sigstore/bundle'), import('@sigstore/protobuf-specs')]);
      return { sign, tuf, bundle, specs };
    } catch (cause) {
      loaded = null;
      throw new PrismError(
        'signing needs the sigstore packages (@sigstore/sign, @sigstore/tuf, @sigstore/bundle, @sigstore/protobuf-specs), which are optional dependencies of prism-code and need Node 22.22.2 or newer: ' +
          cause.message,
        { code: 'attest.unavailable', cause },
      );
    }
  })();
  return loaded;
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

/**
 * The text with each token replaced, whole and part by part, because a service may quote only a JWT's payload.
 * `@sigstore/sign` writes a token it cannot parse into its own message, and that message is printed.
 */
function withoutTokens(text, tokens) {
  const parts = tokens.flatMap((token) => [token, ...token.split('.').filter((part) => part.length >= 8)]);
  return parts.reduce((out, part) => out.split(part).join('[redacted]'), text);
}

async function keylessBuilder(m, options, tokens) {
  let signingConfig = options.signingConfig;
  try {
    if (typeof signingConfig === 'string') signingConfig = await readJsonFile(signingConfig, 'the signing configuration');
    if (!signingConfig) {
      const tuf = await m.tuf.initTUF(tufOptions(options));
      signingConfig = JSON.parse(await tuf.getTarget(SIGNING_CONFIG_TARGET));
    }
    signingConfig = m.specs.SigningConfig.fromJSON(signingConfig);
    const source = options.identityToken ? { getToken: async () => options.identityToken } : new m.sign.CIContextProvider('sigstore');
    // Every token passes here, whichever source it came from, so a failure can be cleaned of it.
    const identityProvider = {
      getToken: async () => {
        const token = await source.getToken();
        tokens.push(String(token));
        return token;
      },
    };
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
  const tokens = [];
  const builder = options.key !== undefined ? await keyedBuilder(m, options.key) : await keylessBuilder(m, options, tokens);
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
    const message = withoutTokens(cause?.message ?? String(cause), tokens);
    // The CI identity provider rejects with a plain string; sigstore's own errors carry a code.
    const identity = typeof cause === 'string' || /^IDENTITY_TOKEN/.test(cause?.code ?? '');
    throw new SigningError(
      typeof cause === 'string' || cause?.code === 'IDENTITY_TOKEN_READ_ERROR'
        ? `no OIDC identity token is available: set SIGSTORE_ID_TOKEN, pass identityToken, or run in GitHub Actions with id-token: write (${message})`
        : identity
          ? `the OIDC identity token cannot be used: ${message}`
          : `signing failed: ${message}`,
      // Once a token was read, the original error may hold it anywhere, so it is not passed on.
      { check: identity ? 'sign.identity' : 'sign.service', cause: tokens.length === 0 ? cause : undefined },
    );
  }
}
