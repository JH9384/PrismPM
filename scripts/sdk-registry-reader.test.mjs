// Actual TLS transport controls; no image execution or SDK acceptance claim.
import assert from 'node:assert/strict';
import {execFile, execFileSync} from 'node:child_process';
import {createHash, X509Certificate} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createServer as httpServer} from 'node:http';
import {createServer, globalAgent} from 'node:https';
import {createServer as tcpServer} from 'node:net';
import {networkInterfaces, tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import {createSdkRegistryReader, sdkRegistryCertificate, readSdkRegistryManifest, closeSdkRegistryReader} from './sdk-registry-reader.mjs';

const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const body = Buffer.from('{"original":"SDK registry transport test, not SDK evidence"}');
const host = Object.values(networkInterfaces()).flat().find(row => row.family === 'IPv4' && !row.internal)?.address;
assert(host, 'actual non-loopback private container address required');

function certificate(t, name, san = host) {
  const directory = mkdtempSync(join(tmpdir(), 'prism-owned-registry-tls-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const key = join(directory, 'key.pem'), ca = join(directory, 'ca.pem');
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=' + name, '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'subjectAltName=IP:' + san, '-keyout', key, '-out', ca],
  {timeout: 15000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe']});
  return {key: readFileSync(key), cert: readFileSync(ca), directory, keyPath: key, caPath: ca};
}

function leaf(t, ca) {
  const key = join(ca.directory, 'leaf.key'), csr = join(ca.directory, 'leaf.csr'), cert = join(ca.directory, 'leaf.pem');
  execFileSync('/usr/bin/openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=owned-registry-leaf',
    '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'subjectAltName=IP:' + host,
    '-addext', 'extendedKeyUsage=serverAuth', '-keyout', key, '-out', csr],
  {timeout: 15000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe']});
  execFileSync('/usr/bin/openssl', ['x509', '-req', '-in', csr, '-CA', ca.caPath, '-CAkey', ca.keyPath,
    '-set_serial', '2', '-days', '1', '-sha256', '-copy_extensions', 'copy', '-out', cert],
  {timeout: 15000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe']});
  return {key: readFileSync(key), cert: readFileSync(cert)};
}

async function server(t, handler, tls) {
  const instance = tls === false ? tcpServer(handler) : tls ? createServer(tls, handler) : httpServer(handler);
  const sockets = new Set(); let connections = 0, connects = 0;
  instance.on('connection', socket => { connections++; sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  instance.on('connect', (_, socket) => {
    connects++; socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  // The client deliberately exercises invalid TLS without accepting it.
  instance.on('tlsClientError', () => {});
  await new Promise((resolve, reject) => { instance.once('error', reject); instance.listen(0, host, resolve); });
  t.after(async () => {
    const closed = [...sockets].map(socket => new Promise(resolve => socket.once('close', resolve)));
    for (const socket of sockets) socket.destroy();
    let deadline;
    try {
      await Promise.race([Promise.all([...closed, new Promise(resolve => instance.close(resolve))]),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('actual test-server retirement deadline exceeded')), 5000); })]);
    } finally { clearTimeout(deadline); }
    assert.equal(sockets.size, 0, 'actual server sockets retired');
  });
  return {authority: host + ':' + instance.address().port, sockets,
    counters: () => ({connections, connects})};
}

const image = (authority, bytes = body, repository = 'prismpm/sdk') => authority + '/' + repository + '@' + sha(bytes);
async function read(t, authority, ca, options, bytes = body) {
  const reference = image(authority, bytes), handle = createSdkRegistryReader(reference, ca, options);
  try { return await readSdkRegistryManifest(handle, reference); }
  finally { assert.equal(closeSdkRegistryReader(handle).agent_retired, true); }
}

test('owned-registry selection, CA and private handles fail closed before network I/O', t => {
  const tls = certificate(t, 'selection');
  for (const authority of ['localhost:443', '127.0.0.1:443', '0.0.0.0:443', '169.254.1.1:443',
    '8.8.8.8:443', '010.0.0.1:443', host + ':0', host + ':06543', host + ':65536']) {
    assert.throws(() => createSdkRegistryReader(image(authority), tls.cert));
  }
  for (const reference of ['https://' + image(host + ':443'), image(host + ':443', body, '../sdk'),
    image(host + ':443', body, 'prism//sdk'), image(host + ':443') + '?query', image(host + ':443') + '#fragment']) {
    assert.throws(() => createSdkRegistryReader(reference, tls.cert));
  }
  for (const ca of [null, '', Buffer.alloc(0), Buffer.alloc(65537), Buffer.from('not a certificate'),
    Buffer.concat([tls.cert, tls.cert])]) assert.throws(() => createSdkRegistryReader(image(host + ':443'), ca));
  for (const options of [{timeout_ms: 45001}, {timeout_ms: 0}, {timeout_ms: null}, {maximum: 4194305}, {maximum: 0}, {maximum: null}, {signal: {}}]) {
    assert.throws(() => createSdkRegistryReader(image(host + ':443'), tls.cert, options));
  }
  let getterRan = false;
  for (const options of [{ca: tls.cert}, {transport() {}}, [], Object.create({maximum: 1}),
    {get maximum() { getterRan = true; return 1; }}, {[Symbol('hidden')]: true}]) {
    assert.throws(() => createSdkRegistryReader(image(host + ':443'), tls.cert, options));
  }
  assert.equal(getterRan, false, 'option accessors cannot execute');
  for (const handle of [{}, null, Object.freeze({image: image(host + ':443')})]) {
    assert.throws(() => sdkRegistryCertificate(handle)); assert.throws(() => closeSdkRegistryReader(handle));
  }
});

test('actual TLS reads exact original index and child bytes with immutable explicit CA and no ambient proxy', async t => {
  const ca = certificate(t, 'positive'), tls = leaf(t, ca), other = Buffer.from('{"child":"original bytes"}');
  let calls = 0, proxyCalls = 0;
  const proxy = await server(t, (_, res) => { proxyCalls++; res.end('must not be used'); });
  const endpoint = await server(t, (req, res) => {
    calls++; assert.equal(req.headers.authorization, undefined); assert.equal(req.headers['accept-encoding'], 'identity');
    assert.equal(req.method, 'GET');
    const bytes = req.url === '/v2/prismpm/sdk/manifests/' + sha(body) ? body : other;
    assert.equal(req.url, '/v2/prismpm/sdk/manifests/' + sha(bytes));
    res.writeHead(200, {'Content-Length': bytes.length, 'Docker-Content-Digest': sha(bytes)}); res.end(bytes);
  }, tls);
  const previous = Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY',
    'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']) process.env[key] = 'http://' + proxy.authority;
  process.env.NO_PROXY = ''; process.env.NODE_USE_ENV_PROXY = '1'; process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const originalGlobalCa = globalAgent.options.ca;
  globalAgent.options.ca = Buffer.from('not trusted');
  t.after(() => { if (originalGlobalCa === undefined) delete globalAgent.options.ca; else globalAgent.options.ca = originalGlobalCa; });
  const supplied = Buffer.from(ca.cert), options = {maximum: 4194304, timeout_ms: 45000};
  const handle = createSdkRegistryReader(image(endpoint.authority), supplied, options);
  options.maximum = 1; options.timeout_ms = 1;
  supplied.fill(0); const copy = sdkRegistryCertificate(handle); assert.deepEqual(copy, ca.cert); copy.fill(0);
  assert.deepEqual(sdkRegistryCertificate(handle), ca.cert);
  assert.deepEqual(await readSdkRegistryManifest(handle, image(endpoint.authority)), body);
  assert.deepEqual(await readSdkRegistryManifest(handle, image(endpoint.authority, other)), other);
  await assert.rejects(readSdkRegistryManifest(handle, image(endpoint.authority, other)), /only original SDK/);
  const retired = closeSdkRegistryReader(handle);
  assert.equal(retired.requests, 2); assert.equal(retired.request_socket_retirement, 'observed'); assert(retired.agent_retired);
  assert.equal(retired.reads.length, 2);
  for (const [index, row] of retired.reads.entries()) {
    const bytes = index === 0 ? body : other;
    assert.equal(row.reference, image(endpoint.authority, bytes)); assert.equal(row.byte_length, bytes.length);
    assert.equal(row.sha256, sha(bytes).slice(7)); assert(row.request_close_observed && row.socket_close_observed);
    assert(row.tls.authorized); assert.equal(row.tls.remote_address, host);
    assert.equal(row.tls.remote_port, Number(endpoint.authority.split(':')[1]));
    assert(['TLSv1.2', 'TLSv1.3'].includes(row.tls.protocol));
    assert.equal(row.tls.peer_certificate_sha256, sha(new X509Certificate(tls.cert).raw).slice(7));
  }
  assert.throws(() => sdkRegistryCertificate(handle)); assert.throws(() => closeSdkRegistryReader(handle));
  await assert.rejects(readSdkRegistryManifest(handle, image(endpoint.authority)));
  assert.equal(calls, 2); assert.equal(proxyCalls, 0);
  assert.deepEqual(proxy.counters(), {connections: 0, connects: 0});
  // Startup-enabled ambient proxy: first prove this exact proxy is reachable
  // and used by the standard global agent, then prove the private reader is not.
  const environment = {...process.env};
  const control = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    `import https from 'node:https';
     const req=https.get(${JSON.stringify('https://' + endpoint.authority + '/control')},res=>{res.resume();process.exitCode=2;});
     req.on('error',()=>process.stdout.write('proxy-rejected'));`],
  {env: environment, timeout: 5000, maxBuffer: 65536});
  assert.equal(control.stdout, 'proxy-rejected');
  assert.deepEqual(proxy.counters(), {connections: 1, connects: 1});
  const child = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    `const {createSdkRegistryReader,readSdkRegistryManifest,closeSdkRegistryReader}=await import(${JSON.stringify(new URL('./sdk-registry-reader.mjs', import.meta.url).href)});
     const image=${JSON.stringify(image(endpoint.authority))};
     const handle=createSdkRegistryReader(image,Buffer.from(${JSON.stringify(ca.cert.toString('base64'))},'base64'));
     try{process.stdout.write(await readSdkRegistryManifest(handle,image));}finally{closeSdkRegistryReader(handle);}`],
  {env: environment, timeout: 5000, maxBuffer: 65536});
  assert.equal(child.stdout, body.toString()); assert.equal(calls, 3); assert.equal(proxyCalls, 0);
  assert.deepEqual(proxy.counters(), {connections: 1, connects: 1}, 'private reader makes no TCP or CONNECT contact with ambient proxy');
});

