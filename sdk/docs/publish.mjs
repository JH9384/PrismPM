#!/usr/bin/env node
/**
 * Stage a built site as the tree of the `docs-site` branch, and say whether it
 * differs from what the branch already holds. The workflow commits and pushes;
 * this script only checks the layout, writes the branch's README.md and
 * compares.
 *
 *   node sdk/docs/publish.mjs <site-dir> --commit <sha> [--repository <owner/name>] [--previous <dir>]
 *
 * Prints `changed=true` or `changed=false` on standard output, for
 * $GITHUB_OUTPUT, and the pages that differ on standard error. The commit a
 * spec page's footer names is ignored when comparing (see changed.mjs), and so
 * is README.md, so a main commit that changes no page publishes nothing.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPages } from './changed.mjs';
import { layoutProblems } from './lib/site.mjs';

export const BRANCH = 'docs-site';
export const README = 'README.md';

export function branchReadme({ commit, repository }) {
  return [
    '# Prism docs site',
    '',
    'This branch is generated. Do not edit it, and do not open pull requests against it.',
    'Every push to main that changes a page replaces it with one new commit; nothing here is kept.',
    '',
    `Generated from main at commit ${commit} of https://github.com/${repository} by \`.github/workflows/docs-generate.yml\`.`,
    'The hand-written pages are `docs/site/` on main and the generator is `sdk/docs/`; `sdk/docs/README.md` there describes this layout.',
    '',
  ].join('\n');
}

/**
 * Check the layout, write README.md into the site, and compare with the
 * previous branch tree.
 * @param {string} siteDir the built site, written over with README.md
 * @param {{ commit: string, repository: string, previous?: string | null }} options
 * @returns {{ changed: boolean, added: string[], removed: string[], modified: string[] }}
 */
export function stage(siteDir, { commit, repository, previous = null }) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`--commit must be a full commit id, got ${commit}`);
  const problems = layoutProblems(readdirSync(siteDir).filter((e) => e !== README));
  if (problems.length > 0) throw new Error(`${siteDir} is not the docs site layout: ${problems.join(', ')}`);
  writeFileSync(join(siteDir, README), branchReadme({ commit, repository }));
  if (!previous || !existsSync(join(previous, 'llms.txt'))) return { changed: true, added: [], removed: [], modified: [] };
  const result = changedPages(previous, siteDir);
  const pages = (list) => list.filter((f) => f !== README);
  const added = pages(result.added);
  const removed = pages(result.removed);
  const modified = pages(result.changed);
  return { changed: added.length + removed.length + modified.length > 0, added, removed, modified };
}

function main(argv) {
  const args = [...argv];
  const positional = [];
  const options = { commit: null, repository: 'UOR-Foundation/PrismPM', previous: null };
  while (args.length) {
    const arg = args.shift();
    if (arg === '--commit') options.commit = args.shift();
    else if (arg === '--repository') options.repository = args.shift();
    else if (arg === '--previous') options.previous = resolve(process.cwd(), args.shift());
    else positional.push(arg);
  }
  if (positional.length !== 1 || !options.commit) throw new Error('usage: publish.mjs <site-dir> --commit <sha> [--repository <owner/name>] [--previous <dir>]');
  const result = stage(resolve(process.cwd(), positional[0]), options);
  for (const [label, list] of [['changed', result.modified], ['added', result.added], ['removed', result.removed]]) {
    for (const file of list) console.error(`${label}: ${file}`);
  }
  console.error(result.changed ? `the ${BRANCH} branch needs a new commit` : `no page differs from the ${BRANCH} branch; nothing to publish`);
  console.log(`changed=${result.changed}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
