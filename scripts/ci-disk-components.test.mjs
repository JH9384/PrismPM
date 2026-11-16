import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, lstatSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {boundedDiskCommand, diskComponents, diskComponentLabels, diskLimits, parseDiskCapacity, parseDiskObservation} from './ci-disk-components.mjs';

const walker = fileURLToPath(new URL('./ci-disk-walk.py', import.meta.url));
const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), 'ci-disk-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  return root;
};
const scan = (root, {exclude = false, entries = 20000, depth = 32, ms = 900} = {}) =>
  parseDiskObservation(execFileSync('/usr/bin/python3', ['-I', '-S', '-B', walker, root, exclude ? '1' : '0',
    String(entries), String(depth), String(ms)], {encoding: 'utf8', timeout: 1500}), entries);

test('fd-relative scan handles hostile names without exposing names or following symlinks', t => {
  const root = fixture(t), source = join(root, 'workspace\n;$(DO_NOT_RUN)');
  mkdirSync(source);
  const secret = 'DO_NOT_RETAIN_name_or_content';
  const file = join(source, secret + '\n\t[glob]');
  writeFileSync(file, secret.repeat(1000));
  linkSync(file, join(source, 'hardlink'));
  const outside = join(root, 'outside');
  mkdirSync(outside); writeFileSync(join(outside, secret), Buffer.alloc(1024 * 1024));
  symlinkSync(outside, join(source, 'directory-link'));
  symlinkSync(file, join(source, 'file-link'));
  symlinkSync(source, join(source, 'loop'));
  execFileSync('/usr/bin/mkfifo', [join(source, 'pipe')]);
  const result = scan(source);
  assert.equal(result.status, 'complete');
  assert.equal(result.symlinks, 3);
  assert.equal(result.entriesVisited, 7);
  // The scanner counts the allocated inode blocks of links and FIFOs too.
  // Some filesystems allocate blocks to symlinks; deduplicate the hard link.
  const entries = [source, file, join(source, 'hardlink'), join(source, 'directory-link'),
    join(source, 'file-link'), join(source, 'loop'), join(source, 'pipe')];
  const unique = new Map(entries.map(path => { const item = lstatSync(path); return [`${item.dev}:${item.ino}`, item.blocks]; }));
  assert.equal(result.allocatedBytes, [...unique.values()].reduce((sum, blocks) => sum + blocks * 512, 0));
  assert(!JSON.stringify(result).includes(secret));
  assert(!JSON.stringify(result).includes(root));
  symlinkSync(source, join(root, 'alias'));
  assert.equal(scan(join(root, 'alias')).status, 'unavailable');
  assert.equal(scan(join(root, 'alias', 'missing')).status, 'unavailable');
});

test('other workspace excludes only direct target, not nested target names', t => {
  const root = fixture(t);
  mkdirSync(join(root, 'target')); writeFileSync(join(root, 'target', 'ignored'), Buffer.alloc(32768));
  mkdirSync(join(root, 'nested')); mkdirSync(join(root, 'nested', 'target'));
  writeFileSync(join(root, 'nested', 'target', 'counted'), Buffer.alloc(8192));
  const all = scan(root), other = scan(root, {exclude: true}), target = scan(join(root, 'target'));
  assert.equal(other.status, 'complete');
  assert.equal(all.allocatedBytes - other.allocatedBytes, target.allocatedBytes);
  assert(other.allocatedBytes >= 8192);
});

test('walk bounds entries/depth and reports missing roots without zero-byte success', t => {
  const root = fixture(t);
  for (let i = 0; i < 20; i++) writeFileSync(join(root, String(i)), 'data');
  const limited = scan(root, {entries: 4});
  assert.equal(limited.status, 'entry-limit'); assert.equal(limited.entriesVisited, 4);
  mkdirSync(join(root, 'a/b/c'), {recursive: true});
  assert.equal(scan(join(root, 'a'), {depth: 1}).status, 'depth-limit');
  const missing = scan(join(root, 'missing'));
  assert.equal(missing.status, 'unavailable'); assert.equal(missing.allocatedBytes, null);
});

