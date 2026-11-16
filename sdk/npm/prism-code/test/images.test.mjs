// prism.images (#442): five verbs over the code that already does the work. OC-11 owns this file. It needs no optional
// package, so it runs whole everywhere; what needs sigstore is in images-signed.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn as realSpawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendAttestations, readAttestations } from '../src/attestations.mjs';
import { blake3Hex } from '../src/blake3.mjs';
import { check } from '../src/check.mjs';
import { DigestMismatchError, ManifestNotFoundError, PrismCodeError, PrismError, PullVerificationError, ReferenceInvalidError, RegistryAuthError, VerificationError } from '../src/errors.mjs';
import { EMPTY_BYTES, EMPTY_DESCRIPTOR, canonicalBytes, digestOf, holoManifest, HOLO_MEDIA_TYPE } from '../src/oci-manifest.mjs';
import { openStore } from '../src/oci-store.mjs';
import { experimental_verify } from '../src/verify.mjs';
import { inspect as inspectHolo } from '../src/inspect.mjs';
import { experimental_pull, experimental_push } from '../src/push-pull.mjs';
import { createPrism } from '../src/index.mjs';
import { hostDockerArguments } from '../src/host.mjs';

// The client's Docker host, without probing this machine for a daemon, as `PRISM_CODE_DRY_RUN` does for the CLI.
const hostDocker = (request) => hostDockerArguments({ ...request, probe: false });
import { createImages, images, IMAGE_BUILD_SCHEMA, IMAGE_INSPECTION_SCHEMA, IMAGE_PULL_SCHEMA, IMAGE_PUSH_SCHEMA } from '../src/images-namespace.mjs';
import { startRegistry } from './support/registry.mjs';

// A CLI pull keeps what it pulled in the local image store (#349); this suite's stays in a scratch folder.
process.env.PRISM_IMAGES ??= (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'prism-images-store-'));

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const plain = new Uint8Array(readFileSync(fixture));
const placeholders = new Uint8Array(readFileSync(new URL('./fixtures/attestation/Calculator.v5.signed.holo', import.meta.url)));
const FINGERPRINT = `blake3:${blake3Hex(plain.subarray(0, plain.length - 32))}`;
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

