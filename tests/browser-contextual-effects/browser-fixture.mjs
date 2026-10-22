// Owning tests only: actual generated artifacts, WebCrypto and IndexedDB.
const check = (condition, message) => { if (!condition) throw Error(message); };
const hex = bytes => {
  const parts = [];
  for (let at = 0; at < bytes.length; at += 4096) parts.push(Array.from(bytes.subarray(at, at + 4096), byte => byte.toString(16).padStart(2, '0')).join(''));
  return parts.join('');
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const observed = promise => promise.then(value => ({value}), error => ({error}));
const later = () => new Promise(resolve => setTimeout(resolve, 0));
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('bounded contextual fixture timeout')), 30000); })]); }
  finally { clearTimeout(timer); }
}
async function rejects(action, code, detail) {
  let error;
  try { await (typeof action === 'function' ? action() : action); } catch (caught) { error = caught; }
  check(error?.code === code, 'expected contextual ' + code + ', got ' + error?.code);
  if (detail !== undefined) check(error.detail === detail, 'expected contextual detail ' + detail + ', got ' + error.detail);
  check(error.cause === undefined, 'no user data in contextual error cause');
  return error;
}

// Lossless transport of observed generated frames, not a replacement oracle.
// Large synthetic byte strings use bounded runs. Every restored frame must
// match its actual browser byte length and SHA-256 before native replay.
function pack(value) {
  if (value instanceof Uint8Array) {
    if (value.length <= 65536) return {hex: hex(value)};
    const runs = [];
    for (let at = 0; at < value.length;) {
      let end = at + 1; while (end < value.length && value[end] === value[at]) end++;
      runs.push([end - at, value[at]]); at = end;
      check(runs.length <= 64, 'closed synthetic maximum run budget');
    }
    return {runs, length: value.length};
  }
  if (Array.isArray(value)) return value.map(pack);
  check(typeof value === 'string' || typeof value === 'boolean' || Number.isSafeInteger(value), 'closed observed frame scalar');
  return value;
}

