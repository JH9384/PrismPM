/**
 * `prism-code build --remote github` (experimental): the user's own GitHub
 * repository builds the app, and this machine verifies what comes back. No
 * Docker, no SDK image, no toolchain here.
 *
 * The principle: build anywhere, verify locally. The runner is not trusted,
 * it is checked. One commit is pushed to `refs/heads/prism/build/<sha>`, the
 * repository's `build.yml` runs `prismpm verify` in the SDK image on it, and
 * the artifact `prism-build-<sha>` comes back with the holo, its build
 * directory, `build.json` and the run's signed provenance. Before anything is
 * written under `.prism/build/`, this machine checks, in order:
 *
 *   1. `build.json` names this commit and this repository;
 *   2. the holo's SHA-256 is the one the runner recorded;
 *   3. the provenance statement's subject is that SHA-256, and its build
 *      names this repository and this commit;
 *   4. the statement's signature verifies, and the signer is a workflow of
 *      this repository through GitHub's OIDC issuer (prism-code's own Sigstore
 *      verifier, or `gh attestation verify` when the Sigstore packages are not
 *      installed);
 *   5. `check` reaches a verdict the policy accepts, trusting the statements
 *      signed into the holo only when a workflow of this repository signed
 *      them (so a keylessly signed proof statement reaches P2), the
 *      fingerprint is the one the runner recorded, and every acceptance
 *      vector replays here.
 *
 * Every refusal is typed: `remote.*` is a refusal of this machine's (exit 2),
 * a digest that differs is `DigestMismatchError` (exit 1), and a verdict or a
 * vector that fails ends with the exit code `check` and `vectors` give.
 *
 * The token comes from `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`; it is
 * sent to the API host and nowhere else, and never printed. `fetch` follows
 * the artifact redirect to GitHub's storage without the Authorization header,
 * as the Fetch standard requires on a change of origin.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { GITHUB_ACTIONS_ISSUER, experimental_verifyBundle } from './attest.mjs';
import { check, exitCodeOf } from './check.mjs';
import { DigestMismatchError, PrismError, fail } from './errors.mjs';
import { BUILD_WORKFLOW, TEMPLATE_WORKFLOW_URL, parseRepository } from './github.mjs';
import { fromFile } from './node.mjs';

export { BUILD_WORKFLOW, TEMPLATE_WORKFLOW_URL, parseRepository } from './github.mjs';
export const REMOTE_BUILD_SCHEMA = 'prism/remote-build/1';
export const BUILD_REF_PREFIX = 'refs/heads/prism/build/';
export const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';
export const API_URL = 'https://api.github.com';
/** The verdict a remote build is held to when the caller names no policy: the least level. The detached provenance bundle is checked here apart from `check`; the statements signed into the holo raise its level when they verify against this repository's workflows (`repositorySigner`). */
export const DEFAULT_POLICY = Object.freeze({ minimum: 'P0' });
/** A GitHub Actions workflow's signing identity: the workflow file at a ref of the repository. */
export const identityPattern = (repo) => new RegExp(`^https://github\\.com/${repo.full.replace(/[.]/g, '\\.')}/\\.github/workflows/[A-Za-z0-9._-]+\\.ya?ml@refs/`);

/**
 * The signer `check` trusts for a remote build (#582): a workflow of the
 * repository the build was pushed to, through GitHub's OIDC issuer. A proof
 * statement the build signed keylessly counts towards P2 only under it.
 */
export const repositorySigner = (repo) => ({ certificateIdentityRegexp: identityPattern(repo), certificateOidcIssuer: GITHUB_ACTIONS_ISSUER });

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{40}$/;

// ---------------------------------------------------------------------------
// The repository, the token and the commit.
// ---------------------------------------------------------------------------

