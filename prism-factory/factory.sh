#!/usr/bin/env bash
# The Prism factory's entry point on a laptop, a runner, or any CI.
#
#   factory.sh plan|request|run|workflow|route-record [options]   the host CLI (see `prism-factory`)
#   factory.sh ci                     plan and run this host's obligations against the receipts branch
#   factory.sh actions-route          a release run's factory job: run host obligations, write routes
#   factory.sh actions-receipts       a release run's receipts job: record and push its receipts
#   factory.sh actions-cut            the release cut: tag vVERSION and dispatch its publication run
#                                     when the certified plan says the rehearsed commit is cuttable
#   factory.sh site DIR               build the GitHub Pages site into DIR
#   factory.sh forge-plan             delegation `plan` job: verify kept receipts, write what to establish
#   factory.sh forge-prepare NAME     delegation `establish` job: materialize NAME's closure for the Action
#   factory.sh forge-receipt NAME     write NAME's receipt from the Action's result
#   factory.sh forge-bundle NAME      place the receipt's Sigstore bundle beside it
#   factory.sh forge-report           delegation `report` job: verify every receipt, report the check
#   factory.sh forge-keep             delegation `keep` job: keep verified receipts on the receipts branch
#
# Decisions are made by the certified core in prism-factory/certified; this
# script only builds the host and moves receipts.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
manifest=prism-factory/host/Cargo.toml
host=prism-factory/host/target/release/prism-factory
store=target/factory/receipts
branch=${FACTORY_RECEIPTS_BRANCH:-factory-receipts}

build() { cargo build --quiet --release --locked --offline --manifest-path "$manifest"; }

fetch_receipts() {
  rm -rf "$store"; mkdir -p "$store"
  if git fetch --quiet --depth=1 origin "refs/heads/$branch" 2>/dev/null; then
    git archive FETCH_HEAD | tar -x -C "$store"
  fi
}

publish_receipts() {
  # Adds this run's receipts to the branch's newest head, reweighs the schedule
  # by this run's outcomes, and pushes; another run may push first, so retry.
  local fresh=$1 attempt index tree commit parent blob receipt
  for attempt in 1 2 3 4 5; do
    index=$(mktemp)
    parent=()
    if git fetch --quiet --depth=1 origin "refs/heads/$branch" 2>/dev/null; then
      GIT_INDEX_FILE=$index git read-tree FETCH_HEAD
      parent=(-p "$(git rev-parse FETCH_HEAD)")
    else
      rm -f "$index"
    fi
    for receipt in "$fresh"/*.receipt; do
      [ -e "$receipt" ] || continue
      blob=$(git hash-object -w "$receipt")
      GIT_INDEX_FILE=$index git update-index --add --cacheinfo "100644,$blob,${receipt##*/}"
    done
    { GIT_INDEX_FILE=$index git cat-file blob :weights 2>/dev/null || true; cat "$fresh/outcomes" 2>/dev/null || true; } \
      | "$host" reweigh > "$fresh/weights"
    blob=$(git hash-object -w "$fresh/weights")
    GIT_INDEX_FILE=$index git update-index --add --cacheinfo "100644,$blob,weights"
    # The index is what the Pages site and a laptop read: receipt lines, then weights.
    GIT_INDEX_FILE=$index git ls-files -- '*.receipt' | while read -r receipt; do
      GIT_INDEX_FILE=$index git cat-file blob ":$receipt" | head -n 1
    done > "$fresh/index"
    cat "$fresh/weights" >> "$fresh/index"
    blob=$(git hash-object -w "$fresh/index")
    GIT_INDEX_FILE=$index git update-index --add --cacheinfo "100644,$blob,index"
    tree=$(GIT_INDEX_FILE=$index git write-tree)
    rm -f "$index"
    commit=$(git -c user.name=prism-factory -c user.email=prism-factory@users.noreply.github.com \
      commit-tree "$tree" "${parent[@]}" -m "Receipts of run ${GITHUB_RUN_ID:-local} for $(git rev-parse HEAD)")
    if git push --quiet origin "$commit:refs/heads/$branch"; then return 0; fi
    sleep $((attempt * 5))
  done
  echo "factory.sh: could not push receipts to $branch" >&2
  return 1
}

