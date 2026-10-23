import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sdkImageFromLock, dockerArguments } from '../src/docker.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const closure = fileURLToPath(new URL('./fixtures/calculator-closure', import.meta.url));

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', ...options });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const IMAGE = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:36da25ef924d84899453f24ec0c117a7a220e708037933eb8b499caa7723d99e';

test('vectors replays the fixture: 22 of 22', () => {
  const { code, out } = run(['vectors', fixture]);
  assert.equal(code, 0, out);
  assert.match(out, /^22 of 22 vectors passed \(holo, Calculator, identities verified\)/m);
});

test('inspect prints the human view, and the whole inspection with --json', () => {
  // Full coverage of the verb is in inspect.test.mjs.
  const human = run(['inspect', fixture]);
  assert.equal(human.code, 0, human.err);
  assert.match(human.out, /^Name: {6}Calculator$/m);
  const inspection = JSON.parse(run(['inspect', fixture, '--json']).out);
  assert.equal(inspection.schema, 'prismpm/holo-inspection/1');
  assert.equal(inspection.model.vectors, 22);
  assert.equal(inspection.sections.length, 8);
});

test('vectors on a closure needs the model for the numeric profile', () => {
  const without = run(['vectors', closure]);
  assert.equal(without.code, 2);
  assert.match(without.err, /closure\.model/);
});

test('usage errors exit 64 and name the problem', () => {
  assert.equal(run([]).code, 64);
  assert.equal(run(['frobnicate']).code, 64);
  assert.equal(run(['vectors']).code, 64);
  assert.match(run(['--help']).out, /Usage:/);
  assert.match(run(['--version']).out, /^\d+\.\d+\.\d+/);
});

test('a refused artifact exits 2 with the reader\'s code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-code-'));
  const bad = join(dir, 'bad.holo');
  writeFileSync(bad, Buffer.from('HOLX' + '\0'.repeat(60)));
  const { code, err } = run(['vectors', bad]);
  assert.equal(code, 2);
  assert.match(err, /^archive\.magic:/);
});

test('the lock admits only an immutable image reference', () => {
  assert.equal(sdkImageFromLock(JSON.stringify({ sdk_image: IMAGE })), IMAGE);
  assert.equal(sdkImageFromLock(`{"x":1,"sdk_image":"${IMAGE}"}`), IMAGE);
  for (const image of ['ghcr.io/uor-foundation/prismpm-sdk:latest', 'prismpm-sdk@sha256:abc', '']) {
    assert.throws(() => sdkImageFromLock(JSON.stringify({ sdk_image: image })), (e) => e.code === 'lock.image', image);
  }
  assert.throws(() => sdkImageFromLock('not json'), (e) => e.code === 'lock.image');
});

test('the docker invocation is the template\'s, minus the socket unless building', () => {
  const check = dockerArguments({ image: IMAGE, cwd: '/home/u/app', command: 'check', uid: 1000, gid: 1000, platform: 'linux' });
  assert.deepEqual(check, [
    'run', '--rm', '--user', '1000:1000', '--tmpfs', '/tmp:rw,exec,nosuid,size=2g',
    '--volume', '/home/u/app:/home/u/app', '--workdir', '/home/u/app',
    '--env', 'HOME=/tmp/prismpm-home', '--env', 'PRISMPM_EPHEMERAL_HOME=1',
    IMAGE, 'prismpm', 'check',
  ]);
  const build = dockerArguments({ image: IMAGE, cwd: '/home/u/app', command: 'build', args: ['--release'], uid: 1000, gid: 1000, platform: 'linux', build: true, dockerSocketGid: 999 });
  assert.ok(build.includes('--group-add') && build.includes('999'));
  assert.ok(build.includes('/var/run/docker.sock:/var/run/docker.sock'));
  assert.ok(build.includes(`SDK_IMAGE=${IMAGE}`));
  assert.deepEqual(build.slice(-3), ['build', '--release'].length === 2 ? ['prismpm', 'build', '--release'] : null);
  const windows = dockerArguments({ image: IMAGE, cwd: 'C:\\app', command: 'check', platform: 'win32' });
  assert.ok(!windows.includes('--user'));
  assert.ok(windows.includes('C:\\app:/work'));
  assert.ok(windows.includes('/work'));
});

test('check runs docker with the lock\'s image (dry run)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-code-lock-'));
  writeFileSync(join(dir, 'prismpm.lock'), JSON.stringify({ spec: 'prismpm/sdk-lock/2', sdk_image: IMAGE }));
  const { code, out } = run(['check', '--verbose'], { cwd: dir, env: { ...process.env, PRISM_CODE_DRY_RUN: '1' } });
  assert.equal(code, 0, out);
  assert.match(out, /^docker run --rm /);
  assert.ok(out.includes(`${IMAGE} prismpm check --verbose`));
  const missing = run(['check'], { cwd: mkdtempSync(join(tmpdir(), 'prism-code-nolock-')), env: { ...process.env, PRISM_CODE_DRY_RUN: '1' } });
  assert.equal(missing.code, 64);
});
