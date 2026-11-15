// The factory route: κ, receipts and the release workflow checked against
// factory/src/Factory/Release.lex.tex.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {findCandidate, imageJobs, isPlumbing, kappa, plumbing, plumbingTests} from './factory.mjs';

const require = createRequire('/opt/prismpm/oracles/package.json'), {load} = require('js-yaml');
const root = new URL('..', import.meta.url).pathname;
const read = path => readFileSync(join(root, path), 'utf8');
const strings = body => [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => match[1]);
const definition = (source, name) => {
  const start = source.indexOf(`  name: ${name},\n`);
  assert(start >= 0, `definition ${name}`);
  return source.slice(start, source.indexOf('\n}\n', start));
};

function repository(t) {
  const path = mkdtempSync(join(tmpdir(), 'prismpm-factory-test-'));
  t.after(() => rmSync(path, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', args, {cwd: path, encoding: 'utf8',
    env: {...process.env, GIT_AUTHOR_NAME: 'unit', GIT_AUTHOR_EMAIL: 'unit@example.invalid', GIT_COMMITTER_NAME: 'unit',
      GIT_COMMITTER_EMAIL: 'unit@example.invalid', GIT_CONFIG_NOSYSTEM: '1', HOME: path}}).trim();
  git('init', '-q', '-b', 'release/v0.4');
  const commit = (files, message) => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(path, dirname(name)), {recursive: true}); writeFileSync(join(path, name), text);
    }
    git('add', '-A'); git('commit', '-q', '-m', message); return git('rev-parse', 'HEAD');
  };
  return {path, git, commit};
}

