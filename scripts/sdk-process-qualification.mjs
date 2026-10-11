// Complete native process/staging units; never installed-SDK acceptance.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execute} from './sdk-vv-check.mjs';
import {captureQualificationFiles} from './sdk-registry-qualification.mjs';
import {verifyTap, verifyFileCompletions} from './browser-api-sdk-check.mjs';

const output = '/evidence', source = process.env.SOURCE_REVISION;
assert.match(source, /^[a-f0-9]{40}$/);
assert.equal(process.version, 'v22.23.2');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.RUNNER_OS, 'Linux'); assert.equal(process.platform, 'linux');
assert(['amd64', 'arm64'].includes(process.env.QUALIFICATION_ARCH));
assert.equal(process.arch, process.env.QUALIFICATION_ARCH === 'amd64' ? 'x64' : 'arm64');
assert.equal(process.env.RUNNER_ARCH, process.arch === 'x64' ? 'X64' : 'ARM64');
const git = args => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 4 * 1024 ** 2});
assert.equal(git(['rev-parse', 'HEAD']).trim(), source);
assert.equal(git(['status', '--porcelain']), '');
const paths = git(['ls-files', '-z']).split('\0').filter(Boolean);
const inputs = captureQualificationFiles(paths);
const write = (name, value) => writeFileSync(output + '/' + name, JSON.stringify(value) + '\n', {flag: 'wx'});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
write('inputs.json', {source, files: inputs});
const python = await execute('/usr/bin/python3', ['-I', '-B', '-c', 'import sys; print(".".join(map(str,sys.version_info[:3])))']);
assert.equal(python.status, 0); assert.equal(python.signal, null);
assert.equal(python.stdout.toString().trim(), '3.11.2'); assert.equal(python.retirement.descendants_absent, true);
const interpreter = readFileSync('/usr/bin/python3');
write('interpreter.json', {path: '/usr/bin/python3', version: '3.11.2', bytes: interpreter.length,
  sha256: hash(interpreter), process_retirement: python.retirement});
const owners = new Map([
  ['scripts/sdk-vv-check.test.mjs', 20],
  ['scripts/sdk-command-owner.test.mjs', 12],
  ['scripts/sdk-registry-qualification.test.mjs', 17],
  ['scripts/sdk-construction-archive.test.mjs', 14],
  ['scripts/sdk-construction-stage.test.mjs', 17],
  ['scripts/sdk-construction-acquire.test.mjs', 6],
  ['scripts/sdk-construction-observe.test.mjs', 17],
]);
const args = ['--test', '--test-concurrency=1', '--test-timeout=120000',
  '--test-reporter=./scripts/owning-node-reporter.mjs', ...owners.keys()];
write('command.json', {source, program: process.execPath, args, timeout_ms: 150000,
  architecture: process.arch, owners: [...owners], scope: 'all original71 process/construction cases plus2 actual normal-exit cases,1 whole wrapper-lifecycle unit,12 supervisor controls and complete17 registry-process cases; unchanged deadlines'});
let result, failure, sourceUnchanged = false;
try {
  try { result = await execute(process.execPath, args, {timeout: 150000, limit: 16 * 1024 ** 2}); }
  catch (error) { failure = error; result = error.result; }
  assert(result, 'original process result must be retained');
  writeFileSync(output + '/owner.log', result.stdout, {flag: 'wx'});
  writeFileSync(output + '/owner.stderr', result.stderr, {flag: 'wx'});
  assert.deepEqual(captureQualificationFiles(paths), inputs);
  assert.equal(git(['rev-parse', 'HEAD']).trim(), source); assert.equal(git(['status', '--porcelain']), '');
  sourceUnchanged = true;
  if (failure) throw failure;
  assert.equal(result.status, 0); assert.equal(result.signal, null);
  const tap = result.stdout.toString();
  assert.equal(verifyTap(tap, 103), 103);
  verifyFileCompletions(tap, [...owners.keys()].map(path => resolve(path)), 103);
  const expected = new Map([...owners].map(([path, count]) => [resolve(path), count]));
  for (const line of tap.split(/\r?\n/).filter(line => line.startsWith('# prismpm-owning-file '))) {
    const row = JSON.parse(line.slice('# prismpm-owning-file '.length));
    assert.equal(row.tests, expected.get(row.file), 'complete original owning-file count required');
  }
} catch (error) { failure = error; }
finally {
  const memory = Object.fromEntries(['memory.current', 'memory.peak', 'memory.events',
    'memory.max', 'memory.swap.max', 'memory.swap.current', 'memory.swap.peak', 'memory.swap.events',
    'cpu.max', 'pids.max']
    .map(key => [key, readFileSync('/sys/fs/cgroup/' + key, 'utf8')]));
  try {
    assert.equal(memory['memory.max'].trim(), '1073741824');
    assert.equal(memory['memory.swap.max'].trim(), '0');
    assert.equal(memory['memory.swap.current'].trim(), '0');
    assert.equal(memory['memory.swap.peak'].trim(), '0');
    assert.equal(memory['pids.max'].trim(), '256');
    const [quota, period] = memory['cpu.max'].trim().split(/\s+/).map(Number);
    assert(Number.isSafeInteger(quota) && quota > 0 && Number.isSafeInteger(period) && period > 0);
    assert.equal(quota, 2 * period);
    for (const key of ['memory.events', 'memory.swap.events']) {
      const events = Object.fromEntries(memory[key].trim().split('\n').map(line => line.split(/\s+/)));
      for (const [name, count] of Object.entries(events)) { assert.match(count, /^\d+$/); assert.equal(Number(count), 0, name); }
    }
  } catch (error) { failure ??= error; }
  write('completed.json', {source, architecture: process.arch, status: result?.status ?? null,
    signal: result?.signal ?? null, passed: !failure, source_unchanged: sourceUnchanged, memory,
    ...(result ? {stdout_sha256: hash(result.stdout), stderr_sha256: hash(result.stderr),
      ...(result.retirement ? {process_retirement: result.retirement} : {})} : {}),
    failure: failure ? String(failure) : null,
    scope: 'native whole process/construction/registry units and actual descendant controls only; no original remote archive staging/import/SDK/fullVV or release acceptance'});
}
if (failure) throw failure;
