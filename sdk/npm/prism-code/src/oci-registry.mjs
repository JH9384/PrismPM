/**
 * A client for an OCI Distribution 1.1 registry, over `fetch`, with no dependency
 * (issue #292, docs/proposals/292-push-pull-oci.md).
 *
 * It implements the same endpoint as the local store (`oci-store.mjs`): blobs,
 * manifests and referrers, each verified by `sha256` when read. Referrers use the
 * API when the registry has it and the tag schema of the spec otherwise.
 *
 * Credentials: `resolveCredentials(host)` is called once and may return
 * `{ username, password }`, `{ identityToken }` or null (`oci-auth.mjs`). The
 * registry's challenge decides how they are used. They are never sent over plain
 * `http` except to a loopback address, and never to another origin.
 */
import { DigestMismatchError, ManifestNotFoundError, ReferrersUnsupportedError, RegistryAuthError, RegistryError } from './errors.mjs';
import { canonicalBytes, digestOf, emptyIndex, INDEX_MEDIA_TYPE, MANIFEST_MEDIA_TYPE, referrersTag, fingerprintTag } from './oci-manifest.mjs';

/** The spec's suggested upper bound on a manifest a client should accept. */
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MANIFEST_ACCEPT = `${MANIFEST_MEDIA_TYPE}, ${INDEX_MEDIA_TYPE}`;
const JSON_TYPES = /^application\/(?:vnd\.[\w.+-]+\+)?json\b/;

/** Docker's rule: a loopback registry speaks plain HTTP unless told otherwise. */
export function isLoopback(host) {
  const name = host.replace(/:[0-9]+$/, '').replace(/^\[|\]$/g, '');
  return name === 'localhost' || name === '::1' || name.endsWith('.localhost') || /^127\.[0-9]+\.[0-9]+\.[0-9]+$/.test(name);
}

/** The API host of a registry name: Docker Hub's name is not the host that serves it. */
const apiHost = (registry) => (registry === 'docker.io' || registry === 'index.docker.io' ? 'registry-1.docker.io' : registry);

/** Parse `Bearer realm="...",service="...",scope="..."` or `Basic realm="..."`. */
export function parseChallenge(header) {
  if (typeof header !== 'string') return null;
  const space = header.indexOf(' ');
  const scheme = (space < 0 ? header : header.slice(0, space)).toLowerCase();
  const parameters = {};
  if (space >= 0) {
    for (const match of header.slice(space + 1).matchAll(/([A-Za-z_]+)=(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g)) {
      parameters[match[1].toLowerCase()] = match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3];
    }
  }
  return { scheme, parameters };
}

async function readLimited(response, limit, what) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw new RegistryError(`${what} is ${declared} bytes, over the ${limit} byte bound`, { check: 'registry.size' });
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > limit) throw new RegistryError(`${what} is over the ${limit} byte bound`, { check: 'registry.size' });
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

async function errorText(response) {
  try {
    const body = JSON.parse(new TextDecoder().decode(await readLimited(response, 65536, 'the error')));
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    return { codes: errors.map((e) => e?.code).filter(Boolean), message: errors.map((e) => `${e?.code ?? 'ERROR'}: ${e?.message ?? ''}`.trim()).join('; ') };
  } catch {
    return { codes: [], message: '' };
  }
}

/**
 * A client for one repository of one registry.
 *
 * @param {{ registry: string, repository: string }} reference
 * @param {{ plainHttp?: boolean, resolveCredentials?: (host: string) => Promise<object | null> | object | null, fetch?: typeof fetch, timeoutMs?: number, referrersFallback?: boolean }} [options]
 */
