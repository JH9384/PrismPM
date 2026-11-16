#!/usr/bin/env node
// Moves every hard-coded LexLean pin from the registered revision and version
// to a new one. model/dependencies.toml stays the register: this script reads
// the current pin from it and leaves it for scripts/reconcile-lexlean.mjs,
// which rewrites it together with the vendored package and its digests.
//
//   node scripts/lexlean-pin.mjs <revision> <version>
//
// lexlean-pin.test.mjs fails when a tracked file outside these sites starts
// carrying the pin, so a new hard-coded copy cannot be missed by a bump.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const REPOSITORY = join(dirname(fileURLToPath(import.meta.url)), '..');

// Files that carry the full 40-hex revision.
export const REVISION_SITES = Object.freeze([
  '.github/workflows/m0-lexlean-reconcile.yml',
  'AGENTS.md',
  'SPEC.md',
  'scripts/reconcile-lexlean.test.mjs',
  'xtask/src/audit.rs',
]);

// Files that carry the package version, and the literal phrases that carry it.
// `{v}` is the version; `{re}` is the version as escaped in a regex literal.
export const VERSION_SITES = Object.freeze({
  '.github/workflows/release.yml': ['wait_for_crate lexlean {v}'],
  'Cargo.toml': ['lexlean = { version = "{v}", path = "vendor/lexlean" }'],
  'SPEC.md': ['LexLean {v} package', 'lexlean-{v}.crate'],
  // release.yml is projected from this fragment; a bump rewrites both alike.
  'prism-factory/jobs/crates.yml': ['wait_for_crate lexlean {v}'],
  'crates/prismpm/src/input_lock.rs': ['pinned["lexlean"], "{v}"'],
  'scripts/package-release-crates.sh': ['lexlean-{v}.crate', 'public_checksum lexlean {v}', 'lexlean {v} must'],
  'scripts/reconcile-lexlean.mjs': ["LEXLEAN_VERSION='{v}'"],
  'scripts/reconcile-lexlean.test.mjs': ['lexlean-{v}.crate', 'version = "{v}"'],
  'scripts/release-phases.test.mjs': ['wait_for_crate lexlean {v}', 'wait_for_crate lexlean {re}'],
  'xtask/src/audit.rs': ['lexlean-{v}'],
});

const fill = (phrase, version) =>
  phrase.replaceAll('{v}', version).replaceAll('{re}', version.replaceAll('.', '\\.'));

export function registered(dependencies) {
  const start = dependencies.indexOf('[[dependency]]\nid = "lexlean"\n');
  assert.ok(start >= 0, 'model/dependencies.toml has no LexLean row');
  const row = dependencies.slice(start, dependencies.indexOf('\n[[dependency]]', start + 1) >>> 0);
  const version = row.match(/^version = "(\d+\.\d+\.\d+)"$/m)?.[1];
  const revision = row.match(/^revision = "([0-9a-f]{40})"$/m)?.[1];
  assert.ok(version && revision, 'LexLean row lacks an exact version or revision');
  return {version, revision};
}

// Returns the rewritten text of one file. Every declared phrase must be
// present, so a site that silently stops matching fails the bump.
export function rewrite(path, text, from, to) {
  let out = text;
  if (REVISION_SITES.includes(path) && from.revision !== to.revision) {
    assert.ok(out.includes(from.revision), `${path} no longer carries ${from.revision}`);
    out = out.replaceAll(from.revision, to.revision);
  }
  if (path in VERSION_SITES && from.version !== to.version) {
    for (const phrase of VERSION_SITES[path]) {
      const old = fill(phrase, from.version);
      assert.ok(out.includes(old), `${path} no longer carries ${old}`);
      out = out.replaceAll(old, fill(phrase, to.version));
    }
  }
  return out;
}

export function pin(root, to) {
  assert.match(to.revision, /^[0-9a-f]{40}$/, 'revision must be a full commit hash');
  assert.match(to.version, /^\d+\.\d+\.\d+$/, 'version must be exact');
  const from = registered(readFileSync(join(root, 'model/dependencies.toml'), 'utf8'));
  const changed = [];
  for (const path of new Set([...REVISION_SITES, ...Object.keys(VERSION_SITES)])) {
    const before = readFileSync(join(root, path), 'utf8');
    const after = rewrite(path, before, from, to);
    if (after !== before) { writeFileSync(join(root, path), after); changed.push(path); }
  }
  return {from, to, changed};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [revision, version] = process.argv.slice(2);
  if (!revision || !version) {
    process.stderr.write('usage: node scripts/lexlean-pin.mjs <revision> <version>\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(pin(REPOSITORY, {revision, version})) + '\n');
}
