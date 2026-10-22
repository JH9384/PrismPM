// Test-only lifecycle for completed, privately staged compiler tool caches.
import assert from 'node:assert/strict';
import {closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync,
  realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {repository, run, sha} from './compile.mjs';

const owners = Object.freeze({
  'holo-primary-component': {directory:'holo-primary-component', executable:'holo-primary-component-driver'},
  'session-retention': {directory:'browser-session-journal-retention', executable:'browser-session-journal-retention-driver'},
  'session-payloads': {directory:'browser-session-payloads', executable:'browser-session-payloads-driver'},
  publication: {directory:'publication-admission', executable:'publication-admission-driver'},
  budget: {directory:'browser-budget', executable:'browser-budget-driver'},
  session: {directory:'browser-session', executable:'browser-session-driver'},
  'session-journal': {directory:'browser-session-journal', executable:'browser-session-journal-driver'},
  'session-recovery-frames': {directory:'browser-session-recovery-frames', executable:'browser-session-recovery-frames-driver'},
  'session-journal-recovery': {directory:'browser-session-journal-recovery', executable:'browser-session-journal-recovery-driver'},
  effects: {directory:'browser-effects', executable:'browser-effects-driver'},
  custody: {directory:'browser-custody', executable:'browser-custody-driver'},
  'operation-journal': {directory:'browser-operation-journal', executable:'browser-operation-journal-driver'},
  presentation: {directory:'browser-presentation', executable:'browser-presentation-driver'},
  'semantic-presentation': {directory:'browser-semantic-presentation', executable:'browser-semantic-presentation-driver'},
  'dynamic-choice': {directory:'browser-dynamic-choice', executable:'browser-dynamic-choice-driver'},
  view: {repositoryManifest:'tests/browser-view/driver/Cargo.toml', executable:'browser-workspace-view-driver'},
  journal: {repositoryManifest:'tests/browser-journal/driver/Cargo.toml', executable:'browser-workspace-journal-driver'},
  query: {repositoryManifest:'tests/browser-query/driver/Cargo.toml', executable:'browser-workspace-query-driver'},
  command: {repositoryManifest:'tests/browser-command/driver/Cargo.toml', executable:'browser-workspace-command-driver'},
});

function directory(path, owned = true) {
  assert.equal(realpathSync(path), path, 'compiler cache ancestor cannot be aliased');
  const stat = lstatSync(path);
  assert(stat.isDirectory() && (!owned || stat.uid === process.getuid()), 'owned compiler cache directory required');
}

function capture(path, maximum, owned = true) {
  directory(dirname(path), owned);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint:true});
    assert(before.isFile() && (!owned || before.uid === BigInt(process.getuid())) && before.size <= BigInt(maximum),
      'bounded owned regular compiler input required');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      assert(count > 0, 'compiler input shortened'); offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0, 'compiler input grew');
    for (const after of [fstatSync(fd, {bigint:true}), lstatSync(path, {bigint:true})]) {
      assert(after.isFile(), 'compiler input replaced');
      for (const key of ['dev','ino','size','mode','mtimeNs','ctimeNs']) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { closeSync(fd); }
}

// Call only after the final synchronous driver/exporter invocation, terminated
// owned process groups, pinned source checks and complete generated artifacts.
// This removes reconstructible tool caches, not source, proof or product output.
export function retireCompletedCompilerCaches(work, owner) {
  assert(Object.hasOwn(owners, owner), 'unregistered private compiler owner');
  directory(work);
  assert.equal(dirname(work), realpathSync(tmpdir()), 'fresh private temporary work required');
  assert.match(basename(work), new RegExp('^prismpm-' + owner + '-[A-Za-z0-9]+$'), 'owned work prefix required');
  const selected = owners[owner], target = join(work, 'driver-target');
  // Older fixtures compile directly from the read-only SDK source tree. Only
  // these closed manifests may be external; every cleaned path remains owned
  // private work. Source ownership is not cache ownership.
  const manifest = selected.repositoryManifest ? join(repository, selected.repositoryManifest)
    : join(work, 'tests', selected.directory, 'driver/Cargo.toml');
  const driver = join(target, 'debug', selected.executable);
  const exporter = join(work, 'exporter'), build = join(exporter, '.lake/build');
  const receiptPath = join(work, 'compiler-cache-retirement.json');
  assert.equal(lstatSync(receiptPath, {throwIfNoEntry:false}), undefined, 'cache retirement cannot overwrite evidence');
  for (const path of [target, exporter, build]) directory(path);
  assert.equal(capture(join(target, 'CACHEDIR.TAG'), 4096).toString().split('\n')[0],
    'Signature: 8a477f597d28d172789f06886806bc55', 'actual Cargo cache tag required');
  const inputs = [manifest, driver, join(exporter, 'lakefile.lean'), join(build, 'bin/prod-export')];
  const records = inputs.map(path => {
    const external = path === manifest && selected.repositoryManifest;
    const bytes = capture(path, 256 * 1024 ** 2, !external);
    return {path:external ? 'repository/' + selected.repositoryManifest : path.slice(work.length + 1),
      byte_length:bytes.length, sha256:sha(bytes)};
  });
  const receipt = {scope:'completed-private-tool-caches-only', owner, records};
  writeFileSync(receiptPath, JSON.stringify(receipt) + '\n', {flag:'wx', mode:0o444});
  run('cargo', ['clean', '--manifest-path', manifest, '--target-dir', target], work);
  run('lake', ['clean'], exporter);
  assert(!existsSync(driver) && !existsSync(build), 'completed tool caches must be removed');
  return receipt;
}