test('actual TLS rejects wrong CA and SAN despite ambient TLS bypass', async t => {
  const tls = certificate(t, 'expected'), other = certificate(t, 'wrong-ca'), wrongSan = certificate(t, 'wrong-san', '127.0.0.1');
  let calls = 0;
  const endpoint = await server(t, (_, res) => { calls++; res.end(body); }, tls);
  const badIdentity = await server(t, (_, res) => { calls++; res.end(body); }, wrongSan);
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  t.after(() => { if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous; });
  await assert.rejects(read(t, endpoint.authority, other.cert), /certificate|self-signed/i);
  await assert.rejects(read(t, badIdentity.authority, wrongSan.cert), /altname|IP.*certificate/i);
  assert.equal(calls, 0, 'rejected TLS cannot reach HTTP handlers');
});

test('actual TLS rejects every redirect and authentication challenge without target requests', async t => {
  const tls = certificate(t, 'redirects'); let targets = 0, status = 301, location;
  const target = await server(t, (_, res) => { targets++; res.end(body); }, tls);
  const plaintext = await server(t, (_, res) => { targets++; res.end(body); });
  const endpoint = await server(t, (_, res) => { res.writeHead(status, {Location: location,
    'WWW-Authenticate': 'Bearer realm="https://' + target.authority + '/token"'}); res.end(); }, tls);
  for (const scheme of ['https', 'http']) for (status of [301, 302, 303, 307, 308, 401, 403]) {
    location = scheme + '://' + (scheme === 'https' ? target.authority : plaintext.authority) + '/target';
    await assert.rejects(read(t, endpoint.authority, tls.cert), /redirects and authentication challenges refused/);
  }
  assert.equal(targets, 0);
  await assert.rejects(read(t, plaintext.authority, tls.cert), /wrong version number|EPROTO|SSL/i);
  assert.equal(targets, 0, 'TLS client never downgrades to plaintext');
});

