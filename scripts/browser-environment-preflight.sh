#!/usr/bin/env bash
set -euo pipefail
if test "$#" -ne 0; then
  printf 'Browser environment preflight accepts no overrides.\n' >&2
  exit 64
fi
cd "$(dirname "$0")/.."
# Includes launch, evaluation and cleanup; this is not a product test deadline.
exec timeout --signal=TERM --kill-after=5s 90s node scripts/browser-environment-preflight.mjs
