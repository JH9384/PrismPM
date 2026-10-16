import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

function docker(args) {
  const child = spawnSync('docker', args, {encoding: 'utf8', timeout: 45_000, maxBuffer: 1024 * 1024});
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  return child;
}

test('actual docker exec CLI refuses a hard stack cap that bypasses the SDK entrypoint', () => {
  const image = process.env.PRISMPM_TEST_SDK_IMAGE;
  assert.match(image ?? '', /^[a-z0-9./_:-]+@sha256:[0-9a-f]{64}$/);
  const created = docker(['run', '--detach', '--rm', '--user', '1000:1000', '--network', 'none',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--ulimit', 'stack=8388608:-1',
    image, '/bin/sh', '-c', 'ulimit -S -s 65536; exec sleep infinity']);
  assert.equal(created.status, 0, created.stderr);
  const container = created.stdout.trim();
  assert.match(container, /^[0-9a-f]{64}$/);
  try {
    const limit = docker(['exec', '--user', '1000:1000', container, '/bin/sh', '-c', 'ulimit -S -s']);
    assert.equal(limit.status, 0, limit.stderr);
    assert.equal(limit.stdout.trim(), '8192', 'docker exec does not inherit the PID1 launcher limit');
    const healthy = docker(['exec', '--user', '1000:1000', container, 'prismpm', '--json', 'completion', 'bash']);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.equal(JSON.parse(healthy.stdout).schema, 'prismpm/completion-result/1');
    const refused = docker(['exec', '--user', '1000:1000', container, '/bin/sh', '-c',
      'ulimit -S -s 8192; ulimit -H -s 8192; exec prismpm --json completion bash']);
    assert.equal(refused.status, 4, refused.stderr + refused.stdout);
    const error = JSON.parse(refused.stdout);
    assert.equal(error.schema, 'prismpm/error-result/1');
    assert.equal(error.diagnostic.code, 'PP5401');
    assert.match(error.diagnostic.message, /stack/i);
  } finally {
    const removed = docker(['rm', '--force', container]);
    assert.equal(removed.status, 0, removed.stderr);
  }
});
