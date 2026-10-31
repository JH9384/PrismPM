// `prism-code check <app.holo>` (#270): the verdict, its text and JSON forms, and exit codes 0, 1 and 2.
// The deprecated Docker-backed spelling and `build --check` are covered at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { parseArchive, resolveArchive, appendAttestations } from '../src/index.mjs';
import { experimental_attest, signStatement } from '../src/attest.mjs';
import { formatVerdict, titleOf, LIMITS, EXIT } from '../src/check.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const bin = here('../bin/prism-code.mjs');
const fixture = here('../fixtures/Calculator.holo');
const paymentApproval = here('../fixtures/PaymentApproval.holo');
const verdicts = here('../../spec/test/fixtures/verdict/verdict-v1/');
const GUEST_SHA256 = 'dcf53677c7c80636f8fc2247676b8f747d1549ce4af742c8505eb0f0ae334c03';
const IMAGE = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:36da25ef924d84899453f24ec0c117a7a220e708037933eb8b499caa7723d99e';

function run(args, options = {}) {
  const env = { ...process.env, ...options.env };
  delete env.PRISM_MINIMUM_LEVEL;
  Object.assign(env, options.env);
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', ...options, env });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const dir = mkdtempSync(join(tmpdir(), 'prism-code-check-'));
function file(name, content) {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}
const P0 = file('p0.json', JSON.stringify({ minimum: 'P0' }));
const checks = (verdict) => verdict.reasons.map((r) => r.check);

test('the reference archive is P0 and fails the default policy: exit 1', () => {
  const { code, out, err } = run(['check', fixture]);
  assert.equal(code, EXIT.FAILED, err);
  assert.match(out, /^FAILED {2}P0 unverified {2}policy default requires P2 or above$/m);
  assert.match(out, /^ {2}policy\.level \(PP5601, Verification, policy rule\)$/m);
  assert.doesNotMatch(out, /cannot know/);
});

test('--json prints exactly one canonical verdict', () => {
  const { code, out } = run(['check', fixture, '--json']);
  assert.equal(code, EXIT.FAILED);
  assert.ok(out.endsWith('}\n') && out.indexOf('\n') === out.length - 1, 'one line');
  const verdict = JSON.parse(out);
  assert.equal(verdict.schema, 'prism/verdict/1');
  assert.equal(verdict.holo, 'blake3:8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba');
  assert.deepEqual([verdict.level, verdict.passed, verdict.policy], ['P0', false, { minimum: 'P2', name: 'default' }]);
  assert.deepEqual(checks(verdict), ['provenance.statement', 'proof.statement', 'replay.statement', 'policy.level']);
  assert.deepEqual(Object.keys(verdict), [...Object.keys(verdict)].sort(), 'canonical key order');
});

test('a policy that accepts P0 passes: exit 0, named by its path', () => {
  const { code, out } = run(['check', fixture, '--policy', P0, '--json']);
  assert.equal(code, EXIT.PASSED);
  const verdict = JSON.parse(out);
  assert.deepEqual([verdict.level, verdict.passed, verdict.policy], ['P0', true, { minimum: 'P0', name: P0 }]);
  const named = file('named.json', JSON.stringify({ name: 'pure', minimum: 'P0' }));
  assert.match(run(['check', fixture, `--policy=${named}`]).out, /^PASSED {2}P0 unverified {2}policy pure requires P0 or above$/m);
});

test('PRISM_MINIMUM_LEVEL sets the minimum when the policy does not', () => {
  assert.equal(run(['check', fixture], { env: { PRISM_MINIMUM_LEVEL: 'P0' } }).code, EXIT.PASSED);
  const strict = file('strict.json', JSON.stringify({ minimum: 'P2' }));
  assert.equal(run(['check', fixture, '--policy', strict], { env: { PRISM_MINIMUM_LEVEL: 'P0' } }).code, EXIT.FAILED);
});

test('a pinned digest the holo does not have fails the policy at any level: exit 1', () => {
  const pin = file('pin.json', JSON.stringify({ minimum: 'P0', digests: { guest: { sha256: '0'.repeat(64) } } }));
  const { code, out } = run(['check', fixture, '--policy', pin, '--json']);
  assert.equal(code, EXIT.FAILED);
  assert.deepEqual(checks(JSON.parse(out)).at(-1), 'policy.digests.guest');
  const right = file('right.json', JSON.stringify({ minimum: 'P0', digests: { guest: { sha256: GUEST_SHA256 } } }));
  assert.equal(run(['check', fixture, '--policy', right]).code, EXIT.PASSED);
});

test('a tampered wasm blob fails holo.integrity, drops to P0 and fails the default policy: exit 1', () => {
  const bytes = new Uint8Array(readFileSync(fixture));
  const guest = parseArchive(bytes).blobs.find((b) => b.label === 'blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380');
  const at = guest.content.byteOffset + 100;
  bytes[at] ^= 0xff;
  const tampered = file('tampered.holo', bytes);
  const { code, out } = run(['check', tampered, '--json']);
  assert.equal(code, EXIT.FAILED);
  const verdict = JSON.parse(out);
  assert.equal(verdict.level, 'P0');
  assert.deepEqual(verdict.reasons[0], { check: 'holo.integrity', message: verdict.reasons[0].message, withholds: 'P1' });
  // P0 asks only that check could read the file, so a policy of P0 accepts even a damaged holo.
  assert.equal(run(['check', tampered, '--policy', P0]).code, EXIT.PASSED);
});

test('no verdict exits 2, says why on stderr, and prints nothing on stdout', () => {
  const notHolo = file('bad.holo', Buffer.from('HOLX' + '\0'.repeat(60)));
  const notJson = file('policy.txt', 'minimum: P0');
  const unknown = file('unknown.json', JSON.stringify({ minimum: 'P0', signer: 'me' }));
  const badLevel = file('p4.json', JSON.stringify({ minimum: 'P4' }));
  const cases = [
    [[join(dir, 'missing.holo')], /^no verdict: load\.path: /],
    [[notHolo], /^no verdict: archive\.magic: /],
    [[fixture, '--policy', join(dir, 'missing.json')], /^no verdict: policy\.unreadable: /],
    [[fixture, '--policy', notJson], /^no verdict: policy\.invalid: .* is not JSON/],
    [[fixture, '--policy', unknown], /^no verdict: policy\.invalid: .*unknown members signer/],
    [[fixture, '--policy', badLevel], /^no verdict: policy\.invalid: policy\.minimum "P4"/],
  ];
  for (const [args, message] of cases) {
    const { code, out, err } = run(['check', ...args, '--json']);
    assert.equal(code, EXIT.NO_VERDICT, `${args.join(' ')}: ${err}`);
    assert.equal(out, '', args.join(' '));
    assert.match(err, message);
  }
});

// P2 (#270). The statements are signed at test time with a throwaway key, which is the only way a test can have a
// signer the verifier accepts; the proof predicate is a stand-in that claims no Lean run. What these tests show is
// that the verdict follows the signature, the subjects and the signer the caller names, and nothing else.
const PROOF_TYPE = 'https://uor.foundation/prism/proof/v1';
const SLSA_TYPE = 'https://slsa.dev/provenance/v1';
const signing = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const stranger = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privatePem = signing.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = file('signer.pem', signing.publicKey.export({ type: 'spki', format: 'pem' }));
const strangerKey = file('stranger.pem', stranger.publicKey.export({ type: 'spki', format: 'pem' }));
const calculatorProof = JSON.parse(readFileSync(here('../../spec/test/fixtures/attestation/statement/calculator.json'), 'utf8')).predicate;

/** The proof predicate of the Calculator, with the model ids of the archive it is about. */
function proofPredicateFor(bytes) {
  const resolved = resolveArchive(parseArchive(bytes));
  const { provenance } = resolved;
  const predicate = structuredClone(calculatorProof);
  predicate.model.document = { sha256: provenance.model_id, blake3: resolved.identities.modelKappa.slice('blake3:'.length) };
  Object.assign(predicate.model, { sourceId: provenance.source_id, semanticId: provenance.semantic_id, snapshotId: provenance.snapshot_id, compilerSemanticsId: provenance.compiler_semantics_id, leanManifestSha256: provenance.lean_manifest_sha256 });
  return predicate;
}

/** The holo with a provenance statement over its four blobs and a proof statement over its guest, both signed. */
async function signedHolo(path, { proof = true, provenance = true, predicate } = {}) {
  let bytes = new Uint8Array(readFileSync(path));
  const original = bytes;
  if (provenance) {
    bytes = (await experimental_attest(bytes, { type: SLSA_TYPE, predicate: { buildDefinition: { buildType: 'https://uor.foundation/prism/holo-build/v1' } }, subjects: ['guest', 'view', 'model', 'capabilities'], key: privatePem })).holo;
  }
  if (proof) bytes = (await experimental_attest(bytes, { type: PROOF_TYPE, predicate: predicate ?? proofPredicateFor(original), subjects: ['guest'], key: privatePem })).holo;
  return bytes;
}

test('both reference archives pass at P2 when signed by the key the policy trusts: exit 0', async () => {
  for (const [name, path] of [['Calculator', fixture], ['PaymentApproval', paymentApproval]]) {
    const signed = file(`${name}.signed.holo`, await signedHolo(path));
    const { code, out, err } = run(['check', signed, '--key', publicKey, '--json']);
    assert.equal(code, EXIT.PASSED, `${name}: ${out}${err}`);
    const verdict = JSON.parse(out);
    assert.deepEqual([verdict.level, verdict.passed], ['P2', true], name);
    assert.deepEqual(checks(verdict), ['replay.statement'], 'only the replay statement, which withholds P3, is missing');
    assert.equal(verdict.holo, `blake3:${parseArchive(new Uint8Array(readFileSync(signed))).fingerprint}`, 'the holo member is the fingerprint of the file given');
    assert.match(run(['check', signed, '--key', publicKey]).out, /^PASSED {2}P2 proof checked/);
  }
});

test('the same signed holo is P0 until the caller names a signer: an unchecked signature is no evidence', async () => {
  const signed = file('unnamed.holo', await signedHolo(fixture));
  for (const args of [[], ['--key', strangerKey]]) {
    const { code, out } = run(['check', signed, ...args, '--json']);
    assert.equal(code, EXIT.FAILED, args.join(' '));
    const verdict = JSON.parse(out);
    assert.equal(verdict.level, 'P0');
    assert.deepEqual(checks(verdict), ['provenance.envelope', 'proof.envelope', 'replay.statement', 'policy.level']);
    assert.equal(verdict.reasons[1].code, 'PP5501');
  }
  assert.match(run(['check', signed, '--key', strangerKey]).out, /does not verify/);
  assert.equal(run(['check', signed, '--policy', P0]).code, EXIT.PASSED, 'a policy of P0 accepts it');
});

test('a signer that cannot be read or is half named is no verdict: exit 2', async () => {
  const signed = file('signer-errors.holo', await signedHolo(fixture));
  const { code, out, err } = run(['check', signed, '--key', join(dir, 'missing.pem'), '--json']);
  assert.deepEqual([code, out], [EXIT.NO_VERDICT, '']);
  assert.match(err, /^no verdict: policy\.unreadable: /);
  const keyless = run(['check', signed, '--certificate-identity', 'ci@example.org', '--json']);
  assert.equal(keyless.code, EXIT.NO_VERDICT);
  assert.match(keyless.err, /certificateOidcIssuer|issuer/);
});

test('a tampered wasm blob in a signed holo fails with ProofMismatch: exit 1', async () => {
  const bytes = await signedHolo(fixture);
  const guest = parseArchive(bytes).blobs.find((b) => b.label === 'blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380');
  bytes[guest.content.byteOffset + 100] ^= 0xff;
  const tampered = file('signed-tampered.holo', bytes);
  const { code, out } = run(['check', tampered, '--key', publicKey, '--json']);
  assert.equal(code, EXIT.FAILED);
  const verdict = JSON.parse(out);
  assert.equal(verdict.level, 'P0');
  assert.ok(checks(verdict).includes('holo.integrity') && checks(verdict).includes('proof.subject'), checks(verdict).join());
  assert.equal(verdict.reasons.find((r) => r.check === 'proof.subject').code, 'PP5503');
  assert.match(run(['check', tampered, '--key', publicKey]).out, /^ {2}proof\.subject \(PP5503, ProofMismatch, withholds P2\)$/m);
});

test('a proof statement signed for another build fails with ProofMismatch at P1: exit 1', async () => {
  // The Calculator's own statement, validly signed, attached to Payment Approval: the signature holds and the subject does not.
  const other = await signedHolo(paymentApproval, { proof: false });
  const bundle = await signStatement(readFileSync(here('../../spec/test/fixtures/attestation/statement/calculator.json')), { key: privatePem });
  const { code, out } = run(['check', file('mismatch.holo', appendAttestations(other, [bundle])), '--key', publicKey, '--json']);
  assert.equal(code, EXIT.FAILED);
  const verdict = JSON.parse(out);
  assert.equal(verdict.level, 'P1');
  assert.deepEqual(checks(verdict), ['proof.subject', 'proof.model', 'replay.statement', 'policy.level']);
  assert.equal(verdict.reasons[0].code, 'PP5503');
});

test('the committed signed fixtures are what check prints, signatures verified for real; the Rust CLI holds its verdicts against them (parity, #270)', () => {
  const signedDir = here('../test/fixtures/signed/');
  const damaged = new Uint8Array(readFileSync(join(signedDir, 'Calculator.signed.holo')));
  const guest = parseArchive(damaged).blobs.find((b) => b.label === 'blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380');
  damaged[guest.content.byteOffset + 100] ^= 0xff;
  const tamperedSigned = file('signed-golden-tampered.holo', damaged);
  const signer = join(signedDir, 'signer.pub.pem');
  for (const [name, args, code] of [
    ['calculator.trusted.json', [join(signedDir, 'Calculator.signed.holo'), '--key', signer], EXIT.PASSED],
    ['payment-approval.trusted.json', [join(signedDir, 'PaymentApproval.signed.holo'), '--key', signer], EXIT.PASSED],
    ['calculator.no-signer.json', [join(signedDir, 'Calculator.signed.holo')], EXIT.FAILED],
    ['calculator.stranger.json', [join(signedDir, 'Calculator.signed.holo'), '--key', join(signedDir, 'stranger.pub.pem')], EXIT.FAILED],
    ['payment-approval.mismatch.json', [join(signedDir, 'PaymentApproval.mismatch.holo'), '--key', signer], EXIT.FAILED],
    ['calculator.tampered.json', [tamperedSigned, '--key', signer], EXIT.FAILED],
  ]) {
    const { code: actual, out } = run(['check', ...args, '--json']);
    assert.equal(actual, code, name);
    assert.equal(out, readFileSync(join(signedDir, name), 'utf8'), name);
  }
});

test('a directory named like a holo is not one: no verdict', () => {
  const folder = join(dir, 'closure.holo');
  mkdirSync(folder);
  const { code, err } = run(['check', folder]);
  assert.equal(code, EXIT.NO_VERDICT);
  assert.match(err, /^no verdict: verify\.kind: .* is a directory/);
});

test('usage errors exit 64', () => {
  assert.equal(run(['check', fixture, fixture]).code, 64);
  assert.match(run(['check', fixture, '--frobnicate']).err, /check has no option --frobnicate/);
  assert.equal(run(['check', fixture, '--policy']).code, 64);
  assert.match(run(['--help']).out, /prism-code check <app\.holo> \[--policy <file>\] \[--json\]/);
});

test('the text form names the human title of each reason, and the limits from P2 up', () => {
  const tampered = JSON.parse(readFileSync(join(verdicts, 'calculator-p1-tampered-guest.json'), 'utf8'));
  const text = formatVerdict(tampered, 'app.holo');
  assert.match(text, /^FAILED {2}P1 provenance {2}policy default requires P2 or above\nholo {4}app\.holo\ndigest {2}blake3:/);
  assert.match(text, /^ {2}proof\.subject \(PP5503, ProofMismatch, withholds P2\)$/m);
  assert.equal(titleOf({ check: 'proof.subject' }), 'ProofMismatch');
  assert.doesNotMatch(text, /cannot know/);
  const passed = formatVerdict(JSON.parse(readFileSync(join(verdicts, 'calculator-p2-passed.json'), 'utf8')));
  assert.match(passed, /^PASSED {2}P2 proof checked/);
  assert.ok(passed.endsWith(`This check trusts the signer for what it cannot know:\n${LIMITS.map((l) => `  ${l}\n`).join('')}`));
});

test('the committed verdict goldens are what check prints; the Rust CLI holds its verdicts against them (AL-06)', () => {
  const goldens = here('../test/fixtures/verdict/');
  const bytes = new Uint8Array(readFileSync(fixture));
  const guest = parseArchive(bytes).blobs.find((b) => b.label === 'blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380');
  bytes[guest.content.byteOffset + 100] ^= 0xff;
  const tampered = file('golden-tampered.holo', bytes);
  const named = file('golden-p0.json', JSON.stringify({ name: 'p0', minimum: 'P0' }));
  for (const [name, args, code] of [
    ['calculator.default.json', [fixture], EXIT.FAILED],
    ['calculator.p0.json', [fixture, '--policy', named], EXIT.PASSED],
    ['calculator.tampered-guest.json', [tampered], EXIT.FAILED],
    ['payment-approval.default.json', [paymentApproval], EXIT.FAILED],
  ]) {
    const { code: actual, out } = run(['check', ...args, '--json']);
    assert.equal(actual, code, name);
    assert.equal(out, readFileSync(join(goldens, name), 'utf8'), name);
  }
});

test('check without a holo is the deprecated build --check: it warns and still runs', () => {
  const project = mkdtempSync(join(tmpdir(), 'prism-code-lock-'));
  writeFileSync(join(project, 'prismpm.lock'), JSON.stringify({ spec: 'prismpm/sdk-lock/2', sdk_image: IMAGE }));
  const env = { PRISM_CODE_DRY_RUN: '1' };
  const old = run(['check', '--verbose'], { cwd: project, env });
  assert.equal(old.code, 0, old.err);
  assert.match(old.err, /prism-code check without a holo is deprecated and is removed in 0\.4\.0; use prism-code build --check/);
  assert.ok(old.out.includes(`${IMAGE} prismpm check --verbose`));
  const current = run(['build', '--check', '--verbose'], { cwd: project, env });
  assert.equal(current.code, 0, current.err);
  assert.equal(current.err, '');
  assert.equal(current.out, old.out);
  assert.doesNotMatch(current.out, /--volume \/var\/run\/docker\.sock/, 'check needs no Docker socket');
  assert.ok(run(['build'], { cwd: project, env }).out.includes(`${IMAGE} prismpm build`));
});
