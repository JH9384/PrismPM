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
# Release packaging also verifies the independently locked upstream compiler.
# Review these pins whenever an independently locked verification graph changes.
sha256sum --check --strict <<'CHECKSUMS'
ec19fdecf241b6e502726c1740bdc962dffc7fc1eaf456468ba0836b8fb2272a  tests/hologram-oracle/Cargo.toml
16e2a6e4ce47c12b3510813b605897a377981b8314d031775a4ec99e89b5c277  tests/hologram-oracle/Cargo.lock
5be0cb25a1bc7ebff4a709c6dd4c724ae787c6d97e4e9b0a9070ca2cafa71f89  tests/holo-codec-oracle/Cargo.toml
8ab0b99efa9ab6f44d9368d026aefadcefae4640cc92c814947609b41aaf0df4  tests/holo-codec-oracle/Cargo.lock
ec81bd62c5874aaea817f464a808a7c573b0333cef7366c72f2d9def2fbf17fc  tests/holo-browser-codec/Cargo.toml
0074e95dc75e42ad8f802da1b5d51aca3b212e6a6cb0970e1907ec9d040dc88c  tests/holo-browser-codec/Cargo.lock
f4f509d4944c26b80cd193f34c8540ce947f32fddde21086f7a8b0ee0226f6fb  tests/holo-primary-component/driver/Cargo.toml
6b21dc771379314f6db1321cdfc946c62649455be4fab2e26588b88980a6cadb  tests/holo-primary-component/driver/Cargo.lock
f10516f4dadd400a2ebfe3dba12a864d955b7d74d9a42d31440cfe9f1d1a06d5  tests/browser-pkce/driver/Cargo.toml
6850d9d87bd9b216b5780dea790cd970e64a18041479bc3a841348dbdf13ea3c  tests/browser-pkce/driver/Cargo.lock
ba7c379fbd1bec12820138025a40d18a8d78438cb7f28bd62a4b10e17aa6e6b6  tests/browser-session-operation/driver/Cargo.toml
653e89e482c30fdbbdefc205188a5c3d22b623e670467c75e6663b2d15a4dd23  tests/browser-session-operation/driver/Cargo.lock
4b081a50b4fb7ed3123b9614973266cdcd80c1b80805bb9af7d763628aa2082a  tests/browser-signed-context/driver/Cargo.toml
524f043557af4670ab17d674d477f98c70f93b734ac9f4194c54e30912b590ce  tests/browser-signed-context/driver/Cargo.lock
ef0863c074b3ddfccbd3fbf6610f50a60934e71af94ce6173c62be90e7303454  tests/browser-workspace/Cargo.toml
e0760aabe262c5faf7adf184e9abc6e9518084530ffe4df7b1850ce8fa6dbe92  tests/browser-workspace/Cargo.lock
d82e387edc5ebc0e7c871ba0f8872b3f2649d55cffee661dfc81bb15bb8a5dfb  tests/browser-envelope/driver/Cargo.toml
930c3dee97da87d4fab7f45e4bfd7a6e3ddc0a59bc94d4149bef63a45f17c390  tests/browser-envelope/driver/Cargo.lock
29400c9e41ff4bdd38c076162ec58c7c86ed385dfa2e8ea6214b9e60435644b1  tests/browser-journal/driver/Cargo.toml
a055b2a77a4ec1bf3345acb52d8de5346b86d0db474167d9b3a23ac52c7813e2  tests/browser-journal/driver/Cargo.lock
caf5c34ef2b21d58c1aa12acf81cb13ace1adaffb3c69a641f54f490ed61cf66  crates/prismpm/vendor/hologram-live.tar
2fbac4abadf6e829388cfa30f58898f8b39daa547a03cd184395315b6e1b5484  tests/browser-command/driver/Cargo.toml
bd13d46f2e6a0b601ea0ecd2a3fbe9f115c376711cb9a81b8002c9221c00ee47  tests/browser-command/driver/Cargo.lock
7a94f169b4dfafcbdf60bc937e5010fa54294e4877734356abc2dd63b707f31c  tests/browser-query/driver/Cargo.toml
7027cbfbdb0a975b69282e3e3a14e90ac40d6927bab8b29d3cbbf0c96c8da885  tests/browser-query/driver/Cargo.lock
31a14e80b87945140ec3c894627621ab1b8fdf52a0b13c63bf0ffcc8648ec814  tests/browser-view/driver/Cargo.toml
4e644754a8b4c20daaa09b38cb163c2717d899842f168aed77b0766aa4f7c7bc  tests/browser-view/driver/Cargo.lock
142eae324d5056c0a735399914fcd0a7c644d400ce81a4fd98630f09c76d6935  tests/browser-effects/driver/Cargo.toml
51faaf961f092fdaacc7254ffa7337a2bb665ca4b582413792e80cd9bdd2532a  tests/browser-effects/driver/Cargo.lock
4e552c9f767cccf6e5218d41839db5d6817943b9f590ec2f5332e082b5f5f198  tests/browser-presentation/driver/Cargo.toml
e0e463830a83bcf5df9618607ccf582ce89d0d1e12ff2c8d6105a4f9b1586e15  tests/browser-presentation/driver/Cargo.lock
452fe74652146b6d53ae18f39e59fd0bb87a3f572b59bc201fe5fb2a13525bfc  tests/browser-p256/driver/Cargo.toml
d5ccc0f586d9f7c23fe2aeed8061ca8a7c7bd3cc86cdb9dd74b2ee2f7e3f4b27  tests/browser-p256/driver/Cargo.lock
9231c4aed5d035efa24f350998412fd7c2245c94e133eba361f70d9170468aba  tests/browser-account-genesis/driver/Cargo.toml
cfd47b9c092260ccde44cb095aaf262e7a3aa5ec1e425d63df006fd16ffa1f80  tests/browser-account-genesis/driver/Cargo.lock
7a718d1826fed8d9bf03c66a955181709bfa0841be7b8405563e1e847ce8e3dc  tests/browser-session/driver/Cargo.toml
2782b85a5c9563de1124ca098e8c3a3756d59029a1d6397bb3adf735dcde0942  tests/browser-session/driver/Cargo.lock
09358667234a3bd05ca3a3ae0c652fe1bac3b0647002cae781f3faffc887e769  tests/browser-custody/driver/Cargo.toml
6658bd53c89124aa441bb32bc00fc9e32fe7e739ccd5f1004f8a7d9448c770ad  tests/browser-custody/driver/Cargo.lock
0818395d9e8997a0ee0b4a2eea4b1b2c884743d89d690b5b2536b4a5f6dd4a3c  tests/browser-operation-journal/driver/Cargo.toml
e371064282af5de28959d0b43badbd36524a9ecb9b11b4c9a9e715bd2b302d9d  tests/browser-operation-journal/driver/Cargo.lock
b6434d4dfbd8f30fc15332fc2aa5cec524dbea2e7fe5e8bccf11910d00ac9b11  tests/publication-admission/driver/Cargo.toml
78b84a6460b55e7124d247e31db57190f0d4ca9e7925bd73bc40b3f5cc540df4  tests/publication-admission/driver/Cargo.lock
f7cdb135602bc50a7eb7004f92dcad4964038bdd25ab112eb156df494fdd1d7a  tests/browser-budget/driver/Cargo.toml
9beee1b23c800689db006acb9ad6dbaca7e8dc7812433046ccec6b624da6e043  tests/browser-budget/driver/Cargo.lock
daf7f338bc60de1c7ad7c2330cc8f1698573933c0ca0ee730eb4c5bac0d29d8e  tests/browser-dynamic-choice/driver/Cargo.toml
d4ac5f90d29a302466f6159b8fe3cac190a3e08dba0899e82925450c4f5c902c  tests/browser-dynamic-choice/driver/Cargo.lock
53e67644ca16396d3a55f7edf0c482bf2fad82110409498c62af45a9636ee42f  tests/browser-semantic-presentation/driver/Cargo.toml
8a6a4d6dd7dc3121e268cdba35299bbb47c30eaa9759aee2cde8c1b1d8eeeed5  tests/browser-semantic-presentation/driver/Cargo.lock
2171d8140dbce6f6c33f51b54e24b407ad05e1c97df1987d3fb1922daaa1a409  tests/browser-session-journal/driver/Cargo.toml
18820921d85e015e8ea975b5f08cb4c79a5ff34c27a39f2e017b0be3720bf65e  tests/browser-session-journal/driver/Cargo.lock
2171d8140dbce6f6c33f51b54e24b407ad05e1c97df1987d3fb1922daaa1a409  tests/browser-session-journal/reservation-driver/Cargo.toml
18820921d85e015e8ea975b5f08cb4c79a5ff34c27a39f2e017b0be3720bf65e  tests/browser-session-journal/reservation-driver/Cargo.lock
38359e1db950f30f83521b8ae76b39ad2ba7a8e302c3830034a73875fb1a7864  tests/browser-session-journal-retention/driver/Cargo.toml
5cdaac6d2ff2b369560cb640b7d47f84734ceffab08d9fad0590b71a75a902ca  tests/browser-session-journal-retention/driver/Cargo.lock
712f5e4b465fd89ad0ec62726f86db266cc5c2cefa6bf076f8347dd19f5e6949  tests/browser-session-journal-recovery/driver/Cargo.toml
3c2eb5cd0b4542d89820387c94fbde9b16aa05b0187abb76b6a2d3762139457a  tests/browser-session-journal-recovery/driver/Cargo.lock
690934d62c16c241c92e294697454e6188ba0f20fa73967ff7c67fc2a31e2a34  tests/browser-session-payloads/driver/Cargo.toml
21c8239d8a03a70005a81e1a0290ab0ee1799db8c252e6dc4a3c829538e669e6  tests/browser-session-payloads/driver/Cargo.lock
7c0d97fc4688766f7928670b1857442882c4937458d3bd1a3e00e31c91b9940a  tests/browser-session-recovery-frames/driver/Cargo.toml
ae9078a1675989a8d4740e2f93e453badc6cd5f8c623762d1ef5281d8ba282a0  tests/browser-session-recovery-frames/driver/Cargo.lock
d9e72b04fc5c6d3db7a078fd871aa0cabf48b1f0d7ac5f650253ba640f9a5903  tests/publication-context-linkage/driver/Cargo.toml
26e4a2b3cff5b7b73f8d4951d449fdeadb7d80f4c4bd8ae02ffdaf771039ea7b  tests/publication-context-linkage/driver/Cargo.lock
2fb0bb8ba645ff99e72007455fbbb9b5ee0716e2182fb061f3a84ae37ffb1379  sdk/oracles/oscal/Cargo.toml
1e33bbf4be333f4f745e976f7b8529c559aea7b7dcc5b7905ca75ce416d5d2e1  sdk/oracles/oscal/Cargo.lock
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
  tests/holo-browser-codec/Cargo.toml \
  tests/holo-primary-component/driver/Cargo.toml \
  tests/browser-pkce/driver/Cargo.toml \
  tests/browser-session-operation/driver/Cargo.toml \
  tests/browser-signed-context/driver/Cargo.toml \
  tests/browser-workspace/Cargo.toml \
  tests/browser-envelope/driver/Cargo.toml \
  tests/browser-journal/driver/Cargo.toml \
  tests/browser-command/driver/Cargo.toml \
  tests/browser-query/driver/Cargo.toml \
  tests/browser-view/driver/Cargo.toml \
  tests/browser-effects/driver/Cargo.toml \
  tests/browser-presentation/driver/Cargo.toml \
  tests/browser-p256/driver/Cargo.toml \
  tests/browser-account-genesis/driver/Cargo.toml \
  tests/browser-session/driver/Cargo.toml \
  tests/browser-custody/driver/Cargo.toml \
  tests/browser-operation-journal/driver/Cargo.toml \
  tests/publication-admission/driver/Cargo.toml \
  tests/browser-budget/driver/Cargo.toml \
  tests/browser-dynamic-choice/driver/Cargo.toml \
  tests/browser-semantic-presentation/driver/Cargo.toml \
  tests/browser-session-journal/driver/Cargo.toml \
  tests/browser-session-journal/reservation-driver/Cargo.toml \
  tests/browser-session-journal-retention/driver/Cargo.toml \
  tests/browser-session-journal-recovery/driver/Cargo.toml \
  tests/browser-session-payloads/driver/Cargo.toml \
  tests/browser-session-recovery-frames/driver/Cargo.toml \
  tests/publication-context-linkage/driver/Cargo.toml \
  sdk/oracles/oscal/Cargo.toml \
  vendor/lean4-prod/rust/Cargo.toml; do
  cargo fetch --locked --manifest-path "$manifest"
  cargo metadata --locked --offline --format-version 1 --manifest-path "$manifest" >/dev/null
done
