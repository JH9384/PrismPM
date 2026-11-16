// prism.images (#442) with signatures, which need the optional sigstore packages and Node 22.22.2 or newer. A throwaway
// key signs at test time, as in check.test.mjs. These show that the verbs hand the signer to the code that judges it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimental_attest } from '../src/attest-write.mjs';
import { parseArchive, resolveArchive } from '../src/archive.mjs';
import { check } from '../src/check.mjs';
import { PullVerificationError } from '../src/errors.mjs';
import { images } from '../src/images-namespace.mjs';

const sigstore = await import('@sigstore/sign').then(() => true, () => false);
const needsSigstore = { skip: sigstore ? false : 'the optional sigstore packages are not installed' };

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const plain = new Uint8Array(readFileSync(here('../fixtures/Calculator.v5.holo')));
const PROOF = 'https://uor.foundation/prism/proof/v1';
const SLSA = 'https://slsa.dev/provenance/v1';
const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const stranger = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const key = pair.publicKey.export({ type: 'spki', format: 'pem' });
const strangerKey = stranger.publicKey.export({ type: 'spki', format: 'pem' });

const dir = mkdtempSync(join(tmpdir(), 'prism-images-signed-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const fresh = (name) => join(dir, `${name}-${counter++}`);

/** The Calculator with a signed provenance statement and a signed proof statement about its guest. */
async function signedImage() {
  const { provenance } = resolveArchive(parseArchive(plain));
  const predicate = structuredClone(JSON.parse(readFileSync(here('../../spec/test/fixtures/attestation/statement/calculator.json'), 'utf8')).predicate);
  predicate.model.document = { sha256: provenance.model_id };
  Object.assign(predicate.model, { sourceId: provenance.source_id, semanticId: provenance.semantic_id, snapshotId: provenance.snapshot_id, compilerSemanticsId: provenance.compiler_semantics_id, leanManifestSha256: provenance.lean_manifest_sha256 });
  const { holo } = await experimental_attest(plain, { type: SLSA, predicate: { buildDefinition: { buildType: 'https://uor.foundation/prism/holo-build/v1' } }, subjects: ['guest', 'view', 'model', 'capabilities'], key: privateKey });
  return (await experimental_attest(holo, { type: PROOF, predicate, subjects: ['guest'], key: privateKey })).holo;
}

test('verify hands the signer to check: the same image is P2 with it, P0 without, and a stranger counts for nothing', needsSigstore, async () => {
  const image = await signedImage();
  const passed = await images.verify(image, { key });
  assert.deepEqual([passed.level, passed.passed], ['P2', true]);
  assert.deepEqual(passed, await check(image, { signer: { key } }));
  assert.equal((await images.verify(image)).level, 'P0');
  assert.equal((await images.verify(image, { key: strangerKey })).level, 'P0');
});

test('pull and verify give one signed image one verdict', needsSigstore, async () => {
  const image = await signedImage();
  const store = fresh('store');
  await images.push('app:1', { source: image, store });
  const policy = { name: 'strict', minimum: 'P2' };
  const pulled = await images.pull('app:1', { store, policy, key });
  assert.deepEqual([pulled.verdict.level, pulled.verdict.passed], ['P2', true]);
  assert.deepEqual(pulled.verdict, await images.verify(image, { policy, key }));
  assert.equal(pulled.digest, (await images.inspect(image)).digest);
});

test('a keyed push signs for the registry, and pull checks the signer before it writes', needsSigstore, async () => {
  const image = await signedImage();
  const store = fresh('store');
  const pushed = await images.push('app:1', { source: image, store, key: privateKey });
  assert.deepEqual([...new Set(pushed.referrers.map((r) => r.source))], ['image', 'push']);

  const output = fresh('never.holo');
  await assert.rejects(images.pull('app:1', { store, output, key: strangerKey }), (error) => error instanceof PullVerificationError && error.check === 'pull.signer');
  await assert.rejects(images.pull('app:1', { store, output, key, type: 'https://example.com/other' }), (error) => error instanceof PullVerificationError && error.check === 'pull.signer');
  assert.equal(existsSync(output), false);

  const pulled = await images.pull('app:1', { store, output, key });
  assert.equal(pulled.attestations.signatures, 'verified');
  assert.ok(pulled.attestations.verified.every((row) => row.source === 'image' || row.source === 'referrer'));
  assert.ok(pulled.attestations.verified.some((row) => row.source === 'image'));
  assert.ok(existsSync(output));
});
