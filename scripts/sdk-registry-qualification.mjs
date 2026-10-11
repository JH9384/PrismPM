// Real native transport qualification, not SDK execution or release acceptance.
import assert from 'node:assert/strict';
import {executeOwnedSdkCommand} from './sdk-command-owner.mjs';
import {createHash, randomBytes, X509Certificate} from 'node:crypto';
import {createServer as createHttpServer} from 'node:http';
import {createServer as createHttpsServer, request} from 'node:https';
import {closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, opendirSync,
  readFileSync, readdirSync, readlinkSync, readSync, realpathSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireOwnedImageMetadata, inspectLoadedImage, readRuntimeLock} from './sdk-vv-check.mjs';
import {createSdkRegistryReader, readSdkRegistryManifest, closeSdkRegistryReader} from './sdk-registry-reader.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = bytes => 'sha256:' + hash(bytes);
const INDEX = 'application/vnd.oci.image.index.v1+json';
const MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const CONFIG = 'application/vnd.oci.image.config.v1+json';
const OWNER = 'org.uor.prismpm.registry-qualification';
const SOCKET = 'unix:///var/run/docker.sock';

export function probeQualificationRegistry(hostname, port, ca, signal) {
  signal?.throwIfAborted();
  let timer;
  return new Promise((resolve, reject) => {
    const req = request({hostname, port, path: '/v2/', ca, rejectUnauthorized: true,
      agent: false, timeout: 2000, signal}, res => {
      const fail = error => {req.destroy(error); reject(error);};
      res.once('error', fail);
      res.once('aborted', () => fail(Error('registry readiness response aborted')));
      res.once('close', () => {if (!res.complete) fail(Error('registry readiness response incomplete'));});
      res.once('end', () => {
        if (!res.complete) fail(Error('registry readiness response incomplete'));
        else if (res.statusCode !== 200) fail(Error('registry not ready'));
        else resolve();
      });
      res.resume();
    });
    req.once('error', reject);
    req.once('timeout', () => req.destroy(Error('registry readiness timeout')));
    timer = setTimeout(() => req.destroy(Error('registry readiness wall-clock timeout')), 2000);
    req.end();
  }).finally(() => clearTimeout(timer));
}

export function handoffQualificationEvidence(root) {
  assert.equal(realpathSync(root), root); assert.equal(basename(root), 'public');
  const pending = [{path: root, depth: 0}], directories = [], files = [];
  let entries = 1, total = 0;
  while (pending.length) {
    const {path, depth} = pending.pop(); assert(depth < 16 && path.length < 4096);
    const stat = lstatSync(path); assert(!stat.isSymbolicLink(), 'public evidence aliases refused');
    if (stat.isDirectory()) {
      directories.push(path); const directory = opendirSync(path, {bufferSize: 32});
      try {for (let entry; (entry = directory.readSync()) !== null;) {
        assert(++entries <= 4096, 'bounded public handoff inventory');
        pending.push({path: join(path, entry.name), depth: depth + 1});
      }} finally {directory.closeSync();}
    } else {
      assert(stat.isFile() && stat.nlink === 1 && stat.size <= 4 * 1024 ** 2);
      total += stat.size; assert(total <= 64 * 1024 ** 2);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = fstatSync(fd); assert.equal(before.dev, stat.dev); assert.equal(before.ino, stat.ino);
        assert(before.isFile() && before.nlink === 1 && before.size === stat.size);
        fchmodSync(fd, 0o644); const after = fstatSync(fd); assert.equal(after.mode & 0o7777, 0o644);
        for (const key of ['dev', 'ino', 'nlink', 'size', 'mtimeMs']) assert.equal(after[key], before[key]);
        files.push({path: path.slice(root.length + 1), size: after.size, mode: 0o644});
      } finally {closeSync(fd);}
    }
  }
  for (const path of directories.reverse()) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {assert(fstatSync(fd).isDirectory()); fchmodSync(fd, 0o755); assert.equal(fstatSync(fd).mode & 0o7777, 0o755);}
    finally {closeSync(fd);}
  }
  return {entries, total, root_mode: 0o755, files: files.sort((a, b) => a.path.localeCompare(b.path))};
}

