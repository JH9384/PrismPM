// The host side of the SDK image: finding Docker (native, inside WSL, or missing), spelling a host path
// for a bind mount, the cache volume per image, and the config `setup` records. Nothing here touches
// this machine: every probe goes through a stand-in `find` and `run`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostConfigEntry, hostDocker, hostDockerArguments, parseDistributions, readHostConfig, resolveDocker, splitCommandLine } from '../src/host.mjs';
import { cacheVolumeName, dockerArguments, mountPath, wslMountPath } from '../src/docker.mjs';

const IMAGE = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:36da25ef924d84899453f24ec0c117a7a220e708037933eb8b499caa7723d99e';

/** A `run` that answers from a table keyed by the command line, and records every call. */
function runner(answers) {
  const calls = [];
  const run = (command, args) => {
    const line = [command, ...args].join(' ');
    calls.push(line);
    const hit = Object.entries(answers).find(([key]) => line === key || line.startsWith(`${key} `));
    if (!hit) return { status: 1, stdout: '', stderr: 'no such command', error: undefined };
    return { status: 0, stdout: hit[1], stderr: '' };
  };
  return { calls, run };
}

test('a host path mounts as itself natively, and under /mnt/<drive> for a daemon inside WSL', () => {
  assert.equal(wslMountPath('C:\\Users\\ilya\\app'), '/mnt/c/Users/ilya/app');
  assert.equal(wslMountPath('D:/work/app'), '/mnt/d/work/app');
  assert.equal(wslMountPath('/home/u/app'), '/home/u/app');
  assert.equal(mountPath('C:\\app', 'native'), 'C:\\app');
  assert.equal(mountPath('C:\\app', 'wsl'), '/mnt/c/app');
  assert.throws(() => mountPath('C:\\app', 'nfs'), (e) => e.code === 'docker.mount');
});

test('the cache volume is named by the image digest, so two lockfiles never share one', () => {
  assert.equal(cacheVolumeName(IMAGE), 'prism-sdk-cache-36da25ef924d');
  assert.throws(() => cacheVolumeName('ghcr.io/x/y:latest'), (e) => e.code === 'lock.image');
});

test('docker on the PATH wins, and podman stands in for it', () => {
  const { run, calls } = runner({ '/usr/bin/docker version': '29.1.3\n' });
  const found = resolveDocker({ platform: 'linux', env: {}, find: (n) => (n === 'docker' ? '/usr/bin/docker' : null), run });
  assert.deepEqual(found, { kind: 'native', command: '/usr/bin/docker', args: [], mount: 'native', version: '29.1.3', distro: null, source: 'PATH' });
  assert.deepEqual(calls, ['/usr/bin/docker version --format {{.Server.Version}}']);

  const podman = resolveDocker({ platform: 'linux', env: {}, find: (n) => (n === 'podman' ? '/usr/bin/podman' : null), run: runner({ '/usr/bin/podman version': '5.0\n' }).run });
  assert.equal(podman.command, '/usr/bin/podman');
  assert.equal(podman.kind, 'native');
});

test('Windows without Docker Desktop: the first WSL distribution whose docker answers is the daemon', () => {
  // `wsl -l -q` prints UTF-16: a NUL after every character, and docker-desktop's own distributions are skipped.
  const list = 'd\0o\0c\0k\0e\0r\0-\0d\0e\0s\0k\0t\0o\0p\0\r\0\n\0U\0b\0u\0n\0t\0u\0\r\0\n\0D\0e\0b\0i\0a\0n\0\r\0\n\0';
  assert.deepEqual(parseDistributions(list), ['Ubuntu', 'Debian']);
  const { run, calls } = runner({
    'C:\\Windows\\System32\\wsl.exe -l -q': list,
    'C:\\Windows\\System32\\wsl.exe -d Debian -- docker version': '28.0.0\n',
  });
  const found = resolveDocker({ platform: 'win32', env: {}, find: (n) => (n === 'wsl' ? 'C:\\Windows\\System32\\wsl.exe' : null), run });
  assert.equal(found.kind, 'wsl');
  assert.equal(found.distro, 'Debian');
  assert.equal(found.mount, 'wsl');
  assert.deepEqual(found.args, ['-d', 'Debian', '--', 'docker']);
  assert.ok(calls.includes('C:\\Windows\\System32\\wsl.exe -d Ubuntu -- docker version --format {{.Server.Version}}'), 'Ubuntu was asked first and did not answer');
});

