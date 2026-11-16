#!/usr/bin/env bash
# One independent no-cache rebuild of the matrix image in ROOT, exported as an
# OCI layout to ROOT.oci with its manifest digest in ROOT.digest. Release
# plumbing (scripts/factory.mjs): reproducibility compares it to the shipped
# platform manifest.
set -euo pipefail
root=$1
test "$#" -eq 1 && test -d "$root"
context=()
if [ "$DOCKERFILE" = sdk/Dockerfile ]; then
  build=(node "$root/scripts/sdk-image-inputs.mjs" build "$root" "$GITHUB_SHA" "$TARGET")
else
  test "$DOCKERFILE" = sdk/runtime/Dockerfile
  build=(docker buildx build --file "$root/$DOCKERFILE")
  context=("$root")
fi
"${build[@]}" --no-cache --provenance=false --sbom=false \
  --build-arg SOURCE_DATE_EPOCH=0 \
  --label "org.opencontainers.image.created=1970-01-01T00:00:00Z" \
  --label "org.opencontainers.image.revision=$GITHUB_SHA" \
  --label "org.opencontainers.image.source=https://github.com/$GITHUB_REPOSITORY" \
  --label "org.opencontainers.image.version=$VERSION" \
  --platform "$PLATFORM" \
  --output "type=oci,dest=$root.oci.tar,rewrite-timestamp=true,oci-mediatypes=true" "${context[@]}"
mkdir "$root.oci"
tar -xf "$root.oci.tar" -C "$root.oci"
jq -r '.manifests[0].digest' "$root.oci/index.json" > "$root.digest"
