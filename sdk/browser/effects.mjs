// Private SDK composition boundary, not a product authorization endpoint.
// Independently verified bootstrap grants bind every artifact and resource.
import {bytesCopy, digestBytes, randomBytes, signBytes, verifyBytes, validateIdentity} from './identity.mjs';
import {openStore} from './store.mjs';
import {decodeEffectWire, encodeEffectWire, EFFECT_FRAME_MAXIMUM} from './effects-wire.mjs';
import {inspectEffectModule, inspectEffectArtifactBudget} from './effects-module.mjs';
import {checkCredentialSigning, credentialPublicBindings, signCredential} from './credential-custody.mjs';

const WIRE_PAGES = 16384;
const failures = ['invalid-input', 'identity-corrupt', 'crypto-unavailable', 'head-conflict',
  'missing-object', 'object-corrupt', 'store-limit', 'store-closed', 'storage-quota',
  'storage-unavailable', 'invalid-generated-module', 'generated-execution-failed', 'invalid-generated-output'];
const allowed = [
  [10, 11, 12], [0, 2], [0, 2], [0, 1, 2], [0, 2],
  [0, 2, 5, 7, 8, 9], [0, 2, 5, 7, 8, 9], [0, 2, 3, 4, 5, 6, 7, 8],
];
const same = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const equal = (a, b) => same(encodeEffectWire(a), encodeEffectWire(b));
function record(value, keys) {
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string')
    || own.sort().join(',') !== keys.toSorted().join(',')) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return own.every(key => 'value' in fields[key]);
}
function captureArray(value, capture) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 64) throw fail('invalid-input');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== value.length + 1) throw fail('invalid-input');
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const field = fields[index];
    if (!field || !('value' in field)) throw fail('invalid-input');
    result.push(capture(field.value));
  }
  return result;
}

