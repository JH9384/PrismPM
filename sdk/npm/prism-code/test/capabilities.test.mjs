// Capability sets, deny by default (issue #279, docs/proposals/279-capability-sets.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  load,
  parseCapabilities,
  grantOf,
  compileGuest,
  CapabilityDeniedError,
  PrismCodeError,
  PrismError,
  classForCheck,
  CAPABILITY_KINDS,
} from '../src/index.mjs';
import { fromFile } from '../src/node.mjs';
import { reference, referenceGuest, wasmSections, assembleWasm, withGuest } from '../../verify/test/helpers.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const SPEC_FIXTURES = fileURLToPath(new URL('../../spec/test/fixtures/capabilities/capabilities-v1/', import.meta.url));

const file = (sets) => ({ schema: 'prism/capabilities/1', sets });
const grant = (set, name = 'default') => grantOf(parseCapabilities(file({ default: {}, ...set })), name);
const SAMPLES = { 'outbound-hosts': 'https://api.example.com', 'key-value-stores': 'default', variables: 'api_token' };

/**
 * The reference archive whose guest also imports a table, env.host. A table
 * import shifts no function or global index, so the guest still compiles and
 * the import is the only thing the runtime can refuse.
 */
function importGuest() {
  const sections = wasmSections(referenceGuest());
  const name = (text) => [text.length, ...new TextEncoder().encode(text)];
  const payload = Uint8Array.from([1, ...name('env'), ...name('host'), 1, 0x70, 0, 0]);
  sections.splice(sections.findIndex((s) => s.id === 1) + 1, 0, { id: 2, payload });
  return withGuest(assembleWasm(sections));
}

function invalid(source, pattern) {
  assert.throws(
    () => parseCapabilities(source),
    (error) => error instanceof PrismCodeError && error.code === 'capabilities.invalid' && pattern.test(error.message),
  );
}

test('no capability file grants nothing, and the reference holo still loads and runs', async () => {
  const app = await load(reference());
  assert.equal(app.capabilities.set, null);
  for (const kind of CAPABILITY_KINDS) {
    assert.equal(app.capabilities.allows(kind, SAMPLES[kind]), false, kind);
    assert.equal(app.capabilities.allows(kind, '*'), false, kind);
  }
  const result = await app.acceptance();
  assert.equal(result.passed, result.total);
});

test('an empty default set and a deny-only default set grant nothing', () => {
  for (const set of [{}, { 'deny-outbound-hosts': ['*://*:*'], 'deny-variables': ['*'] }]) {
    const g = grantOf(parseCapabilities(file({ default: set })));
    assert.equal(g.set, 'default');
    for (const kind of CAPABILITY_KINDS) assert.equal(g.allows(kind, SAMPLES[kind]), false, kind);
  }
});

test('allow grants exactly what it names, for each kind', () => {
  const g = grant({ default: { 'allow-outbound-hosts': ['https://api.example.com'], 'allow-key-value-stores': ['default'], 'allow-variables': ['api_token'] } });
  for (const kind of CAPABILITY_KINDS) assert.equal(g.allows(kind, SAMPLES[kind]), true, kind);
  assert.equal(g.allows('key-value-stores', 'cache'), false);
  assert.equal(g.allows('variables', 'api_token2'), false);
  assert.equal(g.allows('outbound-hosts', 'https://api.example.com/v1/items?q=1'), true, 'the path is ignored');
  assert.equal(g.allows('outbound-hosts', 'https://API.example.com:443'), true, 'an explicit default port and upper-case host match');
  assert.equal(g.allows('outbound-hosts', 'http://api.example.com'), false, 'another scheme');
  assert.equal(g.allows('outbound-hosts', 'https://api.example.com:8443'), false, 'no port in the entry means the default port only');
  assert.equal(g.allows('outbound-hosts', 'https://evil.api.example.com'), false, 'no subdomains without *.');
  assert.equal(g.allows('outbound-hosts', 'not a url'), false);
});

test('host wildcards: *. subdomains, port *, scheme * and host *', () => {
  const g = grant({ default: { 'allow-outbound-hosts': ['https://*.example.com', 'http://localhost:*', '*://cdn.example.org'] } });
  assert.equal(g.allows('outbound-hosts', 'https://a.example.com'), true);
  assert.equal(g.allows('outbound-hosts', 'https://a.b.example.com'), true);
  assert.equal(g.allows('outbound-hosts', 'https://example.com'), false, '*.example.com does not match example.com');
  assert.equal(g.allows('outbound-hosts', 'https://badexample.com'), false);
  assert.equal(g.allows('outbound-hosts', 'http://localhost:3000'), true);
  assert.equal(g.allows('outbound-hosts', 'http://localhost'), true);
  assert.equal(g.allows('outbound-hosts', 'wss://cdn.example.org'), true);
  assert.equal(g.allows('outbound-hosts', 'wss://cdn.example.org:9000'), false);
  const any = grant({ default: { 'allow-outbound-hosts': ['*://*:*'] } });
  assert.equal(any.allows('outbound-hosts', 'ftp://files.example.net:21'), true);
});

