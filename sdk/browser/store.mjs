// This host boundary supplies durable bytes, not application authorization.
// A generated reducer must accept an operation before it reaches commit().
import { BrowserEffectError, bytesCopy, digestBytes, validateIdentity } from './identity.mjs';

const defaults = Object.freeze({ maxObjectBytes: 1048576, maxObjects: 4096, maxHeads: 64 });
const hashPattern = /^sha256:[0-9a-f]{64}$/;
const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const fail = code => new BrowserEffectError(code);

function checkedName(value) {
  if (typeof value !== 'string' || !namePattern.test(value)) throw fail('invalid-input');
  return value;
}

function checkedHash(value) {
  if (typeof value !== 'string' || !hashPattern.test(value)) throw fail('invalid-input');
  return value;
}

function checkedLimits(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'maxHeads,maxObjectBytes,maxObjects'
      || Object.entries(defaults).some(([key, cap]) => !Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > cap)) {
    throw fail('invalid-input');
  }
  return Object.freeze({ maxObjectBytes: value.maxObjectBytes, maxObjects: value.maxObjects, maxHeads: value.maxHeads });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storageError(error) {
  if (error instanceof BrowserEffectError) return error;
  return fail(error?.name === 'QuotaExceededError' ? 'storage-quota' : 'storage-unavailable');
}

async function transaction(db, stores, mode, operation) {
  let tx;
  try {
    tx = db.transaction(stores, mode, { durability: 'strict' });
    if (tx.durability !== 'strict') throw fail('storage-unavailable');
  } catch (error) {
    try { tx?.abort(); } catch { /* No operation or acknowledgement has occurred. */ }
    throw storageError(error);
  }
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(storageError(tx.error));
    tx.onerror = () => {};
  });
  // Install the rejection observer immediately: an IDB request may fail before
  // the operation settles. Never acknowledge a write before oncomplete.
  void done.catch(() => {});
  try {
    const result = await operation(tx);
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* Already aborted or completed. */ }
    await done.catch(() => {});
    throw storageError(error);
  }
}

async function verifiedBytes(id, bytes, maximum) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maximum
      || await digestBytes(bytes) !== id) throw fail('object-corrupt');
  return bytes;
}

class BrowserStore {
  #db;
  #closed = false;
  #limits;

