/**
 * What `setup` and `build --remote github` both know about a GitHub
 * repository, with no imports, so `setup` can read a remote without loading
 * the verifier.
 */
export const BUILD_WORKFLOW = '.github/workflows/build.yml';
/** Where the template keeps the workflow a repository needs, for the message that names it. */
export const TEMPLATE_WORKFLOW_URL = 'https://github.com/UOR-Foundation/template/blob/main/.github/workflows/build.yml';

/** `owner/repo` of a GitHub remote URL (https, ssh or scp-like) or of `owner/repo` itself, or null for anything else. */
export function parseRepository(url) {
  const text = String(url ?? '').trim();
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(text) ?? /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(text);
  if (!m) return null;
  return { owner: m[1], repo: m[2], full: `${m[1]}/${m[2]}` };
}

/** The `origin` remote of `cwd` as a GitHub repository: `{ url, repo }`, where `repo` is null for a remote elsewhere, or null with no origin. */
export function originOf(cwd, run) {
  const result = run('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.error || result.status !== 0) return null;
  const url = String(result.stdout).trim();
  return { url, repo: parseRepository(url) };
}

/** Where a token would come from, without reading it: the variable, or `gh auth token`; null with none. */
export function tokenSource(env, run) {
  if (env.GITHUB_TOKEN) return 'GITHUB_TOKEN';
  if (env.GH_TOKEN) return 'GH_TOKEN';
  const result = run('gh', ['auth', 'token'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  return !result.error && result.status === 0 && String(result.stdout).trim() ? 'gh auth token' : null;
}
