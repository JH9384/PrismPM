// f. Host-spawned threads over one shared memory: the stable-built no_std guest
// (+atomics,+bulk-memory,+simd128, imported shared memory) is instantiated once per
// worker; each worker gets its own shadow-stack region via the exported __stack_pointer.
// Matvec 4096x4096 rows are split across T workers; each dispatch runs ITER matvecs.
// Median of 11 runs after 5 warm-ups; reported per matvec.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const R = 4096, C = 4096, STACK = 1 << 16, ITER = 8; // ITER matvecs per dispatch
if (isMainThread) {
  const bytes = readFileSync(new URL('./out/simd_Os_shared.wasm', import.meta.url));
  const mod = new WebAssembly.Module(bytes);
  const mem = new WebAssembly.Memory({ initial: 17 + 2 * 1 + Math.ceil((R * C + C + 4 * R + 16 * STACK) / 65536) + 32, maximum: 16384, shared: true });
  // probe instance to learn where free memory starts (end of module's static data + stack)
  const probe = new WebAssembly.Instance(mod, { env: { memory: mem } });
  const base = (mem.buffer.byteLength - (R * C + C + 4 * R + 16 * STACK) - 65536) & ~0xffff;
  const stacks = base, pm = stacks + 16 * STACK, pv = pm + R * C, po = pv + C;
  let s = 0x12345678 >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s & 0xff; };
  const M = new Uint8Array(R * C).map(rnd), V = new Uint8Array(C).map(rnd);
  new Uint8Array(mem.buffer).set(M, pm); new Uint8Array(mem.buffer).set(V, pv);
  // single-thread reference via the probe instance's own stack
  const ref = new Int32Array(R);
  { const x = new Int8Array(M.buffer), y = new Int8Array(V.buffer); for (let r = 0; r < R; r++) { let t = 0; for (let i = 0; i < C; i++) t += x[r * C + i] * y[i]; ref[r] = t; } }
  const ctl = new Int32Array(new SharedArrayBuffer(16 * 4));
  const results = [];
  for (const T of [1, 2, 4, 8]) {
    Atomics.store(ctl, 0, 0); Atomics.store(ctl, 1, 0); Atomics.store(ctl, 2, 0);
    const ws = [];
    for (let k = 0; k < T; k++) {
      const r0 = Math.floor(k * R / T), r1 = Math.floor((k + 1) * R / T);
      ws.push(new Worker(fileURLToPath(import.meta.url), { workerData: { mod, mem, ctl, sp: stacks + (k + 1) * STACK, pm: pm + r0 * C, pv, po: po + 4 * r0, rows: r1 - r0 } }));
    }
    await Promise.all(ws.map((w) => new Promise((res, rej) => { w.once('message', res); w.once('error', rej); })));
    const times = [];
    for (let rep = 0; rep < 16; rep++) {
      new Int32Array(mem.buffer, po, R).fill(0);
      Atomics.store(ctl, 1, 0);
      const t = process.hrtime.bigint();
      Atomics.add(ctl, 0, 1); Atomics.notify(ctl, 0);
      while (Atomics.load(ctl, 1) < T) { /* spin */ }
      times.push(Number(process.hrtime.bigint() - t));
      const o = new Int32Array(mem.buffer, po, R);
      for (let r = 0; r < R; r++) if (o[r] !== ref[r]) throw new Error(`T=${T} row ${r}`);
    }
    Atomics.store(ctl, 2, 1); Atomics.add(ctl, 0, 1); Atomics.notify(ctl, 0);
    await Promise.all(ws.map((w) => new Promise((res) => w.once('exit', res))));
    const med = times.slice(5).sort((a, b) => a - b)[5] / ITER;
    results.push(`| simd_Os_shared [dot_i16x8], ${T} worker(s) | matvec 4096x4096 | ${med} | ${(med / (R * C)).toFixed(4)} | ${(R * C / med).toFixed(2)} |`);
  }
  console.log(results.join('\n'));
} else {
  const { mod, mem, ctl, sp, pm, pv, po, rows } = workerData;
  const inst = new WebAssembly.Instance(mod, { env: { memory: mem } });
  inst.exports.__stack_pointer.value = sp;
  parentPort.postMessage('ready');
  let gen = 0;
  for (;;) {
    Atomics.wait(ctl, 0, gen);
    gen = Atomics.load(ctl, 0);
    if (Atomics.load(ctl, 2)) break;
    for (let it = 0; it < ITER; it++) inst.exports.matvec(pm, pv, rows, C, po);
    Atomics.add(ctl, 1, 1);
  }
}
