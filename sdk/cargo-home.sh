#!/bin/sh
# Print a writable Cargo home seeded from the SDK's immutable locked offline
# cache (/opt/prismpm/cargo-home) for the identity that will run Cargo.
#
# A root caller seeds for UID/GID 1000: the SDK entrypoint drops root to that
# identity before executing the requested command, and a root login shell can
# still write a 1000-owned home. Ephemeral homes (PRISMPM_EPHEMERAL_HOME=1) are
# private per final UID under TMPDIR; otherwise the home is /home/vscode/.cargo,
# which the full SDK ships seeded and the build-only SDK ships empty.
#
# A home is complete only when `.seeded` exists. It is published last, after
# every seed entry is in place and, for a root caller, after the whole home
# belongs to the final identity; the full SDK writes it when it pre-seeds the
# image home. Any other state is an interrupted or failed copy (signal,
# ENOSPC) and is reseeded: copies go to a staging directory inside the home,
# then replace only the seed's own top-level entries, so other content of the
# home (installed tools, credentials) is kept. One seeder runs at a time per
# home (flock, released if the holder dies). The seed itself is only read.
#
# Usage: prismpm-cargo-home               SDK startup
#        prismpm-cargo-home SEED HOME     tests
set -eu

seed=${1:-/opt/prismpm/cargo-home}
uid=$(id -u)
owner=
if [ "$uid" = 0 ]; then
  uid=1000
  owner=1000:1000
fi

if [ $# -ge 2 ]; then
  home=$2
elif [ "${PRISMPM_EPHEMERAL_HOME:-}" = 1 ]; then
  home=${TMPDIR:-/tmp}/prismpm-cargo-$uid
else
  home=/home/vscode/.cargo
fi

# The seed's top-level entries, excluding this script's own bookkeeping names.
entries() {
  for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    [ -e "$entry" ] || continue
    case ${entry##*/} in .seeded | .seeded.* | .seed.lock | .seeding.*) continue ;; esac
    printf '%s\n' "$entry"
  done
}

if [ ! -e "$home/.seeded" ]; then
  test -d "$seed"
  mkdir -p "$home"
  exec 9>>"$home/.seed.lock"
  flock 9
  if [ ! -e "$home/.seeded" ]; then
    # The seed is read-only and `cp -a` keeps its modes, so an interrupted
    # stage holds read-only directories: restore owner write before removal.
    for stale in "$home"/.seeding.*; do
      if [ -e "$stale" ]; then
        chmod -R u+rwX "$stale"
        rm -rf "$stale"
      fi
    done
    stage=$(mktemp -d "$home/.seeding.XXXXXX")
    # Copy entries, not "$seed/.": the home directory may belong to another
    # identity, and its own ownership and times must not be rewritten.
    entries "$seed" | while IFS= read -r entry; do
      cp -a "$entry" "$stage/"
    done
    chmod -R u+rwX "$stage"
    entries "$stage" | while IFS= read -r entry; do
      name=${entry##*/}
      if [ -e "$home/$name" ]; then
        chmod -R u+rwX "$home/$name"
        rm -rf "${home:?}/$name"
      fi
      mv "$entry" "$home/$name"
    done
    rmdir "$stage"
    # Publish completion last: only after every seed entry is in place and,
    # for a root caller, the whole home belongs to the final identity. The
    # marker is renamed into place so it never exists before that; a failed
    # or interrupted ownership transfer leaves the home unmarked, and the next
    # start reseeds and repeats the transfer.
    if [ -n "$owner" ]; then
      chown -R "$owner" "$home"
    fi
    : > "$home/.seeded.pending"
    if [ -n "$owner" ]; then
      chown "$owner" "$home/.seeded.pending"
    fi
    mv "$home/.seeded.pending" "$home/.seeded"
  fi
  exec 9>&-
fi

printf '%s\n' "$home"
