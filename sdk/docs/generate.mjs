#!/usr/bin/env node
/**
 * Generate the Reference and API pages, llms.txt and llms-full.md from the
 * spec package, the runtime and the executed examples in this checkout.
 * Nothing it writes is committed.
 *
 *   node sdk/docs/generate.mjs [--out <dir>]   write the site (default: build/docs, ignored by git)
 *   node sdk/docs/generate.mjs verify          generate into a temp dir, run every example and the
 *                                              vocabulary lint, exit 1 naming each page that fails
 *
 * The spec is read from the working tree, so a page always describes the
 * checkout it was generated from. The footer of a spec page names that commit.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintFiles, renderSite } from './lib/generate.mjs';
import { ROOT } from './lib/spec.mjs';

export const OUT_DIR = join(ROOT, 'build', 'docs');

export function writeOutput(files, dir) {
  for (const [rel, text] of files) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}

/** A directory as the message names it: repository-relative when inside the repository. */
function shown(dir) {
  const rel = relative(ROOT, dir);
  return rel && !rel.startsWith('..') ? rel.split(sep).join('/') : dir;
}

/**
 * Generate, then lint. A problem is named by its page: the example that did not
 * run, the generator that threw, or the line the lint rejected.
 * @returns {Promise<{ files: Map<string, string>, problems: import('./lib/generate.mjs').PageProblem[] }>}
 */
export async function verify(options) {
  const { files, problems } = await renderSite(options);
  return { files, problems: [...problems, ...lintFiles(files)] };
}

async function main(argv) {
  const args = [...argv];
  let mode = 'generate';
  let out = OUT_DIR;
  while (args.length) {
    const arg = args.shift();
    if (arg === 'verify') mode = 'verify';
    else if (arg === '--out') {
      const value = args.shift();
      if (!value) throw new Error('--out needs a directory');
      out = resolve(process.cwd(), value);
    } else throw new Error(`unknown argument ${arg}`);
  }

  const { files, problems } = await verify();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`docs: ${problem}`);
    console.error(`${problems.length} problem(s) in ${new Set(problems.map((p) => p.page)).size} page(s). Fix the source, then run node sdk/docs/generate.mjs verify.`);
    return 1;
  }

  if (mode === 'verify') {
    // Generation is the check; write once to a scratch directory so the same code path as a real build is exercised.
    const temp = mkdtempSync(join(tmpdir(), 'prism-docs-verify-'));
    try {
      writeOutput(files, temp);
      console.log(`docs verified: ${files.size} files, every example ran, vocabulary lint clean`);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
    return 0;
  }

  // Only the default directory is ours to empty; a directory the caller names is written over, never deleted.
  if (out === OUT_DIR && existsSync(out)) rmSync(out, { recursive: true, force: true });
  writeOutput(files, out);
  console.log(`wrote ${files.size} files to ${shown(out)}`);
  return 0;
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
