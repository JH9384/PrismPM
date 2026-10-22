import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const {load} = createRequire('/opt/prismpm/oracles/package.json')('js-yaml');
const workflow = name => load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
const jobs = [
  ['lint-and-policy', 'Lint & Dependency Policy', 40, 'cargo fmt --check\ncargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings\ncargo deny --frozen --all-features check'],
  ['model-and-audits', 'Model & Audits', 50, 'bash scripts/bootstrap-verify.sh --check-source\ncargo xtask validate'],
  ['fixtures-and-golden', 'Fixtures & Reviewed Golden Outputs', 50, 'cargo xtask check-fixtures\ncargo run --locked --offline --manifest-path tests/holo-codec-oracle/Cargo.toml --target-dir target/holo-codec-oracle\ncargo xtask check-golden'],
];

function sourceEvents(name, value) {
  const expected = {
    'ci-parallel': {pull_request: null, workflow_dispatch: null},
    vv: {push: {branches: ['main'], tags: ['v*']}, workflow_dispatch: null},
    bootstrap: {workflow_dispatch: null},
    reproducibility: {schedule: [{cron: '17 3 * * *'}], workflow_dispatch: null},
  }[name];
  assert.deepEqual(value.on, expected, name + ': complete source trigger contract');
}

function parallelContract(value) {
  sourceEvents('ci-parallel', value);
  assert.deepEqual(Object.keys(value.jobs), ['devcontainer-image', ...jobs.map(row => row[0])]);
  const image = value.jobs['devcontainer-image'];
  assert.equal(image.name, 'Devcontainer image cache');
  assert.equal(image['timeout-minutes'], 40);
  assert(!('if' in image) && !('strategy' in image) && !('needs' in image));
  assert.equal(image.steps[0].uses, 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683');
  assert.equal(image.steps.at(-1).uses, 'devcontainers/ci@8bf61b26e9c3a98f69cb6ce2f88d24ff59b785c6');
  assert.equal(image.steps.at(-1).with.push, 'never');
  assert.equal(image.steps.at(-1).with.runCmd, 'true');
  for (const [id, name, timeout, command] of jobs) {
    const job = value.jobs[id];
    assert.equal(job.needs, 'devcontainer-image', id);
    assert.equal(job.name, name);
    assert.equal(job['timeout-minutes'], timeout);
    assert(!('if' in job) && !('strategy' in job), id);
    const run = job.steps.at(-1);
    assert.equal(run.uses, 'devcontainers/ci@8bf61b26e9c3a98f69cb6ce2f88d24ff59b785c6');
    assert.equal(run.with.push, 'never');
    assert(run.with.runCmd.startsWith('set -euo pipefail\n'), id);
    assert(run.with.runCmd.endsWith(command + '\n'), id);
    assert(!run.with.runCmd.includes('|| true'), id);
    assert.equal(job.steps[0].uses, 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683');
  }
}

test('three capped jobs preserve every pull request gate name and complete command', () => {
  parallelContract(workflow('ci-parallel'));
});

test('parallel policy refuses missing, duplicated, weakened or unbounded execution', () => {
  const original = workflow('ci-parallel');
  for (const mutate of [
    v => delete v.jobs['model-and-audits'],
    v => delete v.jobs['devcontainer-image'],
    v => delete v.jobs['model-and-audits'].needs,
    v => v.jobs['devcontainer-image'].steps.at(-1).with.runCmd = 'cargo xtask validate',
    v => v.jobs.extra = v.jobs['lint-and-policy'],
    v => v.jobs['lint-and-policy'].steps.at(-1).with.runCmd = 'cargo fmt --check',
    v => v.jobs['model-and-audits'].steps.at(-1).with.runCmd += ' || true',
    v => v.jobs['lint-and-policy'].steps.at(-1).with.push = 'always',
    v => v.jobs['lint-and-policy']['timeout-minutes'] = 10,
    v => v.jobs['fixtures-and-golden'].if = 'false',
    v => v.on.pull_request = {branches: ['main']},
    v => v.on.push = {branches: ['main']},
  ]) {
    const value = structuredClone(original); mutate(value);
    assert.throws(() => parallelContract(value));
  }
});

function workspaceUnitOwnership(source) {
  const signature = 'fn run_unit_tests(root: &Path) -> Result<(), Fail> {';
  const start = source.indexOf(signature), end = source.indexOf('\nfn validate_all(', start);
  assert(start >= 0 && end > start && source.indexOf(signature, start + 1) === -1);
  let body = source.slice(start + signature.length, end)
    .replace(/^\s*\/\/[^\n]*$/gm, '').trim();
  const progress = /^println!\("Running workspace unit and integration tests"\);\s*/.exec(body);
  assert(progress); body = body.slice(progress[0].length);
  const statements = [], arguments_ = [];
  for (let index = 0; index < 2; index++) {
    const statement = /^command\(\s*root,\s*"cargo",\s*&\[([\s\S]*?)\],?\s*\)\?;\s*/.exec(body);
    assert(statement, 'both complete Cargo unit owners must execute and propagate failure');
    statements.push(statement[0].trimEnd());
    arguments_.push(JSON.parse('[' + statement[1].replace(/,\s*$/, '') + ']'));
    body = body.slice(statement[0].length);
  }
  assert.match(body, /^Ok\(\(\)\)\s*\}$/);
  assert.deepEqual(arguments_, [
    ['test', '--workspace', '--bins', '--lib', '--tests', '--exclude', 'repo-conformance',
      '--all-features', '--locked', '--offline'],
    ['test', '--package', 'repo-conformance', '--lib', '--bins', '--all-features', '--locked', '--offline'],
  ]);
  return statements;
}

test('workspace units own conformance library and binaries without duplicate integration execution', () => {
  workspaceUnitOwnership(readFileSync(new URL('../xtask/src/main.rs', import.meta.url), 'utf8'));
});

test('unit ownership refuses missing regressions, repeated integration, hidden execution and swallowed failures', () => {
  const source = readFileSync(new URL('../xtask/src/main.rs', import.meta.url), 'utf8');
  const [workspace, conformance] = workspaceUnitOwnership(source);
  for (const mutate of [
    value => value.replace(conformance, ''),
    value => value.replace(conformance, conformance + conformance),
    value => value.replace(conformance, conformance.replace('"--lib"', '"--tests"')),
    value => value.replace(conformance, conformance.replace('"--bins",', '')),
    value => value.replace(conformance, conformance.replace('"--all-features",', '')),
    value => value.replace(conformance, conformance.replace('"--offline"', '"--frozen"')),
    value => value.replace(workspace, workspace.replace('"--exclude",', '')),
    value => value.replace(conformance, conformance.replace(')?;', ');')),
    value => value.replace(conformance, 'if false { ' + conformance + ' }'),
    value => value.replace(conformance, 'return Ok(());\n' + conformance),
    value => value.replace(conformance, 'let _ = ' + conformance),
  ]) assert.throws(() => workspaceUnitOwnership(mutate(source)));
});

test('read-only source workflows supersede by workflow and ref, never unique run ID', () => {
  for (const name of ['ci-parallel', 'vv', 'bootstrap', 'reproducibility']) {
    const value = workflow(name);
    sourceEvents(name, value);
    assert.equal(value.concurrency['cancel-in-progress'], true);
    assert(value.concurrency.group.includes('github.workflow'));
    assert(value.concurrency.group.includes('github.ref'));
    assert(!value.concurrency.group.includes('github.run_id'));
    assert.deepEqual(value.permissions, {contents: 'read'});
  }
});

test('source trigger policy refuses missing filtered broadened or redundant execution', () => {
  for (const name of ['ci-parallel', 'reproducibility', 'vv', 'bootstrap']) {
    const original = workflow(name);
    const mutations = [
      value => delete value.on.workflow_dispatch,
      value => value.on.pull_request_target = null,
      value => value.on.pull_request = {paths: ['src/**']},
    ];
    if (name !== 'ci-parallel') mutations.push(value => value.on.pull_request = null);
    if (name !== 'reproducibility') mutations.push(value => value.on.schedule = [{cron: '* * * * *'}]);
    if (name !== 'vv') mutations.push(value => value.on.push = {branches: ['main']});
    else mutations.push(value => delete value.on.push, value => value.on.push = null,
      value => value.on.push = {branches: ['main', 'other'], tags: ['v*']},
      value => value.on.push = {branches: ['main'], tags: ['v*'], paths: ['src/**']});
    for (const mutate of mutations) {
      const value = structuredClone(original); mutate(value);
      assert.throws(() => sourceEvents(name, value), name);
    }
  }
});

test('all affected jobs have explicit bounds; the one normative pass retains six hours', () => {
  for (const name of ['ci-parallel', 'vv', 'bootstrap', 'reproducibility', 'sdk', 'release', 'sdk-candidate', 'native-golden']) {
    for (const [id, job] of Object.entries(workflow(name).jobs)) {
      const bound = job['timeout-minutes'];
      assert(Number.isInteger(bound) && bound > 0 && bound <= 360, `${name}/${id}`);
    }
  }
  assert.equal(workflow('vv').jobs.vv['timeout-minutes'], 360);
  assert.equal(workflow('bootstrap').jobs['native-gate']['timeout-minutes'], 360);
  const run = workflow('vv').jobs.vv.steps.find(step => step.with?.runCmd).with.runCmd;
  assert.equal(run, `set -euo pipefail
bash scripts/vv.sh --with-sdk bash -euo pipefail -c "$(cat <<'PRISMPM_VV'
node scripts/ci-observe.mjs run target/ci-diagnostics/vv -- just vv
PRISMPM_VV
)"
`);
});

const readOnly = `contains(fromJSON('["check", "build", "verify", "test"]'), inputs.command)`;
const optedIn = readOnly + " && inputs.invocation-key != ''";
const outputNames = ['release-digest', 'plan-digest', 'evidence-digest', 'policy-path', 'trusted-root-path', 'signature-referrer'];
const originalSdkInputs = {
  'sdk-image': {required: true, type: 'string'}, command: {required: true, type: 'string'},
  context: {default: '.', type: 'string'}, reference: {default: '', type: 'string'},
  release: {default: '', type: 'string'}, target: {default: '', type: 'string'},
  plan: {default: '', type: 'string'}, backup: {default: '', type: 'string'},
  'restore-target': {default: '', type: 'string'}, detach: {default: false, type: 'boolean'},
  authorized: {default: false, type: 'boolean'}, 'secret-directory': {default: '.prismpm/secrets', type: 'string'},
  bundle: {default: '', type: 'string'}, 'trusted-root': {default: '', type: 'string'},
  policy: {default: '', type: 'string'}, 'promotion-to': {default: '', type: 'string'},
  environment: {default: '', type: 'string'},
};
function sdkContract(value) {
  assert(!('concurrency' in value));
  assert.deepEqual(Object.keys(value.jobs), ['validate-invocation-key', 'invoke-readonly', 'invoke']);
  const validation = value.jobs['validate-invocation-key'];
  const readonly = value.jobs['invoke-readonly'], mutable = value.jobs.invoke;
  assert.equal(validation.if, optedIn);
  assert(!('concurrency' in validation));
  assert.deepEqual(validation.permissions, {});
  assert.equal(validation['timeout-minutes'], 5);
  assert.deepEqual(validation.outputs, {key: '${{ steps.validate.outputs.key }}'});
  assert.equal(readonly.needs, 'validate-invocation-key');
  assert.equal(readonly.if, "needs.validate-invocation-key.result == 'success'");
  assert.equal(mutable.if, '${{ !(' + optedIn + ') }}');
  assert(!('needs' in mutable));
  assert(!('concurrency' in mutable));
  assert.equal(readonly.concurrency['cancel-in-progress'], true);
  assert.equal(readonly.concurrency.group, 'prismpm-sdk-readonly-${{ github.repository }}-${{ github.workflow_ref }}-${{ github.ref }}-${{ needs.validate-invocation-key.outputs.key }}');
  assert.deepEqual(readonly.permissions, {contents: 'read'});
  assert.deepEqual(mutable.permissions, readonly.permissions);
  assert.deepEqual(mutable.outputs, readonly.outputs);
  assert.deepEqual(validation.steps, [{id: 'validate', env: {LC_ALL: 'C', INVOCATION_KEY: '${{ inputs.invocation-key }}'}, run: 'set -euo pipefail\n[[ "$INVOCATION_KEY" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ ]]\nprintf \'key=%s\\n\' "$INVOCATION_KEY" >> "$GITHUB_OUTPUT"\n'}]);
  assert.deepEqual(mutable.steps, [readonly.steps[0], {...readonly.steps[1], if: readOnly}, readonly.steps[2]]);
  assert.equal(readonly.steps[1].uses, 'UOR-Foundation/PrismPM/action@f785ee46d794886c29b7efe80c2b261e48733a15');
  assert.deepEqual(readonly.steps[1].with, {'sdk-image': '${{ inputs.sdk-image }}', command: 'fetch', context: '${{ inputs.context }}'});
  assert.equal(readonly.steps[2].uses, readonly.steps[1].uses);
  const inputs = value.on.workflow_call.inputs;
  const actionInputs = Object.keys(inputs).filter(input => input !== 'invocation-key');
  assert.deepEqual(Object.fromEntries(actionInputs.map(name => [name, inputs[name]])), originalSdkInputs);
  assert.deepEqual(inputs['invocation-key'], {description: 'Optional stable lowercase ASCII caller job/project key (1-64 letters, digits, dots, underscores or hyphens), unique within its workflow; read-only supersession only', default: '', type: 'string'});
  assert.deepEqual(Object.keys(readonly.steps[2].with), actionInputs);
  for (const input of actionInputs) assert.equal(readonly.steps[2].with[input], '${{ inputs.' + input + ' }}');
  assert.deepEqual(Object.keys(value.on.workflow_call.outputs), outputNames);
  for (const output of outputNames) {
    assert.equal(readonly.outputs[output], '${{ steps.prism.outputs.' + output + ' }}');
    assert.equal(value.on.workflow_call.outputs[output].value, '${{ jobs.invoke-readonly.outputs.' + output + ' || jobs.invoke.outputs.' + output + ' }}');
  }
}

test('SDK supersession is restricted to read-only commands and preserves every input and output', () => {
  sdkContract(workflow('sdk'));
});

test('SDK policy rejects dropped outputs, command narrowing and cancellation of authorized operations', () => {
  const original = workflow('sdk');
  for (const mutate of [
    v => v.concurrency = v.jobs['invoke-readonly'].concurrency,
    v => v.jobs.invoke.concurrency = v.jobs['invoke-readonly'].concurrency,
    v => v.jobs.invoke.if = readOnly,
    v => v.jobs['invoke-readonly'].if = 'true',
    v => delete v.jobs.invoke.steps[2].with.authorized,
    v => delete v.on.workflow_call.outputs['release-digest'],
    v => {delete v.on.workflow_call.inputs.authorized; delete v.jobs.invoke.steps[2].with.authorized; delete v.jobs['invoke-readonly'].steps[2].with.authorized;},
    v => v.jobs['invoke-readonly'].if = 'always()',
    v => delete v.jobs['invoke-readonly'].needs,
    v => v.jobs['validate-invocation-key'].concurrency = v.jobs['invoke-readonly'].concurrency,
    v => v.on.workflow_call.inputs.command.required = false,
    v => v.jobs['invoke-readonly'].concurrency.group = '${{ github.workflow }}-${{ github.ref }}',
  ]) {
    const value = structuredClone(original); mutate(value);
    assert.throws(() => sdkContract(value));
  }
});

test('existing SDK callers retain independent invocation; distinct opt-in caller jobs cannot self-cancel', () => {
  const value = workflow('sdk'); sdkContract(value);
  // Evaluate the actual closed GitHub expression with its documented
  // contains/fromJSON semantics, rather than a second handwritten selector.
  function selected(command, key) {
    const expression = value.jobs['validate-invocation-key'].if.replaceAll('inputs.command', 'command').replaceAll('inputs.invocation-key', 'key');
    return Function('command', 'key', 'contains', 'fromJSON', `return ${expression}`)(command, key, (array, item) => array.some(value => value.toLowerCase() === item.toLowerCase()), JSON.parse);
  }
  for (const command of ['check', 'build', 'verify', 'test']) {
    assert.equal(selected(command, ''), false);
    assert.equal(selected(command, 'project-a-check'), true);
    assert.equal(selected(command.toUpperCase(), ''), false);
    assert.equal(selected(command.toUpperCase(), 'project-a-check'), true);
  }
  for (const command of ['fetch', 'deploy', 'run', 'apply', 'promote', 'backup', 'restore', 'remove', 'unknown']) {
    assert.equal(selected(command, ''), false);
    assert.equal(selected(command, 'project-a-check'), false);
  }
  const expand = key => value.jobs['invoke-readonly'].concurrency.group
    .replace('${{ needs.validate-invocation-key.outputs.key }}', key);
  assert.notEqual(expand('project-a-check').toLowerCase(), expand('project-b-check').toLowerCase());
  assert(!('concurrency' in value.jobs.invoke));
});

test('real invocation-key preflight refuses case aliases before concurrency admission', t => {
  const value = workflow('sdk'); sdkContract(value);
  const body = value.jobs['validate-invocation-key'].steps[0].run;
  const root = mkdtempSync(join(tmpdir(), 'prismpm-ci-key-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const [key, accepted] of [
    ['project-a-check', true], ['0', true], ['a'.repeat(64), true], ['a.b_c-d', true],
    ['', false], ['Project-a', false], ['a'.repeat(65), false], ['-a', false],
    ['a/b', false], ['a b', false], ['a\nb', false], ['å', false],
  ]) {
    const output = join(root, String(Buffer.from(key).toString('hex')) || 'empty');
    const result = spawnSync('bash', ['-c', body], {env: {...process.env, LC_ALL: value.jobs['validate-invocation-key'].steps[0].env.LC_ALL, INVOCATION_KEY: key, GITHUB_OUTPUT: output}});
    assert.equal(result.status === 0, accepted, JSON.stringify(key));
    if (accepted) assert.equal(readFileSync(output, 'utf8'), `key=${key}\n`);
    else assert(!existsSync(output), 'invalid keys produce no concurrency admission output');
  }
});

const products = [
  ['sdk', 'sdk/Dockerfile', 'runtime'], ['runtime', 'sdk/runtime/Dockerfile', ''],
  ['adapter-compose', 'sdk/Dockerfile', 'adapter-compose'],
  ['adapter-kubernetes', 'sdk/Dockerfile', 'adapter-kubernetes'],
  ['adapter-github-pages', 'sdk/Dockerfile', 'adapter-github-pages'],
  ['oracles', 'sdk/Dockerfile', 'oracles'],
];
const platforms = [{os: 'ubuntu-24.04', arch: 'amd64'}, {os: 'ubuntu-24.04-arm', arch: 'arm64'}];
const expectedMatrices = {
  release: {
    images: products.map(([name, dockerfile, target]) => ({name, dockerfile, target, repository: `ghcr.io/uor-foundation/prismpm-${name}`})),
    reproducibility: products.flatMap(([image, dockerfile, target]) => platforms.map(({os, arch}) => ({os, platform: `linux/${arch}`, dockerfile, target, name: `${image}-${arch}`, image}))),
    'installed-sdk': platforms,
    native: [{platform: 'linux/amd64', target: 'x86_64-unknown-linux-gnu', arch: 'amd64'}, {platform: 'linux/arm64', target: 'aarch64-unknown-linux-gnu', arch: 'arm64'}],
  },
  'sdk-candidate': {
    build: platforms.map(({os, arch}) => ({runner: os, architecture: arch})),
    'unpublished-construction': platforms.map(({os, arch}) => ({runner: os, architecture: arch})),
  },
  'native-golden': {'native-source-review': platforms},
};

// These six current union jobs have distinct publication/construction policy.
// Bind their complete original bodies, not only the older donor build matrix;
// only the explicitly reviewed timeout and matrix concurrency fields differ.
const candidateJobs = {
  'input-policy': [30, '1a2606aed5c40be2c5fd6ade291d4d8cc8f48b265ec77346e886d7e429331b1c'],
  policy: [30, 'd8c166a9586b9ecf4e6852352218bdeec51b918562604c920fea38db8e13d499'],
  build: [180, '54a93dd0777745bc3e2d455e06019b4971bce7fc4c3b2baed1451fbc796f143d'],
  publish: [60, 'eed34aecea86d7fb123167999bb1a0048f62609f6fc91d6979eeb0dcb8340128'],
  'unpublished-construction': [180, '1d3f4bfbee8ab48dcb68a2a754be821358dcd5658ea7993ad4e32aee7c023254'],
  'construction-integrity': [90, '6cf032e9b0febd74a52489ce4f06439f93ddebb3e13910e503e9f68f90fc3fa7'],
};
function candidateContract(value) {
  assert.deepEqual(Object.keys(value.jobs), Object.keys(candidateJobs));
  const canonical = v => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  for (const [id, [timeout, digest]] of Object.entries(candidateJobs)) {
    const job = structuredClone(value.jobs[id]);
    assert.equal(job['timeout-minutes'], timeout);
    delete job['timeout-minutes'];
    if (job.strategy) delete job.strategy['max-parallel'];
    assert.equal(createHash('sha256').update(JSON.stringify(canonical(job))).digest('hex'), digest, id);
  }
}
const matrixParallelism = {release: {images: 3, reproducibility: 4, 'installed-sdk': 2, native: 2}};
function publicationContract(name, value) {
  if (name === 'sdk-candidate') candidateContract(value);
  const actual = Object.fromEntries(Object.entries(value.jobs).filter(([, job]) => job.strategy).map(([id, job]) => {
    assert.equal(job.strategy['max-parallel'], matrixParallelism[name]?.[id] ?? 2);
    assert.equal(job.strategy['fail-fast'], false);
    assert.deepEqual(Object.keys(job.strategy.matrix), ['include']);
    return [id, job.strategy.matrix.include];
  }));
  assert.deepEqual(actual, expectedMatrices[name]);
}

test('publication keeps non-canceling lifecycles and every original matrix row', () => {
  for (const name of ['release', 'sdk-candidate']) assert.equal(workflow(name).concurrency['cancel-in-progress'], false);
  for (const name of Object.keys(expectedMatrices)) publicationContract(name, workflow(name));
});

test('publication policy rejects removal or substitution of any original platform or product', () => {
  for (const id of Object.keys(candidateJobs)) for (const mutate of [
    v => delete v.jobs[id],
    v => v.jobs[id].if = 'true',
    v => v.jobs[id].steps = [],
    v => v.jobs[id]['timeout-minutes']++,
  ]) {
    const value = workflow('sdk-candidate'); mutate(value);
    assert.throws(() => publicationContract('sdk-candidate', value));
  }
  for (const [name, matrices] of Object.entries(expectedMatrices)) for (const [job, rows] of Object.entries(matrices)) {
    for (let index = 0; index < rows.length; index++) for (const action of ['remove', 'substitute']) {
      const value = workflow(name), actual = value.jobs[job].strategy.matrix.include;
      if (action === 'remove') actual.splice(index, 1);
      else actual[index] = {...actual[index], name: 'wrong-product'};
      assert.throws(() => publicationContract(name, value));
    }
  }
});
