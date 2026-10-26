// `prism-code attest` and `prism-code verify-attestation` (#272): a round trip with a local key, the exit codes, and the JSON result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const PROOF = 'https://uor.foundation/prism/proof/v1';

const run = (...args) => {
  const env = { ...process.env };
  for (const name of ['SIGSTORE_ID_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']) delete env[name];
  const out = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env });
  return { code: out.status, stdout: out.stdout, stderr: out.stderr };
};

const dir = mkdtempSync(join(tmpdir(), 'prism-attest-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
writeFileSync(join(dir, 'private.pem'), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
writeFileSync(join(dir, 'public.pem'), pair.publicKey.export({ type: 'spki', format: 'pem' }));
writeFileSync(join(dir, 'other.pem'), other.publicKey.export({ type: 'spki', format: 'pem' }));
writeFileSync(join(dir, 'predicate.json'), JSON.stringify({ accepted: true }));
const p = (name) => join(dir, name);

test('attest writes the signed holo to --output and leaves the input alone; verify-attestation accepts it', () => {
  copyFileSync(fixture, p('app.holo'));
  const before = readFileSync(p('app.holo'));
  const attested = run('attest', p('app.holo'), '--predicate', p('predicate.json'), '--type', PROOF, '--key', p('private.pem'), '--output', p('signed.holo'));
  assert.equal(attested.code, 0, attested.stderr);
  assert.match(attested.stdout, /attested https:\/\/uor\.foundation\/prism\/proof\/v1 \(guest\), key [0-9a-f]{64}; 1 attestation\n/);
  assert.deepEqual(readFileSync(p('app.holo')), before);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no scratch file is left behind');

  const verified = run('verify-attestation', p('signed.holo'), '--key', p('public.pem'), '--type', PROOF);
  assert.equal(verified.code, 0, verified.stderr);
  assert.match(verified.stdout, /attestation 0 .*\(guest\): verified key [0-9a-f]{64}\nverified\n$/);

  // The section is an ordinary Extension row, so the holo still inspects and its footer still verifies.
  assert.match(run('inspect', p('signed.holo')).stdout, /Footer:\s+[0-9a-f]{64}/);
});

test('without --output attest signs in place, and a second attest adds a second bundle', () => {
  copyFileSync(fixture, p('inplace.holo'));
  for (const [i, subject] of ['guest', 'view'].entries()) {
    const out = run('attest', p('inplace.holo'), '--predicate', p('predicate.json'), '--type', PROOF, '--subject', subject, '--key', p('private.pem'));
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, new RegExp(`\\(${subject}\\), key [0-9a-f]{64}; ${i + 1} attestation`));
  }
  const json = JSON.parse(run('verify-attestation', p('inplace.holo'), '--key', p('public.pem'), '--json').stdout);
  assert.equal(json.passed, true);
  assert.deepEqual(json.results.map((r) => r.subjects), [['guest'], ['view']]);
});

test('--json reports a failure as data, with the typed error, and exits 1', () => {
  const out = run('verify-attestation', p('signed.holo'), '--key', p('other.pem'), '--json');
  assert.equal(out.code, 1);
  const json = JSON.parse(out.stdout);
  assert.equal(json.passed, false);
  assert.equal(json.results[0].error.code, 'signature_invalid');
  assert.match(json.results[0].error.check, /^signature\./);
  assert.equal(json.error.code, 'signature_invalid');
  const text = run('verify-attestation', p('signed.holo'), '--key', p('other.pem'));
  assert.equal(text.code, 1);
  assert.match(text.stdout, /signature_invalid: .*\nnot verified\n$/);
});

test('a holo with no attestation exits 1 and names attestation_not_found', () => {
  const out = run('verify-attestation', fixture, '--key', p('public.pem'));
  assert.equal(out.code, 1);
  assert.match(out.stderr, /attestation_not_found: the holo has no attestation section/);
});

test('a policy that would let any signer pass is a usage error, exit 64', () => {
  const none = run('verify-attestation', p('signed.holo'));
  assert.equal(none.code, 64);
  assert.match(none.stderr, /policy\.invalid/);
  const issuerOnly = run('verify-attestation', p('signed.holo'), '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com');
  assert.equal(issuerOnly.code, 64);
  assert.equal(run('verify-attestation', p('signed.holo'), '--key', p('public.pem'), '--entries', 'many').code, 64);
});

test('missing operands and values are usage errors, exit 64', () => {
  assert.equal(run('attest').code, 64);
  assert.equal(run('attest', fixture).code, 64);
  assert.equal(run('attest', fixture, '--predicate', p('predicate.json')).code, 64);
  assert.equal(run('attest', fixture, '--predicate').code, 64);
  assert.equal(run('verify-attestation').code, 64);
  assert.equal(run('verify-attestation', fixture, '--key').code, 64);
});

test('unreadable operands are PrismCodeErrors, exit 2', () => {
  const missing = run('attest', fixture, '--predicate', p('nope.json'), '--type', PROOF, '--key', p('private.pem'), '--output', p('x.holo'));
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /load\.path: the predicate/);
  assert.equal(run('verify-attestation', fixture, '--key', p('nope.pem')).code, 2);
});

test('keyless attest with no identity token exits 3 and says how to give one', () => {
  copyFileSync(fixture, p('keyless.holo'));
  const out = run('attest', p('keyless.holo'), '--predicate', p('predicate.json'), '--type', PROOF, '--signing-config', p('missing-config.json'));
  assert.equal(out.code, 3);
  assert.match(out.stderr, /signing_failed/);
  assert.match(out.stderr, /check: sign\.config/);
  assert.deepEqual(readFileSync(p('keyless.holo')), readFileSync(fixture), 'a failed attest leaves the holo as it was');
});

test('the help names both verbs', () => {
  const out = run('--help');
  assert.match(out.stdout, /prism-code attest <app\.holo> --predicate <file> --type <uri>/);
  assert.match(out.stdout, /prism-code verify-attestation <app\.holo>/);
});
