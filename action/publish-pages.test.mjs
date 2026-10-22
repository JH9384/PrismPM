import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const require = createRequire('/opt/prismpm/oracles/package.json');
const {load} = require('js-yaml');
const closure = fileURLToPath(new URL('./pages-closure.mjs', import.meta.url));
const entrypoint = fileURLToPath(new URL('./entrypoint.sh', import.meta.url));
const starter = fileURLToPath(new URL('./starter/publish-pages.yml', import.meta.url));
const sdk = `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'a'.repeat(64)}`;
const revision = 'c'.repeat(40);
const RELEASE_TYPE = 'application/vnd.prismpm.product.release.v1+json';
const PAGES = {kind: 'github-pages-browser', api: 'github-pages-artifact@v4'};
const CONTROLS = ['application-acceptance', 'artifact-closure', 'source-proof', 'spdx'];
const KUBERNETES = {id: 'production', kind: 'kubernetes', api_version: 'kubernetes@1.36.4',
  adapter_digest: `sha256:${'6'.repeat(64)}`, minimum_release_status: 'accepted'};
const PAGES_TARGET = {id: 'pages', kind: PAGES.kind, api_version: PAGES.api,
  adapter_digest: `sha256:${'5'.repeat(64)}`, minimum_release_status: 'development'};

const digestOf = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const sortKeys = value => Array.isArray(value) ? value.map(sortKeys)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])])) : value;
const canonical = value => Buffer.from(JSON.stringify(sortKeys(value)));

// A synthetic verified release layout: the exact byte relationships the SDK
// writes (release manifest layers titled by build path, blobs by digest, the
// browser-system binding and the build manifest). It is a transport fixture
// for the Action's closure check, not SDK release or production acceptance.
function releaseFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'prismpm-pages-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const workspace = join(root, 'workspace with spaces');
  const project = join(workspace, 'project with spaces');
  mkdirSync(project, {recursive: true});
  const browser = {
    'app.css': Buffer.from('body{margin:0}'),
    'app.js': Buffer.from('export const app = 1;'),
    'index.html': Buffer.from('<!doctype html><title>product</title>'),
    'product.js': Buffer.from('export function init(){}'),
    'product_bg.wasm': Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
    'provenance.json': canonical({build: 'synthetic'}),
  };
  const applicationModelDigest = `sha256:${'1'.repeat(64)}`;
  const system = {
    schema: options.schema ?? 'prismpm/system-model/2',
    product: {id: 'browser-product', owner: 'UOR Foundation', version: 'A', lifecycle: 'development'},
    application_profile: {contract: 'prismpm/browser-resident-application/1',
      application_model_digest: applicationModelDigest},
    artifacts: [{id: 'product-application', role: 'selected-application'}],
    components: [{id: 'product-browser', artifact: 'product-application', kind: 'browser', version: '0.1.0'}],
    targets: options.targets ?? [PAGES_TARGET],
    controls: CONTROLS,
  };
  const systemBytes = canonical(system);
  const build = {
    'model.prism.json': canonical({schema: 'prismpm/model/1', application: {name: 'product'}}),
    'product.holo': Buffer.from('{"holo":1}'),
    ...Object.fromEntries(Object.entries(browser).map(([name, bytes]) => [`view/browser/${name}`, bytes])),
  };
  if (options.withSystem !== false) build['system.prism.json'] = systemBytes;
  const bindingRows = Object.entries(build)
    .filter(([path]) => path !== 'system.prism.json')
    .map(([path, bytes]) => ({digest: digestOf(bytes), path, size: bytes.length}));
  const binding = {
    schema: 'prismpm/browser-system-release/1', system_digest: digestOf(systemBytes),
    application_model_digest: applicationModelDigest, component: 'product-browser',
    artifact: 'product-application', target: system.targets[0]?.id ?? 'pages',
    controls: CONTROLS, files: bindingRows,
    ...(options.binding ?? {}),
  };
  if (options.withSystem !== false) {
    build['projections/browser-system-release.json'] = canonical(binding);
    build['projections/spdx.json'] = canonical({spdxVersion: 'SPDX-3.0.1'});
  }
  const manifestRows = Object.entries(build).map(([path, bytes]) => ({
    path, kind: path.endsWith('.json') ? 'json' : 'artifact', byte_length: bytes.length,
    sha256: digestOf(bytes).slice('sha256:'.length)}));
  build['manifest.json'] = canonical({files: manifestRows, inputs: {schema: 'prismpm/build-inputs/2'},
    schema: 'prismpm/build-manifest/1'});
  if (options.mutateBuild) options.mutateBuild(build);
  const layers = Object.entries(build).map(([path, bytes]) => ({
    mediaType: 'application/octet-stream', digest: digestOf(bytes), size: bytes.length,
    annotations: {'org.opencontainers.image.title': path, 'org.prismpm.role': 'release-artifact'}}));
  const config = canonical({schema: 'prismpm/product-release/1', product: 'browser-product'});
  const release = canonical({schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
    artifactType: RELEASE_TYPE, config: {mediaType: RELEASE_TYPE, digest: digestOf(config), size: config.length},
    layers});
  const releaseDigest = digestOf(release);
  const store = join(project, '.prism/oci');
  mkdirSync(join(store, 'blobs/sha256'), {recursive: true});
  mkdirSync(join(store, 'verified'));
  const blob = bytes => writeFileSync(join(store, 'blobs/sha256', digestOf(bytes).slice('sha256:'.length)), bytes);
  for (const bytes of Object.values(build)) blob(bytes);
  blob(config); blob(release);
  writeFileSync(join(store, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}');
  writeFileSync(join(store, 'index.json'), canonical({schemaVersion: 2, manifests: [{
    mediaType: 'application/vnd.oci.image.manifest.v1+json', artifactType: RELEASE_TYPE,
    digest: releaseDigest, size: release.length}]}));
  writeFileSync(join(store, 'verified', `${releaseDigest.slice('sha256:'.length)}.json`), '{}');
  const output = 'pages';
  if (options.withOutput !== false) {
    mkdirSync(join(project, output));
    for (const [name, bytes] of Object.entries(browser)) writeFileSync(join(project, output, name), bytes);
  }
  const files = Object.entries(browser).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, bytes]) => ({digest: digestOf(bytes), path, size: bytes.length}));
  const treeDigest = digestOf(canonical(files));
  return {root, workspace, project, store, output, releaseDigest, treeDigest, files, browser,
    systemDigest: digestOf(systemBytes)};
}

