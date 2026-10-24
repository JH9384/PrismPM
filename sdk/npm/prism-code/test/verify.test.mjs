// holo.verify() (#276): the verdict of @prism-code/verify, the honest level, options, and the typed errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verify as verifyPackage } from '../../verify/src/index.mjs';
import { appendAttestations } from '../src/attestations.mjs';
import { parseArchive } from '../src/archive.mjs';
import {
  load,
  experimental_verify,
  experimental_createClient,
  MINIMUM_LEVEL_ENV,
  PrismError,
  VerificationError,
} from '../src/index.mjs';

const fixture = new URL('../fixtures/Calculator.holo', import.meta.url);
const original = new Uint8Array(readFileSync(fixture));
const none = { env: {} };

function tampered() {
  const bytes = original.slice();
  const guest = parseArchive(bytes).blobs.find((b) => b.content.length > 1000);
  const section = parseArchive(bytes).sections[guest.section];
  bytes[section.offset + 71 + 10] ^= 0xff;
  return bytes;
}

test('the vendored verify is what scripts/vendor-verify.mjs makes from @prism-code/verify today', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/vendor-verify.mjs', import.meta.url)), '--check'], { stdio: 'pipe' });
});

test('the verdict equals the one @prism-code/verify returns, from bytes, a Blob and an opened holo', async () => {
  const expected = await verifyPackage(original);
  assert.deepEqual(await experimental_verify(original, none), expected);
  assert.deepEqual(await experimental_verify(new Blob([original]), none), expected);
  assert.deepEqual(await experimental_verify(original.buffer.slice(0), none), expected);
  const app = await load(original);
  assert.deepEqual(await app.experimental_verify(none), expected);
  assert.deepEqual(await experimental_verify(app, none), expected);
  assert.equal(expected.schema, 'prism/verdict/1');
});

test('the level is the honest one: P0 today, however low the policy and whatever statement is appended', async () => {
  const lenient = await experimental_verify(original, { minimum: 'P0', env: {} });
  assert.equal(lenient.level, 'P0');
  assert.equal(lenient.passed, true);
  const claim = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'guest', digest: { sha256: '0'.repeat(64), blake3: '0'.repeat(64) } }],
    predicateType: 'https://uor.foundation/prism/proof/v1',
    predicate: { verifiedLevels: ['P3'] },
  };
  const bundle = {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: { publicKey: { hint: 'placeholder' }, tlogEntries: [] },
    dsseEnvelope: { payload: Buffer.from(JSON.stringify(claim)).toString('base64'), payloadType: 'application/vnd.in-toto+json', signatures: [{ keyid: '', sig: 'AA==' }] },
  };
  const claimed = appendAttestations(original, [bundle]);
  // The package reads format revision 2026-10-23, which has no attestation row, so a holo with one has no verdict yet.
  // Whatever it learns to read, an unsigned claim of P3 must not raise the level.
  const withClaim = await experimental_verify(claimed, { minimum: 'P0', env: {} }).catch((error) => {
    assert.ok(error instanceof VerificationError);
    return { level: 'P0' };
  });
  assert.equal(withClaim.level, 'P0');
  // The default policy still fails it, and the reason names what is missing.
  const verdict = await experimental_verify(original, none);
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.reasons.map((r) => r.check), ['provenance.statement', 'proof.statement', 'replay.statement', 'policy.level']);
});

test('a tampered blob is a failed verdict that withholds P1, and throws a VerificationError on request', async () => {
  const bytes = tampered();
  const verdict = await experimental_verify(bytes, { minimum: 'P0', env: {} });
  assert.equal(verdict.passed, true, 'P0 has no requirement');
  const reasons = (await experimental_verify(bytes, none)).reasons;
  assert.ok(reasons.some((r) => r.check === 'holo.integrity' && r.withholds === 'P1'));
  await assert.rejects(
    () => experimental_verify(bytes, { minimum: 'P1', throw: true, env: {} }),
    (error) => {
      assert.ok(error instanceof VerificationError && error instanceof PrismError);
      assert.equal(error.code, 'verification_failed');
      assert.equal(error.check, 'holo.integrity');
      assert.equal(error.verdict.schema, 'prism/verdict/1');
      assert.ok(error.reasons.length >= 2);
      return true;
    },
  );
});

test('throw: true throws the error for a failed verdict and nothing for a passed one', async () => {
  await assert.rejects(
    () => experimental_verify(original, { throw: true, env: {} }),
    (error) => error instanceof VerificationError && error.check === 'provenance.statement' && error.verdict.level === 'P0',
  );
  assert.equal((await experimental_verify(original, { minimum: 'P0', throw: true, env: {} })).passed, true);
});

test('no verdict is always a VerificationError whose check names why', async () => {
  const cases = [
    [new Uint8Array(10), 'archive.magic'],
    [original.subarray(0, 100), 'archive.table'],
    ['not bytes', 'input'],
    [original, 'policy.invalid', { minimum: 'P9' }],
    [original, 'policy.invalid', { colour: 'red' }],
  ];
  for (const [source, check, options] of cases) {
    await assert.rejects(
      () => experimental_verify(source, { ...options, env: {} }),
      (error) => error instanceof VerificationError && error.code === 'verification_failed' && error.check === check && error.verdict === undefined,
      check,
    );
  }
});

test('a closure has no footer to verify', async () => {
  await assert.rejects(
    () => experimental_verify({ kind: 'closure' }, none),
    (error) => error instanceof VerificationError && error.check === 'verify.kind',
  );
});

test('options: the environment, then the client, then the call', async () => {
  const env = { [MINIMUM_LEVEL_ENV]: 'P0' };
  assert.equal((await experimental_verify(original, { env })).policy.minimum, 'P0');
  const client = experimental_createClient({ minimum: 'P1', env });
  assert.equal((await client.verify(original)).policy.minimum, 'P1');
  assert.equal((await client.verify(original, { minimum: 'P3' })).policy.minimum, 'P3');
  assert.equal((await client.verify(original, { name: 'ci' })).policy.name, 'ci');
  assert.equal((await client.verify(original, { minimum: undefined })).policy.minimum, 'P1');
  // The client's options do not change when a call overrides them.
  assert.equal((await client.verify(original)).policy.minimum, 'P1');
  assert.equal((await experimental_verify(original, { env: {} })).policy.minimum, 'P2');
  await assert.rejects(
    () => experimental_verify(original, { env: { [MINIMUM_LEVEL_ENV]: 'high' } }),
    (error) => error instanceof VerificationError && error.check === 'policy.invalid' && error.message.includes(MINIMUM_LEVEL_ENV),
  );
  assert.throws(() => experimental_createClient({ nope: 1 }), (error) => error instanceof VerificationError);
});

test('the environment variable is read from process.env when no env is given', async () => {
  const saved = process.env[MINIMUM_LEVEL_ENV];
  process.env[MINIMUM_LEVEL_ENV] = 'P1';
  try {
    assert.equal((await experimental_verify(original)).policy.minimum, 'P1');
    assert.equal((await experimental_verify(original, { minimum: 'P0' })).policy.minimum, 'P0');
  } finally {
    if (saved === undefined) delete process.env[MINIMUM_LEVEL_ENV];
    else process.env[MINIMUM_LEVEL_ENV] = saved;
  }
});
