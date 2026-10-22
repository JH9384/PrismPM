// Owning acceptance infrastructure; no application implementation or decoder.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {run} from '../browser-view/compile.mjs';

const work = resolve(process.argv[2]);
const index = JSON.parse(readFileSync(new URL(
  '../../stdlib/src/Foundation/Codec/Cbor/V1/primitive-corpus.json', import.meta.url)));
assert.equal(index.schema, 'prismpm/cbor-primitive-corpus/1');
assert.equal(index.roots.length, 194);
assert.deepEqual(index.cases.map(row => row.root), index.roots);
const maximumPages = 1024, maximumPayload = 4_202_612;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const modules = new Map(), digests = {};
for (const name of ['primitive', 'corpus']) {
  const directory = join(work, name);
  run('cargo', ['build', '--locked', '--offline', '--release', '--manifest-path',
    join(directory, 'Cargo.toml')], directory, {CARGO_TARGET_DIR: join(directory, 'target')});
  const bytes = readFileSync(join(directory, 'target/wasm32-unknown-unknown/release',
    `cbor_${name}_conformance.wasm`));
  const module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const exports = WebAssembly.Module.exports(module);
  for (const [name, kind] of [['memory', 'memory'], ['holo_alloc', 'function'], ['holo_run', 'function']]) {
    assert.equal(exports.filter(row => row.name === name && row.kind === kind).length, 1);
  }
  modules.set(name, module); digests[name] = sha(bytes);
}
let invocations = 0, highWaterPages = 0;
function execute(name, input, inputMaximum, outputMaximum, caseId) {
  assert.ok(input instanceof Uint8Array && input.length <= inputMaximum);
  const instance = new WebAssembly.Instance(modules.get(name), {});
  const {memory, holo_alloc: allocate, holo_run: run} = instance.exports;
  const pointer = allocate(input.length) >>> 0;
  assert.ok(pointer + input.length <= memory.buffer.byteLength);
  new Uint8Array(memory.buffer, pointer, input.length).set(input);
  let packed;
  try { packed = BigInt.asUintN(64, run(pointer, input.length)); }
  catch (cause) { throw new Error(`CBOR Wasm trap: ${caseId}; input=${input.length}; pages=${memory.buffer.byteLength / 65536}`, {cause}); }
  const offset = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
  assert.ok(length <= outputMaximum && offset + length <= memory.buffer.byteLength);
  assert.ok(memory.buffer.byteLength <= maximumPages * 65536);
  highWaterPages = Math.max(highWaterPages, memory.buffer.byteLength / 65536);
  invocations++;
  return Buffer.from(new Uint8Array(memory.buffer, offset, length));
}
// Indices below256 use the independent RFC8949 integer examples/rules. The
// generated dispatcher executes the entire indexed typed corpus, not a subset.
for (let selected = 0; selected < index.roots.length; selected++) {
  const input = selected < 24 ? [selected] : [24, selected];
  assert.deepEqual(execute('corpus', Uint8Array.from(input), 5, 1, index.roots[selected]), Buffer.from([0xf5]), index.roots[selected]);
}
for (const input of [[], [0x18, 0], [0, 0], [0x1a, 255, 255, 255, 255], [0xf4]]) {
  assert.deepEqual(execute('corpus', Uint8Array.from(input), 5, 1, `rejected-dispatch:${input}`), Buffer.from([0xf4]));
}
let byteVectors = 0;
for (const row of index.cases) {
  if (row.kind !== 'accepted-primitive' && row.kind !== 'prefix-rejection'
      && row.kind !== 'whole-primitive-trailing') continue;
  const input = Buffer.from(row.hex, 'hex');
  const expected = row.kind === 'accepted-primitive' ? input : Buffer.alloc(0);
  assert.deepEqual(execute('primitive', input, 4_202_618, 4_202_617, row.id), expected, row.id);
  byteVectors++;
}
assert.equal(byteVectors, 71, 'complete direct ingress fixture set');
for (const name of ['primitive', 'corpus']) {
  const {holo_alloc: allocate} = new WebAssembly.Instance(modules.get(name), {}).exports;
  const cap = name === 'primitive' ? 4_202_618 : 5;
  assert.throws(() => allocate(cap + 1), WebAssembly.RuntimeError, 'actual allocator admission cap');
}
// Real ingress maximum-size byte and UTF8 values, not merely declared lengths
// or internally manufactured typed values. Literal independent CBOR headers.
for (const major of [0x5a, 0x7a]) {
  const input = Buffer.alloc(maximumPayload + 5, 0x61);
  input.set([major, 0, 0x40, 0x20, 0x74]);
  assert.deepEqual(execute('primitive', input, 4_202_618, 4_202_617, `maximum:${major}`), input);
  const excessive = Buffer.alloc(maximumPayload + 6, 0x61);
  excessive.set([major, 0, 0x40, 0x20, 0x75]);
  assert.deepEqual(execute('primitive', excessive, 4_202_618, 4_202_617, `maximum+1:${major}`), Buffer.alloc(0));
}
assert.equal(invocations, index.roots.length + 71 + 5 + 4, 'complete runtime case count');
assert.ok(highWaterPages >= 65 && highWaterPages <= maximumPages);
process.stdout.write(JSON.stringify({schema: 'prismpm/cbor-primitive-wasm/1',
  typed_roots: index.roots.length, byte_vectors: byteVectors, invocations,
  maximum_payload: maximumPayload, maximum_pages: maximumPages,
  observed_pages: highWaterPages, modules: digests, status: 'passed'}) + '\n');
