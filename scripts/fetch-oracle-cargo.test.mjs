import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const helper = 'scripts/fetch-oracle-cargo.sh';
const pinned = [
  'tests/hologram-oracle/Cargo.toml',
  'tests/hologram-oracle/Cargo.lock',
  'tests/holo-codec-oracle/Cargo.toml',
  'tests/holo-codec-oracle/Cargo.lock',
  'tests/holo-browser-codec/Cargo.toml',
  'tests/holo-browser-codec/Cargo.lock',
  'tests/holo-primary-component/driver/Cargo.toml',
  'tests/holo-primary-component/driver/Cargo.lock',
  'tests/browser-pkce/driver/Cargo.toml',
  'tests/browser-pkce/driver/Cargo.lock',
  'tests/browser-session-operation/driver/Cargo.toml',
  'tests/browser-session-operation/driver/Cargo.lock',
  'tests/browser-signed-context/driver/Cargo.toml',
  'tests/browser-signed-context/driver/Cargo.lock',
  'tests/browser-workspace/Cargo.toml',
  'tests/browser-workspace/Cargo.lock',
  'tests/browser-envelope/driver/Cargo.toml',
  'tests/browser-envelope/driver/Cargo.lock',
  'tests/browser-journal/driver/Cargo.toml',
  'tests/browser-journal/driver/Cargo.lock',
  'tests/browser-command/driver/Cargo.toml',
  'tests/browser-command/driver/Cargo.lock',
  'tests/browser-query/driver/Cargo.toml',
  'tests/browser-query/driver/Cargo.lock',
  'tests/browser-view/driver/Cargo.toml',
  'tests/browser-view/driver/Cargo.lock',
  'tests/browser-effects/driver/Cargo.toml',
  'tests/browser-effects/driver/Cargo.lock',
  'tests/browser-presentation/driver/Cargo.toml',
  'tests/browser-presentation/driver/Cargo.lock',
  'tests/browser-p256/driver/Cargo.toml',
  'tests/browser-p256/driver/Cargo.lock',
  'tests/browser-account-genesis/driver/Cargo.toml',
  'tests/browser-account-genesis/driver/Cargo.lock',
  'tests/browser-session/driver/Cargo.toml',
  'tests/browser-session/driver/Cargo.lock',
  'tests/browser-custody/driver/Cargo.toml',
  'tests/browser-custody/driver/Cargo.lock',
  'tests/browser-operation-journal/driver/Cargo.toml',
  'tests/browser-operation-journal/driver/Cargo.lock',
  'tests/publication-admission/driver/Cargo.toml',
  'tests/publication-admission/driver/Cargo.lock',
  'tests/browser-budget/driver/Cargo.toml',
  'tests/browser-budget/driver/Cargo.lock',
  'tests/browser-dynamic-choice/driver/Cargo.toml',
  'tests/browser-dynamic-choice/driver/Cargo.lock',
  'tests/browser-semantic-presentation/driver/Cargo.toml',
  'tests/browser-semantic-presentation/driver/Cargo.lock',
  'tests/browser-session-journal/driver/Cargo.toml',
  'tests/browser-session-journal/driver/Cargo.lock',
  'tests/browser-session-journal/reservation-driver/Cargo.toml',
  'tests/browser-session-journal/reservation-driver/Cargo.lock',
  'tests/browser-session-journal-retention/driver/Cargo.toml',
  'tests/browser-session-journal-retention/driver/Cargo.lock',
  'tests/browser-session-journal-recovery/driver/Cargo.toml',
  'tests/browser-session-journal-recovery/driver/Cargo.lock',
  'tests/browser-session-payloads/driver/Cargo.toml',
  'tests/browser-session-payloads/driver/Cargo.lock',
  'tests/browser-session-recovery-frames/driver/Cargo.toml',
  'tests/browser-session-recovery-frames/driver/Cargo.lock',
  'tests/publication-context-linkage/driver/Cargo.toml',
  'tests/publication-context-linkage/driver/Cargo.lock',
  'sdk/oracles/oscal/Cargo.toml',
  'sdk/oracles/oscal/Cargo.lock',
  'vendor/lean4-prod/rust/Cargo.toml',
  'vendor/lean4-prod/rust/Cargo.lock',
  'crates/prismpm/vendor/hologram-live.tar',
];
const embedded = [
  'crates/prismpm/src/embedded/hologram-oracle.Cargo.toml',
  'crates/prismpm/src/embedded/hologram-oracle.Cargo.lock',
  'crates/prismpm/src/embedded/hologram-oracle.main.rs',
];
const check = (directory, args = ['--check']) => spawnSync('bash', [helper, ...args], {
  cwd: directory, encoding: 'utf8', timeout: 10_000,
});

