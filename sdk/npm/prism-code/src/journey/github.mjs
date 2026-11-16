/**
 * What a journey app needs to build on GitHub Actions with no Docker here.
 *
 * The template's `build.yml` builds an app in `prism/` when the commit holds
 * `prism/prism.toml`, `prism/prismpm.lock` and `prism/standards.lock`, and it
 * reads the SDK image from `prismpm.lock` at the repository root. Pinning the
 * app to an image (`bind`) used to need the image itself, but both locks are
 * a function of the image alone: every app pinned to the default image holds
 * the same bytes. So they are fetched from the template at a pinned commit and
 * checked against pinned SHA-256 digests, beside the workflow, rather than
 * shipped in the package (about 330 KB).
 *
 * The repository is created only when the caller names it, after the user has
 * approved it: creating a public repository is outward facing.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseRepository, tokenSource } from '../github.mjs';
import { isBound } from './project.mjs';
import { DEFAULT_SDK_IMAGE } from './sdk.mjs';

export const TEMPLATE_REPOSITORY = 'UOR-Foundation/template';
/** The template commit the files below are read from. Its prismpm.lock pins DEFAULT_SDK_IMAGE; a test holds the two equal. */
export const TEMPLATE_COMMIT = '5b712b9d7b123af6c4545534ffa7c8b1647e7110';
/** Each file a GitHub build needs, by its path in the template, with the SHA-256 it must have. */
export const PINNED_FILES = Object.freeze({
  'prismpm.lock': 'fb18f8a88756f6f3b89efe375c6611ab317beec320f986f81af92e142ac54969',
  'standards.lock': '5717dc99c3dbe05d9be26114be7e2df3f00df7128b12f3d9933b77543da8f866',
  '.github/workflows/build.yml': 'a9d130a135bfaa7a6b7d44f3397445d94913bb5f8672d21a2750ea405c6555cb',
});
export const RAW_URL = 'https://raw.githubusercontent.com';

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, args, run) => run('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
const ok = (result) => !result.error && result.status === 0;
const said = (result) => String(result.stderr || result.stdout || result.error?.message || '').trim().split('\n').slice(-3).join(' ');

/** The bytes of a pinned template file, refused unless they have the pinned digest. */
export async function fetchPinned(path, { fetch = globalThis.fetch } = {}) {
  const want = PINNED_FILES[path];
  if (!want) throw new Error(`${path} is not a pinned template file`);
  const url = `${RAW_URL}/${TEMPLATE_REPOSITORY}/${TEMPLATE_COMMIT}/${path}`;
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`${url} did not answer: ${error.cause?.code ?? error.message}`);
  }
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const got = sha256Hex(bytes);
  if (got !== want) throw new Error(`${url} has SHA-256 ${got}, not the pinned ${want}`);
  return bytes;
}

/** The top of the git repository holding `dir`, or null. */
export function gitRoot(dir, { run = spawnSync } = {}) {
  const top = git(dir, ['rev-parse', '--show-toplevel'], run);
  return ok(top) ? resolve(String(top.stdout).trim()) : null;
}

/** The github.com repository `origin` names in `root`, or null. */
export function originRepository(root, { run = spawnSync } = {}) {
  const url = git(root, ['remote', 'get-url', 'origin'], run);
  return ok(url) ? parseRepository(String(url.stdout).trim()) : null;
}

/** The signed-in GitHub login, from gh, or null. */
export function signedInLogin({ run = spawnSync } = {}) {
  const result = run('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const login = ok(result) ? String(result.stdout).trim() : '';
  return /^[A-Za-z0-9-]+$/.test(login) ? login : null;
}

/** Whether a build can go to GitHub Actions: a token is there to start and read it. */
export const canBuildOnGitHub = ({ env = process.env, run = spawnSync } = {}) => tokenSource(env, run) !== null;

/** The repository to suggest for an app: `<login>/prism-<name>`. */
export const suggestedRepository = (login, spec) => `${login ?? 'OWNER'}/prism-${spec.name}`;

/**
 * Write what the build needs and is missing: the app's two locks when it is
 * not pinned yet, `prismpm.lock` at the root, which the workflow reads, and
 * the workflow. Never overwrites. Returns the paths written, relative to `root`.
 */
export async function readyForGitHub({ root, dir, session, fetch = globalThis.fetch, log = () => {} }) {
  const wanted = [];
  if (!isBound(dir)) {
    const image = session.image ?? DEFAULT_SDK_IMAGE;
    if (image !== DEFAULT_SDK_IMAGE) throw new Error(`the app is to be pinned to ${image}, and only ${DEFAULT_SDK_IMAGE} can be pinned without Docker`);
    for (const file of ['standards.lock', 'prismpm.lock']) if (!existsSync(join(dir, file))) wanted.push([file, join(dir, file)]);
  }
  if (!existsSync(join(root, 'prismpm.lock'))) wanted.push(['prismpm.lock', join(root, 'prismpm.lock')]);
  if (!existsSync(join(root, '.github', 'workflows', 'build.yml'))) wanted.push(['.github/workflows/build.yml', join(root, '.github', 'workflows', 'build.yml')]);
  if (wanted.length === 0) return [];
  log(`Adding what the GitHub build needs, from ${TEMPLATE_REPOSITORY} at ${TEMPLATE_COMMIT.slice(0, 12)}, each file checked against its pinned SHA-256...`);
  const cache = new Map();
  const written = [];
  for (const [source, target] of wanted) {
    if (!cache.has(source)) cache.set(source, await fetchPinned(source, { fetch }));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, cache.get(source));
    written.push(relative(root, target).split('\\').join('/'));
  }
  return written;
}

