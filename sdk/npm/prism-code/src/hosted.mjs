/**
 * The hosted LexLean tiers (experimental): `build --check` and `verify --lean`
 * with no SDK image, through the UOR MCP server's `prism-app` profile.
 *
 * The profile fixes the source root (`src`) and the lexicon packages, so a
 * project is sent only when its `lexlean.toml` has that shape; anything else is
 * refused with `hosted.layout` and runs in the image. Only the files under
 * `src/` are sent. The project's entrypoints are named as the files to verify,
 * and a verification counts only when every entrypoint's module comes back
 * verified (`hosted.coverage`): the profile otherwise verifies its own
 * entrypoint, and an answer about other modules is not an answer about this
 * project.
 *
 * What the hosted tier does not do, and the image does: `prismpm check`'s
 * lockfile and SDK pins, the declaration names under the project's own
 * `module_prefix` (the profile has its own), and the local build directory
 * under `.lexlean/verified/` that `axioms` reads. The record of a hosted
 * verification is written to `.lexlean/hosted/<attestation_id>.json`.
 *
 * Drafts on the server are unlisted, not private: nothing lists or searches
 * them, but `lexlean_draft_read` serves a draft to anyone who has its ID.
 *
 * A tool call carries the gaps recorded since the last one (gaps.mjs) in its
 * `_meta`, and they are marked sent once the server answered: fingerprints,
 * never the user's text, and nothing when telemetry is off.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_URL } from './agents.mjs';
import { fail } from './errors.mjs';
import { GAPS_META_KEY, gapLedger } from './gaps.mjs';
import { parseToml } from './toml.mjs';

export const HOSTED_PROFILE = 'prism-app';
export const HOSTED_PROTOCOL = '2026-07-28';
export const HOSTED_RECORD_SCHEMA = 'prism/hosted-verification/1';
/** The draft holds the files under this root; it is the profile's one source root. */
export const HOSTED_ROOT = 'src';
const RETRY_STATUSES = new Set([502, 503, 504]);

/** The server to use: `PRISM_LEXLEAN_URL`, else the UOR MCP server. */
export const hostedUrl = (env = process.env) => env.PRISM_LEXLEAN_URL || MCP_URL;

/** `src/Foundation/Bytes.lex.tex` is the module `Foundation.Bytes`. */
export function moduleOf(path) {
  const m = /^src\/(.+)\.lex\.tex$/.exec(path);
  return m ? m[1].split('/').join('.') : null;
}

function files(dir, base = '', out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) files(full, rel, out);
    else out.push({ path: `${HOSTED_ROOT}/${rel}`, content: readFileSync(full, 'utf8') });
  }
  return out;
}

/**
 * The keys of a `lexlean.toml` the hosted tier reads: the top-level table,
 * parsed, and the `package` of each `[[lexicon_source]]`. The manifest parser
 * takes no arrays of tables, so only the text before the first header is
 * parsed, and the packages are read from their own sections.
 */
export function readLexleanToml(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const header = lines.findIndex((line) => /^\s*\[/.test(line));
  const config = parseToml(lines.slice(0, header < 0 ? lines.length : header).join('\n'));
  const lexicon = [];
  let inSource = false;
  for (const line of header < 0 ? [] : lines.slice(header)) {
    if (/^\s*\[/.test(line)) {
      inSource = /^\s*\[\[\s*lexicon_source\s*\]\]\s*(#.*)?$/.test(line);
      if (inSource) lexicon.push({});
      continue;
    }
    const m = inSource && /^\s*package\s*=\s*"([^"]*)"\s*(#.*)?$/.exec(line);
    if (m) lexicon[lexicon.length - 1].package = m[1];
  }
  return { ...config, lexicon_source: lexicon };
}

/**
 * The LexLean project at `projectDir` as a draft would hold it: its files
 * under `src/`, its entrypoints and its lexicon packages. Throws
 * `hosted.layout` when the project has a shape the profile cannot take.
 */
export function hostedProject(projectDir) {
  let config;
  try {
    config = readLexleanToml(readFileSync(join(projectDir, 'lexlean.toml'), 'utf8'));
  } catch (error) {
    fail('hosted.layout', `lexlean.toml: ${error.message}`);
  }
  const roots = config.source_roots ?? [];
  if (roots.length !== 1 || roots[0] !== HOSTED_ROOT) fail('hosted.layout', `source_roots is ${JSON.stringify(roots)}; the hosted profile takes only ["${HOSTED_ROOT}"]`);
  const entrypoints = config.entrypoints ?? [];
  if (entrypoints.length === 0) fail('hosted.layout', 'lexlean.toml names no entrypoints');
  for (const entry of entrypoints) if (!moduleOf(entry)) fail('hosted.layout', `entrypoint ${entry} is not a .lex.tex file under ${HOSTED_ROOT}/`);
  const packages = (config.lexicon_source ?? []).map((source) => source.package).filter(Boolean);
  const sources = files(join(projectDir, HOSTED_ROOT));
  for (const entry of entrypoints) if (!sources.some((f) => f.path === entry)) fail('hosted.layout', `entrypoint ${entry} is not in ${HOSTED_ROOT}/`);
  return { files: sources, entrypoints, packages, modulePrefix: config.module_prefix ?? null };
}

/** The packages the project names that the profile does not carry; the draft cannot be checked with those. */
export function missingPackages(project, profile) {
  const carried = new Set((profile.packages ?? []).map((p) => p.package));
  return project.packages.filter((name) => !carried.has(name));
}

/** The answer in a response body: JSON, or the last event of a stream that carries an id. */
function answerOf(text) {
  if (text.trimStart().startsWith('{')) return JSON.parse(text);
  let found = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const event = JSON.parse(line.slice(5));
    if ('id' in event) found = event;
  }
  return found;
}

