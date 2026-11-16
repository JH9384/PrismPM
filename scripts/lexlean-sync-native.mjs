#!/usr/bin/env node
// Imports the native records that native-golden.yml produced for one commit,
// for both architectures, into tests/golden/native. Each record must be the
// exact bytes its review.json lists for that commit; anything else refuses.
//
//   node scripts/lexlean-sync-native.mjs <commit> <artifacts>
//
// <artifacts>/<arch>/ is the downloaded native-golden-review-<arch>-<commit>.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const ARCHITECTURES = Object.freeze(['amd64', 'arm64']);
export const RECORDS = Object.freeze(['golden-manifest.json', 'verified/lexlean-attestation.json', 'verified/manifest.json']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const listed = (root, prefix = '') => readdirSync(join(root, prefix), {withFileTypes: true}).flatMap(entry => {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  assert.ok(!entry.isSymbolicLink(), `symlink in artifact: ${path}`);
  return entry.isDirectory() ? listed(root, path) : [path];
});

// Returns [{target, bytes}] for one architecture after every check passes.
export function verifiedRecords(commit, architecture, artifact) {
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.ok(ARCHITECTURES.includes(architecture));
  const review = JSON.parse(readFileSync(join(artifact, 'review.json'), 'utf8'));
  assert.equal(review.schema, 'prismpm/native-golden-review/1');
  assert.equal(review.status, 'review-required');
  assert.equal(review.source_revision, commit, 'records belong to another commit');
  assert.equal(review.platform, `linux-${architecture}-ubuntu-24.04`);
  assert.deepEqual(review.records.map(row => row.path), RECORDS);
  assert.deepEqual(listed(join(artifact, 'records')).sort(), [...RECORDS].sort(), 'artifact records differ from review.json');
  return review.records.map(row => {
    const source = join(artifact, 'records', row.path);
    assert.ok(lstatSync(source).isFile());
    const bytes = readFileSync(source);
    assert.equal(bytes.length, row.byte_length, `${row.path} length`);
    assert.equal(sha256(bytes), row.sha256, `${row.path} digest`);
    return {target: `tests/golden/native/linux-${architecture}-ubuntu-24.04/${row.path}`, bytes};
  });
}

export function importRecords(root, commit, artifacts) {
  // Verify both architectures before writing either.
  const rows = ARCHITECTURES.flatMap(architecture => verifiedRecords(commit, architecture, join(artifacts, architecture)));
  for (const {target, bytes} of rows) writeFileSync(join(root, target), bytes);
  return rows.map(row => row.target);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [commit, artifacts] = process.argv.slice(2);
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  process.stdout.write(importRecords(root, commit, artifacts).join('\n') + '\n');
}