test('nothing answers: missing, with the reason', () => {
  const none = resolveDocker({ platform: 'linux', env: {}, find: () => null, run: runner({}).run });
  assert.equal(none.kind, 'missing');
  assert.match(none.reason, /not on the PATH/);
  const wslSilent = resolveDocker({ platform: 'win32', env: {}, find: (n) => (n === 'wsl' ? 'wsl.exe' : null), run: runner({ 'wsl.exe -l -q': 'Ubuntu\n' }).run });
  assert.equal(wslSilent.kind, 'missing');
  assert.match(wslSilent.reason, /no WSL distribution answered/);
  assert.throws(() => hostDocker({ configDir: mkdtempSync(join(tmpdir(), 'prism-host-')), env: {}, platform: 'linux', find: () => null, run: runner({}).run }), (e) => e.code === 'docker.missing');
});

test('PRISM_DOCKER overrides the probe, and names its mount style', () => {
  assert.deepEqual(splitCommandLine('wsl.exe -d "My Distro" -- docker'), ['wsl.exe', '-d', 'My Distro', '--', 'docker']);
  const { run } = runner({ 'wsl.exe -d Ubuntu -- docker version': '29.1.3\n' });
  const found = resolveDocker({ platform: 'win32', env: { PRISM_DOCKER: 'wsl.exe -d Ubuntu -- docker' }, find: () => null, run });
  assert.equal(found.mount, 'wsl', 'a command through wsl.exe mounts /mnt paths unless told otherwise');
  assert.equal(found.source, 'PRISM_DOCKER');
  const explicit = resolveDocker({ platform: 'linux', env: { PRISM_DOCKER: 'sudo docker', PRISM_DOCKER_MOUNT: 'native' }, find: () => null, run: runner({ 'sudo docker version': '1\n' }).run });
  assert.deepEqual([explicit.command, explicit.args, explicit.mount], ['sudo', ['docker'], 'native']);
  assert.throws(() => resolveDocker({ env: { PRISM_DOCKER: 'docker', PRISM_DOCKER_MOUNT: 'nfs' }, find: () => null, run }), (e) => e.code === 'docker.mount');
  const silent = resolveDocker({ env: { PRISM_DOCKER: 'nothing' }, find: () => null, run: runner({}).run });
  assert.equal(silent.kind, 'missing');
});

test('the config setup wrote is read back, and a dry run assumes docker without probing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-host-'));
  assert.equal(readHostConfig(dir), null);
  mkdirSync(dir, { recursive: true });
  const resolved = { kind: 'wsl', command: 'C:\\Windows\\System32\\wsl.exe', args: ['-d', 'Ubuntu', '--', 'docker'], mount: 'wsl', version: '29.1.3', distro: 'Ubuntu' };
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ preferredAgent: 'claude-code', docker: hostConfigEntry(resolved), cache: true }));
  const saved = readHostConfig(dir);
  assert.deepEqual(saved, { command: resolved.command, args: resolved.args, mount: 'wsl', cache: true });
  const host = hostDocker({ configDir: dir, env: {}, run: () => assert.fail('the record answers; no probe runs') });
  assert.equal(host.source, 'config');
  assert.equal(host.kind, 'wsl');
  writeFileSync(join(dir, 'config.json'), '{"docker": {"command": 1}}');
  assert.equal(readHostConfig(dir), null, 'a record that does not fit is no record');
  const dry = hostDocker({ configDir: dir, env: {}, probe: false, run: () => assert.fail('no probe') });
  assert.deepEqual([dry.command, dry.args, dry.mount, dry.cache], ['docker', [], 'native', false]);
});

