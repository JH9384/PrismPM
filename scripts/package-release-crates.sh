#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
mode=${1:-}

prepare() {
    destination=$1
    test ! -e "$destination"
    mkdir -p "$destination/lean4-prod" "$destination/stdlib" "$destination/packages"

    cp -a "$root/vendor/lean4-prod/rust/." "$destination/lean4-prod/"
    cp -a "$root/stdlib/generated/package/." "$destination/stdlib/"
    rm -rf "$destination/lean4-prod/target" "$destination/stdlib/target"

    mkdir -p "$destination/lean4-prod/.cargo"
    printf '[patch.crates-io]\nprod-ir = { path = "%s" }\n' \
        "$destination/lean4-prod/prod-ir" \
        > "$destination/lean4-prod/.cargo/config.toml"

    (
        cd "$destination/lean4-prod"
        # Keep archives and verification builds in this stage, irrespective of
        # a caller's CARGO_TARGET_DIR or Cargo configuration.
        CARGO_NET_OFFLINE=true cargo package --locked --offline --target-dir target --package prod-ir
        CARGO_NET_OFFLINE=true cargo package --locked --offline --target-dir target --package prod-codegen
    )
    (
        cd "$destination/stdlib"
        CARGO_NET_OFFLINE=true cargo package --locked --offline --target-dir target
    )

    cp "$destination/lean4-prod/target/package/prod-ir-0.1.0.crate" \
        "$destination/packages/prod-ir-0.1.0.crate"
    cp "$destination/lean4-prod/target/package/prod-codegen-0.1.0.crate" \
        "$destination/packages/prod-codegen-0.1.0.crate"
    cp "$destination/stdlib/target/package/prism-stdlib-0.2.0.crate" \
        "$destination/packages/prism-stdlib-0.2.0.crate"
}

workspace_version() {
    sed -n 's/^version = "\(.*\)"$/\1/p' "$root/Cargo.toml" | head -1
}

