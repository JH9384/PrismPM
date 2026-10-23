/**
 * The spec package as the generator sees it: a checkout of `sdk/npm/spec` at
 * the commit pinned in `spec.lock.json`, never the working tree. The pin makes
 * every page a deterministic function of a named commit, and `--check`
 * compares the working tree's copy of the spec, when there is one, against
 * the pin so a spec change without a re-pin fails CI.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DOCS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const ROOT = dirname(dirname(DOCS_DIR));
export const LOCK_PATH = join(DOCS_DIR, 'spec.lock.json');
export const SPEC_SUBDIR = 'sdk/npm/spec';
export const CACHE_DIR = join(DOCS_DIR, '.spec-cache');

/** Files that do not change what the generator reads. */
const IGNORED = new Set(['test', 'scripts', 'node_modules']);

export function git(args, options = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

export function readLock() {
  return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
}

export function writeLock(lock) {
  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
}

function hasCommit(commit) {
  try {
    git(['cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Make sure the pinned commit is in the local object store, fetching it by hash if not. */
export function ensureCommit(commit) {
  if (hasCommit(commit)) return;
  git(['fetch', '--depth', '1', 'origin', commit], { stdio: ['ignore', 'pipe', 'inherit'] });
  if (!hasCommit(commit)) throw new Error(`commit ${commit} is not reachable from origin`);
}

/** Write `sdk/npm/spec` at `commit` into the cache and return its directory. */
export function checkoutSpec(commit) {
  const dir = join(CACHE_DIR, commit);
  if (existsSync(join(dir, 'index.mjs'))) return dir;
  ensureCommit(commit);
  const files = git(['ls-tree', '-r', '--name-only', commit, '--', SPEC_SUBDIR])
    .split(/\r?\n/)
    .filter(Boolean);
  if (files.length === 0) throw new Error(`${SPEC_SUBDIR} does not exist at ${commit}`);
  for (const file of files) {
    const target = join(dir, relative(SPEC_SUBDIR, file));
    mkdirSync(dirname(target), { recursive: true });
    const bytes = execFileSync('git', ['show', `${commit}:${file}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(target, bytes);
  }
  return dir;
}

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const rel = relative(base, full).split(sep).join('/');
    if (IGNORED.has(rel.split('/')[0])) continue;
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(rel);
  }
  return out;
}

/** `sha256:` over every file the generator may read, by sorted path then bytes. */
export function digestOf(dir) {
  const hash = createHash('sha256');
  for (const rel of walk(dir)) {
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(join(dir, rel)));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

/** The digest of the working tree's `sdk/npm/spec`, or null when the tree has no spec package. */
export function workingSpecDigest() {
  const dir = join(ROOT, SPEC_SUBDIR);
  return existsSync(join(dir, 'index.mjs')) ? digestOf(dir) : null;
}

/** Load the pinned spec: its constants module, a JSON reader and a text reader. */
export async function loadSpec(lock = readLock()) {
  const dir = checkoutSpec(lock.commit);
  const digest = digestOf(dir);
  if (digest !== lock.digest) {
    throw new Error(`spec checkout at ${lock.commit} has digest ${digest}, but spec.lock.json records ${lock.digest}`);
  }
  const module = await import(pathToFileURL(join(dir, 'index.mjs')).href);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return {
    dir,
    commit: lock.commit,
    digest,
    module,
    version: pkg.version,
    name: pkg.name,
    json: (rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8')),
    text: (rel) => readFileSync(join(dir, rel), 'utf8').replace(/\r\n/g, '\n'),
    url: pathToFileURL(join(dir, 'index.mjs')).href,
    /** The footer source for pages built from the spec. */
    source: () => `${pkg.name} ${module.FORMAT_REVISION} at ${lock.commit}`,
  };
}

/** Pin a commit: check it out, record its digest and revision in the lock. */
export async function pin(commit) {
  const full = git(['rev-parse', `${commit}^{commit}`]).trim();
  const dir = checkoutSpec(full);
  const module = await import(pathToFileURL(join(dir, 'index.mjs')).href);
  const lock = {
    package: '@prism-code/spec',
    path: SPEC_SUBDIR,
    commit: full,
    digest: digestOf(dir),
    formatRevision: module.FORMAT_REVISION,
  };
  writeLock(lock);
  return lock;
}