  constructor(db, limits) {
    this.#db = db;
    this.#limits = limits;
    db.onversionchange = () => this.close();
    db.onclose = () => { this.#closed = true; };
  }

  #assertOpen() {
    if (this.#closed) throw fail('store-closed');
  }

  async loadIdentity() {
    this.#assertOpen();
    const identity = await transaction(this.#db, ['identity'], 'readonly', tx => requestValue(tx.objectStore('identity').get('local')));
    return identity === undefined ? null : validateIdentity(identity);
  }

  async saveIdentity(value) {
    this.#assertOpen();
    const identity = await validateIdentity(value);
    this.#assertOpen();
    await transaction(this.#db, ['identity'], 'readwrite', async tx => {
      const store = tx.objectStore('identity');
      if (await requestValue(store.get('local')) !== undefined) throw fail('identity-exists');
      await requestValue(store.add(identity, 'local'));
    });
  }

  async readObject(value) {
    this.#assertOpen();
    const id = checkedHash(value);
    const bytes = await transaction(this.#db, ['objects'], 'readonly', tx => requestValue(tx.objectStore('objects').get(id)));
    return bytes === undefined ? null : verifiedBytes(id, bytes, this.#limits.maxObjectBytes);
  }

  async readHead(value) {
    this.#assertOpen();
    const name = checkedName(value);
    const result = await transaction(this.#db, ['heads', 'objects'], 'readonly', async tx => {
      const id = await requestValue(tx.objectStore('heads').get(name));
      if (id === undefined) return null;
      if (typeof id !== 'string' || !hashPattern.test(id)) throw fail('object-corrupt');
      return { id, bytes: await requestValue(tx.objectStore('objects').get(id)) };
    });
    if (result === null) return null;
    return { id: result.id, bytes: await verifiedBytes(result.id, result.bytes, this.#limits.maxObjectBytes) };
  }

  async commit(value) {
    this.#assertOpen();
    if (!value || Object.keys(value).sort().join(',') !== 'expected,head,next,objects'
        || !Array.isArray(value.objects) || value.objects.length > 16) throw fail('invalid-input');
    const head = checkedName(value.head);
    const expected = value.expected === null ? null : checkedHash(value.expected);
    const next = checkedHash(value.next);
    // Capture all caller-owned buffers before the first asynchronous operation.
    const copies = value.objects.map(bytes => bytesCopy(bytes, this.#limits.maxObjectBytes));
    const prepared = await Promise.all(copies.map(async bytes => ({ id: await digestBytes(bytes), bytes })));
    if (new Set(prepared.map(row => row.id)).size !== prepared.length) throw fail('invalid-input');
    // No asynchronous hashing in a live IDB transaction: the desired object's
    // verified bytes are required even when it has already been retained.
    if (!prepared.some(row => row.id === next)) throw fail('missing-object');
    this.#assertOpen();
    await transaction(this.#db, ['objects', 'heads'], 'readwrite', async tx => {
      const objects = tx.objectStore('objects');
      const heads = tx.objectStore('heads');
      const current = await requestValue(heads.get(head));
      if (current !== undefined && (typeof current !== 'string' || !hashPattern.test(current))) throw fail('object-corrupt');
      if ((current ?? null) !== expected) throw fail('head-conflict');
      let count = await requestValue(objects.count());
      for (const { id, bytes } of prepared) {
        const existing = await requestValue(objects.get(id));
        if (existing !== undefined) {
          if (!(existing instanceof Uint8Array) || existing.length !== bytes.length
              || existing.some((byte, index) => byte !== bytes[index])) throw fail('object-corrupt');
        } else {
          if (++count > this.#limits.maxObjects) throw fail('store-limit');
          await requestValue(objects.add(bytes, id));
        }
      }
      if (current === undefined && await requestValue(heads.count()) >= this.#limits.maxHeads) throw fail('store-limit');
      await requestValue(heads.put(next, head));
    });
    return next;
  }

  close() {
    if (!this.#closed) this.#db.close();
    this.#closed = true;
  }
}

export async function openStore(namespace, requestedLimits = defaults) {
  checkedName(namespace);
  const limits = checkedLimits(requestedLimits);
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(`prismpm.browser.v1/${namespace}`, 1);
      let abandoned = false;
      const timer = setTimeout(() => { abandoned = true; reject(fail('storage-blocked')); }, 5000);
      request.onblocked = () => { abandoned = true; clearTimeout(timer); reject(fail('storage-blocked')); };
      request.onerror = () => { clearTimeout(timer); reject(storageError(request.error)); };
      request.onupgradeneeded = () => {
        if (abandoned) { request.transaction.abort(); return; }
        for (const name of ['objects', 'heads', 'identity', 'metadata']) request.result.createObjectStore(name);
        request.transaction.objectStore('metadata').add(limits, 'limits');
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (abandoned) request.result.close();
        else resolve(request.result);
      };
    });
    if (Array.from(db.objectStoreNames).join(',') !== 'heads,identity,metadata,objects') throw fail('object-corrupt');
    await transaction(db, ['objects', 'heads', 'identity', 'metadata'], 'readonly', async tx => {
      for (const name of db.objectStoreNames) {
        const store = tx.objectStore(name);
        if (store.keyPath !== null || store.autoIncrement || store.indexNames.length !== 0) throw fail('object-corrupt');
      }
      const metadata = tx.objectStore('metadata');
      const existing = await requestValue(metadata.get('limits'));
      if (!existing || Object.keys(existing).sort().join(',') !== 'maxHeads,maxObjectBytes,maxObjects'
          || Object.entries(defaults).some(([key, cap]) => !Number.isSafeInteger(existing[key]) || existing[key] < 1 || existing[key] > cap)) {
        throw fail('object-corrupt');
      }
      if (Object.keys(limits).some(key => existing[key] !== limits[key])) throw fail('store-policy-mismatch');
    });
    return new BrowserStore(db, limits);
  } catch (error) {
    db?.close();
    throw storageError(error);
  }
}