/**
 * Commit Prism's own paths, and nothing else, in `root`. A new repository is
 * created first. Returns `{ committed, sha }`; throws with git's reason.
 */
export function commitApp({ root, paths, message, run = spawnSync }) {
  if (!existsSync(join(root, '.git')) && gitRoot(root, { run }) === null) {
    const init = git(root, ['init', '-b', 'main'], run);
    if (!ok(init)) throw new Error(`git init failed: ${said(init)}`);
  }
  const add = git(root, ['add', '--', ...paths], run);
  if (!ok(add)) throw new Error(`git add failed: ${said(add)}`);
  const staged = git(root, ['diff', '--cached', '--quiet', '--', ...paths], run);
  let committed = false;
  if (staged.status === 1) {
    const commit = git(root, ['commit', '--quiet', '-m', message, '--', ...paths], run);
    if (!ok(commit)) {
      const hint = /user\.(name|email)|identity/i.test(said(commit)) ? ' Set your name and email with git config --global user.name and user.email, then build again.' : '';
      throw new Error(`git commit failed: ${said(commit)}.${hint}`);
    }
    committed = true;
  }
  const head = git(root, ['rev-parse', 'HEAD'], run);
  if (!ok(head)) throw new Error(`git rev-parse HEAD failed: ${said(head)}`);
  return { committed, sha: String(head.stdout).trim() };
}

/**
 * Put `root` on GitHub as `repository`: create it public with gh and push, or,
 * when it exists already and is empty of this history, add it as origin and push.
 */
