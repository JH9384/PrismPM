// Lean's kernel with its library loaded, kept as an image of its memory: a fresh kernel with the image laid over it
// judges every proof as the kernel that loaded the library does, and an image is reused only by `reuseAdmits`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { compile } from '../src/journey/session.mjs';
import { ruleWords } from '../src/journey/kernel-prove.mjs';
import { HOLDS, proofLines, readLibrary } from '../src/journey/kernel-terms.mjs';
import { IMAGE_SCHEMA, decodeImage, encodeImage, restoreImage } from '../src/journey/kernel-image.mjs';
import { findImage, keepImage, opfsStore } from '../src/journey/kappa-opfs.mjs';
import { derivationKey, reuseAdmits } from '../src/journey/kappa-rules.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/kernel/', import.meta.url));
const unpack = (file) => gunzipSync(readFileSync(join(FIXTURES, file)));
const glue = unpack('lean-kernel.mjs.gz');
const wasm = unpack('lean-kernel.wasm.gz');
const library = unpack('library.ndjson.gz');
const loaderFile = join(mkdtempSync(join(tmpdir(), 'prism-kernel-image-')), 'lean-kernel.mjs');
writeFileSync(loaderFile, glue);
const factory = (await import(pathToFileURL(loaderFile).href)).default;
const lib = readLibrary(library.toString('utf8'));

const PARKING = {
  purpose: 'Parking fee tier: decide the parking fee tier for a vehicle from the hours parked and the vehicle type.',
  fields: 'hours: number 0..24, vehicle: car|motorcycle|truck',
  outcomes: 'free, standard, premium',
  rules: 'when hours = 0 then free\nwhen vehicle is motorcycle then free\nwhen vehicle is truck then premium\nwhen hours > 8 then premium\notherwise standard',
  properties: 'never when vehicle is motorcycle then premium\nalways when vehicle is truck and hours > 0 then premium\nnever when hours = 0 then standard',
  examples: '0 car -> free\n3 car -> standard\n10 car -> premium',
};
const { words, guarantees } = ruleWords(compile({ ...PARKING, review: 'yes' }).spec);
// False: the third rule makes a truck premium. The kernel must refuse it from an image as it does after a load.
const falsehood = { ...guarantees[0], when: [[guarantees[0].when[0][0], guarantees[0].when[0][1], 2]] };

/** A fresh kernel, as the page opens one: the loader's factory, its memory, and a runner of its entry points. */
async function open() {
  const said = [];
  let memory;
  const module = await factory({
    instantiateWasm: (imports, done) => {
      WebAssembly.instantiate(wasm, imports).then((r) => {
        memory = r.instance.exports.memory;
        done(r.instance, r.module);
      });
      return {};
    },
    print: (s) => said.push(s),
    printErr: (s) => said.push(s),
  });
  const run = (entry, bytes) => {
    said.length = 0;
    module.FS.writeFile('/in.ndjson', bytes);
    let exit;
    try {
      exit = module.ccall(entry, 'number', ['string'], ['/in.ndjson']);
    } catch {
      exit = 3;
    }
    module.FS.unlink('/in.ndjson');
    const axioms = said.map((line) => /^axioms ([^:]+): ?(.*)$/.exec(line)).find((a) => a && a[1] === HOLDS);
    return { exit, axioms: axioms ? axioms[2] : null };
  };
  assert.equal(module.ccall('checker_ready', 'number', [], []), 0);
  return { module, run, memory: () => memory, grow: (n) => assert.ok(module._malloc(n + 65536)) };
}
const judge = (k) => [...guarantees, falsehood].map((g) => k.run('check_suffix', Buffer.from(proofLines(lib, words, g), 'utf8')));

