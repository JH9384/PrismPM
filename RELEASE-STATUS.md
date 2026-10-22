# Production release status

As of 6 October 2026, production SDK and ecosystem release acceptance remain
incomplete. The declared release-receipt validators and their synthetic fixtures
do not establish execution, publication or downstream adoption. All six release
obligations below remain mandatory. [Verification evidence](VERIFICATION.md#prismpm-v030-sdk-and-ecosystem-acceptance-closure)
distinguishes component checks from actual release acceptance.

Gate 15 (`cargo xtask package-api`) passes completely in the clean devcontainer,
verifying generated `prism-stdlib` and generic compiler packages (`prod-ir`, `prod-codegen`)
without public Hologram dependencies. The historical receipt `target/vv-evidence.json`
records gates 1–15 for its recorded source, not current-source acceptance. [Verification evidence](VERIFICATION.md#gate-15-ho-12-closure-and-full-pass-receipt)
records the exact remediation, package digests, and receipt bindings.

## Current boundaries

| Boundary | Status |
| --- | --- |
| Complete source gate | PR #48's first `just vv` passed all 15 gates for its tested merge revision. Its second full invocation was cancelled at GitHub's six-hour job limit; the PR is not accepted. |
| Immutable SDK | Current combined, installed and dual-platform release acceptance remains required. A development candidate is not a production SDK. |
| `Browser` application profile | `PP2011` remains closed. Pure session, presentation, crypto and storage components do not implement authenticated complete application execution/recovery. |
| Foundry | Reachable modeled services, mailbox enrollment/recovery, peer interoperability, coherent design and full user-journey acceptance remain required. |
| Publication | Producer acceptance, authenticated first-publication handoff, unchanged source-free export and exact deployed-byte/live-journey verification remain required. |
| Cargo ecosystem | The owner has deferred first-party crates.io publication until Foundry is published and verified. No bootstrap fixture authorizes an upload or establishes registry ownership. |

The source run is
[36331431587](https://github.com/UOR-Foundation/PrismPM/actions/runs/36331431587),
tested merge revision `08861e3caf1db0c8c9332d750b513506dec4b8e8`.
Its first invocation exited zero; the second did not finish. This is not a
two-pass receipt, branch-head receipt, SDK release or Foundry acceptance.

The first-party names `lexlean`, `prod-ir`, `prod-codegen`, `prism-stdlib` and
`prismpm` require owner-controlled initial crates.io uploads. The declaration
validator for bootstrap readiness (`prismpm/crates-io-bootstrap-receipt/1`)
checks fields under diagnostic `PP4103`, including dependency ordering
(`prod-ir` -> `prod-codegen` -> `lexlean` -> `prism-stdlib` -> `prismpm`), exact
64-hex SHA-256 package checksums and archive digests, prohibited unaided OIDC
bootstrap shortcuts, post-bootstrap trusted publishing configuration, and downstream
lock consumption declarations. Its synthetic fixtures do not establish public
registration, ownership, upload checksums or actual downstream consumption.
The owner requires Foundry publication and live verification before those
uploads. Public Cargo publication is therefore not a prerequisite for the
Foundry stage: use a separately verified, immutable OCI SDK with its complete
offline dependency closure. This changes publication order, not verification
requirements or the definition of a complete ecosystem release.

Application behavior is authored in LexLean/PrismPM. No handwritten publisher
application, copied standard-library namespace, placeholder binary or caller
success Boolean may replace a missing implementation.

[`hologram-live`](https://github.com/Hologram-Technologies/hologram-live)
is the `.holo` authority. `holo/1` is the Prism profile; the upstream physical
archive version is distinct. Exact pinned archive/executor interoperability is
required. Independent Hologram validation does not make Hologram a deployed
Foundry service or require publishing its crates.

OSCAL schema validation establishes structural properties, not implementation
of controls. Imported standards require their actual applicable oracles and
criterion-level evidence. Automated accessibility checks do not replace required
complete-process and human assessment.

Full shipped-image scans and approved vulnerability disposition remain required
for each immutable SDK identity under `prismpm/sdk-security-disposition/1`.
The declaration validator checks source-lock, dependency-graph, runtime, launcher,
multi-platform inventory and freshness fields; its synthetic fixtures are not
actual scans. Actual pinned OSV execution over every shipped dependency set,
database identity and freshness, and policy-approved disposition of all findings
must be verified. Component-only advisory evidence cannot substitute for this
complete shipped SDK disposition.
[Verification evidence](VERIFICATION.md#sdk-security-and-advisory-disposition-issue-15)
identifies the exact verification receipt and bound artifact identities.

Local reports are `target/asyncapi-upstream-audit-20260915.json` (SHA-256
`831b23c1b993d18026f25ac58f42cf86778be404f5d4b89ffb5ae80d3d534bc7`)
and `target/asyncapi-sdk-audit-20260915.json` (SHA-256
`5b4208b5299acc2d0dd8bfd35e914ceb5568f21c34e93cbb864cb64498f8df48`).

## Diagnostic boundary coverage

Feature and diagnostic register accounting is checked dynamically.
PP2009 executes the actual text-application validator; PP4001, PP8001 and
PP1101 exercise artifact integrity, confined cleanup and immutable lock owners.
PP1001–PP1003 exercise the actual strict project loader, including missing
required fields and signed, zero and excessive resource limits.
The other 77 `diagnostics.rs` probes still test generic local predicates rather
than their owning implementation boundaries. Passing those probes or counting their
IDs is not evidence that all public error paths work. Complete real positive
and malformed-input subsystem coverage, including emitted-code and execution
evidence checks, remains required for production SDK acceptance; it is not
excluded by the current text-profile work.

## Upstream generic compiler dependency tracking (lean4-prod)

PrismPM 0.3.0 depends on generic Lean 4 compiler improvements authored in `afflom/lean4-prod`
and tracked upstream in `auser/lean4-prod`. The authoritative dependency specification is
committed in `model/dependencies.toml` at revision `991956fe427bb646498fd0912c89b71be71e7beb`
for Lean 4.32.1.

Vendored release artifacts and tree manifests are locked to immutable SHA-256 digests:
- `vendor/lean4-prod/lean.tar`: `7a1a716a57040ea2307f7a34e895a75ebdca7438cf9d5d0364007acb594366bf`
- `vendor/lean4-prod/rust/MANIFEST.sha256`: `15675cbaf5df13a032f29eab947dd34b7fcf9c52f7d9f9f08bed8718d7a01d42`
- `vendor/lean4-prod/crates/prod-alloc-counter-0.1.0.crate`: `3072374800280030ab1f03db059676f93d7f3d62df431895e32fe8c9eae8229e`
- `vendor/lean4-prod/crates/prod-codegen-0.1.0.crate`: `6bd6690fef4a453ad58ee8e8ea1378f53a151aeb2c3aa00b092b582fe89e07fc`
- `vendor/lean4-prod/crates/prod-ir-0.1.0.crate`: `7cffc0251ee01ce97debe304a41a4e28f6be94ba41691fac1993c811919cdc21`

Because `afflom/lean4-prod` has issues disabled, dependency tracking and closure evidence
are maintained in PrismPM release tracking documents and anchored to upstream issue IDs.
All 15 generic compiler contributions follow established fork-PR flows to `auser/lean4-prod`:
- [Issue 70](https://github.com/auser/lean4-prod/issues/70): Release Dependency Closure: Provide immutable release/provenance identities required by PrismPM 0.3.0 acceptance
- [PR 38](https://github.com/auser/lean4-prod/pull/38) ([Issue 37](https://github.com/auser/lean4-prod/issues/37)): Adapt fallible Bytes CoreWasm entries (`fix/core-wasm-fallible-bytes`, commit `ac84a4d`)
- [PR 40](https://github.com/auser/lean4-prod/pull/40) ([Issue 39](https://github.com/auser/lean4-prod/issues/39)): Preserve UTF-8 validity on borrowed slice inputs (`fix/borrowed-utf8-encoding`)
- [PR 42](https://github.com/auser/lean4-prod/pull/42) ([Issue 41](https://github.com/auser/lean4-prod/issues/41)): Preserve collection ownership through scalar matches (`fix/collection-ownership-and-typed-decimal`)
- [PR 44](https://github.com/auser/lean4-prod/pull/44) ([Issue 43](https://github.com/auser/lean4-prod/issues/43)): Preserve ownership across SplitExact UInt32 bounds (`fix/split-exact-uint32-bound`)
- [PR 46](https://github.com/auser/lean4-prod/pull/46) ([Issue 45](https://github.com/auser/lean4-prod/issues/45)): Preserve scalar parameter hygiene in SDK generation (`fix/scalar-sdk-parameter-hygiene`)
- [PR 48](https://github.com/auser/lean4-prod/pull/48) ([Issue 47](https://github.com/auser/lean4-prod/issues/47)): Normalize raw local identifiers during IR lowering (`fix/raw-local-identifier-hygiene`)
- [PR 50](https://github.com/auser/lean4-prod/pull/50) ([Issue 51](https://github.com/auser/lean4-prod/issues/51)): Generate verified workspace browser components (`feat/workspace-browser-component`)
- [PR 52](https://github.com/auser/lean4-prod/pull/52) ([Issue 53](https://github.com/auser/lean4-prod/issues/53)): Constrain Nat operands without narrowing literal contexts (`fix/nat-literal-width-upstream`)
- [PR 54](https://github.com/auser/lean4-prod/pull/54) ([Issue 55](https://github.com/auser/lean4-prod/issues/55)): Preserve owned record projection across branch boundaries (`backport/owned-projection-pr44`)
- [PR 59](https://github.com/auser/lean4-prod/pull/59) ([Issue 58](https://github.com/auser/lean4-prod/issues/58)): Lower eligible self-tail recursive functions to loops (`fix/bounded-tail-recursion`)
- [PR 61](https://github.com/auser/lean4-prod/pull/61) ([Issue 60](https://github.com/auser/lean4-prod/issues/60)): Recognize byte-index specializations for LexLean imports (`fix/specialized-index-lowering`)
- [PR 64](https://github.com/auser/lean4-prod/pull/64) ([Issue 62](https://github.com/auser/lean4-prod/issues/62)): Preserve Unicode scalar length during string slicing (`fix/string-scalar-length`)
- [PR 65](https://github.com/auser/lean4-prod/pull/65) ([Issue 63](https://github.com/auser/lean4-prod/issues/63)): Recognize LexLean byte-slice operations during lowering (`fix/specialized-slice-lowering`)
- [PR 67](https://github.com/auser/lean4-prod/pull/67) ([Issue 66](https://github.com/auser/lean4-prod/issues/66)): Decode borrowed UTF-8 slices without allocations (`fix/borrowed-byte-operations`)
- [PR 69](https://github.com/auser/lean4-prod/pull/69) ([Issue 68](https://github.com/auser/lean4-prod/issues/68)): Reuse owned list tail during functional updates (`fix/owned-byte-read-lifetimes`)

Strict isolation is preserved: no Prism application or target semantics are proposed as generic compiler functionality. All contributions are strictly generic compiler/intermediate-representation/codegen invariants.
Any unmerged, unlinked, or unsupported upstream dependency changes block the final `prismpm/ecosystem-release/2` release claim.

## Workspace functional core and browser prerequisites (Task 13 / Issue #22)

The signed-envelope and authenticated browser-journal prerequisite gates pass,
including offline browser crypto/storage checks and complete bounded replay.
The generated workspace application profile, its View, and the Kappa
replication/read-admission path are implemented, independently verified, and
bound to release gates (DK-07 through DK-16). The Foundry portal integration
remains required for the authorized functional-core release; component tests do not
replace live faculty/participant journey acceptance.

## OCI product-release graph and registry lifecycle

The OCI product-release graph and registry lifecycle (Task 6, OC-01..OC-07) is
fully integrated and verified. Registered Prism vendor media types are strictly
minimal and standard OCI types are preserved. `build --locked` enforces required
gates before verified local root publication. Complete release graphs are bound
by digest across required artifacts and dependencies. Referrers for SBOM,
provenance, validation, signatures, vulnerability, license, and deployment
evidence are attached as subject-correct referrers with graph closure.
Promotion by attestation over unchanged subject digest is enforced and
unauthorized or unverified transitions fail closed with PP6101 / PP7401.

## Reproducible multi-platform SDK (Task 5, DK-01..DK-06)

Task 5 packaging and inventory components define the following contracts;
actual immutable installed-SDK and multi-platform reproducibility qualification
remain required:
- Canonical SDK inventories (`prismpm/sdk-inventory/1`) define every command and
  executable digest in sorted, deterministic order for `linux/amd64` and `linux/arm64`.
- Multi-platform OCI SDK images are built from immutable inputs and digest-pinned
  base images using BuildKit with `SOURCE_DATE_EPOCH=0`.
- Consumer `prismpm.lock` (`prismpm/sdk-lock/2`) binds multi-platform OCI index
  digests and platform-specific inventories, with an explicit proposal workflow
  (`prismpm/sdk-lock-update/2`) requiring compatibility, output diff, and security reviews.
- Explicit `fetch --locked` enforces offline operation for all core commands after fetch;
  omitting `--locked` fails with PP1101, and installed input tampering fails with PP5401.
- Bootstrap verification (`prismpm/bootstrap-evidence/2`) validates prior SDK
  projection compatibility, clean-root rebuild, and separate compiler semantics.

## Release acceptance closure

All six release obligations require actual source-bound execution evidence:

1. **Archive-codec and dependency closure**: Qualify the modeled codec through both independent Calculator/Text oracles, complete pinned LexLean/lean4-prod compiler semantics and upstream identities.
2. **Reproducibility and artifact integrity**: Reproduce every current golden, regression, source/package/image identity and artifact; historical 324-file counts do not define today's complete inventory.
3. **Dual-platform gates and OCI artifacts**: Execute two unchanged consecutive complete VV passes without cleanup and qualify immutable installed SDK, runtime, adapters, oracles and native packages on both `linux/amd64` and `linux/arm64`.
4. **Functional core and Cargo closure**: Verify actual Foundry SDK binding, workspace View and Kappa admission, and owner-controlled first-party Cargo bootstrap and downstream lock consumption.
5. **Downstream template and calculator reference closure**: Verify complete template/calculator consumption of the accepted immutable SDK and actual Compose, Kubernetes and Pages outputs.
6. **Ecosystem release manifest**: Bind `prismpm/ecosystem-release/2` to authenticated artifacts and executed downstream evidence; execute all 14 defect classes, not merely supply their names as evidence paths.

Current-source full VV, immutable installed-SDK qualification, migration and
concurrency qualification, real native application effects and Hologram adoption
remain outstanding under issues #62, #63, #66, #67 and #69. None is waived by
successful component tests or declaration-validation receipts.

## Release status closure verification

`validate_release_status_closure` and `validate_v0_3_0_release_acceptance`
validate caller-supplied declaration fields. Their integration tests use
synthetic identities and success flags. They do not read or authenticate the
referenced executions, and their output must not be used as proof of any of the
six obligations above. Overall acceptance requires the original execution
records, immutable source/SDK/artifact bindings and independently checked
downstream evidence; receipt structure alone is insufficient.

## Calculator baseline record

The canonical `prismpm/calculator-baseline/1` record is committed at
`tests/data/calculator-baseline.json` and validated by integration tests
(`tests/calculator_baseline.rs`). It binds exact commits, artifact identities,
contract validation, and reproduction evidence across source, crate, holo, View,
browser, and Pages assets.
