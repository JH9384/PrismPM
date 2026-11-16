// Private resource ownership component, version 1. No public exporter profile.
// Application transitions and encoded diagnostics belong to the source backend.
// The sole owner must retire the entire Wasm instance after an unknown outcome.
const computeCodes = new Set(['AddOverflow', 'MulOverflow', 'ShiftExponentTooLarge',
  'ShiftOverflow', 'PowExponentTooLarge', 'PowOverflow', 'OutputTooSmall']);
const limitNames = ['maximumConfigBytes', 'maximumChunkBytes', 'maximumOutputBytes',
  'maximumDiagnosticBytes', 'maximumSummaryBytes', 'maximumSessions'];
const ByteArray = Uint8Array;
const typedArray = Object.getPrototypeOf(ByteArray.prototype);
const actualByteLength = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
const actualBuffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;
const actualElementType = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag).get;
const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const setBytes = ByteArray.prototype.set;
// wasm-bindgen classes can have automatic guest-calling finalizers. Retain
// known objects even if the poisoned runtime itself is collected. The dedicated
// owner must terminate this entire realm; failed retirement retains memory.
const poisonedOwners = new Set();
/** Test-only observation of this private component; no raw objects escape. */
export const privateQuarantinedOwnerCount = () => poisonedOwners.size;
class ProtocolViolation extends Error {}
class CopyRefusal extends Error {}

const adapterError = (code, ownership = 'unchanged') => ({kind: 'adapterError', code, ownership});
function snapshot(value) {
  const names = value !== null && typeof value === 'object' ? Reflect.ownKeys(value) : [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || names.some(name => typeof name !== 'string')) throw new ProtocolViolation();
  const record = Object.create(null);
  for (const name of names) {
    const field = Object.getOwnPropertyDescriptor(value, name);
    if (!field || !Object.hasOwn(field, 'value')) throw new ProtocolViolation();
    record[name] = field.value;
  }
  return record;
}
function shape(value, fields) {
  const actual = Reflect.ownKeys(value).sort(), expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((name, i) => name !== expected[i])) {
    throw new ProtocolViolation();
  }
}
function byteLength(bytes) {
  if (actualElementType.call(bytes) !== 'Uint8Array') throw new ProtocolViolation();
  try {
    // The intrinsic ArrayBuffer getter rejects SharedArrayBuffer in every
    // realm. Prototypes/instanceof do not establish either storage brand.
    arrayBufferLength.call(actualBuffer.call(bytes));
  } catch {
    throw new ProtocolViolation();
  }
  return actualByteLength.call(bytes);
}
function copy(bytes) {
  // This catches only the adapter copy. Core/engine/process OOM recovery is not
  // established by catching an exception here, and may terminate execution.
  try {
    // TypedArray.slice consults user-controlled Symbol.species. An intrinsic
    // destination and set bypass species and shadowed byteLength/buffer fields.
    const result = new ByteArray(actualByteLength.call(bytes));
    setBytes.call(result, bytes); return result;
  }
  catch { throw new CopyRefusal(); }
}