test('oracle acquisition inputs match reviewed pins and embedded verifier inputs', () => {
  const result = check(root);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(check(root, ['--unknown']).status, 64);
  const script = readFileSync(join(root, helper), 'utf8');
  const catalog = readFileSync(join(root, 'model/dependencies.toml'), 'utf8');
  const live = catalog.split('[[dependency]]').find(row => /^id = "hologram-live"$/m.test(row));
  const upstream = catalog.split('[[dependency]]').find(row => /^id = "uor-hologram"$/m.test(row));
  assert.ok(live && upstream);
  const digest = /^sha256 = "([a-f0-9]{64})"$/m.exec(live)?.[1];
  const revision = /^revision = "([a-f0-9]{40})"$/m.exec(upstream)?.[1];
  assert.ok(digest && revision);
  assert.ok(script.includes(`${digest}  crates/prismpm/vendor/hologram-live.tar`));
  for (const family of ['browser-p256', 'browser-account-genesis', 'browser-session', 'browser-operation-journal', 'publication-admission', 'browser-budget', 'browser-dynamic-choice', 'browser-semantic-presentation', 'browser-session-journal', 'browser-session-journal-retention', 'browser-session-journal-recovery', 'browser-session-payloads', 'browser-session-recovery-frames', 'publication-context-linkage']) for (const file of ['Cargo.toml', 'Cargo.lock']) {
    const path = `tests/${family}/driver/${file}`;
    assert.ok(script.includes('  ' + path + '\n'), 'closed owning acquisition pin: ' + path);
  }
  for (const file of ['Cargo.toml', 'Cargo.lock'])
    assert.ok(script.includes('  sdk/oracles/oscal/' + file + '\n'), 'closed published OSCAL engine pin');
  for (const file of ['Cargo.toml', 'Cargo.lock'])
    assert.ok(script.includes('  vendor/lean4-prod/rust/' + file + '\n'), 'independent packaged compiler graph is pinned');
  for (const file of ['Cargo.toml', 'Cargo.lock'])
    assert.ok(script.includes('  tests/browser-session-journal/reservation-driver/' + file + '\n'), 'independent journal reservation graph is pinned');
  for (const oracle of ['hologram-oracle', 'holo-codec-oracle']) {
    assert.ok(readFileSync(join(root, `tests/${oracle}/Cargo.toml`), 'utf8').includes(`rev = "${revision}"`));
    assert.ok(readFileSync(join(root, `tests/${oracle}/Cargo.lock`), 'utf8').includes(`?rev=${revision}#${revision}`));
  }
});

test('changed pinned inputs and embedded divergence fail before Cargo acquisition', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'prismpm-oracle-fetch-'));
  try {
    const files = [helper, ...pinned, ...embedded, 'tests/hologram-oracle/src/main.rs'];
    for (const path of files) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      copyFileSync(join(root, path), join(scratch, path));
    }
    assert.equal(check(scratch).status, 0);
    for (const path of [...pinned, ...embedded]) {
      appendFileSync(join(scratch, path), '\nchanged\n');
      const result = check(scratch);
      assert.ifError(result.error);
      assert.notEqual(result.status, 0, `accepted modified ${path}`);
      copyFileSync(join(root, path), join(scratch, path));
    }
    assert.equal(check(scratch).status, 0);
  } finally {
    rmSync(scratch, { recursive: true });
  }
});

