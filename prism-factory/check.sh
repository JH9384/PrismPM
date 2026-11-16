#!/usr/bin/env bash
# The factory-model obligation: the factory checks itself.
#  1. The certified bundle replays without the source, Lean or the network.
#  2. When the pinned Lean is present, the model is verified through the kernel
#     and re-exported, and the export must equal the committed bundle.
#  3. The host's tests pass and both committed workflows equal their projection:
#     factory.yml, release.yml with its job fragments (prism-factory/jobs/),
#     release-cut.yml, and prism-delegation.yml.
# It runs in a directory that holds only this obligation's declared inputs.
set -euo pipefail
lexlean_target=${CARGO_TARGET_DIR:-$PWD/target}/lexlean
cargo build --quiet --release --locked --manifest-path vendor/lexlean/Cargo.toml --bin lexlean --target-dir "$lexlean_target"
lexlean=$lexlean_target/release/lexlean
"$lexlean" production verify-artifact prism-factory/certified
if command -v lean >/dev/null 2>&1; then
  (cd prism-factory/model && "$lexlean" lock --check && "$lexlean" verify --all)
  result=$(cd prism-factory/model && "$lexlean" production build --request ../production-request.json | sed -n 's/.*; result \([0-9a-f]\{64\}\);.*/\1/p')
  # The attestation names the compiler binary by its hash, and a binary built
  # in another directory has other bytes. Everything else must be identical.
  diff -r --exclude=attestation.json --exclude=result.json "prism-factory/model/.lexlean/production/$result" prism-factory/certified
  python3 -I - "prism-factory/model/.lexlean/production/$result" prism-factory/certified <<'PY'
import json, sys
def load(root, name):
    value = json.load(open(f"{root}/{name}"))
    def strip(item):
        if isinstance(item, dict):
            return {key: strip(entry) for key, entry in item.items()
                    if key not in ("executable_sha256", "attestation_id", "result_id")
                    and not (key == "sha256" and item.get("path", "").endswith("attestation.json"))}
        return [strip(entry) for entry in item] if isinstance(item, list) else item
    return strip(value)
fresh, committed = sys.argv[1], sys.argv[2]
for name in ("evidence/attestation.json", "result.json"):
    assert load(fresh, name) == load(committed, name), f"{name} differs beyond the compiler binary"
PY
else
  echo "check.sh: no Lean toolchain here; the committed bundle was replayed, not re-exported" >&2
fi
cargo test --quiet --release --locked --offline --manifest-path prism-factory/host/Cargo.toml
cargo build --quiet --release --locked --offline --manifest-path prism-factory/host/Cargo.toml
prism-factory/host/target/release/prism-factory workflow --name factory --check .github/workflows/factory.yml
prism-factory/host/target/release/prism-factory workflow --name release --check .github/workflows/release.yml
prism-factory/host/target/release/prism-factory workflow --name cut --check .github/workflows/release-cut.yml
prism-factory/host/target/release/prism-factory workflow --name delegate --check .github/workflows/prism-delegation.yml
