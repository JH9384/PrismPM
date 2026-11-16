/**
 * `prism.volumes`: the `volumes` module of the nine in #440
 * (docs/proposals/440-nine-modules.md, experimental), a view over the capability
 * file. It depends on `errors` and on `verify`'s capability code, and on nothing
 * else, so it loads without Node.
 *
 * A volume is a named, declared store from a provider. It is not a mounted folder,
 * which is narrower than Docker's word, and the owner chose the name knowing that.
 *
 * - The capability file says which stores exist: `allow-key-value-stores`, less
 *   `deny-key-value-stores`. This module never writes the file, so no call can add
 *   a grant.
 * - `declarations` say which provider serves each store, as `manifestProviders`
 *   returns them. A volume's name is its capability's name and its store's label.
 * - `runner` runs the provider, with `up` and `down` taking one declaration. `client`
 *   passes it in, because `providers.mjs` needs Node. With no runner, as in a browser,
 *   `create` and `remove` raise `ProviderNotFoundError` (`provider.runner`).
 * - It never reads or writes a system model. A deployment volume is `images`' topology.
 *
 * Every refusal is a `CapabilityDeniedError`, and adds no error code. `check` is
 * `capabilities.key-value-stores` or `capabilities.providers` with `details.outside`
 * saying what it is outside of (`grant`, `declaration`, `world` or `policy`),
 * `capabilities.host-folder` for a host folder, or `capabilities.host-effects` for a
 * call that needs host effects, whose `details.dependsOn` names them.
 *
 * A guest cannot reach a store yet: the only world has no imports, and imports need
 * host effects (#216, #217). So `attachVolume`, which `containers` calls (#443), always
 * refuses. `refusalRecord` is what `containers` keeps on the container.
 */
import { DEFAULT_SET, grantOf, parseCapabilities } from './capabilities.mjs';
import { CapabilityDeniedError, PrismError, ProviderNotFoundError, fail } from './errors.mjs';

/** What real store access from a guest depends on. */
export const HOST_EFFECTS = Object.freeze(['#216', '#217']);

const KIND = 'key-value-stores';
const STORE_CHECK = `capabilities.${KIND}`;
const PROVIDER_CHECK = 'capabilities.providers';
const FOLDER_CHECK = 'capabilities.host-folder';
// An `allow-key-value-stores` entry without the wildcard, which matches any label and so names no volume.
const STORE = /^[a-z0-9][a-z0-9_-]*$/;
// `verify` calls an import outside WASI an `unknown` effect, and no WASI interface it classifies is a store.
const STORE_EFFECT = 'unknown';
const GUEST = Object.freeze({ access: false, dependsOn: HOST_EFFECTS });

const FOLDER_KEY = /^(?:binds?|device|dir|directory|folder|hostpath|mounts?|mountpoint|path|source|src)$/;
const ROOTED = /^(?:[/\\~]|\.{1,2}(?:[/\\]|$)|[a-z]:[/\\]|file:)/i;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A path on the host: rooted, or relative with a separator. `key=value` and `scheme://` are values that hold a separator. */
const isHostPath = (text) => ROOTED.test(text) || (/[/\\]/.test(text) && !/^[^/\\]*=/.test(text) && !/^[a-z][a-z0-9+.-]*:\/\//.test(text));

/**
 * Whether a value names a host folder, by a key such as `device` or a value that is a path.
 * This reads shape: a provider's own options mean what it says they mean, so a bare folder
 * name under a key not listed here passes. `allow-providers` is what bounds a provider.
 */
function holdsHostFolder(value, seen = new Set()) {
  if (typeof value === 'string') return isHostPath(value);
  if (value === null || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, entry]) => FOLDER_KEY.test(key.toLowerCase().replace(/[-_]/g, '')) || holdsHostFolder(entry, seen));
}

function refused(verb, volume, check, message, details = {}) {
  return new CapabilityDeniedError(message, { check, details: { module: 'volumes', verb, volume, ...details } });
}

const hostFolder = (verb, volume, what) => refused(verb, volume, FOLDER_CHECK, `${what} a host folder, and a volume is a declared store: a host folder would escape what was verified`);

function readWorld(world) {
  if (world === null) return null;
  if (!isObject(world) || !Array.isArray(world.imports)) fail('capabilities.invalid', 'world must be a row of WORLDS, with an imports array, or null');
  return world;
}

function readPolicy(policy) {
  if (policy === null) return null;
  const known = isObject(policy) && Object.keys(policy).every((member) => member === 'name' || member === 'effects');
  // A Rego policy stops here: this module cannot evaluate one, and must not read it as allowing everything.
  if (!known || !(policy.effects === null || Array.isArray(policy.effects))) fail('capabilities.invalid', 'policy must be { name, effects }, where effects is what `verify` read from the active policy: the impure effects it allows, or null for any');
  return policy;
}

