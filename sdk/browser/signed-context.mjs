// Private key-signed statements. Artifact provenance belongs to the verified
// bootstrap; these facts are not account, mailbox, permission or freshness grants.
import {bytesCopy, identityPrincipal, verifyBytes} from './identity.mjs';
import {inspectEffectModule} from './effects-module.mjs';
import {encodeEffectWire as encode, decodeEffectWire as decode} from './effects-wire.mjs';

const FRAME = 2048, ARTIFACT = 67108864, MEMORY = 1073741824;
const apply = Reflect.apply, own = Object.getOwnPropertyDescriptors;
const prototype = Object.getPrototypeOf, keys = Reflect.ownKeys;
const Instance = WebAssembly.Instance, compile = WebAssembly.compile;
const same = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const fail = code => new SignedContextError(code);
export class SignedContextError extends Error {
  constructor(code) {super(code); this.name = 'SignedContextError'; this.code = code;}
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
    if (value[1] === 1 || value[1] === 2) throw fail('model-rejected');
    if (value[1] !== 0) throw fail('invalid-generated-output');
    return value[2];
  } catch (error) {
    if (error instanceof SignedContextError) throw error;
    throw fail('generated-execution-failed');
  }
}

export async function openSignedContext(options) {
  if (arguments.length !== 1) throw fail('invalid-input');
  // Every caller-owned option is read and copied before the first suspension.
  const fields = exact(options, ['wire', 'wireDigest']);
  const wire = copy(fields.wire, ARTIFACT), wireDigest = copy(fields.wireDigest, 32);
  if (wireDigest.length !== 32) throw fail('invalid-input');
  let actual;
  try {actual = new Uint8Array(await crypto.subtle.digest('SHA-256', wire));}
  catch {throw fail('crypto-unavailable');}
  if (!same(actual, wireDigest)) throw fail('artifact-mismatch');
  let module;
  try {
    inspectEffectModule(wire, 16384);
    module = await apply(compile, WebAssembly, [wire]);
  } catch {throw fail('invalid-generated-module');}
  const evidence = new WeakMap();
  // No caller-visible class/constructor can brand a handle or choose a verifier.
  const authenticate = async function (options) {
    if (arguments.length !== 1) throw fail('invalid-input');
    const fields = exact(options, ['envelope', 'expectedContext', 'expectedKey']);
    const envelope = copy(fields.envelope, FRAME), expectedContext = copy(fields.expectedContext, FRAME);
    const expectedKey = copy(fields.expectedKey, 65);
    if (expectedKey.length !== 65) throw fail('invalid-input');
    const capturedEnvelope = canonical(envelope), capturedContext = canonical(expectedContext);
    if (run(module, request([1, 2, capturedContext, expectedKey, capturedEnvelope])) !== true)
      throw fail('invalid-generated-output');
    const projection = run(module, request([1, 1, capturedEnvelope]));
    if (!Array.isArray(projection) || projection.length !== 4 || typeof projection[1] !== 'string')
      throw fail('invalid-generated-output');
    const publicKey = copy(projection[0], 65), unsigned = copy(projection[2], FRAME), signature = copy(projection[3], 64);
    if (!same(publicKey, expectedKey) || signature.length !== 64) throw fail('invalid-generated-output');
    const signingContext = projection[1];
    let keyIdentity, valid;
    try {
      keyIdentity = await identityPrincipal(publicKey);
      valid = await verifyBytes(publicKey, signingContext, unsigned, signature);
    } catch {throw fail('invalid-key-or-signature');}
    if (valid !== true) throw fail('signature-rejected');
    const handle = Object.freeze(Object.create(null));
    evidence.set(handle, {envelope, expectedContext, publicKey, unsigned, signature, signingContext, keyIdentity});
    return handle;
  };
  const readEvidence = function (handle) {
    if (arguments.length !== 1 || !evidence.has(handle)) throw fail('invalid-evidence');
    const value = evidence.get(handle);
    return Object.freeze({envelope: copy(value.envelope, FRAME), context: copy(value.expectedContext, FRAME),
      publicKey: copy(value.publicKey, 65), unsigned: copy(value.unsigned, FRAME), signature: copy(value.signature, 64),
      signingContext: value.signingContext, keyIdentity: value.keyIdentity, wireDigest: copy(wireDigest, 32)});
  };
  return Object.freeze(Object.assign(Object.create(null), {authenticate, readEvidence}));
}
