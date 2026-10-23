#!/usr/bin/env node
/**
 * The vocabulary lint. It applies the docs style guide's banned-word list
 * to Markdown prose and reports every hit as `file:line: word`, then exits 1.
 *
 *   node sdk/docs/lint.mjs               lint docs/generated and the site docs
 *   node sdk/docs/lint.mjs <path>...     lint these files or directories
 *
 * Prose is every line outside a fenced code block, with inline code spans
 * removed. Identifiers inside code are the sources' own names and are not
 * vocabulary. Two identifiers are allowed in prose: the predicate type URIs
 * and the site hostname. Em dashes and emoji are reported on every line.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED, BANNED, STYLE } from './lib/banned.mjs';
import { ROOT } from './lib/spec.mjs';

/**
 * Engineering records under docs/ that cite issues and internal names by
 * design, and the vocabulary page, which maps the docs' terms onto the
 * repository's own names and so must name them.
 */
export const EXCLUDED = ['docs/adr', 'docs/decisions', 'docs/proposals', 'docs/release', 'docs/vocabulary.md'];

export function defaultTargets() {
  const docs = join(ROOT, 'docs');
  return [docs];
}

function markdownFiles(target, out = []) {
  const rel = relative(ROOT, target).split(sep).join('/');
  if (EXCLUDED.some((e) => rel === e || rel.startsWith(`${e}/`))) return out;
  if (statSync(target).isDirectory()) {
    for (const entry of readdirSync(target).sort()) markdownFiles(join(target, entry), out);
  } else if (/\.(md|txt)$/.test(target)) out.push(target);
  return out;
}

function prose(line) {
  let text = line.replace(/`[^`]*`/g, ' ');
  for (const allowed of ALLOWED) text = text.replace(allowed, ' ');
  return text;
}

/** @returns {{ file: string, line: number, word: string, text: string }[]} */
export function lintText(text, file) {
  const hits = [];
  let inFence = false;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    for (const rule of STYLE) {
      if (rule.pattern.test(raw)) hits.push({ file, line, word: rule.name, text: raw });
    }
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const p = prose(raw);
    for (const rule of BANNED) {
      if (rule.pattern.test(p)) hits.push({ file, line, word: rule.name, text: raw });
    }
  });
  return hits;
}

export function lint(targets) {
  const files = targets.flatMap((t) => (existsSync(t) ? markdownFiles(t) : []));
  const name = (f) => {
    const rel = relative(ROOT, f);
    return rel.startsWith('..') ? f : rel.split(sep).join('/');
  };
  return { files, hits: files.flatMap((f) => lintText(readFileSync(f, 'utf8'), name(f))) };
}

function main(argv) {
  const targets = argv.length ? argv.map((a) => resolve(process.cwd(), a)) : defaultTargets();
  const { files, hits } = lint(targets);
  for (const hit of hits) console.error(`${hit.file}:${hit.line}: ${hit.word}: ${hit.text.trim()}`);
  if (hits.length) {
    console.error(`${hits.length} hit(s) in ${files.length} file(s)`);
    return 1;
  }
  console.log(`vocabulary ok: ${files.length} file(s)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