function readDeclarations(declarations) {
  if (!Array.isArray(declarations)) fail('capabilities.invalid', 'declarations must be an array, as manifestProviders returns');
  return new Map(
    declarations.map((declaration) => {
      if (!isObject(declaration) || typeof declaration.name !== 'string' || typeof declaration.type !== 'string') fail('capabilities.invalid', 'a declaration has a name and a provider type, as manifestProviders returns');
      return [declaration.name, declaration];
    }),
  );
}

/** One image and policy's checks over one capability set, shared by the verbs and `attachVolume`. */
function scopeOf({ capabilities = null, set = DEFAULT_SET, world = null, policy = null, declarations = [] }) {
  const grant = grantOf(capabilities === null ? null : parseCapabilities(capabilities), set);
  const imageWorld = readWorld(world);
  const activePolicy = readPolicy(policy);
  const declared = readDeclarations(declarations);

  const by = grant.set === null ? 'no capability file grants anything' : `capability set ${grant.set} does not allow it`;

  function checkName(verb, name) {
    if (typeof name !== 'string') throw refused(verb, null, STORE_CHECK, 'a volume is named by a string', { outside: 'grant', set: grant.set });
    if (name.includes(':') || isHostPath(name)) throw hostFolder(verb, name, `${JSON.stringify(name)} is`);
    if (!STORE.test(name)) throw refused(verb, name, STORE_CHECK, `${JSON.stringify(name)} is not a store label; it must match ${STORE.source}`, { outside: 'grant', kind: KIND, resource: name, set: grant.set });
    if (!grant.allows(KIND, name)) throw refused(verb, name, STORE_CHECK, `volume ${name} is denied: ${by}`, { outside: 'grant', kind: KIND, resource: name, set: grant.set });
  }

  /** Docker's options, such as `driver_opts` and `force`, are refused and not ignored: an ignored one would appear to succeed. */
  function checkOptions(verb, volume, options) {
    if (options === undefined || options === null) return;
    if (holdsHostFolder(options)) throw hostFolder(verb, volume, `${verb} was given`);
    if (isObject(options) && Object.keys(options).length === 0) return;
    throw refused(verb, volume, STORE_CHECK, `${verb} takes no options: the capability file and the provider's declaration say all there is about a volume`, { outside: 'declaration', set: grant.set });
  }

  function checkDeclared(verb, name) {
    const declaration = declared.get(name);
    if (declaration === undefined) throw refused(verb, name, PROVIDER_CHECK, `volume ${name} is granted, and no provider declares it`, { outside: 'declaration', set: grant.set });
    const options = declaration.options ?? {};
    if (holdsHostFolder(options)) throw hostFolder(verb, name, `the declaration of ${name} names`);
    if (options.store !== undefined && options.store !== name) throw refused(verb, name, STORE_CHECK, `the declaration of ${name} names another store, and the grant is on ${name}`, { outside: 'declaration', kind: KIND, resource: name, set: grant.set });
    if (!grant.allows('providers', declaration.type)) throw refused(verb, name, PROVIDER_CHECK, `volume ${name} needs provider ${declaration.type}, and ${by}`, { outside: 'grant', kind: 'providers', resource: declaration.type, set: grant.set });
    return declaration;
  }

  function checkWorld(verb, name, required) {
    if (imageWorld === null && !required) return;
    if (imageWorld !== null && imageWorld.imports.some((entry) => entry.capability === KIND)) return;
    const what = imageWorld === null ? 'no world was declared' : `the world ${imageWorld.contract ?? '(unnamed)'} imports no ${KIND}`;
    throw refused(verb, name, STORE_CHECK, `volume ${name} is outside the image's declared world: ${what}, and a world with store imports needs host effects (${HOST_EFFECTS.join(', ')})`, { outside: 'world', contract: imageWorld?.contract ?? null, set: grant.set, dependsOn: HOST_EFFECTS });
  }

  function checkPolicy(verb, name) {
    if (activePolicy === null || activePolicy.effects === null || activePolicy.effects.includes(STORE_EFFECT)) return;
    throw refused(verb, name, STORE_CHECK, `volume ${name} is outside the active policy${activePolicy.name === undefined ? '' : ` ${activePolicy.name}`}: a store is an effect a replay cannot reproduce, and the policy allows ${activePolicy.effects.join(', ') || 'none'}`, { outside: 'policy', policy: activePolicy.name ?? null, set: grant.set });
  }

  function record(name) {
    const declaration = declared.get(name);
    return Object.freeze({ name, set: grant.set, provider: declaration?.type ?? null, options: declaration === undefined ? null : (declaration.options ?? {}), guest: GUEST });
  }

  function names() {
    const entries = (grant.members?.[`allow-${KIND}`] ?? []).filter((entry) => entry !== '*');
    return [...new Set([...entries, ...declared.keys()])].filter((name) => grant.allows(KIND, name)).sort();
  }

  return { checkName, checkOptions, checkDeclared, checkWorld, checkPolicy, record, names };
}

