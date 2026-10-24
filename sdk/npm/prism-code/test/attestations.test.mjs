// The attestation bundle section (#267): append, read back, strip, and the archive without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArchive, resolveArchive, KIND } from '../src/archive.mjs';
import { blake3Hex } from '../src/blake3.mjs';
import {
  ATTESTATION_EXTENSION,
  BUNDLE_MEDIA_TYPE,
  attestationSection,
  readAttestations,
  appendAttestations,
  stripAttestations,
  encodeArchive,
} from '../src/attestations.mjs';
import { load, PrismCodeError } from '../src/index.mjs';

const original = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
const pristine = original.slice();
const parsedOriginal = parseArchive(original);
const resolvedOriginal = resolveArchive(parsedOriginal);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const b64 = (text) => Buffer.from(text).toString('base64');

const GUEST_NAME = 'core-wasm/prism_calculator_core_wasm.wasm';
const guestSubject = {
  name: GUEST_NAME,
  digest: { blake3: blake3Hex(resolvedOriginal.guest.content), sha256: sha256(resolvedOriginal.guest.content) },
};

function statement(subject = [guestSubject], predicateType = 'https://uor.foundation/prism/proof/v1') {
  return { _type: 'https://in-toto.io/Statement/v1', subject, predicateType, predicate: {} };
}

/** An unsigned placeholder bundle: the shape is real, the signature is not. Signing is #272. */
function bundle(stmt = statement(), extra = {}) {
  return {
    mediaType: BUNDLE_MEDIA_TYPE,
    verificationMaterial: { publicKey: { hint: 'placeholder' }, tlogEntries: [] },
    dsseEnvelope: {
      payload: b64(JSON.stringify(stmt)),
      payloadType: 'application/vnd.in-toto+json',
      signatures: [{ keyid: '', sig: b64('not a real signature') }],
    },
    ...extra,
  };
}

const rejects = (fn, code) =>
  assert.throws(fn, (error) => error instanceof PrismCodeError && error.code === code, `expected ${code}`);

test('an archive without the section loads unchanged and has no attestations', async () => {
  assert.equal(attestationSection(original), null);
  assert.deepEqual(readAttestations(original), []);
  assert.ok(stripAttestations(original).every((b, i) => b === original[i]));
  assert.equal(stripAttestations(original).length, original.length);
  const app = await load(original);
  assert.deepEqual(app.attestations(), []);
  assert.equal(app.identities.archiveFingerprint, parsedOriginal.fingerprint);
  const result = await app.acceptance();
  assert.equal(result.failed.length, 0);
});

test('appending a bundle adds one last Extension row and keeps every original section byte-identical', () => {
  const signed = appendAttestations(original, [bundle()]);
  assert.ok(original.every((b, i) => b === pristine[i]), 'the input was modified');
  const parsed = parseArchive(signed);
  assert.equal(parsed.sections.length, 9);
  assert.equal(parsed.sections[8].kind, KIND.EXTENSION);
  assert.equal(parsed.extensions.at(-1).name, ATTESTATION_EXTENSION);
  for (let i = 0; i < 8; i++) {
    assert.equal(parsed.sections[i].kind, parsedOriginal.sections[i].kind, `row ${i} kind`);
    assert.ok(Buffer.from(parsed.sections[i].body).equals(Buffer.from(parsedOriginal.sections[i].body)), `row ${i} body`);
    assert.equal(parsed.sections[i].offset, parsedOriginal.sections[i].offset + 24, `row ${i} offset shifts by one table row`);
  }
  assert.equal(signed.length, original.length + 24 + parsed.sections[8].length);
});

test('the footer of the signed archive is BLAKE3 of its whole body, bundle included', () => {
  const signed = appendAttestations(original, [bundle()]);
  const parsed = parseArchive(signed);
  assert.equal(parsed.verification.footer, true);
  assert.equal(parsed.verification.labels, true);
  assert.equal(parsed.footer, blake3Hex(signed.subarray(0, signed.length - 32)));
  assert.notEqual(parsed.footer, parsedOriginal.footer);
  // Flipping one byte inside the bundle breaks the footer.
  const tampered = signed.slice();
  tampered[parsed.sections[8].offset + parsed.sections[8].length - 3] ^= 1;
  assert.equal(parseArchive(tampered).verification.footer, false);
});

test('the application identity does not move; only the archive fingerprint does', () => {
  const resolved = resolveArchive(parseArchive(appendAttestations(original, [bundle()])));
  const { archiveFingerprint, footer, ...rest } = resolved.identities;
  const { archiveFingerprint: was, footer: wasFooter, ...restOriginal } = resolvedOriginal.identities;
  assert.deepEqual(rest, restOriginal);
  assert.notEqual(archiveFingerprint, was);
  assert.equal(rest.verified, true);
});

test('the bundle reads back with its exact bytes, statement and resolved subjects', () => {
  const line = JSON.stringify(bundle());
  const signed = appendAttestations(original, [line]);
  const [attestation, ...more] = readAttestations(signed);
  assert.equal(more.length, 0);
  assert.equal(attestation.index, 0);
  assert.equal(Buffer.from(attestation.bytes).toString('utf8'), line);
  assert.equal(attestation.mediaType, BUNDLE_MEDIA_TYPE);
  assert.equal(attestation.predicateType, 'https://uor.foundation/prism/proof/v1');
  assert.deepEqual(attestation.statement, statement());
  assert.equal(attestation.resolved, true);
  assert.deepEqual(attestation.subjects, [{ ...guestSubject, blob: resolvedOriginal.guest.label }]);
  assert.equal(`blake3:${attestation.subjects[0].digest.blake3}`, resolvedOriginal.identities.guestKappa);
});

