// `prism.auth` (#447): login and logout through Docker's stores, signing identities, and the rule that holds over all of
// it: no return value, error or log line holds a secret. Every value here is a test value. It needs no sigstore package, so
// the conformance id runs it whole; what really signs is in auth-signed.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auth, createAuth } from '../src/auth.mjs';
import { RegistryAuthError, RegistryError, SigningError } from '../src/errors.mjs';
import { dockerCredentials } from '../src/oci-auth.mjs';
import { createRegistryClient } from '../src/oci-registry.mjs';
import { experimental_push } from '../src/push-pull.mjs';
import { startRegistry } from './support/registry.mjs';
import { assertHidden, refusalOf } from './support/secrets.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const plain = new Uint8Array(readFileSync(here('../fixtures/Calculator.holo')));
const root = mkdtempSync(join(tmpdir(), 'prism-auth-'));
test.after(() => rmSync(root, { recursive: true, force: true }));

const USERNAME = 'test-user';
const PASSWORD = 'test-password-0f3a9c';
const BASIC = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');

const assertClean = (value, secrets = [PASSWORD, BASIC]) => assertHidden(value, secrets);
const refusal = (promise, Class, check, secrets = [PASSWORD, BASIC]) => refusalOf(promise, Class, check, secrets);

let directories = 0;
function config(contents) {
  const directory = join(root, `config-${directories++}`);
  mkdirSync(directory, { recursive: true });
  if (contents !== undefined) writeFileSync(join(directory, 'config.json'), typeof contents === 'string' ? contents : JSON.stringify(contents));
  const env = { DOCKER_CONFIG: directory, PATH: '' };
  return { env, path: join(directory, 'config.json'), read: () => JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')), text: () => readFileSync(join(directory, 'config.json'), 'utf8') };
}

/** A credential helper the spawn in oci-auth.mjs can run on this platform. */
const bins = (() => {
  const directory = join(root, 'bin');
  mkdirSync(directory, { recursive: true });
  const script = here('./support/credential-helper.cjs');
  if (process.platform === 'win32') copyFileSync(process.execPath, join(directory, 'docker-credential-fake.exe'));
  else {
    writeFileSync(join(directory, 'docker-credential-fake'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(join(directory, 'docker-credential-fake'), 0o755);
  }
  return { directory, env: process.platform === 'win32' ? { NODE_OPTIONS: `--require "${script.replace(/\\/g, '/')}"`, SystemRoot: process.env.SystemRoot } : {} };
})();

function helperConfig(contents, mode) {
  const made = config(contents);
  const state = join(made.env.DOCKER_CONFIG, 'helper-state.json');
  Object.assign(made.env, bins.env, { PATH: `${bins.directory}${delimiter}${process.env.PATH}`, FAKE_HELPER_STATE: state, ...(mode ? { FAKE_HELPER_MODE: mode } : {}) });
  return { ...made, helperState: () => JSON.parse(readFileSync(state, 'utf8')) };
}

// --- login and logout

test('login writes the entry Docker writes, keeps the rest of the config, and dockerCredentials reads it back', async () => {
  const made = config({ HttpHeaders: { 'X-Test': '1' }, auths: { 'other.test': { auth: 'b3RoZXI6b3RoZXI=' } } });
  const result = await createAuth({ env: made.env }).login({ username: USERNAME, password: PASSWORD, registry: 'registry.test' });
  assert.deepEqual(result, { registry: 'registry.test', username: USERNAME, store: { kind: 'config', path: made.path }, verified: false });
  assertClean(result);
  const written = made.read();
  assert.deepEqual(written.HttpHeaders, { 'X-Test': '1' });
  assert.equal(written.auths['registry.test'].auth, BASIC);
  assert.equal(written.auths['other.test'].auth, 'b3RoZXI6b3RoZXI=');
  assert.deepEqual(await dockerCredentials('registry.test', { env: made.env }), { username: USERNAME, password: PASSWORD });
  if (process.platform !== 'win32') assert.equal(statSync(made.path).mode & 0o777, 0o600);
});

test('login creates the config when there is none, replaces older spellings, and defaults to Docker Hub as docker-py does', async () => {
  const made = config({ auths: { 'https://registry.test': { auth: Buffer.from('old:old').toString('base64') }, 'registry.test': { identitytoken: 'old-token' } } });
  const prism = createAuth({ env: made.env });
  await prism.login({ username: USERNAME, password: PASSWORD, registry: 'registry.test' });
  assert.deepEqual(Object.keys(made.read().auths), ['registry.test']);
  assert.deepEqual(await dockerCredentials('registry.test', { env: made.env }), { username: USERNAME, password: PASSWORD });

  const fresh = config();
  rmSync(fresh.env.DOCKER_CONFIG, { recursive: true });
  const hub = await createAuth({ env: fresh.env }).login({ username: USERNAME, password: PASSWORD });
  assert.equal(hub.registry, 'docker.io');
  assert.equal(fresh.read().auths['https://index.docker.io/v1/'].auth, BASIC);
  assert.equal((await dockerCredentials('docker.io', { env: fresh.env })).username, USERNAME);
});

test('logout removes every spelling, says whether anything was there, and leaves the rest', async () => {
  const made = config({ proxies: { default: {} }, auths: { 'registry.test': { auth: BASIC }, 'https://registry.test/v1/': { auth: BASIC }, 'other.test': { auth: BASIC } } });
  const prism = createAuth({ env: made.env });
  const result = await prism.logout({ registry: 'registry.test' });
  assert.deepEqual(result, { registry: 'registry.test', removed: true, ambient: null });
  assert.deepEqual(Object.keys(made.read().auths), ['other.test']);
  assert.deepEqual(made.read().proxies, { default: {} });
  assert.equal(await dockerCredentials('registry.test', { env: made.env }), null);
  assert.deepEqual(await prism.logout({ registry: 'registry.test' }), { registry: 'registry.test', removed: false, ambient: null });
});

test('logout says when an ambient token still answers for ghcr.io, and never quotes it', async () => {
  const made = config({ auths: { 'ghcr.io': { auth: BASIC } } });
  const env = { ...made.env, GHCR_TOKEN: 'ambient-token-7e21' };
  const prism = createAuth({ env });
  assert.equal((await prism.inspect('ghcr.io')).store.kind, 'config');
  const result = await prism.logout({ registry: 'ghcr.io' });
  assert.deepEqual(result, { registry: 'ghcr.io', removed: true, ambient: 'GHCR_TOKEN' });
  const seen = await prism.inspect('ghcr.io');
  assert.deepEqual(seen, { registry: 'ghcr.io', type: 'password', username: 'x-access-token', store: { kind: 'environment', variable: 'GHCR_TOKEN' } });
  for (const value of [result, seen, await prism.stores.list()]) assertClean(value, ['ambient-token-7e21']);
});

test('a config that does not parse is refused and left as it is, and its text is not quoted', async () => {
  const text = `{"auths":{"registry.test":{"password":"${PASSWORD}"`;
  const made = config(text);
  const prism = createAuth({ env: made.env });
  await refusal(prism.login({ username: USERNAME, password: 'test-other-password', registry: 'registry.test' }), RegistryError, 'store.credentials', [PASSWORD, 'test-other-password']);
  await refusal(prism.logout({ registry: 'registry.test' }), RegistryError, 'store.credentials');
  assert.equal(made.text(), text);
  await refusal(createAuth({ env: config('[]').env }).login({ username: USERNAME, password: PASSWORD, registry: 'registry.test' }), RegistryError, 'store.credentials');
});

test('what login cannot store is refused before anything is written, and the value is not quoted', async () => {
  const made = config();
  const prism = createAuth({ env: made.env });
  const refused = (request) => refusal(prism.login(request), RegistryError, 'store.credential-input');
  await refused({ username: USERNAME, registry: 'registry.test' });
  await refused({ username: USERNAME, password: '', registry: 'registry.test' });
  await refused({ username: USERNAME, password: 12345, registry: 'registry.test' });
  await refused({ username: 'with:colon', password: PASSWORD, registry: 'registry.test' });
  await refused({ username: '<token>', password: PASSWORD, registry: 'registry.test' });
  await refused({ username: USERNAME, password: PASSWORD, registry: PASSWORD + '/path' });
  await refused({ username: USERNAME, password: PASSWORD, registry: 'https://registry.test' });
  await refused(null);
  await refusal(prism.login(USERNAME, PASSWORD), RegistryError, 'store.credential-input');
  await refusal(prism.logout({ registry: PASSWORD + '/path' }), RegistryError, 'store.credential-input');
  await refusal(prism.inspect(PASSWORD + '/path'), RegistryError, 'store.credential-input');
  assert.throws(() => readFileSync(made.path));
  assert.ok((await prism.login({ username: USERNAME, password: PASSWORD, registry: '[::1]:5000' })).store);
  assert.ok((await prism.login({ username: USERNAME, password: PASSWORD, registry: 'localhost:5000' })).store);
});

// --- credential helpers

test('login goes through the helper Docker would use and writes no secret to the config', async () => {
  const scoped = helperConfig({ credHelpers: { 'registry.test': 'fake' }, auths: {} });
  const prism = createAuth({ env: scoped.env });
  assert.deepEqual(await prism.stores.get('registry.test'), { kind: 'helper', name: 'fake' });
  assert.deepEqual(await prism.stores.get('other.test'), { kind: 'config', path: scoped.path });
  const result = await prism.login({ username: USERNAME, password: PASSWORD, registry: 'registry.test' });
  assert.deepEqual(result.store, { kind: 'helper', name: 'fake' });
  assert.deepEqual(scoped.helperState()['registry.test'], { Username: USERNAME, Secret: PASSWORD });
  assert.deepEqual(await dockerCredentials('registry.test', { env: scoped.env }), { username: USERNAME, password: PASSWORD });
  assert.deepEqual(await prism.inspect('registry.test'), { registry: 'registry.test', type: 'password', username: USERNAME, store: { kind: 'helper', name: 'fake' } });
  assert.equal(scoped.text().includes(PASSWORD), false);
  assert.equal(scoped.text().includes(BASIC), false);
  assert.deepEqual(await prism.logout({ registry: 'registry.test' }), { registry: 'registry.test', removed: true, ambient: null });
  assert.deepEqual(scoped.helperState(), {});
  assert.equal(await dockerCredentials('registry.test', { env: scoped.env }), null);
});

test('with a default helper, an old entry in auths cannot shadow the login, and logout clears both', async () => {
  const made = helperConfig({ credsStore: 'fake', auths: { 'registry.test': { auth: Buffer.from('old:old').toString('base64') } } });
  const prism = createAuth({ env: made.env });
  await prism.login({ username: USERNAME, password: PASSWORD, registry: 'registry.test' });
  assert.equal(made.read().auths['registry.test'], undefined);
  assert.deepEqual(await dockerCredentials('registry.test', { env: made.env }), { username: USERNAME, password: PASSWORD });
  assert.deepEqual(await prism.stores.list(), [{ kind: 'config', path: made.path }, { kind: 'helper', name: 'fake', registries: null }]);
  assert.equal((await prism.logout({ registry: 'registry.test' })).removed, true);
  assert.equal(await dockerCredentials('registry.test', { env: made.env }), null);
});

test('a helper that refuses and prints the secret is a typed error with no secret in it', async () => {
  const made = helperConfig({ credsStore: 'fake' }, 'noisy-store');
  await refusal(createAuth({ env: made.env }).login({ username: USERNAME, password: PASSWORD, registry: 'registry.test' }), RegistryError, 'store.credentials');
  assert.deepEqual(made.helperState(), { refused: true });
});

test('a helper that is not installed is a refused login, not a success', async () => {
  const made = config({ credsStore: 'no-such-helper' });
  await refusal(createAuth({ env: made.env }).login({ username: USERNAME, password: PASSWORD, registry: 'registry.test' }), RegistryError, 'store.credentials');
});

test('a helper that is not installed does not hold the process open', async () => {
  const made = config({ credsStore: 'no-such-helper' });
  const script = `
    import { createAuth } from ${JSON.stringify(new URL('../src/auth.mjs', import.meta.url).href)};
    import { dockerCredentials } from ${JSON.stringify(new URL('../src/oci-auth.mjs', import.meta.url).href)};
    const env = ${JSON.stringify(made.env)};
    const auth = createAuth({ env });
    await auth.login({ username: 'u', password: 'p', registry: 'registry.test' }).catch(() => {});
    await auth.logout({ registry: 'registry.test' });
    await dockerCredentials('registry.test', { env });
  `;
  const started = Date.now();
  await new Promise((resolve, reject) => {
    execFile(process.execPath, ['--input-type=module', '-e', script], { timeout: 25000 }, (error) => (error ? reject(error) : resolve()));
  });
  assert.ok(Date.now() - started < 20000, 'it waited for the helper timeout');
});

test('a helper that says it erased and did not fails the logout: logout never appears to work', async () => {
  const made = helperConfig({ credsStore: 'fake' });
  await createAuth({ env: made.env }).login({ username: USERNAME, password: PASSWORD, registry: 'registry.test' });
  const stuck = { ...made.env, FAKE_HELPER_MODE: 'stuck-erase' };
  await refusal(createAuth({ env: stuck }).logout({ registry: 'registry.test' }), RegistryError, 'store.credentials');
});

// --- checking a login against a registry, which the caller supplies

const askRegistry = (registry, credential) => createRegistryClient({ registry, repository: 'a/b' }, { resolveCredentials: () => credential }).hasBlob(`sha256:${'0'.repeat(64)}`);

test('login, push and logout against a registry: a wrong password stores nothing, and push finds what login stored', async () => {
  const registry = await startRegistry({ auth: 'bearer', username: USERNAME, password: PASSWORD });
  try {
    const made = config();
    const prism = createAuth({ env: made.env, checkCredential: askRegistry });
    const reference = `${registry.host}/a/b:v1`;
    const wrong = await refusal(prism.login({ username: USERNAME, password: 'test-wrong-password', registry: registry.host }), RegistryAuthError, 'registry.auth', ['test-wrong-password']);
    assert.equal(wrong.code, 'registry_auth_failed');
    assert.throws(() => readFileSync(made.path));

    const result = await prism.login({ username: USERNAME, password: PASSWORD, registry: registry.host });
    assert.equal(result.verified, true);
    assert.equal((await experimental_push(plain, reference, { env: made.env })).tags[0], 'v1');

    await prism.logout({ registry: registry.host });
    await assert.rejects(experimental_push(plain, `${registry.host}/a/b:v2`, { env: made.env }), RegistryAuthError);
  } finally {
    await registry.close();
  }
});

test('a check that throws anything, quoting the secret, is a typed error with the secret replaced', async () => {
  const made = config();
  const check = (thrown) => createAuth({ env: made.env, checkCredential: async () => { throw thrown; } }).login({ username: USERNAME, password: PASSWORD, registry: 'registry.test' });
  const untyped = await refusal(check(new Error(`refused ${PASSWORD} and Basic ${BASIC}`, { cause: new Error(PASSWORD) })), RegistryAuthError, 'registry.auth');
  assert.match(untyped.message, /refused \[redacted\] and Basic \[redacted\]/);
  await refusal(check(`refused ${PASSWORD}`), RegistryAuthError, 'registry.auth');
  const typed = await refusal(check(new RegistryAuthError(`no ${PASSWORD}`, { check: 'registry.denied', details: { sent: [PASSWORD], [PASSWORD]: 1 }, cause: new Error(PASSWORD) })), RegistryAuthError, 'registry.denied');
  assert.deepEqual(typed.details, { sent: ['[redacted]'], '[redacted]': 1 });
  assert.throws(() => readFileSync(made.path));
});

// --- signing identities

const keys = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });

test('an identity shows its kind and public facts and nothing of its key or token', () => {
  const { privateKey, publicKey } = keys();
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const body = pem.split('\n').filter((line) => line && !line.startsWith('-----'));
  for (const key of [pem, Buffer.from(pem), privateKey]) {
    const identity = auth.identities.fromKey(key);
    assert.equal(identity.kind, 'key');
    assert.equal(identity.publicKey, publicKey.export({ type: 'spki', format: 'pem' }));
    assert.ok(Object.isFrozen(identity));
    assertClean(identity, body);
  }
  const token = 'test-identity-token-a4b7c2';
  const keyless = auth.identities.keyless({ identityToken: token });
  assert.equal(keyless.kind, 'keyless');
  assert.equal(keyless.ambient, false);
  assertClean(keyless, [token]);
  assert.throws(() => auth.identities.keyless({ identityToken: '' }), (e) => e instanceof SigningError && e.check === 'sign.identity');
  assert.equal(auth.identities.keyless().ambient, true);
});

test('a key that cannot be read is sign.key, and what was passed is not quoted', async () => {
  const { publicKey } = keys();
  const marker = 'test-not-a-key-5d1c8e';
  const refused = [marker, `-----BEGIN PRIVATE KEY-----\n${marker}\n-----END PRIVATE KEY-----\n`, 12345, null, undefined, { key: marker, format: marker }, publicKey, publicKey.export({ type: 'spki', format: 'pem' })];
  for (const key of refused) {
    assert.throws(
      () => auth.identities.fromKey(key),
      (error) => {
        assert.ok(error instanceof SigningError);
        assert.equal(error.check, 'sign.key');
        assert.equal(error.cause, undefined);
        assertClean(error, [marker]);
        return true;
      },
    );
  }
});

test('sign takes statement bytes and nothing else', async () => {
  const identity = auth.identities.fromKey(keys().privateKey);
  await refusal(identity.sign('a string'), SigningError, 'sign.predicate');
});

// --- nothing logged, and the module's boundary

test('nothing reaches stdout or stderr, even from a helper that prints the secret', async () => {
  const noisy = helperConfig({ credsStore: 'fake' }, 'noisy-store');
  const quiet = helperConfig({ credsStore: 'fake' });
  const script = `
    import { createAuth } from ${JSON.stringify(new URL('../src/auth.mjs', import.meta.url).href)};
    const request = { username: ${JSON.stringify(USERNAME)}, password: ${JSON.stringify(PASSWORD)}, registry: 'registry.test' };
    const noisy = createAuth({ env: ${JSON.stringify(noisy.env)} });
    const quiet = createAuth({ env: ${JSON.stringify(quiet.env)} });
    const swallow = (promise) => promise.catch(() => {});
    await swallow(noisy.login(request));
    await swallow(quiet.login(request));
    await swallow(quiet.inspect('registry.test'));
    await swallow(quiet.stores.list());
    await swallow(quiet.logout({ registry: 'registry.test' }));
    await swallow(quiet.identities.keyless({ identityToken: ${JSON.stringify(PASSWORD)}, signingConfig: { caUrls: [] } }).sign(new Uint8Array(1)));
  `;
  const { stdout, stderr } = await new Promise((resolve, reject) => {
    execFile(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }, (error, out, err) => (error ? reject(error) : resolve({ stdout: out, stderr: err })));
  });
  assert.equal(stdout, '');
  assert.equal(stderr, '');
  assert.deepEqual(noisy.helperState(), { refused: true });
});

