// `prism-code system ...` (#446) and `prism-code auth login|logout` (#447), called as the CLI dispatcher calls them:
// `verbs[name](argv, io)`. The rule over the auth half: no secret reaches stdout, stderr or an error, however it is given.
// Every value here is a test value. DK-44 owns this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileImageStore, imagesDirectory, Prism } from '../src/node.mjs';
import { createImageStore } from '../src/image-store.mjs';
import { RegistryAuthError } from '../src/errors.mjs';
import { VERSION } from '../src/version.mjs';
import { FORMAT_REVISION } from '../src/vendor/spec/constants.mjs';
import * as systemCli from '../src/cli/system.mjs';
import * as authCli from '../src/cli/auth.mjs';
import { readArgs, UsageError } from '../src/cli/args.mjs';
import { startRegistry } from './support/registry.mjs';
import { assertHidden } from './support/secrets.mjs';

const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const ADD = '1\tadd\t20\t22';
const P0 = Object.freeze({ policy: { minimum: 'P0' } });
const IMAGE = `ghcr.io/uor-foundation/prismpm@sha256:${'a'.repeat(64)}`;
const TOOLCHAIN = { lean: 'v4.24.0', lexlean: '1.2.0', prismpm: '0.4.0', rustc: '1.91.0', wasm_bindgen: '0.2.100' };
const USERNAME = 'test-user';
const PASSWORD = 'test-password-7c41e2';
const BASIC = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
const SECRETS = [PASSWORD, BASIC];

const root = mkdtempSync(join(tmpdir(), 'prism-cli-'));
test.after(() => rmSync(root, { recursive: true, force: true }));
let folders = 0;
const folder = (name) => {
  const path = join(root, `${name}-${folders++}`);
  mkdirSync(path, { recursive: true });
  return path;
};

/** A writable that keeps what it is given. */
const sink = () => {
  const chunks = [];
  return { write: (chunk) => (chunks.push(String(chunk)), true), text: () => chunks.join('') };
};

/** Run one verb with captured streams; `stdin` is text piped in. */
async function call(group, verb, argv, { stdin = '', ...io } = {}) {
  const stdout = sink();
  const stderr = sink();
  const input = Readable.from(stdin === null ? [] : [Buffer.from(stdin)]);
  input.isTTY = false;
  const code = await group.verbs[verb](argv, { stdout, stderr, stdin: input, ...io });
  return { code, out: stdout.text(), err: stderr.text() };
}

/** A PRISM_HOME with one exited and one created container, and a project with a prismpm.lock. */
async function home() {
  const env = { PRISM_HOME: folder('home'), DOCKER_CONFIG: folder('docker'), PATH: '' };
  const prism = Prism.fromEnv({ env, warn: () => {} });
  const exited = await prism.containers.run(fixture, ADD, P0);
  const created = await prism.containers.create(fixture, ADD, P0);
  const project = folder('project');
  writeFileSync(join(project, 'prismpm.lock'), JSON.stringify({ schema: 'prismpm/sdk-lock/3', sdk_version: '0.3.0', sdk_image: IMAGE, inputs: { toolchain: TOOLCHAIN } }));
  return { env, prism, project, exited: exited.id, created: created.id };
}

// --- the argument reader

test('the argument reader takes only the options a verb names and never quotes a value back', () => {
  assert.deepEqual(readArgs(['a', '--json', '--project', 'p', '-u', 'me', '--filter=x=1', '--filter', 'y=2'], { values: ['project', 'username', 'filter'], flags: ['json'], short: { u: 'username' }, repeat: ['filter'] }), {
    positional: ['a'],
    options: { json: true, project: 'p', username: 'me', filter: ['x=1', 'y=2'] },
  });
  assert.deepEqual(readArgs(['--', '--json'], { flags: ['json'] }).positional, ['--json']);
  for (const [argv, message] of [
    [['--nope=hidden-value'], /no option --nope$/],
    [['--json=hidden-value'], /--json takes no value/],
    [['--project'], /--project takes a value/],
    [['-z'], /no option -z/],
  ]) {
    assert.throws(() => readArgs(argv, { values: ['project'], flags: ['json'] }), (error) => error instanceof UsageError && message.test(error.message) && !error.message.includes('hidden-value'));
  }
});

