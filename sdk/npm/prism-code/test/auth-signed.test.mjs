// `prism.auth` identities that really sign (#447). These need the optional sigstore packages, so they run in the npm
// workflow; auth.test.mjs needs none of them and is what the conformance id runs. Every value here is a test value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { auth } from '../src/auth.mjs';
import { experimental_verifyBundle } from '../src/attest.mjs';
import { SigningError } from '../src/errors.mjs';
import { assertHidden, refusalOf } from './support/secrets.mjs';

const STATEMENT = new TextEncoder().encode(JSON.stringify({ _type: 'https://in-toto.io/Statement/v1', subject: [], predicateType: 'https://example.test/p', predicate: {} }));
// A token with the shape Fulcio's client needs: three parts, the middle a JSON object with an issuer and a subject.
const TOKEN = `headerpart.${Buffer.from(JSON.stringify({ iss: 'https://oidc.test', sub: 'tester' })).toString('base64url')}.signaturepart`;
const pemBody = (pem) => pem.split('\n').filter((line) => line && !line.startsWith('-----'));

const FULCIO_ONLY = {
  mediaType: 'application/vnd.dev.sigstore.signingconfig.v0.2+json',
  caUrls: [{ url: 'http://127.0.0.1:1', majorApiVersion: 1, validFor: { start: '2020-01-01T00:00:00Z' }, operator: 'test' }],
  oidcUrls: [],
  rekorTlogUrls: [],
  tsaUrls: [],
};

test('a key identity signs a bundle a verifier accepts, names the key, and shows nothing of the private key', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  for (const key of [pem, Buffer.from(pem), privateKey]) {
    const identity = auth.identities.fromKey(key);
    const bundle = await identity.sign(STATEMENT);
    assert.equal(bundle.verificationMaterial.publicKey.hint, identity.keyId);
    const outcome = await experimental_verifyBundle(bundle, { key: publicKey });
    assert.equal(outcome.keyId, identity.keyId);
    assertHidden(bundle, pemBody(pem));
  }
});

test('an unusable token is replaced in the error sigstore writes', async () => {
  const malformed = 'test-malformed-token-a4b7c2';
  const identity = auth.identities.keyless({ identityToken: malformed, signingConfig: FULCIO_ONLY });
  const error = await refusalOf(identity.sign(STATEMENT), SigningError, 'sign.identity', [malformed]);
  // sigstore's own message quotes the token, so this proves the replacement ran.
  assert.match(error.message, /\[redacted\]/);
});

test('a service that echoes the token gets no further than the error', async () => {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 400, message: `bad token ${TOKEN} ${TOKEN.split('.')[1]}` }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const signingConfig = { ...FULCIO_ONLY, caUrls: [{ ...FULCIO_ONLY.caUrls[0], url: `http://127.0.0.1:${server.address().port}` }] };
    const error = await refusalOf(auth.identities.keyless({ identityToken: TOKEN, signingConfig }).sign(STATEMENT), SigningError, 'sign.service', [TOKEN, TOKEN.split('.')[1]]);
    assert.match(error.message, /\[redacted\]/);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