test('acquisition covers the actual test-manifest census and every registered compiler family', () => {
  const manifests = [];
  const visit = directory => {
    for (const entry of readdirSync(join(root, directory), {withFileTypes: true})) {
      if (['target', 'node_modules', '.git'].includes(entry.name)) continue;
      const path = directory + '/' + entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.name === 'Cargo.toml') {
        assert(entry.isFile(), 'test manifest must be a regular source file: ' + path);
        manifests.push(path);
      }
    }
  };
  visit('tests');
  const script = readFileSync(join(root, helper), 'utf8');
  const checksums = script.split("<<'CHECKSUMS'\n")[1]?.split('\nCHECKSUMS\n')[0];
  assert(checksums);
  const rows = checksums.split('\n').map(line => {
    const row = /^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$/.exec(line);
    assert(row, 'exact acquisition checksum row');
    return row[2];
  });
  assert.equal(new Set(rows).size, rows.length, 'unique acquisition inputs');
  assert.deepEqual([...rows].sort(), [...pinned].sort());
  const loop = script.split('for manifest in ')[1]?.split('; do')[0];
  assert(loop);
  const acquired = loop.replaceAll('\\', '').trim().split(/\s+/);
  assert.equal(acquired[0], '"$oracle_work/harness/Cargo.toml"');
  acquired[0] = 'tests/hologram-oracle/Cargo.toml';
  const registry = readFileSync(join(root, 'tests/browser-view/compiler-owner.mjs'), 'utf8');
  const begin = registry.indexOf('const families = Object.freeze({');
  const end = registry.indexOf('\nconst owners = ', begin);
  assert(begin >= 0 && end > begin);
  const families = [...runInNewContext(
    registry.slice(begin, end) + '\nObject.values(families).map(row => row.directory);',
    {}, {timeout: 1000}
  )].map(directory => 'tests/' + directory + '/driver/Cargo.toml');
  const coverage = (pins, owners, actual = manifests, registered = families) => {
    assert.equal(new Set(owners).size, owners.length, 'unique acquisition owners');
    assert.deepEqual([...owners].sort(), pins.filter(path => path.endsWith('/Cargo.toml')).sort());
    for (const manifest of actual) {
      assert(pins.includes(manifest), 'missing actual manifest pin: ' + manifest);
      assert(pins.includes(manifest.replace('Cargo.toml', 'Cargo.lock')), 'missing actual lock pin: ' + manifest);
      assert(owners.includes(manifest), 'missing actual locked metadata owner: ' + manifest);
    }
    for (const manifest of registered)
      assert(actual.includes(manifest), 'registered compiler family is outside the covered census: ' + manifest);
  };
  coverage(rows, acquired);
  for (const manifest of manifests) {
    assert.throws(() => coverage(rows.filter(path => path !== manifest), acquired), manifest);
    const lock = manifest.replace('Cargo.toml', 'Cargo.lock');
    assert.throws(() => coverage(rows.filter(path => path !== lock), acquired), lock);
    assert.throws(() => coverage(rows, acquired.filter(path => path !== manifest)), manifest);
  }
  const newManifest = 'tests/new-consumer/driver/Cargo.toml';
  assert.throws(() => coverage(rows, acquired, [...manifests, newManifest]), 'new consumer cannot bypass acquisition');
  assert.throws(() => coverage(rows, acquired, manifests, [...families, newManifest]), 'new family cannot bypass the actual census');
});

test('source and SDK acquisition share the helper before the SDK cache is frozen', () => {
  const fetch = readFileSync(join(root, 'scripts/fetch.sh'), 'utf8');
  const dockerfile = readFileSync(join(root, 'sdk/Dockerfile'), 'utf8');
  const invocation = `bash ${helper}`;
  assert.equal(fetch.split(invocation).length, 2);
  assert.equal(dockerfile.split(invocation).length, 2);
  const acquisition = dockerfile.indexOf(invocation);
  const snapshot = dockerfile.indexOf('cp -a /usr/local/cargo/registry /opt/prismpm/cargo-home/');
  assert.ok(acquisition >= 0 && snapshot > acquisition);
});

test('full acquisition loop invokes exactly every reviewed manifest and offline check', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'prismpm-acquisition-arguments-'));
  try {
    const log = join(scratch, 'calls');
    const result = spawnSync('bash', ['-c', `
      cargo() { printf '%s\\0' "$@" >> "$PRISMPM_ACQUIRE_LOG"; printf '\\0' >> "$PRISMPM_ACQUIRE_LOG"; }
      export -f cargo
      bash scripts/fetch-oracle-cargo.sh
    `], {cwd: root, encoding: 'utf8', timeout: 10_000, env: {...process.env, PRISMPM_ACQUIRE_LOG: log}});
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const captured = readFileSync(log, 'utf8');
    assert.ok(captured.endsWith('\0\0'));
    const calls = captured.slice(0, -2).split('\0\0').map(row => row.split('\0'));
    const manifests = pinned.filter(path => path.endsWith('/Cargo.toml'));
    assert.equal(calls.length, manifests.length * 2);
    for (let index = 0; index < manifests.length; index++) {
      const manifest = index === 0 ? calls[0][3] : manifests[index];
      if (index === 0) assert.match(manifest, /^\/[^\0]+\/harness\/Cargo\.toml$/);
      assert.deepEqual(calls[index * 2], ['fetch', '--locked', '--manifest-path', manifest]);
      assert.deepEqual(calls[index * 2 + 1], ['metadata', '--locked', '--offline', '--format-version', '1', '--manifest-path', manifest]);
    }
  } finally {
    rmSync(scratch, {recursive: true});
  }
});
