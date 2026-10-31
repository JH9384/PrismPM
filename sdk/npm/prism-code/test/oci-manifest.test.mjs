// The registry objects of a holo (#292): canonical bytes, pinned by fixtures, and the shapes cosign reads (ADR-015).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../src/archive.mjs';
import { blake3Hex } from '../src/blake3.mjs';
import { sha256Hex } from '../src/sha256.mjs';
import { readAttestations, BUNDLE_MEDIA_TYPE } from '../src/attestations.mjs';
import { OCI, ATTESTATION_BUNDLE } from '../../spec/constants.mjs';
import { ANNOTATION, BUNDLE_CONTENT, CREATED, EMPTY_BYTES, EMPTY_DESCRIPTOR, HOLO_MEDIA_TYPE, MANIFEST_MEDIA_TYPE, fingerprintTag, holoLayerOf, holoManifest, referrerManifest, referrersTag, registryStatement, registryStatements } from '../src/oci-manifest.mjs';

const read = (name) => new Uint8Array(readFileSync(new URL(name, import.meta.url)));
const plain = read('../fixtures/Calculator.holo');
const signed = read('./fixtures/attestation/Calculator.signed.holo');
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const isCanonical = (bytes) => canonicalJson(JSON.parse(Buffer.from(bytes).toString('utf8'))) === Buffer.from(bytes).toString('utf8');

test('the manifest of the reference holo is the committed bytes, and they are canonical', async () => {
  const fixture = read('./fixtures/oci/Calculator.manifest.json');
  const built = await holoManifest(plain);
  assert.ok(same(built.bytes, fixture), Buffer.from(built.bytes).toString());
  assert.ok(isCanonical(fixture));
  assert.equal(built.digest, `sha256:${await sha256Hex(fixture)}`);
  assert.equal(built.digest, 'sha256:208bb91cc9984112b3992b0a051c1f1b28d59e57266e208244d469f09b1bb5e4');
});

test('the manifest and the first referrer of the signed holo are the committed bytes, and canonical', async () => {
  const built = await holoManifest(signed);
  assert.ok(same(built.bytes, read('./fixtures/oci/Calculator.signed.manifest.json')));
  const [first] = readAttestations(signed);
  const referrer = await referrerManifest(first.bytes, built.descriptor, first.predicateType);
  const fixture = read('./fixtures/oci/Calculator.signed.referrer-0.json');
  assert.ok(same(referrer.bytes, fixture), Buffer.from(referrer.bytes).toString());
  assert.ok(isCanonical(fixture));
});

test('the manifest is a pure function of the bytes: the fields of the proposal and nothing that varies', async () => {
  const first = await holoManifest(plain);
  const second = await holoManifest(plain.slice());
  assert.ok(same(first.bytes, second.bytes));
  const { manifest, layer, fingerprint, name } = first;
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.mediaType, MANIFEST_MEDIA_TYPE);
  assert.equal(manifest.artifactType, HOLO_MEDIA_TYPE);
  assert.deepEqual(manifest.config, EMPTY_DESCRIPTOR);
  assert.equal(`sha256:${await sha256Hex(EMPTY_BYTES)}`, EMPTY_DESCRIPTOR.digest);
  assert.equal(Buffer.from(EMPTY_DESCRIPTOR.data, 'base64').toString(), '{}');
  assert.equal(manifest.layers.length, 1);
  assert.equal(layer.mediaType, HOLO_MEDIA_TYPE);
  assert.equal(layer.size, plain.length);
  assert.equal(name, 'Calculator');
  assert.equal(manifest.annotations[ANNOTATION.CREATED], CREATED);
  assert.equal(manifest.annotations[ANNOTATION.TITLE], 'Calculator');
  assert.equal(layer.annotations[ANNOTATION.TITLE], 'Calculator.holo');
  assert.equal(holoLayerOf(manifest), layer);
  assert.equal(holoLayerOf({ layers: [layer, layer] }), null);
  assert.equal(holoLayerOf({ layers: [{ mediaType: 'other' }] }), null);
});

test('both digests sit side by side: sha256 in the descriptor, blake3 over the same bytes, and the footer on its own', async () => {
  const { layer, fingerprint, manifest } = await holoManifest(signed);
  assert.equal(layer.digest, `sha256:${await sha256Hex(signed)}`);
  assert.equal(layer.annotations[ANNOTATION.BLAKE3], blake3Hex(signed));
  // The footer covers every byte before it, so it is not the BLAKE3 of the file (ADR-015 rules 9 and 10).
  assert.equal(fingerprint, `blake3:${blake3Hex(signed.subarray(0, signed.length - 32))}`);
  assert.notEqual(`blake3:${layer.annotations[ANNOTATION.BLAKE3]}`, fingerprint);
  assert.equal(manifest.annotations[ANNOTATION.FINGERPRINT], fingerprint);
  // Every descriptor is sha256: registries refuse anything else (ADR-015 rule 11).
  assert.match(layer.digest, /^sha256:/);
  assert.match(manifest.config.digest, /^sha256:/);
});

