/**
 * The loop behind `prism-code dev` (issue #288, docs/proposals/288-prism-dev.md):
 * watch the project's sources, rebuild when their bytes change, judge the new
 * holo with the same `check` the command line runs, and hand each state to the
 * studio.
 *
 * Nothing here opens a socket or a browser. The watcher, the loop and the
 * build runner take what they act on as arguments, so a test drives each one
 * with a real directory and a fake build.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
import { watch } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, LIMITS, readPolicy, titleOf } from './check.mjs';
import { grantOf } from './capabilities.mjs';
import { MANIFEST_FILE } from './manifest.mjs';
import { readManifest } from './node.mjs';
import { parseToml } from './toml.mjs';
import { ASSURANCE } from './vendor/verify.mjs';

/** The schema of the state the studio reads. Experimental, like the verdict it carries. */
export const DEV_STATE_SCHEMA = 'prism/dev-state/1';

/**
 * What a project without a `[model]` table watches: its model, its lexicons, and
 * the files that configure the build. A lexicon is as much the model as a
 * `.lex.tex` file is. `language/**\/*.toml` is what `prism-code init` declares.
 */
export const DEFAULT_WATCH = Object.freeze(['src/**/*.lex.tex', 'model/**/*.lex.tex', 'language/**/*.toml', MANIFEST_FILE, 'prismpm.toml', 'lexlean.toml']);

/** Directories no pattern reaches: build output and tooling state, which a build itself rewrites. */
export const IGNORED_DIRECTORIES = Object.freeze(['.git', '.prism', '.lake', '.lexlean', 'node_modules', 'target']);

const BIN = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));

/** The most of a build's output the state keeps: its end, where the error is. */
const LOG_LIMIT = 64 * 1024;

const posix = (path) => path.split(sep).join('/');

function globSource(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return out;
}

/**
 * One predicate over project-relative paths with forward slashes. `*` stops at
 * a slash, `**` does not, and a pattern with no wildcard also covers what is
 * under it, so `examples` means the directory.
 *
 * @param {readonly string[]} patterns
 * @returns {(path: string) => boolean}
 */
export function globMatcher(patterns) {
  const rules = patterns.map((pattern) => new RegExp(`^${globSource(pattern)}${/[*?]/.test(pattern) ? '' : '(?:/.*)?'}$`));
  return (path) => rules.some((rule) => rule.test(path));
}

/** Every file under `root` a pattern matches, skipping the ignored directories. */
async function walk(root, matches, ignored, prefix = '') {
  let entries;
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!ignored.has(path) && !ignored.has(entry.name)) files.push(...(await walk(root, matches, ignored, path)));
    } else if (entry.isFile() && matches(path)) files.push(path);
  }
  return files;
}

/**
 * The hash and times of the files being watched. A file's bytes are read only
 * when its size or time moved, and a change is a change of bytes, so saving a
 * file unchanged rebuilds nothing.
 *
 * `extra` names files by absolute path, for a policy that lives outside the
 * project; `exclude` keeps a file out, for a holo the build writes in place.
 */