// The real path: macOS links its temp folder, and the CLI's working directory is always resolved.
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'prism-images-')));
test.after(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const fresh = (name = 'x') => join(dir, `${name}-${counter++}`);
const emptyDocker = fresh('docker');
mkdirSync(emptyDocker);
// The real credential lookup, pointed at a Docker config with nothing in it.
const noCredentials = { DOCKER_CONFIG: emptyDocker };

/** Every path under a directory with its bytes, to show that nothing there changed. */
function snapshot(root) {
  if (!existsSync(root)) return null;
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return `${relative(root, path)} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
    })
    .sort();
}

/** The key of every object inside a value, except a verdict, which is `prism/verdict/1` and keeps its terms. */
function keysOf(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, found));
  else if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) {
    for (const [key, member] of Object.entries(value)) {
      found.add(key);
      if (key !== 'verdict') keysOf(member, found);
    }
  }
  return found;
}
// The canonical words of the model (#346), which a developer-facing shape must not use for its members.
const CANONICAL_KEYS = ['holo', 'fingerprint', 'footer', 'section', 'sections', 'label', 'labels', 'model', 'blob', 'blobs', 'physical_version', 'kind_name', 'length', 'cross_references', 'capability_set'];
const assertDeveloperTerms = (value) => {
  const keys = keysOf(value);
  assert.deepEqual(CANONICAL_KEYS.filter((key) => keys.has(key)), []);
  assert.deepEqual([...keys].filter((key) => key.includes('_')), [], 'a prism/ shape is camelCase');
};

/** A store holding `holo` as `app:<name>`, with whatever manifest and bytes it is given, as another tool might leave it. */
async function plantInStore(store, name, holo) {
  const opened = openStore(store, { repository: 'app' });
  const { manifest } = await holoManifest(plain);
  const layer = { mediaType: HOLO_MEDIA_TYPE, digest: await digestOf(holo), size: holo.length };
  await opened.putBlob(EMPTY_DESCRIPTOR.digest, EMPTY_BYTES);
  await opened.putBlob(layer.digest, holo);
  const { annotations, ...rest } = manifest;
  await opened.tagManifest(name, canonicalBytes({ ...rest, layers: [layer] }));
}

// The namespace

test('the namespace is the verbs of #442 over the local store of #349, and usage for system.df', () => {
  assert.deepEqual(Object.keys(images).sort(), ['build', 'get', 'inspect', 'list', 'prune', 'pull', 'push', 'remove', 'tag', 'usage', 'verify']);
  assert.ok(Object.isFrozen(images));
});

test('the client exposes it as prism.images, and only a client with a Docker host can build', async () => {
  const prism = createPrism();
  assert.deepEqual(Object.keys(prism.images).sort(), Object.keys(images).sort());
  assert.deepEqual(await prism.images.inspect(plain), await images.inspect(plain));
  await assert.rejects(prism.images.build({ path: dir }), (error) => error.code === 'PP5008' && /no Docker host/.test(error.message));
});

test('an option a verb does not have is refused, so a misspelling cannot weaken a rule', async () => {
  const store = fresh('store');
  await images.push('app:1', { source: plain, store });
  const output = fresh('never.holo');
  const calls = [
    ['pull', () => images.pull('app:1', { store, output, polcy: { minimum: 'P3' } }), /polcy/],
    ['pull', () => images.pull('app:1', { store, output, credentials: { username: 'a', password: 'b' } }), /credentials/],
    ['pull', () => images.pull('app:1', null), /must be a plain object/],
    ['push', () => images.push('app:2', { source: plain, store, sign: true }), /sign/],
    ['verify', () => images.verify(plain, { minimum: 'P0' }), /minimum/],
    ['build', () => images.build({ dockerfile: 'x' }), /dockerfile/],
  ];
  for (const [verb, call, named] of calls) {
    await assert.rejects(call, (error) => error instanceof PrismCodeError && error.code === 'PP1001' && named.test(error.message), verb);
  }
  assert.equal(existsSync(output), false);
  assert.deepEqual((await openStore(store).list()).map((item) => item.name), ['app:1'], 'the refused push wrote nothing');
});

test('options must be a plain object, because an inherited key would skip every check here', async () => {
  const store = fresh('store');
  await images.push('app:1', { source: plain, store });
  const output = fresh('never.holo');
  const inherited = Object.create({ key: 'not a key', output });
  inherited.store = store;
  class Options {
    store = store;
  }
  for (const options of [inherited, new Options(), [store], new Map()]) {
    await assert.rejects(images.pull('app:1', options), (error) => error.code === 'PP1001' && /plain object/.test(error.message));
  }
  assert.equal(existsSync(output), false);
  assert.ok((await images.pull('app:1', Object.assign(Object.create(null), { store }))).bytes);
});

test('an option of the wrong type is refused, never ignored', async () => {
  const store = fresh('store');
  await images.push('app:1', { source: plain, store });
  const sandbox = fresh('sandbox');
  mkdirSync(sandbox);
  for (const output of [pathToFileURL(join(sandbox, 'a.holo')), 123, null, '']) {
    await assert.rejects(images.pull('app:1', { store, output }), (error) => error.code === 'PP1001' && /output/.test(error.message));
  }
  for (const maxSize of [Number.NaN, 'abc', 0, -1, 1.5]) {
    await assert.rejects(images.pull('app:1', { store, maxSize }), (error) => error.code === 'PP1001' && /maxSize/.test(error.message));
  }
  await assert.rejects(images.pull('app:1', { store: null }), (error) => error.code === 'PP1001');
  await assert.rejects(images.push('app:1', { source: plain, store: 5 }), (error) => error.code === 'PP1001');
  for (const options of [{ path: 5 }, { tag: null }, { file: 5 }, { release: true }]) {
    await assert.rejects(images.build(options), (error) => error.code === 'PP1001');
  }
  assert.deepEqual(snapshot(sandbox), []);
  await assert.rejects(images.pull('app:1', { store, maxSize: 10 }), (error) => error.check === 'pull.size');
});

test('a name that is not text never becomes one: nothing is written to a store under null', async () => {
  const store = fresh('store');
  for (const name of [null, undefined, 5, '']) {
    await assert.rejects(images.push(name, { source: plain, store }), ReferenceInvalidError);
    await assert.rejects(images.pull(name, { store }), ReferenceInvalidError);
  }
  for (const tag of [null, 5, '']) await assert.rejects(images.push('app', { tag, source: plain, store }), ReferenceInvalidError);
  assert.equal(existsSync(store), false);
});

test('a dir:// name holds its own tag, so the tag option beside it is refused', async () => {
  const store = fresh('store');
  await images.push(`dir://${store}:v1`, { source: plain });
  await assert.rejects(images.pull(`dir://${store}:v1`, { tag: 'v2' }), (error) => error instanceof ReferenceInvalidError && error.check === 'reference.store');
  await assert.rejects(images.push(`dir://${store}`, { tag: 'v2', source: plain }), (error) => error instanceof ReferenceInvalidError && error.check === 'reference.store');
  assert.deepEqual((await openStore(store).list()).map((item) => item.name.split(':').pop()), ['v1']);
});

test('a file URL must be a local path, and anything else is a typed refusal before any read', async () => {
  for (const url of [new URL('file://host/share/a.holo'), new URL('file:///a%2fb'), new URL('https://example.invalid/a.holo')]) {
    await assert.rejects(images.inspect(url), (error) => error instanceof PrismError && error.code === 'load.path', String(url));
    await assert.rejects(images.verify(url), (error) => error instanceof PrismError && error.code === 'load.path', String(url));
  }
});

// pull and push

