#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
source_commit=f378fd3a8dc5711cb4b22cec9ee2f874353628c3
if test "$#" -gt 1 || { test "$#" -eq 1 && test "$1" != --check-source; }; then
  printf 'usage: bootstrap-verify.sh [--check-source]\n' >&2
  exit 2
fi
if ! git -C "$root" cat-file -e "$source_commit^{tree}" 2>/dev/null; then
  printf 'Pinned bootstrap source %s is unavailable; use a full-history checkout (actions/checkout fetch-depth: 0) before verification.\n' \
    "$source_commit" >&2
  exit 1
fi
if test "$#" -eq 1; then
  printf 'Pinned bootstrap source %s is available (source preflight only).\n' "$source_commit"
  exit 0
fi

archive="$root/.prism/cache/bootstrap/prismpm-0.2.0-x86_64-unknown-linux-gnu.tar.gz"
archive_sha=f3dd999f5618db154fa06222a06f9de95d86e1dbf683954426ea91c974cbe24c
work=$(mktemp -d /tmp/prismpm-bootstrap-verify.XXXXXX)
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT

test -f "$archive"
printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum --check --strict >/dev/null
tar --extract --gzip --file "$archive" --directory "$work" \
  --no-same-owner --no-same-permissions
prior="$work/prismpm-0.2.0-x86_64-unknown-linux-gnu/prismpm"
test -x "$prior"
prior_binary_sha=$(sha256sum "$prior" | cut -d' ' -f1)
node "$root/sdk/bootstrap/runner.mjs" --describe "$prior"

node --test "$root/scripts/bootstrap-evidence.test.mjs"
envelope="$work/envelope"
mkdir -p "$envelope"
git -C "$root" archive "$source_commit" | tar --extract --directory "$envelope"
node "$root/scripts/bootstrap-evidence.mjs" prepare "$root" "$envelope"

# The 0.3 system language intentionally uses generic LexLean 0.3 forms that a
# 0.2 binary cannot interpret.  The prior SDK therefore validates a complete,
# byte-exact manifest of the new tracked source closure through a deliberately
# 0.2-compatible semantic projection.  The current SDK validates that same
# projection and then validates the full production model below.  The evidence
# keeps those scopes separate; it never represents compatibility validation as
# full 0.3 semantic conformance.
if ! node "$root/sdk/bootstrap/runner.mjs" "$prior" --project "$envelope" check --json >"$work/prior-projection.json"; then
  cat "$work/prior-projection.json" >&2
  exit 1
fi
node "$root/sdk/bootstrap/runner.mjs" "$prior" --project "$envelope" build --json >"$work/prior-build.json"
node "$root/scripts/bootstrap-evidence.mjs" capture "$envelope" \
  "$work/prior-projection.json" "$work/prior-build.json" "$work/prior-capture.json"
# Keep compilation out of the sealed dependency tree, including when a caller
# supplies a Cargo target directory. The existing private workspace owns cleanup.
if ! cargo run --locked --offline --quiet --manifest-path \
  "$root/vendor/lexlean/Cargo.toml" --target-dir "$work/lexlean-target" \
  -- --project "$envelope/lexlean.toml" lock; then
  exit 1
fi
if ! cargo run --locked --offline --quiet --package prismpm -- \
  --project "$envelope" check --json >"$work/current-projection.json"; then
  cat "$work/current-projection.json" >&2
  exit 1
fi
cargo run --locked --offline --quiet --package prismpm -- \
  --project "$envelope" build --json >"$work/current-build.json"
node "$root/scripts/bootstrap-evidence.mjs" capture "$envelope" \
  "$work/current-projection.json" "$work/current-build.json" "$work/current-capture.json"
if ! cargo run --locked --offline --quiet --package prismpm -- \
  --project "$root" check --json >"$work/production.json"; then
  cat "$work/production.json" >&2
  exit 1
fi

node "$root/scripts/bootstrap-evidence.mjs" emit "$root" "$work" \
  "$archive_sha" "$prior_binary_sha" "$source_commit"

# Validate the emitted bytes through PrismPM's registered contract rather than
# treating JSON parsing in this wrapper as conformance.
cargo run --locked --offline --quiet --package xtask -- \
  validate-contract prismpm/bootstrap-evidence/2 "$work/evidence.json"
node "$root/scripts/bootstrap-evidence.mjs" publish "$root" "$work"

printf 'bootstrap SDK 0.2.0 verified compatibility content; current production semantic identity %s\n' \
  "$(node -p "require('$work/production.json').semantic_id")"
