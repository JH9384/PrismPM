import { createClock } from './clock.mjs';
import { createRandom } from './random.mjs';
import { TestSetupError, UnexpectedCallError } from './errors.mjs';
import { DEFAULT_SET, fromFile, grantOf, load, parseCapabilities } from './runtime.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytesOf = (value) => (typeof value === 'string' ? encoder.encode(value) : value instanceof Uint8Array ? value : encoder.encode(JSON.stringify(value)));

function responseOf(stub, url) {
  const init = stub !== null && typeof stub === 'object' && !(stub instanceof Uint8Array) && ('body' in stub || 'status' in stub) ? stub : { body: stub };
  const body = bytesOf(init.body ?? '');
  const status = init.status ?? 200;
  return Object.freeze({ url, status, ok: status >= 200 && status < 300, headers: Object.freeze({ ...(init.headers ?? {}) }), body, text: () => decoder.decode(body) });
}

/**
 * A host for code under test: a clock that moves when the test says, a seeded random source, and the
 * three resources a capability file can grant (outbound hosts, key-value stores, variables), each
 * checked against the same grant the runtime enforces. With no capability file nothing is granted,
 * as in `load`, so a test learns about a missing grant the way production would.
 *
 * - `clock`: `now`, `advance`, `next`, `runAll`, `sleep`, `until`, `setTimeout`.
 * - `random`: `next`, `int`, `bytes`, `uuid`, `getRandomValues`, from `seed`.
 * - `fetch(url, init)`: `CapabilityDeniedError` (`capabilities.outbound-hosts`) unless granted, then the
 *   stub for the exact URL in `fetch`, else `UnexpectedCallError`. A stub is a response body, a
 *   `{ status, headers, body }`, or a function of `(url, init)` returning either.
 * - `kv(store)`: `get`, `set`, `delete`, `keys` over `stores`, `capabilities.key-value-stores` unless granted.
 * - `variable(name)`: the value in `variables`, `capabilities.variables` unless granted.
 * - `calls`: every host call so far, with the clock time it happened at.
 * - `load(source, options)`: open a holo under this host's capability file and set.
 *
 * @param {object} [options]
 * @param {number | string | Date} [options.start] where the clock starts; default 2026-01-01T00:00:00Z
 * @param {number | string} [options.seed] default 0
 * @param {string | Uint8Array | object | null} [options.capabilities] a `prism/capabilities/1` file
 * @param {string} [options.capabilitySet] default `default`
 * @param {Record<string, string>} [options.variables]
 * @param {Record<string, Record<string, string>>} [options.stores]
 * @param {Record<string, unknown>} [options.fetch]
 */
export function createMockHost(options = {}) {
  const known = ['start', 'seed', 'capabilities', 'capabilitySet', 'variables', 'stores', 'fetch'];
  const unknown = Object.keys(options).find((key) => !known.includes(key));
  if (unknown !== undefined) throw new TestSetupError(`unknown mock host option ${unknown}; expected ${known.join(', ')}`, { check: 'testing.host' });
  const { start, seed, capabilities = null, capabilitySet = DEFAULT_SET, variables = {}, stores = {}, fetch: stubs = {} } = options;

  const file = capabilities === null ? null : parseCapabilities(capabilities);
  const grant = grantOf(file, capabilitySet);
  const clock = createClock({ start });
  const random = createRandom({ seed });
  const calls = [];
  const data = new Map(Object.entries(stores).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
  const record = (kind, resource) => calls.push(Object.freeze({ kind, resource, at: clock.now() }));

  const host = {
    clock,
    random,
    capabilities: grant,
    calls,
    async fetch(url, init = {}) {
      record('fetch', url);
      grant.assert('outbound-hosts', url);
      if (!Object.hasOwn(stubs, url)) {
        throw new UnexpectedCallError(`fetch ${JSON.stringify(url)} is granted but the test stubs no response for it; stubbed: ${Object.keys(stubs).join(', ') || 'none'}`, {
          check: 'testing.unexpected_call',
          details: { kind: 'fetch', resource: url },
        });
      }
      const stub = stubs[url];
      return responseOf(typeof stub === 'function' ? await stub(url, init) : stub, url);
    },
    kv(store) {
      record('kv', store);
      grant.assert('key-value-stores', store);
      if (!data.has(store)) data.set(store, new Map());
      const entries = data.get(store);
      return Object.freeze({
        get: (key) => entries.get(key) ?? null,
        set: (key, value) => void entries.set(key, String(value)),
        delete: (key) => entries.delete(key),
        keys: () => [...entries.keys()].sort(),
      });
    },
    variable(name) {
      record('variable', name);
      grant.assert('variables', name);
      return variables[name];
    },
    /** Open a holo (bytes, or a path) with the capability file and set this host was made with. */
    load(source, loadOptions = {}) {
      const grantOptions = { capabilities: file === null ? null : file, capabilitySet };
      return typeof source === 'string' || source instanceof URL ? fromFile(source, { ...grantOptions, ...loadOptions }) : load(source, { ...grantOptions, ...loadOptions });
    },
  };
  return Object.freeze(host);
}
