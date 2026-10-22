import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {corpusModule, corpusSource, directory} from './corpus.mjs';

const index = JSON.parse(readFileSync(new URL('lease-corpus.json', directory), 'utf8'));
const source = readFileSync(new URL('LeaseCorpus.lex.tex', directory), 'utf8');
const clone = () => structuredClone(index);

test('every explicit native lease case owns one exact canonical LexLean probe', () => {
  assert.equal(index.cases.length, 93);
  assert.equal(corpusSource(index), source);
  assert.equal(corpusModule(index).declarations.length, 93);
  for (const name of ['invalid_operation_gap', 'invalid_operation_maximum', 'opaque_zero_equal_references',
    'complete_deadline_equal', 'complete_cancelled', 'complete_unknown', 'complete_old_sequence',
    'unknown_after_close', 'retire_expired', 'retire_closed', 'retire_duplicate', 'readmit_same_digest',
    'begin_exhausted', 'begin_last', 'close_maximum_clock']) {
    assert(index.cases.some(row => row.name === name), name);
  }
});

test('changing any expected state, diagnostic, argument, order or inventory breaks the exact linkage', () => {
  for (const change of [
    value => { value.cases[0].expected.state.nextOperation = '1'; },
    value => { value.cases[1].expected.error = 'Busy'; },
    value => { value.cases[0].args[0] = 'ff'.repeat(32); },
    value => { [value.cases[0], value.cases[1]] = [value.cases[1], value.cases[0]]; },
    value => { value.cases.pop(); },
  ]) {
    const changed = clone(); change(changed);
    assert.notEqual(corpusSource(changed), source);
  }
});

test('unknown methods, ambiguous cases, extra fields and malformed scalar encodings cannot enter the corpus', () => {
  for (const change of [
    value => { value.extra = true; },
    value => { value.cases[1].name = value.cases[0].name; },
    value => { value.cases[0].method = 'callerSuppliedCleanup'; },
    value => { value.cases[0].args.push(''); },
    value => { value.cases[0].args[0] = 'AA'; },
    value => { value.cases[0].expected.error = 'BadState'; },
    value => { value.cases[0].expected.state.secret = 'not-a-lane-field'; },
    value => { value.cases[0].expected.state.observed = '01'; },
    value => { value.cases[0].expected.state.observed = '18446744073709551616'; },
    value => { value.cases[0].expected.state.closed = 'false'; },
  ]) {
    const changed = clone(); change(changed);
    assert.throws(() => corpusModule(changed));
  }
});
