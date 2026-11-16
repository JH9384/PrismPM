# Spike D: int8 dot product / matvec — generated SIMD vs external kernels

Date 2026-11-12. All numbers measured in this spike; nothing is extrapolated.

## Setup

CPU: AMD RYZEN AI MAX 390 w/ Radeon 8050S (24 logical CPUs on Windows; Zen 5, has AVX2, AVX-512 BW/VNNI, AVX-VNNI). Laptop; power/turbo state not controlled.
Wasm host: Node v22.21.0, V8 12.4.254.21-node.33, Windows 11.
Compiler: rustc 1.97.1 (8bab26f4f 2026-07-14), LLVM 22.1.6, stable, in docker image `rust:1.97.1` (WSL2 Linux VM, 12 vCPU). Native benches ran in that container.
Guest profile (all wasm variants): `#![no_std]` cdylib, `wasm32-unknown-unknown`, `lto = true`, `codegen-units = 1`, `panic = "abort"`; opt-level `s` (as shipped) or `3`; target features none or `+simd128`.
Data: fixed-seed xorshift bytes, interpreted as i8. Dot lengths 4096 and 1,048,576; matvec 4096x4096 i8 matrix times i8 vector to i32 vector.
Timing: warm-up 5 calls, then 11 samples (each sample loops 2000/8/2 calls for n=4096 / n=1M / matvec), median sample. The whole wasm suite was run 3 times; the table shows the median of the 3 medians and the min-max across runs. Native: median of 11 samples, one run.
Correctness: every wasm variant and every row of every matvec was compared with a JS reference (exact sum in doubles) and the bench throws on mismatch; all passed (dot n=4096 = -419206, n=1M = 5836340). Native variants agree with each other (n=4096 = 361613, n=1M = 9959798, matvec checksum 16163209; different RNG from the JS bench).
1 MAC = one i8*i8 multiply-add. GMAC/s = elements / ns. Dot input bandwidth = 2 bytes per MAC.

## Variants (sources in this directory)

a `checked`: generated-style. Tail recursion `go a b i acc` lowered to a loop, `slice.get(i)` returning Err, `checked_mul`, `checked_add`, `checked_add(1)` on the index; Err traps (`unreachable`). `kernels.rs::dot_checked`.
`wrap`: same loop shape and bounds checks, wrapping mul/add. `dot_wrap`.
`iter`: idiomatic zip/fold with wrapping add, length check hoisted. `dot_iter`.
`chunk`: "proof-aware" generated shape: wrapping i32 inside chunks of 65,536 terms (provably cannot overflow), chunk sums in i64, one final range check. `dot_chunk`.
b: each of the above compiled with `-C target-feature=+simd128`, at opt-level s and 3.
c `simd`: hand-written SIMD128 kernel in the same module (`guest/src/lib.rs`, mod `simd`). `[dot_i16x8]`: `i16x8.extend_{low,high}_i8x16_s` then `i32x4.dot_i16x8_s`, 32 bytes per iteration, two accumulators. `[extmul]`: `i16x8.extmul_{low,high}_i8x16_s` then `i32x4.extadd_pairwise_i16x8_s`. Both chunk at 65,536 and fold in i64 with a final range check.
d `host`: guest export calls an `env` import implemented as a plain JS loop over `Int8Array` views of guest memory (zero copy). Matvec measured both as 4096 per-row host calls and as one host call.
e native x86_64: same `kernels.rs`, opt-level 3, LTO, default target (x86-64 baseline, SSE2) and `-C target-cpu=native`.
f threads: guest built on stable with `+atomics,+bulk-memory,+simd128`, `--shared-memory --import-memory`, `--export=__stack_pointer`; Node worker_threads, one instance per worker on one shared `WebAssembly.Memory`, each worker given its own 64 KiB shadow stack; matvec rows split across workers (`threads.mjs`).

## Results: wasm in Node 22 (median of 3 runs; ns/elem = ns per MAC)

