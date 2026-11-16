// prism.system (#446): info, version, events, df and prune over the client's own containers, and the nine modules on one
// client (#441). DK-41 owns this file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrism, load, memoryContainerStore, MODULES, prism as defaultPrism } from '../src/index.mjs';
import { Prism, fileContainerStore } from '../src/node.mjs';
import { createEventBus, createSystem, EVENT_ACTIONS, EVENT_HISTORY, SYSTEM_DF_SCHEMA, SYSTEM_EVENT_SCHEMA, SYSTEM_INFO_SCHEMA, SYSTEM_PRUNE_SCHEMA, SYSTEM_VERSION_SCHEMA } from '../src/system.mjs';
import { VERSION } from '../src/version.mjs';
import { FORMAT_REVISION } from '../src/vendor/spec/constants.mjs';
import { errors } from '../src/errors-namespace.mjs';
import { verify } from '../src/verify-namespace.mjs';

const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const ADD = '1\tadd\t20\t22';
const P0 = Object.freeze({ policy: { minimum: 'P0' } });
const scratch = (name = 'prism-system-') => mkdtempSync(join(tmpdir(), name));
const quiet = (options = {}) => createPrism({ warn: () => {}, ...options });
const IMAGE = `ghcr.io/uor-foundation/prismpm@sha256:${'a'.repeat(64)}`;
const TOOLCHAIN = { lean: 'v4.24.0', lexlean: '1.2.0', prismpm: '0.4.0', rustc: '1.91.0', wasm_bindgen: '0.2.100' };

/** Read every event a stream has now, then close it. */
async function drain(stream, count) {
  const seen = [];
  for await (const event of stream) {
    seen.push(event);
    if (seen.length === count) break;
  }
  return seen;
}

/** A loaded holo whose dispatch waits until the test lets it return. */
async function held() {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return { app: { ...(await load(fixture)), dispatch: () => gate }, release };
}

// The client (#441)

test('a client exposes the eight other modules, each as its own namespace', () => {
  const prism = quiet();
  assert.deepEqual(Object.keys(prism), ['images', 'containers', 'networks', 'volumes', 'system', 'auth', 'errors', 'verify']);
  assert.deepEqual(MODULES, ['client', ...Object.keys(prism)]);
  assert.ok(Object.isFrozen(prism));
  assert.equal(prism.errors, errors);
  assert.equal(prism.verify, verify);
  for (const verb of ['build', 'pull', 'push', 'inspect', 'verify']) assert.equal(typeof prism.images[verb], 'function', verb);
  for (const verb of ['run', 'create', 'get', 'list', 'prune', 'start', 'remove']) assert.equal(typeof prism.containers[verb], 'function', verb);
  for (const verb of ['info', 'version', 'events', 'df', 'prune']) assert.equal(typeof prism.system[verb], 'function', verb);
  for (const verb of ['create', 'list', 'inspect', 'remove']) assert.equal(typeof prism.volumes[verb], 'function', verb);
  for (const verb of ['create', 'list', 'inspect', 'remove', 'connect', 'disconnect']) assert.equal(typeof prism.networks[verb], 'function', verb);
  assert.deepEqual(Object.keys(defaultPrism), Object.keys(prism));
});

test('createPrism refuses an option it does not have, so a misspelling cannot weaken a module', () => {
  assert.throws(() => createPrism({ stor: memoryContainerStore() }), (error) => error.code === 'client.option' && /no option stor/.test(error.message));
  assert.throws(() => createPrism(Object.create({ store: null })), { code: 'client.option' });
  assert.throws(() => createPrism({ docker: 'docker' }), { code: 'client.option' });
});

test('without Node credentials prism.auth refuses every verb and names the way to get them', async () => {
  const { auth } = quiet();
  for (const call of [() => auth.login({}), () => auth.logout('r'), () => auth.inspect('r'), () => auth.stores.list(), () => auth.stores.get('r'), () => auth.identities.fromKey({}), () => auth.identities.keyless({})]) {
    assert.throws(call, (error) => error.code === 'auth.unavailable' && /Prism\.fromEnv\(\)/.test(error.message));
  }
});

test('the capability file reaches networks and volumes from one option', async () => {
  const capabilities = { schema: 'prism/capabilities/1', sets: { default: { 'allow-key-value-stores': ['cache'] } } };
  const prism = quiet({ capabilities, declarations: [{ name: 'cache', type: 'kv' }] });
  assert.deepEqual((await prism.volumes.list()).map((volume) => volume.name), ['cache']);
  assert.deepEqual(await prism.networks.list(), []);
  await assert.rejects(prism.volumes.create('/home'), (error) => error.check === 'capabilities.host-folder');
});

