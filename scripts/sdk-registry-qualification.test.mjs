// Unit evidence for the qualifier. Real registry/daemon proof is separate CI.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:https';
import {linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {networkInterfaces, tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createTransportLayout, acquireQualificationMetadata, captureQualificationFiles,
  executeQualificationProcess, qualificationRegistryAddress, validateSanFailure,
  validateQualificationResources, handoffQualificationEvidence, probeQualificationRegistry,
  writeFinalPublicEvidence} from './sdk-registry-qualification.mjs';
import {selectPlatform, validateImageMetadata} from './sdk-vv-check.mjs';

const revision = 'a'.repeat(40), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const host = Object.values(networkInterfaces()).flat().find(row => row.family === 'IPv4' && !row.internal)?.address;
assert(host, 'actual private non-loopback test container address required');
const directory = t => {
  const path = mkdtempSync(join(tmpdir(), 'prism-tls-qualification-unit-'));
  t.after(() => rmSync(path, {recursive: true, force: true})); return path;
};
const certificate = path => {
  const key = join(path, 'key.pem'), cert = join(path, 'ca.pem');
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=qualification-unit', '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'subjectAltName=IP:' + host, '-keyout', key, '-out', cert],
  {timeout: 15000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe']});
  return {key: readFileSync(key), cert: readFileSync(cert)};
};
async function server(t, tls, handler) {
  const instance = createServer(tls, handler), sockets = new Set();
  instance.on('connection', socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
  instance.on('tlsClientError', () => {});
  await new Promise((resolve, reject) => {instance.once('error', reject); instance.listen(0, host, resolve);});
  t.after(async () => {
    const socketsClosed = [...sockets].map(socket => new Promise(resolve => socket.once('close', resolve)));
    const closed = new Promise((resolve, reject) => instance.close(error => error ? reject(error) : resolve()));
    for (const socket of sockets) socket.destroy();
    let timer;
    try {await Promise.race([Promise.all([...socketsClosed, closed]), new Promise((_, reject) => {timer = setTimeout(() => reject(Error('unit listener retirement expired')), 5000);})]);}
    finally {clearTimeout(timer);}
    assert.equal(sockets.size, 0);
  });
  return host + ':' + instance.address().port;
}

test('actual registry readiness owns truncated response errors and cancellation', async t => {
  const tls = certificate(directory(t));
  for (const mode of ['complete', 'truncated', 'status', 'cancel', 'trickle']) {
    const authority = await server(t, tls, (req, res) => {
      assert.equal(req.url, '/v2/');
      if (mode === 'cancel') return;
      if (mode === 'trickle') {
        res.writeHead(200); res.write('x');
        const timer = setInterval(() => res.write('x'), 100);
        res.once('close', () => clearInterval(timer)); return;
      }
      res.writeHead(mode === 'status' ? 503 : 200, {'Content-Length': 10});
      if (mode === 'truncated') {res.write('x'); setImmediate(() => res.destroy());}
      else res.end('0123456789');
    });
    const controller = new AbortController();
    const result = probeQualificationRegistry(host, Number(authority.split(':')[1]), tls.cert, controller.signal);
    if (mode === 'cancel') {
      const timer = setTimeout(() => controller.abort(), 30);
      try {await assert.rejects(result, /aborted/i);} finally {clearTimeout(timer);}
    } else if (mode === 'trickle') {
      const start = performance.now();
      await assert.rejects(result, /wall-clock timeout/); assert(performance.now() - start < 5000);
    } else if (mode === 'complete') await result;
    else await assert.rejects(result, mode === 'truncated' ? /aborted|incomplete|reset/i : /not ready/);
  }
});

test('transport fixtures retain complete native OCI graph and cannot masquerade as SDKs', t => {
  const root = directory(t);
  for (const arch of ['amd64', 'arm64']) {
    const path = join(root, arch), layout = createTransportLayout(path, arch, revision);
    for (const row of [layout.config, layout.child, layout.index]) {
      assert.equal(row.descriptor.digest, 'sha256:' + hash(row.bytes));
      assert.equal(row.descriptor.size, row.bytes.length);
      assert.deepEqual(readFileSync(join(path, 'blobs/sha256', row.descriptor.digest.slice(7))), row.bytes);
    }
    assert.equal(readdirSync(join(path, 'blobs/sha256')).length, 3);
    const image = host + ':5000/qualification/transport@' + layout.index.descriptor.digest;
    const selected = selectPlatform(layout.index.bytes, layout.index.descriptor.digest, arch);
    assert.equal(selected.digest, layout.child.descriptor.digest);
    assert.equal(validateImageMetadata(layout.index.bytes, layout.child.bytes, image, arch).config_digest, layout.config.descriptor.digest);
    const config = JSON.parse(layout.config.bytes);
    assert.deepEqual(config.rootfs.diff_ids, []);
    assert.equal(config.config.Labels['org.uor.prismpm.scope'], 'transport-fixture-only');
    assert.equal(config.config.Entrypoint, undefined); assert.equal(config.config.Cmd, undefined);
    assert.throws(() => selectPlatform(layout.index.bytes, layout.index.descriptor.digest, arch === 'amd64' ? 'arm64' : 'amd64'));
    assert.throws(() => validateImageMetadata(layout.index.bytes, Buffer.concat([layout.child.bytes, Buffer.from('\n')]), image, arch));
  }
});

test('transport fixture construction rejects invalid platform, revision and reused destinations', t => {
  const root = directory(t), path = join(root, 'layout');
  for (const [arch, value] of [['x64', revision], ['amd64', 'main'], ['arm64', 'g'.repeat(40)]]) {
    assert.throws(() => createTransportLayout(path, arch, value));
    assert.deepEqual(readdirSync(root), []);
  }
  createTransportLayout(path, 'amd64', revision);
  assert.throws(() => createTransportLayout(path, 'amd64', revision), /fresh fixture layout/);
});

test('actual TLS qualifier executes the shared SDK graph acquisition and observes both retirements', async t => {
  const root = directory(t), tls = certificate(root), layout = createTransportLayout(join(root, 'layout'), 'amd64', revision);
  const requests = [];
  const authority = await server(t, tls, (req, res) => {
    requests.push(req.url); assert.equal(req.headers.authorization, undefined);
    const bytes = req.url.endsWith(layout.index.descriptor.digest) ? layout.index.bytes : layout.child.bytes;
    res.writeHead(200, {'Content-Length': bytes.length, 'Docker-Content-Digest': 'sha256:' + hash(bytes)}); res.end(bytes);
  });
  const image = authority + '/qualification/transport@' + layout.index.descriptor.digest;
  const result = await acquireQualificationMetadata(image, tls.cert, 'amd64');
  assert.deepEqual(result.index, layout.index.bytes); assert.deepEqual(result.manifest, layout.child.bytes);
  assert.deepEqual(requests, [layout.index.descriptor.digest, layout.child.descriptor.digest].map(id => '/v2/qualification/transport/manifests/' + id));
  assert.equal(result.transport.requests, 2); assert.equal(result.transport.agent_retired, true);
  for (const row of result.transport.reads) {
    assert.equal(row.request_close_observed, true); assert.equal(row.socket_close_observed, true);
    assert.equal(row.tls.authorized, true); assert.equal(row.tls.remote_address, host);
  }
});

test('real redirect to a proven reachable graph is rejected before target contacts', async t => {
  const root = directory(t), tls = certificate(root), layout = createTransportLayout(join(root, 'layout'), 'amd64', revision);
  let contacts = 0;
  const target = await server(t, tls, (req, res) => {
    contacts++; const bytes = req.url.endsWith(layout.index.descriptor.digest) ? layout.index.bytes : layout.child.bytes;
    res.writeHead(200, {'Content-Length': bytes.length}); res.end(bytes);
  });
  await acquireQualificationMetadata(target + '/qualification/transport@' + layout.index.descriptor.digest, tls.cert, 'amd64');
  assert.equal(contacts, 2); contacts = 0;
  for (const code of [301, 302, 303, 307, 308]) {
    const origin = await server(t, tls, (req, res) => {res.writeHead(code, {Location: 'https://' + target + req.url}); res.end();});
    await assert.rejects(acquireQualificationMetadata(origin + '/qualification/transport@' + layout.index.descriptor.digest, tls.cert, 'amd64'), error => {
      assert.match(error.message, /redirects and authentication challenges refused/);
      assert.equal(error.retirement.requests, 1); assert.equal(error.retirement.agent_retired, true); return true;
    });
    assert.equal(contacts, 0);
  }
});

test('invalid actual child graph is rejected after both original TLS reads and retired once', async t => {
  const root = directory(t), tls = certificate(root), layout = createTransportLayout(join(root, 'layout'), 'amd64', revision);
  let contacts = 0;
  const authority = await server(t, tls, (req, res) => {
    contacts++; const bytes = req.url.endsWith(layout.index.descriptor.digest) ? layout.index.bytes : Buffer.from('{}');
    res.writeHead(200, {'Content-Length': bytes.length}); res.end(bytes);
  });
  await assert.rejects(acquireQualificationMetadata(authority + '/qualification/transport@' + layout.index.descriptor.digest, tls.cert, 'amd64'), error => {
    assert.match(error.message, /original SDK metadata digest differs/);
    assert.equal(error.retirement.requests, 2); assert.equal(error.retirement.agent_retired, true); return true;
  });
  assert.equal(contacts, 2);
});

test('native qualification keeps pinned real actors, complete negative controls and honest scope', () => {
  const workflow = readFileSync(new URL('../.github/workflows/sdk-registry-qualification.yml', import.meta.url), 'utf8');
  const source = readFileSync(new URL('./sdk-registry-qualification.mjs', import.meta.url), 'utf8');
  const orchestrator = readFileSync(new URL('./sdk-vv-check.mjs', import.meta.url), 'utf8');
  const recipe = readFileSync(new URL('../sdk/Dockerfile', import.meta.url), 'utf8');
  const processOwner = readFileSync(new URL('./sdk-process-qualification.mjs', import.meta.url), 'utf8');
  assert(workflow.includes('name: Verify complete native outer process owner'));
  assert(workflow.includes('240s node scripts/sdk-process-qualification.mjs'));
  assert(workflow.includes('--network "$network"'));
  assert(workflow.includes('--read-only --cpus 2 --memory 1g --memory-swap 1g --pids-limit 256'));
  assert(workflow.includes('--tmpfs /tmp:rw,exec,nosuid,nodev,size=16g,mode=1777'));
  assert(workflow.includes('native-outer-process-owner-${{ matrix.arch }}-'));
  assert(workflow.indexOf('trap cleanup EXIT') < workflow.indexOf('network_id=$(controlled network-create'));
  assert(workflow.includes('test "$status" = 1 || return 1'));
  assert(workflow.includes('cleaning=1 cleanup_deadline=$((SECONDS + 60))'));
  assert(workflow.includes('timeout --signal=TERM --kill-after=2s "${bound}s" docker'));
  assert(workflow.includes('test "$id" = "$container_id" || exit 1'));
  assert(workflow.includes('test "$id" = "$network_id" || exit 1'));
  assert(workflow.includes('--mount type=bind,source=$out/results,target=/evidence'));
  assert(workflow.includes('container_id=$(controlled container-create create --rm --init'));
  assert(processOwner.includes("assert.equal(memory['memory.max'].trim(), '1073741824')"));
  assert(processOwner.includes("assert.equal(memory['memory.swap.max'].trim(), '0')"));
  assert(processOwner.includes('assert.equal(quota, 2 * period)'));
  assert(processOwner.includes("'--test-timeout=120000'"));
  assert(processOwner.includes('assert.equal(verifyTap(tap, 103), 103)'));
  for (const [path, count] of [['sdk-vv-check', 20], ['sdk-command-owner', 12], ['sdk-registry-qualification', 17], ['sdk-construction-archive', 14],
    ['sdk-construction-stage', 17], ['sdk-construction-acquire', 6], ['sdk-construction-observe', 17]]) {
    assert(processOwner.includes(`['scripts/${path}.test.mjs', ${count}]`));
  }
  assert(workflow.includes('- scripts/sdk-construction-*.mjs'));
  assert(processOwner.includes('verifyFileCompletions(tap, [...owners.keys()].map(path => resolve(path)), 103)'));
  assert(processOwner.includes('new Map([...owners].map(([path, count]) => [resolve(path), count]))'));
  assert(processOwner.includes("assert.equal(row.tests, expected.get(row.file), 'complete original owning-file count required')"));
  assert(processOwner.includes('captureQualificationFiles(paths), inputs'));
  assert(!processOwner.includes('test-name-pattern'));
  assert(workflow.includes('mkdir -m 2770 "$RUNNER_TEMP/registry-qualification"'));
  assert(workflow.includes('--user 0:0 --group-add "$(id -g)"'));
  for (const [os, arch] of [['ubuntu-24.04', 'amd64'], ['ubuntu-24.04-arm', 'arm64']]) {
    assert(workflow.includes('os: ' + os)); assert(workflow.includes('arch: ' + arch));
  }
  assert(workflow.includes('--target registry_qualification_tools'));
  assert(source.includes('await allocateQualificationNetwork({own, docker, owned, prefix, nonce})'));
  assert(source.includes("['network', 'create', '--subnet', subnet,"));
  assert(source.indexOf('entry.retired = true') > source.indexOf("await docker(['network', 'rm', probe.Id])"));
  assert(source.indexOf("const actual = await own('network', name") > source.indexOf('entry.retired = true'));
  assert(source.includes('for (const reference of [probe.Id, probeName])'));
  assert(source.includes('for (const reference of [row.id, row.name])'));
  assert(!/setup-qemu|--network[ =]host|secrets\.|contents: write/.test(workflow));
  assert(recipe.includes('FROM input_tools AS registry_qualification_tools'));
  assert(recipe.includes('COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker'));
  const tools = recipe.split('FROM input_tools AS registry_qualification_tools\n')[1].split('\nFROM ')[0];
  assert(tools.includes('COPY --from=docker_cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx'),
    'thin qualification tools must retain the actual pinned native Buildx plugin, not depend on a host plugin');
  assert(tools.includes('&& docker buildx version'));
  assert(tools.includes('/usr/bin/python3 -I -B'));
  assert(tools.includes('sys.version_info[:3] == (3, 11, 2)'));
  assert(workflow.includes('- scripts/sdk-command-owner.*'));
  assert(source.includes("await execute('docker', ['buildx', 'version'])"));
  assert(source.includes("assert.match(buildx.stdout.toString().trim(), /^github\\.com\\/docker\\/buildx v0\\.28\\.0 b1281b81bba797b21d9eaf256e6a13eb14419836$/)"));
  assert(source.includes("['docker-buildx', '/usr/local/libexec/docker/cli-plugins/docker-buildx']"));
  assert(source.includes('await acquireOwnedImageMetadata(reader, image, arch)'));
  assert(orchestrator.includes('await acquireOwnedImageMetadata(registryReader, image, arch)'));
  for (const id of ['positive-real-registry-and-daemon', 'missing-ca', 'wrong-ca', 'wrong-authority-ca-path',
    'wrong-authority-admission-refused', 'http-admission-refused', 'http-real-daemon-refused',
    'wrong-ca-admission-refused', 'wrong-san-real-tls-and-daemon']) assert(source.includes("'" + id + "'"));
  assert(source.includes('for (const code of [301, 302, 303, 307, 308])'));
  assert(source.includes('assert.equal(targetContacts, 2); targetContacts = 0'));
  assert(source.includes('assert.equal(targetContacts, 0)'));
  assert(source.includes('await inspectLoadedImage(positiveDaemon.inside, acquired.metadata, arch, revision)'));
  assert(source.includes("unclaimed: ['daemon-redirect-refusal', 'SDK-image', 'image-execution', 'installed-fullVV', 'SDK-release', 'product-readiness']"));
});

test('source custody retains literal tracked file and directory links without following aliases', t => {
  const root = directory(t); mkdirSync(join(root, 'tree'));
  writeFileSync(join(root, 'tree/file'), 'original source\n', {flag: 'wx'});
  symlinkSync('tree/file', join(root, 'file-link')); symlinkSync('tree', join(root, 'directory-link'), 'dir');
  const paths = ['tree/file', 'file-link', 'directory-link'], before = captureQualificationFiles(paths, root);
  assert.equal(before.length, 3);
  for (const [index, target] of [[1, 'tree/file'], [2, 'tree']]) {
    assert.equal(before[index].link_base64, Buffer.from(target).toString('base64'));
    assert.equal(before[index].sha256, hash(Buffer.from(target)));
  }
  assert.deepEqual(captureQualificationFiles(paths, root), before);
  assert.throws(() => captureQualificationFiles(['directory-link/file'], root), /parent alias/);
  unlinkSync(join(root, 'file-link')); symlinkSync('missing-target', join(root, 'file-link'));
  assert.notDeepEqual(captureQualificationFiles(paths, root), before, 'literal target changes are visible even without following the link');
  linkSync(join(root, 'tree/file'), join(root, 'hard-link'));
  assert.throws(() => captureQualificationFiles(['tree/file'], root), /unaliased regular source/);
  for (const invalid of [[], ['tree/file', 'tree/file'], ['/absolute'], ['../escape'], ['tree/./file']]) {
    assert.throws(() => captureQualificationFiles(invalid, root));
  }
});

test('registry SAN allocation is fixed before create and standard Go mismatch wording is admitted only as failure', () => {
  for (const [subnet, expected] of [['172.18.0.0/16', '172.18.0.10'], ['10.7.2.0/24', '10.7.2.10'],
    ['192.168.30.16/28', '192.168.30.26']]) assert.equal(qualificationRegistryAddress(subnet), expected);
  for (const invalid of ['192.0.2.0/24', '172.32.0.0/16', '172.18.1.0/16', '10.0.0.0/29', '10.0.0.0/15', '10.0.999.0/24', 'main']) {
    assert.throws(() => qualificationRegistryAddress(invalid));
  }
  const result = {status: 1, signal: null, stderr: Buffer.from('Error: x509: certificate is valid for 192.0.2.1, not 172.18.0.10')};
  validateSanFailure(result);
  assert.throws(() => validateSanFailure({...result, status: 0}));
  assert.throws(() => validateSanFailure({...result, signal: 'SIGTERM'}));
  assert.throws(() => validateSanFailure({...result, stderr: Buffer.from('connection refused')}));
});

test('resource validation uses actual running cgroup bytes and rejects missing or nonzero measurements', () => {
  const raw = Buffer.concat(['memory.max', 'memory.peak', 'memory.events'].map(name => readFileSync('/sys/fs/cgroup/' + name)));
  const limit = Number(raw.toString().split('\n')[0]), valid = validateQualificationResources(raw, limit);
  assert.equal(valid.maximum, limit); assert(valid.peak > 0 && valid.peak <= limit);
  for (const name of ['max', 'oom', 'oom_kill']) {
    assert.throws(() => validateQualificationResources(Buffer.from(raw.toString().replace(name + ' 0', name + ' 1')), limit));
    assert.throws(() => validateQualificationResources(Buffer.from(raw.toString().replace(name + ' 0\n', '')), limit));
  }
  assert.throws(() => validateQualificationResources(raw, limit + 1));
  assert.throws(() => validateQualificationResources(Buffer.from('max\n1\noom 0\n'), limit));
});

test('public-only handoff makes nested artifacts and failure evidence readable without exposing private keys', t => {
  const root = directory(t), publicRoot = join(root, 'public'), privateRoot = join(root, 'private');
  const previous = process.umask(0o077);
  try {
    mkdirSync(publicRoot, {mode: 0o700}); mkdirSync(privateRoot, {mode: 0o700});
    writeFileSync(join(privateRoot, 'server.key'), 'private fixture key\n', {flag: 'wx', mode: 0o600});
    createTransportLayout(join(publicRoot, 'transport-layout'), 'amd64', revision);
    writeFileSync(join(publicRoot, 'failed-command.json'), '{"status":1}\n', {flag: 'wx'});
    const handoff = handoffQualificationEvidence(publicRoot);
    assert(handoff.files.length > 3); assert.equal(handoff.root_mode, 0o755);
    for (const path of [publicRoot, join(publicRoot, 'transport-layout'),
      join(publicRoot, 'transport-layout/blobs'), join(publicRoot, 'transport-layout/blobs/sha256')]) {
      assert.equal(lstatSync(path).mode & 0o7777, 0o755);
    }
    for (const row of handoff.files) assert.equal(lstatSync(join(publicRoot, row.path)).mode & 0o7777, 0o644);
    const digest = writeFinalPublicEvidence(publicRoot, 'public-handoff.json', handoff);
    assert.equal(digest, hash(readFileSync(join(publicRoot, 'public-handoff.json'))));
    assert.equal(lstatSync(join(publicRoot, 'public-handoff.json')).mode & 0o7777, 0o644);
    assert.throws(() => writeFinalPublicEvidence(publicRoot, 'public-handoff.json', handoff), /EEXIST/);
    assert.equal(lstatSync(privateRoot).mode & 0o7777, 0o700);
    assert.equal(lstatSync(join(privateRoot, 'server.key')).mode & 0o7777, 0o600);
    symlinkSync('../private/server.key', join(publicRoot, 'planted-key-link'));
    assert.throws(() => handoffQualificationEvidence(publicRoot), /aliases refused/);
    assert.equal(lstatSync(join(privateRoot, 'server.key')).mode & 0o7777, 0o600);
    assert.throws(() => handoffQualificationEvidence(privateRoot));
  } finally {process.umask(previous);}
});

test('actual command cancellation and deadlines retire the owned process group before completion', async t => {
  await t.test('cooperative actual child receives cancellation and is reaped', async () => {
    const cancellation = new AbortController();
    const result = await executeQualificationProcess(process.execPath, ['-e',
      "process.on('SIGTERM',()=>process.exit(0));process.stdout.write('READY\\n');setInterval(()=>{},1000)"],
    {signal: cancellation.signal, onOutput: (_, bytes) => {if (bytes.includes('READY')) cancellation.abort(Error('unit cancellation'));}});
    assert.equal(result.aborted, true); assert.equal(result.status, 0); assert.equal(result.signal, null);
    assert.equal(result.retirement, 'actual-subreaper-exhaustion-observed');
    assert.equal(result.process_retirement.descendants_absent, true);
    assert.throws(() => process.kill(result.pid, 0), {code: 'ESRCH'});
  });
  await t.test('TERM-refusing actual child is killed within fixed five-second retirement bound', async () => {
    const cancellation = new AbortController(), start = performance.now();
    const result = await executeQualificationProcess(process.execPath, ['-e',
      "process.on('SIGTERM',()=>{});process.stdout.write('READY\\n');setInterval(()=>{},1000)"],
    {signal: cancellation.signal, onOutput: (_, bytes) => {if (bytes.includes('READY')) cancellation.abort(Error('unit cancellation'));}});
    assert.equal(result.aborted, true); assert.equal(result.signal, 'SIGKILL'); assert.equal(result.status, null);
    assert(performance.now() - start < 9000); assert.throws(() => process.kill(result.pid, 0), {code: 'ESRCH'});
  });
  await t.test('actual command deadline is a failed observed terminal, never a synthetic success', async () => {
    const result = await executeQualificationProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {timeout: 200});
    assert.equal(result.timedOut, true); assert.equal(result.aborted, false); assert.equal(result.status, null);
    assert.equal(result.signal, 'SIGTERM'); assert.throws(() => process.kill(result.pid, 0), {code: 'ESRCH'});
  });
  await t.test('cooperative parent cannot hide a TERM-refusing live descendant with ignored stdio', async () => {
    const cancellation = new AbortController(), start = performance.now(); let descendant;
    const program = String.raw`const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});
child.once('message',()=>{child.disconnect();process.on('SIGTERM',()=>process.exit(0));process.stdout.write('READY '+child.pid+'\n');});
setInterval(()=>{},1000);`;
    const result = await executeQualificationProcess(process.execPath, ['-e', program], {signal: cancellation.signal,
      onOutput: (_, bytes) => {const match = /^READY ([1-9][0-9]*)\n$/.exec(bytes.toString());
        if (match) {descendant = Number(match[1]); cancellation.abort(Error('unit descendant cancellation'));}}});
    assert.equal(result.status, 0); assert.equal(result.aborted, true); assert.equal(result.descendants_absent, true);
    assert(Number.isSafeInteger(descendant)); assert(performance.now() - start < 9000);
    assert.throws(() => process.kill(result.pid, 0), {code: 'ESRCH'});
    assert.throws(() => process.kill(-result.pid, 0), {code: 'ESRCH'});
    assert.throws(() => process.kill(descendant, 0), {code: 'ESRCH'});
  });
  await t.test('escaped descendant holding inherited pipes cannot suppress the independent retirement deadline', async () => {
    const cancellation = new AbortController(), start = performance.now(); let descendant, output = '';
    const program = String.raw`const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','inherit','inherit','ipc']});
child.once('message',()=>{child.disconnect();process.on('SIGTERM',()=>process.exit(0));process.stdout.write('READY '+child.pid+'\n');});
setInterval(()=>{},1000);`;
    try {
      const result = await executeQualificationProcess(process.execPath, ['-e', program], {signal: cancellation.signal,
        onOutput: (name, bytes) => {if (name !== 'stdout') return; output += bytes.toString();
          const match = /^READY ([1-9][0-9]*)\n$/.exec(output);
          if (match) {descendant = Number(match[1]); cancellation.abort(Error('unit escaped-pipe cancellation'));}}});
      assert.equal(result.aborted, true); assert.equal(result.close_observed, true);
      assert.equal(result.retirement, 'actual-subreaper-exhaustion-observed'); assert.equal(result.status, 0);
      assert.equal(result.descendants_absent, true);
      assert(Number.isSafeInteger(descendant)); assert.throws(() => process.kill(descendant, 0), {code: 'ESRCH'});
      assert(performance.now() - start < 9000);
    } finally {
      if (descendant) {
        // This deliberately escaped fixture group belongs solely to this test.
        try {process.kill(-descendant, 'SIGKILL');} catch (error) {assert.equal(error.code, 'ESRCH');}
        const deadline = performance.now() + 5000;
        for (;;) {
          try {process.kill(descendant, 0);} catch (error) {assert.equal(error.code, 'ESRCH'); break;}
          assert(performance.now() < deadline, 'actual escaped unit child must be reaped');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    }
  });
});