function check(f, overrides = {}) {
  const result = spawnSync(process.execPath, [closure, overrides.project ?? f.project,
    overrides.releaseDigest ?? f.releaseDigest, overrides.output ?? f.output, overrides.treeDigest ?? f.treeDigest],
  {encoding: 'utf8', timeout: 10000});
  assert.equal(result.error, undefined);
  return result;
}

function refused(result, code, pattern, name = '') {
  assert.equal(result.stdout, '', `${name}: a refusal publishes no closure summary`);
  const lines = result.stderr.trim().split('\n');
  const diagnostic = JSON.parse(lines[lines.length - 1]);
  assert.equal(diagnostic.code, code, `${name}: ${result.stderr}`);
  assert.match(diagnostic.message, pattern, name);
  assert.equal(result.status, {PP2101: 3, PP6101: 5, PP8001: 1}[code], name);
}

function summaryOf(f) {
  return {api_version: PAGES.api, files: f.files, output: f.output, product_id: 'browser-product',
    product_version: 'A', release_digest: f.releaseDigest, system_digest: f.systemDigest,
    target_id: 'pages', target_kind: PAGES.kind, tree_digest: f.treeDigest};
}

test('a verified release naming the Pages target yields the exact closure summary', t => {
  const f = releaseFixture(t), result = check(f);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), summaryOf(f));
  assert.equal(result.stdout, `${JSON.stringify(sortKeys(summaryOf(f)))}\n`, 'one canonical line');
});

test('a system manifest that does not name the Pages target is refused before any export is read', t => {
  // Fail-first owner of the refusal: no variant has an export directory, so a
  // closure read would fail with another code; only the modeled target refuses.
  for (const [name, options] of [
    ['a transactional system', {schema: 'prismpm/system-model/1', targets: [KUBERNETES]}],
    ['a browser system bound to another target kind', {targets: [KUBERNETES]}],
    ['a browser system with no targets', {targets: []}],
    ['a browser system with two targets', {targets: [PAGES_TARGET, KUBERNETES]}],
    ['a browser system with another Pages artifact API', {targets: [{...PAGES_TARGET, api_version: 'github-pages-artifact@v3'}]}],
    ['a release without a containing system', {withSystem: false}],
  ]) {
    refused(check(releaseFixture(t, {...options, withOutput: false})), 'PP2101', /Pages target/, name);
  }
});