/** Private host boundary for one exclusively owned generated Wasm instance. */
export function createResourceAdapter({backend, limits, retire}) {
  try { limits = snapshot(limits); shape(limits, limitNames); }
  catch { throw new TypeError('Invalid private resource configuration'); }
  if (!backend || !['init', 'step', 'release'].every(name => typeof backend[name] === 'function')
    || typeof retire !== 'function'
    || !limitNames.every(name => Number.isSafeInteger(limits[name]) && limits[name] >= 0)
    || limits.maximumSessions === 0) throw new TypeError('Invalid private resource configuration');
  limits = Object.freeze({...limits});
  const sessions = new WeakMap(), active = new Map(), resources = new Set();
  let busy = false, poisoned = false, closed = false, retirementOutcome = null, inFlight = null;

  async function requestRetirement() {
    if (retirementOutcome !== null) return retirementOutcome;
    retirementOutcome = 'requested';
    try { await retire(); return 'requested'; }
    catch { retirementOutcome = 'failed'; return retirementOutcome; }
  }
  async function fatal(code) {
    poisoned = true;
    // Do not prompt automatic finalization by clearing known resource refs.
    // Unknown/unreturned init temporaries still require actual realm termination.
    poisonedOwners.add({backend, active, resources, inFlight});
    for (const entry of active.values()) entry.status = 'poisoned';
    backend = null; inFlight = null;
    return {kind: 'fatal', code, ownership: 'unknown', retirement: await requestRetirement()};
  }
  function available() {
    if (poisoned) return adapterError('InstancePoisoned', 'unknown');
    if (closed) return adapterError('InstanceClosed', 'released');
    if (busy) return adapterError('ConcurrentCall');
    return null;
  }
  async function guarded(run) {
    const refusal = available(); if (refusal) return refusal;
    busy = true;
    try { return await run(); }
    catch (error) {
      return fatal(error instanceof ProtocolViolation ? 'BackendProtocol'
        : error instanceof WebAssembly.RuntimeError ? 'BackendTrap' : 'BackendException');
    } finally { busy = false; }
  }
  function lookup(session) {
    const entry = sessions.get(session);
    if (!entry) return adapterError('ForeignSession');
    if (entry.status !== 'active') return adapterError('StaleSession', 'released');
    return entry;
  }
  async function finish(session, entry, result) {
    const resource = entry.resource;
    inFlight = resource;
    entry.resource = null; entry.status = 'released';
    active.delete(session); resources.delete(resource);
    try {
      if (await backend.release(resource) !== undefined) return fatal('BackendProtocol');
    }
    catch { return fatal('ReleaseFailure'); }
    inFlight = null;
    return result;
  }
  function compute(result) {
    shape(result, ['kind', 'code']);
    if (!computeCodes.has(result.code)) throw new ProtocolViolation();
    return {kind: 'computeError', code: result.code};
  }
  function failure(result, cancelled = false) {
    shape(result, ['kind', 'error', 'disposition']);
    if (byteLength(result.error) > limits.maximumDiagnosticBytes
      || byteLength(result.disposition) > limits.maximumDiagnosticBytes) return adapterError('DiagnosticLimit');
    return {kind: cancelled ? 'cancelled' : 'modeledError', error: copy(result.error),
      sourceDisposition: copy(result.disposition)};
  }

  return Object.freeze({
    init(config) {
      return guarded(async () => {
        try { if (byteLength(config) > limits.maximumConfigBytes) return adapterError('ConfigLimit'); }
        catch { return adapterError('InvalidInput'); }
        if (active.size >= limits.maximumSessions) return adapterError('SessionLimit');
        let input;
        try { input = copy(config); } catch { return adapterError('AdapterAllocation'); }
        inFlight = await backend.init(input);
        const result = snapshot(inFlight);
        if (result?.kind === 'computeError') {
          const reply = compute(result); inFlight = null; return reply;
        }
        if (result?.kind === 'failed') {
          try { const reply = failure(result); inFlight = null; return reply; }
          catch (error) {
            if (error instanceof CopyRefusal) { inFlight = null; return adapterError('AdapterAllocation'); }
            throw error;
          }
        }
        if (result?.kind === 'resourceRefusal') {
          shape(result, ['kind']); inFlight = null; return adapterError('ResourceRefusal');
        }
        // Preserve a known ready candidate even when a later protocol check
        // fails before it can be adopted into the session map.
        if (result.resource !== null && typeof result.resource === 'object') inFlight = result.resource;
        shape(result, ['kind', 'resource']);
        if (result.kind !== 'ready' || result.resource === null || typeof result.resource !== 'object'
          || resources.has(result.resource)) throw new ProtocolViolation();
        // Tokens are never reused and have no wrapping numeric generation.
        const session = Object.freeze(Object.create(null));
        const entry = {resource: result.resource, status: 'active', demand: false, eof: false};
        sessions.set(session, entry); active.set(session, entry); resources.add(result.resource);
        inFlight = null;
        return {kind: 'ready', session};
      });
    },
    step(session, event) {
      return guarded(async () => {
        const entry = lookup(session); if (entry.kind === 'adapterError') return entry;
        let input;
        try {
          event = snapshot(event);
          if (event?.kind === 'chunk') {
            shape(event, ['kind', 'bytes']);
            if (byteLength(event.bytes) > limits.maximumChunkBytes) return adapterError('ChunkLimit');
            input = {kind: 'chunk', bytes: copy(event.bytes)};
          } else {
            shape(event, ['kind']);
            if (!['tick', 'endOfInput', 'cancel'].includes(event.kind)) return adapterError('InvalidInput');
            input = {kind: event.kind};
          }
        } catch (error) { return adapterError(error instanceof CopyRefusal ? 'AdapterAllocation' : 'InvalidInput'); }
        if (['chunk', 'endOfInput'].includes(input.kind) && (!entry.demand || entry.eof)) return adapterError('InvalidPhase');
        if (input.kind === 'endOfInput') entry.eof = true;
        // Retain even an unadoptable returned record before inspecting it.
        inFlight = await backend.step(entry.resource, input);
        const result = snapshot(inFlight);
        // Only safe, tagged outcomes permit per-resource destruction.
        if (result?.kind === 'computeError') return finish(session, entry, compute(result));
        if (result?.kind === 'resourceRefusal') {
          shape(result, ['kind']); return finish(session, entry, adapterError('ResourceRefusal', 'released'));
        }
        if (result?.kind === 'failed') {
          let reply;
          try { reply = failure(result, input.kind === 'cancel'); }
          catch (error) { if (!(error instanceof CopyRefusal)) throw error; reply = adapterError('AdapterAllocation'); }
          if (reply.kind === 'adapterError') reply.ownership = 'released';
          return finish(session, entry, reply);
        }
        if (input.kind === 'cancel') throw new ProtocolViolation();
        if (result?.kind === 'complete') {
          shape(result, ['kind', 'summary']);
          if (!entry.eof) throw new ProtocolViolation();
          let reply;
          if (byteLength(result.summary) > limits.maximumSummaryBytes) reply = adapterError('SummaryLimit', 'released');
          else {
            try { reply = {kind: 'complete', summary: copy(result.summary)}; }
            catch (error) { if (!(error instanceof CopyRefusal)) throw error; reply = adapterError('AdapterAllocation', 'released'); }
          }
          return finish(session, entry, reply);
        }
        if (result?.kind === 'output') {
          shape(result, ['kind', 'bytes']);
          if (byteLength(result.bytes) > limits.maximumOutputBytes) return finish(session, entry, adapterError('OutputLimit', 'released'));
          let bytes;
          try { bytes = copy(result.bytes); }
          catch (error) {
            if (!(error instanceof CopyRefusal)) throw error;
            return finish(session, entry, adapterError('AdapterAllocation', 'released'));
          }
          entry.demand = false; inFlight = null; return {kind: 'output', bytes};
        }
        shape(result, ['kind']);
        if (!['needInput', 'advanced'].includes(result.kind) || (result.kind === 'needInput' && entry.eof)) throw new ProtocolViolation();
        entry.demand = result.kind === 'needInput';
        inFlight = null;
        return {kind: result.kind};
      });
    },
    release(session) {
      return guarded(async () => {
        const entry = lookup(session); if (entry.kind === 'adapterError') return entry;
        return finish(session, entry, {kind: 'released'});
      });
    },
    close() {
      return guarded(async () => {
        for (const [session, entry] of active) {
          const result = await finish(session, entry, {kind: 'released'});
          if (result.kind === 'fatal') return result;
        }
        closed = true; backend = null;
        const retirement = await requestRetirement();
        return retirement === 'failed' ? fatal('RetirementFailure')
          : {kind: 'closed'};
      });
    }
  });
}