test('the namespace is what #440 names: it logs in, holds stores and identities, and has no trust decision to make', () => {
  assert.deepEqual(Object.keys(auth).sort(), ['identities', 'inspect', 'login', 'logout', 'stores']);
  assert.deepEqual(Object.keys(auth.stores).sort(), ['get', 'list']);
  assert.deepEqual(Object.keys(auth.identities).sort(), ['from', 'fromKey', 'keyless']);
  assert.deepEqual(Object.keys(auth.identities.fromKey(keys().privateKey)).sort(), ['keyId', 'kind', 'publicKey', 'sign']);
  assert.deepEqual(Object.keys(auth.identities.keyless()).sort(), ['ambient', 'kind', 'sign']);
  for (const frozen of [auth, auth.stores, auth.identities]) assert.ok(Object.isFrozen(frozen));
});

test('it depends only on errors and its own code: oci-auth.mjs and signing.mjs', () => {
  const source = readFileSync(here('../src/auth.mjs'), 'utf8');
  const imported = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(imported, ['./errors.mjs', './oci-auth.mjs', './signing.mjs', 'node:crypto']);
  assert.deepEqual([...source.matchAll(/await import\('([^']+)'\)/g)], []);
  for (const file of ['oci-auth.mjs', 'signing.mjs']) {
    const owned = readFileSync(here(`../src/${file}`), 'utf8');
    assert.deepEqual([...owned.matchAll(/^import .* from '(\.[^']+)';$/gm)].map((match) => match[1]), ['./errors.mjs'], file);
  }
});

test('every signature in prism-code is made through an auth identity: only auth.mjs imports signing.mjs', () => {
  const src = here('../src');
  const importers = readdirSync(src).filter((file) => file.endsWith('.mjs') && /from '\.\/signing\.mjs'|import\('\.\/signing\.mjs'\)/.test(readFileSync(join(src, file), 'utf8')));
  assert.deepEqual(importers, ['auth.mjs']);
});

test('identities.from turns the flat signer options attest and push take into one identity', () => {
  const { privateKey } = keys();
  assert.equal(auth.identities.from({ key: privateKey }).kind, 'key');
  assert.equal(auth.identities.from({ key: privateKey }).keyId, auth.identities.fromKey(privateKey).keyId);
  const keyless = auth.identities.from({ identityToken: 'a.b.c' });
  assert.equal(keyless.kind, 'keyless');
  assert.equal(keyless.ambient, false);
  assert.equal(auth.identities.from({}).ambient, true);
  assert.equal(auth.identities.from(undefined).kind, 'keyless');
});
