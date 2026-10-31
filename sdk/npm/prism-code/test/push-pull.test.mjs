// push and pull against the local directory store (#292), which always runs: the layout, keyed signatures, what pull
// refuses before it writes, and the copy between a store and a registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../src/archive.mjs';
import { appendAttestations, BUNDLE_MEDIA_TYPE, readAttestations } from '../src/attestations.mjs';
import { experimental_attest } from '../src/attest.mjs';
import { blake3Hex } from '../src/blake3.mjs';
import { DigestMismatchError, ManifestNotFoundError, PullVerificationError, RegistryError, SubjectMismatchError, VerificationError } from '../src/errors.mjs';
import { ANNOTATION, EMPTY_BYTES, EMPTY_DESCRIPTOR, canonicalBytes, digestOf, holoManifest, HOLO_MEDIA_TYPE, referrerManifest } from '../src/oci-manifest.mjs';
import { openStore } from '../src/oci-store.mjs';
import { experimental_pull, experimental_push } from '../src/push-pull.mjs';
import { startRegistry } from './support/registry.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const plain = new Uint8Array(readFileSync(fixture));
const placeholders = new Uint8Array(readFileSync(new URL('./fixtures/attestation/Calculator.signed.holo', import.meta.url)));
const PROOF = 'https://uor.foundation/prism/proof/v1';
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