/**
 * A client of the server's stateless MCP transport. `fetch` and `sleep` are
 * injectable for tests, and so is `gaps`, the ledger whose pending gaps ride
 * on the next call. A 502, 503, 504 or a lost connection is tried again after
 * `retryMs`, `retries` times.
 */
export function hostedClient({ url = hostedUrl(), fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 2, retryMs = 10000, version = '0.0.0', gaps = gapLedger() } = {}) {
  let id = 0;
  const meta = (tasks) => ({
    'io.modelcontextprotocol/protocolVersion': HOSTED_PROTOCOL,
    'io.modelcontextprotocol/clientInfo': { name: 'prism-code', version },
    'io.modelcontextprotocol/clientCapabilities': tasks ? { extensions: { 'io.modelcontextprotocol/tasks': {} } } : {},
  });
  async function rpc(method, name, params) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': HOSTED_PROTOCOL, 'mcp-method': method };
    if (name) headers['mcp-name'] = name;
    const body = JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params });
    for (let attempt = 0; ; attempt++) {
      let status;
      let text;
      try {
        const response = await fetch(url, { method: 'POST', headers, body });
        status = response.status;
        text = await response.text();
      } catch (error) {
        if (attempt < retries) {
          await sleep(retryMs);
          continue;
        }
        fail('hosted.unreachable', `${url} did not answer: ${error.cause?.code ?? error.message}`);
      }
      if (RETRY_STATUSES.has(status) && attempt < retries) {
        await sleep(retryMs);
        continue;
      }
      let answer;
      try {
        answer = answerOf(text);
      } catch {
        answer = null;
      }
      if (!answer) fail('hosted.unreachable', `${url} answered ${method} with HTTP ${status} and no message`);
      if (answer.error) fail('hosted.unreachable', `${url} refused ${method}: ${answer.error.message ?? JSON.stringify(answer.error)}`);
      return answer.result;
    }
  }
  return {
    url,
    async call(tool, args, { tasks = false } = {}) {
      const batch = gaps?.pending() ?? null;
      const result = await rpc('tools/call', tool, { name: tool, arguments: args, _meta: { ...meta(tasks), ...(batch?.meta ? { [GAPS_META_KEY]: batch.meta } : {}) } });
      batch?.commit();
      return result;
    },
    task: (taskId) => rpc('tasks/get', taskId, { taskId, _meta: meta(true) }),
    sleep,
  };
}

/** A tool result that is an error, as a `hosted.unreachable` failure naming the tool. */
function refused(tool, result) {
  const text = result?.content?.[0]?.text ?? JSON.stringify(result?.structuredContent ?? result);
  fail('hosted.unreachable', `${tool} refused the draft: ${String(text).slice(0, 400)}`);
}

/** The profile as the server describes it. */
export async function hostedProfile(client) {
  const result = await client.call('lexlean_profiles', { profile: HOSTED_PROFILE });
  const profile = result?.structuredContent?.profiles?.[0] ?? null;
  if (result?.isError || !profile) refused('lexlean_profiles', result);
  return profile;
}

/** Write the project's files as a draft; the draft is named by its profile and the digest of its files. */
export async function writeDraft(client, project) {
  const profile = await hostedProfile(client);
  const roots = profile.roots ?? [];
  if (roots.length !== 1 || roots[0] !== HOSTED_ROOT) fail('hosted.layout', `the hosted profile's source roots are ${JSON.stringify(roots)}; this prism-code sends only ${HOSTED_ROOT}/`);
  const missing = missingPackages(project, profile);
  if (missing.length > 0) fail('hosted.layout', `the hosted profile does not carry the lexicon package${missing.length === 1 ? '' : 's'} ${missing.join(', ')}`);
  const result = await client.call('lexlean_draft_write', { profile: HOSTED_PROFILE, files: project.files });
  const draft = result?.structuredContent?.draft;
  if (result?.isError || !draft) refused('lexlean_draft_write', result);
  return { draft, profile };
}

