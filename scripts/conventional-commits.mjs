#!/usr/bin/env node
/**
 * Conventional Commits on a pull request. release-please reads subjects on main to
 * choose the version and write the changelog, and skips any subject it cannot parse,
 * so a breaking change under a free-form subject would ship as a patch.
 *
 * What reaches main depends on how the pull request merges:
 *   - squash, more than one commit: the pull request title is the subject;
 *   - squash, one commit: that commit's subject is the subject, because the repository
 *     sets squash_merge_commit_title to COMMIT_OR_PR_TITLE;
 *   - merge or rebase: every commit's subject reaches main.
 *
 * So the title must conform, and so must a lone commit. In a longer pull request other
 * subjects are reported as warnings, since a squash drops them.
 *
 *   node scripts/conventional-commits.mjs --title <title> --commits <file>
 *
 * <file> holds a JSON array of full commit messages, oldest first. The accepted types
 * are the ones release-please-config.json puts in the changelog, plus revert.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function allowedTypes(config = JSON.parse(readFileSync(join(ROOT, 'release-please-config.json'), 'utf8'))) {
  return [...new Set(config['changelog-sections'].map((section) => section.type))];
}

/** @returns {string|null} why the subject does not conform, or null when it does. */
export function subjectProblem(subject, types = allowedTypes()) {
  const match = /^([a-z]+)(\(([^()]*)\))?(!)?: (.*)$/.exec(subject);
  if (!match) return `"${subject}" is not "type(scope): subject"`;
  const [, type, scoped, scope, , text] = match;
  if (!types.includes(type)) return `"${type}" is not a type here: use one of ${types.join(', ')}`;
  if (scoped && !/^[a-z0-9][a-z0-9._/-]*(, ?[a-z0-9][a-z0-9._/-]*)*$/.test(scope)) return `scope "${scope}" must be lowercase words, separated by commas`;
  if (!text.trim() || text !== text.trimStart()) return 'the subject after the colon must start with text';
  return null;
}

const isMerge = (subject) => /^Merge (pull request|branch|remote-tracking branch|remote branch) /.test(subject);

/** @returns {{ errors: string[], warnings: string[] }} */
export function checkPullRequest({ title, commits, types = allowedTypes() }) {
  const errors = [];
  const warnings = [];
  const titleProblem = subjectProblem(title, types);
  if (titleProblem) errors.push(`pull request title: ${titleProblem}`);

  const subjects = commits.map((message) => message.split(/\r?\n/, 1)[0]);
  const authored = subjects.filter((subject) => !isMerge(subject));
  if (authored.length === 1) {
    const problem = subjectProblem(authored[0], types);
    if (problem) errors.push(`the only commit, whose subject a squash merge keeps: ${problem}`);
  } else {
    for (const subject of authored) {
      const problem = subjectProblem(subject, types);
      if (problem) warnings.push(`commit: ${problem}; a squash merge drops it, any other merge keeps it`);
    }
  }
  return { errors, warnings };
}

function main() {
  const { values } = parseArgs({ options: { title: { type: 'string' }, commits: { type: 'string' } } });
  if (values.title === undefined || values.commits === undefined) throw new Error('usage: conventional-commits.mjs --title <title> --commits <file>');
  const { errors, warnings } = checkPullRequest({ title: values.title, commits: JSON.parse(readFileSync(values.commits, 'utf8')) });
  for (const warning of warnings) console.log(`::warning::${warning}`);
  for (const error of errors) console.log(`::error::${error}`);
  if (errors.length) {
    console.error('release-please reads these subjects. A breaking change is feat(scope)!: subject, or a BREAKING CHANGE: footer. See CONTRIBUTING.md.');
    return 1;
  }
  console.log(`conventional commits ok: "${values.title}"`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
