// A small in-process OCI registry for the client's tests: the referrers API or only its tag fallback, three kinds of
// authentication, and ways to lie. It stores what it is given and checks digests the way distribution does.
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function readAll(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

const errorBody = (code, message) => JSON.stringify({ errors: [{ code, message }] });

/**
 * @param {{ referrers?: 'api' | 'fallback' | 'broken', auth?: 'none' | 'bearer' | 'basic', username?: string, password?: string, tamper?: { blob?: boolean, manifestHeader?: boolean }, refuseTags?: RegExp }} [options]
 */
export async function startRegistry(options = {}) {
  const state = {
    referrers: options.referrers ?? 'api',
    auth: options.auth ?? 'none',
    username: options.username ?? 'alice',
    password: options.password ?? 'secret',
    tamper: { ...(options.tamper ?? {}) },
    refuseTags: options.refuseTags ?? null,
    blobs: new Map(),
    manifests: new Map(),
    tags: new Map(),
    log: [],
    tokenRequests: [],
  };
  const uploads = new Map();
  const validBearer = (header) => typeof header === 'string' && header.startsWith('Bearer token-');
  const tokenScope = (header) => Buffer.from(header.slice('Bearer token-'.length), 'base64url').toString();
  const allowed = (request, write) => {
    if (state.auth === 'none') return true;
    const header = request.headers.authorization;
    if (state.auth === 'basic') return header === `Basic ${Buffer.from(`${state.username}:${state.password}`).toString('base64')}`;
    if (!validBearer(header)) return false;
    return write ? tokenScope(header).split(':')[2]?.includes('push') : true;
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://registry');
    const send = (status, body = '', headers = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    state.log.push(`${request.method} ${url.pathname}`);

    // The token endpoint: anyone may have a pull token; a push token needs the password.
    if (url.pathname === '/token') {
      const scope = url.searchParams.get('scope') ?? '';
      const authorization = request.headers.authorization ?? null;
      state.tokenRequests.push({ scope, service: url.searchParams.get('service'), authorization });
      const good = authorization === `Basic ${Buffer.from(`${state.username}:${state.password}`).toString('base64')}`;
      if (authorization !== null && !good) return send(401, errorBody('UNAUTHORIZED', 'bad credentials'));
      if (scope.includes('push') && !good) return send(401, errorBody('UNAUTHORIZED', 'authentication required'));
      return send(200, JSON.stringify({ token: `token-${Buffer.from(scope).toString('base64url')}` }));
    }

    const match = url.pathname.match(/^\/v2\/(.+?)\/(blobs\/uploads\/?(.*)|blobs\/(.+)|manifests\/(.+)|referrers\/(.+))$/);
    if (!match) return send(url.pathname === '/v2/' ? 200 : 404, '{}');
    const [, repository, , uploadId, blobDigest, manifestRef, referrersDigest] = match;
    const write = request.method === 'POST' || request.method === 'PUT';
    if (!allowed(request, write)) {
      const scope = `repository:${repository}:${write ? 'pull,push' : 'pull'}`;
      const challenge = state.auth === 'basic' ? 'Basic realm="registry"' : `Bearer realm="http://${request.headers.host}/token",service="registry.test",scope="${scope}"`;
      return send(401, errorBody('UNAUTHORIZED', 'authentication required'), { 'www-authenticate': challenge });
    }

    if (uploadId !== undefined && request.method === 'POST') {
      const id = randomUUID();
      uploads.set(id, true);
      return send(202, '', { location: `/v2/${repository}/blobs/uploads/${id}?state=opaque`, 'docker-upload-uuid': id });
    }
    if (uploadId !== undefined && request.method === 'PUT') {
      const body = await readAll(request);
      const digest = url.searchParams.get('digest');
      if (!uploads.has(uploadId)) return send(404, errorBody('BLOB_UPLOAD_UNKNOWN', 'no such upload'));
      if (sha(body) !== digest) return send(400, errorBody('DIGEST_INVALID', 'provided digest did not match uploaded content'));
      state.blobs.set(digest, body);
      return send(201, '', { location: `/v2/${repository}/blobs/${digest}`, 'docker-content-digest': digest });
    }
    if (blobDigest !== undefined) {
      const blob = state.blobs.get(blobDigest);
      if (!blob) return send(404, errorBody('BLOB_UNKNOWN', 'blob unknown'));
      const bytes = state.tamper.blob ? Buffer.concat([blob.subarray(0, blob.length - 1), Buffer.from([blob[blob.length - 1] ^ 1])]) : blob;
      return send(200, bytes, { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length), 'docker-content-digest': blobDigest });
    }
    if (manifestRef !== undefined && request.method === 'PUT') {
      const body = await readAll(request);
      if (state.refuseTags?.test(manifestRef)) return send(400, errorBody('TAG_INVALID', 'tag refused'));
      const digest = sha(body);
      if (manifestRef.startsWith('sha256:') && manifestRef !== digest) return send(400, errorBody('DIGEST_INVALID', 'manifest digest differs'));
      const manifest = JSON.parse(body.toString('utf8'));
      for (const descriptor of [...(manifest.layers ?? []), ...(manifest.config ? [manifest.config] : [])]) {
        if (!state.blobs.has(descriptor.digest)) return send(400, errorBody('MANIFEST_BLOB_UNKNOWN', `blob ${descriptor.digest} unknown`));
      }
      state.manifests.set(digest, { body, contentType: request.headers['content-type'] });
      if (!manifestRef.startsWith('sha256:')) state.tags.set(`${repository}:${manifestRef}`, digest);
      const headers = { 'docker-content-digest': digest, location: `/v2/${repository}/manifests/${digest}` };
      if (manifest.subject && state.referrers === 'api') headers['oci-subject'] = manifest.subject.digest;
      return send(201, '', headers);
    }
    if (manifestRef !== undefined) {
      const digest = manifestRef.startsWith('sha256:') ? manifestRef : state.tags.get(`${repository}:${manifestRef}`);
      const stored = digest && state.manifests.get(digest);
      if (!stored) return send(404, errorBody('MANIFEST_UNKNOWN', 'manifest unknown'));
      return send(200, stored.body, { 'content-type': stored.contentType, 'docker-content-digest': state.tamper.manifestHeader ? sha(Buffer.from('another')) : digest, 'content-length': String(stored.body.length) });
    }
    if (referrersDigest !== undefined) {
      if (state.referrers === 'broken') return send(500, errorBody('UNKNOWN', 'broken'));
      if (state.referrers === 'fallback') return send(404, errorBody('NAME_UNKNOWN', 'no referrers API'));
      const manifests = [];
      for (const [digest, { body }] of state.manifests) {
        let manifest;
        try {
          manifest = JSON.parse(body.toString('utf8'));
        } catch {
          continue;
        }
        if (manifest.subject?.digest === referrersDigest) manifests.push({ mediaType: manifest.mediaType, digest, size: body.length, artifactType: manifest.artifactType, annotations: manifest.annotations });
      }
      return send(200, JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests }), { 'content-type': 'application/vnd.oci.image.index.v1+json' });
    }
    return send(405);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    host: `127.0.0.1:${port}`,
    state,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
    /** Store a manifest by hand, for a registry that lies. */
    plant(repository, tag, body) {
      const bytes = Buffer.from(body);
      const digest = sha(bytes);
      state.manifests.set(digest, { body: bytes, contentType: 'application/vnd.oci.image.manifest.v1+json' });
      if (tag) state.tags.set(`${repository}:${tag}`, digest);
      return digest;
    },
    plantBlob(body) {
      const bytes = Buffer.from(body);
      const digest = sha(bytes);
      state.blobs.set(digest, bytes);
      return digest;
    },
  };
}
