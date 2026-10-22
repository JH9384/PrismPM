import assert from 'node:assert/strict';
import {inspectEffectModule} from '../../sdk/browser/effects-module.mjs';

export function executeWasm(bytes, rows) {
  const memory = inspectEffectModule(bytes, 16384), module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  let maximumBytes = 0;
  const allocationRefusals = [];
  for (const row of rows) for (let repeat = 0; repeat < 2; repeat++) {
    const instance = new WebAssembly.Instance(module, {});
    if (row.request.length > 67108864) {
      assert.equal(row.request.length, 67108865, 'registered one-over allocation probe');
      assert.throws(() => instance.exports.holo_alloc(row.request.length), WebAssembly.RuntimeError,
        row.id + ' actual generated Wasm allocator must refuse before execution');
      allocationRefusals.push({id: row.id, repeat, inputBytes: row.request.length,
        observedException: 'WebAssembly.RuntimeError'});
      continue;
    }
    const start = instance.exports.holo_alloc(row.request.length) >>> 0;
    assert.ok(start + row.request.length <= instance.exports.memory.buffer.byteLength);
    new Uint8Array(instance.exports.memory.buffer, start, row.request.length).set(row.request);
    let result;
    try { result = BigInt.asUintN(64, instance.exports.holo_run(start, row.request.length)); }
    catch (error) { throw new Error(row.id + ' actual generated Wasm trap at ' + instance.exports.memory.buffer.byteLength + ' bytes', {cause: error}); }
    const at = Number(result >> 32n), length = Number(result & 0xffffffffn);
    assert.ok(length <= 67108864 && at + length <= instance.exports.memory.buffer.byteLength);
    const actual = Buffer.from(new Uint8Array(instance.exports.memory.buffer, at, length));
    assert.ok(actual.equals(Buffer.from(row.response)), row.id + ' generated Wasm output mismatch: ' + (length < 32 ? actual.toString('hex') : length));
    maximumBytes = Math.max(maximumBytes, instance.exports.memory.buffer.byteLength);
    assert.ok(maximumBytes <= memory.maximumPages * 65536);
  }
  const over = new WebAssembly.Instance(module, {});
  assert.throws(() => over.exports.holo_alloc(67108865), WebAssembly.RuntimeError);
  assert.throws(() => over.exports.memory.grow(memory.maximumPages), RangeError);
  return {maximumBytes, declaredPages: memory.maximumPages, allocationRefusals};
}
