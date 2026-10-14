// Input/consumer conservation only; actual browser and SDK owners remain required.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const hash = path => createHash('sha256').update(readFileSync(new URL('../' + path, import.meta.url))).digest('hex');
const authority = JSON.parse(read('sdk/browser-engine/authority.json'));
const root = authority.destination;

function inputTable(source) {
  // A closed canonical lock profile, not a general-purpose TOML parser.
  const sections = source.split(/^\[([^\]\n]+)\]\s*$/m);
  const matches = [];
  for (let index = 1; index < sections.length; index += 2) {
    if (sections[index] === 'chromium-headless-input') matches.push(sections[index + 1]);
  }
  assert.equal(matches.length, 1, 'one exact Chromium input table required');
  const table = Object.create(null);
  for (const line of matches[0].trim().split('\n')) {
    const row = /^([a-z][a-z0-9_]*) = "([^"\\]*)"$/.exec(line);
    assert.ok(row, 'only canonical string rows allowed in Chromium input table');
    assert.ok(!Object.hasOwn(table, row[1]), 'duplicate Chromium input field');
    table[row[1]] = row[2];
  }
  assert.deepEqual(Object.keys(table).sort(), ['authority', 'authority_sha256', 'channel',
    'installer', 'installer_sha256', 'version']);
  return table;
}

function verifyInputTable(source) {
  const table = inputTable(source);
  assert.equal(table.version, authority.version);
  assert.equal(table.channel, authority.channel);
  for (const [field, name] of [['authority', 'authority.json'], ['installer', 'install.py']]) {
    assert.equal(table[field], 'sdk/browser-engine/' + name);
    assert.equal(table[field + '_sha256'], hash(table[field]));
  }
}

test('the tool lock binds exact immutable input authority and installer sources', () => {
  verifyInputTable(read('tools.lock'));
  assert.ok(read('sdk/browser-engine/install.py').includes(`LOCK_SHA256 = "${hash('sdk/browser-engine/authority.json')}"`));
  assert.equal(authority.main_branch_point_revision, 1716465);
  assert.equal(authority.compatibility.experimental, true);
  assert.equal(authority.compatibility.driver, 'playwright@1.62.1');
  assert.equal(authority.compatibility.core, 'playwright-core@1.62.1');
});

test('lock joins refuse comments, wrong sections, missing duplicate unknown and changed fields', () => {
  const original = read('tools.lock');
  const table = inputTable(original);
  for (const changed of [
    original.replace('[chromium-headless-input]', '[other-input]'),
    original.replace('[chromium-headless-input]', '# [chromium-headless-input]'),
    original.replace('authority_sha256 = "' + table.authority_sha256 + '"', '# authority_sha256 = "' + table.authority_sha256 + '"'),
    original.replace('authority_sha256 = "' + table.authority_sha256 + '"', ''),
    original.replace('[chromium-headless-input]', '[chromium-headless-input]\nunknown = "not admitted"'),
    original.replace('[chromium-headless-input]', '[chromium-headless-input]\n__proto__ = "not admitted"'),
    original.replace('[chromium-headless-input]', '[chromium-headless-input]\nversion = "157.0.8099.0"'),
    original.replace('[chromium-headless-input]', '[chromium-headless-input]\n[chromium-headless-input]'),
    original.replace('authority_sha256 = "' + table.authority_sha256 + '"', 'authority_sha256 = "' + '0'.repeat(64) + '"'),
    original.replace('version = "157.0.8099.0"', 'version = "151.0.7922.34"'),
  ]) {
    assert.notEqual(changed, original);
    assert.throws(() => verifyInputTable(changed));
  }
});

test('the original model audit always executes the complete input join owner', () => {
  assert.ok(read('xtask/src/main.rs').includes('"scripts/browser-engine-input.test.mjs",'));
  assert.ok(read('xtask/src/audit.rs').includes('audit_chromium_input(root, &lock)?;'));
});

test('every active browser path consumer binds both exact native archive layouts', () => {
  const consumers = [
    'crates/prismpm/src/embedded/hologram-oracle.browser.mjs',
    'crates/prismpm/src/release_verification.rs',
    'scripts/portable-oracle-matrix.mjs',
    'sdk/browser/browser-test-server.mjs',
  ];
  for (const path of consumers) {
    for (const input of Object.values(authority.platforms)) {
      assert.ok(read(path).includes(`${root}/${input.archive_root}/chrome-headless-shell`), path);
    }
  }
  const verifier = read('crates/prismpm/src/browser_oracle.rs');
  assert.ok(verifier.includes(`const BROWSER: &str = "${root}";`));
  assert.ok(verifier.includes(`const BROWSER_X64_SHA: &str = "${authority.platforms.amd64.tree_sha256}";`));
  for (const input of Object.values(authority.platforms)) {
    assert.ok(verifier.includes(`${input.archive_root}/chrome-headless-shell`));
  }
});

test('all positive report owners retain the exact new engine and unchanged driver versions', () => {
  for (const path of [
    'crates/prismpm/src/embedded/hologram-oracle.browser.mjs',
    'crates/prismpm/src/verification.rs',
    'crates/prismpm/tests/hologram_interop.rs',
    'crates/conformance/src/cases/mod.rs',
    'scripts/portable-oracle-observation.mjs',
    'scripts/portable-oracle-submission-probe.mjs',
    'sdk/browser/browser-test-server.mjs',
    'scripts/browser-environment-preflight.test.mjs',
  ]) assert.ok(read(path).includes(authority.version), path);
  const inventory = read('sdk/generate-inventory.mjs');
  assert.ok(inventory.includes(`id: 'playwright-headless-shell', kind: 'oracle', version: '${authority.version}'`));
  assert.ok(inventory.includes(`digest: await treeDigest('${root}')`));
  assert.ok(inventory.includes("['playwright-driver', 'oracle', '1.62.1'"));
  assert.ok(inventory.includes("['playwright-core', 'oracle', '1.62.1'"));
});

test('both real image recipes use the same admitted input and preserve original preflight', () => {
  const development = read('.devcontainer/Dockerfile');
  const sdk = read('sdk/Dockerfile');
  assert.ok(development.includes('COPY sdk/browser-engine/ /opt/prismpm/browser-engine/'));
  assert.ok(sdk.includes('COPY --from=source_inputs --chmod=0444 /prepared/source/sdk/browser-engine/ /opt/prismpm/browser-engine/'));
  for (const recipe of [development, sdk]) {
    assert.ok(recipe.includes('python3 -B /opt/prismpm/browser-engine/install_test.py'));
    assert.ok(recipe.includes('python3 -B /opt/prismpm/browser-engine/install.py --architecture'));
    assert.ok(recipe.includes('mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e'));
  }
  assert.ok(development.includes('runuser -u vscode -- bash /opt/prismpm/browser-environment/scripts/browser-environment-preflight.sh'));
  assert.ok(read('scripts/vv.sh').includes('bash scripts/browser-environment-preflight.sh'));
});
