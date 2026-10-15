#!/usr/bin/env bash
# Hosted infrastructure only. No SDK image/archive is pulled to a maintainer host.
set -euo pipefail
started=$SECONDS
whole_deadline=$((started+21600))
work_deadline=$((whole_deadline-180))
test "$#" -eq 4 || { echo 'usage: unpublished-sdk-qualification.sh CLOSED_SELECTION ARCH PHASE FRESH_OUTPUT' >&2; exit 64; }
selection=$1 architecture=$2 phase=$3 output=$4
case "$(uname -m):$architecture" in x86_64:amd64|aarch64:arm64) ;; *) exit 64 ;; esac
case "$phase" in prerequisites|installed) ;; *) exit 64 ;; esac
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REPOSITORY:-}" = UOR-Foundation/PrismPM
[[ ${GITHUB_SHA:-} =~ ^[0-9a-f]{40}$ ]]
root=$(cd "$(dirname "$0")/.." && pwd -P)
test "$(basename "$root")" = root-a
test "$(git -C "$root" rev-parse HEAD)" = "$GITHUB_SHA"
test -z "$(git -C "$root" status --porcelain)"
test ! -e "$output"
mkdir -m 0700 "$output"
output=$(cd "$output" && pwd -P)
mkdir -m 0700 "$output/private"
nonce=$(cat /proc/sys/kernel/random/uuid)
[[ $nonce =~ ^[a-f0-9-]{36}$ ]]
name="prism-unpublished-outer-$nonce"
tag="prism-unpublished-tools:$GITHUB_SHA-$nonce"
label=org.uor.prismpm.unpublished-outer
container_id= image_id= create_attempted=0 build_attempted=0 cleaning=0 cleanup_deadline=0
controlled() {
  local operation=$1 bound=$2 status remaining deadline
  shift 2
  deadline=$work_deadline
  if (( cleaning )); then deadline=$cleanup_deadline; fi
  # Charge timeout's existing two-second kill/retirement allowance to the
  # original shared clock, including the last cleanup command.
  remaining=$((deadline-SECONDS-2))
  if (( remaining<=0 )); then
    printf '%s\n' 'original owned-command deadline exhausted before launch' >"$output/$operation.stderr"
    : >"$output/$operation.stdout"
    printf '%s\n' 124 >"$output/$operation.status"
    return 124
  fi
  (( remaining>=bound )) || bound=$remaining
  if timeout --signal=TERM --kill-after=2s "${bound}s" docker "$@" >"$output/$operation.stdout" 2>"$output/$operation.stderr"; then status=0; else status=$?; fi
  printf '%s\n' "$status" >"$output/$operation.status"
  cat "$output/$operation.stdout"
  return "$status"
}
absent() {
  local operation=$1 kind=$2 id=$3 status
  if controlled "$operation" 10 "$kind" inspect "$id"; then return 1; else status=$?; fi
  test "$status" = 1
  [[ $(cat "$output/$operation.stderr") =~ [Nn]o[[:space:]]such|not[[:space:]]found ]]
}
cleanup() {
  local status=$? failure=0 actual
  trap - EXIT
  cleaning=1 cleanup_deadline=$((SECONDS+180))
  (( cleanup_deadline<=whole_deadline )) || cleanup_deadline=$whole_deadline
  if (( create_attempted )); then
    if test -f "$output/private/container.id"; then
      actual=$(cat "$output/private/container.id")
      if [[ $actual =~ ^[a-f0-9]{64}$ ]] && { test -z "$container_id" || test "$container_id" = "$actual"; }; then
        container_id=$actual
        if controlled terminal 10 container inspect "$container_id"; then
          test "$(controlled terminal-label 10 container inspect "$container_id" --format '{{index .Config.Labels "org.uor.prismpm.unpublished-outer"}}')" = "$nonce" || failure=1
          if test "$failure" = 0; then
            if test "$(controlled terminal-running 10 container inspect "$container_id" --format '{{.State.Running}}')" = true; then
              # This is an interrupted owner, never a successful qualification.
              failure=1
              controlled interrupted-stop 35 container stop --time 30 "$container_id" || true
            fi
            if test "$(controlled removal-running 10 container inspect "$container_id" --format '{{.State.Running}}')" = false; then
              controlled removal 10 container rm "$container_id" || failure=1
            else failure=1; fi
          fi
        fi
        absent container-id-absence container "$container_id" || failure=1
      else failure=1; fi
    else failure=1; fi
  fi
  absent container-name-absence container "$name" || failure=1
  if (( build_attempted )) && test -z "$image_id" && test -f "$output/private/tools.id"; then image_id=$(cat "$output/private/tools.id"); fi
  if [[ $image_id =~ ^sha256:[a-f0-9]{64}$ ]]; then
    if test "$(controlled tools-final-id 10 image inspect "$tag" --format '{{.Id}}')" = "$image_id"; then
      controlled tools-tag-removal 10 image rm "$tag" || failure=1
    else failure=1; fi
  fi
  absent tools-tag-absence image "$tag" || failure=1
  printf '%s\n' "$failure" >"$output/cleanup-owned.status"
  if test "$failure" != 0; then status=1; fi
  printf '%s\n' "$status" >"$output/cleanup.status"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
test ! -e "$root/target" && test ! -L "$root/target"
mkdir -m 0700 "$root/target"
git -C "$root" check-ignore --quiet -- target/
stat --printf='%d:%i:%u:%g:%a\n' "$root/target" >"$output/owned-target-before.txt"
absent prior-container container "$name"
absent prior-tools-tag image "$tag"
# Preserve the existing SDK outer owner's16GiB infrastructure allowance and
#12GiB reserve. Actual archive/DiffID measurements and original owners perform
# their subsequent admissions; no new fixed full-SDK capacity is fabricated.
available=$(df --output=avail -B1 "$output" | tail -n 1)
(( available >= 28*1024*1024*1024 )) || { echo 'original tools allowance and SDK reserve unavailable' >&2; exit 1; }
build_attempted=1
controlled tools-build 1200 buildx build --iidfile "$output/private/tools.id" --file "$root/sdk/Dockerfile" \
  --target registry_qualification_tools --platform "linux/$architecture" --load --tag "$tag" "$root"
image_id=$(cat "$output/private/tools.id")
[[ $image_id =~ ^sha256:[a-f0-9]{64}$ ]]
test "$(controlled tools-image-id 10 image inspect "$tag" --format '{{.Id}}')" = "$image_id"
controlled tools-initial 10 image inspect "$image_id" >/dev/null
remaining=$((21600-(SECONDS-started)-180-5))
(( remaining > 180 ))
owner_end_epoch_ms=$(( $(date +%s%3N) + remaining*1000 ))
socket_group=$(stat -c '%g' /var/run/docker.sock)
[[ $socket_group =~ ^[0-9]+$ ]]
create_attempted=1
container_id=$(controlled create 30 container create --interactive --init --name "$name" --cidfile "$output/private/container.id" \
  --label "$label=$nonce" --pull=never --platform "linux/$architecture" --read-only \
  --user "$(id -u):$(id -g)" --group-add "$socket_group" --cpus 2 --memory 1g --memory-swap 1g --pids-limit 256 \
  --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,exec,nosuid,nodev,size=1g,mode=1777 \
  --mount "type=bind,source=$(dirname "$root"),target=$(dirname "$root")" \
  --mount "type=bind,source=$root,target=$root,readonly" \
  --mount "type=bind,source=$root/target,target=$root/target" \
  --mount "type=bind,source=$RUNNER_TEMP,target=$RUNNER_TEMP" \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock --workdir "$root" \
  --env GITHUB_ACTIONS --env GITHUB_REPOSITORY --env GITHUB_SHA --env GITHUB_RUN_ID --env GITHUB_RUN_ATTEMPT \
  --env RUNNER_ENVIRONMENT --env RUNNER_OS --env RUNNER_ARCH \
  --env "PRISMPM_QUALIFICATION_TOOLS_IMAGE=$image_id" --env "PRISMPM_QUALIFICATION_WHOLE_REMAINING=$remaining" \
  --env "PRISMPM_QUALIFICATION_WHOLE_END_UTC_MS=$owner_end_epoch_ms" \
  --entrypoint node "$image_id" scripts/unpublished-sdk-qualification.mjs "$selection" "$architecture" "$phase" "$output/inner")
[[ $container_id =~ ^[a-f0-9]{64}$ ]]
test "$(cat "$output/private/container.id")" = "$container_id"
controlled container-initial 10 container inspect "$container_id" >/dev/null
remaining=$((21600-(SECONDS-started)-180-5))
(( remaining > 180 ))
if timeout --signal=TERM --kill-after=5s "${remaining}s" docker start --attach --interactive "$container_id" >"$output/owner.stdout" 2>"$output/owner.stderr"; then attached=0; else attached=$?; fi
printf '%s\n' "$attached" >"$output/owner.status"
controlled container-terminal 10 container inspect "$container_id" >/dev/null
test "$attached" = 0
test "$(controlled owner-running 10 container inspect "$container_id" --format '{{.State.Running}}')" = false
test "$(controlled owner-exit 10 container inspect "$container_id" --format '{{.State.ExitCode}}')" = 0
test "$(controlled owner-oom 10 container inspect "$container_id" --format '{{.State.OOMKilled}}')" = false
test "$(git -C "$root" rev-parse HEAD)" = "$GITHUB_SHA"
test -z "$(git -C "$root" status --porcelain)"
stat --printf='%d:%i:%u:%g:%a\n' "$root/target" >"$output/owned-target-after.txt"
cmp "$output/owned-target-before.txt" "$output/owned-target-after.txt"
