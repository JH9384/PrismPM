// `attest` and `verify-attestation` (#272): keyed round trips, the identity policy, and every typed refusal.
// The keyless path against the public Sigstore instance runs in CI (.github/workflows/npm-prism-code.yml, job
// "keyless"); here the keyless checks run offline against the Sigstore conformance bundles that #275 vendors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PrismError,
  SigningError,
  SignatureInvalidError,
  IdentityMismatchError,
  TransparencyError,
  SubjectMismatchError,
  AttestationNotFoundError,
  TrustRootError,
  VerificationError,
  ERROR_CLASSES,
  parseArchive,
  readAttestations,
  appendAttestations,
  stripAttestations,
  blake3Hex,
} from '../src/index.mjs';
import { experimental_attest as attest, experimental_verifyAttestations as verifyAttestations, experimental_verifyBundle as verifyBundle, GITHUB_ACTIONS_ISSUER } from '../src/attest.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const holo = new Uint8Array(readFileSync(here('../fixtures/Calculator.holo')));
const PROOF = 'https://uor.foundation/prism/proof/v1';
const PROVENANCE = 'https://slsa.dev/provenance/v1';

const pem = (key, type) => key.export({ type, format: 'pem' });
function keys(type = 'ec') {
  const pair = type === 'ec' ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : generateKeyPairSync(type);
  return { privateKey: pem(pair.privateKey, 'pkcs8'), publicKey: pem(pair.publicKey, 'spki'), pair };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A keyed DSSE bundle signed by hand, so a test can sign a statement `attest` would never write. */
function signByHand(statement, privateKeyPem) {
  const payload = Buffer.from(JSON.stringify(statement));
  const type = 'application/vnd.in-toto+json';
  const pae = Buffer.concat([Buffer.from(`DSSEv1 ${type.length} ${type} ${payload.length} `), payload]);
  const signature = cryptoSign('sha256', pae, privateKeyPem);
  return {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: { publicKey: { hint: 'by-hand' } },
    dsseEnvelope: { payload: payload.toString('base64'), payloadType: type, signatures: [{ sig: signature.toString('base64') }] },
  };
}

async function rejects(promise, Class, check) {
  const error = await promise.then(
    () => assert.fail('expected a rejection'),
    (e) => e,
  );
  assert.ok(error instanceof Class, `${error.constructor.name}: ${error.message}`);
  if (check) assert.equal(error.check, check, error.message);
  return error;
}

test('the attestation error classes are PrismErrors with their own stable codes', () => {
  const classes = [SigningError, SignatureInvalidError, IdentityMismatchError, TransparencyError, SubjectMismatchError, AttestationNotFoundError, TrustRootError];
  assert.deepEqual(
    classes.map((C) => C.code),
    ['signing_failed', 'signature_invalid', 'identity_mismatch', 'transparency_failed', 'subject_mismatch', 'attestation_not_found', 'trust_root_invalid'],
  );
  for (const C of classes) {
    const error = new C('message', { check: 'x.y' });
    assert.ok(error instanceof PrismError && error instanceof Error);
    assert.equal(error.code, C.code);
    assert.equal(error.name, C.name);
    assert.equal(error.check, 'x.y');
    assert.equal(ERROR_CLASSES[C.code], C);
  }
});

for (const type of ['ec', 'ed25519']) {
  test(`a ${type} key signs a statement into the holo and verifies, offline`, async () => {
    const { privateKey, publicKey } = keys(type);
    const before = holo.slice();
    const out = await attest(holo, { type: PROOF, predicate: { verifier: 'lean4', accepted: true }, key: privateKey });
    assert.deepEqual(holo, before, 'the input holo is not modified');
    assert.equal(out.attestations, 1);
    assert.equal(out.statement.predicateType, PROOF);
    assert.deepEqual(out.statement.predicate, { verifier: 'lean4', accepted: true });

    // The section is the bundle exactly as signed; the unsigned holo is recoverable byte for byte.
    const [stored] = readAttestations(out.holo);
    assert.equal(stored.resolved, true);
    assert.deepEqual(stored.bundle, out.bundle);
    assert.deepEqual(stripAttestations(out.holo), holo);

    // The subject is the guest blob with both digests, recomputed from its bytes.
    const guest = parseArchive(holo).blobs.find((b) => b.label === 'blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380');
    assert.deepEqual(out.statement.subject, [{ name: 'guest', digest: { sha256: sha256(guest.content), blake3: blake3Hex(guest.content) } }]);

    const result = await verifyAttestations(out.holo, { key: publicKey, type: PROOF });
    assert.equal(result.passed, true);
    assert.equal(result.error, null);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].signer.identity, null);
    assert.match(result.results[0].signer.keyId, /^[0-9a-f]{64}$/);
    assert.equal(result.results[0].time, null);
  });
}

