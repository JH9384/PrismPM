/**
 * The machine half of `prism-code setup` (experimental): what a build needs
 * here before any model is written. Like the agent half, it plans first and
 * applies after, so `--dry-run` prints every command and changes nothing.
 *
 * A plain `setup` plans node, endings and github only: the journey proves on
 * the hosted verifier and builds on GitHub Actions, so a first run needs no
 * Docker. The local rows (docker, image, cache) are planned with `local`,
 * which `--local`, `--pull`, `--image` and `--machine-only` set.
 *
 *   node      22 or later.
 *   docker    the program that reaches a daemon: `docker` on the PATH, or
 *             `wsl.exe -d <distro> -- docker` on Windows without Docker
 *             Desktop. Recorded in `$PRISM_HOME/config.json`, so every later
 *             check, build and verify spawns it without probing.
 *   image     the SDK image the project's `prismpm.lock` pins (or `--image`);
 *             outside a project, the one a new app is pinned to.
 *             It is pulled only with `--pull` or `--image`, and the pull
 *             streams its progress. Otherwise a missing image is deferred:
 *             `build --check` and `verify --lean` run hosted without it, and
 *             the first build, verify or axioms pulls it, saying so first.
 *   cache     a volume per image, mounted at /tmp in place of the 2 GB
 *             in-memory tmpfs, so the SDK's 1.2 GB Cargo home is on disk, not
 *             in memory beside the build, and is kept for the next run.
 *   endings   `.gitattributes` with `* text eol=lf` in a project, because
 *             LexLean refuses a file with CRLF and Git on Windows writes it.
 *   github    whether builds can run on GitHub Actions: a token (GITHUB_TOKEN,
 *             GH_TOKEN or gh) and, inside a repository, a github.com origin and
 *             the build workflow. Read only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cacheVolumeName, commandDisplay, sdkImageFromLock } from './docker.mjs';
import { BUILD_WORKFLOW, TEMPLATE_WORKFLOW_URL, originOf, tokenSource } from './github.mjs';
import { hostConfigEntry, readHostConfig, resolveDocker } from './host.mjs';
import { DEFAULT_SDK_IMAGE } from './journey/sdk.mjs';

export const GITATTRIBUTES_LINE = '* text eol=lf';
/** The compressed size of the SDK image the template pins, measured on ghcr.io on 2026-11-16 (`prismpm-sdk@sha256:d6c263a7…`, amd64: 5.70 GB). */
export const SDK_IMAGE_DOWNLOAD = '5.7 GB';
/** The files a project is known by. */
const PROJECT_MARKERS = ['prism.toml', 'prismpm.lock', 'lexlean.toml', 'prismpm.toml'];
/** The sources LexLean reads; a CRLF in one of them is LLC0101. */
const LF_ONLY = /\.(lex\.tex|toml|lock)$/;

const major = (version) => Number(String(version).replace(/^v/, '').split('.')[0]);

function planNode(context) {
  const version = context.nodeVersion;
  return major(version) >= 22
    ? { id: 'node', status: 'already', detail: `node ${version}` }
    : { id: 'node', status: 'failed', detail: `node ${version}; prism-code needs 22 or later` };
}

function planDocker(context) {
  const resolved = context.resolveDocker();
  // Agents can be set up without Docker, so a missing daemon is a manual step here, not a failure.
  if (resolved.kind === 'missing') {
    return { id: 'docker', status: 'manual', detail: `${resolved.reason}; install Docker, or set PRISM_DOCKER to the command that reaches it`, resolved };
  }
  const entry = hostConfigEntry(resolved);
  const where = resolved.kind === 'wsl' ? `docker ${resolved.version} inside WSL ${resolved.distro}, host paths mounted under /mnt` : `docker ${resolved.version}, ${commandDisplay(resolved.command, resolved.args)}`;
  const saved = readHostConfig(context.configDir);
  if (saved && saved.command === entry.command && JSON.stringify(saved.args) === JSON.stringify(entry.args) && saved.mount === entry.mount) {
    return { id: 'docker', status: 'already', detail: where, resolved, steps: [] };
  }
  return { id: 'docker', status: 'configure', detail: where, resolved, steps: [{ kind: 'merge-json', path: join(context.configDir, 'config.json'), patch: { docker: entry } }] };
}

/** `docker <args>` through the resolved program; stdout, or null when it did not answer. */
function ask(context, resolved, args) {
  const result = context.run(resolved.command, [...resolved.args, ...args], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? '').trim();
}

