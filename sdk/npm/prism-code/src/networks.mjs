/**
 * `prism.networks`: the `networks` module of the nine in #440
 * (docs/proposals/440-nine-modules.md). A network is a named, deny-by-default
 * grant of outbound hosts, not a virtual network: narrower than Docker's word,
 * and the owner chose the name knowing that.
 *
 * It is a view over a capability file (#279), which stays the canonical form. A
 * network is a set of that file with an `allow-outbound-hosts` or
 * `deny-outbound-hosts` member. The other members of a set belong to other
 * modules, and this one keeps them as they are.
 *
 * It holds no state, and reads and writes only through the `store` it is given.
 * It depends only on `errors` and the capability code of `verify`, so it loads
 * without Node. Deployment topology is `images`' and never grants, so it is not
 * read here.
 *
 * Nothing here widens access:
 *
 * - `create` and `connect` refuse an entry outside the active policy.
 * - `connect` refuses a grant of hosts to an image whose world imports no
 *   outbound hosts. A world names interfaces and not hosts (#283), so this check
 *   is by kind. `hologram:guest/core-wasm@1` has no imports, so it refuses today.
 *
 * A refusal is a `CapabilityDeniedError` with the check `capabilities.outbound-hosts`.
 * Its `details` are plain JSON and `details.outside` is `world` or `policy`, so
 * `containers` (#443) can record `code`, `check`, `message` and `details` on the container.
 *
 * Traffic needs host effects (#216, #217). Until they land, a `connect` that is
 * not refused and every `disconnect` raise `networks.unavailable`. No connection
 * can exist, so neither may appear to succeed.
 */
import { CAPABILITIES_SCHEMA, DEFAULT_SET, parseCapabilities } from './capabilities.mjs';
import { CapabilityDeniedError, fail } from './errors.mjs';

const KIND = 'outbound-hosts';
const ALLOW = `allow-${KIND}`;
const DENY = `deny-${KIND}`;
const DEPENDS_ON = Object.freeze(['#216', '#217']);
const DEFAULT_PORTS = Object.freeze({ http: '80', https: '443', ws: '80', wss: '443' });

const isNetwork = (set) => Object.hasOwn(set, ALLOW) || Object.hasOwn(set, DENY);

function parseEntry(entry) {
  const [scheme, rest] = entry.split('://');
  const colon = rest.indexOf(':');
  return colon < 0 ? { scheme, host: rest, port: null } : { scheme, host: rest.slice(0, colon), port: rest.slice(colon + 1) };
}

const portOf = (entry) => entry.port ?? DEFAULT_PORTS[entry.scheme] ?? '';

function hostWithin(inner, outer) {
  if (outer === '*') return true;
  if (outer.startsWith('*.')) return inner !== '*' && inner.endsWith(outer.slice(1));
  return inner === outer;
}

function portWithin(inner, outer) {
  if (outer.port === '*') return true;
  if (inner.port === '*') return false;
  // With every scheme, no port means each scheme's own default, which only the same spelling covers.
  if (inner.scheme === '*') return inner.port === outer.port;
  return portOf(inner) === (outer.port ?? DEFAULT_PORTS[inner.scheme] ?? '');
}

/** Does `outer` match everything `inner` matches? `capabilities.mjs` matches a URL against an entry; a grant compares two entries. */
function entryWithin(innerEntry, outerEntry) {
  const inner = parseEntry(innerEntry);
  const outer = parseEntry(outerEntry);
  return (outer.scheme === '*' || outer.scheme === inner.scheme) && hostWithin(inner.host, outer.host) && portWithin(inner, outer);
}

/** Could one URL match both entries? It answers yes when it cannot tell, which refuses more and never less. */
function entriesOverlap(oneEntry, otherEntry) {
  const one = parseEntry(oneEntry);
  const other = parseEntry(otherEntry);
  if (one.scheme !== '*' && other.scheme !== '*' && one.scheme !== other.scheme) return false;
  if (!hostWithin(one.host, other.host) && !hostWithin(other.host, one.host)) return false;
  if (one.port === '*' || other.port === '*' || one.scheme === '*' || other.scheme === '*') return true;
  return portOf(one) === portOf(other);
}

