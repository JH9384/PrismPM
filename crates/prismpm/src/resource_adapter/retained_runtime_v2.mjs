// Private /2 ownership boundary. Source observations never imply destruction.
// The generated backend owns typed State; only its current source release grant
// authorizes release. This is neither a public exporter nor a backing provider.
export const retainedResourceProtocol = 'prismpm/private-resource-component/2';
const computeCodes = new Set(['AddOverflow', 'MulOverflow', 'ShiftExponentTooLarge',
  'ShiftOverflow', 'PowExponentTooLarge', 'PowOverflow', 'OutputTooSmall']);
const limitNames = ['maximumConfigBytes', 'maximumEventBytes', 'maximumObservationBytes', 'maximumSessions'];
const Bytes = Uint8Array;
const typed = Object.getPrototypeOf(Bytes.prototype);
const lengthOf = Object.getOwnPropertyDescriptor(typed, 'byteLength').get;
const bufferOf = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
const brandOf = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag).get;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const setBytes = Bytes.prototype.set;
const quarantined = new Set();
// A caller dropping its API object must not schedule guest-calling finalizers
// for still-owned generated resources. Explicit close or realm termination is
// required; abandonment can therefore retain memory indefinitely.
const retainedInstances = new Set();
export const privateRetainedQuarantinedOwnerCount = () => quarantined.size;
export const privateRetainedInstanceCount = () => retainedInstances.size;
class ProtocolError extends Error {}
class CopyError extends Error {}
const refusal = (code, ownership = 'unchanged') => ({kind: 'adapterError', code, ownership});

function snapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProtocolError();
  const keys = Reflect.ownKeys(value), result = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string') throw new ProtocolError();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new ProtocolError();
    result[key] = descriptor.value;
  }
  return result;
}
function record(value, fields) {
  const result = snapshot(value), keys = Object.keys(result);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw new ProtocolError();
  return result;
}
function byteLength(value) {
  if (brandOf.call(value) !== 'Uint8Array') throw new ProtocolError();
  try { bufferLength.call(bufferOf.call(value)); } catch { throw new ProtocolError(); }
  return lengthOf.call(value);
}
function copy(value) {
  try { const output = new Bytes(lengthOf.call(value)); setBytes.call(output, value); return output; }
  catch { throw new CopyError(); }
}

