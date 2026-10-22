import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequiredChecks, executeRequiredSubtest, writeOwnerReport} from './aggregate.mjs';

test('required diagnostics continue after failures and explicitly throw the aggregate', async () => {
  const ran = [], required = createRequiredChecks(['provider', 'mutant-1', 'mutant-2']);
  const first = Error('original provider failure'), second = Error('actual mutant failure');
  assert.equal((await required.check('provider', () => {ran.push('provider'); throw first;})).ok, false);
  assert.equal((await required.check('mutant-1', () => {ran.push('mutant-1'); return 1;})).value, 1);
  assert.equal((await required.check('mutant-2', async () => {ran.push('mutant-2'); throw second;})).ok, false);
  assert.deepEqual(ran, ['provider', 'mutant-1', 'mutant-2']);
  assert.deepEqual(required.report().map(row => [row.id, row.passed]),
    [['provider', false], ['mutant-1', true], ['mutant-2', false]]);
  assert.throws(() => required.finish(), error => error instanceof AggregateError
    && error.errors.length === 2 && error.errors[0] === first && error.errors[1] === second);
  await assert.rejects(required.check('mutant-2', () => {}), /closed/);
  const helper = new URL('./aggregate.mjs', import.meta.url).href;
  const source = `import test from 'node:test'; import {createRequiredChecks,executeRequiredSubtest} from ${JSON.stringify(helper)};
    test('actual parent',async t=>{const checks=createRequiredChecks(['failed','later']);
    await checks.check('failed',()=>executeRequiredSubtest(t,'actual failed child',()=>{throw Error('planted provider failure')}));
    await checks.check('later',()=>executeRequiredSubtest(t,'actual later child',()=>console.log('LATER_REQUIRED_CHECK_EXECUTED')));
    checks.finish();console.log('INCORRECT_ACCEPTANCE')});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {encoding: 'utf8', timeout: 10000});
  assert.equal(child.status, 1); assert.match(child.stdout, /LATER_REQUIRED_CHECK_EXECUTED/);
  assert.match(child.stdout, /AggregateError|required checks failed/);
  assert.doesNotMatch(child.stdout, /INCORRECT_ACCEPTANCE/);
});

test('missing reordered repeated and unexecuted required checks cannot pass', async () => {
  assert.throws(() => createRequiredChecks(['a', 'a']), /unique/);
  assert.throws(() => createRequiredChecks([]), /nonempty/);
  const missing = createRequiredChecks(['a', 'b']);
  await missing.check('a', () => true);
  assert.throws(() => missing.finish(), /complete required check inventory/);
  const wrong = createRequiredChecks(['a', 'b']);
  await assert.rejects(wrong.check('b', () => true), /required check order/);
  await wrong.check('a', () => true);
  await assert.rejects(wrong.check('a', () => true), /required check order/);
  await wrong.check('b', () => true);
  assert.throws(() => wrong.finish(), /invalid required check invocation/);
  const untouched = createRequiredChecks(['a']);
  assert.throws(() => untouched.finish(), /complete required check inventory/);
  await assert.rejects(executeRequiredSubtest({test: async () => {}}, 'not run', () => true),
    /required subtest body was not executed/);
});

test('only a complete successful immutable collection can emit its owning receipt', async t => {
  const selected = ['a', 'b'], required = createRequiredChecks(selected);
  selected.pop();
  await required.check('a', () => true);
  await required.check('b', async () => true);
  const report = required.report();
  assert.ok(Object.isFrozen(report) && report.every(Object.isFrozen));
  assert.throws(() => {report[0].passed = false;}, TypeError);
  assert.deepEqual(required.finish().map(row => row.id), ['a', 'b']);
  assert.throws(() => required.finish(), /closed/);
  const work = mkdtempSync(join(tmpdir(), 'prismpm-signed-context-aggregate-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  const failed = createRequiredChecks(['generated', 'final-closure']);
  await failed.check('generated', () => true);
  await failed.check('final-closure', () => {throw Error('actual changed source closure');});
  assert.throws(() => writeOwnerReport(failed, {publicApplicationAccepted: false}, work), AggregateError);
  const attempt = JSON.parse(readFileSync(join(work, 'signed-context-owner-attempt.json')));
  assert.equal(attempt.componentAccepted, false);
  assert.equal(attempt.requiredChecks[1].passed, false);
  assert.ok(!existsSync(join(work, 'signed-context-owner.json')));
  const helper = readFileSync(new URL('./aggregate.mjs', import.meta.url), 'utf8');
  assert.equal(helper.split('  required.finish();').length, 2, 'exact final acceptance guard');
  const mutantWork = mkdtempSync(join(tmpdir(), 'prismpm-signed-context-aggregate-mutant-'));
  t.after(() => rmSync(mutantWork, {recursive: true, force: true}));
  const mutantSource = helper.replace('  required.finish();', '  // planted missing acceptance guard')
    + `\nconst mutantChecks=createRequiredChecks(['final-closure']);
      await mutantChecks.check('final-closure',()=>{throw Error('actual changed source closure')});
      writeOwnerReport(mutantChecks,{publicApplicationAccepted:false},${JSON.stringify(mutantWork)});`;
  const mutant = spawnSync(process.execPath, ['--input-type=module', '-e', mutantSource],
    {encoding: 'utf8', timeout: 10000});
  assert.equal(mutant.error, undefined); assert.equal(mutant.signal, null);
  assert.equal(mutant.status, 0, mutant.stderr);
  assert.ok(existsSync(join(mutantWork, 'signed-context-owner.json')),
    'actual removed-guard defect emits a forbidden success receipt');
  const ownerSource = readFileSync(new URL('./checks.mjs', import.meta.url), 'utf8');
  assert.equal(ownerSource.split('  writeOwnerReport(required, evidence, build.work);').length, 2);
  assert.ok(!ownerSource.includes("'signed-context-owner.json'"), 'no bypass writer in owning entry');
  const successWork = mkdtempSync(join(tmpdir(), 'prismpm-signed-context-aggregate-success-'));
  t.after(() => rmSync(successWork, {recursive: true, force: true}));
  const success = createRequiredChecks(['generated', 'final-closure']);
  await success.check('generated', () => true); await success.check('final-closure', () => true);
  writeOwnerReport(success, {publicApplicationAccepted: false}, successWork);
  const receipt = JSON.parse(readFileSync(join(successWork, 'signed-context-owner.json')));
  assert.ok(receipt.requiredChecks.every(row => row.passed));
  assert.equal(receipt.scope, 'private-signed-context-complete-component');
  assert.ok(!existsSync(join(successWork, 'signed-context-owner-attempt.json')));
});
