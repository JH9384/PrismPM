/**
 * `prism.system`: the `system` module of the nine in #440 (issue #446). It tells
 * you about this installation and does its housekeeping, as Docker's `system`
 * does: `info`, `version`, `events`, `df` and `prune`.
 *
 * It is not the production-system model. That model keeps its name, and its
 * Rust module is the one being renamed.
 *
 * What it reads it is given, because `system` may depend only on `errors`,
 * `verify`, `images`, `containers`, `networks` and `volumes` (model/modules.toml):
 *
 * - `containers` is the namespace `createContainers` made, whose records `df`
 *   counts and `prune` removes.
 * - `events` is the bus the same client gave `createContainers` as `onEvent`
 *   (`createEventBus` below). Without it, `events` raises `system.events`.
 * - `readLock(path)` returns the text of `<path>/prismpm.lock`, or null when there
 *   is none. `client` passes it in Node. In a browser there is none, and `info`
 *   reports no toolchain.
 * - `images` is the images namespace of the same client, whose local store `df`
 *   measures and `prune` collects (#349). Without it, or where it is unavailable
 *   (a browser), `df` and `info` report no images and `prune` removes none.
 *
 * Where Prism differs from Docker:
 *
 * - `info` and `version` also report the toolchain and builder image the lock pins,
 *   which are what a build's verdict depends on.
 * - `prune` removes exited containers first, then untagged images that no
 *   remaining container references. An image a container references is never
 *   pruned, as `docker system prune` keeps it.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
import { fail } from './errors.mjs';
import { VERSION } from './version.mjs';
import { FORMAT_REVISION } from './vendor/spec/constants.mjs';
import { sdkImageFromLock } from './docker.mjs';

export const SYSTEM_INFO_SCHEMA = 'prism/system-info/1';
export const SYSTEM_VERSION_SCHEMA = 'prism/system-version/1';
export const SYSTEM_DF_SCHEMA = 'prism/system-df/1';
export const SYSTEM_PRUNE_SCHEMA = 'prism/system-prune/1';
export const SYSTEM_EVENT_SCHEMA = 'prism/system-event/1';

/** Docker's container actions, the ones a Prism container has. A container never pauses, and a guest has no process to `exec` into. */
export const EVENT_ACTIONS = Object.freeze(['create', 'start', 'die', 'destroy']);

/** How many events a bus keeps for `events({ since })`. Older ones are dropped, oldest first. */
export const EVENT_HISTORY = 1024;

const utf8 = new TextEncoder();

function allow(verb, options, names) {
  const prototype = options === null || typeof options !== 'object' ? undefined : Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) fail('system.option', `system.${verb} options must be a plain object`);
  const unknown = Object.keys(options).filter((name) => !names.includes(name));
  if (unknown.length > 0) fail('system.option', `system.${verb} has no option ${unknown.join(', ')}; it takes ${names.length === 0 ? 'none' : names.join(', ')}`);
}

/** A time as Docker's `since` and `until` take it: a Date, an ISO 8601 text or milliseconds since the epoch. */
function instant(verb, name, value) {
  if (value === undefined) return undefined;
  const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(ms)) fail('system.option', `system.${verb} option ${name} must be a Date, an ISO 8601 time or milliseconds`);
  return ms;
}

/**
 * The event bus one client shares between `containers` (its `onEvent`) and
 * `system.events`. It keeps the last `EVENT_HISTORY` events, so `since` can
 * reach back, and hands every new one to each open stream.
 */