export function createRetainedResourceAdapter({backend, limits, retire}) {
  try { limits = record(limits, limitNames); }
  catch { throw new TypeError('Invalid private /2 resource configuration'); }
  if (backend?.protocol !== retainedResourceProtocol
    || !['init', 'advance', 'requestRelease', 'release'].every(key => typeof backend[key] === 'function')
    || typeof retire !== 'function'
    || !limitNames.every(key => Number.isSafeInteger(limits[key]) && limits[key] >= 0)
    || limits.maximumSessions === 0) throw new TypeError('Invalid private /2 resource configuration');
  limits = Object.freeze({...limits});
  const sessions = new WeakMap(), active = new Map(), resources = new Set();
  let busy = false, poisoned = false, closed = false, checkedFailure = false;
  let pending = null, inFlight = null, retirement = null;
  const custody = {backend, active, resources, get pending() { return pending; }, get inFlight() { return inFlight; }};
  retainedInstances.add(custody);

  async function retireOnce() {
    if (retirement !== null) return retirement;
    retirement = 'requested';
    try { await retire(); } catch { retirement = 'failed'; }
    return retirement;
  }
  async function fatal(code) {
    if (!poisoned) {
      poisoned = true;
      // Strong references prevent guest-calling finalizers being scheduled just
      // because the wrapper is collected. Actual realm termination is external.
      quarantined.add(custody); retainedInstances.delete(custody);
      for (const entry of active.values()) entry.status = 'poisoned';
    }
    return {kind: 'fatal', code, ownership: 'unknown', retirement: await retireOnce()};
  }
  function available(mode) {
    if (poisoned) return refusal('InstancePoisoned', 'unknown');
    if (closed) return refusal('InstanceClosed', 'released');
    if (busy) return refusal('ConcurrentCall');
    if (mode !== 'abandon' && checkedFailure) return refusal('ComputeFailureHeld', 'retained');
    if (mode !== 'abandon' && mode !== 'retry' && pending) return refusal('ObservationPending', 'retained');
    return null;
  }
  async function guarded(mode, action) {
    const denied = available(mode); if (denied) return denied;
    busy = true;
    try { return await action(); }
    catch (error) {
      return fatal(error instanceof ProtocolError ? 'BackendProtocol'
        : error instanceof WebAssembly.RuntimeError ? 'BackendTrap' : 'BackendException');
    } finally { busy = false; }
  }
  function lookup(session) {
    const entry = sessions.get(session);
    if (!entry) return refusal('ForeignSession');
    if (entry.status !== 'active') return refusal('StaleSession', 'released');
    return entry;
  }
  function checked(result) {
    result = record(result, ['kind', 'code']);
    if (result.kind !== 'computeError' || !computeCodes.has(result.code)) throw new ProtocolError();
    // Known pre-call ownership is retained. Hidden intermediate ownership/peak
    // is unknown; never call source release using a potentially stale state.
    checkedFailure = true;
    return {kind: 'computeError', code: result.code, ownership: 'retained', recovery: 'blocked'};
  }
  async function deliver() {
    const held = pending;
    let observation;
    try {
      if (byteLength(held.observation) > limits.maximumObservationBytes) {
        return {...refusal('ObservationLimit', 'retained'), session: held.session};
      }
      observation = copy(held.observation);
    } catch (error) {
      if (!(error instanceof CopyError)) throw error;
      return {...refusal('AdapterAllocation', 'retained'), session: held.session};
    }
    if (held.operation === 'releaseAuthorized') {
      // The exact grant is retained during copy refusal; retry copies it and
      // releases once without replaying the source authorization call.
      inFlight = held.entry.resource;
      try { if (await backend.release(held.entry.resource) !== undefined) return fatal('BackendProtocol'); }
      catch { return fatal('ReleaseFailure'); }
      held.entry.status = 'released';
      active.delete(held.session); resources.delete(held.entry.resource);
      held.entry.resource = null; inFlight = null; pending = null;
      return {kind: 'released', observation};
    }
    pending = null; inFlight = null;
    return held.operation === 'ready'
      ? {kind: 'ready', session: held.session, observation}
      : {kind: 'retained', observation};
  }
  function hold(session, entry, operation, observation) {
    // Validate before copying; malformed output poisons instead of discarding
    // the successor state or inventing a successful acknowledgment.
    byteLength(observation);
    pending = {session, entry, operation, observation};
    inFlight = null;
    return deliver();
  }
  async function invoke(session, event, releasing) {
    const entry = lookup(session); if (entry.kind === 'adapterError') return entry;
    let input;
    if (!releasing) {
      try {
        if (byteLength(event) > limits.maximumEventBytes) return refusal('EventLimit');
        input = copy(event);
      } catch (error) { return refusal(error instanceof CopyError ? 'AdapterAllocation' : 'InvalidInput'); }
    }
    inFlight = releasing ? await backend.requestRelease(entry.resource) : await backend.advance(entry.resource, input);
    const captured = snapshot(inFlight);
    if (captured.kind === 'computeError') return checked(captured);
    if (captured.kind === 'resourceRefusal') {
      record(captured, ['kind']); inFlight = null;
      // This tag is admitted only before a generated call/state change, as
      // established by the generated facade's source-bound input-copy path.
      return refusal('ResourceRefusal');
    }
    const result = record(captured, ['kind', 'observation']);
    if (result.kind !== 'retained' && !(releasing && result.kind === 'releaseAuthorized')) throw new ProtocolError();
    return hold(session, entry, result.kind, result.observation);
  }
  return Object.freeze({
    init(config) {
      return guarded('normal', async () => {
        let input;
        try {
          if (byteLength(config) > limits.maximumConfigBytes) return refusal('ConfigLimit');
          input = copy(config);
        } catch (error) { return refusal(error instanceof CopyError ? 'AdapterAllocation' : 'InvalidInput'); }
        if (active.size >= limits.maximumSessions) return refusal('SessionLimit');
        inFlight = await backend.init(input);
        const captured = snapshot(inFlight);
        if (captured.kind === 'computeError') return checked(captured);
        if (captured.kind === 'resourceRefusal') {
          record(captured, ['kind']); inFlight = null; return refusal('ResourceRefusal');
        }
        const result = record(captured, ['kind', 'resource', 'observation']);
        if (result.kind !== 'ready' || !result.resource || typeof result.resource !== 'object'
          || resources.has(result.resource)) throw new ProtocolError();
        const session = Object.freeze(Object.create(null)), entry = {resource: result.resource, status: 'active'};
        sessions.set(session, entry); active.set(session, entry); resources.add(result.resource);
        return hold(session, entry, 'ready', result.observation);
      });
    },
    advance(session, event) { return guarded('normal', () => invoke(session, event, false)); },
    requestRelease(session) { return guarded('normal', () => invoke(session, undefined, true)); },
    retryObservation(session) {
      return guarded('retry', () => {
        const entry = lookup(session); if (entry.kind === 'adapterError') return entry;
        if (!pending || pending.session !== session) return refusal('NoPendingObservation');
        return deliver();
      });
    },
    close() {
      return guarded('normal', async () => {
        if (active.size !== 0) return refusal('OwnersRetained', 'retained');
        closed = true;
        const outcome = await retireOnce();
        if (outcome === 'failed') return fatal('RetirementFailure');
        retainedInstances.delete(custody);
        return {kind: 'closed', retirement: outcome};
      });
    },
    // Refuses while busy. Forced termination/hang recovery requires the external
    // realm owner; this component never claims it can cancel an in-flight call.
    abandon() { return guarded('abandon', () => fatal('Abandoned')); }
  });
}
