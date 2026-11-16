// Runs every wasm variant in Node: dot n=4096, n=1048576, matvec 4096x4096.
// Fixed-seed data, checked against a JS reference; median of 11 samples after warm-up.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');

let s = 0x12345678 >>> 0;
const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s & 0xff; };
const BIG = 1 << 20, R = 4096, C = 4096;
const A = new Uint8Array(BIG).map(rnd), B = new Uint8Array(BIG).map(rnd);
const M = new Uint8Array(R * C).map(rnd), V = new Uint8Array(C).map(rnd);

const ref = (a, b, n) => { let t = 0; const x = new Int8Array(a.buffer, a.byteOffset, n), y = new Int8Array(b.buffer, b.byteOffset, n); for (let i = 0; i < n; i++) t += x[i] * y[i]; return t; };
const refDot = { 4096: ref(A, B, 4096), [BIG]: ref(A, B, BIG) };
const refMv = new Int32Array(R); for (let r = 0; r < R; r++) refMv[r] = ref(M.subarray(r * C, (r + 1) * C), V, C);

// d. host-side kernels: plain JS loops over Int8Array views of guest memory.
let mem;
const env = {
  host_dot_i8(pa, pb, n) {
    const a = new Int8Array(mem.buffer, pa, n), b = new Int8Array(mem.buffer, pb, n);
    let acc = 0; for (let i = 0; i < n; i++) acc += a[i] * b[i];
    return acc | 0;
  },
  host_matvec_i8(pm, pv, rows, cols, pout) {
    const m = new Int8Array(mem.buffer, pm, rows * cols), v = new Int8Array(mem.buffer, pv, cols), o = new Int32Array(mem.buffer, pout, rows);
    for (let r = 0; r < rows; r++) { let acc = 0, base = r * cols; for (let i = 0; i < cols; i++) acc += m[base + i] * v[i]; o[r] = acc; }
  },
};

const median = (xs) => xs.sort((p, q) => p - q)[xs.length >> 1];
function time(f, reps) {
  for (let i = 0; i < 5; i++) f();
  const xs = [];
  for (let k = 0; k < 11; k++) { const t = process.hrtime.bigint(); for (let i = 0; i < reps; i++) f(); xs.push(Number(process.hrtime.bigint() - t) / reps); }
  return median(xs);
}

const variants = process.argv.slice(2).length ? process.argv.slice(2) : [
  'checked_Os_none', 'checked_Os_simd128', 'checked_O3_none', 'checked_O3_simd128',
  'wrap_Os_none', 'wrap_Os_simd128', 'wrap_O3_none', 'wrap_O3_simd128',
  'iter_Os_none', 'iter_Os_simd128', 'iter_O3_none', 'iter_O3_simd128',
  'chunk_Os_none', 'chunk_Os_simd128', 'chunk_O3_none', 'chunk_O3_simd128',
  'simd_Os_simd128', 'simd_O3_simd128', 'host_Os_none'];

const rows = [];
for (const v of variants) {
  const bytes = readFileSync(join(out, v + '.wasm'));
  const { instance } = await WebAssembly.instantiate(bytes, { env });
  const ex = instance.exports; mem = ex.memory;
  const base = mem.buffer.byteLength;
  const need = 2 * BIG + R * C + C + 4 * R + 64;
  mem.grow(Math.ceil(need / 65536));
  const pa = base, pb = pa + BIG, pm = pb + BIG, pv = pm + R * C, po = pv + C;
  const u8 = new Uint8Array(mem.buffer);
  u8.set(A, pa); u8.set(B, pb); u8.set(M, pm); u8.set(V, pv);
  const fams = [['dot', 'matvec']];
  if (ex.dot2) fams.push(['dot2', 'matvec2']);
  else if (ex.matvec2) fams.push([null, 'matvec2']);
  for (const [d, mv] of fams) {
    const name = v + (v.startsWith('simd') ? (d === 'dot2' ? ' [extmul]' : ' [dot_i16x8]') : '');
    if (d) {
    const unused =`${v}${d === 'dot2' ? (v.startsWith('simd') ? ' [extmul]' : '') : (v.startsWith('simd') ? ' [dot_i16x8]' : '')}`;
    for (const n of [4096, BIG]) {
      const got = ex[d](pa, pb, n);
      if (got !== refDot[n]) throw new Error(`${name} n=${n}: ${got} != ${refDot[n]}`);
      const ns = time(() => ex[d](pa, pb, n), n === 4096 ? 2000 : 8);
      rows.push({ variant: name, op: `dot n=${n}`, result: got, ns, nsPerElem: ns / n, gmacs: n / ns, gbs: 2 * n / ns });
    }
    }
    if (ex[mv]) {
      new Int32Array(mem.buffer, po, R).fill(0);
      ex[mv](pm, pv, R, C, po);
      const o = new Int32Array(mem.buffer, po, R);
      for (let r = 0; r < R; r++) if (o[r] !== refMv[r]) throw new Error(`${name} matvec row ${r}`);
      const label = v.startsWith('host') ? (mv === 'matvec' ? 'matvec (4096 host calls)' : 'matvec (1 host call)') : 'matvec 4096x4096';
      const ns = time(() => ex[mv](pm, pv, R, C, po), 2);
      rows.push({ variant: name, op: label, result: 'ok', ns, nsPerElem: ns / (R * C), gmacs: R * C / ns, gbs: (R * C + C) / ns });
    }
  }
  // per-call crossing cost: tiny n
  if (v.startsWith('host') || v === 'simd_Os_simd128') {
    const ns = time(() => ex.dot(pa, pb, 16), 200000);
    rows.push({ variant: v, op: 'dot n=16 (call overhead)', result: ex.dot(pa, pb, 16), ns, nsPerElem: ns / 16, gmacs: 16 / ns, gbs: 32 / ns });
  }
}
console.log(`node ${process.version} v8 ${process.versions.v8}`);
console.log('refs', refDot[4096], refDot[BIG]);
console.log('| variant | op | ns/call | ns/elem | GMAC/s | GB/s |');
console.log('|---|---|---:|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.variant} | ${r.op} | ${r.ns.toFixed(0)} | ${r.nsPerElem.toFixed(4)} | ${r.gmacs.toFixed(2)} | ${r.gbs.toFixed(2)} |`);
