import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const require = createRequire('/opt/prismpm/oracles/package.json');
const {load} = require('js-yaml');
const entrypoint = fileURLToPath(new URL('./entrypoint.sh', import.meta.url));
const sdk = `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'a'.repeat(64)}`;
const reference = `registry.example.test:5000/team/product@sha256:${'b'.repeat(64)}`;
const revision = 'c'.repeat(40);
const receipt = {schema: 'prismpm/browser-export/1', reference, release_digest: `sha256:${'b'.repeat(64)}`,
  model_digest: `sha256:${'d'.repeat(64)}`, build_digest: `sha256:${'e'.repeat(64)}`,
  output: 'published-site', files: ['app.css', 'app.js', 'index.html', 'product.js', 'product_bg.wasm', 'provenance.json']
    .map(path => ({path, size: 1, digest: `sha256:${'f'.repeat(64)}`})),
  tree_digest: `sha256:${'f'.repeat(64)}`};
const publicationUrl = 'https://uor.foundation/foundry-web/';
const {output: exportDestination, ...browserIdentity} = receipt;
const publicationReceipt = {...browserIdentity, schema: 'prismpm/browser-publication-integrity/1',
  scope: 'browser-byte-integrity-only', url: publicationUrl, requests: 7, redirects: 0};

// This records the real shell adapter's Docker boundary, not release verification.
// The SDK's CLI/OCI/controller tests own evidence, reference and filesystem validity.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'prismpm-action-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const workspace = join(root, 'workspace with spaces');
  const bin = join(root, 'bin');
  for (const path of [workspace, bin, join(workspace, 'project with spaces')]) mkdirSync(path);
  const log = join(root, 'docker.jsonl'), output = join(root, 'outputs');
  writeFileSync(log, ''); writeFileSync(output, '');
  writeFileSync(join(bin, 'docker'), `#!${process.execPath}
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.ACTION_TEST_LOG, JSON.stringify(args) + '\\n');
if (args.includes('prismpm')) {
  process.stdout.write(process.env.ACTION_TEST_RESULT + '\\n');
  process.exit(Number(process.env.ACTION_TEST_STATUS));
}
const node = args.indexOf('node');
if (node < 0) throw new Error('unexpected Docker command');
const result = spawnSync(process.execPath, args.slice(node + 1), {input: fs.readFileSync(0)});
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
process.exit(result.status);
`, {mode: 0o700});
  const env = {PATH: `${bin}:/usr/bin:/bin`, HOME: join(root, 'home'),
    RUNNER_TEMP: root, GITHUB_WORKSPACE: workspace, GITHUB_OUTPUT: output,
    GITHUB_SHA: revision, PRISMPM_ACTION_SDK_IMAGE: sdk,
    PRISMPM_ACTION_COMMAND: 'export-browser', PRISMPM_ACTION_CONTEXT: 'project with spaces',
    PRISMPM_ACTION_REFERENCE: reference, PRISMPM_ACTION_OUTPUT: 'published-site',
    ACTION_TEST_LOG: log, ACTION_TEST_RESULT: JSON.stringify(receipt), ACTION_TEST_STATUS: '0'};
  return {root, workspace, output, log, env};
}