test('push then pull returns the image byte for byte, in developer-view terms', async () => {
  const store = fresh('store');
  const pushed = await images.push('app', { tag: 'v1', source: plain, store });
  assert.equal(pushed.schema, IMAGE_PUSH_SCHEMA);
  assert.equal(pushed.digest, FINGERPRINT);
  assert.match(pushed.manifestDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual([pushed.tag, pushed.tags, pushed.size, pushed.uploaded], ['v1', ['v1'], plain.length, true]);
  assert.deepEqual(pushed.fileDigest, { sha256: createHash('sha256').update(plain).digest('hex'), blake3: blake3Hex(plain) });
  assertDeveloperTerms(pushed);

  const output = fresh('pulled.holo');
  const pulled = await images.pull('app', { tag: 'v1', store, output });
  assert.equal(pulled.schema, IMAGE_PULL_SCHEMA);
  assert.deepEqual([pulled.digest, pulled.manifestDigest, pulled.size], [pushed.digest, pushed.manifestDigest, plain.length]);
  assert.deepEqual(pulled.fileDigest, pushed.fileDigest);
  assert.equal(pulled.reference, `app@${pushed.manifestDigest}`);
  assert.equal(pulled.output, output);
  assert.equal(pulled.verdict.schema, 'prism/verdict/1');
  assert.ok(same(pulled.bytes, plain));
  assert.ok(same(readFileSync(output), plain));
  assertDeveloperTerms(pulled);
});

test('the same words mean the same value: the digest a pull reports is what a container reports and what pull accepts back', async () => {
  const store = fresh('store');
  const { digest, manifestDigest } = await images.push('app:1', { source: plain, store });
  const prism = createPrism({ warn: () => {} });
  const container = await prism.containers.run(plain, '1\tadd\t20\t22', { policy: { minimum: 'P0' } });
  assert.equal((await container.inspect()).image.digest, digest);
  assert.equal((await images.inspect(plain)).digest, digest);
  assert.ok(same((await images.pull(`app@${digest}`, { store })).bytes, plain));
  assert.ok(same((await images.pull(`app@${manifestDigest}`, { store })).bytes, plain));
});

test('the verbs return what the code under them returned, under the new names', async () => {
  const store = fresh('store');
  const under = await experimental_push(placeholders, 'app:1', { store });
  const over = await images.push('app:1', { source: placeholders, store });
  assert.deepEqual([over.reference, over.repository, over.tags, over.manifestDigest, over.digest], [under.reference, under.repository, under.tags, under.digest, under.fingerprint]);
  assert.deepEqual(over.referrers.map((r) => r.digest), under.referrers.map((r) => r.digest));
  assert.deepEqual([...new Set(over.referrers.map((r) => r.source))], ['image']);
  const below = await experimental_pull('app:1', { store });
  const above = await images.pull('app:1', { store });
  assert.deepEqual([above.reference, above.manifestDigest, above.digest, above.verdict, above.output], [below.reference, below.digest, below.fingerprint, below.verdict, below.output]);
  assert.deepEqual(above.attestations, { image: below.attestations.holo, referrers: below.attestations.referrers, signatures: 'not checked', verified: [] });
});

test('a pull with no output writes no file and keeps the image in the local store under the name it was pulled by', async () => {
  const store = fresh('store');
  const local = createImages();
  await local.push('app:1', { source: plain, store });
  const before = snapshot(dir);
  const pulled = await local.pull('app:1', { store });
  assert.equal(pulled.output, null);
  assert.ok(same(pulled.bytes, plain));
  assert.deepEqual(snapshot(dir), before);
  assert.deepEqual(pulled.tags, ['app:1']);
  assert.deepEqual((await local.list()).map((image) => [image.digest, image.tags]), [[FINGERPRINT, ['app:1']]]);
  assert.ok(same((await local.get('app:1')).bytes, plain));
});

test('push without a source sends the stored image its name names, as docker push does', async () => {
  const local = createImages();
  const store = fresh('store');
  await local.push('seed:1', { source: plain, store });
  await local.pull('seed:1', { store });
  await local.tag('seed:1', 'app:2');
  const target = fresh('store');
  assert.equal((await local.push('app:2', { store: target })).digest, FINGERPRINT);
  assert.deepEqual((await openStore(target).list()).map((item) => item.name), ['app:2']);
  await assert.rejects(local.push('app:3', { store: target }), { code: 'image.missing' });
  await assert.rejects(local.push(`dir://${target}:4`), (error) => error.code === 'load.source' && /options.source/.test(error.message));
});

test('push takes the image as bytes, a Blob, a path, a file URL or a store; without one it says why', async () => {
  const store = fresh('store');
  const from = await images.push('from:1', { source: plain, store });
  for (const source of [plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength), new Blob([plain]), fixture, pathToFileURL(fixture), `dir://${store}:1`]) {
    assert.equal((await images.push('to:1', { source, store: fresh('store') })).digest, from.digest);
  }
  await assert.rejects(createImages().push('app:1', { store }), (error) => error instanceof PrismCodeError && error.code === 'image.missing');
  await assert.rejects(images.push('app:1', { source: join(dir, 'nothing.holo'), store }), (error) => error.code === 'load.path');
  await assert.rejects(images.push('app:1', { source: new URL('https://example.invalid/a.holo'), store }), (error) => error.code === 'load.path');
});

test('a name that already has a tag or digest beside the tag option is refused, and so is a name that is not text', async () => {
  const store = fresh('store');
  await images.push('app:1', { source: plain, store });
  await assert.rejects(images.pull('app:1', { store, tag: '2' }), ReferenceInvalidError);
  await assert.rejects(images.pull(`app@sha256:${'0'.repeat(64)}`, { store, tag: '2' }), ReferenceInvalidError);
  await assert.rejects(images.pull(undefined), ReferenceInvalidError);
  await assert.rejects(images.pull({ kind: 'store', path: store }), ReferenceInvalidError);
  await assert.rejects(images.pull('app:9', { store }), ManifestNotFoundError);
});

// pull refuses a failing image before writing a byte

