// Private owned-registry metadata transport. TLS identity is not construction
// provenance, image execution, SDK acceptance or release authority.
import assert from 'node:assert/strict';
import {createHash, X509Certificate} from 'node:crypto';
import {Agent, request} from 'node:https';
import {isIP} from 'node:net';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAXIMUM = 4 * 1024 * 1024;
const DEADLINE = 45000;
const RETIREMENT = 5000;
const handles = new WeakMap();

function selection(image) {
  assert.equal(typeof image, 'string');
  const match = /^(\d+\.\d+\.\d+\.\d+):([1-9][0-9]{0,4})\/([a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*)@(sha256:[a-f0-9]{64})$/.exec(image);
  assert(match && image.length <= 512, 'exact owned private IPv4 registry reference required');
  const [, host, port, repository, digest] = match;
  assert.equal(isIP(host), 4); assert(Number(port) <= 65535);
  const [a, b] = host.split('.').map(Number);
  assert(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168),
    'owned non-loopback private registry authority required');
  return {authority: host + ':' + port, host, port: Number(port), repository, digest};
}

export function createSdkRegistryReader(image, certificateAuthority, options = {}) {
  assert(options && (Object.getPrototypeOf(options) === Object.prototype || Object.getPrototypeOf(options) === null),
    'closed SDK registry reader options required');
  const fields = Object.getOwnPropertyDescriptors(options);
  for (const key of Reflect.ownKeys(fields)) {
    assert(['timeout_ms', 'maximum', 'signal'].includes(key) && Object.hasOwn(fields[key], 'value'),
      'closed data-only SDK registry reader options required');
  }
  const timeout_ms = fields.timeout_ms?.value === undefined ? DEADLINE : fields.timeout_ms.value;
  const maximum = fields.maximum?.value === undefined ? MAXIMUM : fields.maximum.value;
  const signal = fields.signal?.value;
  assert(Buffer.isBuffer(certificateAuthority) && certificateAuthority.length > 0 && certificateAuthority.length <= 65536,
    'bounded explicit SDK registry CA required');
  assert(Number.isSafeInteger(timeout_ms) && timeout_ms > 0 && timeout_ms <= DEADLINE);
  assert(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= MAXIMUM);
  assert(signal === undefined || signal instanceof AbortSignal);
  const selected = selection(image), ca = Buffer.from(certificateAuthority);
  assert.match(ca.toString('ascii'), /^-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/=]+\n)+-----END CERTIFICATE-----\n?$/,
    'one explicit PEM CA certificate required');
  const certificate = new X509Certificate(ca);
  assert(certificate.ca, 'SDK registry trust must be a CA certificate');
  assert.equal(certificate.subject, certificate.issuer, 'owned registry CA must be self-issued');
  assert(certificate.verify(certificate.publicKey), 'owned registry CA self-signature differs');
  // Explicit CA and a private agent exclude default roots, ambient proxies,
  // globalAgent mutations, client credentials and custom connection hooks.
  const agent = new Agent({ca, rejectUnauthorized: true, minVersion: 'TLSv1.2',
    keepAlive: false, maxSockets: 1, maxFreeSockets: 0, maxCachedSessions: 0, proxyEnv: {}});
  const handle = Object.freeze({image, authority: selected.authority, ca_sha256: hash(ca)});
  handles.set(handle, {selected, ca, agent, signal, end: performance.now() + timeout_ms,
    maximum, count: 0, busy: false, closed: false, failed: false, retirementUncertain: false, reads: []});
  return handle;
}

export function sdkRegistryCertificate(handle) {
  const state = handles.get(handle);
  assert(state && !state.closed && !state.failed, 'actual live SDK registry reader required');
  return Buffer.from(state.ca);
}

