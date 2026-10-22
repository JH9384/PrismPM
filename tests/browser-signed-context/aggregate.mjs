// Test orchestration only: continuing diagnostics never converts a failure to a pass.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function writeOwnerReport(required, evidence, work) {
  evidence.requiredChecks = required.report();
  if (evidence.requiredChecks.some(row => !row.passed)) {
    writeFileSync(join(work, 'signed-context-owner-attempt.json'), JSON.stringify({...evidence,
      scope: 'private-signed-context-incomplete-owner-attempt', componentAccepted: false}, null, 2) + '\n', {flag: 'wx'});
  }
  required.finish();
  evidence.scope = 'private-signed-context-complete-component';
  writeFileSync(join(work, 'signed-context-owner.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
}

export async function executeRequiredSubtest(t, name, body) {
  let entered = false, completed = false, failed = false, failure;
  await t.test(name, async () => {
    entered = true;
    try {await body(); completed = true;}
    catch (error) {failed = true; failure = error; throw error;}
  });
  // A resolved t.test promise does not mean its body ran or passed.
  assert.ok(entered, 'required subtest body was not executed');
  if (failed) throw failure;
  assert.ok(completed, 'required subtest body did not complete');
}

export function createRequiredChecks(ids) {
  assert.ok(Array.isArray(ids) && ids.length > 0, 'nonempty required check inventory');
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0)
    && new Set(ids).size === ids.length, 'unique named required checks');
  const expected = Object.freeze([...ids]), rows = [], errors = [], invalid = [];
  let next = 0, busy = false, closed = false;
  const report = () => Object.freeze(rows.map(row => Object.freeze({...row})));
  return Object.freeze({
    async check(id, operation) {
      try {
        assert.ok(!closed, 'required checks closed');
        assert.ok(!busy, 'required checks must execute sequentially');
        assert.equal(id, expected[next], 'required check order');
        assert.equal(typeof operation, 'function', 'actual required check callback');
      } catch (error) {invalid.push(error); throw error;}
      next++; busy = true;
      try {
        const value = await operation(); rows.push({id, passed: true});
        return Object.freeze({ok: true, value});
      } catch (error) {
        errors.push(error);
        rows.push({id, passed: false, error: Object.freeze({name: String(error?.name ?? 'Error'),
          message: String(error?.message ?? error)})});
        return Object.freeze({ok: false, error});
      } finally {busy = false;}
    },
    report,
    finish() {
      assert.ok(!closed, 'required checks closed'); closed = true;
      assert.ok(!busy && next === expected.length && rows.length === expected.length,
        'complete required check inventory');
      assert.deepEqual(rows.map(row => row.id), expected, 'complete required check inventory');
      assert.equal(invalid.length, 0, 'invalid required check invocation');
      if (errors.length > 0) throw new AggregateError(errors, 'required checks failed');
      return report();
    },
  });
}