test('the binding must name the same system, application and target as the released system manifest', t => {
  for (const [name, binding] of [
    ['another target', {target: 'other'}],
    ['another system digest', {system_digest: `sha256:${'7'.repeat(64)}`}],
    ['another application model', {application_model_digest: `sha256:${'8'.repeat(64)}`}],
    ['another schema', {schema: 'prismpm/browser-system-release/2'}],
  ]) {
    refused(check(releaseFixture(t, {binding})), 'PP6101', /binding/, name);
  }
});

test('served bytes that differ from the release closure are refused', t => {
  const changed = releaseFixture(t);
  writeFileSync(join(changed.project, changed.output, 'app.js'), 'export const app = 2;');
  refused(check(changed), 'PP6101', /app\.js/, 'changed');
  const extra = releaseFixture(t);
  writeFileSync(join(extra.project, extra.output, 'CNAME'), 'example.test');
  refused(check(extra), 'PP6101', /exported files differ/, 'extra');
  const missing = releaseFixture(t);
  rmSync(join(missing.project, missing.output, 'provenance.json'));
  refused(check(missing), 'PP6101', /exported files differ/, 'missing');
  refused(check(releaseFixture(t, {withOutput: false})), 'PP6101', /export directory/, 'absent');
  refused(check(releaseFixture(t), {treeDigest: `sha256:${'9'.repeat(64)}`}), 'PP6101', /tree digest/, 'tree');
});

test('release evidence that disagrees with itself is refused', t => {
  const tamperedBinding = releaseFixture(t, {mutateBuild(build) {
    const binding = JSON.parse(build['projections/browser-system-release.json'].toString());
    binding.files.find(row => row.path === 'view/browser/app.css').digest = `sha256:${'2'.repeat(64)}`;
    build['projections/browser-system-release.json'] = canonical(binding);
  }});
  refused(check(tamperedBinding), 'PP6101', /app\.css/, 'binding row');
  const tamperedManifest = releaseFixture(t, {mutateBuild(build) {
    const manifest = JSON.parse(build['manifest.json'].toString());
    manifest.files.find(row => row.path === 'view/browser/index.html').byte_length += 1;
    build['manifest.json'] = canonical(manifest);
  }});
  refused(check(tamperedManifest), 'PP6101', /index\.html/, 'manifest row');
  const tamperedBlob = releaseFixture(t);
  const hex = digestOf(tamperedBlob.browser['app.css']).slice('sha256:'.length);
  writeFileSync(join(tamperedBlob.store, 'blobs/sha256', hex), 'body{margin:1}');
  refused(check(tamperedBlob), 'PP6101', /blob/, 'blob');
  const unverified = releaseFixture(t);
  rmSync(join(unverified.store, 'verified'), {recursive: true});
  refused(check(unverified), 'PP6101', /verified/, 'unverified');
  refused(check(releaseFixture(t), {releaseDigest: `sha256:${'3'.repeat(64)}`}), 'PP6101', /verified/, 'unknown');
  refused(check(releaseFixture(t), {releaseDigest: 'latest'}), 'PP6101', /release digest/, 'mutable');
});

test('unsafe export paths are refused without reading through links', t => {
  const linked = releaseFixture(t, {withOutput: false});
  const elsewhere = join(linked.root, 'elsewhere');
  mkdirSync(elsewhere);
  for (const [name, bytes] of Object.entries(linked.browser)) writeFileSync(join(elsewhere, name), bytes);
  symlinkSync(elsewhere, join(linked.project, linked.output));
  refused(check(linked), 'PP8001', /link/, 'linked directory');
  const linkedFile = releaseFixture(t);
  rmSync(join(linkedFile.project, linkedFile.output, 'app.css'));
  symlinkSync(join(linkedFile.root, 'missing'), join(linkedFile.project, linkedFile.output, 'app.css'));
  refused(check(linkedFile), 'PP8001', /link/, 'linked file');
  for (const output of ['../escape', '/absolute', 'nested/site', '.prism', 'site name', '']) {
    refused(check(releaseFixture(t), {output}), 'PP8001', /output/, output);
  }
});

