// `prism.volumes` (#445): a view over the capability file. Host folders, widening and calls that need host effects are refused with typed errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CapabilityDeniedError, ProviderFailedError, ProviderNotFoundError, classForCheck, exitCodeFor } from '../src/errors.mjs';
import { manifestProviders } from '../src/manifest.mjs';
import { releaseProviders, resolveProviders } from '../src/providers.mjs';
import { HOST_EFFECTS, attachVolume, createVolumes, refusalRecord } from '../src/volumes.mjs';
import { createPrism } from '../src/index.mjs';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const windows = process.platform === 'win32';
const caps = (set, more = {}) => ({ schema: 'prism/capabilities/1', sets: { default: set, ...more } });
const GRANT = { 'allow-key-value-stores': ['rates'], 'allow-providers': ['kv'] };
const RATES = Object.freeze({ name: 'rates', type: 'kv', options: { set: ['base=EUR'] } });
const CORE_WASM = Object.freeze({ contract: 'hologram:guest/core-wasm@1', imports: [] });
const WITH_STORES = Object.freeze({ contract: 'example:guest/stores@1', imports: [{ module: 'wasi:keyvalue/store', name: 'get', kind: 'func', capability: 'key-value-stores' }] });

/** A runner that records its calls, so a refusal can show that no provider ran. */
function recording(reply = { env: { RATES_STORE: 'rates' }, withheld: [] }) {
  const calls = [];
  return {
    calls,
    up: async (declaration) => {
      calls.push(['up', declaration]);
      return reply;
    },
    down: async (declaration) => {
      calls.push(['down', declaration]);
    },
  };
}

const scope = (more = {}) => ({ capabilities: caps(GRANT), declarations: [RATES], ...more });

/** A rejection with this check and these details, and a typed error `classForCheck` and the exit table agree on. */
async function refuses(promise, check, details = {}) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof CapabilityDeniedError, `${error.name}: ${error.message}`);
    assert.equal(error.code, 'capability_denied');
    assert.equal(error.check, check, error.message);
    assert.equal(classForCheck(error.check), CapabilityDeniedError);
    assert.equal(exitCodeFor(error), 2);
    for (const [member, value] of Object.entries(details)) assert.deepEqual(error.details[member], value, member);
    return true;
  });
}

test('the namespace is exactly the four verbs of the module table, and cannot be changed', () => {
  const volumes = createVolumes();
  assert.deepEqual(Object.keys(volumes).sort(), ['create', 'inspect', 'list', 'remove']);
  assert.ok(Object.isFrozen(volumes));
});

test('list is the capability set: named stores less denied ones, and declared ones a wildcard allows', async () => {
  const named = createVolumes({ capabilities: caps({ 'allow-key-value-stores': ['zeta', 'alpha', 'gone'], 'deny-key-value-stores': ['gone'] }) });
  assert.deepEqual((await named.list()).map((volume) => volume.name), ['alpha', 'zeta']);

  const wildcard = createVolumes({ capabilities: caps({ 'allow-key-value-stores': ['*'], 'deny-key-value-stores': ['old'] }), declarations: [RATES, { name: 'old', type: 'kv' }] });
  assert.deepEqual((await wildcard.list()).map((volume) => volume.name), ['rates']);

  assert.deepEqual(await createVolumes().list(), []);
  assert.deepEqual(await createVolumes({ capabilities: caps({}) }).list(), []);
  assert.deepEqual(await createVolumes({ declarations: [RATES] }).list(), []);
});

test('a named set other than default is the one in force, and an unknown set is an error, not an empty grant', async () => {
  const capabilities = caps({}, { staging: GRANT });
  assert.deepEqual((await createVolumes({ capabilities, set: 'staging' }).list()).map((volume) => [volume.name, volume.set]), [['rates', 'staging']]);
  assert.throws(() => createVolumes({ capabilities, set: 'nope' }), { code: 'capabilities.invalid' });
});

test('the capability file may be its text or its bytes, and a malformed one is refused', async () => {
  const text = JSON.stringify(caps(GRANT));
  assert.equal((await createVolumes({ capabilities: text }).inspect('rates')).name, 'rates');
  assert.equal((await createVolumes({ capabilities: new TextEncoder().encode(text) }).inspect('rates')).name, 'rates');
  assert.throws(() => createVolumes({ capabilities: { schema: 'prism/capabilities/1', sets: { default: { 'allow-volumes': ['x'] } } } }), { code: 'capabilities.invalid' });
});

