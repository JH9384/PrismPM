// `prism-code check --policy` with policy files (issue #285): the shipped policies, Rego files, the three typed errors,
// the exit codes that tell a denial from an error, and the rule that a policy never lives in the holo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ERROR_CLASSES,
  PolicyDeniedError,
  PolicyEvaluationError,
  PolicyParseError,
  PrismError,
  VerificationError,
  CapabilityDeniedError,
  classForCheck,
  encodeArchive,
  experimental_verify,
  parseArchive,
} from '../src/index.mjs';
import { check, EXIT, readPolicy, titleOf } from '../src/check.mjs';
import { POLICIES } from '../src/vendor/verify.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const bin = here('../bin/prism-code.mjs');
const fixture = here('../fixtures/Calculator.holo');
const dir = mkdtempSync(join(tmpdir(), 'prism-code-policy-'));

function run(args, env = {}) {
  const merged = { ...process.env, ...env };
  if (!('PRISM_MINIMUM_LEVEL' in env)) delete merged.PRISM_MINIMUM_LEVEL;
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: merged });
  return { code: result.status, out: result.stdout, err: result.stderr };
}
function file(name, content) {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}
const rego = (name, rules) => file(name, `package prism.policy\n\nimport rego.v1\n\n${rules}\n`);
const checks = (verdict) => verdict.reasons.map((r) => r.check);

function tampered() {
  const bytes = new Uint8Array(readFileSync(fixture));
  bytes[bytes.length - 200] ^= 0xff;
  return bytes;
}

test('the three policy errors are verification errors with stable codes of their own', () => {
  assert.deepEqual(
    [PolicyParseError, PolicyEvaluationError, PolicyDeniedError].map((C) => C.code),
    ['policy_parse_failed', 'policy_evaluation_failed', 'policy_denied'],
  );
  for (const C of [PolicyParseError, PolicyEvaluationError, PolicyDeniedError]) {
    const error = new C('message', { check: 'policy.x' });
    assert.ok(error instanceof VerificationError && error instanceof PrismError);
    assert.equal(error.code, C.code);
    assert.equal(ERROR_CLASSES[C.code], C);
  }
});

test('a check id maps to its class, and the checks from before policy files keep theirs', () => {
  assert.equal(classForCheck('policy.parse'), PolicyParseError);
  assert.equal(classForCheck('policy.evaluation'), PolicyEvaluationError);
  assert.equal(classForCheck('policy.pure-only.effects'), PolicyDeniedError);
  assert.equal(classForCheck('policy.mine'), PolicyDeniedError);
  for (const check of ['policy.level', 'policy.effects', 'policy.invalid', 'policy.unreadable', 'policy.digests.guest']) assert.equal(classForCheck(check), VerificationError, check);
  assert.equal(classForCheck('world.capabilities'), CapabilityDeniedError);
});

test('--policy pure-only passes the reference archive: exit 0, named by its name', () => {
  const { code, out, err } = run(['check', fixture, '--policy', 'pure-only', '--json']);
  assert.equal(code, EXIT.PASSED, err);
  const verdict = JSON.parse(out);
  assert.deepEqual([verdict.level, verdict.passed, verdict.policy], ['P0', true, { minimum: 'P0', name: 'pure-only' }]);
});

test('--policy provenance-only fails the reference archive: exit 1, with the rule named', () => {
  const { code, out } = run(['check', fixture, '--policy', 'provenance-only', '--json']);
  assert.equal(code, EXIT.FAILED);
  const verdict = JSON.parse(out);
  assert.deepEqual(verdict.policy, { minimum: 'P1', name: 'provenance-only' });
  assert.deepEqual(checks(verdict).slice(-2), ['policy.level', 'policy.provenance-only.absent']);
  const text = run(['check', fixture, '--policy', 'provenance-only']).out;
  assert.match(text, /^ {2}policy\.provenance-only\.absent \(PolicyDenied, policy rule\)$/m);
});