test('each group\'s help names every verb it has', () => {
  for (const [name, group] of [['system', systemCli], ['auth', authCli]]) {
    for (const verb of Object.keys(group.verbs)) assert.match(group.help, new RegExp(`prism-code ${name} ${verb}\\b`), `${name} ${verb}`);
  }
  assert.deepEqual(Object.keys(systemCli.verbs), ['info', 'version', 'events', 'df', 'prune']);
  assert.deepEqual(Object.keys(authCli.verbs), ['login', 'logout']);
  assert.deepEqual(authCli.aliases, { login: 'login', logout: 'logout' });
});

// --- system

test('system version and info name the package, the holo format, the runtime and what the lock pins', async () => {
  const { env, project } = await home();
  const version = await call(systemCli, 'version', ['--project', project, '--json'], { env });
  assert.equal(version.code, 0, version.err);
  const report = JSON.parse(version.out);
  assert.equal(report.schema, 'prism/system-version/1');
  assert.equal(report.version, VERSION);
  assert.equal(report.formatRevision, FORMAT_REVISION);
  assert.equal(report.runtime.name, 'node');
  assert.equal(report.builder, IMAGE);
  assert.deepEqual(report.toolchain, TOOLCHAIN);

  const human = await call(systemCli, 'version', [], { env, cwd: project });
  assert.match(human.out, new RegExp(`^Version: +${VERSION.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(human.out, new RegExp(`^Builder image: +${IMAGE.replace(/[.@/]/g, '\\$&')}$`, 'm'));
  assert.match(human.out, /^Toolchain: +lean v4\.24\.0, lexlean 1\.2\.0, prismpm 0\.4\.0, rustc 1\.91\.0, wasm_bindgen 0\.2\.100$/m);

  const info = await call(systemCli, 'info', ['--project', project], { env });
  assert.equal(info.code, 0, info.err);
  assert.match(info.out, /^Containers: +2 \(1 created, 0 running, 1 exited\)$/m);
  assert.match(info.out, /^Images: +0$/m);
  assert.match(info.out, /^Builder image: +ghcr\.io/m);
  const json = JSON.parse((await call(systemCli, 'info', ['--project', project, '--json'], { env })).out);
  assert.equal(json.schema, 'prism/system-info/1');
  assert.deepEqual(json.containers, { total: 2, created: 1, running: 0, exited: 1 });
  assert.equal(json.lock.builder, IMAGE);

  const bare = await call(systemCli, 'info', [], { env, cwd: folder('empty') });
  assert.match(bare.out, /^Lock: +none in this project$/m);
  assert.match((await call(systemCli, 'version', [], { env, cwd: folder('empty') })).out, /^Toolchain: +no prismpm\.lock here$/m);
});

test('system df counts every record, and lists them with --verbose', async () => {
  const { env, exited, created } = await home();
  const report = JSON.parse((await call(systemCli, 'df', ['--json'], { env })).out);
  assert.equal(report.schema, 'prism/system-df/1');
  assert.equal(report.containers.total, 2);
  assert.equal(report.containers.active, 1);
  assert.ok(report.containers.reclaimable > 0 && report.containers.reclaimable < report.containers.size);
  assert.deepEqual({ ...report.images, location: undefined }, { total: 0, active: 0, size: 0, reclaimable: 0, location: undefined, rows: [] });
  const human = await call(systemCli, 'df', ['-v'], { env });
  assert.match(human.out, /^Containers +2 +1 +/m);
  assert.match(human.out, /^Images +0 +0 +0B +0B$/m);
  for (const id of [exited, created]) assert.match(human.out, new RegExp(`^${id} `, 'm'));
});

test('system prune asks first, refuses without a terminal, and with --force removes exited containers only', async () => {
  const { env, prism, exited, created } = await home();
  const refused = await call(systemCli, 'prune', [], { env });
  assert.equal(refused.code, 64);
  assert.match(refused.err, /pass --force/);
  assert.equal((await prism.containers.list({ all: true })).length, 2);

  const kept = await call(systemCli, 'prune', ['--force', '--filter', 'until=2000-01-01T00:00:00Z', '--json'], { env });
  assert.deepEqual(JSON.parse(kept.out).containersDeleted, []);

  const pruned = await call(systemCli, 'prune', ['-f'], { env });
  assert.equal(pruned.code, 0, pruned.err);
  assert.match(pruned.out, new RegExp(`^Deleted containers:\\n${exited}\\n`, 'm'));
  assert.match(pruned.out, /^Total reclaimed space: \d/m);
  assert.deepEqual((await prism.containers.list({ all: true })).map((c) => c.id), [created]);
  assert.equal((await call(systemCli, 'prune', ['-f', '--filter', 'since=1'], { env })).code, 64);
});

test('system df and prune count the local image store; prune --all removes every image no container references (#349)', async () => {
  const { env } = await home();
  const store = createImageStore({ backend: fileImageStore(imagesDirectory(env)) });
  await store.add(new Uint8Array(readFileSync(fixture)), { tags: ['calc:1'] });
  const held = JSON.parse((await call(systemCli, 'df', ['--json'], { env })).out).images;
  assert.equal(held.total, 1);
  assert.equal(held.active, 1, 'both containers run the Calculator holo');
  assert.equal(held.reclaimable, 0);
  assert.match((await call(systemCli, 'df', ['-v'], { env })).out, /^[0-9a-f]{12} +calc:1 +\S+ +2$/m);
  assert.match((await call(systemCli, 'info', [], { env })).out, /^Images: +1$/m);
  const pruned = JSON.parse((await call(systemCli, 'prune', ['-f', '-a', '--json'], { env })).out);
  assert.equal(pruned.containersDeleted.length, 1);
  assert.deepEqual(pruned.imagesDeleted, [], 'the created container still references the image');
  assert.equal(JSON.parse((await call(systemCli, 'df', ['--json'], { env })).out).images.total, 1);
});

test('system events replays create, start and die from the store in order, with filters', async () => {
  const { env, exited, created } = await home();
  const all = await call(systemCli, 'events', ['--since', '0', '--until', String(Date.now() / 1000), '--json'], { env });
  assert.equal(all.code, 0, all.err);
  const events = all.out.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(events.map((e) => [e.action, e.id]), [['create', exited], ['start', exited], ['die', exited], ['create', created]]);
  assert.deepEqual(events.map((e) => e.sequence), [1, 2, 3, 4]);
  assert.ok(events.every((e) => e.schema === 'prism/system-event/1' && e.type === 'container' && e.time === new Date(e.timeMs).toISOString()));
  assert.equal(events[2].exitCode, 0);

  const dies = await call(systemCli, 'events', ['--since', '1h', '--until', '0s', '--filter', 'event=die'], { env });
  assert.equal(dies.out.trim().split('\n').length, 1);
  assert.match(dies.out, new RegExp(` container die ${exited} \\(image=[a-z0-9]+:[0-9a-f]{64}, exitCode=0\\)$`, 'm'));
  const one = await call(systemCli, 'events', ['--since', '0', '--until', '0s', '--filter', `container=${created.slice(0, 12)}`, '--json'], { env });
  assert.deepEqual(one.out.trim().split('\n').map((line) => JSON.parse(line).action), ['create']);

  for (const argv of [['--filter', 'action=pause'], ['--filter', 'image=x'], ['--since', 'yesterday'], ['extra']]) {
    const bad = await call(systemCli, 'events', argv, { env });
    assert.equal(bad.code, 64, argv.join(' '));
    assert.match(bad.err, /prism-code system events/);
  }
});

test('system events follows the store until stopped, and reports a removed container as destroy', async () => {
  const { env, prism, exited, created } = await home();
  const stop = new AbortController();
  const following = call(systemCli, 'events', ['--json'], { env, pollMs: 20, signal: stop.signal });
  // Let it read the store once, so a container it has already seen as created must be read again when it starts.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await (await prism.containers.get(created)).start();
  const later = await prism.containers.run(fixture, ADD, P0);
  await (await prism.containers.get(exited)).remove();
  await new Promise((resolve) => setTimeout(resolve, 200));
  stop.abort();
  const { code, out } = await following;
  assert.equal(code, 0);
  const seen = out.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(seen.filter((e) => e.id === later.id).map((e) => e.action), ['create', 'start', 'die']);
  assert.deepEqual(seen.filter((e) => e.id === exited).map((e) => e.action), ['destroy']);
  assert.deepEqual(seen.filter((e) => e.id === created).map((e) => e.action), ['start', 'die']);
});

test('system events ends at an --until still ahead of it', async () => {
  const { env } = await home();
  const started = Date.now();
  const { code, out } = await call(systemCli, 'events', ['--until', String((Date.now() + 300) / 1000)], { env, pollMs: 20 });
  assert.equal(code, 0);
  assert.equal(out, '');
  assert.ok(Date.now() - started >= 250);
});

test('times are ISO 8601, Unix seconds or a duration ago', () => {
  const now = Date.parse('2026-11-12T00:00:00Z');
  assert.equal(systemCli.parseTime('since', '10m', now), now - 600000);
  assert.equal(systemCli.parseTime('since', '2h', now), now - 7200000);
  assert.equal(systemCli.parseTime('since', '1762905600', now), 1762905600000);
  assert.equal(systemCli.parseTime('since', '2026-11-11T00:00:00Z', now), now - 86400000);
  assert.equal(systemCli.parseTime('since', undefined, now), undefined);
  assert.throws(() => systemCli.parseTime('since', 'soon', now), UsageError);
});

// --- auth

/** A Docker config folder of its own, and its env. */
function docker() {
  const directory = folder('docker');
  return { env: { DOCKER_CONFIG: directory, PATH: '' }, config: () => (existsSync(join(directory, 'config.json')) ? readFileSync(join(directory, 'config.json'), 'utf8') : '') };
}

/** Everything a login printed and threw, held to the rule. */
function clean(result) {
  assertHidden(result.out, SECRETS);
  assertHidden(result.err, SECRETS);
  return result;
}

for (const kind of ['basic', 'bearer']) {
  test(`auth login checks the password with a ${kind} registry, stores it, and prints no secret`, async (t) => {
    const registry = await startRegistry({ auth: kind, username: USERNAME, password: PASSWORD });
    t.after(registry.close);
    const { env, config } = docker();
    const result = clean(await call(authCli, 'login', [registry.host, '-u', USERNAME, '--password-stdin'], { env, stdin: `${PASSWORD}\n` }));
    assert.equal(result.code, 0, result.err);
    assert.equal(result.out, `Login Succeeded: ${USERNAME} at ${registry.host}, stored in ${join(env.DOCKER_CONFIG, 'config.json')}\n`);
    assert.match(result.err, /^warning: the credential is stored unencrypted in /);
    assert.equal(JSON.parse(config()).auths[registry.host].auth, BASIC);
    assert.ok(registry.state.log.includes('GET /v2/'));

    const json = clean(await call(authCli, 'login', ['--json', '--username', USERNAME, '--password-stdin', registry.host], { env, stdin: PASSWORD }));
    assert.deepEqual(JSON.parse(json.out), { registry: registry.host, username: USERNAME, store: { kind: 'config', path: join(env.DOCKER_CONFIG, 'config.json') }, verified: true });
    assert.equal(json.err, '');
  });
}

test('a password the registry refuses is not stored, and the refusal holds no secret', async (t) => {
  const registry = await startRegistry({ auth: 'bearer', username: USERNAME, password: 'the-real-one' });
  t.after(registry.close);
  const { env, config } = docker();
  const error = await call(authCli, 'login', [registry.host, '-u', USERNAME, '--password-stdin'], { env, stdin: PASSWORD }).then(
    () => assert.fail('expected a refusal'),
    (caught) => caught,
  );
  assert.ok(error instanceof RegistryAuthError, error?.message);
  assert.equal(error.check, 'registry.auth');
  assert.equal(error.cause, undefined);
  assertHidden(error, SECRETS);
  assert.equal(config(), '');
});

test('a password on the command line is refused in every spelling, and is never printed', async () => {
  const { env, config } = docker();
  for (const argv of [['-p', PASSWORD], [`--password=${PASSWORD}`], ['--password', PASSWORD], [`-p${PASSWORD}`], ['registry.test', '-u', USERNAME, '-p', PASSWORD]]) {
    const result = clean(await call(authCli, 'login', argv, { env }));
    assert.equal(result.code, 64, argv.join(' '));
    assert.match(result.err, /no password on the command line.*--password-stdin/);
    assert.equal(result.out, '');
  }
  // A password typed where the registry or an option goes is counted, not quoted.
  for (const argv of [['registry.test', PASSWORD, '-u', USERNAME, '--password-stdin'], [`--pass=${PASSWORD}`, '-u', USERNAME], [PASSWORD, '-u', USERNAME, '--password-stdin']]) {
    const result = await call(authCli, 'login', argv, { env, stdin: PASSWORD }).then(clean, (error) => (assertHidden(error, SECRETS), { code: 'thrown' }));
    assert.notEqual(result.code, 0, argv.join(' '));
  }
  assert.equal(config(), '');
});

test('login needs a username and a password source when there is no terminal to prompt on', async () => {
  const { env } = docker();
  const noUser = clean(await call(authCli, 'login', ['--password-stdin'], { env, stdin: PASSWORD }));
  assert.equal(noUser.code, 64);
  assert.match(noUser.err, /--username/);
  const noPassword = clean(await call(authCli, 'login', ['-u', USERNAME], { env }));
  assert.equal(noPassword.code, 64);
  assert.match(noPassword.err, /--password-stdin/);
  assert.match(noPassword.err, /prism-code auth login/);
});

test('login prompts on a terminal without echoing the password', async () => {
  const { env, config } = docker();
  const stdout = sink();
  const stderr = sink();
  const stdin = new Readable({ read() {} });
  stdin.isTTY = true;
  const modes = [];
  stdin.setRawMode = (mode) => modes.push(mode);
  const done = authCli.verbs.login(['registry.test'], { env, stdout, stderr, stdin, checkCredential: async () => {} });
  setImmediate(() => {
    stdin.push(`${USERNAME}\r`);
    setImmediate(() => stdin.push(`${PASSWORD}x\u007f\r`));
  });
  assert.equal(await done, 0, stderr.text());
  assert.deepEqual(modes, [true, false]);
  assert.equal(stderr.text().startsWith('Username: Password: \n'), true, stderr.text());
  assertHidden(stdout.text() + stderr.text(), SECRETS);
  assert.equal(JSON.parse(config()).auths['registry.test'].auth, BASIC);
});

test('logout removes the credential, says when there was none, and names an ambient token without printing it', async () => {
  const { env, config } = docker();
  await call(authCli, 'login', ['registry.test', '-u', USERNAME, '--password-stdin'], { env, stdin: PASSWORD, checkCredential: async () => {} });
  const removed = clean(await call(authCli, 'logout', ['registry.test'], { env }));
  assert.deepEqual([removed.code, removed.out, removed.err], [0, 'Removed the credential for registry.test\n', '']);
  assert.equal(config().includes(BASIC), false);
  assert.equal((await call(authCli, 'logout', ['registry.test'], { env })).out, 'Not logged in to registry.test\n');
  assert.deepEqual(JSON.parse((await call(authCli, 'logout', ['--json'], { env })).out), { registry: 'docker.io', removed: false, ambient: null });

  const ambient = clean(await call(authCli, 'logout', ['ghcr.io'], { env: { ...env, GHCR_TOKEN: PASSWORD } }));
  assert.equal(ambient.code, 0);
  assert.match(ambient.err, /^warning: GHCR_TOKEN still gives a token for ghcr\.io/);
  assert.equal((await call(authCli, 'logout', ['a', 'b'], { env })).code, 64);
});
