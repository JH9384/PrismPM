/**
 * The world of a guest (issue #278, docs/proposals/278-wit-world.md): what a
 * core-wasm module imports and exports, read from its binary, and whether
 * that is the interface the WIT world its contract names declares.
 *
 * Nothing here compiles or instantiates the module. It reads the type,
 * import, function and export sections and stops. It never throws on bad
 * bytes: a module it cannot read is reported as unreadable.
 */
import { WORLDS } from './vendor/spec.mjs';

const VALUE_TYPES = Object.freeze({ 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64' });
const EXTERNAL_KINDS = Object.freeze(['func', 'table', 'memory', 'global', 'tag']);
const utf8 = new TextDecoder('utf-8', { fatal: true });

class Unreadable extends Error {}

/** A cursor over one module. Every read past the end throws `Unreadable`. */
function reader(bytes) {
  let at = 0;
  const need = (n) => {
    if (at + n > bytes.length) throw new Unreadable('the module ends inside a section');
  };
  const self = {
    get at() {
      return at;
    },
    set at(value) {
      at = value;
    },
    byte() {
      need(1);
      return bytes[at++];
    },
    leb() {
      let result = 0;
      for (let shift = 0; shift < 35; shift += 7) {
        const byte = self.byte();
        result += (byte & 0x7f) * 2 ** shift;
        if (byte < 0x80) return result;
      }
      throw new Unreadable('a LEB128 integer is longer than 5 bytes');
    },
    name() {
      const length = self.leb();
      need(length);
      const text = utf8.decode(bytes.subarray(at, at + length));
      at += length;
      return text;
    },
  };
  return self;
}

function limits(r) {
  const flag = r.byte();
  r.leb();
  if (flag & 1) r.leb();
}

/**
 * The imports and exports of a core module.
 *
 * Returns `{ ok: true, imports, exports }`, or `{ ok: false, detail }` when
 * the bytes are not a readable core module. A function export carries its
 * parameter and result types; other exports carry only their kind.
 *
 * @param {Uint8Array} bytes
 */
export function readInterface(bytes) {
  try {
    if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
      return { ok: false, detail: 'the guest is not a WebAssembly module' };
    }
    if (bytes[4] !== 1 || bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 0) return { ok: false, detail: 'the guest is not a version 1 core module' };
    const r = reader(bytes);
    r.at = 8;
    const types = [];
    const functions = [];
    const imports = [];
    const exports = [];
    let importedFunctions = 0;
    while (r.at < bytes.length) {
      const id = r.byte();
      const size = r.leb();
      const end = r.at + size;
      if (end > bytes.length) throw new Unreadable('a section is longer than the module');
      if (id === 1) {
        for (let n = r.leb(); n > 0; n--) {
          if (r.byte() !== 0x60) throw new Unreadable('a type is not a function type');
          const params = Array.from({ length: r.leb() }, () => VALUE_TYPES[r.byte()] ?? 'other');
          const results = Array.from({ length: r.leb() }, () => VALUE_TYPES[r.byte()] ?? 'other');
          types.push({ params, results });
        }
      } else if (id === 2) {
        for (let n = r.leb(); n > 0; n--) {
          const module = r.name();
          const name = r.name();
          const kind = EXTERNAL_KINDS[r.byte()] ?? 'other';
          if (kind === 'func') {
            r.leb();
            importedFunctions++;
          } else if (kind === 'table') {
            r.byte();
            limits(r);
          } else if (kind === 'memory') limits(r);
          else if (kind === 'global') {
            r.byte();
            r.byte();
          } else {
            // A tag or an unknown kind: record it and stop; the rest of the section is not needed.
            imports.push({ module, name, kind });
            break;
          }
          imports.push({ module, name, kind });
        }
      } else if (id === 3) {
        for (let n = r.leb(); n > 0; n--) functions.push(r.leb());
      } else if (id === 7) {
        for (let n = r.leb(); n > 0; n--) {
          const name = r.name();
          const kind = EXTERNAL_KINDS[r.byte()] ?? 'other';
          const index = r.leb();
          if (kind === 'func') {
            const type = types[functions[index - importedFunctions]];
            exports.push({ name, kind, params: type ? type.params : null, results: type ? type.results : null });
          } else exports.push({ name, kind });
        }
      }
      r.at = end;
    }
    return { ok: true, imports, exports };
  } catch (error) {
    if (error instanceof Unreadable || error instanceof TypeError || error instanceof RangeError) {
      return { ok: false, detail: `the guest module cannot be read: ${error.message}` };
    }
    throw error;
  }
}

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
const signature = (e) => `${e.name}(${e.params ? e.params.join(', ') : '?'}) -> ${e.results ? e.results.join(', ') : '?'}`;

/**
 * Whether a guest module has the interface its contract's world declares.
 *
 * Returns `{ known, conforms, problems }`. `known` is false when no world is
 * registered for the contract, and then `conforms` is null. `problems` lists
 * every difference, one plain clause each.
 *
 * @param {string} contract the guest contract, for example `hologram:guest/core-wasm@1`
 * @param {Uint8Array} guest the guest module
 */
export function checkWorld(contract, guest) {
  const world = Object.hasOwn(WORLDS, contract) ? WORLDS[contract] : undefined;
  if (!world) return { known: false, conforms: null, problems: [] };
  const found = readInterface(guest);
  if (!found.ok) return { known: true, conforms: false, problems: [found.detail] };

  const problems = [];
  const wanted = new Map(world.imports.map((i) => [`${i.module}.${i.name}`, i]));
  for (const i of found.imports) {
    if (!wanted.has(`${i.module}.${i.name}`)) problems.push(`the guest imports ${i.module}.${i.name} (${i.kind}), which the world does not list`);
  }
  for (const [key, i] of wanted) {
    if (!found.imports.some((f) => `${f.module}.${f.name}` === key)) problems.push(`the guest lacks the import ${key} (${i.kind}) the world lists`);
  }
  const have = new Map(found.exports.map((e) => [e.name, e]));
  for (const e of world.exports) {
    const actual = have.get(e.name);
    if (!actual) problems.push(`the guest lacks the export ${e.name}`);
    else if (actual.kind !== e.kind) problems.push(`the guest exports ${e.name} as a ${actual.kind}, the world declares a ${e.kind}`);
    else if (e.kind === 'func' && !(sameList(actual.params, e.params) && sameList(actual.results, e.results))) {
      problems.push(`the guest exports ${signature(actual)}, the world declares ${signature(e)}`);
    }
  }
  const declared = new Set(world.exports.map((e) => e.name));
  for (const e of found.exports) if (!declared.has(e.name)) problems.push(`the guest exports ${e.name}, which the world does not declare`);
  if (found.exports.length !== have.size) problems.push('the guest exports one name twice');
  return { known: true, conforms: problems.length === 0, problems };
}

/**
 * The world a holo's contract names, as `inspect` prints it. `conforms` is
 * null when the contract is not registered or no guest module is at hand.
 *
 * @param {string} contract
 * @param {Uint8Array | null} guest
 */
export function describeWorld(contract, guest) {
  const world = Object.hasOwn(WORLDS, contract) ? WORLDS[contract] : undefined;
  const purity = world ? worldPurity(world) : null;
  return {
    contract,
    package: world ? world.package : null,
    name: world ? world.world : null,
    file: world ? world.file : null,
    digest: world ? { blake3: world.digest.blake3, sha256: world.digest.sha256 } : null,
    imports: world ? world.imports.map((i) => `${i.module}.${i.name}`) : null,
    exports: world ? world.exports.map((e) => e.name) : null,
    conforms: world && guest ? checkWorld(contract, guest).conforms : null,
    pure: purity ? purity.pure : null,
    effects: purity ? purity.effects : null,
  };
}

/**
 * Compare a pinned world, in the shape of the lock's `inputs.world`, with the
 * world a holo's contract names. Returns the differences, empty when it matches.
 * `null` pins "no world expected", which a holo with a guest never satisfies.
 *
 * @param {string} contract the holo's contract
 * @param {{ contract?: string, blake3?: string, sha256?: string } | null} pin
 */
export function compareWorldPin(contract, pin) {
  if (pin === null) return [`the policy expects no world, the holo declares ${contract}`];
  const problems = [];
  if (pin.contract !== undefined && pin.contract !== contract) problems.push(`the policy pins contract ${pin.contract}, the holo declares ${contract}`);
  const world = Object.hasOwn(WORLDS, contract) ? WORLDS[contract] : undefined;
  for (const algorithm of ['blake3', 'sha256']) {
    if (pin[algorithm] === undefined) continue;
    if (!world) problems.push(`the policy pins ${algorithm} ${pin[algorithm]}, and this reader has no world for ${contract}`);
    else if (world.digest[algorithm] !== pin[algorithm]) problems.push(`the policy pins ${algorithm} ${pin[algorithm]}, the world ${contract} has ${world.digest[algorithm]}`);
  }
  return problems;
}

/*
 * Issue #283, docs/proposals/283-world-within-policy.md: is the world within
 * the granted capabilities, and is it pure? Both are read from the world's
 * declared imports alone, before anything is instantiated.
 */

/** The effects that make a world impure: a guest importing one can see something a replay cannot reproduce. */
export const IMPURE_EFFECTS = Object.freeze(['clock', 'random', 'socket', 'filesystem', 'unknown']);
const CAPABILITY_KINDS = Object.freeze(['outbound-hosts', 'key-value-stores', 'variables']);
const SET_MEMBERS = Object.freeze(CAPABILITY_KINDS.flatMap((kind) => [`allow-${kind}`, `deny-${kind}`]));
const WASI_INTERFACES = Object.freeze([
  ['wasi:clocks/', 'clock'],
  ['wasi:random/', 'random'],
  ['wasi:sockets/', 'socket'],
  ['wasi:http/', 'socket'],
  ['wasi:filesystem/', 'filesystem'],
]);
const WASI_PREVIEW1 = Object.freeze([
  [/^clock_/, 'clock'],
  [/^random_get$/, 'random'],
  [/^(sock_|poll_oneoff$)/, 'socket'],
  [/^(fd_|path_)/, 'filesystem'],
  [/^(proc_exit|proc_raise|sched_yield|args_get|args_sizes_get|environ_get|environ_sizes_get)$/, 'none'],
]);

/**
 * The effect of one import: `clock`, `random`, `socket`, `filesystem`,
 * `none` for an import known to be deterministic, or `unknown`. A WASI 0.2
 * interface is classified by its package and interface name, a WASI 0.1
 * import by its function name; anything else is `unknown`, because nothing
 * says what the host behind it returns.
 *
 * @param {{ module: string, name: string }} entry
 */
export function classifyImport(entry) {
  for (const [prefix, effect] of WASI_INTERFACES) if (entry.module.startsWith(prefix)) return effect;
  if (entry.module === 'wasi_snapshot_preview1' || entry.module === 'wasi_unstable') {
    for (const [pattern, effect] of WASI_PREVIEW1) if (pattern.test(entry.name)) return effect;
  }
  return 'unknown';
}

/**
 * Whether a world is pure, and which effects stop it. A world is pure when
 * none of its imports is a clock, random, socket or filesystem import, nor an
 * import whose effect is unknown. Pure worlds are replayable (VER-09).
 *
 * @param {{ imports: { module: string, name: string }[] }} world a `WORLDS` row
 */
export function worldPurity(world) {
  const effects = [...new Set(world.imports.map(classifyImport).filter((e) => IMPURE_EFFECTS.includes(e)))].sort();
  return { pure: effects.length === 0, effects };
}

/**
 * Check the shape of one capability set, the members of a set of a
 * `prism/capabilities/1` file (issue #279). The entries' syntax is the
 * runtime's to check; here only the shape matters. Returns a problem, or null.
 */
export function capabilitySetProblem(set) {
  if (set === null || typeof set !== 'object' || Array.isArray(set)) return 'a capability set is an object of allow- and deny- lists';
  for (const [member, entries] of Object.entries(set)) {
    if (!SET_MEMBERS.includes(member)) return `a capability set has no member ${member}; it has ${SET_MEMBERS.join(', ')}`;
    if (!Array.isArray(entries) || entries.some((e) => typeof e !== 'string')) return `${member} must be an array of strings`;
  }
  return null;
}

/**
 * Whether a set grants any resource of a kind: an allow entry that no deny
 * entry names, and no deny entry that matches everything. This is the link
 * rule of #279: an import of a kind is linked when the grant allows at least
 * one resource of that kind.
 */
function grantsKind(set, kind) {
  const allow = set?.[`allow-${kind}`] ?? [];
  const deny = set?.[`deny-${kind}`] ?? [];
  const everything = kind === 'outbound-hosts' ? ['*://*', '*://*:*'] : ['*'];
  if (deny.some((d) => everything.includes(d))) return false;
  return allow.some((a) => !deny.includes(a));
}

/**
 * Is the world within the granted capability set? Every import must name the
 * capability kind it uses (a `capability` member of its row in `WORLDS`), and
 * the set must grant some resource of that kind. `set` is one capability set,
 * or null when nothing is granted. Returns `{ within, problems, pure, effects }`.
 *
 * @param {{ imports: { module: string, name: string, kind: string, capability?: string }[] }} world a `WORLDS` row
 * @param {object | null} set
 */
export function worldWithinGrant(world, set) {
  const problems = [];
  for (const entry of world.imports) {
    const name = `${entry.module}.${entry.name}`;
    if (!CAPABILITY_KINDS.includes(entry.capability)) problems.push(`the world imports ${name}, which names no capability kind, so no capability set can grant it`);
    else if (!grantsKind(set, entry.capability)) problems.push(`the world imports ${name}, which needs ${entry.capability}, and ${set ? 'the capability set grants none' : 'no capability set was granted'}`);
  }
  return { within: problems.length === 0, problems, ...worldPurity(world) };
}

/**
 * The impure effects a world imports that a policy does not allow (#282).
 * `allowed` null allows any; `[]` is the pure-world policy. Returns the
 * effects outside the policy, empty when the world is within it.
 *
 * @param {string[]} effects the world's impure effects, as `worldPurity` reports them
 * @param {string[] | null} allowed
 */
export function effectsOutsidePolicy(effects, allowed) {
  if (allowed === null || allowed === undefined) return [];
  return effects.filter((e) => !allowed.includes(e));
}

/**
 * `worldWithinGrant` for a holo's contract. `known` is false, and nothing is
 * claimed, when this reader has no world for the contract.
 *
 * @param {string} contract
 * @param {object | null} set
 */
export function checkWorldPolicy(contract, set) {
  const world = Object.hasOwn(WORLDS, contract) ? WORLDS[contract] : undefined;
  if (!world) return { known: false, within: null, problems: [], pure: null, effects: null };
  return { known: true, ...worldWithinGrant(world, set) };
}
