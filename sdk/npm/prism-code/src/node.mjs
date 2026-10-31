/**
 * prism-code/node — Node-only conveniences: open an application from a path and
 * serve its view with the `/_hologram/intent` endpoint a HOLOVIEW page posts to
 * (hologram-live `hologram-view-surface`: `application.invoke`, at most 16
 * outputs).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadArchive, loadClosure } from './index.mjs';
import { fail } from './errors.mjs';
import { parseManifest, manifestCapabilities, MANIFEST_FILE } from './manifest.mjs';
import { parseCapabilities } from './capabilities.mjs';

export { resolveProviders, releaseProviders, PROVIDER_MESSAGES, PROVIDER_MESSAGES_ENV, PROVIDER_TIMEOUT_MS } from './providers.mjs';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.holo': 'application/octet-stream',
};

function toPath(source) {
  if (source instanceof URL) return fileURLToPath(source);
  if (typeof source === 'string' && source.startsWith('file:')) return fileURLToPath(source);
  return resolve(source);
}

/** Read a closure directory into a file map (regular files at the top level only). */
export async function readClosureDirectory(directory) {
  const files = new Map();
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    if ((await stat(path)).isFile()) files.set(name, new Uint8Array(await readFile(path)));
  }
  return files;
}

/**
 * Open a `.holo` file or a closure directory. `options.capabilities` is a
 * capability file, as a path or a parsed value, and `options.capabilitySet`
 * the set to apply (#279); with no file the application is granted nothing.
 */
export async function fromFile(source, options = {}) {
  const path = toPath(source);
  const info = await stat(path).catch(() => fail('load.path', `${path} does not exist`));
  let capabilities = options.capabilities ?? null;
  if (typeof capabilities === 'string' || capabilities instanceof URL) {
    const file = toPath(capabilities);
    capabilities = new Uint8Array(await readFile(file).catch(() => fail('capabilities.path', `${file} does not exist`)));
  }
  const grant = { capabilities, capabilitySet: options.capabilitySet };
  if (info.isDirectory()) {
    const files = await readClosureDirectory(path);
    let model = options.model ?? null;
    if (typeof model === 'string') model = JSON.parse(await readFile(toPath(model), 'utf8'));
    return loadClosure(files, (name) => import(pathToFileURL(join(path, name)).href), { model, ...grant });
  }
  return loadArchive(new Uint8Array(await readFile(path)), grant);
}

/**
 * Read `prism.toml` from a project directory (#280), with the overlay
 * `prism.<target>.toml` merged when `options.target` is given and that file
 * exists. A capability file the manifest names is read relative to the
 * directory. Resolves to the result of `parseManifest` plus `directory`,
 * `files` (the manifest files read, in merge order) and `grant`, the
 * `{ capabilities, capabilitySet }` options `fromFile` and `load` take.
 */
export async function readManifest(directory = '.', options = {}) {
  const root = toPath(directory);
  const target = options.target ?? null;
  const main = join(root, MANIFEST_FILE);
  const text = await readFile(main).catch(() => fail('manifest.path', `${main} does not exist`));
  const files = [MANIFEST_FILE];
  let overlay = null;
  if (target !== null) {
    const name = `prism.${target}.toml`;
    overlay = await readFile(join(root, name)).then(
      (bytes) => {
        files.push(name);
        return new Uint8Array(bytes);
      },
      () => null,
    );
  }
  const parsed = parseManifest(new Uint8Array(text), { target, overlay });
  const { capabilities, capabilitySet, file } = manifestCapabilities(parsed.manifest);
  let grant = { capabilities, capabilitySet };
  if (file !== null) {
    const path = join(root, file);
    const bytes = await readFile(path).catch(() => fail('capabilities.path', `${path} does not exist; capabilities.file in ${MANIFEST_FILE} names it`));
    grant = { capabilities: parseCapabilities(new Uint8Array(bytes)), capabilitySet };
  }
  return Object.freeze({ ...parsed, directory: root, files: Object.freeze(files), grant: Object.freeze(grant) });
}

const INTENT_VERSION = 1;
const INTENT_NAME = 'application.invoke';
const MAX_INTENT_OUTPUTS = 16;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

function readBody(request, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolveBody(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/**
 * Serve `app.view` as static files and answer `POST /_hologram/intent` by
 * dispatching the payload. Resolves to `{ server, url, close }`.
 */
export async function serve(app, { port = 0, host = '127.0.0.1' } = {}) {
  const files = app.view.files;
  const entry = app.view.entry ?? 'index.html';
  const bodyLimit = 65536 + (app.limits?.request ?? 65536);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'POST' && url.pathname === '/_hologram/intent') {
      let outputs;
      try {
        const body = JSON.parse((await readBody(request, bodyLimit)).toString('utf8'));
        if (body.version !== INTENT_VERSION || body.name !== INTENT_NAME || typeof body.payload !== 'string') {
          throw new Error('not an application.invoke intent');
        }
        const result = await app.dispatch(encoder.encode(body.payload));
        outputs = [decoder.decode(result)].slice(0, MAX_INTENT_OUTPUTS);
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ version: INTENT_VERSION, error: String(error.message ?? error) }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ version: INTENT_VERSION, outputs }));
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    const name = url.pathname === '/' ? entry : decodeURIComponent(url.pathname.slice(1));
    const content = files.get(name);
    if (!content) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(name)] ?? 'application/octet-stream',
      'content-length': content.length,
      'cache-control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : Buffer.from(content));
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolveListen);
  });
  const address = server.address();
  const urlOf = `http://${host}:${address.port}/`;
  return {
    server,
    url: urlOf,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}

// Signing and checking attestations (#272). The sigstore packages they need are optional and load on first use.
export { experimental_attest, experimental_verifyAttestations, experimental_verifyBundle, GITHUB_ACTIONS_ISSUER } from './attest.mjs';

// Moving holos to and from a registry or a local store (#292).
export { experimental_push, experimental_pull, openEndpoint, MAX_HOLO_BYTES, PUSH_SCHEMA, PULL_SCHEMA } from './push-pull.mjs';
export { parseReference, formatReference } from './oci-reference.mjs';
export { createRegistryClient, parseChallenge, isLoopback } from './oci-registry.mjs';
export { dockerCredentials } from './oci-auth.mjs';
export { openStore } from './oci-store.mjs';
export {
  holoManifest,
  referrerManifest,
  registryStatement,
  registryStatements,
  fingerprintTag,
  referrersTag,
  HOLO_MEDIA_TYPE,
  MANIFEST_MEDIA_TYPE,
  INDEX_MEDIA_TYPE,
  EMPTY_DESCRIPTOR,
  ANNOTATION,
  CREATED,
} from './oci-manifest.mjs';