test('the plumbing is exactly the model\'s, and every listed path is tracked', () => {
  const model = read('factory/src/Factory/Release.lex.tex');
  assert.deepEqual(strings(definition(model, 'plumbing')), [...plumbing]);
  assert.deepEqual([...plumbing].sort(), [...plumbing], 'sorted, so a review sees one list');
  const tracked = execFileSync('git', ['ls-files'], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\n');
  for (const entry of plumbing) assert(tracked.some(path => entry.endsWith('/') ? path.startsWith(entry) : path === entry), entry);
  assert(isPlumbing('factory/src/Factory/Release.lex.tex')); assert(isPlumbing('.github/workflows/release.yml'));
  assert(!isPlumbing('.github/workflows/vv.yml')); assert(!isPlumbing('scripts/release-phases.mjs.bak'));
  assert(!isPlumbing('factory')); assert(!isPlumbing('crates/prismpm/src/lib.rs'));
});

test('every plumbing test runs in the plumbing check, and every test that reads the release workflow is plumbing', () => {
  const tests = plumbingTests(root);
  assert(tests.includes('scripts/factory.test.mjs') && tests.includes('scripts/release-phases.test.mjs'));
  for (const path of tests) assert(isPlumbing(path));
  const scripts = readdirSync(join(root, 'scripts')).filter(name => name.endsWith('.test.mjs')).map(name => `scripts/${name}`);
  for (const path of scripts) {
    const text = read(path);
    if (/release\.yml|release-gate-evidence|release-phases|sdk-release-evidence|release-native-contract|scripts\/factory\.mjs/.test(text))
      assert(isPlumbing(path), `${path} pins the release plumbing, so κ must leave it out and the plumbing check must run it`);
  }
});

test('κ ignores the plumbing and follows every other byte, mode and path', t => {
  const {path, commit, git} = repository(t);
  const first = commit({'src/a.txt': 'a\n', '.github/workflows/release.yml': 'one\n', 'factory/x.lex.tex': 'x\n'}, 'first');
  const plumbingOnly = commit({'.github/workflows/release.yml': 'two\n', 'factory/y.lex.tex': 'y\n', 'scripts/release-phases.mjs': '//\n'}, 'plumbing');
  assert.equal(kappa(path, plumbingOnly), kappa(path, first));
  const source = commit({'src/a.txt': 'b\n'}, 'source');
  assert.notEqual(kappa(path, source), kappa(path, first));
  const added = commit({'src/b.txt': 'b\n'}, 'added');
  assert.notEqual(kappa(path, added), kappa(path, source));
  git('update-index', '--chmod=+x', 'src/b.txt'); git('commit', '-q', '-m', 'mode');
  assert.notEqual(kappa(path, git('rev-parse', 'HEAD')), kappa(path, added));
  git('mv', 'src/b.txt', 'src/c.txt'); git('commit', '-q', '-m', 'rename');
  const renamed = git('rev-parse', 'HEAD');
  assert.notEqual(kappa(path, renamed), kappa(path, added));
  assert.match(kappa(path, renamed), /^[0-9a-f]{64}$/);
});

const run = (id, sha, extra = {}) => ({id, head_sha: sha, run_attempt: 2, event: 'push', head_branch: 'release/v0.4',
  path: '.github/workflows/release.yml', repository: {full_name: 'UOR-Foundation/prismpm'},
  head_repository: {full_name: 'UOR-Foundation/prismpm'}, ...extra});

const built = () => [...Array.from({length: imageJobs}, (_, index) => ({name: `images (image-${index})`, conclusion: 'success'})),
  {name: 'image-platforms (ubuntu-24.04, amd64)', conclusion: 'success'}, {name: 'image-platforms (ubuntu-24.04-arm, arm64)', conclusion: 'success'},
  {name: 'installed-sdk (ubuntu-24.04, amd64)', conclusion: 'failure'}];
function candidates(runs, jobs = {}, artifacts = {}) {
  return {api(path) {
    if (path.includes('/workflows/release.yml/runs?')) return {workflow_runs: runs};
    let match = path.match(/\/runs\/(\d+)\/jobs\?filter=latest&per_page=100$/);
    if (match) return {jobs: jobs[match[1]] ?? built()};
    match = path.match(/\/runs\/(\d+)\/artifacts\?name=sdk-image$/);
    if (match) return {artifacts: artifacts[match[1]] ?? [{name: 'sdk-image', expired: false}]};
    throw new Error(`unexpected ${path}`);
  }};
}

test('a qualification candidate is the newest release-line ancestor whose images were all built and signed', t => {
  const {path, commit, git} = repository(t);
  const older = commit({'src/a.txt': 'a\n'}, 'older');
  const newer = commit({'src/a.txt': 'b\n'}, 'newer');
  const proposal = commit({'scripts/product-sdk-check.sh': 'fixed\n'}, 'check fix');
  git('checkout', '-q', '-b', 'side', older); const foreign = commit({'src/a.txt': 'side\n'}, 'side');
  git('checkout', '-q', 'release/v0.4');
  // A later failure elsewhere in the run does not disqualify its images.
  assert.deepEqual(findCandidate(path, proposal, candidates([run(9, newer), run(7, older)])), {run_id: '9', revision: newer});
  assert.deepEqual(findCandidate(path, proposal, candidates([run(9, newer), run(7, older)], {9: built().slice(1)})), {run_id: '7', revision: older});
  // main and every release/vMAJOR.MINOR branch are the release line.
  for (const head_branch of ['main', 'release/v0.5', 'release/v1.0'])
    assert.deepEqual(findCandidate(path, proposal, candidates([run(9, newer, {head_branch})])), {run_id: '9', revision: newer});
  const failed = built(); failed[0] = {...failed[0], conclusion: 'failure'};
  const platform = built(); platform[imageJobs] = {...platform[imageJobs], conclusion: 'cancelled'};
  for (const [runs, jobs, artifacts] of [
    [[run(9, foreign)], {}, {}], [[run(9, 'x'.repeat(40))], {}, {}], [[run(9, newer, {event: 'pull_request'})], {}, {}],
    [[run(9, newer, {head_branch: 'feature'})], {}, {}], [[run(9, newer, {head_branch: 'release/v05'})], {}, {}], [[run(9, newer, {head_repository: {full_name: 'fork/PrismPM'}})], {}, {}],
    [[run(9, newer, {path: '.github/workflows/vv.yml'})], {}, {}], [[run(9, newer)], {9: failed}, {}], [[run(9, newer)], {9: platform}, {}],
    [[run(9, newer)], {}, {9: [{name: 'sdk-image', expired: true}]}], [[run(9, newer)], {}, {9: []}], [[], {}, {}],
  ]) assert.throws(() => findCandidate(path, proposal, candidates(runs, jobs, artifacts)), /no release-line run/);
});

test('the release workflow is the model\'s route', () => {
  const model = read('factory/src/Factory/Release.lex.tex');
  const route = definition(model, 'route');
  assert(!route.includes('Stage.installedVv'), 'the route has no installed re-run of source V&V');
  const workflow = load(read('.github/workflows/release.yml'));
  const stageJobs = {sourceVv: ['source-vv'], images: ['image-platforms', 'images'], reproducibility: ['reproducibility'],
    native: ['native'], installedSdk: ['installed-sdk'], publication: ['gate', 'oci-native', 'crates', 'release']};
  const routed = [...route.matchAll(/Stage\.([a-zA-Z]+)/g)].map(match => match[1]);
  assert.deepEqual(routed.sort(), Object.keys(stageJobs).sort());
  const support = ['policy', 'factory', 'devcontainer-image', 'vv-sdk', 'receipts'];
  assert.deepEqual(Object.keys(workflow.jobs).sort(), [...support, ...Object.values(stageJobs).flat()].sort());
  // onlyPublicationWaitsForTheSource: no projection stage needs source V&V or the gate.
  const needs = job => [workflow.jobs[job].needs ?? []].flat();
  const upstream = job => {const seen = new Set(); const visit = name => {for (const need of needs(name)) if (!seen.has(need)) {seen.add(need); visit(need);}}; visit(job); return seen;};
  for (const job of [...stageJobs.images, ...stageJobs.reproducibility, ...stageJobs.native, ...stageJobs.installedSdk])
    assert(!upstream(job).has('source-vv') && !upstream(job).has('gate'), `${job} starts beside source V&V`);
  for (const job of ['oci-native', 'crates', 'release']) assert(upstream(job).has('gate'), `${job} waits for the gate`);
  assert(upstream('gate').has('source-vv') && upstream('gate').has('factory'));
  // Source V&V runs its oracles in the one image vv-sdk built, never one of its own.
  assert(upstream('source-vv').has('vv-sdk'));
  assert(!JSON.stringify(workflow.jobs['source-vv']).includes('sdk-image-inputs.mjs build'));
  // Receipts are recorded after every job, and only the factory core decides routes.
  assert.deepEqual(needs('receipts').sort(), Object.keys(workflow.jobs).filter(name => name !== 'receipts').sort());
  assert(!read('.github/workflows/release.yml').includes('factory.mjs find-receipt'));
});

test('the certified factory\'s source V&V reads every path except exactly this plumbing', () => {
  const model = read('prism-factory/model/src/Factory/PrismPM.lex.tex');
  const graph = definition(model, 'graph');
  const sourceVv = graph.slice(graph.indexOf('(obligation "source-vv"'), graph.indexOf('(obligation "build"'));
  const inputs = strings(sourceVv).filter(value => value === '' || value.startsWith('!'));
  assert.deepEqual(inputs[0], '');
  assert.deepEqual(inputs.slice(1).map(value => value.slice(1)).sort(), [...plumbing].sort());
});

test('the factory catalog names only first-party products', () => {
  const files = execFileSync('git', ['ls-files', 'factory'], {cwd: root, encoding: 'utf8'}).split('\n').filter(Boolean);
  assert(files.includes('factory/src/Factory/Catalog.lex.tex'));
  for (const file of files) {
    const text = read(file).toLowerCase();
    for (const name of ['afflom', 'casey-allard', 'rule30', 'prism-legal', 'lexlean-r4', 'compression'])
      assert(!text.includes(name), `${file} names ${name}; downstream work consumes Prism, it is not in the factory`);
  }
  const catalog = read('factory/src/Factory/Catalog.lex.tex');
  assert.deepEqual([...definition(catalog, 'products').matchAll(/Model \{name := "([^"]+)"/g)].map(match => match[1]), ['PrismPM', 'LexLean']);
});
