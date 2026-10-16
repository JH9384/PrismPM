#!/usr/bin/env bash
# Candidate transport tooling only. This never grants production acceptance.
set -euo pipefail
helper="$(dirname "$0")/sdk-candidate.mjs"

inspect_layout() {
  node "$helper" inspect "$@"
}

case "${1:-}" in
  install-cosign)
    directory=${2:?installation directory required}
    case "$(uname -m)" in
      x86_64) architecture=amd64; checksum=4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71 ;;
      aarch64) architecture=arm64; checksum=c5d324e091826b0d7a78eb16fef316450b4eb9aaec045611c08ba06f5e73220a ;;
      *) exit 2 ;;
    esac
    mkdir -p "$directory"
    curl --fail --location --silent --show-error \
      "https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-${architecture}" \
      --output "$directory/cosign"
    printf '%s  %s\n' "$checksum" "$directory/cosign" | sha256sum --check --strict
    chmod 0755 "$directory/cosign"
    ;;
  install-oras)
    directory=${2:?installation directory required}
    case "$(uname -m)" in
      x86_64) architecture=amd64; checksum=6cdc692f929100feb08aa8de584d02f7bcc30ec7d88bc2adc2054d782db57c64 ;;
      aarch64) architecture=arm64; checksum=7649738b48fde10542bcc8b0e9b460ba83936c75fb5be01ee6d4443764a14352 ;;
      *) exit 2 ;;
    esac
    mkdir -p "$directory"
    curl --fail --location --silent --show-error \
      "https://github.com/oras-project/oras/releases/download/v1.3.0/oras_1.3.0_linux_${architecture}.tar.gz" \
      --output "$directory/oras.tar.gz"
    printf '%s  %s\n' "$checksum" "$directory/oras.tar.gz" | sha256sum --check --strict
    tar -xzf "$directory/oras.tar.gz" -C "$directory" oras
    ;;
  inspect)
    test "$#" -eq 5
    inspect_layout "$2" "$3" "$4" "$5"
    ;;
  smoke)
    test "$#" -eq 5
    archive=$2; architecture=$3; revision=$4; evidence=$5
    inspect_layout "$archive" "$architecture" "$revision" "$evidence"
    digest=$(<"$evidence/digest.txt")
    nonce="$$-${RANDOM}"
    registry="prismpm-candidate-${nonce}"
    volume="prismpm-candidate-config-${nonce}"
    scratch=$(mktemp -d)
    cleanup() {
      docker container rm --force "$registry" >/dev/null 2>&1 || true
      docker volume rm "$volume" >/dev/null 2>&1 || true
      rm -r -- "$scratch"
    }
    trap cleanup EXIT
    # OCI-only here: this test transports the exact OCI artifact, never Docker conversion.
    printf '%s\n' '{"distSpecVersion":"1.1.1","http":{"address":"0.0.0.0","port":5000},"log":{"level":"warn"},"storage":{"rootDirectory":"/tmp/zot"}}' > "$scratch/config.json"
    docker volume create "$volume" >/dev/null
    docker container create --name "$registry" --publish 127.0.0.1::5000 \
      --read-only --tmpfs /tmp:rw,nosuid,nodev --volume "$volume:/config" \
      ghcr.io/project-zot/zot@sha256:cd2aea942f428630bcb4190542be6abd35e14177aab84fc7ccad0dca8ecb363d \
      serve /config/config.json >/dev/null
    docker container cp "$scratch/config.json" "$registry:/config/config.json"
    docker container start "$registry" >/dev/null
    endpoint=$(docker container port "$registry" 5000/tcp | sed -n '1p')
    [[ $endpoint =~ ^127\.0\.0\.1:[0-9]+$ ]] || exit 2
    # Run on the native GitHub runner, not inside the tested image.
    ready=0
    for attempt in $(seq 1 20); do
      if curl --fail --silent --max-time 2 "http://$endpoint/v2/" >/dev/null; then ready=1; break; fi
      sleep 0.25
    done
    if test "$ready" -ne 1; then docker logs "$registry" >&2; exit 1; fi
    oras cp --from-oci-layout --to-plain-http "$archive@$digest" "$endpoint/sdk:candidate"
    test "$(oras resolve --plain-http "$endpoint/sdk:candidate")" = "$digest"
    image="$endpoint/sdk@$digest"
    docker pull --platform "linux/$architecture" "$image"
    sdk() {
      docker run --rm --user 1000:1000 --network none --cap-drop ALL \
        --security-opt no-new-privileges "$image" "$@"
    }
    test "$(sdk id -u)" = 1000
    PRISMPM_TEST_SDK_IMAGE="$image" node --test "$(dirname "$helper")/sdk-runtime-exec.test.mjs"
    sdk prismpm --json completion bash > "$evidence/cli.json"
    sdk cat /opt/prismpm/share/inventory.json > "$evidence/inventory.json"
    sdk cat /opt/prismpm/share/standards.lock > "$evidence/standards.lock"
    sdk sh -ec '
      project=$(mktemp -d /tmp/prismpm-standards.XXXXXXXX)
      cp /opt/prismpm/share/standards.lock "$project/standards.lock"
      prismpm --json --project "$project" authority resolve --locked
    ' > "$evidence/authority-result.json"
    sdk sh -ec '
      cp -a /opt/prismpm/share/conformance-root/examples/Calculator /tmp/Calculator
      chmod -R u+w /tmp/Calculator
      prismpm --json --project /tmp/Calculator check
    ' > "$evidence/model-check.json"
    # Fail closed on a PATH tool inserted ahead of the SDK inventory.
    if sdk sh -ec '
      mkdir /tmp/shadow
      cp /usr/bin/true /tmp/shadow/lean
      PATH="/tmp/shadow:$PATH" prismpm --json completion bash
    ' > "$evidence/tamper.json" 2>&1; then
      echo 'candidate accepted a shadowed SDK tool' >&2
      exit 1
    fi
    grep -Fq 'PP5401' "$evidence/tamper.json"
    node "$helper" record "$evidence" "$architecture" "$revision" "$digest"
    if test -n "${GITHUB_OUTPUT:-}"; then
      printf 'manifest-digest=%s\nimage-id=%s\n' "$digest" \
        "$(docker image inspect "$image" --format '{{.Id}}')" >> "$GITHUB_OUTPUT"
    fi
    ;;
  *) echo 'usage: sdk-candidate.sh install-oras|install-cosign DIR | inspect|smoke OCI_TAR ARCH SOURCE_SHA EVIDENCE_DIR' >&2; exit 2 ;;
esac
