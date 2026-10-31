// The format-change gate, against real commits in a scratch repository.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatGate, globToRegExp, loadScenarios, problemsOfConfig, runGate } from '../src/index.mjs';
import { GATE_CONFIG, readGateConfig, SCENARIO_DIR } from '../src/gate.mjs';

const BIN = fileURLToPath(new URL('../bin/prism-conformance.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WRITER = 'crates/prismpm/src/holo/archive.rs';
const SCHEMA = 'sdk/npm/spec/schemas/holo/archive.schema.json';
const LOAD = `${SCENARIO_DIR}/load.json`;

const check = (id, members = {}) => ({ id, title: 'A title.', op: 'load', archive: 'reference', expect: { ok: true, result: {} }, ...members });
const scenario = (...checks) => `${JSON.stringify({ feature: 'load', title: 'Load', checks }, null, 2)}\n`;
const CONFIG = {
  rules: [{ name: 'archive container', format: [WRITER, 'sdk/npm/spec/schemas/holo/**'], scenarios: ['load', 'verify'] }],
  exemptions: [],
};

function scratch() {
  const repo = mkdtempSync(join(tmpdir(), 'prism-conformance-gate-'));
  const run = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'gate@example.com');
  run('config', 'user.name', 'Gate Test');
  run('config', 'core.autocrlf', 'false');
  const write = (path, text) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const commit = (message) => {
    run('add', '-A');
    run('commit', '-q', '--allow-empty', '-m', message);
    return run('rev-parse', 'HEAD');
  };
  write(WRITER, 'fn writer() {}\n');
  write(SCHEMA, '{}\n');
  write('README.md', 'hello\n');
  write(LOAD, scenario(check('load.one')));
  write(GATE_CONFIG, `${JSON.stringify(CONFIG, null, 2)}\n`);
  const base = commit('base');
  return { repo, base, write, commit, remove: (path) => rmSync(join(repo, path)) };
}

const gate = (scope, head) => runGate({ repo: scope.repo, base: scope.base, head });

test('a change that touches no format file passes, and no rule applies', () => {
  const scope = scratch();
  scope.write('README.md', 'changed\n');
  const outcome = gate(scope, scope.commit('docs'));
  assert.equal(outcome.passed, true);
  assert.deepEqual(outcome.findings, []);
});

test('a change to the Rust writer with no scenario fails, and the report says how to satisfy it', () => {
  const scope = scratch();
  scope.write(WRITER, 'fn writer() { changed(); }\n');
  const outcome = gate(scope, scope.commit('format'));
  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.findings[0].files, [WRITER]);
  const text = formatGate(outcome);
  assert.match(text, /FAIL archive container/);
  assert.match(text, /needs a new or changed check in sdk\/npm\/conformance\/scenarios\/load\.json or .*verify\.json/);
  assert.match(text, /cannot merge without a scenario/);
  assert.match(text, /exemptions/);
});

test('a change to a spec schema with no scenario fails', () => {
  const scope = scratch();
  scope.write(SCHEMA, '{"type":"object"}\n');
  assert.equal(gate(scope, scope.commit('schema')).passed, false);
});

test('deleting a format file with no scenario fails', () => {
  const scope = scratch();
  scope.remove(SCHEMA);
  assert.equal(gate(scope, scope.commit('delete')).passed, false);
});

test('a new check in a mapped scenario file satisfies the rule', () => {
  const scope = scratch();
  scope.write(WRITER, 'fn writer() { changed(); }\n');
  scope.write(LOAD, scenario(check('load.one'), check('load.two')));
  const outcome = gate(scope, scope.commit('format and scenario'));
  assert.equal(outcome.passed, true);
  assert.deepEqual(outcome.findings[0].covered, ['load.two']);
  assert.match(formatGate(outcome), /ok {3}archive container.*\n.*covered by load\.two/);
});

test('a changed expectation in an existing check satisfies the rule', () => {
  const scope = scratch();
  scope.write(WRITER, 'fn writer() { changed(); }\n');
  scope.write(LOAD, scenario(check('load.one', { expect: { ok: true, result: { kind: 'holo' } } })));
  const outcome = gate(scope, scope.commit('format and expectation'));
  assert.equal(outcome.passed, true);
  assert.deepEqual(outcome.findings[0].covered, ['load.one']);
});

for (const [what, edit] of [
  ['whitespace', () => `${JSON.stringify(JSON.parse(scenario(check('load.one'))))}\n`],
  ['a title', () => scenario(check('load.one', { title: 'Another title.' }))],
  ['a placeholder', () => scenario(check('load.one'), { id: 'load.later', title: 'Later.', placeholder: { issue: 1, reason: 'later' } })],
  ['removing a check', () => scenario()],
]) {
  test(`${what} in a scenario file does not satisfy the rule, because it tests nothing new`, () => {
    const scope = scratch();
    scope.write(WRITER, 'fn writer() { changed(); }\n');
    scope.write(LOAD, edit());
    const outcome = gate(scope, scope.commit(what));
    assert.equal(outcome.passed, false, formatGate(outcome));
  });
}

test('a scenario in a file the rule does not map does not satisfy it', () => {
  const scope = scratch();
  scope.write(WRITER, 'fn writer() { changed(); }\n');
  scope.write(`${SCENARIO_DIR}/dispatch.json`, `${JSON.stringify({ feature: 'dispatch', title: 'D', checks: [{ id: 'dispatch.x', title: 'X.', op: 'acceptance', archive: 'reference', expect: { ok: true, result: {} } }] })}\n`);
  assert.equal(gate(scope, scope.commit('wrong scenario')).passed, false);
});

const withExemption = (config, ...entries) => `${JSON.stringify({ ...config, exemptions: [...config.exemptions, ...entries] }, null, 2)}\n`;

