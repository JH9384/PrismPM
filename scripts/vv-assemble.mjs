#!/usr/bin/env node
// Writes V&V acceptance evidence only from every passed part record of
// one commit. Reasons for the split are in SPEC.md, next to the 15 gates.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assembleVvEvidence, vvParts} from './sdk-vv-run.mjs';

// The one list of V&V parts. Every other script and workflow matrix derives
// from it (sdk-vv-run.mjs re-exports it as vvParts; release.yml is checked
// against it by release-gate-evidence.test.mjs).
export const parts = Object.freeze(['conformance', 'dk-0-1', 'dk-2', 'dk-3', 'gates', 'ho-oc', 'source', 'st-sy']);

export function assemble(directory, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  assert.deepEqual(readdirSync(directory).sort(), parts.map(part => `vv-part-${part}.json`), 'exactly the part records required');
  return assembleVvEvidence(new Map(parts.map(part => {
    const bytes = readFileSync(join(directory, `vv-part-${part}.json`));
    return [part, bytes];
  })), revision);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length === 3 && process.argv[2] === '--list') {
    console.log(parts.join('\n'));
    process.exit(0);
  }
  const [directory, output, revision, ...extra] = process.argv.slice(2);
  assert(directory && output && revision && extra.length === 0, 'usage: vv-assemble.mjs PARTS_DIRECTORY OUTPUT REVISION | --list');
  writeFileSync(output, assemble(directory, revision), {flag: 'wx', mode: 0o644});
  console.log(`All ${parts.length} V&V parts and 15 gates PASSED for commit ${revision}.`);
}