function planImage({ image, pull }, context, resolved) {
  let reference = image ?? null;
  let from = '--image';
  if (!reference) {
    const lock = context.readFile(join(context.cwd, 'prismpm.lock'));
    if (lock === null) {
      // An app that is not pinned yet proves in this image, so it is the one a pull outside a project is for.
      // Reporting "no prismpm.lock" here made setup --pull from the home folder exit 0 having pulled nothing.
      reference = DEFAULT_SDK_IMAGE;
      from = 'no prismpm.lock here, the image new apps are pinned to';
    } else {
      try {
        reference = sdkImageFromLock(lock);
      } catch (error) {
        return { id: 'image', status: 'failed', detail: `prismpm.lock: ${error.message}` };
      }
      from = 'prismpm.lock';
    }
  }
  if (!resolved) return { id: 'image', status: 'manual', detail: `${reference} (${from}); not checked, Docker is missing`, reference };
  const id = ask(context, resolved, ['image', 'inspect', '--format', '{{.Id}}', reference]);
  if (id) return { id: 'image', status: 'already', detail: `${reference} (${from}), ${id.slice(0, 19)}`, reference, steps: [] };
  if (!pull) {
    return {
      id: 'image',
      status: 'deferred',
      detail: `${reference} (${from}) is not here; build --check and verify --lean run hosted without it, and build, verify and axioms pull it on first use (about ${SDK_IMAGE_DOWNLOAD}); ${image ? `setup --image ${reference}` : 'setup --pull'} gets it now`,
      reference,
    };
  }
  return {
    id: 'image',
    status: 'configure',
    detail: `${reference} (${from}): pull, about ${SDK_IMAGE_DOWNLOAD}`,
    reference,
    steps: [{ kind: 'command', command: resolved.command, args: [...resolved.args, 'pull', reference], options: {}, inherit: true, display: `docker pull ${reference}` }],
  };
}

function planCache(context, resolved, reference) {
  if (!resolved || !reference) return { id: 'cache', status: 'not-found', detail: 'no image to cache for' };
  const name = cacheVolumeName(reference);
  const saved = readHostConfig(context.configDir);
  const present = ask(context, resolved, ['volume', 'inspect', '--format', '{{.Name}}', name]) === name;
  const steps = [];
  if (!present) steps.push({ kind: 'command', command: resolved.command, args: [...resolved.args, 'volume', 'create', name], options: {}, display: `docker volume create ${name}` });
  if (!saved?.cache) steps.push({ kind: 'merge-json', path: join(context.configDir, 'config.json'), patch: { cache: true } });
  if (steps.length === 0) return { id: 'cache', status: 'already', detail: `volume ${name} at /tmp`, steps };
  return { id: 'cache', status: 'configure', detail: `volume ${name} at /tmp${present ? '' : ', created'}`, steps };
}

/** Every file under `dir` the scan reads, skipping build outputs and dependencies. */
function sources(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out, depth + 1);
    else if (LF_ONLY.test(entry.name)) out.push(full);
  }
  return out;
}

function planEndings(context) {
  const { cwd } = context;
  if (!PROJECT_MARKERS.some((name) => context.exists(join(cwd, name)))) return { id: 'endings', status: 'not-found', detail: 'no project here' };
  const path = join(cwd, '.gitattributes');
  const text = context.readFile(path);
  const crlf = sources(cwd).filter((file) => (context.readFile(file) ?? '').includes('\r\n'));
  const note = crlf.length ? `; ${crlf.length} file${crlf.length === 1 ? ' has' : 's have'} CRLF already, which LexLean refuses: run git add --renormalize . and commit` : '';
  if (text !== null && /^\*\s+text(\s+\S+)*\s+eol=lf\b/m.test(text)) return { id: 'endings', status: crlf.length ? 'manual' : 'already', detail: `.gitattributes keeps sources LF${note}` };
  // A root rule that turns conversion off keeps every file as committed; a later `* text` line would override it, so it is left alone.
  if (text !== null && /^\*\s+(-text|binary)\b/m.test(text)) return { id: 'endings', status: crlf.length ? 'manual' : 'already', detail: `.gitattributes keeps every file byte for byte, so sources stay LF as committed; left as it is${note}` };
  const content = text === null || text === '' ? `${GITATTRIBUTES_LINE}\n` : `${text}${text.endsWith('\n') ? '' : '\n'}${GITATTRIBUTES_LINE}\n`;
  return { id: 'endings', status: 'configure', detail: `.gitattributes: ${GITATTRIBUTES_LINE}${note}`, steps: [{ kind: 'write', path, content }] };
}

/**
 * What `build --remote github` would find here: the origin repository, a
 * token's source and the build workflow. Nothing to apply; a missing piece is
 * a manual step naming it, and no origin at all is simply not a repository.
 */
