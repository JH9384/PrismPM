#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

cargo fetch --locked
cargo fetch --locked --manifest-path vendor/lexlean/Cargo.toml

bash scripts/fetch-oracle-cargo.sh

cargo deny fetch

# The no-skip Distribution conformance gate runs the exact official suite
# against this immutable registry subject on an internal Docker network. Pull
# while acquisition is authorized; verification itself never reaches a public
# network.
zot_image='ghcr.io/project-zot/zot@sha256:cd2aea942f428630bcb4190542be6abd35e14177aab84fc7ccad0dca8ecb363d'
docker pull "$zot_image"
observed_zot=$(docker image inspect "$zot_image" --format '{{index .RepoDigests 0}}')
case "$observed_zot" in
  *@sha256:cd2aea942f428630bcb4190542be6abd35e14177aab84fc7ccad0dca8ecb363d) ;;
  *) printf 'Zot acquisition did not preserve the locked digest: %s\n' "$observed_zot" >&2; exit 1 ;;
esac

# The release exporter regression uses the same immutable docker-container
# builder as release/reproducibility; the Docker driver cannot push by digest.
buildkit_image='moby/buildkit@sha256:de10faf919fc71ba4eb1dd7bd6449566d012b0c9436b1c61bfee21d621b009aa'
docker pull "$buildkit_image"
observed_buildkit=$(docker image inspect "$buildkit_image" --format '{{index .RepoDigests 0}}')
case "$observed_buildkit" in
  *@sha256:de10faf919fc71ba4eb1dd7bd6449566d012b0c9436b1c61bfee21d621b009aa) ;;
  *) printf 'BuildKit acquisition did not preserve the locked digest: %s\n' "$observed_buildkit" >&2; exit 1 ;;
esac

# The previous accepted SDK is an independent bootstrap input, not an output
# of the 0.3 build. Acquire it explicitly while networking is authorized; the
# repository gate consumes only these checksum-verified cached bytes.
bootstrap_cache="$root/.prism/cache/bootstrap"
bootstrap_archive="$bootstrap_cache/prismpm-0.2.0-x86_64-unknown-linux-gnu.tar.gz"
bootstrap_sha=f3dd999f5618db154fa06222a06f9de95d86e1dbf683954426ea91c974cbe24c
mkdir -p "$bootstrap_cache"
if [ -f "$bootstrap_archive" ]; then
  printf '%s  %s\n' "$bootstrap_sha" "$bootstrap_archive" | sha256sum --check --strict
else
  bootstrap_staging=$(mktemp "$bootstrap_cache/download.XXXXXX")
  trap 'rm -f "$bootstrap_staging"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
    https://github.com/UOR-Foundation/PrismPM/releases/download/v0.2.0/prismpm-0.2.0-x86_64-unknown-linux-gnu.tar.gz \
    --output "$bootstrap_staging"
  printf '%s  %s\n' "$bootstrap_sha" "$bootstrap_staging" | sha256sum --check --strict
  chmod 0444 "$bootstrap_staging"
  mv "$bootstrap_staging" "$bootstrap_archive"
fi
