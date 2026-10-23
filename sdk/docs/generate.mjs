#!/usr/bin/env node
/**
 * Generate the Reference and API pages, llms.txt and llms-full.md into
 * docs/generated/, or check that the committed output is what the sources
 * produce.
 *
 *   node sdk/docs/generate.mjs                 write docs/generated/
 *   node sdk/docs/generate.mjs --check         regenerate into a temp dir, diff, exit 1 naming each page that differs
 *   node sdk/docs/generate.mjs --pin <commit>  pin the spec package at <commit>, then write
 *   node sdk/docs/generate.mjs --out <dir>     write somewhere else
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './lib/generate.mjs';
import { ROOT, SPEC_SUBDIR, pin, readLock, workingSpecDigest } from './lib/spec.mjs';

export const OUT_DIR = join(ROOT, 'docs', 'generated');

function listFiles(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

export function writeOutput(files, dir) {
  for (const [rel, text] of files) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}

const normalize = (text) => text.replace(/\r\n/g, '\n');

/** A directory as the message names it: repository-relative when inside the repository. */
function shown(dir) {
  const rel = relative(ROOT, dir);
  return rel && !rel.startsWith('..') ? rel.split(sep).join('/') : dir;
}

/** Compare generated files with a directory. Returns the list of differing pages. */
export function diffAgainst(files, dir) {
  const problems = [];
  const committed = new Set(listFiles(dir));
  for (const [rel, text] of files) {
    const path = join(dir, rel);
    if (!existsSync(path)) problems.push(`${rel}: missing from ${shown(dir)}`);
    else if (normalize(readFileSync(path, 'utf8')) !== normalize(text)) problems.push(`${rel}: differs from the generated page`);
    committed.delete(rel);
  }
  for (const rel of committed) problems.push(`${rel}: not produced by the generator`);
  return problems;
}

/** The working tree's spec package, when present, must match the pin. */
export function pinProblems() {
  const lock = readLock();
  const working = workingSpecDigest();
  if (working === null || working === lock.digest) return [];
  return [`${SPEC_SUBDIR}: differs from the pinned spec (commit ${lock.commit}). Run node sdk/docs/generate.mjs --pin <commit> and commit the regenerated pages.`];
}

async function main(argv) {
  const args = [...argv];
  let check = false;
  let out = OUT_DIR;
  let pinTo = null;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--check') check = true;
    else if (arg === '--out') out = resolve(process.cwd(), args.shift());
    else if (arg === '--pin') pinTo = args.shift();
    else throw new Error(`unknown argument ${arg}`);
  }
  if (pinTo) {
    const lock = await pin(pinTo);
    console.log(`pinned ${lock.package} at ${lock.commit} (${lock.digest})`);
  }
  const files = await render();
  if (!check) {
    writeOutput(files, out);
    console.log(`wrote ${files.size} files to ${shown(out)}`);
    return 0;
  }
  const temp = mkdtempSync(join(tmpdir(), 'prism-docs-'));
  try {
    writeOutput(files, temp);
    const problems = [...pinProblems(), ...diffAgainst(files, out)];
    if (problems.length === 0) {
      console.log(`docs/generated is current: ${files.size} files`);
      return 0;
    }
    for (const problem of problems) console.error(`drift: ${problem}`);
    console.error(`${problems.length} problem(s). Run node sdk/docs/generate.mjs and commit the result.`);
    return 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.stack ?? String(error));
      process.exit(2);
    },
  );
}