test('signing the holo changes the manifest digest, and the application identity stays', async () => {
  const a = await holoManifest(plain);
  const b = await holoManifest(signed);
  assert.notEqual(a.digest, b.digest);
  assert.equal(a.manifest.annotations[ANNOTATION.APPLICATION], b.manifest.annotations[ANNOTATION.APPLICATION]);
});

test('a referrer copies the layout cosign writes, and its layer is the attestation line (#267 rule 10)', async () => {
  const built = await holoManifest(signed);
  const [first] = readAttestations(signed);
  const { manifest, descriptor, layer, digest } = await referrerManifest(first.bytes, built.descriptor, first.predicateType);
  assert.equal(manifest.artifactType, BUNDLE_MEDIA_TYPE);
  assert.equal(BUNDLE_MEDIA_TYPE, 'application/vnd.dev.sigstore.bundle.v0.3+json');
  assert.deepEqual(manifest.config, EMPTY_DESCRIPTOR);
  assert.equal(manifest.layers.length, 1);
  assert.equal(layer.mediaType, BUNDLE_MEDIA_TYPE);
  assert.equal(layer.digest, `sha256:${await sha256Hex(first.bytes)}`);
  assert.equal(layer.size, first.bytes.length);
  assert.deepEqual(manifest.subject, built.descriptor);
  assert.equal(manifest.annotations[ANNOTATION.BUNDLE_CONTENT], 'dsse-envelope');
  assert.equal(manifest.annotations[ANNOTATION.BUNDLE_PREDICATE], first.predicateType);
  assert.deepEqual(descriptor, { mediaType: MANIFEST_MEDIA_TYPE, digest, size: JSON.stringify(manifest).length, artifactType: BUNDLE_MEDIA_TYPE, annotations: manifest.annotations });
});

test('the registry-facing statement names the manifest first, with sha256 only, then the same blobs (ADR-015)', async () => {
  const built = await holoManifest(signed);
  const [first] = readAttestations(signed);
  const statement = registryStatement(first.statement, built.digest);
  assert.deepEqual(statement.subject[0], { name: 'oci-manifest', digest: { sha256: built.digest.slice('sha256:'.length) } });
  assert.deepEqual(statement.subject.slice(1), first.statement.subject);
  assert.equal(statement.predicateType, first.statement.predicateType);
  assert.deepEqual(statement.predicate, first.statement.predicate);
  for (const subject of statement.subject.slice(1)) assert.deepEqual(Object.keys(subject.digest).sort(), ['blake3', 'sha256']);
});

test('one registry-facing statement per distinct predicate, in section order', async () => {
  const all = readAttestations(signed);
  const statements = registryStatements(all, 'sha256:' + 'b'.repeat(64));
  assert.deepEqual(statements.map((s) => s.predicateType), [...new Set(all.map((a) => a.predicateType))]);
  const repeated = registryStatements([all[0], all[0]], 'sha256:' + 'b'.repeat(64));
  assert.equal(repeated.length, 1);
  assert.deepEqual(registryStatements([], 'sha256:' + 'b'.repeat(64)), []);
});

test('the tags are shaped as the spec and the proposal say', () => {
  assert.equal(referrersTag('sha256:' + 'c'.repeat(64)), `sha256-${'c'.repeat(64)}`);
  assert.equal(fingerprintTag('blake3:' + 'c'.repeat(64)), `blake3-${'c'.repeat(64)}`);
  // The longest legal tag is 128 characters, and both fit.
  assert.ok(`blake3-${'c'.repeat(64)}`.length <= 128);
});

test("the values that go into a manifest are the spec package's", () => {
  assert.equal(HOLO_MEDIA_TYPE, OCI.HOLO_MEDIA_TYPE);
  assert.equal(CREATED, OCI.CREATED);
  assert.equal(ANNOTATION.FINGERPRINT, OCI.ANNOTATIONS.FINGERPRINT);
  assert.equal(ANNOTATION.APPLICATION, OCI.ANNOTATIONS.APPLICATION);
  assert.equal(ANNOTATION.BLAKE3, OCI.ANNOTATIONS.BLAKE3);
  assert.ok(fingerprintTag(`blake3:${'c'.repeat(64)}`).startsWith(OCI.FINGERPRINT_TAG_PREFIX));
  assert.equal(BUNDLE_MEDIA_TYPE, ATTESTATION_BUNDLE.MEDIA_TYPE);
  assert.equal(ANNOTATION.BUNDLE_CONTENT, ATTESTATION_BUNDLE.OCI_ANNOTATIONS.CONTENT);
  assert.equal(ANNOTATION.BUNDLE_PREDICATE, ATTESTATION_BUNDLE.OCI_ANNOTATIONS.PREDICATE_TYPE);
  assert.equal(BUNDLE_CONTENT, ATTESTATION_BUNDLE.OCI_CONTENT);
});
