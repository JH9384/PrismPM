// Private browser session transport. Generated DK-24 partition/descriptor admission and
// generated retention own the protocols. This supplies hashing and storage only.
import {bytesCopy} from './identity.mjs';
import {inspectEffectArtifactBudget, inspectEffectModule} from './effects-module.mjs';
import {encodeEffectWire as encode, decodeEffectWire as decode} from './effects-wire.mjs';
import {encodeRetentionWire, decodeRetentionWire} from './session-retention-wire.mjs';
import {sessionStorageAccess} from './session-storage.mjs';

const FRAME = 67108864, CHUNK = 1048576, METADATA = 65536;
const same = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const hash = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const fail = code => new SessionPayloadError(code);
export class SessionPayloadError extends Error {
  constructor(code) {super(code); this.name = 'SessionPayloadError'; this.code = code;}
}
function exact(value, names) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw fail('invalid-input');
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string')
    || keys.sort().join(',') !== names.toSorted().join(',')
    || keys.some(key => !('value' in fields[key]))) throw fail('invalid-input');
  return Object.fromEntries(names.map(name => [name, fields[name].value]));
}
function canonical(bytes) {
  let value;
  try {value = decode(bytes);} catch {throw fail('invalid-input');}
  if (!same(encode(value), bytes)) throw fail('invalid-input');
  return value;
}
async function generated(bytes, expected) {
  if (expected.length !== 32 || !same(await hash(bytes), expected)) throw fail('artifact-mismatch');
  try {inspectEffectModule(bytes, 16384);} catch {throw fail('invalid-generated-module');}
  let module;
  try {module = await WebAssembly.compile(bytes);} catch {throw fail('invalid-generated-module');}
  return input => {
    if (input.length > FRAME) throw fail('invalid-input');
    try {
      const instance = new WebAssembly.Instance(module, {});
      const {memory, holo_alloc: allocate, holo_run: run} = instance.exports;
      if (!(memory instanceof WebAssembly.Memory) || typeof allocate !== 'function'
        || typeof run !== 'function' || allocate.length !== 1 || run.length !== 2)
        throw fail('invalid-generated-module');
      const pointer = allocate(input.length) >>> 0;
      if (pointer + input.length > memory.buffer.byteLength) throw fail('invalid-generated-output');
      new Uint8Array(memory.buffer, pointer, input.length).set(input);
      const returned = run(pointer, input.length);
      if (typeof returned !== 'bigint') throw fail('invalid-generated-output');
      const packed = BigInt.asUintN(64, returned), start = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
      if (length > METADATA || start + length > memory.buffer.byteLength || memory.buffer.byteLength > 1073741824)
        throw fail('invalid-generated-output');
      const reply = canonical(new Uint8Array(memory.buffer, start, length).slice());
      if (!Array.isArray(reply) || reply.length !== 3 || reply[0] !== 1) throw fail('invalid-generated-output');
      if (reply[1] === 1 || reply[1] === 2) throw fail('model-rejected');
      if (reply[1] !== 0) throw fail('invalid-generated-output');
      return reply[2];
    } catch (error) {if (error instanceof SessionPayloadError) throw error; throw fail('generated-execution-failed');}
  };
}

function partitionPlan(partition, bytes) {
    const plan = partition(bytes);
    if (!Array.isArray(plan) || plan.length < 1 || plan.length > 64) throw fail('invalid-generated-output');
    let offset = 0;
    for (const row of plan) {
      if (!Array.isArray(row) || row.length !== 2 || row[0] !== offset
        || row[1] !== Math.min(CHUNK, bytes.length - offset) || row[1] <= 0)
        throw fail('invalid-generated-output');
      offset += row[1];
    }
    if (offset !== bytes.length) throw fail('invalid-generated-output');
    return plan;
}
function admittedDescriptor(wire, bytes) {
    const value = canonical(bytes), admitted = wire(encode([1, 6, value]));
    if (!same(bytes, encode(admitted))) throw fail('payload-invalid');
    if (!Array.isArray(admitted) || admitted.length !== 3) throw fail('invalid-generated-output');
    const [digest, length, chunks] = admitted;
    if (!(digest instanceof Uint8Array) || digest.length !== 32 || !Number.isSafeInteger(length)
      || length < 1 || length > FRAME || !Array.isArray(chunks) || chunks.length !== Math.ceil(length / CHUNK)
      || chunks.some(chunk => !(chunk instanceof Uint8Array) || chunk.length !== 32)) throw fail('payload-invalid');
    return admitted;
}

// SDK-private byte description only. Digest agreement is not SDK/artifact
// authority, authenticated state, storage acknowledgement or a publication.
const descriptorOwners = new WeakMap();
export async function createSessionPayloadDescriptor(value) {
  if (arguments.length !== 1) throw fail('invalid-input');
  value = exact(value, ['wire', 'wireDigest', 'partition', 'partitionDigest']);
  inspectEffectArtifactBudget(value.wire, [value.partition]);
  const wireBytes = bytesCopy(value.wire, FRAME), partitionBytes = bytesCopy(value.partition, FRAME);
  const wireDigest = bytesCopy(value.wireDigest, 32), partitionDigest = bytesCopy(value.partitionDigest, 32);
  const wire = await generated(wireBytes, wireDigest), partition = await generated(partitionBytes, partitionDigest);
  const owner = Object.freeze({
    partition(value) {
      if (arguments.length !== 1) throw fail('invalid-input');
      return partitionPlan(partition, bytesCopy(value, FRAME));
    },
    admit(value) {
      if (arguments.length !== 1) throw fail('invalid-input');
      return admittedDescriptor(wire, bytesCopy(value, METADATA));
    },
    async describe(value) {
      if (arguments.length !== 1) throw fail('invalid-input');
      const bytes = bytesCopy(value, FRAME), plan = partitionPlan(partition, bytes), chunks = [];
      for (const [at, length] of plan) chunks.push(await hash(bytes.subarray(at, at + length)));
      const descriptor = encode([await hash(bytes), bytes.length, chunks]);
      admittedDescriptor(wire, descriptor);
      return Object.freeze({descriptor, marker: await hash(descriptor)});
    },
  });
  descriptorOwners.set(owner, Object.freeze({wire, partition}));
  return owner;
}

