/**
 * Containers: one run of a holo as an object with Docker's states (issue #348,
 * docs/proposals/348-container-lifecycle.md). A container is created from an
 * image and an input, is started once or again, and is kept with its exit code
 * and output until it is removed.
 *
 *   created --start--> running --guest returned or threw--> exited --start--> running
 *      |                                                      ^
 *      +----- check refused the holo, the guest never ran ----+
 *
 * This is the developer view of an instance (#346); the model's terms do not
 * change. The gate is the verdict of `check` (#282), so no container runs a
 * holo that check refuses unless the caller says `allowUnverified`.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
import { PrismError, VerificationError, errorFromVerdict, exitCodeFor, fail } from './errors.mjs';
import { attestationBlocker } from './verify.mjs';
import { ASSURANCE } from './vendor/verify.mjs';

export const CONTAINER_SCHEMA = 'prism/container/1';

const utf8 = new TextDecoder('utf-8', { fatal: true });
const HEX_ID = /^[0-9a-f]{1,64}$/;

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function inputBytes(input) {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return fail('container.input', 'a container takes one input: a string or bytes');
}

function encodeOutput(bytes) {
  try {
    return { encoding: 'utf-8', data: utf8.decode(bytes) };
  } catch {
    return { encoding: 'hex', data: hex(bytes) };
  }
}

function decodeOutput(output) {
  if (output === null) return null;
  if (output.encoding === 'utf-8') return new TextEncoder().encode(output.data);
  return Uint8Array.from(output.data.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

function errorSummary(error) {
  const summary = { name: error?.name ?? 'Error', code: error?.code ?? null, message: String(error?.message ?? error) };
  if (error?.check !== undefined) summary.check = error.check;
  if (error?.diagnostic !== undefined) summary.diagnostic = error.diagnostic;
  return summary;
}

/** The warning a run under `allowUnverified` gives, on every start. `error` explains a null verdict. */
export function unverifiedWarning(verdict, error) {
  if (verdict === null) return `no verdict (${error.check ?? error.code}: ${error.message}); running it unverified`;
  const failed = verdict.reasons.filter((r) => r.check !== 'policy.level').map((r) => r.check).join(', ') || 'policy.level';
  return `the holo failed check (${verdict.level}, policy ${verdict.policy.name} requires ${verdict.policy.minimum}): ${failed}; running it unverified`;
}

/**
 * The verdict the holo runs under, and the error that explains a refusal.
 * `policy` is the members `experimental_verify` takes, or a function that
 * returns them, so that a policy file that cannot be read is no verdict and
 * not a failure to create. Whatever else goes wrong is no verdict too, as in
 * `check`: the gate fails closed.
 */
async function judge(app, policy) {
  try {
    const members = typeof policy === 'function' ? await policy() : policy;
    const blocked = app.archive?.bytes ? attestationBlocker(app.archive.bytes) : null;
    if (blocked) throw blocked;
    const verdict = await app.experimental_verify(members ?? undefined);
    return { verdict, error: errorFromVerdict(verdict, ASSURANCE.RANK) };
  } catch (error) {
    if (error instanceof PrismError) return { verdict: null, error };
    return { verdict: null, error: new VerificationError(error?.message ?? String(error), { check: 'verify.input', cause: error }) };
  }
}

/** Records in memory: the default store, in Node and in a browser. A record lives as long as the process. */
export function memoryContainerStore() {
  const records = new Map();
  return Object.freeze({
    put: async (record) => void records.set(record.id, structuredClone(record)),
    get: async (id) => structuredClone(records.get(id)),
    find: async (prefix) => [...records.keys()].filter((id) => id.startsWith(prefix)),
    remove: async (id) => void records.delete(id),
  });
}

class Container {
  #record;
  #app;
  #input;
  #policy;
  #allowUnverified;
  #store;
  #warn;
  #forget;
  #output;
  #error = null;
  #inFlight = null;
  #removed = false;

  constructor({ record, app = null, input = null, policy, allowUnverified = false, store, warn, forget }) {
    this.#record = record;
    this.#app = app;
    this.#input = input;
    this.#policy = policy;
    this.#allowUnverified = allowUnverified;
    this.#store = store;
    this.#warn = warn;
    this.#forget = forget;
    this.#output = decodeOutput(record.output);
  }

  get id() {
    return this.#record.id;
  }

  /** `created`, `running` or `exited`. */
  get status() {
    return this.#record.state.status;
  }

  /** The exit code once exited, otherwise null. */
  get exitCode() {
    return this.#record.state.exitCode;
  }

  /** The bytes the guest returned, or null when it returned none. */
  get output() {
    return this.#output;
  }

  /** The typed error that ended this run, or null. A container read back from a store has the summary in `inspect()` instead. */
  get error() {
    return this.#error;
  }

  /** The output as text, or null when the guest returned none. */
  text() {
    return this.#output === null ? null : new TextDecoder().decode(this.#output);
  }