test('a directory swapped for an external symlink between stat and open is not followed', t => {
  const root = fixture(t), source = join(root, 'source'), outside = join(root, 'outside');
  mkdirSync(source); mkdirSync(outside); mkdirSync(join(source, 'victim'));
  writeFileSync(join(outside, 'private'), Buffer.alloc(1024 * 1024));
  const code = `import importlib.util, os, sys, json
spec=importlib.util.spec_from_file_location('walker',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
source,outside,retired=sys.argv[2:]
original=os.open
def replace(path, flags, **kwargs):
    if path == 'victim' and kwargs.get('dir_fd') is not None:
        os.rename(source+'/victim',retired)
        os.symlink(outside,source+'/victim')
    return original(path,flags,**kwargs)
os.open=replace
print(json.dumps(module.walk(source,False,20000,32,900)))
`;
  const result = parseDiskObservation(execFileSync('/usr/bin/python3', ['-I', '-S', '-B', '-c', code,
    walker, source, outside, join(root, 'retired')], {encoding: 'utf8', timeout: 1500}));
  assert.equal(result.status, 'partial'); assert(result.errors >= 1);
  assert(result.allocatedBytes < 1024 * 1024);
});

test('internal elapsed deadline returns a numeric partial state and inaccessible roots stay unavailable', t => {
  const root = fixture(t);
  const code = `import importlib.util, sys, json
spec=importlib.util.spec_from_file_location('walker',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
ticks=iter(range(1000));module.time.monotonic=lambda:next(ticks)
print(json.dumps(module.walk(sys.argv[2],False,20000,32,900)))
`;
  const result = parseDiskObservation(execFileSync('/usr/bin/python3', ['-I', '-S', '-B', '-c', code,
    walker, root], {encoding: 'utf8', timeout: 1500}));
  assert.equal(result.status, 'timed-out');
  if (process.getuid() !== 0) {
    const privateRoot = join(root, 'private'); mkdirSync(privateRoot); chmodSync(privateRoot, 0);
    try { assert.equal(scan(privateRoot).status, 'unavailable'); }
    finally { chmodSync(privateRoot, 0o700); }
  }
});

test('parser refuses hostile text, arbitrary fields, malformed states and unsafe numbers', () => {
  for (const text of ['private/path', '{"path":"secret"}', '[0,1,2,3,4,5,6]', '[99,1,1,0,0,0]',
    '[0,-1,1,0,0,0]', '[0,9007199254740992,1,0,0,0]', '[0,1,20001,0,0,0]',
    '[0,1,1,"secret",0,0]', '[3,1,0,0,0,0]', '[0,1.5,1,0,0,0]', ' '.repeat(1025)]) {
    const result = parseDiskObservation(text);
    assert.equal(result.status, 'invalid-output');
    assert(!JSON.stringify(result).includes('secret'));
  }
  assert.deepEqual(parseDiskObservation('[1,512,2,0,0,1]'),
    {status: 'partial', allocatedBytes: 512, entriesVisited: 2, symlinks: 0, skippedMounts: 0, errors: 1});
});

test('subprocess deadline, output bound, failure and unavailable states are closed and path-free', async () => {
  const options = {timeoutMs: 150, outputBytes: 64};
  const run = source => boundedDiskCommand(process.execPath, ['-e', source], options);
  assert.deepEqual(await run('process.stdout.write("[0,512,1,0,0,0]")'), {status: 'complete', stdout: '[0,512,1,0,0,0]'});
  const before = Date.now();
  assert.deepEqual(await run('setInterval(()=>{},1000)'), {status: 'timed-out', stdout: ''});
  assert(Date.now() - before < 1000);
  assert.deepEqual(await run('process.stdout.write("x".repeat(65))'), {status: 'output-limit', stdout: ''});
  assert.deepEqual(await run('process.stdout.write("x".repeat(32));process.stderr.write("private".repeat(6))'), {status: 'output-limit', stdout: ''});
  assert.deepEqual(await run('process.stderr.write("secret path");process.exit(17)'), {status: 'failed', stdout: ''});
  assert.deepEqual(await boundedDiskCommand('/does/not/exist/secret', [], options), {status: 'unavailable', stdout: ''});
  await assert.rejects(() => boundedDiskCommand(process.execPath, [], {...options, timeoutMs: 1001}));
  await assert.rejects(() => boundedDiskCommand(process.execPath, [], {...options, outputBytes: 1025}));
});