test('inspect reports what is declared, that a guest has no access and why, and runs nothing', async () => {
  const runner = recording();
  const volumes = createVolumes({ ...scope(), runner });
  const volume = await volumes.inspect('rates');
  assert.deepEqual(volume, { name: 'rates', set: 'default', provider: 'kv', options: { set: ['base=EUR'] }, guest: { access: false, dependsOn: ['#216', '#217'] } });
  assert.ok(Object.isFrozen(volume));
  assert.deepEqual(runner.calls, []);
  assert.deepEqual(HOST_EFFECTS, ['#216', '#217']);
  assert.equal((await createVolumes({ capabilities: caps(GRANT) }).inspect('rates')).provider, null);
  await refuses(volumes.inspect('other'), 'capabilities.key-value-stores', { outside: 'grant', resource: 'other' });
});

test('create provisions through the runner it was given, with the one declaration, and returns what the runner returned', async () => {
  const runner = recording({ env: { RATES_STORE: 'rates' }, withheld: [{ capability: 'rates', name: 'RATES_URL', variable: 'rates_url' }] });
  const volume = await createVolumes({ ...scope({ declarations: [RATES, { name: 'other', type: 'kv' }] }), runner }).create('rates');
  assert.deepEqual(runner.calls, [['up', RATES]]);
  assert.equal(volume.name, 'rates');
  assert.equal(volume.provider, 'kv');
  assert.deepEqual(volume.env, { RATES_STORE: 'rates' });
  assert.deepEqual(volume.withheld, [{ capability: 'rates', name: 'RATES_URL', variable: 'rates_url' }]);
  assert.deepEqual(volume.guest, { access: false, dependsOn: ['#216', '#217'] });
  assert.deepEqual((await createVolumes({ ...scope(), runner: { up: async () => undefined, down: async () => {} } }).create('rates')).env, {});
});

test('remove releases through the runner, and needs the grant, not the image or the policy', async () => {
  const runner = recording();
  const volumes = createVolumes({ ...scope({ world: CORE_WASM, policy: { name: 'pure-only', effects: [] } }), runner });
  assert.equal(await volumes.remove('rates'), undefined);
  assert.deepEqual(runner.calls, [['down', RATES]]);
  await refuses(createVolumes({ capabilities: caps({ 'allow-providers': ['kv'] }), declarations: [RATES], runner }).remove('rates'), 'capabilities.key-value-stores', { outside: 'grant' });
  assert.equal(runner.calls.length, 1);
});

test('a provider failure passes through as the runner raised it, and is not a refusal of this module', async () => {
  const failure = new ProviderFailedError('prism-provider-kv failed', { check: 'provider.failed' });
  const down = async () => {
    throw failure;
  };
  await assert.rejects(createVolumes({ ...scope(), runner: { up: down, down } }).create('rates'), (error) => {
    assert.equal(error, failure);
    assert.equal(refusalRecord(error), null);
    return true;
  });
});

test('with no runner, as in a browser, create and remove raise a typed error and list and inspect still work', async () => {
  const volumes = createVolumes(scope());
  for (const verb of ['create', 'remove']) {
    await assert.rejects(volumes[verb]('rates'), (error) => {
      assert.ok(error instanceof ProviderNotFoundError);
      assert.equal(error.code, 'provider_not_found');
      assert.equal(error.check, 'provider.runner');
      assert.deepEqual(refusalRecord(error).details, { module: 'volumes', verb, volume: 'rates' });
      return true;
    });
  }
  assert.equal((await volumes.list()).length, 1);
  assert.equal((await volumes.inspect('rates')).name, 'rates');
  assert.throws(() => createVolumes({ runner: { up() {} } }), { code: 'capabilities.invalid' });
});

const HOST_NAMES = ['/var/lib/data', './data', '../data', '.', '..', '~/data', 'data/sub', 'C:\\data', 'C:/data', '\\\\server\\share', 'file:///etc', '/host:/data', 'data:/data'];

