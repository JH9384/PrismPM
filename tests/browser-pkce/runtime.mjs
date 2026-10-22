import assert from 'node:assert/strict';

export async function executeWasm(bytes, rows) {
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  let maximum = 0;
  for (const row of rows) for (let repeat = 0; repeat < 2; repeat++) {
    const instance = new WebAssembly.Instance(module, {}), {memory, holo_alloc, holo_run} = instance.exports;
    assert.ok(memory instanceof WebAssembly.Memory);
    const start = holo_alloc(row.request.length) >>> 0;
    assert.ok(start + row.request.length <= memory.buffer.byteLength);
    new Uint8Array(memory.buffer, start, row.request.length).set(row.request);
    const packed = BigInt.asUintN(64, holo_run(start, row.request.length));
    const at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
    assert.ok(at + length <= memory.buffer.byteLength && length <= 129);
    assert.deepEqual(Buffer.from(new Uint8Array(memory.buffer, at, length)), row.response, row.id + ' Wasm output mismatch');
    maximum = Math.max(maximum, memory.buffer.byteLength);
    assert.ok(maximum <= 4194304, 'unchanged PKCE Wasm memory bound');
  }
  return {cases: rows.length, invocations: rows.length * 2, maximum};
}