test('Prism.fromEnv keeps containers under PRISM_HOME, reads the lock, and has real credentials', async () => {
  const home = scratch();
  const env = { ...process.env, PRISM_HOME: home, DOCKER_CONFIG: join(home, 'docker') };
  const prism = Prism.fromEnv({ env });
  assert.deepEqual(Object.keys(prism), Object.keys(quiet()));
  const container = await prism.containers.run(fixture, ADD, P0);
  assert.equal(JSON.parse(readFileSync(join(home, 'containers', `${container.id}.json`), 'utf8')).id, container.id);
  // Another client from the same environment sees it, as Docker's daemon would.
  assert.equal((await Prism.fromEnv({ env }).containers.list({ all: true })).length, 1);
  assert.deepEqual(await prism.auth.stores.list(), await (await import('../src/auth.mjs')).createAuth({ env }).stores.list());

  const project = join(home, 'project');
  mkdirSync(project);
  assert.equal((await prism.system.info({ path: project })).lock, null);
  writeFileSync(join(project, 'prismpm.lock'), JSON.stringify({ schema: 'prismpm/sdk-lock/3', sdk_version: '0.3.0', sdk_image: IMAGE, inputs: { toolchain: TOOLCHAIN } }));
  assert.deepEqual((await prism.system.info({ path: project })).lock, { schema: 'prismpm/sdk-lock/3', sdkVersion: '0.3.0', builder: IMAGE, toolchain: TOOLCHAIN });
  assert.deepEqual(await prism.system.version({ path: project }), { schema: SYSTEM_VERSION_SCHEMA, version: VERSION, formatRevision: FORMAT_REVISION, runtime: { name: 'node', version: process.versions.node, platform: `${process.platform}/${process.arch}` }, toolchain: TOOLCHAIN, builder: IMAGE });
  // Any option of createPrism wins over the environment's.
  const store = memoryContainerStore();
  assert.equal((await Prism.fromEnv({ env, store }).containers.list({ all: true })).length, 0);
  assert.equal(Prism.create, createPrism);
});

// system.version and system.info

test('version names this package, the holo format it reads and its runtime, and no toolchain without a project', async () => {
  const { system } = quiet();
  const version = await system.version();
  assert.deepEqual(version, { schema: SYSTEM_VERSION_SCHEMA, version: VERSION, formatRevision: FORMAT_REVISION, runtime: { name: 'node', version: process.versions.node, platform: `${process.platform}/${process.arch}` }, toolchain: null, builder: null });
  assert.equal(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version, version.version);
  await assert.rejects(system.version({ path: '.' }), (error) => error.code === 'system.lock' && /Node/.test(error.message));
  await assert.rejects(system.version({ verbose: true }), { code: 'system.option' });
});

test('info counts containers by state and the images in the local store', async () => {
  const prism = quiet();
  const { app, release } = await held();
  await prism.containers.create(fixture, ADD, P0);
  const running = await prism.containers.create(app, ADD, P0);
  const started = running.start();
  await prism.containers.run(fixture, ADD, P0);
  const info = await prism.system.info();
  assert.equal(info.schema, SYSTEM_INFO_SCHEMA);
  assert.deepEqual(info.containers, { total: 3, created: 1, running: 1, exited: 1 });
  assert.deepEqual([info.images, info.lock, info.events], [0, null, true]);
  release(new TextEncoder().encode('1\tok\t42'));
  await started;
});

test('a lock that pins no immutable builder is refused, as build refuses it', async () => {
  const { system } = quiet({ readLock: () => JSON.stringify({ sdk_image: 'ghcr.io/uor-foundation/prismpm:latest' }) });
  await assert.rejects(system.info({ path: 'p' }), { code: 'lock.image' });
  const pinned = quiet({ readLock: () => JSON.stringify({ sdk_image: IMAGE }) });
  assert.deepEqual((await pinned.system.info({ path: 'p' })).lock, { schema: null, sdkVersion: null, builder: IMAGE, toolchain: null });
  await assert.rejects(pinned.system.info({ path: '' }), { code: 'system.option' });
});

// system.df and system.prune

