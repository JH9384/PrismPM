#!/usr/bin/env bash
# Basic host Docker infrastructure only; SDK commands execute in pinned tools.
set -euo pipefail
test "$#" -eq 4 || { echo 'usage: sdk-vv-outer.sh IMAGE@sha256:DIGEST SOURCE_COMMIT ARCH FRESH_OUTPUT' >&2; exit 64; }
sdk_image=$1 revision=$2 architecture=$3 destination=$4
[[ $sdk_image =~ ^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$ ]] || exit 64
[[ $revision =~ ^[0-9a-f]{40}$ ]] || exit 64
case "$(uname -m):$architecture" in x86_64:amd64|aarch64:arm64) ;; *) exit 64 ;; esac
root=$(cd "$(dirname "$0")/.." && pwd -P)
workspace=$(pwd -P)
test "$(git -C "$root" rev-parse HEAD)" = "$revision"
test -z "$(git -C "$root" status --porcelain)"
test "$root" = "$workspace/root-a"
[[ $destination =~ ^sdk-(amd64|arm64)-full-sdk-vv$ ]] || exit 64
test "$destination" = "sdk-$architecture-full-sdk-vv"
test ! -e "$workspace/$destination"
evidence="$workspace/$destination-outer-owner"
mkdir -m 0700 "$evidence"
# Kernel-generated invocation namespace, not a reusable run label. Collision
# checks remain mandatory; a label alone never authenticates a created object.
invocation=$(cat /proc/sys/kernel/random/uuid)
[[ $invocation =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$ ]] || exit 1
owner="prism-sdk-outer-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$architecture-$invocation"
tag="prism-sdk-outer-tools:$revision-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$architecture-$invocation"
label=org.uor.prismpm.sdk-outer
printf '%s\n' "$owner" >"$evidence/owner.name"
printf '%s\n' "$tag" >"$evidence/tools.tag"
container_id= image_id= create_attempted=0 build_attempted=0 cleaning=0 cleanup_deadline=0
controlled() {
  local name=$1 bound=$2 status remaining
  shift 2
  if (( cleaning )); then
    remaining=$((cleanup_deadline-SECONDS)); (( remaining>0 )) || return 124
    (( remaining>=bound )) || bound=$remaining
  fi
  if timeout --signal=TERM --kill-after=2s "${bound}s" docker "$@" >"$evidence/$name.stdout" 2>"$evidence/$name.stderr"; then status=0; else status=$?; fi
  printf '%s\n' "$status" >"$evidence/$name.status"
  cat "$evidence/$name.stdout"
  return "$status"
}
absent() {
  local name=$1 reference=$2 kind=${3:-container} status diagnostic
  if controlled "$name" 10 "$kind" inspect "$reference"; then return 1; else status=$?; fi
  test "$status" = 1 || return 1
  diagnostic=$(cat "$evidence/$name.stderr")
  [[ $diagnostic =~ [Nn]o[[:space:]]such[[:space:]](object|container|image) ]]
}
cleanup_owned() {
  local actual
  # Docker's private CID file, not a matching name/label or partial stdout,
  # authenticates a creation whose CLI response was lost.
  if (( create_attempted )); then
    test -f "$evidence/container.id" || return 1
    actual=$(cat "$evidence/container.id")
    [[ $actual =~ ^[a-f0-9]{64}$ ]] || return 1
    if test -n "$container_id"; then test "$actual" = "$container_id" || return 1; fi
    container_id=$actual
    if controlled survivor 10 container inspect "$container_id"; then
      test "$(controlled survivor-id 10 container inspect "$container_id" --format '{{.Id}}')" = "$container_id" || return 1
      test "$(controlled survivor-label 10 container inspect "$container_id" --format '{{index .Config.Labels "org.uor.prismpm.sdk-outer"}}')" = "$owner" || return 1
      controlled removal 10 container rm --force --volumes "$container_id" || return 1
    else
      absent survivor-id-absence "$container_id" || return 1
    fi
  fi
  absent name-absence "$owner" || return 1
  if test -n "$container_id"; then absent id-absence "$container_id" || return 1; fi
  if (( build_attempted )) && test -z "$image_id" && test -f "$evidence/tools.id"; then
    image_id=$(cat "$evidence/tools.id")
    [[ $image_id =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  fi
  if test -n "$image_id"; then
    test "$(controlled tag-identity 10 image inspect "$tag" --format '{{.Id}}')" = "$image_id" || return 1
    controlled tag-removal 10 image rm "$tag" || return 1
  fi
  absent tag-absence "$tag" image || return 1
}
cleanup() {
  local status=$? cleanup_status=0
  trap - EXIT
  cleaning=1 cleanup_deadline=$((SECONDS+60))
  if cleanup_owned; then cleanup_status=0; else cleanup_status=1; fi
  printf '%s\n' "$cleanup_status" >"$evidence/cleanup-owned.status"
  if test "$cleanup_status" != 0; then status=1; fi
  printf '%s\n' "$status" >"$evidence/cleanup.status"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
absent prior "$owner"
absent prior-tag "$tag" image
# This infrastructure stage is source-independent and small. Keep the original
# 12GiB SDK reserve plus a separate16GiB build allowance BEFORE construction.
available=$(df --output=avail -B1 "$workspace" | tail -n 1)
(( available >= 28*1024*1024*1024 )) || { echo 'insufficient space for tools and original SDK reserve' >&2; exit 1; }
test ! -e "$evidence/tools.id"
build_attempted=1
controlled tools-build 1200 buildx build --iidfile "$evidence/tools.id" --file "$root/sdk/Dockerfile" --target registry_qualification_tools \
  --platform "linux/$architecture" --load --tag "$tag" "$root"
recorded_image=$(cat "$evidence/tools.id")
[[ $recorded_image =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
# Authority comes from the original build receipt, never from a substituted
# tag discovered while checking that receipt.
image_id=$recorded_image
observed_image=$(controlled tools-id 10 image inspect "$tag" --format '{{.Id}}')
test "$observed_image" = "$image_id"
controlled tools-inspect 10 image inspect "$image_id" >/dev/null
socket_group=$(stat -c '%g' /var/run/docker.sock)
# Only successful prior-absence and this actual create attempt confer authority
# to reconcile a lost response. Partial stdout is not a container identity.
test ! -e "$evidence/container.id"
create_attempted=1
created=$(controlled create 30 container create --init --name "$owner" --cidfile "$evidence/container.id" \
  --label "$label=$owner" --pull=never --platform "linux/$architecture" \
  --read-only --user "$(id -u):$(id -g)" --group-add "$socket_group" \
  --cpus 2 --memory 1g --memory-swap 1g --pids-limit 256 --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=16g,mode=1777 \
  --mount "type=bind,source=$workspace,target=$workspace" \
  --mount "type=bind,source=$root,target=$root,readonly" \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --workdir "$workspace" --env GITHUB_ACTIONS --env GITHUB_SHA --env RUNNER_ENVIRONMENT --env RUNNER_OS \
  --env RUNNER_ARCH --env GITHUB_RUN_ID --env GITHUB_RUN_ATTEMPT --entrypoint /bin/bash "$image_id" \
  --noprofile --norc -euo pipefail -c \
  'node root-a/scripts/sdk-vv-check.mjs tests; node root-a/scripts/sdk-vv-check.mjs run "$1" "$2" "$3" "$4"' \
  sdk-outer "$sdk_image" "$revision" "$architecture" "$destination")
[[ $created =~ ^[a-f0-9]{64}$ ]] || exit 1
container_id=$created
test "$(cat "$evidence/container.id")" = "$container_id"
# The original360-minute job and inner two-run4-hour deadline remain unchanged.
if docker container start --attach "$container_id" >"$evidence/actor.stdout" 2>"$evidence/actor.stderr"; then attached=0; else attached=$?; fi
printf '%s\n' "$attached" >"$evidence/actor.status"
controlled terminal 10 container inspect "$container_id" >/dev/null
test "$attached" = 0
test "$(controlled actor-running 10 container inspect "$container_id" --format '{{.State.Running}}')" = false
test "$(controlled actor-exit 10 container inspect "$container_id" --format '{{.State.ExitCode}}')" = 0
test "$(controlled actor-oom 10 container inspect "$container_id" --format '{{.State.OOMKilled}}')" = false