/** The ways an image can fail, each with the class and check that report it. */
function failures() {
  const damagedFooter = plain.slice();
  damagedFooter[damagedFooter.length - 1] ^= 1;
  const [line] = readAttestations(placeholders);
  const statement = structuredClone(line.statement);
  statement.subject[0].digest.sha256 = '0'.repeat(64);
  const bundle = structuredClone(line.bundle);
  bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
  // Only a holo v5 takes attestations (ADR-017).
  const lying = appendAttestations(new Uint8Array(readFileSync(new URL('../fixtures/Calculator.v5.holo', import.meta.url))), [bundle]);
  return [
    {
      name: 'a changed blob',
      check: 'digest.blob',
      type: DigestMismatchError,
      async store(store) {
        const { fileDigest } = await images.push('app:1', { source: plain, store });
        const blob = join(store, 'blobs', 'sha256', fileDigest.sha256);
        const bytes = readFileSync(blob);
        bytes[100] ^= 1;
        writeFileSync(blob, bytes);
      },
    },
    { name: 'a footer that does not match', check: 'pull.archive', type: DigestMismatchError, store: (store) => plantInStore(store, '1', damagedFooter) },
    { name: 'bytes that are not an image', check: 'pull.archive', type: DigestMismatchError, store: (store) => plantInStore(store, '1', new TextEncoder().encode('HOLX not an image at all, but long enough to read a header from')) },
    { name: 'a statement that lies about its subject', check: 'pull.attestation', type: PullVerificationError, store: (store) => plantInStore(store, '1', lying) },
    { name: 'a verdict below the policy', check: 'pull.verdict', type: PullVerificationError, options: { policy: { name: 'strict', minimum: 'P2' } }, store: (store) => images.push('app:1', { source: plain, store }) },
    { name: 'a policy that pins another digest', check: 'pull.verdict', type: PullVerificationError, options: { policy: { minimum: 'P0', digests: { archive: { blake3: '0'.repeat(64) } } } }, store: (store) => images.push('app:1', { source: plain, store }) },
    { name: 'a minimum the environment raises', check: 'pull.verdict', type: PullVerificationError, options: { env: { PRISM_MINIMUM_LEVEL: 'P1' } }, store: (store) => images.push('app:1', { source: plain, store }) },
  ];
}

for (const failure of failures()) {
  test(`pull refuses ${failure.name} before writing a byte`, async () => {
    const store = fresh('store');
    await failure.store(store);
    const refused = (error) => error instanceof failure.type && error.check === failure.check;
    const options = { store, ...(failure.options ?? {}) };
    const sandbox = fresh('sandbox');
    mkdirSync(sandbox);
    const before = snapshot(store);

    // A new file: nothing appears, and no scratch file beside it.
    const output = join(sandbox, 'app.holo');
    await assert.rejects(images.pull('app:1', { ...options, output }), refused);
    assert.deepEqual(snapshot(sandbox), []);

    // A file already there keeps every byte.
    const kept = new TextEncoder().encode('what was here before');
    writeFileSync(output, kept);
    await assert.rejects(images.pull('app:1', { ...options, output }), refused);
    assert.ok(same(readFileSync(output), kept));
    assert.deepEqual(readdirSync(sandbox), ['app.holo']);

    // A store to pull into is not even created.
    const into = join(sandbox, 'into');
    await assert.rejects(images.pull('app:1', { ...options, output: `dir://${into}:x` }), refused);
    assert.equal(existsSync(into), false);

    // The refusal comes first: a folder that does not exist would fail the first write, and the refusal is what is reported.
    await assert.rejects(images.pull('app:1', { ...options, output: join(sandbox, 'no-such-folder', 'app.holo') }), refused);

    assert.deepEqual(snapshot(store), before, 'the source store is read, never written');
  });
}

test('the guard above can fail: a passing image does reach the write, and the same missing folder stops it there', async () => {
  const store = fresh('store');
  await images.push('app:1', { source: plain, store });
  const output = join(fresh('sandbox'), 'no-such-folder', 'app.holo');
  await assert.rejects(images.pull('app:1', { store, output }), (error) => !(error instanceof PrismError) && error.code === 'ENOENT');
});

test('a registry that sends other bytes is refused, and nothing is written', async () => {
  const registry = await startRegistry({ tamper: { blob: true } });
  try {
    const sandbox = fresh('sandbox');
    mkdirSync(sandbox);
    const name = `${registry.host}/prism/app`;
    registry.state.tamper.blob = false;
    await images.push(name, { tag: '1', source: plain, env: noCredentials });
    registry.state.tamper.blob = true;
    const output = join(sandbox, 'app.holo');
    await assert.rejects(images.pull(name, { tag: '1', env: noCredentials, output }), DigestMismatchError);
    await assert.rejects(images.pull(name, { tag: '1', env: noCredentials, output: `dir://${join(sandbox, 'into')}:x` }), DigestMismatchError);
    assert.deepEqual(snapshot(sandbox), []);
  } finally {
    await registry.close();
  }
});

test('a policy that names evidence is refused: the level comes from the image, never from an option', async () => {
  const store = fresh('store');
  await images.push('app:1', { source: plain, store });
  const output = fresh('never.holo');
  const forged = { minimum: 'P2', statements: { proof: { statement: {}, envelope: { verified: true } } } };
  await assert.rejects(images.pull('app:1', { store, output, policy: forged }), (error) => error instanceof VerificationError && error.check === 'policy.invalid' && /statements/.test(error.message));
  await assert.rejects(images.verify(plain, { policy: forged }), (error) => error instanceof VerificationError && error.check === 'policy.invalid');
  await assert.rejects(images.pull('app:1', { store, output, policy: ['P0'] }), (error) => error.check === 'policy.invalid');
  await assert.rejects(images.pull('app:1', { store, output, policy: null }), (error) => error.check === 'policy.invalid');
  await assert.rejects(images.verify(plain, { policy: null }), (error) => error.check === 'policy.invalid');
  await assert.rejects(images.pull('app:1', { store, output, policy: join(dir, 'no-such-policy.json') }), (error) => error.check === 'policy.unreadable');
  assert.equal(existsSync(output), false);
});

// Credentials