export function createEventBus({ history = EVENT_HISTORY, now = () => Date.now() } = {}) {
  if (!Number.isSafeInteger(history) || history < 0) fail('system.option', 'history must be a whole number of events');
  const kept = [];
  const streams = new Set();
  let sequence = 0;

  function emit({ action, id, image = null, exitCode = null }) {
    if (!EVENT_ACTIONS.includes(action)) fail('system.event', `no container action ${JSON.stringify(action)}; one of ${EVENT_ACTIONS.join(', ')}`);
    const time = now();
    const event = Object.freeze({ schema: SYSTEM_EVENT_SCHEMA, sequence: ++sequence, type: 'container', action, id, image, exitCode, time: new Date(time).toISOString(), timeMs: time });
    kept.push(event);
    if (kept.length > history) kept.shift();
    for (const stream of streams) stream.push(event);
    return event;
  }

  /** An async iterable of events from `since` (only new ones when absent) up to `until` (open when absent). `close()` ends it. */
  function subscribe({ since, until, signal } = {}) {
    const queue = since === undefined ? [] : kept.filter((event) => event.timeMs >= since && (until === undefined || event.timeMs <= until));
    let wake = null;
    let closed = false;
    const finish = () => {
      closed = true;
      streams.delete(stream);
      if (wake !== null) wake();
    };
    const stream = {
      push(event) {
        if (until !== undefined && event.timeMs > until) return finish();
        queue.push(event);
        if (wake !== null) wake();
      },
    };
    // An `until` already past ends once what was kept has been read, as `docker events --until` does.
    if (until !== undefined && until <= now()) closed = true;
    else streams.add(stream);
    signal?.addEventListener?.('abort', finish, { once: true });
    if (signal?.aborted) finish();
    return Object.freeze({
      close: finish,
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            if (queue.length > 0) {
              yield queue.shift();
              continue;
            }
            if (closed) return;
            await new Promise((resolve) => {
              wake = resolve;
            });
            wake = null;
          }
        } finally {
          finish();
        }
      },
    });
  }

  return Object.freeze({ emit, subscribe });
}

/** The runtime this module runs in, without importing anything of Node's. */
function runtime() {
  const node = globalThis.process?.versions?.node;
  if (typeof node === 'string') return { name: 'node', version: node, platform: `${globalThis.process.platform}/${globalThis.process.arch}` };
  return { name: 'browser', version: globalThis.navigator?.userAgent ?? null, platform: null };
}

/** What the lock pins, or null without one. A lock that names no immutable builder is refused, as `build` refuses it. */
function pinned(text) {
  if (text === null || text === undefined) return null;
  let lock;
  try {
    lock = JSON.parse(text);
  } catch {
    lock = null;
  }
  const builder = sdkImageFromLock(text);
  return {
    schema: typeof lock?.schema === 'string' ? lock.schema : null,
    sdkVersion: typeof lock?.sdk_version === 'string' ? lock.sdk_version : null,
    builder,
    toolchain: lock?.inputs?.toolchain && typeof lock.inputs.toolchain === 'object' ? { ...lock.inputs.toolchain } : null,
  };
}

/** The size of a record as its store keeps it, in UTF-8 bytes of its JSON. */
const sizeOf = (record) => utf8.encode(JSON.stringify(record)).length;

/**
 * The `system` namespace.
 *
 * @param {{ containers: { list: Function, prune: Function }, events?: ReturnType<typeof createEventBus> | null, readLock?: ((path: string) => Promise<string | null> | string | null) | null }} dependencies
 */
