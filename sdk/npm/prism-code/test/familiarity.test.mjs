// The familiarity test of #347: the ten most common Docker tasks, spelled as Docker
// spells them, done against Prism through the CLI and the SDK. The transcript is
// test/fixtures/familiarity.json; every step of it runs here, so the fixture is what
// Prism does today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { spawn as realSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrism } from '../src/index.mjs';
import { hostDockerArguments } from '../src/host.mjs';
import { fileImageStore } from '../src/image-store.mjs';
import { startRegistry } from './support/registry.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const image = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const transcript = JSON.parse(readFileSync(new URL('./fixtures/familiarity.json', import.meta.url), 'utf8'));
const TASKS = ['build', 'run', 'inspect', 'tag', 'push', 'pull', 'list images', 'list containers', 'logs', 'remove'];
const ADD = '1\tadd\t20\t22';
const BUILDER = `ghcr.io/uor-foundation/prismpm@sha256:${'a'.repeat(64)}`;

const root = realpathSync(mkdtempSync(join(tmpdir(), 'prism-familiarity-')));
test.after(() => rmSync(root, { recursive: true, force: true }));

/** A project as `prismpm build` leaves it: the lock that pins the builder, and the build directory it wrote. */
function project(name) {
  const at = join(root, name);
  const holo = readFileSync(image);
  const id = 'b'.repeat(64);
  mkdirSync(join(at, '.prism', 'build', id), { recursive: true });
  writeFileSync(join(at, 'prismpm.lock'), JSON.stringify({ sdk_image: BUILDER }));
  writeFileSync(join(at, '.prism', 'build', id, 'Calculator.holo'), holo);
  const sha256 = createHash('sha256').update(holo).digest('hex');
  writeFileSync(join(at, '.prism', 'build', id, 'manifest.json'), JSON.stringify({ schema: 'prismpm/build-manifest/1', files: [{ path: 'Calculator.holo', sha256, byte_length: holo.length }] }));
  const result = { schema: 'prismpm/build-result/1', build_id: id, source_id: 's', semantic_id: 'm', model_path: `.prism/build/${id}/model.prism.json`, manifest_path: `.prism/build/${id}/manifest.json` };
  return { at, result };
}

/** The CLI, asynchronously: the registry answers in this process. */
function cli(argv, { cwd = root, env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...argv], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('the transcript covers the ten tasks through the CLI and the SDK, and each CLI step is Docker\'s command renamed', () => {
  assert.equal(transcript.schema, 'prism-code/familiarity/1');
  assert.deepEqual([...new Set(transcript.cli.map((step) => step.task))].sort(), [...TASKS].sort());
  assert.deepEqual(transcript.sdk.map((step) => step.task).sort(), [...TASKS].sort());
  for (const step of transcript.cli) assert.match(step.docker, /^docker /);
});

test('a Docker user does the ten tasks with the prism-code CLI, as Docker spells them', async () => {
  const registry = await startRegistry();
  try {
    const env = { ...process.env, PRISM_HOME: join(root, 'cli-home'), PRISM_IMAGES: join(root, 'cli-images'), PRISM_MINIMUM_LEVEL: 'P0' };
    delete env.PRISM_CODE_DRY_RUN;
    const words = { $REGISTRY: registry.host, $IMAGE: image, $INPUT: ADD };
    const spell = (text) => text.split(' ').map((word) => Object.entries(words).reduce((out, [name, value]) => out.replaceAll(name, value), word));
    for (const step of transcript.setup) {
      const done = await cli(spell(step.prism).slice(1), { env });
      assert.equal(done.code, 0, `${step.prism}\n${done.stderr}`);
    }
    const { at } = project('cli-project');
    for (const step of transcript.cli) {
      const argv = spell(step.docker).slice(1);
      const done = step.task === 'build'
        ? await cli(argv, { cwd: at, env: { ...env, PRISM_CODE_DRY_RUN: '1' } })
        : await cli(argv, { env });
      assert.equal(done.code, step.exit, `prism-code ${argv.join(' ')}\n${done.stderr}`);
      const expected = Object.entries(words).reduce((out, [name, value]) => out.replaceAll(name, value), step.stdout);
      if (expected === '') assert.equal(done.stdout.trim(), '', `prism-code ${argv.join(' ')}`);
      else assert.match(done.stdout.trim(), new RegExp(expected, 'm'), `prism-code ${argv.join(' ')}`);
      if (step.task === 'run') {
        const listed = await cli(['ps', '-a', '--json'], { env });
        words.$CONTAINER = JSON.parse(listed.stdout).at(-1).id;
      }
    }
  } finally {
    await registry.close();
  }
});

test('a Docker SDK user does the ten tasks with the prism client, under the names Docker\'s SDK uses', async () => {
  const registry = await startRegistry();
  try {
    const reference = (tag) => `${registry.host}/calc:${tag}`;
    const { at, result } = project('sdk-project');
    // The builder image runs as a fake that prints what `prismpm build --json` prints.
    const builder = (command, args, options) => realSpawn(process.execPath, ['-e', 'process.stdout.write(process.env.RESULT)'], { ...options, env: { ...process.env, RESULT: JSON.stringify(result) } });
    const prism = createPrism({ docker: (request) => hostDockerArguments({ ...request, probe: false }), spawn: builder, imageStore: fileImageStore(join(root, 'sdk-images')), warn: () => {} });
    await prism.images.push(reference(1), { source: image });
    const done = new Set();
    const step = async (task, call) => {
      const value = await call();
      done.add(task);
      return value;
    };

    const built = await step('build', () => prism.images.build({ path: at }));
    assert.match(built.digest, /^blake3:[0-9a-f]{64}$/);
    const pulled = await step('pull', () => prism.images.pull(reference(1)));
    assert.equal(pulled.digest, built.digest);
    await step('tag', () => prism.images.tag(reference(1), 'calc:latest'));
    const listed = await step('list images', () => prism.images.list());
    assert.ok(listed.some((entry) => entry.tags.includes('calc:latest')), JSON.stringify(listed));
    const inspected = await step('inspect', () => prism.images.inspect('calc:latest'));
    assert.equal(inspected.digest, built.digest);
    const container = await step('run', () => prism.containers.run('calc:latest', ADD, { policy: { minimum: 'P0' } }));
    assert.equal(container.exitCode, 0, String(container.error));
    const containers = await step('list containers', () => prism.containers.list({ all: true }));
    assert.deepEqual(containers.map((found) => found.id), [container.id]);
    const logs = await step('logs', () => prism.containers.logs(container.id));
    assert.equal(new TextDecoder().decode(logs), '1\tok\t42');
    await step('remove', () => prism.containers.remove(container.id));
    assert.deepEqual(await prism.containers.list({ all: true }), []);
    await prism.images.tag('calc:latest', reference(2));
    const pushed = await step('push', () => prism.images.push(reference(2)));
    assert.equal(pushed.digest, built.digest);
    assert.deepEqual([...done].sort(), [...TASKS].sort());
  } finally {
    await registry.close();
  }
});
