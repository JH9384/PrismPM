// Actual IndexedDB execution against a freshly generated retention reducer.
// The enclosing DK-30 owner supplies and attests the artifact; no fake reducer.
import assert from 'node:assert/strict';
import {lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {storageJourneyInventory} from './storage-observations.mjs';

export function captureStorageSources(inputs, directory = new URL('../../sdk/browser/', import.meta.url)) {
  assert.ok(inputs && typeof inputs === 'object', 'original frozen storage source inventory required');
  const files = {};
  for (const name of ['session-storage.mjs', 'session-retention-wire.mjs', 'identity.mjs', 'effects-module.mjs', 'effects-wire.mjs']) {
    const path = fileURLToPath(new URL(name, directory)), stat = lstatSync(path);
    assert.equal(realpathSync(path), path); assert.ok(stat.isFile() && stat.nlink === 1);
    const bytes = readFileSync(path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), inputs['sdk/browser/' + name],
      'actual served storage source must match original frozen input ' + name);
    files[name] = bytes.toString('utf8');
  }
  return Object.freeze(files);
}

async function preparePage(page, baseURL, wire, options) {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([baseURL, baseURL + 'favicon.ico'].includes(url.href) && route.request().method() === 'GET') return route.continue();
      const name = url.pathname.slice(1);
      if (url.origin !== new URL(baseURL).origin || url.search || route.request().method() !== 'GET'
        || !Object.hasOwn(options.sources, name)) {
        options.unexpected.push({method: route.request().method(), url: url.href});
        return route.abort('blockedbyclient');
      }
      return route.fulfill({status: 200, contentType: 'text/javascript', body:
        name === 'session-storage.mjs' && options.source !== null ? options.source : options.sources[name]});
    });
    await page.goto(baseURL);
    await page.evaluate(bytes => {
      globalThis.retentionWireBytes = bytes;
      // Observe real generated execution without changing inputs or responses.
      // Every instance must originate in the exact owner-supplied artifact.
      const originalCompile = WebAssembly.compile, OriginalInstance = WebAssembly.Instance;
      const modules = new WeakSet(), calls = [];
      const hex = value => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
      WebAssembly.compile = async function(input) {
        const captured = new Uint8Array(input).slice();
        if (captured.length !== bytes.length || !captured.every((byte, index) => byte === bytes[index]))
          throw Error('retention observer requires the exact generated artifact');
        const module = await Reflect.apply(originalCompile, WebAssembly, [captured]); modules.add(module); return module;
      };
      WebAssembly.Instance = class {
        constructor(module, imports) {
          if (!modules.has(module)) throw Error('retention observer requires captured module provenance');
          const real = new OriginalInstance(module, imports), exports = {...real.exports};
          exports.holo_run = (pointer, length) => {
            const request = new Uint8Array(exports.memory.buffer, pointer, length).slice();
            const result = real.exports.holo_run(pointer, length), packed = BigInt.asUintN(64, result);
            const start = Number(packed >> 32n), size = Number(packed & 0xffffffffn);
            const response = new Uint8Array(exports.memory.buffer, start, size).slice();
            if (exports.memory.buffer.byteLength > 1073741824) throw Error('retention observer memory bound');
            calls.push({request: hex(request), response: hex(response), memory: exports.memory.buffer.byteLength});
            return result;
          };
          return {exports};
        }
      };
      globalThis.retentionObservedCalls = calls;
    }, Array.from(wire));
    await page.addScriptTag({type: 'module', content: `
      import {openSessionStorage} from './session-storage.mjs';
      import {encodeRetentionWire as encode, decodeRetentionWire as decode} from './session-retention-wire.mjs';
      const wire = Uint8Array.from(globalThis.retentionWireBytes);
      delete globalThis.retentionWireBytes;
      const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const wireDigest = await digest(wire);
      const open = namespace => openSessionStorage({namespace, wire, wireDigest});
      const fail = async action => { try { await action(); return 'unexpected-success'; } catch (error) {return error.code ?? error.message;} };
      const sort = refs => refs.toSorted((a, b) => {for (let i=0;i<32;i++) if(a[i]!==b[i]) return a[i]-b[i]; return 0;});
      const replace = (name, expected, head, refs) => encode([1, [name, expected === null ? [0] : [1, expected], head, sort(refs)]]);
      globalThis.retentionFixture = {open, encode, decode, digest, fail, sort, replace};
    `});
    await page.waitForFunction(() => globalThis.retentionFixture !== undefined);
}