/** The repository to build in: `--repo`, else the `origin` remote of `cwd`. */
export function repositoryOf(cwd, { override = null, run = spawnSync } = {}) {
  if (override) {
    const named = parseRepository(override);
    if (!named) fail('remote.repository', `--repo takes owner/name or a github.com URL, not ${JSON.stringify(override)}`);
    return named;
  }
  const result = run('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) fail('remote.repository', `no git remote named origin in ${cwd}; name the repository with --repo owner/name`);
  const found = parseRepository(result.stdout);
  if (!found) fail('remote.repository', `origin is ${String(result.stdout).trim()}, not a github.com repository; name one with --repo owner/name`);
  return found;
}

/** A token for the API: `GITHUB_TOKEN`, `GH_TOKEN`, else what `gh auth token` prints. Never logged. */
export function tokenOf({ env = process.env, run = spawnSync } = {}) {
  const fromEnv = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (fromEnv) return { token: fromEnv, source: env.GITHUB_TOKEN ? 'GITHUB_TOKEN' : 'GH_TOKEN' };
  const result = run('gh', ['auth', 'token'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const token = result.error || result.status !== 0 ? '' : String(result.stdout).trim();
  if (!token) fail('remote.auth', 'no GitHub token: set GITHUB_TOKEN or GH_TOKEN, or sign in with gh auth login');
  return { token, source: 'gh auth token' };
}

/** The commit to build: `ref` resolved in `cwd`, refused while the working tree has changes unless `allowDirty`. */
export function commitOf(cwd, { ref = 'HEAD', allowDirty = false, run = spawnSync } = {}) {
  const parsed = run('git', ['-C', cwd, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8', windowsHide: true });
  if (parsed.error || parsed.status !== 0) fail('remote.ref', `${ref} is not a commit in ${cwd}`);
  const sha = String(parsed.stdout).trim();
  const status = run('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', windowsHide: true });
  const dirty = !status.error && status.status === 0 && String(status.stdout).trim() !== '';
  if (dirty && ref === 'HEAD' && !allowDirty) {
    fail('remote.dirty', 'the working tree has uncommitted changes, which a remote build cannot see; commit them, name a commit with --ref, or pass --allow-dirty to build HEAD as committed');
  }
  return { sha, dirty };
}

/** Whether the commit holds a file at `path`, read from the local repository. */
export function commitHolds(cwd, sha, path, { run = spawnSync } = {}) {
  const result = run('git', ['-C', cwd, 'cat-file', '-e', `${sha}:${path}`], { encoding: 'utf8', windowsHide: true });
  return !result.error && result.status === 0;
}

// ---------------------------------------------------------------------------
// The API client.
// ---------------------------------------------------------------------------

/**
 * A client of the GitHub REST API with one token. `fetch` and `sleep` are
 * injectable for tests. A 5xx or a lost connection is tried again, twice.
 */
export function gitHubClient({ token, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), apiUrl = API_URL, version = '0.0.0', retries = 2, retryMs = 5000 }) {
  const headers = (accept) => ({ accept, authorization: `Bearer ${token}`, 'user-agent': `prism-code/${version}`, 'x-github-api-version': '2022-11-28' });
  async function request(path, { method = 'GET', accept = 'application/vnd.github+json', body } = {}) {
    const url = path.startsWith('http') ? path : `${apiUrl}${path}`;
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetch(url, { method, headers: { ...headers(accept), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'follow' });
      } catch (error) {
        if (attempt < retries) {
          await sleep(retryMs);
          continue;
        }
        fail('remote.api', `${method} ${path} did not answer: ${error.cause?.code ?? error.message}`);
      }
      if (response.status >= 500 && attempt < retries) {
        await sleep(retryMs);
        continue;
      }
      return response;
    }
  }
  return {
    apiUrl,
    sleep,
    /** JSON, or null for 404; any other failure is `remote.api` with the status and GitHub's message. */
    async json(path, options = {}) {
      const response = await request(path, options);
      if (response.status === 404) return null;
      const text = await response.text();
      if (!response.ok) {
        let message = text.slice(0, 300);
        try {
          message = JSON.parse(text).message ?? message;
        } catch {
          // GitHub's error bodies are JSON; anything else is shown as it is.
        }
        fail('remote.api', `${options.method ?? 'GET'} ${path}: HTTP ${response.status}: ${message}`);
      }
      return text ? JSON.parse(text) : {};
    },
    /** The bytes a path answers with, redirects followed. */
    async bytes(path) {
      const response = await request(path, { accept: 'application/vnd.github+json' });
      if (!response.ok) fail('remote.api', `GET ${path}: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

// ---------------------------------------------------------------------------
// The build ref, the run and the artifact.
// ---------------------------------------------------------------------------

export const buildRef = (sha) => `${BUILD_REF_PREFIX}${sha}`;

/** Push the commit to its build ref, so the workflow runs on exactly that SHA. */
export function pushBuildRef(cwd, sha, { run = spawnSync } = {}) {
  const result = run('git', ['-C', cwd, 'push', '--quiet', 'origin', `${sha}:${buildRef(sha)}`], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (result.error || result.status !== 0) fail('remote.push', `could not push ${sha.slice(0, 12)} to ${buildRef(sha)}: ${String(result.stderr ?? result.error?.message ?? '').trim()}`);
}

/** Delete the build ref once the artifact is here. Best effort: a ref left behind is harmless. */
export function deleteBuildRef(cwd, sha, { run = spawnSync } = {}) {
  const result = run('git', ['-C', cwd, 'push', '--quiet', 'origin', `:${buildRef(sha)}`], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return !result.error && result.status === 0;
}

/** The build workflow's newest run for the commit, or null. A pages run that called it counts too. */
export async function findRun(client, repo, sha) {
  const listed = await client.json(`/repos/${repo.full}/actions/runs?head_sha=${sha}&per_page=50`);
  const runs = (listed?.workflow_runs ?? []).filter((run) => run.head_sha === sha && /\/(build|pages)\.ya?ml$/.test(run.path ?? ''));
  runs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return runs[0] ?? null;
}

/**
 * Wait for a run to end. Polls with a growing interval, 5 s to 30 s, and
 * gives up after `timeoutMs` (`remote.timeout`). `onProgress` hears each poll.
 */
export async function waitForRun(client, repo, run, { timeoutMs = 30 * 60 * 1000, onProgress = () => {}, now = Date.now } = {}) {
  const started = now();
  let interval = 5000;
  let current = run;
  while (current.status !== 'completed') {
    if (now() - started > timeoutMs) fail('remote.timeout', `the run ${current.html_url} did not end in ${Math.round(timeoutMs / 1000)} s; it goes on, and --ref ${run.head_sha} picks it up later`);
    await client.sleep(interval);
    interval = Math.min(interval + 5000, 30000);
    current = await client.json(`/repos/${repo.full}/actions/runs/${run.id}`);
    if (!current) fail('remote.api', `the run ${run.id} disappeared`);
    onProgress({ status: current.status, seconds: Math.round((now() - started) / 1000), url: current.html_url });
  }
  return current;
}

/** The entries of a zip archive, stored or deflated, as `Map<path, Uint8Array>`. Enough for an Actions artifact. */
export function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail('remote.artifact', 'the artifact is not a zip archive');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) fail('remote.artifact', 'the artifact\'s central directory is damaged');
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (view.getUint32(local, true) !== 0x04034b50) fail('remote.artifact', `the artifact's entry ${name} is damaged`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    let content;
    if (method === 0) content = new Uint8Array(data);
    else if (method === 8) content = new Uint8Array(inflateRawSync(data));
    else fail('remote.artifact', `the artifact's entry ${name} uses compression method ${method}, which this reader does not take`);
    if (content.length !== size) fail('remote.artifact', `the artifact's entry ${name} is ${content.length} bytes, not the ${size} its directory says`);
    files.set(name, content);
  }
  return files;
}

/** Download the artifact `prism-build-<sha>` of a run as its files. */
export async function downloadArtifact(client, repo, runId, sha) {
  const name = `prism-build-${sha}`;
  const listed = await client.json(`/repos/${repo.full}/actions/runs/${runId}/artifacts?per_page=100`);
  const artifact = (listed?.artifacts ?? []).find((a) => a.name === name && !a.expired);
  if (!artifact) fail('remote.artifact', `the run ${runId} left no artifact named ${name}; its build.yml is not the one that uploads the holo`);
  return { artifact, files: unzip(await client.bytes(`/repos/${repo.full}/actions/artifacts/${artifact.id}/zip`)) };
}

// ---------------------------------------------------------------------------
// What came back, checked.
// ---------------------------------------------------------------------------

const utf8 = (bytes) => new TextDecoder().decode(bytes);

/** The in-toto statement inside a Sigstore bundle's DSSE envelope. */
export function statementOf(bundle) {
  const envelope = bundle?.dsseEnvelope;
  if (!envelope?.payload) fail('remote.provenance', 'the provenance is not a Sigstore bundle with a DSSE envelope');
  let statement;
  try {
    statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
  } catch {
    fail('remote.provenance', 'the provenance envelope does not hold a JSON statement');
  }
  return statement;
}

/**
 * The provenance says what was built and from what. Its subject must be the
 * holo's SHA-256, and its build must name this repository and this commit.
 * This is checked before any signature, so a bundle for another artifact,
 * repository or commit is refused whoever signed it.
 */
export function checkProvenance(bundle, { repo, sha, holoSha256 }) {
  const statement = statementOf(bundle);
  if (statement.predicateType !== SLSA_PROVENANCE_V1) fail('remote.provenance', `the provenance is ${statement.predicateType ?? 'untyped'}, not ${SLSA_PROVENANCE_V1}`);
  const subjects = Array.isArray(statement.subject) ? statement.subject : [];
  if (!subjects.some((s) => s?.digest?.sha256 === holoSha256)) {
    fail('remote.subject', `the provenance is about ${subjects.map((s) => s?.digest?.sha256 ?? '?').join(', ') || 'nothing'}, not this holo (${holoSha256})`);
  }
  const definition = statement.predicate?.buildDefinition ?? {};
  const workflow = definition.externalParameters?.workflow ?? {};
  const repositoryUrl = String(workflow.repository ?? '');
  if (repositoryUrl.replace(/\.git$/, '').toLowerCase() !== `https://github.com/${repo.full}`.toLowerCase()) {
    fail('remote.signer', `the provenance was built in ${repositoryUrl || 'an unnamed repository'}, not https://github.com/${repo.full}`);
  }
  const sources = Array.isArray(definition.resolvedDependencies) ? definition.resolvedDependencies : [];
  const source = sources.find((d) => String(d?.uri ?? '').toLowerCase().startsWith(`git+https://github.com/${repo.full}`.toLowerCase()));
  if (!source || source.digest?.gitCommit !== sha) {
    fail('remote.commit', `the provenance was built from ${source?.digest?.gitCommit ?? 'an unnamed commit'}, not ${sha}`);
  }
  return { statement, workflowRef: String(workflow.ref ?? ''), workflowPath: String(workflow.path ?? '') };
}

/**
 * The signature on the provenance, by a workflow of this repository through
 * GitHub's issuer. prism-code's Sigstore verifier when its packages load;
 * else `gh attestation verify`, which checks the same bundle against the same
 * roots; else a refusal naming both. `verifyBundle` and `run` are injectable.
 */
export async function verifySignature(bundle, { repo, holoPath, verifyBundle = experimental_verifyBundle, run = spawnSync }) {
  try {
    const outcome = await verifyBundle(bundle, { certificateIdentityRegexp: identityPattern(repo), certificateOidcIssuer: GITHUB_ACTIONS_ISSUER });
    return { via: 'sigstore', identity: outcome.identity, issuer: outcome.issuer, time: outcome.time ?? null };
  } catch (error) {
    if (error?.code !== 'attest.unavailable') throw error;
  }
  const gh = run('gh', ['attestation', 'verify', holoPath, '--repo', repo.full, '--predicate-type', SLSA_PROVENANCE_V1, '--format', 'json'], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (gh.error?.code === 'ENOENT') {
    fail('remote.attestation', 'the signature cannot be checked here: the Sigstore packages are not installed (optional dependencies of prism-code, Node 22.22.2 or newer) and gh is not on the PATH; install either');
  }
  if (gh.error || gh.status !== 0) fail('remote.attestation', `gh attestation verify refused the provenance: ${String(gh.stderr ?? gh.error?.message ?? '').trim().split('\n').slice(-3).join(' ')}`);
  let identity = null;
  try {
    const parsed = JSON.parse(gh.stdout);
    identity = parsed?.[0]?.verificationResult?.signature?.certificate?.sourceRepositoryURI ?? parsed?.[0]?.verificationResult?.signature?.certificate?.subjectAlternativeName ?? null;
  } catch {
    identity = null;
  }
  return { via: 'gh', identity, issuer: GITHUB_ACTIONS_ISSUER, time: null };
}

/** `build.json` as the runner wrote it, checked against what was asked for. */
export function checkRecord(files, { repo, sha }) {
  const raw = files.get('build.json');
  if (!raw) fail('remote.artifact', 'the artifact has no build.json');
  let record;
  try {
    record = JSON.parse(utf8(raw));
  } catch {
    fail('remote.artifact', 'build.json is not JSON');
  }
  if (record.schema !== REMOTE_BUILD_SCHEMA) fail('remote.artifact', `build.json is ${record.schema ?? 'unversioned'}, not ${REMOTE_BUILD_SCHEMA}`);
  if (record.sha !== sha) fail('remote.commit', `the artifact was built from ${record.sha}, not ${sha}`);
  if (String(record.repository).toLowerCase() !== repo.full.toLowerCase()) fail('remote.signer', `the artifact was built in ${record.repository}, not ${repo.full}`);
  for (const name of ['project', 'build', 'holo', 'fingerprint', 'holo_sha256']) {
    if (typeof record[name] !== 'string' || record[name] === '') fail('remote.artifact', `build.json has no ${name}`);
  }
  // A holo is named after the app, spaces included (`Leap year.holo`); what a name must not do is leave its directory.
  const leaves = (name) => /[\\/\0]/.test(name) || name === '..' || name.split(/[\\/]/).includes('..');
  if (!/^[A-Za-z0-9_.-]+$/.test(record.project) || record.project === '..' || !/^[0-9a-f]{64}$/.test(record.build) || !/\.holo$/.test(record.holo) || leaves(record.holo)) {
    fail('remote.artifact', `build.json names a project, build or holo a path cannot take: ${JSON.stringify({ project: record.project, build: record.build, holo: record.holo })}`);
  }
  return record;
}

/**
 * Verify a downloaded artifact in `staging` and write the build under
 * `<cwd>/<project>/.prism/build/<build>/`. Resolves to what was verified;
 * rejects with the typed error of the first check that failed. `checkHolo`
 * (`check`) is injectable for tests.
 */
export async function verifyRemoteBuild(files, { cwd, repo, sha, runInfo = null, policy, verifyBundle, run = spawnSync, env = process.env, checkHolo = check }) {
  const record = checkRecord(files, { repo, sha });
  const holoBytes = files.get(`build/${record.holo}`);
  if (!holoBytes) fail('remote.artifact', `the artifact has no build/${record.holo}`);
  const holoSha256 = sha256Hex(holoBytes);
  if (holoSha256 !== record.holo_sha256) throw new DigestMismatchError(`the holo's SHA-256 is ${holoSha256}, not the ${record.holo_sha256} the runner recorded: the bytes changed in transit`, { code: 'remote.digest' });
  const rawBundle = files.get('provenance.sigstore.json');
  if (!rawBundle) fail('remote.provenance', 'the artifact has no provenance.sigstore.json; the build was not signed');
  let bundle;
  try {
    bundle = JSON.parse(utf8(rawBundle));
  } catch {
    fail('remote.provenance', 'provenance.sigstore.json is not JSON');
  }
  const provenance = checkProvenance(bundle, { repo, sha, holoSha256 });

  // Staging under .prism/remote/, never under .prism/build/, until every check has passed.
  const project = resolve(cwd, record.project);
  const staging = join(project, '.prism', 'remote', sha);
  rmSync(staging, { recursive: true, force: true });
  for (const [name, content] of files) {
    if (name.includes('..') || name.startsWith('/')) fail('remote.artifact', `the artifact names a path outside itself: ${name}`);
    const path = join(staging, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const stagedHolo = join(staging, 'build', record.holo);
  const signature = await verifySignature(bundle, { repo, holoPath: stagedHolo, verifyBundle, run });

  const verdict = await checkHolo(stagedHolo, { policy: policy ?? DEFAULT_POLICY, env, signer: repositorySigner(repo) });
  const app = await fromFile(stagedHolo);
  const fingerprint = app.identities?.archiveFingerprint ?? null;
  if (fingerprint !== record.fingerprint) fail('remote.fingerprint', `the holo's fingerprint is ${fingerprint}, not the ${record.fingerprint} the runner recorded`);
  const acceptance = await app.acceptance();
  const verdictCode = exitCodeOf(verdict);
  const vectorsCode = acceptance.failed.length === 0 && acceptance.total > 0 ? 0 : 1;

  let holoPath = stagedHolo;
  if (verdictCode === 0 && vectorsCode === 0) {
    const target = join(project, '.prism', 'build', record.build);
    rmSync(target, { recursive: true, force: true });
    for (const [name, content] of files) {
      if (!name.startsWith('build/')) continue;
      const path = join(target, name.slice('build/'.length));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    holoPath = join(target, record.holo);
  }
  return {
    schema: 'prism/remote-build-result/1',
    repository: repo.full,
    sha,
    run: runInfo,
    project: record.project,
    build: record.build,
    holo: holoPath,
    staging,
    fingerprint,
    holoSha256,
    signature: { ...signature, workflowRef: provenance.workflowRef, workflowPath: provenance.workflowPath },
    verdict,
    vectors: { passed: acceptance.passed, total: acceptance.total, failed: acceptance.failed.map((f) => f.index) },
    exitCode: verdictCode !== 0 ? verdictCode : vectorsCode,
  };
}

// ---------------------------------------------------------------------------
// The whole build.
// ---------------------------------------------------------------------------

/**
 * Build one commit of `cwd` in its GitHub repository and verify what comes
 * back. `log` hears one line per step. Everything that touches the machine or
 * the network is injectable: `fetch`, `run` (spawnSync), `sleep`, `now`,
 * `verifyBundle`.
 */
export async function remoteBuild({
  cwd = process.cwd(),
  repo: override = null,
  ref = 'HEAD',
  allowDirty = false,
  timeoutMs = 30 * 60 * 1000,
  policy = undefined,
  env = process.env,
  fetch = globalThis.fetch,
  run = spawnSync,
  sleep,
  now = Date.now,
  verifyBundle = experimental_verifyBundle,
  version = '0.0.0',
  log = () => {},
} = {}) {
  const repo = repositoryOf(cwd, { override, run });
  const { token, source } = tokenOf({ env, run });
  const { sha, dirty } = commitOf(cwd, { ref, allowDirty, run });
  const client = gitHubClient({ token, fetch, sleep, version });

  const repository = await client.json(`/repos/${repo.full}`);
  if (!repository) fail('remote.repository', `${repo.full} is not a repository the token (${source}) can see`);
  log(`building ${sha.slice(0, 12)} in ${repo.full} (${repository.private ? 'private' : 'public'})${dirty ? ', the working tree\'s changes left out' : ''}`);
  // The workflow must be in the commit itself: a push event runs the workflow of the pushed commit, and
  // the commit may not be on GitHub yet, so this reads the local object, not the API.
  if (!commitHolds(cwd, sha, BUILD_WORKFLOW, { run })) {
    fail('remote.workflow', `the commit ${sha.slice(0, 12)} holds no ${BUILD_WORKFLOW}. Add the template's: ${TEMPLATE_WORKFLOW_URL}, commit it, and build again.`);
  }

  let run0 = await findRun(client, repo, sha);
  let pushed = false;
  if (!run0) {
    if (!repository.permissions?.push) fail('remote.permission', `the token (${source}) cannot push to ${repo.full}, which starting a build needs`);
    log(`pushing ${sha.slice(0, 12)} to ${buildRef(sha)}`);
    pushBuildRef(cwd, sha, { run });
    pushed = true;
    const begin = now();
    while (!run0) {
      if (now() - begin > 120000) fail('remote.run', `no run of ${BUILD_WORKFLOW} started for ${sha.slice(0, 12)} within two minutes of the push; is the workflow's push trigger on prism/build/**?`);
      await client.sleep(5000);
      run0 = await findRun(client, repo, sha);
    }
  } else {
    log(`a run for ${sha.slice(0, 12)} exists: ${run0.html_url}`);
  }
  log(`run ${run0.html_url}`);
  const ended = await waitForRun(client, repo, run0, { timeoutMs, now, onProgress: (p) => p.seconds % 60 < 10 && log(`  ${p.status}, ${p.seconds} s`) });
  if (ended.conclusion !== 'success') {
    fail('remote.run', `the run ended ${ended.conclusion}: ${ended.html_url}. Nothing was built; the log there says why.`);
  }
  log('downloading the artifact');
  const { artifact, files } = await downloadArtifact(client, repo, ended.id, sha);
  const result = await verifyRemoteBuild(files, { cwd, repo, sha, runInfo: { id: ended.id, url: ended.html_url, artifact: artifact.name }, policy, verifyBundle, run, env });
  // The build ref has served, whoever pushed it: a run reused after a refusal still leaves one behind otherwise.
  result.refDeleted = deleteBuildRef(cwd, sha, { run });
  result.pushed = pushed;
  return result;
}

/** Whether an error is one of this module's refusals. */
export const isRemoteError = (error) => error instanceof PrismError && String(error.code).startsWith('remote.');

/** The staging directory a build leaves, for a caller that wants to clean up. */
export const stagingOf = (cwd, project, sha) => join(resolve(cwd, project), '.prism', 'remote', sha);

export const hasRemoteBuild = (cwd, project, sha) => existsSync(join(stagingOf(cwd, project, sha), 'build.json'));

/** The record of a staged build, or null. */
export function readRecord(cwd, project, sha) {
  try {
    return JSON.parse(readFileSync(join(stagingOf(cwd, project, sha), 'build.json'), 'utf8'));
  } catch {
    return null;
  }
}
