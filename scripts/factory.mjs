#!/usr/bin/env node
// The release plumbing of the Prism factory (factory/src/Factory/Release.lex.tex).
//
// Routes, identities and receipts are decided by the certified factory core
// (prism-factory/: `factory.sh actions-route` and `route-record`), whose
// source V&V obligation reads every path except this plumbing. What remains
// here: the plumbing list itself, κ (the source tree without the plumbing,
// which release-gate-evidence.mjs checks a source receipt against), the
// plumbing's own tests, and the qualification candidate of release-qualify.yml.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const repository = 'UOR-Foundation/prismpm';

// Mirrors `plumbing` in factory/src/Factory/Release.lex.tex; factory.test.mjs
// keeps the two equal. Entries ending in `/` are directory prefixes.
export const plumbing = Object.freeze([
  '.github/workflows/release-cut.yml',
  '.github/workflows/release-qualify.yml',
  '.github/workflows/release.yml',
  'factory/',
  'prism-factory/',
  'scripts/browser-api-sdk-check.test.mjs',
  'scripts/ci-capacity.test.mjs',
  'scripts/factory.mjs',
  'scripts/factory.test.mjs',
  'scripts/lexlean-pin.test.mjs',
  'scripts/library-sdk-check.test.mjs',
  'scripts/product-sdk-check.test.mjs',
  'scripts/release-gate-evidence.mjs',
  'scripts/release-gate-evidence.test.mjs',
  'scripts/release-native-contract.test.mjs',
  'scripts/release-phases.md',
  'scripts/release-phases.mjs',
  'scripts/release-phases.test.mjs',
  'scripts/release-publication.mjs',
  'scripts/release-publication.test.mjs',
  'scripts/release-rebuild.sh',
  'scripts/rust-oracle-tools-inputs.test.mjs',
  'scripts/sdk-candidate-sbom.test.mjs',
  'scripts/sdk-construction-handoff.test.mjs',
  'scripts/sdk-image-inputs.test.mjs',
  'scripts/sdk-release-evidence.mjs',
  'scripts/sdk-release-evidence.test.mjs',
  'scripts/sdk-vv-check.test.mjs',
  'scripts/unpublished-sdk-qualification.test.mjs',
]);

export const isPlumbing = path => plumbing.some(entry => entry.endsWith('/') ? path.startsWith(entry) : path === entry);

const git = (root, args) => execFileSync('git', args, {cwd: root, maxBuffer: 256 * 1024 * 1024});
const oid = value => assert.match(value, /^[0-9a-f]{40}$/);

// κ of one commit: every tracked entry (mode, type, object id, path) of its
// tree in Git's order, without the plumbing.
export function kappa(root, revision) {
  oid(revision);
  const listing = git(root, ['ls-tree', '-r', '-z', '--full-tree', revision]);
  const hash = createHash('sha256');
  let entries = 0;
  for (const row of listing.toString('utf8').split('\0')) {
    if (row === '') continue;
    const match = row.match(/^([0-7]{6}) (blob|commit) ([0-9a-f]{40})\t(.+)$/s);
    assert(match, 'unexpected Git tree entry');
    if (isPlumbing(match[4])) continue;
    hash.update(`${match[1]} ${match[2]} ${match[3]}\t${match[4]}\n`);
    entries += 1;
  }
  assert(entries > 0, 'empty source tree');
  return hash.digest('hex');
}

// The plumbing's own tests: run fresh by every release, since κ leaves them out.
export function plumbingTests(root) {
  const files = git(root, ['ls-files', '-z']).toString('utf8').split('\0');
  return files.filter(path => path.endsWith('.test.mjs') && isPlumbing(path)).sort();
}

export const isAncestor = (root, ancestor, revision) =>
  spawnSync('git', ['merge-base', '--is-ancestor', ancestor, revision], {cwd: root}).status === 0;

// A qualification candidate: the newest release-line run whose images were
// all built, indexed and signed, with their identities still retained. Check
// changes are proved against these images before they merge
// (.github/workflows/release-qualify.yml); the merged commit's own release run
// still checks its own images.
export const imageJobs = 7;
// The branches a release rehearsal runs on: main and release/vMAJOR.MINOR.
export const releaseLine = branch => branch === 'main' || /^release\/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(branch ?? '');
export function findCandidate(root, revision, client) {
  oid(revision);
  const runs = client.api(`repos/${repository}/actions/workflows/release.yml/runs?per_page=100`).workflow_runs;
  for (const run of runs) {
    if (!['push', 'workflow_dispatch'].includes(run.event) || !releaseLine(run.head_branch)) continue;
    if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) continue;
    if (run.path !== '.github/workflows/release.yml' && !String(run.path).startsWith('.github/workflows/release.yml@')) continue;
    if (!/^[0-9a-f]{40}$/.test(run.head_sha) || !isAncestor(root, run.head_sha, revision)) continue;
    const jobs = client.api(`repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`).jobs;
    const images = jobs.filter(job => job.name.startsWith('images ('));
    const platforms = jobs.filter(job => job.name.startsWith('image-platforms ('));
    if (images.length !== imageJobs || platforms.length !== 2) continue;
    if (![...images, ...platforms].every(job => job.conclusion === 'success')) continue;
    const artifacts = client.api(`repos/${repository}/actions/runs/${run.id}/artifacts?name=sdk-image`).artifacts;
    if (!artifacts.some(artifact => artifact.name === 'sdk-image' && !artifact.expired)) continue;
    return {run_id: String(run.id), revision: run.head_sha};
  }
  throw new Error('no release-line run with retained, signed candidate images is an ancestor of this revision');
}

function gh(path) {
  const result = spawnSync('gh', ['api', path], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `GitHub API request failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, ...args] = process.argv.slice(2);
  const root = resolve('.');
  if (operation === 'kappa' && args.length === 1) process.stdout.write(`${kappa(root, args[0])}\n`);
  else if (operation === 'tests' && args.length === 0) process.stdout.write(plumbingTests(root).join('\n') + '\n');
  else if (operation === 'checks' && args.length === 0) {
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...plumbingTests(root)], {stdio: 'inherit'});
    process.exit(result.status ?? 1);
  } else if (operation === 'candidate' && args.length === 1) {
    // Qualification runs only for changes proposed to the release line.
    assert.ok(releaseLine(process.env.GITHUB_BASE_REF), 'release-line pull request required');
    const found = findCandidate(root, args[0], {api: gh});
    process.stdout.write(`run-id=${found.run_id}\nrevision=${found.revision}\n`);
  } else {
    console.error('usage: factory.mjs kappa REV | tests | checks | candidate REV');
    process.exit(64);
  }
}