test('credentials come from Docker\'s config through oci-auth, with no way to pass one around it', async () => {
  const registry = await startRegistry({ auth: 'basic', username: 'alice', password: 'secret' });
  try {
    const name = `${registry.host}/prism/app`;
    const config = fresh('docker');
    mkdirSync(config);
    writeFileSync(join(config, 'config.json'), JSON.stringify({ auths: { [registry.host]: { username: 'alice', password: 'secret' } } }));
    await assert.rejects(images.push(name, { tag: '1', source: plain, env: noCredentials }), RegistryAuthError);
    const pushed = await images.push(name, { tag: '1', source: plain, env: { DOCKER_CONFIG: config } });
    await assert.rejects(images.pull(name, { tag: '1', env: noCredentials }), RegistryAuthError);
    const pulled = await images.pull(name, { tag: '1', env: { DOCKER_CONFIG: config } });
    assert.equal(pulled.manifestDigest, pushed.manifestDigest);
    assert.ok(same(pulled.bytes, plain));
    await assert.rejects(images.pull(name, { credentials: null }), (error) => error.code === 'PP1001');
  } finally {
    await registry.close();
  }
});

// inspect

test('inspect reports every value of the canonical inspection, in developer-view terms', async () => {
  const canonical = await inspectHolo(plain);
  const view = await images.inspect(plain);
  assert.equal(view.schema, IMAGE_INSPECTION_SCHEMA);
  assert.equal(view.digest, `blake3:${canonical.footer}`);
  assert.deepEqual(view.fileDigest, canonical.digest);
  assert.deepEqual([view.name, view.size], [canonical.name, canonical.size]);
  assert.deepEqual(view.format, { revision: canonical.revision, version: canonical.physical_version, flags: canonical.flags });
  assert.equal(view.layers.length, canonical.sections.length);
  view.layers.forEach((layer, i) => {
    const section = canonical.sections[i];
    assert.deepEqual([layer.index, layer.kind, layer.type, layer.offset, layer.size, layer.bytesDigest], [section.index, section.kind, section.kind_name, section.offset, section.length, section.digest]);
    assert.equal(layer.digest, section.label ?? null);
    assert.deepEqual(layer.contentDigest, section.content?.digest);
    assert.equal(layer.verified, section.content?.label_matches);
    assert.equal(layer.name, section.name);
  });
  assert.deepEqual(view.layers.map((layer) => layer.role), canonical.sections.map((section) => (section.role === 'model-document' ? 'config' : section.role)));
  assert.ok(view.layers.some((layer) => layer.role === 'config'));
  assert.deepEqual(view.manifest.layers, { capabilitySet: canonical.manifest.labels.capability_set, guest: canonical.manifest.labels.guest, view: canonical.manifest.labels.view });
  assert.deepEqual(view.config.contentDigest, canonical.model.digest);
  assert.deepEqual([view.config.name, view.config.crate.name, view.config.function, view.config.vectors], [canonical.model.name, canonical.model.cargo_name, canonical.model.function, canonical.model.vectors]);
  assert.deepEqual(view.config.limits, { request: canonical.model.limits.request, response: canonical.model.limits.response, guestAllocation: canonical.model.limits.guest_allocation });
  assert.equal(view.provenance.applicationKappa, canonical.provenance.application_kappa);
  assert.deepEqual([view.world.contract, view.world.imports, view.world.exports], [canonical.world.contract, canonical.world.imports, canonical.world.exports]);
  assert.deepEqual(view.world.capabilitySet, { digest: canonical.world.capability_set.label, empty: canonical.world.capability_set.empty });
  assert.deepEqual(view.verification, { digest: true, claimedDigest: `blake3:${canonical.footer}`, layers: true, crossReferences: true, attestations: true });
  assert.deepEqual(view.attestations, []);
  const { world: _world, ...named } = view;
  assertDeveloperTerms(named);
});

test('inspect reads bytes, a Blob, a path or a file URL, and they agree', async () => {
  const fromBytes = await images.inspect(plain);
  assert.deepEqual(await images.inspect(fixture), fromBytes);
  assert.deepEqual(await images.inspect(pathToFileURL(fixture)), fromBytes);
  assert.deepEqual(await images.inspect(new Blob([plain])), fromBytes);
});

test('a damaged image can still be looked at: inspect reports it and throws nothing', async () => {
  const damaged = plain.slice();
  damaged[damaged.length - 1] ^= 1;
  const view = await images.inspect(damaged);
  assert.equal(view.verification.digest, false);
  assert.equal(view.digest, FINGERPRINT, 'the digest is what the bytes give');
  assert.notEqual(view.verification.claimedDigest, view.digest);
  assert.equal((await images.verify(damaged, { policy: { minimum: 'P0' } })).holo, view.digest);
  await assert.rejects(images.inspect(new TextEncoder().encode('not an image')), (error) => error instanceof PrismCodeError && error.code.startsWith('archive.'));
});

test('inspect reports the statements an image carries, and says when one cannot be read', async () => {
  const store = fresh('store');
  await images.push('app:1', { source: placeholders, store });
  const pulled = await images.pull('app:1', { store });
  const view = await images.inspect(placeholders);
  assert.equal(view.digest, pulled.digest);
  assert.equal(view.attestations.length, pulled.attestations.image);
  assert.ok(view.attestations.length > 0);
  const lines = readAttestations(placeholders);
  view.attestations.forEach((attestation, i) => {
    assert.deepEqual([attestation.predicateType, attestation.signed], [lines[i].predicateType, lines[i].signed]);
    assert.deepEqual(attestation.subjects.map((subject) => subject.name), lines[i].subjects.map((subject) => subject.name));
  });
  assertDeveloperTerms(view.attestations);
  assert.equal(view.verification.attestations, true);

  // A byte changed inside a statement line: the archive still parses, and the line no longer decodes.
  const unreadable = placeholders.slice();
  unreadable[Buffer.from(unreadable).indexOf('dsseEnvelope')] ^= 1;
  const damaged = await images.inspect(unreadable);
  assert.deepEqual([damaged.attestations, damaged.verification.attestations], [[], false]);
});