test('a host-folder mount is refused by every verb and by attaching, before any provider runs', async () => {
  const runner = recording();
  const volumes = createVolumes({ capabilities: caps({ 'allow-key-value-stores': ['*'], 'allow-providers': ['*'] }), declarations: [RATES], runner });
  for (const name of HOST_NAMES) {
    await refuses(volumes.create(name), 'capabilities.host-folder', { verb: 'create', volume: name });
    await refuses(volumes.inspect(name), 'capabilities.host-folder');
    await refuses(volumes.remove(name), 'capabilities.host-folder');
    await refuses(attachVolume({ capabilities: caps(GRANT), declarations: [RATES], world: WITH_STORES }, name), 'capabilities.host-folder');
  }
  assert.deepEqual(runner.calls, []);
});

test("Docker's forms of a host folder in the options are refused", async () => {
  const runner = recording();
  const volumes = createVolumes({ ...scope(), runner });
  const forms = [
    { driver: 'local', driver_opts: { type: 'none', o: 'bind', device: '/srv/data' } },
    { DriverOpts: { device: 'data' } },
    { mountpoint: '/srv/data' },
    { Mountpoint: 'x' },
    { source: 'data' },
    { binds: ['data'] },
    { 'host-path': 'data' },
    { dir: 'data' },
    { anything: { nested: '/srv/data' } },
    '/srv/data',
  ];
  for (const form of forms) await refuses(volumes.create('rates', form), 'capabilities.host-folder');
  const cyclic = { device: 'x' };
  cyclic.self = cyclic;
  await refuses(volumes.create('rates', cyclic), 'capabilities.host-folder');
  assert.deepEqual(runner.calls, []);
});

test('a declaration that names a host folder is refused too, such as the --dir of prism-provider-kv', async () => {
  const runner = recording();
  for (const options of [{ dir: '/srv/kv' }, { dir: 'relative' }, { root: '/srv/kv' }, { root: 'a/b' }]) {
    const volumes = createVolumes({ capabilities: caps(GRANT), declarations: [{ name: 'rates', type: 'kv', options }], runner });
    await refuses(volumes.create('rates'), 'capabilities.host-folder', { volume: 'rates' });
    await refuses(volumes.remove('rates'), 'capabilities.host-folder');
  }
  assert.deepEqual(runner.calls, []);
  // Option values that hold a separator without being a path.
  const fine = createVolumes({ capabilities: caps(GRANT), declarations: [{ name: 'rates', type: 'kv', options: { set: ['base=a/b', 'url=https://example.com/x'], origin: 'https://example.com/x' } }], runner });
  await fine.create('rates');
  assert.equal(runner.calls.length, 1);
});

test('no call widens the grant: a denied, undeclared, wildcard or otherwise malformed name is refused, and no provider runs', async () => {
  const runner = recording();
  const volumes = createVolumes({ capabilities: caps({ 'allow-key-value-stores': ['*', 'nameless'], 'deny-key-value-stores': ['blocked'], 'allow-providers': ['kv'] }), declarations: [RATES, { name: 'blocked', type: 'kv' }], runner });
  await refuses(volumes.create('blocked'), 'capabilities.key-value-stores', { outside: 'grant', resource: 'blocked', set: 'default' });
  await refuses(volumes.create('nameless'), 'capabilities.providers', { outside: 'declaration' });
  for (const name of ['*', '', 'UPPER', '-x', 'a b']) await refuses(volumes.create(name), 'capabilities.key-value-stores', { outside: 'grant' });
  for (const name of [undefined, null, 7, 1n, {}, ['rates']]) await refuses(volumes.create(name), 'capabilities.key-value-stores', { outside: 'grant', volume: null });
  assert.deepEqual(runner.calls, []);

  const none = createVolumes({ declarations: [RATES], runner });
  await refuses(none.create('rates'), 'capabilities.key-value-stores', { outside: 'grant', set: null });
  assert.deepEqual(runner.calls, []);
});

test('options cannot add to the grant, and options Docker takes are refused and not ignored', async () => {
  const runner = recording();
  const volumes = createVolumes({ ...scope(), runner });
  const tries = [{ 'allow-key-value-stores': ['*'] }, { set: 'other' }, { driver: 'local' }, { labels: { a: 'b' } }, 7];
  for (const options of tries) await refuses(volumes.create('rates', options), 'capabilities.key-value-stores', { outside: 'declaration' });
  // The schema's name holds a separator, so this one is refused as a folder, which reads shape: refused either way.
  await refuses(volumes.create('rates', { capabilities: caps({ 'allow-key-value-stores': ['*'] }) }), 'capabilities.host-folder');
  await refuses(volumes.remove('rates', { force: true }), 'capabilities.key-value-stores', { outside: 'declaration' });
  await refuses(volumes.list({ filters: { name: 'x' } }), 'capabilities.key-value-stores', { outside: 'declaration', volume: null });
  await refuses(volumes.inspect('rates', { size: true }), 'capabilities.key-value-stores', { outside: 'declaration' });
  assert.deepEqual(runner.calls, []);
  for (const empty of [undefined, null, {}]) await volumes.create('rates', empty);
  assert.equal(runner.calls.length, 3);
});

