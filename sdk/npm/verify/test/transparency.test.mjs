// Transparency log entries and signed timestamps (#275), checked offline against real Sigstore staging bundles.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { DerError, ecdsaToRaw, parse, time } from '../src/asn1.mjs';
import { VerifyError, verifyTransparency } from '../src/index.mjs';
import { fromBase64, inclusionHolds, readTrustedRoot } from '../src/transparency.mjs';
import { validate } from '../src/vendor/json-schema.mjs';
import { here } from './helpers.mjs';

const CASES = here('fixtures/sigstore-conformance/');
const read = (name, file) => JSON.parse(readFileSync(`${CASES}${name}/${file}`, 'utf8'));
const load = (name) => ({ bundle: read(name, 'bundle.sigstore.json'), root: read(name, 'trusted_root.json') });
const run = (name) => {
  const { bundle, root } = load(name);
  return verifyTransparency(bundle, root);
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const failed = (result) => [...new Set(result.reasons.map((r) => r.check))];

// What each case must give. `time` is the earliest verified timestamp.
const ACCEPTED = {
  'rekor2-happy-path': '2025-06-12T12:02:20.000Z',
  'rekor2-dsse-happy-path': '2026-05-13T19:23:33.000Z',
  'rekor2-timestamp-with-embedded-cert': '2025-08-06T18:51:36.000Z',
  'rekor2-timestamp-without-embedded-cert': '2025-08-06T19:03:51.000Z',
  'rekor2-timestamp-with-expired-cert-chain': '2025-08-07T15:32:26.000Z',
  'trust-root-tsa-validity-end-inclusive': '2025-06-12T12:02:20.000Z',
  'rekor2-checkpoint-cosigned': '2025-06-12T12:02:20.000Z',
  'rekor2-checkpoint-origin-not-first': '2025-06-12T12:02:20.000Z',
  'rekor2-checkpoint-two-sigs-from-origin': '2025-06-12T12:02:20.000Z',
};
const REJECTED = {
  'rekor2-no-timestamp_fail': ['timestamp.count', 'certificate.chain'],
  'rekor2-timestamp-outside-trust-root-tsa-validity_fail': ['timestamp'],
  'rekor2-timestamp-outside-tsa-cert-validity_fail': ['timestamp'],
  'rekor2-timestamp-payload-mismatch_fail': ['timestamp'],
  'rekor2-timestamp-untrusted-tsa-with-embedded-cert_fail': ['timestamp'],
  'rekor2-timestamp-untrusted-tsa-without-embedded-cert_fail': ['timestamp'],
  'rekor2-timestamp-with-incorrect-time_fail': ['timestamp'],
  'rekor2-no-inclusion-proof_fail': ['tlog.inclusion'],
  'rekor2-checkpoint-missing-log-signature_fail': ['tlog.checkpoint'],
  'rekor2-checkpoint-no-matching-signature_fail': ['tlog.checkpoint'],
  'rekor2-checkpoint-missing-size_fail': ['tlog.checkpoint'],
  'rekor2-dsse-mismatch-envelope_fail': ['tlog.body'],
  'rekor2-dsse-mismatch-sig_fail': ['tlog.body'],
};

test('every Sigstore conformance bundle that should verify does, with its signed time', async () => {
  for (const [name, signedAt] of Object.entries(ACCEPTED)) {
    const result = await run(name);
    assert.deepEqual(result.reasons, [], name);
    assert.equal(result.passed, true, name);
    assert.equal(result.time, signedAt, name);
    assert.ok(result.checks.every((c) => c.passed), name);
  }
});

test('every Sigstore conformance bundle that should fail names the failing check', async () => {
  for (const [name, checks] of Object.entries(REJECTED)) {
    const result = await run(name);
    assert.equal(result.passed, false, name);
    for (const check of checks) assert.ok(failed(result).includes(check), `${name}: expected ${check} in ${failed(result)}`);
    assert.ok(result.reasons.every((r) => r.withholds === 'P1' && typeof r.message === 'string' && r.message.length > 0), name);
  }
});

test('the case lists cover every fixture folder, and each folder says where it came from', () => {
  const listed = Object.keys({ ...ACCEPTED, ...REJECTED }).sort();
  const onDisk = readdirSync(CASES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(onDisk, listed);
  assert.ok(readFileSync(`${CASES}SOURCE.md`, 'utf8').includes('sigstore/sigstore-conformance'));
  for (const name of listed) assert.equal(name.endsWith('_fail'), name in REJECTED, name);
});

test('a log entry that is changed anywhere no longer verifies', async () => {
  const mutations = {
    'a proof hash': (b) => (b.verificationMaterial.tlogEntries[0].inclusionProof.hashes[3] = b.verificationMaterial.tlogEntries[0].inclusionProof.hashes[4]),
    'a missing proof hash': (b) => b.verificationMaterial.tlogEntries[0].inclusionProof.hashes.pop(),
    'the root hash': (b) => (b.verificationMaterial.tlogEntries[0].inclusionProof.rootHash = b.verificationMaterial.tlogEntries[0].inclusionProof.hashes[0]),
    'the tree size': (b) => (b.verificationMaterial.tlogEntries[0].inclusionProof.treeSize = '4026480'),
    'the entry body': (b) => {
      const body = JSON.parse(Buffer.from(b.verificationMaterial.tlogEntries[0].canonicalizedBody, 'base64').toString());
      body.spec.hashedRekordV002.data.digest = Buffer.alloc(32, 1).toString('base64');
      b.verificationMaterial.tlogEntries[0].canonicalizedBody = Buffer.from(JSON.stringify(body)).toString('base64');
    },
    'the log index': (b) => (b.verificationMaterial.tlogEntries[0].logIndex = '4026477'),
    'the checkpoint text': (b) => {
      const proof = b.verificationMaterial.tlogEntries[0].inclusionProof;
      proof.checkpoint.envelope = proof.checkpoint.envelope.replace('log2025-alpha3.rekor.sigstage.dev\n', 'log2025-alpha3.rekor.sigstage.dev\n0');
    },
  };
  for (const [what, mutate] of Object.entries(mutations)) {
    const { bundle, root } = load('rekor2-dsse-happy-path');
    mutate(bundle);
    const result = await verifyTransparency(bundle, root);
    assert.equal(result.passed, false, what);
    assert.ok(failed(result).some((c) => c.startsWith('tlog.')), `${what}: ${failed(result)}`);
  }
});

test('the log, the entry kind and the counts are policy, not hints', async () => {
  let { bundle, root } = load('rekor2-dsse-happy-path');
  bundle.verificationMaterial.tlogEntries[0].logId.keyId = Buffer.alloc(32, 9).toString('base64');
  assert.ok(failed(await verifyTransparency(bundle, root)).includes('tlog.log'));

  ({ bundle, root } = load('rekor2-dsse-happy-path'));
  bundle.verificationMaterial.tlogEntries[0].kindVersion = { kind: 'intoto', version: '0.0.2' };
  assert.ok(failed(await verifyTransparency(bundle, root)).includes('tlog.kind'));

  ({ bundle, root } = load('rekor2-dsse-happy-path'));
  bundle.verificationMaterial.tlogEntries = [];
  assert.deepEqual(failed(await verifyTransparency(bundle, root)), ['tlog.count']);
  assert.equal((await verifyTransparency(bundle, root, { entries: 0 })).passed, true);

  ({ bundle, root } = load('rekor2-dsse-happy-path'));
  assert.ok(failed(await verifyTransparency(bundle, root, { entries: 2 })).includes('tlog.count'));
  assert.ok(failed(await verifyTransparency(bundle, root, { timestamps: 2 })).includes('timestamp.count'));

  // A log pinned for a period that has not begun does not vouch for the checkpoint.
  ({ bundle, root } = load('rekor2-dsse-happy-path'));
  const log = root.tlogs.find((l) => l.logId.keyId === bundle.verificationMaterial.tlogEntries[0].logId.keyId);
  log.publicKey.validFor.start = '2027-01-01T00:00:00Z';
  assert.ok(failed(await verifyTransparency(bundle, root)).includes('tlog.checkpoint'));
});

test('the timestamp covers this bundle\'s signature, and the certificate must have been valid then', async () => {
  const { bundle, root } = load('rekor2-dsse-happy-path');
  const signature = Buffer.from(bundle.dsseEnvelope.signatures[0].sig, 'base64');
  signature[10] ^= 1;
  bundle.dsseEnvelope.signatures[0].sig = signature.toString('base64');
  const result = await verifyTransparency(bundle, root);
  assert.ok(failed(result).includes('timestamp'));
  assert.ok(failed(result).includes('tlog.body'));

  const other = load('rekor2-dsse-happy-path');
  other.bundle.verificationMaterial.certificate.rawBytes = load('rekor2-happy-path').bundle.verificationMaterial.certificate.rawBytes;
  const swapped = await verifyTransparency(other.bundle, other.root);
  assert.ok(failed(swapped).includes('timestamp'), 'a certificate that was not valid at the signed time');
  assert.ok(failed(swapped).includes('tlog.body'), 'a certificate the log did not record');

  const forged = load('rekor2-dsse-happy-path');
  const certificate = Buffer.from(forged.bundle.verificationMaterial.certificate.rawBytes, 'base64');
  certificate[certificate.length - 5] ^= 1;
  forged.bundle.verificationMaterial.certificate.rawBytes = certificate.toString('base64');
  assert.ok(failed(await verifyTransparency(forged.bundle, forged.root)).includes('certificate.chain'));
});

test('the signed time, not the clock, decides which keys apply: a chain that has since expired still verifies', async () => {
  const { bundle, root } = load('rekor2-timestamp-with-expired-cert-chain');
  const tsa = root.timestampAuthorities.find((a) => a.validFor.end);
  assert.ok(tsa === undefined || Date.parse(tsa.validFor.end) < Date.now());
  assert.equal((await verifyTransparency(bundle, root)).passed, true);
});

test('without WebCrypto the answer is a reason, never a pass', async () => {
  const { bundle, root } = load('rekor2-dsse-happy-path');
  const result = await verifyTransparency(bundle, root, { crypto: {} });
  assert.equal(result.passed, false);
  assert.ok(failed(result).includes('crypto.unavailable'));
});

test('a trusted root that is not usable is an error, a bundle that is not an object is an error', async () => {
  const { bundle, root } = load('rekor2-dsse-happy-path');
  const bad = async (value, code) => {
    await assert.rejects(verifyTransparency(bundle, value), (e) => e instanceof VerifyError && e.code === code);
  };
  await bad(null, 'trustedroot.invalid');
  await bad({ ...root, mediaType: 'text/plain' }, 'trustedroot.invalid');
  await bad({ ...root, tlogs: 'none' }, 'trustedroot.invalid');
  await bad({ ...root, timestampAuthorities: [{ certChain: { certificates: [{ rawBytes: 'AAAA' }] }, validFor: { start: '2025-01-01T00:00:00Z' } }] }, 'trustedroot.invalid');
  await bad({ ...root, tlogs: [{ ...root.tlogs[0], publicKey: { ...root.tlogs[0].publicKey, validFor: {} } }] }, 'trustedroot.invalid');
  await assert.rejects(verifyTransparency(null, root), (e) => e instanceof VerifyError && e.code === 'input');
  await assert.rejects(verifyTransparency([], root), (e) => e instanceof VerifyError && e.code === 'input');
  assert.equal(readTrustedRoot(root).tlogs.length, root.tlogs.length);
});

test('a bundle with neither envelope nor message signature is a reason', async () => {
  const { bundle, root } = load('rekor2-dsse-happy-path');
  delete bundle.dsseEnvelope;
  const result = await verifyTransparency(bundle, root);
  assert.deepEqual(failed(result), ['bundle.shape']);
});

// --------------------------------------------------------------- Merkle proofs

const hash = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
const leafHash = (data) => hash(Buffer.from([0]), data);
/** RFC 9162 section 2.1.1: the tree hash by definition, and the audit path by definition (section 2.1.3.1). */
function treeHash(leaves) {
  if (leaves.length === 0) return createHash('sha256').digest();
  if (leaves.length === 1) return leafHash(leaves[0]);
  const k = 2 ** Math.floor(Math.log2(leaves.length - 1));
  return hash(Buffer.from([1]), treeHash(leaves.slice(0, k)), treeHash(leaves.slice(k)));
}
function path(index, leaves) {
  if (leaves.length === 1) return [];
  const k = 2 ** Math.floor(Math.log2(leaves.length - 1));
  return index < k ? [...path(index, leaves.slice(0, k)), treeHash(leaves.slice(k))] : [...path(index - k, leaves.slice(k)), treeHash(leaves.slice(0, k))];
}

test('inclusion proofs recompute for every leaf of every tree up to 40 leaves (RFC 9162)', () => {
  for (let size = 1; size <= 40; size++) {
    const leaves = Array.from({ length: size }, (_, i) => Buffer.from(`entry ${i}`));
    const root = treeHash(leaves);
    for (let index = 0; index < size; index++) {
      const proof = path(index, leaves);
      assert.equal(inclusionHolds(leaves[index], index, size, proof, root), true, `${index} of ${size}`);
      assert.equal(inclusionHolds(Buffer.from('other'), index, size, proof, root), false, `wrong leaf, ${index} of ${size}`);
      assert.equal(inclusionHolds(leaves[index], index, size, proof, hash(root)), false, `wrong root, ${index} of ${size}`);
      if (size > 1) {
        assert.equal(inclusionHolds(leaves[index], (index + 1) % size, size, proof, root), false, `wrong index, ${index} of ${size}`);
        assert.equal(inclusionHolds(leaves[index], index, size, [...proof, hash(root)], root), false, `extra hash, ${index} of ${size}`);
        assert.equal(inclusionHolds(leaves[index], index, size, proof.slice(1), root), false, `short path, ${index} of ${size}`);
      }
    }
    assert.equal(inclusionHolds(leaves[0], size, size, [], root), false, 'an index past the tree');
  }
});

// ---------------------------------------------------------------------- DER

test('the DER reader refuses what it cannot read exactly', () => {
  assert.throws(() => parse(Uint8Array.of(0x30, 0x80, 0x00, 0x00)), DerError, 'indefinite length is BER');
  assert.throws(() => parse(Uint8Array.of(0x30, 0x05, 0x01)), DerError, 'runs past its container');
  assert.throws(() => parse(Uint8Array.of(0x30)), DerError, 'truncated');
  assert.throws(() => parse(Uint8Array.of(0x1f, 0x01, 0x00)), DerError, 'high tag number');
  assert.equal(parse(Uint8Array.of(0x04, 0x81, 0x03, 1, 2, 3)).body.length, 3);
});

test('times and ECDSA signatures decode', () => {
  const ascii = (text) => Uint8Array.from(Buffer.from(text));
  assert.equal(time({ tag: 0x18, body: ascii('20260513192333Z') }), Date.UTC(2026, 4, 13, 19, 23, 33));
  assert.equal(time({ tag: 0x18, body: ascii('20260513192333.250Z') }), Date.UTC(2026, 4, 13, 19, 23, 33) + 250);
  assert.equal(time({ tag: 0x17, body: ascii('491231235959Z') }), Date.UTC(2049, 11, 31, 23, 59, 59));
  assert.equal(time({ tag: 0x17, body: ascii('500101000000Z') }), Date.UTC(1950, 0, 1));
  assert.throws(() => time({ tag: 0x18, body: ascii('2026-05-13') }), DerError);
  // r = 0xff behind two leading zeros, s = 0x01
  const raw = ecdsaToRaw(Uint8Array.of(0x30, 0x08, 0x02, 0x03, 0x00, 0x00, 0xff, 0x02, 0x01, 0x01), 32);
  assert.equal(raw.length, 64);
  assert.equal(raw[31], 0xff);
  assert.equal(raw[63], 0x01);
  assert.throws(() => ecdsaToRaw(Uint8Array.of(0x30, 0x07, 0x02, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01), 1), DerError);
  assert.deepEqual([...fromBase64('AQID')], [1, 2, 3]);
  assert.deepEqual([...fromBase64('AQI=')], [1, 2]);
  assert.deepEqual([...fromBase64('-_8')], [0xfb, 0xff]);
  assert.throws(() => fromBase64('a$b'));
});

// ---------------------------------------------------------- spec agreement

test('the bundles and trusted roots validate against the spec schemas', () => {
  const schema = (path) => JSON.parse(readFileSync(here(`../../spec/${path}`), 'utf8'));
  const bundleSchema = schema('schemas/attestation/sigstore-bundle.schema.json');
  const rootSchema = schema('schemas/attestation/trusted-root.schema.json');
  for (const name of ['rekor2-dsse-happy-path', 'rekor2-dsse-mismatch-envelope_fail', 'rekor2-dsse-mismatch-sig_fail']) {
    const { bundle, root } = load(name);
    assert.deepEqual(validate(bundleSchema, bundle), [], `${name} bundle`);
    assert.deepEqual(validate(rootSchema, root), [], `${name} trusted root`);
  }
  // A Rekor v2 entry has no integratedTime; the schema must allow that and still reject a non-string one.
  const { bundle } = load('rekor2-dsse-happy-path');
  assert.equal('integratedTime' in bundle.verificationMaterial.tlogEntries[0], false);
  const withNumber = clone(bundle);
  withNumber.verificationMaterial.tlogEntries[0].integratedTime = 1;
  assert.notDeepEqual(validate(bundleSchema, withNumber), []);
});
