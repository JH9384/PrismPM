// The attestation bundle section (#267): schema, fixture statement, and agreement with prism-code's reader and writer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { blake3Hex } from '../../prism-code/src/blake3.mjs';
import { KIND } from '../../prism-code/src/archive.mjs';
import * as bundles from '../../prism-code/src/attestations.mjs';
import { ATTESTATION, ATTESTATION_BUNDLE, LABEL_PREFIX, PROOF_PREDICATE_TYPE, SECTION_KIND } from '../index.mjs';
import { validate } from './json-schema.mjs';
import { loadReference, readJson, schema } from './reference.mjs';

const ref = loadReference();
const fixture = readJson('fixtures/calculator-statement.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');
const valid = (path, value) => assert.deepEqual(validate(schema(path), value), [], path);
const rejects = (path, value, why) => assert.notDeepEqual(validate(schema(path), value), [], `${path} accepted ${why}`);
const strip = ({ $schema, $id, title, description, ...rest }) => rest;

/** An unsigned bundle around the fixture. The shape is real; the signature is a placeholder (signing is #272). */
const keyed = {
  mediaType: ATTESTATION_BUNDLE.MEDIA_TYPE,
  verificationMaterial: { publicKey: { hint: 'placeholder' } },
  dsseEnvelope: { payload: b64(fixture), payloadType: ATTESTATION.DSSE_PAYLOAD_TYPE, signatures: [{ keyid: '', sig: b64('not a real signature') }] },
};
/** The keyless shape cosign 3 writes: leaf certificate, one Rekor entry with proof, one timestamp. Values are placeholders. */
const keyless = {
  ...keyed,
  verificationMaterial: {
    certificate: { rawBytes: b64('DER') },
    tlogEntries: [
      {
        logIndex: '123456789',
        logId: { keyId: b64('log') },
        kindVersion: { kind: 'dsse', version: '0.0.1' },
        integratedTime: '1761177600',
        inclusionPromise: { signedEntryTimestamp: b64('set') },
        inclusionProof: { logIndex: '1234', rootHash: b64('root'), treeSize: '5678', hashes: [b64('h1')], checkpoint: { envelope: 'rekor.sigstore.dev - 1\n5678\n' } },
        canonicalizedBody: b64('body'),
      },
    ],
    timestampVerificationData: { rfc3161Timestamps: [{ signedTimestamp: b64('tsa') }] },
  },
};

test('the calculator fixture statement names the guest blob with both digests over the same bytes (ADR-015)', () => {
  valid(ATTESTATION.STATEMENT_SCHEMA, fixture);
  assert.equal(fixture.predicateType, PROOF_PREDICATE_TYPE);
  assert.equal(fixture.subject.length, 1);
  const [subject] = fixture.subject;
  const guest = ref.resolved.guest;
  assert.equal(subject.digest.blake3, blake3Hex(guest.content));
  assert.equal(`${LABEL_PREFIX}${subject.digest.blake3}`, guest.label);
  assert.equal(subject.digest.sha256, sha256(guest.content));
  assert.notEqual(subject.digest.blake3, ref.parsed.footer, 'a subject never names the footer');
  assert.notEqual(subject.digest.sha256, ref.sha256, 'a subject never names the whole file');
});

test('the bundle schema restates the DSSE envelope schema exactly', () => {
  assert.deepEqual(strip(schema(ATTESTATION_BUNDLE.SCHEMA).$defs.DsseEnvelope), strip(schema(ATTESTATION.ENVELOPE_SCHEMA)));
});

test('keyed and keyless bundles around the fixture validate', () => {
  valid(ATTESTATION_BUNDLE.SCHEMA, keyed);
  valid(ATTESTATION_BUNDLE.SCHEMA, keyless);
});

test('negative controls: the bundle schema rejects what Prism never writes', () => {
  const path = ATTESTATION_BUNDLE.SCHEMA;
  rejects(path, { ...keyed, mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.2' }, 'a v0.2 media type');
  rejects(path, { ...keyed, messageSignature: { signature: b64('x') } }, 'a messageSignature');
  rejects(path, { mediaType: keyed.mediaType, verificationMaterial: keyed.verificationMaterial }, 'no DSSE envelope');
  rejects(path, { ...keyed, verificationMaterial: { ...keyless.verificationMaterial, publicKey: { hint: 'both' } } }, 'certificate and public key');
  rejects(path, { ...keyed, verificationMaterial: { tlogEntries: [] } }, 'neither certificate nor public key');
  rejects(path, { ...keyed, verificationMaterial: { x509CertificateChain: { certificates: [] } } }, 'a v0.2 certificate chain');
  const entry = keyless.verificationMaterial.tlogEntries[0];
  rejects(path, { ...keyless, verificationMaterial: { ...keyless.verificationMaterial, tlogEntries: [{ ...entry, logIndex: 1 }] } }, 'an int64 as a JSON number');
  rejects(path, { ...keyed, dsseEnvelope: { ...keyed.dsseEnvelope, payloadType: 'text/plain' } }, 'a foreign payload type');
});

test('prism-code constants equal ATTESTATION_BUNDLE', () => {
  assert.equal(bundles.ATTESTATION_EXTENSION, ATTESTATION_BUNDLE.EXTENSION);
  assert.equal(bundles.BUNDLE_MEDIA_TYPE, ATTESTATION_BUNDLE.MEDIA_TYPE);
  assert.equal(bundles.STATEMENT_TYPE, ATTESTATION.STATEMENT_TYPE);
  assert.equal(bundles.DSSE_PAYLOAD_TYPE, ATTESTATION.DSSE_PAYLOAD_TYPE);
  assert.equal(bundles.OCI_MANIFEST_SUBJECT, ATTESTATION.OCI_MANIFEST_SUBJECT);
  assert.equal(ATTESTATION_BUNDLE.SECTION_KIND, SECTION_KIND.EXTENSION);
  assert.equal(KIND.EXTENSION, ATTESTATION_BUNDLE.SECTION_KIND);
});

test('a bundle appended by prism-code reads back as schema-valid bundle and statement', () => {
  const signed = bundles.appendAttestations(ref.bytes, [keyed, keyless]);
  const read = bundles.readAttestations(signed);
  assert.equal(read.length, 2);
  for (const attestation of read) {
    valid(ATTESTATION_BUNDLE.SCHEMA, attestation.bundle);
    valid(ATTESTATION.STATEMENT_SCHEMA, attestation.statement);
    assert.deepEqual(attestation.statement, fixture);
    assert.equal(attestation.resolved, true);
    assert.equal(attestation.subjects[0].blob, ref.resolved.guest.label);
  }
  assert.ok(Buffer.from(bundles.stripAttestations(signed)).equals(ref.bytes));
});