# The crate `prismpm build` writes into its private registry is the file
# application_build.rs includes. It must be the reviewed archive, the archive
# stdlib/release.json records, and the archive just packaged, so that the crate
# a consumer resolves from crates.io is the crate the SDK embeds (#214).
embedded_identity() {
    packaged=$1
    grep -q 'include_bytes!("../stdlib/generated/prism-stdlib-0.2.0.crate")' \
        "$root/crates/prismpm/src/application_build.rs"
    recorded=$(sed -n 's/.*"crate_sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$root/stdlib/release.json")
    path=$(sed -n 's/.*"crate_path":"\([^"]*\)".*/\1/p' "$root/stdlib/release.json")
    test "$path" = stdlib/generated/prism-stdlib-0.2.0.crate
    test "$(sha256sum "$packaged" | cut -d' ' -f1)" = "$recorded"
    test "$(sha256sum "$root/stdlib/generated/prism-stdlib-0.2.0.crate" | cut -d' ' -f1)" = "$recorded"
}

# prismpm, packaged offline against the vendored copies of the four crates it
# depends on, which stand in through command-line patches because those crates
# are not on the registry before the owner's first upload and cargo does not
# read a patch in a manifest when it prepares a package. They name the same
# directories as the [patch.crates-io] of the root manifest: patches naming other
# copies would conflict with it and change the lock file. The Cargo.lock of this
# archive therefore lacks the registry checksums of those four, so `--publish`
# packages prismpm again once they are public. It is not verified by compiling
# here: `just vv` builds it.
package_prismpm() {
    stage=$1
    (
        cd "$root"
        CARGO_NET_OFFLINE=true cargo package --locked --offline --no-verify --allow-dirty \
            --package prismpm --target-dir "$stage/prismpm-target" \
            --config "patch.crates-io.lexlean.path=\"$root/vendor/lexlean\"" \
            --config "patch.crates-io.prod-ir.path=\"$root/vendor/lean4-prod/rust/prod-ir\"" \
            --config "patch.crates-io.prod-codegen.path=\"$root/vendor/lean4-prod/rust/prod-codegen\"" \
            --config "patch.crates-io.prism-stdlib.path=\"$root/stdlib/generated/package\""
    )
}

# `cargo publish --dry-run` for every crate, in upload order, each repackaging
# to the bytes the stage already compared with the reviewed archive. It reads the
# registry index, so it needs the network (and no credential); the offline gate
# of `just vv` does not run it.
dry_run() {
    stage=$1
    (
        cd "$stage/lean4-prod"
        for crate in prod-ir prod-codegen; do
            cargo publish --dry-run --locked --target-dir target --package "$crate"
            cmp "target/package/$crate-0.1.0.crate" "../packages/$crate-0.1.0.crate"
        done
    )
    (
        cd "$stage/stdlib"
        cargo publish --dry-run --locked --target-dir target
        cmp target/package/prism-stdlib-0.2.0.crate ../packages/prism-stdlib-0.2.0.crate
    )
    (
        cd "$root"
        cargo publish --dry-run --locked --no-verify --allow-dirty \
            --package prismpm --target-dir "$stage/prismpm-dry-run" \
            --config "patch.crates-io.lexlean.path=\"$root/vendor/lexlean\"" \
            --config "patch.crates-io.prod-ir.path=\"$root/vendor/lean4-prod/rust/prod-ir\"" \
            --config "patch.crates-io.prod-codegen.path=\"$root/vendor/lean4-prod/rust/prod-codegen\"" \
            --config "patch.crates-io.prism-stdlib.path=\"$root/stdlib/generated/package\""
        # Without verification cargo does not keep the archive it dry-ran, so
        # its bytes are not compared here; `--publish` packages prismpm again.
    )
}

# Package the crates into $stage and require every property that must hold
# before any upload that needs no network: the reviewed bytes, the embedded
# stdlib identity, and prismpm packaged against the vendored dependencies.
verified_stage() {
    prepare "$stage"
    cmp "$stage/packages/prod-ir-0.1.0.crate" \
        "$root/vendor/lean4-prod/crates/prod-ir-0.1.0.crate"
    cmp "$stage/packages/prod-codegen-0.1.0.crate" \
        "$root/vendor/lean4-prod/crates/prod-codegen-0.1.0.crate"
    cmp "$stage/packages/prism-stdlib-0.2.0.crate" \
        "$root/stdlib/generated/prism-stdlib-0.2.0.crate"
    embedded_identity "$stage/packages/prism-stdlib-0.2.0.crate"
    package_prismpm "$stage"
}

# The SHA-256 crates.io records for NAME VERSION: status 0 and the digest on
# standard output when it is public, 1 when crates.io has no such version.
public_checksum() {
    response=$(mktemp)
    code=$(curl --silent --show-error --user-agent prismpm-release/0.3 \
        --output "$response" --write-out '%{http_code}' \
        "https://crates.io/api/v1/crates/$1/$2") || { rm -f "$response"; return 2; }
    if [ "$code" = 404 ]; then
        rm -f "$response"
        return 1
    fi
    if [ "$code" != 200 ]; then
        rm -f "$response"
        return 2
    fi
    sed -n 's/.*"checksum":"\([0-9a-f]\{64\}\)".*/\1/p' "$response" | head -1
    rm -f "$response"
}

# Upload ARCHIVE as NAME VERSION by running `cargo publish` with the given
# arguments in DIRECTORY, then wait until crates.io serves the same bytes. A
# version that is already public with the same bytes is left alone; with other
# bytes it stops the run, because a published version cannot be replaced.
upload() {
    name=$1 version=$2 directory=$3 archive=$4
    shift 4
    local_checksum=$(sha256sum "$archive" | cut -d' ' -f1)
    if observed=$(public_checksum "$name" "$version"); then
        if [ "$observed" != "$local_checksum" ]; then
            printf '%s %s is public with sha256 %s, not %s\n' \
                "$name" "$version" "$observed" "$local_checksum" >&2
            exit 1
        fi
        printf '%s %s is already public with sha256 %s\n' "$name" "$version" "$local_checksum"
        return 0
    else
        status=$?
        [ "$status" -eq 1 ] || { printf 'crates.io lookup of %s failed\n' "$name" >&2; exit "$status"; }
    fi
    (cd "$directory" && cargo publish --locked "$@")
    attempt=0
    until observed=$(public_checksum "$name" "$version"); do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge 90 ]; then
            printf 'crates.io did not serve %s %s after publication\n' "$name" "$version" >&2
            exit 1
        fi
        sleep 10
    done
    test "$observed" = "$local_checksum"
    printf '%s %s published, sha256 %s\n' "$name" "$version" "$local_checksum"
}