test('several attestations: a type selects which bundles are checked', async () => {
  const a = keys();
  const b = keys();
  const first = await attest(holo, { type: PROOF, predicate: { n: 1 }, key: a.privateKey });
  const second = await attest(first.holo, { type: PROVENANCE, predicate: { n: 2 }, key: b.privateKey, subjects: ['guest', 'view', 'copy=model'] });
  assert.equal(second.attestations, 2);
  assert.deepEqual(second.statement.subject.map((s) => s.name), ['guest', 'view', 'copy']);

  assert.equal((await verifyAttestations(second.holo, { key: a.publicKey, type: PROOF })).passed, true);
  assert.equal((await verifyAttestations(second.holo, { key: b.publicKey, type: PROVENANCE })).passed, true);

  // Without a type every bundle is checked; the result passes when one does, and says which did not.
  const all = await verifyAttestations(second.holo, { key: a.publicKey });
  assert.equal(all.passed, true);
  assert.deepEqual(all.results.map((r) => r.passed), [true, false]);
  assert.ok(all.results[1].error instanceof SignatureInvalidError);

  // One key that signed neither: nothing passes, and the result carries the first failure.
  const none = await verifyAttestations(second.holo, { key: keys().publicKey });
  assert.equal(none.passed, false);
  assert.ok(none.error instanceof SignatureInvalidError);
});

test('the wrong key is a SignatureInvalidError, and throw: true throws it', async () => {
  const { privateKey } = keys();
  const { holo: signed } = await attest(holo, { type: PROOF, predicate: {}, key: privateKey });
  const result = await verifyAttestations(signed, { key: keys().publicKey, type: PROOF });
  assert.equal(result.passed, false);
  assert.ok(result.error instanceof SignatureInvalidError);
  assert.equal(result.error.code, 'signature_invalid');
  assert.match(result.error.check, /^signature\./);
  await rejects(verifyAttestations(signed, { key: keys().publicKey, type: PROOF, throw: true }), SignatureInvalidError);
});

test('a holo without the requested attestation is an AttestationNotFoundError', async () => {
  const { publicKey, privateKey } = keys();
  const bare = await verifyAttestations(holo, { key: publicKey });
  assert.equal(bare.passed, false);
  assert.ok(bare.error instanceof AttestationNotFoundError);
  assert.equal(bare.error.check, 'attestation.none');
  assert.deepEqual(bare.results, []);

  const { holo: signed } = await attest(holo, { type: PROOF, predicate: {}, key: privateKey });
  const other = await verifyAttestations(signed, { key: publicKey, type: PROVENANCE });
  assert.ok(other.error instanceof AttestationNotFoundError);
  assert.equal(other.error.check, 'attestation.type');
  assert.match(other.error.message, /prism\/proof\/v1/);
  await rejects(verifyAttestations(holo, { key: publicKey, throw: true }), AttestationNotFoundError);
});

