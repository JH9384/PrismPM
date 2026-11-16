/**
 * Run LexLean and PrismPM inside the digest-pinned SDK image, and read their
 * answers back as data the journey can explain.
 *
 * Docker is the one every delegated verb uses (host.mjs): the program `setup`
 * recorded in `$PRISM_HOME/config.json` (Docker Engine inside WSL included,
 * with Windows paths spelled `/mnt/<drive>/...`), else a fresh probe, and the
 * per-image cache volume at `/tmp` when setup created it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { prismHome } from '../agents.mjs';
import { SDK_IMAGE_PATTERN, cacheVolumeName, dockerArguments, mountPath, sdkImageFromLock } from '../docker.mjs';
import { hostDocker } from '../host.mjs';

/**
 * The SDK image a new app is pinned to when none is named: the PrismPM 0.4.0 release, the image
 * UOR-Foundation/template pins, so an app built here and the same app built on GitHub Actions
 * are built by one toolchain. Measured on 2026-11-16: with the 0.3.0 candidate here and the
 * release there, one spec gave two holos of different bytes and the same seal.
 */
export const DEFAULT_SDK_IMAGE = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:d6c263a733a6bc36e0458c3f5b9a1f5ea9c14dfbe8c257d3f650a960b5fe633c';
export const IMAGE_STANDARDS_LOCK = '/opt/prismpm/share/standards.lock';

let cached = null;

/** The host Docker of host.mjs, or `{ error }` when there is none. */
export function resolveDocker({ env = process.env } = {}) {
  if (cached) return cached;
  try {
    const host = hostDocker({ configDir: prismHome(env), env });
    return (cached = { ...host, prefix: host.args, mapPath: (p) => mountPath(p, host.mount) });
  } catch (error) {
    return { error: `${error.message}. Run \`npx prism-code@latest setup\` to find Docker and record it.` };
  }
}

export function imageOf(projectDir) {
  return sdkImageFromLock(readFileSync(`${projectDir}/prismpm.lock`, 'utf8'));
}

/** Whether the image is already local. */
export function hasImage(image) {
  const d = resolveDocker();
  if (d.error) return false;
  const r = spawnSync(d.command, [...d.prefix, 'image', 'inspect', '--format', '{{.Id}}', image], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  return r.status === 0;
}

/** Spawn docker with `args`, `input` on its stdin; stream lines to `onLine`; resolve `{ code, output }`. */
export function docker(args, { onLine = () => {}, timeoutMs = 60 * 60 * 1000, input = null } = {}) {
  const d = resolveDocker();
  if (d.error) return Promise.resolve({ code: 69, output: d.error });
  return new Promise((done) => {
    const child = spawn(d.command, [...d.prefix, ...args], { windowsHide: true, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (input !== null) child.stdin.end(input);
    const chunks = [];
    let pending = '';
    const take = (buffer) => {
      const text = buffer.toString('utf8');
      chunks.push(text);
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) onLine(line);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ code: error.code === 'ENOENT' ? 69 : 70, output: String(error.message) });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (pending) onLine(pending);
      done({ code: code ?? (signal ? 124 : 0), output: chunks.join('') });
    });
  });
}

/** Run a shell script in the project's SDK image, as every delegated verb runs prismpm. `socket` is for `prismpm verify`. */
export function runInImage(projectDir, script, { image = imageOf(projectDir), socket = false, onLine, timeoutMs } = {}) {
  if (!SDK_IMAGE_PATTERN.test(image)) return Promise.resolve({ code: 64, output: `not an immutable SDK image: ${image}` });
  const d = resolveDocker();
  if (d.error) return Promise.resolve({ code: 69, output: d.error });
  let uid = null;
  let gid = null;
  let dockerSocketGid = null;
  if (process.platform !== 'win32') {
    ({ uid, gid } = userInfo());
    if (socket) {
      try {
        dockerSocketGid = statSync('/var/run/docker.sock').gid;
      } catch {
        dockerSocketGid = null;
      }
    }
  }
  const cache = d.cache && process.env.PRISM_CODE_NO_CACHE !== '1' ? cacheVolumeName(image) : null;
  // The script goes in on stdin, never on the command line: `wsl.exe -d <distro> -- docker`
  // runs through a shell on the WSL side, which would expand its `$?` before Docker saw it.
  const args = dockerArguments({ image, cwd: projectDir, command: '-s', program: 'sh', uid, gid, build: socket, dockerSocketGid, cache, mount: d.mount });
  args.splice(args.indexOf('run') + 1, 0, '--interactive');
  return docker(args, { onLine, timeoutMs, input: `${script}\n` });
}

// ---------------------------------------------------------------------------
// Diagnostics.
// ---------------------------------------------------------------------------

/** `error[CODE]: message` blocks with their `--> file:line:col` span. */
export function parseDiagnostics(output) {
  const out = [];
  const lines = String(output).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(error|warning)\[([A-Z]+\d+)\]:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const body = [m[3]];
    let span = null;
    for (let j = i + 1; j < lines.length && !/^(error|warning)\[/.test(lines[j]); j++) {
      const s = /^\s*-->\s*(.+?):(\d+):(\d+)/.exec(lines[j]);
      if (s && !span) span = { file: s[1], line: Number(s[2]), column: Number(s[3]) };
      else if (!/^\s*note:/.test(lines[j]) && !s) body.push(lines[j]);
    }
    out.push({ severity: m[1], code: m[2], message: body.join('\n').trim(), span });
  }
  return out;
}

