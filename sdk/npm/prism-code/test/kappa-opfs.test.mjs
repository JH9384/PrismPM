// A rule app's page keeps what it fetched and proved in the browser's origin-private file system, by κ-label,
// and reuses a proof only as the Node store does: under the same key, kernel, library and proof bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findProof, keepProof, opfsStore } from '../src/journey/kappa-opfs.mjs';
import { PROOF_SCHEMA, derivationKey, reuseAdmits } from '../src/journey/kappa-rules.mjs';
import * as nodeStore from '../src/journey/kappa-store.mjs';

const enc = new TextEncoder();
const k = (c) => `sha256:${c.repeat(64)}`;

/** An origin-private file system in memory, with the handle methods the store uses. */
function memoryRoot() {
  const dirs = new Map();
  const files = new Map();
  return {
    dirs,
    files,
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!dirs.has(name)) {
        if (!create) throw new DOMException('absent', 'NotFoundError');
        dirs.set(name, memoryRoot());
      }
      return dirs.get(name);
    },
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name)) {
        if (!create) throw new DOMException('absent', 'NotFoundError');
        files.set(name, new Uint8Array());
      }
      return {
        getFile: async () => ({ arrayBuffer: async () => files.get(name).slice().buffer }),
        createWritable: async () => {
          let next;
          return { write: async (b) => { next = new Uint8Array(b); }, close: async () => { files.set(name, next); } };
        },
      };
    },
  };
}

test('bytes come back only when they re-derive to their label', async () => {
  const root = memoryRoot();
  const store = await opfsStore({ root });
  const label = await store.put(enc.encode('kernel bytes'));
  assert.deepEqual(await store.get(label), enc.encode('kernel bytes'));
  assert.equal(await store.get(k('a')), null);
  // Planted defect S1: bytes altered on disk under their old name are not returned.
  root.dirs.get('bytes').dirs.get(label.slice(7, 9)).files.set(label.slice(9), enc.encode('other bytes'));
  assert.equal(await store.get(label), null);
});

test('a page with no origin-private file system keeps nothing and answers nothing, and never throws', async () => {
  const store = await opfsStore();
  assert.equal(store.off, true);
  assert.equal(await store.get(await store.put(enc.encode('x'))), null);
  assert.equal(await store.bound(k('b')), null);
});

test('a proof is reused in the browser exactly when it is reused on Node', async () => {
  const root = memoryRoot();
  const store = await opfsStore({ root });
  const [kernel, library, statement] = [k('1'), k('2'), k('3')];
  const key = derivationKey(PROOF_SCHEMA, [kernel, library, statement]);
  assert.equal(reuseAdmits((await findProof(store, { key, kernel, library })).facts), false);
  await keepProof(store, { key, kernel, library, statement, text: 'proof lines\n', axioms: ['propext'] });
  const found = await findProof(store, { key, kernel, library });
  assert.equal(reuseAdmits(found.facts), true);
  assert.equal(found.text, 'proof lines\n');
  assert.deepEqual(found.proof.axioms, ['propext']);
  // Another kernel, another library, or another statement's key finds nothing it may use.
  assert.equal(reuseAdmits((await findProof(store, { key, kernel: k('4'), library })).facts), false);
  assert.equal(reuseAdmits((await findProof(store, { key, kernel, library: k('5') })).facts), false);
  assert.equal(reuseAdmits((await findProof(store, { key: derivationKey(PROOF_SCHEMA, [kernel, library, k('6')]), kernel, library })).facts), false);
  // Planted defect S2: proof bytes altered under their old name are no longer reused.
  const bundle = found.proof.bundle;
  root.dirs.get('bytes').dirs.get(bundle.slice(7, 9)).files.set(bundle.slice(9), enc.encode('other proof\n'));
  assert.equal(reuseAdmits((await findProof(store, { key, kernel, library })).facts), false);
  // One rule in two places: Node's store decides with these very functions.
  assert.equal(nodeStore.reuseAdmits, reuseAdmits);
  assert.equal(nodeStore.derivationKey, derivationKey);
});

test('the browser store and its rules need nothing from Node', () => {
  for (const file of ['kappa-opfs.mjs', 'kappa-rules.mjs']) {
    const text = readFileSync(new URL(`../src/journey/${file}`, import.meta.url), 'utf8');
    assert.ok(!/\bfrom\s*['"]node:/.test(text), file);
  }
});
