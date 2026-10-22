// SDK-private IndexedDB mechanics. Generated retention admission is mandatory;
// neither storage possession nor this adapter grants application authority.
import {bytesCopy} from './identity.mjs';
import {encodeRetentionWire as encode, decodeRetentionWire as decode} from './session-retention-wire.mjs';
import {inspectEffectModule} from './effects-module.mjs';

const FRAME = 67108864, CHUNK = 1048576, OBJECTS = 4096, ROOTS = 64;
const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const storageHandles = new WeakSet();
const equal = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const hash = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const reference = text => {
  if (typeof text !== 'string' || !hashPattern.test(text)) throw fail('storage-corrupt');
  return Uint8Array.from(text.match(/../g), pair => Number.parseInt(pair, 16));
};
const fail = code => new SessionStorageError(code);
export class SessionStorageError extends Error {
  constructor(code) { super(code); this.name = 'SessionStorageError'; this.code = code; }
}
function exact(value, names) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw fail('invalid-input');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string')
    || keys.sort().join(',') !== names.toSorted().join(',')
    || keys.some(key => !('value' in descriptors[key]))) throw fail('invalid-input');
  return Object.fromEntries(names.map(name => [name, descriptors[name].value]));
}
function copies(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw fail('invalid-input');
  const descriptors = Object.getOwnPropertyDescriptors(value), count = descriptors.length?.value;
  if (!Number.isInteger(count) || count < 0 || count > 16
    || Reflect.ownKeys(descriptors).length !== count + 1) throw fail('invalid-input');
  return Array.from({length: count}, (_, index) => {
    if (!descriptors[index] || !('value' in descriptors[index])) throw fail('invalid-input');
    return bytesCopy(descriptors[index].value, CHUNK);
  });
}
function canonical(bytes) {
  let value;
  try { value = decode(bytes); } catch { throw fail('invalid-input'); }
  if (!equal(encode(value), bytes)) throw fail('invalid-input');
  return value;
}
function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const storageError = error => error instanceof SessionStorageError ? error
  : fail(error?.name === 'QuotaExceededError' ? 'storage-quota' : 'storage-unavailable');
