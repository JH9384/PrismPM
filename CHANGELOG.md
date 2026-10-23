# Changelog

All notable changes to PrismPM will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Shared Action command `publish-pages`: builds a browser-resident system once, runs `export-browser` on the built release, checks the exported closure against the release's system manifest, build manifest, release layers and stored blobs, and refuses a system manifest that does not name the `github-pages-browser` target (`PP2101`) before any upload; returns `pages-path` and `pages-closure` outputs for `actions/upload-pages-artifact` and `actions/deploy-pages`.
- Starter workflow `action/starter/publish-pages.yml` for template instances: one job on one runner, `main` pushes and tags only, `timeout-minutes`, cancelling `concurrency`, commit-pinned Pages actions, no OCI sign, promote or push job.

## [0.3.0] - 2026-09-21

### Added
- Authoritative production-system model (`prismpm/system-schema/1`, `prismpm/conformance-model/1`), immutable standards/oracle bindings, OCI release graphs, digest-only lifecycle controller, Compose and Kubernetes target projections, operations/supply-chain evidence, and the reproducible multi-platform PrismPM SDK.
- Shipped reproducible multi-platform SDK packages for `linux/amd64` and `linux/arm64`.
- First-party crates.io bootstrap specification (`prismpm/crates-io-bootstrap-receipt/1`) and trusted publishing configuration for `lexlean`, `prod-ir`, `prod-codegen`, `prism-stdlib`, and `prismpm`.
- Full release status closure receipt (`prismpm/release-status-closure-receipt/1`) and production release acceptance receipt (`prismpm/production-release-acceptance/1`).
- Ecosystem release closure manifest (`prismpm/ecosystem-release/2`) and falsification test suite across 14 defect classes.
- Universal template contract, source-free browser export (`export-browser`), and HTTPS publication verification (`verify-browser-publication`) supporting foundry-web production deployment.
- Complete Calculator reference closure and Hologram Calculator/Text interoperability acceptance evidence.

### Changed
- Prepared `prism-stdlib` 0.2.0 with generated production-system validation support while preserving Holo/1 and the 0.1 application runtime API.
- Corrected generated View field layout in `lean4-prod`; Calculator behavior and Holo/1 remain compatible.
- Generated the Holo/1 wire codec and bounded workspace reducer from LexLean; kept independent Hologram oracles outside the production dependency graph.
- Upgraded AsyncAPI owned runtime lock with zero vulnerabilities, audited via npm audit and pinned in `sdk/oracles`.

### Standards & Targets
- Supported standards editions: JSON Schema 2020-12, SPDX 3.0.1, SLSA Provenance v1, OCI Image Spec v1.1, Sigstore Bundle v0.3.
- Supported target profiles: Local CLI, Docker Compose 3.8, Kubernetes 1.36.4, and GitHub Pages.

### Compatibility
- Holo/1 and accepted Prism application inputs remain stable. Additive contracts use new registered schemas; an incompatible schema change requires a new schema identifier and an explicit migration.
- Security disclosures and vulnerability reporting: `security@uor.foundation`.

### Verification Commands
- `cargo run --package xtask -- validate`
- `cargo test --all-targets`
- `cargo clippy --all-targets --all-features -- -D warnings`

Holo/1 and accepted Prism application inputs remain stable. Additive contracts
use new registered schemas; an incompatible schema change requires a new schema
identifier and an explicit migration.

## [0.1.0] - 2026-08-30

### Added
- Initial UOR-Foundation workspace layout and devcontainer.
- LexLean-authored Prism facet lexicons (`prism.arch`, `prism.sec`, `prism.qual`).
- Formal metamodel in `.lex.tex` defining ISO 42010, ISO 27034, ISO 27005, and ISO 25010 primitives.
- Canonical JSON Holo format (`prismpm/holo/1`) emitter and validator.
- Controller API, CLI commands (`check`, `build`, `verify`), and `vv` acceptance gates.

### Compatibility

- The `/1` project, Holo, build, verification, and evidence schemas are the
  initial stable schemas. An incompatible schema change requires a new schema
  identifier and a SemVer-major PrismPM release; compatible additive behavior
  may not weaken closed-object decoding or existing verification guarantees.