test('deny wins over allow, including a specific deny under a wildcard allow', () => {
  const g = grant({
    default: {
      'allow-outbound-hosts': ['https://*.cdn.example.com:8443'],
      'deny-outbound-hosts': ['https://admin.cdn.example.com:8443'],
      'allow-key-value-stores': ['*'],
      'deny-key-value-stores': ['secrets'],
      'allow-variables': ['*'],
      'deny-variables': ['signing_key'],
    },
  });
  assert.equal(g.allows('outbound-hosts', 'https://img.cdn.example.com:8443'), true);
  assert.equal(g.allows('outbound-hosts', 'https://admin.cdn.example.com:8443'), false);
  assert.equal(g.allows('key-value-stores', 'default'), true);
  assert.equal(g.allows('key-value-stores', 'secrets'), false);
  assert.equal(g.allows('variables', 'api_token'), true);
  assert.equal(g.allows('variables', 'signing_key'), false);
  const same = grant({ default: { 'allow-variables': ['api_token'], 'deny-variables': ['api_token'] } });
  assert.equal(same.allows('variables', 'api_token'), false, 'the same entry on both lists is denied');
});

test('a named set applies only when asked for, and a missing set is an error, never an empty grant', async () => {
  const caps = file({ default: {}, online: { 'allow-outbound-hosts': ['https://api.example.com'] } });
  assert.equal(grantOf(parseCapabilities(caps)).allows('outbound-hosts', SAMPLES['outbound-hosts']), false);
  const online = await load(reference(), { capabilities: caps, capabilitySet: 'online' });
  assert.equal(online.capabilities.set, 'online');
  assert.equal(online.capabilities.allows('outbound-hosts', SAMPLES['outbound-hosts']), true);
  await assert.rejects(load(reference(), { capabilities: caps, capabilitySet: 'offline' }), (e) => e instanceof PrismCodeError && e.code === 'capabilities.invalid' && /no set offline/.test(e.message));
  await assert.rejects(load(reference(), { capabilitySet: 'online' }), (e) => e.code === 'capabilities.invalid' && /no capability file/.test(e.message));
});

test('unknown members, a missing default and malformed entries are rejected', () => {
  invalid({ ...file({ default: {} }), permissions: [] }, /unknown member permissions/);
  invalid(file({ default: { 'allow-outbound-host': ['https://api.example.com'] } }), /unknown member allow-outbound-host/);
  invalid(file({ online: {} }), /no default set/);
  invalid({ schema: 'prism/capabilities/2', sets: { default: {} } }, /schema must be prism\/capabilities\/1/);
  invalid(file({ default: {}, 'Web Client': {} }), /set name/);
  invalid(file({ default: { 'allow-outbound-hosts': ['api.example.com/v1'] } }), /malformed entry/);
  invalid(file({ default: { 'allow-outbound-hosts': ['https://API.example.com'] } }), /malformed entry/);
  invalid(file({ default: { 'allow-variables': ['API_TOKEN'] } }), /malformed entry/);
  invalid(file({ default: { 'allow-key-value-stores': ['default', 'default'] } }), /repeats/);
  invalid(file({ default: { 'allow-variables': 'api_token' } }), /must be an array/);
  invalid('{"schema":', /not JSON/);
  invalid([], /JSON object/);
});

test('the schema in @prism-code/spec and parseCapabilities agree on every fixture', () => {
  const valid = readdirSync(SPEC_FIXTURES).filter((f) => f.endsWith('.json'));
  const rejected = readdirSync(join(SPEC_FIXTURES, 'invalid')).filter((f) => f.endsWith('.json'));
  assert.ok(valid.length >= 2 && rejected.length >= 5);
  for (const name of valid) parseCapabilities(readFileSync(join(SPEC_FIXTURES, name)));
  for (const name of rejected) {
    assert.throws(() => parseCapabilities(readFileSync(join(SPEC_FIXTURES, 'invalid', name))), (e) => e.code === 'capabilities.invalid', name);
  }
});

