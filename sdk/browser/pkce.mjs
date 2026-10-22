// Private RFC 7636 client primitive. Not token, mailbox or account admission.
import {bytesCopy as captureBytes, randomBytes as generateRandomBytes} from './identity.mjs';
import {inspectEffectModule} from './effects-module.mjs';

const apply = Reflect.apply;
export class PkceError extends Error {
  constructor(code) {super(code); this.name = 'PkceError'; this.code = code;}
}
const fail = code => new PkceError(code);
const bytesCopy = (value, maximum) => {
  try {return captureBytes(value, maximum);} catch {throw fail('invalid-input');}
};
const randomBytes = length => {
  try {return generateRandomBytes(length);} catch {throw fail('crypto-unavailable');}
};
const same = (left, right) => left.length === right.length && left.every((byte, at) => byte === right[at]);
function exact(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw fail('invalid-input');
  const fields = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(fields);
  if (names.length !== 2 || !names.includes('bytes') || !names.includes('sha256')
    || names.some(name => !Object.hasOwn(fields[name], 'value'))) throw fail('invalid-input');
  return {bytes: bytesCopy(fields.bytes.value, 67108864), sha256: bytesCopy(fields.sha256.value, 32)};
}
async function sha256(value) {
  let provider, digest;
  try {provider = globalThis.crypto.subtle; digest = provider.digest;
    if (typeof digest !== 'function') throw null;
    const result = new Uint8Array(await apply(digest, provider, ['SHA-256', value]));
    if (result.length !== 32) throw null;
    return result;
  } catch {throw fail('crypto-unavailable');}
}

export async function createPkceS256(options) {
  if (arguments.length !== 1) throw fail('invalid-input');
  const artifact = exact(options);
  if (artifact.sha256.length !== 32 || !same(await sha256(artifact.bytes), artifact.sha256))
    throw fail('artifact-mismatch');
  let module;
  try {
    inspectEffectModule(artifact.bytes, 64);
    module = await WebAssembly.compile(artifact.bytes);
    if (WebAssembly.Module.imports(module).length !== 0) throw null;
  } catch {throw fail('invalid-generated-module');}
  let closed = false;
  const live = () => {if (closed) throw fail('closed');};
  function run(operation, value) {
    live();
    const input = new Uint8Array(value.length + 1); input[0] = operation; input.set(value, 1);
    let memory;
    try {
      const instance = new WebAssembly.Instance(module, {}), exports = instance.exports;
      memory = exports.memory;
      if (!(memory instanceof WebAssembly.Memory) || typeof exports.holo_alloc !== 'function'
        || exports.holo_alloc.length !== 1 || typeof exports.holo_run !== 'function'
        || exports.holo_run.length !== 2) throw fail('invalid-generated-module');
      const at = exports.holo_alloc(input.length) >>> 0;
      if (at + input.length > memory.buffer.byteLength) throw fail('invalid-generated-output');
      new Uint8Array(memory.buffer, at, input.length).set(input);
      const raw = exports.holo_run(at, input.length);
      if (typeof raw !== 'bigint') throw fail('invalid-generated-output');
      const packed = BigInt.asUintN(64, raw), start = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
      if (length < 2 || length > 129 || start + length > memory.buffer.byteLength
        || memory.buffer.byteLength > 4194304) throw fail('invalid-generated-output');
      const result = new Uint8Array(memory.buffer, start, length).slice();
      if (result[0] === 1 && result.length === 2 && result[1] >= 1 && result[1] <= 3)
        throw fail('invalid-verifier');
      if (result[0] !== 0 || (operation === 1 ? result.length !== value.length + 1 : result.length !== 44))
        throw fail('invalid-generated-output');
      return result.slice(1);
    } catch (error) {
      if (error instanceof PkceError) throw error;
      throw fail('generated-execution-failed');
    } finally {
      input.fill(0);
      // Best effort only: the engine/provider may retain other copies.
      if (memory instanceof WebAssembly.Memory) new Uint8Array(memory.buffer).fill(0);
    }
  }
  async function derive(verifier) {
    let admitted, digest;
    try {
      admitted = run(1, verifier);
      digest = await sha256(admitted); live();
      return run(2, digest);
    } finally {admitted?.fill(0); digest?.fill(0);}
  }
  return Object.freeze({
    async challenge(value) {
      if (arguments.length !== 1) throw fail('invalid-input'); live();
      const verifier = bytesCopy(value, 128);
      try {return await derive(verifier);} finally {verifier.fill(0);}
    },
    async generate() {
      if (arguments.length !== 0) throw fail('invalid-input'); live();
      let entropy, verifier;
      try {
        entropy = randomBytes(32); verifier = run(0, entropy);
        const challenge = await derive(verifier); live();
        return Object.freeze({verifier: verifier.slice(), challenge});
      } finally {entropy?.fill(0); verifier?.fill(0);}
    },
    close() {if (arguments.length !== 0) throw fail('invalid-input'); closed = true;},
  });
}
