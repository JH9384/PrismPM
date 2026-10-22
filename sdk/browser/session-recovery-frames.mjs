// Private byte composition over independently admitted generated artifacts.
// No state parsing, authority grant, journal admission or freshness assertion.
import {bytesCopy} from './identity.mjs';
import {encodeEffectWire as encode, decodeEffectWire as decode} from './effects-wire.mjs';
import {inspectEffectModule} from './effects-module.mjs';

const FRAME = 67108864, PAGES = 16384;
const equal = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', value));
export class SessionRecoveryFrameError extends Error {
  constructor(code) {super(code); this.name = 'SessionRecoveryFrameError'; this.code = code;}
}
const fail = code => new SessionRecoveryFrameError(code);
function exact(value, names) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw fail('invalid-input');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string')
    || keys.sort().join(',') !== names.toSorted().join(',')
    || keys.some(key => !('value' in descriptors[key]))) throw fail('invalid-input');
  return Object.fromEntries(names.map(name => [name, descriptors[name].value]));
}
function captureArtifact(value) {
  const fields = exact(value, ['bytes', 'sha256']);
  return {bytes: bytesCopy(fields.bytes, FRAME), sha256: bytesCopy(fields.sha256, 32)};
}
async function compile(artifact) {
  if (artifact.sha256.length !== 32 || !equal(await digest(artifact.bytes), artifact.sha256)) throw fail('artifact-mismatch');
  let module;
  try {
    if (inspectEffectModule(artifact.bytes, PAGES).maximumPages !== PAGES) throw fail('invalid-artifact');
    module = await WebAssembly.compile(artifact.bytes);
    if (WebAssembly.Module.imports(module).length !== 0) throw fail('invalid-artifact');
  } catch {throw fail('invalid-artifact');}
  return input => {
    if (input.length > FRAME) throw fail('frame-limit');
    try {
      const instance = new WebAssembly.Instance(module, {});
      const {memory, holo_alloc: allocate, holo_run: run} = instance.exports;
      const at = allocate(input.length) >>> 0;
      if (at + input.length > memory.buffer.byteLength) throw fail('invalid-output');
      new Uint8Array(memory.buffer, at, input.length).set(input);
      const packed = run(at, input.length);
      if (typeof packed !== 'bigint') throw fail('invalid-output');
      const value = BigInt.asUintN(64, packed), start = Number(value >> 32n), size = Number(value & 0xffffffffn);
      if (size > FRAME || start + size > memory.buffer.byteLength || memory.buffer.byteLength > 1073741824)
        throw fail('invalid-output');
      return new Uint8Array(memory.buffer, start, size).slice();
    } catch (error) {throw error instanceof SessionRecoveryFrameError ? error : fail('generated-failure');}
  };
}
function reply(bytes, tag) {
  let value; try {value = decode(bytes);} catch {throw fail('invalid-output');}
  if (!Array.isArray(value) || value.length !== 3 || value[0] !== 1) throw fail('invalid-output');
  if (value[1] !== tag) throw fail('source-refusal');
  return value[2];
}

export async function createSessionRecoveryFrames(options) {
  // Copy every selected artifact before the first asynchronous operation.
  const fields = exact(options, ['layout', 'tail']);
  const artifacts = {layout: captureArtifact(fields.layout), tail: captureArtifact(fields.tail)};
  const layout = await compile(artifacts.layout), tail = await compile(artifacts.tail);
  return Object.freeze({async recover(input) {
    const fields = exact(input, ['state', 'authority', 'execution', 'selector', 'presentation']);
    const captured = Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, bytesCopy(value, FRAME)]));
    // The source alone selects the prefix. No caller layout/offset is admitted.
    const layoutBytes = layout(captured.state), selected = reply(layoutBytes, 6);
    if (!Array.isArray(selected) || selected.length !== 6 || !Number.isInteger(selected[0])
      || selected[0] <= 0 || selected[0] > captured.state.length) throw fail('invalid-output');
    let authority, request;
    try {
      authority = decode(captured.authority);
      request = encode([1, [1, selected, authority, captured.execution, captured.selector, captured.presentation]]);
    } catch {throw fail('invalid-input');}
    const tailBytes = tail(request), recipe = reply(tailBytes, 7);
    if (!Array.isArray(recipe) || recipe.length !== 2 || recipe[0] !== selected[0]
      || !(recipe[1] instanceof Uint8Array) || recipe[1].length > FRAME - recipe[0]) throw fail('invalid-output');
    const result = new Uint8Array(recipe[0] + recipe[1].length);
    result.set(captured.state.subarray(0, recipe[0])); result.set(recipe[1], recipe[0]);
    // Canonical EOF, complete state validity and quiescence are checked again
    // by the real generated entry, never inferred from successful byte copying.
    const validated = reply(layout(result), 6);
    if (!Array.isArray(validated) || validated.length !== 6 || validated[0] !== recipe[0]) throw fail('invalid-output');
    const hashes = {};
    for (const [name, bytes] of Object.entries({...captured, layout: layoutBytes, operation: request,
      tail: tailBytes, result})) hashes[name] = await digest(bytes);
    return Object.freeze({bytes: result, hashes: Object.freeze(hashes),
      artifacts: Object.freeze({layout: artifacts.layout.sha256.slice(), tail: artifacts.tail.sha256.slice()})});
  }});
}
