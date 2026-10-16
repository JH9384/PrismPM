import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const initializer = fileURLToPath(new URL('../sdk/devcontainer-init.sh', import.meta.url));

function launch(limits, args) {
  const env = {...process.env};
  delete env.PRISMPM_EPHEMERAL_HOME;
  return spawnSync('/bin/sh', ['-c', `${limits}\nexec /bin/sh "$@"`, '--', initializer, ...args], {
    env, encoding: 'utf8', timeout: 10_000,
  });
}

test('SDK launcher supplies a bounded 64 MiB stack to the actual requested process', () => {
  const child = launch('ulimit -S -s 8192', ['/bin/sh', '-c', 'ulimit -S -s; ulimit -H -s']);
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  const [soft, hard] = child.stdout.trim().split('\n');
  assert.equal(soft, '65536');
  const baseline = spawnSync('/bin/sh', ['-c', 'ulimit -H -s'], {encoding: 'utf8'});
  assert.equal(baseline.status, 0);
  assert.equal(hard, baseline.stdout.trim(), 'the SDK must preserve the host hard limit');
});

test('SDK launcher refuses an insufficient hard stack limit before executing the command', () => {
  const child = launch('ulimit -S -s 8192\nulimit -H -s 8192', ['/bin/sh', '-c', 'printf command-executed']);
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.notEqual(child.status, 0);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /ulimit|stack/i);
});

test('SDK launcher preserves requested argv and nonzero exit status', () => {
  const child = launch('ulimit -S -s 8192', ['/bin/sh', '-c', 'printf "%s\\n" "$1"; exit 23', '--', 'literal argument']);
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 23);
  assert.equal(child.stdout, 'literal argument\n');
});