/** The declaration of a model file that starts at or before `line`. */
export function declarationAt(modelText, line) {
  let name = null;
  const lines = modelText.split(/\r?\n/);
  for (let i = 0; i < Math.min(line, lines.length); i++) {
    if (/^(definition|theorem|structure|inductive)\{/.test(lines[i])) {
      const m = /^\s*name:\s*([A-Za-z0-9_.]+)/.exec(lines[i + 1] ?? '') ?? /name:\s*([A-Za-z0-9_.]+)/.exec(lines[i]);
      if (m) name = m[1];
    }
  }
  return name;
}

/** `PrismX.X.name violates its exact axiom policy: observed [A, B]` gives `{ name, axioms }`. */
export function axiomViolations(diagnostics) {
  return diagnostics
    .filter((d) => d.code === 'LLV7005')
    .map((d) => {
      const m = /`([^`]+)` violates its exact axiom policy: observed (\[[^\]]*\])/.exec(d.message);
      if (!m) return null;
      const observed = m[2].slice(1, -1).split(',').map((a) => a.trim()).filter(Boolean);
      return { name: m[1].split('.').pop(), axioms: m[2], forbidden: observed.filter((a) => !ALLOWED_AXIOMS.includes(a)) };
    })
    .filter(Boolean);
}

/**
 * The only axioms a proof may rest on: Lean's standard three. An observed set
 * becomes a declaration's exact policy only when it stays inside these;
 * `sorryAx` (a missing proof), `Lean.ofReduceBool` (native_decide, which
 * trusts compiled code) or any other axiom fails the proof instead.
 */
export const ALLOWED_AXIOMS = Object.freeze(['propext', 'Quot.sound', 'Classical.choice']);

/** Each fix whose observed axioms leave the allowed three, as `name rests on axiom`; empty when every fix may be recorded. */
export const forbiddenAxioms = (fixes) => fixes.flatMap((f) => f.forbidden.map((a) => `${f.name} rests on ${a}`));

/** The refusal for axioms outside the allowed three. */
export const forbiddenMessage = (lines) => `Lean observed an axiom outside ${ALLOWED_AXIOMS.join(', ')}: ${lines.join('; ')}. A proof that rests on sorryAx, Lean.ofReduceBool (native_decide) or another axiom is not a proof, so Prism refuses it rather than record it.`;

const STEP = (name, command) => `echo "@@step ${name}"; ${command} 2>&1; code=$?; echo "@@exit ${name} $code"; [ $code -eq 0 ] || exit $code`;

/** The first tier: format, lock, check with LexLean, check with PrismPM. Seconds, not minutes. */
export const CHECK_SCRIPT = [STEP('prelock', 'lexlean lock'), STEP('format', 'lexlean fmt --all'), STEP('lock', 'lexlean lock'), STEP('lexlean-check', 'lexlean check --all'), STEP('prismpm-check', 'prismpm check')].join('; ');
/** The second tier: Lean proves every theorem and audits every axiom set. About two to four minutes. */
export const PROVE_SCRIPT = [STEP('prelock', 'lexlean lock'), STEP('format', 'lexlean fmt --all'), STEP('lock', 'lexlean lock'), STEP('verify', 'lexlean verify --all')].join('; ');
/** The third tier: the whole build, the holo and its independent acceptance run. Ten minutes or more when cold. */
export const BUILD_SCRIPT = [STEP('prelock', 'lexlean lock'), STEP('format', 'lexlean fmt --all'), STEP('lock', 'lexlean lock'), STEP('build', 'PRISMPM_PROGRESS=1 prismpm verify')].join('; ');

/** What each step of a script is doing, for a progress line. */
const STEP_LABELS = Object.freeze({
  prelock: 'Locking the LexLean project',
  format: 'Formatting the model',
  lock: 'Locking the formatted model',
  'lexlean-check': 'Checking the model with LexLean',
  'prismpm-check': 'Checking the model with PrismPM',
  verify: 'Lean is proving every theorem',
  build: 'Building the app with prismpm verify',
});

/**
 * The stage a build line names, as a sentence for a progress line, or null
 * when the line names none (issue #585). `@@step` markers name the script's
 * steps; `prismpm: stage <tool>` lines, which `prismpm verify` prints under
 * `PRISMPM_PROGRESS`, name the process or phase it has started. An SDK image
 * whose prismpm predates those lines still reports its steps.
 */
export function buildProgress(line) {
  const step = /^@@step (\S+)$/.exec(line);
  if (step) return Object.hasOwn(STEP_LABELS, step[1]) ? `Stage: ${STEP_LABELS[step[1]]}.` : `Stage: ${step[1]}.`;
  const stage = /^prismpm: stage (\S+)$/.exec(line);
  if (!stage) return null;
  const tool = stage[1];
  const kind =
    tool === 'lean-proof' ? 'Lean proof'
    : tool === 'holo' ? 'the holo'
    : /wasm/.test(tool) ? 'WebAssembly'
    : /acceptance|replay|consumer|oracle|conformance|harness/.test(tool) ? 'the acceptance run'
    : /lean|lake|export|leanchecker/.test(tool) ? 'Lean export'
    : /cargo|rust|generated|native|library|text-cli|server/.test(tool) ? 'Rust'
    : 'tools';
  return `Stage: ${kind} (${tool}).`;
}

/** The steps a script ran and the exit code of each, from its markers. */
export function steps(output) {
  const out = [];
  for (const m of String(output).matchAll(/^@@exit (\S+) (\d+)$/gm)) out.push({ step: m[1], code: Number(m[2]) });
  return out;
}