test('with no record, the first run records the Docker it found with the cache on, keeping other keys; PRISM_DOCKER is never recorded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-host-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ preferredAgent: 'codex' }));
  const native = { find: (n) => (n === 'docker' ? '/usr/bin/docker' : null), run: runner({ '/usr/bin/docker version': '29.1.3\n' }).run };
  const first = hostDocker({ configDir: dir, env: {}, platform: 'linux', ...native });
  assert.equal(first.cache, true, 'a local build keeps the SDK caches on the volume without setup --local');
  assert.equal(first.source, 'recorded');
  const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  assert.equal(config.preferredAgent, 'codex');
  assert.equal(config.cache, true);
  assert.equal(config.docker.command, '/usr/bin/docker');
  const second = hostDocker({ configDir: dir, env: {}, platform: 'linux', run: () => assert.fail('the record answers; no probe runs') });
  assert.deepEqual([second.source, second.cache], ['config', true]);

  const other = mkdtempSync(join(tmpdir(), 'prism-host-'));
  const overridden = hostDocker({ configDir: other, env: { PRISM_DOCKER: 'docker' }, platform: 'linux', find: () => null, run: runner({ 'docker version': '1\n' }).run });
  assert.equal(overridden.cache, false);
  assert.equal(existsSync(join(other, 'config.json')), false, 'an override is for one environment');

  writeFileSync(join(dir, 'config.json'), JSON.stringify({ docker: config.docker }));
  assert.equal(readHostConfig(dir).cache, true, 'a record without cache keeps the caches on disk');
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ docker: config.docker, cache: false }));
  assert.equal(readHostConfig(dir).cache, false, 'cache: false turns it off');
});

test('a cache volume replaces the tmpfs at /tmp, another program replaces prismpm, and WSL paths mount under /mnt', () => {
  const plain = dockerArguments({ image: IMAGE, cwd: '/home/u/app', command: 'check', platform: 'linux' });
  assert.ok(plain.includes('--tmpfs'));
  const cached = dockerArguments({ image: IMAGE, cwd: 'C:\\app', command: 'verify', platform: 'win32', cache: 'prism-sdk-cache-36da25ef924d', mount: 'wsl', program: 'lexlean', args: ['--project', '/work/app'] });
  assert.ok(!cached.includes('--tmpfs'));
  assert.ok(cached.includes('type=volume,source=prism-sdk-cache-36da25ef924d,target=/tmp'));
  assert.ok(cached.includes('/mnt/c/app:/work'));
  assert.deepEqual(cached.slice(-5), [IMAGE, 'lexlean', 'verify', '--project', '/work/app']);
});

test('the host invocation puts the recorded program before run, and the cache only once setup turned it on', () => {
  const docker = { command: 'wsl.exe', args: ['-d', 'Ubuntu', '--', 'docker'], mount: 'wsl', cache: true };
  const { command, args, display } = hostDockerArguments({ image: IMAGE, cwd: 'C:\\app', command: 'check', env: {}, docker });
  assert.equal(command, 'wsl.exe');
  assert.deepEqual(args.slice(0, 6), ['-d', 'Ubuntu', '--', 'docker', 'run', '--rm']);
  assert.ok(args.includes('type=volume,source=prism-sdk-cache-36da25ef924d,target=/tmp'));
  assert.match(display, /^wsl\.exe -d Ubuntu -- docker run --rm /);
  const off = hostDockerArguments({ image: IMAGE, cwd: '/home/u/app', command: 'check', env: { PRISM_CODE_NO_CACHE: '1' }, docker });
  assert.ok(off.args.includes('--tmpfs'), 'PRISM_CODE_NO_CACHE=1 restores the tmpfs');
  const cold = hostDockerArguments({ image: IMAGE, cwd: '/home/u/app', command: 'check', env: {}, docker: { ...docker, cache: false } });
  assert.ok(cold.args.includes('--tmpfs'));
});
