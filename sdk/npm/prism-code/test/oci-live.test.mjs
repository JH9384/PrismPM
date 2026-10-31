// push and pull against a real registry, and against the tools the done criterion names (#292).
//
// The registry: PRISM_TEST_REGISTRY=<host:port> if set, otherwise a `distribution` container when Docker can run one,
// otherwise the test skips. cosign and oras run when they are on the PATH, and skip otherwise. CI runs all of it in
// .github/workflows/oci-interop.yml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArchive, resolveArchive } from '../src/archive.mjs';
import { readAttestations } from '../src/attestations.mjs';
import { experimental_attest } from '../src/attest.mjs';
import { PullVerificationError } from '../src/errors.mjs';
import { experimental_pull, experimental_push } from '../src/push-pull.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const fixture = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
const PROOF = 'https://uor.foundation/prism/proof/v1';
/** Pinned by digest: registry:2.8.3, the last stock `registry:2`. */
const IMAGE = process.env.PRISM_TEST_REGISTRY_IMAGE ?? 'registry@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373';

const has = (tool, ...args) => spawnSync(tool, args, { stdio: 'ignore', timeout: 15000 }).status === 0;
const hasCosign = has('cosign', 'version');
const hasOras = has('oras', 'version');
const sigstore = await import('@sigstore/sign').then(() => true, () => false);

function startContainer() {
  if (!has('docker', 'info')) return null;
  const started = spawnSync('docker', ['run', '-d', '--rm', '-p', '127.0.0.1::5000', IMAGE], { encoding: 'utf8', timeout: 120000 });
  if (started.status !== 0) return null;
  const id = started.stdout.trim();
  const port = spawnSync('docker', ['port', id, '5000/tcp'], { encoding: 'utf8' }).stdout.split('\n')[0].trim();
  return { id, host: port.replace(/^0\.0\.0\.0/, '127.0.0.1') };
}

const given = process.env.PRISM_TEST_REGISTRY;
const container = given ? null : startContainer();
const host = given ?? container?.host ?? null;
const skip = host ? false : 'no registry: set PRISM_TEST_REGISTRY, or make Docker available';
const signing = host && !sigstore ? 'the optional sigstore packages are not installed' : skip;

const dir = mkdtempSync(join(tmpdir(), 'prism-live-'));
test.after(() => {
  rmSync(dir, { recursive: true, force: true });
  if (container) spawnSync('docker', ['rm', '-f', container.id], { stdio: 'ignore' });
});

const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
writeFileSync(join(dir, 'public.pem'), publicKey);
writeFileSync(join(dir, 'private.pem'), privateKey);

/** A repository nothing else has touched, so reruns against one registry do not see each other. */
const repository = () => `${host}/prism/live-${randomBytes(4).toString('hex')}`;

async function waitForRegistry() {
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(`http://${host}/v2/`).then((r) => r.status === 200 || r.status === 401, () => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`the registry at ${host} did not answer`);
}

const attested = async () => (await experimental_attest(fixture, { type: PROOF, predicate: { accepted: true }, key: privateKey })).holo;

test('a stock registry takes the holo and gives it back byte for byte, by tag, digest and fingerprint', { skip }, async () => {
  await waitForRegistry();
  const repo = repository();
  const pushed = await experimental_push(fixture, `${repo}:v1`, { credentials: null });
  const same = (a) => Buffer.from(a).equals(Buffer.from(fixture));
  assert.ok(same((await experimental_pull(`${repo}:v1`, { credentials: null })).holo));
  assert.ok(same((await experimental_pull(`${repo}@${pushed.digest}`, { credentials: null })).holo));
  assert.ok(same((await experimental_pull(`${repo}@${pushed.fingerprint}`, { credentials: null })).holo));
});

test('the manifest digest is the one every registry gets', { skip }, async () => {
  await waitForRegistry();
  const a = await experimental_push(fixture, `${repository()}:a`, { credentials: null });
  const b = await experimental_push(fixture, `${repository()}:b`, { credentials: null });
  assert.equal(a.digest, b.digest);
  assert.equal(a.digest, 'sha256:208bb91cc9984112b3992b0a051c1f1b28d59e57266e208244d469f09b1bb5e4');
});