test('sampler uses only five closed labels, fixed host roots and argv without shell interpolation', async t => {
  const workspace = join(fixture(t), 'hostile\n$(DO_NOT_RUN)'), calls = [];
  const result = await diskComponents({workspace, execute: async (command, args, options) => {
    calls.push({command, args, options});
    return {status: 'complete', stdout: args[4] === '--capacity' ? '[0,8192,4096,1]' : '[0,4096,1,0,0,0]'};
  }});
  assert.equal(result.schema, 1);
  assert.deepEqual(Object.keys(result.components), diskComponentLabels);
  assert.equal(calls.length, 7);
  assert(calls.every(call => call.command === '/usr/bin/python3' && call.options.timeoutMs <= 1000
    && call.options.outputBytes === diskLimits.outputBytes));
  assert.deepEqual(calls.slice(0, 2).map(call => call.args.slice(4)), [['--capacity', workspace], ['--capacity', '/var/lib/docker']]);
  assert.deepEqual(result.capacity, {workspace: {status: 'ok', totalBytes: 8192, availableBytes: 4096, freeFiles: 1},
    docker: {status: 'ok', totalBytes: 8192, availableBytes: 4096, freeFiles: 1}});
  assert.deepEqual(calls.slice(2).map(call => call.args[4]), [join(workspace, 'target'), workspace,
    '/var/lib/docker', '/home/runner/actions-runner', '/opt/hostedtoolcache']);
  assert.deepEqual(calls.slice(2).map(call => call.args[5]), ['0', '1', '0', '0', '0']);
  assert(!JSON.stringify(result).includes('DO_NOT_RUN'));
  assert(!JSON.stringify(result).includes(workspace));
});

test('sampler translates all subprocess failures without leaking raw text or rejecting observation', async () => {
  const statuses = ['unavailable', 'timed-out', 'output-limit', 'failed', 'arbitrary secret']; let at = 0;
  const result = await diskComponents({execute: async (_command, args) =>
    ({status: args[4] === '--capacity' ? 'unavailable' : statuses[at++], stdout: 'secret path'})});
  assert.deepEqual(Object.values(result.components).map(row => row.status),
    ['unavailable', 'timed-out', 'output-limit', 'failed', 'invalid-output']);
  assert(Object.values(result.components).every(row => row.allocatedBytes === null));
  assert(!JSON.stringify(result).includes('secret'));
  const thrown = await diskComponents({execute: async () => {throw Error('private/path');}});
  assert(Object.values(thrown.components).every(row => row.status === 'unavailable'));
});

test('global elapsed budget prevents later scans and invalid bounds are rejected', async () => {
  let calls = 0;
  const result = await diskComponents({totalMs: 20, execute: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 25)); return {status: 'timed-out'};
  }});
  assert.equal(calls, 1);
  assert.equal(result.capacity.workspace.status, 'timed-out');
  assert.equal(result.capacity.docker.status, 'not-sampled');
  assert.equal(Object.values(result.components).filter(row => row.status === 'not-sampled').length, 5);
  for (const [key, maximum] of Object.entries(diskLimits)) {
    await assert.rejects(() => diskComponents({[key]: maximum + 1}));
    await assert.rejects(() => diskComponents({[key]: 0}));
  }
});

test('capacity uses timed child metadata only, rejects symlink roots and validates numeric protocol', t => {
  const root = fixture(t);
  const capacity = path => parseDiskCapacity(execFileSync('/usr/bin/python3', ['-I', '-S', '-B', walker, '--capacity', path],
    {encoding: 'utf8', timeout: 1500}));
  const result = capacity(root);
  assert.equal(result.status, 'ok'); assert(result.totalBytes > 0);
  assert(result.availableBytes >= 0 && result.availableBytes <= result.totalBytes);
  assert(Number.isSafeInteger(result.freeFiles));
  symlinkSync(root, join(root, 'alias'));
  assert.deepEqual(capacity(join(root, 'alias')), {status: 'unavailable'});
  assert.deepEqual(capacity(join(root, 'missing')), {status: 'unavailable'});
  for (const text of ['secret/path', '[0,1,2,3]', '[0,1,0,9007199254740992]', '[0,1,0,-1]', '[4,0,0,0]',
    '[3,1,0,0]', '[0,1,0,0,"secret"]', ' '.repeat(1025)]) {
    assert.deepEqual(parseDiskCapacity(text), {status: 'invalid-output'});
  }
});

test('component priority rotates deterministically without altering closed serialization order', async () => {
  const paths = [];
  const result = await diskComponents({componentOffset: 3, totalMs: 20, execute: async (_command, args) => {
    if (args[4] === '--capacity') return {status: 'complete', stdout: '[0,4096,1024,1]'};
    paths.push(args[4]);
    await new Promise(resolve => setTimeout(resolve, 25));
    return {status: 'timed-out'};
  }});
  assert.deepEqual(paths, ['/home/runner/actions-runner']);
  assert.deepEqual(Object.keys(result.components), diskComponentLabels);
  assert.equal(result.components['runner-installation'].status, 'timed-out');
  assert.equal(result.components['workspace-target'].status, 'not-sampled');
  for (const componentOffset of [-1, 5, 0.5]) await assert.rejects(() => diskComponents({componentOffset}));
});
