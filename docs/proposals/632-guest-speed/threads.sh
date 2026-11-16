#!/bin/sh
# f. Threads feasibility on stable 1.97.1 (no nightly, no build-std).
cd /w/guest
export CARGO_TARGET_DIR=/w/target-thr
T=$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/guest.wasm
echo "== wasm32-unknown-unknown, no_std guest, +atomics,+bulk-memory, shared imported memory"
RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+simd128 -C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--max-memory=1073741824 -C link-arg=--export=__stack_pointer" \
  cargo build -q --release --target wasm32-unknown-unknown --features v_simd 2>&1 | grep -E "error|rust-lld" | head -8
echo "build exit: done"; ls -la $T 2>&1
cp $T /w/out/simd_Os_shared.wasm 2>/dev/null
echo "== -Zbuild-std on stable"
cargo build --release --target wasm32-unknown-unknown -Zbuild-std=core 2>&1 | head -1
echo "== wasm32-wasip1-threads"
rustup target add wasm32-wasip1-threads 2>&1 | tail -1
mkdir -p /tmp/thr/src && cd /tmp/thr
printf '[package]\nname="thr"\nversion="0.0.0"\nedition="2021"\n' > Cargo.toml
printf 'fn main(){ let h: Vec<_> = (0..4).map(|i| std::thread::spawn(move || i*2)).collect(); let s: i32 = h.into_iter().map(|h| h.join().unwrap()).sum(); println!("{s}"); }\n' > src/main.rs
CARGO_TARGET_DIR=/tmp/thr/target cargo build -q --release --target wasm32-wasip1-threads 2>&1 | tail -3
ls -la /tmp/thr/target/wasm32-wasip1-threads/release/thr.wasm 2>&1