export function createSystem({ containers, events = null, readLock = null, images = null } = {}) {
  if (typeof containers?.list !== 'function' || typeof containers?.prune !== 'function') fail('system.option', 'prism.system needs the containers namespace of the same client');
  if (events !== null && typeof events?.subscribe !== 'function') fail('system.option', 'events must be the bus from createEventBus, or null');
  if (readLock !== null && typeof readLock !== 'function') fail('system.option', 'readLock must be a function, or null');
  if (images !== null && (typeof images?.usage !== 'function' || typeof images?.prune !== 'function')) fail('system.option', 'images must be the images namespace of the same client, or null');

  /** The image store's usage, or null where this client has none: a browser leaves the store out. */
  const imageUsage = async () => {
    if (images === null) return null;
    try {
      return await images.usage();
    } catch (error) {
      if (error?.code === 'images.unavailable') return null;
      throw error;
    }
  };

  const lockAt = async (path) => {
    if (path === undefined) return null;
    if (typeof path !== 'string' || path === '') fail('system.option', 'path must be a non-empty project folder');
    if (readLock === null) fail('system.lock', 'this client cannot read files, so it cannot read a prismpm.lock; use prism.system from createPrism() in Node');
    return pinned(await readLock(path));
  };

  async function records() {
    const all = await containers.list({ all: true });
    return Promise.all(all.map((container) => container.inspect()));
  }

  /** docker-py's `version`: this package, the holo format it reads, its runtime and, given a project, the toolchain its lock pins. */
  async function version(options = {}) {
    allow('version', options, ['path']);
    const lock = await lockAt(options.path);
    return {
      schema: SYSTEM_VERSION_SCHEMA,
      version: VERSION,
      formatRevision: FORMAT_REVISION,
      runtime: runtime(),
      toolchain: lock?.toolchain ?? null,
      builder: lock?.builder ?? null,
    };
  }

  /** docker-py's `info`: counts of containers by state, what the lock pins, and what is not here yet. */
  async function info(options = {}) {
    allow('info', options, ['path']);
    const lock = await lockAt(options.path);
    const states = { created: 0, running: 0, exited: 0 };
    for (const record of await records()) states[record.state.status] = (states[record.state.status] ?? 0) + 1;
    return {
      schema: SYSTEM_INFO_SCHEMA,
      version: VERSION,
      formatRevision: FORMAT_REVISION,
      runtime: runtime(),
      containers: { total: states.created + states.running + states.exited, ...states },
      images: (await imageUsage())?.rows.length ?? null,
      lock,
      events: events !== null,
    };
  }

  /** docker-py's `df`: what each container record and each stored image takes. An image a container references is active; the rest is reclaimable. */
  async function df(options = {}) {
    allow('df', options, []);
    const rows = (await records()).map((record) => ({ id: record.id, image: record.image.digest, status: record.state.status, size: sizeOf(record) }));
    const reclaimable = rows.filter((row) => row.status === 'exited');
    const usage = await imageUsage();
    const sum = (list) => list.reduce((total, row) => total + row.size, 0);
    return {
      schema: SYSTEM_DF_SCHEMA,
      containers: {
        total: rows.length,
        active: rows.length - reclaimable.length,
        size: rows.reduce((sum, row) => sum + row.size, 0),
        reclaimable: reclaimable.reduce((sum, row) => sum + row.size, 0),
        rows,
      },
      images:
        usage === null
          ? null
          : {
              total: usage.rows.length,
              active: usage.rows.filter((row) => row.containers > 0).length,
              size: sum(usage.rows),
              reclaimable: sum(usage.rows.filter((row) => row.containers === 0)),
              location: usage.location,
              rows: usage.rows,
            },
    };
  }

  /**
   * docker-py's `prune`, for what Prism stores: exited containers, optionally only those
   * that finished before `until`, then the images no remaining container references:
   * untagged ones, or with `all` tagged ones too, as `docker system prune [-a]`.
   * Created and running containers are kept, and so are the images they reference.
   */
  async function prune(options = {}) {
    allow('prune', options, ['until', 'all']);
    const until = instant('prune', 'until', options.until);
    if (options.all !== undefined && typeof options.all !== 'boolean') fail('system.option', 'system.prune option all must be true or false');
    const { containersDeleted, spaceReclaimed } = await containers.prune(until === undefined ? {} : { until });
    const collected = (await imageUsage()) === null ? { imagesDeleted: [], spaceReclaimed: 0 } : await images.prune({ all: options.all ?? false });
    return { schema: SYSTEM_PRUNE_SCHEMA, containersDeleted, imagesDeleted: collected.imagesDeleted, spaceReclaimed: spaceReclaimed + collected.spaceReclaimed };
  }

  /**
   * docker-py's `events`, with `decode` always on: an async iterable of container events.
   * `since` replays what the bus kept from that time; `until` ends the stream there; a
   * `signal` or `close()` ends it early. Filters by `action` and `id`, as `--filter` does.
   */
  function stream(options = {}) {
    allow('events', options, ['since', 'until', 'signal', 'filters']);
    if (events === null) fail('system.events', 'this client has no event bus; use prism.system from createPrism(), whose containers report to it');
    const since = instant('events', 'since', options.since);
    const until = instant('events', 'until', options.until);
    const filters = options.filters ?? {};
    allow('events filters', filters, ['action', 'id']);
    const wanted = (name) => (filters[name] === undefined ? null : new Set([filters[name]].flat()));
    const actions = wanted('action');
    const ids = wanted('id');
    if (actions !== null) for (const action of actions) if (!EVENT_ACTIONS.includes(action)) fail('system.option', `no container action ${JSON.stringify(action)}; one of ${EVENT_ACTIONS.join(', ')}`);
    const source = events.subscribe({ since, until, signal: options.signal });
    return Object.freeze({
      close: source.close,
      async *[Symbol.asyncIterator]() {
        for await (const event of source) {
          if (actions !== null && !actions.has(event.action)) continue;
          if (ids !== null && ![...ids].some((id) => event.id.startsWith(id))) continue;
          yield event;
        }
      },
    });
  }

  return Object.freeze({ info, version, events: stream, df, prune });
}
