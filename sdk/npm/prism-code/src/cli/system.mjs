/**
 * `prism-code system info|version|events|df|prune` (#446): the CLI of `prism.system`,
 * over the client `Prism.fromEnv()` gives, whose containers live in
 * `$PRISM_HOME/containers`.
 *
 * There is no daemon, so no process hears another's events. `events` reads them
 * from the container records instead: a record's `created`, `startedAt` and
 * `finishedAt` are its create, start and die, and a record that goes away while
 * the stream is open is its destroy. Without `--until` it follows the store, as
 * `docker events` follows the daemon, until interrupted.
 */
import { resolve } from 'node:path';
import { Prism } from '../node.mjs';
import { EVENT_ACTIONS, SYSTEM_EVENT_SCHEMA } from '../system.mjs';
import { readArgs, UsageError, wrapVerbs } from './args.mjs';

export const help = `  prism-code system info [--project <dir>] [--json]
                                                    this installation: package, holo format, runtime, containers
                                                    by state, and the toolchain and builder image the project's
                                                    prismpm.lock pins (the current folder by default)
  prism-code system version [--project <dir>] [--json]
                                                    the package, holo format and runtime, and what the lock pins
  prism-code system events [--since <time>] [--until <time>] [--filter action=<a>|id=<id>]... [--json]
                                                    container create, start, die and destroy events, read from the
                                                    container store; follows it until --until or interrupted. A time
                                                    is ISO 8601, Unix seconds or a duration ago such as 10m
  prism-code system df [--verbose] [--json]         what the container records and the local image store take
  prism-code system prune [-a|--all] [--filter until=<time>] [--force] [--json]
                                                    remove exited containers, then untagged images no container
                                                    references (--all: every image none references); asks first
                                                    unless --force
`;

/** How often a following `events` reads the store, in milliseconds. */
export const EVENTS_POLL_MS = 500;

