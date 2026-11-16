import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {parts as vvParts} from './vv-assemble.mjs';

const {load} = createRequire('/opt/prismpm/oracles/package.json')('js-yaml');
const workflow = name => load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
function sourceEvents(name, value) {
  const expected = {
    bootstrap: {workflow_dispatch: null},
    reproducibility: {schedule: [{cron: '17 3 * * *'}], workflow_dispatch: null},
  }[name];
  assert.deepEqual(value.on, expected, name + ': complete source trigger contract');
}

// PR Fast Checks (ci-parallel.yml) is retired: lint, model-audits and
// fixtures-golden are obligations of the Prism factory's delegation
// (prism-factory/model/src/Factory/PrismPM.lex.tex), established on lent
// runners only when their content identity has no counted receipt, and
// reported as the one prism/delegation check.
test('the pull request checks are carried by the delegation, not a parallel workflow', () => {
  assert(!existsSync(new URL('../.github/workflows/ci-parallel.yml', import.meta.url)));
  const delegation = workflow('prism-delegation');
  assert('pull_request' in delegation.on);
  const model = readFileSync(new URL('../prism-factory/model/src/Factory/PrismPM.lex.tex', import.meta.url), 'utf8');
  for (const command of ['cargo fmt --check', 'cargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings',
    'cargo deny --frozen --all-features check', 'cargo xtask validate', 'cargo xtask check-fixtures', 'cargo xtask check-golden']) {
    assert(model.includes(command), command);
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

// vv.yml is retired too: the eight parts of the normative acceptance are the
// delegation's vv-<part> obligations (Factory.PrismPM::verification). Each runs
// in the devcontainer image the devcontainer obligation built, against the SDK
// image vv-sdk built, once per content identity; the model's theorems fix
// their sandbox, needs and lanes.
test('the normative acceptance parts are carried by the delegation, not a main-push workflow', () => {
  assert(!existsSync(new URL('../.github/workflows/vv.yml', import.meta.url)));
  assert.deepEqual(workflow('prism-delegation').on.push.branches, ['main', 'release/v*']);
  // A newer pull request push supersedes its run, but a push to main or a release line runs its
  // whole graph to the end: cancelling it there is what kept vv.yml from ever finishing.
  assert.equal(workflow('prism-delegation').concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
  const model = readFileSync(new URL('../prism-factory/model/src/Factory/PrismPM.lex.tex', import.meta.url), 'utf8');
  for (const part of vvParts) {
    assert.equal(model.split(`"bash prism-factory/obligations/vv-part.sh ${part}"`).length, 2, part);
  }
  const run = readFileSync(new URL('../prism-factory/obligations/vv-part.sh', import.meta.url), 'utf8');
  assert(run.includes('export PRISMPM_TEST_SDK_IMAGE=$PRISM_UPSTREAM_VV_SDK_IMAGE'));
  assert(run.includes('bash scripts/vv.sh --with-sdk bash -euo pipefail -c "just vv-part $part"\n'));
});

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
  for (const name of ['bootstrap', 'reproducibility']) {
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
  for (const name of ['reproducibility', 'bootstrap']) {
    const original = workflow(name);
    const mutations = [
      value => delete value.on.workflow_dispatch,
      value => value.on.pull_request_target = null,
      value => value.on.pull_request = {paths: ['src/**']},
    ];
    mutations.push(value => value.on.pull_request = null);
    mutations.push(value => value.on.merge_group = {branches: ['main']});
    if (name !== 'reproducibility') mutations.push(value => value.on.schedule = [{cron: '* * * * *'}]);
    mutations.push(value => value.on.push = {branches: ['main']});
    for (const mutate of mutations) {
      const value = structuredClone(original); mutate(value);
      assert.throws(() => sourceEvents(name, value), name);
    }
  }
});

test('all affected jobs have explicit bounds; the bootstrap pass retains six hours', () => {
  for (const name of ['bootstrap', 'reproducibility', 'sdk', 'release', 'sdk-candidate', 'native-golden']) {
    for (const [id, job] of Object.entries(workflow(name).jobs)) {
      const bound = job['timeout-minutes'];
      assert(Number.isInteger(bound) && bound > 0 && bound <= 360, `${name}/${id}`);
    }
  }
  assert.equal(workflow('bootstrap').jobs['native-gate']['timeout-minutes'], 360);
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
  ['sdk-build', 'sdk/Dockerfile', 'sdk-build'],
];
const platforms = [{os: 'ubuntu-24.04', arch: 'amd64'}, {os: 'ubuntu-24.04-arm', arch: 'arm64'}];
// Longest-measured part first, so max-parallel starts the slow ones early. The
// set is checked against the one list in vv-assemble.mjs.
const vvStartOrder = ['dk-3', 'ho-oc', 'dk-2', 'gates', 'st-sy', 'dk-0-1', 'conformance', 'source'];
assert.deepEqual([...vvStartOrder].sort(), [...vvParts].sort());
const expectedMatrices = {
  release: {
    images: products.map(([name, dockerfile, target]) => ({name, dockerfile, target, repository: `ghcr.io/uor-foundation/prismpm-${name}`})),
    reproducibility: products.flatMap(([image, dockerfile, target]) => platforms.map(({os, arch}) => ({os, platform: `linux/${arch}`, dockerfile, target, name: `${image}-${arch}`, image}))),
    'installed-sdk': platforms,
    'source-vv': vvStartOrder.map(part => ({part})),
    // No installed-vv: re-running the eight source parts inside the shipped
    // image verified the source a second time, on a projection (Factory.Release).
    'image-platforms': platforms,
    native: [{os: 'ubuntu-24.04', platform: 'linux/amd64', target: 'x86_64-unknown-linux-gnu', arch: 'amd64'}, {os: 'ubuntu-24.04-arm', platform: 'linux/arm64', target: 'aarch64-unknown-linux-gnu', arch: 'arm64'}],
  },
  'sdk-candidate': {
    build: platforms.map(({os, arch}) => ({runner: os, architecture: arch})),
    'unpublished-construction': platforms.map(({os, arch}) => ({runner: os, architecture: arch})),
    'unpublished-prerequisites': platforms.map(({os, arch}) => ({os, arch, phase: 'prerequisites'})),
    'unpublished-installed': platforms.map(({os, arch}) => ({os, arch, phase: 'installed'})),
  },
  'native-golden': {'native-source-review': platforms},
};

// Six original union jobs and two additive unpublished qualification owners.
// Bind their complete original bodies, not only the older donor build matrix;
// only the explicitly reviewed timeout and matrix concurrency fields differ.
// build and unpublished-construction label the image with the workspace
// version (scripts/workspace-version.mjs) instead of a fixed 0.4.0.
const candidateJobs = {
  'input-policy': [30, '1a2606aed5c40be2c5fd6ade291d4d8cc8f48b265ec77346e886d7e429331b1c'],
  policy: [30, 'd8c166a9586b9ecf4e6852352218bdeec51b918562604c920fea38db8e13d499'],
  build: [180, '08a904bb01d8fa819ade3915e7df588e49a3f6848c7314d3976e91b17aa429f9'],
  publish: [60, 'eed34aecea86d7fb123167999bb1a0048f62609f6fc91d6979eeb0dcb8340128'],
  'unpublished-construction': [180, '85b9d056adcf8710aab779f72895daec983e70ba72c157a1c178afe52bc5fbe3'],
  'construction-integrity': [90, '6cf032e9b0febd74a52489ce4f06439f93ddebb3e13910e503e9f68f90fc3fa7'],
  'unpublished-prerequisites': [360, '5057f713c44d33f474ffd88493498157884d36791aaf32de67e42ec356993890'],
  'unpublished-installed': [360, 'be3439a936501f81eb4ec1f7aea6fc31eabad4c6d75cb285ec18167d8fdd0a6b'],
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
    if (id === 'input-policy') {
      // Strip ONLY the exact additional mutual-exclusion block after checking
      // it. The unchanged original policy still has its original whole hash.
      const extra = 'if test -n "$QUALIFICATION_SELECTION"; then\n  test "$DEVELOPMENT_ONLY" = false\n  test -z "$SOURCE_REVISION"\n  test -z "$INTEGRITY_SELECTION"\n  test "$WORKFLOW_REVISION" = "$GITHUB_SHA"\nfi\n';
      assert.equal(job.steps[0].env.QUALIFICATION_SELECTION, '${{ inputs.unpublished_qualification }}');
      assert(job.steps[0].run.endsWith(extra));
      delete job.steps[0].env.QUALIFICATION_SELECTION;
      job.steps[0].run = job.steps[0].run.slice(0, -extra.length);
    }
    if (id === 'build') {
      // Strip ONLY the exact first step that frees runner disk, after checking
      // it. The unchanged original build owner still has its original hash.
      assert.deepEqual(job.steps[0], {
        name: 'Free runner disk for the image and its inventory',
        run: 'sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL\ndf -h /\n',
      });
      job.steps.shift();
    }
    assert.equal(createHash('sha256').update(JSON.stringify(canonical(job))).digest('hex'), digest, id);
  }
}
const matrixParallelism = {release: {images: 6, reproducibility: 12, 'installed-sdk': 2, 'source-vv': 8, native: 2}};
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
