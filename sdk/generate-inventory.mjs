import { createHash } from 'node:crypto';
import { access, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { compilerRevision, encodeInventory, exporterArtifactBindings, validateAuthorityMetadata, validateImageInputMetadata } from './inventory-metadata.mjs';
import { readSmall, snapshotFile } from './exporter-seed.mjs';

const output = process.argv[2];
if (!output) throw new Error('inventory output path is required');

const commands = [];
const seen = new Set();
for (const directory of (process.env.PATH ?? '').split(':')) {
  if (!directory) continue;
  let names;
  try {
    names = (await readdir(directory)).sort();
  } catch {
    continue;
  }
  for (const command of names) {
    if (seen.has(command)) continue;
    const candidate = `${directory}/${command}`;
    try {
      await access(candidate, constants.X_OK);
      const executable = await realpath(candidate);
      if (!(await stat(executable)).isFile()) continue;
      const sha256 = createHash('sha256').update(await readFile(executable)).digest('hex');
      commands.push({ command, executable, sha256 });
      seen.add(command);
    } catch {
      // Non-executable and broken directory entries are not commands on PATH.
    }
  }
}
commands.sort((left, right) => Buffer.from(left.command).compare(Buffer.from(right.command)));

const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
async function treeDigest(root) {
  const rows = [];
  async function visit(directory, prefix = '') {
    for (const name of (await readdir(directory)).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) {
      const path = `${directory}/${name}`;
      const relative = prefix ? `${prefix}/${name}` : name;
      const metadata = await stat(path);
      if (metadata.isDirectory()) await visit(path, relative);
      else if (metadata.isFile()) rows.push([relative, await readFile(path)]);
      else throw new Error(`SDK artifact tree contains a non-regular entry: ${relative}`);
    }
  }
  await visit(root);
  const digest = createHash('sha256');
  for (const [path, bytes] of rows) {
    const name = Buffer.from(path);
    const nameLength = Buffer.alloc(8); nameLength.writeBigUInt64BE(BigInt(name.length));
    const byteLength = Buffer.alloc(8); byteLength.writeBigUInt64BE(BigInt(bytes.length));
    digest.update(nameLength).update(name).update(byteLength).update(bytes);
  }
  return `sha256:${digest.digest('hex')}`;
}

const definitions = [
  ['sdk-exporter-seed-producer', 'schema', '1', '/opt/prismpm/exporter-seed.mjs'],
  ['sdk-platform-lock', 'schema', '2', '/opt/prismpm/platform-lock.mjs'],
  ['sdk-metadata-cli', 'schema', '1', '/opt/prismpm/metadata-cli.mjs'],
  ['sdk-metadata-capture', 'schema', '1', '/opt/prismpm/metadata-capture.mjs'],
  ['sdk-metadata-layer', 'schema', '1', '/opt/prismpm/metadata-layer.mjs'],
  ['sdk-metadata-transport', 'schema', '1', '/opt/prismpm/metadata-transport.mjs'],
  ['sdk-metadata-credentials', 'schema', '1', '/opt/prismpm/metadata-credentials.mjs'],
  ['sdk-metadata-helper', 'schema', '1', '/opt/prismpm/metadata-helper.mjs'],
  ['sdk-metadata-helper-supervisor', 'schema', '1', '/opt/prismpm/metadata-helper-supervisor.py'],
  ['action', 'workflow', '0.4.0', 'action', 'tree'],
  ['adapter-compose', 'adapter', 'compose-spec@fee041b381ffd4aad263410980bdce0cdf4beb7d', 'adapters/compose.json'],
  ['adapter-github-pages', 'adapter', 'github-pages-artifact@v4', 'adapters/github-pages.json'],
  ['adapter-github-pages-browser', 'adapter', 'github-pages-artifact@v4', 'adapters/github-pages-browser.json'],
  ['adapter-kubernetes', 'adapter', '1.36.4', 'adapters/kubernetes.json'],
  ['asyncapi-oracle', 'oracle', '3.1.0', 'sdk/oracles', 'tree'],
  ['asyncapi-embedded-runtime-lock', 'dependency-lock', '@asyncapi/parser/3.6.0', '/opt/prismpm/asyncapi-official/scripts/package-lock.json'],
  ['asyncapi-embedded-runtime', 'oracle', '@asyncapi/parser/3.6.0', '/opt/prismpm/asyncapi-official/scripts/node_modules', 'tree'],
  ['asyncapi-embedded-launcher', 'oracle', '1', '/opt/prismpm/asyncapi-official/scripts/launcher.mjs'],
  ['asyncapi-embedded-runtime-tests', 'test-corpus', '1', '/opt/prismpm/asyncapi-official/scripts/launcher.test.mjs'],
  ['asyncapi-3.1.0-official-corpus', 'test-corpus', 'b3fac5bb522771428ea57b16129b273cd3ea0180', 'standards/oracles/asyncapi-spec-b3fac5bb', 'tree'],
  ['asyncapi-website-adeo-schemas', 'test-corpus', '20a31a0396b41dd24b1bac877ab7ce3f58037c28', 'standards/oracles/asyncapi-website-20a31a03', 'tree'],
  ['build-base', 'base-image', 'rust-1.97.1-bookworm', null, 'sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97'],
  ['browser-host-primitives', 'adapter', '1', '/opt/prismpm/browser', 'tree'],
  ['browser-account-genesis-construction', 'adapter', '1', '/opt/prismpm/share/account-genesis', 'tree'],
  ['chromium-input-authority', 'dependency-lock', '157.0.8099.0', 'sdk/browser-engine/authority.json'],
  ['chromium-input-installer', 'oracle', '1', 'sdk/browser-engine/install.py'],
  ['bootstrap-historical-runtime', 'binary', '0.2.0-runner/1', '/opt/prismpm/bootstrap-0.2.0', 'tree'],
  ['bootstrap-historical-runner', 'binary', '0.2.0-runner/1', 'sdk/bootstrap/runner.mjs'],
  ['conformance-corpus', 'test-corpus', 'prismpm/ids/1', '/opt/prismpm/share/conformance-root', 'tree'],
  ['cloudevents-1.0.2-fixtures', 'test-corpus', '1.0.2', 'standards/corpora/cloudevents-1.0.2', 'tree'],
  ['cloudevents-sdk-go-corpus', 'test-corpus', '2.16.2', 'standards/oracles/cloudevents-sdk-go-2.16.2', 'tree'],
  ['cloudevents-sdk-conformance', 'oracle', '2.16.2', '/usr/local/bin/cloudevents-sdk-conformance'],
  ['cloudevents-validator', 'oracle', 'sdk-go/2.16.2', '/usr/local/bin/cloudevents-validator'],
  ['contracts', 'schema', '1', 'schemas', 'tree'],
  ['docker-buildx', 'binary', '0.28.0', '/usr/local/libexec/docker/cli-plugins/docker-buildx'],
  ['git-tag-root-akihirosuda', 'trust-root', 'github-key-record-5228653', 'standards/trust/github-akihirosuda-openpgp-49524c6f9f638f1a.asc'],
  ['git-tag-root-hayden-io', 'trust-root', 'github-key-record-682831', 'standards/trust/github-hayden-io-ssh-zjmejzisa.pub'],
  ['git-tag-root-songy23', 'trust-root', 'github-key-record-276780', 'standards/trust/github-songy23-ssh-sfmatr1d.pub'],
  ['git-tag-root-sudo-bmitch', 'trust-root', 'github-key-record-2155637', 'standards/trust/github-sudo-bmitch-openpgp-6e0ff28c767a8bee.asc'],
  ['lean', 'binary', '4.32.1', '/usr/local/elan/toolchains/leanprover--lean4---v4.32.1/bin/lean'],
  ['lean4-prod', 'crate', null, 'vendor/lean4-prod/crates/prod-codegen-0.1.0.crate'],
  ['leanchecker', 'binary', '4.32.1', '/usr/local/elan/toolchains/leanprover--lean4---v4.32.1/bin/leanchecker'],
  ['lexlean', 'binary', '0.4.0', '/usr/local/bin/lexlean'],
  ['oci-distribution-1.1.1-corpus', 'test-corpus', 'a139cc423184af6078077b9b7ee336eddbd03f8f', 'standards/oracles/oci-distribution-1.1.1', 'tree'],
  ['oci-distribution-conformance', 'oracle', '1.1.1@a139cc42', '/usr/local/bin/oci-distribution-conformance'],
  ['oci-image-1.1.1-corpus', 'test-corpus', '147f9c13cedb47a0c4d9a11a222961073d585877', 'standards/oracles/oci-image-1.1.1', 'tree'],
  ['oci-image-schema-conformance', 'oracle', '1.1.1@147f9c13', '/usr/local/bin/oci-image-schema-conformance'],
  ['oci-runtime-1.3.0-corpus', 'test-corpus', '92249139eea7161e13745abd4cb6d0ea02a3227a', 'standards/oracles/oci-runtime-1.3.0', 'tree'],
  ['oci-runtime-validate', 'oracle', '1.3.0@92249139', '/usr/local/bin/oci-runtime-validate'],
  ['openid-conformance-suite-corpus', 'test-corpus', '3e09b13b896fce95d78c2c0f931feee9614e9452', 'standards/oracles/openid-conformance-suite-3e09b13b', 'tree'],
  ['openid-conformance', 'oracle', '3e09b13b896f', '/usr/local/bin/openid-conformance'],
  ['json-schema-2020-12-corpus', 'test-corpus', 'c9510e3bf8a896c3cba4e08509cf752b4f30dff8', 'standards/corpora/json-schema-2020-12', 'tree'],
  ['in-toto-attestation-1.0-source', 'test-corpus', 'ee16c68a11dfcfbdc891600cacd767896fe6e724', 'standards/oracles/in-toto-attestation-ee16c68a', 'tree'],
  ['intoto-statement-validator', 'oracle', '1.0@ee16c68a', '/usr/local/bin/intoto-statement-validator'],
  ['playwright-chromium', 'oracle', '1.62.1', null, 'sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e'],
  ['playwright-driver', 'oracle', '1.62.1', '/opt/prismpm/oracles/node_modules/playwright', 'tree'],
  ['playwright-core', 'oracle', '1.62.1', '/opt/prismpm/oracles/node_modules/playwright-core', 'tree'],
  ['prismpm', 'binary', '0.4.0', '/usr/local/bin/prismpm'],
  ['prismpm-conformance', 'binary', '0.4.0', '/usr/local/bin/prismpm-conformance'],
  ['prismpm-platform-equivalence', 'binary', '0.4.0', '/usr/local/bin/prismpm-platform-equivalence'],
  ['prism-stdlib', 'crate', '0.2.0', 'stdlib/generated/prism-stdlib-0.2.0.crate'],
  ['runtime-base', 'base-image', 'playwright-v1.62.1-noble', null, 'sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e'],
  ['runtime-os-lock', 'dependency-lock', 'ubuntu-noble@20260901T000000Z', 'sdk/runtime-os.lock'],
  ['sigstore-trusted-root', 'trust-root', 'cosign-3.1.3-default-services', 'standards/trust/sigstore-trusted-root-cosign-3.1.3.json'],
  ['spdx-3.0.1-fixtures', 'test-corpus', '3.0.1', 'standards/corpora/spdx-3.0.1', 'tree'],
  ['spdx-3.0.1-model', 'test-corpus', 'a745f63e8643d5ae0f0851fcfa6836085308f80b', 'standards/oracles/spdx-3.0.1-model', 'tree'],
  ['spdx-3.0.1-schema', 'schema', '3.0.1', 'standards/oracles/spdx-json-schema-3.0.1', 'tree'],
  ['spdx-validator', 'oracle', 'ajv-8.20.0+spdx-3.0.1', '/usr/local/bin/spdx-validator'],
  ['standards-and-oracles', 'oracle', 'prismpm/standards-lock/1', 'standards.lock'],
  ['stdlib-sources', 'crate', '0.2.0-sources', 'sdk/stdlib-sources.tar'],
  ['timeout', 'binary', 'coreutils-9.4', '/usr/bin/timeout'],
  ['unicode-17.0.0-normalization-corpus', 'test-corpus', '17.0.0', 'standards/corpora/unicode-17.0.0', 'tree'],
  ['opentelemetry-0.136.0-signal-corpus', 'test-corpus', '0.136.0', 'standards/corpora/opentelemetry-0.136.0', 'tree'],
  ['workflow-reusable-sdk', 'workflow', '0.4.0', '.github/workflows/sdk.yml'],
];
const inputRoot = '/opt/prismpm/share/vv-inputs';
const inputPolicyBytes = await readFile('/opt/prismpm/share/vv-input-policy.json');
const inputManifestBytes = await readFile(`${inputRoot}/manifest.json`);
const inputPolicy = JSON.parse(inputPolicyBytes), inputManifest = JSON.parse(inputManifestBytes);
definitions.push(
  ['sdk-vv-source', 'test-corpus', inputPolicy.source_revision, `${inputRoot}/source.pack`],
  ['sdk-vv-advisory', 'test-corpus', inputPolicy.advisory_revision, `${inputRoot}/advisory.pack`],
  ['sdk-vv-bootstrap', 'test-corpus', '0.2.0', `${inputRoot}/bootstrap.tar.gz`],
  ['sdk-vv-manifest', 'test-corpus', '1', `${inputRoot}/manifest.json`],
  ['sdk-vv-policy', 'test-corpus', '1', '/opt/prismpm/share/vv-input-policy.json'],
  ['sdk-vv-verifier', 'test-corpus', '1', 'scripts/sdk-vv-inputs.mjs'],
  ['sdk-image-input-verifier', 'test-corpus', '1', 'scripts/sdk-image-inputs.mjs'],
  ['sdk-image-input-authorities', 'test-corpus', '1', 'sdk/vv-inputs.lock.json'],
);
let artifacts;
const dependencies = process.env.PRISMPM_ARTIFACT_INVENTORY
  ? '/opt/prismpm/share/conformance-root/model/dependencies.toml' : 'model/dependencies.toml';
const revision = compilerRevision(await readFile(dependencies, 'utf8'));
if (process.env.PRISMPM_ARTIFACT_INVENTORY) {
  const inventory = JSON.parse(await readFile(process.env.PRISMPM_ARTIFACT_INVENTORY, 'utf8'));
  if (!Array.isArray(inventory.artifacts)) throw new Error('artifact inventory is malformed');
  artifacts = inventory.artifacts;
  if (artifacts.some(row => ['lean4-prod-exporter', 'lean4-prod-exporter-seed'].includes(row.id))) {
    throw new Error('exporter seed must be measured from the final native runtime');
  }
  const exporterManifest = Buffer.from(readSmall('/opt/prismpm/share/exporter-seed/manifest.json', 8 * 1024 * 1024));
  const nativeExporter = snapshotFile('/opt/prismpm/share/exporter-seed/.lake/build/bin/prod-export', 256 * 1024 * 1024);
  const exporterBindings = exporterArtifactBindings(exporterManifest, revision,
    `linux/${{x64: 'amd64', arm64: 'arm64'}[process.arch]}`, nativeExporter);
  artifacts.push(...exporterBindings);
  if (artifacts.some(row => row.id === 'playwright-headless-shell')) throw new Error('browser artifact must be measured from the final runtime');
  artifacts.push({id: 'playwright-headless-shell', kind: 'oracle', version: '157.0.8099.0',
    digest: await treeDigest('/ms-playwright/chromium_headless_shell-cft-157.0.8099.0')});
  artifacts.sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)));
} else {
  artifacts = [];
  for (const [id, kind, version, source, mode] of definitions) {
    let digest;
    if (mode?.startsWith('sha256:')) digest = mode;
    else if (mode === 'tree') digest = await treeDigest(source);
    else {
      const resolved = source.startsWith('/') ? await realpath(source) : source;
      digest = sha(await readFile(resolved));
    }
    artifacts.push({ digest, id, kind, version: id === 'lean4-prod' ? revision : version });
  }
  artifacts.sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)));
}
validateAuthorityMetadata(artifacts, revision);
validateImageInputMetadata(artifacts, inputPolicy, inputManifest, sha(inputManifestBytes), sha(inputPolicyBytes));
const value = process.env.PRISMPM_ARTIFACTS_ONLY === '1'
  ? { artifacts, schema: 'prismpm/sdk-artifact-inventory/1' }
  : { artifacts, commands, schema: 'prismpm/sdk-inventory/1' };
await writeFile(output, encodeInventory(value), { flag: 'wx', mode: 0o444 });