function planGitHub(context) {
  const origin = originOf(context.cwd, context.run);
  if (origin === null) {
    // Outside a repository, what matters is the sign-in: prism_build creates the repository itself.
    const token = tokenSource(context.env, context.run);
    return token
      ? { id: 'github', status: 'already', detail: `signed in (${token}): apps build on GitHub Actions, no Docker needed` }
      : { id: 'github', status: 'manual', detail: 'not signed in: run gh auth login, so apps build on GitHub Actions without Docker' };
  }
  if (!origin.repo) return { id: 'github', status: 'manual', detail: `origin is ${origin.url}, not a github.com repository, which build --remote github needs` };
  const token = tokenSource(context.env, context.run);
  const workflow = context.exists(join(context.cwd, ...BUILD_WORKFLOW.split('/')));
  const detail = [
    origin.repo.full,
    token ? `token from ${token}` : 'no token: set GITHUB_TOKEN or GH_TOKEN, or run gh auth login',
    workflow ? `${BUILD_WORKFLOW} present` : `no ${BUILD_WORKFLOW}: add the template's, ${TEMPLATE_WORKFLOW_URL}`,
  ].join('; ');
  return { id: 'github', status: token && workflow ? 'already' : 'manual', detail };
}

/**
 * Everything the machine half would do. `image` overrides the lockfile. A
 * missing image is pulled only when `pull` is true (`--pull`, or `--image`
 * naming one); otherwise it is deferred to the first command that needs it.
 * Without `local`, Docker, the image and the cache are not looked at.
 */
export function planMachine({ image, pull = false, local = true } = {}, context) {
  const node = planNode(context);
  if (!local) return { rows: [node, planEndings(context), planGitHub(context)] };
  const docker = planDocker(context);
  const resolved = docker.resolved?.kind === 'missing' ? null : docker.resolved;
  const imageRow = planImage({ image, pull }, context, resolved);
  const cache = planCache(context, resolved, imageRow.reference ?? null);
  const endings = planEndings(context);
  const github = planGitHub(context);
  return { rows: [node, docker, imageRow, cache, endings, github] };
}

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/** The context `planMachine` reads on this machine. */
export function hostMachineContext({ env = process.env, platform = process.platform, cwd = process.cwd(), configDir } = {}) {
  return {
    platform,
    env,
    cwd,
    configDir,
    nodeVersion: process.versions.node,
    exists: existsSync,
    readFile: readText,
    run: spawnSync,
    resolveDocker: () => resolveDocker({ platform, env }),
  };
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.prism-${process.pid}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

/** Carry out one machine step. A JSON merge reads the file as it is when the step runs, so no other writer's keys are lost. */
export function applyMachineStep(step, { run = spawnSync } = {}) {
  switch (step.kind) {
    case 'write':
      writeAtomic(step.path, step.content);
      return;
    case 'merge-json': {
      let current = {};
      try {
        const parsed = JSON.parse(readFileSync(step.path, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
      } catch {
        // A missing or unreadable config holds only what setup writes.
      }
      writeAtomic(step.path, `${JSON.stringify({ ...current, ...step.patch }, null, 2)}\n`);
      return;
    }
    case 'command': {
      const result = run(step.command, step.args, { ...step.options, encoding: 'utf8', windowsHide: true, stdio: step.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
      if (result.error || result.status !== 0) {
        throw new Error(`${step.display ?? commandDisplay(step.command, step.args)} failed: ${result.error?.code ?? `exit ${result.status}`}${result.stderr ? `: ${String(result.stderr).trim()}` : ''}`);
      }
      return;
    }
    default:
      throw new Error(`unknown step ${step.kind}`);
  }
}

/** Carry out a machine plan in order. A row that fails is marked, and the rows after it still run. */
export function applyMachine(plan, options) {
  for (const row of plan.rows) {
    try {
      for (const step of row.steps ?? []) applyMachineStep(step, options);
    } catch (error) {
      row.status = 'failed';
      row.detail = error.message;
    }
  }
  return plan;
}

const WORDS = {
  configure: ['would configure', 'configured'],
  already: ['ok', 'ok'],
  'not-found': ['skipped', 'skipped'],
  manual: ['manual', 'manual'],
  deferred: ['deferred', 'deferred'],
  failed: ['failed', 'failed'],
};

function formatStep(step) {
  if (step.kind === 'write') return `write ${step.path}`;
  if (step.kind === 'merge-json') return `set ${Object.keys(step.patch).join(', ')} in ${step.path}`;
  return `run ${step.display ?? commandDisplay(step.command, step.args)}`;
}

/** The printed machine rows, one line each, with the steps under their row in a dry run. */
export function formatMachine(plan, { dryRun = false } = {}) {
  const lines = [`prism-code setup${dryRun ? ' --dry-run' : ''}: this machine`];
  for (const row of plan.rows) {
    const word = (WORDS[row.status] ?? [row.status, row.status])[dryRun ? 0 : 1];
    lines.push(`  ${row.id.padEnd(16)}${word.padEnd(20)}${row.detail}`.trimEnd());
    if (dryRun) for (const step of row.steps ?? []) lines.push(`      ${formatStep(step)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The rows as data, for `--json`. */
export function machineReport(plan) {
  return plan.rows.map(({ id, status, detail }) => ({ id, status, detail }));
}

export const machineFailed = (plan) => plan.rows.some((row) => row.status === 'failed');

/** True when `dir` is a Prism project directory, by its marker files. */
export const isProject = (dir) => PROJECT_MARKERS.some((name) => existsSync(join(dir, name)));
