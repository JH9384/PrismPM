# PrismPM SDK commands are immutable image content and must precede any
# project-provided path in interactive and login shells.
export ELAN_HOME=/usr/local/elan
export ELAN_TOOLCHAIN=leanprover/lean4:v4.32.1
# Keep the seeded Cargo home the entrypoint selects (ephemeral, or seeded on
# demand where the image ships /home/vscode/.cargo empty or a seeding was
# interrupted) instead of resetting a login shell to an incomplete home
# without the locked offline dependencies.
if [ -x /usr/local/libexec/prismpm-cargo-home ] && { [ "${PRISMPM_EPHEMERAL_HOME:-}" = 1 ] || [ ! -e /home/vscode/.cargo/.seeded ]; }; then
  if prismpm_cargo_home=$(/usr/local/libexec/prismpm-cargo-home); then
    export CARGO_HOME="$prismpm_cargo_home"
  fi
  unset prismpm_cargo_home
else
  export CARGO_HOME=/home/vscode/.cargo
fi
export PATH=/usr/local/elan/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin
