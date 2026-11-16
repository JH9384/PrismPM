#!/usr/bin/env bash
# Independent post-build closure test; never consumes the external-oracle image override.
set -euo pipefail
test "$#" -eq 2 -o "$#" -eq 3 || { echo 'usage: browser-api-sdk-check.sh IMAGE@sha256:DIGEST SOURCE_COMMIT [EXPLICIT_REGISTRY_CA]' >&2; exit 64; }
image=$1
revision=$2
root=$(cd "$(dirname "$0")/.." && pwd -P)
helper="$root/scripts/browser-api-sdk-check.mjs"
if test "$#" -eq 3; then
  node "$root/scripts/sdk-qualification-trust.mjs" "$3"
  export NODE_EXTRA_CA_CERTS=$3
fi
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
  # Stream the root as a tar so tracked relative symlinks such as
  # crates/prismpm/model -> ../../model stay symlinks; docker cp refuses to
  # extract a link that points outside its destination. verify checks every alias.
  docker container cp "$container:/opt/prismpm/share/conformance-root/$path" - | tar -x -C "$sdk_work/source/$(dirname "$path")"
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
# The installed V&V parts already run the browser owners in this exact image.
node "$helper" verify "$root" "$sdk_work/source.json"
printf 'browser SDK closure passed: source=%s image=%s platform=linux/%s\n' "$revision" "$image" "$architecture"
