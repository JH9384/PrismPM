// `prism.networks` (#444, docs/proposals/440-nine-modules.md): a named, deny-by-default grant of outbound hosts, as a view over a capability file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createNetworks } from '../src/networks.mjs';
import { load, grantOf, parseCapabilities, classForCheck, exitCodeFor, CapabilityDeniedError, PrismCodeError } from '../src/index.mjs';

const OPEN = { capabilities: { 'allow-outbound-hosts': ['*://*:*'] } };
const WORLD_WITH_HOSTS = { world: { contract: 'test:world@1', imports: [{ module: 'wasi:http/outgoing-handler', name: 'handle', kind: 'func', capability: 'outbound-hosts' }] } };
const file = (sets) => ({ schema: 'prism/capabilities/1', sets });

/** A store in memory, which counts its writes and holds what a file on disk would. */
function memory(initial = null) {
  const store = {
    text: initial === null ? null : JSON.stringify(initial),
    writes: 0,
    read: () => store.text,
    write: (text) => {
      store.writes += 1;
      store.text = text;
    },
  };
  return store;
}

const networksOver = (initial, policy = OPEN) => {
  const store = memory(initial);
  return { store, networks: createNetworks({ store, policy }) };
};
const codeIs = (code) => (error) => error instanceof PrismCodeError && error.code === code;
const refusedAs = (outside) => (error) => error instanceof CapabilityDeniedError && error.check === 'capabilities.outbound-hosts' && error.details.outside === outside;

test('create writes a named grant to the canonical capability file, and list and inspect read it back', async () => {
  const { store, networks } = networksOver(null);
  const created = await networks.create('api', { hosts: ['https://api.example.com'], deny: ['https://admin.example.com'] });
  assert.deepEqual(parseCapabilities(store.text).sets, {
    default: {},
    api: { 'allow-outbound-hosts': ['https://api.example.com'], 'deny-outbound-hosts': ['https://admin.example.com'] },
  });
  assert.deepEqual(await networks.inspect('api'), created);
  assert.deepEqual(await networks.list(), [created]);
  assert.deepEqual(created.allow, ['https://api.example.com']);
  assert.ok(Object.isFrozen(created));
});

test('a network with no hosts grants nothing, and no file lists nothing', async () => {
  const { store, networks } = networksOver(null);
  assert.deepEqual(await networks.list(), []);
  assert.equal(store.writes, 0);
  await networks.create('empty', null);
  const grant = grantOf(parseCapabilities(store.text), 'empty');
  assert.equal(grant.allows('outbound-hosts', 'https://example.com'), false);
});

test('a set that holds other kinds keeps them through create and remove', async () => {
  const stores = { 'allow-key-value-stores': ['cache'] };
  const { store, networks } = networksOver(file({ default: {}, web: stores }));
  assert.deepEqual(await networks.list(), []);
  await networks.create('web', { hosts: ['https://example.com'] });
  assert.deepEqual(parseCapabilities(store.text).sets.web, { ...stores, 'allow-outbound-hosts': ['https://example.com'] });
  await networks.remove('web');
  assert.deepEqual(parseCapabilities(store.text).sets.web, stores);
  await assert.rejects(networks.inspect('web'), codeIs('networks.not-found'));
});

test('remove drops a set with nothing else in it, and never the default set', async () => {
  const { store, networks } = networksOver(file({ default: { 'allow-outbound-hosts': ['https://example.com'] }, api: { 'allow-outbound-hosts': [] } }));
  await networks.remove('api');
  assert.deepEqual(Object.keys(parseCapabilities(store.text).sets), ['default']);
  const writes = store.writes;
  await assert.rejects(networks.remove('default'), codeIs('networks.protected'));
  assert.equal(store.writes, writes);
});

test('wrong calls raise typed errors and write nothing', async () => {
  const { store, networks } = networksOver(file({ default: {}, api: { 'allow-outbound-hosts': [] } }));
  await assert.rejects(networks.create('api'), codeIs('networks.exists'));
  await assert.rejects(networks.inspect('nope'), codeIs('networks.not-found'));
  await assert.rejects(networks.inspect('constructor'), codeIs('networks.not-found'));
  await assert.rejects(networks.remove('nope'), codeIs('networks.not-found'));
  await assert.rejects(networks.create('other', { internal: true }), codeIs('networks.option'));
  await assert.rejects(networks.create('Not A Name'), codeIs('capabilities.invalid'));
  await assert.rejects(networks.create(['other']), codeIs('capabilities.invalid'));
  await assert.rejects(networks.create('other', { hosts: ['not a host'] }), codeIs('capabilities.invalid'));
  await assert.rejects(networks.create('other', { hosts: 'https://example.com' }), codeIs('capabilities.invalid'));
  assert.equal(store.writes, 0);
});

test('without a store nothing can appear to be saved', async () => {
  assert.throws(() => createNetworks(), codeIs('networks.store'));
  const networks = createNetworks({ store: { read: () => null }, policy: OPEN });
  await assert.rejects(networks.create('api'), codeIs('networks.store'));
  assert.throws(() => createNetworks({ store: memory(), policy: { effects: 'socket' } }), codeIs('networks.option'));
  assert.throws(() => createNetworks({ store: memory(), policy: { capabilities: { 'allow-outbound-host': [] } } }), codeIs('capabilities.invalid'));
});

