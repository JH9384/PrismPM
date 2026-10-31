/**
 * The studio's server (issue #288): the page's own files, the current state, a
 * stream of states, and the bytes of the judged holo. Loopback only, read only,
 * and every response carries a policy that lets the page reach this origin and
 * nothing else, so the studio cannot come to depend on the network by accident.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { fail } from './errors.mjs';

/** The studio's port. Fixed and documented; `--port` moves it, and a port in use is an error, never a silent move. */
export const STUDIO_PORT = 4100;

/** The only address the studio binds: verdicts on work in progress are not for the network. */
export const STUDIO_HOST = '127.0.0.1';

const asset = (path) => fileURLToPath(new URL(path, import.meta.url));
const JAVASCRIPT = 'text/javascript; charset=utf-8';

/** Every file the page may load. A closed table, so no request path ever reaches the file system. */
export const ASSETS = Object.freeze({
  '/': { file: asset('./studio/index.html'), type: 'text/html; charset=utf-8' },
  '/studio.css': { file: asset('./studio/studio.css'), type: 'text/css; charset=utf-8' },
  '/studio.mjs': { file: asset('./studio/studio.mjs'), type: JAVASCRIPT },
  '/tabs.mjs': { file: asset('./studio/tabs.mjs'), type: JAVASCRIPT },
  '/verify.mjs': { file: asset('./vendor/verify.mjs'), type: JAVASCRIPT },
});

/** The page may talk to its own origin and load nothing from anywhere else. */
export const CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const HEADERS = Object.freeze({
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
});

const TEXT = 'text/plain; charset=utf-8';

/**
 * Serve the studio. `getState` and `getHolo` read the loop; `publish` on the
 * result sends a new state to every open page.
 *
 * @param {{ getState: () => object, getHolo: () => Uint8Array | null, port?: number, host?: string, heartbeatMs?: number }} options
 * @returns {Promise<{ url: string, port: number, publish: (state: object) => void, close: () => Promise<void> }>}
 */
export async function serveStudio({ getState, getHolo, port = STUDIO_PORT, host = STUDIO_HOST, heartbeatMs = 15000 }) {
  const streams = new Set();
  let bound = port;

  // A page on another site can point its own name at this address; only a loopback Host reaches the studio.
  const allowedHost = (value) => value === `localhost:${bound}` || value === `127.0.0.1:${bound}`;

  const send = (response, status, type, body) => {
    response.writeHead(status, { ...HEADERS, 'content-type': type, 'content-length': Buffer.byteLength(body) });
    response.end(body);
  };

  const server = createServer(async (request, response) => {
    if (!allowedHost(request.headers.host)) return send(response, 421, TEXT, 'The studio answers on its loopback address only.\n');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('allow', 'GET, HEAD');
      return send(response, 405, TEXT, 'The studio is read only.\n');
    }
    const { pathname } = new URL(request.url, 'http://studio.invalid');
    if (pathname === '/api/state') return send(response, 200, 'application/json; charset=utf-8', JSON.stringify(getState()));
    if (pathname === '/api/events') {
      response.writeHead(200, { ...HEADERS, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' });
      response.write(`data: ${JSON.stringify(getState())}\n\n`);
      streams.add(response);
      request.on('close', () => streams.delete(response));
      return undefined;
    }
    if (pathname === '/holo') {
      const bytes = getHolo();
      if (!bytes) return send(response, 404, TEXT, 'No judged holo yet.\n');
      response.writeHead(200, { ...HEADERS, 'content-type': 'application/octet-stream', 'content-length': bytes.length });
      return response.end(bytes);
    }
    // Answered so a browser's automatic request is not an error in the console.
    if (pathname === '/favicon.ico') {
      response.writeHead(204, HEADERS);
      return response.end();
    }
    const entry = Object.hasOwn(ASSETS, pathname) ? ASSETS[pathname] : null;
    if (!entry) return send(response, 404, TEXT, 'Not found.\n');
    return send(response, 200, entry.type, await readFile(entry.file));
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolveListen);
  }).catch((error) => {
    if (error.code === 'EADDRINUSE') fail('dev.port', `port ${port} is in use. The studio does not move by itself; stop what holds it, or pass --port <n>`);
    throw error;
  });

  bound = server.address().port;
  const heartbeat = setInterval(() => {
    for (const stream of streams) stream.write(': keep-alive\n\n');
  }, heartbeatMs);
  heartbeat.unref();

  return {
    url: `http://localhost:${bound}`,
    port: bound,
    publish(state) {
      const text = `data: ${JSON.stringify(state)}\n\n`;
      for (const stream of streams) stream.write(text);
    },
    close() {
      clearInterval(heartbeat);
      for (const stream of streams) stream.end();
      streams.clear();
      return new Promise((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
    },
  };
}
