# ADR-006: Lean4-Prod Upstream Dependency Management

## Status
Proposed

## Context
RELEASE-STATUS.md:94-127 documents 15 lean4-prod contributions (1 issue + 14 PRs) tracked upstream in `auser/lean4-prod`. Key constraint: "Because `afflom/lean4-prod` has issues disabled, dependency tracking and closure evidence are maintained in PrismPM release tracking documents and anchored to upstream issue IDs."

Critical statement: "**Any unmerged, unlinked, or unsupported upstream dependency changes block the final `prismpm/ecosystem-release/2` release claim.**"

Current status of 15 contributions (from RELEASE-STATUS.md):
- Issue 70: Release Dependency Closure — tracking issue
- PRs 38-69: 14 compiler fixes — various states (some merged, some open)

VERIFICATION.md:342-347 documents upstream ownership failure tracked in lean4-prod issue 30 and PR 29 (Bytes equality kernel reduction). The fix was accepted but PR 32 was "still open at this checkpoint, not merged."

## Decision
**Establish explicit upstream dependency policy:**

### Policy: Vendored Artifacts Are Release Artifacts
- The vendored lean4-prod artifacts in `vendor/lean4-prod/` (lean.tar, crate .tar.gz files) **are the release artifacts**
- Upstream PR merges are **desirable but not required** for SDK release (Phase 1)
- Upstream PR merges **are required** for Ecosystem Release (Phase 2)

### Vendoring Protocol
1. **Vendor commit pinned**: `model/dependencies.toml` locks lean4-prod revision `991956fe427bb646498fd0912c89b71be71e7beb`
2. **Artifact integrity**: SHA-256 hashes committed for all vendored artifacts (RELEASE-STATUS.md:99-105)
3. **Upstream tracking**: Each vendored change linked to upstream issue/PR for auditability
4. **Drift detection**: `cargo deny` and vendor manifest checks prevent unauthorized changes

### Release Phase Requirements
| Phase | Upstream Requirement |
|-------|---------------------|
| Phase 1 (SDK Release) | Vendored artifacts pass all gates; upstream tracking documented |
| Phase 2 (Ecosystem Release) | All 15 contributions merged in `auser/lean4-prod`; vendored artifacts updated to post-merge state |

### Contingency: Upstream Rejects/Stalls
If upstream rejects or stalls on any contribution:
1. Document rationale in `vendor/lean4-prod/UPSTREAM_STATUS.md`
2. Assess if vendored patch can be maintained indefinitely
3. If critical (blocks conformance), fork lean4-prod to `uor-foundation/lean4-prod` with maintained patches
4. Update `model/dependencies.toml` to point to fork

## Consequences
- **Positive**: Decouples SDK release from upstream timeline; maintains reproducibility via vendoring
- **Negative**: Creates maintenance burden if upstream diverges; requires explicit fork decision process
- **Action**: 
  1. Create `vendor/lean4-prod/UPSTREAM_STATUS.md` tracking each PR
  2. Add upstream merge check to Phase 2 release checklist
  3. Document fork procedure in RUNBOOK.md

## References
- RELEASE-STATUS.md § "Upstream generic compiler dependency tracking (lean4-prod)"
- VERIFICATION.md § "Complete generated-projection oracle execution" (Bytes equality issue)
- model/dependencies.toml (lean4-prod revision pin)