test('create refuses a host outside the policy, and writes nothing', async () => {
  const policy = { capabilities: { 'allow-outbound-hosts': ['https://*.example.com', 'http://plain.example.com:8080'] } };
  const outside = [
    'https://example.com',
    'https://evil-example.com',
    'https://*.com',
    'https://*',
    '*://api.example.com',
    'http://api.example.com',
    'https://api.example.com:8443',
    'https://api.example.com:*',
    'http://plain.example.com',
  ];
  for (const host of outside) {
    const { store, networks } = networksOver(null, policy);
    await assert.rejects(networks.create('api', { hosts: ['https://api.example.com', host] }), refusedAs('policy'), host);
    assert.equal(store.writes, 0, host);
  }
  for (const host of ['https://api.example.com', 'https://api.example.com:443', 'https://*.api.example.com', 'http://plain.example.com:8080']) {
    await networksOver(null, policy).networks.create('api', { hosts: [host] });
  }
});

test('with no policy capabilities a network can grant nothing: deny by default', async () => {
  const { store, networks } = networksOver(null, {});
  await assert.rejects(networks.create('api', { hosts: ['https://example.com'] }), refusedAs('policy'));
  assert.equal(store.writes, 0);
  await networks.create('empty');
  const none = networksOver(null, { capabilities: null });
  await assert.rejects(none.networks.create('api', { hosts: ['https://example.com'] }), refusedAs('policy'));
  const omitted = createNetworks({ store: memory() });
  await assert.rejects(omitted.create('api', { hosts: ['https://example.com'] }), refusedAs('policy'));
});

test('a policy that does not allow the socket effect refuses any host', async () => {
  const { networks } = networksOver(null, { ...OPEN, effects: [] });
  await assert.rejects(networks.create('api', { hosts: ['https://example.com'] }), (error) => refusedAs('policy')(error) && error.details.rule === 'policy.effects');
  await networks.create('empty');
  await networksOver(null, { ...OPEN, effects: ['socket'] }).networks.create('api', { hosts: ['https://example.com'] });
});

test('a wildcard cannot reach what the policy denies, unless the network denies it too', async () => {
  const policy = { capabilities: { 'allow-outbound-hosts': ['https://*.example.com'], 'deny-outbound-hosts': ['https://admin.example.com'] } };
  await assert.rejects(networksOver(null, policy).networks.create('api', { hosts: ['https://*.example.com'] }), refusedAs('policy'));
  await assert.rejects(networksOver(null, policy).networks.create('api', { hosts: ['https://admin.example.com'] }), refusedAs('policy'));
  await networksOver(null, policy).networks.create('api', { hosts: ['https://*.example.com'], deny: ['https://admin.example.com'] });
  await networksOver(null, policy).networks.create('api', { hosts: ['https://api.example.com'] });
});

test('what create admits, the evaluator in capabilities.mjs never allows beyond the policy', async () => {
  const entries = ['https://a.example.com', 'https://a.example.com:443', 'https://a.example.com:8443', 'https://a.example.com:*', 'http://a.example.com', 'https://*.example.com', 'https://*.a.example.com', 'https://*', '*://a.example.com', '*://a.example.com:8443', '*://*', '*://*:*', 'ws://a.example.com', 'foo://a.example.com'];
  const urls = ['https://a.example.com', 'https://a.example.com:443', 'https://a.example.com:8443', 'http://a.example.com', 'http://a.example.com:443', 'https://b.a.example.com', 'https://example.com', 'https://other.org', 'ws://a.example.com', 'wss://a.example.com', 'foo://a.example.com', 'foo://a.example.com:8443'];
  const grant = (allow) => grantOf(parseCapabilities(file({ default: { 'allow-outbound-hosts': [allow] } })));
  let admitted = 0;
  for (const outer of entries) {
    for (const inner of entries) {
      const attempt = networksOver(null, { capabilities: { 'allow-outbound-hosts': [outer] } }).networks.create('api', { hosts: [inner] });
      const ok = await attempt.then(() => true, (error) => {
        assert.ok(refusedAs('policy')(error), error.message);
        return false;
      });
      if (inner === outer) assert.ok(ok, `${inner} is within itself`);
      if (!ok) continue;
      admitted += 1;
      for (const url of urls) if (grant(inner).allows('outbound-hosts', url)) assert.ok(grant(outer).allows('outbound-hosts', url), `${inner} within ${outer}, but ${url} escapes`);
    }
  }
  assert.ok(admitted > entries.length);
});

