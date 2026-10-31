// `prism-code check <app.holo>` (#270): the verdict, its text and JSON forms, and exit codes 0, 1 and 2.
// The deprecated Docker-backed spelling and `build --check` are covered at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArchive, appendAttestations } from '../src/index.mjs';
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
  const statement = readFileSync(here('../../spec/test/fixtures/attestation/statement/calculator.json'));
  const bundle = { mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json', verificationMaterial: { publicKey: { hint: 'x' } }, dsseEnvelope: { payload: statement.toString('base64'), payloadType: 'application/vnd.in-toto+json', signatures: [{ sig: 'AA==' }] } };
  const signed = file('signed.holo', appendAttestations(new Uint8Array(readFileSync(fixture)), [bundle]));
  const cases = [
    [[join(dir, 'missing.holo')], /^no verdict: load\.path: /],
    [[notHolo], /^no verdict: archive\.magic: /],
    [[fixture, '--policy', join(dir, 'missing.json')], /^no verdict: policy\.unreadable: /],
    [[fixture, '--policy', notJson], /^no verdict: policy\.invalid: .* is not JSON/],
    [[fixture, '--policy', unknown], /^no verdict: policy\.invalid: .*unknown members signer/],
    [[fixture, '--policy', badLevel], /^no verdict: policy\.invalid: policy\.minimum "P4"/],
    [[signed], /^no verdict: format\.revision: the holo carries an attestation section .*#267/],
  ];
  for (const [args, message] of cases) {
    const { code, out, err } = run(['check', ...args, '--json']);
    assert.equal(code, EXIT.NO_VERDICT, `${args.join(' ')}: ${err}`);
    assert.equal(out, '', args.join(' '));
    assert.match(err, message);
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
