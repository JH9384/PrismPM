import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {sessionFixture} from './vv-sdk-session-fixture.mjs';
import { assetNames, imageVerificationArguments, publicationNotes, publicationPolicy, publishOci, releaseSbomRecord, requirePrerequisites, verifyReproducibility, verifyExistingRelease } from './release-phases.mjs';

const require = createRequire('/opt/prismpm/oracles/package.json');
const { load } = require('js-yaml');
const source = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const workflow = () => load(source);
const revision = 'a'.repeat(40);
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const policy = () => ({repository: 'UOR-Foundation/PrismPM', ref: 'refs/heads/main',
  event: 'workflow_dispatch', version: '0.3.0', publishCrates: false, revision});
const prerequisites = names => Object.fromEntries(names.map(name => [name, {result: 'success'}]));
const ociNeeds = ['gate', 'images', 'native', 'reproducibility', 'installed-sdk'];
const buildkit = 'moby/buildkit@sha256:de10faf919fc71ba4eb1dd7bd6449566d012b0c9436b1c61bfee21d621b009aa';
const environment = () => ({GITHUB_REPOSITORY: 'UOR-Foundation/PrismPM', GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: revision, DISPATCH_VERSION: '0.3.0', PUBLISH_CRATES: 'false',
  GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123456789', GITHUB_RUN_ATTEMPT: '1'});
const publicationTag = `sdk-oci-${revision}-123456789-1`;

function validateWorkflow(value) {
  assert.deepEqual(value.jobs['oci-native'].needs, ociNeeds);
  assert.equal(value.jobs['oci-native'].if, undefined, 'normal success gating must not be bypassed');
  assert.deepEqual(value.jobs.release.needs, [...ociNeeds, 'oci-native', 'crates']);
  assert.equal(value.jobs.release.if, undefined);
  assert.equal(value.jobs.crates.if, "${{ needs.gate.outputs.publish-crates == 'true' }}");
  assert.deepEqual(value.jobs.crates.needs, [...ociNeeds, 'oci-native']);
  const cargoPublication = value.jobs.crates.steps.find(step => step.run?.includes('publish_exact()'))?.run;
  assert.ok(cargoPublication, 'Cargo publication must select and verify the exact archive');
  let previous = -1;
  for (const checkpoint of [
    'package_target=${archive%/package/*}',
    'test "$archive" = "$package_target/package/$package-$version.crate"',
    'cargo package --locked --manifest-path "$manifest" --target-dir "$package_target"',
    'test -f "$archive"',
    'cmp "$archive" "$expected"',
    'local_checksum=$(sha256sum "$archive" | cut -d" " -f1)',
    'cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"',
  ]) {
    const offset = cargoPublication.indexOf(checkpoint);
    assert.ok(offset > previous, `Cargo publication omits or misorders ${checkpoint}`);
    assert.equal(cargoPublication.lastIndexOf(checkpoint), offset, `Cargo publication repeats ${checkpoint}`);
    previous = offset;
  }
  assert.deepEqual(cargoPublication.split('\n').map(line => line.trim()).filter(line => line.startsWith('cargo ')), [
    'cargo package --locked --manifest-path "$manifest" --target-dir "$package_target"',
    'cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"',
  ], 'Cargo must retain complete verification for both selected-target operations');
  assert.equal(value.jobs.gate.outputs['publish-crates'], '${{ steps.version.outputs.publish-crates }}');
  assert.match(value.jobs.gate.steps.find(step => step.id === 'version').run, /release-phases\.mjs policy/);
  const sourceGate = value.jobs.gate.steps.find(step => step.with?.runCmd)?.with.runCmd;
  assert.equal(sourceGate, "set -euo pipefail\nbash scripts/vv.sh --with-sdk bash -euo pipefail -c \"$(cat <<'PRISMPM_VV'\n" + [1, 2].map(run =>
    `node scripts/release-gate-evidence.mjs source-run . target/source-vv-evidence '\${{ github.sha }}' amd64 - '\${{ github.run_id }}' '\${{ github.run_attempt }}' ${run}\n`).join('') + 'PRISMPM_VV\n)"\n');
  const sourceUpload = value.jobs.gate.steps.find(step => step.with?.name === 'source-vv');
  assert.equal(sourceUpload.if, 'always()'); assert.equal(sourceUpload.with.path, 'target/source-vv-evidence/');
  assert.equal(sourceUpload.with['if-no-files-found'], 'error');
  assert.deepEqual(value.jobs.reproducibility.needs, ['gate', 'images']);
  const installed = value.jobs['installed-sdk'];
  assert.deepEqual(installed.needs, ['gate', 'images']);
  assert.equal(installed.if, undefined); assert.equal(installed['continue-on-error'], undefined);
  assert.equal(installed['runs-on'], '${{ matrix.os }}');
  assert.deepEqual(installed.strategy.matrix.include, [{os:'ubuntu-24.04',arch:'amd64'}, {os:'ubuntu-24.04-arm',arch:'arm64'}]);
  const complete = installed.steps.find(step => step.run?.includes('sdk-vv-check.mjs run'));
  assert(complete); assert.equal(complete.if, undefined); assert.equal(complete['continue-on-error'], undefined);
  assert.match(complete.run, /sdk-vv-check\.mjs tests/);
  assert(installed.steps.some(step => step.with?.name === 'sdk-image' && step.with.path === '.shipped-image'));
  const retained = installed.steps.find(step => step.with?.name === 'full-sdk-vv-sdk-${{ matrix.arch }}');
  assert.equal(retained.if, 'always()'); assert.equal(retained.with['if-no-files-found'], 'error');
  const builds = value.jobs.images.steps.find(step => step.id === 'build');
  assert.equal(builds.uses, undefined);
  assert.equal(builds.with, undefined);
  assert.equal(builds.env.REPOSITORY, '${{ matrix.repository }}');
  assert.match(builds.run, /--output "type=registry,name=\$REPOSITORY,push-by-digest=true,name-canonical=true,rewrite-timestamp=true,oci-mediatypes=true"/);
  assert.ok(!builds.run.includes('--tag'), 'unaccepted publication must not move discovery aliases');
  assert.match(builds.run, /build=\(node scripts\/sdk-image-inputs\.mjs build \. "\$GITHUB_SHA" "\$TARGET"\)/);
  assert.match(builds.run, /--platform linux\/amd64,linux\/arm64/);
  assert.match(builds.run, /--provenance=false --sbom=false --build-arg SOURCE_DATE_EPOCH=0/);
  assert.match(builds.run, /digest=\$\(node scripts\/sdk-image-inputs\.mjs digest "\$RUNNER_TEMP\/sdk-build\.json"\)/);
  const rebuild = value.jobs.reproducibility.steps.find(step => step.env?.DOCKERFILE);
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
  assert.ok(publication.some(step => step.run?.includes('release-phases.mjs publish-oci')));
  assert.ok(!publication.some(step => step.run?.includes('imagetools create')));
  assert.ok(!publication.some(step => step.uses?.startsWith('softprops/action-gh-release')),
    'default overwrite-enabled release upload must not replace source-addressed bytes');
  for (const name of ['images', 'oci-native', 'crates', 'release']) {
    const steps = value.jobs[name].steps;
    const policyStep = steps.findIndex(step => step.run?.includes('release-phases.mjs policy'));
    assert.ok(policyStep >= 0, `${name} must check its own publication policy`);
    assert.equal(steps[policyStep].env.PUBLISH_CRATES, '${{ toJSON(inputs.publish-crates) }}');
    const firstCredential = steps.findIndex(step => step.uses?.startsWith('docker/login-action')
      || step.uses?.startsWith('rust-lang/crates-io-auth-action') || step.env?.GH_TOKEN);
    assert.ok(firstCredential < 0 || policyStep < firstCredential);
  }
  for (const name of ['images', 'native', 'reproducibility', 'installed-sdk', 'release']) {
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
    value => value.jobs['oci-native'].needs.push('crates'),
    value => value.jobs['oci-native'].needs.pop(),
    value => { delete value.jobs['installed-sdk']; },
    value => { value.jobs['installed-sdk'].if = '${{ false }}'; },
    value => { value.jobs['installed-sdk'].strategy.matrix.include.pop(); },
    value => { value.jobs['installed-sdk'].strategy.matrix.include[1].os = 'ubuntu-24.04'; },
    value => { value.jobs['installed-sdk'].steps.find(step => step.run?.includes('sdk-vv-check.mjs run')).if = '${{ false }}'; },
    value => { value.jobs['oci-native'].if = '${{ always() }}'; },
    value => { value.jobs.release.if = '${{ always() }}'; },
    value => value.jobs.release.needs.pop(),
    value => { value.jobs.crates.if = '${{ true }}'; },
    ...[
      run => run.replace('package_target=${archive%/package/*}', 'package_target=target'),
      run => run.replace('test "$archive" = "$package_target/package/$package-$version.crate"', 'true'),
      run => run.replace('cargo package --locked --manifest-path "$manifest" --target-dir "$package_target"',
        'cargo package --locked --manifest-path "$manifest"'),
      run => run.replace('cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"',
        'cargo publish --locked --manifest-path "$manifest"'),
      run => run.replace('cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"',
        'cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target" --no-verify'),
      run => run.replace('cmp "$archive" "$expected"', 'true'),
      run => run.replace('cmp "$archive" "$expected"', 'true').replace(
        'cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"',
        'cargo publish --locked --manifest-path "$manifest" --target-dir "$package_target"\n                cmp "$archive" "$expected"'),
    ].map(mutate => value => {
      const step = value.jobs.crates.steps.find(step => step.run?.includes('publish_exact()'));
      step.run = mutate(step.run);
    }),
    value => { value.jobs.gate.steps.find(step => step.with?.runCmd).with.runCmd = 'just vv'; },
    value => { value.jobs.reproducibility.steps.find(step => step.env?.DOCKERFILE).run = 'cmp root-a.digest root-b.digest'; },
    value => { value.jobs.images.steps = value.jobs.images.steps.filter(step => !step.run?.includes('release-phases.mjs policy')); },
    ...[
      run => run + '\n--tag mutable:unaccepted\n',
      run => run.replace('push-by-digest=true', 'push-by-digest=false'),
      run => run.replace('node scripts/sdk-image-inputs.mjs build . "$GITHUB_SHA" "$TARGET"', 'docker buildx build'),
      run => run.replace('--platform linux/amd64,linux/arm64', '--platform linux/amd64'),
      run => run.replace('--provenance=false', '--provenance=true'),
    ].map(mutate => value => { const step = value.jobs.images.steps.find(step => step.id === 'build'); step.run = mutate(step.run); }),
    value => { value.jobs.images.steps.push({uses: 'actions/attest-sbom@fixture'}); },
    value => { value.jobs.images.steps.find(step => step.id === 'sbom-amd64').with['syft-version'] = 'latest'; },
    value => { const step = value.jobs.images.steps.find(step => step.run?.includes('release-phases.mjs image-verify'));
      step.run = step.run.replace('"$GITHUB_SHA" "$GITHUB_REF"', '"other-sha" "$GITHUB_REF"'); },
    value => { const step = value.jobs.images.steps.find(step => step.run?.includes('release-phases.mjs image-verify'));
      step.run = step.run.replace('"$GITHUB_SHA" "$GITHUB_REF"', '"$GITHUB_SHA" "refs/heads/main"'); },
    value => { const step = value.jobs.images.steps.find(step => step.run?.includes('release-phases.mjs image-verify'));
      step.run = step.run.replace('set -euo pipefail\n', ''); },
    value => { const step = value.jobs.images.steps.find(step => step.run?.includes('release-phases.mjs image-verify'));
      step.run += '\ntrue || true\n'; },
  ]) {
    const changed = workflow(); mutate(changed);
    assert.throws(() => validateWorkflow(changed));
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
      assert.deepEqual(bytes, readFileSync(join(stage, owner, 'target/package', name)));
      assert.deepEqual(bytes, readFileSync(new URL(`../${reviewed}/${name}`, import.meta.url)));
    }
    assert.deepEqual(readdirSync(inherited), ['caller-owned']);
    assert.equal(readFileSync(join(inherited, 'caller-owned'), 'utf8'), 'preserve caller artifacts\n');
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('Cargo publication target selection binds the exact package and version archive', () => {
  const body = workflow().jobs.crates.steps.find(step => step.run?.includes('publish_exact()')).run;
  const selection = body.slice(body.indexOf('package_target='), body.indexOf('cargo package')).trim();
  const select = (packageName, version, archive) => execFileSync('sh', ['-eu', '-c',
    `${selection}\nprintf '%s\\n' "$package_target"`], {encoding: 'utf8', stdio: 'pipe',
    env: {...process.env, package: packageName, version, archive}});
  for (const [name, version, target] of [
    ['prod-ir', '0.1.0', '/release sources/lean4-prod/target'],
    ['prod-codegen', '0.1.0', '/release sources/lean4-prod/target'],
    ['prism-stdlib', '0.2.0', '/release sources/stdlib/target'],
    ['prismpm', '0.3.0', '/workspace/target'],
  ]) {
    assert.equal(select(name, version, `${target}/package/${name}-${version}.crate`), `${target}\n`);
    for (const archive of [`${target}/${name}-${version}.crate`,
      `${target}/package/other-${version}.crate`, `${target}/package/${name}-99.0.0.crate`]) {
      assert.throws(() => select(name, version, archive), error => error.status !== 0);
    }
  }
});

test('explicit OCI-only dispatch is distinct from Cargo publication and rejects foreign refs', () => {
  assert.deepEqual(publicationPolicy(policy()), {version: '0.3.0', publishCrates: false});
  assert.equal(publicationPolicy({...policy(), publishCrates: true}).publishCrates, true);
  assert.equal(publicationPolicy({...policy(), event: 'push', ref: 'refs/tags/v0.3.0', publishCrates: null}).publishCrates, true);
  for (const change of [{publishCrates: 'false'}, {publishCrates: null}, {repository: 'other/PrismPM'},
    {ref: 'refs/heads/feature'}, {ref: 'refs/tags/v0.3.0'}, {event: 'pull_request'},
    {version: '0.4.0'}, {revision: 'main'}, {extra: true}]) {
    assert.throws(() => publicationPolicy({...policy(), ...change}));
  }
});

test('image-index signatures require the exact current source, ref, trigger, name, issuer and repository', () => {
  const imageDigest = `sha256:${'b'.repeat(64)}`;
  for (const name of ['sdk', 'runtime', 'adapter-compose', 'adapter-kubernetes', 'adapter-github-pages', 'oracles']) {
    for (const ref of ['refs/heads/main', 'refs/tags/v0.3.0']) {
      const image = `ghcr.io/uor-foundation/prismpm-${name}@${imageDigest}`;
      assert.deepEqual(imageVerificationArguments(image, revision, ref, '/trusted-root'), [
        'verify', '--trusted-root', '/trusted-root', '--certificate-identity',
        `https://github.com/UOR-Foundation/PrismPM/.github/workflows/release.yml@${ref}`,
        '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com',
        '--certificate-github-workflow-repository', 'UOR-Foundation/PrismPM',
        '--certificate-github-workflow-ref', ref, '--certificate-github-workflow-sha', revision,
        '--certificate-github-workflow-trigger', ref === 'refs/heads/main' ? 'workflow_dispatch' : 'push',
        '--certificate-github-workflow-name', 'PrismPM OCI/native and Cargo publication', image,
      ]);
    }
  }
  const image = `ghcr.io/uor-foundation/prismpm-sdk@${imageDigest}`;
  for (const [subject, source, ref] of [
    [image.replace('uor-foundation', 'other'), revision, 'refs/heads/main'],
    [image.replace('prismpm-sdk', 'prismpm-sdk-candidate'), revision, 'refs/heads/main'],
    [image.replace(imageDigest, 'latest'), revision, 'refs/heads/main'],
    [`${image}@${imageDigest}`, revision, 'refs/heads/main'],
    [image, 'main', 'refs/heads/main'], [image, revision, 'refs/heads/feature'],
    [image, revision, 'refs/tags/v0.4.0'],
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
    const args = imageVerificationArguments(image, revision, 'refs/heads/main', trust);
    const executable = join(directory, 'cosign');
    writeFileSync(executable, `#!${process.execPath}\nrequire('node:assert/strict').deepEqual(process.argv.slice(2), JSON.parse(process.env.EXPECTED_ARGS));\nprocess.stdout.write('verified-command-fixture\\n');\nprocess.exit(Number(process.env.VERIFIER_STATUS));\n`);
    chmodSync(executable, 0o700);
    const invoke = (status, root = trust, sourceRevision = revision) => execFileSync(process.execPath,
      [helper, 'image-verify', image, sourceRevision, 'refs/heads/main', root], {stdio: 'pipe', encoding: 'utf8',
        env: {...process.env, PATH: `${directory}:${process.env.PATH}`, EXPECTED_ARGS: JSON.stringify(args),
          VERIFIER_STATUS: String(status)}});
    assert.equal(invoke(0), 'verified-command-fixture\n');
    assert.throws(() => invoke(1), error => error.status !== 0);
    assert.throws(() => invoke(0, trust, 'c'.repeat(40)), error => error.status !== 0);
    const changedRoot = join(directory, 'untrusted.json'); writeFileSync(changedRoot, '{}');
    assert.throws(() => invoke(0, changedRoot), error => error.status !== 0 && error.stdout === '');
    assert.throws(() => invoke(0, join(directory, 'absent.json')), error => error.status !== 0 && error.stdout === '');
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('the release twice-VV shell must fail on either invocation, including first-run-only failure', t => {
  // This checks the actual shell sequence's failure propagation. The helper's
  // fixed just-vv command and real process capture have separate owning tests.
  const bodies = [workflow().jobs.gate.steps.find(step => step.with?.runCmd).with.runCmd];
  const verify = body => {
    for (const [first, second] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const root = mkdtempSync(join(tmpdir(), 'prismpm-release-session-'));
      t.after(() => rmSync(root, {recursive: true, force: true}));
      const env = sessionFixture(root, process.env, {first, second, release: true,
        image: `ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:${'b'.repeat(64)}`});
      if (first === 0 && second === 0) {
        assert.equal(execFileSync('bash', ['-c', body], {cwd: root, env, encoding: 'utf8', timeout: 15_000}), 'call:1\ncall:2\n');
      } else {
        assert.throws(() => execFileSync('bash', ['-c', body], {cwd: root, env, encoding: 'utf8', timeout: 15_000}), error => {
          assert.equal(error.status, 1);
          assert.equal(error.stdout, first === 0 ? 'call:1\ncall:2\n' : 'call:1\n');
          return true;
        });
      }
    }
  };
  for (const body of bodies) {
    verify(body);
    assert.throws(() => verify(body.replace('--with-sdk bash -euo pipefail', '--with-sdk bash')));
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
  }
  assert.throws(() => requirePrerequisites('unknown', {}));
});

function layout(directory, architecture, marker = 'same') {
  mkdirSync(join(directory, 'blobs/sha256'), {recursive: true});
  const put = value => {
    const bytes = Buffer.from(JSON.stringify(value)); const digest = sha(bytes);
    writeFileSync(join(directory, 'blobs/sha256', digest.slice(7)), bytes);
    return {mediaType: 'application/vnd.oci.image.manifest.v1+json', digest, size: bytes.length};
  };
  const config = {...put({architecture, os: 'linux', config: {Labels: {
    'org.opencontainers.image.created': '1970-01-01T00:00:00Z',
    'org.opencontainers.image.revision': revision,
    'org.opencontainers.image.source': 'https://github.com/UOR-Foundation/PrismPM',
    'org.opencontainers.image.version': '0.3.0', marker}}}), mediaType: 'application/vnd.oci.image.config.v1+json'};
  const manifest = put({schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config, layers: []});
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

test('existing source-addressed publication is reusable only with exact metadata and every byte', () => {
  const tag = `sdk-oci-${revision}`, notes = 'Explicitly unaccepted OCI/native publication.\n';
  const files = [{name: 'archive.tar.gz', size: 3, digest: sha(Buffer.from('abc'))}];
  const release = {tag_name: tag, target_commitish: revision, draft: false, prerelease: true,
    body: notes, assets: [{name: files[0].name, size: files[0].size}]};
  const check = (value = release, actual = files, commit = revision) =>
    verifyExistingRelease(value, {tag, revision, notes, files}, actual, commit);
  check();
  for (const change of [{tag_name: 'v0.3.0'}, {target_commitish: 'main'}, {draft: true},
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
      [helper, command, directory, 'amd64', revision, image, 'refs/heads/main', ...extra], {stdio: 'pipe'});
    invoke('sbom-record');
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'sbom-record.json'))), record);
    writeFileSync(join(directory, 'sbom-record.json'), JSON.stringify({...record, production_accepted: true}));
    assert.throws(() => invoke('sbom-verify', '/absent-trusted-root'));
    invoke('sbom-record');
    writeFileSync(join(directory, 'config.json'), '{}');
    assert.throws(() => invoke('sbom-record'));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('publisher reuses identical release without writes and refuses all substitutions or partial drafts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-existing-release-'));
  try {
    const names = assetNames();
    for (const name of names) writeFileSync(join(directory, name), 'abc');
    const initial = {tag_name: publicationTag, target_commitish: revision,
      draft: false, prerelease: true, body: publicationNotes(revision),
      assets: names.map(name => ({name, size: 3}))};
    const fixture = (change = {}, content = 'abc', tagCommit = revision) => {
      const calls = [];
      const release = {...structuredClone(initial), ...change};
      const client = {environment: environment(),
        api: path => path.includes('/commits/') ? {sha: tagCommit} : release,
        checked: args => {
          calls.push(args);
          assert.equal(args[1], 'download', 'existing releases must never be written');
          const target = args[args.indexOf('--dir') + 1];
          for (const name of names) writeFileSync(join(target, name), content);
        }};
      return {client, calls};
    };
    const same = fixture();
    assert.equal(await publishOci(directory, revision, same.client),
      `https://github.com/UOR-Foundation/PrismPM/releases/tag/${publicationTag}`);
    assert.equal(same.calls.length, 1);
    for (const [change, content, tagCommit] of [
      [{}, 'abd', revision], [{draft: true, assets: []}, 'abc', revision],
      [{prerelease: false}, 'abc', revision], [{body: 'accepted'}, 'abc', revision],
      [{assets: initial.assets.slice(1)}, 'abc', revision], [{}, 'abc', 'b'.repeat(40)],
      [{assets: [...initial.assets.slice(1), initial.assets[1]]}, 'abc', revision],
    ]) {
      const changed = fixture(change, content, tagCommit);
      await assert.rejects(publishOci(directory, revision, changed.client));
      assert.ok(changed.calls.every(args => args[1] === 'download'));
    }
    rmSync(join(directory, names[0]));
    const missing = fixture();
    await assert.rejects(publishOci(directory, revision, missing.client), /asset closure is incomplete/);
    assert.equal(missing.calls.length, 0);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('new and complete staged publications verify all bytes before becoming public', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-new-release-'));
  try {
    const names = assetNames();
    for (const name of names) writeFileSync(join(directory, name), 'abc');
    for (const [corrupt, resume] of [[false, false], [true, false], [false, true], [true, true]]) {
      let release = resume ? {tag_name: publicationTag, target_commitish: revision,
        draft: true, prerelease: true, body: publicationNotes(revision),
        assets: names.map(name => ({name, size: 3}))} : null;
      let tag = null;
      const calls = [];
      const client = {environment: environment(),
        api: path => path.includes('/commits/') ? tag : release,
        checked: args => {
          calls.push(args);
          assert.ok(!args.includes('--clobber'));
          if (args[1] === 'create') {
            assert.ok(args.includes('--draft') && args.includes('--prerelease'));
            release = {tag_name: publicationTag, target_commitish: revision, draft: true,
              prerelease: true, body: args[args.indexOf('--notes') + 1], assets: []};
          } else if (args[1] === 'upload') {
            release.assets = names.map(name => ({name, size: 3}));
          } else if (args[1] === 'download') {
            const target = args[args.indexOf('--dir') + 1];
            for (const name of names) writeFileSync(join(target, name), corrupt ? 'bad' : 'abc');
          } else if (args[1] === 'edit') {
            assert.deepEqual(args.slice(-1), ['--draft=false']);
            release.draft = false; tag = {sha: revision};
          } else assert.fail(`unexpected publication command: ${args[1]}`);
        }};
      if (corrupt) {
        await assert.rejects(publishOci(directory, revision, client), /cannot be overwritten/);
        assert.equal(release.draft, true);
        assert.ok(!calls.some(args => args[1] === 'edit'));
      } else {
        await publishOci(directory, revision, client);
        assert.deepEqual(calls.map(args => args[1]), resume ? ['download', 'edit'] : ['create', 'upload', 'download', 'edit']);
      }
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('publication attempts have distinct discovery tags and invalid run contexts perform no I/O', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-attempt-release-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const names = assetNames();
  for (const name of names) writeFileSync(join(directory, name), 'abc');
  const releases = new Map(), commits = new Map(), endpoints = [], writes = [];
  const client = {environment: environment(), api: path => {
    endpoints.push(path);
    if (path.includes('/commits/')) return commits.get(path.split('/').at(-1)) ?? null;
    return releases.get(path.split('/').at(-1)) ?? null;
  }, checked: args => {
    const tag = args[2];
    if (args[1] !== 'download') writes.push(args);
    if (args[1] === 'create') {
      assert(!releases.has(tag));
      releases.set(tag, {tag_name: tag, target_commitish: revision, draft: true, prerelease: true,
        body: args[args.indexOf('--notes') + 1], assets: []});
    } else if (args[1] === 'upload') {
      releases.get(tag).assets = names.map(name => ({name, size: 3}));
    } else if (args[1] === 'download') {
      const target = args[args.indexOf('--dir') + 1];
      for (const name of names) writeFileSync(join(target, name), 'abc');
    } else if (args[1] === 'edit') {
      releases.get(tag).draft = false; commits.set(tag, {sha: revision});
    } else assert.fail('unexpected release operation');
  }};
  for (const [run, attempt] of [['123456789', '1'], ['123456789', '2'], ['987654321', '1']]) {
    client.environment = {...environment(), GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt};
    const expected = `sdk-oci-${revision}-${run}-${attempt}`;
    assert.equal(await publishOci(directory, revision, client),
      `https://github.com/UOR-Foundation/PrismPM/releases/tag/${expected}`);
    assert(endpoints.some(path => path.endsWith('/tags/' + expected)));
  }
  assert.equal(releases.size, 3, 'reruns must not collide with earlier evidence');
  const before = writes.length;
  await publishOci(directory, revision, client);
  assert.equal(writes.length, before, 'identical same-attempt publication is read-only');
  writeFileSync(join(directory, names[0]), 'abd');
  await assert.rejects(publishOci(directory, revision, client), /cannot be overwritten/);
  assert.equal(writes.length, before);
  for (const change of [{GITHUB_ACTIONS: undefined}, {GITHUB_ACTIONS: 'false'},
    ...['', '0', '01', '-1', '1.0', '1e3', ' 1', '1\n', '../main', undefined]
      .flatMap(value => [{GITHUB_RUN_ID: value}, {GITHUB_RUN_ATTEMPT: value}])]) {
    client.environment = {...environment(), ...change};
    const requests = endpoints.length;
    await assert.rejects(publishOci(directory, revision, client));
    assert.equal(endpoints.length, requests, 'invalid run identity must fail before API access');
    assert.equal(writes.length, before);
  }
});

test('pinned Buildx pushes a genuine two-platform OCI index by digest without creating tags', {timeout: 240_000}, async () => {
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
      'org.opencontainers.image.source=https://github.com/UOR-Foundation/PrismPM',
      '--label', 'org.opencontainers.image.version=0.3.0'];
    const metadata = join(directory, 'metadata.json');
    docker([...args, '--platform', 'linux/amd64,linux/arm64', '--metadata-file', metadata, '--output',
      `type=registry,name=${endpoint}/fixture/sdk,push-by-digest=true,name-canonical=true,rewrite-timestamp=true,oci-mediatypes=true,registry.insecure=true`, context]);
    const digest = JSON.parse(readFileSync(metadata))['containerimage.digest'];
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
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
    }
  } finally {
    try { if (builderCreated) docker(['buildx', 'rm', '--force', registry]); }
    finally {
      try { if (registryCreated) docker(['rm', '--force', registry]); } finally { rmSync(directory, {recursive: true, force: true}); }
    }
  }
});
