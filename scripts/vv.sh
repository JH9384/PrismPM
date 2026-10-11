#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if test "${1:-}" = --with-sdk && test "$#" -lt 2; then
  printf '%s\n' '--with-sdk requires a command' >&2
  exit 64
fi
if test "${1:-}" = --with-sdk; then
  # Preparation must not consume a here-document intended for the command.
  exec {sdk_command_input}<&0
  exec </dev/null
fi
bash scripts/browser-environment-preflight.sh
node --test scripts/devcontainer-init.test.mjs
bash scripts/bootstrap-verify.sh --check-source

# The external-oracle corpus must execute in the SDK image, including on the
# first clean source gate before a release image exists. Build an exact local
# image, publish it to an isolated local registry, and pass its distribution
# manifest digest to the tests. A Docker config image ID is not an OCI
# distribution identity. A caller may instead supply an already verified
# digest (for example, the released image in a consumer repository).
# These exact source-only owners do not consume the separately built SDK image.
# All three preflights and their complete local compiler/browser owners remain.
# Other argv, default/full vv and --with-sdk still prepare the runtime image.
if test -z "${PRISMPM_TEST_SDK_IMAGE:-}" &&
  ! { { test "$#" -eq 1 && test "${1:-}" = package-api; } ||
      { test "$#" -eq 2 && test "${1:-}" = conformance &&
        { test "${2:-}" = holo-stdlib || test "${2:-}" = desktop-browser; }; }; }; then
  zot_image='ghcr.io/project-zot/zot@sha256:cd2aea942f428630bcb4190542be6abd35e14177aab84fc7ccad0dca8ecb363d'
  nonce="$$-${RANDOM}"
  registry="prismpm-vv-registry-${nonce}"
  config_volume="prismpm-vv-registry-config-${nonce}"
  scratch=$(mktemp -d)
  sdk_tag=''
  local_sdk_tag="prismpm-vv-sdk:gate-${nonce}"
  session_owner="${scratch##*/}-${nonce}"
  registry_id=''
  registry_attempted=false
  local_build_attempted=false
  volume_owned=false
  volume_attempted=false
  registry_tag_owned=false
  registry_tag_attempted=false
  local_image_id=''

  cleanup_registry() {
    local command_status=$? cleanup_status=0 current_owner current_image tag recovered recovered_id recovered_owner
    trap - EXIT
    set +e
    if "$registry_attempted" && test -z "$registry_id"; then
      recovered=$(docker container inspect "$registry" --format '{{.Id}} {{index .Config.Labels "io.prismpm.vv-session"}}')
      if test "$?" -eq 0; then
        read -r recovered_id recovered_owner <<< "$recovered"
        if [[ "$recovered_id" =~ ^[0-9a-f]{64}$ ]] && test "$recovered_owner" = "$session_owner"; then
          registry_id=$recovered_id
        else
          printf '%s\n' 'SDK session container ownership differs; refusing removal' >&2
          cleanup_status=1
        fi
      else
        printf 'SDK session could not reconcile attempted container: %s\n' "$registry" >&2
        cleanup_status=1
      fi
    fi
    if test -n "$registry_id"; then
      docker container rm --force "$registry_id" >/dev/null || cleanup_status=1
    fi
    if "$volume_attempted" && ! "$volume_owned"; then
      current_owner=$(docker volume inspect "$config_volume" --format '{{ index .Labels "io.prismpm.vv-session" }}')
      if test "$?" -eq 0 && test "$current_owner" = "$session_owner"; then
        volume_owned=true
      else
        printf 'SDK session could not establish volume ownership; retained name: %s\n' "$config_volume" >&2
        cleanup_status=1
      fi
    fi
    if "$volume_owned"; then
      current_owner=$(docker volume inspect "$config_volume" --format '{{ index .Labels "io.prismpm.vv-session" }}')
      if test "$?" -eq 0 && test "$current_owner" = "$session_owner"; then
        docker volume rm "$config_volume" >/dev/null || cleanup_status=1
      else
        printf '%s\n' 'SDK session volume ownership changed; refusing removal' >&2
        cleanup_status=1
      fi
    fi
    if test -n "$local_image_id"; then
      if "$registry_tag_attempted" && ! "$registry_tag_owned"; then
        current_image=$(docker image inspect "$sdk_tag" --format '{{.Id}}')
        if test "$?" -eq 0 && test "$current_image" = "$local_image_id"; then
          registry_tag_owned=true
        else
          printf 'SDK session could not establish tag ownership; retained name: %s\n' "$sdk_tag" >&2
          cleanup_status=1
        fi
      fi
      for tag in "$sdk_tag" "$local_sdk_tag"; do
        if test "$tag" = "$sdk_tag" && ! "$registry_tag_owned"; then continue; fi
        current_image=$(docker image inspect "$tag" --format '{{.Id}}')
        if test "$?" -eq 0 && test "$current_image" = "$local_image_id"; then
          docker image rm "$tag" >/dev/null || cleanup_status=1
        else
          printf 'SDK session image identity changed; refusing removal: %s\n' "$tag" >&2
          cleanup_status=1
        fi
      done
    elif "$local_build_attempted"; then
      printf 'SDK build did not establish image ownership; inspect possibly retained tag: %s\n' "$local_sdk_tag" >&2
      cleanup_status=1
    fi
    rm -r -- "$scratch" || cleanup_status=1
    if test "$cleanup_status" -ne 0; then
      printf '%s\n' 'SDK session cleanup failed' >&2
    fi
    if test "$command_status" -ne 0; then exit "$command_status"; fi
    exit "$cleanup_status"
  }
  trap cleanup_registry EXIT

  printf '%s\n' '{"distSpecVersion":"1.1.1","http":{"address":"0.0.0.0","port":5000,"compat":["docker2s2"]},"log":{"level":"warn"},"storage":{"rootDirectory":"/tmp/zot"}}' >"$scratch/config.json"
  volume_attempted=true
  docker volume create --label "io.prismpm.vv-session=$session_owner" "$config_volume" >/dev/null
  if test "$(docker volume inspect "$config_volume" --format '{{ index .Labels "io.prismpm.vv-session" }}')" != "$session_owner"; then
    printf '%s\n' 'SDK session volume name belongs to another owner' >&2
    exit 1
  fi
  volume_owned=true
  registry_attempted=true
  if created_registry_id=$(docker container create \
    --name "$registry" \
    --label "io.prismpm.vv-session=$session_owner" \
    --publish 127.0.0.1::5000 \
    --read-only \
    --tmpfs /tmp:rw,nosuid,nodev \
    --volume "$config_volume:/config" \
    "$zot_image" \
    serve /config/config.json); then
    if [[ "$created_registry_id" =~ ^[0-9a-f]{64}$ ]]; then
      registry_id=$created_registry_id
    fi
  else
    exit "$?"
  fi
  if test -z "$registry_id"; then
    printf '%s\n' 'SDK session container identity is invalid' >&2
    exit 1
  fi
  docker container cp "$scratch/config.json" "$registry_id:/config/config.json"
  docker container start "$registry_id" >/dev/null

  endpoint=$(docker container port "$registry_id" 5000/tcp | sed -n '1p')
  case "$endpoint" in
    127.0.0.1:[0-9]*) ;;
    *) printf 'SDK gate registry returned an invalid endpoint: %s\n' "$endpoint" >&2; exit 1 ;;
  esac

  # The devcontainer and registry share the daemon's default bridge. Its IP
  # reaches the registry from here; published loopback is for daemon image I/O.
  registry_ip=$(docker container inspect "$registry_id" \
    --format '{{(index .NetworkSettings.Networks "bridge").IPAddress}}')
  if ! node scripts/registry-smoke.mjs "http://$registry_ip:5000"; then
    docker container logs "$registry_id" >&2 || true
    exit 1
  fi

  if docker image inspect "$local_sdk_tag" >/dev/null 2>&1; then
    printf '%s\n' 'SDK session local image tag already exists' >&2
    exit 1
  fi
  local_build_attempted=true
  node scripts/sdk-image-inputs.mjs build . "$(git rev-parse HEAD)" runtime \
    --build-arg SOURCE_DATE_EPOCH=0 \
    --load \
    --tag "$local_sdk_tag"
  local_image_id=$(docker image inspect "$local_sdk_tag" --format '{{.Id}}')
  if ! [[ "$local_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    local_image_id=''
    printf '%s\n' 'SDK session local image identity is invalid' >&2
    exit 1
  fi

  sdk_tag="$endpoint/prismpm-vv-sdk:gate"
  if docker image inspect "$sdk_tag" >/dev/null 2>&1; then
    printf '%s\n' 'SDK session registry image tag already exists' >&2
    exit 1
  fi
  registry_tag_attempted=true
  docker image tag "$local_sdk_tag" "$sdk_tag"
  registry_tag_owned=true
  for attempt in $(seq 1 20); do
    if docker image push "$sdk_tag"; then
      break
    fi
    if test "$attempt" -eq 20; then
      printf 'SDK gate image push failed after %s attempts\n' "$attempt" >&2
      docker container logs "$registry_id" >&2 || true
      exit 1
    fi
    sleep 0.25
  done

  sdk_reference=$(docker image inspect "$sdk_tag" --format '{{range .RepoDigests}}{{println .}}{{end}}' \
    | awk -v prefix="$endpoint/prismpm-vv-sdk@sha256:" 'index($0, prefix) == 1 { print; exit }')
  case "$sdk_reference" in
    "$endpoint"/prismpm-vv-sdk@sha256:????????????????????????????????????????????????????????????????) ;;
    *) printf 'SDK gate push returned an invalid manifest reference: %s\n' "$sdk_reference" >&2; exit 1 ;;
  esac
  if ! [[ "${sdk_reference##*@sha256:}" =~ ^[0-9a-f]{64}$ ]]; then
    printf '%s\n' 'SDK gate manifest digest is not lowercase SHA-256' >&2
    exit 1
  fi
  export PRISMPM_TEST_SDK_IMAGE="$sdk_reference"
fi

if test "${1:-}" = --with-sdk; then
  # Keep this exact image and its owned registry alive for the command. Nested
  # unchanged `just vv` invocations inherit the digest, never acceptance data.
  shift
  "$@" <&"$sdk_command_input"
elif test "$#" -gt 0; then
  cargo xtask "$@"
else
  cargo xtask vv
fi
