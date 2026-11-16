#!/bin/sh
# Runs inside rust:1.97.1 with the scratch dir at /w. Builds each guest variant
# under {opt-level s, 3} x {no target features, +simd128}, and emits wasm asm text.
set -eu
cd /w/guest
export CARGO_TARGET_DIR=/w/target-guest
mkdir -p /w/out
for opt in s 3; do
  for feat in none simd128; do
    if [ "$feat" = none ]; then RF=""; else RF="-C target-feature=+simd128"; fi
    for v in checked wrap iter chunk simd host; do
      if [ "$v" = simd ] && [ "$feat" = none ]; then continue; fi
      if [ "$v" = host ] && { [ "$feat" != none ] || [ "$opt" != s ]; }; then continue; fi
      tag="${v}_O${opt}_${feat}"
      CARGO_PROFILE_RELEASE_OPT_LEVEL=$opt RUSTFLAGS="$RF" \
        cargo build -q --release --target wasm32-unknown-unknown --no-default-features --features v_$v
      cp $CARGO_TARGET_DIR/wasm32-unknown-unknown/release/guest.wasm /w/out/$tag.wasm
      # Assembly text for v128 inspection (same flags; per-crate codegen, cgu=1).
      CARGO_PROFILE_RELEASE_OPT_LEVEL=$opt RUSTFLAGS="$RF" \
        cargo rustc -q --release --target wasm32-unknown-unknown --no-default-features --features v_$v -- --emit asm 2>/dev/null || true
      cp $CARGO_TARGET_DIR/wasm32-unknown-unknown/release/deps/guest*.s /w/out/$tag.s 2>/dev/null || true
      rm -f $CARGO_TARGET_DIR/wasm32-unknown-unknown/release/deps/guest*.s
      echo "$tag $(stat -c %s /w/out/$tag.wasm)"
    done
  done
done