# ---------------------------------------------------------------- delegation
# GitHub is the forge (prism-factory/model/src/Factory/Delegation.lex.tex): it
# verifies receipts and the certified `delegate` root decides. A receipt is a
# file `KAPPA-pass|fail.receipt`; its Sigstore bundle `KAPPA-...jsonl` (gh reads
# only .json and .jsonl bundles) was
# made by actions/attest-build-provenance in this repository's delegation
# workflow, and `gh attestation verify` checks it before the root sees it.
delegation_branch=${PRISM_RECEIPTS_BRANCH:-prism-receipts}
delegation_workflow=.github/workflows/prism-delegation.yml
work=target/factory/work
kept=target/factory/kept
fresh=target/factory/fresh

forge_event() {
  case "${GITHUB_EVENT_NAME:-workflow_dispatch}:${GITHUB_REF:-}" in
    push:refs/tags/*) echo tag ;;
    pull_request:*) echo pull_request ;;
    push:*) echo push ;;
    *) echo workflow_dispatch ;;
  esac
}

forge_contexts() {
  printf -- '--context\nmode=%s\n--context\nrun=%s\n' "$( [ "$(forge_event)" = tag ] && echo publish || echo rehearsal )" "${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
}

# Writes the trust and event lines, then one `signed` line for each receipt in
# the given directories whose bundle verifies against this repository's
# delegation workflow. Receipts that do not verify are dropped, not trusted.
forge_verified() {
  local out=$1; shift
  local repo=${GITHUB_REPOSITORY:?} subject="${GITHUB_REPOSITORY}/${delegation_workflow}"
  mkdir -p "$(dirname "$out")"
  {
    echo "trust-repository $subject"
    echo "event $(forge_event)"
  } > "$out"
  local dir receipt bundle kappa verdict name
  for dir in "$@"; do
    [ -d "$dir" ] || continue
    for receipt in "$dir"/*.receipt; do
      [ -e "$receipt" ] || continue
      bundle=${receipt%.receipt}.jsonl
      [ -e "$bundle" ] || { echo "factory: $receipt has no bundle; ignored" >&2; continue; }
      if ! why=$(gh attestation verify "$receipt" --bundle "$bundle" --repo "$repo" \
           --signer-workflow "$subject" 2>&1); then
        printf 'factory: %s does not verify; ignored:\n%s\n' "$receipt" "$why" >&2
        continue
      fi
      read -r _ kappa verdict < "$receipt"
      name=$(sed -n 's/^obligation //p' "$receipt")
      echo "signed $name $kappa $verdict workflow runner $subject" >> "$out"
    done
  done
}

fetch_kept() {
  rm -rf "$kept"; mkdir -p "$kept"
  if git fetch --quiet --depth=1 origin "refs/heads/$delegation_branch" 2>/dev/null; then
    git archive FETCH_HEAD | tar -x -C "$kept"
  fi
}

forge_plan() {
  local verified=target/factory/verified plan
  mkdir -p target/factory
  mapfile -t contexts < <(forge_contexts)
  forge_verified "$verified" "$kept" "$@"
  "$host" delegate "$verified" "${contexts[@]}"
}

command=${1:-}
case "$command" in
  ci)
    # A pull request or a laptop: run this host's obligations against the
    # published receipts. Only release runs write receipts.
    build
    fetch_receipts
    status=0
    "$host" run --receipts "$store" --context mode=rehearsal --context "run=local-$$" || status=$?
    "$host" plan --receipts "$store" --context mode=rehearsal --context "run=local-$$" | grep -E '^(obligation|releasable) ' || true
    exit "$status"
    ;;
  actions-route)
    build
    fetch_receipts
    : "${FACTORY_MODE:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
    "$host" run --receipts "$store" --only factory-model \
      --context "mode=$FACTORY_MODE" --context "run=$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
    exec "$host" actions-route --receipts "$store"
    ;;
  actions-receipts)
    build
    fresh=target/factory/run-receipts
    rm -rf "$fresh"; mkdir -p "$fresh"
    "$host" actions-receipts --receipts "$fresh"
    publish_receipts "$fresh"
    ;;
  actions-cut)
    # The certified plan decides; this only reads GitHub and writes the tag.
    build
    fetch_receipts
    : "${CUT_REVISION:?}" "${GITHUB_REPOSITORY:?}"
    repo=$GITHUB_REPOSITORY
    version=$(sed -n '/^\[workspace\.package\]/,/^\[/s/^version = "\([^"]*\)"$/\1/p' Cargo.toml)
    [[ $version =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "factory: workspace version '$version'" >&2; exit 65; }
    tag=v$version minor="v${BASH_REMATCH[1]}.${BASH_REMATCH[2]}" patch=${BASH_REMATCH[3]}
    test "$(git rev-parse HEAD)" = "$CUT_REVISION"
    if gh api "repos/$repo/git/ref/tags/$tag" >/dev/null 2>&1; then
      echo "factory: $tag already exists; nothing to cut"
      exit 0
    fi
    plan=$("$host" plan --rev "$CUT_REVISION" --receipts "$store" --context mode=publish --context run=cut)
    grep -E '^(obligation|cuttable) ' <<<"$plan"
    if ! grep -qx 'cuttable yes' <<<"$plan"; then
      echo "factory: $CUT_REVISION is not cuttable: a run-independent obligation has no passing receipt"
      exit 0
    fi
    # A minor release ships when its milestone's planned work is done.
    milestone=
    if [ "$patch" = 0 ]; then
      milestone=$(gh api "repos/$repo/milestones?state=open&per_page=100" \
        --jq ".[] | select(.title | split(\" \") | index(\"$minor\")) | \"\(.number) \(.open_issues)\"")
      if [ -z "$milestone" ] || [ "$(wc -l <<<"$milestone")" != 1 ]; then
        echo "factory: no single open milestone names $minor; not cutting $tag"
        exit 0
      fi
      if [ "${milestone#* }" != 0 ]; then
        echo "factory: milestone $minor has ${milestone#* } open issues; not cutting $tag"
        exit 0
      fi
    fi
    object=$(gh api "repos/$repo/git/tags" -f tag="$tag" -f message="PrismPM $version" \
      -f object="$CUT_REVISION" -f type=commit --jq .sha)
    gh api "repos/$repo/git/refs" -f ref="refs/tags/$tag" -f sha="$object" >/dev/null
    echo "factory: tagged $tag at $CUT_REVISION"
    # The release body is the version's changelog entry, as release-please would
    # write it; the publication run appends RELEASE_NOTES.md and the assets.
    notes=$(mktemp)
    node --input-type=module -e "import {readFileSync} from 'node:fs'; import {entryFor} from './sdk/docs/lib/changelog.mjs';
      const body = entryFor(readFileSync('CHANGELOG.md', 'utf8'), process.argv[1]); if (!body) process.exit(65);
      process.stdout.write(body);" "$version" > "$notes"
    gh release create "$tag" --verify-tag --repo "$repo" --title "$tag" --notes-file "$notes"
    gh workflow run release.yml --repo "$repo" --ref "$tag" \
      -f version="$version" -f rehearsal=false -f publish-crates=true
    echo "factory: dispatched the publication run of $tag"
    if [ -n "$milestone" ]; then
      gh api -X PATCH "repos/$repo/milestones/${milestone%% *}" -f state=closed >/dev/null
      echo "factory: closed milestone $minor"
    fi
    ;;
  forge-plan)
    build
    fetch_kept
    plan=$(forge_plan)
    grep -E '^(obligation|status|check|establish|sdk) ' <<<"$plan" || true
    establish=$(sed -n 's/^establish //p' <<<"$plan" | jq -R . | jq -cs .)
    sdk=$(sed -n 's/^sdk //p' <<<"$plan")
    { echo "establish=$establish"; echo "sdk-image=$sdk"; } >> "${GITHUB_OUTPUT:-/dev/stdout}"
    ;;
  forge-prepare)
    name=${2:?usage: factory.sh forge-prepare NAME}
    build
    mapfile -t contexts < <(forge_contexts)
    # The closure and command do not depend on receipts: plan with none.
    forge_verified target/factory/verified
    "$host" delegate-prepare target/factory/verified "$name" --work "$work" "${contexts[@]}" >/dev/null
    echo "context=$work/$name" >> "${GITHUB_OUTPUT:-/dev/stdout}"
    ;;
  forge-receipt)
    name=${2:?usage: factory.sh forge-receipt NAME}
    : "${FACTORY_RESULT:?}"
    passed=$(jq -r '.passed' <<<"$FACTORY_RESULT")
    case "$passed" in true) verdict=pass ;; false) verdict=fail ;; *) echo "factory: no result for $name" >&2; exit 65 ;; esac
    kappa=$(cat "$work/$name.kappa")
    mkdir -p "$fresh/$name"
    receipt=$fresh/$name/$kappa-$verdict.receipt
    {
      echo "receipt $kappa $verdict"
      echo "obligation $name"
      echo "revision $(git rev-parse HEAD)"
      echo "sandbox $(cat "$work/$name.sandbox")"
      echo "peer runner"
      echo "workflow ${GITHUB_WORKFLOW_REF:-local}"
      echo "run ${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
    } > "$receipt"
    echo "receipt=$receipt" >> "${GITHUB_OUTPUT:-/dev/stdout}"
    ;;
  forge-bundle)
    name=${2:?usage: factory.sh forge-bundle NAME}
    : "${FACTORY_BUNDLE:?}"
    for receipt in "$fresh/$name"/*.receipt; do cp "$FACTORY_BUNDLE" "${receipt%.receipt}.jsonl"; done
    ;;
  forge-report)
    build
    fetch_kept
    plan=$(forge_plan "$fresh")
    grep -E '^(obligation|status|check) ' <<<"$plan" || true
    check=$(sed -n 's/^check //p' <<<"$plan")
    : "${GITHUB_REPOSITORY:?}"
    sha=$(jq -r '.pull_request.head.sha // empty' "${GITHUB_EVENT_PATH:-/dev/null}" 2>/dev/null || true)
    sha=${sha:-${GITHUB_SHA:?}}
    case "$check" in success) state=success ;; failure) state=failure ;; *) state=pending ;; esac
    summary=$(sed -n 's/^status \([^ ]*\) \(.*\)$/\1 \2/p' <<<"$plan" | paste -sd ',' -)
    gh api "repos/$GITHUB_REPOSITORY/statuses/$sha" -f state="$state" -f context=prism/delegation \
      -f description="${summary:-nothing carried}" \
      -f target_url="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/actions/runs/${GITHUB_RUN_ID:-0}" >/dev/null
    [ "$state" != failure ]
    ;;
  forge-keep)
    # Keeps every receipt of this run that verifies, with its bundle, on the
    # receipts branch. A receipt that does not verify is not kept.
    forge_verified target/factory/keep-verified "$fresh"
    staged=target/factory/keep
    rm -rf "$staged"; mkdir -p "$staged"
    while read -r tag name kappa verdict _; do
      [ "$tag" = signed ] || continue
      cp "$fresh/$kappa-$verdict.receipt" "$fresh/$kappa-$verdict.jsonl" "$staged/"
    done < target/factory/keep-verified
    ls "$staged"/*.receipt >/dev/null 2>&1 || { echo "factory: no new receipts to keep"; exit 0; }
    for attempt in 1 2 3 4 5; do
      index=$(mktemp); parent=()
      if git fetch --quiet --depth=1 origin "refs/heads/$delegation_branch" 2>/dev/null; then
        GIT_INDEX_FILE=$index git read-tree FETCH_HEAD; parent=(-p "$(git rev-parse FETCH_HEAD)")
      else
        rm -f "$index"
      fi
      for file in "$staged"/*; do
        blob=$(git hash-object -w "$file")
        GIT_INDEX_FILE=$index git update-index --add --cacheinfo "100644,$blob,${file##*/}"
      done
      tree=$(GIT_INDEX_FILE=$index git write-tree); rm -f "$index"
      commit=$(git -c user.name=prism-factory -c user.email=prism-factory@users.noreply.github.com \
        commit-tree "$tree" "${parent[@]}" -m "Receipts of run ${GITHUB_RUN_ID:-local} for $(git rev-parse HEAD)")
      if git push --quiet origin "$commit:refs/heads/$delegation_branch"; then echo "factory: kept $(ls "$staged" | grep -c receipt) receipts"; exit 0; fi
      sleep $((attempt * 5))
    done
    echo "factory: could not push receipts to $delegation_branch" >&2
    exit 1
    ;;
  site)
    out=${2:?usage: factory.sh site DIR}
    rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
    cargo rustc --quiet --release --locked --offline --lib --crate-type cdylib --target wasm32-unknown-unknown --manifest-path "$manifest"
    rm -rf "$out"; mkdir -p "$out"
    cp prism-factory/host/target/wasm32-unknown-unknown/release/prism_factory_host.wasm "$out/factory.wasm"
    cp prism-factory/site/index.html "$out/index.html"
    ;;
  plan|request|run|workflow|route-record)
    build
    shift
    exec "$host" "$command" "$@"
    ;;
  *)
    sed -n '2,11p' "$0" >&2
    exit 64
    ;;
esac