test('a fresh kernel with the image laid over it judges every proof as the kernel that loaded the library', { timeout: 120000 }, async () => {
  const loaded = await open();
  assert.equal(loaded.run('load_library', library).exit, 0);
  const image = encodeImage(new Uint8Array(loaded.memory().buffer).slice());
  const fromLoad = judge(loaded);
  assert.deepEqual(fromLoad.map((r) => r.exit), [0, 0, 0, 1], 'the true guarantees are accepted and the false one refused');

  const restored = await open();
  assert.equal(restoreImage(image, restored), true);
  assert.deepEqual(judge(restored), fromLoad, 'the same answers and the same axioms');
  // A kernel that never loaded the library accepts nothing: the image is what carries it.
  assert.deepEqual(judge(await open()).map((r) => r.exit), [1, 1, 1, 1]);
  // The image leaves out the memory that is all zero.
  assert.ok(image.length < loaded.memory().buffer.byteLength / 2, `${image.length} bytes`);
});

test('an image has one reading: anything else is not an image and nothing is written', async () => {
  const memory = new Uint8Array(4096 * 4);
  memory[5] = 1;
  memory[4096 * 2 + 9] = 7;
  const image = encodeImage(memory);
  assert.deepEqual(decodeImage(image).blocks.map(([index]) => index), [0, 2]);
  assert.deepEqual(encodeImage(memory), image, 'the same memory gives the same bytes');
  const target = { buffer: new ArrayBuffer(4096 * 4) };
  new Uint8Array(target.buffer).fill(9);
  assert.equal(restoreImage(image, { memory: () => target, grow: () => {} }), true);
  assert.deepEqual(new Uint8Array(target.buffer), memory, 'every byte is written, the left-out blocks as zero');
  // Planted defects: another schema, a truncated image, and blocks out of order are each refused.
  const other = image.slice();
  other[0] ^= 1;
  assert.equal(decodeImage(other), null);
  assert.equal(decodeImage(image.subarray(0, image.length - 1)), null);
  const swapped = image.slice();
  const at = `${IMAGE_SCHEMA}\n`.length + 12;
  swapped.set(image.subarray(at + 4, at + 8), at);
  swapped.set(image.subarray(at, at + 4), at + 4);
  assert.equal(decodeImage(swapped), null);
  const untouched = { buffer: new ArrayBuffer(4096 * 4) };
  new Uint8Array(untouched.buffer).fill(9);
  assert.equal(restoreImage(other, { memory: () => untouched, grow: () => {} }), false);
  assert.ok(new Uint8Array(untouched.buffer).every((b) => b === 9));
});

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

test('an image stands in for loading the library only under the same key, kernel, library and bytes', async () => {
  const k = (c) => `sha256:${c.repeat(64)}`;
  const root = memoryRoot();
  const store = await opfsStore({ root });
  const [loader, kernel, library] = [k('1'), k('2'), k('3')];
  const key = derivationKey(IMAGE_SCHEMA, [loader, kernel, library]);
  assert.equal(reuseAdmits((await findImage(store, { key, kernel, library })).facts), false);
  const bytes = encodeImage(Uint8Array.of(...new Array(4096).fill(0), 1, ...new Array(4095).fill(0)));
  await keepImage(store, { key, loader, kernel, library, bytes });
  const found = await findImage(store, { key, kernel, library });
  assert.equal(reuseAdmits(found.facts), true);
  assert.deepEqual(found.image, bytes);
  // Another loader is another key; another kernel or library is refused under this one.
  assert.equal(reuseAdmits((await findImage(store, { key: derivationKey(IMAGE_SCHEMA, [k('4'), kernel, library]), kernel, library })).facts), false);
  assert.equal(reuseAdmits((await findImage(store, { key, kernel: k('5'), library })).facts), false);
  assert.equal(reuseAdmits((await findImage(store, { key, kernel, library: k('6') })).facts), false);
  // Planted defect: image bytes altered under their old name are not reused.
  const label = JSON.parse(new TextDecoder().decode(await store.get(await store.bound(key)))).image;
  root.dirs.get('bytes').dirs.get(label.slice(7, 9)).files.set(label.slice(9), Uint8Array.of(1, 2, 3));
  assert.equal(reuseAdmits((await findImage(store, { key, kernel, library })).facts), false);
});
