/**
 * `prism.auth`: who you are (issue #447, the `auth` module of #440). Registry
 * logins and credential stores over `oci-auth.mjs`, and the identities that sign
 * attestations over `signing.mjs`. Node only. Every signature in prism-code is
 * made through an identity of this module: `attest`, `signStatements` and `push`
 * ask `identities.from` for one.
 *
 * Nothing this module returns, throws or logs holds a secret. A password goes
 * into a store and stays there, and `push` and `pull` read it from that store
 * themselves. A signing key or token stays inside its identity object. An error
 * that may quote a secret has it replaced and loses its `cause`.
 *
 * It decides nothing about trust. An identity signs; whether that signer is
 * acceptable is for `verify` to say. It may depend only on `errors`: `oci-auth`
 * and `signing` are its own code.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
import { createHash, createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';
import { PrismError, RegistryAuthError, RegistryError, SigningError } from './errors.mjs';
import { describeCredential, eraseCredential, listStores, storeCredential, storeForRegistry } from './oci-auth.mjs';
import { signStatement } from './signing.mjs';

const DOCKER_HUB = 'docker.io';
const REGISTRY_NAME = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])(?::[0-9]+)?$/;
const REDACTED = '[redacted]';
/** The variables `@sigstore/sign` reads an ambient identity from. */
const AMBIENT_TOKENS = ['SIGSTORE_ID_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'];

/** Every spelling of a secret a message may carry: as it is, encoded, and each part of a JWT or line of a PEM. */
function spellings(secret) {
  const forms = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), Buffer.from(secret).toString('base64url')];
  for (const part of secret.split(/[.\s]+/)) if (part.length >= 8) forms.push(part);
  return forms;
}

function redactor(secrets) {
  const forms = [...new Set(secrets.filter((s) => typeof s === 'string' && s !== '').flatMap(spellings))].sort((a, b) => b.length - a.length);
  return (text) => forms.reduce((out, form) => out.split(form).join(REDACTED), text);
}

/**
 * Make an error safe to hand out, in place, so its class, `code` and `check` stay. A `cause` may hold anything, so it goes,
 * unless `keepCause` says no secret was in play, which is how a keyless failure before any token was read stays explainable.
 */
function scrub(error, secrets, keepCause = false) {
  const redact = redactor(secrets);
  const deep = (value) => {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(deep);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, member]) => [redact(key), deep(member)]));
    return value;
  };
  if (!keepCause) delete error.cause;
  error.message = redact(error.message);
  if (typeof error.stack === 'string') error.stack = redact(error.stack);
  for (const member of ['details', 'reasons', 'verdict']) {
    if (error[member] !== undefined) error[member] = deep(error[member]);
  }
  return error;
}

const invalid = (message) => new RegistryError(message, { check: 'store.credential-input' });

/** A registry is a host name. The value is not quoted: a password pasted in the wrong place must not be printed. */
function registryName(registry) {
  if (typeof registry !== 'string' || !REGISTRY_NAME.test(registry)) throw invalid('a registry is a host name with an optional port, such as ghcr.io or localhost:5000');
  return registry;
}

function checkLogin(username, password) {
  if (typeof username !== 'string' || username === '' || username.includes(':') || username === '<token>' || /[\0-\x1f]/.test(username)) {
    throw invalid('login takes a non-empty username without a colon or control characters; Docker cannot read any other back');
  }
  if (typeof password !== 'string' || password === '' || password.endsWith('\0')) throw invalid('login takes a non-empty password as a string');
}

function keyIdentity(key) {
  let privateKey;
  try {
    if (key instanceof KeyObject) privateKey = key;
    else if (typeof key === 'string' || key instanceof Uint8Array) privateKey = createPrivateKey(key);
  } catch {
    // Node's message can quote what it was given, so it is not passed on.
    privateKey = undefined;
  }
  if (privateKey?.type !== 'private') throw new SigningError('the signing key cannot be read; expected a private KeyObject or an unencrypted PKCS#8 or SEC1 PEM', { check: 'sign.key' });
  const publicKey = createPublicKey(privateKey);
  return Object.freeze({
    kind: 'key',
    keyId: createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    sign: (statement) => signWith(statement, { key: privateKey }, typeof key === 'string' ? [key] : [], false),
  });
}

function keylessIdentity(options) {
  const { identityToken, signingConfig, tufMirrorUrl, tufRoot, tufCache } = options ?? {};
  if (identityToken !== undefined && (typeof identityToken !== 'string' || identityToken === '')) throw new SigningError('an identity token is a non-empty string', { check: 'sign.identity' });
  return Object.freeze({
    kind: 'keyless',
    ambient: identityToken === undefined,
    sign: (statement) => signWith(statement, { identityToken, signingConfig, tufMirrorUrl, tufRoot, tufCache }, [identityToken], true),
  });
}