test('a provider the set does not allow never runs, and a declaration cannot point at another store', async () => {
  const runner = recording();
  const denied = createVolumes({ capabilities: caps({ 'allow-key-value-stores': ['rates'] }), declarations: [RATES], runner });
  await refuses(denied.create('rates'), 'capabilities.providers', { outside: 'grant', resource: 'kv' });
  await refuses(denied.remove('rates'), 'capabilities.providers', { outside: 'grant' });
  const elsewhere = createVolumes({ capabilities: caps(GRANT), declarations: [{ name: 'rates', type: 'kv', options: { store: 'secrets' } }], runner });
  await refuses(elsewhere.create('rates'), 'capabilities.key-value-stores', { outside: 'declaration' });
  const arrayed = createVolumes({ capabilities: caps(GRANT), declarations: [{ name: 'rates', type: 'kv', options: { store: ['rates', 'secrets'] } }], runner });
  await refuses(arrayed.create('rates'), 'capabilities.key-value-stores', { outside: 'declaration' });
  assert.deepEqual(runner.calls, []);
  const same = createVolumes({ capabilities: caps(GRANT), declarations: [{ name: 'rates', type: 'kv', options: { store: 'rates' } }], runner });
  await same.create('rates');
  assert.equal(runner.calls.length, 1);
});

test("create is refused outside the image's declared world, and names what a store import depends on", async () => {
  const runner = recording();
  const volumes = createVolumes({ ...scope({ world: CORE_WASM }), runner });
  await refuses(volumes.create('rates'), 'capabilities.key-value-stores', { outside: 'world', contract: 'hologram:guest/core-wasm@1', dependsOn: ['#216', '#217'] });
  assert.deepEqual(runner.calls, []);
  // list and inspect grant nothing, so they read the file whatever the world.
  assert.equal((await volumes.list()).length, 1);
  assert.equal((await volumes.inspect('rates')).name, 'rates');
  await createVolumes({ ...scope({ world: WITH_STORES }), runner }).create('rates');
  assert.equal(runner.calls.length, 1);
  // No image in scope: Docker's volumes exist apart from any image, and only the grant applies.
  await createVolumes({ ...scope({ world: null }), runner }).create('rates');
  assert.equal(runner.calls.length, 2);
  for (const world of [{}, { imports: 'none' }, 'hologram:guest/core-wasm@1']) assert.throws(() => createVolumes({ ...scope(), world }), { code: 'capabilities.invalid' });
});

test('create is refused outside the active policy, and a policy this module cannot evaluate is refused rather than allowed', async () => {
  const runner = recording();
  const pureOnly = createVolumes({ ...scope({ policy: { name: 'pure-only', effects: [] } }), runner });
  await refuses(pureOnly.create('rates'), 'capabilities.key-value-stores', { outside: 'policy', policy: 'pure-only' });
  await refuses(createVolumes({ ...scope({ policy: { effects: ['clock'] } }), runner }).create('rates'), 'capabilities.key-value-stores', { outside: 'policy', policy: null });
  assert.deepEqual(runner.calls, []);
  await createVolumes({ ...scope({ policy: { name: 'open', effects: null } }), runner }).create('rates');
  await createVolumes({ ...scope({ policy: { name: 'stores', effects: ['unknown'] } }), runner }).create('rates');
  assert.equal(runner.calls.length, 2);
  for (const policy of [{ name: 'default', rego: 'package prism.policy' }, { name: 'x' }, { effects: 'none' }, 'pure-only']) assert.throws(() => createVolumes({ ...scope(), policy }), { code: 'capabilities.invalid' });
});

