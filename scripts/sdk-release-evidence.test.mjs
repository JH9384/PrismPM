// Evidence preservation tests, not execution or acceptance of an SDK image.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {captureEvidence, packEvidence} from './sdk-release-evidence.mjs';
import {assetNames} from './release-phases.mjs';
import {bootstrapFixture} from './sdk-bootstrap-retention-fixture.mjs';
const require = createRequire('/opt/prismpm/oracles/package.json');
const {load} = require('js-yaml');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const context = {source_revision: 'a'.repeat(40), architecture: 'amd64',
  image_reference: 'ghcr.io/uor-foundation/prismpm-sdk@sha256:' + 'b'.repeat(64)};
const temporary = t => {const root = mkdtempSync(join(tmpdir(), 'prismpm-evidence-test-')); t.after(() => rmSync(root, {recursive: true, force: true})); return root;};
const put = (root, name, value) => writeFileSync(join(root, name), typeof value === 'string' ? value : canonical(value));
function vv(root) {
  const bootstrap = bootstrapFixture(context.source_revision);
  for (const [name, bytes] of [...bootstrap.retained, ['bootstrap.json', bootstrap.manifest]]) writeFileSync(join(root, name), bytes);
  mkdirSync(join(root, 'docker'));
  put(join(root, 'docker'), 'config.json', 'private transport data that must never ship');
  const raw = canonical({schema: 'prismpm/vv-evidence/1', commit: context.source_revision,
    gates: Array.from({length: 15}, (_, index) => index + 1), status: 'passed'});
  for (const run of [1, 2]) put(root, `run-${run}.json`, raw);
  const execution = canonical({schema: 'prismpm/sdk-vv-execution/1', scope: 'two-full-vv-executions-only',
    source_revision: context.source_revision, image_reference: context.image_reference, process_architecture: 'x64',
    inventory_sha256: 'c'.repeat(64), cli_sha256: 'd'.repeat(64), input_policy_sha256: 'e'.repeat(64),
    input_manifest_sha256: 'f'.repeat(64), advisory_revision: '1'.repeat(40),
    runs: [1, 2].map(run => ({run, path: `run-${run}/vv-evidence.json`, byte_length: raw.length, sha256: sha(raw)})),
    unclaimed: ['native-host', 'network-isolation', 'oci-image-identity', 'sdk-release', 'product-readiness']});
  put(root, 'execution.json', execution);
  put(root, 'acceptance.json', {schema: 'prismpm/sdk-installed-vv-check/1', status: 'passed', scope: 'isolated-installed-two-run-vv',
    ...context, execution_sha256: sha(execution), phases: ['exact-native-images-acquired', 'external-network-disconnected',
      'isolated-native-sdk-probed', 'both-full-vv-records-verified', 'owned-resources-removed'],
    unclaimed: ['hardware-attestation', 'sdk-release', 'product-readiness']});
  for (const name of ['image-plan.json', 'loaded-identities.json']) put(root, name, {fixture: 'transport-only'});
  put(root, '0001.stdout', 'unit transcript\n'); put(root, '0001.stderr', '');
  put(root, '0001.json', {arguments: ['info'], status: 0, signal: null,
    stdout_sha256: sha('unit transcript\n'), stderr_sha256: sha('')});
}
function product(root) {
  const names = ['source.json', 'image.json', 'inventory.json', 'standards.lock', 'prismpm.lock',
    'acquire.stdout.json', 'acquire.stderr.txt', 'acquisition.json', 'build.stdout.json', 'build.stderr.txt',
    'build.json', 'result.json', 'receiver.stderr.txt'];
  for (const name of names) put(root, name, {fixture: 'transport-only'});
  put(root, 'source.json', {revision: context.source_revision});
  for (const name of ['build.json', 'prismpm.lock']) put(root, name, {sdk_image: context.image_reference});
  put(root, 'image.json', [{Architecture: context.architecture, Os: 'linux', Config: {Labels: {'org.opencontainers.image.revision': context.source_revision}}}]);
  const files = ['app.css', 'app.js', 'index.html', 'prism_calculator.js', 'prism_calculator_bg.wasm', 'provenance.json']
    .map(path => ({path, size: 1, digest: 'sha256:' + 'c'.repeat(64)}));
  put(root, 'result.json', {schema: 'prismpm/installed-product-cli-check/1', scope: 'installed-cli-product-build-and-source-free-integrity',
    status: 'passed', sdk_image: context.image_reference, releases: ['A', 'B'].map((release, index) => ({release,
      release_digest: 'sha256:' + String(index).repeat(64), model_digest: 'sha256:' + 'd'.repeat(64),
      build_digest: 'sha256:' + 'e'.repeat(64), tree_digest: 'sha256:' + sha(canonical(files)), files,
      checks: ['source-free-proof-replay', 'exact-browser-export', 'missing-proof-refused', 'changed-proof-refused', 'restored-export']})),
    unclaimed: ['sdk-release', 'crates.io-publication', 'producer-authorization', 'deployment', 'foundry-readiness']});
}

