import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';

function docker(args) {
  const child = spawnSync('docker', args, {encoding: 'utf8', timeout: 45_000, maxBuffer: 1024 * 1024});
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  return child;
}

test('actual unprivileged SDK consumers read exact immutable helper bytes', () => {
  const image = process.env.PRISMPM_TEST_SDK_IMAGE;
  assert.match(image ?? '', /^[a-z0-9./_:-]+@sha256:[0-9a-f]{64}$/);
  const recipe = readFileSync(new URL('../sdk/Dockerfile', import.meta.url), 'utf8');
  const browser = recipe.split('\n').find(line => line.startsWith('COPY --from=source_inputs --chmod=0444 ') && line.endsWith(' /opt/prismpm/browser/'));
  assert(browser);
  const paths = browser.split(' ').filter(path => path.startsWith('/prepared/source/')).map(path => path.slice('/prepared/source/'.length));
  for (const name of readdirSync(new URL('../sdk/browser-engine/', import.meta.url))) paths.push(`sdk/browser-engine/${name}`);
  paths.push('sdk/runtime-sources/configure.py', 'sdk/runtime-sources/fixtures/amd64.nodesource.list', 'sdk/runtime-sources/fixtures/arm64.nodesource.list');
  const expected = paths.map(path => [`/opt/prismpm/${path.slice(4)}`, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')]);
  const script = `
    const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
    assert.equal(process.getuid(),1000);
    const expected=${JSON.stringify(expected)};
    for(const [file,hash] of expected){
      for(let directory=path.dirname(file);directory!=='/';directory=path.dirname(directory)){
        const mode=fs.statSync(directory).mode;
        assert.equal(mode&0o111,0o111,directory+' must be searchable');assert.equal(mode&0o022,0,directory+' must not be group/other writable');
      }
      assert.equal(fs.statSync(file).mode&0o222,0,file+' must remain read-only');
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,file+' must retain source bytes');
    }
    console.log(JSON.stringify({checked:expected.length}));
  `;
  const result = docker(['run', '--rm', '--user', '1000:1000', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'node', image, '-e', script]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).checked, expected.length);
});

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
