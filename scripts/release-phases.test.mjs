import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync,
  symlinkSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parts as vvParts } from './vv-assemble.mjs';
import {sessionFixture} from './vv-sdk-session-fixture.mjs';
import { imageVerificationArguments, platformIndex, publicationPolicy, workspaceVersion, releaseSbomRecord, requirePrerequisites, verifyReproducibility, verifyExistingRelease } from './release-phases.mjs';

const require = createRequire('/opt/prismpm/oracles/package.json');
const { load } = require('js-yaml');
const source = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const workflow = () => load(source);

test('canonical Cargo Git caches retain every object and real locked offline submodule builds', () => {
  execFileSync('python3', ['-I', '-B', new URL('./normalize-cargo-git_test.py', import.meta.url).pathname],
    {timeout: 120000});
});

test('Cargo sparse-index caches keep exactly the held crates under one fixed index version', () => {
  execFileSync('python3', ['-I', '-B', new URL('./normalize-cargo-index_test.py', import.meta.url).pathname],
    {timeout: 120000});
  const dockerfile = readFileSync(new URL('../sdk/Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /scripts\/normalize-cargo-git\.py \/usr\/local\/cargo \\\n    && \/usr\/bin\/python3 -I -B scripts\/normalize-cargo-index\.py \/usr\/local\/cargo \\\n    && mkdir -p \/opt\/prismpm\/cargo-home/);
});

test('OCI mismatch diagnostics execute bounded real archive fixtures and remain failure-only', () => {
  execFileSync('python3', ['-B', new URL('./oci-repro-diagnostics_test.py', import.meta.url).pathname]);
  const steps = workflow().jobs.reproducibility.steps;
  const compare = steps.find(step => step.env?.IMAGE);
  // One independent rebuild against the shipped build; no third build on success.
  assert.match(compare.run, /\nbash root-a\/scripts\/release-rebuild\.sh root-b\n/);
  assert(!compare.run.includes('release-rebuild.sh root-a'));
  assert.match(compare.run, /"\$GITHUB_SHA" \\\n +root-b\.oci > /);
  const diagnostic = steps.find(step => step.run?.includes('oci-repro-diagnostics.py'));
  assert.equal(diagnostic.if, 'failure()');
  // Diagnosis compares the rebuild with the shipped manifest copied by digest;
  // a failure never pays for another build.
  assert(!diagnostic.run.includes('release-rebuild.sh'));
  assert.match(diagnostic.run, /\n"\$tools\/oras" copy --to-oci-layout "\$\{identity%@\*\}@\$platform" shipped\.oci:shipped\n/);
  assert.match(diagnostic.run, /oci-repro-diagnostics\.py shipped\.oci root-b\.oci > /);
  assert(steps.indexOf(diagnostic) > steps.indexOf(compare));
  const retained = steps.find(step => step.with?.name === 'reproducibility-diagnostics-${{ matrix.name }}');
  assert.equal(retained.if, 'failure()');
  assert.equal(retained.with.path, 'reproducibility-diagnostics.*');
});

const revision = 'a'.repeat(40);
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const policy = () => ({repository: 'UOR-Foundation/prismpm', ref: 'refs/tags/v0.5.0',
  event: 'workflow_dispatch', version: '0.5.0', publishCrates: false, rehearsal: false, revision});
const rehearsal = () => ({...policy(), ref: 'refs/heads/main', rehearsal: true});
const buildStages = ['images', 'native', 'reproducibility', 'installed-sdk'];
const prerequisites = (names, route = 'establish') => Object.fromEntries(names.map(name => [name,
  name === 'factory' ? {result: 'success', outputs: {'build-route': route}}
    : {result: route === 'proved' && buildStages.includes(name) ? 'skipped' : 'success'}]));
const ociNeeds = ['gate', 'factory', ...buildStages];
const buildkit = 'moby/buildkit@sha256:de10faf919fc71ba4eb1dd7bd6449566d012b0c9436b1c61bfee21d621b009aa';
const workspace = workspaceVersion();
const workspaceMinor = workspace.split('.').slice(0, 2).join('.');
const environment = () => ({GITHUB_REPOSITORY: 'UOR-Foundation/prismpm', GITHUB_REF: `refs/tags/v${workspace}`,
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: revision, DISPATCH_VERSION: workspace, PUBLISH_CRATES: 'false', REHEARSAL: 'false',
  GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123456789', GITHUB_RUN_ATTEMPT: '1'});

function validateWorkflow(value) {
  assert.deepEqual(value.on.push, {branches: ['release/v*'], tags: ['v*']});
  assert.deepEqual(value.jobs['oci-native'].needs, ociNeeds);
  // Publication runs on its build stages' success, or on their skip when the
  // factory routed the build to a receipt; nothing else (scripts/factory.mjs).
  const stageResults = result => buildStages.map(name => `needs.${name}.result == '${result}'`).join(' && ');
  assert.equal(value.jobs['oci-native'].if.replaceAll(/\s+/g, ' '), "${{ !cancelled() && needs.gate.result == 'success' && needs.factory.result == 'success'"
    + ` && ((needs.factory.outputs.build-route == 'establish' && ${stageResults('success')})`
    + ` || (needs.factory.outputs.build-route == 'proved' && ${stageResults('skipped')})) }}`);
  assert.deepEqual(value.jobs.release.needs, [...ociNeeds, 'oci-native', 'crates']);
  assert.equal(value.jobs.release.if.replaceAll(/\s+/g, ' '), "${{ !cancelled() && needs.oci-native.result == 'success' && needs.crates.result == 'success' && needs.gate.outputs.rehearsal != 'true' }}");
  assert.equal(value.jobs.crates.if.replaceAll(/\s+/g, ' '), "${{ !cancelled() && needs.oci-native.result == 'success' && needs.gate.outputs.publish-crates == 'true' && needs.gate.outputs.rehearsal != 'true' }}");
  assert.deepEqual(value.on.workflow_dispatch.inputs.rehearsal, {description: 'Run every check but publish no release assets, discovery tags or crates. Images are still pushed by digest and signed.',
    required: true, default: true, type: 'boolean'});
  for (const name of ['oci-native']) {
    const publishing = value.jobs[name].steps.filter(step => step.run?.includes('publish-oci') || step.uses?.startsWith('actions/attest-build-provenance'));
    assert.equal(publishing.length, 2);
    for (const step of publishing) assert.equal(step.if, "${{ needs.gate.outputs.rehearsal != 'true' }}");
  }
  assert.deepEqual(value.jobs.crates.needs, [...ociNeeds, 'oci-native']);
  const cargoPublication = value.jobs.crates.steps.find(step => step.run?.includes('publish_exact()'))?.run;
  assert.ok(cargoPublication, 'Cargo publication must select and verify the exact archive');
  let previous = -1;
  for (const checkpoint of [
    'package_target=${archive%/package/*}',
    'test "$archive" = "$package_target/package/$package-$version.crate"',
    'release_cargo "$package" package --locked --manifest-path "$manifest" --target-dir "$package_target"',
    'test -f "$archive"',
    'cmp "$archive" "$expected"',
    'local_checksum=$(sha256sum "$archive" | cut -d" " -f1)',
    'release_cargo "$package" publish --dry-run --locked --manifest-path "$manifest" --target-dir "$package_target"',
    'test "$(sha256sum "$archive" | cut -d" " -f1)" = "$local_checksum"',
    './scripts/crate-metadata-check.sh "$archive"',
    'if [ "$UPLOAD" != true ]; then',
    'cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"',
  ]) {
    const offset = cargoPublication.indexOf(checkpoint);
    assert.ok(offset > previous, `Cargo publication omits or misorders ${checkpoint}`);
    assert.equal(cargoPublication.lastIndexOf(checkpoint), offset, `Cargo publication repeats ${checkpoint}`);
    previous = offset;
  }
  assert.deepEqual(cargoPublication.split('\n').map(line => line.trim())
    .filter(line => /^(release_cargo "\$package" |cargo )(package|publish)/.test(line)), [
    'release_cargo "$package" package --locked --manifest-path "$manifest" --target-dir "$package_target"',
    'release_cargo "$package" publish --dry-run --locked --manifest-path "$manifest" --target-dir "$package_target"',
    'cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"',
  ], 'Cargo must retain complete verification for every selected-target operation, and only the last one uploads');
  // The upload happens only with a credential: the skip returns before it, the
  // wait for lexlean is conditional on it, and no step hands Cargo a token
  // without the secret or the trusted-publishing switch (#214).
  assert.ok(cargoPublication.indexOf('return 0', cargoPublication.indexOf('if [ "$UPLOAD" != true ]; then'))
    < cargoPublication.indexOf('cargo publish --locked --manifest-path'), 'the skip must return before the upload');
  assert.match(cargoPublication, /if \[ "\$UPLOAD" = true \]; then\n\s+wait_for_crate lexlean 0\.4\.0\n\s+fi/);
  assert.match(cargoPublication, /release_cargo\(\) \{\n\s+name=\$1\n\s+shift\n\s+if \[ "\$UPLOAD" = true \]; then\n\s+cargo "\$@"\n\s+elif \[ "\$name" = prod-codegen \]/);
  for (const dependency of ['lexlean', 'prod-ir', 'prod-codegen', 'prism-stdlib']) {
    assert.ok(cargoPublication.includes(`--config "patch.crates-io.${dependency}.path=`), `${dependency} must resolve from the reviewed copy before upload`);
  }
  assert.equal(value.jobs.crates.env.HAS_CARGO_REGISTRY_TOKEN, "${{ secrets.CARGO_REGISTRY_TOKEN != '' }}");
  assert.equal(value.jobs.crates.env.TRUSTED_PUBLISHING, "${{ vars.CRATES_IO_TRUSTED_PUBLISHING == 'true' }}");
  const authentication = value.jobs.crates.steps.find(step => step.uses?.startsWith('rust-lang/crates-io-auth-action'));
  assert.equal(authentication.if, "${{ env.HAS_CARGO_REGISTRY_TOKEN != 'true' && env.TRUSTED_PUBLISHING == 'true' }}");
  const publicationStep = value.jobs.crates.steps.find(step => step.run?.includes('publish_exact()'));
  assert.equal(publicationStep.env.CARGO_REGISTRY_TOKEN, '${{ secrets.CARGO_REGISTRY_TOKEN || steps.auth.outputs.token }}');
  assert.equal(publicationStep.env.UPLOAD, "${{ env.HAS_CARGO_REGISTRY_TOKEN == 'true' || env.TRUSTED_PUBLISHING == 'true' }}");
  assert.match(publicationStep.run, /--env UPLOAD \\\n/);
  // The job script is one single-quoted `bash -c` argument: an apostrophe in a
  // comment or a message inside it ends the quote and breaks the whole job.
  execFileSync('bash', ['-n'], {input: publicationStep.run, stdio: ['pipe', 'pipe', 'pipe']});
  assert.equal(value.jobs.policy.outputs['publish-crates'], '${{ steps.version.outputs.publish-crates }}');
  assert.equal(value.jobs.policy.outputs.rehearsal, '${{ steps.version.outputs.rehearsal }}');
  assert.equal(value.jobs.gate.outputs['publish-crates'], '${{ needs.policy.outputs.publish-crates }}');
  assert.equal(value.jobs.gate.outputs.rehearsal, '${{ needs.policy.outputs.rehearsal }}');
  assert.match(value.jobs.policy.steps.find(step => step.id === 'version').run, /release-phases\.mjs policy/);
  assert(value.jobs.policy.steps.some(step => step.run === 'node --test scripts/release-native-contract.test.mjs'));
  assert.deepEqual(value.jobs['source-vv'].needs, ['policy', 'factory', 'devcontainer-image', 'vv-sdk'],
    'cheap release contracts, the factory route, the one construction-cache writer and the one V&V SDK image precede source verification');
  assert.equal(value.jobs['source-vv'].if, "${{ !cancelled() && needs.factory.outputs.route == 'establish' && needs.devcontainer-image.result == 'success' "
    + "&& (needs.vv-sdk.result == 'success' || (needs.factory.outputs.vv-sdk == 'proved' && needs.vv-sdk.result == 'skipped')) }}",
    'source V&V runs exactly when no receipt exists for its identity, on a V&V SDK image this run built or a receipt proved');
  const factory = value.jobs.factory;
  assert.equal(factory.needs, 'policy');
  assert.deepEqual(factory.permissions, {contents: 'read'});
  assert.equal(factory.steps.find(step => step.uses?.startsWith('actions/checkout')).with['fetch-depth'], 0, 'identities of ancestors need history');
  assert.equal(factory.steps.find(step => step.id === 'route').run, 'bash prism-factory/factory.sh actions-route', 'the certified factory core decides every route');
  const image = value.jobs['devcontainer-image'];
  assert.deepEqual(image.needs, ['policy', 'factory']);
  assert(!('strategy' in image) && !('if' in image), 'exactly one unconditional construction-cache writer');
  const imageBuild = image.steps.at(-1);
  assert.equal(imageBuild.uses, 'devcontainers/ci@513af61f4de4f75d37e4438f184ba4358f0fc1ca');
  assert.equal(imageBuild.with.push, 'never');
  assert.match(imageBuild.with.runCmd, /\nPATH="\$PWD\/target\/release-tools:\$PATH" node scripts\/factory\.mjs checks\n/, 'the plumbing κ leaves out is checked on every run');
  // The SBOM transport tests execute the pinned ORAS and cosign; the devcontainer has neither.
  const tools = image.steps.find(step => step.name === 'Install the pinned transport and verifier tools');
  assert(tools && image.steps.indexOf(tools) < image.steps.indexOf(imageBuild));
  assert.equal(tools.if, undefined); assert.equal(tools['continue-on-error'], undefined);
  assert.match(tools.run, /tools="\$GITHUB_WORKSPACE\/target\/release-tools"/);
  assert.match(tools.run, /for tool in oras cosign; do/);
  assert.match(tools.run, /bash scripts\/sdk-candidate\.sh "install-\$tool" "\$tools" && break/);
  assert.match(imageBuild.with.runCmd, /--project factory\/lexlean\.toml verify\n/, 'the factory model is verified on every run');
  assert.equal(imageBuild.with.cacheFrom, '${{ steps.cache.outputs.cache-from }}');
  assert.equal(imageBuild.with.cacheTo, '${{ steps.cache.outputs.cache-to }}');
  const sourceSteps = value.jobs['source-vv'].steps;
  for (const job of [image, value.jobs['source-vv']]) {
    const cleanup = job.steps.findIndex(step => step.uses === './.github/actions/prepare-devcontainer-runner');
    const cache = job.steps.findIndex(step => step.uses === './.github/actions/devcontainer-cache');
    assert(cleanup > 0 && cleanup < cache, 'prepare disk before importing construction layers');
  }
  assert(sourceSteps.some(step => step.id === 'cache' && step.uses === './.github/actions/devcontainer-cache'));
  const sourceBuild = sourceSteps.find(step => step.with?.runCmd).with;
  assert.equal(sourceBuild.cacheFrom, '${{ steps.cache.outputs.cache-from }}');
  assert.equal(sourceBuild.cacheTo, undefined, 'source shards consume the construction cache without concurrent writers');
  const sourceGate = value.jobs['source-vv'].steps.find(step => step.with?.runCmd)?.with.runCmd;
  assert.equal(sourceGate, "set -euo pipefail\nexport PRISMPM_TEST_SDK_IMAGE='${{ steps.sdk.outputs.image }}'\nbash scripts/vv.sh --with-sdk bash -euo pipefail -c \"$(cat <<'PRISMPM_VV'\n"
    + "node scripts/release-gate-evidence.mjs source-run . target/source-vv-evidence '${{ github.sha }}' amd64 - '${{ github.run_id }}' '${{ github.run_attempt }}' '${{ matrix.part }}'\n" + 'PRISMPM_VV\n)"\n');
  assert.deepEqual(value.jobs['source-vv'].strategy.matrix.include.map(row => row.part).sort(), [...vvParts].sort());
  assert.equal(value.jobs['source-vv'].strategy.matrix.include.length, vvParts.length);
  const sourceUpload = value.jobs.gate.steps.find(step => step.uses?.startsWith('actions/upload-artifact') && step.with?.name === 'source-vv');
  assert.equal(sourceUpload.if, undefined); assert.equal(sourceUpload.with.path, 'target/source-vv-evidence/');
  assert.equal(sourceUpload.with['if-no-files-found'], 'error');
  // The gate accepts exactly one route and records it.
  const gate = value.jobs.gate;
  assert.deepEqual(gate.needs, ['policy', 'factory', 'devcontainer-image', 'source-vv']);
  for (const clause of ["needs.devcontainer-image.result == 'success'",
    "(needs.factory.outputs.route == 'establish' && needs.source-vv.result == 'success')",
    "(needs.factory.outputs.route == 'proved' && needs.source-vv.result == 'skipped')"])
    assert(gate.if.includes(clause), `gate requires ${clause}`);
  assert.equal(gate.steps.find(step => step.run?.includes('source-assemble')).if, "${{ needs.factory.outputs.route == 'establish' }}");
  const receipt = gate.steps.find(step => step.run?.includes('source-receipt'));
  assert.equal(receipt.if, "${{ needs.factory.outputs.route == 'proved' }}");
  const receiptDownload = gate.steps.find(step => step.with?.['run-id']);
  assert.equal(receiptDownload.with.name, 'source-vv'); assert.equal(receiptDownload.with['run-id'], '${{ needs.factory.outputs.run-id }}');
  assert.match(gate.steps.find(step => step.id === 'source').run, /bash prism-factory\/factory\.sh route-record factory-route\/factory-route\.json/);
  assert(gate.steps.some(step => step.with?.name === 'factory-route' && step.with['if-no-files-found'] === 'error'));
  // Image stages establish projection obligations only and start beside source V&V.
  // They run exactly when the factory routes the build to be established;
  // a build receipt proves them instead (scripts/factory.mjs).
  const established = "${{ needs.factory.outputs.build-route == 'establish' }}";
  assert.deepEqual(value.jobs.reproducibility.needs, ['policy', 'factory', 'images']);
  for (const job of ['image-platforms', 'images', 'reproducibility', 'native', 'installed-sdk']) assert.equal(value.jobs[job].if, established, job);
  assert.equal(value.jobs['installed-vv'], undefined, 'installed V&V would verify the source a second time, on a projection');
  const installed = value.jobs['installed-sdk'];
  assert.deepEqual(installed.needs, ['policy', 'factory', 'images']); assert.deepEqual(value.jobs.native.needs, ['policy', 'factory', 'images']); assert.equal(installed['continue-on-error'], undefined); assert.equal(installed['runs-on'], '${{ matrix.os }}');
  assert.deepEqual(installed.strategy.matrix.include, [{os:'ubuntu-24.04',arch:'amd64'}, {os:'ubuntu-24.04-arm',arch:'arm64'}]);
  const product = installed.steps.find(step => step.run?.includes('product-sdk-check.sh'));
  assert(product); assert.equal(product.if, undefined); assert.equal(product['continue-on-error'], undefined);
  const platformJob = value.jobs['image-platforms'];
  assert.deepEqual(platformJob.needs, ['policy', 'factory']);
  assert.equal(platformJob['runs-on'], '${{ matrix.os }}');
  assert.deepEqual(platformJob.strategy.matrix.include, [{os: 'ubuntu-24.04', arch: 'amd64'}, {os: 'ubuntu-24.04-arm', arch: 'arm64'}]);
  assert.deepEqual(value.jobs.images.needs, ['policy', 'factory', 'image-platforms']);
  for (const job of Object.values(value.jobs))
    assert.ok(!job.steps.some(step => step.uses?.startsWith('docker/setup-qemu-action')), 'every platform is built natively');
  const builds = platformJob.steps.find(step => step.id === 'build');
  assert.equal(builds.uses, undefined);
  assert.equal(builds.with, undefined);
  assert.match(builds.run, /--output "type=registry,name=\$repository,push-by-digest=true,name-canonical=true,rewrite-timestamp=true,oci-mediatypes=true"/);
  assert.ok(!builds.run.includes('--tag'), 'unaccepted publication must not move discovery aliases');
  assert.match(builds.run, /build=\(node scripts\/sdk-image-inputs\.mjs build \. "\$GITHUB_SHA" "\$target"\)/);
  assert.match(builds.run, /--platform "linux\/\$ARCH"/);
  assert.match(builds.run, /--provenance=false --sbom=false --build-arg SOURCE_DATE_EPOCH=0/);
  assert.match(builds.run, /node scripts\/sdk-image-inputs\.mjs digest "\$RUNNER_TEMP\/\$name-build\.json" > "\$RUNNER_TEMP\/image-platforms\/\$name-\$ARCH\.digest"/);
  const table = builds.run.slice(builds.run.indexOf("<<'IMAGES'\n") + 10, builds.run.indexOf('IMAGES\n', builds.run.indexOf("<<'IMAGES'\n") + 10))
    .trim().split('\n').map(line => line.split(' '));
  assert.deepEqual(table, value.jobs.images.strategy.matrix.include.map(image =>
    [image.name, image.dockerfile, image.target || '-', image.repository]), 'every image is built on both platforms');
  const assembly = value.jobs.images.steps.find(step => step.id === 'build');
  assert.match(assembly.run, /node scripts\/release-phases\.mjs image-index "\$\{platforms\[@\]\}"/);
  assert.match(assembly.run, /oras manifest push --media-type application\/vnd\.oci\.image\.index\.v1\+json \\\n +"\$REPOSITORY@\$digest"/);
  assert.ok(!assembly.run.includes('--tag') && !assembly.run.includes(':latest'), 'the index is pushed by digest only');
  const rebuildStep = value.jobs.reproducibility.steps.find(step => step.env?.IMAGE);
  // The rebuild itself is the release plumbing script both reproducibility steps run.
  const rebuild = {run: rebuildStep.run + readFileSync(new URL('./release-rebuild.sh', import.meta.url), 'utf8')};
  for (const key of ['created', 'revision', 'source', 'version']) {
    assert.ok(builds.run.includes(`--label "org.opencontainers.image.${key}=`)
      || builds.run.includes(`--label org.opencontainers.image.${key}=`), `build omits ${key}`);
    assert.ok(rebuild.run.includes(`--label "org.opencontainers.image.${key}=`), `rebuild omits ${key}`);
  }
  assert.match(rebuild.run, /--label "org\.opencontainers\.image\.revision=\$GITHUB_SHA"/);
  assert.match(rebuild.run, /--label "org\.opencontainers\.image\.source=https:\/\/github\.com\/\$GITHUB_REPOSITORY"/);
  assert.match(rebuild.run, /--label "org\.opencontainers\.image\.version=\$VERSION"/);
  assert.match(rebuild.run, /--label "org\.opencontainers\.image\.created=1970-01-01T00:00:00Z"/);
  assert.match(rebuild.run, /release-phases\.mjs reproducibility/);
  assert.match(rebuild.run, /type=oci,dest=\$root\.oci\.tar,rewrite-timestamp=true,oci-mediatypes=true/);
  for (const row of value.jobs.reproducibility.strategy.matrix.include) {
    assert.ok(value.jobs.images.strategy.matrix.include.some(image => image.name === row.image
      && image.dockerfile === row.dockerfile && image.target === row.target));
  }
  const publication = value.jobs['oci-native'].steps;
  assert.ok(publication.some(step => step.run?.includes('release-phases.mjs prerequisites oci-native')));
  assert.ok(publication.some(step => step.run === 'node scripts/release-publication.mjs publish-oci release'));
  assert.ok(!publication.some(step => step.run?.includes('imagetools create')));
  assert.ok(!publication.some(step => step.uses?.startsWith('softprops/action-gh-release')),
    'default overwrite-enabled release upload must not replace source-addressed bytes');
  for (const name of ['image-platforms', 'images', 'oci-native', 'crates', 'release']) {
    const steps = value.jobs[name].steps;
    const policyStep = steps.findIndex(step => step.run?.includes('release-phases.mjs policy'));
    assert.ok(policyStep >= 0, `${name} must check its own publication policy`);
    assert.equal(steps[policyStep].env.PUBLISH_CRATES, '${{ toJSON(inputs.publish-crates) }}');
    const firstCredential = steps.findIndex(step => step.uses?.startsWith('docker/login-action')
      || step.uses?.startsWith('rust-lang/crates-io-auth-action') || step.env?.GH_TOKEN);
    assert.ok(firstCredential < 0 || policyStep < firstCredential);
  }
  for (const name of ['image-platforms', 'images', 'native', 'reproducibility', 'installed-sdk', 'release']) {
    const builder = value.jobs[name].steps.find(step => step.uses?.startsWith('docker/setup-buildx-action'));
    assert.equal(builder.with.version, 'v0.28.0');
    assert.equal(builder.with['driver-opts'], `image=${buildkit}`);
  }
  assert.ok(!value.jobs.images.steps.some(step => step.uses?.startsWith('actions/attest-sbom')),
    'complete SPDX must not enter the inline predicate size limit');
  for (const architecture of ['amd64', 'arm64']) {
    const step = value.jobs.images.steps.find(step => step.id === `sbom-${architecture}`);
    assert.equal(step.with['syft-version'], 'v1.51.1');
    assert.equal(step.with['upload-artifact'], false);
  }
  const transport = value.jobs.images.steps.find(step => step.run?.includes('release-phases.mjs sbom-publish'));
  assert.ok(transport, 'both platform SBOMs must be signed and re-fetched');
  assert.match(transport.run, /for architecture in amd64 arm64/);
  assert.match(transport.run, /oras manifest fetch-config/);
  assert.match(transport.run, /release-phases\.mjs sbom-record/);
  assert.match(transport.run, /cmp .*sbom\.spdx\.json.*sbom\.received\.spdx\.json/);
  const indexVerification = value.jobs.images.steps.find(step => step.run?.includes('docker pull "$REPOSITORY@$DIGEST"'));
  assert.match(indexVerification.run, /^set -euo pipefail\n/);
  assert.match(indexVerification.run, /release-phases\.mjs image-verify "\$REPOSITORY@\$DIGEST" "\$GITHUB_SHA" "\$GITHUB_REF"/);
  assert.match(indexVerification.run, /standards\/trust\/sigstore-trusted-root-cosign-3\.1\.3\.json/);
  assert.ok(!indexVerification.run.includes('certificate-identity-regexp'));
  assert.ok(!indexVerification.run.includes('||'), 'index signature failure must stop publication');
}

test('publication phases preserve all gates and decouple OCI/native from optional Cargo', () => {
  validateWorkflow(workflow());
  for (const mutate of [
    value => { value.on.push.branches = ['main']; },
    value => value.jobs['oci-native'].needs.push('crates'),
    value => value.jobs['oci-native'].needs.pop(),
    value => { delete value.jobs['installed-sdk']; },
    value => { value.jobs['installed-sdk'].if = '${{ false }}'; },
    value => { value.jobs['installed-sdk'].strategy.matrix.include.pop(); },
    value => { value.jobs['installed-sdk'].strategy.matrix.include[1].os = 'ubuntu-24.04'; },
    value => { value.jobs['installed-sdk'].steps.find(step => step.run?.includes('product-sdk-check.sh')).if = '${{ false }}'; },
    value => { value.jobs['source-vv'].if = undefined; },
    value => { value.jobs['source-vv'].if = '${{ false }}'; },
    value => { value.jobs.gate.if = '${{ always() }}'; },
    value => { value.jobs.gate.needs = value.jobs.gate.needs.filter(name => name !== 'devcontainer-image'); },
    value => { value.jobs.gate.steps.find(step => step.run?.includes('source-receipt')).if = '${{ false }}'; },
    value => { value.jobs['devcontainer-image'].steps.at(-1).with.runCmd = 'true'; },
    value => { value.jobs['installed-vv'] = {...value.jobs['installed-sdk']}; },
    value => { value.jobs['oci-native'].steps.find(step => step.run?.includes('publish-oci')).if = undefined; },
    value => { value.jobs.release.if = undefined; },
    value => { value.on.workflow_dispatch.inputs.rehearsal.default = false; },
    value => { value.jobs['oci-native'].if = '${{ always() }}'; },
    value => { value.jobs.release.if = '${{ always() }}'; },
    value => value.jobs.release.needs.pop(),
    value => { value.jobs.crates.if = '${{ true }}'; },
    ...[
      run => run.replace('package_target=${archive%/package/*}', 'package_target=target'),
      run => run.replace('test "$archive" = "$package_target/package/$package-$version.crate"', 'true'),
      run => run.replace('release_cargo "$package" package --locked --manifest-path "$manifest" --target-dir "$package_target"',
        'release_cargo package --locked --manifest-path "$manifest"'),
      run => run.replace('cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"\n',
        'cargo publish --locked --manifest-path "$manifest"\n'),
      run => run.replace('cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"\n',
        'cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target" --no-verify\n'),
      run => run.replace('cmp "$archive" "$expected"', 'true'),
      run => run.replace('cmp "$archive" "$expected"', 'true').replace(
        'cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"\n',
        'cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"\n                cmp "$archive" "$expected"\n'),
      // #214: the packaged crate must be dry-run, must stay the compared bytes
      // through the dry run, must meet crates.io metadata, and must not upload
      // without a credential.
      run => run.replace('release_cargo "$package" publish --dry-run --locked --manifest-path "$manifest" --target-dir "$package_target"\n', ''),
      run => run.replace('release_cargo "$package" publish --dry-run --locked --manifest-path "$manifest" --target-dir "$package_target"',
        'release_cargo "$package" publish --dry-run --locked --manifest-path "$manifest" --target-dir "$package_target" --no-verify'),
      run => run.replace('test "$(sha256sum "$archive" | cut -d" " -f1)" = "$local_checksum"\n', ''),
      run => run.replace('./scripts/crate-metadata-check.sh "$archive"\n', ''),
      run => run.replace('if [ "$UPLOAD" != true ]; then', 'if false; then'),
      run => run.replace(/if \[ "\$UPLOAD" = true \]; then\s+wait_for_crate lexlean 0\.4\.0\s+fi/, 'wait_for_crate lexlean 0.4.0'),
      run => run.replace(/\s*--config "patch\.crates-io\.lexlean\.path=[^\n]*\n/, '\n'),
    ].map(mutate => value => {
      const step = value.jobs.crates.steps.find(step => step.run?.includes('publish_exact()'));
      step.run = mutate(step.run);
    }),
    value => { delete value.jobs.crates.env.HAS_CARGO_REGISTRY_TOKEN; },
    value => { delete value.jobs.crates.steps.find(step => step.uses?.startsWith('rust-lang/crates-io-auth-action')).if; },
    value => { value.jobs.crates.steps.find(step => step.run?.includes('publish_exact()')).env.UPLOAD = 'true'; },
    value => { value.jobs.crates.steps.find(step => step.run?.includes('publish_exact()')).env.CARGO_REGISTRY_TOKEN
      = '${{ steps.auth.outputs.token }}'; },
    value => { value.jobs['source-vv'].steps.find(step => step.with?.runCmd).with.runCmd = 'just vv'; },
    value => { value.jobs.reproducibility.steps.find(step => step.env?.IMAGE).run = 'cmp root-a.digest root-b.digest'; },
    value => { value.jobs.images.steps = value.jobs.images.steps.filter(step => !step.run?.includes('release-phases.mjs policy')); },
    ...[
      run => run + '\n--tag mutable:unaccepted\n',
      run => run.replace('push-by-digest=true', 'push-by-digest=false'),
      run => run.replace('node scripts/sdk-image-inputs.mjs build . "$GITHUB_SHA" "$target"', 'docker buildx build'),
      run => run.replace('--platform "linux/$ARCH"', '--platform linux/amd64'),
      run => run.replace('--provenance=false', '--provenance=true'),
      run => run.replace('oracles sdk/Dockerfile oracles ghcr.io/uor-foundation/prismpm-oracles\n', ''),
    ].map(mutate => value => { const step = value.jobs['image-platforms'].steps.find(step => step.id === 'build'); step.run = mutate(step.run); }),
    value => { value.jobs['image-platforms'].strategy.matrix.include.pop(); },
    value => { value.jobs['image-platforms'].steps.splice(1, 0, {uses: 'docker/setup-qemu-action@fixture'}); },
    value => { const step = value.jobs.images.steps.find(step => step.id === 'build');
      step.run = step.run.replace('"$REPOSITORY@$digest" "$RUNNER_TEMP/image-index.json"', '"$REPOSITORY:latest" "$RUNNER_TEMP/image-index.json"'); },
    value => { value.jobs.images.steps.push({uses: 'actions/attest-sbom@fixture'}); },
    value => { value.jobs.images.steps.find(step => step.id === 'sbom-amd64').with['syft-version'] = 'latest'; },
    value => { const step = value.jobs.images.steps.find(step => step.run?.includes('release-phases.mjs image-verify'));
      step.run = step.run.replace('"$GITHUB_SHA" "$GITHUB_REF"', '"other-sha" "$GITHUB_REF"'); },
    value => { const step = value.jobs.images.steps.find(step => step.run?.includes('release-phases.mjs image-verify'));
      step.run = step.run.replace('"$GITHUB_SHA" "$GITHUB_REF"', '"$GITHUB_SHA" "refs/heads/release/v0.4"'); },
    value => { const step = value.jobs.images.steps.find(step => step.run?.includes('release-phases.mjs image-verify'));
      step.run = step.run.replace('set -euo pipefail\n', ''); },
    value => { const step = value.jobs.images.steps.find(step => step.run?.includes('release-phases.mjs image-verify'));
      step.run += '\ntrue || true\n'; },
  ]) {
    const changed = workflow(); mutate(changed);
    assert.throws(() => validateWorkflow(changed), undefined, mutate.toString());
  }
});

test('release crates use stage-owned targets despite an inherited Cargo target directory', () => {
  // Exercise real Cargo packaging and its verification builds, not a command
  // stub. The independent package-api gate also checks these archive bytes.
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-package-target-'));
  try {
    const inherited = join(directory, 'caller target');
    const stage = join(directory, 'release crates');
    mkdirSync(inherited);
    writeFileSync(join(inherited, 'caller-owned'), 'preserve caller artifacts\n');
    execFileSync('sh', [new URL('./package-release-crates.sh', import.meta.url).pathname,
      '--prepare', stage], {encoding: 'utf8', timeout: 180_000, stdio: 'pipe',
      env: {...process.env, CARGO_TARGET_DIR: inherited}});
    const archives = [
      ['prod-ir-0.1.0.crate', 'lean4-prod', 'vendor/lean4-prod/crates'],
      ['prod-codegen-0.1.0.crate', 'lean4-prod', 'vendor/lean4-prod/crates'],
      ['prism-stdlib-0.2.0.crate', 'stdlib', 'stdlib/generated'],
    ];
    assert.deepEqual(readdirSync(join(stage, 'packages')).sort(), archives.map(([name]) => name).sort());
    for (const [name, owner, reviewed] of archives) {
      const bytes = readFileSync(join(stage, 'packages', name));
      const produced = readFileSync(join(stage, owner, 'target/package', name));
      const expected = readFileSync(new URL(`../${reviewed}/${name}`, import.meta.url));
      assert.ok(bytes.equals(produced), `${name}: staged archive differs from Cargo output (${sha(bytes)} != ${sha(produced)})`);
      assert.ok(bytes.equals(expected), `${name}: archive differs from reviewed bytes (${sha(bytes)} != ${sha(expected)})`);
    }
    assert.deepEqual(readdirSync(inherited), ['caller-owned']);
    assert.equal(readFileSync(join(inherited, 'caller-owned'), 'utf8'), 'preserve caller artifacts\n');
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('Cargo publication target selection binds the exact package and version archive', () => {
  const body = workflow().jobs.crates.steps.find(step => step.run?.includes('publish_exact()')).run;
  // The checkout is the runner's, not uid 1000's: every target is stage-owned.
  // PrismPM's version is the workspace version, which the gate passes in.
  assert.ok(body.includes('publish_exact prismpm "$VERSION" crates/prismpm/Cargo.toml'));
  assert.ok(body.includes('"$release_parent/prismpm/target/package/prismpm-$VERSION.crate" -'));
  assert.ok(!body.includes('$PWD/target'), 'the container never writes into the runner-owned checkout');
  const selection = body.slice(body.indexOf('package_target='), body.indexOf('release_cargo "$package" package')).trim();
  const select = (packageName, version, archive) => execFileSync('sh', ['-eu', '-c',
    `${selection}\nprintf '%s\\n' "$package_target"`], {encoding: 'utf8', stdio: 'pipe',
    env: {...process.env, package: packageName, version, archive}});
  for (const [name, version, target] of [
    ['prod-ir', '0.1.0', '/release sources/lean4-prod/target'],
    ['prod-codegen', '0.1.0', '/release sources/lean4-prod/target'],
    ['prism-stdlib', '0.2.0', '/release sources/stdlib/target'],
    ['prismpm', '0.4.0', '/tmp/release parent/prismpm/target'],
  ]) {
    assert.equal(select(name, version, `${target}/package/${name}-${version}.crate`), `${target}\n`);
    for (const archive of [`${target}/${name}-${version}.crate`,
      `${target}/package/other-${version}.crate`, `${target}/package/${name}-99.0.0.crate`]) {
      assert.throws(() => select(name, version, archive), error => error.status !== 0);
    }
  }
});

test('a tag dispatch publishes, a branch dispatch rehearses, and foreign refs are refused', () => {
  assert.deepEqual(publicationPolicy(policy()), {version: '0.5.0', publishCrates: false, rehearsal: false});
  assert.equal(publicationPolicy({...policy(), publishCrates: true}).publishCrates, true);
  assert.deepEqual(publicationPolicy(rehearsal()), {version: '0.5.0', publishCrates: false, rehearsal: true});
  assert.equal(publicationPolicy({...rehearsal(), ref: 'refs/heads/release/v0.5'}).rehearsal, true);
  assert.throws(() => publicationPolicy({...rehearsal(), publishCrates: true}), /rehearsal cannot publish/);
  assert.throws(() => publicationPolicy({...rehearsal(), rehearsal: false}), /only the tag publishes/);
  assert.throws(() => publicationPolicy({...policy(), rehearsal: true}), /only the tag publishes/);
  assert.throws(() => publicationPolicy({...policy(), rehearsal: 'true'}));
  assert.throws(() => publicationPolicy({...policy(), rehearsal: null}));
  assert.throws(() => publicationPolicy({...policy(), event: 'push', publishCrates: null, rehearsal: true}));
  assert.equal(publicationPolicy({...policy(), event: 'push', publishCrates: null, rehearsal: null}).publishCrates, true);
  for (const change of [{publishCrates: 'false'}, {publishCrates: null}, {repository: 'other/PrismPM'},
    {ref: 'refs/heads/feature'}, {ref: 'refs/heads/release/v0.4'}, {ref: 'refs/heads/release/v0.6'}, {ref: 'refs/tags/v0.4.0'},
    {ref: 'refs/tags/v0.5.1'}, {event: 'pull_request'}, {version: '0.5'}, {version: '05.0.0'}, {revision: 'main'}, {extra: true}]) {
    assert.throws(() => publicationPolicy({...policy(), ...change}));
  }
});

test('release branch pushes force rehearsal, main rehearses only by dispatch, and a tag push publishes', () => {
  const pushed = {...policy(), ref: 'refs/heads/release/v0.5', event: 'push', publishCrates: null, rehearsal: null};
  assert.deepEqual(publicationPolicy(pushed), {version: '0.5.0', publishCrates: false, rehearsal: true});
  for (const ref of ['refs/heads/main', 'refs/heads/feature', 'refs/heads/release/v0.4', 'refs/tags/v0.4.0']) {
    assert.throws(() => publicationPolicy({...pushed, ref}));
  }
  for (const change of [{publishCrates: true}, {rehearsal: false}, {version: '0.6.0'}]) {
    assert.throws(() => publicationPolicy({...pushed, ...change}));
  }
  const helper = new URL('./release-phases.mjs', import.meta.url).pathname;
  const output = execFileSync(process.execPath, [helper, 'policy'], {encoding: 'utf8',
    env: {...process.env, ...environment(), GITHUB_EVENT_NAME: 'push', GITHUB_REF: `refs/heads/release/v${workspaceMinor}`,
      GITHUB_REF_NAME: `release/v${workspaceMinor}`, DISPATCH_VERSION: '9.9.9', PUBLISH_CRATES: 'true', REHEARSAL: 'false'}});
  assert.equal(output, `version=${workspace}\npublish-crates=false\nrehearsal=true\n`);
  assert.throws(() => execFileSync(process.execPath, [helper, 'policy'], {stdio: 'pipe',
    env: {...process.env, ...environment(), DISPATCH_VERSION: '9.9.9'}}), /workspace version/);
});

test('image-index signatures require the exact current source, ref, trigger, name, issuer and repository', () => {
  const imageDigest = `sha256:${'b'.repeat(64)}`;
  for (const name of ['sdk', 'runtime', 'adapter-compose', 'adapter-kubernetes', 'adapter-github-pages', 'oracles', 'sdk-build']) {
    for (const [ref, event] of [['refs/heads/release/v0.4', 'workflow_dispatch'], ['refs/heads/main', 'workflow_dispatch'],
      ['refs/heads/release/v0.4', 'push'], ['refs/tags/v0.4.0', 'push'], ['refs/tags/v0.5.0', 'workflow_dispatch']]) {
      const image = `ghcr.io/uor-foundation/prismpm-${name}@${imageDigest}`;
      assert.deepEqual(imageVerificationArguments(image, revision, ref, '/trusted-root', event), [
        'verify', '--trusted-root', '/trusted-root', '--certificate-identity',
        `https://github.com/UOR-Foundation/prismpm/.github/workflows/release.yml@${ref}`,
        '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com',
        '--certificate-github-workflow-repository', 'UOR-Foundation/prismpm',
        '--certificate-github-workflow-ref', ref, '--certificate-github-workflow-sha', revision,
        '--certificate-github-workflow-trigger', event,
        '--certificate-github-workflow-name', 'PrismPM OCI/native and Cargo publication', image,
      ]);
    }
  }
  const image = `ghcr.io/uor-foundation/prismpm-sdk@${imageDigest}`;
  for (const [ref, event] of [['refs/heads/release/v0.4', 'pull_request'],
    ['refs/heads/release/v0.4', 'push|workflow_dispatch'], ['refs/heads/main', 'push'], ['refs/tags/v0.4.0', 'pull_request']]) {
    assert.throws(() => imageVerificationArguments(image, revision, ref, '/trusted-root', event));
  }
  for (const [subject, source, ref] of [
    [image.replace('uor-foundation', 'other'), revision, 'refs/heads/release/v0.4'],
    [image.replace('prismpm-sdk', 'prismpm-sdk-candidate'), revision, 'refs/heads/release/v0.4'],
    [image.replace(imageDigest, 'latest'), revision, 'refs/heads/release/v0.4'],
    [`${image}@${imageDigest}`, revision, 'refs/heads/release/v0.4'],
    [image, 'main', 'refs/heads/release/v0.4'], [image, revision, 'refs/heads/feature'], [image, revision, 'refs/heads/release/v04'],
    [image, revision, 'refs/tags/v0.3'], [image, revision, 'refs/tags/0.3.0'],
  ]) assert.throws(() => imageVerificationArguments(subject, source, ref, '/trusted-root'));
});

test('image-index verifier CLI checks the pinned root and propagates signature-verifier failures', () => {
  // This command fixture proves invocation/failure propagation only. The
  // separate pinned Sigstore suite exercises real signed upstream fixtures.
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-index-verifier-'));
  try {
    const helper = new URL('./release-phases.mjs', import.meta.url).pathname;
    const trust = new URL('../standards/trust/sigstore-trusted-root-cosign-3.1.3.json', import.meta.url).pathname;
    const image = `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'b'.repeat(64)}`;
    const args = imageVerificationArguments(image, revision, 'refs/heads/release/v0.4', trust);
    const executable = join(directory, 'cosign');
    writeFileSync(executable, `#!${process.execPath}\nrequire('node:assert/strict').deepEqual(process.argv.slice(2), JSON.parse(process.env.EXPECTED_ARGS));\nprocess.stdout.write('verified-command-fixture\\n');\nprocess.exit(Number(process.env.VERIFIER_STATUS));\n`);
    chmodSync(executable, 0o700);
    const invoke = (status, root = trust, sourceRevision = revision, event = 'workflow_dispatch', expected = args) => execFileSync(process.execPath,
      [helper, 'image-verify', image, sourceRevision, 'refs/heads/release/v0.4', root], {stdio: 'pipe', encoding: 'utf8',
        env: {...process.env, PATH: `${directory}:${process.env.PATH}`, EXPECTED_ARGS: JSON.stringify(expected), GITHUB_EVENT_NAME: event,
          VERIFIER_STATUS: String(status)}});
    assert.equal(invoke(0), 'verified-command-fixture\n');
    const pushArgs = imageVerificationArguments(image, revision, 'refs/heads/release/v0.4', trust, 'push');
    assert.equal(invoke(0, trust, revision, 'push', pushArgs), 'verified-command-fixture\n');
    assert.throws(() => invoke(0, trust, revision, 'push'), error => error.status !== 0);
    assert.throws(() => invoke(0, trust, revision, 'pull_request'), error => error.status !== 0 && error.stdout === '');
    assert.throws(() => invoke(1), error => error.status !== 0);
    assert.throws(() => invoke(0, trust, 'c'.repeat(40)), error => error.status !== 0);
    const changedRoot = join(directory, 'untrusted.json'); writeFileSync(changedRoot, '{}');
    assert.throws(() => invoke(0, changedRoot), error => error.status !== 0 && error.stdout === '');
    assert.throws(() => invoke(0, join(directory, 'absent.json')), error => error.status !== 0 && error.stdout === '');
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('the release part shell must fail when its one invocation fails', t => {
  // This checks the actual shell sequence's failure propagation. The helper's
  // fixed just-vv-part command and real process capture have separate owning tests.
  const bodies = [workflow().jobs['source-vv'].steps.find(step => step.with?.runCmd).with.runCmd.replaceAll('${{ matrix.part }}', 'source')];
  const verify = body => {
    for (const first of [0, 1]) {
      const root = mkdtempSync(join(tmpdir(), 'prismpm-release-session-'));
      t.after(() => rmSync(root, {recursive: true, force: true}));
      const env = sessionFixture(root, process.env, {first, release: true,
        image: `ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:${'b'.repeat(64)}`});
      if (first === 0) {
        assert.equal(execFileSync('bash', ['-c', body], {cwd: root, env, encoding: 'utf8', timeout: 15_000}), 'call:1\n');
      } else {
        assert.throws(() => execFileSync('bash', ['-c', body], {cwd: root, env, encoding: 'utf8', timeout: 15_000}), error => {
          assert.equal(error.status, 1);
          assert.equal(error.stdout, 'call:1\n');
          return true;
        });
      }
    }
  };
  for (const body of bodies) {
    verify(body);
    assert.throws(() => verify(body.replace("'source'\n", "'source' || true\n")));
  }
});

test('publication rejects missing, skipped, failed, cancelled or extraneous prerequisites', () => {
  requirePrerequisites('oci-native', prerequisites(ociNeeds));
  const releaseNeeds = [...ociNeeds, 'oci-native', 'crates'];
  requirePrerequisites('release', prerequisites(releaseNeeds));
  for (const phase of ['oci-native', 'release']) {
    const names = phase === 'release' ? releaseNeeds : ociNeeds;
    for (const name of names) {
      const missing = prerequisites(names); delete missing[name];
      assert.throws(() => requirePrerequisites(phase, missing));
      for (const result of ['failure', 'cancelled', 'skipped', 'neutral', '', undefined]) {
        assert.throws(() => requirePrerequisites(phase, {...prerequisites(names), [name]: {result}}));
      }
    }
    assert.throws(() => requirePrerequisites(phase, {...prerequisites(names), unrelated: {result: 'success'}}));
    // A build receipt: the build stages are skipped, never run, and every
    // other prerequisite still succeeded.
    requirePrerequisites(phase, prerequisites(names, 'proved'));
    for (const name of names.filter(name => name !== 'factory')) {
      for (const result of ['success', 'failure', 'cancelled', 'skipped', '', undefined]) {
        const expected = buildStages.includes(name) ? 'skipped' : 'success';
        if (result === expected) continue;
        assert.throws(() => requirePrerequisites(phase, {...prerequisites(names, 'proved'), [name]: {result}}), `${phase} ${name} ${result}`);
      }
    }
    for (const route of ['', undefined, 'assumed'])
      assert.throws(() => requirePrerequisites(phase, {...prerequisites(names), factory: {result: 'success', outputs: {'build-route': route}}}));
  }
  assert.throws(() => requirePrerequisites('unknown', {}));
});

function layout(directory, architecture, marker = 'same') {
  mkdirSync(join(directory, 'blobs/sha256'), {recursive: true});
  const putBytes = bytes => {
    const digest = sha(bytes);
    writeFileSync(join(directory, 'blobs/sha256', digest.slice(7)), bytes);
    return {mediaType: 'application/vnd.oci.image.manifest.v1+json', digest, size: bytes.length};
  };
  const put = value => putBytes(Buffer.from(JSON.stringify(value)));
  const config = {...put({architecture, os: 'linux', config: {Labels: {
    'org.opencontainers.image.created': '1970-01-01T00:00:00Z',
    'org.opencontainers.image.revision': revision,
    'org.opencontainers.image.source': 'https://github.com/UOR-Foundation/prismpm',
    'org.opencontainers.image.version': workspaceVersion(), marker}}}), mediaType: 'application/vnd.oci.image.config.v1+json'};
  const layers = [Buffer.alloc(200_003, 97), Buffer.from('second layer\n')].map(bytes =>
    ({...putBytes(bytes), mediaType: 'application/vnd.oci.image.layer.v1.tar'}));
  const manifest = put({schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config, layers});
  writeFileSync(join(directory, 'index.json'), JSON.stringify({schemaVersion: 2, manifests: [manifest]}));
  return {...manifest, platform: {os: 'linux', architecture}};
}

test('two byte-equal rebuilds must also equal the shipped platform and source-labelled config', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-release-repro-'));
  try {
    const a = join(directory, 'a'), b = join(directory, 'b');
    const first = layout(a, 'amd64'); layout(b, 'amd64');
    const arm = {...first, digest: `sha256:${'b'.repeat(64)}`, platform: {os: 'linux', architecture: 'arm64'}};
    const bytes = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [first, arm]}));
    const image = `ghcr.io/uor-foundation/prismpm-sdk@${sha(bytes)}`;
    const verify = (reference = image, index = bytes, architecture = 'amd64', sourceRevision = revision) =>
      verifyReproducibility(reference, index, architecture, sourceRevision, a, b);
    assert.equal(verify(), first.digest);
    assert.throws(() => verify(`${image.slice(0, -1)}0`));
    assert.throws(() => verify(image, Buffer.concat([bytes, Buffer.from('\n')])));
    assert.throws(() => verify(image, bytes, 'arm64'));
    assert.throws(() => verify(image, bytes, 'amd64', 'c'.repeat(40)));
    layout(b, 'amd64', 'different'); assert.throws(() => verify());
    layout(a, 'amd64', 'different'); assert.throws(() => verify(), 'equal rebuilds cannot substitute unshipped bytes');
    layout(a, 'amd64'); layout(b, 'amd64');
    writeFileSync(join(a, 'blobs/sha256', first.digest.slice(7)), '{}');
    assert.throws(() => verify());
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('reproducibility freshly verifies every layer and refuses damaged or aliased bytes in either layout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-release-layers-'));
  try {
    for (const side of ['a', 'b']) {
      for (const damage of ['missing', 'changed', 'truncated', 'grown', 'symlink', 'hardlink', 'fifo', 'parent-alias']) {
        const root = join(directory, `${side}-${damage}`), a = join(root, 'a'), b = join(root, 'b');
        const first = layout(a, 'amd64'); layout(b, 'amd64');
        const arm = {...first, platform: {os: 'linux', architecture: 'arm64'}};
        const index = Buffer.from(JSON.stringify({schemaVersion: 2,
          mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [first, arm]}));
        const verify = () => verifyReproducibility(`ghcr.io/uor-foundation/prismpm-sdk@${sha(index)}`,
          index, 'amd64', revision, a, b);
        assert.equal(verify(), first.digest);
        const selected = join(root, side), manifest = JSON.parse(readFileSync(join(selected, 'blobs/sha256', first.digest.slice(7))));
        // Damage the last layer as well as the multi-chunk first layer: neither
        // the first descriptor nor a previous successful read is acceptance.
        const layer = manifest.layers[damage === 'truncated' ? 0 : 1];
        const path = join(selected, 'blobs/sha256', layer.digest.slice(7)), original = readFileSync(path);
        if (damage === 'missing') rmSync(path);
        else if (damage === 'changed') writeFileSync(path, Buffer.alloc(original.length, 98));
        else if (damage === 'truncated') writeFileSync(path, original.subarray(0, -1));
        else if (damage === 'grown') writeFileSync(path, Buffer.concat([original, Buffer.from('x')]));
        else if (damage === 'parent-alias') {
          const actual = join(selected, 'actual-blobs'); renameSync(join(selected, 'blobs'), actual);
          symlinkSync(actual, join(selected, 'blobs'));
        } else {
          rmSync(path);
          if (damage === 'fifo') execFileSync('mkfifo', [path]);
          else {
            const actual = join(root, 'external-layer'); writeFileSync(actual, original);
            if (damage === 'symlink') symlinkSync(actual, path);
            else linkSync(actual, path);
          }
        }
        assert.throws(verify, undefined, `${side}: ${damage} layer must refuse`);
      }
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('reproducibility rejects malformed or over-bound layer inventories', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-release-layer-descriptors-'));
  try {
    const mutations = [
      manifest => { delete manifest.layers; },
      manifest => { manifest.layers = {}; },
      manifest => { manifest.layers = Array(4097).fill(manifest.layers[0]); },
      manifest => { manifest.layers = Array.from({length: 5}, () => ({...manifest.layers[0], size: 32 * 1024 ** 3})); },
      ...[{digest: '../../escape'}, {digest: `sha256:${'B'.repeat(64)}`}, {size: -1}, {size: 1.5},
        {size: '14'}, {size: 32 * 1024 ** 3 + 1}, {mediaType: 'application/json'}]
        .map(change => manifest => { Object.assign(manifest.layers[0], change); }),
    ];
    for (const [number, mutate] of mutations.entries()) {
      const root = join(directory, String(number)), child = layout(root, 'amd64');
      const manifest = JSON.parse(readFileSync(join(root, 'blobs/sha256', child.digest.slice(7))));
      mutate(manifest);
      const bytes = Buffer.from(JSON.stringify(manifest)), descriptor = {...child, digest: sha(bytes), size: bytes.length};
      writeFileSync(join(root, 'blobs/sha256', descriptor.digest.slice(7)), bytes);
      writeFileSync(join(root, 'index.json'), JSON.stringify({schemaVersion: 2, manifests: [descriptor]}));
      const index = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json',
        manifests: [descriptor, {...descriptor, platform: {os: 'linux', architecture: 'arm64'}}]}));
      assert.throws(() => verifyReproducibility(`ghcr.io/uor-foundation/prismpm-sdk@${sha(index)}`,
        index, 'amd64', revision, root, root), number === 3 ? /OCI layer closure exceeds its byte bound/ : undefined,
      `descriptor mutation ${number} must refuse`);
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('both layout owners retain custody until the complete comparison finishes; removing the final sweep is killed', async () => {
  const helper = new URL('./release-phases.mjs', import.meta.url), source = readFileSync(helper, 'utf8');
  const withoutSweep = source.replace('  for (const owner of owners) owner();', '  // planted omitted final two-layout sweep');
  assert.notEqual(source, withoutSweep);
  const absoluteImports = withoutSweep.replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL(path, helper).href}'`);
  const mutant = await import(`data:text/javascript;base64,${Buffer.from(absoluteImports).toString('base64')}`);
  const check = (implementation, mutation) => {
    const directory = mkdtempSync(join(tmpdir(), 'prismpm-release-during-read-'));
    const originalRead = fs.readSync;
    let changed = false;
    try {
      const a = join(directory, 'a'), b = join(directory, 'b'), first = layout(a, 'amd64'); layout(b, 'amd64');
      const manifest = JSON.parse(readFileSync(join(a, 'blobs/sha256', first.digest.slice(7))));
      const layer = manifest.layers[0].digest.slice(7), victim = join(a, 'blobs/sha256', layer), trigger = join(b, 'blobs/sha256', layer);
      const index = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json',
        manifests: [first, {...first, platform: {os: 'linux', architecture: 'arm64'}}]}));
      fs.readSync = (fd, ...args) => {
        const count = originalRead(fd, ...args);
        if (!changed && fs.readlinkSync(`/proc/self/fd/${fd}`) === trigger) {
          changed = true;
          if (mutation === 'inode') {
            const bytes = readFileSync(victim); renameSync(victim, victim + '.retained'); writeFileSync(victim, bytes);
          } else writeFileSync(victim, Buffer.alloc(manifest.layers[0].size, 98));
        }
        return count;
      };
      syncBuiltinESMExports();
      assert.throws(() => implementation(`ghcr.io/uor-foundation/prismpm-sdk@${sha(index)}`,
        index, 'amd64', revision, a, b), /OCI input changed during read/);
      assert.equal(changed, true, 'actual second-layout layer read must trigger the substitution');
    } finally {
      fs.readSync = originalRead; syncBuiltinESMExports();
      rmSync(directory, {recursive: true, force: true});
    }
  };
  for (const mutation of ['content', 'inode']) {
    check(verifyReproducibility, mutation);
    assert.throws(() => check(mutant.verifyReproducibility, mutation), /Missing expected exception/);
  }
});

test('existing source-addressed publication is reusable only with exact metadata and every byte', () => {
  const tag = `sdk-oci-${revision}`, notes = 'Explicitly unaccepted OCI/native publication.\n';
  const files = [{name: 'archive.tar.gz', size: 3, digest: sha(Buffer.from('abc'))}];
  const release = {tag_name: tag, target_commitish: revision, draft: false, prerelease: true,
    body: notes, assets: [{name: files[0].name, size: files[0].size}]};
  const check = (value = release, actual = files, commit = revision) =>
    verifyExistingRelease(value, {tag, revision, notes, files}, actual, commit);
  check();
  for (const change of [{tag_name: 'v0.4.0'}, {target_commitish: 'main'}, {draft: true},
    {prerelease: false}, {body: 'accepted'}, {assets: []},
    {assets: [...release.assets, ...release.assets]}, {assets: [{...release.assets[0], size: 4}]}]) {
    assert.throws(() => check({...release, ...change}));
  }
  assert.throws(() => check(release, [{...files[0], digest: sha(Buffer.from('abd'))}]));
  assert.throws(() => check(release, [], revision));
  assert.throws(() => check(release, files, 'd'.repeat(40)));
});

test('release SBOM input binds exact index, child, config, platform, source and unmodified SPDX', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-release-sbom-'));
  try {
    const child = layout(directory, 'amd64');
    const childBytes = readFileSync(join(directory, 'blobs/sha256', child.digest.slice(7)));
    const configBytes = readFileSync(join(directory, 'blobs/sha256', JSON.parse(childBytes).config.digest.slice(7)));
    const arm = {...child, digest: `sha256:${'b'.repeat(64)}`, platform: {os: 'linux', architecture: 'arm64'}};
    const index = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [child, arm]}));
    const spdx = Buffer.from(JSON.stringify({spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT', dataLicense: 'CC0-1.0',
      documentNamespace: 'https://example.test/release-sbom-fixture', packages: [{}], files: [{}], relationships: [{}],
      hasExtractedLicensingInfos: [{licenseId: 'LicenseRef-Fixture', extractedText: 'full unmodified text'}]}));
    const image = `ghcr.io/uor-foundation/prismpm-sdk@${sha(index)}`;
    const args = [image, index, childBytes, configBytes, spdx, 'amd64', revision];
    const record = releaseSbomRecord(...args);
    assert.equal(record.image_reference, image);
    assert.equal(record.image_config_digest, sha(configBytes));
    assert.equal(record.spdx.digest, sha(spdx));
    assert.equal(record.spdx.size, spdx.length);
    assert.equal(record.production_accepted, false);
    assert.equal(record.development_only, undefined, 'release transport must not invent candidate smoke results');
    assert.equal(record.inventory_digest, undefined, 'runtime image must not be misreported as an SDK inventory');
    for (const [index, value] of [[0, image.replace('uor-foundation', 'other')], [1, Buffer.from('{}')],
      [2, Buffer.from('{}')], [3, Buffer.from('{}')], [4, spdx.subarray(0, -1)],
      [5, 'arm64'], [6, 'b'.repeat(40)]]) {
      const bad = [...args]; bad[index] = value;
      assert.throws(() => releaseSbomRecord(...bad));
    }
    for (const [name, bytes] of [['index.json', index], ['manifest.json', childBytes], ['config.json', configBytes],
      ['sbom.spdx.json', spdx]]) writeFileSync(join(directory, name), bytes);
    const helper = new URL('./release-phases.mjs', import.meta.url).pathname;
    const invoke = (command, ...extra) => execFileSync(process.execPath,
      [helper, command, directory, 'amd64', revision, image, 'refs/heads/release/v0.4', ...extra],
      {stdio: 'pipe', env: {...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch'}});
    invoke('sbom-record');
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'sbom-record.json'))), record);
    const trust = new URL('../standards/trust/sigstore-trusted-root-cosign-3.1.3.json', import.meta.url).pathname;
    const executable = join(directory, 'cosign');
    writeFileSync(executable, `#!${process.execPath}\nconst args=process.argv.slice(2);\nrequire('node:assert/strict').equal(args[args.indexOf('--certificate-github-workflow-trigger')+1],process.env.GITHUB_EVENT_NAME);\nprocess.stderr.write('exact-event-verified\\n');\nprocess.exit(19);\n`);
    chmodSync(executable, 0o700);
    for (const event of ['workflow_dispatch', 'push', 'pull_request']) {
      // Stop at the verifier: no registry interaction or fabricated signature acceptance.
      assert.throws(() => execFileSync(process.execPath,
        [helper, 'sbom-verify', directory, 'amd64', revision, image, 'refs/heads/release/v0.4', trust],
        {stdio: 'pipe', env: {...process.env, GITHUB_EVENT_NAME: event, PATH: `${directory}:${process.env.PATH}`}}),
      error => event === 'pull_request' ? error.stderr.toString().includes('exact release ref/event pair required')
        : error.stderr.toString().includes('exact-event-verified'));
    }

    writeFileSync(join(directory, 'sbom-record.json'), JSON.stringify({...record, production_accepted: true}));
    assert.throws(() => invoke('sbom-verify', '/absent-trusted-root'));
    invoke('sbom-record');
    writeFileSync(join(directory, 'config.json'), '{}');
    assert.throws(() => invoke('sbom-record'));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('the platform index names exactly the two pushed manifests, canonically', () => {
  const manifest = architecture => Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: {mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha(architecture), size: architecture.length}, layers: []}));
  const platforms = ['amd64', 'arm64'].map(architecture => ({architecture, digest: sha(manifest(architecture)), bytes: manifest(architecture)}));
  const index = platformIndex(platforms);
  assert.deepEqual(index, platformIndex(platforms.map(row => ({...row}))));
  assert.deepEqual(JSON.parse(index), {schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: platforms.map(({architecture, digest, bytes}) => ({mediaType: 'application/vnd.oci.image.manifest.v1+json',
      digest, size: bytes.length, platform: {architecture, os: 'linux'}}))});
  for (const broken of [
    platforms.slice(0, 1), [...platforms].reverse(), [platforms[0], {...platforms[1], digest: platforms[0].digest}],
    [platforms[0], {...platforms[1], bytes: Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json'}))}],
  ]) assert.throws(() => platformIndex(broken));
});

test('pinned Buildx pushes each platform by digest and the assembled two-platform OCI index creates no tags', {timeout: 240_000}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-digest-export-'));
  const registry = `prismpm-digest-export-${process.pid}-${Date.now()}`;
  const docker = args => execFileSync('docker', args, {encoding: 'utf8', timeout: 90_000, maxBuffer: 8 * 1024 * 1024});
  let registryCreated = false, builderCreated = false;
  try {
    assert.match(docker(['buildx', 'version']), /github\.com\/docker\/buildx v0\.28\.0 /);
    const cached = JSON.parse(docker(['image', 'inspect', buildkit]))[0].RepoDigests;
    assert.ok(cached.includes(`docker.io/${buildkit}`) || cached.includes(buildkit),
    'run scripts/fetch.sh before offline exporter verification');
    const fetchScript = readFileSync(new URL('./fetch.sh', import.meta.url), 'utf8');
    assert.ok(fetchScript.includes(`buildkit_image='${buildkit}'`));
    const config = join(directory, 'zot.json');
    writeFileSync(config, JSON.stringify({distSpecVersion: '1.1.1', http: {address: '0.0.0.0', port: 5000},
      log: {level: 'warn'}, storage: {rootDirectory: '/tmp/zot'}}));
    docker(['create', '--pull=never', '--name', registry,
      'ghcr.io/project-zot/zot@sha256:cd2aea942f428630bcb4190542be6abd35e14177aab84fc7ccad0dca8ecb363d',
      'serve', '/tmp/config.json']);
    registryCreated = true;
    docker(['cp', config, `${registry}:/tmp/config.json`]);
    docker(['start', registry]);
    const address = docker(['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', registry]).trim();
    assert.match(address, /^\d+\.\d+\.\d+\.\d+$/);
    const endpoint = `${address}:5000`;
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if ((await fetch(`http://${endpoint}/v2/`, {signal: AbortSignal.timeout(1000)})).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'pinned isolated registry did not become ready');
    docker(['buildx', 'create', '--name', registry, '--driver', 'docker-container', '--driver-opt', `image=${buildkit}`]);
    builderCreated = true;
    docker(['buildx', 'inspect', '--bootstrap', registry]);
    const context = join(directory, 'context'); mkdirSync(context);
    writeFileSync(join(context, 'Dockerfile'), 'FROM scratch\nARG SOURCE_DATE_EPOCH=0\nCOPY marker /marker\n');
    writeFileSync(join(context, 'marker'), 'synthetic export fixture, not an SDK\n');
    const args = ['buildx', 'build', '--builder', registry, '--no-cache', '--provenance=false', '--sbom=false',
      '--build-arg', 'SOURCE_DATE_EPOCH=0', '--label', 'org.opencontainers.image.created=1970-01-01T00:00:00Z',
      '--label', `org.opencontainers.image.revision=${revision}`, '--label',
      'org.opencontainers.image.source=https://github.com/UOR-Foundation/prismpm',
      '--label', `org.opencontainers.image.version=${workspaceVersion()}`];
    const platforms = [];
    for (const architecture of ['amd64', 'arm64']) {
      const metadata = join(directory, `${architecture}-metadata.json`);
      docker([...args, '--platform', `linux/${architecture}`, '--metadata-file', metadata, '--output',
        `type=registry,name=${endpoint}/fixture/sdk,push-by-digest=true,name-canonical=true,rewrite-timestamp=true,oci-mediatypes=true,registry.insecure=true`, context]);
      const platformDigest = JSON.parse(readFileSync(metadata))['containerimage.digest'];
      assert.match(platformDigest, /^sha256:[0-9a-f]{64}$/);
      const fetched = await fetch(`http://${endpoint}/v2/fixture/sdk/manifests/${platformDigest}`,
        {headers: {Accept: 'application/vnd.oci.image.manifest.v1+json'}, signal: AbortSignal.timeout(5000)});
      assert.equal(fetched.status, 200);
      platforms.push({architecture, digest: platformDigest, bytes: Buffer.from(await fetched.arrayBuffer())});
    }
    const assembled = platformIndex(platforms), digest = sha(assembled);
    const pushed = await fetch(`http://${endpoint}/v2/fixture/sdk/manifests/${digest}`, {method: 'PUT', body: assembled,
      headers: {'Content-Type': 'application/vnd.oci.image.index.v1+json'}, signal: AbortSignal.timeout(5000)});
    assert.equal(pushed.status, 201);
    const response = await fetch(`http://${endpoint}/v2/fixture/sdk/manifests/${digest}`,
      {headers: {Accept: 'application/vnd.oci.image.index.v1+json'}, signal: AbortSignal.timeout(5000)});
    assert.equal(response.status, 200);
    const index = Buffer.from(await response.arrayBuffer()); assert.equal(sha(index), digest);
    const tags = await fetch(`http://${endpoint}/v2/fixture/sdk/tags/list`, {signal: AbortSignal.timeout(5000)});
    assert.equal(tags.status, 200); assert.deepEqual((await tags.json()).tags ?? [], []);
    for (const platform of ['amd64', 'arm64']) {
      for (const name of ['a', 'b']) {
        const target = join(directory, `${platform}-${name}`); mkdirSync(target);
        const archive = `${target}.tar`;
        docker([...args, '--platform', `linux/${platform}`, '--output',
          `type=oci,dest=${archive},rewrite-timestamp=true,oci-mediatypes=true`, context]);
        execFileSync('tar', ['-xf', archive, '-C', target]);
      }
      verifyReproducibility(`ghcr.io/uor-foundation/prismpm-sdk@${digest}`, index, platform, revision,
        join(directory, `${platform}-a`), join(directory, `${platform}-b`));
      for (const side of ['a', 'b']) {
        const target = join(directory, `${platform}-${side}`), localIndex = JSON.parse(readFileSync(join(target, 'index.json')));
        const manifest = JSON.parse(readFileSync(join(target, 'blobs/sha256', localIndex.manifests[0].digest.slice(7))));
        assert.ok(manifest.layers.length > 0, 'genuine Buildx fixture must exercise actual layer verification');
        const path = join(target, 'blobs/sha256', manifest.layers[0].digest.slice(7)), original = readFileSync(path);
        for (const damage of ['missing', 'changed', 'truncated', 'alias']) {
          if (damage === 'missing') rmSync(path);
          else if (damage === 'changed') writeFileSync(path, Buffer.alloc(original.length, 0));
          else if (damage === 'truncated') writeFileSync(path, original.subarray(0, -1));
          else {
            const actual = join(directory, 'external-buildx-layer'); writeFileSync(actual, original);
            rmSync(path); symlinkSync(actual, path);
          }
          assert.throws(() => verifyReproducibility(`ghcr.io/uor-foundation/prismpm-sdk@${digest}`,
            index, platform, revision, join(directory, `${platform}-a`), join(directory, `${platform}-b`)),
          undefined, `actual ${platform}/${side} ${damage} must refuse`);
          if (damage !== 'missing') rmSync(path);
          writeFileSync(path, original);
        }
      }
    }
  } finally {
    try { if (builderCreated) docker(['buildx', 'rm', '--force', registry]); }
    finally {
      try { if (registryCreated) docker(['rm', '--force', registry]); } finally { rmSync(directory, {recursive: true, force: true}); }
    }
  }
});

test('versioned discovery tags are checked by the digest of the raw bytes they serve', t => {
  const step = workflow().jobs.release.steps.find(step => step.name === 'Publish accepted OCI discovery tags');
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-discovery-tags-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const bin = join(directory, 'bin'), release = join(directory, 'release');
  mkdirSync(bin); mkdirSync(release);
  const served = '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[]}';
  writeFileSync(join(directory, 'served.json'), served);
  // Buildx v0.28.0: --raw prints the served bytes; --format '{{.Manifest.Digest}}'
  // prints its default text, not the digest.
  writeFileSync(join(bin, 'docker'), `#!/bin/sh
set -eu
test "$1 $2" = "buildx imagetools"
case "$3" in
  create) printf '%s\\n' "$*" >> "${directory}/created" ;;
  inspect)
    if [ "$4" = --raw ]; then cat "${directory}/served.json"
    else printf 'Name:      %s\\nMediaType: application/vnd.oci.image.index.v1+json\\n' "$4"; fi ;;
  *) exit 2 ;;
esac
`);
  chmodSync(join(bin, 'docker'), 0o755);
  const run = digest => {
    rmSync(release, {recursive: true, force: true}); mkdirSync(release);
    writeFileSync(join(release, 'sdk-image.txt'), `ghcr.io/uor-foundation/prismpm-sdk@${digest}\n`);
    return execFileSync('bash', ['-c', step.run], {cwd: directory, stdio: 'pipe',
      env: {...process.env, PATH: `${bin}:${process.env.PATH}`, VERSION: '0.4.0'}});
  };
  run(sha(Buffer.from(served)));
  assert.equal(readFileSync(join(directory, 'created'), 'utf8'),
    `buildx imagetools create --tag ghcr.io/uor-foundation/prismpm-sdk:0.4.0 ghcr.io/uor-foundation/prismpm-sdk@${sha(Buffer.from(served))}\n`);
  assert.throws(() => run(sha(Buffer.from('other'))), error => error.status !== 0);
});