case "$mode" in
    --prepare)
        test "$#" -eq 2
        prepare "$2"
        ;;
    --identity)
        # Is PACKAGED the crate `prismpm build` writes into its private registry?
        test "$#" -eq 2
        embedded_identity "$2"
        ;;
    --dry-run)
        # `cargo publish --dry-run` for every crate. Needs the network, not a credential.
        test "$#" -eq 1
        work=$(mktemp -d)
        trap 'rm -rf "$work"' EXIT HUP INT TERM
        stage="$work/release-crates"
        verified_stage
        dry_run "$stage"
        "$root/scripts/crate-metadata-check.sh"             "$stage/packages/"*.crate "$stage/prismpm-target/package/prismpm-$(workspace_version).crate"
        sha256sum "$stage/packages/"*.crate             "$stage/prismpm-target/package/prismpm-$(workspace_version).crate"
        ;;
    --check)
        test "$#" -eq 1
        work=$(mktemp -d)
        trap 'rm -rf "$work"' EXIT HUP INT TERM
        stage="$work/release-crates"
        verified_stage
        "$root/scripts/crate-metadata-check.sh" \
            "$stage/packages/"*.crate "$stage/prismpm-target/package/prismpm-$(workspace_version).crate"
        sha256sum "$stage/packages/"*.crate \
            "$stage/prismpm-target/package/prismpm-$(workspace_version).crate"
        ;;
    --publish)
        # The owner's first upload (#214, #19). Everything --check requires
        # holds first; then the crates go up in dependency order. The token is
        # read from the environment by cargo and is never stored or printed.
        test "$#" -eq 1
        if [ -z "${CARGO_REGISTRY_TOKEN:-}" ]; then
            printf 'set CARGO_REGISTRY_TOKEN for this command; this script never stores it\n' >&2
            exit 64
        fi
        if [ -n "$(git -C "$root" status --porcelain)" ]; then
            printf 'the working tree must be clean: the upload is of committed bytes\n' >&2
            exit 1
        fi
        work=$(mktemp -d)
        trap 'rm -rf "$work"' EXIT HUP INT TERM
        stage="$work/release-crates"
        verified_stage
        dry_run "$stage"
        "$root/scripts/crate-metadata-check.sh" "$stage/packages/"*.crate
        upload prod-ir 0.1.0 "$stage/lean4-prod" "$stage/packages/prod-ir-0.1.0.crate" \
            --package prod-ir --target-dir target
        upload prod-codegen 0.1.0 "$stage/lean4-prod" "$stage/packages/prod-codegen-0.1.0.crate" \
            --package prod-codegen --target-dir target
        # lexlean is published from the LexLean repository (LexLean#260). The
        # SDK embeds vendor/lexlean/lexlean-0.4.0.crate, so crates.io must serve
        # exactly those bytes before anything that depends on it is uploaded.
        vendored=$(sha256sum "$root/vendor/lexlean/lexlean-0.4.0.crate" | cut -d' ' -f1)
        if ! observed=$(public_checksum lexlean 0.4.0) || [ "$observed" != "$vendored" ]; then
            printf 'lexlean 0.4.0 must be public with sha256 %s (the crate the SDK embeds); upload it from LexLean first\n' \
                "$vendored" >&2
            exit 1
        fi
        upload prism-stdlib 0.2.0 "$stage/stdlib" "$stage/packages/prism-stdlib-0.2.0.crate" \
            --target-dir target
        # prismpm is packaged again now that its four dependencies are public,
        # so the archive carries their registry checksums.
        (cd "$root" && cargo package --locked --package prismpm --target-dir "$stage/prismpm-publish")
        version=$(workspace_version)
        archive="$stage/prismpm-publish/package/prismpm-$version.crate"
        "$root/scripts/crate-metadata-check.sh" "$archive"
        upload prismpm "$version" "$root" "$archive" \
            --package prismpm --target-dir "$stage/prismpm-publish"
        ;;
    *)
        printf 'usage: %s --check | --dry-run | --prepare DIRECTORY | --identity PACKAGE.crate | --publish\n' "$0" >&2
        exit 64
        ;;
esac
