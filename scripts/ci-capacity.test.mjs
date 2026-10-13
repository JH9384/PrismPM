import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const {load} = createRequire('/opt/prismpm/oracles/package.json')('js-yaml');
const workflow = name => load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
const commands = [
  ['Lint & Dependency Policy', 45, 'cargo fmt --check\ncargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings\ncargo deny --frozen --all-features check'],
  ['Model & Audits', 45, 'bash scripts/bootstrap-verify.sh --check-source\ncargo xtask validate'],
  ['Workspace Unit Tests', 180, './scripts/vv.sh unit-tests'],
  ['Conformance / contracts', 120, './scripts/vv.sh conformance contracts'],
  ['Conformance / core', 120, './scripts/vv.sh conformance core'],
  ['Conformance / holo-stdlib', 180, './scripts/vv.sh conformance holo-stdlib'],
  ['Conformance / desktop-browser', 210, './scripts/vv.sh conformance desktop-browser'],
  ['Conformance / system-oci', 180, './scripts/vv.sh conformance system-oci'],
  ['Conformance / verification-schemas', 90, './scripts/vv.sh conformance verification-schemas'],
  ['Fixtures & Reviewed Golden Outputs', 90, 'cargo xtask check-fixtures\ncargo run --locked --offline --manifest-path tests/holo-codec-oracle/Cargo.toml --target-dir target/holo-codec-oracle\ncargo xtask check-golden'],
  ['Lean 4 Proofs & Formal Verification', 75, 'cargo xtask verify-examples\ncargo run --locked --offline --target-dir target/vendor-lexlean --manifest-path vendor/lexlean/Cargo.toml -- --project lexlean.toml fmt --check\ncargo run --locked --offline --target-dir target/vendor-lexlean --manifest-path vendor/lexlean/Cargo.toml -- --project lexlean.toml lock --check'],
  ['Packaging, API & Upstream Conformance', 120, './scripts/vv.sh package-api'],
];

function parallelContract(value) {
  assert.deepEqual(Object.keys(value.jobs), ['gate']);
  const job = value.jobs.gate;
  assert.equal(job.name, '${{ matrix.name }}');
  assert.equal(job['timeout-minutes'], '${{ matrix.timeout }}');
  assert.equal(job.strategy['max-parallel'], 3);
  assert.equal(job.strategy['fail-fast'], false);
  assert.deepEqual(Object.keys(job.strategy.matrix), ['include']);
  assert.deepEqual(job.strategy.matrix.include.map(row => {
    assert.deepEqual(Object.keys(row), ['name', 'timeout', 'commands']);
    return [row.name, row.timeout, row.commands.trim()];
  }), commands);
  assert.deepEqual(job.steps.map(step => step.uses), [
    'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
    'devcontainers/ci@8bf61b26e9c3a98f69cb6ce2f88d24ff59b785c6',
  ]);
  assert.equal(job.steps[0].with['fetch-depth'], 0);
  assert.equal(job.steps[1].with.push, 'never');
  assert.equal(job.steps[1].with.runCmd, 'set -euo pipefail\n${{ matrix.commands }}\n');
  assert(!('if' in job));
}

test('one capped matrix preserves every original parallel job name and complete command', () => {
  parallelContract(workflow('ci-parallel'));
});

test('parallel policy refuses missing, duplicated, weakened or unbounded execution', () => {
  const original = workflow('ci-parallel');
  for (const mutate of [
    v => v.jobs.gate.strategy.matrix.include.pop(),
    v => v.jobs.gate.strategy.matrix.include.push(v.jobs.gate.strategy.matrix.include[0]),
    v => v.jobs.gate.strategy.matrix.include[0].commands = 'cargo fmt --check',
    v => v.jobs.gate.strategy.matrix.include[3].commands += ' || true',
    v => v.jobs.gate.strategy['max-parallel'] = 12,
    v => v.jobs.gate.strategy['fail-fast'] = true,
    v => v.jobs.gate.steps[1].with.runCmd = '${{ matrix.commands }}',
    v => v.jobs.gate.steps[1].with.push = 'always',
    v => v.jobs.gate['timeout-minutes'] = 10,
    v => v.jobs.gate.if = 'false',
    v => v.jobs.extra = v.jobs.gate,
  ]) {
    const value = structuredClone(original); mutate(value);
    assert.throws(() => parallelContract(value));
  }
});

test('read-only source workflows supersede by repository and ref, never unique run ID', () => {
  for (const name of ['ci-parallel', 'vv', 'bootstrap', 'reproducibility', 'honesty']) {
    const value = workflow(name);
    if (['ci-parallel', 'reproducibility', 'honesty'].includes(name)) {
      // Stacked PRs must run the same source checks before their parent merges.
      assert.equal(value.on.pull_request, null);
      assert.deepEqual(value.on.push.branches, ['main']);
    }
    assert.equal(value.concurrency['cancel-in-progress'], true);
    assert(value.concurrency.group.includes('github.repository'));
    assert(value.concurrency.group.includes('github.ref'));
    assert(!value.concurrency.group.includes('github.run_id'));
    assert.deepEqual(value.permissions, {contents: 'read'});
  }
});

test('all affected jobs have explicit bounds; both unchanged normative passes retain six hours', () => {
  for (const name of ['ci-parallel', 'vv', 'bootstrap', 'reproducibility', 'honesty', 'sdk', 'release', 'sdk-candidate', 'native-golden']) {
    for (const [id, job] of Object.entries(workflow(name).jobs)) {
      const bound = job['timeout-minutes'];
      assert((Number.isInteger(bound) && bound > 0 && bound <= 360) || (name === 'ci-parallel' && bound === '${{ matrix.timeout }}'), `${name}/${id}`);
    }
  }
  assert.equal(workflow('vv').jobs.vv['timeout-minutes'], 360);
  assert.equal(workflow('bootstrap').jobs['native-gate']['timeout-minutes'], 360);
  const run = workflow('vv').jobs.vv.steps.find(step => step.with?.runCmd).with.runCmd;
  assert.equal(run, `set -euo pipefail
bash scripts/vv.sh --with-sdk bash -euo pipefail -c "$(cat <<'PRISMPM_VV'
node scripts/ci-observe.mjs run target/ci-diagnostics/vv-first -- just vv
node scripts/ci-observe.mjs run target/ci-diagnostics/vv-second -- just vv
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
  'sdk-candidate': {build: platforms.map(({os, arch}) => ({runner: os, architecture: arch}))},
  'native-golden': {'native-source-review': platforms},
};

function publicationContract(name, value) {
  const actual = Object.fromEntries(Object.entries(value.jobs).filter(([, job]) => job.strategy).map(([id, job]) => {
    assert.equal(job.strategy['max-parallel'], 2);
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
  for (const [name, matrices] of Object.entries(expectedMatrices)) for (const [job, rows] of Object.entries(matrices)) {
    for (let index = 0; index < rows.length; index++) for (const action of ['remove', 'substitute']) {
      const value = workflow(name), actual = value.jobs[job].strategy.matrix.include;
      if (action === 'remove') actual.splice(index, 1);
      else actual[index] = {...actual[index], name: 'wrong-product'};
      assert.throws(() => publicationContract(name, value));
    }
  }
});
