// Private account declarations. Artifact provenance belongs to the verified
// bootstrap; these facts do not prove key possession or current account authority.
import {bytesCopy, identityPrincipal, digestBytes} from './identity.mjs';
import {inspectEffectModule} from './effects-module.mjs';
import {encodeEffectWire as encode, decodeEffectWire as decode} from './effects-wire.mjs';
import {accountGenesisBinding} from './account-genesis-binding.mjs';

const FRAME = 512, ARTIFACT = 67108864, MEMORY = 1073741824;
const apply = Reflect.apply, own = Object.getOwnPropertyDescriptors;
const prototype = Object.getPrototypeOf, keys = Reflect.ownKeys;
const Instance = WebAssembly.Instance, compile = WebAssembly.compile;
const fetchArtifact = globalThis.fetch, Controller = globalThis.AbortController;
const artifactURL = new URL('./account-genesis.wasm', import.meta.url).href;
const ARTIFACT_DEADLINE = 30000;
const CLEANUP_DEADLINE = 5000;
const same = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const fail = code => new AccountGenesisError(code);
export class AccountGenesisError extends Error {
  constructor(code) {super(code); this.name = 'AccountGenesisError'; this.code = code;}
}
function exact(value, names) {
  if (!value || prototype(value) !== Object.prototype) throw fail('invalid-input');
  const fields = own(value), actual = keys(fields);
  if (actual.length !== names.length || actual.some(key => !names.includes(key)
    || !Object.hasOwn(fields[key], 'value'))) throw fail('invalid-input');
  return Object.fromEntries(names.map(name => [name, fields[name].value]));
}
function copy(value, maximum) {
  try {return bytesCopy(value, maximum);} catch {throw fail('invalid-input');}
}
function artifactBinding() {
  try {
    const names = ['schema', 'model_source_id', 'model_closure_sha256', 'ir_sha256',
      'wasm_sha256', 'wasm_bytes', 'package_sha256'];
    const value = exact(accountGenesisBinding, names);
    if (value.schema !== 'prismpm/account-genesis-binding/1'
      || !Number.isSafeInteger(value.wasm_bytes) || value.wasm_bytes < 8
      || value.wasm_bytes > ARTIFACT) throw fail('artifact-mismatch');
    for (const name of names.filter(name => name !== 'schema' && name !== 'wasm_bytes'))
      if (typeof value[name] !== 'string' || !/^[a-f0-9]{64}$/.test(value[name]))
        throw fail('artifact-mismatch');
    return value;
  } catch {throw fail('artifact-mismatch');}
}
function canonical(bytes) {
  try {
    const value = decode(bytes);
    if (!same(encode(value), bytes)) throw fail('invalid-input');
    return value;
  } catch {throw fail('invalid-input');}
}
function request(value) {
  let bytes;
  try {bytes = encode(value);} catch {throw fail('invalid-input');}
  if (bytes.length > FRAME) throw fail('invalid-input');
  return bytes;
}
function run(module, input) {
  try {
    const instance = new Instance(module, {});
    const {memory, holo_alloc: allocate, holo_run: execute} = instance.exports;
    if (!(memory instanceof WebAssembly.Memory) || typeof allocate !== 'function'
      || allocate.length !== 1 || typeof execute !== 'function' || execute.length !== 2)
      throw fail('invalid-generated-module');
    const pointer = allocate(input.length) >>> 0;
    if (pointer + input.length > memory.buffer.byteLength) throw fail('invalid-generated-output');
    new Uint8Array(memory.buffer, pointer, input.length).set(input);
    const result = execute(pointer, input.length);
    if (typeof result !== 'bigint') throw fail('invalid-generated-output');
    const packed = BigInt.asUintN(64, result), start = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
    if (length > FRAME || start + length > memory.buffer.byteLength || memory.buffer.byteLength > MEMORY)
      throw fail('invalid-generated-output');
    const value = canonical(new Uint8Array(memory.buffer, start, length).slice());
    if (!Array.isArray(value) || value.length !== 3 || value[0] !== 1)
      throw fail('invalid-generated-output');
    if (value[1] === 1 && value[2] === 2) throw fail('invalid-key');
    if (value[1] === 1 || value[1] === 2) throw fail('model-rejected');
    if (value[1] !== 0) throw fail('invalid-generated-output');
    return value[2];
  } catch (error) {
    if (error instanceof AccountGenesisError) throw error;
    throw fail('generated-execution-failed');
  }
}

