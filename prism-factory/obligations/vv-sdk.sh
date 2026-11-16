#!/usr/bin/env bash
# The vv-sdk obligation: the SDK runtime image the source V&V parts run their
# external oracles in, built once for its identity from the closure through the
# input-bound constructor and pushed by digest.
set -euo pipefail
here=$(dirname "$0")
: "${FACTORY_OBLIGATION:=vv-sdk}"
revision=${PRISM_SOURCE_REVISION:-$(git rev-parse HEAD)}
# The constructor packs the source with the bootstrap release's history.
. "$here/history.sh"
prism_bootstrap_history
exec bash "$here/image.sh" ghcr.io/uor-foundation/prismpm-sdk -- \
  node scripts/sdk-image-inputs.mjs build . "$revision" runtime --platform linux/amd64
