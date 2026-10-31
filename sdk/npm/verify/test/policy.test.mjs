// Policy files (issue #285): the shipped policies against the input fixtures, the evaluator's contract, and verify().
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ASSURANCE, POLICIES, POLICY_INPUT_SCHEMA, VerifyError, evaluatePolicy, parsePolicy, policyInput, verify } from '../src/index.mjs';
import { here, reference } from './helpers.mjs';

const { RANK } = ASSURANCE;
const fixture = (name) => JSON.parse(readFileSync(here(`../../spec/test/fixtures/policy/policy-input-v1/${name}.json`), 'utf8'));
const policy = (rules) => `package prism.policy\n\nimport rego.v1\n\n${rules}\n`;
const code = (expected) => (error) => {
  assert.ok(error instanceof VerifyError, String(error));
  assert.equal(error.code, expected);
  return true;
};

/** Pass or fail, as `verify` turns a decision into `passed`. */
function judge(name, input) {
  const { minimum, denied, denials } = evaluatePolicy(parsePolicy(POLICIES[name]), input);
  return { passed: !denied && RANK[input.verdict.level] >= RANK[minimum], rules: denials.map((d) => d.rule) };
}

// The P1, P2 and over-privileged fixtures are the reference archive's real facts with the evidence a signed holo
// will carry written in by hand, because verify reads no statement yet and no build writes one (#267, #268).
const TABLE = [
  // fixture               default  pure-only  provenance-only
  ['calculator-p2', true, true, true],
  ['calculator-p0', false, true, false],
  ['provenance-p1', false, true, true],
  ['over-privileged-p2', false, false, true],
  ['tampered-p0', false, false, false],
  ['granted-p0', false, false, false],
];

for (const [name, byDefault, pure, provenance] of TABLE) {
  test(`the shipped policies on ${name}`, () => {
    const input = fixture(name);
    assert.equal(judge('default', input).passed, byDefault, 'default');
    assert.equal(judge('pure-only', input).passed, pure, 'pure-only');
    assert.equal(judge('provenance-only', input).passed, provenance, 'provenance-only');
  });
}

test('the default policy passes the facts of the reference archive at P2, and denies the same archive over-privileged', () => {
  assert.deepEqual(judge('default', fixture('calculator-p2')), { passed: true, rules: [] });
  const over = evaluatePolicy(parsePolicy(POLICIES.default), fixture('over-privileged-p2'));
  assert.equal(over.denied, true);
  assert.deepEqual(over.denials, [], 'it rests on the world.capabilities reason the evidence already holds');
});

test('the default policy is the file, and it says what the spec says', () => {
  assert.match(POLICIES.default, /^minimum := "P2"$/m);
  assert.equal(evaluatePolicy(parsePolicy(POLICIES.default), fixture('calculator-p0')).minimum, ASSURANCE.DEFAULT_MINIMUM);
});

test('pure-only names each thing beyond pure dispatch', () => {
  assert.deepEqual(judge('pure-only', fixture('over-privileged-p2')).rules, ['policy.pure-only.effects', 'policy.pure-only.imports']);
  assert.deepEqual(judge('pure-only', fixture('granted-p0')).rules, ['policy.pure-only.granted']);
  const provider = fixture('calculator-p0');
  provider.capabilities = { 'allow-providers': ['search'] };
  assert.deepEqual(judge('pure-only', provider).rules, ['policy.pure-only.granted']);
  const requests = fixture('calculator-p0');
  requests.world.capability_set.empty = false;
  assert.deepEqual(judge('pure-only', requests).rules, ['policy.pure-only.requested']);
  const none = fixture('calculator-p0');
  none.world = null;
  assert.deepEqual(judge('pure-only', none).rules, ['policy.pure-only.world']);
  const unknown = fixture('calculator-p0');
  Object.assign(unknown.world, { contract: 'other:world@1', known: false, within: null, pure: null, effects: null, imports: null });
  assert.deepEqual(judge('pure-only', unknown).rules, ['policy.pure-only.world']);
});