const dir = mkdtempSync(join(tmpdir(), 'prism-store-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const fresh = () => join(dir, `store-${counter++}`);

// Signing needs the optional sigstore packages, which need Node 22.22.2 or newer.
const sigstore = await import('@sigstore/sign').then(() => true, () => false);
const needsSigstore = { skip: sigstore ? false : 'the optional sigstore packages are not installed' };

const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
const otherPublic = other.publicKey.export({ type: 'spki', format: 'pem' });

async function attested() {
  const { holo } = await experimental_attest(plain, { type: PROOF, predicate: { accepted: true }, key: privateKey });
  return holo;
}

test('a store is an OCI image layout: the marker, a canonical index and content-addressed blobs', async () => {
  const store = fresh();
  const pushed = await experimental_push(plain, 'calculator:v1', { store });
  assert.deepEqual(JSON.parse(readFileSync(join(store, 'oci-layout'), 'utf8')), { imageLayoutVersion: '1.0.0' });
  const text = readFileSync(join(store, 'index.json'), 'utf8');
  const index = JSON.parse(text);
  assert.equal(canonicalJson(index), text);
  assert.equal(index.schemaVersion, 2);
  assert.equal(index.mediaType, 'application/vnd.oci.image.index.v1+json');
  assert.deepEqual(index.manifests, [{
    annotations: { [ANNOTATION.FINGERPRINT]: pushed.fingerprint, [ANNOTATION.IMAGE_NAME]: 'calculator:v1', [ANNOTATION.REF_NAME]: 'v1' },
    digest: pushed.digest,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    size: pushed.size,
  }]);
  const blobs = readdirSync(join(store, 'blobs', 'sha256')).sort();
  const { digest, layer } = await holoManifest(plain);
  assert.deepEqual(blobs, [digest, layer.digest, EMPTY_DESCRIPTOR.digest].map((d) => d.slice('sha256:'.length)).sort());
  for (const blob of blobs) assert.equal(await digestOf(readFileSync(join(store, 'blobs', 'sha256', blob))), `sha256:${blob}`);
  assert.ok(same(readFileSync(join(store, 'blobs', 'sha256', EMPTY_DESCRIPTOR.digest.slice('sha256:'.length))), EMPTY_BYTES));
  assert.deepEqual(readdirSync(store).filter((f) => f.endsWith('.tmp')), []);
  assert.deepEqual(blobs.filter((f) => f.endsWith('.tmp')), []);
});

test('push then pull returns the holo byte for byte, by tag, by digest and by fingerprint', async () => {
  const store = fresh();
  const output = join(dir, 'round.holo');
  const pushed = await experimental_push(plain, `dir://${store}:v1`);
  assert.equal(pushed.fingerprint, `blake3:${blake3Hex(plain.subarray(0, plain.length - 32))}`);
  const byTag = await experimental_pull(`dir://${store}:v1`, { output });
  assert.ok(same(byTag.holo, plain));
  assert.ok(same(readFileSync(output), plain));
  assert.equal(byTag.output, output);
  assert.equal(byTag.sha256, pushed.sha256);
  assert.equal(byTag.blake3, pushed.blake3);
  assert.ok(same((await experimental_pull(`dir://${store}@${pushed.digest}`)).holo, plain));
  assert.ok(same((await experimental_pull(`dir://${store}@${pushed.fingerprint}`)).holo, plain));
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('a pull with no output returns the bytes and writes nothing', async () => {
  const store = fresh();
  await experimental_push(plain, 'app:1', { store });
  const pulled = await experimental_pull('app:1', { store });
  assert.equal(pulled.output, null);
  assert.ok(same(pulled.holo, plain));
});

test('each attestation line is a referrer whose layer is that line, listed untagged with its type', async () => {
  const store = fresh();
  const pushed = await experimental_push(placeholders, 'app:1', { store });
  const lines = readAttestations(placeholders);
  assert.equal(pushed.referrers.length, lines.length);
  const opened = openStore(store, { repository: 'app' });
  const listed = await opened.listReferrers(pushed.digest);
  assert.deepEqual(listed.map((d) => d.digest).sort(), pushed.referrers.map((r) => r.digest).sort());
  const layers = [];
  for (const descriptor of listed) {
    assert.equal(descriptor.artifactType, BUNDLE_MEDIA_TYPE);
    assert.equal(descriptor.annotations[ANNOTATION.BUNDLE_CONTENT], 'dsse-envelope');
    assert.equal(descriptor.annotations[ANNOTATION.REF_NAME], undefined);
    const { bytes } = await opened.getManifest(descriptor.digest);
    const manifest = JSON.parse(Buffer.from(bytes).toString());
    assert.equal(manifest.subject.digest, pushed.digest);
    layers.push(Buffer.from(await opened.getBlob(manifest.layers[0].digest, manifest.layers[0].size)).toString());
  }
  assert.deepEqual(layers.sort(), lines.map((l) => Buffer.from(l.bytes).toString()).sort());
});

test('the index does not depend on the order of writes', async () => {
  const a = fresh();
  const b = fresh();
  await experimental_push(plain, 'one:1', { store: a });
  await experimental_push(placeholders, 'two:1', { store: a });
  await experimental_push(placeholders, 'two:1', { store: b });
  await experimental_push(plain, 'one:1', { store: b });
  assert.equal(readFileSync(join(a, 'index.json'), 'utf8'), readFileSync(join(b, 'index.json'), 'utf8'));
});

test('moving a tag leaves the old manifest reachable by digest; one manifest can carry two tags', async () => {
  const store = fresh();
  const first = await experimental_push(plain, 'app:1', { store });
  const second = await experimental_push(placeholders, 'app:1', { store });
  assert.notEqual(first.digest, second.digest);
  assert.ok(same((await experimental_pull('app:1', { store })).holo, placeholders));
  assert.ok(same((await experimental_pull(`app@${first.digest}`, { store })).holo, plain));
  await experimental_push(plain, 'app:2', { store });
  await experimental_push(plain, 'app:3', { store });
  assert.ok(same((await experimental_pull('app:2', { store })).holo, plain));
  assert.ok(same((await experimental_pull('app:3', { store })).holo, plain));
  const listed = await openStore(store).list();
  assert.deepEqual(listed.map((i) => `${i.name}=${i.digest === first.digest}`).sort(), ['app:1=false', 'app:2=true', 'app:3=true']);
  assert.ok(listed.every((i) => i.size > 0 && /^blake3:/.test(i.fingerprint)), 'list() is what images needs (#349)');
});

test('two names under one tag: the full name finds each, the bare tag refuses to guess', async () => {
  const store = fresh();
  await experimental_push(plain, 'one:v1', { store });
  await experimental_push(placeholders, 'two:v1', { store });
  assert.ok(same((await experimental_pull('one:v1', { store })).holo, plain));
  assert.ok(same((await experimental_pull('two:v1', { store })).holo, placeholders));
  await assert.rejects(experimental_pull(`dir://${store}:v1`), (error) => error instanceof RegistryError && error.check === 'store.ambiguous');
  await assert.rejects(experimental_pull('three:v1', { store }), (error) => error instanceof ManifestNotFoundError && error.check === 'store.reference');
});

test('a store that is not there or is broken says so, and a pull creates nothing', async () => {
  const missing = fresh();
  await assert.rejects(experimental_pull(`dir://${missing}:v1`), ManifestNotFoundError);
  await assert.rejects(experimental_pull(`dir://${missing}@sha256:${'0'.repeat(64)}`), ManifestNotFoundError);
  await assert.rejects(experimental_pull(`dir://${missing}@blake3:${'0'.repeat(64)}`), ManifestNotFoundError);
  assert.equal(existsSync(missing), false);
  const broken = fresh();
  await experimental_push(plain, 'app:1', { store: broken });
  writeFileSync(join(broken, 'index.json'), 'not json');
  await assert.rejects(experimental_pull('app:1', { store: broken }), (error) => error instanceof RegistryError && error.check === 'store.layout');
  writeFileSync(join(broken, 'index.json'), '{}');
  await assert.rejects(experimental_pull('app:1', { store: broken }), (error) => error instanceof RegistryError && error.check === 'store.layout');
  const foreign = fresh();
  await experimental_push(plain, 'app:1', { store: foreign });
  writeFileSync(join(foreign, 'oci-layout'), '{"imageLayoutVersion":"9.0.0"}');
  await assert.rejects(experimental_push(plain, 'app:2', { store: foreign }), (error) => error instanceof RegistryError && error.check === 'store.layout');
});

test('a changed blob in the store is DigestMismatchError, and nothing is written', async () => {
  const store = fresh();
  const pushed = await experimental_push(plain, 'app:1', { store });
  const blob = join(store, 'blobs', 'sha256', pushed.sha256);
  const bytes = readFileSync(blob);
  bytes[100] ^= 1;
  writeFileSync(blob, bytes);
  const output = join(dir, 'never-a.holo');
  await assert.rejects(experimental_pull('app:1', { store, output }), (error) => error instanceof DigestMismatchError && error.check === 'digest.blob');
  assert.equal(existsSync(output), false);
  rmSync(blob);
  await assert.rejects(experimental_pull('app:1', { store }), (error) => error instanceof RegistryError && error.check === 'store.blob');
});

test('a layer whose digest holds but whose archive does not verify is refused at the archive step', async () => {
  const store = fresh();
  const opened = openStore(store, { repository: 'app' });
  const put = async (name, holo) => {
    const { manifest } = await holoManifest(plain);
    const layer = { mediaType: HOLO_MEDIA_TYPE, digest: await digestOf(holo), size: holo.length };
    await opened.putBlob(EMPTY_DESCRIPTOR.digest, EMPTY_BYTES);
    await opened.putBlob(layer.digest, holo);
    const { annotations, ...rest } = manifest;
    await opened.tagManifest(name, canonicalBytes({ ...rest, layers: [layer] }));
  };
  const output = join(dir, 'never-b.holo');
  const badFooter = plain.slice();
  badFooter[badFooter.length - 1] ^= 1;
  await put('footer', badFooter);
  await assert.rejects(experimental_pull('app:footer', { store, output }), (error) => error instanceof DigestMismatchError && error.check === 'pull.archive' && /footer/.test(error.message));
  await put('junk', new TextEncoder().encode('HOLX not a holo at all, but long enough to read a header from it'));
  await assert.rejects(experimental_pull('app:junk', { store, output }), (error) => error instanceof DigestMismatchError && error.check === 'pull.archive');
  assert.equal(existsSync(output), false);
});

test('a verdict below the policy is PullVerificationError with the whole verdict, and nothing is written', async () => {
  const store = fresh();
  await experimental_push(plain, 'app:1', { store });
  const output = join(dir, 'never-c.holo');
  const policy = join(dir, 'p2.json');
  writeFileSync(policy, JSON.stringify({ name: 'strict', minimum: 'P2' }));
  await assert.rejects(experimental_pull('app:1', { store, output, policy }), (error) => {
    assert.ok(error instanceof PullVerificationError);
    assert.equal(error.code, 'pull_verification_failed');
    assert.equal(error.check, 'pull.verdict');
    assert.equal(error.verdict.policy.name, 'strict');
    assert.equal(error.verdict.passed, false);
    assert.ok(error.reasons.length > 0);
    return true;
  });
  assert.equal(existsSync(output), false);
  await assert.rejects(experimental_pull('app:1', { store, output, env: { PRISM_MINIMUM_LEVEL: 'P1' } }), (error) => error.check === 'pull.verdict' && error.verdict.policy.minimum === 'P1');
  assert.equal(existsSync(output), false);
  const pass = await experimental_pull('app:1', { store, output, policy: { name: 'mine', minimum: 'P0' } });
  assert.equal(pass.verdict.policy.name, 'mine');
  assert.ok(existsSync(output));
});

test('a policy that pins a digest is judged as check judges it, and an invalid policy gives no pull', async () => {
  const store = fresh();
  await experimental_push(plain, 'app:1', { store });
  const output = join(dir, 'never-d.holo');
  await assert.rejects(experimental_pull('app:1', { store, output, policy: { minimum: 'P0', digests: { archive: { blake3: '0'.repeat(64) } } } }), (error) => error instanceof PullVerificationError || error instanceof VerificationError);
  await assert.rejects(experimental_pull('app:1', { store, output, policy: join(dir, 'no-such-policy.json') }), (error) => error instanceof VerificationError && error.check === 'policy.unreadable');
  await assert.rejects(experimental_pull('app:1', { store, output, policy: { minimum: 'P9' } }), (error) => error.check === 'policy.invalid');
  assert.equal(existsSync(output), false);
});

test('a holo with an attestation section still reaches a verdict: the unsigned archive is what is judged', async () => {
  const store = fresh();
  await experimental_push(placeholders, 'app:1', { store });
  const pulled = await experimental_pull('app:1', { store });
  assert.equal(pulled.verdict.level, 'P0');
  assert.equal(pulled.verdict.holo, `blake3:${blake3Hex(plain.subarray(0, plain.length - 32))}`);
  assert.notEqual(pulled.fingerprint, pulled.verdict.holo);
});

test('a statement that lies about its subject is refused by push and by pull', async () => {
  const [line] = readAttestations(placeholders);
  const statement = JSON.parse(JSON.stringify(line.statement));
  statement.subject[0].digest.sha256 = '0'.repeat(64);
  const bundle = JSON.parse(JSON.stringify(line.bundle));
  bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
  const lying = appendAttestations(plain, [bundle]);
  const store = fresh();
  await assert.rejects(experimental_push(lying, 'app:1', { store }), SubjectMismatchError);
  assert.equal(existsSync(store), false, 'nothing reached the store');

  // Put there by hand, as another tool might.
  const opened = openStore(store, { repository: 'app' });
  const { layer, bytes } = await holoManifest(lying);
  await opened.putBlob(EMPTY_DESCRIPTOR.digest, EMPTY_BYTES);
  await opened.putBlob(layer.digest, lying);
  await opened.tagManifest('1', bytes);
  const output = join(dir, 'never-e.holo');
  await assert.rejects(experimental_pull('app:1', { store, output }), (error) => error instanceof PullVerificationError && error.check === 'pull.attestation');
  assert.equal(existsSync(output), false);
});

test('a keyed push signs one statement naming the manifest, and pull checks it against the signer policy', needsSigstore, async () => {
  const holo = await attested();
  const store = fresh();
  const pushed = await experimental_push(holo, 'app:1', { store, key: privateKey });
  assert.deepEqual(pushed.referrers.map((r) => r.source), ['holo', 'push']);
  assert.deepEqual(pushed.referrers.map((r) => r.predicateType), [PROOF, PROOF]);

  const opened = openStore(store, { repository: 'app' });
  const facing = pushed.referrers.find((r) => r.source === 'push');
  const manifest = JSON.parse(Buffer.from((await opened.getManifest(facing.digest)).bytes).toString());
  const line = Buffer.from(await opened.getBlob(manifest.layers[0].digest, manifest.layers[0].size)).toString();
  const bundle = JSON.parse(line);
  assert.equal(line.includes('\n'), false);
  const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64'));
  assert.deepEqual(statement.subject[0], { name: 'oci-manifest', digest: { sha256: pushed.digest.slice('sha256:'.length) } });
  assert.deepEqual(Object.keys(statement.subject[1].digest).sort(), ['blake3', 'sha256']);
  assert.deepEqual(statement.predicate, { accepted: true });
  // A DSSE verifier skips a signature whose keyid is not its own; cosign's would not be this one.
  assert.equal(bundle.dsseEnvelope.signatures[0].keyid, '');
  // It never goes in the holo.
  assert.equal(readAttestations((await experimental_pull('app:1', { store })).holo).length, 1);

  const pass = await experimental_pull('app:1', { store, key: publicKey, type: PROOF });
  assert.equal(pass.attestations.signatures, 'verified');
  assert.deepEqual(pass.attestations.verified.map((v) => v.source), ['holo', 'referrer']);
});

test('a referrer alone can satisfy the signer policy', needsSigstore, async () => {
  const store = fresh();
  // A holo with only an unsigned placeholder: nothing in the file can pass, and the signed statement is in the store.
  const pushed = await experimental_push(placeholders, 'app:1', { store, key: privateKey });
  assert.deepEqual(pushed.referrers.map((r) => r.source), ['holo', 'holo', 'push', 'push']);
  const pass = await experimental_pull('app:1', { store, key: publicKey });
  assert.deepEqual([...new Set(pass.attestations.verified.map((v) => v.source))], ['referrer']);
});

test('the wrong key, another predicate type or a bad policy fails the pull and writes nothing', needsSigstore, async () => {
  const holo = await attested();
  const store = fresh();
  await experimental_push(holo, 'app:1', { store, key: privateKey });
  const output = join(dir, 'never-f.holo');
  await assert.rejects(experimental_pull('app:1', { store, output, key: otherPublic }), (error) => error instanceof PullVerificationError && error.check === 'pull.signer' && error.details.cause === 'signature_invalid');
  await assert.rejects(experimental_pull('app:1', { store, output, key: publicKey, type: 'https://example.com/other' }), (error) => error instanceof PullVerificationError && error.check === 'pull.signer' && error.details.cause === 'attestation_not_found');
  await assert.rejects(experimental_pull('app:1', { store, output, certificateIdentity: 'someone' }), (error) => error.check === 'policy.invalid');
  assert.equal(existsSync(output), false);
});

test('a signed statement about another manifest does not count', needsSigstore, async () => {
  const store = fresh();
  const holo = await attested();
  const { digest } = await experimental_push(holo, 'app:1', { store });
  // Attach a signed statement that names a different manifest as a referrer of this one.
  const elsewhere = fresh();
  const unrelated = await experimental_push(placeholders, 'x:1', { store: elsewhere, key: privateKey });
  const from = openStore(elsewhere, { repository: 'x' });
  const facing = unrelated.referrers.find((r) => r.source === 'push');
  const foreign = JSON.parse(Buffer.from((await from.getManifest(facing.digest)).bytes).toString());
  const line = await from.getBlob(foreign.layers[0].digest, foreign.layers[0].size);
  const to = openStore(store, { repository: 'app' });
  const { descriptor } = await holoManifest(holo);
  const planted = await referrerManifest(line, descriptor, PROOF);
  await to.putBlob(planted.layer.digest, line);
  await to.putManifest(planted.digest, planted.bytes);
  assert.ok((await to.listReferrers(digest)).some((d) => d.digest === planted.digest));
  // The in-holo bundle is signed by the same key, so the pull passes on that, and the planted one is not among those that count.
  const pass = await experimental_pull('app:1', { store, key: publicKey });
  assert.ok(pass.attestations.verified.every((v) => v.digest !== planted.digest));
});

test('a holo with nothing to sign pushes, and says so', needsSigstore, async () => {
  const store = fresh();
  writeFileSync(join(dir, 'k.pem'), privateKey);
  const out = spawnSync(process.execPath, [bin, 'push', fixture, 'app:1', '--store', store, '--key', join(dir, 'k.pem')], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stderr, /nothing to sign/);
});

test('a store copies to a registry and back with the same digest and the signed statement intact', needsSigstore, async () => {
  const registry = await startRegistry({ referrers: 'fallback' });
  try {
    const holo = await attested();
    const store = fresh();
    const stored = await experimental_push(holo, 'app:1', { store, key: privateKey });

    const pushed = await experimental_push(`dir://${store}:1`, `${registry.host}/prism/app:1`, { credentials: null });
    assert.equal(pushed.digest, stored.digest);
    assert.deepEqual(pushed.referrers.map((r) => r.digest).sort(), stored.referrers.map((r) => r.digest).sort(), 'the bytes of every referrer survive the copy');
    assert.deepEqual(pushed.referrers.map((r) => r.source), ['holo', 'store']);

    const back = fresh();
    const pulled = await experimental_pull(`${registry.host}/prism/app:1`, { credentials: null, key: publicKey, output: `dir://${back}:copied` });
    assert.equal(pulled.output, `dir://${back}:copied`);
    assert.equal(pulled.digest, stored.digest);
    const offline = await experimental_pull(`dir://${back}:copied`, { key: publicKey });
    assert.ok(same(offline.holo, holo));
    assert.equal(offline.attestations.referrers, 2);
    assert.equal(offline.attestations.verified.length, 2);

    // A failed verification stores nothing.
    const refused = fresh();
    await assert.rejects(experimental_pull(`${registry.host}/prism/app:1`, { credentials: null, key: otherPublic, output: `dir://${refused}:x` }), PullVerificationError);
    assert.equal(existsSync(refused), false);
  } finally {
    await registry.close();
  }
});

test('the command line on a store: the default output comes from the name, never from the registry', async () => {
  const store = fresh();
  const cwd = mkdtempSync(join(dir, 'cwd-'));
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd });
  const pushed = run('push', fixture, 'acme/calculator:v1', '--store', store);
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.match(pushed.stdout, /^The push refers to repository \[acme\/calculator\]$/m);
  const pulled = run('pull', 'acme/calculator:v1', '--store', store);
  assert.equal(pulled.status, 0, pulled.stderr);
  assert.match(pulled.stdout, /^Status: Verified and wrote calculator\.holo$/m);
  assert.ok(same(readFileSync(join(cwd, 'calculator.holo')), plain));
  const policy = join(dir, 'strict.json');
  writeFileSync(policy, JSON.stringify({ name: 'strict', minimum: 'P2' }));
  const refused = run('pull', 'acme/calculator:v1', 'strict.holo', '--store', store, '--policy', policy);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /^pull_verification_failed: /m);
  assert.match(refused.stderr, /^check: pull\.verdict$/m);
  assert.match(refused.stderr, /FAILED {2}P0/);
  assert.equal(existsSync(join(cwd, 'strict.holo')), false);
  const badPolicy = join(dir, 'bad.json');
  writeFileSync(badPolicy, '{"minimum":"P9"}');
  assert.equal(run('pull', 'acme/calculator:v1', 'x.holo', '--store', store, '--policy', badPolicy).status, 64);
  assert.equal(run('pull', 'acme/nothing:v1', 'x.holo', '--store', store).status, 2);
});
