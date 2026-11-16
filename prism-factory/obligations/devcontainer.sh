#!/usr/bin/env bash
# The devcontainer obligation: the pinned development container, built from
# exactly the paths its Dockerfile copies and pushed by digest, so the source
# V&V parts start from one image instead of rebuilding it each.
set -euo pipefail
here=$(dirname "$0")
exec bash "$here/image.sh" ghcr.io/uor-foundation/prismpm-devcontainer -- \
  docker buildx build --file .devcontainer/Dockerfile --platform linux/amd64 .
