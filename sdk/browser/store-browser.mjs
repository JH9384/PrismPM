import assert from 'node:assert/strict';
import { withBrowser as runBrowser } from './browser-test-server.mjs';

export async function verifyStore(t, options = {}) {
  const withBrowser = callback => runBrowser(callback, options);

  await t.test('storage refuses actual transactions that do not report strict durability', {timeout: 30000}, async () => {
    await withBrowser(async ({browser, baseURL}) => {
      const page = await browser.newPage(); await page.goto(baseURL);
      const actual = await page.evaluate(async () => {
        const {openStore} = await import('./store.mjs'), {digestBytes} = await import('./identity.mjs');
        const rows = [], failure = async fn => {try {await fn(); return 'unexpected-success';} catch (error) {return error.code;}};
        for (const [index, durability] of ['relaxed', 'default', undefined].entries()) {
          const store = await openStore('test-durability-' + index), bytes = Uint8Array.of(1), id = await digestBytes(bytes);
          const original = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function(...args) {
            const tx = original.apply(this, args); Object.defineProperty(tx, 'durability', {value: durability}); return tx;
          };
          let write, read;
          try {
            write = await failure(() => store.commit({head: 'main', expected: null, next: id, objects: [bytes]}));
            read = await failure(() => store.readHead('main'));
          } finally {IDBDatabase.prototype.transaction = original;}
          const head = await store.readHead('main'), object = await store.readObject(id); store.close();
          rows.push({write, read, head, object});
        }
        return rows;
      });
      assert.deepEqual(actual, Array.from({length: 3}, () => ({write: 'storage-unavailable', read: 'storage-unavailable', head: null, object: null})));
    });
  });

  await t.test('browser storage retains keys and an atomic content-addressed head after reopening', { timeout: 30000 }, async () => {
    await withBrowser(async ({ browser, baseURL }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(baseURL);
      const principal = await page.evaluate(async () => {
        const { openStore } = await import('./store.mjs');
        const { createIdentity, digestBytes } = await import('./identity.mjs');
        const store = await openStore('test-restart');
        const identity = await createIdentity();
        await store.saveIdentity(identity);
        const bytes = new TextEncoder().encode('durable state');
        const id = await digestBytes(bytes);
        await store.commit({ head: 'workspace', expected: null, next: id, objects: [bytes] });
        store.close();
        return identity.principal;
      });
      await page.close();
      const reopened = await context.newPage();
      await reopened.goto(baseURL);
      const actual = await reopened.evaluate(async () => {
        const { openStore } = await import('./store.mjs');
        const { signBytes, verifyBytes } = await import('./identity.mjs');
        const store = await openStore('test-restart');
        const identity = await store.loadIdentity();
        const head = await store.readHead('workspace');
        const signature = await signBytes(identity, 'test/1', head.bytes);
        const valid = await verifyBytes(identity.publicKey, 'test/1', head.bytes, signature);
        store.close();
        return { principal: identity.principal, text: new TextDecoder().decode(head.bytes), valid };
      });
      assert.deepEqual(actual, { principal, text: 'durable state', valid: true });
      await context.close();
    });
  });

  await t.test('competing writers cannot overwrite a head or retain rejected transaction objects', { timeout: 30000 }, async () => {
    await withBrowser(async ({ browser, baseURL }) => {
      const page = await browser.newPage();
      await page.goto(baseURL);
      const actual = await page.evaluate(async () => {
        const { openStore } = await import('./store.mjs');
        const { digestBytes } = await import('./identity.mjs');
        const first = await openStore('test-race');
        const second = await openStore('test-race');
        const a = Uint8Array.of(1), b = Uint8Array.of(2);
        const aid = await digestBytes(a), bid = await digestBytes(b);
        const outcomes = await Promise.allSettled([
          first.commit({ head: 'shared', expected: null, next: aid, objects: [a] }),
          second.commit({ head: 'shared', expected: null, next: bid, objects: [b] }),
        ]);
        const current = await first.readHead('shared');
        const loser = await first.readObject(current.id === aid ? bid : aid);
        const failures = outcomes.filter(row => row.status === 'rejected').map(row => row.reason.code);
        first.close(); second.close();
        return { failures, successes: outcomes.filter(row => row.status === 'fulfilled').length, loser };
      });
      assert.deepEqual(actual, { failures: ['head-conflict'], successes: 1, loser: null });
    });
  });

  await t.test('storage fails closed for corruption, limits, missing targets, and identity replacement', { timeout: 30000 }, async () => {
    await withBrowser(async ({ browser, baseURL }) => {
      const page = await browser.newPage();
      await page.goto(baseURL);
      const actual = await page.evaluate(async () => {
        const { openStore } = await import('./store.mjs');
        const { createIdentity, digestBytes } = await import('./identity.mjs');
        const limits = { maxObjectBytes: 4, maxObjects: 1, maxHeads: 1 };
        const store = await openStore('test-failure', limits);
        const codes = [];
        const fail = async operation => { try { await operation(); codes.push('unexpected-success'); } catch (error) { codes.push(error.code); } };
        const a = Uint8Array.of(1), b = Uint8Array.of(2);
        const aid = await digestBytes(a), bid = await digestBytes(b);
        await fail(() => store.commit({ head: 'main', expected: null, next: aid, objects: [] }));
        await fail(() => store.commit({ head: 'main', expected: null, next: aid, objects: [new Uint8Array(5)] }));
        await store.commit({ head: 'main', expected: null, next: aid, objects: [a] });
        await fail(() => store.commit({ head: 'main', expected: aid, next: bid, objects: [b] }));
        await fail(() => store.commit({ head: 'second', expected: null, next: aid, objects: [a] }));
        await fail(() => openStore('test-failure', { ...limits, maxObjects: 2 }));
        await store.saveIdentity(await createIdentity());
        await fail(async () => store.saveIdentity(await createIdentity()));
        // Direct IDB corruption represents a damaged or tampered on-disk object.
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('prismpm.browser.v1/test-failure');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('objects', 'readwrite');
            tx.objectStore('objects').put(Uint8Array.of(9), aid);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onabort = () => reject(tx.error);
          };
        });
        await fail(() => store.readObject(aid));
        await fail(() => store.readHead('main'));
        store.close();
        await fail(() => store.readHead('main'));
        return codes;
      });
      assert.deepEqual(actual, ['missing-object', 'invalid-input', 'store-limit', 'store-limit',
        'store-policy-mismatch', 'identity-exists', 'object-corrupt', 'object-corrupt', 'store-closed']);
    });
  });
}