// Real shell adapter boundary for publish-pages: a fake Docker records every
// invocation; SDK results are scripted; the closure check runs for real.
function adapterFixture(t, options = {}) {
  const f = releaseFixture(t, options);
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  const log = join(f.root, 'docker.jsonl'), output = join(f.root, 'outputs');
  writeFileSync(log, ''); writeFileSync(output, '');
  writeFileSync(join(bin, 'docker'), [
    `#!${process.execPath}`,
    "import fs from 'node:fs';",
    "import {spawnSync} from 'node:child_process';",
    'const args = process.argv.slice(2);',
    "fs.appendFileSync(process.env.ACTION_TEST_LOG, JSON.stringify(args) + '\\n');",
    "if (args.includes('prismpm')) {",
    "  const command = args[args.indexOf('--json') + 1];",
    '  const scripted = JSON.parse(process.env.ACTION_TEST_RESULTS)[command];',
    "  if (!scripted) throw new Error('unexpected SDK command ' + command);",
    "  process.stdout.write(scripted.result + '\\n');",
    '  process.exit(scripted.status);',
    '}',
    "const node = args.indexOf('node');",
    "if (node < 0) throw new Error('unexpected Docker command');",
    'const result = spawnSync(process.execPath, args.slice(node + 1), {input: fs.readFileSync(0)});',
    'process.stdout.write(result.stdout); process.stderr.write(result.stderr);',
    'process.exit(result.status);',
    '',
  ].join('\n'), {mode: 0o700});
  const reference = 'registry.example.test:5000/team/product:pages';
  const buildResult = {schema: 'prismpm/product-release-result/1', reference,
    release_digest: f.releaseDigest, product: 'browser-product', release: 'A'};
  const receipt = {schema: 'prismpm/browser-export/1',
    reference: `registry.example.test:5000/team/product@${f.releaseDigest}`,
    release_digest: f.releaseDigest, model_digest: `sha256:${'d'.repeat(64)}`,
    build_digest: `sha256:${'e'.repeat(64)}`, output: f.output, files: f.files, tree_digest: f.treeDigest};
  const env = {PATH: `${bin}:/usr/bin:/bin`, HOME: join(f.root, 'home'),
    RUNNER_TEMP: f.root, GITHUB_WORKSPACE: f.workspace, GITHUB_OUTPUT: output,
    GITHUB_SHA: revision, PRISMPM_ACTION_SDK_IMAGE: sdk,
    PRISMPM_ACTION_COMMAND: 'publish-pages', PRISMPM_ACTION_CONTEXT: 'project with spaces',
    PRISMPM_ACTION_REFERENCE: reference, PRISMPM_ACTION_OUTPUT: f.output,
    ACTION_TEST_LOG: log, ACTION_TEST_RESULTS: JSON.stringify({
      build: {result: JSON.stringify(buildResult), status: 0},
      'export-browser': {result: JSON.stringify(receipt), status: 0},
    })};
  return {...f, log, outputs: output, env, reference, buildResult, receipt};
}

function invoke(f, overrides = {}, script = entrypoint) {
  writeFileSync(f.log, ''); writeFileSync(f.outputs, '');
  const result = spawnSync('/bin/bash', [script], {env: {...f.env, ...overrides},
    encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024});
  assert.equal(result.error, undefined);
  const calls = readFileSync(f.log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  return {...result, calls, outputs: readFileSync(f.outputs, 'utf8')};
}

const isolation = () => ['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`,
  '--env', 'HOME=/tmp/prismpm-home', '--env', 'PRISMPM_EPHEMERAL_HOME=1',
  '--tmpfs', '/tmp:rw,exec,nosuid,size=1g', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'];

function verifyPublication(result, f) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 10, 'build, digest, export, tree digest, closure and five isolated projections');
  const [build, digest, exported, tree, checked] = result.calls;
  const project = join(f.workspace, 'project with spaces');
  const sdkArguments = ['--network', 'none', '--volume', `${f.workspace}:${f.workspace}`,
    '--env', `PRISMPM_SOURCE_REVISION=${revision}`, sdk];
  assert.deepEqual(build, [...isolation(), ...sdkArguments, 'prismpm', '--json',
    'build', '--locked', '--tag', f.reference, project]);
  assert.deepEqual(exported, [...isolation(), ...sdkArguments, 'prismpm', '--project', project, '--json',
    'export-browser', `registry.example.test:5000/team/product@${f.releaseDigest}`, '--output', f.output]);
  const actionPath = fileURLToPath(new URL('./', import.meta.url)).replace(/\/$/, '');
  assert.deepEqual(checked, [...isolation(), '--network', 'none',
    '--volume', `${f.workspace}:${f.workspace}:ro`, '--volume', `${actionPath}:${actionPath}:ro`, sdk,
    'node', `${actionPath}/pages-closure.mjs`, project, f.releaseDigest, f.output, f.treeDigest]);
  for (const projection of [digest, tree, ...result.calls.slice(5)]) {
    assert.equal(projection[projection.indexOf('--network') + 1], 'none');
    assert.equal(projection[projection.indexOf('node') - 1], sdk);
    assert.ok(!projection.includes('--volume'), 'output projection mounts no project or credentials');
  }
  assert.equal(result.outputs, `result=${JSON.stringify(f.receipt)}\nrelease-digest=${f.releaseDigest}\n`
    + 'plan-digest=\nevidence-digest=\ntranscript-digest=\nsignature-referrer=\n'
    + `pages-path=project with spaces/${f.output}\npages-closure=${JSON.stringify(sortKeys(summaryOf(f)))}\n`);
}