test('attaching a store to a guest never succeeds: a refusal comes first, and otherwise the error names the dependency', async () => {
  const within = scope({ world: WITH_STORES });
  await refuses(attachVolume(within, 'rates'), 'capabilities.host-effects', { verb: 'attach', volume: 'rates', dependsOn: ['#216', '#217'] });
  await assert.rejects(attachVolume(within, 'rates'), /#216, #217/);
  await refuses(attachVolume(scope({ world: CORE_WASM }), 'rates'), 'capabilities.key-value-stores', { outside: 'world', dependsOn: ['#216', '#217'] });
  await refuses(attachVolume(scope(), 'rates'), 'capabilities.key-value-stores', { outside: 'world', contract: null });
  await refuses(attachVolume(scope({ world: WITH_STORES, policy: { name: 'pure-only', effects: [] } }), 'rates'), 'capabilities.key-value-stores', { outside: 'policy' });
  await refuses(attachVolume({ ...within, capabilities: null }, 'rates'), 'capabilities.key-value-stores', { outside: 'grant' });
  await refuses(attachVolume({ ...within, declarations: [] }, 'rates'), 'capabilities.providers', { outside: 'declaration' });
  // Whatever provisioning did, a provisioned store is still out of a guest's reach.
  const created = await createVolumes({ ...within, runner: recording() }).create('rates');
  assert.equal(created.guest.access, false);
  await refuses(attachVolume(within, created.name), 'capabilities.host-effects');
});

test('a refusal becomes plain JSON that containers can keep on a container (#443)', async () => {
  const error = await attachVolume(scope({ world: CORE_WASM }), 'rates').catch((caught) => caught);
  const record = refusalRecord(error);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), {
    name: 'CapabilityDeniedError',
    code: 'capability_denied',
    check: 'capabilities.key-value-stores',
    message: error.message,
    details: { module: 'volumes', verb: 'attach', volume: 'rates', outside: 'world', contract: 'hologram:guest/core-wasm@1', set: 'default', dependsOn: ['#216', '#217'] },
  });
  assert.ok(Object.isFrozen(record));
  assert.equal(refusalRecord(new CapabilityDeniedError('from elsewhere', { check: 'capabilities.import' })), null);
  assert.equal(refusalRecord(new Error('untyped')), null);
  assert.equal(refusalRecord(null), null);
});

test('a system model is not a capability file, and the module has nothing that could read one', () => {
  for (const capabilities of [{ spec: 'prismpm/system-model/3', volumes: [{ id: 'data', mount_path: '/srv/data' }] }, { spec: 'prismpm/system-model/1', topology: [] }]) {
    assert.throws(() => createVolumes({ capabilities }), { code: 'capabilities.invalid' });
  }
  const text = readFileSync(join(src, 'volumes.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(text, /system-model|system_model|systemModel|topology|mount_path/);
});

test('the module imports only errors and the capability code, and no Node built-in', () => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const [, specifier] of text.matchAll(/^\s*(?:import|export)\b[^'";]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
      assert.ok(specifier.startsWith('.'), `${relative(src, file)} imports ${specifier}`);
      visit(join(dirname(file), specifier));
    }
    assert.doesNotMatch(text, /\bimport\s*\(/, relative(src, file));
    assert.doesNotMatch(text, /\b(?:process|require|Buffer)\b/, relative(src, file));
  };
  visit(join(src, 'volumes.mjs'));
  assert.deepEqual([...seen].map((file) => relative(src, file)).sort(), ['capabilities.mjs', 'errors.mjs', 'volumes.mjs']);
});

test('the module loads and refuses where a host has no node: imports', () => {
  const url = pathToFileURL(join(src, 'volumes.mjs')).href;
  const program = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) { if (specifier.startsWith('node:')) throw new Error('refused ' + specifier); return next(specifier, context); } });
    const refused = await import('node:fs').then(() => 'loaded', (error) => error.message);
    const { createVolumes } = await import(${JSON.stringify(url)});
    const volumes = createVolumes(${JSON.stringify(scope())});
    const check = await volumes.create('rates').catch((error) => error.check);
    const host = await volumes.create('/srv').catch((error) => error.check);
    console.log(JSON.stringify({ refused, listed: (await volumes.list()).length, check, host }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { refused: 'refused node:fs', listed: 1, check: 'provider.runner', host: 'capabilities.host-folder' });
});