test('provenance-only asks for a statement whose signature checks, and for no proof', () => {
  assert.deepEqual(judge('provenance-only', fixture('provenance-p1')), { passed: true, rules: [] });
  assert.deepEqual(judge('provenance-only', fixture('calculator-p0')).rules, ['policy.provenance-only.absent']);
  const unverified = fixture('provenance-p1');
  unverified.predicates.provenance.verified = false;
  assert.deepEqual(judge('provenance-only', unverified), { passed: false, rules: ['policy.provenance-only.unverified'] });
});

test('calculator-p0.json is what policyInput returns for the reference archive', async () => {
  assert.deepEqual(await policyInput(reference()), fixture('calculator-p0'));
  assert.equal(fixture('calculator-p0').schema, POLICY_INPUT_SCHEMA);
});

test('policyInput carries the grant, and refuses one of the wrong shape', async () => {
  const set = { 'allow-variables': ['API_KEY'] };
  assert.deepEqual((await policyInput(reference(), { capabilities: set })).capabilities, set);
  await assert.rejects(policyInput(reference(), { capabilities: { nope: [] } }), code('policy.invalid'));
});

test('verify with no policy and verify with the default file reach the same verdict', async () => {
  const none = await verify(reference());
  const named = await verify(reference(), { name: 'default', rego: POLICIES.default });
  assert.deepEqual(named, none);
  assert.deepEqual([none.level, none.passed, none.policy], ['P0', false, { name: 'default', minimum: 'P2' }]);
});

test('a policy decides passed and never the level', async () => {
  const lenient = await verify(reference(), { name: 'pure-only', rego: POLICIES['pure-only'] });
  assert.deepEqual([lenient.level, lenient.passed, lenient.policy], ['P0', true, { name: 'pure-only', minimum: 'P0' }]);
  const strict = await verify(reference(), { rego: policy('minimum := "P3"') });
  assert.deepEqual([strict.level, strict.passed, strict.policy], ['P0', false, { name: 'policy', minimum: 'P3' }]);
  assert.equal(strict.reasons.at(-1).check, 'policy.level');
});

test('a denial is a verdict reason named by its rule, sorted, and fails the verdict', async () => {
  const verdict = await verify(
    reference(),
    {
      name: 'mine',
      rego: policy(`minimum := "P0"
deny contains {"rule": "policy.zeta", "message": "zeta"}
deny contains {"rule": "policy.alpha", "message": "second"}
deny contains {"rule": "policy.alpha", "message": "first"}`),
    },
  );
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.reasons.filter((r) => r.withholds === null).map((r) => [r.check, r.message]), [
    ['policy.alpha', 'First.'],
    ['policy.alpha', 'Second.'],
    ['policy.zeta', 'Zeta.'],
  ]);
});

test('a policy can read digests, so it can pin one', async () => {
  const pin = (sha256) => policy(`minimum := "P0"
deny contains {"rule": "policy.pin.guest", "message": "the guest is not the one pinned"} if {
	input.holo.digests.guest.sha256 != "${sha256}"
}`);
  assert.equal((await verify(reference(), { rego: pin('dcf53677c7c80636f8fc2247676b8f747d1549ce4af742c8505eb0f0ae334c03') })).passed, true);
  assert.equal((await verify(reference(), { rego: pin('0'.repeat(64)) })).passed, false);
});

test('a tampered archive still reaches a verdict: pure-only rests on holo.integrity, and adds no reason of its own', async () => {
  const bytes = reference();
  bytes[bytes.length - 200] ^= 0xff;
  const verdict = await verify(bytes, { name: 'pure-only', rego: POLICIES['pure-only'] });
  assert.equal(verdict.passed, false);
  assert.equal(verdict.level, 'P0');
  const reported = verdict.reasons.map((r) => r.check);
  assert.ok(reported.includes('holo.integrity'));
  assert.deepEqual(reported.filter((check) => check.startsWith('policy.')), []);
});