export function createSnapshot({ root, patterns, ignored = IGNORED_DIRECTORIES, extra = [], exclude = [] }) {
  const matches = globMatcher(patterns);
  const skip = new Set(ignored);
  const excluded = new Set(exclude);
  let known = new Map();

  async function read(path) {
    const full = isAbsolute(path) ? path : join(root, path);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) return null;
    const previous = known.get(path);
    if (previous && previous.size === info.size && previous.mtimeMs === info.mtimeMs) return previous;
    const bytes = await readFile(full).catch(() => null);
    if (bytes === null) return null;
    return { size: info.size, mtimeMs: info.mtimeMs, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  /** Scan, keep the result, and return the paths whose bytes changed with the newest edit time among them. */
  async function scan() {
    const paths = [...new Set([...(await walk(root, matches, skip)), ...extra])].filter((path) => !excluded.has(path)).sort();
    const next = new Map();
    for (const path of paths) {
      const entry = await read(path);
      if (entry) next.set(path, entry);
    }
    const changed = [];
    let editedAt = null;
    for (const [path, entry] of next) {
      if (known.get(path)?.sha256 === entry.sha256) continue;
      changed.push(path);
      editedAt = Math.max(editedAt ?? 0, entry.mtimeMs);
    }
    // A deleted file changes the build too; its edit time is the moment it was seen gone.
    for (const path of known.keys()) {
      if (next.has(path)) continue;
      changed.push(path);
      editedAt = Math.max(editedAt ?? 0, Date.now());
    }
    known = next;
    return { changed: changed.sort(), editedAt, files: [...next.keys()] };
  }

  return { scan };
}

/**
 * Watch `root` and call `onChange({ files, editedAt })` when the bytes of a
 * watched file change. `fs.watch` carries the latency and a slow scan carries
 * the guarantee: a file system that delivers no events (a network mount, a
 * Windows path seen from WSL) is still noticed within `pollMs`.
 *
 * @returns {Promise<{ files: string[], watching: boolean, close: () => void }>} after the first scan, which reports nothing
 */
export async function createWatcher({ root, patterns, ignored, extra, exclude, onChange, onError = () => {}, events = true, debounceMs = 40, pollMs = 1000 }) {
  const snapshot = createSnapshot({ root, patterns, ignored, extra, exclude });
  const { files } = await snapshot.scan();
  let closed = false;
  let scanning = false;
  let again = false;
  let timer = null;

  async function run() {
    if (closed) return;
    if (scanning) {
      again = true;
      return;
    }
    scanning = true;
    try {
      const { changed, editedAt } = await snapshot.scan();
      if (changed.length > 0 && !closed) onChange({ files: changed, editedAt });
    } catch (error) {
      onError(error);
    } finally {
      scanning = false;
    }
    if (again) {
      again = false;
      schedule();
    }
  }

  function schedule() {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  }

  let watcher = null;
  if (events) {
    try {
      watcher = watch(root, { recursive: true }, schedule);
      watcher.on('error', (error) => {
        watcher?.close();
        watcher = null;
        onError(error);
      });
    } catch (error) {
      onError(error);
    }
  }
  const poll = pollMs > 0 ? setInterval(run, pollMs) : null;

  return {
    files,
    get watching() {
      return watcher !== null;
    },
    close() {
      closed = true;
      clearTimeout(timer);
      clearInterval(poll);
      watcher?.close();
    },
  };
}

/**
 * The holo a build result names: the one `.holo` beside the `manifest_path` of
 * the last JSON object the build printed. A rebuild of unchanged source reuses
 * its old directory, so the result is the only way to tell which one is current.
 */
async function holoFromResult(directory, stdout) {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const text = line.trim();
    if (!text.startsWith('{')) continue;
    let manifestPath;
    try {
      manifestPath = JSON.parse(text).manifest_path;
    } catch {
      continue;
    }
    if (typeof manifestPath !== 'string') continue;
    const folder = resolve(directory, dirname(manifestPath));
    const names = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith('.holo')).sort();
    return names.length === 1 ? join(folder, names[0]) : null;
  }
  return null;
}

/** The newest `.holo` written at or after `since`, in the project root or a build directory of its build root. */
async function holoWrittenSince(directory, buildRoot, since) {
  const candidates = [directory];
  const builds = join(directory, buildRoot, 'build');
  for (const name of await readdir(builds).catch(() => [])) candidates.push(join(builds, name));
  let best = null;
  for (const folder of candidates) {
    for (const name of await readdir(folder).catch(() => [])) {
      if (!name.endsWith('.holo')) continue;
      const path = join(folder, name);
      const info = await stat(path).catch(() => null);
      if (info?.isFile() && info.mtimeMs >= since && (!best || info.mtimeMs > best.mtimeMs)) best = { path, mtimeMs: info.mtimeMs };
    }
  }
  return best?.path ?? null;
}

/**
 * Run one build and name the holo it produced. A build that exits 0 and names
 * no holo reports a `problem` and no holo: a verdict on some older file would
 * describe source the developer has already changed.
 *
 * `command` is null for `prism-code build --update --json`, the build in the
 * SDK image `prismpm.lock` names; otherwise it runs in a shell, as an npm script
 * does. `--update` is what makes this a development loop: a plain build refuses
 * a lock whose model pin the edit just made stale (PP5401), so without it every
 * edit would fail. The lock follows the model, for the developer to commit.
 *
 * @param {{ directory: string, command: string | null, holo?: string | null, buildRoot?: string, env?: object, onSpawn?: (child: object) => void, now?: () => number }} options
 */