export async function runFixture(input) {
  const {openContextualStagedEffects: open, openStagedEffects} = await import('./effects.mjs');
  const {encodeEffectWire: encode, decodeEffectWire: decode} = await import('./effects-wire.mjs');
  const {openCredentialCustody, credentialPublicBindings, closeCredentialCustody} = await import('./credential-custody.mjs');
  const {openStore} = await import('./store.mjs');
  const same = (left, right) => hex(encode(left)) === hex(encode(right));
  const artifacts = Object.fromEntries(Object.entries(input.artifacts).map(([name, bytes]) => [name, new Uint8Array(bytes)]));
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle), originalSign = crypto.subtle.sign.bind(crypto.subtle);
  const originalVerify = crypto.subtle.verify.bind(crypto.subtle), originalRandom = crypto.getRandomValues.bind(crypto);
  const digest = async bytes => new Uint8Array(await originalDigest('SHA-256', bytes));
  const references = Object.fromEntries(await Promise.all(Object.entries(artifacts).map(async ([name, bytes]) => [name, await digest(bytes)])));
  const originalCompile = WebAssembly.compile, NativeInstance = WebAssembly.Instance;
  const modules = new WeakMap(), calls = [], pending = [], maximum = {}, cases = [];
  const primitives = {guest: 0, random: 0, digest: 0, sign: 0, verify: 0, store: 0};
  const hosts = [], custodies = [], stores = [], barriers = [];
  const artifactRoles = new Map(Object.entries(artifacts).map(([name, bytes]) => [hex(bytes), name]));
  WebAssembly.compile = async function(bytes) {
    const captured = new Uint8Array(bytes).slice(), role = artifactRoles.get(hex(captured));
    check(role, 'every compiled module is the actual captured generated artifact');
    const module = await Reflect.apply(originalCompile, WebAssembly, [captured]); modules.set(module, role); return module;
  };
  WebAssembly.Instance = class {
    constructor(module, imports) {
      const role = modules.get(module); check(role, 'observed instance binds captured generated module');
      const actual = new NativeInstance(module, imports), exports = {...actual.exports};
      exports.holo_run = (pointer, length) => {
        const request = new Uint8Array(exports.memory.buffer, pointer, length).slice();
        if (role === 'Guest') primitives.guest++;
        const result = BigInt.asUintN(64, actual.exports.holo_run(pointer, length));
        const at = Number(result >> 32n), size = Number(result & 0xffffffffn);
        const response = new Uint8Array(exports.memory.buffer, at, size).slice();
        maximum[role] = Math.max(maximum[role] ?? 0, exports.memory.buffer.byteLength);
        const row = {role}; calls.push(row);
        pending.push(Promise.all([request, response].map(async bytes => ({length: bytes.length,
          sha256: hex(await digest(bytes)), value: pack(role === 'Guest' ? bytes : decode(bytes))})))
          .then(([request, response]) => Object.assign(row, {request, response})));
        return result;
      };
      return {exports};
    }
  };
  crypto.getRandomValues = value => { primitives.random++; return originalRandom(value); };
  crypto.subtle.digest = (...args) => { primitives.digest++; return originalDigest(...args); };
  crypto.subtle.sign = (...args) => { primitives.sign++; return originalSign(...args); };
  crypto.subtle.verify = (...args) => { primitives.verify++; return originalVerify(...args); };
  const originalTransaction = IDBDatabase.prototype.transaction;
  let fault;
  IDBDatabase.prototype.transaction = function(...args) {
    const real = Reflect.apply(originalTransaction, this, args), name = this.name;
    const names = typeof args[0] === 'string' ? [args[0]] : [...args[0]];
    if (names.includes('objects') && names.includes('heads')) primitives.store++;
    if (fault?.database !== name || args[1] !== 'readwrite' || !names.includes('heads')) return real;
    let aborted, lost = false;
    return new Proxy(real, {
      get(target, key) {
        if (key === 'error' && lost) return new DOMException('Lost acknowledgment', 'UnknownError');
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) {
        if (key === 'onabort') aborted = value;
        if (key !== 'oncomplete') return Reflect.set(target, key, value, target);
        return Reflect.set(target, key, event => {
          const selected = fault;
          if (!selected || selected.database !== name || selected.used) return value.call(target, event);
          selected.used = true; selected.entered.resolve();
          void selected.release.promise.then(() => {
            if (selected.unknown) { lost = true; aborted.call(target, event); }
            else value.call(target, event);
          });
        }, target);
      },
    });
  };
  const arm = (namespace, unknown) => {
    fault = {database: 'prismpm.browser.v1/' + namespace, unknown, used: false, entered: deferred(), release: deferred()};
    barriers.push(fault.release); return fault;
  };
  const context = 'contextual-effect/1', entry = 'PrismPM.Fixture.fixtureEchoBytes';
  const text = value => new TextEncoder().encode(value);
  const invoke = value => ['guest', [0, [references.Guest.slice(), entry, context, value]]];
  const request = (host, intent, observedContext = host.context()) => encode([observedContext.application,
    observedContext.manifest, observedContext.session, observedContext.nextOperation, ...intent]);
  const keep = async promise => { const host = await promise; hosts.push(host); return host; };
  async function setup(signMaximum = 1048576) {
    const application = originalRandom(new Uint8Array(32)), policyId = originalRandom(new Uint8Array(32));
    const policy = [application, policyId, ['primary'], [['sign', 'primary', context, signMaximum]]];
    const custody = await openCredentialCustody({wire: artifacts.Custody, wireDigest: references.Custody,
      policy: encode(policy), mode: 'initialize'});
    custodies.push(custody); const key = credentialPublicBindings(custody).resources[0].publicKey;
    const namespace = 'contextual-' + crypto.randomUUID();
    const manifest = [application, originalRandom(new Uint8Array(32)), [67108864, 67108864, 16384], [
      ['guest', [0, [references.Guest, entry, context, 2097151, 2097152, 256]]],
      ['random', [1]], ['digest', [2]], ['sign', [3, [key, context]]],
      ['verify', [4, [key, context]]], ['store', [5, [namespace, 1048576, 4096, 64]]],
    ]];
    const options = () => ({wire: artifacts.Effects.slice(), wireDigest: references.Effects.slice(), manifest: encode(manifest),
      guests: [{resource: 'guest', bytes: artifacts.Guest.slice()}], signers: [{resource: 'sign', custody}]});
    const readStore = async () => { const store = await openStore(namespace); stores.push(store); return store; };
    return {manifest, namespace, custody, options, readStore, open: () => keep(open(options()))};
  }
  async function execute(host, intent) {
    const bytes = request(host, intent), captured = decode(bytes), before = {...primitives};
    const token = host.prepareExact(bytes);
    check(Object.isFrozen(token) && Object.keys(token).sort().join(',') === 'release,request', 'closed exact staged token');
    check(hex(token.request) === hex(bytes), 'prepared bytes exactly preserve the admitted request');
    await later(); check(JSON.stringify(primitives) === JSON.stringify(before), 'no primitive before private release');
    const completion = decode(await bounded(token.release()));
    check(same(completion[0], captured), 'completion is bound to the original actual request');
    check(host.status().pending === 0, 'completed operation leaves no waiter');
    await rejects(token.release(), 'invalid-input');
    return completion[1];
  }
  async function run(name, body) {
    if (input.only && input.only !== name) return;
    await body(); cases.push(name);
  }
  try {
    await run('closed-api-context-and-detached-copies', async () => {
      const f = await setup(), supplied = f.options(), opening = keep(open(supplied));
      supplied.wire.fill(0); supplied.wireDigest.fill(0); supplied.manifest.fill(0); supplied.guests[0].bytes.fill(0);
      supplied.guests.length = 0; supplied.signers.length = 0;
      const host = await opening;
      check(Object.isFrozen(host) && Object.keys(host).sort().join(',') === 'close,context,prepareExact,status', 'closed contextual API');
      const original = host.context();
      check(Object.isFrozen(original) && Object.keys(original).sort().join(',') === 'application,manifest,nextOperation,session', 'closed copied context');
      check(original.nextOperation === 0 && same(original.application, f.manifest[0]) && same(original.manifest, f.manifest[1]), 'actual initial context');
      check(original.session.length === 32, 'host-owned complete session');
      original.application.fill(0); original.manifest.fill(0); original.session.fill(0);
      const captured = request(host, invoke(text('capture'))), expected = decode(captured), token = host.prepareExact(captured);
      const observedRequest = token.request;
      captured.fill(0); observedRequest.fill(0);
      structuredClone(captured, {transfer: [captured.buffer]});
      const released = await observed(token.release());
      check(!released.error, 'private completion ignores changed returned/caller request copies');
      const done = decode(released.value);
      check(same(done[0], expected) && same(done[1], [0, Uint8Array.of(0x7b, ...text('capture'))]), 'private completion ignores changed returned/caller request copies');
      const after = host.context(); after.session.fill(0);
      check(host.context().session.some(byte => byte !== 0), 'context never lends internal session bytes');
      for (const method of ['context', 'close', 'status']) await rejects(() => host[method](0), 'invalid-input');
      await rejects(() => host.prepareExact(), 'invalid-input');
      await rejects(() => host.prepareExact(request(host, ['random', [1, 1]]), 0), 'invalid-input');
      await rejects(open(f.options(), 0), 'invalid-input');
    });
    await run('all-eight-real-effect-families', async () => {
      const f = await setup(), host = await f.open(), value = text('abc');
      check(same(await execute(host, invoke(value)), [0, Uint8Array.of(0x7b, ...value)]), 'real generated guest completion');
      const random = await execute(host, ['random', [1, 32]]); check(random[0] === 1 && random[1].length === 32, 'real bounded randomness');
      const hash = 'sha256:' + hex(await digest(value));
      check(same(await execute(host, ['digest', [2, value]]), [2, hash]), 'real SHA256 completion');
      const signature = await execute(host, ['sign', [3, value]]); check(signature[0] === 3 && signature[1].length === 64, 'opaque modeled custody signature');
      check(same(await execute(host, ['verify', [4, [value, signature[1]]]]), [4, true]), 'actual signature verification');
      check(same(await execute(host, ['store', [7, ['primary', [0], hash, [value]]]]), [7, hash]), 'actual atomic commit');
      check(same(await execute(host, ['store', [5, hash]]), [5, [1, value]]), 'actual stored object');
      check(same(await execute(host, ['store', [6, 'primary']]), [6, [1, [hash, value]]]), 'actual stored head');
      check(host.context().nextOperation === 8, 'eight actual consumed operations');
    });
    await run('exact-field-and-canonical-refusals', async () => {
      const f = await setup(), host = await f.open(), good = request(host, ['random', [1, 1]]);
      for (const [index, detail] of [[0, 6], [1, 7], [2, 8], [3, 9]]) {
        const changed = decode(good); if (index === 3) changed[index]++; else changed[index][0] ^= 1;
        const before = {...primitives}, state = host.status();
        await rejects(() => host.prepareExact(encode(changed)), 'model-rejected', detail);
        check(JSON.stringify(primitives) === JSON.stringify(before) && JSON.stringify(host.status()) === JSON.stringify(state), 'mismatched exact request neither repairs nor consumes');
      }
      const unknown = decode(good); unknown[4] = 'absent';
      await rejects(() => host.prepareExact(encode(unknown)), 'model-rejected', 10);
      const wrongKind = decode(good); wrongKind[5] = [2, text('a')];
      await rejects(() => host.prepareExact(encode(wrongKind)), 'model-rejected', 11);
      for (const count of [0xfffffffe, 0xffffffff]) {
        const changed = decode(good); changed[3] = count;
        await rejects(() => host.prepareExact(encode(changed)), 'model-rejected', 9);
      }
      const noncanonical = Uint8Array.of(0x98, 6, ...good.subarray(1));
      const extra = decode(good); extra.push(0);
      const missing = decode(good); missing.pop();
      const detached = good.slice(); structuredClone(detached, {transfer:[detached.buffer]});
      for (const value of [encode(['random', [1, 1]]), encode(extra), encode(missing), Uint8Array.of(...good, 0),
        noncanonical, good.subarray(0, good.length - 1), detached, {}, new ArrayBuffer(8)])
        await rejects(() => host.prepareExact(value), 'invalid-input');
      check(host.status().nextOperation === 0 && host.status().pending === 0, 'refused requests never reserve a counter');
      await execute(host, ['random', [1, 1]]);
      await rejects(() => host.prepareExact(good), 'model-rejected', 9);
    });
    await run('active-waiter-stale-and-one-shot', async () => {
      const host = await (await setup()).open(), initial = host.context();
      const a = host.prepareExact(request(host, invoke(text('A')), initial));
      await rejects(() => host.prepareExact(request(host, invoke(text('stale')), initial)), 'model-rejected', 9);
      const b = host.prepareExact(request(host, invoke(text('B')))), after = host.context();
      const callsBefore = primitives.guest;
      await rejects(() => host.prepareExact(request(host, invoke(text('full')))), 'model-rejected', 4);
      check(same(after.session, host.context().session) && after.nextOperation === host.context().nextOperation, 'busy admission does not advance');
      const waiter = observed(b.release()); await later();
      check(primitives.guest === callsBefore, 'released waiter cannot bypass unreleased active exact request');
      const duplicate = await Promise.race([observed(b.release()), later().then(() => ({pending:true}))]);
      check(duplicate.error?.code === 'invalid-input', 'duplicate exact release must refuse immediately');
      const first = decode(await a.release()), second = await bounded(waiter);
      check(!second.error && same(first[1], [0, text('{A')]) && same(decode(second.value)[1], [0, text('{B')]), 'exact queue preserves active then waiter');
      check(host.status().pending === 0 && host.context().nextOperation === 2, 'exactly two admissions');
      const c = host.prepareExact(request(host, ['random', [1, 1]]));
      await rejects(c.release('fake completion'), 'invalid-input'); await c.release();
      await rejects(c.release(), 'invalid-input');
    });
    await run('cross-host-and-reopened-context-refusal', async () => {
      const f = await setup(), a = await f.open(), b = await f.open();
      const old = request(a, ['random', [1, 1]]), current = request(b, ['random', [1, 1]]);
      check(!same(a.context().session, b.context().session), 'independently host-generated sessions');
      await rejects(() => b.prepareExact(old), 'model-rejected', 8);
      await rejects(() => a.prepareExact(current), 'model-rejected', 8);
      await a.prepareExact(old).release(); a.close();
      const reopened = await f.open();
      await rejects(() => reopened.prepareExact(old), 'model-rejected', 8);
      await rejects(() => reopened.prepareExact(current), 'model-rejected', 8);
      await rejects(() => a.context(), 'host-closed');
      await rejects(() => a.prepareExact(old), 'host-closed');
    });
    await run('source-custody-bound-before-admission', async () => {
      for (const maximum of [1, 3, 65536, 1048576]) {
        const f = await setup(maximum), host = await f.open();
        const value = new Uint8Array(maximum + 1);
        const result = await execute(host, ['sign', [3, value.subarray(0, maximum)]]);
        check(result[0] === 3 && result[1].length === 64, 'exact source-selected custody bound signs');
        const before = {...primitives}, counter = host.status().nextOperation;
        await rejects(() => host.prepareExact(request(host, ['sign', [3, value]])), 'host-unavailable');
        check(host.status().closed && host.status().nextOperation === counter && host.status().pending === 0
          && primitives.sign === before.sign, 'modeled custody denial precedes exact admission and signing');
      }
    });
    await run('known-rejection-captured-completion', async () => {
      const f = await setup(), host = await f.open(), value = text('retained'), id = 'sha256:' + hex(await digest(value));
      await execute(host, ['store', [7, ['primary', [0], id, [value]]]]);
      check(same(await execute(host, ['store', [7, ['primary', [0], id, [value]]]]), [8, [3]]), 'real conflicting commit yields bound rejected result');
      check(host.context().nextOperation === 2, 'known refusal consumes only its own operation');
    });
    await run('close-before-release-and-active-ack', async () => {
      const f = await setup(), host = await f.open(), token = host.prepareExact(request(host, invoke(text('unreleased'))));
      const before = primitives.guest; host.close();
      await rejects(token.release(), 'host-closed'); check(primitives.guest === before, 'close cannot release an unexecuted primitive');
      const active = await f.open(), value = text('close-after-write'), id = 'sha256:' + hex(await digest(value));
      const barrier = arm(f.namespace, false), pending = observed(active.prepareExact(request(active, ['store', [7, ['primary', [0], id, [value]]]])).release());
      await bounded(barrier.entered.promise); active.close(); barrier.release.resolve();
      const result = await bounded(pending); check(result.error?.code === 'effect-outcome-unknown', 'close after real commit cannot invent terminal success');
      check(same((await (await f.readStore()).readHead('primary')).bytes, value), 'actual committed bytes survive close');
      await rejects(() => active.context(), 'host-closed'); fault = null;
    });
    await run('unknown-commit-blocks-context-and-waiter', async () => {
      const f = await setup(), host = await f.open(), value = text('unknown-after-write'), id = 'sha256:' + hex(await digest(value));
      const first = host.prepareExact(request(host, ['store', [7, ['primary', [0], id, [value]]]]));
      const waiter = host.prepareExact(request(host, invoke(text('never')))), before = primitives.guest;
      const barrier = arm(f.namespace, true), waiting = observed(waiter.release()), pending = observed(first.release());
      await bounded(barrier.entered.promise); barrier.release.resolve();
      check((await bounded(pending)).error?.code === 'effect-outcome-unknown', 'lost real acknowledgment is unknown');
      check((await bounded(waiting)).error?.code === 'effect-outcome-unknown' && primitives.guest === before, 'unknown retains waiter without execution');
      check(host.status().uncertain && host.status().pending === 2, 'unknown retains both captured operations');
      await rejects(() => host.context(), 'effect-outcome-unknown');
      check(same((await (await f.readStore()).readHead('primary')).bytes, value), 'uncertain acknowledgment does not imply rollback'); fault = null;
    });
    await run('unknown-late-waiter-release', async () => {
      const f = await setup(), host = await f.open(), value = text('late-waiter'), id = 'sha256:' + hex(await digest(value));
      const first = host.prepareExact(request(host, ['store', [7, ['primary', [0], id, [value]]]]));
      const waiter = host.prepareExact(request(host, invoke(text('never-late')))), before = primitives.guest;
      const barrier = arm(f.namespace, true), pending = observed(first.release());
      await bounded(barrier.entered.promise); barrier.release.resolve();
      check((await bounded(pending)).error?.code === 'effect-outcome-unknown', 'active lost acknowledgment remains unknown');
      check(!host.status().closed && host.status().uncertain, 'live uncertain host is not closed');
      await rejects(waiter.release(), 'effect-outcome-unknown');
      check(primitives.guest === before && host.status().pending === 2, 'late waiter release cannot execute after unknown');
      fault = null;
    });
    await run('actual-resource-maxima-and-one-over', async () => {
      const f = await setup(), host = await f.open();
      const large = new Uint8Array(1048576).fill(0x5a), guest = new Uint8Array(2097151).fill(0x4a);
      check((await execute(host, invoke(guest)))[1].length === 2097152, 'actual exact generated guest maximum');
      check((await execute(host, ['random', [1, 65536]]))[1].length === 65536, 'actual exact Random maximum');
      check((await execute(host, ['digest', [2, large]]))[1] === 'sha256:' + hex(await digest(large)), 'actual exact Digest maximum');
      const signature = (await execute(host, ['sign', [3, large]]))[1];
      check(same(await execute(host, ['verify', [4, [large, signature]]]), [4, true]), 'actual exact Sign and Verify maxima');
      const objects = Array.from({length: 16}, (_, i) => new Uint8Array(1048576).fill(i));
      const id = 'sha256:' + hex(await digest(objects[0]));
      await execute(host, ['store', [7, ['maximum', [0], id, objects]]]);
      check(same(await execute(host, ['store', [5, id]]), [5, [1, objects[0]]]), 'actual ReadObject maximum');
      check(same(await execute(host, ['store', [6, 'maximum']]), [6, [1, [id, objects[0]]]]), 'actual ReadHead maximum');
      const bad = [[invoke(new Uint8Array(2097152)), 'model-rejected', 11], [['random', [1, 65537]], 'model-rejected', 11],
        [['digest', [2, new Uint8Array(1048577)]], 'wire-rejected', 6],
        [['verify', [4, [new Uint8Array(1048577), signature]]], 'wire-rejected', 6],
        [['store', [7, ['maximum', [1, id], id, [...objects, Uint8Array.of(0)]]]], 'wire-rejected', 6],
        [['store', [7, ['maximum', [1, id], id, [new Uint8Array(1048577)]]]], 'wire-rejected', 6]];
      for (const [intent, code, detail] of bad) {
        const before = host.status(), primitiveBefore = {...primitives};
        await rejects(() => host.prepareExact(request(host, intent)), code, detail);
        check(JSON.stringify(before) === JSON.stringify(host.status()) && JSON.stringify(primitiveBefore) === JSON.stringify(primitives), 'one-over never consumes or performs');
      }
    });
    await run('generated-counter-exhaustion', async () => {
      const module = await WebAssembly.compile(artifacts.Effects), instance = new WebAssembly.Instance(module, {});
      const request = new Uint8Array(input.counter.request), expected = new Uint8Array(input.counter.response);
      const pointer = instance.exports.holo_alloc(request.length) >>> 0;
      new Uint8Array(instance.exports.memory.buffer, pointer, request.length).set(request);
      const result = BigInt.asUintN(64, instance.exports.holo_run(pointer, request.length));
      const at = Number(result >> 32n), length = Number(result & 0xffffffffn);
      check(hex(new Uint8Array(instance.exports.memory.buffer, at, length)) === hex(expected), 'actual generated OperationExhausted at uint32 maximum');
      check(same(decode(expected), [1, 1, [5]]), 'source-owned terminal counter diagnostic');
    });
    await run('old-staged-interface-stays-result-only', async () => {
      const f = await setup(), host = await keep(openStagedEffects(f.options()));
      check(Object.keys(host).sort().join(',') === 'close,prepare,status', 'old staged API unchanged');
      const token = host.prepare(encode(invoke(text('old'))));
      check(same(decode(await token.release()), [0, text('{old')]), 'old staged release is still only EffectResult');
    });
    for (const host of hosts) host.close();
    await Promise.all(pending);
    return {cases, calls, maximum};
  } finally {
    for (const release of barriers) release.resolve();
    for (const host of hosts) { try { host.close(); } catch {} }
    for (const store of stores) store.close();
    for (const custody of custodies) closeCredentialCustody(custody);
    WebAssembly.compile = originalCompile; WebAssembly.Instance = NativeInstance;
    crypto.getRandomValues = originalRandom; crypto.subtle.digest = originalDigest;
    crypto.subtle.sign = originalSign; crypto.subtle.verify = originalVerify;
    IDBDatabase.prototype.transaction = originalTransaction;
  }
}