test('a policy that does not parse is policy.parse, before the holo is looked at', async () => {
  await assert.rejects(verify(reference(), { rego: 'package prism.policy\nminimum := \n' }), (error) => {
    code('policy.parse')(error);
    assert.match(error.message, /line 2, column/);
    return true;
  });
  await assert.rejects(verify(new Uint8Array(4), { rego: 'nope' }), code('policy.parse'));
});

const UNDECIDED = [
  ['minimum has no value', 'minimum := "P1" if input.holo.fingerprint == "x"', /rule minimum has no value/],
  ['minimum is not a level', 'minimum := "P9"', /rule minimum is "P9"/],
  ['deny holds a string', 'minimum := "P0"\ndeny contains "a string"', /rule deny produced "a string"/],
  ['deny holds an extra member', 'minimum := "P0"\ndeny contains {"rule": "policy.a", "message": "m", "extra": 1}', /exactly a rule and a message/],
  ['deny has no message', 'minimum := "P0"\ndeny contains {"rule": "policy.a"}', /exactly a rule and a message/],
  ['a rule that is not a dotted name', 'minimum := "P0"\ndeny contains {"rule": "Oops", "message": "m"}', /a rule is a dotted name/],
  ['a rule that takes a check of the verdict', 'minimum := "P0"\ndeny contains {"rule": "policy.level", "message": "m"}', /policy\.level, which already means something else/],
  ['a rule that takes a digest check', 'minimum := "P0"\ndeny contains {"rule": "policy.digests.guest", "message": "m"}', /already means something else/],
  ['a rule that invents evidence', 'minimum := "P0"\ndeny contains {"rule": "proof.subject", "message": "m"}', /neither a policy\.\* name nor a reason the evidence holds/],
  ['a rule that errors', 'minimum := "P0"\ndeny contains {"rule": "policy.a", "message": sprintf("%s", [input.verdict])}', /rule deny at line \d+: sprintf %s wants a string/],
];

for (const [name, rules, pattern] of UNDECIDED) {
  test(`policy.evaluation: ${name}`, async () => {
    await assert.rejects(verify(reference(), { rego: policy(rules) }), (error) => {
      code('policy.evaluation')(error);
      assert.match(error.message, pattern);
      return true;
    });
  });
}

test('evaluatePolicy refuses a document that is not prism/policy-input/1', () => {
  const program = parsePolicy(POLICIES.default);
  for (const name of ['unknown-level', 'carries-a-policy', 'no-predicates']) {
    const invalid = JSON.parse(readFileSync(here(`../../spec/test/fixtures/policy/policy-input-v1/invalid/${name}.json`), 'utf8'));
    assert.throws(() => evaluatePolicy(program, invalid), code('policy.evaluation'), name);
  }
});

test('a Rego policy states everything itself: options cannot adjust it', async () => {
  for (const member of [{ minimum: 'P0' }, { digests: {} }, { world: null }, { effects: [] }]) {
    await assert.rejects(verify(reference(), { rego: POLICIES.default, ...member }), code('policy.invalid'));
  }
});

test('the options of the check keep their meaning under the default file', async () => {
  const lowered = await verify(reference(), { minimum: 'P0' });
  assert.deepEqual([lowered.passed, lowered.policy], [true, { name: 'default', minimum: 'P0' }]);
  const pinned = await verify(reference(), { minimum: 'P0', digests: { guest: { sha256: '0'.repeat(64) } } });
  assert.equal(pinned.reasons.at(-1).check, 'policy.digests.guest');
  assert.equal(pinned.passed, false);
});

test('the docs page shows the shipped policies as they are', () => {
  const page = readFileSync(here('../../../../docs/site/reference/policy.md'), 'utf8').replace(/\r\n/g, '\n');
  for (const [name, source] of Object.entries(POLICIES)) assert.ok(page.includes(source.trimEnd()), `docs/site/reference/policy.md differs from ${name}.rego`);
});

test('the same inputs give the same verdict', async () => {
  const run = () => verify(reference(), { name: 'pure-only', rego: POLICIES['pure-only'] });
  assert.deepEqual(await run(), await run());
});