test('client can bind the real runner: create and remove run prism-provider-kv through providers.mjs, unchanged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prism-volumes-'));
  const dir = join(root, 'project');
  const path = join(root, 'path');
  mkdirSync(dir);
  mkdirSync(path);
  const kv = fileURLToPath(new URL('../bin/prism-provider-kv.mjs', import.meta.url));
  if (windows) {
    writeFileSync(join(path, 'prism-provider-kv.cmd'), `@"${process.execPath}" "${kv}" %*\r\n`);
  } else {
    writeFileSync(join(path, 'prism-provider-kv'), `#!/bin/sh\nexec "${process.execPath}" "${kv}" "$@"\n`);
    chmodSync(join(path, 'prism-provider-kv'), 0o755);
  }
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH')), PATH: [path, dirname(process.execPath)].join(delimiter) };

  const capabilities = caps({ 'allow-key-value-stores': ['rates'], 'allow-providers': ['kv'], 'allow-variables': ['rates_store'] });
  const declared = { rates: { provider: { type: 'kv', options: { set: ['base=EUR'] } } } };
  const manifest = { application: { name: 'exchange', version: '0.1.0' }, capabilities: declared };
  // The binding #441 makes: one declaration at a time, through the functions that exist.
  const project = ({ name }) => ({ manifest: { ...manifest, capabilities: { [name]: declared[name] } }, grant: { capabilities, capabilitySet: 'default' }, directory: dir });
  const runner = { up: (declaration) => resolveProviders(project(declaration), { env }), down: (declaration) => releaseProviders(project(declaration), { env }) };
  const volumes = createVolumes({ capabilities, declarations: manifestProviders(manifest), runner });

  const store = join(dir, '.prism', 'kv', 'exchange', 'rates.json');
  const volume = await volumes.create('rates');
  assert.deepEqual(volume.env, { RATES_STORE: 'rates' });
  assert.deepEqual(volume.withheld.map((row) => row.name), ['RATES_URL']);
  assert.deepEqual(JSON.parse(readFileSync(store, 'utf8')), { base: 'EUR' });
  await volumes.create('rates');
  await volumes.remove('rates');
  assert.equal(existsSync(store), false);
  await volumes.remove('rates');
});

test('no verb changes the capability file, and remove leaves the grant in place', async () => {
  const capabilities = caps(GRANT);
  const before = JSON.stringify(capabilities);
  const volumes = createVolumes({ capabilities, declarations: [RATES], world: WITH_STORES, policy: { effects: null }, runner: recording() });
  await volumes.create('rates');
  await volumes.remove('rates');
  assert.equal(JSON.stringify(capabilities), before);
  assert.deepEqual((await volumes.list()).map((volume) => volume.name), ['rates']);
});

test('without a runner, remove reports a refusal before it reports the missing runner', async () => {
  await refuses(createVolumes({ capabilities: caps(GRANT) }).remove('rates'), 'capabilities.providers', { outside: 'declaration' });
});

// containers.create({ volumes }) (#443): the volume goes through attachVolume and the refusal is kept on the container.

const HOLO = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const P0 = Object.freeze({ policy: { minimum: 'P0' } });

test('a container that asks for a volume is created with the typed refusal on its record, and never runs', async () => {
  const prism = createPrism({ ...scope({ world: WITH_STORES }), warn: () => {} });
  const container = await prism.containers.create(HOLO, '1\tadd\t1\t2', { ...P0, volumes: ['rates'] });
  const created = await container.inspect();
  assert.equal(created.volumes.length, 1);
  assert.equal(created.volumes[0].name, 'rates');
  assert.equal(created.volumes[0].attached, false);
  assert.equal(created.volumes[0].refusal.check, 'capabilities.host-effects');
  assert.deepEqual(created.volumes[0].refusal.details.dependsOn, HOST_EFFECTS);
  // allowUnverified bypasses check and nothing else.
  for (const options of [P0, { ...P0, allowUnverified: true }]) {
    const run = await prism.containers.run(HOLO, '1\tadd\t1\t2', { ...options, volumes: ['rates'] });
    assert.equal(run.exitCode, 2);
    assert.ok(run.error instanceof CapabilityDeniedError);
    assert.equal(run.error.check, 'capabilities.host-effects');
    const record = await run.inspect();
    assert.equal(record.state.startedAt, null, 'the guest never ran');
    assert.equal(record.output, null);
    assert.equal(record.state.error.name, 'CapabilityDeniedError');
    assert.equal(record.verdict, null, 'the refusal comes before check');
  }
  await refuses(prism.containers.dispatch(HOLO, '1\tadd\t1\t2', { ...P0, volumes: ['rates'] }), 'capabilities.host-effects', { dependsOn: ['#216', '#217'] });
});