  /**
   * Run the holo, and resolve to this container once it has exited. A second
   * call while it runs joins that run; a call after it exited runs it again
   * from the same input, as `docker start` does. A failure of the run is the
   * exit code, never a rejection.
   */
  start() {
    this.#inFlight ??= this.#run().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #run() {
    if (this.#removed) fail('container.missing', `no such container: ${this.id}`);
    if (this.#app === null) fail('container.state', `container ${this.id} was read back from its store, which does not keep its input; run the holo again instead`);
    const { verdict, error } = await judge(this.#app, this.#policy);
    this.#record.verdict = verdict;
    if (error !== null) {
      if (!this.#allowUnverified) return this.#exit({ error, startedAt: null });
      this.#warn(unverifiedWarning(verdict, error));
    }
    const startedAt = new Date().toISOString();
    this.#record.state = { status: 'running', exitCode: null, error: null, startedAt, finishedAt: null };
    this.#record.output = null;
    this.#output = null;
    this.#error = null;
    await this.#store.put(this.#record);
    let output;
    try {
      output = await this.#app.dispatch(this.#input);
    } catch (thrown) {
      return this.#exit({ error: thrown, startedAt });
    }
    return this.#exit({ error: null, startedAt, output });
  }

  async #exit({ error, startedAt, output = null }) {
    this.#error = error;
    this.#output = output;
    this.#record.state = {
      status: 'exited',
      exitCode: exitCodeFor(error),
      error: error === null ? null : errorSummary(error),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    this.#record.output = output === null ? null : encodeOutput(output);
    if (this.#record.rm) await this.#drop();
    else await this.#store.put(this.#record);
    return this;
  }

  async #drop() {
    await this.#store.remove(this.id);
    this.#removed = true;
    this.#forget(this.id);
  }

  /**
   * The record: state, exit code, image digest, verdict and output. Rejects
   * with `container.missing` once the container is removed; what you hold
   * keeps `status`, `exitCode`, `error` and `output`.
   */
  async inspect() {
    if (this.#removed) fail('container.missing', `no such container: ${this.id}`);
    return structuredClone(this.#record);
  }

  /** Remove the container and its record. A running container is refused, as Docker refuses it without `--force`. */
  async remove() {
    if (this.#removed) fail('container.missing', `no such container: ${this.id}`);
    if (this.#inFlight !== null) fail('container.running', `container ${this.id} is running and cannot be removed`);
    await this.#drop();
  }
}

/**
 * The `containers` namespace over a loader and a store. `load` opens an image;
 * `store` keeps the records; `warn` receives the warning of an unverified run.
 */
export function createContainers({ load, store = memoryContainerStore(), warn = (message) => console.warn(`prism-code: ${message}`) }) {
  const live = new Map();
  const forget = (id) => live.delete(id);

  /**
   * Open the image and make a container in state `created`. An image that
   * cannot be opened makes no container: this rejects with its typed error, as
   * `docker create` fails on an image it cannot find.
   */
  async function create(image, input, options = {}) {
    const { policy, allowUnverified = false, rm = false, ...loadOptions } = options;
    // A copy: a later `start` runs the input as it was given here.
    const bytes = inputBytes(input).slice();
    const app = typeof image?.dispatch === 'function' ? image : await load(image, loadOptions);
    const fingerprint = app.identities?.archiveFingerprint;
    const record = {
      schema: CONTAINER_SCHEMA,
      id: hex(crypto.getRandomValues(new Uint8Array(32))),
      image: { name: app.name ?? null, kind: app.kind ?? null, digest: fingerprint ? `blake3:${fingerprint}` : null },
      created: new Date().toISOString(),
      rm,
      state: { status: 'created', exitCode: null, error: null, startedAt: null, finishedAt: null },
      verdict: null,
      output: null,
    };
    await store.put(record);
    const container = new Container({ record, app, input: bytes, policy, allowUnverified, store, warn, forget });
    live.set(record.id, container);
    return container;
  }

  /** Create and start: resolves to the container once it has exited, whatever its exit code. */
  async function run(image, input, options) {
    const container = await create(image, input, options);
    return container.start();
  }

  /** The container with this id, or with this unique id prefix. */
  async function get(id) {
    const ids = typeof id === 'string' && HEX_ID.test(id) ? await store.find(id) : [];
    if (ids.length === 0) fail('container.missing', `no such container: ${id}`);
    if (ids.length > 1) fail('container.ambiguous', `${id} names ${ids.length} containers; give more of the id`);
    const known = live.get(ids[0]);
    if (known) return known;
    const container = new Container({ record: await store.get(ids[0]), store, warn, forget });
    live.set(ids[0], container);
    return container;
  }

  return Object.freeze({
    run,
    create,
    get,
    start: async (id) => (await get(id)).start(),
    remove: async (id) => (await get(id)).remove(),
  });
}
