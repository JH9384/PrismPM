# Spike: int8 dot product, generated-style wasm against kernels

The measurements behind [proposal 632](../632-guest-speed.md). This folder is evidence, not part of any build or any guest: nothing in the repository compiles or links it.

- `RESULTS.md`: method, every number, caveats.
- `kernels.rs`: the dot-product variants (generated-style checked, wrapping, chunked) and the matvec.
- `guest/`: the wasm guest crate, one feature per variant, and a hand-written SIMD128 kernel as the stand-in for a compiler kernel.
- `native/`: the same kernels natively, for reference.
- `build.sh`, `threads.sh`: build every variant inside `rust:1.97.1` with this folder mounted at `/w`.
- `bench.mjs`, `threads.mjs`: run them in Node 22 and check every result against a reference.
- `*_results*.txt`, `wasm_median.txt`: the raw output of the runs in `RESULTS.md`.