export async function runBuild({ directory, command, holo = null, buildRoot = '.prism', env = process.env, onSpawn = () => {}, now = Date.now }) {
  const startedAt = now();
  // A coarse file system rounds a time down, so a holo written at once can look older than its build's start.
  const writtenSince = startedAt - 2000;
  const child = command === null
    ? spawn(process.execPath, [BIN, 'build', '--update', '--json'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(command, { cwd: directory, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  onSpawn(child);
  let stdout = '';
  let log = '';
  const keep = (text) => {
    log = `${log}${text}`.slice(-LOG_LIMIT);
  };
  child.stdout.setEncoding('utf8').on('data', (text) => {
    stdout = `${stdout}${text}`.slice(-LOG_LIMIT);
    keep(text);
  });
  child.stderr.setEncoding('utf8').on('data', keep);
  const code = await new Promise((done) => {
    child.on('error', (error) => {
      keep(`${error.message}\n`);
      done(null);
    });
    child.on('close', (exit) => done(exit));
  });
  const ms = now() - startedAt;
  if (code !== 0) return { ok: false, code, ms, log, holo: null, problem: null };
  const named = holo ?? (await holoFromResult(directory, stdout)) ?? (await holoWrittenSince(directory, buildRoot, writtenSince));
  if (named && (await stat(named).catch(() => null))?.isFile()) return { ok: true, code, ms, log, holo: named, problem: null };
  const problem = holo ? `the build exited 0 but ${holo} does not exist` : 'the build exited 0 but wrote no .holo this run; pass --holo <path> to name the file it builds';
  return { ok: true, code, ms, log, holo: null, problem };
}

/**
 * Judge one holo as `prism-code run` judges it: the same `check`, the policy
 * file read fresh, the capability set of `prism.toml`. Also returns the policy
 * as the page's verifier takes it, so the page can reach the verdict on its own.
 */
export async function judgeHolo({ directory, holo, policy, hasManifest }) {
  let capabilities = null;
  if (hasManifest) {
    const { grant } = await readManifest(directory);
    if (grant.capabilities !== null) capabilities = grantOf(grant.capabilities, grant.capabilitySet).members;
  }
  const verdict = await check(holo, { policy, capabilities });
  const file = policy === undefined ? {} : await readPolicy(policy);
  return {
    verdict,
    bytes: new Uint8Array(await readFile(holo)),
    // What the page passes to `verify`: the policy, the grant and the name the verdict settled on. A Rego policy
    // states its own minimum and refuses one given beside it; any other takes the minimum the verdict settled on.
    policy: { ...file, capabilities, name: verdict.policy.name, ...(file.rego === undefined ? { minimum: verdict.policy.minimum } : {}) },
    limits: ASSURANCE.RANK[verdict.level] >= ASSURANCE.RANK.P2 ? [...LIMITS] : [],
    levelName: ASSURANCE.NAMES[verdict.level],
    reasons: verdict.reasons.map((reason) => ({ ...reason, title: titleOf(reason) })),
  };
}

const union = (a, b) => [...new Set([...a, ...b])].sort();

function mergeRequests(a, b) {
  const editedAt = a.editedAt === null || b.editedAt === null ? (a.editedAt ?? b.editedAt) : Math.max(a.editedAt, b.editedAt);
  return { reason: a.rebuild || !b.rebuild ? a.reason : b.reason, files: union(a.files, b.files), editedAt, rebuild: a.rebuild || b.rebuild };
}

/**
 * The state machine: one cycle at a time, and whatever changes during a cycle
 * becomes exactly one more. Each cycle ends in one of three outcomes:
 *
 *   verdict       the build wrote a holo and `check` judged it
 *   no-verdict    the build named no holo, or `check` could not judge the one it named
 *   build-failed  the build exited non-zero, so nothing describes the current source
 *
 * A verdict that no longer describes the source is never shown as current: it
 * moves to `previous` until a new verdict replaces it.
 *
 * @param {{ build: () => Promise<object>, judge: (holo: string) => Promise<object>, replay: (input: { holo: string, verdict: object }) => Promise<object>, initial?: object, onState?: (state: object) => void, now?: () => number }} options
 */
export function createDevLoop({ build, judge, replay, initial = {}, onState = () => {}, now = Date.now }) {
  let state = { schema: DEV_STATE_SCHEMA, revision: 0, phase: 'idle', cycle: null, result: null, previous: null, replay: null, ...initial };
  let holo = null;
  let bytes = null;
  let running = null;
  let queued = null;
  let count = 0;

  const publish = (patch) => {
    state = { ...state, ...patch, revision: state.revision + 1 };
    onState(state);
  };

  /** The last verdict, kept for context while the source has moved past it. */
  const previousOf = () => (state.result?.outcome === 'verdict' ? state.result : state.previous);

  async function runCycle(request) {
    const startedAt = now();
    const cycle = { number: ++count, reason: request.reason, files: request.files, editedAt: request.editedAt, startedAt, build: null, checkMs: null, finishedAt: null, editToVerdictMs: null };
    // Without a holo yet, a policy edit has nothing to re-judge.
    const rebuild = request.rebuild || holo === null;
    publish({ phase: rebuild ? 'building' : 'checking', cycle });

    const finish = (patch, checkMs = null) => {
      const finishedAt = now();
      const editToVerdictMs = request.editedAt === null ? null : Math.max(0, finishedAt - request.editedAt);
      publish({ phase: 'idle', cycle: { ...state.cycle, checkMs, finishedAt, editToVerdictMs }, ...patch });
    };
    const withoutVerdict = (result, checkMs) => {
      const previous = previousOf();
      bytes = null;
      finish({ result, previous, replay: null }, checkMs);
    };

    if (rebuild) {
      let built;
      try {
        built = await build();
      } catch (error) {
        built = { ok: false, code: null, ms: now() - startedAt, log: `${error?.message ?? error}\n`, holo: null, problem: null };
      }
      state = { ...state, cycle: { ...state.cycle, build: { ok: built.ok, code: built.code, ms: built.ms, log: built.log } } };
      holo = built.holo;
      if (!built.ok) return withoutVerdict({ outcome: 'build-failed', code: built.code, log: built.log });
      if (holo === null) return withoutVerdict({ outcome: 'no-verdict', check: 'dev.holo', message: built.problem, holo: null });
      publish({ phase: 'checking' });
    }

    const checkStarted = now();
    let judged;
    try {
      judged = await judge(holo);
    } catch (error) {
      return withoutVerdict({ outcome: 'no-verdict', check: error?.check ?? error?.code ?? 'verify.input', message: error?.message ?? String(error), holo }, now() - checkStarted);
    }
    const checkMs = now() - checkStarted;
    bytes = judged.bytes;
    let replayed;
    try {
      replayed = await replay({ holo, verdict: judged.verdict });
    } catch (error) {
      replayed = { state: 'no-verdict', reason: error?.message ?? String(error) };
    }
    return finish({
      result: { outcome: 'verdict', holo, verdict: judged.verdict, reasons: judged.reasons, levelName: judged.levelName, limits: judged.limits, policy: judged.policy, cycle: cycle.number },
      previous: null,
      replay: replayed,
    }, checkMs);
  }

  async function pump(first) {
    let next = first;
    while (next) {
      queued = null;
      await runCycle(next);
      next = queued;
    }
    running = null;
  }

  return {
    get state() {
      return state;
    },
    /** The bytes of the holo the current verdict judged, or null. */
    get holoBytes() {
      return bytes;
    },
    /** Ask for a cycle. Resolves when the loop has gone idle again. */
    trigger({ reason = 'change', files = [], editedAt = null, rebuild = true } = {}) {
      const request = { reason, files, editedAt, rebuild };
      if (running) {
        queued = queued ? mergeRequests(queued, request) : request;
        return running;
      }
      running = pump(request);
      return running;
    },
  };
}

/** The project's name and build root, from `prism.toml` and `prismpm.toml`, where they exist. */
export async function describeProject(directory) {
  const bytes = await readFile(join(directory, 'prismpm.toml')).catch(() => null);
  let project = null;
  if (bytes !== null) {
    try {
      project = parseToml(new Uint8Array(bytes));
    } catch {
      project = {};
    }
  }
  const buildRoot = typeof project?.build_root === 'string' ? project.build_root : '.prism';
  const hasManifest = (await stat(join(directory, MANIFEST_FILE)).catch(() => null))?.isFile() ?? false;
  if (!hasManifest) return { hasManifest, manifest: null, name: typeof project?.project === 'string' ? project.project : null, buildRoot, isProject: project !== null };
  const { manifest } = await readManifest(directory);
  return { hasManifest, manifest, name: manifest.application.name, buildRoot, isProject: true };
}

/** What a project watches: `[model].watch`, or `[model].source`, or the defaults; always the manifest and a capability file it names. */
export function watchPatterns(manifest) {
  const model = manifest?.model;
  const declared = model?.watch ?? (model?.source !== undefined ? [`${model.source}/**`] : DEFAULT_WATCH);
  const always = manifest ? [MANIFEST_FILE, ...(manifest.capabilities?.file ? [manifest.capabilities.file] : [])] : [];
  return [...new Set([...declared, ...always])];
}

/** A path as the watcher names it: relative to the project when inside it, otherwise absolute. */
export function watchedPath(directory, path) {
  const full = resolve(directory, path);
  const inside = relative(directory, full);
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? posix(inside) : full;
}