test('a statement that names the wrong digest is a SubjectMismatchError, even with a valid signature', async () => {
  const { privateKey, publicKey } = keys();
  const guest = parseArchive(holo).blobs[0];
  const subject = (digest) => ({ name: 'guest', digest });
  const good = { sha256: sha256(guest.content), blake3: blake3Hex(guest.content) };
  const statement = (digest) => ({ _type: 'https://in-toto.io/Statement/v1', subject: [subject(digest)], predicateType: PROOF, predicate: {} });

  const sound = appendAttestations(holo, [signByHand(statement(good), privateKey)]);
  assert.equal((await verifyAttestations(sound, { key: publicKey })).passed, true, 'the by-hand bundle is sound');

  // Same blake3 label, a sha256 that is not the blob's: the two digests disagree about the same bytes.
  const forged = appendAttestations(holo, [signByHand(statement({ ...good, sha256: '0'.repeat(64) }), privateKey)]);
  const result = await verifyAttestations(forged, { key: publicKey });
  assert.equal(result.passed, false);
  assert.ok(result.error instanceof SubjectMismatchError);
  assert.equal(result.error.check, 'attestation.subject');
});

test('a corrupted holo is refused before any signature is looked at', async () => {
  const { privateKey, publicKey } = keys();
  const { holo: signed } = await attest(holo, { type: PROOF, predicate: {}, key: privateKey });
  const broken = signed.slice();
  broken[broken.length - 1] ^= 0xff;
  await rejects(verifyAttestations(broken, { key: publicKey }), VerificationError, 'holo.integrity');
});

test('the policy is checked before anything else', async () => {
  const { publicKey, privateKey } = keys();
  const issuer = GITHUB_ACTIONS_ISSUER;
  const invalid = (options) => rejects(verifyAttestations(holo, options), VerificationError, 'policy.invalid');
  await invalid({});
  await invalid({ certificateOidcIssuer: issuer });
  await invalid({ certificateIdentity: 'someone' });
  await invalid({ certificateIdentity: 'a', certificateIdentityRegexp: 'a', certificateOidcIssuer: issuer });
  await invalid({ certificateIdentityRegexp: '(', certificateOidcIssuer: issuer });
  await invalid({ key: publicKey, certificateIdentity: 'someone' });
  await invalid({ key: publicKey, certificateOidcIssuer: issuer });
  await invalid({ key: publicKey, entries: 1 });
  await invalid({ key: publicKey, timestamps: -1 });
  await invalid({ key: 'not a key' });
  await invalid({ key: privateKey.replace(/PRIVATE/g, 'PUBLIC') });
  await rejects(verifyAttestations(holo, null), VerificationError, 'policy.invalid');
});

test('attest refuses what it cannot sign, each with its check', async () => {
  const { privateKey } = keys();
  const sign = (options) => attest(holo, { type: PROOF, predicate: {}, key: privateKey, ...options });
  await rejects(sign({ type: 'not a uri' }), SigningError, 'sign.predicate');
  await rejects(sign({ type: undefined }), SigningError, 'sign.predicate');
  await rejects(sign({ predicate: undefined }), SigningError, 'sign.predicate');
  await rejects(sign({ predicate: '{nope' }), SigningError, 'sign.predicate');
  await rejects(sign({ subjects: ['nonsense'] }), SigningError, 'sign.subject');
  await rejects(sign({ subjects: ['blake3:' + '1'.repeat(64)] }), SigningError, 'sign.subject');
  await rejects(sign({ subjects: ['guest', 'guest'] }), SigningError, 'sign.subject');
  await rejects(sign({ key: 'not a key' }), SigningError, 'sign.key');
  await rejects(attest(holo, null), SigningError, 'sign.predicate');
  // A predicate may be JSON text or bytes as well as a value.
  assert.equal((await sign({ predicate: '{"a":1}' })).statement.predicate.a, 1);
  assert.equal((await sign({ predicate: Buffer.from('[1,2]') })).statement.predicate.length, 2);
});

test('attest will not append to a holo whose footer does not verify', async () => {
  const broken = holo.slice();
  broken[broken.length - 1] ^= 0xff;
  await rejects(attest(broken, { type: PROOF, predicate: {}, key: keys().privateKey }), PrismError);
});