export async function readSdkRegistryManifest(handle, image) {
  const state = handles.get(handle);
  assert(state && !state.closed && !state.failed && !state.busy, 'actual idle SDK registry reader required');
  const requested = selection(image);
  assert.equal(requested.authority, state.selected.authority, 'SDK registry authority changed');
  assert.equal(requested.repository, state.selected.repository, 'SDK registry repository changed');
  assert(state.count < 2, 'only original SDK index and selected child reads permitted');
  if (state.count === 0) assert.equal(requested.digest, state.selected.digest, 'original SDK index digest required first');
  else assert.notEqual(requested.digest, state.selected.digest, 'selected SDK child digest required second');
  state.signal?.throwIfAborted();
  const remaining = Math.floor(state.end - performance.now());
  assert(remaining > 0, 'SDK registry acquisition deadline exceeded');
  state.busy = true; state.count++;
  let req, socket, response, result, failure, tls, requestClosed = false, socketClosed = false;
  const controller = new AbortController();
  const abort = () => controller.abort(state.signal.reason);
  state.signal?.addEventListener('abort', abort, {once: true});
  if (state.signal?.aborted) abort();
  let retire;
  const retired = new Promise(resolve => { retire = resolve; });
  const observedClose = () => { if (requestClosed && (!socket || socketClosed)) retire(); };
  const timer = setTimeout(() => controller.abort(Error('SDK registry acquisition deadline exceeded')), remaining);
  try {
    result = await new Promise((resolve, reject) => {
      req = request({protocol: 'https:', hostname: requested.host, port: requested.port, family: 4,
        method: 'GET', path: '/v2/' + requested.repository + '/manifests/' + requested.digest,
        agent: state.agent, signal: controller.signal, maxHeaderSize: 16384,
        headers: {Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
          'Accept-Encoding': 'identity', Connection: 'close'}}, res => {
        response = res;
        // Destruction may synchronously emit `aborted`. Preserve the original
        // observed rejection rather than replacing it with cleanup fallout.
        const fail = error => { reject(error); res.destroy(); req.destroy(error); };
        try {
          assert(performance.now() <= state.end, 'SDK registry acquisition deadline exceeded');
          assert(res.socket === socket && socket.encrypted && socket.authorized, 'authorized SDK registry TLS required');
          assert.equal(socket.remoteAddress, requested.host); assert.equal(socket.remotePort, requested.port);
          const protocol = socket.getProtocol(), peer = socket.getPeerCertificate();
          assert(['TLSv1.2', 'TLSv1.3'].includes(protocol));
          assert(Buffer.isBuffer(peer.raw) && peer.raw.length > 0 && peer.raw.length <= 65536);
          tls = {protocol, peer_certificate_sha256: hash(peer.raw), authorized: true,
            remote_address: socket.remoteAddress, remote_port: socket.remotePort};
          assert.equal(res.statusCode, 200, 'SDK registry redirects and authentication challenges refused');
          assert(res.headers['content-encoding'] === undefined || res.headers['content-encoding'] === 'identity',
            'original unencoded SDK metadata required');
          const length = res.headers['content-length'];
          assert(length === undefined || (/^(?:0|[1-9][0-9]*)$/.test(length) && Number(length) <= state.maximum),
            'SDK registry response length exceeds bound');
          const claimed = res.headers['docker-content-digest'];
          assert(claimed === undefined || claimed === requested.digest, 'SDK registry response digest header differs');
          const parts = []; let size = 0;
          res.on('data', chunk => {
            try {
              assert(performance.now() <= state.end, 'SDK registry acquisition deadline exceeded');
              size += chunk.length; assert(size <= state.maximum, 'SDK registry streamed response exceeds bound'); parts.push(chunk);
            }
            catch (error) { fail(error); }
          });
          res.once('error', reject);
          res.once('aborted', () => reject(Error('SDK registry response truncated')));
          res.once('end', () => {
            try {
              assert(res.complete, 'complete SDK registry response required');
              if (length !== undefined) assert.equal(size, Number(length), 'SDK registry response length differs');
              const bytes = Buffer.concat(parts, size);
              assert.equal('sha256:' + hash(bytes), requested.digest, 'original SDK metadata digest differs');
              assert(performance.now() <= state.end, 'SDK registry acquisition deadline exceeded');
              state.signal?.throwIfAborted();
              resolve(bytes);
            } catch (error) { fail(error); }
          });
        } catch (error) { fail(error); }
      });
      req.once('error', reject);
      req.once('close', () => { requestClosed = true; observedClose(); });
      req.once('socket', value => {
        socket = value;
        socket.once('close', () => { socketClosed = true; observedClose(); });
      });
      req.end();
    });
  } catch (error) { failure = error; }
  finally {
    clearTimeout(timer); state.signal?.removeEventListener('abort', abort);
    response?.destroy(); req?.destroy(); socket?.destroy();
    if (!req) { requestClosed = true; observedClose(); }
    let closeTimer;
    try {
      await Promise.race([retired, new Promise((_, reject) => {
        closeTimer = setTimeout(() => reject(Error('SDK registry request/socket retirement unproven')), RETIREMENT);
      })]);
    } catch (error) {
      state.retirementUncertain = true;
      failure = failure ? new AggregateError([failure, error], 'SDK registry read and retirement failed') : error;
    }
    finally { clearTimeout(closeTimer); state.busy = false; }
  }
  if (state.signal?.aborted) failure ??= state.signal.reason ?? Error('SDK registry read cancelled');
  if (failure) { state.failed = true; state.agent.destroy(); throw failure; }
  state.reads.push({reference: image, byte_length: result.length, sha256: hash(result), tls,
    request_close_observed: requestClosed, socket_close_observed: socketClosed});
  return result;
}

export function closeSdkRegistryReader(handle) {
  const state = handles.get(handle);
  assert(state && !state.closed && !state.busy, 'actual idle SDK registry reader required for retirement');
  state.closed = true; state.agent.destroy();
  assert(!state.retirementUncertain, 'SDK registry request/socket retirement remains unproven');
  assert.equal(Object.keys(state.agent.requests).length, 0, 'SDK registry queued requests remain');
  assert.equal(Object.keys(state.agent.sockets).length, 0, 'SDK registry active sockets remain');
  assert.equal(Object.keys(state.agent.freeSockets).length, 0, 'SDK registry idle sockets remain');
  return {requests: state.count, request_socket_retirement: 'observed', agent_retired: true,
    reads: structuredClone(state.reads)};
}