function invoke(f, overrides = {}, script = entrypoint) {
  writeFileSync(f.log, ''); writeFileSync(f.output, '');
  const result = spawnSync('/bin/bash', [script], {env: {...f.env, ...overrides},
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
  assert.equal(result.error, undefined);
  const calls = readFileSync(f.log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  return {...result, calls, outputs: readFileSync(f.output, 'utf8')};
}

function verifyExportInvocation(result, f, ref = reference, destination = 'published-site') {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 6, 'one SDK command and five isolated JSON projections');
  const args = result.calls[0], cli = args.indexOf('prismpm');
  assert.deepEqual(args.slice(cli), ['prismpm', '--project', join(f.workspace, 'project with spaces'),
    '--json', 'export-browser', ref, '--output', destination]);
  assert.equal(args[cli - 1], sdk);
  assert.deepEqual(args.slice(0, cli - 1), ['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`,
    '--env', 'HOME=/tmp/prismpm-home', '--env', 'PRISMPM_EPHEMERAL_HOME=1',
    '--tmpfs', '/tmp:rw,exec,nosuid,size=2g', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--network', 'none', '--volume', `${f.workspace}:${f.workspace}`,
    '--env', `PRISMPM_SOURCE_REVISION=${revision}`]);
  for (const projection of result.calls.slice(1)) {
    assert.equal(projection[projection.indexOf('--network') + 1], 'none');
    assert.equal(projection[projection.indexOf('node') - 1], sdk);
    assert.ok(!projection.includes('--volume'), 'output projection mounts no project or credentials');
  }
}

function publicationFixture(t) {
  const f = fixture(t);
  Object.assign(f.env, {PRISMPM_ACTION_COMMAND: 'verify-browser-publication',
    PRISMPM_ACTION_OUTPUT: '', PRISMPM_ACTION_URL: publicationUrl,
    ACTION_TEST_RESULT: JSON.stringify(publicationReceipt)});
  return f;
}

function verifyPublicationInvocation(result, f, ref = reference, url = publicationUrl) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 6, 'one SDK observation and five isolated JSON projections');
  const args = result.calls[0], cli = args.indexOf('prismpm');
  assert.deepEqual(args.slice(cli), ['prismpm', '--project', join(f.workspace, 'project with spaces'),
    '--json', 'verify-browser-publication', ref, '--url', url]);
  assert.equal(args[cli - 1], sdk);
  assert.deepEqual(args.slice(0, cli - 1), ['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`,
    '--env', 'HOME=/tmp/prismpm-home', '--env', 'PRISMPM_EPHEMERAL_HOME=1',
    '--tmpfs', '/tmp:rw,exec,nosuid,size=2g', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--volume', `${f.workspace}:${f.workspace}`,
    '--env', `PRISMPM_SOURCE_REVISION=${revision}`]);
  for (const projection of result.calls.slice(1)) {
    assert.equal(projection[projection.indexOf('--network') + 1], 'none');
    assert.equal(projection[projection.indexOf('node') - 1], sdk);
    assert.ok(!projection.includes('--volume'), 'output projection mounts no project or credentials');
  }
}

test('Action metadata exposes only the SDK output-name operand and complete receipt', () => {
  const action = load(readFileSync(new URL('./action.yml', import.meta.url), 'utf8'));
  assert.equal(action.inputs.output.default, '');
  const step = action.runs.steps.find(value => value.id === 'run');
  assert.equal(step.env.PRISMPM_ACTION_OUTPUT, '${{ inputs.output }}');
  assert.equal(action.outputs.result.value, '${{ steps.run.outputs.result }}');
  assert.equal(step.run, '${{ github.action_path }}/entrypoint.sh');
});

test('export-browser forwards the immutable reference and project-relative name without rebuilding', t => {
  const f = fixture(t), result = invoke(f);
  verifyExportInvocation(result, f);
  assert.equal(result.outputs, `result=${JSON.stringify(receipt)}\nrelease-digest=${receipt.release_digest}\n`
    + 'plan-digest=\nevidence-digest=\ntranscript-digest=\nsignature-referrer=\n');
});