test('a keyed push: the referrers are listed, pull checks the signer, the wrong key writes nothing', { skip: signing }, async () => {
  await waitForRegistry();
  const repo = repository();
  const holo = await attested();
  const pushed = await experimental_push(holo, `${repo}:v1`, { credentials: null, key: privateKey });
  assert.deepEqual(pushed.referrers.map((r) => r.source), ['holo', 'push']);
  const pulled = await experimental_pull(`${repo}:v1`, { credentials: null, key: publicKey, type: PROOF });
  assert.equal(pulled.attestations.referrers, 2);
  assert.deepEqual(pulled.attestations.verified.map((v) => v.source).sort(), ['holo', 'referrer']);
  const wrong = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' });
  await assert.rejects(experimental_pull(`${repo}:v1`, { credentials: null, key: wrong }), (error) => error instanceof PullVerificationError && error.check === 'pull.signer');
});

test('cosign verify-attestation accepts the pushed reference, and refuses another key', { skip: signing || (hasCosign ? false : 'cosign is not on the PATH') }, async () => {
  await waitForRegistry();
  const repo = repository();
  await experimental_push(await attested(), `${repo}:v1`, { credentials: null, key: privateKey });
  const verify = (key, ...extra) => spawnSync('cosign', ['verify-attestation', '--key', key, '--insecure-ignore-tlog', '--allow-http-registry', '--type', PROOF, ...extra, `${repo}:v1`], { encoding: 'utf8' });
  const passed = verify(join(dir, 'public.pem'));
  assert.equal(passed.status, 0, passed.stderr);
  const statement = JSON.parse(Buffer.from(JSON.parse(passed.stdout.trim().split('\n')[0]).payload, 'base64'));
  assert.equal(statement.subject[0].name, 'oci-manifest');
  assert.deepEqual(Object.keys(statement.subject[1].digest).sort(), ['blake3', 'sha256'], 'cosign keeps the dual digest');
  writeFileSync(join(dir, 'other.pem'), generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' }));
  assert.notEqual(verify(join(dir, 'other.pem')).status, 0);
});

test('cosign verify-blob-attestation accepts a line of the holo against the extracted blob (#267)', { skip: signing || (hasCosign ? false : 'cosign is not on the PATH') }, async () => {
  const holo = await attested();
  const parsed = parseArchive(holo);
  const [line] = readAttestations(parsed);
  writeFileSync(join(dir, 'line.sigstore.json'), line.bytes);
  writeFileSync(join(dir, 'guest.wasm'), resolveArchive(parsed).guest.content);
  const out = spawnSync('cosign', ['verify-blob-attestation', '--key', join(dir, 'public.pem'), '--insecure-ignore-tlog', '--type', PROOF, '--bundle', join(dir, 'line.sigstore.json'), join(dir, 'guest.wasm')], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
});

test('oras discover lists every referrer with its annotations, and reads the store as a layout', { skip: signing || (hasOras ? false : 'oras is not on the PATH') }, async () => {
  await waitForRegistry();
  const repo = repository();
  const holo = await attested();
  const pushed = await experimental_push(holo, `${repo}:v1`, { credentials: null, key: privateKey });
  const out = spawnSync('oras', ['discover', '--plain-http', '--format', 'json', `${repo}:v1`], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const found = JSON.parse(out.stdout);
  const listed = found.referrers ?? found.manifests;
  assert.deepEqual(listed.map((r) => r.digest).sort(), pushed.referrers.map((r) => r.digest).sort());
  for (const referrer of listed) {
    assert.equal(referrer.artifactType, 'application/vnd.dev.sigstore.bundle.v0.3+json');
    assert.equal(referrer.annotations['dev.sigstore.bundle.predicateType'], PROOF);
  }
  const filtered = spawnSync('oras', ['discover', '--plain-http', '--format', 'json', '--artifact-type', 'application/vnd.dev.sigstore.bundle.v0.3+json', `${repo}:v1`], { encoding: 'utf8' });
  assert.equal(filtered.status, 0, filtered.stderr);

  const store = join(dir, 'layout');
  const cli = spawnSync(process.execPath, [bin, 'pull', `${repo}:v1`, `dir://${store}:v1`], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const local = spawnSync('oras', ['discover', '--oci-layout', '--format', 'json', `${store}:v1`], { encoding: 'utf8' });
  assert.equal(local.status, 0, local.stderr);
  const inLayout = JSON.parse(local.stdout);
  assert.deepEqual((inLayout.referrers ?? inLayout.manifests).map((r) => r.digest).sort(), pushed.referrers.map((r) => r.digest).sort());
});
