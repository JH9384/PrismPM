#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != --check ]; }; then
  printf 'usage: %s [--check]\n' "$0" >&2
  exit 64
fi

# Acquisition is separate from the offline verifier and production Cargo graph.
# Browser compiler fixtures are internal gates, not external standards oracles.
# Release-package verification also owns an independently locked compiler graph;
# root workspace resolution cannot supply all of its locked registry versions.
# Review these pins whenever an independently locked verification graph changes.
sha256sum --check --strict <<'CHECKSUMS'
ec19fdecf241b6e502726c1740bdc962dffc7fc1eaf456468ba0836b8fb2272a  tests/hologram-oracle/Cargo.toml
16e2a6e4ce47c12b3510813b605897a377981b8314d031775a4ec99e89b5c277  tests/hologram-oracle/Cargo.lock
5be0cb25a1bc7ebff4a709c6dd4c724ae787c6d97e4e9b0a9070ca2cafa71f89  tests/holo-codec-oracle/Cargo.toml
8ab0b99efa9ab6f44d9368d026aefadcefae4640cc92c814947609b41aaf0df4  tests/holo-codec-oracle/Cargo.lock
1e0a368fc436907ea62dab3cf44d73a4aad133584ae6dd9799d741aa82fe1f68  tests/browser-workspace/Cargo.toml
3d27b77bec3b81bc28bbcac4e606bb0dfe83df7bc900e3607fbb08ad73dc03fa  tests/browser-workspace/Cargo.lock
a8ddd90c616555741a750f91d820b80827438612523624c5afdc7e0301a76493  tests/browser-envelope/driver/Cargo.toml
d1cc74e3713bc55ae0b4f2212ce6e4d44d1ea8c036284f0d3e88eb7263373478  tests/browser-envelope/driver/Cargo.lock
996a76f015df5c4166e450f67e5016b7ac39817acdd57d3c678aee9c99212681  tests/browser-journal/driver/Cargo.toml
d03b1a2dd7b347329827d2f4944ae35ae26d33f87d692b4db34390e51c4dd200  tests/browser-journal/driver/Cargo.lock
caf5c34ef2b21d58c1aa12acf81cb13ace1adaffb3c69a641f54f490ed61cf66  crates/prismpm/vendor/hologram-live.tar
feb39fe80f840e1e564b6e07a213ca8f6eace18f85416d5386c699addec3ba87  tests/browser-command/driver/Cargo.toml
7766dd2ef272c54dbc5419ea903adf7cd9618e34e2ec2b4c113307ed7a524a22  tests/browser-command/driver/Cargo.lock
f0a86585e2c142af57db2b060e7626accc670ccbcbc42e120f8261429cec5f31  tests/browser-query/driver/Cargo.toml
a6175eb8fa5bec0d3eccddb4d6b66a0d63e5d687b709d1e596d24d7dc1025113  tests/browser-query/driver/Cargo.lock
9a900b56d97f32040f6a6eb386226062822ec299f9e8d3832d880eb67e7980fa  tests/browser-view/driver/Cargo.toml
dd24ad15a6178d8917b181a3ca2b97d2989d4c684d112efc0a65cdb98357d27e  tests/browser-view/driver/Cargo.lock
34114e4a9080e9fee708d7ced51ddb05e03fe82c633e7847cf596d431ad42348  tests/browser-effects/driver/Cargo.toml
2b05b3bd44c54329ea46161d50e227de6714330c6706f7b00c6c30122bb306d6  tests/browser-effects/driver/Cargo.lock
cd971655426523e79de558c58706629b633f18f55b977f9441279879139b96b8  tests/browser-presentation/driver/Cargo.toml
f35425d3c10f529eae5760cdc53fb3ffd598240415a67016dbf49194592283de  tests/browser-presentation/driver/Cargo.lock
367929deb65c746365b59a6055c76f8e0ff97f334d08ca5382bc163474346213  tests/browser-custody/driver/Cargo.toml
75a9c3b0754d0c085c18a0091f6ce8922ab5b64834a8a996c2c1d2d5307dcacb  tests/browser-custody/driver/Cargo.lock
10c2a425a0028ebe478c5a2e4f4435623634ed6529cf7193a2185aed9852206f  tests/browser-operation-journal/driver/Cargo.toml
1f035224a640bf63cb07d3d817eb5a5df43370459685cc51ca7d30f17ea893e6  tests/browser-operation-journal/driver/Cargo.lock
d833db76924bdf573f4d0cd47a24b585bb454879be0ff668670629688277039f  tests/publication-admission/driver/Cargo.toml
ea11b8abbdb0b258776a17359d98948f06ce12486dae7fcb06639574c3c33baa  tests/publication-admission/driver/Cargo.lock
fc49c5659bded9db17612c76d47370fd715e4fa900f2b0aa8617e77a0fb13581  tests/browser-budget/driver/Cargo.toml
8693ae0f8f674d3e38013956e129759665d35dfe2f31001fbed782759bdcaa3d  tests/browser-budget/driver/Cargo.lock
63e9f1793c48cddffd4c8378fe230ea1972a128ded41a2dda5814e841fefc2f4  vendor/lean4-prod/rust/Cargo.toml
5e16d324b08b942c476099b6c10235f4ddd58bca28aaf69514b8a88c9252c88f  vendor/lean4-prod/rust/Cargo.lock
CHECKSUMS
cmp tests/hologram-oracle/Cargo.toml crates/prismpm/src/embedded/hologram-oracle.Cargo.toml
cmp tests/hologram-oracle/Cargo.lock crates/prismpm/src/embedded/hologram-oracle.Cargo.lock
cmp tests/hologram-oracle/src/main.rs crates/prismpm/src/embedded/hologram-oracle.main.rs
if [ "${1:-}" = --check ]; then
  exit 0
fi

oracle_work=$(mktemp -d)
trap 'rm -r -- "$oracle_work"' EXIT
mkdir -p "$oracle_work/hologram-live" "$oracle_work/harness/src"
tar -xf crates/prismpm/vendor/hologram-live.tar -C "$oracle_work/hologram-live"
cp tests/hologram-oracle/Cargo.toml "$oracle_work/harness/Cargo.toml"
cp tests/hologram-oracle/Cargo.lock "$oracle_work/harness/Cargo.lock"
cp tests/hologram-oracle/src/main.rs "$oracle_work/harness/src/main.rs"

for manifest in "$oracle_work/harness/Cargo.toml" \
  tests/holo-codec-oracle/Cargo.toml \
  tests/browser-workspace/Cargo.toml \
  tests/browser-envelope/driver/Cargo.toml \
  tests/browser-journal/driver/Cargo.toml \
  tests/browser-command/driver/Cargo.toml \
  tests/browser-query/driver/Cargo.toml \
  tests/browser-view/driver/Cargo.toml \
  tests/browser-effects/driver/Cargo.toml \
  tests/browser-presentation/driver/Cargo.toml \
  tests/browser-custody/driver/Cargo.toml \
  tests/browser-operation-journal/driver/Cargo.toml \
  tests/publication-admission/driver/Cargo.toml \
  tests/browser-budget/driver/Cargo.toml \
  vendor/lean4-prod/rust/Cargo.toml; do
  cargo fetch --locked --manifest-path "$manifest"
  cargo metadata --locked --offline --format-version 1 --manifest-path "$manifest" >/dev/null
done