test('inspect says why it has nothing to read', async () => {
  await assert.rejects(images.inspect(join(dir, 'nothing.holo')), (error) => error.code === 'load.path');
  await assert.rejects(images.inspect(dir), (error) => error.code === 'inspect.kind');
  await assert.rejects(images.inspect(42), (error) => error instanceof PrismCodeError && error.code === 'archive.input');
});

// verify

test('verify is the verdict of check, whatever form the image takes', async () => {
  const expected = await check(fixture, { policy: 'default' });
  assert.equal(expected.schema, 'prism/verdict/1');
  for (const image of [plain, fixture, pathToFileURL(fixture), new Blob([plain])]) {
    assert.deepEqual(await images.verify(image, { policy: 'default' }), expected);
  }
  assert.deepEqual(await images.verify(plain), await check(fixture));
  const policy = { name: 'mine', minimum: 'P0' };
  assert.deepEqual(await images.verify(plain, { policy }), await experimental_verify(plain, policy));
  assert.equal((await images.verify(plain, { env: { PRISM_MINIMUM_LEVEL: 'P0' } })).policy.minimum, 'P0');
});

test('a failed verdict is returned, and only no verdict at all rejects', async () => {
  const failed = await images.verify(plain, { policy: { name: 'strict', minimum: 'P2' } });
  assert.deepEqual([failed.passed, failed.level], [false, 'P0']);
  assert.ok(failed.reasons.length > 0);
  await assert.rejects(images.verify(join(dir, 'nothing.holo')), (error) => error instanceof VerificationError && error.check === 'load.path');
  await assert.rejects(images.verify(dir), (error) => error instanceof VerificationError && error.check === 'verify.kind');
  await assert.rejects(images.verify(new TextEncoder().encode('not an image')), VerificationError);
  await assert.rejects(images.verify(plain, { policy: { minimum: 'P9' } }), (error) => error.check === 'policy.invalid');
});

test('verify judges a damaged image as check does, and a statement in it counts for nothing without a signer', async () => {
  const damaged = plain.slice();
  damaged[100] ^= 1;
  const path = fresh('damaged.holo');
  writeFileSync(path, damaged);
  const fail = (promise) => promise.then((verdict) => ({ verdict }), (error) => ({ code: error.code, check: error.check }));
  assert.deepEqual(await fail(images.verify(damaged)), await fail(check(path)));
  const signed = await images.verify(placeholders, { policy: { minimum: 'P0' } });
  assert.equal(signed.level, 'P0');
});

// build

const IMAGE = `ghcr.io/uor-foundation/prismpm@sha256:${'a'.repeat(64)}`;

/** A project with a lock, and a docker that runs a child printing what the test says. It returns the calls it saw. */
function project({ result, exit = 0, logs = '', pad = 0, lock = JSON.stringify({ sdk_image: IMAGE }), write = () => {} } = {}) {
  const root = fresh('project');
  mkdirSync(root);
  if (lock !== null) writeFileSync(join(root, 'prismpm.lock'), lock);
  write(root);
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const script = "process.stderr.write(process.env.FAKE_LOGS);process.stdout.write(' '.repeat(Number(process.env.FAKE_PAD)));process.stdout.write(process.env.FAKE_RESULT);process.exitCode=Number(process.env.FAKE_EXIT)";
    return realSpawn(process.execPath, ['-e', script], { ...options, env: { ...process.env, FAKE_LOGS: logs, FAKE_RESULT: typeof result === 'string' ? result : JSON.stringify(result ?? null), FAKE_EXIT: String(exit), FAKE_PAD: String(pad) } });
  };
  return { root, calls, images: createImages({ spawn, docker: hostDocker }) };
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const BUILD_ID = 'b'.repeat(64);
const BUILD_RESULT = Object.freeze({ schema: 'prismpm/build-result/1', build_id: BUILD_ID, source_id: 's', semantic_id: 'm', model_path: `.prism/build/${BUILD_ID}/model.prism.json`, manifest_path: `.prism/build/${BUILD_ID}/manifest.json` });

/** What `prismpm build` leaves: a build directory whose manifest has a row for the holo at its top. */
function buildDirectory(root, { rows, holo = plain, name = 'Calculator.holo' } = {}) {
  const folder = join(root, '.prism', 'build', BUILD_ID);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), holo);
  const files = rows ?? [{ path: name, sha256: sha(holo), byte_length: holo.length }, { path: 'application/directory.json', sha256: sha(''), byte_length: 0 }];
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ schema: 'prismpm/build-manifest/1', files }));
  return folder;
}

test('build runs the builder image the lock pins and returns the image it made, with the logs', async () => {
  let folder;
  const { root, calls, images: built } = project({ result: BUILD_RESULT, logs: 'compiling\n', write: (at) => { folder = buildDirectory(at); } });
  const result = await built.build({ path: root });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'docker');
  assert.equal(calls[0].options.cwd, root);
  assert.ok(calls[0].args.includes(IMAGE));
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf(IMAGE) + 1), ['prismpm', 'build', '--json']);
  assert.equal(result.schema, IMAGE_BUILD_SCHEMA);
  assert.deepEqual([result.digest, result.tag, result.path, result.size, result.builder, result.manifestDigest, result.buildId, result.logs], [FINGERPRINT, null, join(folder, 'Calculator.holo'), plain.length, IMAGE, null, BUILD_ID, 'compiling\n']);
  assert.deepEqual(result.fileDigest, { sha256: sha(plain), blake3: blake3Hex(plain) });
  assert.ok(same(result.bytes, plain));
  assertDeveloperTerms(result);
  // What it made is an image the other verbs take.
  assert.equal((await images.inspect(result.path)).digest, result.digest);
  const store = fresh('store');
  assert.equal((await images.push('app:1', { source: result.bytes, store })).digest, result.digest);
});

