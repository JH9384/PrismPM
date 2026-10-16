#!/bin/sh
set -eu

# Generated Lean modules require more than the common 8 MiB process default.
# Keep this resource bound explicit and inherited by sanitized child processes;
# changing only compiler environment variables would be lost at that boundary.
ulimit -S -s 65536

# This image intentionally starts as root only long enough to adapt an optional
# host Docker socket.  Ensure the environment follows the permanent SDK user
# before any cache setup or requested command executes.
if [ "$(id -u)" = 0 ] || [ "$(id -u)" = 1000 ]; then
  export HOME=/home/vscode
  export USER=vscode
  export LOGNAME=vscode
fi

# GitHub runners can have any numeric uid. Give those short-lived action
# containers a private writable Cargo cache, seeded from the SDK's immutable
# locked cache, instead of relying on permissions in /home/vscode.
if [ "${PRISMPM_EPHEMERAL_HOME:-}" = 1 ]; then
  cache_root=${TMPDIR:-/tmp}/prismpm-cargo-${UID:-$(id -u)}
  if [ ! -e "$cache_root/.seeded" ]; then
    mkdir -p "$cache_root"
    cp -a /opt/prismpm/cargo-home/. "$cache_root/"
    chmod -R u+rwX "$cache_root"
    : > "$cache_root/.seeded"
  fi
  export CARGO_HOME=$cache_root
fi

if [ "$(id -u)" = 0 ] && [ -S /var/run/docker.sock ]; then
  socket_gid=$(stat -c '%g' /var/run/docker.sock)
  group_name=$(getent group "$socket_gid" | cut -d: -f1 || true)
  if [ -z "$group_name" ]; then
    group_name=host-docker
    /usr/sbin/groupadd --gid "$socket_gid" "$group_name"
  fi
  /usr/sbin/usermod --append --groups "$group_name" vscode
fi

if [ "$#" -gt 0 ]; then
  if [ "$(id -u)" = 0 ]; then
    exec setpriv --reuid=1000 --regid=1000 --init-groups "$@"
  fi
  exec "$@"
fi
if [ "$(id -u)" = 0 ]; then
  exec setpriv --reuid=1000 --regid=1000 --init-groups sleep infinity
fi
exec sleep infinity
