// Execution of recorded requests through the Core-Wasm entry, for `prismpm replay` (issue #284).
// The loop is the one prism-code's runGuest runs, and the error codes are its codes, so both
// runtimes record and compare the same outcomes. Nothing is decoded; every outcome is bytes.
import {readFileSync, writeFileSync} from 'node:fs';

const [wasmPath, planPath, outcomesPath] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const hex = value => Buffer.from(value, 'hex');

const module = await WebAssembly.compile(readFileSync(wasmPath));
if (WebAssembly.Module.imports(module).length !== 0) {
  throw new Error('a guest with imports cannot be replayed here; prism-code replay links them against a capability set');
}

function dispatch(request) {
  if (request.length > plan.guest_allocation_maximum) return {error: 'core.allocation'};
  try {
    // A fresh instance per request: the guest allocator never frees.
    const {exports: guest} = new WebAssembly.Instance(module, {});
    const at = guest.holo_alloc(request.length) >>> 0;
    new Uint8Array(guest.memory.buffer, at, request.length).set(request);
    const packed = BigInt.asUintN(64, guest.holo_run(at, request.length));
    const offset = Number(packed >> 32n);
    const size = Number(packed & 0xffffffffn);
    if (offset + size > guest.memory.buffer.byteLength) return {error: 'core.response'};
    return {response: Buffer.from(new Uint8Array(guest.memory.buffer, offset, size)).toString('hex')};
  } catch {
    // A trap has no stable message, so it has one code.
    return {error: 'core.trap'};
  }
}

writeFileSync(outcomesPath, JSON.stringify(plan.requests.map(request => dispatch(hex(request)))));