test('build passes Docker\'s flag names as prismpm\'s, each as one argument, and the docker call is the CLI\'s', async () => {
  const { root, calls, images: built } = project({ result: BUILD_RESULT, write: (at) => buildDirectory(at) });
  await built.build({ path: root, file: 'other.toml', locked: true, update: true, release: 'stable' });
  const args = calls[0].args.slice(calls[0].args.indexOf(IMAGE) + 1);
  assert.deepEqual(args, ['prismpm', 'build', '--json', '--config=other.toml', '--release=stable', '--locked', '--update']);
  // A value cannot become a flag of its own.
  await built.build({ path: root, tag: '--update' }).catch(() => {});
  assert.ok(calls[1].args.includes('--tag=--update'));
  assert.ok(!calls[1].args.slice(calls[1].args.indexOf(IMAGE)).includes('--update'));

  const cli = spawnSync(process.execPath, [bin, 'build', '--json', '--config=other.toml', '--release=stable', '--locked', '--update'], { cwd: root, encoding: 'utf8', env: { ...process.env, PRISM_CODE_DRY_RUN: '1' } });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim(), `docker ${calls[0].args.join(' ')}`);
});

test('a tagged build returns the image of the verified release it made', async () => {
  const layer = (title, bytes) => ({ digest: `sha256:${sha(bytes)}`, size: bytes.length, annotations: { 'org.opencontainers.image.title': title } });
  const buildManifest = Buffer.from(JSON.stringify({ schema: 'prismpm/build-manifest/1', files: [{ path: 'Calculator.holo', sha256: sha(plain), byte_length: plain.length }] }));
  const releaseBytes = Buffer.from(JSON.stringify({ artifactType: 'application/vnd.prismpm.product.release.v1+json', layers: [layer('manifest.json', buildManifest), layer('Calculator.holo', plain)] }));
  const release = `sha256:${sha(releaseBytes)}`;
  const { root, calls, images: built } = project({
    result: { schema: 'prismpm/product-release-result/1', reference: 'ghcr.io/acme/app:1', product_digest: release, release_digest: release, model_digest: release, build_digest: release, evidence_path: 'x' },
    write(at) {
      const blobs = join(at, '.prism', 'oci', 'blobs', 'sha256');
      mkdirSync(blobs, { recursive: true });
      mkdirSync(join(at, '.prism', 'oci', 'verified'));
      writeFileSync(join(at, '.prism', 'oci', 'verified', `${sha(releaseBytes)}.json`), '{}');
      for (const bytes of [releaseBytes, buildManifest, plain]) writeFileSync(join(blobs, sha(bytes)), bytes);
    },
  });
  const result = await built.build({ path: root, tag: 'ghcr.io/acme/app:1' });
  assert.ok(calls[0].args.includes('--tag=ghcr.io/acme/app:1'));
  assert.deepEqual([result.digest, result.tag, result.path, result.manifestDigest, result.buildId], [FINGERPRINT, 'ghcr.io/acme/app:1', null, release, null]);
  assert.ok(same(result.bytes, plain));
});

test('a failed build rejects with the code prismpm gave and the logs that explain it', async () => {
  const { root, images: built } = project({ exit: 2, logs: 'stale lock\n', result: { schema: 'prismpm/error-result/1', diagnostic: { code: 'PP1101', message: 'the lock is stale' } } });
  await assert.rejects(built.build({ path: root }), (error) => {
    assert.ok(error instanceof PrismCodeError);
    assert.deepEqual([error.code, error.message], ['PP1101', 'the lock is stale']);
    assert.deepEqual(error.details, { exitCode: 2, logs: 'stale lock\n' });
    return true;
  });
});

test('a build that stopped with no diagnostic is not reported as one that never ran', async () => {
  for (const exit of [101, 137, 1]) {
    const { root, images: built } = project({ exit, result: '{"truncat', logs: 'panicked\n' });
    await assert.rejects(built.build({ path: root }), (error) => error.code === 'PP9001' && error.details.exitCode === exit && /panicked/.test(error.details.logs), String(exit));
  }
  for (const exit of [125, 126, 127]) {
    const { root, images: built } = project({ exit, result: '' });
    await assert.rejects(built.build({ path: root }), (error) => error.code === 'PP5008' && error.details.exitCode === exit, String(exit));
  }
});

test('a build cannot read outside the project: not through a name, not through a link', async () => {
  const outside = fresh('outside');
  mkdirSync(join(outside, BUILD_ID), { recursive: true });
  writeFileSync(join(outside, BUILD_ID, 'Calculator.holo'), plain);
  writeFileSync(join(outside, BUILD_ID, 'manifest.json'), JSON.stringify({ schema: 'prismpm/build-manifest/1', files: [{ path: 'Calculator.holo', sha256: sha(plain), byte_length: plain.length }] }));
  const linked = project({ result: BUILD_RESULT, write: (at) => { mkdirSync(join(at, '.prism')); symlinkSync(outside, join(at, '.prism', 'build'), 'junction'); } });
  await assert.rejects(linked.images.build({ path: linked.root }), (error) => error.code === 'PP8001');
  for (const title of ['..\\..\\..\\secret.holo', 'a\\b.holo', '.hidden.holo', '-x.holo']) {
    const row = [{ path: title, sha256: sha(plain), byte_length: plain.length }];
    const { root, images: built } = project({ result: BUILD_RESULT, write: (at) => buildDirectory(at, { rows: row }) });
    await assert.rejects(built.build({ path: root }), (error) => error.code === 'PP8001', title);
  }
});