async function loadArtifact(binding, expectedDigest) {
  let controller, reader, timer, complete = false;
  try {
    controller = new Controller();
    timer = setTimeout(() => controller.abort(), ARTIFACT_DEADLINE);
    const response = await apply(fetchArtifact, globalThis, [artifactURL, {
      method: 'GET', credentials: 'omit', mode: 'same-origin', redirect: 'manual',
      cache: 'no-store', signal: controller.signal,
    }]);
    reader = response.body?.getReader();
    if (response.status !== 200 || response.type !== 'basic' || response.redirected || response.url !== artifactURL
      || !reader) throw fail('artifact-mismatch');
    const wire = new Uint8Array(binding.wasm_bytes);
    let offset = 0;
    for (let reads = 0; ; reads++) {
      if (reads > wire.length) throw fail('artifact-mismatch');
      const {done, value} = await reader.read();
      if (done) break;
      const chunk = copy(value, wire.length - offset);
      if (!chunk.length) throw fail('artifact-mismatch');
      wire.set(chunk, offset); offset += chunk.length;
    }
    if (offset !== wire.length || controller.signal.aborted) throw fail('artifact-mismatch');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', wire));
    if (!same(digest, expectedDigest) || controller.signal.aborted) throw fail('artifact-mismatch');
    complete = true;
    return wire;
  } catch {
    // Transport bytes are not caller input. In particular, copy() refuses an
    // oversized chunk as invalid-input; acquisition must report artifact failure.
    throw fail('artifact-mismatch');
  } finally {
    clearTimeout(timer);
    if (!complete) {
      controller?.abort();
      // Observe real stream cancellation, including its rejection after abort.
      // Cleanup never converts the original refusal into a usable verifier.
      if (reader) {
        let cleanupTimer;
        try {
          // Observe rejection even when a defective platform never settles
          // cancellation. The finite cleanup bound never grants acceptance.
          const cancellation = Promise.resolve(reader.cancel()).then(() => {}, () => {});
          await Promise.race([cancellation, new Promise(resolve => {
            cleanupTimer = setTimeout(resolve, CLEANUP_DEADLINE);
          })]);
        } catch { /* Preserve the acquisition refusal, including synchronous cancellation errors. */ }
        finally {clearTimeout(cleanupTimer);}
      }
    }
    if (reader) try {reader.releaseLock();} catch {
      if (complete) throw fail('artifact-mismatch'); // Never replace a primary refusal.
    }
  }
}

export async function openAccountGenesis(options) {
  if (arguments.length > 1) throw fail('invalid-input');
  const binding = artifactBinding();
  const wireDigest = Uint8Array.from(binding.wasm_sha256.match(/../g), byte => Number.parseInt(byte, 16));
  if (arguments.length === 1) {
    // Legacy arguments are assertions only. They never select executable code.
    const fields = exact(options, ['wire', 'wireDigest']);
    const supplied = copy(fields.wire, ARTIFACT), digest = copy(fields.wireDigest, 32);
    if (digest.length !== 32) throw fail('invalid-input');
    if (!same(digest, wireDigest)) throw fail('artifact-mismatch');
    let actual;
    try {actual = new Uint8Array(await crypto.subtle.digest('SHA-256', supplied));}
    catch {throw fail('crypto-unavailable');}
    if (!same(actual, wireDigest)) throw fail('artifact-mismatch');
  }
  const wire = await loadArtifact(binding, wireDigest);
  let module;
  try {
    inspectEffectModule(wire, 16384);
    module = await apply(compile, WebAssembly, [wire]);
  } catch {throw fail('invalid-generated-module');}
  const facts = new WeakMap();
  const declare = async function (options) {
    if (arguments.length !== 1) throw fail('invalid-input');
    const fields = exact(options, ['genesis', 'expectedNamespace']);
    const genesis = copy(fields.genesis, FRAME), expected = copy(fields.expectedNamespace, 32);
    if (expected.length !== 32) throw fail('invalid-input');
    const value = canonical(genesis);
    if (run(module, request([1, 2, expected, value])) !== true) throw fail('invalid-generated-output');
    const projected = run(module, request([1, 1, value]));
    if (!Array.isArray(projected) || projected.length !== 4) throw fail('invalid-generated-output');
    const namespace = copy(projected[0], 32), publicKey = copy(projected[1], 65);
    const canonicalGenesis = copy(projected[2], FRAME), material = copy(projected[3], FRAME);
    if (namespace.length !== 32 || publicKey.length !== 65 || !same(namespace, expected)
      || !same(canonicalGenesis, genesis)) throw fail('invalid-generated-output');
    let keyIdentity, identity;
    try {keyIdentity = await identityPrincipal(publicKey);}
    catch {throw fail('invalid-key');}
    try {
      const digest = await digestBytes(material);
      identity = Uint8Array.from(digest.slice(7).match(/../g), pair => Number.parseInt(pair, 16));
    } catch {throw fail('crypto-unavailable');}
    const handle = Object.freeze(Object.create(null));
    facts.set(handle, {genesis, namespace, publicKey, material, keyIdentity, identity});
    return handle;
  };
  const readFacts = function (handle) {
    if (arguments.length !== 1 || !facts.has(handle)) throw fail('invalid-facts');
    const value = facts.get(handle);
    return Object.freeze({genesis: copy(value.genesis, FRAME), namespace: copy(value.namespace, 32),
      publicKey: copy(value.publicKey, 65), material: copy(value.material, FRAME),
      keyIdentity: value.keyIdentity, identity: copy(value.identity, 32), wireDigest: copy(wireDigest, 32)});
  };
  return Object.freeze(Object.assign(Object.create(null), {declare, readFacts}));
}