export function createRegistryClient(reference, options = {}) {
  const { registry, repository } = reference;
  const host = apiHost(registry);
  const fetcher = options.fetch ?? globalThis.fetch;
  const plain = options.plainHttp === true || isLoopback(host);
  const base = `${plain ? 'http' : 'https'}://${host}`;
  const origin = new URL(base).origin;
  const timeoutMs = options.timeoutMs ?? 300000;
  const fallbackAllowed = options.referrersFallback !== false;
  let credentials;
  /** The token per realm and scope. */
  const tokens = new Map();
  /** The Authorization to send first, once a challenge has been answered. */
  let current = null;

  const creds = async () => {
    if (credentials === undefined) credentials = (await options.resolveCredentials?.(registry)) ?? null;
    return credentials;
  };

  const send = async (url, init, what) => {
    try {
      return await fetcher(url, { redirect: 'follow', ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      throw new RegistryError(`${what}: ${registry} cannot be reached: ${cause?.cause?.code ?? cause?.message ?? cause}${plain ? '' : '; a registry on plain HTTP needs --plain-http'}`, { check: 'registry.unreachable', cause });
    }
  };

  /** Exchange credentials for a bearer token at the realm the registry named. */
  const fetchToken = async (parameters, scope) => {
    const key = `${parameters.realm} ${scope}`;
    if (tokens.has(key)) return tokens.get(key);
    let realm;
    try {
      realm = new URL(parameters.realm);
    } catch (cause) {
      throw new RegistryAuthError(`${registry} named an unusable token realm ${JSON.stringify(parameters.realm)}`, { check: 'registry.auth', cause });
    }
    const secret = await creds();
    if (secret && realm.protocol !== 'https:' && !isLoopback(realm.host)) {
      throw new RegistryAuthError(`${registry} asked for credentials over plain HTTP at ${realm.origin}; refusing to send them`, { check: 'registry.insecure' });
    }
    // An ambient token belongs to one registry, whatever the challenge says.
    const usable = secret && (!secret.onlyRealmHost || secret.onlyRealmHost === realm.host) ? secret : null;
    if (parameters.service) realm.searchParams.set('service', parameters.service);
    if (scope) realm.searchParams.set('scope', scope);
    const headers = { accept: 'application/json' };
    let response;
    if (usable?.identityToken) {
      // An identity token is a refresh token: the OAuth2 form of the token exchange.
      const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: usable.identityToken, service: parameters.service ?? '', scope: scope ?? '', client_id: 'prism-code' });
      response = await send(`${realm.origin}${realm.pathname}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body: form }, 'token');
    } else {
      if (usable) headers.authorization = `Basic ${btoa(`${usable.username}:${usable.password}`)}`;
      response = await send(realm.href, { headers }, 'token');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new RegistryAuthError(`${registry} refused ${usable ? 'the credentials' : 'an anonymous token'} for ${scope ?? 'this repository'} (${response.status}); log in with docker login${registry === 'ghcr.io' ? ', or set GHCR_TOKEN' : ''}`, { check: 'registry.auth', details: { status: response.status, scope } });
    }
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(await readLimited(response, 1024 * 1024, 'the token')));
    } catch (cause) {
      throw new RegistryAuthError(`${registry} answered the token request with something that is not JSON`, { check: 'registry.auth', cause });
    }
    const token = body.token ?? body.access_token;
    if (typeof token !== 'string' || token === '') throw new RegistryAuthError(`${registry} answered the token request without a token`, { check: 'registry.auth' });
    tokens.set(key, token);
    return token;
  };

  const answerChallenge = async (response, requested) => {
    const challenge = parseChallenge(response.headers.get('www-authenticate'));
    await response.body?.cancel();
    if (challenge?.scheme === 'bearer' && challenge.parameters.realm) {
      const scope = requested ?? challenge.parameters.scope;
      return `Bearer ${await fetchToken(challenge.parameters, scope)}`;
    }
    if (challenge?.scheme === 'basic') {
      const secret = await creds();
      if (!secret || secret.identityToken) throw new RegistryAuthError(`${registry} needs a username and password; log in with docker login`, { check: 'registry.auth' });
      if (!plain || isLoopback(host)) return `Basic ${btoa(`${secret.username}:${secret.password}`)}`;
      throw new RegistryAuthError(`${registry} asked for basic credentials over plain HTTP; refusing to send them`, { check: 'registry.insecure' });
    }
    throw new RegistryAuthError(`${registry} answered 401 with no challenge this client can answer`, { check: 'registry.auth' });
  };

  /**
   * One request. A 401 is answered once with the challenge's credentials;
   * `Authorization` only ever goes to the registry's own origin.
   */
  const request = async (path, init = {}, { scope, what = path } = {}) => {
    const url = path.startsWith('http') ? path : `${base}${path}`;
    if (new URL(url).protocol === 'http:' && !plain) throw new RegistryError(`${registry} sent a plain HTTP location, ${url}; refusing to follow it`, { check: 'registry.upload' });
    const sameOrigin = new URL(url).origin === origin;
    const attempt = (authorization) => {
      const headers = { ...(init.headers ?? {}) };
      if (authorization && sameOrigin) headers.authorization = authorization;
      return send(url, { ...init, headers }, what);
    };
    let response = await attempt(current);
    if (response.status === 401 && sameOrigin) {
      current = await answerChallenge(response, scope);
      response = await attempt(current);
      if (response.status === 401) {
        await response.body?.cancel();
        throw new RegistryAuthError(`${registry} refused the credentials for ${what}`, { check: 'registry.auth' });
      }
    }
    if (response.status === 403) {
      const { message } = await errorText(response);
      throw new RegistryAuthError(`${registry} denied ${what}${message ? `: ${message}` : ''}`, { check: 'registry.denied' });
    }
    return response;
  };

  const pullScope = `repository:${repository}:pull`;
  const pushScope = `repository:${repository}:pull,push`;
  const v2 = `/v2/${repository}`;

  const failure = async (response, what) => {
    const { codes, message } = await errorText(response);
    if (codes.includes('DIGEST_INVALID')) return new DigestMismatchError(`${registry} refused ${what}: ${message}`, { check: 'digest.blob' });
    if (response.status === 404) return new ManifestNotFoundError(`${what} does not exist in ${registry}/${repository}${message ? `: ${message}` : ''}`, { check: 'registry.manifest' });
    return new RegistryError(`${what}: ${registry} answered ${response.status}${message ? `: ${message}` : ''}`, { check: 'registry.status', details: { status: response.status, codes } });
  };

  const client = {
    kind: 'registry',
    registry,
    repository,

    async hasBlob(digest) {
      const response = await request(`${v2}/blobs/${digest}`, { method: 'HEAD' }, { scope: pullScope, what: `blob ${digest}` });
      await response.body?.cancel();
      if (response.ok) return true;
      if (response.status === 404) return false;
      throw await failure(response, `blob ${digest}`);
    },

    /** Upload one blob with a monolithic `PUT`. Returns false when the registry already had it. */
    async putBlob(digest, bytes) {
      const what = `blob ${digest}`;
      const head = await request(`${v2}/blobs/${digest}`, { method: 'HEAD' }, { scope: pushScope, what });
      await head.body?.cancel();
      if (head.ok) return false;
      const started = await request(`${v2}/blobs/uploads/`, { method: 'POST', headers: { 'content-length': '0' } }, { scope: pushScope, what });
      if (started.status !== 202) throw await failure(started, `starting the upload of ${what}`);
      await started.body?.cancel();
      const location = started.headers.get('location');
      if (!location) throw new RegistryError(`${registry} started an upload without a location`, { check: 'registry.upload' });
      const url = new URL(location, base);
      url.searchParams.set('digest', digest);
      const done = await request(url.href, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) }, body: bytes }, { scope: pushScope, what });
      if (done.status !== 201) throw await failure(done, what);
      await done.body?.cancel();
      return true;
    },

    /** Read one blob, bounded by its descriptor's size, and verify its `sha256`. */
    async getBlob(digest, size) {
      const what = `blob ${digest}`;
      const response = await request(`${v2}/blobs/${digest}`, { headers: { accept: '*/*' } }, { scope: pullScope, what });
      if (!response.ok) throw await failure(response, what);
      const bytes = await readLimited(response, size, what);
      if (bytes.length !== size) throw new DigestMismatchError(`${what} is ${bytes.length} bytes, its descriptor says ${size}`, { check: 'digest.blob' });
      const actual = await digestOf(bytes);
      if (actual !== digest) throw new DigestMismatchError(`${registry} sent ${actual} for ${what}`, { check: 'digest.blob' });
      return bytes;
    },

    /** Put a manifest at a digest or a tag. `indexed` is whether the registry took over its `subject`. */
    async putManifest(reference_, bytes, mediaType = MANIFEST_MEDIA_TYPE) {
      const what = `manifest ${reference_}`;
      const response = await request(`${v2}/manifests/${reference_}`, { method: 'PUT', headers: { 'content-type': mediaType, 'content-length': String(bytes.length) }, body: bytes }, { scope: pushScope, what });
      if (response.status !== 201) throw await failure(response, what);
      await response.body?.cancel();
      const expected = await digestOf(bytes);
      const returned = response.headers.get('docker-content-digest');
      if (returned && returned !== expected) throw new DigestMismatchError(`${registry} stored ${what} as ${returned}, its bytes are ${expected}`, { check: 'digest.manifest' });
      return { digest: expected, indexed: response.headers.has('oci-subject') };
    },

    /** Read a manifest by tag or digest. Its `sha256` is recomputed and checked against every claim about it. */
    async getManifest(reference_) {
      const what = `manifest ${reference_}`;
      const response = await request(`${v2}/manifests/${reference_}`, { headers: { accept: MANIFEST_ACCEPT } }, { scope: pullScope, what });
      if (!response.ok) throw await failure(response, what);
      const bytes = await readLimited(response, MAX_MANIFEST_BYTES, what);
      const digest = await digestOf(bytes);
      if (reference_.startsWith('sha256:') && reference_ !== digest) throw new DigestMismatchError(`${registry} sent ${digest} for ${what}`, { check: 'digest.manifest' });
      const claimed = response.headers.get('docker-content-digest');
      if (claimed && claimed !== digest) throw new DigestMismatchError(`${registry} says ${what} is ${claimed}, its bytes are ${digest}`, { check: 'digest.manifest' });
      return { bytes, digest, mediaType: response.headers.get('content-type') };
    },

    /** Every referrer of a manifest, as descriptors: the API when there is one, else the tag schema. */
    async listReferrers(digest) {
      const what = `the referrers of ${digest}`;
      const response = await request(`${v2}/referrers/${digest}`, { headers: { accept: INDEX_MEDIA_TYPE } }, { scope: pullScope, what });
      if (response.ok) {
        const contentType = response.headers.get('content-type') ?? '';
        const body = await readLimited(response, MAX_MANIFEST_BYTES, what);
        if (JSON_TYPES.test(contentType)) {
          const index = parseIndex(body);
          if (index) return index.manifests;
        }
        throw new RegistryError(`${registry} answered the referrers API with something that is not an index`, { check: 'registry.status' });
      }
      const status = response.status;
      await response.body?.cancel();
      if (!fallbackAllowed) throw new ReferrersUnsupportedError(`${registry} has no referrers API (${status}), and the tag fallback is turned off`, { check: 'referrers.api', details: { status } });
      return readFallback(digest, 'referrers.tag');
    },

    /**
     * Record referrers the registry did not index, in the tag schema's index.
     * Called only when a manifest `PUT` came back without `OCI-Subject`.
     */
    async attachReferrers(digest, descriptors) {
      if (descriptors.length === 0) return;
      if (!fallbackAllowed) throw new ReferrersUnsupportedError(`${registry} did not index the referrer's subject, and the tag fallback is turned off`, { check: 'referrers.api' });
      const manifests = await readFallback(digest, 'referrers.tag');
      const known = new Set(manifests.map((d) => d.digest));
      const added = descriptors.filter((d) => !known.has(d.digest));
      if (added.length === 0) return;
      const bytes = canonicalBytes({ ...emptyIndex(), manifests: [...manifests, ...added] });
      try {
        await client.putManifest(referrersTag(digest), bytes, INDEX_MEDIA_TYPE);
      } catch (cause) {
        if (cause instanceof RegistryAuthError) throw cause;
        throw new ReferrersUnsupportedError(`${registry} has no referrers API and refused the fallback tag ${referrersTag(digest)}: ${cause.message}`, { check: 'referrers.tag', cause });
      }
    },

    /** The tag a BLAKE3 fingerprint is reachable through. */
    async resolveFingerprint(fingerprint) {
      return fingerprintTag(fingerprint);
    },

    /** Put the tags of a holo: its name and its fingerprint. */
    async tagManifest(tag, bytes, _annotations, mediaType = MANIFEST_MEDIA_TYPE) {
      return client.putManifest(tag, bytes, mediaType);
    },
  };

  const parseIndex = (bytes) => {
    try {
      const index = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      return index && Array.isArray(index.manifests) ? index : null;
    } catch {
      return null;
    }
  };

  const readFallback = async (digest, check) => {
    const tag = referrersTag(digest);
    const what = `the referrers tag ${tag}`;
    const response = await request(`${v2}/manifests/${tag}`, { headers: { accept: INDEX_MEDIA_TYPE } }, { scope: pullScope, what });
    if (response.status === 404) {
      await response.body?.cancel();
      return [];
    }
    if (!response.ok) {
      const { message } = await errorText(response);
      throw new ReferrersUnsupportedError(`${registry} has no referrers API and could not read ${what} (${response.status}${message ? `: ${message}` : ''})`, { check });
    }
    // The spec says to start from empty when the tag holds something else.
    return parseIndex(await readLimited(response, MAX_MANIFEST_BYTES, what))?.manifests ?? [];
  };

  return client;
}