/**
 * The `volumes` namespace over one capability set.
 *
 * @param {{ capabilities?: object | string | Uint8Array | null, set?: string, world?: { contract?: string, imports: object[] } | null, policy?: { name?: string, effects: string[] | null } | null, declarations?: { name: string, type: string, options?: object }[], runner?: { up: (declaration: object) => Promise<{ env?: object, withheld?: object[] }>, down: (declaration: object) => Promise<unknown> } | null }} [options]
 *   `capabilities` is a capability file, and null grants nothing. `world` is the row of `WORLDS` for the image in scope, and null means no image is in scope. `policy` is what `verify` read from the active policy, and null means none is active.
 */
export function createVolumes({ runner = null, ...options } = {}) {
  if (runner !== null && (typeof runner?.up !== 'function' || typeof runner?.down !== 'function')) fail('capabilities.invalid', 'runner must have up and down, or be null');
  const scope = scopeOf(options);

  const provision = (verb, name, what) => {
    if (runner === null) throw new ProviderNotFoundError(`${verb} needs a provider runner to ${what} volume ${name}, and this client has none`, { check: 'provider.runner', details: { module: 'volumes', verb, volume: name } });
    return runner;
  };

  return Object.freeze({
    /**
     * Provision a store the capability file allows and a provider declares. Safe to run
     * again, because a provider's `up` is idempotent (#294). `env` and `withheld` are the
     * runner's: `env` may hold secrets, and reaches a guest only through `containers`.
     */
    async create(name, options) {
      scope.checkName('create', name);
      scope.checkOptions('create', name, options);
      const declaration = scope.checkDeclared('create', name);
      scope.checkWorld('create', name, false);
      scope.checkPolicy('create', name);
      const { env = {}, withheld = [] } = (await provision('create', name, 'provision').up(declaration)) ?? {};
      return Object.freeze({ ...scope.record(name), env, withheld });
    },

    /** Every store the capability set allows by name, and every declared one it allows through a wildcard, sorted. */
    async list(options) {
      scope.checkOptions('list', null, options);
      return Object.freeze(scope.names().map(scope.record));
    },

    /** What the capability file and the declarations say about one volume. It runs nothing, so it cannot say whether the store is provisioned. */
    async inspect(name, options) {
      scope.checkName('inspect', name);
      scope.checkOptions('inspect', name, options);
      return scope.record(name);
    },

    /**
     * Release the store, through the provider's `down`, which may delete its data and
     * succeeds when there is nothing to release. The capability file does not change.
     */
    async remove(name, options) {
      scope.checkName('remove', name);
      scope.checkOptions('remove', name, options);
      const declaration = scope.checkDeclared('remove', name);
      await provision('remove', name, 'release').down(declaration);
    },
  });
}

/**
 * Give a guest a store, the call behind `containers` taking a volume (#443). It always
 * rejects for now: outside the grant, the image's declared world or the active policy with
 * that refusal, and otherwise with `capabilities.host-effects`, naming what it depends on.
 *
 * @param {object} scope the options of `createVolumes`, less `runner`; here a null `world` is refused
 * @param {string} name
 */
export async function attachVolume(scope, name) {
  const { checkName, checkDeclared, checkWorld, checkPolicy } = scopeOf(scope);
  checkName('attach', name);
  checkDeclared('attach', name);
  checkWorld('attach', name, true);
  checkPolicy('attach', name);
  throw refused('attach', name, 'capabilities.host-effects', `a guest cannot reach volume ${name} yet: that needs host effects (${HOST_EFFECTS.join(', ')}), which this version does not have`, { dependsOn: HOST_EFFECTS });
}

/**
 * A refusal of this module as plain JSON, for `containers` to keep on the container (#443),
 * or null for any other error, such as a provider that failed.
 */
export function refusalRecord(error) {
  if (!(error instanceof PrismError) || error.details?.module !== 'volumes') return null;
  return Object.freeze({ name: error.name, code: error.code, check: error.check, message: error.message, details: error.details });
}