test('assert throws CapabilityDeniedError with its code, check and details', () => {
  const g = grant({ default: { 'allow-variables': ['*'], 'deny-variables': ['signing_key'] } });
  g.assert('variables', 'api_token');
  assert.throws(
    () => g.assert('variables', 'signing_key'),
    (error) => {
      assert.ok(error instanceof CapabilityDeniedError);
      assert.ok(error instanceof PrismError);
      assert.equal(error.code, 'capability_denied');
      assert.equal(error.check, 'capabilities.variables');
      assert.deepEqual(error.details, { kind: 'variables', resource: 'signing_key', set: 'default' });
      assert.match(error.message, /denied by capability set default/);
      return true;
    },
  );
  assert.throws(() => grantOf(null).assert('outbound-hosts', 'https://api.example.com'), (e) => e instanceof CapabilityDeniedError && /no capability file grants anything/.test(e.message));
  assert.throws(() => g.allows('sockets', 'x'), (e) => e instanceof PrismCodeError && e.code === 'capabilities.kind');
  for (const check of ['capabilities.import', 'capabilities.outbound-hosts', 'capabilities.key-value-stores', 'capabilities.variables']) {
    assert.equal(classForCheck(check), CapabilityDeniedError, check);
  }
});

test('a guest import is denied at load, with or without a capability file', async () => {
  const everything = file({ default: { 'allow-outbound-hosts': ['*://*:*'], 'allow-key-value-stores': ['*'], 'allow-variables': ['*'] } });
  for (const options of [{}, { capabilities: everything }]) {
    await assert.rejects(load(importGuest(), options), (error) => {
      assert.ok(error instanceof CapabilityDeniedError);
      assert.equal(error.check, 'capabilities.import');
      assert.deepEqual(error.details.import, { module: 'env', name: 'host', kind: 'table' });
      assert.match(error.message, /lists no imports/);
      return true;
    });
  }
  await compileGuest(referenceGuest(), grantOf(null));
});

test('fromFile reads a capability file by path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-code-capabilities-'));
  const path = join(dir, 'caps.json');
  writeFileSync(path, JSON.stringify(file({ default: { 'allow-key-value-stores': ['default'] } })));
  const app = await fromFile(fixture, { capabilities: path });
  assert.equal(app.capabilities.allows('key-value-stores', 'default'), true);
  await assert.rejects(fromFile(fixture, { capabilities: join(dir, 'missing.json') }), (e) => e.code === 'capabilities.path');
});

const P0_POLICY = join(mkdtempSync(join(tmpdir(), 'prism-code-p0-')), 'p0.json');
writeFileSync(P0_POLICY, JSON.stringify({ minimum: 'P0' }));

/** Start `prism-code run`, collect its first two lines, then stop it. */
function runServer(args) {
  return new Promise((resolve, reject) => {
    // run gates on check (#282) and every holo is P0 today; this test is about the grant, so it runs under a P0 policy.
    const child = spawn(process.execPath, [bin, 'run', '--policy', P0_POLICY, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.split('\n').length > 2) child.kill();
    });
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}

test('prism-code run says what it grants; a bad file or a denied import exits 2', async () => {
  const none = await runServer([fixture]);
  assert.match(none.out, /^Calculator \(holo\) at http:\/\/127\.0\.0\.1:\d+\/\ncapabilities: none granted\n/);
  const dir = mkdtempSync(join(tmpdir(), 'prism-code-run-'));
  const caps = join(dir, 'caps.json');
  writeFileSync(caps, JSON.stringify(file({ default: {}, online: { 'allow-outbound-hosts': ['https://api.example.com'] } })));
  const online = await runServer([fixture, '--capabilities', caps, '--capability-set', 'online']);
  assert.match(online.out, /\ncapabilities: set online of .*caps\.json\n/);

  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify(file({ default: { 'allow-outbound-host': [] } })));
  const refused = spawnSync(process.execPath, [bin, 'run', fixture, '--policy', P0_POLICY, '--capabilities', bad], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /^capabilities\.invalid: set default has an unknown member allow-outbound-host/);

  const holo = join(dir, 'import.holo');
  writeFileSync(holo, importGuest());
  // The import guest's labels no longer match its provenance, so check fails it; the link refusal is what this asserts.
  const denied = spawnSync(process.execPath, [bin, 'run', holo, '--allow-unverified'], { encoding: 'utf8' });
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /^capability_denied: guest import .* is denied/m);
  assert.match(denied.stderr, /^check: capabilities\.import$/m);

  assert.equal(spawnSync(process.execPath, [bin, 'run', fixture, '--capabilities'], { encoding: 'utf8' }).status, 64);
});