| variant | opt | features | dot 4096 ns/elem | dot 1M ns/elem | matvec ns/elem | matvec GMAC/s | v128 ops in code | .wasm bytes |
|---|---|---|---:|---:|---:|---:|---|---:|
| a checked | s | none | 1.93 (1.58-2.13) | 1.59 (1.45-1.81) | 1.62 (1.37-1.69) | 0.62 | 0 | 771 |
| b checked | s | simd128 | 1.46 (1.41-1.60) | 1.45 (1.30-1.61) | 1.55 (1.55-1.86) | 0.65 | 0 | 780 |
| checked | 3 | none | 1.48 (1.47-1.61) | 1.67 (1.64-1.78) | 1.60 (1.39-1.75) | 0.62 | 0 | 763 |
| b checked | 3 | simd128 | 1.81 (1.46-1.88) | 1.58 (1.58-1.69) | 1.75 (1.48-1.88) | 0.57 | 0 | 772 |
| wrap | s | none | 0.90 | 0.88 | 0.78 | 1.28 | 0 | 737 |
| wrap | s | simd128 | 0.85 | 0.88 | 0.80 | 1.25 | 0 | 746 |
| wrap | 3 | none | 0.78 | 0.79 | 0.83 | 1.20 | 0 | 727 |
| b wrap | 3 | simd128 | 0.238 | 0.224 | 0.228 | 4.38 | 12 (VF 4) | 971 |
| iter | s | simd128 | 0.69 | 0.68 | 0.70 | 1.42 | 0 | 755 |
| iter | 3 | none | 0.63 | 0.64 | 0.69 | 1.44 | 0 | 886 |
| b iter | 3 | simd128 | 0.261 | 0.225 | 0.230 | 4.35 | 12 (VF 4) | 941 |
| chunk | s | simd128 | 0.69 | 1.04 | 0.74 | 1.35 | 0 | 900 |
| chunk | 3 | none | 0.58 | 0.58 | 0.64 | 1.57 | 0 | 1040 |
| b chunk | 3 | simd128 | 0.245 | 0.229 | 0.232 | 4.30 | 12 (VF 4) | 1079 |
| c simd [dot_i16x8] | s | simd128 | 0.074 (0.069-0.086) | 0.066 (0.063-0.069) | 0.074 (0.074-0.075) | 13.6 | 41 (both kernels) | 1780 |
| c simd [extmul] | s | simd128 | 0.103 | 0.093 | 0.090 | 11.1 | (same module) | 1780 |
| c simd [dot_i16x8] | 3 | simd128 | 0.076 | 0.068 | 0.070 | 14.3 | 67 | 2102 |
| c simd [extmul] | 3 | simd128 | 0.096 | 0.100 | 0.100 | 10.0 | (same module) | 2102 |
| d host JS import | s | none | 1.67 | 1.77 (1.48-2.69) | 1.58 (4096 calls) / 1.53 (1 call) | 0.63 / 0.65 | n/a | 609 |

Best wasm dot throughput: hand SIMD128 `[dot_i16x8]` at 15.1 GMAC/s (30 GB/s input) for n=1M.
Call overhead, dot n=16, including the JS-to-wasm call made by the bench: in-module SIMD kernel 28 ns per call; host JS import 143 ns per call (124-156). So one wasm-to-JS import crossing plus `Int8Array` view creation costs roughly 100 ns.
Byte sizes are whole modules (one exported dot plus matvec each); `simd` modules contain both SIMD kernels.

## Results: native x86_64 (opt-level 3, LTO; median of 11)

| variant | target | dot 4096 ns/elem | dot 1M ns/elem | matvec ns/elem | matvec GMAC/s |
|---|---|---:|---:|---:|---:|
| checked | default | 0.610 | 0.597 | 0.567 | 1.76 |
| wrap | default | 0.168 | 0.170 | 0.180 | 5.55 |
| iter | default | 0.178 | 0.179 | 0.174 | 5.75 |
| chunk | default | 0.160 | 0.175 | 0.186 | 5.38 |
| checked | native | 0.726 | 0.602 | 0.574 | 1.74 |
| wrap | native | 0.026 | 0.021 | 0.068 | 14.6 |
| iter | native | 0.026 | 0.023 | 0.025 | 40.1 |
| chunk | native | 0.020 | 0.021 | 0.033 | 30.4 |

## Results: threads (shared memory, stable toolchain, Node workers; hand SIMD `[dot_i16x8]` matvec)

| workers | matvec ms (median of 3 runs; range) | ns/elem | GMAC/s | speedup vs 1 worker |
|---:|---:|---:|---:|---:|
| 1 | 1.16 (1.13-1.32) | 0.069 | 14.5 | 1.0x |
| 2 | 0.66 (0.62-0.77) | 0.039 | 25.4 | 1.8x |
| 4 | 0.48 (0.39-0.57) | 0.028 | 35.3 | 2.4x |
| 8 | 0.26 (0.23-0.30) | 0.015 | 64.7 | 4.5x |

Each dispatch runs 8 matvecs to amortise wake-up latency; the time is per matvec. Every row of every result was checked against the reference.

## Findings