test('export never borrows lifecycle authorization, socket, signing or registry credentials', t => {
  const f = fixture(t);
  const result = invoke(f, {PRISMPM_ACTION_AUTHORIZED: 'true', PRISMPM_ACTION_DETACH: 'true',
    PRISMPM_ACTION_TARGET: 'production', PRISMPM_ACTION_PLAN: 'unit-test-plan',
    PRISMPM_ACTION_POLICY: 'policy.json', PRISMPM_ACTION_TRUSTED_ROOT: 'root.json',
    PRISMPM_ACTION_BUNDLE: 'bundle.json', PRISMPM_ACTION_PROMOTION_TO: 'accepted',
    PRISMPM_ACTION_ENVIRONMENT: 'production', DOCKER_CONFIG: '/unit-test-credentials',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'unit-test-token', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid'});
  verifyExportInvocation(result, f);
});

test('missing reference or output fails before any SDK invocation', t => {
  const f = fixture(t);
  for (const field of ['PRISMPM_ACTION_REFERENCE', 'PRISMPM_ACTION_OUTPUT']) {
    const result = invoke(f, {[field]: ''});
    assert.notEqual(result.status, 0); assert.deepEqual(result.calls, []); assert.equal(result.outputs, '');
  }
});

test('SDK failures publish no receipt or fallback output', t => {
  const f = fixture(t);
  for (const status of [1, 2, 4, 73]) {
    const result = invoke(f, {ACTION_TEST_STATUS: String(status), ACTION_TEST_RESULT: '{"diagnostic":"unit-test"}'});
    assert.equal(result.status, status); assert.equal(result.calls.length, 1); assert.equal(result.outputs, '');
  }
});

test('reference grammar belongs to the SDK; valid authority forms are passed unchanged', t => {
  const f = fixture(t);
  for (const name of ['registry.example.test/team/product', 'localhost:5000/team/sub-product']) {
    const ref = `${name}@sha256:${'b'.repeat(64)}`;
    verifyExportInvocation(invoke(f, {PRISMPM_ACTION_REFERENCE: ref}), f, ref);
  }
});

test('output name is not expanded, prefixed or precreated by the adapter', t => {
  const f = fixture(t);
  for (const name of ['a', 'A0_site-1', 's'.repeat(128)]) {
    verifyExportInvocation(invoke(f, {PRISMPM_ACTION_OUTPUT: name}), f, reference, name);
    assert.deepEqual(readdirSync(join(f.workspace, 'project with spaces')), [], 'only the SDK may create output');
  }
});

test('unsafe reference and destination strings remain single operands and cannot inject host commands', t => {
  const f = fixture(t), sentinel = join(f.root, 'must-not-exist');
  for (const [field, value] of [
    ['PRISMPM_ACTION_REFERENCE', 'registry.example.test/product:mutable'],
    ['PRISMPM_ACTION_REFERENCE', `[2001:db8::1]:5000/team/product@sha256:${'b'.repeat(64)}`],
    ['PRISMPM_ACTION_REFERENCE', `$(touch '${sentinel}')`],
    ['PRISMPM_ACTION_REFERENCE', `x; touch '${sentinel}'`],
    ['PRISMPM_ACTION_REFERENCE', '--skip-verify'],
    ['PRISMPM_ACTION_OUTPUT', '../outside'],
    ['PRISMPM_ACTION_OUTPUT', '/absolute'],
    ['PRISMPM_ACTION_OUTPUT', `$(touch '${sentinel}')`],
    ['PRISMPM_ACTION_OUTPUT', 'site\n--force'],
    ['PRISMPM_ACTION_OUTPUT', 'site name'],
  ]) {
    const result = invoke(f, {[field]: value, ACTION_TEST_STATUS: '4'});
    assert.equal(result.status, 4); assert.equal(result.calls.length, 1); assert.equal(result.outputs, '');
    const args = result.calls[0], cli = args.indexOf('prismpm');
    assert.deepEqual(args.slice(cli), ['prismpm', '--project', join(f.workspace, 'project with spaces'),
      '--json', 'export-browser', field.endsWith('REFERENCE') ? value : reference,
      '--output', field.endsWith('OUTPUT') ? value : 'published-site']);
    assert.throws(() => readFileSync(sentinel), {code: 'ENOENT'});
  }
});

test('project context remains confined before Docker invocation', t => {
  const f = fixture(t);
  for (const context of ['../escape', '/absolute', 'nested/../../escape', 'nested\\escape']) {
    const result = invoke(f, {PRISMPM_ACTION_CONTEXT: context});
    assert.notEqual(result.status, 0); assert.deepEqual(result.calls, []); assert.equal(result.outputs, '');
  }
});

test('existing check and immutable inspect commands retain their argument boundaries', t => {
  const f = fixture(t);
  for (const command of ['check', 'inspect']) {
    const result = invoke(f, {PRISMPM_ACTION_COMMAND: command});
    assert.equal(result.status, 0, result.stderr);
    const args = result.calls[0];
    assert.deepEqual(args.slice(args.indexOf('prismpm')), ['prismpm', '--project',
      join(f.workspace, 'project with spaces'), '--json', command, ...(command === 'inspect' ? [reference] : [])]);
  }
});

test('owning adapter assertions reject real argument and host-isolation defects', t => {
  const f = fixture(t), source = readFileSync(entrypoint, 'utf8');
  for (const [before, after] of [
    ['args+=(export-browser "$reference" --output "$export_output")',
      'args+=(export-browser "$reference" --output "$project/$export_output")'],
    ['network_args=(--network none)', 'network_args=(--network host)'],
    ['--tmpfs /tmp:rw,exec,nosuid,size=2g', '--tmpfs /tmp:rw,exec,nosuid,size=1g'],
  ]) {
    assert.equal(source.split(before).length, 2, 'mutation must change exactly one owning statement');
    const path = join(f.root, 'mutant.sh'); writeFileSync(path, source.replace(before, after));
    assert.throws(() => verifyExportInvocation(invoke(f, {}, path), f), {name: 'AssertionError'});
  }
});

test('Action metadata exposes an integrity-only publication URL as an environment operand', () => {
  const action = load(readFileSync(new URL('./action.yml', import.meta.url), 'utf8'));
  assert.equal(action.inputs.url.default, '');
  assert.match(action.inputs.url.description, /byte integrity only, not deployment acceptance/);
  const step = action.runs.steps.find(value => value.id === 'run');
  assert.equal(step.env.PRISMPM_ACTION_URL, '${{ inputs.url }}');
  assert.equal(step.run, '${{ github.action_path }}/entrypoint.sh');
});

test('publication observation forwards the exact reference and HTTPS base and returns only its receipt', t => {
  const f = publicationFixture(t), result = invoke(f);
  verifyPublicationInvocation(result, f);
  assert.equal(result.outputs, `result=${JSON.stringify(publicationReceipt)}\nrelease-digest=${receipt.release_digest}\n`
    + 'plan-digest=\nevidence-digest=\ntranscript-digest=\nsignature-referrer=\n');
  assert.deepEqual(readdirSync(join(f.workspace, 'project with spaces')), [], 'no local export or build');
});

test('publication observer admits network but never inherits lifecycle, socket, signing or registry authority', t => {
  const f = publicationFixture(t);
  const result = invoke(f, {PRISMPM_ACTION_AUTHORIZED: 'true', PRISMPM_ACTION_DETACH: 'true',
    PRISMPM_ACTION_TARGET: 'production', PRISMPM_ACTION_PLAN: 'unit-test-plan',
    PRISMPM_ACTION_OUTPUT: 'unused-export', PRISMPM_ACTION_RELEASE: 'A',
    PRISMPM_ACTION_POLICY: 'policy.json', PRISMPM_ACTION_TRUSTED_ROOT: 'root.json',
    PRISMPM_ACTION_BUNDLE: 'bundle.json', PRISMPM_ACTION_PROMOTION_TO: 'accepted',
    PRISMPM_ACTION_ENVIRONMENT: 'production', DOCKER_CONFIG: '/unit-test-credentials',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'unit-test-token', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid',
    HTTPS_PROXY: 'https://unit-test-proxy.invalid/', CURL_CA_BUNDLE: '/unit-test-ca.pem'});
  verifyPublicationInvocation(result, f);
});

test('missing publication reference or URL fails before SDK execution or output', t => {
  const f = publicationFixture(t);
  for (const field of ['PRISMPM_ACTION_REFERENCE', 'PRISMPM_ACTION_URL']) {
    const result = invoke(f, {[field]: ''});
    assert.notEqual(result.status, 0); assert.deepEqual(result.calls, []); assert.equal(result.outputs, '');
  }
});

test('canonical publication URL validation belongs to the SDK without adapter normalization', t => {
  const f = publicationFixture(t);
  for (const url of ['https://example.test/', 'https://example.test/nested/Path_0-1/']) {
    verifyPublicationInvocation(invoke(f, {PRISMPM_ACTION_URL: url}), f, reference, url);
  }
  // These transport fixtures do not verify the SDK grammar: its owning tests do.
  for (const url of ['http://example.test/', 'https://Example.test/', 'https://example.test:443/',
    'https://127.0.0.1/', 'https://example.test/no-trailing-slash', 'https://example.test/%2e%2e/',
    'https://example.test/path/?query', 'https://example.test/path/#fragment',
    'https://user:password@example.test/', 'https://example.test/a//b/']) {
    const result = invoke(f, {PRISMPM_ACTION_URL: url, ACTION_TEST_STATUS: '2'});
    assert.equal(result.status, 2); assert.equal(result.calls.length, 1); assert.equal(result.outputs, '');
    const args = result.calls[0];
    assert.deepEqual(args.slice(args.indexOf('prismpm')), ['prismpm', '--project',
      join(f.workspace, 'project with spaces'), '--json', 'verify-browser-publication', reference, '--url', url]);
  }
});

test('publication operands cannot inject host commands or extra CLI options', t => {
  const f = publicationFixture(t), sentinel = join(f.root, 'must-not-exist');
  for (const [field, value] of [
    ['PRISMPM_ACTION_REFERENCE', 'registry.example.test/product:mutable'],
    ['PRISMPM_ACTION_REFERENCE', `$(touch '${sentinel}')`],
    ['PRISMPM_ACTION_REFERENCE', '--skip-verify'],
    ['PRISMPM_ACTION_URL', `https://example.test/; touch '${sentinel}'`],
    ['PRISMPM_ACTION_URL', `$(touch '${sentinel}')`],
    ['PRISMPM_ACTION_URL', 'https://example.test/\n--insecure'],
    ['PRISMPM_ACTION_URL', '--follow-redirects'],
  ]) {
    const result = invoke(f, {[field]: value, ACTION_TEST_STATUS: '2'});
    assert.equal(result.status, 2); assert.equal(result.calls.length, 1); assert.equal(result.outputs, '');
    const args = result.calls[0];
    assert.deepEqual(args.slice(args.indexOf('prismpm')), ['prismpm', '--project',
      join(f.workspace, 'project with spaces'), '--json', 'verify-browser-publication',
      field.endsWith('REFERENCE') ? value : reference, '--url', field.endsWith('URL') ? value : publicationUrl]);
    assert.throws(() => readFileSync(sentinel), {code: 'ENOENT'});
  }
});

test('publication failures and mutable SDK selectors cannot yield an integrity receipt', t => {
  const f = publicationFixture(t);
  for (const status of [1, 2, 4, 5, 73]) {
    const result = invoke(f, {ACTION_TEST_STATUS: String(status), ACTION_TEST_RESULT: '{"diagnostic":"unit-test"}'});
    assert.equal(result.status, status); assert.equal(result.calls.length, 1); assert.equal(result.outputs, '');
  }
  for (const image of ['ghcr.io/uor-foundation/prismpm-sdk:latest', sdk.slice(0, -1), `${sdk}x`]) {
    const result = invoke(f, {PRISMPM_ACTION_SDK_IMAGE: image});
    assert.equal(result.status, 2); assert.deepEqual(result.calls, []); assert.equal(result.outputs, '');
  }
});

test('owning publication assertions reject URL substitution and accidental network denial', t => {
  const f = publicationFixture(t), source = readFileSync(entrypoint, 'utf8');
  for (const [before, after] of [
    ['args+=(verify-browser-publication "$reference" --url "$publication_url")',
      'args+=(verify-browser-publication "$reference" --url "https://substituted.invalid/")'],
    ['test -n "$publication_url"\n    network_args=()',
      'test -n "$publication_url"\n    network_args=(--network none)'],
  ]) {
    assert.equal(source.split(before).length, 2, 'mutation must change exactly one owning statement');
    const path = join(f.root, 'publication-mutant.sh'); writeFileSync(path, source.replace(before, after));
    assert.throws(() => verifyPublicationInvocation(invoke(f, {}, path), f), {name: 'AssertionError'});
  }
});