test('df reports each record and what prune would reclaim, and an empty image store', async () => {
  const prism = quiet();
  const kept = await prism.containers.create(fixture, ADD, P0);
  const done = await prism.containers.run(fixture, ADD, P0);
  const df = await prism.system.df();
  assert.equal(df.schema, SYSTEM_DF_SCHEMA);
  const size = async (container) => new TextEncoder().encode(JSON.stringify(await container.inspect())).length;
  assert.deepEqual(df.containers, {
    total: 2,
    active: 1,
    size: (await size(kept)) + (await size(done)),
    reclaimable: await size(done),
    rows: [
      { id: kept.id, image: (await kept.inspect()).image.digest, status: 'created', size: await size(kept) },
      { id: done.id, image: (await done.inspect()).image.digest, status: 'exited', size: await size(done) },
    ],
  });
  assert.deepEqual(df.images, { total: 0, active: 0, size: 0, reclaimable: 0, location: null, rows: [] });
  await assert.rejects(prism.system.df({ all: true }), { code: 'system.option' });
});

test('prune removes exited containers only and keeps created and running ones', async () => {
  const prism = quiet();
  const { app, release } = await held();
  const created = await prism.containers.create(fixture, ADD, P0);
  const running = await prism.containers.create(app, ADD, P0);
  const started = running.start();
  const exited = await prism.containers.run(fixture, ADD, P0);
  const record = await exited.inspect();
  const pruned = await prism.system.prune();
  assert.deepEqual(pruned, { schema: SYSTEM_PRUNE_SCHEMA, containersDeleted: [exited.id], imagesDeleted: [], spaceReclaimed: new TextEncoder().encode(JSON.stringify(record)).length });
  await assert.rejects(prism.containers.get(exited.id), { code: 'container.missing' });
  assert.deepEqual((await prism.containers.list({ all: true })).map((container) => container.id).sort(), [created.id, running.id].sort());
  // The image a container references is still there: a created container starts from it.
  assert.equal((await created.start()).exitCode, 0);
  release(new TextEncoder().encode('1\tok\t42'));
  await started;
  assert.deepEqual((await prism.system.prune()).containersDeleted.sort(), [created.id, running.id].sort());
  assert.deepEqual((await prism.system.prune()).containersDeleted, []);
});

test('prune until keeps a container that finished at or after that time', async () => {
  const prism = quiet();
  const old = await prism.containers.run(fixture, ADD, P0);
  const cut = Date.parse((await old.inspect()).state.finishedAt) + 1;
  assert.deepEqual((await prism.system.prune({ until: new Date(cut - 1) })).containersDeleted, []);
  assert.deepEqual((await prism.system.prune({ until: new Date(cut).toISOString() })).containersDeleted, [old.id]);
  await assert.rejects(prism.system.prune({ until: 'yesterday' }), { code: 'system.option' });
  await assert.rejects(prism.system.prune({ force: true }), { code: 'system.option' });
});

test('prune works over the file store, and a container another client removed is not counted', async () => {
  const directory = join(scratch(), 'containers');
  const one = quiet({ store: fileContainerStore(directory) });
  const two = quiet({ store: fileContainerStore(directory) });
  const exited = await one.containers.run(fixture, ADD, P0);
  assert.deepEqual((await two.system.prune()).containersDeleted, [exited.id]);
  assert.deepEqual((await one.system.df()).containers.total, 0);
});

// containers.list

test('containers.list lists running containers, or every one with all, oldest first', async () => {
  const prism = quiet();
  const { app, release } = await held();
  const first = await prism.containers.create(fixture, ADD, P0);
  // Creation times are in milliseconds: two in the same one are ordered by id.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const running = await prism.containers.create(app, ADD, P0);
  const started = running.start();
  assert.deepEqual((await prism.containers.list()).map((container) => container.id), [running.id]);
  assert.deepEqual((await prism.containers.list({ all: true })).map((container) => container.id), [first.id, running.id]);
  await assert.rejects(prism.containers.list({ all: 'yes' }), { code: 'container.option' });
  await assert.rejects(prism.containers.list({ filters: {} }), { code: 'container.option' });
  release(new TextEncoder().encode('1\tok\t42'));
  await started;
});

// system.events

test('events streams create, start, die and destroy, in order, with the exit code', async () => {
  const prism = quiet();
  const stream = prism.system.events();
  const container = await prism.containers.run(fixture, ADD, P0);
  await container.remove();
  const seen = await drain(stream, 4);
  assert.deepEqual(seen.map((event) => event.action), ['create', 'start', 'die', 'destroy']);
  assert.deepEqual(EVENT_ACTIONS, ['create', 'start', 'die', 'destroy']);
  for (const event of seen) {
    assert.deepEqual([event.schema, event.type, event.id, event.image], [SYSTEM_EVENT_SCHEMA, 'container', container.id, `blake3:${(await load(fixture)).identities.archiveFingerprint}`]);
    assert.ok(Object.isFrozen(event));
  }
  assert.deepEqual(seen.map((event) => event.exitCode), [null, null, 0, 0]);
  assert.deepEqual(seen.map((event) => event.sequence), [1, 2, 3, 4]);
});