test('authority, repository, original index ordering and overlapping reads cannot be substituted', async t => {
  const tls = certificate(t, 'binding'); let calls = 0;
  const endpoint = await server(t, (_, res) => { calls++; res.end(body); }, tls);
  const handle = createSdkRegistryReader(image(endpoint.authority), tls.cert);
  const otherPort = host + ':' + (Number(endpoint.authority.split(':')[1]) === 65535 ? 65534 : 65535);
  await assert.rejects(readSdkRegistryManifest(handle, image(otherPort)), /authority changed/);
  await assert.rejects(readSdkRegistryManifest(handle, image(endpoint.authority, body, 'other/sdk')), /repository changed/);
  await assert.rejects(readSdkRegistryManifest(handle, image(endpoint.authority, Buffer.from('wrong index'))), /index digest required first/);
  const pending = readSdkRegistryManifest(handle, image(endpoint.authority));
  await assert.rejects(readSdkRegistryManifest(handle, image(endpoint.authority)), /idle SDK registry reader/);
  assert.throws(() => closeSdkRegistryReader(handle), /idle SDK registry reader/);
  assert.deepEqual(await pending, body);
  await assert.rejects(readSdkRegistryManifest(handle, image(endpoint.authority)), /child digest required second/);
  assert.equal(closeSdkRegistryReader(handle).requests, 1); assert.equal(calls, 1);
});