test('publish-pages builds once, exports the built release, checks the closure and returns the Pages path', t => {
  const f = adapterFixture(t);
  verifyPublication(invoke(f), f);
  const root = adapterFixture(t);
  const result = invoke(root, {PRISMPM_ACTION_CONTEXT: '.', GITHUB_WORKSPACE: root.project});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.outputs, /\npages-path=pages\n/);
});

test('publish-pages refuses a release whose manifest does not name the Pages target before any upload path exists', t => {
  const f = adapterFixture(t, {targets: [KUBERNETES]});
  const result = invoke(f);
  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.calls.length, 5, 'the closure check is the last invocation');
  assert.equal(result.outputs, '', 'no result, digest or Pages path is published');
  assert.match(result.stderr, /"code":"PP2101"/);
});

test('publish-pages requires a tagged build reference and an output name before any SDK invocation', t => {
  const f = adapterFixture(t);
  for (const [field, value] of [
    ['PRISMPM_ACTION_REFERENCE', ''],
    ['PRISMPM_ACTION_REFERENCE', `registry.example.test/team/product@sha256:${'b'.repeat(64)}`],
    ['PRISMPM_ACTION_REFERENCE', 'registry.example.test/team/product'],
    ['PRISMPM_ACTION_REFERENCE', 'localhost:5000/team/product'],
    ['PRISMPM_ACTION_REFERENCE', 'registry.example.test/team/product:'],
    ['PRISMPM_ACTION_OUTPUT', ''],
  ]) {
    const result = invoke(f, {[field]: value});
    assert.equal(result.status, 2, `${field}=${value}`);
    assert.deepEqual(result.calls, []); assert.equal(result.outputs, '');
  }
});

test('an SDK build or export failure stops publication without a receipt, digest or Pages path', t => {
  const f = adapterFixture(t);
  const scripted = JSON.parse(f.env.ACTION_TEST_RESULTS);
  for (const [command, calls] of [['build', 1], ['export-browser', 3]]) {
    const failing = {...scripted, [command]: {result: '{"diagnostic":"unit-test"}', status: 5}};
    const result = invoke(f, {ACTION_TEST_RESULTS: JSON.stringify(failing)});
    assert.equal(result.status, 5, command);
    assert.equal(result.calls.length, calls, command);
    assert.equal(result.outputs, '');
  }
  const mutable = {...scripted, build: {result: JSON.stringify({...f.buildResult, release_digest: 'latest'}), status: 0}};
  const result = invoke(f, {ACTION_TEST_RESULTS: JSON.stringify(mutable)});
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.length, 2, 'no export from a mutable release identity');
  assert.equal(result.outputs, '');
});