const FULCIO_ONLY = {
  mediaType: 'application/vnd.dev.sigstore.signingconfig.v0.2+json',
  caUrls: [{ url: 'http://127.0.0.1:1', majorApiVersion: 1, validFor: { start: '2020-01-01T00:00:00Z' }, operator: 'test' }],
  oidcUrls: [],
  rekorTlogUrls: [],
  tsaUrls: [],
};

test('keyless attest with no identity token is a SigningError that says how to give one', async () => {
  const saved = Object.fromEntries(['SIGSTORE_ID_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'].map((k) => [k, process.env[k]]));
  for (const k of Object.keys(saved)) delete process.env[k];
  try {
    const error = await rejects(attest(holo, { type: PROOF, predicate: {}, signingConfig: FULCIO_ONLY }), SigningError, 'sign.identity');
    assert.match(error.message, /SIGSTORE_ID_TOKEN|id-token/);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});

// A token with the shape Fulcio's client needs: three parts, the middle a JSON object with an issuer and a subject.
const TOKEN = `x.${Buffer.from(JSON.stringify({ iss: 'https://oidc.test', sub: 'tester' })).toString('base64url')}.y`;

test('keyless attest with a token that is not a JWT is a SigningError about the identity', async () => {
  await rejects(attest(holo, { type: PROOF, predicate: {}, signingConfig: FULCIO_ONLY, identityToken: 'not-a-jwt' }), SigningError, 'sign.identity');
});

test('keyless attest reports an unusable signing configuration and a refusing service', async () => {
  await rejects(attest(holo, { type: PROOF, predicate: {}, signingConfig: { caUrls: [] }, identityToken: TOKEN }), SigningError, 'sign.config');
  await rejects(attest(holo, { type: PROOF, predicate: {}, signingConfig: here('../no-such-config.json'), identityToken: TOKEN }), SigningError, 'sign.config');

  // A Fulcio that answers 400: no retry, a typed error, and the holo is untouched.
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(400, { 'content-type': 'application/json' }).end('{"code":400,"message":"bad token"}');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const config = { ...FULCIO_ONLY, caUrls: [{ ...FULCIO_ONLY.caUrls[0], url: `http://127.0.0.1:${server.address().port}` }] };
    await rejects(attest(holo, { type: PROOF, predicate: {}, signingConfig: config, identityToken: TOKEN }), SigningError, 'sign.service');
  } finally {
    await new Promise((done) => server.close(done));
  }
});

/**
 * A Fulcio and a Rekor v1 on one local port. `rekor(n, request)` answers the n-th log request. Resolves to what
 * the run saw: the bodies the log received, how many certificates were asked for, and the outcome of `attest`.
 */
