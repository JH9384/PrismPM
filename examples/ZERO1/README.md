# Project ZERO-1

Project ZERO-1 is a bounded formalization of an initial-state obstruction rule:

> If a transition requires something the current state does not admit, the transition is obstructed.

Formally:

```text
Req(T, s) ⊄ Adm(s) ⇒ Obstruct(T, s)
```

## Purpose

ZERO-1 tests whether a small catalog of permitted and obstructed transitions can be represented as a canonical PrismPM project and processed through the complete local verification pipeline.

The current catalog contains:

- Five permitted cases: P1–P5
- Five obstructed cases: O1–O5
- One preserved counterexample concerning incomplete requirement discovery

## Verification status

The project has passed:

- LexLean canonicalization
- PrismPM structural checking
- Deterministic building
- Lean-backed model verification
- Local attestation generation

Verified local results:

```text
Semantic ID:
1597710df23f825dd4360bbca8f77d1a329b6381cced902f3c4ac66bcdd990d1

Build ID:
b2cdc6fc4d1813a0c37fa8f6887350d4e7f5f78fef33c92539ab6eaba276fe05

Attestation ID:
8c1596bf4c2fd4104e2d08cbabac86ba788ae95e14a0bd6976607139cdf42d3a
```

## Reproduce locally

From the PrismPM repository root:

```bash
cargo run --locked --offline --quiet \
  --manifest-path vendor/lexlean/Cargo.toml -- \
  --project examples/ZERO1/lexlean.toml fmt --check

cargo run --locked --offline -p prismpm -- \
  --project examples/ZERO1 check

cargo run --locked --offline -p prismpm -- \
  --project examples/ZERO1 build

cargo run --locked --offline -p prismpm -- \
  --project examples/ZERO1 verify
```

## Evidence boundary

This artifact establishes that the encoded ZERO-1 model is canonical, buildable, and accepted by the PrismPM verification pipeline.

It does not establish that:

- Every implementation discovers all runtime requirements.
- The broader obstruction algebra has been fully formalized.
- The experimental ablation results are formal theorems.
- The rule alone guarantees correct operational behavior.

The preserved counterexample demonstrates the principal boundary: obstruction detection is only complete when the system discovers the transition’s complete requirements.

## Authors

John Haines and Andrew Kadziolka
