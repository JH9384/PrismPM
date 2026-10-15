#!/usr/bin/env bash
# Genuine product CLI construction after both immutable SDK children exist.
set -euo pipefail
test "$#" -eq 3 -o "$#" -eq 4 || { echo 'usage: product-sdk-check.sh SDK_INDEX@sha256:DIGEST SOURCE_COMMIT NEW_EVIDENCE_DIR [EXPLICIT_REGISTRY_CA]' >&2; exit 64; }
image=$1
revision=$2
evidence=$3
root=$(cd "$(dirname "$0")/.." && pwd -P)
helper="$root/scripts/product-sdk-check.mjs"
qualification_trust=()
if test "$#" -eq 4; then
  node "$root/scripts/sdk-qualification-trust.mjs" "$4"
  export NODE_EXTRA_CA_CERTS=$4
  qualification_trust=(--mount "type=bind,source=$4,target=/run/prismpm-qualification-ca.crt,readonly" --env NODE_EXTRA_CA_CERTS=/run/prismpm-qualification-ca.crt)
fi
[[ $image =~ ^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$ ]] || exit 64
[[ $revision =~ ^[0-9a-f]{40}$ ]] || exit 64
test "$(git -C "$root" rev-parse HEAD)" = "$revision"
test -z "$(git -C "$root" status --porcelain)"
test ! -e "$evidence"
test ! -L "$evidence"
mkdir "$evidence"
evidence=$(cd "$evidence" && pwd -P)
case "$(uname -m)" in x86_64) architecture=amd64 ;; aarch64) architecture=arm64 ;; *) exit 64 ;; esac
sdk_work=$(mktemp -d)
container=''
project_volume=''
receiver_volume=''
cleanup() {
  if test -n "$container"; then docker container rm --force "$container" >/dev/null 2>&1 || true; fi
  if test -n "$project_volume"; then docker volume rm "$project_volume" >/dev/null 2>&1 || true; fi
  if test -n "$receiver_volume"; then docker volume rm "$receiver_volume" >/dev/null 2>&1 || true; fi
  chmod -R u+rwX -- "$sdk_work"
  rm -r -- "$sdk_work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node "$helper" capture "$root" "$revision" > "$evidence/source.json"
docker pull --platform "linux/$architecture" "$image"
docker image inspect "$image" > "$evidence/image.json"
node "$helper" image "$image" "$architecture" "$revision" < "$evidence/image.json"
container=$(docker container create --network none --read-only --platform "linux/$architecture" --entrypoint /usr/bin/true "$image")
[[ $container =~ ^[0-9a-f]{64}$ ]] || exit 1
mkdir "$sdk_work/source"
while IFS= read -r path; do
  mkdir -p "$sdk_work/source/$(dirname "$path")"
  docker container cp "$container:/opt/prismpm/share/conformance-root/$path" "$sdk_work/source/$path"
done < <(node "$helper" roots)
node "$helper" verify "$sdk_work/source" "$evidence/source.json"
docker container cp "$container:/opt/prismpm/share/inventory.json" "$evidence/inventory.json"
docker container cp "$container:/opt/prismpm/share/standards.lock" "$evidence/standards.lock"
docker container cp "$container:/usr/local/bin/prismpm-devcontainer-init" "$sdk_work/entrypoint.sh"
cmp "$root/sdk/devcontainer-init.sh" "$sdk_work/entrypoint.sh"
docker container rm "$container" >/dev/null
container=''
# Bound metadata acquisition to the indexed terminal layers; never pull a
# second complete platform image merely to obtain its inventory.
node "$helper" lock "$image" "$evidence/standards.lock" > "$evidence/prismpm.lock"
mkdir "$sdk_work/inputs"
cp "$evidence/prismpm.lock" "$sdk_work/inputs/prismpm.lock"
project_volume=$(docker volume create)
receiver_volume=$(docker volume create)
[[ $project_volume =~ ^[0-9a-f]{64}$ && $receiver_volume =~ ^[0-9a-f]{64}$ ]] || exit 1
socket_gid=$(stat -c '%g' /var/run/docker.sock)
[[ $socket_gid =~ ^[0-9]+$ ]] || exit 1
container=$(docker container create --user 1000:1000 --group-add "$socket_gid" --read-only --cap-drop ALL --platform "linux/$architecture" \
  "${qualification_trust[@]}" \
  --security-opt no-new-privileges --mount "type=volume,source=$project_volume,target=/tmp" \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --env PRISMPM_EPHEMERAL_HOME=1 --env CARGO_BUILD_JOBS=2 \
  --workdir /opt/prismpm/share/conformance-root "$image" node scripts/product-sdk-check.mjs acquire)
[[ $container =~ ^[0-9a-f]{64}$ ]] || exit 1
docker container cp "$sdk_work/inputs" "$container:/tmp/prismpm-product-input"
docker container start --attach "$container" > "$evidence/acquire.stdout.json" 2> "$evidence/acquire.stderr.txt"
test "$(docker container inspect --format '{{.State.ExitCode}}' "$container")" = 0
docker container cp "$container:/tmp/prismpm-product-cli/acquisition.json" "$evidence/acquisition.json"
docker container rm "$container" >/dev/null
container=''
# The build has no socket, external network, host source or host dependency cache.
container=$(docker container create --user 1000:1000 --read-only --network none --cap-drop ALL --platform "linux/$architecture" \
  --security-opt no-new-privileges --mount "type=volume,source=$project_volume,target=/tmp" \
  --env PRISMPM_EPHEMERAL_HOME=1 --env CARGO_NET_OFFLINE=true --env CARGO_BUILD_JOBS=2 \
  --workdir /opt/prismpm/share/conformance-root "$image" node scripts/product-sdk-check.mjs build)
[[ $container =~ ^[0-9a-f]{64}$ ]] || exit 1
docker container start --attach "$container" > "$evidence/build.stdout.json" 2> "$evidence/build.stderr.txt"
test "$(docker container inspect --format '{{.State.ExitCode}}' "$container")" = 0
docker container cp "$container:/tmp/prismpm-product-cli/build.json" "$evidence/build.json"
mkdir -p "$sdk_work/receiver/receiver/.prism"
cp "$evidence/build.json" "$sdk_work/receiver/build.json"
docker container cp "$container:/tmp/prismpm-product-cli/first/.prism/oci" "$sdk_work/receiver/receiver/.prism/oci"
docker container rm "$container" >/dev/null
container=''
# A separate fresh volume carries only the immutable OCI graph and result facts.
container=$(docker container create --user 1000:1000 --read-only --network none --cap-drop ALL --platform "linux/$architecture" \
  --security-opt no-new-privileges --mount "type=volume,source=$receiver_volume,target=/tmp" \
  --env PRISMPM_EPHEMERAL_HOME=1 --env CARGO_NET_OFFLINE=true \
  --workdir /opt/prismpm/share/conformance-root "$image" node scripts/product-sdk-check.mjs receive)
[[ $container =~ ^[0-9a-f]{64}$ ]] || exit 1
docker container cp "$sdk_work/receiver" "$container:/tmp/prismpm-product-cli"
# Docker cp assigns root ownership. A separate bounded infrastructure command
# restores the payload to the permanent SDK user before any verifier executes.
docker run --rm --user 0:0 --read-only --network none --platform "linux/$architecture" \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH \
  --security-opt no-new-privileges --mount "type=volume,source=$receiver_volume,target=/tmp" \
  --entrypoint /usr/bin/chown "$image" -R 1000:1000 /tmp/prismpm-product-cli
docker container start --attach "$container" > "$evidence/result.json" 2> "$evidence/receiver.stderr.txt"
test "$(docker container inspect --format '{{.State.ExitCode}}' "$container")" = 0
node "$helper" result "$evidence/result.json" "$image"
docker container rm "$container" >/dev/null
container=''
node "$helper" verify "$root" "$evidence/source.json"
printf 'installed product CLI gate passed: source=%s image=%s platform=linux/%s\n' "$revision" "$image" "$architecture"