test('--policy default is the same check as no --policy', () => {
  const none = run(['check', fixture, '--json']);
  const named = run(['check', fixture, '--policy', 'default', '--json']);
  assert.equal(named.code, EXIT.FAILED);
  assert.equal(named.out, none.out);
});

test('a tampered holo is denied by the default policy and by pure-only: exit 1', () => {
  const path = file('tampered.holo', tampered());
  for (const args of [[], ['--policy', 'pure-only']]) {
    const { code, out } = run(['check', path, ...args, '--json']);
    assert.equal(code, EXIT.FAILED, args.join(' '));
    const verdict = JSON.parse(out);
    assert.equal(verdict.level, 'P0');
    assert.ok(checks(verdict).includes('holo.integrity'));
  }
});

test('an over-privileged run is denied by pure-only: the caller granted more than pure dispatch', async () => {
  const verdict = await check(fixture, { policy: 'pure-only', capabilities: { 'allow-variables': ['API_KEY'] } });
  assert.equal(verdict.passed, false);
  assert.deepEqual(checks(verdict).at(-1), 'policy.pure-only.granted');
  assert.match(verdict.reasons.at(-1).message, /allow-variables/);
  assert.equal(titleOf(verdict.reasons.at(-1)), 'PolicyDenied');
  assert.equal((await check(fixture, { policy: 'pure-only', capabilities: {} })).passed, true);
});

test('a Rego file decides, and is named by its path', () => {
  const pass = rego('pass.rego', 'minimum := "P0"');
  const passed = run(['check', fixture, '--policy', pass, '--json']);
  assert.equal(passed.code, EXIT.PASSED, passed.err);
  assert.deepEqual(JSON.parse(passed.out).policy, { minimum: 'P0', name: pass });

  const deny = rego('deny.rego', 'minimum := "P0"\ndeny contains {"rule": "policy.house.no-calculators", "message": sprintf("%s is not allowed", [input.world.contract])}');
  const denied = run(['check', fixture, '--policy', deny, '--json']);
  assert.equal(denied.code, EXIT.FAILED);
  const reason = JSON.parse(denied.out).reasons.at(-1);
  assert.deepEqual(reason, { check: 'policy.house.no-calculators', message: 'Hologram:guest/core-wasm@1 is not allowed.', withholds: null });
});

test('a policy that denies is exit 1, one that cannot be parsed or evaluated is exit 2: CI can tell them apart', () => {
  const denies = rego('denies.rego', 'minimum := "P0"\ndeny contains {"rule": "policy.no", "message": "no"}');
  const malformed = file('malformed.rego', 'package prism.policy\nminimum := \n');
  const outside = rego('outside.rego', 'minimum := "P0"\ndeny contains {"rule": "policy.t", "message": sprintf("%d", [time.now_ns()])}');
  const conflict = rego('conflict.rego', 'minimum := "P0"\nminimum := "P1"');
  const missing = rego('missing.rego', 'minimum := "P0" if input.nope');

  assert.equal(run(['check', fixture, '--policy', denies]).code, EXIT.FAILED);
  for (const [path, check, pattern] of [
    [malformed, 'policy.parse', /line 2, column \d+/],
    [outside, 'policy.parse', /time\.now_ns is outside the subset/],
    [conflict, 'policy.evaluation', /rule minimum at line \d+: minimum has two different values/],
    [missing, 'policy.evaluation', /rule minimum has no value/],
  ]) {
    const { code, out, err } = run(['check', fixture, '--policy', path, '--json']);
    assert.equal(code, EXIT.NO_VERDICT, path);
    assert.equal(out, '', 'no verdict on stdout');
    assert.match(err, new RegExp(`^no verdict: ${check.replace('.', '\\.')}: `));
    assert.match(err, pattern);
  }
});