class SessionPayloads {
  #store; #codec; #closed = false; #busy = false; #uncertain = false;
  constructor(store, codec) {
    this.#store = store; this.#codec = descriptorOwners.get(codec);
    if (!this.#codec) throw fail('invalid-input');
  }
  #check() {if (this.#closed) throw fail('payload-closed');}
  // Stage/load already own their complete frame snapshots. Preserve the old
  // maximum-memory behavior instead of making another public-boundary copy.
  #plan(bytes) {return partitionPlan(this.#codec.partition, bytes);}
  #descriptor(bytes) {return admittedDescriptor(this.#codec.wire, bytes);}
  async #load(descriptor) {
    const [digest, length, chunks] = this.#descriptor(descriptor), bytes = new Uint8Array(length);
    let offset = 0;
    for (const reference of chunks) {
      const chunk = await this.#store.read(reference); this.#check();
      if (chunk === null || chunk.length !== Math.min(CHUNK, length - offset)) throw fail('chunk-missing');
      // Storage already checks its object identity; bind the whole ordered frame
      // as well, including duplicated references and the final partial chunk.
      bytes.set(chunk, offset); offset += chunk.length;
    }
    if (offset !== length || !same(await hash(bytes), digest)) throw fail('payload-invalid');
    this.#check(); this.#plan(bytes); return bytes;
  }
  async load(value) {
    if (arguments.length !== 1) throw fail('invalid-input'); this.#check();
    const bytes = bytesCopy(value, METADATA);
    return this.#load(bytes);
  }
  async stage(value) {
    if (arguments.length !== 1) throw fail('invalid-input'); this.#check();
    if (this.#busy) throw fail('payload-busy');
    if (this.#uncertain) throw fail('publication-uncertain');
    value = exact(value, ['bytes', 'root', 'expected']);
    const bytes = bytesCopy(value.bytes, FRAME), root = value.root;
    const expected = value.expected === null ? null : bytesCopy(value.expected, 32);
    if (typeof root !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(root)
      || expected !== null && expected.length !== 32) throw fail('invalid-input');
    this.#busy = true;
    try {
      const plan = this.#plan(bytes), chunks = [];
      for (const [at, length] of plan) chunks.push(await hash(bytes.subarray(at, at + length)));
      const descriptor = encode([await hash(bytes), bytes.length, chunks]);
      this.#check(); this.#descriptor(descriptor);
      const marker = await hash(descriptor); this.#check();
      let frontier = await this.#store.snapshot(); this.#check();
      const before = decodeRetentionWire(frontier), selected = before[3].find(row => row[0] === root);
      if (expected === null ? selected !== undefined : selected === undefined || !same(selected[1], expected))
        throw fail('staging-conflict');
      const references = new Map((selected?.[2] ?? []).map(reference => [hex(reference), reference]));
      // Intermediate heads are opaque chunks, not a descriptor referencing
      // absent bytes. Publish the complete descriptor only in the final batch.
      const additions = new Map();
      for (let index = 0; index < plan.length; index++) {
        const [at, length] = plan[index], key = hex(chunks[index]);
        const old = additions.get(key), part = bytes.subarray(at, at + length);
        if (old && !same(old.bytes, part)) throw fail('payload-invalid');
        if (!old) additions.set(key, {id: chunks[index], bytes: part});
      }
      const markerKey = hex(marker), existingMarker = additions.get(markerKey);
      if (existingMarker && !same(existingMarker.bytes, descriptor)) throw fail('payload-invalid');
      additions.delete(markerKey);
      additions.set(markerKey, {id: marker, bytes: descriptor});
      const objects = [...additions.values()]; let prior = expected;
      for (let start = 0; start < objects.length; start += 16) {
        const batch = objects.slice(start, start + 16);
        const head = batch[batch.length - 1].id;
        for (const object of batch) references.set(hex(object.id), object.id);
        const closure = [...references].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, id]) => id);
        this.#check();
        // Never silently retry a competing frontier or an uncertain commit.
        // Every acknowledged partial batch retains the complete previous root.
        try {
          frontier = await this.#store.commit({expected: frontier,
            replacement: encodeRetentionWire([1, [root, prior === null ? [0] : [1, prior], head, closure]]),
            objects: batch.map(object => object.bytes), retire: encodeRetentionWire([])});
        } catch (error) {this.#uncertain = true; throw error;}
        this.#check(); prior = head;
      }
      if (!same(await this.#load(descriptor), bytes)) throw fail('payload-invalid');
      this.#check();
      return Object.freeze({descriptor: descriptor.slice(), marker: marker.slice(), frontier: frontier.slice()});
    } finally {this.#busy = false;}
  }
  close() {if (arguments.length !== 0) throw fail('invalid-input'); this.#closed = true;}
}

export async function openSessionPayloads(value) {
  if (arguments.length !== 1) throw fail('invalid-input');
  value = exact(value, ['storage', 'wire', 'wireDigest', 'partition', 'partitionDigest']);
  const storage = sessionStorageAccess(value.storage);
  const codec = await createSessionPayloadDescriptor({wire: value.wire, wireDigest: value.wireDigest,
    partition: value.partition, partitionDigest: value.partitionDigest});
  return new SessionPayloads(storage, codec);
}
