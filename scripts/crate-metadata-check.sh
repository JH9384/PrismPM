#!/bin/sh
# What crates.io needs from a packaged crate, read from the archive and not from
# the source tree: the manifest cargo normalised into the archive is what the
# registry stores, and the archive is what its size limit applies to.
#
#   crate-metadata-check.sh PACKAGE.crate...
#
# Each archive must carry a Cargo.toml with `description`, `license` (or
# `license-file`) and `repository`, a `readme` that names a file in the archive,
# and must not exceed the crates.io upload limit. Anything else exits non-zero
# with the archive and the missing field named.
set -eu

# crates.io rejects uploads whose compressed archive exceeds 10 MiB.
limit=10485760

if [ "$#" -eq 0 ]; then
    printf 'usage: %s PACKAGE.crate...\n' "$0" >&2
    exit 64
fi

status=0
for archive in "$@"; do
    if [ ! -f "$archive" ]; then
        printf '%s: no such archive\n' "$archive" >&2
        status=1
        continue
    fi
    size=$(wc -c < "$archive" | tr -d ' ')
    if [ "$size" -gt "$limit" ]; then
        printf '%s: %s bytes exceeds the crates.io limit of %s\n' "$archive" "$size" "$limit" >&2
        status=1
    fi
    manifest=$(tar -xzOf "$archive" --wildcards '*/Cargo.toml' 2>/dev/null || true)
    if [ -z "$manifest" ]; then
        printf '%s: no Cargo.toml in the archive\n' "$archive" >&2
        status=1
        continue
    fi
    package=$(printf '%s\n' "$manifest" | sed -n '/^\[package\]/,/^\[/p')
    field() {
        printf '%s\n' "$package" | sed -n "s/^$1 = \"\\(.*\\)\"\$/\\1/p" | head -1
    }
    for required in description repository; do
        if [ -z "$(field "$required")" ]; then
            printf '%s: Cargo.toml has no `%s`\n' "$archive" "$required" >&2
            status=1
        fi
    done
    if [ -z "$(field license)" ] && [ -z "$(field license-file)" ]; then
        printf '%s: Cargo.toml has neither `license` nor `license-file`\n' "$archive" >&2
        status=1
    fi
    readme=$(field readme)
    if [ -n "$readme" ] && ! tar -tzf "$archive" | grep -q -- "/$readme\$"; then
        printf '%s: `readme = "%s"` names a file the archive does not carry\n' "$archive" "$readme" >&2
        status=1
    fi
done
exit "$status"