test('connect refuses an image whose declared world imports no outbound hosts, the real reference world among them', async () => {
  const { networks } = networksOver(file({ default: {}, api: { 'allow-outbound-hosts': ['https://example.com'] } }));
  const app = await load(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
  assert.equal(app.world.contract, 'hologram:guest/core-wasm@1');
  await assert.rejects(networks.connect('api', app), (error) => refusedAs('world')(error) && error.details.contract === app.world.contract);
  await assert.rejects(networks.connect('api'), refusedAs('world'));
  const otherKind = { world: { imports: [{ module: 'wasi:keyvalue/store', name: 'open', kind: 'func', capability: 'key-value-stores' }] } };
  await assert.rejects(networks.connect('api', otherKind), refusedAs('world'));
  const namesNoKind = { world: { imports: [{ module: 'wasi:http/outgoing-handler', name: 'handle', kind: 'func' }] } };
  await assert.rejects(networks.connect('api', namesNoKind), refusedAs('world'));
  await assert.rejects(networks.connect('api', { world: { imports: [null] } }), refusedAs('world'));
});

test('connect re-checks the file: a hand edit outside the policy is refused, ahead of the missing host effects', async () => {
  const policy = { capabilities: { 'allow-outbound-hosts': ['https://example.com'] } };
  const { networks } = networksOver(file({ default: {}, edited: { 'allow-outbound-hosts': ['https://elsewhere.org'] } }), policy);
  await assert.rejects(networks.connect('edited', WORLD_WITH_HOSTS), refusedAs('policy'));
});

test('calls that need host effects raise a typed error naming #216 and #217, and never appear to succeed', async () => {
  const { store, networks } = networksOver(file({ default: {}, api: { 'allow-outbound-hosts': ['https://example.com'] }, empty: { 'allow-outbound-hosts': [] } }));
  const unavailable = (verb, network) => (error) => {
    assert.ok(codeIs('networks.unavailable')(error));
    assert.match(error.message, /#216, #217/);
    assert.deepEqual(error.details, { verb, network, dependsOn: ['#216', '#217'] });
    return true;
  };
  await assert.rejects(networks.connect('api', WORLD_WITH_HOSTS), unavailable('connect', 'api'));
  await assert.rejects(networks.connect('empty'), unavailable('connect', 'empty'));
  await assert.rejects(networks.disconnect('api', WORLD_WITH_HOSTS), unavailable('disconnect', 'api'));
  await assert.rejects(networks.disconnect('nope', WORLD_WITH_HOSTS), codeIs('networks.not-found'));
  assert.equal(store.writes, 0);
  const view = await networks.inspect('api');
  assert.equal(view.traffic, false);
  assert.deepEqual(view.dependsOn, ['#216', '#217']);
  for (const row of await networks.list()) assert.equal(row.traffic, false);
});

test('a refusal survives being recorded: #443 can store it as JSON and rebuild the class', async () => {
  const { networks } = networksOver(file({ default: {}, api: { 'allow-outbound-hosts': ['https://example.com'] } }));
  const error = await networks.connect('api', { world: { contract: 'test:pure@1', imports: [] } }).catch((caught) => caught);
  const record = JSON.parse(JSON.stringify({ code: error.code, check: error.check, message: error.message, details: error.details }));
  assert.deepEqual(record.details, { kind: 'outbound-hosts', resource: 'https://example.com', set: 'api', network: 'api', verb: 'connect', outside: 'world', contract: 'test:pure@1' });
  assert.equal(record.code, 'capability_denied');
  assert.equal(classForCheck(record.check), CapabilityDeniedError);
  assert.equal(exitCodeFor(error), 2);
});

test('it never reads or writes a system model', async () => {
  const model = { schema: 'prismpm/system-model/3', networks: [{ id: 'mesh', internal: false }] };
  const { store, networks } = networksOver(model);
  await assert.rejects(networks.list(), codeIs('capabilities.invalid'));
  await assert.rejects(networks.create('mesh'), codeIs('capabilities.invalid'));
  await assert.rejects(networks.connect('mesh', WORLD_WITH_HOSTS), codeIs('capabilities.invalid'));
  assert.equal(store.writes, 0);
  const source = readFileSync(new URL('../src/networks.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /system-model|topology|compose|internal:/i);
  const fresh = networksOver(null);
  await fresh.networks.create('api', { hosts: ['https://example.com'] });
  assert.equal(JSON.parse(fresh.store.text).schema, 'prism/capabilities/1');
});

test('the module imports only errors and the capability code of verify', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
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
  };
  visit(join(src, 'networks.mjs'));
  assert.deepEqual([...seen].map((file) => relative(src, file).replaceAll('\\', '/')).sort(), ['capabilities.mjs', 'errors.mjs', 'networks.mjs']);
});

test('the codes it raises are exactly its rows of model/sdk-diagnostics.toml', () => {
  const register = readFileSync(new URL('../../../../model/sdk-diagnostics.toml', import.meta.url), 'utf8');
  const rows = [...register.matchAll(/^code = "(networks\.[^"]+)"\s*$/gm)].map((match) => match[1]);
  const source = readFileSync(new URL('../src/networks.mjs', import.meta.url), 'utf8');
  const raised = new Set([...source.matchAll(/\bfail\(\s*'(networks\.[^']+)'/g)].map((match) => match[1]));
  assert.deepEqual([...raised].sort(), rows);
});