test('actual response bounds reject oversized headers, declared and streamed bodies, encoding, digests and truncation', async t => {
  const tls = certificate(t, 'bounds'); let mode;
  const endpoint = await server(t, (_, res) => {
    if (mode === 'valid') res.end(body);
    if (mode === 'headers') { res.setHeader('x-overflow', 'x'.repeat(20000)); res.end(body); }
    if (mode === 'declared') { res.setHeader('Content-Length', '1025'); res.end(body); }
    if (mode === 'streamed') { res.write(Buffer.alloc(1025)); res.end(); }
    if (mode === 'encoding') { res.setHeader('Content-Encoding', 'gzip'); res.end(body); }
    if (mode === 'digest-header') { res.setHeader('Docker-Content-Digest', sha('wrong')); res.end(body); }
    if (mode === 'digest-body') res.end('wrong');
    if (mode === 'truncated') { res.setHeader('Content-Length', body.length + 1); res.write(body); res.socket.end(); }
  }, tls);
  mode = 'valid'; assert.deepEqual(await read(t, endpoint.authority, tls.cert, {maximum: 1024}), body);
  for (const [kind, error] of [['headers', /Header overflow|HPE_HEADER_OVERFLOW/], ['declared', /response length exceeds bound/],
    ['streamed', /streamed response exceeds bound/], ['encoding', /unencoded SDK metadata/],
    ['digest-header', /digest header differs/], ['digest-body', /metadata digest differs/], ['truncated', /response truncated/]]) {
    mode = kind;
    await assert.rejects(read(t, endpoint.authority, tls.cert, {maximum: 1024}), error, mode);
  }
});