async function keylessAgainst(rekor) {
  const entries = [];
  let certificates = 0;
  const pem = `-----BEGIN CERTIFICATE-----\n${Buffer.from('not a real certificate').toString('base64')}\n-----END CERTIFICATE-----\n`;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', async () => {
      const json = (status, value, headers = {}) => response.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(value));
      if (request.url === '/api/v2/signingCert') {
        certificates += 1;
        return json(200, { signedCertificateEmbeddedSct: { chain: { certificates: [pem] } } });
      }
      entries.push(Buffer.concat(chunks).toString('utf8'));
      const [status, value, headers] = await rekor(entries.length);
      return json(status, value, headers);
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}`;
  const service = { url, majorApiVersion: 1, validFor: { start: '2020-01-01T00:00:00Z' }, operator: 'test' };
  const signingConfig = { ...FULCIO_ONLY, caUrls: [service], rekorTlogUrls: [service], rekorTlogConfig: { selector: 'ANY' } };
  try {
    const outcome = await attest(holo, { type: PROOF, predicate: {}, signingConfig, identityToken: TOKEN }).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    return { entries, certificates, ...outcome };
  } finally {
    await new Promise((done) => server.close(done));
  }
}

const LOG_ENTRY = [201, { 'aa11': { logID: 'bb22', logIndex: 7, integratedTime: 1700000000, body: Buffer.from(JSON.stringify({ kind: 'dsse', apiVersion: '0.0.1' })).toString('base64'), verification: {} } }];
const LOG_DUPLICATE = [409, { code: 409, message: 'an equivalent entry already exists in the transparency log' }, { location: '/api/v1/log/entries/aa11' }];

test('keyless attest survives a log that stored the entry and lost the answer', async () => {
  // The sequence behind the CI flake: stored but answered 500, the same request re-sent and refused, then a new signature.
  const { entries, certificates, value, error } = await keylessAgainst((n) => (n === 1 ? [500, { code: 500, message: 'lost' }] : n === 2 ? LOG_DUPLICATE : LOG_ENTRY));
  assert.equal(error, undefined);
  assert.equal(entries.length, 3);
  assert.equal(entries[1], entries[0], 'the retry re-sends the same entry');
  assert.notEqual(entries[2], entries[0], 'signing again makes a new entry');
  assert.equal(certificates, 2);
  assert.equal(value.attestations, 1);
  assert.equal(value.bundle.verificationMaterial.tlogEntries[0].logIndex, '7');
});

test('keyless attest signs again only once, and only for a duplicate', async () => {
  const twice = await keylessAgainst(() => LOG_DUPLICATE);
  assert.ok(twice.error instanceof SigningError);
  assert.equal(twice.error.check, 'sign.service');
  assert.match(twice.error.message, /409/);
  assert.equal(twice.entries.length, 2);

  const refused = await keylessAgainst(() => [400, { code: 400, message: 'bad entry' }]);
  assert.ok(refused.error instanceof SigningError);
  assert.equal(refused.entries.length, 1);
  assert.equal(refused.certificates, 1);
});

test('keyless attest waits for a log that answers after sigstore\'s default 5 s timeout', async () => {
  const { entries, value, error } = await keylessAgainst(async () => {
    await new Promise((done) => setTimeout(done, 5500));
    return LOG_ENTRY;
  });
  assert.equal(error, undefined);
  assert.equal(entries.length, 1, 'nothing was re-sent');
  assert.equal(value.attestations, 1);
});

// The Sigstore conformance bundle #275 vendors: a DSSE bundle signed by a GitHub Actions identity, with a Rekor v2 entry
// and an RFC 3161 timestamp, against the staging trusted root. Its signer is the identity below.
const FIXTURE = '../../verify/test/fixtures/sigstore-conformance/rekor2-dsse-happy-path/';
const conformance = {
  bundle: JSON.parse(readFileSync(here(`${FIXTURE}bundle.sigstore.json`), 'utf8')),
  trustedRoot: JSON.parse(readFileSync(here(`${FIXTURE}trusted_root.json`), 'utf8')),
};
const SIGNER = 'https://github.com/sigstore-conformance/extremely-dangerous-public-oidc-beacon/.github/workflows/extremely-dangerous-oidc-beacon.yml@refs/heads/main';

const keyless = (options, bundle = conformance.bundle) => verifyBundle(bundle, { trustedRoot: conformance.trustedRoot, certificateOidcIssuer: GITHUB_ACTIONS_ISSUER, ...options });

test('keyless: the signer, the log entry and the signed time of a Sigstore bundle verify offline', async () => {
  const outcome = await keyless({ certificateIdentity: SIGNER });
  assert.equal(outcome.identity, SIGNER);
  assert.equal(outcome.issuer, GITHUB_ACTIONS_ISSUER);
  assert.equal(outcome.time, '2026-05-13T19:23:33.000Z', 'the time is the signed time, not the verifier\'s clock');
  const byPattern = await keyless({ certificateIdentityRegexp: '^https://github\\.com/sigstore-conformance/.+@refs/heads/main$' });
  assert.equal(byPattern.identity, SIGNER);
});

test('keyless: --certificate-identity is exact, not a pattern or a prefix', async () => {
  const mismatch = (identity) => rejects(keyless({ certificateIdentity: identity }), IdentityMismatchError, 'identity.signer');
  await mismatch(SIGNER.slice(0, -1));
  await mismatch(`${SIGNER}-evil`);
  await mismatch(SIGNER.replace('/.github/', '/Xgithub/'));
  await mismatch('.*');
  await mismatch(SIGNER.replace('@refs/heads/main', '@refs/heads/other'));
  await rejects(keyless({ certificateIdentityRegexp: 'nobody' }), IdentityMismatchError, 'identity.signer');
});

test('keyless: the issuer must be the policy\'s issuer', async () => {
  await rejects(keyless({ certificateIdentity: SIGNER, certificateOidcIssuer: 'https://accounts.google.com' }), IdentityMismatchError, 'identity.issuer');
  await rejects(keyless({ certificateIdentity: SIGNER, certificateOidcIssuer: `${GITHUB_ACTIONS_ISSUER}/` }), IdentityMismatchError, 'identity.issuer');
});

test('keyless: a missing or extra transparency requirement is a TransparencyError', async () => {
  await rejects(keyless({ certificateIdentity: SIGNER, timestamps: 2 }), TransparencyError);
  await rejects(keyless({ certificateIdentity: SIGNER, entries: 2 }), TransparencyError);
  const stripped = structuredClone(conformance.bundle);
  stripped.verificationMaterial.timestampVerificationData = { rfc3161Timestamps: [] };
  await rejects(keyless({ certificateIdentity: SIGNER }, stripped), TransparencyError);
  const unlogged = structuredClone(conformance.bundle);
  unlogged.verificationMaterial.tlogEntries = [];
  await rejects(keyless({ certificateIdentity: SIGNER }, unlogged), TransparencyError);
});

test('keyless: a statement changed after signing no longer matches the log entry or the signature', async () => {
  const tampered = structuredClone(conformance.bundle);
  const payload = JSON.parse(Buffer.from(tampered.dsseEnvelope.payload, 'base64').toString());
  payload.predicateType = 'https://example.com/other';
  tampered.dsseEnvelope.payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const error = await keyless({ certificateIdentity: SIGNER }, tampered).then(
    () => assert.fail('a tampered bundle verified'),
    (e) => e,
  );
  assert.ok(error instanceof TransparencyError || error instanceof SignatureInvalidError, error.constructor.name);
});

test('keyless: a trusted root that does not pin what the policy needs is a TrustRootError', async () => {
  await rejects(verifyBundle(conformance.bundle, { trustedRoot: { mediaType: 'x' }, certificateIdentity: SIGNER, certificateOidcIssuer: GITHUB_ACTIONS_ISSUER }), TrustRootError, 'trustedroot.invalid');
  await rejects(verifyBundle(conformance.bundle, { trustedRoot: here('../no-such-root.json'), certificateIdentity: SIGNER, certificateOidcIssuer: GITHUB_ACTIONS_ISSUER }), TrustRootError, 'trustedroot.invalid');
  const noTlog = { ...conformance.trustedRoot, tlogs: [] };
  await rejects(verifyBundle(conformance.bundle, { trustedRoot: noTlog, certificateIdentity: SIGNER, certificateOidcIssuer: GITHUB_ACTIONS_ISSUER }), TrustRootError);
});

test('a keyed bundle can still be held to a log entry and a timestamp by a pinned root', async () => {
  const { privateKey, publicKey } = keys();
  const { holo: signed } = await attest(holo, { type: PROOF, predicate: {}, key: privateKey });
  const result = await verifyAttestations(signed, { key: publicKey, trustedRoot: conformance.trustedRoot, entries: 1 });
  assert.equal(result.passed, false, 'a bundle with no log entry cannot satisfy entries: 1');
  assert.ok(result.error instanceof TransparencyError);
});
