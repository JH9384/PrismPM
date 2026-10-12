import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const helper = 'scripts/fetch-oracle-cargo.sh';
const pinned = [
  'tests/hologram-oracle/Cargo.toml',
  'tests/hologram-oracle/Cargo.lock',
  'tests/holo-codec-oracle/Cargo.toml',
  'tests/holo-codec-oracle/Cargo.lock',
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
