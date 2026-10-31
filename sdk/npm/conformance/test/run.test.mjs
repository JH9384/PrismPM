// The harness: what it reports for a good runtime, a declared gap, a stale declaration, a broken shim and a lying runtime.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSuite, loadScenarios, allChecks, DECLARATION_SCHEMA, problemsOfDeclaration } from '../src/index.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-shim.mjs', import.meta.url));
const JS_SHIM = fileURLToPath(new URL('../../prism-code/conformance/shim.mjs', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/prism-conformance.mjs', import.meta.url));
const JS_DECLARATION = fileURLToPath(new URL('../../prism-code/conformance/declaration.json', import.meta.url));

const js = ['node', JS_SHIM];
const fake = (mode) => ['node', FAKE, mode];
const declaration = (members) => ({ schema: DECLARATION_SCHEMA, xfail: {}, notApplicable: {}, ...members });
const status = (results, id) => results.checks.find((check) => check.id === id)?.status;
const failing = (results) => results.checks.filter((check) => check.status === 'fail').map((check) => check.id);

test('prism-code passes the whole suite, and only the replay placeholders are expected failures', async () => {
  const results = await runSuite({ runtime: 'js', command: js, declaration: JSON.parse(readFileSync(JS_DECLARATION, 'utf8')) });
  assert.deepEqual(failing(results), []);
  assert.equal(results.passed, true);
  assert.equal(results.complete, true);
  assert.equal(results.implementation.name, 'prism-code');
  assert.deepEqual(results.revisions, ['2026-10-23']);
  const expected = results.checks.filter((check) => check.status === 'xfail').map((check) => check.id);
  assert.deepEqual(expected, allChecks(loadScenarios()).filter((check) => check.placeholder).map((check) => check.id));
  assert.ok(expected.every((id) => id.startsWith('replay.')));
  assert.equal(results.summary.pass + results.summary.xfail, results.checks.length);
});

test('a declared failure is xfail and the run passes', async () => {
  const results = await runSuite({ runtime: 'fake', command: fake('always-refuse'), only: 'load.reference', declaration: declaration({ xfail: { 'load.reference.opens': 'not there yet' } }) });
  assert.equal(status(results, 'load.reference.opens'), 'xfail');
  assert.equal(results.checks[0].reason, 'not there yet');
  assert.match(results.checks[0].detail, /expected a result/);
  assert.equal(results.passed, true);
});

test('an undeclared failure is fail and the run fails', async () => {
  const results = await runSuite({ runtime: 'fake', command: fake('always-refuse'), only: 'load.reference' });
  assert.equal(status(results, 'load.reference.opens'), 'fail');
  assert.equal(results.passed, false);
});

test('a declared failure that passes is an unexpected pass, and the run fails until the declaration goes', async () => {
  const results = await runSuite({ runtime: 'js', command: js, only: 'load.refuse.empty', declaration: declaration({ xfail: { 'load.refuse.empty': 'stale' } }) });
  assert.equal(status(results, 'load.refuse.empty'), 'unexpected-pass');
  assert.equal(results.summary['unexpected-pass'], 1);
  assert.equal(results.passed, false);
});

test('a feature declared not applicable is not run, and reports n/a', async () => {
  const results = await runSuite({ runtime: 'fake', command: fake('crash'), only: 'dispatch', declaration: declaration({ notApplicable: { dispatch: 'this runtime only reads archives' } }) });
  assert.ok(results.checks.every((check) => check.status === 'n/a'));
  assert.equal(results.passed, true);
});

test('a placeholder is xfail for every runtime, without running', async () => {
  const results = await runSuite({ runtime: 'fake', command: fake('crash'), only: 'replay' });
  assert.ok(results.checks.length > 0);
  assert.ok(results.checks.every((check) => check.status === 'xfail' && /^#284: /.test(check.reason)));
  assert.equal(results.passed, true);
});

test('a declaration that names what does not exist is refused, so it cannot go stale silently', () => {
  const features = loadScenarios();
  const problemsOf = (members) => problemsOfDeclaration(declaration(members), features);
  assert.match(problemsOf({ xfail: { 'load.no-such-check': 'x' } })[0], /no check of this suite/);
  assert.match(problemsOf({ xfail: { 'replay.history.unchanged': 'x' } })[0], /placeholder/);
  assert.match(problemsOf({ xfail: { 'load.refuse.empty': '' } })[0], /no reason/);
  assert.match(problemsOf({ notApplicable: { nothing: 'x' } })[0], /no feature/);
  assert.match(problemsOf({ notApplicable: { load: '' } })[0], /no reason/);
  assert.match(problemsOf({ xfail: { 'load.refuse.empty': 'x' }, notApplicable: { load: 'x' } })[0], /not applicable/);
  assert.match(problemsOfDeclaration({ schema: 'other' }, features)[0], /schema/);
  assert.match(problemsOf({ ignored: {} })[0], /unknown member/);
  assert.deepEqual(problemsOf({}), []);
});

test('runSuite refuses an invalid declaration before it runs anything', async () => {
  await assert.rejects(runSuite({ runtime: 'fake', command: fake('crash'), declaration: declaration({ xfail: { 'load.no-such-check': 'x' } }) }), /no check of this suite/);
});

test('a shim that speaks another contract stops the run, because no check could mean anything', async () => {
  await assert.rejects(runSuite({ runtime: 'fake', command: fake('wrong-contract') }), /speaks "prism\/conformance-shim\/0"/);
  await assert.rejects(runSuite({ runtime: 'fake', command: ['node', join(tmpdir(), 'does-not-exist.mjs')] }), /describe failed/);
});

for (const [mode, pattern, timeoutMs] of [
  ['crash', /exited 3: boom/],
  ['garbage', /not one JSON document/],
  ['no-code', /no error\.code/],
  ['hang', /no answer within 300 ms/, 300],
]) {
  test(`a shim that breaks (${mode}) fails the check even when a declaration names it`, async () => {
    const id = 'load.reference.opens';
    const results = await runSuite({ runtime: 'fake', command: fake(mode), only: id, timeoutMs: timeoutMs ?? 30000, declaration: declaration({ xfail: { [id]: 'declared' } }) });
    assert.equal(status(results, id), 'fail');
    assert.match(results.checks[0].detail, pattern);
    assert.equal(results.passed, false);
  });
}

test('an unsupported operation is a plain failure, so a partial runtime can start by declaring what it lacks', async () => {
  const id = 'dispatch.acceptance.reference';
  const bare = await runSuite({ runtime: 'fake', command: fake('unsupported'), only: id });
  assert.equal(status(bare, id), 'fail');
  assert.match(bare.checks[0].detail, /does not support this: this runtime has not got that far/);
  const declared = await runSuite({ runtime: 'fake', command: fake('unsupported'), only: id, declaration: declaration({ xfail: { [id]: 'no dispatch yet' } }) });
  assert.equal(status(declared, id), 'xfail');
  assert.equal(declared.passed, true);
});

for (const mode of ['always-ok', 'always-refuse', 'unsupported']) {
  test(`a runtime that answers everything the same way (${mode}) passes almost nothing`, async () => {
    const results = await runSuite({ runtime: 'fake', command: fake(mode) });
    const passedChecks = results.checks.filter((check) => check.status === 'pass').map((check) => check.id);
    assert.equal(results.passed, false);
    assert.deepEqual(passedChecks, [], 'no check may be satisfied by a constant answer');
  });
}

// Each lie, the part of the suite that must see it, and a check that must fail. The prefix keeps the run short.
const LIES = [
  ['allow-everything', 'capabilities', 'capabilities.none.denies-everything'],
  ['allow-everything', 'capabilities', 'capabilities.empty.deny-only-denies'],
  ['deny-does-not-win', 'capabilities.deny', 'capabilities.deny.wins-over-allow'],
  ['inflate-level', 'verify.level', 'verify.level.not-raised-by-policy'],
  ['always-passed', 'verify', 'verify.reference.default-policy'],
  ['always-passed', 'world.mismatch', 'world.mismatch.extra-export'],
  ['always-passed', 'digests.pin', 'digests.pin.one-of-two-wrong'],
  ['hide-integrity', 'verify.damage', 'verify.damage.footer'],
  ['hide-integrity', 'verify.damage', 'verify.damage.guest-label'],
  ['verdict-off-schema', 'verify.reference', 'verify.reference.minimum-p0'],
  ['hide-damage-on-load', 'load.damage', 'load.damage.footer-reported'],
  ['hide-damage-on-load', 'load.damage', 'load.damage.guest-label-reported'],
  ['one-digest-only', 'digests.archive', 'digests.archive.dual'],
  ['hide-damage-on-inspect', 'digests.damage', 'digests.damage.footer-reported'],
  ['wrong-byte', 'dispatch', 'dispatch.vectors.reference'],
  ['acceptance-only', 'dispatch', 'dispatch.vectors.reference'],
  ['untyped-errors', 'errors', 'errors.world.contract'],
  ['untyped-errors', 'errors', 'errors.capability.denied-import'],
  ['accept-bad-version', 'load.refuse', 'load.refuse.bad-version'],
];

for (const [mode, only, id] of LIES) {
  test(`the suite catches the lie ${mode} at ${id}`, async () => {
    const results = await runSuite({ runtime: 'fake', command: fake(mode), only });
    assert.equal(status(results, id), 'fail', JSON.stringify(results.checks.find((check) => check.id === id)));
    assert.equal(results.passed, false);
  });
}

test('the acceptance lie passes the runtime-reported replay, which is why dispatch has vectors of its own', async () => {
  const results = await runSuite({ runtime: 'fake', command: fake('acceptance-only'), only: 'dispatch.acceptance' });
  assert.equal(status(results, 'dispatch.acceptance.reference'), 'pass');
});

test('the environment of a scenario reaches the shim, and the machine\'s does not', async () => {
  const saved = process.env.PRISM_MINIMUM_LEVEL;
  process.env.PRISM_MINIMUM_LEVEL = 'P3';
  try {
    const results = await runSuite({ runtime: 'js', command: js, only: 'verify.reference.default-policy' });
    assert.equal(status(results, 'verify.reference.default-policy'), 'pass');
    const set = await runSuite({ runtime: 'js', command: js, only: 'verify.env.sets-minimum' });
    assert.equal(status(set, 'verify.env.sets-minimum'), 'pass');
  } finally {
    if (saved === undefined) delete process.env.PRISM_MINIMUM_LEVEL;
    else process.env.PRISM_MINIMUM_LEVEL = saved;
  }
});

const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

test('the CLI: exit 0 passed, 1 failed, 2 cannot run, 64 bad usage, and --out writes the results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-conformance-cli-'));
  const out = join(dir, 'nested', 'r.json');
  const passed = cli('run', '--runtime', 'js', '--only', 'load.refuse.empty', '--out', out);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /^pass +load\.refuse\.empty$/m);
  assert.match(passed.stdout, /1 checks: 1 pass, 0 fail, 0 xfail, 0 unexpected pass, 0 n\/a/);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).schema, 'prism/conformance-results/1');

  const failed = cli('run', '--runtime', 'other', '--only', 'load.refuse.empty', '--', process.execPath, FAKE, 'always-ok');
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /^fail +load\.refuse\.empty +expected an error/m);
  assert.match(failed.stdout, /^FAILED$/m);

  const declarationPath = join(dir, 'd.json');
  writeFileSync(declarationPath, JSON.stringify(declaration({ xfail: { 'load.refuse.empty': 'stale' } })));
  const stale = cli('run', '--runtime', 'other', '--only', 'load.refuse.empty', '--declaration', declarationPath, '--', process.execPath, JS_SHIM);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /^unexpected-pass +load\.refuse\.empty/m);
  assert.match(stale.stdout, /remove the entry from the declaration/);

  assert.equal(cli('run', '--runtime', 'other', '--', process.execPath, FAKE, 'wrong-contract').status, 2);
  assert.equal(cli('run', '--runtime', 'nobody').status, 64);
  assert.equal(cli('run', '--runtime', 'rust').status, 64, 'rust has no shim yet');
  assert.equal(cli('run').status, 64);
  assert.equal(cli('nonsense').status, 64);
  assert.equal(cli('--unknown').status, 64);
  assert.equal(cli('--help').status, 0);
  assert.ok(cli('list').stdout.split('\n').includes('digests.archive.dual'));
});