/**
 * `lexlean check` on the draft's own files: the command result, whose `success`
 * and `diagnostics` say how it went. No `all`: a draft is the whole profile
 * bundle with the draft's files laid over it, so `all` would check the
 * profile's own modules too (its `Contract`); with no `files` the server
 * selects exactly the draft's files.
 */
export async function hostedCheck(client, project) {
  const { draft, profile } = await writeDraft(client, project);
  const result = await client.call('lexlean_check', { project: draft });
  const outcome = result?.structuredContent;
  if (!outcome || typeof outcome.success !== 'boolean') refused('lexlean_check', result);
  return { draft, profile, outcome };
}

/**
 * `lexlean verify` on the draft's entrypoints, as a task, polled until it
 * ends. Resolves `{ state: 'verified', record }` only when every entrypoint's
 * module is in the record; `{ state: 'failed', diagnostics }` when Lean refused
 * a proof. `onWait` hears the seconds waited at each poll.
 */
export async function hostedVerify(client, project, { timeoutMs = 15 * 60 * 1000, onWait = () => {}, now = Date.now } = {}) {
  const { draft, profile } = await writeDraft(client, project);
  const started = await client.call('lexlean_verify', { project: draft, files: project.entrypoints }, { tasks: true });
  const taskId = started?.taskId;
  if (!taskId) refused('lexlean_verify', started);
  const begin = now();
  let task = started;
  while (task.status === 'working') {
    if (now() - begin > timeoutMs) fail('hosted.unreachable', `the verification ${taskId} did not end in ${Math.round(timeoutMs / 1000)} s`);
    await client.sleep(Math.max(1000, Math.min(task.pollIntervalMs ?? 5000, 10000)));
    task = await client.task(taskId);
    onWait(Math.round((now() - begin) / 1000));
  }
  if (task.status !== 'completed') fail('hosted.unreachable', `the verification ${taskId} ended ${task.status}${task.statusMessage ? `: ${task.statusMessage}` : ''}`);
  const state = task.result?.structuredContent?.state;
  let body = null;
  try {
    body = JSON.parse(task.result?.content?.[0]?.text ?? 'null');
  } catch {
    body = null;
  }
  if (state === 'failed') return { state, draft, profile, diagnostics: body?.diagnostics ?? [], failure: body?.failure ?? null };
  if (state !== 'verified' || !body?.attestation_id) refused('lexlean_verify', task.result);
  const proved = new Set(body.modules ?? []);
  const absent = project.entrypoints.map(moduleOf).filter((m) => !proved.has(m));
  if (absent.length > 0) fail('hosted.coverage', `the hosted verifier verified ${[...proved].join(', ') || 'nothing'}, not the entrypoint module${absent.length === 1 ? '' : 's'} ${absent.join(', ')}; nothing about this project was proved`);
  return { state, draft, profile, record: body };
}

/** The record of a hosted verification, written beside the local build root. Returns its path. */
export function writeHostedRecord(projectDir, { draft, profile, record, url, entrypoints }, { now = () => new Date() } = {}) {
  const dir = join(projectDir, '.lexlean', 'hosted');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${record.attestation_id}.json`);
  const content = {
    schema: HOSTED_RECORD_SCHEMA,
    server: url,
    profile: { name: profile.name ?? HOSTED_PROFILE, id: profile.id ?? null },
    draft,
    entrypoints,
    verified_at: now().toISOString(),
    ...record,
  };
  const temporary = `${path}.prism-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(content, null, 2)}\n`);
  renameSync(temporary, path);
  return path;
}

/** At most this many lines of one diagnostic's message are printed; Lean's goals can run long. */
const DIAGNOSTIC_LINES = 20;

/**
 * Each diagnostic as `file:line:column: CODE message`, the file relative to
 * where the command ran (`dir` is the project's directory there), and the rest
 * of the message, Lean's goal included, indented under it.
 */
export function formatDiagnostics(diagnostics, { dir = '.' } = {}) {
  return diagnostics
    .map((d) => {
      const p = d.primary;
      const file = p?.path ? (dir === '.' ? p.path : `${dir.replace(/\\/g, '/')}/${p.path}`) : null;
      const where = file ? `${file}${p.line_start ? `:${p.line_start}` : ''}${p.line_start && p.column_start ? `:${p.column_start}` : ''}: ` : '';
      const [first = '', ...more] = String(d.message ?? '').replace(/\s+$/, '').split('\n');
      const kept = more.slice(0, DIAGNOSTIC_LINES - 1).map((line) => `    ${line}`.trimEnd());
      if (more.length > kept.length) kept.push(`    ... ${more.length - kept.length} more line${more.length - kept.length === 1 ? '' : 's'}`);
      return [`  ${where}${d.code ?? 'diagnostic'} ${first}`.trimEnd(), ...kept].join('\n');
    })
    .join('\n');
}