Overflow checks block autovectorisation. In the `checked` asm (`out/checked_O3_simd128.s`) LLVM folded `checked_mul` away (i8*i8 provably fits i32), but the `checked_add` overflow test stays as a loop exit, and LLVM 22's loop vectoriser does not vectorise it: zero v128 instructions at any opt-level, and timing equals the no-SIMD build.
Wrapping alone is enough for vectorisation at opt-level 3: `wrap` vectorised even with per-element `slice.get` bounds checks (LLVM hoists them via runtime checks), as did `iter` and `chunk`.
Opt-level `s` never vectorises, even wrapping code with `+simd128` (rustc disables the loop vectoriser at `s`/`z`). The shipped profile therefore gets no SIMD from `+simd128` alone; the guest needs opt-level 2 or 3 for the hot code (+~200-300 bytes per kernel here).
The autovectoriser's code is weak: vector factor 4 (`v128.load32_zero`, `i16x8.extend_low`, `i32x4.extmul_low_i16x8`), i.e. 4 bytes per iteration, giving ~4.4 GMAC/s. The hand kernel processes 32 bytes per iteration with `i32x4.dot_i16x8_s` and reaches ~14-15 GMAC/s, about 3.1-3.4x faster than the best autovectorised code and about 22-24x faster than the checked generated code.
`[dot_i16x8]` beats `[extmul]` by about 1.3-1.4x on this V8/CPU.
The JS host-import kernel performs like the checked scalar wasm (about 0.6 GMAC/s): crossing to the host costs about 100 ns per call, negligible at 4096 elements, but a plain JS loop is no faster than scalar wasm. A host kernel only wins if the host implements it natively (e.g. a Rust/AVX-512 host function in a Wasmtime-style embedder); native AVX-512 reaches 40-47 GMAC/s, about 3x the wasm SIMD128 kernel. That native-host-import path was not measured (Node cannot host a native import without an addon).
Native default-target (SSE2) code is also weak (5.6 GMAC/s); the AVX-512 gain is from `target-cpu=native`, which a portable wasm module cannot express.

## Exact i32 accumulation bound

For i8 x, y: max x*y = (-128)(-128) = 16384, min x*y = (-128)(127) = -16256. So |x*y| <= 16384.
An i32 sum of n products cannot overflow iff n*16384 <= 2^31-1 on the positive side (n*16256 <= 2^31 on the negative side is weaker): n <= floor(2147483647/16384) = 131071. At n = 131072 all-(-128) inputs give exactly 2^31, which overflows.
One product fits i16 (16384 <= 32767), but the sum of two can be 32768, so i16 accumulation is unsafe beyond one term; `i32x4.dot_i16x8_s` adds pairs in i32, so it is safe.
Within the SIMD kernel each i32 lane of each accumulator receives at most 65536/8 = 8192 products per 65,536-byte chunk (<= 2^27 in magnitude), and the whole chunk sum is <= 2^30, so lane and horizontal sums are exact; chunk sums are folded in i64.
Semantic caveat: generated `checked` code traps if any prefix sum leaves i32; the `chunk` and SIMD kernels trap only if the final exact sum leaves i32. They agree whenever n <= 131071 (neither can trap) and on all data used here; for longer vectors a kernel contract must state which semantics it implements (or specify the result as an exact Int that must fit i32).

## Threads feasibility on stable 1.97.1

`-Zbuild-std` is rejected on stable ("the -Z flag is only accepted on the nightly channel").
Despite that, the `#![no_std]` guest built and linked on stable with `-C target-feature=+atomics,+bulk-memory,+simd128 -C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--max-memory=1073741824 -C link-arg=--export=__stack_pointer`, instantiated against a shared `WebAssembly.Memory` in 1-8 Node workers, and produced correct matvec results with a 4.5x speedup at 8 workers.
Caveats: precompiled `core` is not built with `+atomics` (fine here because the kernel uses no atomics or core synchronisation); the guest has no way to spawn threads, so the host must spawn workers, instantiate one instance each, and assign each a distinct shadow stack via the exported `__stack_pointer` (otherwise instances share one stack region and corrupt each other); the module now imports its memory, so it is no longer import-free; no TLS.
`wasm32-wasip1-threads` is installable on stable (tier 2, prebuilt std) and a `std::thread::spawn` program compiled to a 106 KB module; it requires a WASI host implementing `wasi-thread-spawn` (Node's WASI does not), so it was not run.

## Caveats

Laptop timing noise is about +-20% between runs (ranges shown); ratios above 3x are robust, ratios under 1.3x are not.
The 16 MiB matvec matrix may be largely cache-resident on this CPU; DRAM-bound behaviour was not isolated.
`.s` files come from `--emit asm` of the crate (cgu=1); with no dependencies except `core` this matches the LTO output's hot loops, confirmed by timing.
The "generated-style" source is hand-written to imitate prod-codegen (Result-returning checked ops, `get`-based indexing); real generated code may differ (e.g. Nat-typed indices or helper calls), which would only add overhead.
The JS host kernel is a stand-in for crossing cost, not for the best host kernel.
Native benches ran in a WSL2 container; wasm benches ran on the Windows host.

## Files

`kernels.rs` (scalar kernels, shared), `guest/` (wasm crate; features select one variant), `native/` (native bench), `build.sh` (wasm build matrix + asm), `bench.mjs` (Node bench), `threads.sh`, `threads.mjs`, `out/*.wasm` and `out/*.s` (artifacts), `wasm_results*.txt`, `wasm_median.txt`, `native_results.txt`, `threads_results.txt` (raw output). Cargo target dirs were deleted.