test('actual header and body stalls expire one shared acquisition deadline and retire sockets', async t => {
  const tls = certificate(t, 'deadline'); let mode = 'headers';
  const endpoint = await server(t, (_, res) => {
    if (mode === 'body') { res.writeHead(200); res.write(body.subarray(0, 1)); }
  }, tls);
  for (mode of ['headers', 'body']) {
    const start = performance.now();
    await assert.rejects(read(t, endpoint.authority, tls.cert, {timeout_ms: 200}), /abort|deadline/i);
    assert(performance.now() - start < 5500, 'deadline plus original retirement bound');
  }
  const handshake = await server(t, () => {}, false);
  await assert.rejects(read(t, handshake.authority, tls.cert, {timeout_ms: 200}), /abort|deadline/i);
  assert.equal(handshake.counters().connections, 1, 'actual stalled TLS connection was attempted');
  const child = Buffer.from('delayed child bytes'); let childRequests = 0;
  const pair = await server(t, (req, res) => {
    if (req.url.endsWith(sha(body))) res.end(body);
    else {
      assert(req.url.endsWith(sha(child))); childRequests++;
      const delayed = setTimeout(() => res.end(child), 600);
      res.once('close', () => clearTimeout(delayed));
    }
  }, tls);
  const shared = createSdkRegistryReader(image(pair.authority), tls.cert, {timeout_ms: 1000});
  assert.deepEqual(await readSdkRegistryManifest(shared, image(pair.authority)), body);
  await new Promise(resolve => setTimeout(resolve, 600));
  await assert.rejects(readSdkRegistryManifest(shared, image(pair.authority, child)), /abort|deadline/i);
  assert.equal(childRequests, 1, 'child was requested under the first read remaining budget, not a reset deadline');
  assert.equal(closeSdkRegistryReader(shared).requests, 2);
  mode = 'headers';
  const handle = createSdkRegistryReader(image(endpoint.authority), tls.cert, {timeout_ms: 100});
  await new Promise(resolve => setTimeout(resolve, 150));
  await assert.rejects(readSdkRegistryManifest(handle, image(endpoint.authority)), /acquisition deadline exceeded/);
  assert.equal(closeSdkRegistryReader(handle).requests, 0, 'expired budget never opens a socket');
});

test('actual in-flight and prior cancellation cannot publish partial metadata or reuse failed handles', async t => {
  const tls = certificate(t, 'cancellation'); let entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const endpoint = await server(t, (_, res) => { res.writeHead(200); res.write(body.subarray(0, 1)); entered(); }, tls);
  const controller = new AbortController(), handle = createSdkRegistryReader(image(endpoint.authority), tls.cert, {signal: controller.signal});
  const pending = readSdkRegistryManifest(handle, image(endpoint.authority));
  await reached; controller.abort(Error('owned cancellation'));
  await assert.rejects(pending, /abort|cancellation/i);
  await assert.rejects(readSdkRegistryManifest(handle, image(endpoint.authority)), /actual idle SDK registry reader/);
  assert.equal(closeSdkRegistryReader(handle).requests, 1);
  const already = createSdkRegistryReader(image(endpoint.authority), tls.cert, {signal: controller.signal});
  await assert.rejects(readSdkRegistryManifest(already, image(endpoint.authority)), /owned cancellation/);
  assert.equal(closeSdkRegistryReader(already).requests, 0);
});

