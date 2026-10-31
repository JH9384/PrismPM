// The registry client against a registry in this process (#292): the referrers API and its fallback, authentication,
// and a registry that lies. A real `distribution` is in oci-live.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAttestations } from '../src/attestations.mjs';
import { DigestMismatchError, ManifestNotFoundError, PullVerificationError, ReferrersUnsupportedError, RegistryAuthError, RegistryError, VerificationError } from '../src/errors.mjs';
import { canonicalBytes, EMPTY_DESCRIPTOR, fingerprintTag, holoManifest, referrersTag } from '../src/oci-manifest.mjs';
import { createRegistryClient, isLoopback, parseChallenge } from '../src/oci-registry.mjs';
import { dockerCredentials } from '../src/oci-auth.mjs';
import { experimental_pull, experimental_push } from '../src/push-pull.mjs';
import { startRegistry } from './support/registry.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const plain = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
const signed = new Uint8Array(readFileSync(new URL('./fixtures/attestation/Calculator.signed.holo', import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'prism-registry-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const NO_CREDENTIALS = { credentials: null };

async function withRegistry(options, run) {
  const registry = await startRegistry(options);
  try {
    return await run(registry);
  } finally {
    await registry.close();
  }
}

function cli(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, DOCKER_CONFIG: join(dir, 'no-docker-config') } }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

test('with the referrers API: the holo and one referrer per line, no fallback tag, and it comes back byte for byte', () =>
  withRegistry({ referrers: 'api' }, async (registry) => {
    const reference = `${registry.host}/prism/calculator:v1`;
    const pushed = await experimental_push(signed, reference, NO_CREDENTIALS);
    const { digest, fingerprint } = await holoManifest(signed);
    assert.equal(pushed.schema, 'prism/push-result/1');
    assert.equal(pushed.digest, digest);
    assert.equal(pushed.fingerprint, fingerprint);
    assert.deepEqual(pushed.tags, ['v1', fingerprintTag(fingerprint)]);
    const lines = readAttestations(signed);
    assert.equal(pushed.referrers.length, lines.length);
    assert.equal(registry.state.tags.has(`prism/calculator:${referrersTag(digest)}`), false);

    const pulled = await experimental_pull(reference, NO_CREDENTIALS);
    assert.ok(same(pulled.holo, signed));
    assert.equal(pulled.schema, 'prism/pull-result/1');
    assert.equal(pulled.digest, digest);
    assert.equal(pulled.attestations.holo, lines.length);
    assert.equal(pulled.attestations.referrers, lines.length);
    assert.equal(pulled.attestations.signatures, 'not checked');
    assert.equal(pulled.verdict.level, 'P0');
    assert.equal(pulled.verdict.policy.name, 'pull-default');
  }));

test('each referrer layer is the exact bytes of its line, without the LF (#267 rule 10)', () =>
  withRegistry({}, async (registry) => {
    await experimental_push(signed, `${registry.host}/prism/calculator:v1`, NO_CREDENTIALS);
    const client = createRegistryClient({ registry: registry.host, repository: 'prism/calculator' });
    const { digest } = await holoManifest(signed);
    const listed = await client.listReferrers(digest);
    const layers = new Set();
    for (const { digest: manifestDigest } of listed) {
      const { bytes } = await client.getManifest(manifestDigest);
      const manifest = JSON.parse(Buffer.from(bytes).toString());
      layers.add(Buffer.from(await client.getBlob(manifest.layers[0].digest, manifest.layers[0].size)).toString());
    }
    assert.deepEqual([...layers].sort(), readAttestations(signed).map((a) => Buffer.from(a.bytes).toString()).sort());
  }));

test('without the API: the tag fallback holds the referrers, and both registries give one digest', async () => {
  const api = await withRegistry({ referrers: 'api' }, (registry) => experimental_push(signed, `${registry.host}/a/b:v1`, NO_CREDENTIALS));
  await withRegistry({ referrers: 'fallback' }, async (registry) => {
    const pushed = await experimental_push(signed, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
    assert.equal(pushed.digest, api.digest);
    assert.deepEqual(pushed.referrers.map((r) => r.digest), api.referrers.map((r) => r.digest));
    const tag = registry.state.tags.get(`a/b:${referrersTag(pushed.digest)}`);
    assert.ok(tag, 'the referrers tag exists');
    const index = JSON.parse(registry.state.manifests.get(tag).body.toString());
    assert.deepEqual(index.manifests.map((m) => m.digest).sort(), pushed.referrers.map((r) => r.digest).sort());
    assert.equal(index.mediaType, 'application/vnd.oci.image.index.v1+json');
    assert.equal(index.manifests[0].artifactType, 'application/vnd.dev.sigstore.bundle.v0.3+json');

    const pulled = await experimental_pull(`${registry.host}/a/b:v1`, NO_CREDENTIALS);
    assert.equal(pulled.attestations.referrers, pushed.referrers.length);

    // A second push of the same holo adds nothing to the index.
    await experimental_push(signed, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
    const again = JSON.parse(registry.state.manifests.get(registry.state.tags.get(`a/b:${referrersTag(pushed.digest)}`)).body.toString());
    assert.equal(again.manifests.length, pushed.referrers.length);
  });
});

test('a holo with no referrers lists none on either kind of registry', async () => {
  for (const referrers of ['api', 'fallback']) {
    await withRegistry({ referrers }, async (registry) => {
      await experimental_push(plain, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
      const pulled = await experimental_pull(`${registry.host}/a/b:v1`, NO_CREDENTIALS);
      assert.equal(pulled.attestations.referrers, 0);
    });
  }
});

test('--no-attestations pushes only the manifest, and the section stays in the file', () =>
  withRegistry({ referrers: 'fallback' }, async (registry) => {
    const pushed = await experimental_push(signed, `${registry.host}/a/b:v1`, { ...NO_CREDENTIALS, noAttestations: true });
    assert.deepEqual(pushed.referrers, []);
    assert.equal(registry.state.tags.has(`a/b:${referrersTag(pushed.digest)}`), false);
    const pulled = await experimental_pull(`${registry.host}/a/b:v1`, NO_CREDENTIALS);
    assert.ok(same(pulled.holo, signed));
    assert.equal(pulled.attestations.holo, 2);
  }));

test('the tag goes on last: referrers exist before anything can read the tag', () =>
  withRegistry({ referrers: 'api' }, async (registry) => {
    await experimental_push(signed, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
    const puts = registry.state.log.filter((line) => line.startsWith('PUT') && line.includes('/manifests/'));
    assert.match(puts[0], /manifests\/sha256:/);
    assert.match(puts.at(-2), /manifests\/v1$/);
    assert.match(puts.at(-1), /manifests\/blake3-/);
  }));

test('a blob the registry has is not uploaded again', () =>
  withRegistry({}, async (registry) => {
    const first = await experimental_push(plain, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
    assert.equal(first.layer.uploaded, true);
    const second = await experimental_push(plain, `${registry.host}/a/b:v2`, NO_CREDENTIALS);
    assert.equal(second.layer.uploaded, false);
    assert.equal(registry.state.log.filter((line) => line.startsWith('POST')).length, 2, 'one upload each for the config and the layer');
  }));

test('a registry with neither the API nor a usable tag is ReferrersUnsupportedError', async () => {
  await withRegistry({ referrers: 'fallback', refuseTags: /^sha256-/ }, async (registry) => {
    await assert.rejects(experimental_push(signed, `${registry.host}/a/b:v1`, NO_CREDENTIALS), (error) => error instanceof ReferrersUnsupportedError && error.code === 'referrers_unsupported' && error.check === 'referrers.tag');
    // Nothing was tagged: the failed push did not publish a holo without its attestations.
    assert.equal(registry.state.tags.has('a/b:v1'), false);
  });
  await withRegistry({ referrers: 'fallback' }, async (registry) => {
    await assert.rejects(experimental_push(signed, `${registry.host}/a/b:v1`, { ...NO_CREDENTIALS, referrersFallback: false }), (error) => error instanceof ReferrersUnsupportedError && error.check === 'referrers.api');
    await experimental_push(signed, `${registry.host}/a/b:v2`, NO_CREDENTIALS);
    await assert.rejects(experimental_pull(`${registry.host}/a/b:v2`, { ...NO_CREDENTIALS, referrersFallback: false }), (error) => error instanceof ReferrersUnsupportedError && error.check === 'referrers.api');
  });
});

test('Bearer: anonymous pull works, push needs the password, and the token carries the scope', () =>
  withRegistry({ auth: 'bearer' }, async (registry) => {
    const reference = `${registry.host}/a/b:v1`;
    await assert.rejects(experimental_push(plain, reference, NO_CREDENTIALS), (error) => error instanceof RegistryAuthError && error.code === 'registry_auth_failed' && error.check === 'registry.auth');
    await assert.rejects(experimental_push(plain, reference, { credentials: { username: 'alice', password: 'wrong' } }), RegistryAuthError);
    assert.equal(registry.state.tags.size, 0);
    await experimental_push(plain, reference, { credentials: { username: 'alice', password: 'secret' } });
    assert.ok(registry.state.tokenRequests.some((r) => r.scope === 'repository:a/b:pull,push' && r.service === 'registry.test' && r.authorization));
    registry.state.tokenRequests.length = 0;
    const pulled = await experimental_pull(reference, NO_CREDENTIALS);
    assert.ok(same(pulled.holo, plain));
    assert.ok(registry.state.tokenRequests.some((r) => r.scope === 'repository:a/b:pull' && r.authorization === null));
  }));

test('Basic: the credential from Docker\'s config is used, and a wrong one is refused', () =>
  withRegistry({ auth: 'basic' }, async (registry) => {
    const config = join(dir, 'docker-basic');
    mkdirSync(config, { recursive: true });
    writeFileSync(join(config, 'config.json'), JSON.stringify({ auths: { [registry.host]: { auth: Buffer.from('alice:secret').toString('base64') } } }));
    await experimental_push(plain, `${registry.host}/a/b:v1`, { env: { DOCKER_CONFIG: config } });
    const pulled = await experimental_pull(`${registry.host}/a/b:v1`, { env: { DOCKER_CONFIG: config } });
    assert.ok(same(pulled.holo, plain));
    await assert.rejects(experimental_pull(`${registry.host}/a/b:v1`, NO_CREDENTIALS), RegistryAuthError);
    writeFileSync(join(config, 'config.json'), JSON.stringify({ auths: { [registry.host]: { username: 'alice', password: 'nope' } } }));
    await assert.rejects(experimental_pull(`${registry.host}/a/b:v1`, { env: { DOCKER_CONFIG: config } }), (error) => error instanceof RegistryAuthError && error.check === 'registry.auth');
  }));

test('credentials are not sent to a plain HTTP realm, and an ambient token goes only to ghcr.io', async () => {
  const calls = [];
  const fakeFetch = (realm) => async (url, init) => {
    calls.push({ url: String(url), authorization: init.headers?.authorization ?? null });
    if (String(url).startsWith('https://ghcr.io/v2/')) return new Response('', { status: 401, headers: { 'www-authenticate': `Bearer realm="${realm}",service="ghcr.io"` } });
    return new Response(JSON.stringify({ token: 'x' }), { status: 200 });
  };
  const insecure = createRegistryClient({ registry: 'ghcr.io', repository: 'a/b' }, { fetch: fakeFetch('http://evil.example/token'), resolveCredentials: () => ({ username: 'a', password: 'b' }) });
  await assert.rejects(insecure.getManifest('v1'), (error) => error instanceof RegistryAuthError && error.check === 'registry.insecure');
  assert.ok(calls.every((c) => !c.url.startsWith('http://evil') && c.authorization === null));

  calls.length = 0;
  const ambient = await dockerCredentials('ghcr.io', { env: { DOCKER_CONFIG: join(dir, 'none'), GITHUB_TOKEN: 'ambient' } });
  assert.deepEqual(ambient, { username: 'x-access-token', password: 'ambient', onlyRealmHost: 'ghcr.io' });
  const client = createRegistryClient({ registry: 'ghcr.io', repository: 'a/b' }, { fetch: fakeFetch('https://evil.example/token'), resolveCredentials: () => ambient });
  await client.getManifest('v1').catch(() => {});
  const asked = calls.find((c) => c.url.startsWith('https://evil.example'));
  assert.ok(asked, 'the realm was asked for an anonymous token');
  assert.equal(asked.authorization, null);
});

test('Docker\'s config: credential order, GHCR variables, and a missing or stale helper counts as none', async () => {
  const config = join(dir, 'docker-order');
  mkdirSync(config, { recursive: true });
  const env = { DOCKER_CONFIG: config, PATH: '' };
  assert.equal(await dockerCredentials('registry.test', { env }), null);
  writeFileSync(join(config, 'config.json'), 'not json');
  assert.equal(await dockerCredentials('registry.test', { env }), null);
  writeFileSync(join(config, 'config.json'), JSON.stringify({ credsStore: 'no-such-helper', auths: { 'registry.test': { auth: Buffer.from('u:p:q').toString('base64') }, 'https://other.test': { identitytoken: 'refresh' } } }));
  assert.deepEqual(await dockerCredentials('registry.test', { env }), { username: 'u', password: 'p:q' });
  assert.deepEqual(await dockerCredentials('other.test', { env }), { identityToken: 'refresh' });
  assert.equal(await dockerCredentials('stale.test', { env }), null);
  writeFileSync(join(config, 'config.json'), JSON.stringify({ auths: { 'https://index.docker.io/v1/': { username: 'hub', password: 'p' } } }));
  assert.equal((await dockerCredentials('docker.io', { env })).username, 'hub');
  // A credential in the config wins over the ambient token, which is GHCR's only.
  writeFileSync(join(config, 'config.json'), JSON.stringify({ auths: { 'ghcr.io': { username: 'me', password: 'pat' } } }));
  assert.equal((await dockerCredentials('ghcr.io', { env: { ...env, GITHUB_TOKEN: 'ambient' } })).username, 'me');
  writeFileSync(join(config, 'config.json'), '{}');
  assert.equal((await dockerCredentials('ghcr.io', { env: { ...env, GHCR_TOKEN: 'one', GITHUB_TOKEN: 'two', GITHUB_ACTOR: 'octo' } })).password, 'one');
  assert.equal((await dockerCredentials('ghcr.io', { env: { ...env, GHCR_TOKEN: 'one', GITHUB_ACTOR: 'octo' } })).username, 'octo');
  assert.equal(await dockerCredentials('quay.io', { env: { ...env, GITHUB_TOKEN: 'two' } }), null);
});

test('a credential helper answers, and its identity-token form is understood', { skip: process.platform === 'win32' ? 'a shell script is not a helper on Windows' : false }, async () => {
  const bins = join(dir, 'helper-bin');
  mkdirSync(bins, { recursive: true });
  const script = join(bins, 'docker-credential-fake');
  writeFileSync(script, '#!/bin/sh\nread server\nif [ "$server" = "token.test" ]; then echo \'{"Username":"<token>","Secret":"refresh"}\'; else echo \'{"Username":"helper","Secret":"s3"}\'; fi\n');
  chmodSync(script, 0o755);
  const config = join(dir, 'docker-helper');
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, 'config.json'), JSON.stringify({ credHelpers: { 'helper.test': 'fake', 'token.test': 'fake' }, credsStore: 'fake' }));
  const env = { DOCKER_CONFIG: config, PATH: `${bins}${delimiter}${process.env.PATH}` };
  assert.deepEqual(await dockerCredentials('helper.test', { env }), { username: 'helper', password: 's3' });
  assert.deepEqual(await dockerCredentials('token.test', { env }), { identityToken: 'refresh' });
  assert.deepEqual(await dockerCredentials('via-store.test', { env }), { username: 'helper', password: 's3' });
});

test('a blob with other bytes is DigestMismatchError, and nothing is written', () =>
  withRegistry({}, async (registry) => {
    await experimental_push(plain, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
    registry.state.tamper.blob = true;
    const output = join(dir, 'tampered.holo');
    await assert.rejects(experimental_pull(`${registry.host}/a/b:v1`, { ...NO_CREDENTIALS, output }), (error) => error instanceof DigestMismatchError && error.code === 'digest_mismatch' && error.check === 'digest.blob');
    assert.equal(existsSync(output), false);
  }));

test('a manifest whose bytes differ from what the registry claims is DigestMismatchError', () =>
  withRegistry({}, async (registry) => {
    await experimental_push(plain, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
    registry.state.tamper.manifestHeader = true;
    await assert.rejects(experimental_pull(`${registry.host}/a/b:v1`, NO_CREDENTIALS), (error) => error instanceof DigestMismatchError && error.check === 'digest.manifest');
  }));

test('a digest reference that the registry answers with other bytes is DigestMismatchError', () =>
  withRegistry({}, async (registry) => {
    const { digest } = await experimental_push(plain, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
    const fake = JSON.stringify({ schemaVersion: 2 });
    registry.state.manifests.set(digest, { body: Buffer.from(fake), contentType: 'application/vnd.oci.image.manifest.v1+json' });
    await assert.rejects(experimental_pull(`${registry.host}/a/b@${digest}`, NO_CREDENTIALS), (error) => error instanceof DigestMismatchError && error.check === 'digest.manifest');
  }));

test('a blake3- tag moved onto another holo is refused: the tag proves nothing, the bytes do', () =>
  withRegistry({}, async (registry) => {
    const a = await experimental_push(plain, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
    const b = await experimental_push(signed, `${registry.host}/a/b:v2`, NO_CREDENTIALS);
    registry.state.tags.set(`a/b:${fingerprintTag(a.fingerprint)}`, b.digest);
    await assert.rejects(experimental_pull(`${registry.host}/a/b@${a.fingerprint}`, NO_CREDENTIALS), (error) => error instanceof DigestMismatchError && error.check === 'digest.fingerprint');
    const honest = await experimental_pull(`${registry.host}/a/b@${b.fingerprint}`, NO_CREDENTIALS);
    assert.ok(same(honest.holo, signed));
  }));

test('a manifest that lies in its annotations is refused', () =>
  withRegistry({}, async (registry) => {
    await experimental_push(plain, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
    const { manifest } = await holoManifest(plain);
    const wrongFingerprint = { ...manifest, annotations: { ...manifest.annotations, 'foundation.uor.prism.holo.fingerprint': `blake3:${'0'.repeat(64)}` } };
    registry.plant('a/b', 'liar', canonicalBytes(wrongFingerprint));
    await assert.rejects(experimental_pull(`${registry.host}/a/b:liar`, NO_CREDENTIALS), (error) => error instanceof DigestMismatchError && error.check === 'digest.annotation');
    const [layer] = manifest.layers;
    const wrongFile = { ...manifest, layers: [{ ...layer, annotations: { ...layer.annotations, 'foundation.uor.prism.digest.blake3': '0'.repeat(64) } }] };
    registry.plant('a/b', 'liar2', canonicalBytes(wrongFile));
    await assert.rejects(experimental_pull(`${registry.host}/a/b:liar2`, NO_CREDENTIALS), (error) => error instanceof DigestMismatchError && error.check === 'digest.annotation');
  }));

test('a manifest that is not a holo is refused, whatever the size or shape', () =>
  withRegistry({}, async (registry) => {
    const blob = registry.plantBlob('not a holo');
    const manifest = (layers) => JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: EMPTY_DESCRIPTOR, layers });
    registry.plant('a/b', 'image', manifest([{ mediaType: 'application/vnd.oci.image.layer.v1.tar', digest: blob, size: 10 }]));
    registry.plant('a/b', 'two', manifest([{ mediaType: 'application/vnd.uor.prism.holo.v1', digest: blob, size: 10 }, { mediaType: 'application/vnd.uor.prism.holo.v1', digest: blob, size: 10 }]));
    registry.plant('a/b', 'huge', manifest([{ mediaType: 'application/vnd.uor.prism.holo.v1', digest: blob, size: 2 ** 40 }]));
    registry.plant('a/b', 'junk', manifest([{ mediaType: 'application/vnd.uor.prism.holo.v1', digest: blob, size: 10 }]));
    registry.plant('a/b', 'text', 'not json');
    const refused = (tag, Class, check) => assert.rejects(experimental_pull(`${registry.host}/a/b:${tag}`, NO_CREDENTIALS), (error) => error instanceof Class && error.check === check, tag);
    await refused('image', PullVerificationError, 'pull.manifest');
    await refused('two', PullVerificationError, 'pull.manifest');
    await refused('huge', PullVerificationError, 'pull.size');
    await refused('text', PullVerificationError, 'pull.manifest');
    await refused('junk', DigestMismatchError, 'pull.archive');
  }));

test('a referrer listed for the wrong subject is dropped, and foreign artifacts are ignored', () =>
  withRegistry({ referrers: 'fallback' }, async (registry) => {
    const pushed = await experimental_push(plain, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
    const stray = registry.plant('a/b', null, JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', artifactType: 'x/y', config: EMPTY_DESCRIPTOR, layers: [], subject: { digest: `sha256:${'0'.repeat(64)}` } }));
    const foreign = registry.plant('a/b', null, JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', artifactType: 'application/spdx+json', config: EMPTY_DESCRIPTOR, layers: [{ mediaType: 'application/spdx+json', digest: `sha256:${'1'.repeat(64)}`, size: 1 }], subject: { digest: pushed.digest } }));
    registry.plant('a/b', referrersTag(pushed.digest), JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{ digest: stray, size: 1 }, { digest: foreign, size: 1 }, { digest: 'not-a-digest' }] }));
    const pulled = await experimental_pull(`${registry.host}/a/b:v1`, NO_CREDENTIALS);
    assert.equal(pulled.attestations.referrers, 0);
  }));

test('a missing tag is ManifestNotFoundError, and an unreachable registry is RegistryError', async () => {
  await withRegistry({}, async (registry) => {
    await assert.rejects(experimental_pull(`${registry.host}/a/b:nope`, NO_CREDENTIALS), (error) => error instanceof ManifestNotFoundError && error.code === 'manifest_not_found' && error.check === 'registry.manifest');
  });
  const closed = await startRegistry();
  const { host } = closed;
  await closed.close();
  await assert.rejects(experimental_pull(`${host}/a/b:v1`, NO_CREDENTIALS), (error) => error instanceof RegistryError && error.code === 'registry_failed' && error.check === 'registry.unreachable');
});

test('a registry that answers 500 is RegistryError, naming the status', () =>
  withRegistry({ referrers: 'broken' }, async (registry) => {
    await experimental_push(plain, `${registry.host}/a/b:v1`, NO_CREDENTIALS);
    // The API is broken, and the tag schema answers for it: a pull still works.
    const pulled = await experimental_pull(`${registry.host}/a/b:v1`, NO_CREDENTIALS);
    assert.ok(same(pulled.holo, plain));
    const client = createRegistryClient({ registry: registry.host, repository: 'a/b' }, { fetch: async () => new Response('{"errors":[{"code":"UNKNOWN","message":"boom"}]}', { status: 500 }) });
    await assert.rejects(client.hasBlob(`sha256:${'0'.repeat(64)}`), (error) => error instanceof RegistryError && error.check === 'registry.status' && error.details.status === 500);
  }));

test('push refuses a corrupt holo, a digest that is not its own, and a fingerprint address', () =>
  withRegistry({}, async (registry) => {
    const corrupt = plain.slice();
    corrupt[corrupt.length - 1] ^= 1;
    await assert.rejects(experimental_push(corrupt, `${registry.host}/a/b:v1`, NO_CREDENTIALS), (error) => error instanceof VerificationError && error.check === 'holo.integrity');
    await assert.rejects(experimental_push(plain, `${registry.host}/a/b@sha256:${'0'.repeat(64)}`, NO_CREDENTIALS), (error) => error instanceof DigestMismatchError && error.check === 'digest.push');
    await assert.rejects(experimental_push(plain, `${registry.host}/a/b@blake3:${'0'.repeat(64)}`, NO_CREDENTIALS), (error) => error.check === 'reference.digest');
    assert.equal(registry.state.log.filter((line) => line.startsWith('PUT')).length, 0);
    const { digest } = await holoManifest(plain);
    const pinned = await experimental_push(plain, `${registry.host}/a/b@${digest}`, NO_CREDENTIALS);
    assert.equal(pinned.tag, null);
    assert.equal(pinned.digest, digest);
  }));

test('a challenge parses, and loopback is what Docker calls loopback', () => {
  assert.deepEqual(parseChallenge('Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:a/b:pull"'), { scheme: 'bearer', parameters: { realm: 'https://ghcr.io/token', service: 'ghcr.io', scope: 'repository:a/b:pull' } });
  assert.deepEqual(parseChallenge('Basic realm="x"'), { scheme: 'basic', parameters: { realm: 'x' } });
  assert.deepEqual(parseChallenge('Basic'), { scheme: 'basic', parameters: {} });
  assert.equal(parseChallenge(null), null);
  for (const host of ['localhost:5000', '127.0.0.1:5000', '[::1]:5000', 'app.localhost']) assert.equal(isLoopback(host), true, host);
  for (const host of ['ghcr.io', '10.0.0.1:5000', 'localhost.evil.io', '127.0.0.1.evil.io']) assert.equal(isLoopback(host), false, host);
});

test('the command line: Docker-shaped output, the JSON results and the exit codes', () =>
  withRegistry({ referrers: 'fallback' }, async (registry) => {
    const holo = fileURLToPath(new URL('./fixtures/attestation/Calculator.signed.holo', import.meta.url));
    const reference = `${registry.host}/prism/calculator:v1`;
    const pushed = await cli('push', holo, reference);
    assert.equal(pushed.code, 0, pushed.stderr);
    assert.match(pushed.stdout, new RegExp(`^The push refers to repository \\[${registry.host}/prism/calculator\\]\n`));
    assert.match(pushed.stdout, /^[0-9a-f]{12}: Pushed$/m);
    assert.match(pushed.stdout, /^[0-9a-f]{12}: Attached https:\/\/uor\.foundation\/prism\/proof\/v1$/m);
    assert.match(pushed.stdout, /^v1: digest: sha256:[0-9a-f]{64} size: \d+$/m);
    assert.match(pushed.stdout, /^fingerprint: blake3:[0-9a-f]{64}$/m);
    assert.match(pushed.stderr, /no signer/);

    const output = join(dir, 'cli.holo');
    const pulled = await cli('pull', reference, output);
    assert.equal(pulled.code, 0, pulled.stderr);
    assert.match(pulled.stdout, /^v1: Pulling from prism\/calculator$/m);
    assert.match(pulled.stdout, /^[0-9a-f]{12}: Pull complete$/m);
    assert.match(pulled.stdout, /^Digest: sha256:[0-9a-f]{64}$/m);
    assert.match(pulled.stdout, /^Attestations: 2 in the holo, 2 referrers, signatures not checked$/m);
    assert.ok(same(readFileSync(output), signed));

    const json = JSON.parse((await cli('pull', reference, output, '--json')).stdout);
    assert.equal(json.schema, 'prism/pull-result/1');
    assert.equal(json.holo, undefined, 'the bytes are not in the JSON');
    assert.equal(JSON.parse((await cli('push', holo, reference, '--json')).stdout).schema, 'prism/push-result/1');

    const missing = await cli('pull', `${registry.host}/a/b:nope`, join(dir, 'never.holo'));
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /^manifest_not_found: /m);
    assert.equal(existsSync(join(dir, 'never.holo')), false);

    registry.state.tamper.blob = true;
    const tampered = await cli('pull', reference, join(dir, 'never.holo'));
    assert.equal(tampered.code, 1);
    assert.match(tampered.stderr, /^digest_mismatch: /m);
    assert.match(tampered.stderr, /^check: digest\.blob$/m);
    assert.equal(existsSync(join(dir, 'never.holo')), false);

    assert.equal((await cli('pull', 'calculator:v1')).code, 64);
    assert.equal((await cli('push', holo)).code, 64);
    assert.equal((await cli('push', holo, reference, '--nope')).code, 64);
    assert.equal((await cli('pull', reference, '--store')).code, 64);
    assert.equal((await cli('push', holo, reference, '--key', 'k', '--keyless')).code, 64);
    assert.equal((await cli('push', join(dir, 'no-such.holo'), reference)).code, 2);
  }));
