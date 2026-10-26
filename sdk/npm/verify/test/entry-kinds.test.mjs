// The log entry kinds a DSSE bundle carries (#272): dsse/0.0.1 (Rekor v1, what the public Sigstore instance still logs
// for attestations) and dsse/0.0.2 (Rekor v2), each body checked against the envelope. The bundles are production
// Sigstore bundles from the Sigstore conformance suite (test/fixtures/sigstore-rekor1/, Apache-2.0) against the
// public trusted root fetched over TUF.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { verifyTransparency } from '../src/index.mjs';
import { bodyProblem } from '../src/transparency.mjs';
import { here } from './helpers.mjs';

const DIR = here('fixtures/sigstore-rekor1/');
const bundleOf = (name) => JSON.parse(readFileSync(`${DIR}${name}/bundle.sigstore.json`, 'utf8'));
const root = JSON.parse(readFileSync(`${DIR}trusted_root.json`, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const failed = (result) => [...new Set(result.reasons.map((r) => r.check))];
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

// These Rekor v1 bundles carry no RFC 3161 timestamp, and a Rekor v1 integrated time is never the clock, so the
// certificate cannot be placed in time; every tlog check still runs and must pass or fail on its own.
const logOnly = (bundle) => verifyTransparency(bundle, root, { timestamps: 0 });
// What the entry itself failed on; `tlog.count` only restates that no entry verified.
const tlogReasons = (result) => result.reasons.filter((r) => r.check.startsWith('tlog.') && r.check !== 'tlog.count').map((r) => r.check);

test('a Rekor v1 dsse/0.0.1 entry is checked, not refused: inclusion proof, checkpoint and body', async () => {
  const bundle = bundleOf('rekor1-dsse-happy-path');
  assert.deepEqual(bundle.verificationMaterial.tlogEntries[0].kindVersion, { kind: 'dsse', version: '0.0.1' });
  const result = await logOnly(bundle);
  assert.deepEqual(tlogReasons(result), []);
  assert.ok(result.checks.some((c) => c.check.startsWith('tlog.') && c.passed), 'the entry itself verified');
});

test('a dsse/0.0.1 body that is not about this envelope is tlog.body', async () => {
  assert.deepEqual(tlogReasons(await logOnly(bundleOf('rekor1-dsse-mismatch-envelope_fail'))), ['tlog.body']);
  assert.deepEqual(tlogReasons(await logOnly(bundleOf('rekor1-dsse-mismatch-sig_fail'))), ['tlog.body']);

  // The payload changed after it was logged.
  const changed = bundleOf('rekor1-dsse-happy-path');
  const payload = Buffer.from(changed.dsseEnvelope.payload, 'base64').toString().replace('a.txt', 'b.txt');
  changed.dsseEnvelope.payload = Buffer.from(payload).toString('base64');
  assert.deepEqual(tlogReasons(await logOnly(changed)), ['tlog.body']);

  // The certificate that signed is not the one the log recorded.
  const other = bundleOf('rekor1-dsse-happy-path');
  const donor = bundleOf('rekor1-dsse-mismatch-sig_fail');
  other.verificationMaterial.certificate = donor.verificationMaterial.certificate;
  assert.ok(failed(await logOnly(other)).includes('tlog.body') || failed(await logOnly(other)).includes('certificate.chain'));
});

test('the Rekor v1 checkpoint is held to the pinned log: origin, key and root', async () => {
  const wrongOrigin = clone(root);
  wrongOrigin.tlogs.find((l) => l.baseUrl === 'https://rekor.sigstore.dev').baseUrl = 'https://rekor.example.com';
  assert.ok(tlogReasons(await verifyTransparency(bundleOf('rekor1-dsse-happy-path'), wrongOrigin, { timestamps: 0 })).includes('tlog.checkpoint'));

  const damaged = bundleOf('rekor1-dsse-happy-path');
  const proof = damaged.verificationMaterial.tlogEntries[0].inclusionProof;
  proof.rootHash = Buffer.alloc(32, 7).toString('base64');
  assert.ok(tlogReasons(await logOnly(damaged)).length > 0);

  const prefixOrigin = bundleOf('rekor1-dsse-happy-path');
  const entry = prefixOrigin.verificationMaterial.tlogEntries[0];
  entry.inclusionProof.checkpoint.envelope = entry.inclusionProof.checkpoint.envelope.replace('rekor.sigstore.dev - ', 'rekor.sigstore.devX - ');
  assert.ok(tlogReasons(await logOnly(prefixOrigin)).includes('tlog.checkpoint'));
});

// dsse/0.0.2 has no production bundle yet; its body check is exercised directly, on bodies built from a real envelope.
function dsse002(facts, overrides = {}) {
  const spec = {
    dsseV002: {
      payloadHash: { algorithm: 'SHA2_256', digest: Buffer.from(sha256Hex(facts.payload), 'hex').toString('base64') },
      signatures: [{ content: facts.signature.toString('base64'), verifier: { x509Certificate: { rawBytes: facts.certificate.toString('base64') }, keyDetails: 'PKIX_ECDSA_P256_SHA_256' } }],
      ...overrides,
    },
  };
  const body = Buffer.from(JSON.stringify({ apiVersion: '0.0.2', kind: 'dsse', spec })).toString('base64');
  return { kindVersion: { kind: 'dsse', version: '0.0.2' }, canonicalizedBody: body };
}

const sample = () => {
  const bundle = bundleOf('rekor1-dsse-happy-path');
  const payload = Buffer.from(bundle.dsseEnvelope.payload, 'base64');
  return {
    payload: new Uint8Array(payload),
    signatures: [new Uint8Array(Buffer.from(bundle.dsseEnvelope.signatures[0].sig, 'base64'))],
    digest: new Uint8Array(32),
    signature: Buffer.from(bundle.dsseEnvelope.signatures[0].sig, 'base64'),
    certificate: Buffer.from(bundle.verificationMaterial.certificate.rawBytes, 'base64'),
  };
};

test('a Rekor v2 dsse/0.0.2 body must record this envelope\'s payload hash, signature and certificate', () => {
  const facts = sample();
  const certificate = new Uint8Array(facts.certificate);
  assert.equal(bodyProblem(dsse002(facts), facts, certificate), null);

  assert.match(bodyProblem(dsse002(facts, { payloadHash: { algorithm: 'SHA2_256', digest: Buffer.alloc(32, 1).toString('base64') } }), facts, certificate), /payload hash/);
  assert.match(bodyProblem(dsse002(facts, { payloadHash: { algorithm: 'SHA2_512', digest: Buffer.alloc(64, 1).toString('base64') } }), facts, certificate), /payload hash/);
  const forgedSignature = { ...facts, signature: Buffer.alloc(70, 3) };
  assert.match(bodyProblem(dsse002(forgedSignature), facts, certificate), /signature is not/);
  const otherCertificate = { ...facts, certificate: Buffer.alloc(40, 4) };
  assert.match(bodyProblem(dsse002(otherCertificate), facts, certificate), /certificate is not/);
  assert.match(bodyProblem(dsse002(facts, { signatures: [] }), facts, certificate), /signature is not/);
  assert.match(bodyProblem(dsse002(facts, { signatures: [{}] }), facts, certificate), /signature is not/);

  // A DSSE entry says nothing about a message-signature bundle.
  assert.match(bodyProblem(dsse002(facts), { ...facts, payload: undefined }, certificate), /not about a message-signature/);
  // A body of another kind than the entry declares.
  const lying = dsse002(facts);
  lying.kindVersion = { kind: 'dsse', version: '0.0.1' };
  assert.match(bodyProblem(lying, facts, certificate), /not the entry kind it declares|malformed/);
});

test('an entry kind that is none of the supported three is tlog.kind', async () => {
  for (const kindVersion of [
    { kind: 'intoto', version: '0.0.2' },
    { kind: 'hashedrekord', version: '0.0.1' },
    { kind: 'dsse', version: '0.0.3' },
    undefined,
  ]) {
    const bundle = bundleOf('rekor1-dsse-happy-path');
    bundle.verificationMaterial.tlogEntries[0].kindVersion = kindVersion;
    assert.ok(failed(await logOnly(bundle)).includes('tlog.kind'), JSON.stringify(kindVersion));
  }
});
