#!/usr/bin/env bash
# Independent post-build closure test; never consumes the external-oracle image override.
set -euo pipefail
test "$#" -eq 2 || { echo 'usage: browser-api-sdk-check.sh IMAGE@sha256:DIGEST SOURCE_COMMIT' >&2; exit 64; }
image=$1
revision=$2
root=$(cd "$(dirname "$0")/.." && pwd -P)
helper="$root/scripts/browser-api-sdk-check.mjs"
[[ $image =~ ^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$ ]] || exit 64
[[ $revision =~ ^[0-9a-f]{40}$ ]] || exit 64
test "$(git -C "$root" rev-parse HEAD)" = "$revision"
test -z "$(git -C "$root" status --porcelain)"
case "$(uname -m)" in x86_64) architecture=amd64 ;; aarch64) architecture=arm64 ;; *) exit 64 ;; esac
sdk_work=$(mktemp -d)
container=''
cleanup() {
  if test -n "$container"; then docker container rm --force "$container" >/dev/null 2>&1 || true; fi
  # Docker preserves the image's read-only directory modes in this owned copy.
  chmod -R u+rwX -- "$sdk_work"
  rm -r -- "$sdk_work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node "$helper" capture "$root" "$revision" > "$sdk_work/source.json"
docker pull --platform "linux/$architecture" "$image"
docker image inspect "$image" | node "$helper" image "$image" "$architecture" "$revision"
container=$(docker container create --network none --read-only --entrypoint /usr/bin/true "$image")
[[ $container =~ ^[0-9a-f]{64}$ ]] || exit 1
mkdir "$sdk_work/source" "$sdk_work/browser"
while IFS= read -r path; do
  mkdir -p "$sdk_work/source/$(dirname "$path")"
  docker container cp "$container:/opt/prismpm/share/conformance-root/$path" "$sdk_work/source/$path"
done < <(node "$helper" roots)
node "$helper" verify "$sdk_work/source" "$sdk_work/source.json"
docker container cp "$container:/opt/prismpm/browser/." "$sdk_work/browser"
node "$helper" modules "$root" "$sdk_work/browser"
mkdir -p "$sdk_work/share/account-genesis"
docker container cp "$container:/opt/prismpm/share/account-genesis/." "$sdk_work/share/account-genesis"
node "$helper" account-construction "$sdk_work" "$sdk_work/source.json"
docker container cp "$container:/usr/local/bin/prismpm-devcontainer-init" "$sdk_work/entrypoint.sh"
cmp "$root/sdk/devcontainer-init.sh" "$sdk_work/entrypoint.sh"
docker container rm "$container" >/dev/null
container=''
# Only private temporary caches/builds are writable. The source, tools and browser
# modules come from the inspected image; no host source or dependency mount exists.
container=$(docker container create --user 1000:1000 --read-only --network none --cap-drop ALL \
  --security-opt no-new-privileges --tmpfs /tmp:rw,exec,nosuid,nodev,size=8g \
  --env PRISMPM_EPHEMERAL_HOME=1 --env CARGO_NET_OFFLINE=true \
  --workdir /opt/prismpm/share/conformance-root "$image" \
  node scripts/browser-api-sdk-check.mjs run)
[[ $container =~ ^[0-9a-f]{64}$ ]] || exit 1
docker container start --attach "$container"
test "$(docker container inspect --format '{{.State.ExitCode}}' "$container")" = 0
docker container rm "$container" >/dev/null
container=''
node "$helper" verify "$root" "$sdk_work/source.json"
printf 'browser SDK closure passed: source=%s image=%s platform=linux/%s\n' "$revision" "$image" "$architecture"
