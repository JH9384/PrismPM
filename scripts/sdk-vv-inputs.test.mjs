// Transport-closure tests use real Git objects and synthetic, explicitly pinned
// bootstrap bytes. They do not execute or accept a historical SDK.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildClosure, verifyClosure } from './sdk-vv-inputs.mjs';
import * as inputs from './sdk-vv-inputs.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]));
  }
  return v;
}) + '\n';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Closure fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Closure fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_AUTHOR_DATE: '2026-09-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-09-01T00:00:00Z'
    }
  }).trim();
}

function repository(path) {
  mkdirSync(path);
  git(path, 'init', '--quiet');
  writeFileSync(join(path, 'data'), 'historical data\n');
  git(path, 'add', '.');
  git(path, 'commit', '--quiet', '-m', 'fixture historical commit');
  return git(path, 'rev-parse', 'HEAD');
}

function fixture(t) {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-sdk-inputs-test-'));
  t.after(() => rmSync(work, {
    recursive: true,
    force: true
  }));
  const source = join(work, 'source');
  const historical = repository(source);
  git(source, 'tag', '-a', 'v0.2.0', '-m', 'fixture historical tag');
  const tag = git(source, 'rev-parse', 'v0.2.0');
  const bootstrap = join(work, 'bootstrap.tar.gz');
  writeFileSync(bootstrap, 'synthetic pinned bootstrap archive, not an SDK\n');
  const bootstrapSha = hash(readFileSync(bootstrap));
  writeFileSync(join(source, 'tools.lock'), [
    '[bootstrap-sdk]',
    'version = "0.2.0"',
    `source_commit = "${historical}"`,
    `tag_object = "${tag}"`,
    'url = "https://github.com/UOR-Foundation/PrismPM/releases/download/v0.2.0/prismpm-0.2.0-x86_64-unknown-linux-gnu.tar.gz"',
    `sha256 = "${bootstrapSha}"`,
    ''
  ].join('\n'));
  mkdirSync(join(source, 'dir'));
  writeFileSync(join(source, 'dir', 'tool'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(source, 'dir', 'tool'), 0o755);
  symlinkSync('dir/tool', join(source, 'alias'));
  writeFileSync(join(source, 'unicode-λ'), 'literal data\n');
  git(source, 'add', '.');
  git(source, 'commit', '--quiet', '-m', 'fixture current source');
  const advisory = join(work, 'advisory');
  repository(advisory);
  writeFileSync(join(advisory, 'notice'), 'synthetic advisory fixture\n');
  git(advisory, 'add', '.');
  git(advisory, 'commit', '--quiet', '-m', 'fixture advisory snapshot');
  const policy = {
    schema: 'prismpm/sdk-vv-input-policy/1',
    source_revision: git(source, 'rev-parse', 'HEAD'),
    historical_revision: historical,
    historical_tag: tag,
    bootstrap_sha256: bootstrapSha,
    advisory_revision: git(advisory, 'rev-parse', 'HEAD'),
    advisory_tree: git(advisory, 'rev-parse', 'HEAD^{tree}')
  };
  return {
    work,
    source,
    advisory,
    bootstrap,
    policy,
    destination: join(work, 'closure')
  };
}
test('exact source/history, modes and confined aliases survive deterministic closure and independent verification', t => {
  const f = fixture(t);
  buildClosure(f);
  const first = verifyClosure(f.destination, f.policy);
  assert.equal(first.scope, 'sdk-vv-inputs-only');
  assert.equal(first.source.files.find(row => row.path === 'dir/tool').mode, '100755');
  assert.equal(first.source.files.find(row => row.path === 'alias').target, 'dir/tool');
  const second = join(f.work, 'second');
  buildClosure({
    ...f,
    destination: second
  });
  assert.deepEqual(readFileSync(join(second, 'manifest.json')), readFileSync(join(f.destination, 'manifest.json')));
  for (const row of first.artifacts) {
    assert.deepEqual(readFileSync(join(second, row.path)), readFileSync(join(f.destination, row.path)));
  }
});

test('Git configuration, hooks, credentials, untracked files and unrelated refs never enter the closure', t => {
  const f = fixture(t);
  buildClosure(f);
  const before = readFileSync(join(f.destination, 'manifest.json'));
  git(f.source, 'config', 'credential.helper', 'do-not-copy-secret');
  writeFileSync(join(f.source, '.git', 'hooks', 'secret'), 'private hook secret');
  writeFileSync(join(f.source, 'untracked-secret'), 'private content');
  git(f.source, 'checkout', '--quiet', '-b', 'unrelated');
  writeFileSync(join(f.source, 'unrelated-secret'), 'private branch');
  git(f.source, 'add', '.');
  git(f.source, 'commit', '--quiet', '-m', 'private unrelated history');
  git(f.source, 'checkout', '--quiet', f.policy.source_revision);
  const second = join(f.work, 'isolated');
  buildClosure({
    ...f,
    destination: second
  });
  assert.deepEqual(readFileSync(join(second, 'manifest.json')), before);
  verifyClosure(second, f.policy);
});

test('each missing, additional, changed, linked or noncanonical closure artifact is rejected', t => {
  const f = fixture(t);
  buildClosure(f);
  let n = 0;
  for (const change of [
    dir => rmSync(join(dir, 'source.pack')),
    dir => writeFileSync(join(dir, 'extra'), 'x'),
    dir => writeFileSync(join(dir, 'bootstrap.tar.gz'), 'substituted'),
    dir => {
      rmSync(join(dir, 'advisory.pack'));
      symlinkSync(join(f.destination, 'advisory.pack'), join(dir, 'advisory.pack'));
    },
    dir => writeFileSync(join(dir, 'manifest.json'), readFileSync(join(dir, 'manifest.json'), 'utf8') + ' '),
    dir => {
      const path = join(dir, 'manifest.json');
      const value = JSON.parse(readFileSync(path));
      value.extra = true;
      writeFileSync(path, JSON.stringify(value));
    }
  ]) {
    const dir = join(f.work, 'mutant-' + n++);
    cpSync(f.destination, dir, {
      recursive: true
    });
    change(dir);
    assert.throws(() => verifyClosure(dir, f.policy));
  }
});

test('external pins cannot be supplied by the packaged manifest itself', t => {
  const f = fixture(t);
  buildClosure(f);
  for (const key of [
    'source_revision', 'historical_revision', 'historical_tag', 'bootstrap_sha256',
    'advisory_revision', 'advisory_tree'
  ]) {
    assert.throws(() => verifyClosure(f.destination, {
      ...f.policy,
      [key]: '0'.repeat(key === 'bootstrap_sha256' ? 64 : 40)
    }));
  }
  assert.throws(() => verifyClosure(f.destination, {
    ...f.policy,
    extra: true
  }));
});

test('existing or aliased destinations are never overwritten, and dirty tracked input is rejected', t => {
  const f = fixture(t);
  mkdirSync(f.destination);
  writeFileSync(join(f.destination, 'keep'), 'caller data');
  assert.throws(() => buildClosure(f));
  assert.equal(readFileSync(join(f.destination, 'keep'), 'utf8'), 'caller data');
  const alias = join(f.work, 'alias');
  symlinkSync(f.destination, alias);
  assert.throws(() => buildClosure({
    ...f,
    destination: alias
  }));
  writeFileSync(join(f.source, 'data'), 'dirty');
  const dest = join(f.work, 'dirty');
  assert.throws(() => buildClosure({
    ...f,
    destination: dest
  }));
  assert.ok(!existsSync(dest));
});

test('escaping source symlinks and incomplete history fail closed', t => {
  const f = fixture(t);
  symlinkSync('../../outside', join(f.source, 'escape'));
  git(f.source, 'add', 'escape');
  git(f.source, 'commit', '--quiet', '-m', 'invalid alias');
  const policy = {
    ...f.policy,
    source_revision: git(f.source, 'rev-parse', 'HEAD')
  };
  assert.throws(() => buildClosure({
    ...f,
    policy
  }));
  assert.ok(!existsSync(f.destination));
  git(f.source, 'checkout', '--quiet', f.policy.source_revision);
  writeFileSync(join(f.source, '.git', 'shallow'), f.policy.source_revision + '\n');
  assert.throws(() => buildClosure(f));
});

test('bootstrap substitution and undeclared advisory revision are rejected before output', t => {
  const f = fixture(t);
  assert.throws(() => buildClosure({
    ...f,
    policy: {
      ...f.policy,
      advisory_revision: '0'.repeat(40)
    }
  }));
  assert.ok(!existsSync(f.destination));
  writeFileSync(f.bootstrap, 'wrong bytes');
  assert.throws(() => buildClosure(f));
  assert.ok(!existsSync(f.destination));
});

test('caller Git executable configuration is not executed', t => {
  const f = fixture(t);
  const sentinel = join(f.work, 'executed');
  const hook = join(f.work, 'fsmonitor');
  writeFileSync(hook, `#!/bin/sh\nprintf called > '${sentinel}'\nprintf 'token\\0'\n`);
  chmodSync(hook, 0o755);
  git(f.source, 'config', 'core.fsmonitor', hook);
  buildClosure(f);
  assert.ok(!existsSync(sentinel), 'caller fsmonitor executed');
});

test('directory aliases followed by parent traversal cannot escape the source root', t => {
  const f = fixture(t);
  mkdirSync(join(f.source, 'a', 'b'), {
    recursive: true
  });
  mkdirSync(join(f.source, 'c'));
  writeFileSync(join(f.source, 'c', 'file'), 'data');
  writeFileSync(join(f.source, 'a', 'secret'), 'lexical decoy');
  symlinkSync('../../c', join(f.source, 'a', 'b', 'x'));
  symlinkSync('x/../../secret', join(f.source, 'a', 'b', 'link'));
  git(f.source, 'add', '.');
  git(f.source, 'commit', '--quiet', '-m', 'alias traversal');
  assert.throws(() => buildClosure({
    ...f,
    policy: {
      ...f.policy,
      source_revision: git(f.source, 'rev-parse', 'HEAD')
    }
  }));
});

test('coherently rehashed manifest drift and extra actual Git objects still fail', t => {
  const f = fixture(t);
  buildClosure(f);
  let n = 0;
  for (const change of [
    value => value.source.files.pop(),
    value => value.source.files.find(row => row.path === 'dir/tool').mode = '100644',
    value => value.advisory.authority = 'https://example.invalid/substitute',
    value => value.source.extra = 'ignored'
  ]) {
    const directory = join(f.work, 'metadata-' + n++);
    cpSync(f.destination, directory, {
      recursive: true
    });
    const path = join(directory, 'manifest.json');
    const value = JSON.parse(readFileSync(path));
    change(value);
    writeFileSync(path, canonical(value));
    assert.throws(() => verifyClosure(directory, f.policy));
  }
  const extra = execFileSync('git', ['-C', f.source, 'hash-object', '-w', '--stdin'], {
    input: 'unrelated object, not a declared input\n',
    encoding: 'utf8'
  }).trim();
  const ids = git(f.source, 'rev-list', '--objects', '--no-object-names',
    f.policy.source_revision, f.policy.historical_tag).split('\n');
  const bytes = execFileSync('git', ['-C', f.source, 'pack-objects', '--stdout', '--threads=1'], {
    input: [...ids, extra].sort().join('\n') + '\n'
  });
  writeFileSync(join(f.destination, 'source.pack'), bytes);
  const path = join(f.destination, 'manifest.json');
  const value = JSON.parse(readFileSync(path));
  value.artifacts.find(row => row.path === 'source.pack').sha256 = hash(bytes);
  value.artifacts.find(row => row.path === 'source.pack').byte_length = bytes.length;
  writeFileSync(path, canonical(value));
  assert.throws(() => verifyClosure(f.destination, f.policy), /undeclared or missing Git objects/);
});

test('shallow advisory snapshot is accepted explicitly while source grafts and alternate stores are rejected', t => {
  const f = fixture(t);
  writeFileSync(join(f.advisory, '.git', 'shallow'), f.policy.advisory_revision + '\n');
  buildClosure(f);
  verifyClosure(f.destination, f.policy);
  for (const relative of ['info/grafts', 'objects/info/alternates']) {
    const path = join(f.source, '.git', relative);
    writeFileSync(path, 'unreviewed history lookup\n');
    assert.throws(() => buildClosure({
      ...f,
      destination: join(f.work, 'forbidden')
    }), /grafts and alternate/);
    rmSync(path);
  }
});

test('repacking and separate checkout roots do not change deterministic artifacts', t => {
  const f = fixture(t);
  buildClosure(f);
  const copy = join(f.work, 'other-root');
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', f.source, copy]);
  git(copy, 'repack', '-adf', '--window=50', '--depth=100');
  const destination = join(f.work, 'repacked');
  buildClosure({
    ...f,
    source: copy,
    destination
  });
  for (const name of ['source.pack', 'advisory.pack', 'bootstrap.tar.gz', 'manifest.json']) {
    assert.deepEqual(readFileSync(join(destination, name)), readFileSync(join(f.destination, name)));
  }
});

test('real linked worktree metadata and packed refs retain exact source identity', t => {
  const f = fixture(t);
  buildClosure(f);
  git(f.source, 'pack-refs', '--all');
  const linked = join(f.work, 'linked');
  git(f.source, 'worktree', 'add', '--quiet', '--detach', linked, f.policy.source_revision);
  const destination = join(f.work, 'linked-closure');
  buildClosure({
    ...f,
    source: linked,
    destination
  });
  assert.deepEqual(readFileSync(join(destination, 'manifest.json')),
    readFileSync(join(f.destination, 'manifest.json')));
});

test('actual pack framing and declared resource limits are enforced despite coherent outer hashes', t => {
  const f = fixture(t);
  buildClosure(f);
  let n = 0;
  for (const mutate of [
    bytes => {
      bytes.writeUInt32BE(500001, 8);
      return bytes;
    },
    bytes => {
      bytes.writeUInt32BE(4, 4);
      return bytes;
    },
    bytes => Buffer.concat([
      bytes.subarray(0, 12), Buffer.from([0xb0, 0x80, 0x80, 0x80, 0x20]), bytes.subarray(13)
    ]),
    bytes => Buffer.concat([bytes.subarray(0, 14), bytes.subarray(22)])
  ]) {
    const directory = join(f.work, 'bad-pack-' + n++);
    cpSync(f.destination, directory, {
      recursive: true
    });
    const path = join(directory, 'source.pack');
    const bytes = mutate(readFileSync(path));
    createHash('sha1').update(bytes.subarray(0, -20)).digest().copy(bytes, bytes.length - 20);
    writeFileSync(path, bytes);
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')));
    const row = manifest.artifacts.find(row => row.path === 'source.pack');
    row.sha256 = hash(bytes);
    row.byte_length = bytes.length;
    writeFileSync(join(directory, 'manifest.json'), canonical(manifest));
    assert.throws(() => verifyClosure(directory, f.policy));
  }
});

test('valid component-wise directory aliases and parent steps remain admissible', t => {
  const f = fixture(t);
  mkdirSync(join(f.source, 'a', 'b'), {
    recursive: true
  });
  mkdirSync(join(f.source, 'c'));
  writeFileSync(join(f.source, 'c', 'file'), 'data');
  symlinkSync('../../c', join(f.source, 'a', 'b', 'x'));
  symlinkSync('x/../c/file', join(f.source, 'a', 'b', 'link'));
  git(f.source, 'add', '.');
  git(f.source, 'commit', '--quiet', '-m', 'confined component alias');
  const policy = {
    ...f.policy,
    source_revision: git(f.source, 'rev-parse', 'HEAD')
  };
  buildClosure({
    ...f,
    policy
  });
  verifyClosure(f.destination, policy);
});

test('bounded real Git producer failure cleans only its newly owned output', t => {
  const f = fixture(t);
  assert.throws(() => buildClosure({
    ...f,
    maxPackBytes: 32
  }), /bounded Git operation failed/);
  assert.ok(!existsSync(f.destination));
  assert.ok(existsSync(f.source));
  assert.ok(existsSync(f.advisory));
  assert.ok(existsSync(f.bootstrap));
  assert.throws(() => buildClosure({
    ...f,
    maxPackBytes: 1024 * 1024 * 1024
  }), /can only lower/);
});

test('materialization restores exact independent writable source/history and advisory checkouts', t => {
  const f = fixture(t);
  buildClosure(f);
  const destination = join(f.work, 'workspace');
  const manifest = inputs.materializeClosure(f.destination, f.policy, destination);
  assert.deepEqual(manifest, verifyClosure(f.destination, f.policy));
  const source = join(destination, 'source');
  const advisory = join(destination, 'advisory');
  assert.equal(git(source, 'rev-parse', 'HEAD'), f.policy.source_revision);
  assert.equal(git(source, 'rev-parse', 'v0.2.0'), f.policy.historical_tag);
  assert.equal(git(source, 'show', `${f.policy.historical_revision}:data`), 'historical data');
  assert.equal(git(advisory, 'rev-parse', 'HEAD'), f.policy.advisory_revision);
  assert.equal(git(advisory, 'rev-parse', 'HEAD^{tree}'), f.policy.advisory_tree);
  assert.equal(readFileSync(join(advisory, '.git', 'shallow'), 'utf8'), f.policy.advisory_revision + '\n');
  assert.equal(readlinkSync(join(source, 'alias')), 'dir/tool');
  assert.ok(statSync(join(source, 'dir', 'tool')).mode & 0o111);
  assert.equal(git(source, 'status', '--porcelain'), '');
  assert.equal(git(advisory, 'status', '--porcelain'), '');
  assert.equal(git(source, 'remote'), '');
  assert.equal(git(advisory, 'remote'), '');
  assert.ok(!existsSync(join(source, '.git', 'objects', 'info', 'alternates')));
  assert.deepEqual(readFileSync(join(destination, 'bootstrap.tar.gz')), readFileSync(f.bootstrap));
  for (const name of ['source.pack', 'advisory.pack', 'manifest.json', 'bootstrap.tar.gz']) {
    assert.equal(statSync(join(f.destination, name)).nlink, 1);
  }
  rmSync(f.source, { recursive: true });
  rmSync(f.advisory, { recursive: true });
  rmSync(f.destination, { recursive: true });
  assert.equal(git(source, 'show', `${f.policy.historical_revision}:data`), 'historical data');
  writeFileSync(join(source, 'data'), 'local verification workspace change\n');
  assert.ok(git(source, 'status', '--porcelain').includes('data'));
  assert.equal(readFileSync(join(advisory, 'data'), 'utf8'), 'historical data\n');
});

test('materialization rejects changed bytes, external-policy drift and occupied destinations without writes', t => {
  const f = fixture(t);
  buildClosure(f);
  const occupied = join(f.work, 'occupied');
  mkdirSync(occupied);
  writeFileSync(join(occupied, 'keep'), 'caller data');
  assert.throws(() => inputs.materializeClosure(f.destination, f.policy, occupied), /destination must not exist/);
  assert.equal(readFileSync(join(occupied, 'keep'), 'utf8'), 'caller data');
  const destination = join(f.work, 'rejected');
  assert.throws(() => inputs.materializeClosure(f.destination, {
    ...f.policy, source_revision: '0'.repeat(40)
  }, destination), /external input policy differs/);
  assert.ok(!existsSync(destination));
  writeFileSync(join(f.destination, 'source.pack'), 'tampered');
  assert.throws(() => inputs.materializeClosure(f.destination, f.policy, destination), /artifact bytes differ/);
  assert.ok(!existsSync(destination));
});

test('materialization preserves committed raw bytes without executing repository checkout filters', t => {
  const f = fixture(t);
  writeFileSync(join(f.source, '.gitattributes'), 'data -text\n');
  writeFileSync(join(f.source, 'data'), 'raw\r\nbytes\r\n');
  git(f.source, 'add', '.');
  git(f.source, 'commit', '--quiet', '-m', 'literal CRLF source');
  writeFileSync(join(f.source, '.gitattributes'), 'data text eol=lf filter=untrusted\n');
  git(f.source, 'add', '.gitattributes');
  git(f.source, 'commit', '--quiet', '-m', 'attributes must not rewrite raw committed blobs');
  const policy = { ...f.policy, source_revision: git(f.source, 'rev-parse', 'HEAD') };
  buildClosure({ ...f, policy });
  const destination = join(f.work, 'raw');
  inputs.materializeClosure(f.destination, policy, destination);
  assert.deepEqual(readFileSync(join(destination, 'source', 'data')), Buffer.from('raw\r\nbytes\r\n'));
  assert.equal(git(join(destination, 'source'), 'show', 'HEAD:data'), 'raw\r\nbytes');
});

test('materialization bounds total checkout bytes and never places outputs inside the input closure', t => {
  const f = fixture(t);
  buildClosure(f);
  const destination = join(f.work, 'bounded');
  assert.throws(() => inputs.materializeClosure(f.destination, f.policy, destination, { maxCheckoutBytes: 1 }),
    /checkout exceeds/);
  assert.ok(!existsSync(destination));
  assert.throws(() => inputs.materializeClosure(f.destination, f.policy, destination,
    { maxCheckoutBytes: 5 * 1024 ** 3 }), /can only lower/);
  assert.throws(() => inputs.materializeClosure(f.destination, f.policy, join(f.destination, 'output')),
    /outside/);
  const alias = join(f.work, 'input-alias');
  symlinkSync(f.destination, alias);
  assert.throws(() => inputs.materializeClosure(alias, f.policy, destination), /must not be aliased/);
  verifyClosure(f.destination, f.policy);
});

function withGitObserver(work, observe, action) {
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = join(work, 'observed-bin');
  mkdirSync(bin);
  const wrapper = join(bin, 'git');
  writeFileSync(wrapper, `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
${observe}
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
if (result.signal) process.kill(process.pid, result.signal);
else process.exit(result.status ?? 127);
`);
  chmodSync(wrapper, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = bin + ':' + previous;
  try { return action(); }
  finally { process.env.PATH = previous; }
}

test('materialization uses captured bytes even if input files change after complete verification', t => {
  const f = fixture(t);
  buildClosure(f);
  const expectedBootstrap = readFileSync(f.bootstrap);
  const destination = join(f.work, 'captured');
  withGitObserver(f.work, `if (args.includes('--template=')) {
  fs.writeFileSync(${JSON.stringify(join(f.destination, 'source.pack'))}, 'changed after verification');
  fs.writeFileSync(${JSON.stringify(join(f.destination, 'bootstrap.tar.gz'))}, 'changed after verification');
}`, () => inputs.materializeClosure(f.destination, f.policy, destination));
  assert.equal(git(join(destination, 'source'), 'rev-parse', 'HEAD'), f.policy.source_revision);
  assert.deepEqual(readFileSync(join(destination, 'bootstrap.tar.gz')), expectedBootstrap);
  assert.throws(() => verifyClosure(f.destination, f.policy), /artifact bytes differ/);
});

test('failed Git reconstruction removes only its fresh partial output and retains all input evidence', t => {
  const f = fixture(t);
  buildClosure(f);
  const destination = join(f.work, 'interrupted');
  const callerData = join(f.work, 'caller-data');
  writeFileSync(callerData, 'must survive');
  withGitObserver(f.work, `if (args.includes('read-tree') && args.includes(${JSON.stringify(f.policy.advisory_revision)})) process.exit(73);`,
    () => assert.throws(() => inputs.materializeClosure(f.destination, f.policy, destination), /Git read-tree failed/));
  assert.ok(!existsSync(destination));
  assert.equal(readFileSync(callerData, 'utf8'), 'must survive');
  verifyClosure(f.destination, f.policy);
});