async function transaction(db, mode, operation) {
  let tx;
  try {
    tx = db.transaction(['metadata', 'objects', 'roots'], mode, {durability: 'strict'});
    if (tx.durability !== 'strict') throw fail('storage-unavailable');
  } catch (error) {
    try { tx?.abort(); } catch { /* No operation or acknowledgement has occurred. */ }
    throw storageError(error);
  }
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve; tx.onabort = () => reject(storageError(tx.error)); tx.onerror = () => {};
  });
  void done.catch(() => {});
  try { const result = await operation(tx); await done; return result; }
  catch (error) { try { tx.abort(); } catch { /* Already completed or aborted. */ }
    await done.catch(() => {}); throw storageError(error); }
}
async function snapshot(tx) {
  const metadata = await requestValue(tx.objectStore('metadata').get('state'));
  if (!metadata || Object.keys(metadata).sort().join(',') !== 'revision,schema'
    || metadata.schema !== 1 || !Number.isInteger(metadata.revision)
    || metadata.revision < 0 || metadata.revision > 0xffffffff
    || await requestValue(tx.objectStore('metadata').count()) !== 1) throw fail('storage-corrupt');
  const objects = tx.objectStore('objects'), roots = tx.objectStore('roots');
  if (await requestValue(objects.count()) > OBJECTS || await requestValue(roots.count()) > ROOTS)
    throw fail('storage-corrupt');
  const ids = await requestValue(objects.getAllKeys()), names = await requestValue(roots.getAllKeys());
  const rows = [];
  for (const name of names) {
    if (typeof name !== 'string' || !namePattern.test(name)) throw fail('storage-corrupt');
    const value = await requestValue(roots.get(name));
    if (!(value instanceof Uint8Array) || value.length > FRAME) throw fail('storage-corrupt');
    const root = canonical(value);
    if (!Array.isArray(root) || root[0] !== name) throw fail('storage-corrupt');
    rows.push(root);
  }
  return encode([1, metadata.revision, ids.map(reference), rows]);
}
async function generated(bytes, digest) {
  if (digest.length !== 32 || !equal(await hash(bytes), digest)) throw fail('artifact-mismatch');
  try { inspectEffectModule(bytes, 16384); } catch { throw fail('invalid-generated-module'); }
  const module = await WebAssembly.compile(bytes);
  return input => {
    if (input.length > FRAME) throw fail('frame-limit');
    try {
      const instance = new WebAssembly.Instance(module, {}), {memory, holo_alloc: allocate, holo_run: run} = instance.exports;
      const at = allocate(input.length) >>> 0;
      if (at + input.length > memory.buffer.byteLength) throw fail('invalid-generated-output');
      new Uint8Array(memory.buffer, at, input.length).set(input);
      const result = run(at, input.length);
      if (typeof result !== 'bigint') throw fail('invalid-generated-output');
      const packed = BigInt.asUintN(64, result), start = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
      if (length > FRAME || start + length > memory.buffer.byteLength || memory.buffer.byteLength > 1073741824)
        throw fail('invalid-generated-output');
      const reply = canonical(new Uint8Array(memory.buffer, start, length).slice());
      if (!Array.isArray(reply) || reply.length !== 3 || reply[0] !== 1) throw fail('invalid-generated-output');
      if (reply[1] === 1 || reply[1] === 2) throw fail('model-rejected');
      if (reply[1] !== 0) throw fail('invalid-generated-output');
      return reply[2];
    } catch (error) { if (error instanceof SessionStorageError) throw error; throw fail('generated-execution-failed'); }
  };
}
class SessionStorage {
  #db; #model; #closed = false; #busy = false;
  constructor(db, model) {
    this.#db = db; this.#model = model;
    db.onversionchange = () => this.#shutdown(); db.onclose = () => { this.#closed = true; };
  }
  #check() { if (this.#closed) throw fail('storage-closed'); }
  #shutdown() {
    if (!this.#closed) { this.#closed = true; this.#db.close(); }
  }
  #valid(bytes) {
    if (this.#model(encode([1, 1, canonical(bytes)])) !== true) throw fail('storage-corrupt');
  }
  async snapshot() {
    if (arguments.length !== 0) throw fail('invalid-input'); this.#check();
    const bytes = await transaction(this.#db, 'readonly', snapshot); this.#check(); this.#valid(bytes);
    return bytes;
  }
  async read(value) {
    if (arguments.length !== 1) throw fail('invalid-input'); this.#check();
    const digest = bytesCopy(value, 32); if (digest.length !== 32) throw fail('invalid-input');
    const bytes = await transaction(this.#db, 'readonly', tx => requestValue(tx.objectStore('objects').get(hex(digest))));
    this.#check(); if (bytes === undefined) return null;
    if (!(bytes instanceof Uint8Array) || bytes.length > CHUNK || !equal(await hash(bytes), digest)) throw fail('object-corrupt');
    this.#check(); return bytes;
  }
  async commit(value) {
    if (arguments.length !== 1) throw fail('invalid-input'); this.#check();
    if (this.#busy) throw fail('storage-busy');
    value = exact(value, ['expected', 'replacement', 'objects', 'retire']);
    const expected = bytesCopy(value.expected, FRAME), replacement = bytesCopy(value.replacement, FRAME);
    const retire = bytesCopy(value.retire, FRAME), objects = copies(value.objects);
    const before = canonical(expected), change = canonical(replacement), removed = canonical(retire);
    this.#busy = true;
    try {
      const prepared = await Promise.all(objects.map(async bytes => ({id: await hash(bytes), bytes})));
      prepared.sort((a, b) => hex(a.id) < hex(b.id) ? -1 : hex(a.id) > hex(b.id) ? 1 : 0); this.#check();
      const after = this.#model(encode([1, 0, before, change, prepared.map(row => row.id), removed]));
      const afterBytes = encode(after); this.#valid(afterBytes);
      await transaction(this.#db, 'readwrite', async tx => {
        // Compare the entire frontier, not only the selected journal head.
        // Concurrent staging, publication and retirement cannot hide behind CAS.
        if (!equal(await snapshot(tx), expected)) throw fail('frontier-conflict');
        this.#check();
        const objectStore = tx.objectStore('objects'), roots = tx.objectStore('roots');
        for (const row of prepared) {
          const key = hex(row.id), old = await requestValue(objectStore.get(key));
          if (old !== undefined && (!(old instanceof Uint8Array) || !equal(old, row.bytes))) throw fail('object-corrupt');
          if (old === undefined) await requestValue(objectStore.add(row.bytes, key));
        }
        for (const digest of removed) await requestValue(objectStore.delete(hex(digest)));
        if (change[0] === 1) {
          const [name, , head, references] = change[1];
          await requestValue(roots.put(encode([name, head, references]), name));
        }
        await requestValue(tx.objectStore('metadata').put({schema: 1, revision: after[1]}, 'state'));
        if (!equal(await snapshot(tx), afterBytes)) throw fail('generated-frontier-mismatch');
        this.#check();
      });
      this.#check(); return afterBytes;
    } finally { this.#busy = false; }
  }
  close() {
    if (arguments.length !== 0) throw fail('invalid-input');
    this.#shutdown();
  }
}
// Private composition access captures actual SDK methods, not caller-supplied
// lookalikes or overwritten methods on a genuine instance. It grants no authority.
const storageMethods = Object.freeze(Object.fromEntries(['snapshot', 'read', 'commit']
  .map(name => [name, SessionStorage.prototype[name]])));
export function sessionStorageAccess(storage) {
  if (arguments.length !== 1 || !storageHandles.has(storage)) throw fail('invalid-input');
  return Object.freeze(Object.fromEntries(Object.entries(storageMethods)
    .map(([name, method]) => [name, (...arguments_) => Reflect.apply(method, storage, arguments_)])));
}
export async function openSessionStorage(value) {
  if (arguments.length !== 1) throw fail('invalid-input');
  value = exact(value, ['namespace', 'wire', 'wireDigest']);
  if (typeof value.namespace !== 'string' || !namePattern.test(value.namespace)) throw fail('invalid-input');
  const namespace = value.namespace, wire = bytesCopy(value.wire, FRAME), digest = bytesCopy(value.wireDigest, 32);
  const model = await generated(wire, digest); let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('prismpm.browser.session.v1/' + namespace, 1); let abandoned = false;
      const timer = setTimeout(() => { abandoned = true; reject(fail('storage-blocked')); }, 5000);
      request.onerror = () => { clearTimeout(timer); reject(storageError(request.error)); };
      request.onblocked = () => { abandoned = true; clearTimeout(timer); reject(fail('storage-blocked')); };
      request.onupgradeneeded = () => {
        if (abandoned) { request.transaction.abort(); return; }
        for (const name of ['metadata', 'objects', 'roots']) request.result.createObjectStore(name);
        request.transaction.objectStore('metadata').add({schema: 1, revision: 0}, 'state');
      };
      request.onsuccess = () => { clearTimeout(timer); if (abandoned) request.result.close(); else resolve(request.result); };
    });
    if (Array.from(db.objectStoreNames).join(',') !== 'metadata,objects,roots') throw fail('storage-corrupt');
    await transaction(db, 'readonly', tx => {
      for (const name of db.objectStoreNames) {
        const store = tx.objectStore(name);
        if (store.keyPath !== null || store.autoIncrement || store.indexNames.length) throw fail('storage-corrupt');
      }
    });
    const storage = new SessionStorage(db, model);
    await Reflect.apply(storageMethods.snapshot, storage, []);
    // An instance exposes its constructor/prototype. Only this completed
    // factory may brand it; constructor calls and method overrides are not proof.
    storageHandles.add(storage);
    return storage;
  } catch (error) { db?.close(); throw storageError(error); }
}