/**
 * The identity a set of signer options names: `key` is a private key, and
 * without one the signing is keyless with `identityToken`, `signingConfig` and
 * the TUF options. This is the one place a flat options object, as `attest` and
 * `push` take it, becomes a signer.
 */
function identityFrom(options) {
  const { key, ...keyless } = options ?? {};
  return key !== undefined ? keyIdentity(key) : keylessIdentity(keyless);
}

async function signWith(statement, options, secrets, keyless) {
  if (!(statement instanceof Uint8Array)) throw new SigningError('sign takes the bytes of an in-toto statement', { check: 'sign.predicate' });
  try {
    return await signStatement(statement, options);
  } catch (error) {
    const all = [...secrets, ...AMBIENT_TOKENS.map((name) => process.env[name])].filter((s) => typeof s === 'string' && s !== '');
    // `signStatement` drops the cause itself once it has read a token; with no secret anywhere, the cause explains the failure.
    throw scrub(error, all, keyless && all.length === 0);
  }
}

/**
 * The `auth` namespace over one environment.
 *
 * `login` stores where Docker would, so `docker`, `push` and `pull` all find it.
 * It contacts no registry itself, because the registry client belongs to `images`,
 * which depends on this module. `checkCredential(registry, credential)` is how a
 * caller that has that client asks the registry first: if it throws, nothing is
 * stored. `verified` in the result says whether that happened.
 *
 * @param {{ env?: object, checkCredential?: (registry: string, credential: { username: string, password: string }) => Promise<unknown> }} [options]
 */
export function createAuth(options = {}) {
  const env = options.env ?? process.env;
  const { checkCredential } = options;

  return Object.freeze({
    /**
     * docker-py's `login`, without `email` and `reauth`, which have no meaning without a daemon.
     *
     * @param {{ username: string, password: string, registry?: string }} request `registry` defaults to Docker Hub
     * @returns {Promise<{ registry: string, username: string, store: object, verified: boolean }>}
     */
    async login(request) {
      const { username, password, registry = DOCKER_HUB } = request ?? {};
      registryName(registry);
      checkLogin(username, password);
      if (checkCredential) {
        try {
          await checkCredential(registry, { username, password });
        } catch (error) {
          const typed = error instanceof PrismError ? error : new RegistryAuthError(`the credential check for ${registry} failed: ${error?.message ?? error}`, { check: 'registry.auth' });
          throw scrub(typed, [password, `${username}:${password}`]);
        }
      }
      try {
        return { registry, username, store: await storeCredential(registry, { username, password }, env), verified: Boolean(checkCredential) };
      } catch (error) {
        throw scrub(error, [password, `${username}:${password}`]);
      }
    },

    /**
     * Docker's `logout`; docker-py has none. `removed` says whether a credential
     * was there. `ambient` names a variable that still gives a token, which no
     * logout can clear.
     *
     * @param {{ registry?: string }} [request]
     * @returns {Promise<{ registry: string, removed: boolean, ambient: string | null }>}
     */
    async logout(request) {
      const { registry = DOCKER_HUB } = request ?? {};
      registryName(registry);
      return { registry, ...(await eraseCredential(registry, env)) };
    },

    /**
     * docker-py's `resolve_authconfig`, without the secret.
     *
     * @param {string} [registry]
     * @returns {Promise<{ registry: string, type: 'password' | 'identity-token', username: string | null, store: object } | null>}
     */
    async inspect(registry = DOCKER_HUB) {
      registryName(registry);
      const found = await describeCredential(registry, env);
      return found && { registry, ...found };
    },

    stores: Object.freeze({
      /** Every store this environment configures. No helper is run, and a credential is never read. */
      list: () => listStores(env),
      /** docker-py's `get_credential_store`: where a login to this registry goes. */
      async get(registry = DOCKER_HUB) {
        registryName(registry);
        return storeForRegistry(registry, env);
      },
    }),

    /** Signing identities. Each holds its secret out of reach and offers `sign(statementBytes)`, which resolves to a Sigstore bundle. */
    identities: Object.freeze({
      /** A private key: PEM or KeyObject. `keyId` and `publicKey` are the facts a verifier is told. No network. */
      fromKey: keyIdentity,
      /**
       * Keyless: `identityToken` is exchanged for a Fulcio certificate. Without one the token comes from the process, as
       * `SIGSTORE_ID_TOKEN` or GitHub Actions, and not from `env`, because `@sigstore/sign` reads it there.
       */
      keyless: keylessIdentity,
      /** `fromKey(options.key)` when there is a key, else `keyless(options)`: the signer options `attest` and `push` take. */
      from: identityFrom,
    }),
  });
}

/** The default namespace, over `process.env`. */
export const auth = createAuth();