/** The process's streams and environment, or a test's. */
export function context(io = {}) {
  const env = io.env ?? process.env;
  return {
    stdout: io.stdout ?? process.stdout,
    stderr: io.stderr ?? process.stderr,
    stdin: io.stdin ?? process.stdin,
    cwd: io.cwd ?? process.cwd(),
    env,
    pollMs: io.pollMs ?? EVENTS_POLL_MS,
    signal: io.signal ?? null,
    prism: io.prism ?? Prism.fromEnv({ env, warn: () => {} }),
    // A client keeps each container it has read, so following the store reads it through a new one each time.
    fresh: () => io.prism ?? Prism.fromEnv({ env, warn: () => {} }),
  };
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Docker's `--since` and `--until`: an ISO 8601 time, Unix seconds, or a duration before now (`90s`, `10m`, `2h`). */
export function parseTime(name, value, now = Date.now()) {
  if (value === undefined) return undefined;
  const ago = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  if (ago) return now - Number(ago[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[ago[2]];
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new UsageError(`--${name} takes an ISO 8601 time, Unix seconds or a duration such as 10m`);
  return ms;
}

/** `--filter key=value`, repeated, as a map of sets. */
function filters(list = [], keys) {
  const out = {};
  for (const item of list) {
    const eq = item.indexOf('=');
    const key = keys[item.slice(0, eq)];
    if (eq < 1 || key === undefined) throw new UsageError(`--filter takes ${Object.keys(keys).map((k) => `${k}=<value>`).join(', ')}`);
    (out[key] ??= new Set()).add(item.slice(eq + 1));
  }
  return out;
}

const bytes = (n) => (n < 1000 ? `${n}B` : n < 1e6 ? `${(n / 1e3).toFixed(1)}kB` : `${(n / 1e6).toFixed(1)}MB`);

function lockLines(lock) {
  if (lock === null) return ['Lock:           none in this project'];
  const toolchain = lock.toolchain ? Object.entries(lock.toolchain).map(([tool, version]) => `${tool} ${version}`).join(', ') : 'not pinned';
  return [`Lock:           ${lock.schema ?? 'unnamed schema'}${lock.sdkVersion ? `, SDK ${lock.sdkVersion}` : ''}`, `Builder image:  ${lock.builder ?? 'not pinned'}`, `Toolchain:      ${toolchain}`];
}

const runtimeLine = ({ name, version, platform }) => `Runtime:        ${name} ${version ?? ''}${platform ? ` (${platform})` : ''}`.trimEnd();

async function info(argv, io) {
  const { positional, options } = readArgs(argv, { values: ['project'], flags: ['json'] });
  if (positional.length > 0) throw new UsageError('system info takes no arguments');
  const report = await io.prism.system.info({ path: resolve(io.cwd, options.project ?? '.') });
  if (options.json) return io.stdout.write(json(report)), 0;
  const { total, created, running, exited } = report.containers;
  io.stdout.write(
    [
      `Version:        ${report.version}`,
      `Holo format:    ${report.formatRevision}`,
      runtimeLine(report.runtime),
      `Containers:     ${total} (${created} created, ${running} running, ${exited} exited)`,
      `Images:         ${report.images === null ? 'no local image store' : report.images}`,
      ...lockLines(report.lock),
    ].join('\n') + '\n',
  );
  return 0;
}

async function version(argv, io) {
  const { positional, options } = readArgs(argv, { values: ['project'], flags: ['json'] });
  if (positional.length > 0) throw new UsageError('system version takes no arguments');
  const report = await io.prism.system.version({ path: resolve(io.cwd, options.project ?? '.') });
  if (options.json) return io.stdout.write(json(report)), 0;
  const toolchain = report.toolchain ? Object.entries(report.toolchain).map(([tool, v]) => `${tool} ${v}`).join(', ') : 'no prismpm.lock here';
  io.stdout.write([`Version:        ${report.version}`, `Holo format:    ${report.formatRevision}`, runtimeLine(report.runtime), `Builder image:  ${report.builder ?? 'not pinned'}`, `Toolchain:      ${toolchain}`].join('\n') + '\n');
  return 0;
}

/** The events a record shows, oldest first. */
function recordEvents(record) {
  const at = (action, time, exitCode = null) => (time ? [{ action, id: record.id, image: record.image?.digest ?? null, exitCode, timeMs: Date.parse(time) }] : []);
  return [...at('create', record.created), ...at('start', record.state.startedAt), ...at('die', record.state.finishedAt, record.state.exitCode)];
}

async function snapshot(prism) {
  const all = await prism.containers.list({ all: true });
  return new Map((await Promise.all(all.map((c) => c.inspect()))).map((record) => [record.id, record]));
}

async function events(argv, io) {
  const { positional, options } = readArgs(argv, { values: ['since', 'until', 'filter'], flags: ['json'], repeat: ['filter'] });
  if (positional.length > 0) throw new UsageError('system events takes no arguments');
  const now = Date.now();
  const since = parseTime('since', options.since, now);
  const until = parseTime('until', options.until, now);
  const wanted = filters(options.filter, { action: 'action', event: 'action', id: 'id', container: 'id' });
  for (const action of wanted.action ?? []) if (!EVENT_ACTIONS.includes(action)) throw new UsageError(`--filter action= takes one of ${EVENT_ACTIONS.join(', ')}`);
  let sequence = 0;
  const emit = (event) => {
    if (since !== undefined && event.timeMs < since) return;
    if (until !== undefined && event.timeMs > until) return;
    if (wanted.action && !wanted.action.has(event.action)) return;
    if (wanted.id && ![...wanted.id].some((id) => event.id.startsWith(id))) return;
    const out = { schema: SYSTEM_EVENT_SCHEMA, sequence: ++sequence, type: 'container', action: event.action, id: event.id, image: event.image, exitCode: event.exitCode, time: new Date(event.timeMs).toISOString(), timeMs: event.timeMs };
    io.stdout.write(options.json ? `${JSON.stringify(out)}\n` : `${out.time} container ${out.action} ${out.id}${out.image ? ` (image=${out.image}${out.exitCode === null ? '' : `, exitCode=${out.exitCode}`})` : ''}\n`);
  };
  let seen = await snapshot(io.fresh());
  const shown = new Set();
  const show = (records, quiet = false) => {
    const fresh = [...records.values()].flatMap(recordEvents).filter((e) => !shown.has(`${e.id} ${e.action} ${e.timeMs}`));
    for (const e of fresh.sort((a, b) => a.timeMs - b.timeMs)) {
      shown.add(`${e.id} ${e.action} ${e.timeMs}`);
      if (!quiet) emit(e);
    }
  };
  // Without --since only what happens from now on is new, as with `docker events`.
  show(seen, since === undefined);
  // Follow the store until --until, or until interrupted (Ctrl-C, or `io.signal`).
  let stop = io.signal?.aborted === true;
  const interrupt = () => (stop = true);
  process.once('SIGINT', interrupt);
  io.signal?.addEventListener?.('abort', interrupt, { once: true });
  try {
    while (!stop && (until === undefined || Date.now() <= until)) {
      await new Promise((r) => setTimeout(r, until === undefined ? io.pollMs : Math.max(0, Math.min(io.pollMs, until - Date.now()))));
      let next;
      try {
        next = await snapshot(io.fresh());
      } catch (error) {
        // A record removed between listing the folder and reading it: read the store again on the next turn.
        if (error?.code === 'container.store' || error?.code === 'container.missing') continue;
        throw error;
      }
      show(next);
      const gone = Date.now();
      for (const [id, record] of seen) if (!next.has(id)) emit({ action: 'destroy', id, image: record.image?.digest ?? null, exitCode: null, timeMs: gone });
      seen = next;
      if (until !== undefined && gone >= until) break;
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
  }
  return 0;
}

const imagesLine = (images) =>
  images === null ? 'Images       -       -        -          -  (no local image store)' : `Images       ${String(images.total).padEnd(8)}${String(images.active).padEnd(9)}${bytes(images.size).padEnd(11)}${bytes(images.reclaimable)}`;

async function df(argv, io) {
  const { positional, options } = readArgs(argv, { flags: ['json', 'verbose'], short: { v: 'verbose' } });
  if (positional.length > 0) throw new UsageError('system df takes no arguments');
  const report = await io.prism.system.df();
  if (options.json) return io.stdout.write(json(report)), 0;
  const c = report.containers;
  const lines = ['TYPE         TOTAL   ACTIVE   SIZE       RECLAIMABLE', `Containers   ${String(c.total).padEnd(8)}${String(c.active).padEnd(9)}${bytes(c.size).padEnd(11)}${bytes(c.reclaimable)}`, imagesLine(report.images)];
  if (options.verbose && report.images?.rows.length > 0) {
    lines.push('', 'IMAGE ID       TAGS                                      SIZE     CONTAINERS');
    for (const row of report.images.rows) lines.push(`${row.digest.slice('blake3:'.length, 'blake3:'.length + 12).padEnd(15)}${(row.tags.join(', ') || '<none>').padEnd(42)}${bytes(row.size).padEnd(9)}${row.containers}`);
  }
  if (options.verbose && c.rows.length > 0) {
    lines.push('', 'CONTAINER ID                                                      STATUS    SIZE     IMAGE');
    for (const row of c.rows) lines.push(`${row.id.padEnd(66)}${row.status.padEnd(10)}${bytes(row.size).padEnd(9)}${row.image ?? 'none'}`);
  }
  io.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

/** Ask on a terminal; anything but y or yes is no. */
async function confirm(io, question) {
  if (!io.stdin.isTTY) return null;
  io.stderr.write(`${question} [y/N] `);
  const answer = await new Promise((done) => {
    io.stdin.setEncoding('utf8');
    io.stdin.once('data', (chunk) => done(String(chunk)));
  });
  io.stdin.pause();
  return /^\s*y(es)?\s*$/i.test(answer);
}

async function prune(argv, io) {
  const { positional, options } = readArgs(argv, { values: ['filter'], flags: ['json', 'force', 'all'], short: { f: 'force', a: 'all' }, repeat: ['filter'] });
  if (positional.length > 0) throw new UsageError('system prune takes no arguments');
  const wanted = filters(options.filter, { until: 'until' });
  if ((wanted.until?.size ?? 0) > 1) throw new UsageError('--filter until= is given once');
  const until = wanted.until ? parseTime('filter until', [...wanted.until][0]) : undefined;
  if (!options.force) {
    const yes = await confirm(io, `This removes every exited container record, then ${options.all ? 'every image' : 'every untagged image'} no remaining container references. Continue?`);
    if (yes === null) throw new UsageError('system prune asks before removing anything; pass --force where there is no terminal to ask on');
    if (!yes) return 0;
  }
  const result = await io.prism.system.prune({ ...(until === undefined ? {} : { until }), ...(options.all ? { all: true } : {}) });
  if (options.json) return io.stdout.write(json(result)), 0;
  const ids = result.containersDeleted.map((id) => `${id}\n`).join('');
  const images = (result.imagesDeleted ?? []).map((digest) => `${digest}\n`).join('');
  io.stdout.write(`${ids ? `Deleted containers:\n${ids}\n` : ''}${images ? `Deleted images:\n${images}\n` : ''}Total reclaimed space: ${bytes(result.spaceReclaimed)}\n`);
  return 0;
}

export const verbs = wrapVerbs({ info, version, events, df, prune }, context, help);
