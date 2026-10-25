#!/usr/bin/env node
/**
 * Which generated pages a change touches. Nothing generated is committed, so a
 * reviewer cannot see a page diff in the pull request; CI generates the site
 * for the base branch and for the pull request and runs this on the two.
 *
 *   node sdk/docs/changed.mjs <base-dir> <head-dir> [--markdown <file>] [--diff <file>]
 *
 * The footer of a spec page names the commit it was generated from, which
 * differs between any two checkouts. It is replaced before comparing, so only
 * a real change to a page shows. Exit status is 0 whether or not pages differ.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The longest diff the Markdown summary carries; the full diff goes to its own file. */
const SUMMARY_LIMIT = 200_000;

function listFiles(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

/** Page text with CRLF folded and the generating commit in the footer replaced. */
export function normalize(text) {
  return text.replace(/\r\n/g, '\n').replace(/ at [0-9a-f]{40}\.\n/g, ' at <commit>.\n');
}

function copyNormalized(from, to) {
  for (const rel of listFiles(from)) {
    mkdirSync(dirname(join(to, rel)), { recursive: true });
    writeFileSync(join(to, rel), normalize(readFileSync(join(from, rel), 'utf8')));
  }
}

/**
 * @param {string} baseDir the site generated for the base branch
 * @param {string} headDir the site generated for the change
 * @returns {{ added: string[], removed: string[], changed: string[], diff: string }}
 */
export function changedPages(baseDir, headDir) {
  const baseFiles = new Set(listFiles(baseDir));
  const headFiles = new Set(listFiles(headDir));
  const added = [...headFiles].filter((f) => !baseFiles.has(f));
  const removed = [...baseFiles].filter((f) => !headFiles.has(f));
  const temp = mkdtempSync(join(tmpdir(), 'prism-docs-changed-'));
  try {
    copyNormalized(baseDir, join(temp, 'a'));
    copyNormalized(headDir, join(temp, 'b'));
    const changed = [...headFiles].filter(
      (f) => baseFiles.has(f) && readFileSync(join(temp, 'a', f), 'utf8') !== readFileSync(join(temp, 'b', f), 'utf8'),
    );
    const diff = spawnSync('git', ['diff', '--no-index', '--no-color', '-U2', '--', 'a', 'b'], { cwd: temp, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (diff.status !== 0 && diff.status !== 1) throw new Error(`git diff failed: ${diff.stderr}`);
    return { added, removed, changed, diff: stripSides(diff.stdout) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** git names the two sides a/ and b/ in its headers, and --no-index adds the folder names a and b: leave the page path. */
function stripSides(diff) {
  const header = /^(diff --git |--- |\+\+\+ )/;
  return diff
    .split('\n')
    .map((line) => (header.test(line) ? line.replace(/(^|\s)[ab]\/[ab]\//g, '$1') : line))
    .join('\n');
}

const page = (file) => file.replace(/\.(md|txt)$/, '');

/** The Markdown a job summary shows. */
export function summary({ added, removed, changed, diff }, { baseLabel = 'the base branch' } = {}) {
  const lines = [`## Docs changed against ${baseLabel}`, ''];
  const total = added.length + removed.length + changed.length;
  if (total === 0) {
    lines.push('No generated page differs.');
    return `${lines.join('\n')}\n`;
  }
  lines.push(`${changed.length} page(s) changed, ${added.length} added, ${removed.length} removed.`, '');
  for (const [label, list] of [['Changed', changed], ['Added', added], ['Removed', removed]]) {
    if (list.length === 0) continue;
    lines.push(`**${label}**`, '', ...list.map((f) => `- \`${page(f)}\``), '');
  }
  const shown = diff.length > SUMMARY_LIMIT ? `${diff.slice(0, SUMMARY_LIMIT)}\n... (truncated, the full diff is in the docs-diff artifact)\n` : diff;
  lines.push('<details><summary>Diff</summary>', '', '```diff', shown.replace(/\n+$/, ''), '```', '', '</details>');
  return `${lines.join('\n')}\n`;
}

function main(argv) {
  const args = [...argv];
  const positional = [];
  let markdown = null;
  let diffOut = null;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--markdown') markdown = resolve(process.cwd(), args.shift());
    else if (arg === '--diff') diffOut = resolve(process.cwd(), args.shift());
    else positional.push(arg);
  }
  if (positional.length !== 2) throw new Error('usage: changed.mjs <base-dir> <head-dir> [--markdown <file>] [--diff <file>]');
  const [base, head] = positional.map((p) => resolve(process.cwd(), p));
  const result = changedPages(base, head);
  const text = summary(result);
  if (markdown) writeFileSync(markdown, text);
  else process.stdout.write(text);
  if (diffOut) writeFileSync(diffOut, result.diff);
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