async function capturePage(page, options) {
  assert.deepEqual(options.unexpected, [], 'storage fixture cannot conceal undeclared network or module requests');
  const rows = await page.evaluate(() => globalThis.retentionObservedCalls.splice(0));
  assert.ok(rows.length > 0, 'every storage fixture page must execute the actual generated retention model');
  options.calls.push(...rows);
}

async function runFixture(wire, operation, options) {
  assert.ok(wire instanceof Uint8Array && wire.length > 8);
  return withBrowser(async ({browser, baseURL}) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage(); await preparePage(page, baseURL, wire, options);
      const result = await operation(page, {browser, baseURL, prepare: next => preparePage(next, baseURL, wire, options)});
      for (const observed of context.pages()) await capturePage(observed, options);
      return result;
    } finally {await context.close();}
  }, {engine: options.engine});
}

export async function verifySessionStorage(t, wire, {source = null, engine = 'chromium', inputs} = {}) {
  const options = {source, engine, calls: [], unexpected: [], sources: captureStorageSources(inputs)};
  const fixture = (bytes, operation) => runFixture(bytes, operation, options);
  const owner = t; let journey = 0;
  t = {async test(name, body) {
    const index = journey++, expected = storageJourneyInventory[index];
    assert.ok(expected && name.startsWith(expected[0]), 'closed storage journey inventory');
    return owner.test(name, async () => {
      const start = options.calls.length;
      await body();
      for (const row of options.calls.slice(start)) row.journey = index;
    });
  }};
  await t.test('a transaction must report strict durability before any read or publication', async () => {
    const result = await fixture(wire, page => page.evaluate(async () => {
      const {open, encode, decode, digest, replace, fail} = retentionFixture;
      const rows = [];
      for (const [index, durability] of ['relaxed', 'default', undefined].entries()) {
        const store = await open('journal-retention-durability-' + index), expected = await store.snapshot();
        const bytes = Uint8Array.of(81 + index), id = await digest(bytes), original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(...args) {
          const tx = original.apply(this, args);
          Object.defineProperty(tx, 'durability', {value: durability}); return tx;
        };
        let write, read;
        try {
          write = await fail(() => store.commit({expected, replacement: replace('journal', null, id, [id]),
            objects: [bytes], retire: encode([])}));
          read = await fail(() => store.snapshot());
        } finally {IDBDatabase.prototype.transaction = original;}
        const snapshot = decode(await store.snapshot()), absent = await store.read(id); store.close();
        rows.push({write, read, revision: snapshot[1], objects: snapshot[2].length, roots: snapshot[3].length, absent});
      }
      return rows;
    }));
    assert.deepEqual(result, Array.from({length: 3}, () => ({write: 'storage-unavailable', read: 'storage-unavailable',
      revision: 0, objects: 0, roots: 0, absent: null})));
  });

  await t.test('real durable root closure survives close/reopen without a mutable caller alias', async () => {
    const result = await fixture(wire, page => page.evaluate(async () => {
      const {open, encode, decode, digest, replace} = retentionFixture;
      const store = await open('journal-retention-persist'), initial = await store.snapshot();
      const object = Uint8Array.of(1, 2, 3), id = await digest(object);
      const replacement = replace('journal', null, id, [id]), retire = encode([]);
      const committed = store.commit({expected: initial, replacement, objects: [object], retire});
      initial.fill(0); replacement.fill(0); retire.fill(0); object.fill(0);
      const after = await committed; store.close();
      const reopened = await open('journal-retention-persist');
      const snapshot = await reopened.snapshot(), actual = await reopened.read(id); reopened.close();
      return {same: JSON.stringify(Array.from(after)) === JSON.stringify(Array.from(snapshot)),
        revision: decode(snapshot)[1], objects: decode(snapshot)[2].length, roots: decode(snapshot)[3].length,
        bytes: Array.from(actual)};
    }));
    assert.deepEqual(result, {same: true, revision: 1, objects: 1, roots: 1, bytes: [1, 2, 3]});
  });

  await t.test('competing real transactions publish exactly one frontier and retain no rejected objects', async () => {
    const result = await fixture(wire, page => page.evaluate(async () => {
      const {open, encode, decode, digest, replace} = retentionFixture;
      const a = await open('journal-retention-race'), b = await open('journal-retention-race');
      const expected = await a.snapshot(), bytesA = Uint8Array.of(4), bytesB = Uint8Array.of(5);
      const idA = await digest(bytesA), idB = await digest(bytesB);
      const results = await Promise.allSettled([
        a.commit({expected, replacement: replace('journal', null, idA, [idA]), objects: [bytesA], retire: encode([])}),
        b.commit({expected, replacement: replace('journal', null, idB, [idB]), objects: [bytesB], retire: encode([])}),
      ]);
      const snapshot = decode(await a.snapshot()), winner = results[0].status === 'fulfilled' ? idA : idB;
      const loser = results[0].status === 'fulfilled' ? idB : idA;
      const retained = await a.read(loser), actual = await a.read(winner); a.close(); b.close();
      return {successes: results.filter(row => row.status === 'fulfilled').length,
        errors: results.filter(row => row.status === 'rejected').map(row => row.reason.code),
        revision: snapshot[1], objects: snapshot[2].length, roots: snapshot[3].length,
        retained, winnerBytes: actual.length};
    }));
    assert.deepEqual(result, {successes: 1, errors: ['frontier-conflict'], revision: 1,
      objects: 1, roots: 1, retained: null, winnerBytes: 1});
  });

  await t.test('shared and staging roots prevent retirement until an atomic safe replacement', async () => {
    const result = await fixture(wire, page => page.evaluate(async () => {
      const {open, encode, decode, digest, replace, fail} = retentionFixture;
      const store = await open('journal-retention-shared'), shared = Uint8Array.of(8), marker = Uint8Array.of(9);
      const sharedId = await digest(shared), markerId = await digest(marker), empty = encode([]);
      let expected = await store.snapshot();
      expected = await store.commit({expected, replacement: replace('journal', null, sharedId, [sharedId]), objects: [shared], retire: empty});
      expected = await store.commit({expected, replacement: replace('staging', null, sharedId, [sharedId]), objects: [], retire: empty});
      const removeProtected = await fail(() => store.commit({expected, replacement: encode([0]), objects: [], retire: encode([sharedId])}));
      const replaceShared = await fail(() => store.commit({expected, replacement: replace('journal', sharedId, markerId, [markerId]), objects: [marker], retire: encode([sharedId])}));
      const unchanged = decode(await store.snapshot())[1];
      expected = await store.commit({expected, replacement: replace('staging', sharedId, markerId, [markerId]), objects: [marker], retire: empty});
      expected = await store.commit({expected, replacement: replace('journal', sharedId, markerId, [markerId]), objects: [], retire: encode([sharedId])});
      const missing = await store.read(sharedId), kept = await store.read(markerId), final = decode(expected); store.close();
      return {removeProtected, replaceShared, unchanged, finalRevision: final[1], objects: final[2].length,
        roots: final[3].length, missing, kept: Array.from(kept)};
    }));
    assert.deepEqual(result, {removeProtected: 'model-rejected', replaceShared: 'model-rejected', unchanged: 2,
      finalRevision: 4, objects: 1, roots: 2, missing: null, kept: [9]});
  });

  await t.test('actual transaction abort rolls back additions, retirement and root publication together', async () => {
    const result = await fixture(wire, page => page.evaluate(async () => {
      const {open, encode, decode, digest, replace, fail} = retentionFixture;
      const store = await open('journal-retention-abort'), first = Uint8Array.of(10), second = Uint8Array.of(11);
      const a = await digest(first), b = await digest(second), empty = encode([]);
      const expected = await store.commit({expected: await store.snapshot(), replacement: replace('journal', null, a, [a]), objects: [first], retire: empty});
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args) {
        if (this.name === 'roots') {this.transaction.abort(); throw new DOMException('injected actual root transaction abort', 'AbortError');}
        return original.apply(this, args);
      };
      let code;
      try {code = await fail(() => store.commit({expected, replacement: replace('journal', a, b, [b]), objects: [second], retire: encode([a])}));}
      finally {IDBObjectStore.prototype.put = original;}
      const snapshot = await store.snapshot(), old = await store.read(a), absent = await store.read(b);
      const retried = await store.commit({expected, replacement: replace('journal', a, b, [b]), objects: [second], retire: encode([a])});
      store.close(); return {code, revision: decode(snapshot)[1], old: Array.from(old), absent, next: decode(retried)[1]};
    }));
    assert.deepEqual(result, {code: 'storage-unavailable', revision: 1, old: [10], absent: null, next: 2});
  });

  await t.test('missing closure, invalid input, close and same-handle overlap fail without publication', async () => {
    const result = await fixture(wire, page => page.evaluate(async () => {
      const {open, encode, decode, digest, replace, fail} = retentionFixture;
      const store = await open('journal-retention-refusal'), bytes = Uint8Array.of(20), id = await digest(bytes);
      const expected = await store.snapshot(), empty = encode([]), replacement = replace('journal', null, id, [id]);
      const absent = await fail(() => store.commit({expected, replacement, objects: [], retire: empty}));
      const extra = await fail(() => store.commit({expected, replacement, objects: [bytes], retire: empty, accepted: true}));
      const oversized = await fail(() => store.commit({expected, replacement, objects: [new Uint8Array(1048577)], retire: empty}));
      const pending = store.commit({expected, replacement, objects: [bytes], retire: empty});
      const busy = await fail(() => store.commit({expected, replacement, objects: [bytes], retire: empty}));
      await pending; store.close(); const closed = await fail(() => store.snapshot());
      const reopened = await open('journal-retention-refusal'), revision = decode(await reopened.snapshot())[1]; reopened.close();
      return {absent, extra, oversized, busy, closed, revision};
    }));
    assert.deepEqual(result, {absent: 'model-rejected', extra: 'invalid-input', oversized: 'invalid-input',
      busy: 'storage-busy', closed: 'storage-closed', revision: 1});
  });

  await t.test('two actual tabs cannot both publish against the same captured frontier', async () => {
    await fixture(wire, async (first, {prepare}) => {
      const second = await first.context().newPage(); await prepare(second);
      const expected = await first.evaluate(async () => {
        globalThis.store = await retentionFixture.open('journal-retention-tabs');
        return Array.from(await store.snapshot());
      });
      await second.evaluate(async () => {globalThis.store = await retentionFixture.open('journal-retention-tabs');});
      const results = await Promise.all([first, second].map((page, index) => page.evaluate(async ({expected, index}) => {
        const {digest, replace, encode, fail} = retentionFixture, bytes = Uint8Array.of(41 + index), id = await digest(bytes);
        const code = await fail(() => store.commit({expected: Uint8Array.from(expected),
          replacement: replace('journal', null, id, [id]), objects: [bytes], retire: encode([])}));
        store.close(); return {code, id: Array.from(id)};
      }, {expected, index})));
      assert.deepEqual(results.map(row => row.code).sort(), ['frontier-conflict', 'unexpected-success']);
      const winner = results.find(row => row.code === 'unexpected-success'), loser = results.find(row => row.code === 'frontier-conflict');
      const readback = await second.evaluate(async ({winner, loser}) => {
        const {open, decode} = retentionFixture, store = await open('journal-retention-tabs');
        const snapshot = decode(await store.snapshot()), kept = await store.read(Uint8Array.from(winner));
        const missing = await store.read(Uint8Array.from(loser)); store.close();
        return {revision: snapshot[1], count: snapshot[2].length, roots: snapshot[3].length, kept: kept.length, missing};
      }, {winner: winner.id, loser: loser.id});
      assert.deepEqual(readback, {revision: 1, count: 1, roots: 1, kept: 1, missing: null});
    });
  });

  await t.test('acknowledged root and bytes survive an actual persistent browser restart', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'prismpm-session-retention-profile-'));
    let passed = false;
    try {
      await withBrowser(async ({baseURL, launchPersistentContext}) => {
        const first = await launchPersistentContext(profile), page = await first.newPage();
        await preparePage(page, baseURL, wire, options);
        const saved = await page.evaluate(async () => {
          const {open, encode, digest, replace} = retentionFixture, store = await open('journal-retention-process');
          const bytes = Uint8Array.of(51, 52, 53), id = await digest(bytes);
          const after = await store.commit({expected: await store.snapshot(), replacement: replace('journal', null, id, [id]),
            objects: [bytes], retire: encode([])});
          store.close(); return {id: Array.from(id), after: Array.from(after)};
        });
        await capturePage(page, options); await first.close();
        const second = await launchPersistentContext(profile), reopened = await second.newPage();
        await preparePage(reopened, baseURL, wire, options);
        const actual = await reopened.evaluate(async id => {
          const store = await retentionFixture.open('journal-retention-process');
          const bytes = await store.read(Uint8Array.from(id)), snapshot = await store.snapshot(); store.close();
          return {bytes: Array.from(bytes), snapshot: Array.from(snapshot)};
        }, saved.id);
        assert.deepEqual(actual, {bytes: [51, 52, 53], snapshot: saved.after});
        await capturePage(reopened, options); await second.close();
      }, {engine: options.engine});
      passed = true;
    } finally {
      // Only this freshly created fixture profile; retain failed-run evidence.
      if (passed) rmSync(profile, {recursive: true});
    }
  });

  await t.test('publication cannot acknowledge before the actual transaction completion callback', async () => {
    const result = await fixture(wire, page => page.evaluate(async () => {
      const {open, encode, decode, digest, replace} = retentionFixture, store = await open('journal-retention-ack');
      const expected = await store.snapshot(), bytes = Uint8Array.of(61), id = await digest(bytes);
      const original = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
      let release, completed, acknowledged = false;
      const reached = new Promise(resolve => {completed = resolve;});
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {...original, set(handler) {
        if (this.mode !== 'readwrite') return original.set.call(this, handler);
        return original.set.call(this, event => {release = () => handler.call(this, event); completed();});
      }});
      try {
        const pending = store.commit({expected, replacement: replace('journal', null, id, [id]), objects: [bytes], retire: encode([])})
          .then(bytes => {acknowledged = true; return bytes;});
        await reached;
        const visible = decode(await store.snapshot())[1], early = acknowledged;
        release(); const after = decode(await pending)[1]; store.close();
        return {visible, early, after, acknowledged};
      } finally {Object.defineProperty(IDBTransaction.prototype, 'oncomplete', original); release?.(); store.close();}
    }));
    assert.deepEqual(result, {visible: 1, early: false, after: 1, acknowledged: true});
  });

  await t.test('quota failure aborts the real transaction and keeps its predecessor recoverable', async () => {
    const result = await fixture(wire, page => page.evaluate(async () => {
      const {open, encode, decode, digest, replace, fail} = retentionFixture, store = await open('journal-retention-quota');
      const first = Uint8Array.of(70), next = Uint8Array.of(71), a = await digest(first), b = await digest(next);
      const expected = await store.commit({expected: await store.snapshot(), replacement: replace('journal', null, a, [a]),
        objects: [first], retire: encode([])});
      const original = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function(...args) {
        if (this.name === 'objects') throw new DOMException('fixture quota exhaustion', 'QuotaExceededError');
        return original.apply(this, args);
      };
      let code;
      try {code = await fail(() => store.commit({expected, replacement: replace('journal', a, b, [b]), objects: [next], retire: encode([a])}));}
      finally {IDBObjectStore.prototype.add = original;}
      const after = decode(await store.snapshot())[1], retained = await store.read(a), absent = await store.read(b); store.close();
      const reopened = await open('journal-retention-quota'), revision = decode(await reopened.snapshot())[1]; reopened.close();
      return {code, after, retained: Array.from(retained), absent, revision};
    }));
    assert.deepEqual(result, {code: 'storage-quota', after: 1, retained: [70], absent: null, revision: 1});
  });

  await t.test('read refuses changed stored payload bytes even when the root and object key are unchanged', async () => {
    const result = await fixture(wire, page => page.evaluate(async () => {
      const {open, encode, digest, replace, fail} = retentionFixture;
      const namespace = 'journal-retention-corrupt-payload', store = await open(namespace);
      const bytes = Uint8Array.of(91, 92), id = await digest(bytes);
      const original = await store.commit({expected: await store.snapshot(),
        replacement: replace('journal', null, id, [id]), objects: [bytes], retire: encode([])});
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('prismpm.browser.session.v1/' + namespace, 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['objects'], 'readwrite', {durability: 'strict'});
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
          tx.objectStore('objects').put(Uint8Array.of(91, 93),
            Array.from(id, byte => byte.toString(16).padStart(2, '0')).join(''));
        });
      } finally {db.close();}
      const unchanged = Array.from(await store.snapshot()).join(',') === Array.from(original).join(',');
      const corrupt = await fail(() => store.read(id)); store.close();
      return {unchanged, corrupt};
    }));
    assert.deepEqual(result, {unchanged: true, corrupt: 'object-corrupt'});
  });
  assert.equal(journey, storageJourneyInventory.length);
  return options.calls;
}
