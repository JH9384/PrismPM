/**
 * The spec package as the generator sees it: `sdk/npm/spec` in the checkout the
 * generator runs in, never a pin. Every page is a function of this checkout, so
 * a pull request's pages describe the pull request's spec and nothing has to
 * be regenerated or committed. Each spec page ends with the commit the checkout
 * is at, so a reader can tell which spec a page describes.
 *
 * The spec's entry point is generated and not committed (its `scripts/build.mjs`);
 * `loadSpec` builds it first, which writes only git-ignored files.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DOCS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const ROOT = dirname(dirname(DOCS_DIR));
export const SPEC_SUBDIR = 'sdk/npm/spec';
export const SPEC_DIR = join(ROOT, SPEC_SUBDIR);

export function git(args, options = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

/** The commit the checkout is at. A source archive with no repository has none, and says so. */
export function headCommit() {
  try {
    return git(['rev-parse', 'HEAD']).trim();
  } catch {
    return 'an unversioned checkout';
  }
}

/**
 * Load the spec: its generated entry point, the registries found in its
 * directories, a JSON reader and a text reader.
 * @param {{ dir?: string, commit?: string }} [options]
 */
export async function loadSpec({ dir = SPEC_DIR, commit = headCommit() } = {}) {
  const build = await import(pathToFileURL(join(dir, 'scripts', 'build.mjs')).href);
  const module = await build.loadSpec(dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return {
    dir,
    commit,
    module,
    /** Everything the directories define: schemas, documents, holo sections, predicates. */
    registry: build.discover(dir),
    version: pkg.version,
    name: pkg.name,
    json: (rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8')),
    text: (rel) => readFileSync(join(dir, rel), 'utf8').replace(/\r\n/g, '\n'),
    url: pathToFileURL(join(dir, 'index.mjs')).href,
    /** The footer source for pages built from the spec. */
    source: () => `${pkg.name} ${module.FORMAT_REVISION} at ${commit}`,
  };
}