test('publish-pages never borrows lifecycle authorization, socket, signing or registry credentials', t => {
  const f = adapterFixture(t);
  const result = invoke(f, {PRISMPM_ACTION_AUTHORIZED: 'true', PRISMPM_ACTION_DETACH: 'true',
    PRISMPM_ACTION_TARGET: 'production', PRISMPM_ACTION_PLAN: 'unit-test-plan',
    PRISMPM_ACTION_POLICY: 'policy.json', PRISMPM_ACTION_TRUSTED_ROOT: 'root.json',
    PRISMPM_ACTION_BUNDLE: 'bundle.json', PRISMPM_ACTION_PROMOTION_TO: 'accepted',
    PRISMPM_ACTION_ENVIRONMENT: 'production', PRISMPM_ACTION_URL: 'https://example.test/',
    DOCKER_CONFIG: '/unit-test-credentials',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'unit-test-token', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid'});
  verifyPublication(result, f);
});

test('owning publication assertions reject a skipped closure check and a skipped target check', t => {
  const f = adapterFixture(t), source = readFileSync(entrypoint, 'utf8');
  const before = 'node "$action_path/pages-closure.mjs" "$project" "$release_digest" "$export_output" "$tree_digest"';
  const after = 'node -e "process.stdout.write(process.argv[4])" "$project" "$release_digest" "$export_output" "$tree_digest"';
  assert.equal(source.split(before).length, 2, 'mutation must change exactly one owning statement');
  const mutant = join(f.root, 'mutant.sh'); writeFileSync(mutant, source.replace(before, after));
  assert.throws(() => verifyPublication(invoke(f, {}, mutant), f), {name: 'AssertionError'});

  const refusing = adapterFixture(t, {targets: [KUBERNETES]});
  const validator = readFileSync(closure, 'utf8');
  const guard = 'if (target.kind !== PAGES_TARGET_KIND || target.api_version !== PAGES_TARGET_API)';
  assert.equal(validator.split(guard).length, 2, 'mutation must change exactly one owning statement');
  const skipped = join(refusing.root, 'pages-closure.mjs');
  writeFileSync(skipped, validator.replace(guard, 'if (false)'));
  const result = spawnSync(process.execPath, [skipped, refusing.project, refusing.releaseDigest, refusing.output,
    refusing.treeDigest], {encoding: 'utf8', timeout: 10000});
  assert.notEqual(result.status, 3, 'the mutant must no longer refuse, proving the guard owns the refusal');
});

test('Action metadata returns the Pages path and closure summary from the one run step', () => {
  const action = load(readFileSync(new URL('./action.yml', import.meta.url), 'utf8'));
  const step = action.runs.steps.find(value => value.id === 'run');
  assert.equal(action.outputs['pages-path'].value, '${{ steps.run.outputs.pages-path }}');
  assert.equal(action.outputs['pages-closure'].value, '${{ steps.run.outputs.pages-closure }}');
  assert.match(action.outputs['pages-closure'].description, /not deployment acceptance/);
  assert.equal(step.env.PRISMPM_ACTION_OUTPUT, '${{ inputs.output }}');
  assert.equal(step.run, '${{ github.action_path }}/entrypoint.sh');
});

test('the starter workflow is one job on one runner, runs on main pushes and tags only, and pins every action', () => {
  const workflow = load(readFileSync(starter, 'utf8'));
  assert.deepEqual(workflow.on, {push: {branches: ['main'], tags: ['**']}}, 'never on pull requests');
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.concurrency, {group: 'prismpm-pages-publication', 'cancel-in-progress': true});
  assert.deepEqual(Object.keys(workflow.jobs), ['publish']);
  const job = workflow.jobs.publish;
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(typeof job['timeout-minutes'], 'number');
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 90);
  assert.deepEqual(job.permissions, {contents: 'read', 'id-token': 'write', pages: 'write'});
  assert.equal(job.environment.name, 'github-pages');
  assert.equal(job.needs, undefined, 'no OCI sign, promote or push job is required');
  const uses = job.steps.filter(step => step.uses).map(step => step.uses);
  for (const value of uses) {
    assert.ok(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/.test(value)
      || value === 'UOR-Foundation/PrismPM/action@__PRISMPM_ACTION_REVISION__', value);
  }
  const commands = job.steps.filter(step => step.uses?.startsWith('UOR-Foundation/PrismPM/action@'))
    .map(step => step.with.command);
  assert.deepEqual(commands, ['fetch', 'publish-pages']);
  const publish = job.steps.find(step => step.with?.command === 'publish-pages');
  assert.equal(publish.id, 'pages');
  assert.equal(publish.with.output, 'pages');
  assert.equal(publish.with.reference, '${{ steps.lock.outputs.reference }}');
  assert.equal(publish.with['sdk-image'], '${{ steps.lock.outputs.sdk-image }}');
  assert.deepEqual(uses.map(value => value.split('@')[0]), ['actions/checkout', 'UOR-Foundation/PrismPM/action',
    'UOR-Foundation/PrismPM/action', 'actions/configure-pages', 'actions/upload-pages-artifact', 'actions/deploy-pages']);
  const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-pages-artifact@'));
  assert.equal(upload.with.path, '${{ steps.pages.outputs.pages-path }}');
  const deploy = job.steps.find(step => step.uses?.startsWith('actions/deploy-pages@'));
  assert.equal(deploy.id, 'deployment');
  assert.equal(job.environment.url, '${{ steps.deployment.outputs.page_url }}');
  for (const step of job.steps) {
    assert.ok(!/"command":"(sign|promote|push|prepare-promotion)"|docker\/login/.test(JSON.stringify(step)),
      'Pages-only systems need no OCI publication');
  }
});
