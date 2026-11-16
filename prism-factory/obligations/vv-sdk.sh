#!/usr/bin/env bash
# The vv-sdk obligation: the SDK runtime image the source V&V parts run their
# external oracles in, built once for its identity from the closure through the
# input-bound constructor and pushed by digest.
set -euo pipefail
here=$(dirname "$0")
revision=${PRISM_SOURCE_REVISION:-$(git rev-parse HEAD)}
# The constructor packs the source with the history of the bootstrap release
# tools.lock pins by its tag object. A closure is one commit, so it fetches that
# history by name and holds the tag to the pinned object (an input of the
# identity); a full checkout already has it and fetches nothing.
tag=$(sed -n '/^\[bootstrap-sdk\]/,/^\[/s/^tag_object = "\([0-9a-f]\{40\}\)"$/\1/p' tools.lock)
[ -n "$tag" ] || { echo "vv-sdk: tools.lock pins no bootstrap tag object" >&2; exit 65; }
if [ "$(git cat-file -t "$tag" 2>/dev/null)" != tag ]; then
  git fetch --quiet --no-tags https://github.com/UOR-Foundation/PrismPM refs/tags/v0.2.0:refs/tags/v0.2.0
  [ "$(git rev-parse refs/tags/v0.2.0)" = "$tag" ] || { echo "vv-sdk: v0.2.0 is not the pinned tag object $tag" >&2; exit 65; }
fi
exec bash "$here/image.sh" ghcr.io/uor-foundation/prismpm-sdk -- \
  node scripts/sdk-image-inputs.mjs build . "$revision" runtime --platform linux/amd64
