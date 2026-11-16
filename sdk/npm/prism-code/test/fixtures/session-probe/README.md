# Session ABI probe

A test input for the runtime's handling of the session world `hologram:guest/core-wasm@2` (issue #629).
It is never packaged in a holo and is not an application.

- `src/lib.rs` is the generated shim of `crates/prismpm/src/session_guest` around `entry.rs`, with the bounds request 64, state 256, response 256, response count 4, pages 2 and stack 16384. The Rust test `the_session_probe_is_the_generated_shim_around_its_test_entry` requires it to be byte for byte what the generator renders, and `.cargo/config.toml` and `Cargo.toml` to be the generator's.
- `entry.rs` stands in for a model's generated code: a counter and an accumulating buffer, and requests `0xf0` to `0xf4` that answer what the shim must refuse.
- `probe.wasm` is built from this directory alone, so Cargo finds no enclosing workspace:

```bash
docker run --rm -v "$PWD:/p" -w /p rust:1.97.1 bash -c 'rustup target add wasm32-unknown-unknown && CARGO_TARGET_DIR=/tmp/t cargo build --locked --offline --release && cp /tmp/t/wasm32-unknown-unknown/release/prism_session_probe_core_wasm.wasm probe.wasm'
```
