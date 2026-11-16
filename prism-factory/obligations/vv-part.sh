#!/usr/bin/env bash
# A part of the Linux x86-64 normative acceptance (`just vv-part PART`, the
# parts scripts/vv-assemble.mjs lists), in the devcontainer image the
# devcontainer obligation built, with its external oracles in the SDK image the
# vv-sdk obligation built (PRISM_UPSTREAM_VV_SDK_IMAGE, pulled by digest onto
# this runner's daemon). The recipe the retired vv.yml ran on the legacy adapter.
set -euo pipefail
part=${1:?usage: vv-part.sh PART}
here=$(dirname "$0")
: "${FACTORY_OBLIGATION:=vv-$part}"
node scripts/vv-assemble.mjs --list | grep -Fqx -- "$part" || { echo "vv-part: $part is not a V&V part" >&2; exit 64; }
: "${PRISM_UPSTREAM_VV_SDK_IMAGE:?the vv-sdk obligation named no image}"
export PRISMPM_TEST_SDK_IMAGE=$PRISM_UPSTREAM_VV_SDK_IMAGE
# The bootstrap gate reads the pinned historical source.
. "$here/history.sh"
prism_bootstrap_history
# What the devcontainer's postCreateCommand prepares: the pinned Lean
# toolchain and the locked dependencies.
toolchain=$(tr -d '\n' < lean-toolchain)
elan toolchain list | grep -Fqx "$toolchain" || elan toolchain install "$toolchain"
lean --version
./scripts/fetch.sh
bash scripts/vv.sh --with-sdk bash -euo pipefail -c "just vv-part $part"
# The part's canonical record (prismpm/vv-part/1), named by its digest.
record=target/vv-part-$part.json
test -f "$record"
printf 'record sha256:%s\n' "$(sha256sum "$record" | cut -d' ' -f1)" >> "${PRISM_OUTPUTS:-/dev/null}"
