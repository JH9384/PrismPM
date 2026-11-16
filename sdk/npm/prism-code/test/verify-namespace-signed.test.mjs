// prism.verify (#449) where a signature can be checked. This needs the optional sigstore packages, which need Node
// 22.22.2 or newer, so it is apart from verify-namespace.test.mjs: AL-07 owns that file whole, and allows no skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SubjectMismatchError } from '../src/index.mjs';
import { verify } from '../src/verify-namespace.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const signedPath = here('./fixtures/signed/Calculator.signed.holo');
const mismatchPath = here('./fixtures/signed/PaymentApproval.mismatch.holo');
const signed = new Uint8Array(readFileSync(signedPath));
const signer = { key: readFileSync(here('./fixtures/signed/signer.pub.pem'), 'utf8') };
const stranger = { key: readFileSync(here('./fixtures/signed/stranger.pub.pem'), 'utf8') };
const none = { env: {} };

const sigstore = await import('@sigstore/sign').then(() => true, () => false);
const needsSigstore = { skip: sigstore ? false : 'the optional sigstore packages are not installed' };

test('a signed holo reaches P2 when check is told the signer that signed it', needsSigstore, async () => {
  const trusted = await verify.check(signedPath, { signer, ...none });
  assert.equal(trusted.level, 'P2');
  assert.equal(trusted.passed, true);
  for (const limit of await verify.limits()) assert.ok((await verify.format(trusted)).includes(limit));
});

test('attestations.verify follows the signer, the predicate type and the subjects', needsSigstore, async () => {
  assert.equal((await verify.attestations.verify(signed, signer)).passed, true);
  assert.equal((await verify.attestations.verify(signed, stranger)).passed, false);
  await assert.rejects(verify.attestations.verify(mismatchPath, { ...signer, type: 'https://in-toto.io/nothing', throw: true }), (error) => error.check === 'attestation.type');
  const type = verify.attestations.read(new Uint8Array(readFileSync(mismatchPath))).at(-1).predicateType;
  const mismatch = await verify.attestations.verify(mismatchPath, { ...signer, type });
  assert.ok(mismatch.results.some((r) => r.error instanceof SubjectMismatchError));
});

test('attestations.verifyBundle follows the signer', needsSigstore, async () => {
  const [bundle] = verify.attestations.read(signed);
  assert.equal((await verify.attestations.verifyBundle(bundle.bundle, signer)).identity, null, 'a keyed bundle names no identity');
  await assert.rejects(verify.attestations.verifyBundle(bundle.bundle, stranger));
});
