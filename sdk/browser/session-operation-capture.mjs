// Private DK-35 session-host prerequisite, not journal admission or authority.
// The eventual SDK assembler must supply independently accepted artifacts;
// matching caller-supplied digests alone cannot establish their authority.
import {bytesCopy} from './identity.mjs';
import {inspectEffectArtifactBudget, inspectEffectModule} from './effects-module.mjs';
import {createSessionPayloadDescriptor} from './session-payloads.mjs';

const FRAME = 67108864, PAGES = 16384;
const roles = Object.freeze(['predecessor', 'session', 'observation', 'partition', 'descriptor']);
const same = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', value));
const fail = code => new SessionOperationCaptureError(code);
export class SessionOperationCaptureError extends Error {
  constructor(code) {super(code); this.name = 'SessionOperationCaptureError'; this.code = code;}
}
function exact(value, names) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw fail('invalid-input');
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string')
    || keys.sort().join(',') !== names.toSorted().join(',')
    || keys.some(key => !Object.hasOwn(fields[key], 'value'))) throw fail('invalid-input');
  return Object.fromEntries(names.map(name => [name, fields[name].value]));
}
function response(bytes, status) {
  // Only inspect the canonical outer tag, never reconstruct domain state.
  // Full state/EOF validation belongs to the generated observation entry.
  if (bytes.length === 4 && bytes[0] === 0x83 && bytes[1] === 1
    && (bytes[2] === 1 || bytes[2] === 2) && bytes[3] <= 23) throw fail('source-refused');
  if (bytes.length < 4 || bytes[0] !== 0x83 || bytes[1] !== 1 || bytes[2] !== status)
    throw fail('invalid-generated-output');
  return bytes;
}
async function generated(artifact) {
  if (artifact.sha256.length !== 32 || !same(await hash(artifact.bytes), artifact.sha256)) throw fail('artifact-mismatch');
  let module;
  try {
    inspectEffectModule(artifact.bytes, PAGES);
    module = await WebAssembly.compile(artifact.bytes);
    if (WebAssembly.Module.imports(module).length) throw fail('invalid-generated-module');
  } catch {throw fail('invalid-generated-module');}
  return input => {
    try {
      const instance = new WebAssembly.Instance(module, {}), {memory, holo_alloc: allocate, holo_run: run} = instance.exports;
      if (!(memory instanceof WebAssembly.Memory) || typeof allocate !== 'function' || allocate.length !== 1
        || typeof run !== 'function' || run.length !== 2) throw fail('invalid-generated-module');
      const start = allocate(input.length) >>> 0;
      if (start + input.length > memory.buffer.byteLength) throw fail('invalid-generated-output');
      new Uint8Array(memory.buffer, start, input.length).set(input);
      const result = run(start, input.length);
      if (typeof result !== 'bigint') throw fail('invalid-generated-output');
      const packed = BigInt.asUintN(64, result), at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
      if (length > FRAME || at + length > memory.buffer.byteLength || memory.buffer.byteLength > PAGES * 65536)
        throw fail('invalid-generated-output');
      return new Uint8Array(memory.buffer, at, length).slice();
    } catch (error) {if (error instanceof SessionOperationCaptureError) throw error; throw fail('generated-execution-failed');}
  };
}
const captures = new WeakMap();
export async function createSessionOperationCapture(options) {
  if (arguments.length !== 1) throw fail('invalid-input');
  const selected = exact(options, roles);
  const fields = Object.fromEntries(roles.map(role => [role, exact(selected[role], ['bytes', 'sha256'])]));
  inspectEffectArtifactBudget(fields.predecessor.bytes, roles.slice(1).map(role => fields[role].bytes));
  // Capture every artifact and expected digest before the first await.
  const artifacts = Object.fromEntries(roles.map(role => [role, {
    bytes: bytesCopy(fields[role].bytes, FRAME), sha256: bytesCopy(fields[role].sha256, 32),
  }]));
  const predecessor = await generated(artifacts.predecessor), session = await generated(artifacts.session);
  const observation = await generated(artifacts.observation);
  const codec = await createSessionPayloadDescriptor({wire: artifacts.descriptor.bytes,
    wireDigest: artifacts.descriptor.sha256, partition: artifacts.partition.bytes,
    partitionDigest: artifacts.partition.sha256});
  const identity = Object.freeze(Object.create(null));
  let closed = false, busy = false;
  function check() {if (closed) throw fail('capture-closed');}
  function captured(handle) {
    check(); const record = captures.get(handle);
    if (!record || record.owner !== identity) throw fail('invalid-owner');
    return record;
  }
  return Object.freeze({
    async capture(value) {
      if (arguments.length !== 1) throw fail('invalid-input'); check();
      if (busy) throw fail('capture-busy');
      const operation = bytesCopy(value, FRAME); busy = true;
      try {
        const projected = predecessor(operation);
        const before = same(projected, Uint8Array.of(0x82, 1, 3)) ? null : response(projected, 0);
        const after = response(session(operation), 0);
        const beforeObservation = before === null ? null : response(observation(before), 5);
        const afterObservation = response(observation(after), 5);
        const frames = {operation, before, after, beforeObservation, afterObservation}, descriptions = {};
        for (const [name, bytes] of Object.entries(frames)) {
          if (bytes === null) {descriptions[name] = null; continue;}
          descriptions[name] = await codec.describe(bytes); check();
        }
        const handle = Object.freeze(Object.create(null));
        captures.set(handle, {owner: identity, frames, descriptions});
        return handle;
      } finally {busy = false;}
    },
    read(handle) {
      if (arguments.length !== 1) throw fail('invalid-input');
      const record = captured(handle);
      return Object.freeze({
        frames: Object.freeze(Object.fromEntries(Object.entries(record.frames)
          .map(([name, bytes]) => [name, bytes === null ? null : bytes.slice()]))),
        descriptions: Object.freeze(Object.fromEntries(Object.entries(record.descriptions)
          .map(([name, row]) => [name, row === null ? null : Object.freeze({descriptor: row.descriptor.slice(), marker: row.marker.slice()})]))),
        artifacts: Object.freeze(Object.fromEntries(roles.map(role => [role, artifacts[role].sha256.slice()]))),
      });
    },
    close() {if (arguments.length !== 0) throw fail('invalid-input'); closed = true;},
  });
}