function validateWorkflow(workflow) {
  const upload = workflow.jobs.reproducibility.steps.filter(step => step.with?.name === 'library-sdk-${{ matrix.name }}');
  assert.equal(upload.length, 1);
  assert.equal(upload[0].uses, 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
  assert.equal(upload[0].if, "always() && matrix.image == 'sdk'");
  assert.equal(upload[0]['continue-on-error'], undefined);
  assert.deepEqual(upload[0].with, {name: 'library-sdk-${{ matrix.name }}',
    path: '${{ matrix.name }}-library-sdk.log\nroot-a/target/library-sdk-evidence/\n',
    'if-no-files-found': 'error', 'retention-days': 30});
  assert(assetNames().includes('sdk-metadata-native-join.json'));
  const steps = workflow.jobs['oci-native'].steps;
  const pack = steps.find(step => step.run?.includes('scripts/sdk-release-evidence.mjs'));
  assert(pack && pack.if === undefined && pack['continue-on-error'] === undefined);
  const download = (name, path) => {
    const matching = steps.filter(step => step.with?.name === name);
    assert.equal(matching.length, 1, 'missing or duplicate gate download ' + name);
    const step = matching[0];
    assert.equal(step.uses, 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093');
    assert.deepEqual(step.with, {name, path});
    assert.equal(step.if, undefined); assert.equal(step['continue-on-error'], undefined);
    assert(steps.indexOf(step) < steps.indexOf(pack), 'evidence must arrive before capture');
  };
  for (const arch of ['amd64', 'arm64']) {
    for (const [artifact, suffix] of [['full-sdk-vv', 'full-sdk-vv'], ['product-cli', 'product-cli']]) {
      const name = `${artifact}-sdk-${arch}`;
      download(name, `.sdk-gate-evidence/${name}`);
      assert(assetNames().includes(`sdk-${arch}-${suffix}.tar`));
    }
    download(`browser-sdk-sdk-${arch}`, 'release');
    download(`library-sdk-sdk-${arch}`, `.sdk-gate-evidence/library-sdk-sdk-${arch}`);
    for (const kind of ['browser', 'library']) assert(assetNames().includes(`sdk-${arch}-${kind}-sdk.log`));
    assert(assetNames().includes(`sdk-${arch}-native-metadata.tar`));
  }
  assert.equal(pack.shell, 'bash');
  assert.equal(pack.run, [
    'set -euo pipefail', 'image=$(cat release/sdk-image.txt)',
    'node scripts/library-sdk-metadata-evidence.mjs join \\',
    '  .sdk-gate-evidence/library-sdk-sdk-amd64/root-a/target/library-sdk-evidence/linux-amd64 \\',
    '  .sdk-gate-evidence/library-sdk-sdk-arm64/root-a/target/library-sdk-evidence/linux-arm64 \\',
    '  . "$image" "$GITHUB_SHA" > release/sdk-metadata-native-join.json',
    'cp .sdk-gate-evidence/library-sdk-sdk-amd64/sdk-amd64-library-sdk.log release/',
    'cp .sdk-gate-evidence/library-sdk-sdk-arm64/sdk-arm64-library-sdk.log release/',
    'node scripts/sdk-release-evidence.mjs source-vv .sdk-gate-evidence/source-vv \\',
    '  release/source-vv.tar - "$GITHUB_SHA" amd64 "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"',
    'for architecture in amd64 arm64; do',
    '  node scripts/library-sdk-metadata-evidence.mjs pack \\',
    '    ".sdk-gate-evidence/library-sdk-sdk-$architecture/root-a/target/library-sdk-evidence/linux-$architecture" \\',
    '    "release/sdk-$architecture-native-metadata.tar" . "$image" "$GITHUB_SHA" "$architecture"',
    '  for kind in full-sdk-vv product-cli; do',
    '    node scripts/sdk-release-evidence.mjs "$kind" \\',
    '      ".sdk-gate-evidence/$kind-sdk-$architecture" "release/sdk-$architecture-$kind.tar" \\',
    '      "$image" "$GITHUB_SHA" "$architecture"', '  done',
    '  node scripts/sdk-release-evidence.mjs native-equivalence \\',
    '    ".sdk-gate-evidence/native-equivalence-sdk-$architecture" "release/sdk-$architecture-native-equivalence.tar" \\',
    '    "$image" "$GITHUB_SHA" "$architecture" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"',
    'done', '',
  ].join('\n'));
  download('source-vv', '.sdk-gate-evidence/source-vv');
  for (const arch of ['amd64', 'arm64']) download(`sdk-equivalence-${arch}`, `.sdk-gate-evidence/native-equivalence-sdk-${arch}`);
  assert(steps.indexOf(pack) < steps.findIndex(step => step.run?.includes('checksums=$(mktemp)')));
  assert.deepEqual(workflow.jobs['oci-native'].needs, ['gate', 'images', 'native', 'reproducibility', 'installed-sdk']);
  assert(workflow.jobs.release.needs.includes('crates'));
}

test('OCI publication retains both native gate closures without granting SDK acceptance', () => {
  const workflow = load(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  validateWorkflow(workflow);
  const steps = value => value.jobs['oci-native'].steps;
  const pack = value => steps(value).find(step => step.run?.includes('scripts/sdk-release-evidence.mjs'));
  const gate = value => steps(value).find(step => step.with?.name === 'full-sdk-vv-sdk-arm64');
  for (const mutate of [
    value => steps(value).splice(steps(value).indexOf(gate(value)), 1),
    value => steps(value).push(structuredClone(gate(value))),
    value => {gate(value).with.path = 'release';},
    value => {gate(value).uses = 'actions/download-artifact@main';},
    value => {gate(value).if = 'always()';},
    value => {gate(value)['continue-on-error'] = true;},
    value => {const record = gate(value); steps(value).splice(steps(value).indexOf(record), 1); steps(value).push(record);},
    value => {pack(value).if = 'false';},
    value => {pack(value)['continue-on-error'] = true;},
    value => {pack(value).run = pack(value).run.replace('set -euo pipefail', 'set -uo pipefail');},
    value => {pack(value).run = pack(value).run.replace('amd64 arm64', 'amd64');},
    value => {pack(value).run = pack(value).run.replace('library-sdk-metadata-evidence.mjs join', 'library-sdk-metadata-evidence.mjs omitted');},
    value => {pack(value).run = pack(value).run.replace('library-sdk-metadata-evidence.mjs pack', 'library-sdk-metadata-evidence.mjs omitted');},
    value => {value.jobs.reproducibility.steps.find(step => step.with?.name === 'library-sdk-${{ matrix.name }}').with.path = '${{ matrix.name }}-library-sdk.log';},
    value => {value.jobs.reproducibility.steps.find(step => step.with?.name === 'library-sdk-${{ matrix.name }}').with.path = 'root-a/target/library-sdk-evidence/';},
    value => {value.jobs.reproducibility.steps.find(step => step.with?.name === 'library-sdk-${{ matrix.name }}').with['if-no-files-found'] = 'ignore';},
    value => {pack(value).run = pack(value).run.replace('"$GITHUB_SHA"', '"stale"');},
    value => {pack(value).run = pack(value).run.replace('"$architecture"', '"$architecture" || true');},
    value => {const record = pack(value); steps(value).splice(steps(value).indexOf(record), 1); steps(value).push(record);},
    value => {value.jobs['oci-native'].needs.pop();},
    value => {value.jobs.release.needs = value.jobs.release.needs.filter(name => name !== 'crates');},
  ]) {
    const changed = structuredClone(workflow); mutate(changed); assert.throws(() => validateWorkflow(changed));
  }
});

test('real deterministic USTAR archives retain every original byte and explicitly exclude private transport configuration', t => {
  for (const [kind, fixture] of [['full-sdk-vv', vv], ['product-cli', product]]) {
    const source = temporary(t), output = temporary(t); fixture(source);
    const captured = captureEvidence(source, kind, context);
    const first = join(output, 'one.tar'), second = join(output, 'two.tar');
    packEvidence(source, kind, first, context); packEvidence(source, kind, second, context);
    assert.deepEqual(readFileSync(first), readFileSync(second));
    assert.throws(() => packEvidence(source, kind, first, context), /fresh archive/);
    const extracted = join(output, 'extracted'); mkdirSync(extracted);
    execFileSync('tar', ['-xf', first, '-C', extracted]);
    assert.deepEqual(readdirSync(extracted).sort(), [...captured.files.keys(), 'evidence-manifest.json'].sort());
    for (const [name, bytes] of captured.files) assert.deepEqual(readFileSync(join(extracted, name)), bytes);
    assert.deepEqual(JSON.parse(readFileSync(join(extracted, 'evidence-manifest.json'))), captured.manifest);
    assert.equal(captured.manifest.scope, 'original-gate-evidence-only');
    assert(captured.manifest.unclaimed.includes('sdk-acceptance'));
    assert(!readFileSync(first).includes(Buffer.from('private transport data')));
  }
});

test('the exact 9999-command file closure includes its excluded private directory and rejects one extra entry', {timeout: 60000}, t => {
  const source = temporary(t); vv(source);
  const empty = sha('');
  for (let index = 2; index <= 9999; index++) {
    const number = String(index).padStart(4, '0');
    put(source, number + '.stdout', ''); put(source, number + '.stderr', '');
    put(source, number + '.json', {arguments: ['info'], status: 0, signal: null,
      stdout_sha256: empty, stderr_sha256: empty});
  }
  assert.equal(readdirSync(source).length, 30013);
  const captured = captureEvidence(source, 'full-sdk-vv', context);
  assert.equal(captured.files.size, 30012);
  assert.equal(captured.manifest.files.length, 30012);
  assert.deepEqual(captured.manifest.excluded, ['docker/']);
  assert(!captured.files.has('docker'));
  assert.equal(readFileSync(join(source, 'docker', 'config.json'), 'utf8'), 'private transport data that must never ship');
  put(source, '10000.json', '{}');
  assert.equal(readdirSync(source).length, 30014);
  assert.throws(() => captureEvidence(source, 'full-sdk-vv', context), /evidence file-count limit/);
});

test('missing, extra, stale and changed original evidence fails before archive creation', t => {
  for (const change of [
    root => rmSync(join(root, 'run-2.json')),
    root => rmSync(join(root, 'run-2-bootstrap-evidence.json')),
    root => put(root, 'run-1-bootstrap-current-capture.json', '{}'),
    root => put(root, 'extra.json', {}),
    root => put(root, '0001.stdout', 'changed'),
    root => put(root, 'run-1.json', {status: 'passed'}),
    root => {const value = JSON.parse(readFileSync(join(root, 'acceptance.json'))); value.source_revision = '2'.repeat(40); put(root, 'acceptance.json', value);},
    root => {const value = JSON.parse(readFileSync(join(root, 'acceptance.json'))); value.phases.pop(); put(root, 'acceptance.json', value);},
    root => {const value = JSON.parse(readFileSync(join(root, 'execution.json'))); value.runs[1] = value.runs[0]; put(root, 'execution.json', value);},
  ]) {
    const source = temporary(t), output = temporary(t); vv(source); change(source);
    assert.throws(() => packEvidence(source, 'full-sdk-vv', join(output, 'bad.tar'), context));
    assert.deepEqual(readdirSync(output), []);
  }
  const source = temporary(t); product(source);
  for (const change of [{architecture: 'arm64'}, {image_reference: context.image_reference.replace(/b/g, 'c')}, {source_revision: '2'.repeat(40)}, {extra: true}]) {
    assert.throws(() => captureEvidence(source, 'product-cli', {...context, ...change}));
  }
});

test('aliases, nonregular files, private-directory aliases and oversized evidence reject', t => {
  for (const change of [
    root => {rmSync(join(root, '0001.stdout')); symlinkSync('0001.stderr', join(root, '0001.stdout'));},
    root => {rmSync(join(root, '0001.stdout')); linkSync(join(root, '0001.stderr'), join(root, '0001.stdout'));},
    root => {rmSync(join(root, '0001.stdout')); mkdirSync(join(root, '0001.stdout'));},
    root => truncateSync(join(root, '0001.stdout'), 268435457),
    root => truncateSync(join(root, '0001.stderr'), 67108865),
    root => {rmSync(join(root, 'docker'), {recursive: true}); symlinkSync('.', join(root, 'docker'));},
  ]) {const source = temporary(t); vv(source); change(source); assert.throws(() => captureEvidence(source, 'full-sdk-vv', context));}
  const source = temporary(t); vv(source); const parent = temporary(t), alias = join(parent, 'alias'); symlinkSync(source, alias);
  assert.throws(() => captureEvidence(alias, 'full-sdk-vv', context));
});

test('actual maximum file archive and one-GiB captured closure retain exact bytes without clamping', {timeout: 120000}, t => {
  const maximum = 268435456, zero = Buffer.alloc(maximum), fullHash = sha(zero);
  const row = digest => ({arguments: ['info'], status: 0, signal: null, stdout_sha256: digest, stderr_sha256: sha('')});
  const source = temporary(t); vv(source);
  truncateSync(join(source, '0001.stdout'), 0); truncateSync(join(source, '0001.stdout'), maximum);
  put(source, '0001.json', row(fullHash));
  const output = join(temporary(t), 'maximum.tar');
  const manifest = packEvidence(source, 'full-sdk-vv', output, context);
  assert.equal(manifest.files.find(file => file.path === '0001.stdout').size, maximum);
  const restored = execFileSync('tar', ['-xOf', output, '0001.stdout'], {maxBuffer: maximum + 1024, timeout: 30000});
  assert.equal(restored.length, maximum); assert.equal(sha(restored), fullHash);

  // Sparse original stdout files exercise the complete allocation/read/hash
  // boundary without reserving one GiB of persistent development disk space.
  const aggregate = temporary(t); vv(aggregate);
  for (let index = 1; index <= 4; index++) {
    const number = String(index).padStart(4, '0');
    put(aggregate, number + '.stdout', ''); truncateSync(join(aggregate, number + '.stdout'), maximum);
    put(aggregate, number + '.stderr', ''); put(aggregate, number + '.json', row(fullHash));
  }
  const size = () => readdirSync(aggregate).filter(name => name !== 'docker')
    .reduce((sum, name) => sum + lstatSync(join(aggregate, name)).size, 0);
  const total = 1024 ** 3, lastSize = maximum - (size() - total);
  assert(lastSize > 0 && lastSize < maximum);
  truncateSync(join(aggregate, '0004.stdout'), lastSize);
  put(aggregate, '0004.json', row(sha(zero.subarray(0, lastSize))));
  assert.equal(size(), total);
  const captured = captureEvidence(aggregate, 'full-sdk-vv', context);
  assert.equal(captured.manifest.files.reduce((sum, file) => sum + file.size, 0), total);
  captured.files.clear();
  truncateSync(join(aggregate, '0004.stdout'), lastSize + 1);
  assert.equal(size(), total + 1);
  assert.throws(() => captureEvidence(aggregate, 'full-sdk-vv', context), /bounded unaliased evidence file/);
});

test('removing the real transcript digest guard is detected by the behavioral owning assertion', async t => {
  const source = temporary(t); vv(source); put(source, '0001.stdout', 'substituted bytes');
  const check = capture => assert.throws(() => capture(source, 'full-sdk-vv', context));
  check(captureEvidence);
  const original = readFileSync(new URL('./sdk-release-evidence.mjs', import.meta.url), 'utf8');
  const guard = "for (const stream of ['stdout', 'stderr']) assert.equal(hash(files.get(number + '.' + stream)), row[stream + '_sha256']);";
  assert.equal(original.split(guard).length, 2);
  const changed = original.replace(guard, '/* planted transcript check omission */')
    .replaceAll("from './sdk-vv-check.mjs'", `from '${new URL('./sdk-vv-check.mjs', import.meta.url)}'`)
    .replaceAll("from './product-sdk-check.mjs'", `from '${new URL('./product-sdk-check.mjs', import.meta.url)}'`)
    .replaceAll("from './sdk-bootstrap-retention.mjs'", `from '${new URL('./sdk-bootstrap-retention.mjs', import.meta.url)}'`)
    .replaceAll("from './release-gate-evidence.mjs'", `from '${new URL('./release-gate-evidence.mjs', import.meta.url)}'`);
  const path = join(temporary(t), 'mutant.mjs'); writeFileSync(path, changed);
  const mutant = await import(pathToFileURL(path));
  assert.throws(() => check(mutant.captureEvidence), /Missing expected exception/);
});