export class EffectHostError extends Error {
  constructor(code, detail) {
    super(code); this.name = 'EffectHostError'; this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}
const fail = (code, detail) => new EffectHostError(code, detail);

async function artifactDigest(bytes) {
  // Artifact integrity is a bootstrap check, not the 1-MiB application digest
  // effect. The exact captured artifact has already passed the frame bound.
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

function interpreter(module, inputMaximum, outputMaximum, memoryPages) {
  if (!(module instanceof WebAssembly.Module) || WebAssembly.Module.imports(module).length !== 0) throw fail('invalid-generated-module');
  return input => {
    if (input.length > inputMaximum) throw fail('request-limit');
    try {
      const instance = new WebAssembly.Instance(module, {});
      const {memory, holo_alloc: allocate, holo_run: run} = instance.exports;
      if (!(memory instanceof WebAssembly.Memory) || typeof allocate !== 'function' || typeof run !== 'function'
        || allocate.length !== 1 || run.length !== 2) throw fail('invalid-generated-module');
      if (memory.buffer.byteLength > memoryPages * 65536) throw fail('invalid-generated-output');
      const pointer = allocate(input.length) >>> 0;
      if (memory.buffer.byteLength > memoryPages * 65536 || pointer + input.length > memory.buffer.byteLength) throw fail('invalid-generated-output');
      new Uint8Array(memory.buffer, pointer, input.length).set(input);
      const returned = run(pointer, input.length);
      if (typeof returned !== 'bigint') throw fail('invalid-generated-output');
      const packed = BigInt.asUintN(64, returned), at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
      if (length > outputMaximum || at + length > memory.buffer.byteLength || memory.buffer.byteLength > memoryPages * 65536) throw fail('invalid-generated-output');
      return new Uint8Array(memory.buffer, at, length).slice();
    } catch (error) {
      if (error instanceof EffectHostError) throw error;
      throw fail('generated-execution-failed');
    }
  };
}

function transition(call, input) {
  let output;
  try { output = decodeEffectWire(call(encodeEffectWire(input))); }
  catch (error) { if (error instanceof EffectHostError) throw error; throw fail('invalid-generated-output'); }
  if (!Array.isArray(output) || output.length !== 3 || output[0] !== 1) throw fail('invalid-generated-output');
  if (output[1] === 1 && Array.isArray(output[2]) && output[2].length === 1
    && Number.isInteger(output[2][0]) && output[2][0] >= 0 && output[2][0] < 15) throw fail('model-rejected', output[2][0]);
  if (output[1] === 2 && Number.isInteger(output[2]) && output[2] >= 0 && output[2] < 9) throw fail('wire-rejected', output[2]);
  if (output[1] !== 0 || !Array.isArray(output[2]) || output[2].length !== 7) throw fail('invalid-generated-output');
  return output[2];
}

class Effects {
  #call; #state; #manifest; #session; #resources; #stores; #pending = []; #closed = false;
  constructor(call, state, resources, stores) {
    this.#call = call; this.#state = state;
    this.#manifest = state[0]; this.#session = state[1];
    this.#resources = resources; this.#stores = stores;
  }
  #step(message, validate) {
    const next = transition(this.#call, message);
    if (!equal(next[0], this.#manifest) || !same(next[1], this.#session)) throw fail('invalid-generated-output');
    validate(next);
    this.#state = next;
  }
  #settle(item, error, value) {
    if (item.settled) return;
    item.settled = true;
    if (error) item.reject(error); else item.resolve(value);
  }
  #closeState() {
    this.#step([1, 3, this.#state], next => {
      if (next[2] !== this.#state[2] || next[3] !== true || next[4] !== this.#state[4]
        || !equal(next[5], this.#state[5]) || !equal(next[6], this.#state[6])) throw fail('invalid-generated-output');
    });
  }
  #terminate(code) {
    this.#closed = true;
    try { this.#closeState(); } catch { /* Never invent a reconciled state. */ }
    for (const item of this.#pending) this.#settle(item,
      fail(item.started && item.request[5][0] === 7 ? 'effect-outcome-unknown' : code));
    for (const store of this.#stores) { try { store.close(); } catch { /* No rollback is inferred. */ } }
  }
  async #perform(request) {
    const [, , , , resource, effect] = request, adapter = this.#resources.get(resource);
    const [operation, input] = effect;
    try {
      if (operation === 0) return [0, adapter.call(input[3])];
      if (operation === 1) return [1, randomBytes(input)];
      if (operation === 2) return [2, await digestBytes(input)];
      if (operation === 3) return [3, adapter.custody === undefined
        ? await signBytes(adapter.identity, adapter.context, input)
        : await signCredential(adapter.custody, resource, input)];
      if (operation === 4) return [4, await verifyBytes(adapter.publicKey, adapter.context, input[0], input[1])];
      if (operation === 5) {
        const object = await adapter.store.readObject(input);
        return [5, object === null ? [0] : [1, object]];
      }
      if (operation === 6) {
        const head = await adapter.store.readHead(input);
        return [6, head === null ? [0] : [1, [head.id, head.bytes]]];
      }
      if (operation === 7) return [7, await adapter.store.commit({head: input[0], expected: input[1][0] === 0 ? null : input[1][1], next: input[2], objects: input[3]})];
      throw fail('invalid-generated-output');
    } catch (error) {
      let code;
      try { code = error?.code; } catch { /* Exception content is never retained. */ }
      const selected = failures.indexOf(code);
      if (allowed[operation]?.includes(selected)) return [8, [selected]];
      return [9];
    }
  }
  async #execute(item) {
    if (item.started || !item.released || this.#closed || this.#state[4]) return;
    item.started = true;
    const result = await this.#perform(item.request);
    if (this.#closed || this.#pending[0] !== item) return;
    try {
      this.#step([1, 2, this.#state, [item.request, result]], next => {
        if (next[2] !== this.#state[2] || next[3] !== this.#state[3]
          || next[4] !== (result[0] === 9)) throw fail('invalid-generated-output');
        if (next[4]) {
          if (!equal(next[5], this.#state[5]) || !equal(next[6], this.#state[6])) throw fail('invalid-generated-output');
        } else {
          const expected = this.#pending.length === 1 ? [0] : [1, this.#pending[1].request];
          if (!equal(next[5], expected) || !equal(next[6], [0])) throw fail('invalid-generated-output');
        }
      });
      if (this.#state[4]) {
        for (const pending of this.#pending) this.#settle(pending, fail('effect-outcome-unknown'));
        return;
      }
      this.#pending.shift();
      this.#settle(item, result[0] === 8 && !item.staged ? fail('effect-rejected', result[1][0]) : null,
        encodeEffectWire(result));
      if (this.#pending.length && this.#pending[0].released) void this.#execute(this.#pending[0]);
    } catch {
      this.#settle(item, fail('effect-outcome-unknown'));
      this.#terminate('host-unavailable');
    }
  }
  #admit(value, staged, exact = false) {
      if (this.#closed) throw fail('host-closed');
      if (this.#state[4]) throw fail('effect-outcome-unknown');
      let intent;
      try { intent = decodeEffectWire(value); } catch { throw fail('invalid-input'); }
      if (!Array.isArray(intent) || intent.length !== (exact ? 6 : 2)
        || typeof intent[exact ? 4 : 0] !== 'string') throw fail('invalid-input');
      // The exact path never repairs caller bindings with the current host
      // context. The generated admission owns all six original fields.
      const request = exact ? intent
        : [this.#manifest[0], this.#manifest[1], this.#session, this.#state[2], intent[0], intent[1]];
      if (staged && Array.isArray(request[5]) && request[5][0] === 3) {
        const adapter = this.#resources.get(request[4]);
        if (adapter?.custody !== undefined) checkCredentialSigning(adapter.custody, request[4], request[5][1]);
      }
      this.#step([1, 1, this.#state, request], next => {
        const active = this.#pending.length === 0 ? [1, request] : this.#state[5];
        const waiter = this.#pending.length === 0 ? [0] : [1, request];
        if (this.#pending.length > 1 || next[2] !== request[3] + 1 || next[3] !== false || next[4] !== false
          || !equal(next[5], active) || !equal(next[6], waiter)) throw fail('invalid-generated-output');
      });
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const item = {request, promise, resolve, reject, staged, released: !staged, started: false, settled: false};
      this.#pending.push(item);
      // A staged request has already passed the generated admission exactly
      // once. Its private composition owner must first persist that exact
      // request; admission is not permission to perform the primitive yet.
      if (staged) void promise.catch(() => {});
      if (!staged && this.#pending.length === 1) void this.#execute(item);
      return item;
  }
  #admissionError(error) {
    if (!(error instanceof EffectHostError)) { this.#terminate('host-unavailable'); return fail('host-unavailable'); }
    if (['invalid-generated-module', 'invalid-generated-output', 'generated-execution-failed'].includes(error.code)) this.#terminate('host-unavailable');
    return error;
  }
  submit(value) {
    try {
      if (arguments.length !== 1) throw fail('invalid-input');
      return this.#admit(value, false).promise;
    } catch (error) {
      return Promise.reject(this.#admissionError(error));
    }
  }
  prepare(value) {
    if (arguments.length !== 1) throw fail('invalid-input');
    return this.#prepare(value, false);
  }
  prepareExact(value) {
    if (arguments.length !== 1) throw fail('invalid-input');
    return this.#prepare(value, true);
  }
  #prepare(value, exact) {
    try {
      const item = this.#admit(value, true, exact);
      const request = encodeEffectWire(item.request);
      let released = false;
      return Object.freeze({request, release: (...arguments_) => {
        if (arguments_.length !== 0) return Promise.reject(fail('invalid-input'));
        if (released) return Promise.reject(fail('invalid-input'));
        released = true;
        // Unknown settles every queued promise without closing this host.
        // Exact contextual composition must retain that uncertainty even
        // when its waiter is released only after the active result was lost.
        if (exact && !this.#closed && this.#state[4]) return Promise.reject(fail('effect-outcome-unknown'));
        if (this.#closed || item.settled) return Promise.reject(fail('host-closed'));
        if (this.#state[4]) return Promise.reject(fail('effect-outcome-unknown'));
        item.released = true;
        if (this.#pending[0] === item) void this.#execute(item);
        // The request is the private captured value, not the mutable request
        // copy returned above or a later caller-supplied completion label.
        return exact ? item.promise.then(result => encodeEffectWire([item.request, decodeEffectWire(result)]))
          : item.promise;
      }});
    } catch (error) { throw this.#admissionError(error); }
  }
  context() {
    if (arguments.length !== 0) throw fail('invalid-input');
    if (this.#closed) throw fail('host-closed');
    if (this.#state[4]) throw fail('effect-outcome-unknown');
    return Object.freeze({application: this.#manifest[0].slice(), manifest: this.#manifest[1].slice(),
      session: this.#session.slice(), nextOperation: this.#state[2]});
  }
  close() {
    if (arguments.length !== 0) throw fail('invalid-input');
    if (this.#closed) return;
    try { this.#closeState(); }
    finally { this.#terminate('host-closed'); }
  }
  status() {
    if (arguments.length !== 0) throw fail('invalid-input');
    return Object.freeze({closed: this.#closed, uncertain: this.#state[4], pending: this.#pending.length, nextOperation: this.#state[2]});
  }
}

async function openEffectsInternal(options, staged, contextual = false) {
  const stores = [];
  try {
    if (!record(options, ['wire', 'wireDigest', 'manifest', 'guests', 'signers'])
      || !Array.isArray(options.guests) || !Array.isArray(options.signers)
      || options.guests.length > 64 || options.signers.length > 64) throw fail('invalid-input');
    // Capture all bootstrap-owned values before the first asynchronous boundary.
    const wireInput = options.wire, digestInput = options.wireDigest, manifestInput = options.manifest;
    const guests = captureArray(options.guests, value => {
      if (!record(value, ['resource', 'bytes']) || typeof value.resource !== 'string') throw fail('invalid-input');
      return {resource: value.resource, bytes: value.bytes};
    });
    const signers = captureArray(options.signers, value => {
      if (staged) {
        if (!record(value, ['resource', 'custody']) || typeof value.resource !== 'string') throw fail('invalid-input');
        return {resource: value.resource, custody: value.custody};
      }
      if (!record(value, ['resource', 'identity']) || typeof value.resource !== 'string'
        || !record(value.identity, ['principal', 'privateKey', 'publicKey'])) throw fail('invalid-input');
      return {resource: value.resource, identity: {
        principal: value.identity.principal, privateKey: value.identity.privateKey,
        publicKey: bytesCopy(value.identity.publicKey, 65),
      }};
    });
    try { inspectEffectArtifactBudget(wireInput, guests.map(value => value.bytes)); }
    catch { throw fail('invalid-input'); }
    const wire = bytesCopy(wireInput, EFFECT_FRAME_MAXIMUM), expected = bytesCopy(digestInput, 32);
    const manifest = decodeEffectWire(manifestInput);
    for (const guest of guests) guest.bytes = bytesCopy(guest.bytes, EFFECT_FRAME_MAXIMUM);
    if (expected.length !== 32 || !same(await artifactDigest(wire), expected)) throw fail('artifact-mismatch');
    try { inspectEffectModule(wire, WIRE_PAGES); } catch { throw fail('invalid-generated-module'); }
    const module = await WebAssembly.compile(wire), call = interpreter(module, EFFECT_FRAME_MAXIMUM, EFFECT_FRAME_MAXIMUM, WIRE_PAGES);
    const session = randomBytes(32), state = transition(call, [1, 0, manifest, session]);
    if (!equal(state, [manifest, session, 0, false, false, [0], [0]])) throw fail('invalid-generated-output');
    const resources = new Map(), usedGuests = new Set(), usedSigners = new Set();
    for (const [resource, grant] of manifest[3]) {
      const [kind, value] = grant;
      if (kind === 0) {
        const matches = guests.filter(item => item.resource === resource);
        if (matches.length !== 1 || !same(await artifactDigest(matches[0].bytes), value[0])) throw fail('artifact-mismatch');
        usedGuests.add(matches[0]);
        try { inspectEffectModule(matches[0].bytes, value[5]); } catch { throw fail('invalid-generated-module'); }
        resources.set(resource, {call: interpreter(await WebAssembly.compile(matches[0].bytes), value[3], value[4], value[5])});
      } else if (kind === 3) {
        const matches = signers.filter(item => item.resource === resource);
        if (matches.length !== 1) throw fail('resource-mismatch');
        if (staged) {
          const bindings = credentialPublicBindings(matches[0].custody);
          const selected = bindings.resources.filter(row => row.resource === resource);
          if (!same(bindings.application, manifest[0]) || selected.length !== 1
            || !same(selected[0].publicKey, value[0]) || selected[0].context !== value[1]) throw fail('resource-mismatch');
          resources.set(resource, {custody: matches[0].custody});
        } else {
          const identity = await validateIdentity(matches[0].identity);
          if (!same(identity.publicKey, value[0])) throw fail('resource-mismatch');
          resources.set(resource, {identity, context: value[1]});
        }
        usedSigners.add(matches[0]);
      } else if (kind === 4) resources.set(resource, {publicKey: value[0], context: value[1]});
      else if (kind === 5) resources.set(resource, {storage: value});
      else resources.set(resource, {});
    }
    if (usedGuests.size !== guests.length || usedSigners.size !== signers.length) throw fail('resource-mismatch');
    // Validate all artifact/key/resource bindings before storage initialization.
    for (const [resource, adapter] of resources) if (adapter.storage) {
      const value = adapter.storage;
      const store = await openStore(value[0], {maxObjectBytes: value[1], maxObjects: value[2], maxHeads: value[3]});
      stores.push(store); resources.set(resource, {store});
    }
    const host = new Effects(call, state, resources, stores);
    if (contextual) return Object.freeze({context: host.context.bind(host), prepareExact: host.prepareExact.bind(host),
      close: host.close.bind(host), status: host.status.bind(host)});
    return Object.freeze({[staged ? 'prepare' : 'submit']: staged ? host.prepare.bind(host) : host.submit.bind(host),
      close: host.close.bind(host), status: host.status.bind(host)});
  } catch (error) {
    for (const store of stores) { try { store.close(); } catch { /* No effects have been dispatched. */ } }
    if (error instanceof EffectHostError) throw error;
    throw fail('host-unavailable');
  }
}

export async function openEffects(options) {
  if (arguments.length !== 1) throw fail('invalid-input');
  return openEffectsInternal(options, false);
}

// SDK-private journal composition only. Never export this interface or its
// one-shot release capability to a product. No caller completion is accepted.
export async function openStagedEffects(options) {
  if (arguments.length !== 1) throw fail('invalid-input');
  return openEffectsInternal(options, true);
}

// SDK-private source-session/journal composition. The observation is not a
// reservation or authority; only generated admission consumes its counter.
export async function openContextualStagedEffects(options) {
  if (arguments.length !== 1) throw fail('invalid-input');
  return openEffectsInternal(options, true, true);
}