test('a builder that never ran is PP5008, whether docker is missing or its daemon is down', async () => {
  const stopped = project({ exit: 125, result: '', logs: 'Cannot connect to the Docker daemon\n' });
  await assert.rejects(stopped.images.build({ path: stopped.root }), (error) => error.code === 'PP5008' && error.details.exitCode === 125 && /daemon/.test(error.details.logs));
  const root = project().root;
  const missing = (_command, args, options) => realSpawn('prism-no-such-docker-here', args, options);
  await assert.rejects(createImages({ spawn: missing, docker: hostDocker }).build({ path: root }), (error) => error.code === 'PP5008' && /not installed/.test(error.message));
  const thrown = () => {
    throw new Error('spawn refused');
  };
  await assert.rejects(createImages({ spawn: thrown, docker: hostDocker }).build({ path: root }), (error) => error.code === 'PP5008' && /spawn refused/.test(error.message));
});

test('no lock is PP1101 and a mutable builder image is refused, and neither starts docker', async () => {
  const none = project({ lock: null });
  await assert.rejects(none.images.build({ path: none.root }), (error) => error.code === 'PP1101');
  const mutable = project({ lock: JSON.stringify({ sdk_image: 'ghcr.io/acme/sdk:latest' }) });
  await assert.rejects(mutable.images.build({ path: mutable.root }), (error) => error.code === 'lock.image');
  assert.equal(none.calls.length + mutable.calls.length, 0);
});

test('a build that exits 0 must still have made the image it names', async () => {
  const damaged = plain.slice();
  damaged[damaged.length - 1] ^= 1;
  // A changed byte in the last layer, with the footer recomputed: the file agrees with itself and not with its labels.
  const refootered = plain.slice();
  refootered[refootered.length - 100] ^= 1;
  refootered.set(Buffer.from(blake3Hex(refootered.subarray(0, refootered.length - 32)), 'hex'), refootered.length - 32);
  const cases = [
    ['no JSON', { result: 'built!' }, 'PP4004'],
    ['a result with no manifest', { result: { schema: 'prismpm/build-result/1' } }, 'PP4004'],
    ['a manifest outside the project', { result: { ...BUILD_RESULT, manifest_path: '../../manifest.json' } }, 'PP4004'],
    ['an absolute manifest', { result: { ...BUILD_RESULT, manifest_path: '/etc/manifest.json' } }, 'PP4004'],
    ['a manifest that is not there', { result: BUILD_RESULT }, 'PP4002'],
    ['another document', { result: BUILD_RESULT, write: (at) => writeFileSync(join(buildDirectory(at), 'manifest.json'), '{"schema":"other"}') }, 'PP4004'],
    ['no image', { result: BUILD_RESULT, write: (at) => buildDirectory(at, { rows: [{ path: 'a.json', sha256: sha(''), byte_length: 0 }] }) }, 'PP4002'],
    ['two images', { result: BUILD_RESULT, write: (at) => buildDirectory(at, { rows: [{ path: 'a.holo', sha256: sha(plain), byte_length: plain.length }, { path: 'b.holo', sha256: sha(plain), byte_length: plain.length }] }) }, 'PP4002'],
    ['an image file that is gone', { result: BUILD_RESULT, write: (at) => buildDirectory(at, { rows: [{ path: 'gone.holo', sha256: sha(plain), byte_length: plain.length }] }) }, 'PP4002'],
    ['bytes other than the row', { result: BUILD_RESULT, write: (at) => buildDirectory(at, { rows: [{ path: 'Calculator.holo', sha256: '0'.repeat(64), byte_length: plain.length }] }) }, 'PP4001'],
    ['a footer that does not match', { result: BUILD_RESULT, write: (at) => buildDirectory(at, { holo: damaged }) }, 'PP3004'],
    ['a changed layer under a footer that matches', { result: BUILD_RESULT, write: (at) => buildDirectory(at, { holo: refootered }) }, 'PP3008'],
    ['more output than one result', { result: BUILD_RESULT, pad: 17 * 1024 * 1024, write: (at) => buildDirectory(at) }, 'PP4004'],
    ['a manifest over its bound', { result: BUILD_RESULT, write: (at) => writeFileSync(join(buildDirectory(at), 'manifest.json'), ' '.repeat(17 * 1024 * 1024)) }, 'PP4004'],
  ];
  for (const [name, setup, code] of cases) {
    const { root, images: built } = project(setup);
    await assert.rejects(built.build({ path: root }), (error) => error instanceof PrismError && error.code === code, name);
  }
});

test('the codes the namespace raises of its own are all registered', () => {
  const source = readFileSync(new URL('../src/images-namespace.mjs', import.meta.url), 'utf8');
  const raised = new Set([...source.matchAll(/\bfail\(\s*'([^']+)'/g)].map((match) => match[1]));
  const registered = readFileSync(new URL('../../../../model/errors.toml', import.meta.url), 'utf8');
  // `load.*`, `inspect.*`: the package's codes, reused with the meaning they already have.
  const own = [...raised].filter((code) => !['load.source', 'load.path', 'inspect.kind'].includes(code));
  assert.ok(own.length > 0);
  for (const code of own) assert.ok(registered.includes(`code = "${code}"`), `${code} is not in model/errors.toml`);
});