test('the errors are typed through the API: parse and evaluation reject, a denial throws with throw: true', async () => {
  const bytes = new Uint8Array(readFileSync(fixture));
  await assert.rejects(experimental_verify(bytes, { rego: 'nonsense' }), (error) => {
    assert.ok(error instanceof PolicyParseError);
    assert.equal(error.code, 'policy_parse_failed');
    assert.equal(error.check, 'policy.parse');
    return true;
  });
  await assert.rejects(experimental_verify(bytes, { rego: 'package prism.policy\nminimum := "P9"' }), (error) => {
    assert.ok(error instanceof PolicyEvaluationError);
    assert.equal(error.code, 'policy_evaluation_failed');
    assert.equal(error.check, 'policy.evaluation');
    assert.match(error.message, /rule minimum is "P9"/);
    return true;
  });
  const denies = 'package prism.policy\nminimum := "P0"\ndeny contains {"rule": "policy.no", "message": "the answer is no"}';
  await assert.rejects(experimental_verify(bytes, { rego: denies, throw: true }), (error) => {
    assert.ok(error instanceof PolicyDeniedError);
    assert.equal(error.code, 'policy_denied');
    assert.equal(error.check, 'policy.no');
    assert.equal(error.message, 'The answer is no.');
    assert.equal(error.verdict.passed, false);
    return true;
  });
  const verdict = await experimental_verify(bytes, { rego: denies });
  assert.equal(verdict.passed, false);
});

test('a CUE file is a typed parse error today, so the second language is additive', async () => {
  const { code, err } = run(['check', fixture, '--policy', file('policy.cue', 'minimum: "P0"\n')]);
  assert.equal(code, EXIT.NO_VERDICT);
  assert.match(err, /^no verdict: policy\.parse: .*CUE/);
  await assert.rejects(readPolicy('policy.cue'), PolicyParseError);
});

test('PRISM_MINIMUM_LEVEL never lowers what a Rego policy states', () => {
  const strict = rego('strict.rego', 'minimum := "P2"');
  const { code, out } = run(['check', fixture, '--policy', strict, '--json'], { PRISM_MINIMUM_LEVEL: 'P0' });
  assert.equal(code, EXIT.FAILED);
  assert.equal(JSON.parse(out).policy.minimum, 'P2');
});

test('JSON policy files keep working, and a file named like a shipped policy is reached by a path', async () => {
  const json = file('p0.json', JSON.stringify({ minimum: 'P0' }));
  assert.equal(run(['check', fixture, '--policy', json]).code, EXIT.PASSED);
  assert.deepEqual(await readPolicy('pure-only'), { name: 'pure-only', rego: POLICIES['pure-only'] });
  await assert.rejects(readPolicy('not-shipped'), (error) => error.check === 'policy.unreadable');
  await assert.rejects(readPolicy(join(dir, 'gone.rego')), (error) => error.check === 'policy.unreadable');
});

test('a policy never lives in the holo: an archive with a policy section gets no verdict, and its policy is never read', () => {
  const parsed = parseArchive(new Uint8Array(readFileSync(fixture)));
  const permissive = new TextEncoder().encode(`prism.policy\0${POLICIES['pure-only']}`);
  const sections = parsed.sections.map(({ kind, body }) => ({ kind, body }));
  sections.push({ kind: 14, body: permissive });
  const path = file('smuggled.holo', encodeArchive(sections, { version: parsed.version, flags: parsed.flags }));
  const { code, out, err } = run(['check', path, '--json']);
  assert.equal(code, EXIT.NO_VERDICT);
  assert.equal(out, '');
  assert.match(err, /^no verdict: format\.revision: /);
});

test('run gates on a policy file the same way check does', () => {
  const denied = run(['run', fixture, '--policy', 'provenance-only']);
  assert.equal(denied.code, EXIT.FAILED);
  assert.match(denied.err, /policy\.provenance-only\.absent/);
  assert.match(denied.err, /run refused/);
  const broken = run(['run', fixture, '--policy', file('broken.rego', 'nonsense')]);
  assert.equal(broken.code, EXIT.NO_VERDICT);
  assert.match(broken.err, /^no verdict: policy\.parse: /);
});

test.todo('the real Calculator.holo passes the default policy: needs a holo that carries signed statements (#267, #268); the evaluator side is held by calculator-p2.json in @prism-code/verify');
test.todo('the Payment Approval reference archive passes the default policy: the archive is not in this repository, and needs the same statements');
