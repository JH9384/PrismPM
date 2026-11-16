import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assembleVvEvidence, canonical, executionEnvironment, gateInvocation, retainPart, validateVvEvidence, validateVvPart, vvParts } from './sdk-vv-run.mjs';
import { stop } from './ci-observe.mjs';
import {bootstrapFixture} from './sdk-bootstrap-retention-fixture.mjs';

const revision = '1'.repeat(40);
const image = `localhost:5000/prismpm@sha256:${'2'.repeat(64)}`;
const evidence = () => ({ commit: revision, gates: Array.from({ length: 15 }, (_, i) => i + 1), schema: 'prismpm/vv-evidence/1', status: 'passed' });
const partEvidence = (part = 'source') => ({ commit: revision, part, schema: 'prismpm/vv-part/1', status: 'passed' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function writeResult(f, bytes) {
  writeFileSync(f.input, bytes);
  for (const [name, raw] of bootstrapFixture(revision).files) writeFileSync(join(f.source, 'target', name), raw);
}

function fixture(t) {
  const work = mkdtempSync(join(tmpdir(), 'sdk-vv-run-tests.'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const source = join(work, 'source'), output = join(work, 'evidence');
  mkdirSync(join(source, 'target'), { recursive: true });
  mkdirSync(output);
  return { work, source, output, input: join(source, 'target/vv-part-source.json') };
}

test('exact raw VV evidence requires all ordered gates and the external source revision', () => {
  const bytes = Buffer.from(canonical(evidence()));
  assert.deepEqual(validateVvEvidence(bytes, revision), evidence());
  for (const mutate of [
    value => { value.gates.pop(); },
    value => { value.gates[4] = 4; },
    value => { value.gates.reverse(); },
    value => { value.status = 'skipped'; },
    value => { value.commit = '3'.repeat(40); },
    value => { value.schema = 'prismpm/vv-evidence/2'; },
    value => { value.accepted = true; },
  ]) {
    const value = evidence(); mutate(value);
    assert.throws(() => validateVvEvidence(Buffer.from(canonical(value)), revision));
  }
  for (const bytes of [Buffer.from('{}'), Buffer.from(JSON.stringify(evidence(), null, 2)), Buffer.from(canonical(evidence()) + '\n'), Buffer.alloc(4097)]) {
    assert.throws(() => validateVvEvidence(bytes, revision));
  }
});

test('one part execution retains its unchanged raw evidence after removing stale success', async t => {
  const f = fixture(t), bytes = Buffer.from(canonical(partEvidence()));
  writeFileSync(f.input, bytes);
  let calls = 0;
  const retained = await retainPart(f.source, f.output, revision, 'source', async () => {
    assert(!existsSync(f.input), 'previous success must be invalidated before execution');
    calls++;
    writeResult(f, bytes);
    return 0;
  });
  assert.equal(calls, 1);
  assert.deepEqual(retained, { part: 'source', path: 'part/vv-part.json', byte_length: bytes.length, sha256: sha(bytes) });
  assert.deepEqual(readFileSync(join(f.output, retained.path)), bytes);
  assert(existsSync(join(f.output, 'bootstrap.json')));
  for (const part of vvParts.filter(part => part !== 'source')) {
    const other = fixture(t), raw = Buffer.from(canonical(partEvidence(part)));
    await retainPart(other.source, other.output, revision, part, async () => { writeFileSync(join(other.source, `target/vv-part-${part}.json`), raw); return 0; });
    assert(!existsSync(join(other.output, 'bootstrap.json')), 'only the source part runs the bootstrap gate');
  }
});

test('failed, missing, wrong-commit, wrong-part or aliased results cannot promote a part', async t => {
  for (const mode of ['nonzero', 'missing', 'wrong-commit', 'wrong-part', 'symlink', 'directory']) {
    const f = fixture(t), bytes = Buffer.from(canonical(partEvidence()));
    let calls = 0;
    await assert.rejects(retainPart(f.source, f.output, revision, 'source', async () => {
      calls++;
      if (mode === 'nonzero') { writeFileSync(f.input, bytes); return 7; }
      if (mode === 'missing') return 0;
      if (mode === 'directory') mkdirSync(f.input);
      if (mode === 'wrong-commit') writeFileSync(f.input, canonical({ ...partEvidence(), commit: '4'.repeat(40) }));
      if (mode === 'wrong-part') writeFileSync(f.input, canonical(partEvidence('gates')));
      if (mode === 'symlink') { writeFileSync(join(f.work, 'elsewhere'), bytes); symlinkSync(join(f.work, 'elsewhere'), f.input); }
      return 0;
    }));
    assert.equal(calls, 1);
    assert(!existsSync(join(f.output, 'part/vv-part.json')));
  }
});

test('assembled evidence requires exactly every passed part of one commit', () => {
  const records = () => new Map(vvParts.map(part => [part, Buffer.from(canonical(partEvidence(part)))]));
  assert.deepEqual(validateVvEvidence(assembleVvEvidence(records(), revision), revision), evidence());
  assert.deepEqual(validateVvPart(records().get('source'), revision, 'source'), partEvidence());
  for (const mutate of [
    map => map.delete('st-sy'),
    map => map.set('extra', map.get('source')),
    map => map.set('st-sy', map.get('source')),
    map => map.set('source', Buffer.from(canonical({ ...partEvidence(), status: 'failed' }))),
    map => map.set('source', Buffer.from(canonical({ ...partEvidence(), commit: '4'.repeat(40) }))),
    map => map.set('source', Buffer.from(canonical({ ...partEvidence(), extra: true }))),
    map => map.set('source', Buffer.from(canonical(partEvidence()) + '\n')),
  ]) {
    const map = records(); mutate(map);
    assert.throws(() => assembleVvEvidence(map, revision));
  }
});

test('SIGHUP cancels the actual observer, stops its monitor and cannot return success', { timeout: 25000 }, async t => {
  const f = fixture(t);
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const directory = join(f.work, 'diagnostics'), ready = join(f.work, 'ready');
  const gate = `require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setTimeout(() => process.exit(0), 15000);`;
  const invocation = {
    command: process.execPath,
    args: [join(root, 'scripts/ci-observe.mjs'), 'run', directory, '--', process.execPath, '-e', gate],
    cwd: root,
  };
  const runner = new URL('./sdk-vv-run.mjs', import.meta.url).href;
  const wrapper = spawn(process.execPath, ['--input-type=module', '-e', `
    import { executeGate } from ${JSON.stringify(runner)};
    try { process.exitCode = await executeGate(${JSON.stringify(invocation)}, process.env); }
    catch { process.exitCode = 1; }
  `], { stdio: 'ignore' });
  let closed = false;
  const completion = new Promise((resolve, reject) => {
    wrapper.once('error', reject);
    wrapper.once('close', (code, signal) => { closed = true; resolve({ code, signal }); });
  });
  try {
    const deadline = Date.now() + 10000;
    while (!existsSync(ready)) {
      assert(!closed && Date.now() < deadline, 'actual observed gate must start');
      await delay(20);
    }
    wrapper.kill('SIGHUP');
    const result = await Promise.race([
      completion,
      delay(10000, undefined, { ref: false }).then(() => { throw Error('cancellation did not finish'); }),
    ]);
    assert.notEqual(result.code, 0);
    assert(existsSync(join(directory, 'stop')), 'observer monitor must be stopped cooperatively');
    const monitor = JSON.parse(readFileSync(join(directory, 'monitor-result.json')));
    assert.equal(monitor.reason, 'stopped');
    const observed = JSON.parse(readFileSync(join(directory, 'gate-result.json')));
    assert.equal(observed.state, 'completed');
    assert.notEqual(observed.exitCode, 0);
    const pid = Number(readFileSync(ready, 'utf8'));
    let state = 'absent';
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert(['absent', 'Z'].includes(state), 'owned command must no longer execute');
  } finally {
    if (!closed) wrapper.kill('SIGKILL');
    await completion;
    // This exact private monitor must also be cleaned when testing the defect.
    if (existsSync(join(directory, 'owner.json'))) await stop(directory);
  }
});

test('failure never overwrites caller evidence', async t => {
  const f = fixture(t);
  let calls = 0;
  await assert.rejects(retainPart(f.source, f.output, revision, 'source', async () => { calls++; return 1; }));
  assert.equal(calls, 1);
  const other = fixture(t);
  mkdirSync(join(other.output, 'part'));
  writeFileSync(join(other.output, 'part/sentinel'), 'retain');
  await assert.rejects(retainPart(other.source, other.output, revision, 'source', async () => { throw Error('must not execute'); }));
  assert.equal(readFileSync(join(other.output, 'part/sentinel'), 'utf8'), 'retain');
  await assert.rejects(retainPart(other.source, other.output, revision, 'other', async () => { throw Error('must not execute'); }));
});

test('exact part gate invocation has no alternate binary, source command or login shell', () => {
  assert.deepEqual(gateInvocation('/fresh/source', '/fresh/evidence/part', 'dk-2'), {
    command: '/usr/local/bin/node',
    args: ['/fresh/source/scripts/ci-observe.mjs', 'run', '/fresh/evidence/part/diagnostics', '--', '/usr/local/bin/just', 'vv-part', 'dk-2'],
    cwd: '/fresh/source',
  });
  assert.throws(() => gateInvocation('/fresh/source', '/fresh/evidence/part', 'other'));
});

test('a successful part marker cannot replace the four original bootstrap outputs', async t => {
  const f = fixture(t);
  await assert.rejects(retainPart(f.source, f.output, revision, 'source', async () => {
    writeFileSync(f.input, canonical(partEvidence()));
    return 0;
  }));
});

test('execution environment uses fresh writable caches and fixed SDK tools, not caller overrides', () => {
  const environment = executionEnvironment('/fresh', image, 'unix:///var/run/docker.sock');
  assert.equal(environment.PRISMPM_TEST_SDK_IMAGE, image);
  assert.equal(environment.CARGO_HOME, '/fresh/cargo');
  assert.equal(environment.CARGO_TARGET_DIR, '/fresh/inputs/source/target/vv-driver');
  assert.equal(environment.CARGO_NET_OFFLINE, 'true');
  assert.equal(environment.DOCKER_CONFIG, '/fresh/docker');
  assert.equal(environment.HOME, '/fresh/home', 'HOME is a fresh owned directory, never inherited');
  assert.equal(environment.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(environment.PRISMPM_SDK_INVENTORY, '/opt/prismpm/share/inventory.json');
  for (const key of ['LD_PRELOAD', 'RUSTC_WRAPPER', 'CARGO_ENCODED_RUSTFLAGS', 'GH_TOKEN', 'NODE_OPTIONS', 'BASH_ENV', 'ENV']) assert(!Object.hasOwn(environment, key));
  for (const endpoint of ['tcp://remote:2375', 'unix://relative', 'unix:///tmp/../escape', 'unix:///']) assert.throws(() => executionEnvironment('/fresh', image, endpoint));
  for (const ref of ['sdk:latest', `${image}#other`, '', 'https://registry/image']) assert.throws(() => executionEnvironment('/fresh', ref, 'unix:///var/run/docker.sock'));
});
