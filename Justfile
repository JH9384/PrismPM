set shell := ["bash", "-c"]

default:
    @just --list

# Run full non-mutating verification and acceptance gates
vv:
    ./scripts/vv.sh

# Run one separately run part of vv: source, gates, conformance, ho-oc, st-sy, dk-0-1, dk-2 or dk-3
vv-part part:
    ./scripts/vv.sh vv-part {{part}}

# Planted defects: a gate counts only when a deliberate defect makes it fail.
# G2 text refusals, G3 statement time, G5 axioms outside Lean's three, G7
# integrity under every policy (P0 included), G8 the removed author route, G9
# nothing sent to the hosted verifier by default, B3 init relocks offline.
defects:
    cd sdk/npm/prism-code && node --test test/defects.test.mjs
    cd sdk/npm/prism-code && node --test --test-name-pattern 'never recorded|where Lean proved|without --hosted|three docker commands' test/journey-hosted.test.mjs test/setup.test.mjs test/init.test.mjs
    cd sdk/npm/prism-code && node --test --test-name-pattern 'drops to P0 and fails the default|tampered blob is a failed verdict|--help after a verb|G9|routing' test/check.test.mjs test/verify.test.mjs test/hosted.test.mjs test/journey-hosted.test.mjs
    cd sdk/npm/verify && node --test --test-name-pattern 'minimum is P0|integrity fails it|reported as holo.integrity' test/policy.test.mjs test/verify.test.mjs
    cargo test -p prismpm --lib -- inspect::verdict holo::provenance

# Validate claim registers and spec links
validate:
    cargo run --package xtask -- validate

# Check the nine-module dependency table and its baseline
check-modules:
    cargo run --package xtask -- check-modules

# Check the prism-code surface against the developer view's glossary (#347)
check-developer-view:
    cargo run --package xtask -- check-developer-view

# Run conformance test suite by category (contracts, core, holo-stdlib, desktop-browser, system-oci, verification-schemas, or all)
conformance category="all":
    cargo run --package xtask -- conformance {{category}}

# Run workspace unit, property, and integration tests
unit-tests:
    cargo run --package xtask -- unit-tests

# Check all positive and negative fixture suites
check-fixtures:
    cargo run --package xtask -- check-fixtures

# Rewrite fixture expected outputs
fixtures-write:
    cargo run --package xtask -- check-fixtures --write

# Backward-compatible spelling; the normative rewrite command is fixtures-write.
write-fixtures: fixtures-write

# Verify reproducibility across two distinct build roots
check-reproducibility:
    cargo run --package xtask -- check-reproducibility

# Verify the Cargo-selected package and its downstream public API
package-api:
    cargo run --package xtask -- package-api

# Reproduce the exact prebuilt dependency and stdlib crate archives.
package-release-crates-check:
    ./scripts/package-release-crates.sh --check

# Check generated stdlib sources against a freshly verified, exact LCNF export.
stdlib-package-check:
    cargo run --locked --package xtask -- stdlib-package

# Regenerate only the stdlib source package; archive/release sealing is separate.
stdlib-package-write:
    cargo run --locked --package xtask -- stdlib-package --write

# Check the generated bindings writers against a fresh certified LexLean export.
bindings-package-check:
    cargo run --locked --package xtask -- bindings-package

# Regenerate the bindings writer packages from the LexLean model.
bindings-package-write:
    cargo run --locked --package xtask -- bindings-package --write

# Verify examples and standard library
verify-examples:
    cargo run --package xtask -- verify-examples

# Verify golden outputs
golden-check:
    cargo run --package xtask -- check-golden

# Rewrite committed golden outputs for review. Acceptance never invokes this recipe.
golden-write reason:
    PRISMPM_GOLDEN_REASON='{{reason}}' cargo run --package xtask -- check-golden --write

# Backward-compatible spelling; the normative check command is golden-check.
check-golden: golden-check

# Regenerate model artifacts and documentation
codegen:
    cargo run --package xtask -- validate-model --write

# Check release readiness
release-check:
    cargo run --package xtask -- release-check

# Stage release artifacts
release-artifacts:
    cargo run --package xtask -- release-artifacts