function refuse(verb, network, resource, outside, why, details = {}) {
  throw new CapabilityDeniedError(`network ${network} cannot ${verb === 'create' ? 'be created' : 'be connected'}: ${why}`, {
    check: `capabilities.${KIND}`,
    details: { kind: KIND, resource, set: network, network, verb, outside, ...details },
  });
}

const describe = (name, set) =>
  Object.freeze({
    name,
    allow: Object.freeze([...(set[ALLOW] ?? [])]),
    deny: Object.freeze([...(set[DENY] ?? [])]),
    // A grant is not traffic. Stated on every view, so a listing never reads as a working network.
    traffic: false,
    dependsOn: DEPENDS_ON,
  });

/**
 * The `networks` namespace over one capability file. #441 builds it for `createPrism`.
 *
 * @param {object} options
 * @param {{ read(): unknown, write?(text: string): unknown }} options.store Holds the capability file. `read` returns its text, bytes or parsed value, or null when there is none; either may be async. Without `write`, a verb that changes the file raises `networks.store`.
 * @param {{ effects?: string[] | null, capabilities?: object | null }} [options.policy] The active policy. `effects` means what it means in a policy file: the impure effects allowed, absent for any, and outbound traffic is `socket`. `capabilities` is one capability set a network must stay within, and absent grants nothing, as in `verify`.
 */