test('an exemption added by the change, naming the file and a reason, passes and is reported', () => {
  const scope = scratch();
  scope.write(WRITER, 'fn writer() { refactored(); }\n');
  scope.write(GATE_CONFIG, withExemption(CONFIG, { files: [WRITER], reason: 'A rename inside the writer; the golden bytes did not move.' }));
  const outcome = gate(scope, scope.commit('refactor'));
  assert.equal(outcome.passed, true);
  assert.match(formatGate(outcome), /archive\.rs is exempt: A rename inside the writer/);
});

test('an exemption needs a reason, and covers only the files it names', () => {
  const scope = scratch();
  scope.write(WRITER, 'fn writer() { refactored(); }\n');
  scope.write(GATE_CONFIG, withExemption(CONFIG, { files: [WRITER], reason: '   ' }));
  assert.equal(gate(scope, scope.commit('no reason')).passed, false);

  const other = scratch();
  other.write(WRITER, 'fn writer() { refactored(); }\n');
  other.write(SCHEMA, '{"type":"object"}\n');
  other.write(GATE_CONFIG, withExemption(CONFIG, { files: [WRITER], reason: 'Only the writer.' }));
  assert.equal(gate(other, other.commit('partly exempt')).passed, false);
});

test('an exemption already on the base exempts nothing later', () => {
  const scope = scratch();
  scope.write(GATE_CONFIG, withExemption(CONFIG, { files: [WRITER], reason: 'An old one.' }));
  const base = scope.commit('old exemption');
  scope.write(WRITER, 'fn writer() { changed(); }\n');
  const head = scope.commit('format');
  assert.equal(runGate({ repo: scope.repo, base, head }).passed, false);
});

test('a change cannot loosen the rules that judge it: they are read from the base', () => {
  const scope = scratch();
  scope.write(WRITER, 'fn writer() { changed(); }\n');
  scope.write(GATE_CONFIG, `${JSON.stringify({ rules: [], exemptions: [] })}\n`);
  assert.equal(gate(scope, scope.commit('loosen')).passed, false);
});

test('the diff is against the merge base, so what landed on the base after branching is not counted', () => {
  const scope = scratch();
  execFileSync('git', ['-C', scope.repo, 'checkout', '-q', '-b', 'topic']);
  scope.write('README.md', 'topic\n');
  const head = scope.commit('topic');
  execFileSync('git', ['-C', scope.repo, 'checkout', '-q', 'main']);
  scope.write(WRITER, 'fn writer() { landedElsewhere(); }\n');
  const base = scope.commit('landed on main');
  assert.equal(runGate({ repo: scope.repo, base, head }).findings.length, 0);
});

test('the globs: ** crosses directories and * does not', () => {
  assert.ok(globToRegExp('a/**').test('a/b/c.json'));
  assert.ok(globToRegExp('a/**/c.json').test('a/c.json'));
  assert.ok(globToRegExp('a/**/c.json').test('a/b/c.json'));
  assert.ok(globToRegExp('a/*.json').test('a/b.json'));
  assert.ok(!globToRegExp('a/*.json').test('a/b/c.json'));
  assert.ok(!globToRegExp('a.b').test('axb'));
});

test('the CLI exits 1 on a refused change and 0 on a covered one', () => {
  const scope = scratch();
  scope.write(WRITER, 'fn writer() { changed(); }\n');
  const refused = scope.commit('format');
  const bad = spawnSync(process.execPath, [BIN, 'gate', '--repo', scope.repo, '--base', scope.base, '--head', refused], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL archive container/);
  scope.write(LOAD, scenario(check('load.one'), check('load.two')));
  const covered = scope.commit('scenario');
  assert.equal(spawnSync(process.execPath, [BIN, 'gate', '--repo', scope.repo, '--base', scope.base, '--head', covered]).status, 0);
  assert.equal(spawnSync(process.execPath, [BIN, 'gate']).status, 64);
});

test('the shipped rules point at files that exist and scenarios that exist, and cover the writer and the schemas', () => {
  const config = readGateConfig();
  const tracked = execFileSync('git', ['-C', REPO_ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\n').filter(Boolean);
  const features = loadScenarios().map((feature) => feature.feature);
  assert.deepEqual(problemsOfConfig(config, tracked, features), []);
  const guarded = (path) => config.rules.some((rule) => rule.format.some((glob) => globToRegExp(glob).test(path)));
  for (const path of [
    WRITER,
    'sdk/npm/spec/constants.mjs',
    'sdk/npm/spec/schemas/holo/archive.schema.json',
    'sdk/npm/spec/schemas/holo/app-manifest.schema.json',
    'sdk/npm/spec/schemas/documents/model-document-v6.schema.json',
    'sdk/npm/spec/schemas/verdict/verdict-v1.schema.json',
    'sdk/npm/spec/schemas/capabilities/capabilities-v1.schema.json',
    'sdk/npm/spec/worlds/core-wasm.wit',
  ]) {
    assert.ok(guarded(path), `${path} is not guarded`);
  }
  assert.ok(!guarded('README.md'));
  assert.deepEqual(config.exemptions, [], 'the first version ships with nothing exempt');
  assert.deepEqual(readFileSync(new URL('../format-gate.json', import.meta.url), 'utf8').includes('\r'), false);
});

test('problemsOfConfig names a stale glob and a missing scenario', () => {
  const config = { rules: [{ name: 'r', format: ['gone/**'], scenarios: ['nope'] }, { name: 'empty', format: ['a'], scenarios: [] }] };
  const problems = problemsOfConfig(config, ['a'], ['load']);
  assert.match(problems[0], /gone\/\*\* matches no tracked file/);
  assert.match(problems[1], /no scenario file nope\.json/);
  assert.match(problems[2], /maps to no scenario/);
});
