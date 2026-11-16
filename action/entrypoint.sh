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
# The checkout the Action runs from: pages-closure.mjs reads the release through
# prism-code's export module in sdk/npm/prism-code of the same checkout.
action_root=$(dirname "$action_path")
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

# `factory`: establish one obligation of the Prism factory's delegation
# (prism-factory/model/src/Factory/Delegation.lex.tex). `context` is the
# closure `factory.sh forge-prepare` materialized; only it is mounted, at
# /work. A sealed sandbox has no network; a pinned one fetches by digest only
# (the obligation's own locks). The user, umask, HOME and scratch tmpfs come
# from the obligation's sandbox record. The outcome is the result, so a
# failure is a receipt, not a failed step.
if test "$command" = factory; then
  test -n "$target"
  test -d "$project"
  run_command=$(cat "$project.run")
  access=$(cat "$project.access")
  image=$(cat "$project.image")
  test "$image" = @sdk || { printf '%s\n' "factory: image $image is not the SDK image; not yet carried" >&2; exit 2; }
  # The sandbox record: prism/1 IMAGE USER UMASK HOME SCRATCH ACCESS, with HOME
  # and SCRATCH named from the root. It is part of the obligation's identity,
  # so the container is made from it and nothing else.
  read -r sandbox_version _ sandbox_user sandbox_umask sandbox_home sandbox_scratch sandbox_access <"$project.sandbox"
  test "$sandbox_version" = prism/1 || { printf '%s\n' "factory: unknown sandbox record $sandbox_version" >&2; exit 2; }
  test "$sandbox_access" = "$access" || { printf '%s\n' "factory: the sandbox record says $sandbox_access" >&2; exit 2; }
  case "$sandbox_user:$sandbox_umask:$sandbox_home:$sandbox_scratch" in
    *[!0-9a-z/:._-]*|*..*) printf '%s\n' 'factory: the sandbox record is not confined' >&2; exit 2 ;;
  esac
  case "$sandbox_home" in "$sandbox_scratch"/*) ;; *) printf '%s\n' 'factory: HOME must be inside the scratch' >&2; exit 2 ;; esac
  # Cargo's home starts from the image's locked offline cache when the image
  # carries one (the SDK's prismpm-cargo-home), so a pinned fetch only adds
  # what the closure's locks name beyond it.
  seed_cargo='if test -x /usr/local/libexec/prismpm-cargo-home; then CARGO_HOME=$(PRISMPM_EPHEMERAL_HOME=1 TMPDIR=/'"$sandbox_scratch"' /usr/local/libexec/prismpm-cargo-home); export CARGO_HOME; fi;'
  # The closure is a throwaway copy; the sandbox user must be able to write
  # its build outputs there.
  chmod -R a+rwX "$project"
  # sealed: no network. pinned: fetches by the closure's own locks. daemon:
  # pinned, plus the lent runner's own container daemon (it is ephemeral and
  # holds nothing else), with scratch on the runner's disk, since the images
  # such an obligation drives do not fit in memory.
  scratch_args=(--tmpfs "/$sandbox_scratch:rw,exec,nosuid,size=8g")
  case "$access" in
    sealed) network_args=(--network none) ;;
    pinned) network_args=() ;;
    daemon|publish)
      network_args=(--volume /var/run/docker.sock:/var/run/docker.sock --group-add "$(stat -c %g /var/run/docker.sock)")
      # The hosted runner's unused toolchains leave too little disk for images.
      sudo rm -rf /usr/local/lib/android /usr/share/dotnet /opt/ghc /opt/hostedtoolcache/CodeQL /usr/local/.ghcup \
        /usr/share/swift /usr/local/share/boost /usr/local/julia* /opt/az /opt/microsoft \
        /usr/lib/jvm /usr/share/miniconda /usr/local/share/powershell
      scratch=$RUNNER_TEMP/prism-scratch-$target
      mkdir -p "$scratch" && chmod 1777 "$scratch"
      scratch_args=(--volume "$scratch:/$sandbox_scratch")
      df -h / >&2
      # publish: daemon, plus a registry login that may push this
      # repository's packages by digest, in a Docker config of its own.
      if test "$access" = publish; then
        test -n "${PRISMPM_ACTION_REGISTRY_TOKEN:-}" || { printf '%s\n' 'factory: publish access needs a registry token' >&2; exit 2; }
        docker_config=$RUNNER_TEMP/prism-docker-$target
        rm -rf "$docker_config" && mkdir -p "$docker_config"
        # The registry refuses a login now and then; a refusal is retried
        # before it is taken as the token's.
        for attempt in 1 2 3 4; do
          printf '%s' "$PRISMPM_ACTION_REGISTRY_TOKEN" | DOCKER_CONFIG=$docker_config docker login ghcr.io -u "${GITHUB_ACTOR:?}" --password-stdin >/dev/null && break
          test "$attempt" -lt 4 || { printf '%s\n' 'factory: the registry refused the login four times' >&2; exit 1; }
          sleep $((attempt * 15))
        done
        chmod -R a+rwX "$docker_config"
        network_args+=(--volume "$docker_config:/prism-docker" --env DOCKER_CONFIG=/prism-docker)
      fi
      ;;
    *) printf '%s\n' "factory: access $access is not sealed, pinned, daemon or publish" >&2; exit 2 ;;
  esac
  status=0
  docker run --rm \
    --user "$sandbox_user" \
    --env HOME="/$sandbox_home" \
    --env CARGO_HOME="/$sandbox_home/cargo" \
    --env FACTORY_OBLIGATION="$target" \
    --env PRISM_OUTPUTS=/work/.prism-outputs \
    --env GIT_CONFIG_COUNT=1 --env GIT_CONFIG_KEY_0=safe.directory --env GIT_CONFIG_VALUE_0=/work \
    "${scratch_args[@]}" \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    "${network_args[@]}" \
    --volume "$project:/work" \
    --workdir /work \
    "$PRISMPM_ACTION_SDK_IMAGE" \
    bash -euo pipefail -c "umask $sandbox_umask; $seed_cargo $run_command" || status=$?
  if test "$status" = 0; then passed=true; else passed=false; fi
  printf 'result={"obligation":"%s","passed":%s,"status":%s}\n' "$target" "$passed" "$status" >>"$GITHUB_OUTPUT"
  exit 0
fi

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
    --volume "$action_root:$action_root:ro" \
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