export function createNetworks({ store, policy = {} } = {}) {
  if (typeof store?.read !== 'function') fail('networks.store', 'prism.networks needs a store with read(), which holds the capability file');
  if (policy === null || typeof policy !== 'object') fail('networks.option', 'policy must be an object');
  const { effects = null, capabilities = null } = policy;
  if (effects !== null && !(Array.isArray(effects) && effects.every((effect) => typeof effect === 'string'))) fail('networks.option', 'policy.effects must be an array of effect names');
  const ceiling = parseCapabilities({ schema: CAPABILITIES_SCHEMA, sets: { [DEFAULT_SET]: capabilities ?? {} } }).sets[DEFAULT_SET];

  const read = async () => {
    const source = await store.read();
    return source === null || source === undefined ? null : parseCapabilities(source);
  };
  const write = async (file) => {
    if (typeof store.write !== 'function') fail('networks.store', 'the store has no write(), so the capability file cannot change');
    await store.write(`${JSON.stringify(file, null, 2)}\n`);
  };
  const found = async (name) => {
    const file = await read();
    const set = file !== null && Object.hasOwn(file.sets, name) ? file.sets[name] : null;
    if (set === null || !isNetwork(set)) fail('networks.not-found', `no network named ${JSON.stringify(name)}`);
    return { file, set };
  };

  /** Read back on `connect` too, because the capability file can be edited by hand. */
  const assertWithinPolicy = (verb, name, set) => {
    const allow = set[ALLOW] ?? [];
    if (allow.length === 0) return;
    if (effects !== null && !effects.includes('socket')) {
      refuse(verb, name, allow[0], 'policy', 'the active policy does not allow the socket effect, so it allows no outbound host', { rule: 'policy.effects' });
    }
    for (const entry of allow) {
      if (!(ceiling[ALLOW] ?? []).some((outer) => entryWithin(entry, outer))) {
        refuse(verb, name, entry, 'policy', `${entry} is outside the outbound hosts the active policy allows`, { rule: 'policy.capabilities' });
      }
      for (const denied of ceiling[DENY] ?? []) {
        if (entriesOverlap(entry, denied) && !(set[DENY] ?? []).some((own) => entryWithin(denied, own))) {
          refuse(verb, name, entry, 'policy', `${entry} reaches ${denied}, which the active policy denies`, { rule: 'policy.capabilities' });
        }
      }
    }
  };

  const assertWithinWorld = (name, set, container) => {
    const allow = set[ALLOW] ?? [];
    if (allow.length === 0) return;
    const world = container?.world ?? null;
    const declared = Array.isArray(world?.imports) && world.imports.some((entry) => entry?.capability === KIND);
    if (!declared) {
      const contract = world?.contract ?? null;
      refuse('connect', name, allow[0], 'world', `the world ${contract ?? 'of this image'} imports no ${KIND}, so it cannot be granted any`, { contract });
    }
  };

  const unavailable = (verb, network) =>
    fail('networks.unavailable', `prism.networks.${verb} needs host effects (${DEPENDS_ON.join(', ')}), which this version does not have. Nothing changed, and no traffic can flow on network ${network}.`, {
      verb,
      network,
      dependsOn: DEPENDS_ON,
    });

  return Object.freeze({
    /** Add a grant to the capability file. It grants only `hosts`, and refuses any outside the policy. Docker's `create` makes a virtual network. */
    async create(name, options) {
      if (typeof name !== 'string') fail('capabilities.invalid', 'a network name is a string');
      const { hosts = [], deny, ...rest } = options ?? {};
      const unknown = Object.keys(rest);
      // Docker's driver, internal or ipam would do nothing here, and ignoring one would look as if it had worked.
      if (unknown.length > 0) fail('networks.option', `prism.networks.create takes hosts and deny, not ${unknown.join(', ')}`);
      const sets = (await read())?.sets ?? { [DEFAULT_SET]: {} };
      const existing = Object.hasOwn(sets, name) ? sets[name] : {};
      if (isNetwork(existing)) fail('networks.exists', `a network named ${name} already exists`);
      const grant = { ...existing, [ALLOW]: hosts, ...(deny === undefined ? {} : { [DENY]: deny }) };
      const next = parseCapabilities({ schema: CAPABILITIES_SCHEMA, sets: { ...sets, [name]: grant } });
      assertWithinPolicy('create', name, next.sets[name]);
      await write(next);
      return describe(name, next.sets[name]);
    },

    /** Every grant in the capability file, by name. Docker's `list` also shows its predefined networks; here there are none. */
    async list() {
      const file = await read();
      if (file === null) return Object.freeze([]);
      const names = Object.keys(file.sets).filter((name) => isNetwork(file.sets[name])).sort();
      return Object.freeze(names.map((name) => describe(name, file.sets[name])));
    },

    /** One grant. Docker's `inspect` reports subnets and containers; here a grant has hosts and neither of those. */
    async inspect(name) {
      const { set } = await found(name);
      return describe(name, set);
    },

    /** Remove a grant's outbound hosts, and the set once nothing else is in it. Removing only narrows, so it needs no policy check. */
    async remove(name) {
      const { file, set } = await found(name);
      if (name === DEFAULT_SET) fail('networks.protected', `a capability file must have a ${DEFAULT_SET} set, so it cannot be removed`);
      const { [ALLOW]: _allow, [DENY]: _deny, ...others } = set;
      const { [name]: _set, ...sets } = file.sets;
      await write(parseCapabilities({ schema: CAPABILITIES_SCHEMA, sets: Object.keys(others).length === 0 ? sets : { ...file.sets, [name]: others } }));
    },

    /** Refuse what is outside the policy or the image's world, then raise `networks.unavailable`. Docker's `connect` joins a running container to a network. */
    async connect(name, container) {
      const { set } = await found(name);
      assertWithinPolicy('connect', name, set);
      assertWithinWorld(name, set, container);
      unavailable('connect', name);
    },

    /** Raise `networks.unavailable`: no connection can exist to undo. Docker's `disconnect` removes a container from a network. */
    async disconnect(name, _container) {
      await found(name);
      unavailable('disconnect', name);
    },
  });
}
