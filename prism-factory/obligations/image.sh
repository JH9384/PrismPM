#!/usr/bin/env bash
# Build one image from exactly the obligation's closure and push it by digest,
# naming it as the obligation's `image` output. Shared by the obligations that
# build an image (vv-sdk.sh, devcontainer.sh); the context is the closure, so a
# COPY of a path the obligation does not declare fails the build.
#
#   image.sh REPOSITORY -- BUILD ARGUMENTS...
#
# It drives the daemon the sandbox reaches (`publish` access) with its own
# pinned BuildKit builder, and retries the build, whose fetches are the flaky
# part, before giving up.
set -euo pipefail
repository=${1:?usage: image.sh REPOSITORY -- BUILD ARGUMENTS...}; shift
test "${1:-}" = -- || { echo 'usage: image.sh REPOSITORY -- BUILD ARGUMENTS...' >&2; exit 64; }; shift
: "${PRISM_OUTPUTS:?the factory names the outputs file}"
builder=prism-${FACTORY_OBLIGATION:-image}-$$
docker buildx create --name "$builder" --driver docker-container \
  --driver-opt image=docker.io/moby/buildkit@sha256:de10faf919fc71ba4eb1dd7bd6449566d012b0c9436b1c61bfee21d621b009aa >/dev/null
trap 'docker buildx rm --force "$builder" >/dev/null 2>&1 || true' EXIT
metadata=$(mktemp)
for attempt in 1 2 3; do
  if BUILDX_BUILDER=$builder "$@" \
    --output "type=registry,name=$repository,push-by-digest=true,name-canonical=true,rewrite-timestamp=true,oci-mediatypes=true" \
    --metadata-file "$metadata" --provenance=false --sbom=false --build-arg SOURCE_DATE_EPOCH=0; then
    break
  fi
  test "$attempt" -lt 3
  sleep $((attempt * 120))
done
digest=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))["containerimage.digest"] || "")' "$metadata")
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "image.sh: the build named no digest" >&2; exit 65; }
printf 'image %s@%s\n' "$repository" "$digest" >> "$PRISM_OUTPUTS"
printf '%s@%s\n' "$repository" "$digest"