test('a container that asks for a host folder, a denied store or an undeclared one keeps that refusal instead', async () => {
  const prism = createPrism({ ...scope({ world: WITH_STORES }), warn: () => {} });
  const checks = async (volumes) => (await (await prism.containers.create(HOLO, '', { ...P0, volumes })).inspect()).volumes.map((row) => row.refusal.check);
  assert.deepEqual(await checks(['/var/data']), ['capabilities.host-folder']);
  assert.deepEqual(await checks(['./data:/data']), ['capabilities.host-folder']);
  assert.deepEqual(await checks(['secrets']), ['capabilities.key-value-stores']);
  assert.deepEqual(await checks(['rates', 'rates']), ['capabilities.host-effects'], 'a name asked twice is one volume');
  // With no world in scope, the store is outside the image's declared world.
  const bare = createPrism({ ...scope(), warn: () => {} });
  const record = await (await bare.containers.create(HOLO, '', { ...P0, volumes: ['rates'] })).inspect();
  assert.equal(record.volumes[0].refusal.details.outside, 'world');
  for (const volumes of ['rates', [7], { rates: true }]) {
    await assert.rejects(prism.containers.create(HOLO, '', { volumes }), { code: 'container.option' });
  }
  // No volumes asked for: the record says so, and nothing is attached.
  assert.deepEqual((await (await prism.containers.create(HOLO, '', P0)).inspect()).volumes, []);
});

// `prism-code volumes create|ls|inspect|rm` (#445), over a project's prism.toml.

test('the volumes CLI group lists, inspects, creates and removes the declared stores of a project, and refuses a host folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'prism-volumes-cli-'));
  const dir = join(root, 'project');
  const path = join(root, 'path');
  mkdirSync(dir);
  mkdirSync(path);
  const kv = fileURLToPath(new URL('../bin/prism-provider-kv.mjs', import.meta.url));
  if (windows) writeFileSync(join(path, 'prism-provider-kv.cmd'), `@"${process.execPath}" "${kv}" %*\r\n`);
  else {
    writeFileSync(join(path, 'prism-provider-kv'), `#!/bin/sh\nexec "${process.execPath}" "${kv}" "$@"\n`);
    chmodSync(join(path, 'prism-provider-kv'), 0o755);
  }
  writeFileSync(join(dir, 'prism.toml'), '[application]\nname = "exchange"\nversion = "0.1.0"\n\n[capabilities]\nallow-key-value-stores = ["rates"]\nallow-providers = ["kv"]\nallow-variables = ["rates_store"]\n\n[capabilities.rates]\nprovider = { type = "kv", options = { set = ["base=EUR"] } }\n');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH')), PATH: [path, dirname(process.execPath)].join(delimiter), PRISM_CODE_NO_HOOKS: '1' };
  const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
  const cli = (...args) => {
    const result = spawnSync(process.execPath, [bin, 'volumes', ...args, '--project', dir], { encoding: 'utf8', env });
    return { code: result.status, out: result.stdout, err: result.stderr };
  };

  const ls = cli('ls', '--json');
  assert.equal(ls.code, 0, ls.err);
  assert.deepEqual(JSON.parse(ls.out).map((volume) => [volume.name, volume.provider, volume.guest.access]), [['rates', 'kv', false]]);
  const inspected = cli('inspect', 'rates');
  assert.equal(inspected.code, 0, inspected.err);
  assert.match(inspected.out, /^rates {2}provider kv {2}set default {2}guest access: no \(needs #216, #217\)$/m);
  const created = cli('create', 'rates', '--json');
  assert.equal(created.code, 0, created.err);
  const volume = JSON.parse(created.out);
  assert.deepEqual(volume.variables, ['RATES_STORE']);
  assert.ok(!('env' in volume), 'variable values never reach stdout');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.prism', 'kv', 'exchange', 'rates.json'), 'utf8')), { base: 'EUR' });
  const removed = cli('rm', 'rates');
  assert.equal(removed.code, 0, removed.err);
  assert.equal(existsSync(join(dir, '.prism', 'kv', 'exchange', 'rates.json')), false);

  const folder = cli('create', '/var/data');
  assert.equal(folder.code, 2);
  assert.match(folder.err, /^capability_denied: .*host folder/m);
  assert.equal(cli('inspect').code, 64, 'a missing name is usage');
  assert.equal(cli('ls', '--force').code, 64, 'an option Docker takes is refused, not ignored');
});
