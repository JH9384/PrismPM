#!/usr/bin/env node
/**
 * Makes each new GitHub Release's body the changelog entry for its version, so the
 * changelog is the one record of what changed. release-please takes the body from the
 * release pull request, which still has its own BREAKING CHANGES heading and no
 * `None.` line.
 *
 *   OUTPUTS='<the action outputs as JSON>' node scripts/release-please-notes.mjs
 *
 * It edits the release body and nothing else. It publishes nothing.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryFor } from '../sdk/docs/lib/changelog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The action names the root package's outputs `tag_name` and any other package's
 * `<path>--tag_name`.
 * @returns {{ path: string, tag: string, version: string, changelog: string }[]}
 */
export function releasedPackages(outputs) {
  return JSON.parse(outputs.paths_released || '[]').map((path) => {
    const prefix = path === '.' ? '' : `${path}--`;
    const [tag, version] = [outputs[`${prefix}tag_name`], outputs[`${prefix}version`]];
    if (!tag || !version) throw new Error(`the action reported ${path} released without a tag and a version`);
    return { path, tag, version, changelog: path === '.' ? 'CHANGELOG.md' : `${path}/CHANGELOG.md` };
  });
}

function main() {
  const released = releasedPackages(JSON.parse(process.env.OUTPUTS || '{}'));
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  try {
    for (const { tag, version, changelog } of released) {
      const body = entryFor(readFileSync(join(ROOT, changelog), 'utf8'), version);
      if (!body) throw new Error(`${changelog} has no entry for ${version}`);
      const file = join(dir, `${tag}.md`);
      writeFileSync(file, body);
      execFileSync('gh', ['release', 'edit', tag, '--notes-file', file], { stdio: 'inherit' });
      console.log(`${tag}: release body is the ${version} entry of ${changelog}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
