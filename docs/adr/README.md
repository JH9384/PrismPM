# Architecture Decision Records (ADRs) Index

This directory contains Architecture Decision Records for PrismPM, documenting significant architectural decisions, contradictions resolved, and policy choices.

## ADR List

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [001](001-release-acceptance-definition.md) | Release Acceptance Definition for PrismPM v0.3.0 | Accepted | 2026-09-22 |
| [002](002-crates-io-bootstrap.md) | Crates.io Bootstrap Strategy for First-Party Crates | Proposed | 2026-09-22 |
| [003](003-independent-oracle-scope.md) | Independent Oracle Verification Scope | Accepted | 2026-09-22 |
| [004](004-gate15-package-api-criteria.md) | Gate 15 Package-API Pass Criteria | Accepted | 2026-09-22 |
| [005](005-reproducibility-gate-criteria.md) | Reproducibility Gate Criteria and CI Failures | Accepted | 2026-09-22 |
| [006](006-lean4-prod-upstream.md) | Lean4-Prod Upstream Dependency Management | Proposed | 2026-09-22 |
| [007](007-foundry-integration.md) | Foundry Portal Integration as Post-SDK Milestone | Accepted | 2026-09-22 |
| [008](008-diagnostic-coverage-tiers.md) | Diagnostic Boundary Coverage Completeness | Accepted | 2026-09-22 |
| [009](009-command-register-count.md) | Model Command Register Count Reconciliation | Proposed | 2026-09-22 |
| [010](010-holo-oracle-acceptance-identity.md) | Nonexistent `prismpm/holo-oracle-acceptance/1` Identity | Proposed | 2026-09-22 |
| [011](011-ecosystem-manifest-schema-identities.md) | Ecosystem Manifest Schema Identities | Proposed | 2026-09-22 |
| [012](012-calculator-reference-receipt-identity.md) | Calculator Reference Receipt Identity Drift | Proposed | 2026-09-22 |
| [013](013-vv-evidence-artifact-citation.md) | `target/vv-evidence.json` as Cited Release Evidence | Proposed | 2026-09-22 |
| [014](014-bootstrap-digest-pin-scope.md) | Partial Bootstrap Digest Pin Scope (PP5008) | Proposed | 2026-09-22 |
| [015](015-dual-digests.md) | Dual Digests, BLAKE3 Native Plus sha256 | Accepted | 2026-10-23 |
| [016](016-holo-canonical-bytes-and-version-policy.md) | `.holo` Normative Home, Canonical Bytes, and Version Policy | Proposed | 2026-10-29 |

## Summary of Resolved Dissonance

### Contradictions Addressed
1. **"Release complete" vs. "blocked on crates.io"** → ADR-001: Phased release definition
2. **"Gate 15 passes" vs. "package-api fails"** → ADR-004: Split gate criteria
3. **"Independent oracle" vs. "local binary"** → ADR-003: Explicit oracle scope
4. **"All gates passed twice" vs. "CI failures fixed post-hoc"** → ADR-005: Environment vs. implementation classification
5. **"26 model-defined commands" vs. 29 in `model/commands.toml` and the CLI** → ADR-009: Register is the single source of truth
6. **Receipt named three ways** (`-closure-receipt/1`, `-receipt/1`, `-closure/1`) → ADR-012: Canonical receipt identity

### Hidden Assumptions Made Explicit
1. **OIDC publishing works for first upload** → ADR-002: Manual bootstrap required
2. **Lean4-prod upstream will merge** → ADR-006: Vendored artifacts are release artifacts
3. **Foundry integration == SDK release** → ADR-007: Separated milestones
4. **Diagnostic probe count == boundary coverage** → ADR-008: Tiered coverage model
5. **"The toolchain is pinned" covers every executed tool** → ADR-014: Digest pins cover only 4 of ~12 tool families; two-layer policy
6. **BLAKE3 digests work wherever sha256 does** → ADR-015: registries, cosign and Kyverno match only sha256; every Prism subject carries both

### Gaps Documented with Paths Forward
- **crates.io publication**: ADR-002 provides bootstrap protocol
- **Lean4-prod upstream**: ADR-006 defines vendoring policy and fork contingency
- **Foundry portal**: ADR-007 defers to Phase 2 with explicit criteria
- **Diagnostic coverage**: ADR-008 classifies tiers and sets Phase 2 target
- **Oracle acceptance identity**: ADR-010 replaces phantom `prismpm/holo-oracle-acceptance/1` with registered, fixture-covered identities
- **CHANGELOG manifest schemas**: ADR-011 corrects `system-schema/1`/`conformance-model/1` to enforced identities
- **vv evidence receipt**: ADR-013 qualifies `target/vv-evidence.json` as transient and cites reproducible artifacts
- **Bootstrap digest scope**: ADR-014 documents partial PP5008 coverage and proxy-boundary fragility

## Usage
- All ADRs are immutable once Accepted
- Proposed ADRs require team review before Acceptance
- Reference ADR numbers in commit messages, PRs, and release notes
- Update this index when adding new ADRs