test('a refused image dies without starting, and its exit code says why', async () => {
  const prism = quiet();
  const stream = prism.system.events({ filters: { id: '' } });
  const container = await prism.containers.run(fixture, ADD, { policy: { minimum: 'P2' } });
  assert.notEqual(container.exitCode, 0);
  const seen = await drain(stream, 2);
  assert.deepEqual(seen.map((event) => [event.action, event.exitCode]), [['create', null], ['die', container.exitCode]]);
});

test('since replays what the bus kept, until ends the stream, and filters narrow it', async () => {
  let clock = 1_000;
  const events = createEventBus({ now: () => clock });
  const prism = quiet({ events });
  const a = await prism.containers.create(fixture, ADD, P0);
  clock = 2_000;
  const b = await prism.containers.run(fixture, ADD, P0);
  clock = 3_000;
  const past = await drain(prism.system.events({ since: 0, until: 2_500 }));
  assert.deepEqual(past.map((event) => [event.id, event.action]), [[a.id, 'create'], [b.id, 'create'], [b.id, 'start'], [b.id, 'die']]);
  assert.deepEqual((await drain(prism.system.events({ since: new Date(2_000), until: 2_500, filters: { action: 'die' } }))).map((event) => event.id), [b.id]);
  assert.deepEqual((await drain(prism.system.events({ since: 0, until: 2_500, filters: { id: a.id.slice(0, 8) } }))).map((event) => event.action), ['create']);
  assert.deepEqual((await drain(prism.system.events({ since: '1970-01-01T00:00:01.500Z', until: 2_500, filters: { action: ['create', 'start'] } }))).length, 2);
  assert.throws(() => prism.system.events({ filters: { action: 'pause' } }), { code: 'system.option' });
  assert.throws(() => prism.system.events({ filters: { label: 'x' } }), { code: 'system.option' });
  assert.throws(() => prism.system.events({ since: 'soon' }), { code: 'system.option' });
});

test('a stream ends on close or on its signal, and an open stream waits for the next event', async () => {
  const prism = quiet();
  const stream = prism.system.events();
  const next = drain(stream, 1);
  await prism.containers.create(fixture, ADD, P0);
  assert.equal((await next)[0].action, 'create');
  const closed = prism.system.events();
  closed.close();
  assert.deepEqual(await drain(closed), []);
  const controller = new AbortController();
  const aborted = prism.system.events({ signal: controller.signal });
  const ended = drain(aborted);
  controller.abort();
  assert.deepEqual(await ended, []);
});

test('the bus keeps a bounded history, and an observer that throws never stops a run', async () => {
  const events = createEventBus({ history: 2 });
  for (let index = 0; index < 5; index += 1) events.emit({ action: 'create', id: String(index) });
  assert.deepEqual((await drain(events.subscribe({ since: 0, until: Date.now() }))).map((event) => event.id), ['3', '4']);
  assert.equal(EVENT_HISTORY, 1024);
  assert.throws(() => events.emit({ action: 'pause', id: 'x' }), { code: 'system.event' });
  assert.throws(() => createEventBus({ history: -1 }), { code: 'system.option' });
  const prism = quiet({ events: { emit: () => { throw new Error('observer'); }, subscribe: events.subscribe } });
  assert.equal((await prism.containers.run(fixture, ADD, P0)).exitCode, 0);
});

test('system needs the containers of its own client, and events need its bus', () => {
  assert.throws(() => createSystem({}), { code: 'system.option' });
  const { containers } = quiet();
  const system = createSystem({ containers });
  assert.throws(() => system.events(), (error) => error.code === 'system.events' && /createPrism/.test(error.message));
  assert.throws(() => createSystem({ containers, events: {} }), { code: 'system.option' });
  assert.throws(() => createSystem({ containers, readLock: 'prismpm.lock' }), { code: 'system.option' });
});

test('system imports no module it may not depend on', () => {
  const source = readFileSync(new URL('../src/system.mjs', import.meta.url), 'utf8');
  const imported = [...source.matchAll(/from '\.\/([^']+)'/g)].map((match) => match[1]).sort();
  // errors (errors.mjs, version.mjs, the vendored spec) and images (docker.mjs), as model/modules.toml allows.
  assert.deepEqual(imported, ['docker.mjs', 'errors.mjs', 'vendor/spec/constants.mjs', 'version.mjs']);
});
