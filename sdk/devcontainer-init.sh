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

# Give the requested process a writable Cargo home seeded from the SDK's
# immutable locked cache and owned by the identity that runs it (a root start
# drops to UID 1000 below). GitHub runners can have any numeric uid, so their
# short-lived action containers get a private per-UID home. The build-only SDK
# ships /home/vscode/.cargo unseeded and seeds it here on first start; the
# full SDK ships it seeded and marked complete (.seeded), so its non-ephemeral
# startup is unchanged. An interrupted earlier seeding is completed here.
cargo_home=/usr/local/libexec/prismpm-cargo-home
if [ "${PRISMPM_EPHEMERAL_HOME:-}" = 1 ] || { [ -x "$cargo_home" ] && [ ! -e /home/vscode/.cargo/.seeded ]; }; then
  CARGO_HOME=$("$cargo_home")
  export CARGO_HOME
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