test('stripping the section returns the original archive byte for byte', () => {
  const once = appendAttestations(original, [bundle()]);
  const twice = appendAttestations(once, [bundle(statement([guestSubject], 'https://slsa.dev/provenance/v1'))]);
  for (const signed of [once, twice]) {
    const stripped = stripAttestations(signed);
    assert.ok(Buffer.from(stripped).equals(Buffer.from(original)));
  }
});

test('appending to a signed archive extends the same section in order', () => {
  const first = bundle();
  const second = bundle(statement([guestSubject], 'https://slsa.dev/provenance/v1'));
  const signed = appendAttestations(appendAttestations(original, [first]), [second]);
  const parsed = parseArchive(signed);
  assert.equal(parsed.sections.length, 9);
  assert.equal(parsed.extensions.filter((e) => e.name === ATTESTATION_EXTENSION).length, 1);
  assert.deepEqual(
    readAttestations(signed).map((a) => a.predicateType),
    ['https://uor.foundation/prism/proof/v1', 'https://slsa.dev/provenance/v1'],
  );
  // One call with both bundles produces the same bytes as two calls.
  assert.ok(Buffer.from(appendAttestations(original, [first, second])).equals(Buffer.from(signed)));
});

test('the signed archive loads, dispatches and exposes app.attestations()', async () => {
  const app = await load(appendAttestations(original, [bundle()]));
  const attestations = app.attestations();
  assert.equal(attestations.length, 1);
  assert.equal(attestations[0].subjects[0].name, GUEST_NAME);
  const result = await app.acceptance();
  assert.equal(result.total, 22);
  assert.equal(result.failed.length, 0);
});

test('a subject that names no blob of the archive is reported, not resolved', () => {
  const stranger = { name: 'other.wasm', digest: { blake3: '0'.repeat(64), sha256: '1'.repeat(64) } };
  const [attestation] = readAttestations(appendAttestations(original, [bundle(statement([guestSubject, stranger]))]));
  assert.equal(attestation.resolved, false);
  assert.equal(attestation.subjects[1].blob, null);
});

test('negative controls: malformed bundles are refused before anything is written', () => {
  rejects(() => appendAttestations(original, []), 'attestation.input');
  rejects(() => appendAttestations(original, [{ ...bundle(), mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.2' }]), 'attestation.bundle');
  rejects(() => appendAttestations(original, [bundle(statement(), { messageSignature: {} })]), 'attestation.bundle');
  rejects(() => appendAttestations(original, [{ ...bundle(), dsseEnvelope: { ...bundle().dsseEnvelope, payloadType: 'text/plain' } }]), 'attestation.envelope');
  rejects(() => appendAttestations(original, [{ ...bundle(), dsseEnvelope: { ...bundle().dsseEnvelope, signatures: [] } }]), 'attestation.envelope');
  rejects(() => appendAttestations(original, [bundle({ ...statement(), _type: 'https://in-toto.io/Statement/v0.1' })]), 'attestation.statement');
  rejects(() => appendAttestations(original, [bundle(statement([]))]), 'attestation.statement');
  rejects(
    () => appendAttestations(original, [bundle(statement([{ name: GUEST_NAME, digest: { blake3: guestSubject.digest.blake3 } }]))]),
    'attestation.subject',
  );
  rejects(
    () => appendAttestations(original, [bundle(statement([{ name: 'oci-manifest', digest: { sha256: '0'.repeat(64) } }, guestSubject]))]),
    'attestation.subject',
  );
  rejects(() => appendAttestations(original, [JSON.stringify(bundle(), null, 2)]), 'attestation.lines');
  rejects(() => appendAttestations(original, [bundle(), bundle()]), 'attestation.duplicate');
  rejects(() => appendAttestations(appendAttestations(original, [bundle()]), [bundle()]), 'attestation.duplicate');
  const corrupt = original.slice();
  corrupt[300] ^= 1;
  rejects(() => appendAttestations(corrupt, [bundle()]), 'attestation.footer');
});

function rows(extraRows, at = 8) {
  const kept = parsedOriginal.sections.map(({ kind, body }) => ({ kind, body }));
  kept.splice(at, 0, ...extraRows);
  return encodeArchive(kept);
}

function row(payloadText) {
  const name = Buffer.from(ATTESTATION_EXTENSION);
  const payload = Buffer.from(payloadText);
  const body = Buffer.concat([Buffer.from([name.length & 0xff, name.length >> 8]), name, payload]);
  return { kind: KIND.EXTENSION, body: new Uint8Array(body) };
}

test('negative controls: a misplaced, repeated, empty or blank-line section is refused on load', async () => {
  const line = `${JSON.stringify(bundle())}\n`;
  assert.ok(Buffer.from(rows([])).equals(Buffer.from(original)), 'encodeArchive reproduces the original from its rows');
  assert.equal(readAttestations(rows([row(line)])).length, 1);
  rejects(() => readAttestations(rows([row(line)], 4)), 'attestation.position');
  await assert.rejects(load(rows([row(line)], 4)), (error) => error.code === 'attestation.position');
  rejects(() => readAttestations(rows([row(line), row(line)])), 'attestation.duplicate');
  rejects(() => readAttestations(rows([row('')])), 'attestation.lines');
  rejects(() => readAttestations(rows([row(line.trimEnd())])), 'attestation.lines');
  rejects(() => readAttestations(rows([row(`${line}\n${line}`)])), 'attestation.lines');
  rejects(() => readAttestations(rows([row('{"mediaType":1}\n')])), 'attestation.bundle');
});
