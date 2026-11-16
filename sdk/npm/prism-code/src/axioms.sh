#!/bin/sh
# The axiom probe prism-code runs inside the SDK image (src/axioms.mjs).
#
# LexLean's audit stage asks Lean `#print axioms` for every declaration, one
# process per module, and records each answer as
# audit/LexLeanAudit.<id>.<Module>.process.json in the staging directory. When a
# policy fails, the verify stops and deletes its staging, and the modules it had
# not audited yet get no record. So this script copies every record the moment
# it appears, and keeps what it has when the verify ends:
#
#   - when every module the project owns has a record, it stops the verify, so
#     the certificate stage, the long one, never runs;
#   - when the verify passed first, it reads the published set named by the
#     attestation id the verify printed, which binds it to exactly this source;
#   - when the verify failed first, it keeps the records it copied, and
#     axioms.mjs reports the modules without one as not audited.
#
#   axioms.sh <project-dir> <work-dir>
#
# <work-dir>/modules.txt lists the Lean module names the project owns.
# Writes <work-dir>/audit/*.process.json and <work-dir>/verify.log. Exit 0 with
# at least one record, 2 with none (the log says why).
set -u
project=$1
work=$2
cd "$project" || exit 2
rm -rf "$work/audit"
mkdir -p "$work/audit"

# True when every module of modules.txt has a record under <dir>/audit.
complete() {
  [ -d "$1/audit" ] || return 1
  while IFS= read -r module || [ -n "$module" ]; do
    [ -z "$module" ] && continue
    set -- "$1" "$1"/audit/LexLeanAudit.*."$module".process.json
    [ -f "$2" ] || return 1
    set -- "$1"
  done <"$work/modules.txt"
  return 0
}

lexlean verify >"$work/verify.log" 2>&1 &
pid=$!

found=
while :; do
  for record in .lexlean/verified/.staging-*/audit/*.process.json; do
    [ -f "$record" ] || continue
    [ -f "$work/audit/${record##*/}" ] || cp "$record" "$work/audit/" 2>/dev/null
  done
  if complete "$work"; then
    found=staging
    break
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.2
done
if [ "$found" = staging ]; then
  kill "$pid" 2>/dev/null
  pkill -P "$pid" 2>/dev/null
fi
wait "$pid" 2>/dev/null

if [ -z "$found" ]; then
  id=$(sed -n 's/.*attestation \([0-9a-f]\{64\}\).*/\1/p' "$work/verify.log" | tail -1)
  if [ -n "$id" ] && complete ".lexlean/verified/$id"; then
    rm -f "$work"/audit/*.process.json
    cp ".lexlean/verified/$id"/audit/*.process.json "$work/audit/" && found=published
  fi
fi

if [ -z "$found" ]; then
  set -- "$work"/audit/*.process.json
  if [ -f "$1" ]; then
    found=partial
  else
    echo "the verify ended before its audit; see verify.log" >&2
    exit 2
  fi
fi
echo "audit records: $found"
exit 0
