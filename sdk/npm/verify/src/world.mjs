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
  return {
    contract,
    package: world ? world.package : null,
    name: world ? world.world : null,
    file: world ? world.file : null,
    digest: world ? { blake3: world.digest.blake3, sha256: world.digest.sha256 } : null,
    imports: world ? world.imports.map((i) => `${i.module}.${i.name}`) : null,
    exports: world ? world.exports.map((e) => e.name) : null,
    conforms: world && guest ? checkWorld(contract, guest).conforms : null,
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