export function writeFinalPublicEvidence(root, name, value) {
  assert.equal(basename(root), 'public'); assert.equal(realpathSync(root), root);
  assert.match(name, /^[a-z0-9-]+\.json$/);
  const fd = openSync(join(root, name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o644);
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  try {
    fchmodSync(fd, 0o644); writeFileSync(fd, bytes);
    const actual = fstatSync(fd); assert.equal(actual.mode & 0o7777, 0o644); assert.equal(actual.size, bytes.length);
    return hash(bytes);
  }
  finally {closeSync(fd);}
}

export function captureQualificationFiles(paths, root = process.cwd()) {
  assert(Array.isArray(paths) && paths.length > 0 && paths.length < 20000);
  assert.equal(new Set(paths).size, paths.length); assert.equal(realpathSync(root), root);
  return paths.map(path => {
    assert(typeof path === 'string' && path.length < 4096 && !path.includes('\0') && !path.startsWith('/'));
    const parts = path.split('/'); assert(parts.every(part => part && part !== '.' && part !== '..'));
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part); const stat = lstatSync(parent);
      assert(stat.isDirectory() && !stat.isSymbolicLink(), 'tracked source parent alias refused');
    }
    const absolute = join(root, path), before = lstatSync(absolute);
    const unchanged = after => {
      for (const key of ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(after[key], before[key]);
    };
    if (before.isSymbolicLink()) {
      const bytes = readlinkSync(absolute, {encoding: 'buffer'}); assert(bytes.length > 0 && bytes.length <= 4096);
      unchanged(lstatSync(absolute));
      return {path, mode: before.mode, bytes: bytes.length, sha256: hash(bytes), link_base64: bytes.toString('base64')};
    }
    assert(before.isFile() && before.nlink === 1 && before.size <= 64 * 1024 ** 2, 'bounded unaliased regular source required');
    const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      unchanged(fstatSync(fd)); const bytes = Buffer.alloc(before.size + 1); let size = 0;
      while (size < bytes.length) {const count = readSync(fd, bytes, size, bytes.length - size, null); if (!count) break; size += count;}
      assert.equal(size, before.size); unchanged(fstatSync(fd)); unchanged(lstatSync(absolute));
      return {path, mode: before.mode, bytes: size, sha256: hash(bytes.subarray(0, size))};
    } finally {closeSync(fd);}
  });
}