export function publishRepository({ root, repository, run = spawnSync }) {
  const repo = parseRepository(repository);
  if (!repo) throw new Error(`${JSON.stringify(repository)} is not owner/name`);
  const view = run('gh', ['repo', 'view', repo.full, '--json', 'name'], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (view.error?.code === 'ENOENT') throw new Error('gh is not on the PATH; install the GitHub CLI (https://cli.github.com) and run gh auth login');
  if (ok(view)) {
    const add = git(root, ['remote', 'add', 'origin', `https://github.com/${repo.full}.git`], run);
    if (!ok(add)) throw new Error(`git remote add origin failed: ${said(add)}`);
    const push = git(root, ['push', '--quiet', '-u', 'origin', 'HEAD:main'], run);
    if (!ok(push)) throw new Error(`git push to ${repo.full} failed: ${said(push)}`);
    return { repository: repo.full, created: false };
  }
  const create = run('gh', ['repo', 'create', repo.full, '--public', '--source', root, '--remote', 'origin', '--push'], { encoding: 'utf8', windowsHide: true, timeout: 180000 });
  if (!ok(create)) throw new Error(`gh repo create ${repo.full} failed: ${said(create)}`);
  return { repository: repo.full, created: true };
}

// ---------------------------------------------------------------------------
// A new app as an instance of the template: its frame, page, gate and Pages URL.
// ---------------------------------------------------------------------------

/** git with `gh` as the credential helper for this one command, so a push needs no global setup. */
const gitWithGh = (cwd, args, run) => run('git', ['-C', cwd, '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...args], { encoding: 'utf8', windowsHide: true, timeout: 180000 });

/**
 * Create `repository` from the template, public, with Pages built by its
 * workflow, and clone it to `into`. GitHub fills a repository from a template
 * a moment after creating it, so the first commit is waited for.
 */
export async function createFromTemplate({ repository, into, run = spawnSync, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const repo = parseRepository(repository);
  if (!repo) throw new Error(`${JSON.stringify(repository)} is not owner/name`);
  if (existsSync(into)) throw new Error(`${into} exists already; move it, or name another repository`);
  const create = run('gh', ['repo', 'create', repo.full, '--template', TEMPLATE_REPOSITORY, '--public'], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (create.error?.code === 'ENOENT') throw new Error('gh is not on the PATH; install the GitHub CLI (https://cli.github.com) and run gh auth login');
  if (!ok(create)) throw new Error(`gh repo create ${repo.full} --template ${TEMPLATE_REPOSITORY} failed: ${said(create)}`);
  let filled = false;
  for (let i = 0; i < 30 && !filled; i++) {
    const head = run('gh', ['api', `repos/${repo.full}/commits?per_page=1`, '--jq', '.[0].sha'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    filled = ok(head) && /^[0-9a-f]{40}$/.test(String(head.stdout).trim());
    if (!filled) await sleep(2000);
  }
  if (!filled) throw new Error(`${repo.full} was created but GitHub has not filled it from the template after a minute; build again shortly`);
  const pages = run('gh', ['api', '-X', 'POST', `repos/${repo.full}/pages`, '-f', 'build_type=workflow'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (!ok(pages) && !/already|409/i.test(said(pages))) throw new Error(`could not turn on Pages for ${repo.full}: ${said(pages)}`);
  const clone = run('git', ['-c', 'core.autocrlf=false', 'clone', '--quiet', `https://github.com/${repo.full}.git`, into], { encoding: 'utf8', windowsHide: true, timeout: 300000 });
  if (!ok(clone)) throw new Error(`git clone ${repo.full} failed: ${said(clone)}`);
  return { repository: repo.full, clone: into };
}

/** Commit everything in the clone and push it to main. Returns the commit, or null when nothing changed. */
export function pushClone({ clone, message, run = spawnSync }) {
  const add = git(clone, ['add', '-A'], run);
  if (!ok(add)) throw new Error(`git add failed: ${said(add)}`);
  const staged = git(clone, ['diff', '--cached', '--quiet'], run);
  if (staged.status === 0) return null;
  const commit = git(clone, ['commit', '--quiet', '-m', message], run);
  if (!ok(commit)) {
    const hint = /user\.(name|email)|identity/i.test(said(commit)) ? ' Set your name and email with git config --global user.name and user.email, then build again.' : '';
    throw new Error(`git commit failed: ${said(commit)}.${hint}`);
  }
  const push = gitWithGh(clone, ['push', '--quiet', 'origin', 'HEAD:main'], run);
  if (!ok(push)) throw new Error(`git push failed: ${said(push)}`);
  const head = git(clone, ['rev-parse', 'HEAD'], run);
  return String(head.stdout).trim();
}

/**
 * Wait for the named workflows' runs on `sha` to end, through the GitHub API.
 * Resolves to `{ [workflow]: run }`; a run that does not start within three
 * minutes is an error.
 */
export async function waitForWorkflows({ repository, sha, workflows, log = () => {}, client, now = Date.now }) {
  const found = {};
  const begin = now();
  while (Object.keys(found).length < workflows.length) {
    if (now() - begin > 180000) throw new Error(`no run of ${workflows.filter((w) => !found[w]).join(', ')} started for ${sha.slice(0, 12)} within three minutes`);
    const listed = await client.json(`/repos/${repository}/actions/runs?head_sha=${sha}&per_page=50`);
    for (const w of workflows) {
      const run = (listed?.workflow_runs ?? []).filter((r) => r.head_sha === sha && String(r.path ?? '').endsWith(`/${w}`)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (run && !found[w]) {
        found[w] = run;
        log(`${w}: ${run.html_url}`);
      }
    }
    if (Object.keys(found).length < workflows.length) await client.sleep(5000);
  }
  const { waitForRun } = await import('../remote-github.mjs');
  const ended = {};
  for (const w of workflows) ended[w] = await waitForRun(client, { full: repository }, found[w], { timeoutMs: 45 * 60 * 1000, now, onProgress: (p) => p.seconds % 120 < 10 && log(`  ${w} ${p.status}, ${p.seconds} s`) });
  return ended;
}

/** Download the live page's holo once Pages serves it, retrying while the deploy settles. */
export async function fetchLive({ live, into, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 36 }) {
  const url = new URL('app.holo', live).href;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        mkdirSync(dirname(into), { recursive: true });
        writeFileSync(into, bytes);
        return { url, bytes: bytes.length };
      }
    } catch {
      // The deploy may not have reached the edge yet.
    }
    await sleep(5000);
  }
  throw new Error(`${url} did not answer after three minutes; the page may still be deploying`);
}
