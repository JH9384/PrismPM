// COMPLIANCE.md: its cells, what it refuses to publish, and that the committed file is current.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allChecks, loadScenarios, renderMatrix, sameMatrix, RESULTS_SCHEMA } from '../src/index.mjs';

const BIN = fileURLToPath(new URL('../bin/prism-conformance.mjs', import.meta.url));
const COMPLIANCE = fileURLToPath(new URL('../../../../COMPLIANCE.md', import.meta.url));

const features = [
  {
    feature: 'alpha',
    title: 'Alpha',
    checks: [
      { id: 'alpha.one', title: 'One.' },
      { id: 'alpha.two', title: 'Two | with a pipe.' },
    ],
  },
  { feature: 'beta', title: 'Beta', checks: [{ id: 'beta.one', title: 'One.' }] },
];

function results(runtime, statuses, members = {}) {
  const checks = Object.entries(statuses).map(([id, status]) => ({ id, feature: id.split('.')[0], status, ...(status === 'xfail' ? { reason: `why ${id}` } : {}) }));
  return { schema: RESULTS_SCHEMA, runtime, implementation: { name: runtime, version: '1' }, revisions: [], passed: true, complete: true, summary: {}, checks, ...members };
}

const render = (js, rust = null) => renderMatrix({ features, runtimes: [{ name: 'js', title: 'JS', results: js }, { name: 'rust', title: 'Rust', results: rust }] });
const rowOf = (text, start) => text.split('\n').find((line) => line.startsWith(start));

test('a feature is + only when every check passed, - when any did not, N/A when nothing was measured', () => {
  const text = render(results('js', { 'alpha.one': 'pass', 'alpha.two': 'pass', 'beta.one': 'xfail' }));
  assert.equal(rowOf(text, '| Alpha'), '| Alpha (`alpha`) | 2 | + | N/A |');
  assert.equal(rowOf(text, '| Beta'), '| Beta (`beta`) | 1 | - | N/A |');
  const mixed = render(results('js', { 'alpha.one': 'pass', 'alpha.two': 'xfail', 'beta.one': 'pass' }));
  assert.equal(rowOf(mixed, '| Alpha'), '| Alpha (`alpha`) | 2 | - | N/A |');
});

test('a feature declared not applicable is N/A, and it never reads as a pass or a failure', () => {
  const text = render(results('js', { 'alpha.one': 'n/a', 'alpha.two': 'n/a', 'beta.one': 'pass' }));
  assert.equal(rowOf(text, '| Alpha'), '| Alpha (`alpha`) | 2 | N/A | N/A |');
  assert.equal(rowOf(text, '| `alpha.one`'), '| `alpha.one` | One. | N/A | N/A |');
});

test('each check has its own cell, and a pipe in a title does not break the table', () => {
  const text = render(results('js', { 'alpha.one': 'pass', 'alpha.two': 'xfail', 'beta.one': 'pass' }), results('rust', { 'alpha.one': 'xfail', 'alpha.two': 'pass', 'beta.one': 'n/a' }));
  assert.equal(rowOf(text, '| `alpha.one`'), '| `alpha.one` | One. | + | - |');
  assert.equal(rowOf(text, '| `alpha.two`'), '| `alpha.two` | Two \\| with a pipe. | - | + |');
  assert.equal(rowOf(text, '| `beta.one`'), '| `beta.one` | One. | + | N/A |');
});

test('expected failures are listed with their reasons, per runtime', () => {
  const text = render(results('js', { 'alpha.one': 'xfail', 'alpha.two': 'pass', 'beta.one': 'pass' }), results('rust', { 'alpha.one': 'pass', 'alpha.two': 'pass', 'beta.one': 'xfail' }));
  assert.ok(text.includes('| JS | `alpha.one` | why alpha.one |'));
  assert.ok(text.includes('| Rust | `beta.one` | why beta.one |'));
  assert.match(render(results('js', { 'alpha.one': 'pass', 'alpha.two': 'pass', 'beta.one': 'pass' })), /## Expected failures\n\nNone\./);
});

test('the text says nothing that varies between runs', () => {
  const statuses = { 'alpha.one': 'pass', 'alpha.two': 'pass', 'beta.one': 'pass' };
  const one = render(results('js', statuses));
  const other = render(results('js', statuses, { implementation: { name: 'js', version: '99' }, revisions: ['other'] }));
  assert.equal(one, other);
  assert.doesNotMatch(one, /\b20\d\d-\d\d-\d\d\b/);
});

test('results that did not pass, or do not cover the suite, are never published', () => {
  const all = { 'alpha.one': 'pass', 'alpha.two': 'pass', 'beta.one': 'pass' };
  assert.throws(() => render(results('js', { ...all, 'beta.one': 'fail' }, { passed: false })), /did not pass: beta\.one \(fail\)/);
  assert.throws(() => render(results('js', { ...all, 'beta.one': 'unexpected-pass' }, { passed: false })), /did not pass: beta\.one \(unexpected-pass\)/);
  assert.throws(() => render(results('js', all, { complete: false })), /partial run/);
  assert.throws(() => render(results('js', { 'alpha.one': 'pass', 'alpha.two': 'pass' })), /no result for beta\.one/);
  assert.throws(() => render(results('js', { ...all, 'gone.one': 'pass' })), /does not have: gone\.one/);
  assert.throws(() => render(results('other', all)), /are for other/);
  assert.throws(() => render({ schema: 'x' }), /not prism\/conformance-results\/1/);
});

test('line endings do not make the file stale, and any other difference does', () => {
  assert.equal(sameMatrix('a\r\nb\r\n', 'a\nb\n'), true);
  assert.equal(sameMatrix('a\nb\n', 'a\nc\n'), false);
});

const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

test('the committed COMPLIANCE.md is what the suite generates today, and it names all three runtimes', () => {
  const check = cli('matrix', '--check');
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const text = readFileSync(COMPLIANCE, 'utf8').replace(/\r\n/g, '\n');
  assert.match(text, /^<!-- @generated/);
  assert.match(text, /\| Feature \| Checks \| JavaScript \| Rust \| Python \|/);
  for (const check of allChecks(loadScenarios())) assert.ok(text.includes(`\`${check.id}\``), check.id);
});

test('a hand edit of COMPLIANCE.md is stale, says how to fix it, and --write repairs it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-conformance-matrix-'));
  const output = join(dir, 'COMPLIANCE.md');
  writeFileSync(output, readFileSync(COMPLIANCE, 'utf8').replace('| JavaScript |', '| JS, by hand |'));
  const stale = cli('matrix', '--check', '--output', output);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /is stale\. It is generated/);
  assert.match(stale.stderr, /matrix --write/);
  assert.equal(cli('matrix', '--write', '--output', output).status, 0);
  assert.equal(cli('matrix', '--check', '--output', output).status, 0);
});

test('--results reads saved runs, and a registered runtime with no results is an error, not a blank column', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-conformance-results-'));
  const missing = cli('matrix', '--results', dir);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /js has a shim .* a registered runtime cannot go unmeasured/);
  assert.equal(cli('run', '--runtime', 'js', '--out', join(dir, 'js.json')).status, 0);
  const check = cli('matrix', '--check', '--results', dir);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(cli('matrix', '--write', '--check').status, 64);
});

test('partial results cannot reach the matrix through the CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-conformance-partial-'));
  assert.equal(cli('run', '--runtime', 'js', '--only', 'load.refuse.empty', '--out', join(dir, 'js.json')).status, 0);
  const refused = cli('matrix', '--results', dir);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /partial run/);
});