export async function executeQualificationProcess(program, args, {timeout = 60000, signal, onOutput} = {}) {
  assert(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 300000);
  const result = await executeOwnedSdkCommand(program, args, {profile: 'qualification', timeout, signal, onOutput,
    environment: {PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C'}, limit: 4 * 1024 ** 2, aggregate: true});
  return {...result, descendants_absent: result.retirement.descendants_absent,
    process_retirement: result.retirement, retirement: 'actual-subreaper-exhaustion-observed'};
}
export function qualificationRegistryAddress(subnet) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(subnet); assert(match);
  const parts = match.slice(1, 5).map(Number), prefix = Number(match[5]);
  assert(parts.every(value => value >= 0 && value <= 255) && prefix >= 16 && prefix <= 28);
  assert(parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
  const base = parts.reduce((value, part) => value * 256 + part, 0), width = 2 ** (32 - prefix);
  assert.equal(base % width, 0); const address = base + 10;
  return [24, 16, 8, 0].map(bits => Math.floor(address / 2 ** bits) % 256).join('.');
}

export async function allocateQualificationNetwork({own, docker, owned, prefix, nonce}) {
  const probeName = prefix + '-allocation', name = prefix + '-network';
  const probe = await own('network', probeName, ['network', 'create', '--label', OWNER + '=' + nonce, probeName]);
  assert.equal(probe.Driver, 'bridge'); assert.equal(probe.IPAM.Config.length, 1);
  const subnet = probe.IPAM.Config[0].Subnet; qualificationRegistryAddress(subnet);
  assert.deepEqual(probe.Containers, {});
  assert.equal(probe.Labels[OWNER], nonce);
  const entry = owned.find(row => row.kind === 'network' && row.name === probeName);
  assert(entry && entry.id === probe.Id);
  await docker(['network', 'rm', probe.Id]);
  for (const reference of [probe.Id, probeName]) {
    const absent = await docker(['network', 'inspect', reference], {allowFailure: true});
    assert.notEqual(absent.status, 0); assert.match(absent.stderr.toString(), /No such|not found/i);
  }
  entry.retired = true;
  const actual = await own('network', name, ['network', 'create', '--subnet', subnet,
    '--label', OWNER + '=' + nonce, name]);
  assert.equal(actual.Driver, 'bridge'); assert.equal(actual.IPAM.Config.length, 1);
  assert.equal(actual.IPAM.Config[0].Subnet, subnet); assert.deepEqual(actual.Containers, {});
  return {probe, actual, subnet, probe_name_and_id_absent: true};
}

export function validateSanFailure(result) {
  assert.equal(result.signal, null); assert.notEqual(result.status, 0);
  assert.match(result.stderr.toString(), /x509:.*(?:cannot validate|not valid for|doesn't contain|is valid for .+, not )/);
}

export function validateQualificationResources(bytes, limit) {
  assert(Buffer.isBuffer(bytes) && bytes.length < 4096 && Number.isSafeInteger(limit) && limit > 0);
  const lines = bytes.toString().trim().split('\n'), maximum = lines.shift(), peak = lines.shift();
  assert.match(maximum, /^[1-9][0-9]*$/); assert.match(peak, /^[1-9][0-9]*$/);
  assert.equal(Number(maximum), limit); assert(Number(peak) <= limit);
  const entries = lines.map(line => {const match = /^([a-z_]+) ([0-9]+)$/.exec(line); assert(match); return [match[1], Number(match[2])];});
  assert.equal(new Set(entries.map(([name]) => name)).size, entries.length);
  const events = Object.fromEntries(entries);
  for (const name of ['max', 'oom', 'oom_kill']) assert(Object.hasOwn(events, name), 'required actual memory event missing');
  for (const value of Object.values(events)) assert.equal(value, 0, 'actual memory event cannot be waived');
  return {maximum: Number(maximum), peak: Number(peak), events};
}

export function createTransportLayout(directory, arch, revision) {
  assert(['amd64', 'arm64'].includes(arch)); assert.match(revision, /^[a-f0-9]{40}$/);
  assert(!lstatSync(directory, {throwIfNoEntry: false}), 'fresh fixture layout required');
  mkdirSync(join(directory, 'blobs', 'sha256'), {recursive: true, mode: 0o700});
  const put = (value, mediaType) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const descriptor = {mediaType, digest: digest(bytes), size: bytes.length};
    writeFileSync(join(directory, 'blobs', 'sha256', descriptor.digest.slice(7)), bytes, {flag: 'wx'});
    return {bytes, descriptor};
  };
  // Deliberately non-executable scratch image. Never an SDK or application.
  const config = put({architecture: arch, os: 'linux', rootfs: {type: 'layers', diff_ids: []},
    config: {Labels: {'org.opencontainers.image.revision': revision,
      'org.uor.prismpm.scope': 'transport-fixture-only'}}}, CONFIG);
  const child = put({schemaVersion: 2, mediaType: MANIFEST, config: config.descriptor, layers: []}, MANIFEST);
  const index = put({schemaVersion: 2, mediaType: INDEX,
    manifests: [{...child.descriptor, platform: {os: 'linux', architecture: arch}}]}, INDEX);
  writeFileSync(join(directory, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}\n', {flag: 'wx'});
  writeFileSync(join(directory, 'index.json'), JSON.stringify({schemaVersion: 2,
    manifests: [{...index.descriptor, annotations: {'org.opencontainers.image.ref.name': 'qualification'}}]}) + '\n', {flag: 'wx'});
  return {config, child, index};
}

export async function acquireQualificationMetadata(image, ca, arch, signal) {
  const reader = createSdkRegistryReader(image, ca, {signal});
  let result, failure;
  try {
    result = await acquireOwnedImageMetadata(reader, image, arch);
  } catch (error) {
    failure = error;
  }
  // Exactly one retirement attempt; never mask uncertainty with a second close.
  const retirement = closeSdkRegistryReader(reader);
  if (failure) {failure.retirement = retirement; throw failure;}
  return {...result, transport: retirement};
}

async function run(destination) {
  const environment = process.env, arch = environment.QUALIFICATION_ARCH;
  assert(['amd64', 'arm64'].includes(arch));
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, arch === 'amd64' ? 'x64' : 'arm64');
  assert.equal(process.version, 'v22.23.2');
  assert.equal(environment.GITHUB_ACTIONS, 'true'); assert.equal(environment.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(environment.RUNNER_OS, 'Linux'); assert.equal(environment.RUNNER_ARCH, arch === 'amd64' ? 'X64' : 'ARM64');
  assert.match(environment.GITHUB_RUN_ID, /^[1-9][0-9]*$/); assert.match(environment.GITHUB_RUN_ATTEMPT, /^[1-9][0-9]*$/);
  const revision = environment.SOURCE_REVISION; assert.match(revision, /^[a-f0-9]{40}$/);
  destination = resolve(destination); assert.equal(realpathSync(destination), destination);
  assert.deepEqual(readdirSync(destination), [], 'fresh qualification destination required');
  const publicRoot = join(destination, 'public'), privateRoot = join(destination, 'private');
  mkdirSync(publicRoot, {mode: 0o700}); mkdirSync(privateRoot, {mode: 0o700});
  const dockerConfig = join(privateRoot, 'docker'); mkdirSync(dockerConfig, {mode: 0o700});
  writeFileSync(join(dockerConfig, 'config.json'), '{"auths":{}}\n', {flag: 'wx', mode: 0o600});
  const nonce = randomBytes(12).toString('hex'), prefix = 'prism-tls-' + nonce;
  const commands = [], owned = [], servers = [], results = [], resources = new Map();
  let interrupted, failure, connected = false, self, network, cleanupDeadline;
  const cancellation = new AbortController();
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => {
    interrupted ??= Error(signal); cancellation.abort(interrupted);
  }]);
  for (const [signal, handler] of signals) process.on(signal, handler);
  const execute = async (program, args, {timeout = 60000, allowFailure = false, cleaning = false} = {}) => {
    if (interrupted && !cleaning) throw interrupted;
    assert(commands.length < 512); const id = String(commands.length + 1).padStart(4, '0');
    if (cleaning) {timeout = Math.min(timeout, Math.floor(cleanupDeadline - performance.now())); assert(timeout > 0, 'global cleanup deadline expired');}
    const started = new Date().toISOString();
    let result, processFailure;
    try {result = await executeQualificationProcess(program, args, {timeout, signal: cleaning ? undefined : cancellation.signal});}
    catch (error) {processFailure = error; result = error.result; if (!result) throw error;}
    for (const [name, bytes] of [['stdout', result.stdout], ['stderr', result.stderr]]) writeFileSync(join(publicRoot, id + '.' + name), bytes, {flag: 'wx'});
    const record = {id, program, arguments: args, started, completed: new Date().toISOString(),
      status: result.status, signal: result.signal, timedOut: result.timedOut, overflow: result.overflow,
      aborted: result.aborted, pid: result.pid, retirement: result.retirement,
      descendants_absent: result.descendants_absent, orphaned: result.orphaned,
      process_retirement: result.process_retirement ?? result.retirement,
      close_observed: result.close_observed,
      stdout_sha256: hash(result.stdout), stderr_sha256: hash(result.stderr)};
    commands.push(record); writeFileSync(join(publicRoot, id + '.json'), JSON.stringify(record) + '\n', {flag: 'wx'});
    if (processFailure) throw processFailure;
    assert(!result.overflow && !result.timedOut && !result.aborted && !result.orphaned && result.descendants_absent && result.close_observed && result.signal === null,
      'actual bounded command and subreaper exhaustion required');
    if (!allowFailure) assert.equal(result.status, 0, result.stderr.toString().slice(-4096));
    if (interrupted && !cleaning) throw interrupted;
    return result;
  };
  const docker = (args, options) => execute('docker', ['--host', SOCKET, '--config', dockerConfig, ...args], options);
  const captureResources = async (name, cleaning = false) => {
    const actual = JSON.parse((await docker(['container', 'inspect', name], {cleaning})).stdout)[0];
    assert.equal(actual.Config.Labels?.[OWNER], nonce); assert.equal(actual.State.Running, true);
    assert.equal(actual.State.OOMKilled, false); assert(actual.HostConfig.Memory > 0);
    assert.equal(actual.HostConfig.MemorySwap, actual.HostConfig.Memory);
    const raw = (await docker(['exec', name, 'cat', '/sys/fs/cgroup/memory.max',
      '/sys/fs/cgroup/memory.peak', '/sys/fs/cgroup/memory.events'], {cleaning})).stdout;
    const record = {name, id: actual.Id, ...validateQualificationResources(raw, actual.HostConfig.Memory)};
    resources.set(name, record); writeFileSync(join(publicRoot, name + '-resources.json'), JSON.stringify(record) + '\n', {flag: 'wx'});
  };
  const own = async (kind, name, args) => {
    const prior = await docker([kind, 'inspect', name], {allowFailure: true});
    assert.notEqual(prior.status, 0, 'resource must not already exist');
    assert.match(prior.stderr.toString(), /No such|not found/i, 'only genuine resource absence permits creation');
    owned.push({kind, name});
    const created = await docker(args);
    const rows = JSON.parse((await docker([kind, 'inspect', name])).stdout);
    assert.equal(rows.length, 1); const row = rows[0];
    assert.equal((kind === 'container' ? row.Config.Labels : row.Labels)?.[OWNER], nonce);
    const entry = owned.at(-1); entry.id = kind === 'container' ? row.Id : kind === 'volume' ? row.Name : row.Id;
    assert(created.stdout.toString().trim().length > 0); return row;
  };
  const sourceSnapshot = async () => {
    const git = args => execute('git', ['-c', 'safe.directory=/source', ...args]);
    assert.equal((await git(['rev-parse', 'HEAD'])).stdout.toString().trim(), revision);
    assert.equal((await git(['status', '--porcelain'])).stdout.toString(), '');
    const paths = (await git(['ls-files', '-z'])).stdout.toString().split('\0').filter(Boolean);
    return captureQualificationFiles(paths);
  };
  const certificate = async (name, san, ca) => {
    const directory = join(privateRoot, name); mkdirSync(directory, {mode: 0o700});
    const key = join(directory, 'server.key'), cert = join(directory, 'server.crt');
    if (!ca) await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=' + name, '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', key, '-out', cert]);
    else {
      const csr = join(directory, 'server.csr');
      await execute('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=' + name,
        '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'extendedKeyUsage=serverAuth',
        '-addext', 'subjectAltName=' + san.map(ip => 'IP:' + ip).join(','), '-keyout', key, '-out', csr]);
      await execute('openssl', ['x509', '-req', '-in', csr, '-CA', ca.cert, '-CAkey', ca.key,
        '-set_serial', String(commands.length + 1), '-days', '1', '-sha256', '-copy_extensions', 'copy', '-out', cert]);
    }
    const bytes = readFileSync(cert); const parsed = new X509Certificate(bytes);
    assert.equal(parsed.ca, !ca); if (ca) assert(parsed.verify(new X509Certificate(readFileSync(ca.cert)).publicKey));
    writeFileSync(join(publicRoot, name + '.crt'), bytes, {flag: 'wx'});
    return {directory, key, cert, bytes};
  };
  const startServer = async (handler, host, tls) => {
    const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler), sockets = new Set();
    server.on('connection', socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
    server.on('tlsClientError', () => {});
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, host, resolve);});
    const row = {server, sockets, authority: host + ':' + server.address().port}; servers.push(row); return row;
  };
  const readMetadata = async (image, ca) => {
    const acquired = await acquireQualificationMetadata(image, ca, arch, cancellation.signal);
    assert.equal(acquired.transport.requests, 2); assert.equal(acquired.transport.agent_retired, true);
    return acquired;
  };
  let inputs;
  try {
    inputs = await sourceSnapshot(); writeFileSync(join(publicRoot, 'source-inputs.json'), JSON.stringify({revision, files: inputs}) + '\n', {flag: 'wx'});
    const lockBytes = readFileSync('sdk/vv-runtime.lock.json'), lock = readRuntimeLock(lockBytes);
    writeFileSync(join(publicRoot, 'runtime-inputs.lock.json'), lockBytes, {flag: 'wx'});
    const hostname = readFileSync('/etc/hostname', 'utf8').trim(); assert.match(hostname, /^[a-f0-9]{12}$/);
    self = JSON.parse((await docker(['container', 'inspect', hostname])).stdout)[0];
    assert(self.Id.startsWith(hostname)); assert(self.HostConfig.ReadonlyRootfs); assert.notEqual(self.HostConfig.NetworkMode, 'host');
    assert.equal(self.Config.Labels?.['org.uor.prismpm.registry-qualification-tools'], revision);
    writeFileSync(join(publicRoot, 'tool-container.json'), JSON.stringify(self) + '\n', {flag: 'wx'});
    assert.equal((await execute('docker', ['version', '--format', '{{.Client.Version}}'])).stdout.toString().trim(), '28.4.0');
    const buildx = await execute('docker', ['buildx', 'version']);
    assert.match(buildx.stdout.toString().trim(), /^github\.com\/docker\/buildx v0\.28\.0 b1281b81bba797b21d9eaf256e6a13eb14419836$/);
    await execute('oras', ['version']); await execute('openssl', ['version']);
    const python = await execute('/usr/bin/python3', ['-I', '-B', '-c', 'import sys; print(".".join(map(str,sys.version_info[:3])))']);
    assert.equal(python.stdout.toString().trim(), '3.11.2');
    for (const [tool, path] of [['node', '/usr/local/bin/node'], ['docker', '/usr/local/bin/docker'],
      ['oras', '/usr/local/bin/oras'], ['docker-buildx', '/usr/local/libexec/docker/cli-plugins/docker-buildx'], ['python3', '/usr/bin/python3']]) {
      const bytes = readFileSync(path);
      writeFileSync(join(publicRoot, tool + '-identity.json'), JSON.stringify({path,
        bytes: bytes.length, sha256: hash(bytes)}) + '\n', {flag: 'wx'});
    }
    network = prefix + '-network';
    const allocation = await allocateQualificationNetwork({own, docker, owned, prefix, nonce});
    writeFileSync(join(publicRoot, 'network-allocation.json'), JSON.stringify(allocation) + '\n', {flag: 'wx'});
    const networkRow = allocation.actual;
    assert.equal(networkRow.IPAM.Config.length, 1);
    const ip = qualificationRegistryAddress(networkRow.IPAM.Config[0].Subnet);
    // Mark uncertain connection before dispatch; cleanup checks the actual graph.
    connected = true; await docker(['network', 'connect', network, self.Id]);
    const attached = JSON.parse((await docker(['container', 'inspect', self.Id])).stdout)[0];
    const local = attached.NetworkSettings.Networks[network].IPAddress; assert.match(local, /^(?:10\.|172\.|192\.168\.)/);
    for (const id of ['distribution', 'dind']) await docker(['pull', '--platform', 'linux/' + arch, lock.images[id].reference], {timeout: 300000});
    const ca = await certificate('registry-ca', []), wrongCa = await certificate('unrelated-ca', []);
    const registryTls = join(privateRoot, 'registry-tls'); mkdirSync(registryTls, {mode: 0o700});
    const registry = prefix + '-registry';
    const reg = await own('container', registry, ['create', '--name', registry, '--label', OWNER + '=' + nonce,
      '--network', network, '--ip', ip, '--read-only', '--memory', '256m', '--memory-swap', '256m', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--tmpfs', '/var/lib/registry:rw,nosuid,nodev,size=128m',
      '--mount', 'type=bind,source=' + registryTls + ',target=/tls,readonly',
      '--env', 'REGISTRY_HTTP_ADDR=0.0.0.0:5000', '--env', 'REGISTRY_HTTP_TLS_CERTIFICATE=/tls/server.crt',
      '--env', 'REGISTRY_HTTP_TLS_KEY=/tls/server.key', lock.images.distribution.reference]);
    assert.equal(reg.NetworkSettings.Networks[network].IPAMConfig.IPv4Address, ip);
    const authority = ip + ':5000';
    const leaf = await certificate('registry-leaf', [ip, local], ca);
    for (const name of ['server.key', 'server.crt']) writeFileSync(join(registryTls, name), readFileSync(join(leaf.directory, name)), {flag: 'wx', mode: 0o600});
    await docker(['start', registry]);
    const startedRegistry = JSON.parse((await docker(['container', 'inspect', registry])).stdout)[0];
    assert.equal(startedRegistry.NetworkSettings.Networks[network].IPAddress, ip);
    const deadline = performance.now() + 60000;
    for (;;) {
      cancellation.signal.throwIfAborted();
      try {
        await probeQualificationRegistry(ip, 5000, ca.bytes, cancellation.signal); break;
      } catch (error) {
        cancellation.signal.throwIfAborted(); assert(performance.now() < deadline, String(error));
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    const layoutPath = join(publicRoot, 'transport-layout'), layout = createTransportLayout(layoutPath, arch, revision);
    const image = authority + '/qualification/transport@' + layout.index.descriptor.digest;
    await execute('oras', ['cp', '--from-oci-layout', '--to-ca-file', ca.cert, '--to-registry-config', join(dockerConfig, 'config.json'),
      layoutPath + '@' + layout.index.descriptor.digest, authority + '/qualification/transport:qualification'], {timeout: 120000});
    const acquired = await readMetadata(image, ca.bytes);
    assert.deepEqual(acquired.index, layout.index.bytes); assert.deepEqual(acquired.manifest, layout.child.bytes);
    const positive = {image, metadata: acquired.metadata, transport: acquired.transport};
    const daemon = async (name, trust, boundAuthority = authority) => {
      const data = name + '-data', socket = name + '-socket';
      for (const volume of [data, socket]) await own('volume', volume, ['volume', 'create', '--label', OWNER + '=' + nonce, volume]);
      let mount = [];
      if (trust) {
        const trustDirectory = join(privateRoot, name); mkdirSync(trustDirectory, {mode: 0o700});
        writeFileSync(join(trustDirectory, 'ca.crt'), trust, {flag: 'wx', mode: 0o444});
        mount = ['--mount', 'type=bind,source=' + trustDirectory + ',target=/etc/docker/certs.d/' + boundAuthority + ',readonly'];
      }
      await own('container', name, ['create', '--name', name, '--label', OWNER + '=' + nonce, '--privileged',
        '--network', network, '--env', 'DOCKER_TLS_CERTDIR=', '--memory', '2g', '--memory-swap', '2g',
        '--mount', 'type=volume,source=' + data + ',target=/var/lib/docker',
        '--mount', 'type=volume,source=' + socket + ',target=/var/run', ...mount,
        lock.images.dind.reference, 'dockerd', '--host=' + SOCKET, '--data-root=/var/lib/docker', '--dns=127.0.0.1']);
      await docker(['start', name]);
      const inside = (args, options) => docker(['exec', name, 'docker', '--host', SOCKET, ...args], options);
      const end = performance.now() + 60000; let info;
      for (;;) {
        const observed = await inside(['info', '--format', '{{json .}}'], {allowFailure: true});
        if (observed.status === 0) {info = JSON.parse(observed.stdout); break;}
        assert(performance.now() < end, 'fresh daemon readiness expired'); await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert.equal(info.Images, 0); assert.equal(info.Containers, 0); assert.equal(info.ServerVersion, '28.4.0');
      assert.equal(info.Architecture, arch === 'amd64' ? 'x86_64' : 'aarch64');
      if (trust) {
        assert.deepEqual((await docker(['exec', name, 'cat', '/etc/docker/certs.d/' + boundAuthority + '/ca.crt'])).stdout, trust);
        const inspected = JSON.parse((await docker(['container', 'inspect', name])).stdout)[0];
        const mounts = inspected.Mounts.filter(row => row.Destination === '/etc/docker/certs.d/' + boundAuthority);
        assert.equal(mounts.length, 1); assert.equal(mounts[0].RW, false);
      }
      return {name, inside, initial: info};
    };
    const proveEmpty = async actual => {
      const info = JSON.parse((await actual.inside(['info', '--format', '{{json .}}'])).stdout);
      assert.equal(info.Images, 0); assert.equal(info.Containers, 0); return info;
    };
    const positiveDaemon = await daemon(prefix + '-positive', ca.bytes);
    await positiveDaemon.inside(['pull', '--platform', 'linux/' + arch, image], {timeout: 120000});
    positive.loaded = await inspectLoadedImage(positiveDaemon.inside, acquired.metadata, arch, revision);
    assert.deepEqual((await docker(['exec', positiveDaemon.name, 'cat', '/etc/docker/certs.d/' + authority + '/ca.crt'])).stdout, ca.bytes);
    results.push({id: 'positive-real-registry-and-daemon', ...positive, initial: positiveDaemon.initial});
    for (const [id, trust, bound, expected] of [
      ['missing-ca', null, authority, /x509: certificate signed by unknown authority/],
      ['wrong-ca', wrongCa.bytes, authority, /x509: certificate signed by unknown authority/],
      ['wrong-authority-ca-path', ca.bytes, ip + ':5001', /x509: certificate signed by unknown authority/],
    ]) {
      const actual = await daemon(prefix + '-' + id, trust, bound);
      const rejected = await actual.inside(['pull', '--platform', 'linux/' + arch, image], {allowFailure: true, timeout: 120000});
      assert.notEqual(rejected.status, 0); assert.match(rejected.stderr.toString(), expected);
      results.push({id, initial: actual.initial, final: await proveEmpty(actual), status: rejected.status});
      await captureResources(actual.name);
      await docker(['stop', '--time', '5', actual.name]);
    }
    // Reachable valid target controls precede zero-contact redirect assertions.
    let targetContacts = 0;
    const tls = {key: readFileSync(leaf.key), cert: leaf.bytes};
    const target = await startServer((req, res) => {
      targetContacts++; const bytes = req.url.endsWith(layout.index.descriptor.digest) ? layout.index.bytes : layout.child.bytes;
      res.writeHead(200, {'Content-Length': bytes.length, 'Docker-Content-Digest': digest(bytes)}); res.end(bytes);
    }, local, tls);
    const targetImage = target.authority + '/qualification/transport@' + layout.index.descriptor.digest;
    const targetControl = await readMetadata(targetImage, ca.bytes);
    assert.deepEqual(targetControl.index, layout.index.bytes); assert.deepEqual(targetControl.manifest, layout.child.bytes);
    assert.equal(targetContacts, 2); targetContacts = 0;
    writeFileSync(join(publicRoot, 'redirect-target-positive-control.json'), JSON.stringify({
      authority: target.authority, contacts: 2, original_index_base64: targetControl.index.toString('base64'),
      original_manifest_base64: targetControl.manifest.toString('base64'), transport: targetControl.transport,
      scope: 'actual reachable TLS graph control before resetting contact counter'}) + '\n', {flag: 'wx'});
    const negativeDaemon = await daemon(prefix + '-admission-negative', ca.bytes);
    const boundReader = createSdkRegistryReader(image, ca.bytes);
    await assert.rejects(readSdkRegistryManifest(boundReader, targetImage), /authority changed/);
    const boundRetirement = closeSdkRegistryReader(boundReader);
    assert.equal(boundRetirement.requests, 0); assert.equal(targetContacts, 0);
    results.push({id: 'wrong-authority-admission-refused', targetContacts, retirement: boundRetirement,
      freshDaemon: await proveEmpty(negativeDaemon)});
    for (const code of [301, 302, 303, 307, 308]) {
      let originContacts = 0;
      const origin = await startServer((req, res) => {originContacts++; res.writeHead(code, {Location: 'https://' + target.authority + req.url}); res.end();}, local, tls);
      const reference = origin.authority + '/qualification/transport@' + layout.index.descriptor.digest;
      let rejected;
      try {await readMetadata(reference, ca.bytes); assert.fail('redirect admission unexpectedly succeeded');}
      catch (error) {assert.match(error.message, /redirects and authentication challenges refused/); rejected = error;}
      assert.equal(rejected.actual, code); assert.equal(rejected.expected, 200);
      assert.equal(originContacts, 1); assert.equal(targetContacts, 0);
      assert.equal(rejected.retirement.agent_retired, true);
      results.push({id: 'redirect-' + code, scope: 'real shared acquisition boundary; not daemon redirect refusal',
        originContacts, targetContacts, observed_status: rejected.actual, retirement: rejected.retirement,
        freshDaemon: await proveEmpty(negativeDaemon)});
    }
    const plain = await startServer((_, res) => {res.end('plain HTTP is not TLS');}, local);
    const plainImage = plain.authority + '/qualification/transport@' + layout.index.descriptor.digest;
    await assert.rejects(readMetadata(plainImage, ca.bytes), error => /SSL|TLS|wrong version|EPROTO/i.test(error.message) && error.retirement.agent_retired);
    results.push({id: 'http-admission-refused', freshDaemon: await proveEmpty(negativeDaemon)});
    const plainDaemon = await daemon(prefix + '-plain-http', ca.bytes, plain.authority);
    const httpFailure = await plainDaemon.inside(['pull', '--platform', 'linux/' + arch, plainImage], {allowFailure: true, timeout: 120000});
    assert.notEqual(httpFailure.status, 0); assert.match(httpFailure.stderr.toString(), /(?:HTTP response to HTTPS|TLS handshake|tls:|wrong version)/i);
    results.push({id: 'http-real-daemon-refused', status: httpFailure.status, final: await proveEmpty(plainDaemon)});
    await captureResources(plainDaemon.name);
    await docker(['stop', '--time', '5', plainDaemon.name]);
    await assert.rejects(readMetadata(image, wrongCa.bytes), error => /certificate|self.signed|issuer/i.test(error.message) && error.retirement.agent_retired);
    results.push({id: 'wrong-ca-admission-refused', freshDaemon: await proveEmpty(negativeDaemon)});
    // Wrong SAN is a genuine CA-signed leaf on a real TLS listener.
    const wrongSan = await certificate('wrong-san-leaf', ['192.0.2.1'], ca);
    const mismatch = await startServer((_, res) => res.end(layout.index.bytes), local,
      {key: readFileSync(wrongSan.key), cert: wrongSan.bytes});
    const mismatchImage = mismatch.authority + '/qualification/transport@' + layout.index.descriptor.digest;
    await assert.rejects(readMetadata(mismatchImage, ca.bytes), error => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID' && error.retirement.agent_retired);
    const mismatchDaemon = await daemon(prefix + '-wrong-san', ca.bytes, mismatch.authority);
    const sanFailure = await mismatchDaemon.inside(['pull', '--platform', 'linux/' + arch, mismatchImage], {allowFailure: true, timeout: 120000});
    validateSanFailure(sanFailure);
    results.push({id: 'wrong-san-real-tls-and-daemon', status: sanFailure.status, final: await proveEmpty(mismatchDaemon)});
    assert.deepEqual(await sourceSnapshot(), inputs, 'all original source bytes remain unchanged');
  } catch (error) {failure = error;}
  finally {
    cleanupDeadline = performance.now() + 120000;
    const cleanupFailures = [];
    for (const {server, sockets} of servers.reverse()) {
      try {
        assert(performance.now() < cleanupDeadline, 'global cleanup deadline expired');
        const socketsClosed = [...sockets].map(socket => new Promise(resolve => socket.once('close', resolve)));
        const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
        let timer;
        try {await Promise.race([Promise.all([...socketsClosed, closed]), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('TLS fixture cleanup expired')), Math.min(5000, Math.max(1, cleanupDeadline - performance.now())));
        })]);}
        finally {clearTimeout(timer);}
        assert.equal(sockets.size, 0);
      } catch (error) {cleanupFailures.push(String(error));}
    }
    for (const row of owned.slice().reverse().filter(row => row.kind === 'container')) {
      try {
        const actual = JSON.parse((await docker(['container', 'inspect', row.name], {cleaning: true})).stdout)[0];
        assert.equal(actual.Config.Labels?.[OWNER], nonce); if (row.id) assert.equal(actual.Id, row.id);
        try {
          if (!resources.has(row.name)) await captureResources(row.name, true);
          assert.equal(resources.get(row.name).id, actual.Id);
        } catch (error) {cleanupFailures.push(String(error));}
        await docker(['logs', row.name], {allowFailure: true, cleaning: true});
        await docker(['container', 'rm', '--force', '--volumes', actual.Id], {cleaning: true});
        const absent = await docker(['container', 'inspect', row.name], {allowFailure: true, cleaning: true});
        assert.notEqual(absent.status, 0); assert.match(absent.stderr.toString(), /No such|not found/i);
      } catch (error) {cleanupFailures.push(String(error));}
    }
    if (connected) {
      try {await docker(['network', 'disconnect', '--force', network, self.Id], {cleaning: true});}
      catch (error) {cleanupFailures.push(String(error));}
    }
    for (const row of owned.slice().reverse().filter(row => row.kind !== 'container')) {
      try {
        if (row.retired) {
          assert.equal(row.kind, 'network'); assert(row.id);
          for (const reference of [row.id, row.name]) {
            const absent = await docker(['network', 'inspect', reference], {allowFailure: true, cleaning: true});
            assert.notEqual(absent.status, 0); assert.match(absent.stderr.toString(), /No such|not found/i);
          }
          continue;
        }
        const actual = JSON.parse((await docker([row.kind, 'inspect', row.name], {cleaning: true})).stdout)[0];
        assert.equal(actual.Labels?.[OWNER], nonce);
        if (row.id) assert.equal(row.kind === 'volume' ? actual.Name : actual.Id, row.id);
        await docker([row.kind, 'rm', row.name], {cleaning: true});
        const absent = await docker([row.kind, 'inspect', row.name], {allowFailure: true, cleaning: true});
        assert.notEqual(absent.status, 0); assert.match(absent.stderr.toString(), /No such|not found/i);
      } catch (error) {cleanupFailures.push(String(error));}
    }
    for (const [signal, handler] of signals) process.off(signal, handler);
    try {
      const raw = Buffer.concat(['memory.max', 'memory.peak', 'memory.events'].map(name => readFileSync('/sys/fs/cgroup/' + name)));
      const ownResources = {name: 'qualification-tools', id: self?.Id,
        ...validateQualificationResources(raw, 1024 ** 3)};
      resources.set('qualification-tools', ownResources);
      writeFileSync(join(publicRoot, 'tool-resources.json'), JSON.stringify(ownResources) + '\n', {flag: 'wx'});
    } catch (error) {cleanupFailures.push(String(error));}
    let handoff, handoffDigest;
    try {
      handoff = handoffQualificationEvidence(publicRoot);
      handoffDigest = writeFinalPublicEvidence(publicRoot, 'public-handoff.json', handoff);
    } catch (error) {cleanupFailures.push(String(error));}
    const cleanupElapsed = performance.now() - (cleanupDeadline - 120000);
    if (cleanupElapsed >= 120000) cleanupFailures.push('global cleanup deadline expired before final receipt');
    if (cleanupFailures.length) failure = new AggregateError([...(failure ? [failure] : []), ...cleanupFailures], 'qualification or owned cleanup failed');
    const receipt = {schema: 'prismpm/owned-registry-qualification/1', revision, architecture: arch,
      run: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT,
      passed: !failure && !interrupted, results, commands, owned, resources: [...resources.values()],
      cleanupFailures, cleanup_elapsed_ms: cleanupElapsed, public_handoff_sha256: handoffDigest ?? null,
      failure: failure ? {message: String(failure), stack: failure.stack} : null,
      scope: 'real native registry TLS, exact metadata and fresh daemon transport only',
      unclaimed: ['daemon-redirect-refusal', 'SDK-image', 'image-execution', 'installed-fullVV', 'SDK-release', 'product-readiness']};
    writeFinalPublicEvidence(publicRoot, 'receipt.json', receipt);
  }
  if (failure) throw failure; if (interrupted) throw interrupted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3); await run(process.argv[2]);
}
