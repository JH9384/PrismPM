import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityDeniedError } from 'prism-code';
import { createMockHost, referenceArchive, TestSetupError, UnexpectedCallError } from '../src/index.mjs';

const CAPABILITIES = {
  schema: 'prism/capabilities/1',
  sets: {
    default: { 'allow-outbound-hosts': ['https://api.example.com'], 'allow-key-value-stores': ['cache'], 'allow-variables': ['region'], 'deny-variables': ['secret'] },
    wide: { 'allow-variables': ['*'] },
  },
};

test('with no capability file nothing is granted, as in load', async () => {
  const host = createMockHost();
  await assert.rejects(host.fetch('https://api.example.com/'), (e) => e instanceof CapabilityDeniedError && e.check === 'capabilities.outbound-hosts');
  assert.throws(() => host.kv('cache'), (e) => e.check === 'capabilities.key-value-stores');
  assert.throws(() => host.variable('region'), (e) => e.check === 'capabilities.variables');
  assert.equal(host.capabilities.set, null);
});

test('fetch answers a granted URL from its stub and refuses one the test did not stub', async () => {
  const host = createMockHost({
    capabilities: CAPABILITIES,
    fetch: { 'https://api.example.com/rate': { status: 201, headers: { etag: 'x' }, body: '1.25' }, 'https://api.example.com/echo': (url, init) => `${init.method}:${url}` },
  });
  const rate = await host.fetch('https://api.example.com/rate');
  assert.deepEqual([rate.status, rate.ok, rate.text(), rate.headers.etag], [201, true, '1.25', 'x']);
  assert.equal((await host.fetch('https://api.example.com/echo', { method: 'POST' })).text(), 'POST:https://api.example.com/echo');
  await assert.rejects(host.fetch('https://api.example.com/other'), UnexpectedCallError);
  // A stub for a host the grant does not allow is still denied: a test cannot grant what production would not.
  const denied = createMockHost({ capabilities: CAPABILITIES, fetch: { 'https://evil.example.net/': 'x' } });
  await assert.rejects(denied.fetch('https://evil.example.net/'), CapabilityDeniedError);
});

test('key-value stores and variables follow the grant, including deny entries and named sets', () => {
  const host = createMockHost({ capabilities: CAPABILITIES, variables: { region: 'eu', secret: 's' }, stores: { cache: { a: '1' } } });
  const cache = host.kv('cache');
  assert.equal(cache.get('a'), '1');
  cache.set('b', 2);
  assert.deepEqual(cache.keys(), ['a', 'b']);
  assert.equal(cache.delete('a'), true);
  assert.equal(host.kv('cache').get('a'), null);
  assert.throws(() => host.kv('other'), CapabilityDeniedError);
  assert.equal(host.variable('region'), 'eu');
  assert.throws(() => host.variable('secret'), CapabilityDeniedError);
  const wide = createMockHost({ capabilities: CAPABILITIES, capabilitySet: 'wide', variables: { secret: 's' } });
  assert.equal(wide.variable('secret'), 's');
  assert.equal(wide.capabilities.set, 'wide');
});

test('calls records every host call with the clock time it happened at', async () => {
  const host = createMockHost({ capabilities: CAPABILITIES, start: 0, fetch: { 'https://api.example.com/a': '' } });
  host.variable('region');
  await host.clock.advance(250);
  await host.fetch('https://api.example.com/a');
  assert.deepEqual(host.calls, [
    { kind: 'variable', resource: 'region', at: 0 },
    { kind: 'fetch', resource: 'https://api.example.com/a', at: 250 },
  ]);
});

test('an unknown option, a malformed capability file or an unknown set is refused up front', () => {
  assert.throws(() => createMockHost({ clok: 1 }), TestSetupError);
  assert.throws(() => createMockHost({ capabilities: { schema: 'nope' } }), (e) => e.code === 'capabilities.invalid');
  assert.throws(() => createMockHost({ capabilities: CAPABILITIES, capabilitySet: 'missing' }), (e) => e.code === 'capabilities.invalid');
});

test('two hosts with one seed and one start behave identically', async () => {
  const run = async () => {
    const host = createMockHost({ seed: 'run', start: '2027-02-03T04:05:06Z' });
    await host.clock.advance(10);
    return [host.clock.date().toISOString(), host.random.uuid(), host.random.int(1e6)];
  };
  assert.deepEqual(await run(), await run());
});

test('load opens a holo under the host\'s grant and the guest dispatches', async () => {
  const host = createMockHost({ capabilities: CAPABILITIES });
  const calculator = await referenceArchive('Calculator');
  const app = await host.load(await calculator.bytes());
  assert.equal(app.name, 'Calculator');
  assert.equal(app.capabilities.set, 'default');
  assert.equal(app.capabilities.allows('variables', 'region'), true);
  const byPath = await createMockHost().load(calculator.path);
  assert.equal(byPath.capabilities.set, null);
  assert.deepEqual(await byPath.acceptance(), { total: 22, passed: 22, failed: [] });
});
