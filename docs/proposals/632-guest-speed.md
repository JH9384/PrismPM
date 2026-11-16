# Proposal 632: speed of generated guests, kernels under contract

| | |
| --- | --- |
| Issue | [#632](https://github.com/UOR-Foundation/PrismPM/issues/632) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental. Recommendation only; nothing is implemented until the LexLean contract feature it depends on lands. |
| Depends on | #629 (the session world), LexLean "contracts for external code" (in progress upstream) |
| Measurements | [`632-guest-speed/RESULTS.md`](632-guest-speed/RESULTS.md), with every source and script of the spike |

## Summary

A guest generated from LexLean computes an int8 dot product at about 0.6 GMAC/s, 22 to 24 times slower than a SIMD128 kernel in the same module and about 65 times slower than native AVX-512.
The cause is not the missing `+simd128` flag: generated code checks every addition for overflow, and that check stops LLVM from vectorising at any optimisation level.
This proposal compares two routes, code generation that reaches SIMD from LexLean loops and a closed set of kernels under stated contracts, and recommends the second in a narrow form: **compiler kernels**, a small registry of generic integer kernels that the generator links into the guest in place of a LexLean reference definition, each held to that definition by a contract the model's proofs use and by an executable equivalence check.
The guest stays import-free and deterministic, and no application code enters it.
Threads are not recommended for now: on stable Rust they require an imported shared memory, which ends the import-free world, and a scheduler the model cannot see.

## Motivation

An inference engine spends almost all its time in integer dot products and matrix-vector products.
A verified engine written in LexLean is useful as the reference a fast engine is checked against only if it runs at a speed where that check is practical; at 0.6 GMAC/s a one-billion-MAC token takes about 1.6 seconds.

### Goals

1. Measure, on an int8 dot product and a 4096 × 4096 matrix-vector product, what each route buys.
2. Recommend one route and state what makes it sound.
3. Keep every property the guest has today: import-free, deterministic, generated only, every behavior the model's.

### Non-goals

- Floating point. Every kernel here is integer, so its result is exact and the same on every engine.
- `relaxed-simd`. Its integer dot product may differ by engine, so it would break replay; it is refused.
- A hand-written engine. That is the fast engine this one checks, outside any holo.

## The spike

All variants ran in Node 22 (V8 12.4) on an AMD Ryzen AI Max 390, built with rustc 1.97.1 (LLVM 22.1.6) under the shipped guest profile (`opt-level = "s"`, LTO, one codegen unit, `panic = "abort"`) unless stated.
Every result was compared with a reference on fixed-seed data. Medians of 11 samples, median of 3 runs; run-to-run noise is about ±20%.

| Variant | Opt | Features | ns per MAC, matvec | GMAC/s | v128 ops |
| --- | --- | --- | ---: | ---: | ---: |
| Generated-style: tail loop, checked index, `checked_mul`, `checked_add` | s | none | 1.62 | 0.62 | 0 |
| Same | s | `simd128` | 1.55 | 0.65 | 0 |
| Same | 3 | `simd128` | 1.75 | 0.57 | 0 |
| Same loop, wrapping arithmetic | 3 | `simd128` | 0.228 | 4.38 | 12 |
| Chunked: wrapping inside chunks that cannot overflow, i64 between them | 3 | `simd128` | 0.232 | 4.30 | 12 |
| Kernel in the module: `i16x8.extend` and `i32x4.dot_i16x8_s` | s | `simd128` | 0.074 | 13.6 | 41 |
| Kernel in the module, 1 M-element dot | s | `simd128` | 0.066 | 15.1 | 41 |
| Kernel provided by the JavaScript host as an import | s | none | 1.58 | 0.63 | n/a |
| Native x86-64, AVX-512 (`target-cpu=native`) | 3 | native | 0.025 | 40.1 | n/a |
| Kernel in the module, shared memory, 8 workers | s | `simd128`, `atomics` | 0.015 | 64.7 | 41 |

What the numbers say:

1. **Checked arithmetic blocks vectorisation.** LLVM removes the multiplication check, since an i8 product always fits i32, but keeps the addition check as a loop exit. The generated-style loop has no v128 instruction at any opt-level, with or without `simd128`.
2. **`simd128` alone buys nothing in the shipped profile.** At opt-level `s` even wrapping code is not vectorised; the hot code needs opt-level 3.
3. **A proof that the sum cannot overflow is worth 7×.** Wrapping, or chunked arithmetic that provably cannot overflow, vectorises at opt-level 3 four lanes at a time: about 4.4 GMAC/s.
4. **A kernel is worth another 3×.** The `i32x4.dot_i16x8_s` kernel reaches 13.6 to 15.1 GMAC/s, 22 to 24× the generated-style loop. A generator that emitted it for a recognised loop would land on the same numbers, because it would be the same code.
5. **A host import buys nothing from JavaScript.** A JavaScript kernel runs at the speed of the checked wasm loop, and each call costs about 140 ns against 28 ns for an in-module call. Only a native host kernel would be faster (about 3× wasm SIMD here), and Node cannot host one without an addon.
6. **Threads scale, at a price.** Eight workers reached 4.5× one worker. The module had to import its memory as shared, export its stack pointer, and be instantiated once per worker; `-Zbuild-std` is refused on stable, so this works only while the guest itself uses no atomics. `wasm32-wasip1-threads` builds on stable but Node's WASI cannot spawn its threads.

### The overflow bound a kernel must respect

The largest i8 product in magnitude is (−128)(−128) = 16384, and it is the only one that large.
An i32 sum of *n* products therefore cannot overflow when *n* ≤ ⌊(2³¹ − 1) / 16384⌋ = 131 071; at *n* = 131 072 it can reach exactly 2³¹.
Generated checked code traps when any partial sum leaves i32. A kernel that adds in another order, or in i64 between chunks, traps only when the final sum does.
The two agree for every input only when *n* ≤ 131 071.
A contract must therefore either require that bound or define the kernel's result as the exact integer sum converted to i32 with one final check, and the LexLean reference must be written the same way.

## Options

### Option 1: generate SIMD from LexLean loops

`prod-codegen` would recognise loop shapes in the IR (a fold over two byte arrays with a multiply-add) and emit either chunked wrapping arithmetic or the SIMD kernel directly, at opt-level 3 for those functions.

- What it needs: a loop recogniser in a generic compiler; a proof, available to the generator, that the chunked arithmetic cannot overflow (the bound above), or a reference written so that the order of addition does not matter; opt-level 3 per function, which Rust does not offer, so either the whole guest at opt-level 3 (larger and slower to build) or kernels split into a separate codegen unit.
- What it buys: up to 4.4 GMAC/s from autovectorisation, 13.6 to 15 with an emitted kernel.
- Risk: a recogniser is a semantic transformation inside the compiler, and its correctness is everything. It belongs upstream in `lean4-prod` as generic compiler functionality, and its acceptance needs the same differential evidence as option 2 for every shape it recognises.

### Option 2: kernels under contract

A closed registry of kernels, each a LexLean reference definition plus an implementation the generator links into the guest when the model calls the reference.

- Linked into the module (recommended): the guest stays import-free, the call costs 28 ns, and the kernel is the same wasm on every host.
- Provided by the host as an import (not recommended): ends the import-free world, costs about 140 ns a call, gains nothing on a JavaScript host, and makes the guest's result depend on code outside the holo that no proof or digest covers.

### Option 3: threads

Data-parallel kernels over a shared memory are deterministic when each worker writes a disjoint range and the host joins them before the step returns. But the module must import its memory, which is a new world with an import; the host must spawn and join workers the model does not describe; and on stable Rust the guest cannot use atomics itself. Deferred until a world with imported shared memory is otherwise needed.

## Recommendation: compiler kernels

Option 2, linked into the module, in this exact form:

1. **A closed kernel registry**, `prismpm/kernels/1`, in the SDK, never per application. Each row names a kernel (`dot_i8_i32`, `matvec_i8_i32`, `add_i32`), its LexLean reference definition in `prism-stdlib`, its signature, its preconditions (for example equal lengths, *n* ≤ 131 071 for an i32 accumulator) and the digest of its implementation.
2. **The reference is the specification.** The model calls the reference definition, so every proof about the model is a proof about the reference. LexLean's "contracts for external code" lets the model's proofs use the contract's postcondition, the reference's value, without unfolding the kernel.
3. **The implementation is generic compiler output, not application code.** It is a fixed template in the guest generator, like the session shim of #629, selected by the reference's name. Its source is digested, reviewed once, and identical in every guest that uses it.
4. **Equivalence is executable evidence, not a claim.** For every kernel, conformance runs the generated scalar reference and the kernel on an exhaustive corpus of short inputs (every pair of i8 vectors of length 0 and 1, 2¹⁶ cases, and every lane position of a full vector), on the bound (*n* = 131 071 of −128s), and on a seeded random corpus up to the maximum length, and refuses a kernel whose result or whose trap differs on any input. A planted defect, a kernel that drops the last partial lane, must be rejected.
5. **Only integer SIMD128.** `relaxed-simd`, floating point and threads are refused by the guest validator, which already inspects every guest binary.
6. **The proof does not cover the kernel.** The verdict says so: the inspection of a holo lists the kernels it links by name and digest, and the assurance level documents them as trusted computing base, the same way the Rust compiler and the Wasm engine already are.

Why this over option 1: it buys the same 13.6 to 15 GMAC/s with a much smaller trusted addition (a handful of reviewed kernels instead of a loop recogniser over arbitrary IR), it needs no change to the generic compiler, and the model's proofs see exactly what they see today. Option 1 remains the right long-term direction upstream, and the registry's corpora are the evidence a recogniser would need.

## What is implemented now

Nothing in the guest generator, deliberately.
The recommendation is sound only once the model side exists: without LexLean's contract for external code, a model cannot call a reference that the generator substitutes without the proofs and the generated code silently diverging in meaning.
This pull request adds the proposal and the spike's sources and results, so the measurements can be reproduced and challenged.

## Test plan, once implemented

- A registry row without a reference, a contract or an equivalence corpus is refused by the registry validator.
- Each kernel passes its exhaustive, bound and random corpora against the generated scalar reference; a planted defect in each kernel is rejected.
- A guest that links a kernel not in the registry, imports anything, or uses `relaxed-simd`, atomics or floating point is refused by the guest validator.
- A holo's inspection lists its kernels by name and digest; replay of the session fixture of #629 and the dot-product fixture of #630 gives the same history with and without kernels.

## Graduation criteria

- Experimental: the registry with `dot_i8_i32`, its contract in LexLean, its corpora and the validator.
- Beta: the engine fixture runs on kernels with an unchanged history, and a second runtime (Wasmtime) reproduces it.
- Stable: the registry's row shape and the evidence it requires are final.

## Precedent

- Lean's `@[implemented_by]` and `@[extern]`: a reference definition with a faster implementation. Not copied: Lean trusts the implementation without evidence; here the substitution is closed, reviewed and checked against the reference on every build.
- CompCert's builtins and seL4's trusted assembly: small, named, reviewed components outside the proof, listed as such.
- BLAS: a small set of kernels everything else is written against.

## Alternatives

Options 1 and 3 above, and leaving the generated code as it is. The last costs nothing and keeps the engine at 0.6 GMAC/s; it is acceptable for a reference engine on small models only.

## Unresolved questions

1. The LexLean contract feature is being added in the LexLean repository. Its final shape decides how the reference and the contract are written; this proposal assumes the model can state "this definition is implemented externally under this pre- and postcondition" and that proofs use the postcondition.
2. Should kernel guests be built at opt-level 3? The kernels are explicit SIMD and need no autovectorisation, so `s` suffices for them (measured: 13.6 GMAC/s at `s`); the rest of the guest keeps `s`.
3. Which runtimes must reproduce a kernel's result before it is admitted? V8 is measured here; Wasmtime and the pinned `hologram-live` executor should be added.
4. Threads: if a later world imports a shared memory, a deterministic data-parallel form (disjoint writes, a join before the step returns) could be added as a kernel attribute. Not proposed now.
