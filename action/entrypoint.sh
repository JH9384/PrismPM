#!/usr/bin/env bash
set -euo pipefail

case "${PRISMPM_ACTION_SDK_IMAGE:-}" in
  *@sha256:????????????????????????????????????????????????????????????????) ;;
  *) printf '%s\n' 'sdk-image must be an immutable sha256 reference' >&2; exit 2 ;;
esac

case "${GITHUB_WORKSPACE:-}" in /*) ;; *) printf '%s\n' 'GITHUB_WORKSPACE must be absolute' >&2; exit 2 ;; esac
context=${PRISMPM_ACTION_CONTEXT:-.}
case "$context" in
  /*|*..*|*\\*) printf '%s\n' 'context must be a confined repository path' >&2; exit 2 ;;
esac
project=$GITHUB_WORKSPACE/$context
action_path=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
command=${PRISMPM_ACTION_COMMAND:-}
reference=${PRISMPM_ACTION_REFERENCE:-}
export_output=${PRISMPM_ACTION_OUTPUT:-}
publication_url=${PRISMPM_ACTION_URL:-}
release=${PRISMPM_ACTION_RELEASE:-}
target=${PRISMPM_ACTION_TARGET:-}
plan=${PRISMPM_ACTION_PLAN:-}
backup=${PRISMPM_ACTION_BACKUP:-}
restore_target=${PRISMPM_ACTION_RESTORE_TARGET:-}
detach=${PRISMPM_ACTION_DETACH:-false}
authorized=${PRISMPM_ACTION_AUTHORIZED:-false}
secret_directory=${PRISMPM_ACTION_SECRET_DIRECTORY:-.prismpm/secrets}
bundle=${PRISMPM_ACTION_BUNDLE:-}
trusted_root=${PRISMPM_ACTION_TRUSTED_ROOT:-}
policy=${PRISMPM_ACTION_POLICY:-}
promotion_to=${PRISMPM_ACTION_PROMOTION_TO:-}
environment=${PRISMPM_ACTION_ENVIRONMENT:-}
args=(--json)
socket_args=()
credential_args=()
network_args=(--network none)
pages_publication=false
pages_repository=

case "${GITHUB_SHA:-}" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
    credential_args+=(--env "PRISMPM_SOURCE_REVISION=$GITHUB_SHA")
    ;;
  "") ;;
  *) printf '%s\n' 'GITHUB_SHA must be a lowercase 40-character Git object ID' >&2; exit 2 ;;
esac

case "$detach:$authorized" in
  true:true|true:false|false:true|false:false) ;;
  *) printf '%s\n' 'detach and authorized must be true or false' >&2; exit 2 ;;
esac

case "$command" in
  check|verify)
    args=(--project "$project" "${args[@]}")
    args+=("$command")
    ;;
  fetch)
    network_args=()
    args=(--project "$project" "${args[@]}")
    args+=(fetch --locked)
    ;;
  build)
    test -n "$reference"
    args+=(build --locked --tag "$reference" "$project")
    if test -n "$release"; then args+=(--release "$release"); fi
    ;;
  publish-pages)
    # Build once, export the built release's browser closure, then check that
    # closure against the release's system manifest before any upload step.
    if test -z "$reference" || test -z "$export_output"; then
      printf '%s\n' 'publish-pages requires a tagged build reference and an output name' >&2; exit 2
    fi
    case "$reference" in
      *@*) printf '%s\n' 'publish-pages builds from a tagged destination, not an immutable digest' >&2; exit 2 ;;
    esac
    pages_tag=${reference##*:}
    case "$pages_tag" in
      ""|*/*) printf '%s\n' 'publish-pages requires a REPOSITORY:TAG build destination' >&2; exit 2 ;;
    esac
    pages_repository=${reference%:*}
    pages_publication=true
    args+=(build --locked --tag "$reference" "$project")
    if test -n "$release"; then args+=(--release "$release"); fi
    ;;
  push|pull)
    network_args=()
    test -n "$reference"
    docker_config=${DOCKER_CONFIG:-$HOME/.docker}
    test -d "$docker_config"
    case "$docker_config" in /*) ;; *) printf '%s\n' 'Docker credential directory must be absolute' >&2; exit 2 ;; esac
    credential_args+=(
      --env DOCKER_CONFIG=/home/vscode/.docker
      --volume "$docker_config:/home/vscode/.docker:ro"
    )
    args=(--project "$project" "${args[@]}")
    args+=("$command" "$reference")
    ;;
  inspect|verify-release)
    test -n "$reference"
    args=(--project "$project" "${args[@]}")
    args+=("$command" "$reference")
    ;;
  export-browser)
    test -n "$reference"
    test -n "$export_output"
    args=(--project "$project" "${args[@]}")
    args+=(export-browser "$reference" --output "$export_output")
    ;;
  verify-browser-publication)
    test -n "$reference"
    test -n "$publication_url"
    network_args=()
    args=(--project "$project" "${args[@]}")
    args+=(verify-browser-publication "$reference" --url "$publication_url")
    ;;
  conformance)
    test -n "$reference"
    test -S /var/run/docker.sock
    socket_group=$(stat -c '%g' /var/run/docker.sock)
    socket_args=(--volume /var/run/docker.sock:/var/run/docker.sock --group-add "$socket_group")
    network_args=()
    args=(--project "$project" "${args[@]}")
    args+=(conformance "$reference")
    ;;
  prepare-promotion)
    test -n "$reference" && test -n "$environment"
    for name in GITHUB_ACTIONS RUNNER_ENVIRONMENT GITHUB_REPOSITORY GITHUB_WORKFLOW GITHUB_WORKFLOW_REF GITHUB_REF GITHUB_SHA; do
      test -n "${!name:-}"
      credential_args+=(--env "$name=${!name}")
    done
    args=(--project "$project" "${args[@]}")
    args+=(prepare-promotion "$reference" --environment "$environment")
    ;;
  sign)
    network_args=()
    test -n "$reference" && test -n "$trusted_root" && test -n "$policy"
    test -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" && test -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}"
    credential_args=(
      --env ACTIONS_ID_TOKEN_REQUEST_TOKEN
      --env ACTIONS_ID_TOKEN_REQUEST_URL
    )
    args=(--project "$project" "${args[@]}")
    args+=(sign "$reference" --trusted-root "$trusted_root" --policy "$policy")
    ;;
  sign-evidence)
    network_args=()
    test -n "$reference" && test -n "$trusted_root" && test -n "$policy"
    test -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" && test -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}"
    credential_args+=(
      --env ACTIONS_ID_TOKEN_REQUEST_TOKEN
      --env ACTIONS_ID_TOKEN_REQUEST_URL
    )
    args=(--project "$project" "${args[@]}")
    args+=(sign-evidence "$reference" --all --trusted-root "$trusted_root" --policy "$policy")
    ;;
  verify-signature)
    test -n "$reference" && test -n "$bundle" && test -n "$trusted_root" && test -n "$policy"
    args=(--project "$project" "${args[@]}")
    args+=(verify-signature "$reference" --bundle "$bundle" --trusted-root "$trusted_root" --policy "$policy")
    ;;
  promote)
    network_args=()
    test -n "$reference" && test -n "$trusted_root" && test -n "$policy" && test -n "$promotion_to"
    test -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" && test -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}"
    credential_args=(
      --env ACTIONS_ID_TOKEN_REQUEST_TOKEN
      --env ACTIONS_ID_TOKEN_REQUEST_URL
    )
    args=(--project "$project" "${args[@]}")
    args+=(promote "$reference" --to "$promotion_to" --trusted-root "$trusted_root" --policy "$policy")
    ;;
  run|plan|deploy|status|rollback|backup|restore|destroy|finalize-contract)
    network_args=()
    test -n "$reference" && test -n "$target"
    test -S /var/run/docker.sock
    socket_group=$(stat -c '%g' /var/run/docker.sock)
    socket_args=(--volume /var/run/docker.sock:/var/run/docker.sock --group-add "$socket_group")
    case "$secret_directory" in /*|*..*|*\\*) printf '%s\n' 'secret-directory must be a confined repository path' >&2; exit 2 ;; esac
    if test -d "$GITHUB_WORKSPACE/$secret_directory"; then
      credential_args+=(--env "PRISMPM_SECRET_DIR=$GITHUB_WORKSPACE/$secret_directory")
    fi
    args=(--project "$project" "${args[@]}")
    case "$command" in
      run)
        args+=(run --target "$target" "$reference")
        if test "$detach" = true; then args+=(--detach); fi
        ;;
      deploy)
        test -n "$plan"
        args+=(deploy --target "$target" --plan "$plan" "$reference")
        ;;
      restore)
        test -n "$backup" && test -n "$restore_target"
        case "$backup" in /*|*..*|*\\*) printf '%s\n' 'backup must be a confined repository path' >&2; exit 2 ;; esac
        args+=(restore --target "$target" --restore-target "$restore_target" --backup "$project/$backup" "$reference")
        ;;
      destroy)
        test "$authorized" = true
        args+=(destroy --target "$target" --authorized "$reference")
        ;;
      finalize-contract)
        test "$authorized" = true
        args+=(finalize-contract --target "$target" --authorized "$reference")
        ;;
      *) args+=("$command" --target "$target" "$reference") ;;
    esac
    ;;
  *) printf 'unsupported PrismPM action command: %s\n' "$command" >&2; exit 2 ;;
esac

result_file=$(mktemp "${RUNNER_TEMP:-/tmp}/prismpm-result.XXXXXX")
export_file=
closure_file=
cleanup() { rm -f "$result_file" "${export_file:-}" "${closure_file:-}"; }
trap cleanup EXIT

# Project one field of a canonical result inside the SDK image, with no
# project, socket or credential mount and no network.
project_field() {
  docker run --rm --interactive --network none --user "$(id -u):$(id -g)" \
    --env HOME=/tmp/prismpm-home --tmpfs /tmp:rw,exec,nosuid,size=64m \
    --cap-drop ALL --security-opt no-new-privileges "$PRISMPM_ACTION_SDK_IMAGE" node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);process.stdout.write(v[process.argv[1]]||"")})' \
    "$1" <"$2"
}

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp/prismpm-home \
  --env PRISMPM_EPHEMERAL_HOME=1 \
  --env BUILDX_CONFIG=/tmp/prismpm-buildx \
  --tmpfs /tmp:rw,exec,nosuid,size=2g \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  "${network_args[@]}" \
  --volume "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE" \
  "${socket_args[@]}" \
  "${credential_args[@]}" \
  "$PRISMPM_ACTION_SDK_IMAGE" \
  prismpm "${args[@]}" >"$result_file"

if test "$pages_publication" = true; then
  release_digest=$(project_field release_digest "$result_file")
  case "$release_digest" in
    sha256:????????????????????????????????????????????????????????????????) ;;
    *) printf '%s\n' 'product build did not return an immutable release digest' >&2; exit 5 ;;
  esac
  export_file=$(mktemp "${RUNNER_TEMP:-/tmp}/prismpm-export.XXXXXX")
  closure_file=$(mktemp "${RUNNER_TEMP:-/tmp}/prismpm-closure.XXXXXX")
  # Export the exact built release without rebuilding: same isolation, no network.
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    --env HOME=/tmp/prismpm-home \
    --env PRISMPM_EPHEMERAL_HOME=1 \
    --tmpfs /tmp:rw,exec,nosuid,size=1g \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    "${network_args[@]}" \
    --volume "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE" \
    "${socket_args[@]}" \
    "${credential_args[@]}" \
    "$PRISMPM_ACTION_SDK_IMAGE" \
    prismpm --project "$project" --json export-browser "$pages_repository@$release_digest" --output "$export_output" >"$export_file"
  tree_digest=$(project_field tree_digest "$export_file")
  # Check the exported closure against the release's system manifest with the
  # workspace read-only, no network and no credentials. A system manifest that
  # does not name the Pages target fails here, before any upload step.
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    --env HOME=/tmp/prismpm-home \
    --env PRISMPM_EPHEMERAL_HOME=1 \
    --tmpfs /tmp:rw,exec,nosuid,size=1g \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --network none \
    --volume "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE:ro" \
    --volume "$action_path:$action_path:ro" \
    "$PRISMPM_ACTION_SDK_IMAGE" \
    node "$action_path/pages-closure.mjs" "$project" "$release_digest" "$export_output" "$tree_digest" >"$closure_file"
  cp "$export_file" "$result_file"
fi

result=$(tr -d '\n' <"$result_file")
printf 'result=%s\n' "$result" >>"$GITHUB_OUTPUT"
for pair in release-digest:release_digest plan-digest:plan_digest evidence-digest:evidence_digest transcript-digest:transcript_digest signature-referrer:signature_referrer; do
  output=${pair%%:*}
  field=${pair#*:}
  value=$(project_field "$field" "$result_file")
  printf '%s=%s\n' "$output" "$value" >>"$GITHUB_OUTPUT"
done
if test "$command" = prepare-promotion; then
  digest=${reference##*@sha256:}
  printf 'policy-path=.prism/promotion/%s/policy.json\n' "$digest" >>"$GITHUB_OUTPUT"
  printf 'trusted-root-path=.prism/promotion/%s/trusted-root.json\n' "$digest" >>"$GITHUB_OUTPUT"
fi
if test "$pages_publication" = true; then
  if test "$context" = .; then pages_path=$export_output; else pages_path=$context/$export_output; fi
  printf 'pages-path=%s\n' "$pages_path" >>"$GITHUB_OUTPUT"
  printf 'pages-closure=%s\n' "$(tr -d '\n' <"$closure_file")" >>"$GITHUB_OUTPUT"
fi
