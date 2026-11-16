#!/usr/bin/env bash
# Build a crate from the SDK's locked offline Cargo cache through every SDK
# startup path, not just `prismpm --version`:
#   1. default entrypoint as root (drops to UID 1000)
#   2. login shells without the entrypoint, as UID 1000 and as root
#   3. an arbitrary runner UID with PRISMPM_EPHEMERAL_HOME=1 (Action, prism-code)
# Usage: scripts/sdk-cargo-startup-smoke.sh <image> [extra docker run args...]
set -euo pipefail
image=$1
shift

# Pick an exact cached crate, build it offline in a fresh package, and require
# a writable CARGO_HOME owned by the executing identity.
probe='set -eu
test -n "${CARGO_HOME:-}"
test -w "$CARGO_HOME"
cache=$(ls -d "$CARGO_HOME"/registry/cache/*/ | head -n 1)
file=$(ls "$cache" | grep -m 1 -E "^cfg-if-[0-9][^/]*\.crate$" || ls "$cache" | grep -m 1 -E "\.crate$")
name=$(printf %s "$file" | sed -E "s/^(.+)-([0-9]+\.[0-9]+\.[0-9]+[^/]*)\.crate$/\1/")
version=$(printf %s "$file" | sed -E "s/^(.+)-([0-9]+\.[0-9]+\.[0-9]+[^/]*)\.crate$/\2/")
work=$(mktemp -d)
mkdir "$work/src"
printf "[package]\nname = \"prismpm-cargo-startup-smoke\"\nversion = \"0.0.0\"\nedition = \"2021\"\n\n[dependencies]\n%s = \"=%s\"\n" "$name" "$version" > "$work/Cargo.toml"
printf "fn main() {}\n" > "$work/src/main.rs"
cargo build --offline --quiet --manifest-path "$work/Cargo.toml"
printf "ok uid=%s CARGO_HOME=%s dependency=%s@%s\n" "$(id -u)" "$CARGO_HOME" "$name" "$version"'

run() {
  local label=$1
  shift
  printf '%s: ' "$label"
  docker run --rm --network none --tmpfs /tmp:rw,exec,size=3g "$@"
}

run 'default entrypoint as root' "$@" "$image" sh -c "$probe"
run 'login shell as 1000' --user 1000:1000 --entrypoint bash "$@" "$image" -lc "$probe"
run 'login shell as root' --user 0:0 --entrypoint bash "$@" "$image" -lc "$probe"
run 'ephemeral runner uid' --user 1234:1234 -e PRISMPM_EPHEMERAL_HOME=1 -e HOME=/tmp/home "$@" "$image" sh -c "$probe"