function stateMachineUnit(source, {lateEof = false, uncertainClose = false} = {}) {
  // Explicit event-state units, not real TLS, socket retirement or SDK evidence.
  // The eight tests above retain their actual transports and complete controls.
  const handles = new WeakMap(), handle = Object.freeze({}), selectedImage = image('10.0.0.1:443');
  const state = {selected: {authority: '10.0.0.1:443', host: '10.0.0.1', port: 443, repository: 'prismpm/sdk', digest: sha(body)},
    agent: {requests: {}, sockets: {}, freeSockets: {}, destroy() {}}, end: 1, maximum: 1024,
    count: 0, busy: false, closed: false, failed: false, retirementUncertain: false, reads: []};
  handles.set(handle, state); let clock = 0;
  const request = (_options, callback) => {
    const req = new EventEmitter(), socket = new EventEmitter(), res = new EventEmitter();
    Object.assign(socket, {encrypted: true, authorized: true, remoteAddress: '10.0.0.1', remotePort: 443,
      getProtocol: () => 'TLSv1.3', getPeerCertificate: () => ({raw: Buffer.from('explicit unit peer, not actual certificate')})});
    let requestClosed = false, socketClosed = false, responseDestroyed = false;
    socket.destroy = () => { if (!uncertainClose && !socketClosed) { socketClosed = true; socket.emit('close'); } };
    req.destroy = () => { if (!uncertainClose && !requestClosed) { requestClosed = true; req.emit('close'); } socket.destroy(); };
    Object.assign(res, {socket, statusCode: 200, headers: {'content-length': String(body.length)}, complete: true,
      destroy() { if (!responseDestroyed) { responseDestroyed = true; res.emit('aborted'); } }});
    req.end = () => queueMicrotask(() => {
      req.emit('socket', socket); callback(res); res.emit('data', body);
      if (lateEof) clock = 2;
      res.emit('end');
    });
    return req;
  };
  const begin = source.indexOf('export async function readSdkRegistryManifest(');
  const close = source.indexOf('export function closeSdkRegistryReader(', begin);
  assert(begin >= 0 && close > begin);
  const selected = source.slice(source.indexOf('function selection('), source.indexOf('export function createSdkRegistryReader('));
  const functions = selected + source.slice(begin).replaceAll('export ', '') + '\n({readSdkRegistryManifest,closeSdkRegistryReader});';
  const owner = runInNewContext(functions, {assert, Buffer, AbortController, handles, request, isIP: value => value === '10.0.0.1' ? 4 : 0,
    performance: {now: () => clock}, hash: bytes => sha(bytes).slice(7), setTimeout, clearTimeout, RETIREMENT: 5000, structuredClone});
  return {owner, handle, state, selectedImage};
}

test('unit late-EOF counterfactual cannot beat the monotonic completion deadline', async () => {
  const source = readFileSync(new URL('./sdk-registry-reader.mjs', import.meta.url), 'utf8');
  const original = stateMachineUnit(source, {lateEof: true});
  await assert.rejects(original.owner.readSdkRegistryManifest(original.handle, original.selectedImage), /acquisition deadline exceeded/);
  assert.equal(original.state.reads.length, 0); original.owner.closeSdkRegistryReader(original.handle);
  const anchor = "assert.equal('sha256:' + hash(bytes), requested.digest, 'original SDK metadata digest differs');\n              assert(performance.now() <= state.end, 'SDK registry acquisition deadline exceeded');";
  assert.equal(source.split(anchor).length, 2, 'one exact post-hash completion guard');
  const changed = source.replace(anchor, anchor.split('\n')[0]); assert.notEqual(changed, source);
  const mutant = stateMachineUnit(changed, {lateEof: true});
  assert.deepEqual(await mutant.owner.readSdkRegistryManifest(mutant.handle, mutant.selectedImage), body,
    'executed omission mutant incorrectly admits late original bytes');
  mutant.owner.closeSdkRegistryReader(mutant.handle);
});

test('unit uncertain retirement cannot become a success receipt through empty agent maps', async () => {
  const source = readFileSync(new URL('./sdk-registry-reader.mjs', import.meta.url), 'utf8');
  const original = stateMachineUnit(source, {uncertainClose: true});
  await assert.rejects(original.owner.readSdkRegistryManifest(original.handle, original.selectedImage), /request\/socket retirement unproven/);
  assert(original.state.retirementUncertain, 'actual retirement-timeout path permanently records uncertainty');
  assert.equal(original.state.reads.length, 0);
  assert.throws(() => original.owner.closeSdkRegistryReader(original.handle), /retirement remains unproven/);
  const anchor = "  assert(!state.retirementUncertain, 'SDK registry request/socket retirement remains unproven');";
  assert.equal(source.split(anchor).length, 2);
  const changed = source.replace(anchor, ''), mutant = stateMachineUnit(changed);
  mutant.state.count = 1; mutant.state.failed = true; mutant.state.retirementUncertain = true;
  assert.equal(mutant.owner.closeSdkRegistryReader(mutant.handle).request_socket_retirement, 'observed',
    'executed omission mutant falsely claims retirement from empty agent maps');
});
