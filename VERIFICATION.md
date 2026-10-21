# PrismPM falsifiability and verification record

## Integrated emitter source binding

The complete audit rejected the stale emitter digest after metadata-alias
hardening in `c6d10cdfd59b23b3982eb2d042f55492f455c375`. Independent hashing
reproduced the old digest at its registered revision and the new digest from
all 13 current inputs. Only that bound source file changed in the closure.
The registration now matches; the unchanged complete `xtask validate` passes
all 155 Node checks and the source/model/spec/dependency audits. The normal
stdlib writer's existing model already carries the new computed digest.
This is source-integrity verification, not installed-SDK or Foundry acceptance.

## Bounded-codec compiler input and stdlib regeneration

The compiler input is `6272da01ea2045906f5f844988b6265d6c867f39`, including
tail-call lowering, byte indexing/slicing, scalar string length, borrowed
UTF-8 decoding and allocation-safe byte reads/appends. Its unchanged full
`just ci` passed twice locally and upstream PR #69's hosted verification passed.
The vendored source reproduces its exact Git blobs; public stdlib function
signatures remain unchanged (624 checked, ignoring parameter mutability).

The normal stdlib writer passed with build
`85460cb147589358b903d01fb4c76d6cc6f64e8ff1b8d23adf54d02278a8ad00`
and attestation
`22af3417fcc7291dd021ff9bfe3a8e3ce4d624d8c135bd1b64f0a39190f95de0`.
Two independent packaging runs produced identical compiler, IR and stdlib
archives. The stdlib archive binds the generated manifest and all selected
package bytes; no_std compilation, authored formatting, workspace Clippy and
the complete source audit passed. Writer and complete audit log SHA-256:
`7352ad0f9e6db1419834af0ccff769d33c0737d8e0f326591aed35464aaa40e9`
and `c07f46bcca270f09787128667689228c5291342edaf4577633543ab702ffa8e8`.
Resource-failed earlier attempts remain failures, not substituted receipts.

Current goldens, complete repeated V&V, installed dual-architecture SDK and
Foundry product acceptance remain required. This is not a release claim.

## Integrated codec source checks

After the compiler, effect protocol and CBOR integration, all-target/all-feature
Clippy, the complete source audit (155 Node checks), 45 conformance-library
helper tests and 14 model tests passed. The helper/model log has SHA-256
`5ff100e9a594a60d44d2bc5b664454893bdc8a2dc1175d2c20e95c3ef96fd8aa`.
All 23 xtask unit tests and the original 31-function application API's actual
std/no_std consumer execution also passed without skipped or filtered tests.

The complete 198-test library run finished with 197 passed and one failed:
the obsolete `prismpm-oracle-test` image lacked AsyncAPI's separately locked
runtime. This is a failed run, not SDK acceptance. The unchanged test passed
all 24 documents, 89 examples, five runtime groups and negative probes against
the current development-only OpenID/AsyncAPI image
`127.0.0.1:5000/prismpm-openid-oracle-test@sha256:db5ad1aaac7b1d847a5ec6fc2ed33688fc46dc31b449f7f5f2e7b83e70e7228d`.
Corrected owning log SHA-256:
`8993aced253b24321b25127f28dea13a54ad03aa624264e7e825f9f05f4d168b`.
That isolated result does not replace a clean complete library or V&V run.

The complete library rerun at `7fa9f768c34273faadd7edb5c880810d6129443e`
with the corrected image passed all 198 tests in 2,042.43 seconds: no failures,
skips or filters. Log `target/foundry-publication-library-corrected-image.log`,
SHA-256 `9d19a06dc18188126b0d93d98a6e59e50e64891c82d743d15d9fa2075d35d840`.
This supersedes the failed library checkpoint, not the remaining full V&V,
installed-SDK or Foundry release gates.

## Publication-boundary integration

Inconsistent provenance now fails before expensive proof replay. Coherent
metadata still requires the unchanged complete replay and independently
computed binding. All seven closure tests passed after integration; restoring
the earlier check order failed both ordering regressions without bypassing
the real proof reader. The Action's 19 adapter tests also passed; those tests
establish argument/isolation behavior, not a live deployment.

| Local log | SHA-256 |
| --- | --- |
| `target/publication-integrated-preflight-tests.log` | `a982b1030a55cf233ce127f23e3d04542febfc4ddc51ab610925276c09aebefb` |
| `target/verification-provenance-preflight-red.log` | `93ea11a4b5ee1b408da7535c095811eed9078a5afeaeaaf3d6c3bcea4999c30b` |
| `target/publication-integrated-action-tests.log` | `f772089c04e4778d93157db5301b3aba0ab8384a3bd4131989601cd69d6c85b8` |

## Integrated golden source review

The normal writer passed at `60a1afd`, producing 339 files for build
`85460cb147589358b903d01fb4c76d6cc6f64e8ff1b8d23adf54d02278a8ad00`.
Review found exactly 14 added authored-source copies, no removed or changed
older sources, and five updated manifests/model records. Selected stdlib
semantics remain unchanged; the emitter binding and actual verifier identities
are updated. No generated Lean or expected execution output was hand-edited.
Writer log SHA-256:
`2190bd5cc9d2e31604415f9794ad406638cbdc3a5601c713d8dee7e0c939146f`.
Non-writing readback and native platform records remain separate gates.

## Bounded browser RS256 effect (DK-19)

All 14 Node/Chromium tests passed against the pinned, hash-checked WPT RSA
vectors and independent native signatures. Tests cover exact byte capture,
algorithm/padding substitution, malformed inputs, resource boundaries and
closed provider failures. Three actual browser source mutations (unconditional
acceptance, wrong hash and missing message capture) each failed their unchanged
behavioral assertion; pristine restoration passed. The owning DK-19 case,
model/spec checks and all-target Clippy passed before integration of the
per-file test-completion guard. After that integration, all 26 signature and
SDK-helper tests passed with no skips, including missing/empty-file regressions
and both test-runner guard mutations. The final combined log SHA-256 is
`aa650a0ee89e1f7266dfd9f861e4bfe70aa4c19cf25191678fd437a073048900`.

This accepts a generic signature primitive, not JWT parsing, issuer trust,
mailbox proof, account enrollment, complete WebCrypto conformance or an
installed SDK release. No Foundry deployment is implied.

## Internal mailbox assertion admission (ST-13)

The LexLean-owned kernel passed all 93 modeled cases in actual packaged native
std/no_std consumers and audited all 233 selected declarations. Its authority,
account, challenge and credential bindings remain internal prerequisites;
constructing a proof record does not authenticate an email address.

Both weakened guards were rejected by generated runtime assertions:
`mailboxCurrentControl` at `probeHistoricalPolicy`, and
`mailboxGateWrongCandidate` at `probeProofCandidateCredentialRef` (exit 101).
Neither mutation published accepted artifacts. Both pristine restorations
reproduced build
`28fbeed7032d521ebab63ae2cd0590badd3f78dd6a3381b530efaed57b6cd504`
and attestation
`4b97e0afbfdad30949cdb2dc1eba9d5eb806a46deeccb872fee0daa6352395bc`.
The canonical compiler-input owning run completed in 462.63 seconds;
`target/mailbox-admission-owning-canonical.log` has SHA-256
`ef508f23ca0f83b15abcab67e68bc99090e42c8c0cf551c17e195285196ec6bf`.
Provider integration, cryptographic proof admission, browser enrollment,
atomic persistence, SDK release and deployment are not accepted by this gate.

## Borrowed Copy-pattern compiler input

The compiler input is `d290beebe9b06a6841769b8327308e01e896c1b0`.
Borrowed Option/Result patterns now rebind positively typed Copy fields by
value, matching the existing ownership analysis. Unknown and non-Copy fields
remain borrowed; owned matches retain their behavior. The original regression
and an omitted-rebind mutation failed with an actual generated Rust type error.

Two unchanged compiler `just ci` runs passed, including 231 native cases in
four configurations and seven allocation/Wasm checks. Log SHA-256:
`ee2ce666d8e6ce7c39267a0e2f6a4bae892817ae903706ac159356b2fbb979be`
and `24a859e3cee401366a37a4e257a0dd5ad6952ea9f2a5183ca248ce7b59bd8186`.
An unchanged 307-case Effects corpus also passed private native replay; its
canonical owning gate is separate. The two pre-existing ignored documentation
examples remain unchanged.

All three imported Rust files match exact Git blobs; the 50-file Lean archive
is unchanged. Fresh packaging and an independent repeat produce identical
compiler/IR/stdlib archives (repeat log SHA-256
`758b7aa63cac69323ae30c69623a781b67e77d11c04ce065563980f244bc5f67`).
Existing stdlib archive equality is not current compiler regeneration or SDK/
Foundry acceptance.

## Exclusive-branch compiler input

This checkpoint pinned `507b6c4ef44e951bb4bbe8b34e4767803fafa8b5`.
Owned-value reuse follows execution paths: exclusive branches can move, while
conditions, scrutinees and sequential uses remain additive. Native allocation
and pointer-retention regressions plus the unchanged 64-page Wasm accumulator
fail before the fix and pass afterward. Full compiler `just ci` passes twice;
log SHA-256 `735a2ca714104353101cf2c1cba18b269af24ab29ff73fdd09a108385c5a5313`
and `1f3e04b37d1d15ac308f074d088393ce0f6c9cdfa7e58d900587736b1cd173c3`.
The two changed Rust files reproduce exact tracked Git blobs; the Lean archive
is unchanged. This accepts compiler inputs only. Current stdlib regeneration,
goldens, installed SDK and Foundry acceptance are still required.

## Verified compiler input refresh

This checkpoint pinned `8e97cf8bbae442b18a7c4fac76d8473b837f38de`.
It admits bounded first-order local functions, preserves large Nat literals,
and owns returned values before branch-local storage expires. Borrowed
accessors require one correctly typed, stable borrowed input; valid accessor
pointer identity is retained. All new regressions execute, including 193
native cases in four configurations and the exact 66/65-page owned-copy Wasm
acceptance/denial boundary. Existing application limits are unchanged.

Unchanged compiler `just ci` passed twice in its devcontainer. Log SHA-256:
`1a8cd5bebf55aae0c1fa0f48df28b967d33b0ccff3cf7be7a36b7fd9130fd8cf`
and `e06711e4b8ee8779ae0a236d0d53f045643fc710a7b467d0ea95c76b21879ff1`.
The two pre-existing ignored documentation examples remain unchanged.
The vendored Lean archive and five changed Rust files reproduce exact tracked
Git blobs; the new regression fixture is included in the sealed source tree
and Cargo package. This accepts compiler inputs only. Stdlib regeneration,
owning model gates, reviewed native goldens and installed-SDK acceptance
remain required before release; no Foundry deployment is claimed.

## Bounded application metadata aliases

The original cyclic alias caused a stack overflow; a malformed explicit module
silently fell back to the current module. Iterative resolution now rejects both
with `PP2001`, preserves cross-module lookup and independent repeated fields,
and accepts exactly 65,536 closed calls per scalar metadata value. Native root
lists retain their separate bounded walker.

All 198 library tests passed without skips in the devcontainer using the
development-only external-oracle image with the current oracle adapters.
The log SHA-256 is
`c87314f49dd6b687cc4ffa9e7a9da95e599da2d672b26216821446fc2ad01e16`.
Reducing the limit by one failed the actual boundary assertion; restoration
passed all four regressions, authored formatting, all-target Clippy and model/
spec checks. The restored log SHA-256 is
`5ab89497c8fe7233dc0215cd14a3f49f0aeb5c305bae9619936f1860157aa5f0`.
Earlier runs with missing or stale oracle configuration were interrupted and
are not acceptance evidence. This is not installed-SDK or deployment acceptance.

## OCI product-release graph and registry lifecycle (OC-01..OC-07)

The OCI product-release graph and registry lifecycle implementation was verified against
all seven conformance requirements (OC-01 through OC-07) and registered unit/integration suites:

1. **Registered vendor media types**: Minimal Prism-owned document media types and standard OCI
   descriptors are strictly closed (`PRISM_RELEASE`, `PRISM_VALIDATION`, `PRISM_VERIFICATION`,
   `INTOTO`, `SPDX`, `PRISM_SUPPLY_CHAIN`, `PRISM_PRODUCTION_ACCEPTANCE`, `PRISM_EVIDENCE_SIGNATURE`,
   `PRISM_DEPLOYMENT_EVIDENCE`, `PRISM_PROMOTION_POLICY`, `PRISM_PROMOTION`, `COSIGN_SIGNATURE`,
   `COSIGN_SIMPLE_SIGNING`, `OCI_MANIFEST`, `OCI_INDEX`, `OCI_EMPTY`). Any unregistered vendor
   media type is rejected with `PP6101`.
2. **Graph closure and verified root boundaries**: Graph verification verifies descriptor count,
   manifest count, content digests, and edge acyclicity (`visit_graph` rejects cycles and missing
   blobs with `PP6101`). Referrers can only be attached to verified local release roots with
   exclusive lock synchronization; unverified subjects fail closed with `PP6101`.
3. **Reference validation**: Pinned and tag references enforce OCI distribution naming specs,
   rejecting uppercase characters, path traversals, bare repositories, and tag-only references
   when digest-pinned references are required (`PP6101`).
4. **Schema conformance and falsification**: Conformance and falsification testing verified
   `schemas/product-release.schema.json` and `schemas/product-release-result.schema.json`, asserting
   that payloads lacking required properties, with invalid SHA-256 digests, non-zero negative
   artifact lengths, absolute or traversing evidence paths, or injected undeclared properties fail
   validation (`additionalProperties: false`).
5. **Full lifecycle conformance**: The conformance suite verified the full OCI release lifecycle
   (OC-01 through OC-07), including graph verification, descriptor tampering detection,
   deployment evidence referrers, artifact inspection replay, reference syntax boundaries,
   promotion attestation requirements, and source-free browser export.

## Generated workspace View (DK-15, DK-16)

Registered owning tests first rejected the absent implementation. The complete
fresh modeled gate then passed all 206 vectors in native, no_std and bounded
Wasm execution, including actual compiled session/row mutations. The private
host gate freshly built View, Command, Query and Journal, exercised genuine
browser identity/storage journeys and replayed all 6,562 observed calls twice
natively. All ten host-suite tests passed without skips.

Review reproduced initialization failure leaving one mounted node and seven
listeners. The corrected constructor clears both before returning failure.
The complete host rerun covers three initialization faults, eight promotion
faults and nine host mutants; its log SHA-256 is
`cea54c6b5d65f98ce235ed9911653a5622478c50c51600fc0212f1e14bd54f98`.

Normal writers regenerated the model, stdlib and reviewed goldens. Independent
readers matched all 324 golden files and passed generated-package, downstream
API and all three actual Cargo archive comparisons. The package/API log SHA-256
is `037a3543c5c8a3230b4368d1bb37a1e54709360aabdcdbc5b8d438f92b9121ac`.
All 14 model tests, 15 contract tests, ten SDK/acquisition script tests and
14 release-phase tests passed, as did authored formatting and workspace Clippy.
Clean-tree full V&V and installed dual-architecture SDK acceptance remain
separate requirements. These components do not establish Foundation authority,
email ownership, Kappa replication or Foundry publication.

## Release archive target ownership

An inherited `CARGO_TARGET_DIR` sent verified archives outside their prepared
stage, causing the real archive check to fail. Packaging now selects its owned
target explicitly. The publication workflow selects the target of its expected
package/version archive while retaining verification and pre-publication byte
comparison. No Cargo publication was performed.

The real packaging regression and workflow validator both failed before the
fix. All 14 release-phase tests then passed in the devcontainer, including exact
archive equality, preservation of caller artifacts, seven workflow mutations,
and valid/invalid shell path selection. The log SHA-256 is
`097da6b212e1ce7707a184b14673e50f2aac3d33cabdaad3106410a32d6e0a3b`.

## Source-free browser export (OC-07)

`export-browser` replays the retained release closure and atomically publishes
only its six exact generated browser files. Genuine named releases A and B
are built and verified before source removal; an empty receiver then exports
their unchanged bytes. Missing or substituted evidence, changed assets,
symlinks, hardlinks, special files, unsafe paths, existing outputs and staged
directory replacement are rejected. The CLI first failed with the command
absent; removing the post-publication identity checks made the owning race
regression fail. Both defects were restored before verification.

All 157 library tests passed without skips or filters in the devcontainer;
`target/browser-export-library-complete.log` has SHA-256
`3fa9339257f1b7c3369eb16b449b6b1d3926701450d07a41a0dd8d4584a6f95a`.
All-target/all-feature Clippy, formatting, source/model/spec audits and all
33 model/driver/compatibility tests passed. The final complete conformance
package passed all 151 scenarios and eight unit tests, with none ignored or
filtered; log `target/browser-export-conformance-clean.log` has SHA-256
`dbe3311464c34b31ac0a3a9a3cb9a1b19141e3a78e1805f3abad635f7a5f1e48`.
Golden review preserved all 194 build files and native execution evidence;
only verifier provenance and its two derived records changed. An independent
check reproduced all 240 golden files. Final static checks and golden replay
are recorded in `target/browser-export-final-audit.log`, SHA-256
`4128bcfa6a31361d25b8f0a4dc327a9e306ce14cbf54add278a5cc689384dfeb`.

The real package/API gate still fails on the absent public `uor-hologram`
dependency. No gate is waived and no new SDK release, production-acceptance
receipt or Foundry deployment is claimed. The digest-bound development image
below supplies external oracle tools only. Export integrity does not establish
producer readiness, authorization, full artifact coverage or live acceptance.

## Fixture source isolation

The complete conformance rerun passed 149 cases and failed HO-11/OC-07 with
`ENOSPC`: the text fixture contained 17 GiB of ignored generated cache, which
the fixture copier duplicated into temporary projects. Only those confirmed
untracked generated directories were removed. The copier now prunes generated
state at the project root, preserves source/dotfiles/nested names, and rejects
unreadable, symlinked or nonregular source inputs instead of silently omitting
them. Four owning regressions failed before the correction; all five passed
afterward. Logs: `target/fixture-source-copy-red.log` and
`target/fixture-source-copy-green.log`. No expected outcome or gate was reduced.

## Complete generated-projection oracle execution

Real system projections exposed two additional failures: Compose could not
resolve its modeled secret-directory reference in the cleared sandbox, and
the Kubernetes wrapper rejected the generated generic `List` before checking
its resources. Compose now receives a fixed, isolated non-secret directory;
interpolation and consistency checks remain enabled. The Kubernetes wrapper
traverses every collection leaf through the unchanged pinned OpenAPI schema.
That schema then rejected the imported ingress ConfigMap's `data: null`;
the projection now emits its empty map without modifying imported source.

Compose positive/negative tests and all four Kubernetes wrapper tests pass.
The actual modeled system passes all seven locked projection oracles in
`target/projection-oracles-preflight-normalized.log`, after the recorded
failures in `target/compose-project-environment-red.log` and
`target/projection-oracles-preflight-complete.log`. Six validate generated
documents; CloudEvents uses the production runner's fixed envelope fixture,
not evidence of runtime-event acceptance. The development-only
oracle image is digest-bound at
`127.0.0.1:5000/prismpm-oracle-test@sha256:eb5205273cfcc84bb749272115a40a3b527403d2db5a8ec3751c345bbd7a1f7b`;
it runs the corrected wrapper tests and regenerates its real SDK inventory.
It supplies external tools, not an accepted SDK release or Foundry deployment.

## SPDX project-oracle schema binding

The genuine project runner rejected a valid SPDX document with `PP5403`:
the catalog's relative schema path was resolved from sandbox `/scratch`.
The SDK already includes and inventory-binds that exact authoritative schema.
The catalog now selects its existing absolute SDK path; the installed schema,
SDK wrapper and validation rules are unchanged. The regenerated lock also
retains the source hashes changed by adding the regression tests.

The focused regression runs without a project standards directory. It accepts
the valid corpus, rejects the invalid corpus with `PP5404`, and checks both
original attestations' subject, result and actual SDK image bindings. It failed
before the correction and passed afterward in the devcontainer. Logs are
`target/spdx-project-schema-red.log` and
`target/spdx-project-schema-green.log`. This fixes project-oracle execution,
not complete SDK release or Foundry acceptance.

## Devcontainer Docker group readiness

[Reproducibility run 35232240458](https://github.com/UOR-Foundation/PrismPM/actions/runs/35232240458)
failed before comparison: its lifecycle shell inherited groups before the root
initializer added Docker socket access. In an isolated copy of the actual
devcontainer image, that stale shell still failed after `usermod`, while a fresh
shell succeeded. Lifecycle commands now wait for the current socket group and
refresh their own non-root credentials when necessary; editor readiness waits
for the post-start hook. Existing terminals are not retroactively repaired.

All six devcontainer regression tests passed against the real daemon: the
unwrapped stale process fails, refreshed/fresh/restarted processes succeed,
arguments and exit status are preserved, and missing initialization/socket or
root execution fail closed. Host socket ownership/mode are unchanged; all
owned test containers were removed. The log SHA-256 is
`7a3f7947b3b1c5be51feec8b13849394bc8c0104e4336cb176e1994f3da92a08`.

Hosted VV/Bootstrap at `f01ae4c` then exposed a fixture assumption: GitHub's
remapped devcontainer no longer contained group `1000`. The production startup
hook succeeded; the test's hard-coded group failed before Cargo. Repeating the
actual UID/GID remap reproduced that failure. The fixture now derives existing
identities and exercises both original and remapped users; all 11 tests pass
without changing the production helper or omitting checks. Green log SHA-256:
`acb0e25ec498d495262d842ae2bd3c5a1af8dc7aaf55501f0ec90d3a6ccdab83`.

## Source-free release evidence (OC-02, OC-03, OC-04, OC-06)

OCI now retains the original build manifest, every path-bound output, and the
complete runtime/oracle proof closure. Replay checks the same records without
source access or execution. Native executable bytes remain in the real closure;
reviewed goldens retain their descriptor, as for generated Rust and kernel IR.
Integrity does not establish producer authorization or product acceptance.

The first real A/B application replay rejected selected-module source maps:
their identities legitimately differ from the containing system's full snapshot.
The controller now retains the actual selected snapshot, manifest and outputs;
no map is rewritten or comparison omitted. Both releases then passed runtime
verification and replay, including coherently rehashed evidence mutations.
The log SHA-256 is
`c783bbf2d956058e5063b0b16d02b05d24b18d6c245d80e5d3511082dcf829c3`.

The other 139 library tests passed with none ignored, including genuine native
evidence, missing executable/proof/build-manifest rejection, source-free OCI
round trips, path confinement, and coherently rehashed provenance substitutions.
The log SHA-256 is
`041402a8de8fcf01ff6d2bbd2119b17652cd8441b4c9619ea774ef898f8b509b`.
All four owning conformance scenarios passed; their log SHA-256 is
`f29dfef6632c376fed2a0029adae5b6e412a7d0e765bb4aa12026fc19151f255`.
These runs used the repository devcontainer and the previously authenticated
d017 SDK for external tooling, not as acceptance of this new SDK or Foundry.

The model gate exposed its stale 44-contract count after the two new contracts
were registered. The corrected exact 46-contract gate rejects every individual
omission and same-cardinality duplicate; generated contract documentation and
the model/spec linkage gate pass. Oracle attestations also preserve their
registered in-toto envelope rather than inventing a Prism `schema` property.

Denied-warning workspace Clippy passed with all targets and features. Fresh
stdlib generation checks and all three release-crate archive comparisons pass
without changing package bytes. The downstream `package-api` gate failed:
`uor-hologram` is absent from the public Cargo index. Its log SHA-256 is
`375ff6f77cf400b9532301832b9ba76a155cfdd539d8462634d50b4ddf8d1630`.
No Git/path substitute was introduced. Full release acceptance remains unmet.

The old golden comparison rejected the changed build/verifier identities.
After reviewed regeneration, an independent check matched all 240 files;
all 193 native build-output descriptors remain unchanged. Only the build
manifest, LexLean attestation, verification manifest and golden manifest changed.
The passing comparison log has SHA-256
`c35161c7f3d8b91500181207c6f07094bcbc2543aea3e5092f0f3a07dd2d85be`.

## OpenID source-closure reproducibility

[Bootstrap run 35226604960](https://github.com/UOR-Foundation/PrismPM/actions/runs/35226604960)
passed the repaired Docker/OCI integration, then eight conformance scenarios
failed at the same OpenID corpus digest check. Ten upstream `.claude`/`.idea`
files were present locally but ignored by Git. All 6,021 local files match the
unchanged pinned archive
`d33d7eb40b6db0080a48563fe6e8d1073393d18fe9f4afcb3de83f1679197bbb`.
Its complete tree hashes to the required
`a35012f67dccd4296ab0e380eb86a0e053dbbf6bf52522aca3ed961c83812197`;
the incomplete Git tree exactly reproduced CI's
`1cfc37b89be7e0e7325013deabd485e581c8ffff8aedcad143f51155d3e66dcd`.

Tracking those exact files restores the closure without changing oracle bytes
or pins. The source-audit regression failed before staging and passed afterward;
isolated-index missing/changed/extra/symlink mutations fail, and local untracked
bytes cannot satisfy it. This repairs the shared prerequisite, not evidence
that the eight complete external scenarios have already rerun successfully.

A subsequent complete devcontainer conformance run passed all 150 scenarios,
with zero failures, ignored cases or filters, including all eight previously
blocked scenarios. Log SHA-256:
`1c8419c046afb96043510e12f6e562fd02226b97c10b8c477187b568e04bf3a4`.
External tools used the previously authenticated d017 SDK image; this validates
the corrected source/OCI boundary, not a newly accepted SDK or Foundry release.
The separate public-package failure and absent complete producer/publisher
implementation remain production and Pages deployment blockers.

## Release identity and system certificates (OC-02, SY-02)

The host certificate omitted product and secret-reference identities and used
index order instead of dependency order. Corrected certificates satisfy both
real Calculator A/B `SystemReleaseReady` proofs and all 12 individual formal
predicates through LexLean; no formal rule or dependency was removed.

Explicit A and default B passed actual runtime verification with bound receipts.
Restoring default-only selection failed the receipt/build identity assertion;
disabling the mismatch guard failed the expected `PP6101` rejection. Both
mutations were removed byte-for-byte. The two controller tests and the other
122 library tests passed in separate devcontainer invocations, with none ignored.
External-oracle tests used the previously authenticated d017 SDK as tooling,
not as a newly accepted SDK. The positive controller log has SHA-256
`119bde7d6a503bd394061690b413f067ec35cd03c6ccb7ce84ba90e3bb12ab15`.

The separate public `build --locked --release A` attempt stopped at `PP5403`:
the copied fixture lacked an accepted canonical SDK lock. It produced no release
artifact. These regressions do not establish public product-build integration,
complete SDK acceptance, or Foundry deployment.

## Text application integration and artifact confinement

`application_export_imports_every_generated_module` failed against the previous
first-module-only exporter arguments: the declaration module was absent while
its imported type module was present. Importing every generated module made
the regression pass; a separate test preserves single-module arguments.
Two additional passing tests bind the text View to its exact model, core,
entrypoint and byte limits, and reject invalid evaluated labels.

`artifact_publication_rejects_escape_before_creating_files` reproduced a
`../escape.holo` write in an isolated temporary fixture. Publication now checks
every generated path before filesystem effects and again at the write/readback
boundaries. Parent, absolute, dot and empty-segment paths fail; nested output
and create-new overwrite protection pass. Both controller regression tests
passed inside the PrismPM devcontainer as `vscode`.

These are component checks, not complete SDK or Foundry acceptance.

## Ordered control coverage (SY-07)

Before implementation, `cargo test --locked -p repo-conformance --test
conformance conformance_sy_07 -- --exact --nocapture` failed in the devcontainer
because the semantic snapshot lacked `Production.ControlCoverage`. The log is
`target/control-coverage-red.log`. The capability is structural composition,
not OSCAL conformance or evidence authentication. Its modeled finite corpus
separately witnesses permitted inheritance and rejects origin relabeling,
missing/residual obligations, cycles, duplicate/dangling records, and exact
binding mutations; those cases do not substitute for a universal proof.

The combined dependency-cycle case was strengthened so its two provider edges
are already topologically ordered and neither downstream residual list is
dropped. Replacing only the residual-order predicate with `true` then made the
generated Lean verifier reject `coverageCaseCombinedDependencyCycle = false`
and `coverageCorpusPassed = true`: `decide` proved both propositions false
(`PP5001`, cause `LLV7002`; `target/control-coverage-residual-mutation.log`).
The formal source was restored byte-for-byte after that observed failure.

A separate generated-source probe found that generic `Bytes` equality in the
pinned LexLean runtime does not kernel-reduce, although its String equality
and Bytes-length probes pass. The complete failed formal probe is retained in
`target/control-coverage-bytes-reduction-reproducer.lex.tex`, with diagnostic
log `target/control-coverage-probe.log`. This remains an upstream compiler
issue, not a claimed passing capability. Control coverage instead models
identities as exactly 32 UInt8 octets and compares them by structural recursion;
no equality assertion or proof check is omitted.

The following self-contained semantic declaration preserves the failing probe
in the repository (the larger diagnostic workspace above is ignored). Add it
to a LexLean semantic module and run its normal generated-Lean verification;
the pinned runtime cannot reduce the declared Bytes equality through `decide`.

```json
{"kind":"theorem","name":"coverageBytesEqualityProbe","parameters":[],"proof":{"kind":"decide"},"statement":{"kind":"eq","left":{"arguments":[{"hex":"1111111111111111111111111111111111111111111111111111111111111111","kind":"bytes"},{"hex":"1111111111111111111111111111111111111111111111111111111111111111","kind":"bytes"}],"kind":"primitive","operation":"equal","result":{"kind":"bool"}},"right":{"kind":"bool","value":true}}}
```

Native verification with lean4-prod revision
`853534bddf17690ce45601977db21a795a03d4c8` passed, producing attestation
`01672f7e680cf6b996f65f6be273f743193418a5f535724980439bff25f2e9c6`
for build `a70c44cde661c11cdea4aa75d8ce41666b3d14f36fc30ed979d3d9fcf3382fc7`.
The emitted Rust contains all 54 case definitions, all 54 distinct aggregate
calls, and actual calls to `validateControlCoverage`, not a constant-true
replacement. The native executable ran twice deterministically: 597 list
inputs plus 54 separately accounted control cases (6 positive/48 negative),
with the measured validator probes reporting no allocation or panic. The
digest ABI is owned `Vec<u8>` fields behind borrowed policy/submission inputs;
the modeled exactly-32-octet check remains mandatory. Rust compilation emitted
warnings, recorded in its process evidence; successful execution is not a
claim of warning-free generated code or complete release acceptance.

The upstream ownership failure and its reviewed generic correction are
tracked in [lean4-prod issue 30](https://github.com/auser/lean4-prod/issues/30)
and [PR 29](https://github.com/auser/lean4-prod/pull/29). Its focused native
regression failed before the correction, and the complete devcontainer
`CARGO_NET_OFFLINE=true just ci` passed before committing the accepted fix.
Ordinary Prism verification now checks the exact finite corpus structure and
count bindings before emitting execution evidence; six metadata/source
mutations are rejected with `PP5006` by
`execution_rejects_invented_or_short_circuited_control_case_counts`.

## Generated standard-library package boundary

Regeneration exposed a producer-owned formatting defect: Cargo `src/lib.rs`
ended with redundant blank lines, so faithful generated output failed
`git diff --check`. The empty-module regression failed before the correction.
lean4-prod commit `081ec576f10c7ea5698641483db455962c567e76` normalizes only
the complete generated source to one final LF before its manifest hashes are
computed. Empty, single-definition, and multiple-definition regressions check
that boundary, the final source hash, and byte-preservation of supplied license
and README assets. All 66 codegen unit tests, denied-warning Clippy, and the
complete devcontainer `CARGO_NET_OFFLINE=true just ci` passed. The source is
tracked by [issue 31](https://github.com/auser/lean4-prod/issues/31) and
[PR 32](https://github.com/auser/lean4-prod/pull/32); generated files were not
edited by hand.
The upstream [CI verification run](https://github.com/auser/lean4-prod/actions/runs/35029493850)
also passed for `081ec576`; PR 32 was still open at this checkpoint, not merged.

The source-package comparison also rejected an intermediate package after its
authoritative license inputs changed (`target/control-coverage-stdlib-upstream-check.log`):
`stdlib package drifted; review just stdlib-package-write output`.
This was an observed negative check, not a passing package acceptance result.

The additional required accounting and export bindings are deliberately new
closed evidence contracts: `execution-evidence/2` and
`verification-manifest/2`. Focused negative tests reject the former `/1`
schema values; Holo/1, the CLI result, and application verification retain
their existing schema identities. The successful `/1` union-export preflight
was not accepted as final `/2` evidence.

Fresh `/2` source-package generation and an independent check reproduced
attestation `ad4ae79ee9f78158dd35db0faec6f29e49315ea5707197420cf866b5fa0bafd9`
and LCNF SHA-256
`181c4cf507d3b9ffde50471e14aa825df4c8a767a71c309fe18e0003369b65ff`.
The accepted request contains 51 validator roots and 20 additional package
roots, with all 71 names covered by the one verified export. Runtime evidence
separately reports 597 list inputs and 54 control cases (6 positive/48 negative).
The original 31 application-function signatures and two public types/traits
compile and execute in both `std` and `no_std` plus `alloc` consumer builds;
boundary cases cover bytes, UTF-8, checked integers, and Holo validators.
These component checks do not substitute for clean-commit full VV or registry
release acceptance. Final goldens bind the executable after archive sealing;
embedding changed archive/release bytes can legitimately change the enclosing
LexLean executable hash and its derived attestation identity.

After sealing the standard-library archive (`eae96b8d0a6627fc25cc3b9b73f61c4b91830673ca316deaf0b5e1c4b5928053`),
the final native verification and independent golden comparison accepted
attestation `457c17ac4dfaaec185f882037eba8a82ae9f8b885bd1e7b7f0d79559cfaac004`
for build `416d0d8d2033be2322366eed17fcd26bf4ccc9067d5175216ed496150df96f20`.
All 234 reviewed golden files matched (233 listed files plus the manifest).
Archive reproduction, all 16 fixture comparisons, 18 verifier unit tests,
15 package-orchestration unit tests, model/spec/source audits, formatting,
and denied-warning Clippy passed. The exact package also built offline for
`wasm32-unknown-unknown` with default features disabled, without changing its
source. The post-seal Calculator example reproduced build
`6d7c9c3791c2ac639453291289809deb4afe57b7f5b29960971fcb30c1386999`
and verified attestation
`5f8610adabb35c3f5586e5abeeeba0c7c1fbc324659cfc4bb08ce407cae0a993`.
Calculator's arithmetic and View sources were unchanged; compiler/stdlib
provenance and package-byte changes legitimately change its artifact identity.

The direct 148-case conformance run, with `PRISMPM_TEST_SDK_IMAGE` unset,
reported **139 passed, 9 failed, 0 ignored**. SY-07, ST-07/ST-08 and every
EX-01 through EX-10 passed. AU-05 rejected the absent immutable SDK image;
AU-06, LC-03, OC-01, OC-05, SC-01, SC-02, SY-04 and SY-05 rejected the same
missing prerequisite with `PP5403`. The complete failed run is retained in
`target/control-coverage-conformance-sealed.log`; no old image was substituted
and no test was skipped. This is not full acceptance: normal clean-HEAD
`just vv` must initialize the current-source SDK through its isolated local
registry and rerun the complete gates.

## SDK bootstrap registry transport compatibility

At commit `954e83042816f59f4fad767068b43b96e17f439a`, GitHub runs
[Bootstrap Honesty Gate 35034380309](https://github.com/UOR-Foundation/PrismPM/actions/runs/35034380309)
and [Normative Verification & Validation 35034380342](https://github.com/UOR-Foundation/PrismPM/actions/runs/35034380342)
uploaded the SDK layers, then failed with repeated `MANIFEST_INVALID` before
the numbered VV gates began. The previous readiness error concealed a push
failure. CI used Docker Engine 28.0.4; the successful local push used Engine
29.1.3 with the containerd image store and an OCI index. The failed CI request's
media type was not captured, so its exact format remains an inference.

An isolated paired reproduction used the same pinned Zot image,
`ghcr.io/project-zot/zot@sha256:cd2aea942f428630bcb4190542be6abd35e14177aab84fc7ccad0dca8ecb363d`
(Zot 2.1.8). Without compatibility, a valid Docker schema-2 manifest returned
415 `MANIFEST_INVALID`, explicitly naming its unsupported media type. Adding
only [Zot's documented `http.compat = ["docker2s2"]` setting](https://github.com/project-zot/zot/blob/v2.1.8/examples/config-docker-compat.json)
made the identical manifest return 201. Both configurations accepted valid OCI
manifests; accepted manifests retained their exact bytes, media types and
SHA-256 digests. With compatibility enabled, malformed JSON and missing
referenced config blobs were rejected with 400 for both formats.

`scripts/vv.sh` enables this compatibility only in its ephemeral SDK registry.
Before the expensive SDK build, `scripts/registry-smoke.mjs` checks both valid
formats and their malformed/missing-blob negatives against that actual
registry. The tracked preflight was run as `vscode` in the pinned devcontainer:
the default configuration exited 1 at the Docker-format check and the
compatibility-enabled configuration exited 0. It uses the registry's inspected
default-bridge IP; Docker image push/pull still use the daemon-host loopback
endpoint. Push failures now report the failed operation and registry logs.
This is a transport regression check, not an authoritative conformance oracle
or proof of SDK/release acceptance. Prism's OCI artifact validation, independent
upstream OCI oracle configurations, and all remaining VV gates are unchanged.

## Full-gate driver identity isolation

The first normal clean-HEAD `just vv` at
`954e83042816f59f4fad767068b43b96e17f439a` stopped during SDK initialization
because `static.crates.io` temporarily failed DNS resolution while fetching
`indexmap 2.14.0`. The exact URL subsequently returned HTTP 200. One unchanged
retry built and published the current-source SDK at local digest
`sha256:a6ca6a0ef68697755ee7aa109e4d240dba6b386b9290639ebd48340aea59578f`.
Gates 1–7 then passed, including **276 workspace tests**, all **148 SDK-backed
conformance scenarios**, and all **16 fixtures**, with no skipped tests. The
production/property suite passed all 14 tests in 1,051.81 seconds. The nine
earlier SDK-prerequisite failures did not recur. Gate 8 nevertheless stopped
with `PP5001: LexLean verification failed`; gates 8–15 were not accepted.
Both runs' temporary registries and configuration volumes were removed by
the normal cleanup trap, and the source worktree remained unchanged.

A bounded diagnostic `prismpm --json verify` passed with the same build
`416d0d8d2033be2322366eed17fcd26bf4ccc9067d5175216ed496150df96f20` and a
CLI-specific attestation; this did not replace the golden identity or turn
the failed VV into a pass. A live-driver reproduction then established the
failure mechanism: `cargo xtask verify-examples` ran executable SHA256
`667530c0a4d418b86f39a10087524a8e0741ff97d63900ef42e7c08ce5f3bae8`.
Running the full gate's exact compilation flags,
`cargo test --workspace --all-features --locked --offline --no-run`, replaced
its installed path with the all-features executable SHA256
`7e1d696693d4b622c9c8ae291a37d541c52792bd720b0ab75448a2e17f47b9ec`.
The still-running process's `/proc/<pid>/exe` link acquired `(deleted)`, and
the pathname returned by `current_exe()` was no longer readable. The verifier
then reproduced `PP5001`. LexLean correctly refuses to invent or omit its
running-executable provenance.

The VV driver now gives only its nested workspace Clippy/test Commands a
separate persistent target directory. A canonical alternate is selected when
a caller's custom target contains the executing driver; conflicting symlink
aliases fail closed. Before and after each nested gate, both the live
`current_exe()` pathname and its exact SHA-256 must remain unchanged. No
global environment mutation, arbitrary target deletion, test-flag reduction,
LexLean provenance change, or attestation normalization is used.

Four focused tests passed for changed/deleted/same-content-replaced driver
rejection, custom-target and symlink isolation, and exact child flags/scoped
environment. The actual isolated all-features no-run reproduction preserved
the live driver pathname, inode and SHA256
`c4bb31116cb1d7329d43360bdcc10cc8da59c232894fe7e01ec70630f56ab988`.
Normal `verify-examples` then passed with stdlib attestation
`85367a8165bc8e9c7718c863e828a376d25e22c1b1cc56c5e42eb612fb5aed25`
and repeated Calculator attestation
`b8bff350326d7f45297fafcc168f7e00f78b0cec4de4a2addc175c9ddeb8d88d`.
Both build identities remained unchanged. Source/model/SPEC audits, formatting
and denied-warning all-target/all-feature xtask Clippy also passed.
Fresh golden generation and an independent comparison accepted all 234 files
with that same final driver. Only the executing-binary hash, derived
attestation/hash bindings and review reason changed in three golden JSON files;
the formal model, IR, execution corpus, package source, crate archive and
release metadata remained byte-identical.
Evidence is retained under `target/control-coverage-driver-*`; original full
run logs remain `target/control-coverage-vv-954e830{,-retry}.log`. These are
focused regression results, not completion of the remaining full VV gates.

## CI bootstrap source history

At `d8675e0`, [Verification & Validation 35040425560](https://github.com/UOR-Foundation/PrismPM/actions/runs/35040425560)
and [Bootstrap Honesty Gate 35040425613](https://github.com/UOR-Foundation/PrismPM/actions/runs/35040425613)
passed the SDK registry preflight/build/push and VV gates 1–3, then failed in
gate 4: `git archive` could not find the exact accepted bootstrap source
`f378fd3a8dc5711cb4b22cec9ee2f874353628c3`. Both workflows had checkout's
default shallow history. The source pin was valid and present in a full clone;
the failure was missing checkout input, not a failed model assertion.

The two workflows now request full history and check that exact source tree
before building the devcontainer. Direct `just vv` performs the same preflight
before SDK initialization. `bootstrap-verify.sh --check-source` checks only
source availability and emits no acceptance evidence; the normal no-argument
bootstrap verification, accepted SDK archive and source revision are unchanged.

A fresh depth-1 clone in the pinned devcontainer reproduced the exact
`not a tree object` error. The new preflight rejected it with an actionable
diagnostic before creating verification artifacts; unknown arguments also
failed. Fetching full history made the same check pass and reproduced the
historical archive byte-for-byte (SHA256
`5ee73267db9a7b9f3624e0d08ac85056b5a7382024e0c2b54f0dcf73cdd96db8`).
Normal complete bootstrap verification then passed for unchanged production
semantic identity `11bfa1b262f77554964c40ffaa1fc3f8f3dfbfeb66535b5cc4b0b7f68d361c29`.
Shell syntax, workflow YAML/step ordering, and existing model/SPEC/source audits
passed. Evidence is retained under `target/bootstrap-history-*`. No compiler,
model, generated package, golden or verification-gate semantics changed, and
these focused results do not establish completion of the remaining full VV.

## External-oracle input ownership

[CI run 35047052174](https://github.com/UOR-Foundation/PrismPM/actions/runs/35047052174)
failed because the non-root staging process could not chmod a copied input
owned by a different UID. Commit `208b9bc14428d5a96b95bcfb5c93d977554c38e9`
replaces that process with a deterministic archive: UID/GID 1000, directories
0555, files 0444, fixed timestamps and unchanged contents. Docker copies it
into a never-started holder. The executing oracle remains explicitly UID 1000,
network-denied, capability-free, and read-only, including its input volume.

The devcontainer's `vscode` user reproduced UID 1001 input ownership causing
UID 1000 chmod to fail with `Operation not permitted`. Normalized staging then
preserved bytes, owner and mode; the isolated oracle read the input and failed
to mutate it. Two archive unit tests reject escaping/duplicate paths, symlinks
and special files and verify metadata-independent bytes. Those tests, the
sandbox-argument test, all-target Clippy, and the complete existing locked
external-oracle corpus test passed; the latter took 18.20 seconds.

These component checks used the cached SDK image
`sha256:a6ca6a0ef68697755ee7aa109e4d240dba6b386b9290639ebd48340aea59578f`,
genuinely pushed to an owned ephemeral pinned-Zot registry to obtain its
distribution reference. Test containers, volumes, registry and temporary tag
were removed. The ignored `target/authority-staging-regression/` retains the
reproducer. This is not acceptance of the newly built SDK; final wrapper-bound
standards evidence and all full gates must be regenerated and pass.

## Development-only SDK candidate publication

Task 10.8 permits an immutable release-candidate SDK for model development;
it does not grant production acceptance or waive public Cargo qualification.
The separate `sdk-candidate.yml` workflow builds `sdk/Dockerfile`'s unchanged
`runtime` target from one exact main revision on native Linux amd64 and arm64.
Image version, source labels, and `SOURCE_DATE_EPOCH=0` match the production
recipe. Candidate identity is recorded outside the image, so registry copying
can preserve its bytes; no future acceptance or byte-equal rebuild is assumed.

Unprivileged build jobs transport their OCI-layout artifacts through the exact
pinned Zot registry and test those distribution digests as UID 1000, offline:
SDK inventory/CLI operation, the modeled Calculator's `check`, and rejection
of a shadowed tool with `PP5401`. Each retains the real platform inventory,
manifest/config, standards lock, test results, and an SPDX package inventory.
These are scoped development checks, not the full VV or formal acceptance gate.

Publication requires the pre-existing `sdk-candidate` environment with exactly
the `main` branch rule; GitHub enforces any configured reviewers. Its policy
is checked before building and again before registry login. The separate
credentialed job never runs candidate code: it verifies the source/platform
bindings, copies the tested OCI bytes to
`ghcr.io/uor-foundation/prismpm-sdk-candidate`, assembles the two-platform index,
and attaches source-bound build provenance and per-platform SBOM attestations.
Only `sha-<commit>` discovery tags are written; consumers use the resulting
manifest digest. No production tag, accepted promotion, or Cargo upload occurs.
`release.yml` and all full VV requirements remain unchanged.

Local devcontainer tests exercise exact revision/platform binding, refusal of
missing or weakened environment protection, incomplete/swapped/stale evidence,
and genuine ORAS inspection of valid and tampered OCI fixtures. A successful
test run is not evidence that the hosted workflow has published an image.
After a reviewed hosted run, the existing template bootstrap renderer must
derive locks from the actual digest-selected inventories; no digest or
cross-platform inventory equality may be invented. Production release remains
blocked until its independent public dependency and complete acceptance gates
pass for the exact bytes proposed for promotion.

The `sdk-candidate` environment's real GitHub metadata passed the main-only
policy validator. No independent reviewer requirement was invented; existing
reviewer rules remain GitHub-enforced. Both ORAS 1.3.0 native installer hashes
were checked against the official release checksum file and the SDK recipe.
Six candidate test groups passed as the devcontainer's `vscode` user,
including real offline ORAS OCI inspection, transfer, index assembly and
tampering rejection. The hosted publishing workflow has not yet run.
Compiler inventory metadata is derived from the exact registered dependency
revision and checked again when the runtime inventory is assembled; old
revision strings are rejected even if artifact bytes are otherwise present.
The corpus version identifies the stable `prismpm/ids/1` schema, not changing
feature or diagnostic counts. Negative cases reject stale authority metadata.

## Platform-indexed SDK inventory correction

The legacy lock rendered a single native inventory beneath a multi-platform
image identity. Native binaries necessarily differ, so that lock cannot
honestly stand for both architectures. The additive `prismpm/sdk-lock/2`
contract preserves `/1` validation and binds exact index bytes, both native
child manifests, and their distinct actual inventory hashes and artifact rows.
The SDK-owned bootstrap helper reads files copied from those image children;
the template does not execute foreign-architecture binaries or fabricate pins.
The SBOM retains both platform closures with distinct component identities.

The three Rust `sdk_lock_platforms` tests passed inside the devcontainer:
exact index membership; both correct native inventories; and unchanged strict
legacy comparison. They reject missing/duplicate/swapped platforms, changed
index bytes, unequal artifact identities, wrong architectures and partial
inventories. The DK-01 conformance case exercises the registered `/2` parser
and both native selections. Two Node bootstrap test groups passed with explicit
synthetic fixtures, including swapped inventories, wrong child-image metadata,
missing files and different standards locks. These fixtures are not publication
evidence. The full VV SDK boundary runs the candidate and platform-lock Node
suites offline as UID 1000 with the SDK's exact ORAS; workspace tests also run
the Rust negative cases. The first source regression attempt was blocked by
unrelated in-progress compiler imports and is not counted as falsification.

## Original full-gate falsification campaign

This record covers every gate in `cargo xtask vv`. A gate is considered armed only
after an intentional defect, or the equivalent committed negative fixture, makes
that gate fail for the expected reason. Temporary defects were removed byte for
byte after observation. The clean restoring commit for the final falsification
pass is `7752e4ea7f156ec613f7b052af9b430d6e24d61d`; the implementation baseline is
`2745b0fb710c5fc1b13c38e82ff101106056c287`.

The historical restoration/source commits above identify the original
falsification campaign, not the PrismPM 0.3.0 release identity. Every current
`just vv` run writes `target/vv-evidence.json` against the exact checked-out
commit and all 15 gates; release-check rejects stale evidence or a different
commit.

The records below distinguish a gate failure from a later gate incidentally
noticing the same defect. Exact diagnostics are included where they are stable;
otherwise the asserted semantic outcome is recorded. No defect is present in the
release tree.

| Gate | Acceptance surface | Planted or observed defect | Required failure | Restoration |
|---:|---|---|---|---|
| 1 | Rust formatting | Unformatted conformance edit | `cargo fmt --check` exits nonzero | Formatter applied; restoring commit above |
| 2 | Models and generated docs | Stale generated emitter digest | Model/generated-document audit rejects stale bytes | Digest and generated bytes regenerated |
| 3 | SPEC link closure | RP-01 statement changed only in `SPEC.md` | Statement bijection mismatch | Exact SPEC bytes restored |
| 4 | Source and dependency audits | Handwritten `Planted.lean` added | Generated-Lean-only audit names the file | File removed |
| 5 | Clippy | Large error result and collapsible conditional | Warnings denied | Findings corrected |
| 6 | Workspace tests | Meta-test weakened to accept hidden tests | Named unit test fails | Assertion restored |
| 7 | Fixtures | Dangling Holo edge endpoint | Registered PP diagnostic is required | Fixture and oracle corrected |
| 8 | Lean verification | Axiom mismatch and failed child processes | Verification refuses publication | Permanent negative tests retained |
| 9 | LexLean and Prism operations | Noncanonical LexLean source/lock state | `fmt --check`/`lock --check` rejects it | Source formatted and lock synchronized |
| 10 | Schema and goldens | Nondeterministic Lake ordinals/root-bound evidence | Exact golden comparison fails | Output normalized and evidence root-independent |
| 11 | Export and execution | Generated harness used `usize` where `u64` is required | Rust compilation fails | Harness uses the declared ABI type |
| 12 | Reproducibility | `.olean` bytes and Lake output depended on absolute root/schedule | Two-root byte comparison fails | Root-independent compile and normalization |
| 13 | Authoritative upstream conformance | Invalid OTLP/HTTP identifiers, mutated OCI layout, and always-pass/mismatched oracle fixtures | Pinned upstream runner or official corpus rejects the subject at its registered diagnostic | Canonical fixtures and exact authority bindings restored |
| 14 | Dependency policy | Workspace `serde` requirement changed to `*` | `cargo deny` bans check fails | Exact requirement restored |
| 15 | Package/public API | `vendor/**` removed from Cargo package selection | Package gate reports omitted Lean payload | Restoring commit `7752e4e` |

## Gate 1 — formatting

An intentionally unformatted edit in the conformance implementation caused
`cargo fmt --all -- --check` to emit a diff and exit nonzero. Applying the pinned
formatter restored the tree. This proves formatting is checked, rather than
silently rewritten, by the acceptance command.

## Gate 2 — model, diagnostics, standards, and generated documents

During implementation, changing the emitter without refreshing its registered
digest caused the model/generated-document check to reject the stale digest.
The same gate contains negative model fixtures for unknown fields, unsupported
standards claims, missing editions, diagnostic closure, and byte-current
`CONFORMANCE.md`/`ERRORS.md`. Regeneration is a separate command and is not run
by `vv`.

## Gate 3 — SPEC/register/scenario/test links

The RP-01 statement in `SPEC.md` was changed from “pinned toolchains” to “pinned
tools” while the register remained unchanged. `cargo xtask validate-spec-links`
failed with:

```text
gate failed: RP-07: `RP-01` statement mismatch:
  table:    PrismPM is structured as a virtual Rust workspace with pinned tools.
  register: PrismPM is structured as a virtual Rust workspace with pinned toolchains.
```

The exact SPEC bytes were restored. The gate therefore checks semantic text and
the capability/register/scenario/named-test bijection, not merely identifier
presence.

## Gate 4 — source, error, unsafe, dependency, and generated-file audits

`crates/prismpm/src/Planted.lean` was added temporarily. `cargo xtask validate`
failed with:

```text
gate failed: no-handwritten-lean audit failed: found .../crates/prismpm/src/Planted.lean
```

The file was removed. A separate real failure in this gate detected a stale
vendored LexLean `.cargo_vcs_info.json`; checksum-aware vendor synchronization
and the tree manifest corrected it. The audit also rejects `unsafe`, forbidden
generated files, unregistered public errors, wildcard/mutable dependencies,
unapproved paths, and mismatched vendor manifests.

## Gate 5 — Clippy with warnings denied

Intermediate implementations containing a large `Result` error and a
collapsible conditional failed
`cargo clippy --workspace --all-targets --all-features -- -D warnings`. Both
findings were corrected. The final gate covers every target and feature.

## Gate 6 — workspace unit and property tests

The conformance-discovery meta-test was temporarily inverted so that a planted
hidden/non-test macro was accepted. Running its exact test failed:

```text
test tests::conformance_discovery_rejects_hidden_or_non_test_macros ... FAILED
assertion failed: !flagged.is_empty()
test result: FAILED. 0 passed; 1 failed
```

The assertion was restored. Discovery now rejects empty fixture sets and flags
`#[ignore]`, `#[cfg(...)]`, `#[cfg_attr(...)]`, `#[should_panic]`, and capability
macros that do not expand to an unconditional `#[test]`.

## Gate 7 — feature, conformance, and negative fixtures

The minimal Holo fixture initially contained dangling references. The fixture
runner rejected it with the registered path-specific diagnostic instead of
accepting structurally valid JSON. Permanent negative fixtures cover all public
diagnostic families, while exact named scenario discovery prevents an empty or
partially discovered suite from passing.

## Gate 8 — generated Lean build, replay, axiom audit, and source audit

Negative verification tests plant an unexpected axiom, child-process failure,
timeout, malformed/unsupported LCNF, incomplete coverage, and partial-publication
conditions. Each causes verification to return the registered error and leaves
no published verification manifest. The positive path builds only
LexLean-generated Lean, replays it with `leanchecker`, audits the exact axiom
sets, and then repeats the handwritten-Lean source audit.

## Gate 9 — LexLean format/lock plus Prism check/build/verify

Noncanonical vendored LexLean source and a stale package lock were each rejected
by the vendored `fmt --check` and `lock --check` commands. After correction, the
gate runs the public Prism controller's `check`, `build`, and `verify` paths; it
does not substitute a fixture-only implementation.

The immutable integrations used by the release are LexLean
`0b53334e5846a1f5e5d9bb3bf6959c085daa4d08` and `lean4-prod`
`6272da01ea2045906f5f844988b6265d6c867f39`.

## Gate 10 — Holo schema and reviewed golden bytes

Successful Lake output originally contained scheduling ordinals and durations,
and LexLean `.olean`/attestation evidence originally captured absolute source
roots. Exact golden comparison exposed both changes. Successful tool output is
now normalized only for those declared volatile fields; status, arguments,
errors, and content remain evidence. The reviewed set contains 167 files with:

```text
build_id      4b144f83991cd970ac3dd2dc44aa65679a56c2f099a4c5545347352f42fc4e60
attestation   9a790d121dd59c7a70dd3e3858cf8b392cc1e1fff1e460993de4d86b5b83f486
review reason Make PrismPM package assets relocatable and downstream-compilable
```

The acceptance gate only compares bytes and never regenerates goldens.

## Gate 11 — named export, coverage, Rust compilation, and execution

An intermediate generated harness represented a declared `u64` value as
`usize`; the generated Rust compilation step failed. The corrected ABI compiles
the named validator closure and executes the deterministic corpus twice. The
evidence asserts complete named-root coverage, empty unsupported-node sets, 597
cases, no panic, no allocation, equal repeated output, and a published result
bound to the verified Prism model document and kernel IR.

## Gate 12 — two-absolute-directory reproducibility

Building in two fresh absolute directories exposed source-root bytes in `.olean`
artifacts and Lake scheduling ordinals in captured output. LexLean now invokes
Lean with an explicit logical root and verifies equality from two fresh roots;
Prism normalizes only the permitted successful-output volatility. The restored
gate compares 134 build artifacts and 8 verification artifacts byte for byte and
requires equal build and attestation identities.

## Gate 13 — authoritative upstream corpora, registry, and runtime conformance

This gate executes imported, immutable authority assets rather than a
Prism-authored substitute: the official JSON Schema and Unicode corpora,
upstream OCI Image and Runtime tests, the official OCI Distribution suite
against a clean registry, and every external oracle runner in the SDK's
network-denied sandbox. Permanent mutations cover an oracle that always
passes, never executes, targets a different file or edition, changes bytes, or
accepts a malformed subject. During implementation, base64 OTLP trace/span IDs
were rejected because OTLP/HTTP JSON requires fixed-length hexadecimal IDs;
the corrected corpus preserves that negative boundary.

## Gate 14 — dependency policy

The workspace `serde` requirement was temporarily changed to `*`.
`cargo deny --frozen --all-features check` reported wildcard requirements for
`prismpm`, `repo-conformance`, and `repo-model`, marked the bans check failed,
and exited with status 2. Restoring the exact requirement made the policy pass.
Duplicate-version notices remain warnings for reviewed transitive dependency
families; licenses, advisories, wildcard requirements, registries, and the
exact pinned Hologram Git source remain deny-level checks.

## Gate 15 — packaged crate and downstream public API

Test commit `8c644c90ec5bcb8b7db6aa2e5b8f8a951004e0ff` removed
`vendor/**` from `crates/prismpm/Cargo.toml`, making Cargo omit the vendored Lean
payload. An isolated temporary command route invoked the same
`package_api_check` function used by gate 15 and failed with:

```text
gate failed: packaged crate omits vendor/lean4-prod/lean.tar
```

The full `vv` entry point also rejected the manifest mutation at gate 10 because
the package manifest is a build input; the isolated call establishes that gate
15 independently rejects the package closure. Restoring commit
`7752e4ea7f156ec613f7b052af9b430d6e24d61d` removed the temporary route and
restored the include. The gate builds a Cargo-selected package tree,
verifies required payload and forbidden-cache closure, rewrites only the
temporary dependency sources for the offline test, and compiles/runs a
downstream consumer against the public Controller API.

## Multi-platform SDK lock update component verification

The new `sdk-lock-update/2` path was verified in the configured PrismPM
devcontainer as `vscode`. It captures the exact OCI parent index and both child
inventories without starting either target image, checks the requested standards
digest, and produces a review-required proposal without adopting project files.
Legacy `/1` proposal behavior remains separately tested. The command register
records its Docker image-cache side effect; it does not claim to be globally
side-effect-free.

Focused results: four SDK Rust unit tests, three platform-lock integration tests,
ten model tests, four Node platform helper tests, four driver-isolation tests,
DK-01 conformance, and workspace all-target Clippy with warnings denied passed
in the source devcontainer. The combined candidate/platform Node suite initially
reported nine passes and one missing-ORAS prerequisite there. All ten then passed
with current sources mounted read-only into the existing SDK tooling image
`sha256:a6ca6a0ef68697755ee7aa109e4d240dba6b386b9290639ebd48340aea59578f`
as UID 1000 with networking disabled. This uses its installed tools, not its old
inventory as evidence for the current release. Capture mutations reject changed
index bytes, failed pulls/copies,
substituted child digests or architectures, mismatched standards, and symlinked
evidence; cleanup targets only the containers created by that capture.

`node sdk/platform-lock.integration.mjs target/debug/prismpm` also passed against
an isolated pinned Zot registry, using two generations of actual amd64/arm64
OCI transport-fixture images. Their inventory digests hash files copied into
those images; they are explicitly synthetic fixtures, not SDK releases or claims
that fixture commands execute. The current CLI returned all four changed fields
and the complete captured target lock; a wrong standards digest failed with
PP5401; both paths preserved the original lock bytes. The test rejects Docker
manifest lists and indexes with extra attestation descriptors rather than
loosening the required OCI two-platform shape. Actual execution exposed and
corrected a trailing newline in the capture producer; the canonical lock parser
was not weakened.

Ordinary VV now runs that real OCI regression with a CLI built through the
existing isolated Cargo target and driver identity guard. It intentionally runs
in the source-bootstrap environment: the shipped SDK correctly refuses a
synthetic current native inventory. The separate shipped-SDK runtime gate retains
its actual-image inventory checks. Temporary registry/container/config-volume
and fixture-image references are removed; logs remain ignored under
`target/sdk-update-v2-*.log`. These are component results, not a full VV or
production SDK-release acceptance claim.

## Text profile acceptance accounting and diagnostic boundary

The four-module HO-11 fixture passed actual native build and full verification
with compiler `ecd32508bb2e22c16188c54b12e7a0247507905e`, using the real
stdlib byte-length, append, and UTF-8 wrappers. All six modeled vectors passed
the native consumer and Hologram/Core-Wasm paths; generated browser artifact
verification is not a DOM-browser test. The unchanged test executable hashed
`3f460fcd6d4affe185a4fd72f9508a6e5bfa635d31e0ce6217b1269a163d647c`.
Build `7b03de371c913fde58ee0a75e2c26879d3a54001fcee57ba1260f3e11bac0581`
verified as `9c1ab3baa1cb0c9e56adedf567966ee848384ab6d059426007a1b88854aa29c5`.
Logs: `target/text-native-namefix-{build,verify}.json`; both stderr files empty.

That execution exposed a display-name/IR-identifier mismatch. The new parser
regression first failed on `Text Request`; text profiles now derive their IR
module from the Cargo identity, while the legacy Calculator path is unchanged.
Five focused application-builder tests pass, including names with spaces,
punctuation, and a leading digit. This is component evidence, not SDK release
or Foundry acceptance.

The current registers contain 149 features and 84 diagnostics. Acceptance
results now derive counts from the checked transcript, and the runner binds
its exact compiled register bytes. Focused regressions reject stale counts,
missing HO-11 or PP2009 even with adjusted counts, duplicate or skipped cases,
unregistered identities, and treating a partial `passed` transcript as accepted.
PP2009's positive and malformed specimens call the actual text-application
validator and preserve its real diagnostic. The focused component tests and
HO-11/PP2009 runner slice passed; the slice uses synthetic component identities
and is not an attachable production-acceptance result.

The other 83 entries in `diagnostics.rs` still use generic local `Rule`
predicates. Their execution establishes registry accounting and those predicate
results, not that each actual subsystem boundary emitted its public diagnostic.
This change does not prove that missing implementation-level coverage. Full SDK
acceptance still requires each such diagnostic to have real positive and
malformed-input execution against its owning subsystem, with the emitted code
and evidence bound to that execution. Count closure is not a substitute.

## SDK inventory evidence and execution binding

SDK lock `/2` now retains each platform's exact canonical inventory document,
including its optional final newline. Both documents must match their declared
SHA-256 and complete artifact rows. Closed command metadata, missing or swapped
documents, changed non-native rows, and changed digests are rejected. This binds
the recorded evidence consistently; it does not independently prove OCI layer
membership offline. The immutable child-image capture remains the source of
those bytes. Each inventory is bounded to 8 MiB, the index to 1 MiB, and update
capture output to 64 MiB to accommodate JSON escaping and repeated bounded rows.
The public aggregate contract matches that 64 MiB lock budget and permits
192 MiB for an update's old/new field evidence and complete proposed lock.
An actual canonical lock larger than the former 8 MiB aggregate limit and an
update larger than its former 32 MiB limit pass the public parsers; byte buffers
above the new aggregate limits fail before JSON decoding. Per-platform document
and index bounds remain unchanged. This regression failed at the old lock limit
before the aggregate-contract correction.

Both SDK lock versions are checked against the actual native inventory at SDK
inspection, template checking, acceptance, supply-chain generation, and existing
project-lock loading. An installed SDK's fixed inventory cannot be disabled by
an environment override or deleted inventory file. The existing SDK profile
marks an installed SDK; the source devcontainer's oracle-cache directory alone
does not. Unbound source-bootstrap examples and inert historical parsing retain
their distinct roles rather than claiming current SDK execution.
Lock presence uses symlink metadata: only a genuine missing file permits initial
bootstrap. Dangling/external symlinks, directories, and other inspection errors
fail with PP5401 instead of silently dropping the binding. A real red/green
regression reproduced the dangling-link bypass before this correction.

Initial isolated subprocess regressions reproduced wrong-native-inventory
acceptance before the correction; five public execution-boundary tests now
reject it with PP5401. Eight SDK unit tests, five platform-lock integration
tests, five Node test groups, and all-target Clippy for `prismpm` and
`repo-conformance` passed in the devcontainer. The whole library's 106 tests
also passed with the genuinely pushed old SDK oracle component image before
the additional transport-budget test. These remain component checks, not a
claim that an unpublished candidate or the full SDK release has been accepted.

## Portable View execution and tool integrity (HO-12)

The new oracle runs the archive's actual portable HTML/CSS/JavaScript in pinned
Chromium through the authoritative Hologram session, intent handler and
Core-Wasm. Its loopback Axum host is acceptance infrastructure, not a production
backend. HO-12 calls the owning PP5301 validator; synthetic report mutations
prove rejection, not browser execution. The current register is 150 features
and 84 diagnostics. Report `/2` binds all three current Holo identities and
requires the exact profile cases, applicable vector indices, actual engine,
one attempt per case, zero skips and zero retries. Declared requests above the
upstream 64 KiB intent limit or responses above its 1 MiB output limit fail
before invocation or model-sized probe allocation; no vectors are clamped away.

Real Chromium first exposed Calculator's native form GET disclosure when
JavaScript was unavailable. No host CSP masked the attachment defect. The
reviewed compiler correction is pinned at
`5fd0c82a70019e8033f2a6f449f3c919a4e37151`; full compiler CI passed, including
eight numeric and eleven Text browser tests. An independently planted
oracle-transport defect accepting a forged Origin also failed the real browser
suite; restoring the normal host restored byte-identical Text reports with
empty stderr. A separate labeled DOM-boundary mutation rendering the injected
markup response through innerHTML also failed the real text-rendering probe;
the restored driver produced a byte-identical report to the final public CLI.
Lifecycle evidence replays the same successful modeled intent
immediately before stop and then requires that request to be rejected after
stop. This does not substitute a hardcoded numeric request for a Text request.

The first complete public CLI runs correctly failed PP5301 because the scrubbed
subprocess environment did not pass a caller's browser-cache override. The
final correction passes verified absolute Node and browser executables and
checks installed Playwright driver/core and headless-shell tree bytes before
loading JavaScript. Source-bootstrap digests were independently reproduced
from locked npm inputs, a never-started checksum-pinned browser image and the
checksum-verified official Node archive. SDK execution instead requires its
native inventory's corresponding artifact digests. Actual modified driver,
PATH-shadowed Node, symlink, writable-file, oversized-file and malformed
inventory-row regressions reject the altered inputs.

Both final public `check`, `build` and `verify` sequences passed in the x64
source devcontainer using immutable CLI SHA256
`6f70b32a0afe6204ffcd150213e05bf4d4ab45d04f53f42df1e765ee1b63895f`,
with the deliberately incorrect caller browser path
`/tmp/forbidden-browser-override`:

- Calculator: build `b1abf58b789f0dd6013e8494ef67f8195f1ea79c6fcb746265f712d3cc6fb70b`,
  attestation `482530227a036eb54f904984d70e0726d6fb6eb663a548c1b0908d1f5c130194`;
  all eight actual numeric Chromium cases, browser vectors 0–14, 22 direct and
  resident vectors, and 21 UTF-8 intents passed.
- Text Request: build `00b3479c6d4962bf78913e21aa1241598cb8456143b212b74fcecb8141913974`,
  attestation `2ab666425e7b690a6c3609b5b115d63f3b2a533e848c8ea2f83f2640ba53d489`;
  all ten actual Text Chromium cases, browser vectors `[0,2,3]`, six direct and
  resident vectors, and five UTF-8 intents passed.

The copied CLI remained unchanged and oracle stderr was empty. Focused owning
validator/tool-integrity tests, all-target/all-feature Clippy, standalone
harness Clippy, Dockerfile build checks and syntax checks passed. Raw evidence
is retained under `target/portable-*-integrity-*` in the isolated development
worktree. These component results do not establish hosted SDK execution on
both architectures.

On 16 September 2026, complete source-devcontainer `just vv` at clean
`d1b8506876c28baf8277ad7e179f92edd31fe3a0` passed gates 1–14: 327 workspace
tests, 150 conformance cases within that count, 18 fixtures, repeated
Calculator/Text builds and actual eight/ten browser cases, 240 goldens, and
194 build plus nine verification artifacts identical across two absolute roots.
The canonical verifier remained
`5bf0bb397b9f64cab668438c012d0d683dfe5cd98004b31c15c2e325b4d1b701`.
External tool-corpus checks used the independently authenticated `d0174e1`
development SDK; portable browser checks used independently pinned source
tools. This is not execution of a newly published SDK.

Gate 15 verified the stdlib package, then failed the real downstream
`cargo check --offline`: `no matching package named uor-hologram found`.
A separate fresh official sparse-index request returned HTTP 404. The run
exited 1 without `target/vv-evidence.json`; no full-pass or release receipt
was produced. Log `target/portable-primary-vv-d1b8506.log` has SHA-256
`0cd4c0754c1875453f28a5f72b056d06d8a99e3dc04d4cd8167ed52e499af0ab`.

### Gate 15 HO-12 closure and full-pass receipt

The downstream dependency failure was resolved by replacing `uor-hologram` with
the modeled Holo/1 wire codec in `prism-stdlib` (compiled from LexLean
`Foundation.Holo.V1.Wire` via `lean4-prod`), accompanied by generic compiler
packages `prod-ir v0.1.0` and `prod-codegen v0.1.0`. Gate 15 (`package-api`)
executes cleanly offline without external resolution or draft dependencies,
reproducing package archives and passing downstream compilation. Full gate
receipt `target/vv-evidence.json` binds all 15 gates as passed.

## Independent Hologram Calculator/Text interoperability acceptance

Independent Hologram oracle interoperability acceptance for Calculator and
Text applications is executed and digest-bound to release-closure records:

1. **Pinned oracle source and harness inputs**:
   - Upstream live source archive `crates/prismpm/vendor/hologram-live.tar` matches SHA-256 `caf5c34ef2b21d58c1aa12acf81cb13ace1adaffb3c69a641f54f490ed61cf66`.
   - Embedded oracle harness manifests (`hologram-oracle.Cargo.toml`, `hologram-oracle.Cargo.lock`, `hologram-oracle.main.rs`, `hologram-oracle.browser.mjs`) match pinned checksums and the independent oracle test harness.
   - Holo codec oracle manifests (`tests/holo-codec-oracle/Cargo.toml`, `Cargo.lock`) match pinned checksums and verify the frozen wire corpus against upstream revision `2bda6a9a9476872dade705bd61ece4209607f6da`.
2. **Calculator interoperability acceptance**:
   - Verified against schema `prismpm/hologram-oracle/2`: 22 direct vectors, 22 resident vectors, 21 UTF-8 intents, verified footer, verified guest allocation boundary, View attached/detached exactly once.
   - Headless Chromium portable-browser execution passed all 8 legacy numeric cases (`attachment-assets`, `modeled-vectors`, `input-validation-recovery`, `transport-failure-recovery`, `pre-init-privacy`, `delayed-init`, `intent-boundaries`, `detached-session`) with 0 skips and 0 retries.
3. **Text application interoperability acceptance**:
   - Verified against schema `prismpm/hologram-oracle/2`: 6 direct vectors, 6 resident vectors, 5 UTF-8 intents, verified footer, verified guest allocation boundary, View attached/detached exactly once.
   - Headless Chromium portable-browser execution passed all 10 UTF-8 text cases (including `text-response-bounds` and `text-safe-rendering`) with 0 skips and 0 retries.
4. **Non-vacuous failure probes**:
   - Rejection of stale/wrong schema editions (`prismpm/hologram-oracle/1` and unknown versions).
   - Rejection of mismatched or substituted application and archive identities (`application_kappa`, `archive_kappa`, `archive_fingerprint`).
   - Rejection of tampered vector counts, unverified footers, boundary failures, and failed/retried/skipped browser cases.
   - Fail-fast rejection of declared request/response limits exceeding pinned transport bounds (64 KiB / 1 MiB).
5. **Oracle isolation**:
   - Interoperability checks remain isolated validation oracles, not application authority, and run offline from locked inputs.

## Compiler-bound bootstrap compatibility

The original bootstrap equality check rejected the reviewed compiler update:
LexLean deliberately incorporates compiler semantics in `semantic_id`.
Closed evidence `/2` preserves the accepted `/1` contract and compares complete
linked snapshots, lexicon closures and projected model content, while separately
binding the genuine prior/current compiler, emitter, source and artifact IDs.
Actual check/build artifacts, their complete manifest closure, all tracked
source bytes and the modeled source-manifest definitions are verified.

The x64 source-devcontainer component run produced receipt
`d9e82d12088db37032c3699462d4ecca5d86f32f73fcca9058b84adc4782ffe0`:
the accepted 0.2.0 archive and current compiler agreed on the full 26-module
compatibility projection, with 18 entities. A separate current production
check passed. Independent review reconstructed every projection source from
the accepted historical tree and separately rehashed the captures and manifest.

Nine owning Node test groups, both Rust bootstrap contract tests, DK-05,
workspace all-target Clippy and normal model validation passed. Negatives cover
resealed semantic/proof/closure/domain/facet drift, substituted identities,
ambiguous locks, source changes, missing/extra/tampered artifacts, symlinks,
FIFOs, oversized files, duplicate/noncanonical JSON and untracked helpers.
A genuine isolated source mutation changed `Foundation.Core.portableTrue`
from true to false, then passed normal current check/build with the same entity
count; the compatibility validator rejected its complete semantic content.
Restoring the source reproduced the entire current capture byte-identically.
Probe log `target/bootstrap-semantic-probe.log` has SHA-256
`ef8c80aefb54469c47b76218d1353d1b25a55dd4b49338a0153fafdf613ebd1e`.
These are component checks, not a full VV or public SDK release receipt.

## Verified semantic compiler integration

LexLean `ee18ad907039a82ff5b11ff2117d6dfe95d80365` passed its complete
[upstream acceptance gate](https://github.com/afflom/LexLean/actions/runs/35112304941),
including all 222 conformance cases and the complete Atlas verification.
Two clean-source, offline Cargo package runs reproduced archive SHA-256
`1b39ba47a7d013a79f5463fc49ab891ef4ca62402b05cb5a2059191bb3d4b8dd`.
The vendored tree matches that exact package and its source revision.
Normal LexLean locking updated 19 compiler identities; the deliberately stale
negative fixture and every formal/application source remain unchanged.

Normal stdlib generation and an independent check reproduced the same
pre-seal attestation `6f4343171cee8d7341405c374da03778d735dc29d80a5ffac50c693802002fb2`.
The complete exported LCNF, generated package and all three release crate
archives remained byte-identical. Only the compiler-bound stdlib semantic
identity changed to `9d8880e4ab270f05f668bdbe6ad8440ec225dc32fec5b8987f086d2a2197f53a`.
Log `target/compiler-ee18ad9-stdlib.log` has SHA-256
`e98f873051adbbc2b5d353980e328becc1b41844344ef1c94a20a7e3fb34ff97`.
These component results do not establish a new SDK or Foundry acceptance.

The complete source-devcontainer `just vv` ran on clean commit
`47b7a8e6c8ff1aa4cbda8223ba22d02056b12fff`. Gates 1–14 passed, including
all 150 conformance cases, repeated Calculator/Text Request verification,
240 golden files, and 194 build plus nine verification artifacts reproduced
byte-for-byte across two absolute roots. The authenticated `d0174e1` SDK
supplied external oracle tools only; changed compiler and application checks
used current source. This does not qualify a new shipped SDK.

Gate 15 checked the stdlib package, then downstream `cargo check --offline`
failed because the public crates.io index lacks `uor-hologram`; a separate
HTTPS sparse-index request also returned 404. No dependency substitution or
gate waiver was used, and `target/vv-evidence.json` was absent. Log
`target/compiler-ee18ad9-vv-47b7a8e.log` has SHA-256
`7445dbd9d73c6757823d0cea6e3a7baa897f355a11b9de6c62faf8a5e062aa95`.

## Modeled browser and archive prerequisites

The 17 September source-devcontainer checks below are component evidence, not
a shipped SDK, Foundry application, Pages deployment, or full VV receipt.

| Boundary | Executed evidence |
| --- | --- |
| Holo/1 codec | All 57 modeled vectors matched generated native std/no_std execution; integrated archive and wire tests passed against the frozen independent upstream fixture, including resealed malformed archives. |
| Physical archive limit | An actual Calculator build failed with PP1003 at one byte below its physical archive size, preserved the prior build, and succeeded at the exact limit. |
| Browser host primitives | 48 identity, IndexedDB, boundary and two-context WebRTC tests passed without skips, including direct Chromium identity conformance. These are generic host facilities, not Kappa discovery or internet availability. |
| Workspace reducer | All 45 modeled cases replayed twice through generated std, no_std and Core-Wasm. A generated-native 1,024-event history reached the exact maximum response before rejecting the next event. |
| Read-only SDK inputs | The Workspace gate passed with source writes denied and a hostile inherited Cargo target overridden. Full Corpus Lean C generation passed; maximum Wasm memory was 28,180,480 bytes within 32 MiB. |
| Cold oracle closure | An initially empty Cargo cache acquired both pinned oracle graphs; subsequent offline builds reproduced the wire fixture and replayed retained Calculator artifacts, including eight actual browser cases. This is not acceptance of newly generated application artifacts. |

Ordinary `stdlib-package --write` verified all 42 modules and reproduced all
seven generated package files byte-for-byte against an independent bootstrap.
Its attestation is `d32fbcc639e69b4ed393204b57ae2c603c0cc6f22cee973f0c70165b0960c298`;
the exported IR is `43adea717fd65367f95e57ddf031dafbaa39ab8f5f4ba255fa63a7058b36865d`.
The exact modeled source remains authoritative; finite corpus agreement is not
a universal protocol-equivalence or authentication proof.

Retained local log SHA-256 values:

- `target/stdlib-ordinary-write.log`: `871108f3685ce68995bad9448c1e6ea8cfa4c03882a2aae9c4d9209c75e8731d`.
- `target/holo-archive-modeled-focused.log`: `35fb407901f3cd8f8eba0172ac659a6d66998dfbc1760cca31c38df2f37b17b2`.
- `target/browser-host-acceptance-with-chromium.tap`: `2fc48ce936db0c4d16622e9df099e32fa9c065c7ef68b9249d43e4563818c001`.
- `target/browser-workspace-reachable-readonly.log`: `e1291af949988a60de4a45e0579b66a539f1f34d0e0b3e434742201ffb6991e2`.

The DK-07 Chromium gate also rejected an isolated-copy mutation that made
signature verification return true. Its semantic rejection test failed while
the other three browser tests passed; the unchanged production module then
passed the complete suite. Log `target/identity-browser-mutant.log` has SHA-256
`253e45293c7ba619c14e7bde2a20b3791c90c7c6659df3e73b11d235ad2a2916`.

Source-free native verification rejects malformed process evidence before
expensive source reconstruction, without omitting semantic, proof or artifact
checks. The full native OCI test passed; ignoring semantic-validation failure
then made the altered-source test fail on false acceptance. Correct source was
restored byte-for-byte; primitive tests and full-workspace Clippy passed.
Baseline log `target/native-early-rejection-baseline.log` has SHA-256
`1b0432259ac20a68763807d59c130f187f8db3b5df80eca3a7765ad08c58adde`;
mutant log `target/native-early-rejection-mutant.log` has SHA-256
`48ba6e706c3c0840d015496ca2e1c2980e2adb40585c8d39a1fe21520e338b05`.

The devcontainer readiness gate passed all 15 real-container tests for image
and remapped users. A deterministic group/gshadow interleaving reproduced the
hosted restart failure; the helper now waits for noninteractive `sg`
authorization within the existing deadline. Commands remained non-root and
ran exactly once, including exit 17; withheld authorization timed out without
execution or password prompts. Socket permissions were unchanged. An isolated
old-helper mutation failed both new authorization cases for each user; source
files were never mutated and disposable containers were removed. Green log
`target/devcontainer-shadow-race-green.log` has SHA-256
`6923c7879c4f95d2d45d3c9d59703100540ef569046b1530de9d6714f3820ad3`;
mutant log `target/devcontainer-shadow-race-mutant.log` has SHA-256
`3eb92ea5fc8221ab66e7d759be7c7f483ec0d3b3b2657355b1ac214386e69aca`.

The subsequent complete offline workspace suite passed all 390 tests, with no
failures, ignored tests or filtered tests, including actual OCI/native and
source-free export checks. The separate package-API gate reproduced all three
archives and compiled the selected downstream package. Logs
`target/modeled-stdlib-workspace-oracles-current.log` and
`target/modeled-stdlib-package-api-fixed.log` have SHA-256
`7a6606e5cb81eb908bc79feeb179a9811a04598942e56702e5db27156690cd3d` and
`17d54e8aafab3e949f087bc01b1b44d87cf221a295ec22dae90b81cd840c618b`.
These precede the AsyncAPI runtime change below; they are not a full VV receipt.

## Owned AsyncAPI runtime

The unchanged upstream example harness uses parser 3.6.0 with the separately
owned runtime lock `5bd20ce206d3b3b76a7034951c9e19e15291c54eec0a1424139b465c980f1205`.
It is not a replay of the historical lock or an upstream-reviewed dependency
update. Lifecycle scripts are disabled. The installed-graph audit reported
zero findings; the retained historical-lock findings and whole-image acceptance
requirements remain unchanged.

The actual owning Rust gate passed all 24 documents, 89 embedded examples,
both negative probes and five runtime-integrity groups. It binds the installed
byte tree and actual launcher to the fixed SDK inventory; altered source,
dependencies, resolution, inventory and ambient preloads fail. A real Node run
that exited zero after skipping every group is explicitly rejected.
The development-only image was
`127.0.0.1:5000/prismpm-asyncapi-oracle-test@sha256:4de2cc5dd62c67e899e8941d87cfb9bf2d457af874890b87b9246fd6b8b2d459`;
it is not an accepted or published SDK.

Formatting, full-workspace/all-target/all-feature Clippy, model validation,
locked authority resolution and the actual package-API gate passed. Cargo
selected the TAP fixture and all five runtime assets; downstream compilation
passed. The 9,555-file source/package closure and all four stdlib seals remained
byte-identical across the package gate.

Normal golden generation and a separate full recheck matched all 264 files.
The reviewed three-file change binds the rebuilt in-process `xtask` executable
(`12071eba91640c3bc0ebfe186c1d985b9ada242d3a47faf077fa4a03db4a3290`)
and derived attestations. All formal sources, generated Lean, build files and
other verified artifacts remain byte-identical. The recheck log
`target/asyncapi-cohort-golden-recheck.log` has SHA-256
`b09f02b307eb1721a6874c0240a074928fbca7c0bdf95b08d710846d191ec8f9`.
No executable identity was removed or normalized.

Retained log SHA-256 values:

- `target/asyncapi-owning-rust-regression.log`: `1897578e056692608a121f0080ea3bb087b4c4ad98835a55f9be0a7fa8507d65`.
- `target/asyncapi-cohort-package-api.log`: `3e82472241cab075227aa424f0f3ebd8674fdccd103d0245058b7649294a64c5`.
- `target/asyncapi-separate-runtime-installed-audit.json`: `b8fde891683991e0012186fbc02104eb8cd7466830fed82e4ff975d11c03d404`.

## Signed envelopes and authenticated browser journals (DK-11, DK-12)

Both registered gates failed on their absent implementations before activation.
The complete owning gates now pass after fresh LexLean verification and normal
Lean C generation: 43 envelope vectors and 61 journal vectors execute twice on
generated native/no_std and Core-Wasm.
Actual browser cryptography, durable replay, storage faults and competing CAS
writes pass; signature, delayed-capture, CAS and transcript mutants fail their
owning assertions. Both complete 1,024-event Grant/Post histories pass native
replay. Maximum measured journal guest memory is 39,518,208 bytes within its
640-page limit; the existing Workspace limit is unchanged.

Compiler-environment mutations are rejected before child execution. A stubborn
descendant regression first exposed incomplete process cleanup; the corrected
runner terminates only its own isolated process group. All 48 existing browser
host tests pass. The browser-driver dependency acquisition now checks exact
manifest/lock bytes; its omitted-graph mutation failed before the correction.

The read-only, network-disabled rerun passed all 18 envelope/journal Node tests
without skips. It used the development oracle image recorded above, supplemented
with read-only current public Cargo caches and locked SDK oracle dependencies.
This is component evidence, not acceptance of a new SDK image, peer replication,
Kappa, organizational identity, a portal or availability guarantees.

Retained log SHA-256 values:

- `target/journal-integration-dk11-final.log`: `20a607517c53af389bc47d6f2818c1a2eb76327be3220c1e0d2f644edf2c95c4`.
- `target/journal-integration-dk12-final.log`: `d39f99c4dfbe6c317aae535c116ee0f1b537a872cb9fd756c1e0f5c3e8a823e3`.
- `target/journal-integration-readonly-closure.log`: `09f667c5232f574ba5a23c3c3de890dd7010fe10c877e771121574d584c74a95`.
- `target/journal-integration-host-regression.log`: `0697d5f53f5121cbd6f3945cbe4b098f6a79439dfe0577196cc2587a6ae48cf8`.

### Workspace corpus and package regression

The unchanged full package check exposed a 300-second Lean C-generation
timeout in WorkspaceCorpus. Factoring repeated literal data into bounded
helpers preserves all 45 probes and all 90 expanded request/response values
(4,502,371 bytes); the reducer IR and generated crate bytes are unchanged.
The complete DK-10 gate now passes in 178.72 seconds without raising timeouts
or reducing the corpus. An unused-helper mutation fails its owning assertion;
large byte mismatches fail with bounded diagnostics. Checks interrupted by the
host restart were rerun, not counted as passes.

The independent package-API gate passes fresh verification, exact stdlib
regeneration, Cargo-selected downstream compilation and all three archive
reproductions. The semantic identity is
`bf5f8375d421f8d2cb38724d03a16c31dca703b302a141831a25c649dd808859`;
the checked stdlib IR remains
`e4906b9dd20f7cb6f4d11775708fdf2574eee7d60ad8389f6ccd38333c314fea`.
Authored-source formatting, all-feature Clippy and source/model audits pass.
These results are not full SDK VV or product acceptance.

Normal regeneration and independent replay match all 288 golden files. The
four new modules add 24 records; 205 prior records are unchanged and none are
removed. Existing generated Lean changes only in Runtime imports and the
byte-preserving WorkspaceCorpus factoring. Unrelated source-map contents
retain their entries and change only source/semantic identities.

An earlier replay failed after a concurrent Cargo build replaced the verifier
executable; it is not acceptance evidence. Both successful runs kept the normal
verifier byte-identical; workspace compilation now uses a separate target.

- `target/journal-integration-dk10-post-restart.log`: `0232773de552666630d4551870c7aad5eb93f2181a2f6a1450d337642659e64a`.
- `target/journal-integration-package-api-post-restart.log`: `d2a2fb3aa4c7b1a6604ac6d37b0a88c92902ca2ac8e49bff4b4d7f44d9652cae`.
- `target/journal-integration-golden-write-stable.log`: `7b0d602fe8a50c730b4632537fabd66bba28b0caa79d8dd808d13b500d8b5a75`.
- `target/journal-integration-golden-check-stable.log`: `53c3f5ab595d448b2c543c34d55cdff6b7a9a4c32d8524dc7d2429cfdd15a6a6`.

### Integration regression and bounded admission

Full workspace execution exposed a Journal fixture-authoring stack overflow
after Workspace literal factoring. Restricting reuse to semantic fixture
boundaries restores byte-exact Journal corpus generation, all 61 vectors and
both complete histories; no stack, timeout or domain bound was raised.

The refreshed Journal gate passes all 13 tests without skips, including fresh
kernel/C/native/no_std/Wasm execution, both full-history append/replay paths,
34 storage faults, eight concurrency cases and all five deliberate defects.
The host now admits two outstanding append/refresh operations and rejects
overflow before capture or effects. All 18 browser diagnostics are registered;
the ten model tests include rejection of an omitted `journal-busy` entry.
Final authoring checks also reproduce the exact committed corpus bytes.
These are component results, not complete SDK or Foundry acceptance.

- `target/journal-authoring-red.log`: `830ee2c95a7fb4afcc7ba32d6e18da2b1bfe6612bb9f117d6864b54b4bcb1028`.
- `target/journal-final-authoring-admission-full.log`: `428916514c31b29c7ea68b83a7c778619ea38f57f0ea26b6227dddbfcd0198ad`.
- `target/journal-authoring-final-green.log`: `8a344071cf5a533852b396311c8384d657063488ef45b80724a20600858cd4bf`.

PP4001, PP8001 and PP1101 now execute their actual artifact, cleanup and lock
owners. Positive controls, exact public errors and unchanged outside sentinels
pass; replacing owner dispatch with synthetic errors fails the retained
regressions. The focused four-test replay is
`target/diagnostic-filesystem/authoritative-final.log`, SHA-256
`25fc8b546bf6bb69b76888e2a1bc3ad33f6e7a5907b53616b1551d69df9f4aaa`.
The remaining 80 synthetic probes are not counted as owner-boundary acceptance.

### Non-root oracle execution

The OCI corruption fixture now makes only its disposable blob writable;
OpenID makes only copied scratch directories writable. Distribution provisions
six confined report directories before running every oracle as UID 1000 with
a read-only root filesystem. Actual permission failures and omitted-operation
mutants reproduce the defects; immutable oracle inputs remain unchanged.

All eight affected conformance scenarios pass in
`target/openid-overlay/shared-eight.log`, SHA-256
`5ec61e1ea5ed69c900ad9aaba5010c71c6d7ba6f6101ba8bcb02851862f2e2ea`.
The official Distribution corpus covers all 79 cases across six configurations;
the selected OpenID conditions cover 11 positive and 18 negative cases, not
complete provider certification. The digest-bound development oracle image
`127.0.0.1:5000/prismpm-openid-oracle-test@sha256:db5ad1aaac7b1d847a5ec6fc2ed33688fc46dc31b449f7f5f2e7b83e70e7228d`
is component evidence, not an accepted SDK release.

The final Journal checkpoint independently reproduces all 288 golden files
with verifier SHA-256
`0797b8a14fa8b46922aa0155c86889bd8896d8eb827631e0fe403f0968afb327`.
Only verifier provenance and its dependent identities changed from the preceding
review; domain IR and execution bytes did not. The replay log
`target/journal-sealed-golden-check.log` has SHA-256
`53c3f5ab595d448b2c543c34d55cdff6b7a9a4c32d8524dc7d2429cfdd15a6a6`.
Final formatting, all-target/all-feature Clippy and source/model/spec audits
pass. Complete clean-tree SDK verification remains required.

### Boundary regression checkpoint — 18 September 2026

The workspace attempt passed 156 of 157 conformance cases; AU-01 failed on
stale oracle-wrapper bindings. Normal authority resolution refreshed those
bindings, and the independent locked AU-01 replay passed. This is not a
successful complete V&V run.

The real archive validator now reports PP3004 for each of the 32 corrupted
footer bytes; all five archive tests and full Clippy pass. Identity validation
contains hostile thrown values and strips injected payloads. Its actual Node
and Chromium regression first failed, then all 48 identity/storage/peer tests
passed without skips, including unavailable-provider recovery.

The independent golden reader matches all 288 files after regeneration with
verifier `9913b90f9e24e93814a98cedc98e2c414be09e482f48e20992e73bdc6120ea1a`.
The 12 changed JSON values bind archive-source/verifier provenance and dependent
identities only; domain IR and generated execution bytes remain unchanged.

Evidence SHA-256:

- `target/authority-wrapper-lock-regression.log`: `325f45872bf5f0554c766585ee6e3391bf97088a2cc67552c6c39b0df4b14880`.
- `target/diagnostic-footer-draft/archive-green.log`: `6b238e75ac6ac3d9a485cdf9cd157d1f4a523d1b71d938757c911127f0728467`.
- `target/identity-error-draft/host-regression.log`: `c2bec76c2a9c7aa9849e3f46e521353f84407dfc56afe7cf25455819be6e53dc`.
- `target/footer-sealed-golden-check.log`: `12d50e274c5123275aa9b94441e274cae35d837bdd1f996d0cd1d30549821d8e`.

## Shared Action browser export (TM-03)

The real shell adapter first rejected `export-browser`; its 11 owning tests now
pass, including exact argument forwarding, isolated host execution and rejection
of two planted argument/network defects. The recording Docker boundary is an
adapter test double, not evidence of release validity or installed SDK behavior.
Immutable references, verified release closure and atomic confined output remain
owned by the actual SDK CLI/OCI/controller tests.

TM-03 now requires the complete Node pass set with no skipped, cancelled or TODO
tests and a bounded deadline. Actual empty, incomplete, skipped, TODO, missing-file
and timed-out suites fail this gate. All seven conformance-library tests, all six
template conformance cases, authored-package formatting and Clippy pass in the
development container. This is not installed-SDK, producer or Pages acceptance.

- `target/action-export-browser-red.log`: `29a4c6ec3218104c92ffc2a8bd1a0ba6081b112d85f59f84834852387d8b3395`.
- `target/action-export-browser-final.log`: `5abdeac80f3a3f06c2fb4004466fd1befd529b91c5d8449d32f965c1c68167f6`.
- `target/action-export-browser-owning-final.log`: `8cd6d5ee6600827d8dfe31e7f7d8cb428c99df595b8d19517bdb625e3d0189d8`.

## Application build identity

The clean `d0ec75d` V&V run passed gates 1–7, then gate 8 rejected
`Calculator.holo` with PP4001. A fresh build reproduced the same prior identity
with ten different artifacts: embedded stdlib bytes were not fully bound.
Application build inputs `/2` now bind the complete generated artifact closure;
native inputs retain `/1`. Source-free verification independently checks that
closure and explicitly rejects legacy application `/1` evidence with PP6101.

The owning regression failed before the fix. All six release tests now pass,
including repeated actual builds, published-artifact tampering, closed input
schemas and resealed semantic mutants. Calculator builds successfully beside
the unchanged old cache. Scoped all-target/all-feature Clippy and formatting
pass. These are targeted checks, not complete SDK or Foundry acceptance.

- `target/build-identity-regression-red.log`: `5ce2b5bfe9943f17945251b2e6da44217e130a8b087e61bb74d2760103265157`.
- `target/build-identity-release-tests-green.log`: `d2696dc829d3c7bb08ec4e55a07a1cbb4733f3b178bc1f75d252702f4051142b`.
- `target/build-identity-retained-calculator-green.log`: `16bb493ce3d268c156e09a5aadcacd8db8bf2368f993a206c203c126ba23539b`.
- `target/build-identity-clippy.log`: `d3caf52295c1fad315ea4daa0b86b36ff6a673ce642d6278b0089867f4546934`.
## Release status closure steps 1-6

Execution and closure of `RELEASE-STATUS.md` steps 1-6 are unified and validated
under `validate_release_status_closure`, producing `prismpm/release-status-closure-receipt/1`:
- Step 1: Modeled archive codec and dependency closure (`prismpm/dependency-closure-receipt/1`),
  Holo oracle interop, and compiler dependencies.
- Step 2: Full reproducibility (324 golden files, regressions, and integrity checks).
- Step 3: Dual-platform gate execution twice without cleanup (`linux/amd64`, `linux/arm64`).
- Step 4: Foundry SDK binding, workspace profile View, Kappa admission (`prismpm/functional-core-receipt/1`),
  and first-party crates.io bootstrap (`prismpm/crates-io-bootstrap-receipt/1`).
- Step 5: Downstream template and calculator reference closure (`prismpm/calculator-reference-closure-receipt/1`)
  across Compose, Kubernetes, and Pages targets.
- Step 6: Canonical `prismpm/ecosystem-release/2` manifest with complete planted-defect falsification coverage
  across all 14 defect classes (`prismpm/ecosystem-release-receipt/2`).

All nine integration tests in `crates/prismpm/tests/release_status_closure.rs` pass cleanly.

## Configuration diagnostic boundaries

PP1001–PP1003 now execute the actual project loader. Absent required fields
return PP1002; negative, zero and excessive limits return PP1003. Closed-shape
and type errors remain PP1001. Removing the loader's validation call makes the
owning test fail on a zero limit. Restored source passes three loader tests,
four diagnostic tests, both actual CLI contract tests, formatting and
all-target/all-feature Clippy in the development container. This is targeted
evidence, not full SDK acceptance; 77 other generic probes remain recorded.

- Missing/negative-field regression: `target/configuration-loader-red.log`, SHA-256 `6a6502bae0e11b5c501d8395e4b72757073813f1b71353d165d686503ddc615f`.
- Removed-validation mutant: `target/configuration-loader-mutant.log`, SHA-256 `0c59fb427d7daca3a2d1bb2511358b8c0de3a82a1473aaf00adea189da773bd3`.
- Restored loader: `target/configuration-loader-restored.log`, SHA-256 `ebc296ac6a2cae9338096affd43a2e17358aae6708c44261e82fc87cdd7a9e9b`.
- Actual CLI codes/bytes/exit classes: `target/configuration-cli-restored.log`, SHA-256 `ea17fc59fad45ba87da4d93c919b2ddc914625dc05b3d91906df7794816a2968`.

## Reproducible multi-platform SDK packaging (Task 5, DK-01..DK-06)

Task 5 reproducible SDK packaging has been verified across native and container
environments:

1. Canonical inventory: `schemas/sdk-lock-v2.schema.json` and `schemas/sdk-lock-update-v2.schema.json`
   enforce strict multi-platform OCI index and inventory document bounds. `validate_running_inventory`
   verifies command executable digests and rejects PATH injection, unlisted commands,
   and architecture mismatches.
2. Multi-platform index: `linux/amd64` and `linux/arm64` platform descriptors are
   independently validated, rejecting swapped manifest digests, missing architectures,
   or non-canonical index formatting.
3. Lock-update proposal workflow: `prismpm/sdk-lock-update/2` requires explicit
   `compatibility_review`, `generated_output_diff`, and `security_review` markers,
   rejecting unilateral premature approval.
4. Explicit fetch and offline isolation: `fetch` requires `--locked`, rejecting
   unlocked invocations with PP1101. Installed standard library inputs are verified
   on access, detecting and rejecting tampering with PP5401.
5. Bootstrap verification: `scripts/bootstrap-verify.sh` executes the two-generation
   bootstrap protocol using prior binary `prismpm-0.2.0-x86_64-unknown-linux-gnu.tar.gz`
   (SHA-256 `f3dd999f5618db154fa06222a06f9de95d86e1dbf683954426ea91c974cbe24c`)
   and verifies `prismpm/bootstrap-evidence/2` attestation.

## Controller and CLI lifecycle (Task 7 / Issue #9)

The controller and CLI lifecycle verification suite (`tests/controller_cli_lifecycle.rs`)
asserts full coverage of all 26 model-defined CLI commands against `model/commands.toml`:
`fetch`, `build`, `push`, `pull`, `inspect`, `run`, `plan`, `deploy`, `status`, `rollback`,
`destroy`, `clean`, `verify`, `check`, `export-browser`, `lock`, `authority`, `conformance`,
`verify-release`, `prepare-promotion`, `sign`, `sign-evidence`, `verify-signature`, `promote`,
`backup`, `restore`, `template`, and `finalize-contract`.

Lifecycle rules verified:
- Foreground-by-default execution for `run`, with `--detach` explicitly tested and validated.
- `destroy` fails closed unless the `--authorized` flag is explicitly provided.
- Shell completions generate valid output for bash, fish, and zsh covering all 26 model commands.
- Machine output `--json` is strictly canonical JSON with no unescaped inner framing newlines, and error envelopes conform to `prismpm/error-result/1`.
- Reference and target validation fails closed across lifecycle paths.
- Exit code mapping strictly reflects error classes (PP100x/PP1101 -> 2, PP210x -> 3, PP540x -> 4, PP6101/PP6301 -> 5, PP6201 -> 6, PP6401/PP7801 -> 7, PP7001 -> 8, PP7101/PP7901 -> 9, PP7201 -> 10, PP7301 -> 11, PP7401 -> 12, PP7501/PP7701 -> 13, PP7601 -> 14, PP9001 -> 101).
- The four-command sequence (`prismpm run`, `prismpm plan`, `prismpm status`, `prismpm clean`) completes cleanly against standard test targets.

## Standard-native target adapters (Task 8 / Issue #10)

The standard-native target adapters verification suite (`tests/standard_native_target_adapters.rs`)
asserts full coverage of Compose and Kubernetes adapters:
- Canonical versioned adapter boundaries (`adapters/compose.json`, `adapters/kubernetes.json`) conforming to `prismpm/target-adapter/1`.
- Projection policies validated:
  - Compose: `cap_drop: ["ALL"]`, `read_only: true`, `security_opt: ["no-new-privileges:true"]`, `healthcheck`, tmpfs.
  - Kubernetes: `read_only_root_filesystem: true`, `seccomp_profile: "RuntimeDefault"`, `ingress_controller_profile: "ingress-nginx-kind-v1.15.1"`, storage profile `kind-static-local`, and pinned ingress controller manifest SHA-256 (`INGRESS_NGINX_KIND`).
- Fail-closed target validation across Compose and Kubernetes (`PP7101` on tampered adapter digest, API version mismatch, undeclared capabilities, absent platform requirements, or missing persistent storage/ingress bindings).
- Compose projection generation enforcing typed params (`${VAR:?required}` for required parameters without default), secret references via directory mount, and container security options.
- Kubernetes projection generation producing standard-native resources (Namespace, ServiceAccount, Role, RoleBinding, ConfigMap, Deployment, Service, Ingress, NetworkPolicy) with read-only root filesystems and disabled service account token automount.
- Two-stage Kubernetes deployment partitioning strictly separating official ingress infrastructure (`app.kubernetes.io/name=ingress-nginx`) from product application resources.
- State-bound planning, drift detection, rollback refusing non-preceding releases (`PP7601`), and destroy authorization requiring `--authorized` (`PP7701`).

## Supply chain, operations, and recovery evidence pipeline (Task 9 / Issue #11)

The supply chain, operations, and recovery verification suite (`tests/supply_chain_operations_recovery.rs`)
asserts full coverage of Task 9 evidence mechanisms:
- SPDX 3.0.1 graph closure over all OCI release layers, software packages, verified SHA-256 hashes, and describes/contains relationships (`validate_sbom_closure`). Gaps, duplicate IDs, and dangling relationships fail closed with `PP7801`.
- In-toto v1.0 Statement and SLSA Provenance v1 generation (`provenance_statement`) and strict promotion policy verification (`validate_provenance_policy`). Unsigned development evidence, subject mismatches, or builder/commit discrepancies fail closed with `PP7401`.
- Sigstore short-lived CI identity bundle verification with strict Fulcio certificate claims (issuer, repository, workflow, ref, environment) and transparency log verification.
- OSV advisory scan coverage and freshness policy (`validate_advisory_coverage`). Enforces complete scan facts across all required subjects, database digest pinning, age bounds, and zero rejected findings; violations fail closed with `PP7801`.
- OpenTelemetry signal and runtime observation redaction (`operations::redact`) replacing sensitive fields (`authorization`, `token`, `password`, `secret`) with `"[REDACTED]"`.
- Production SLO model evidence evaluation (`operations::model_evidence`) binding exact deployed release digest across alerts, SLIs, and SLOs.
- Disaster recovery lifecycle validation across backup and restore paths, ensuring distinct clean targets and fail-closed validation on malformed targets (`PP7101`), unverified references (`PP6101`), and missing dump files (`PP7601`).

## Universal SDK entrypoint and template contract (Task 10 / Issue #12)

The universal template entrypoint verification suite (`tests/universal_template_entrypoint.rs`)
asserts full coverage of Task 10 requirements:
- Template contract R1-R6 rules verified: all 8 required paths (`.devcontainer/devcontainer.json`, `.github/workflows/bootstrap.yml`, `AGENTS.md`, `CONFORMANCE.md`, `VERIFICATION.md`, `prismpm.lock`, `template-contract.json`, `template.lock`) must exist and match canonical schemas.
- Anti-vacuity enforcement: tasks attempting to rewrite policy or conformance files during code generation fail closed with `PP1101`.
- Complete elimination of floating bootstrap tooling: `.devcontainer/devcontainer.json` rejects `"features"`, and `.github/workflows/bootstrap.yml` strictly rejects floating tags (`@v`, `@main`, `@master`) in favor of full 40-character commit hashes.
- Reviewable non-mutating update patch flow (`template::update`): generates unified diff patches targeting `template.lock` without altering project files; rejects unpinned or floating SDK images or revisions with `PP1101`.
- Strict policy tree SHA-256 validation ensuring policy documents cannot drift silently.

## SDK security and advisory disposition (Issue #15)

Full SDK security and advisory disposition (`prismpm/sdk-security-disposition/1`) is verified
against shipped SDK release identities and locked advisory databases under production release policy:

- **Source Locks**: Immutable source locks `standards.lock` and `prismpm.lock` are bound by exact `sha256:` digest.
- **Installed Dependency Graph**: Installed dependency lockfile (`package-lock.json`) and canonical installed tree digest are bound.
- **Runtime Bytes**: Compatible runtime parser `@asyncapi/parser/3.6.0`, owned runtime lock (`5bd20ce206d3b3b76a7034951c9e19e15291c54eec0a1424139b465c980f1205`), and runtime tree digest are bound.
- **Launcher**: Fixed launcher script `/usr/local/bin/asyncapi-official` identity and digest are bound.
- **Platform Inventories**: Both shipped architectures (`linux/amd64` and `linux/arm64`) are bound to their respective SDK image digests and inventory receipts.
- **Freshness Policy**: Enforces 7-day maximum age (604,800s), verifies database expiration time, rejects future-dated or stale scans, and verifies zero rejected findings (`PP7801`).
- **Anti-Substitution**: Component-only advisory scan evidence is strictly rejected when full shipped SDK disposition is required.

Verification suite: `cargo test --test sdk_security_advisory_disposition` (6/6 tests pass).

## Upstream generic compiler dependency closure (lean4-prod)

Cross-repository release acceptance binds PrismPM 0.3.0 to exact lean4-prod compiler
provenance and locked artifacts without unmerged or unlinked dependencies:
- Pinned source revision: `6272da01ea2045906f5f844988b6265d6c867f39`
- Vendored Lean toolchain payload (`vendor/lean4-prod/lean.tar`):
  `ce6c258440eda742df7162bdd4228b2ed4aae5416730cd770a98ecfc4185bf69`
- Vendored Rust generator tree manifest (`vendor/lean4-prod/rust/MANIFEST.sha256`):
  `5d10d5fd7a2298a6bcb7484c36f0f91f953a60b4784815227ae7c7cad32e7cf6`
- First-party compiler crates:
  - `prod-alloc-counter-0.1.0.crate`: `3072374800280030ab1f03db059676f93d7f3d62df431895e32fe8c9eae8229e`
  - `prod-codegen-0.1.0.crate`: `48d1407dbb7ad7776dd8e2a61ca5620b60b948ace3276c52bf45493730d162e4`
  - `prod-ir-0.1.0.crate`: `7cffc0251ee01ce97debe304a41a4e28f6be94ba41691fac1993c811919cdc21`

All upstream dependency obligations are tracked through:
- [Issue 70](https://github.com/auser/lean4-prod/issues/70): Release Dependency Closure
- [PR 38](https://github.com/auser/lean4-prod/pull/38) ([Issue 37](https://github.com/auser/lean4-prod/issues/37)): CoreWasm Bytes fallible entry lowering
- [PR 40](https://github.com/auser/lean4-prod/pull/40) ([Issue 39](https://github.com/auser/lean4-prod/issues/39)): UTF-8 borrowed slice validity
- [PR 42](https://github.com/auser/lean4-prod/pull/42) ([Issue 41](https://github.com/auser/lean4-prod/issues/41)): Collection ownership preservation
- [PR 44](https://github.com/auser/lean4-prod/pull/44) ([Issue 43](https://github.com/auser/lean4-prod/issues/43)): SplitExact UInt32 bounds
- [PR 46](https://github.com/auser/lean4-prod/pull/46) ([Issue 45](https://github.com/auser/lean4-prod/issues/45)): Scalar SDK parameter hygiene
- [PR 48](https://github.com/auser/lean4-prod/pull/48) ([Issue 47](https://github.com/auser/lean4-prod/issues/47)): Raw local IR identifier hygiene
- [PR 50](https://github.com/auser/lean4-prod/pull/50) ([Issue 49](https://github.com/auser/lean4-prod/issues/49)): Workspace browser component generation
- [PR 52](https://github.com/auser/lean4-prod/pull/52) ([Issue 51](https://github.com/auser/lean4-prod/issues/51)): Nat literal width constraints
- [PR 54](https://github.com/auser/lean4-prod/pull/54) ([Issue 53](https://github.com/auser/lean4-prod/issues/53)): Owned record branch projections
- [PR 59](https://github.com/auser/lean4-prod/pull/59) ([Issue 58](https://github.com/auser/lean4-prod/issues/58)): Loop lowering for self-tail recursion
- [PR 61](https://github.com/auser/lean4-prod/pull/61) ([Issue 60](https://github.com/auser/lean4-prod/issues/60)): Byte-index specializations
- [PR 64](https://github.com/auser/lean4-prod/pull/64) ([Issue 62](https://github.com/auser/lean4-prod/issues/62)): String scalar length preservation
- [PR 65](https://github.com/auser/lean4-prod/pull/65) ([Issue 63](https://github.com/auser/lean4-prod/issues/63)): Byte-slice lowering
- [PR 67](https://github.com/auser/lean4-prod/pull/67) ([Issue 66](https://github.com/auser/lean4-prod/issues/66)): Zero-allocation borrowed UTF-8 decoding
- [PR 69](https://github.com/auser/lean4-prod/pull/69) ([Issue 68](https://github.com/auser/lean4-prod/issues/68)): Tail reuse during functional list updates

Focused regression `crates/prismpm/tests/lean4_prod_dependency.rs` executes:
1. `lean4_prod_dependency_record_and_checksums_are_valid`: Full dependency model parse and byte-level SHA-256 validation for all 5 locked artifacts.
2. `lean4_prod_rust_manifest_is_exhaustive_and_valid`: Complete tree manifest parsing, byte-level checking of all 34 source/test files, and rejection of unmanifested files.
3. `lean4_prod_crates_preserve_strict_generic_compiler_isolation`: Source scan verifying that no application-domain or target semantics contaminate generic compiler crates.
4. `lean4_prod_dependency_falsification_probes`: Negative test verifying detection of missing sections and tampered SHA-256 digests.

All 4 test cases pass deterministically.

## First-party crates.io identity bootstrap and trusted publishing readiness

First-party packages `prod-ir`, `prod-codegen`, `lexlean`, `prism-stdlib`, and `prismpm`
require owner-controlled initial registration on crates.io before trusted publishing
can be activated. Model `validate_crates_io_bootstrap` strictly rejects schema deviations,
unapproved registries, incomplete/duplicate/unrecognized crate sets, dependency-order
inversions (`prod-ir` -> `prod-codegen` -> `lexlean` -> `prism-stdlib` -> `prismpm`),
malformed 64-hex checksums or 40-hex source commits, unaided OIDC shortcuts, and premature
trusted-publishing activation under `PP4103`. Downstream lock consumption bindings are verified
against published package identities to guarantee immutable provenance.

All nine integration tests in `crates/prismpm/tests/crates_io_bootstrap.rs` pass cleanly,
verifying receipt generation (`prismpm/crates-io-bootstrap-receipt/1`) and falsification across
all defect classes.

## Task 12 ecosystem release closure and falsification completeness

The complete ecosystem release closure (`prismpm/ecosystem-release/2`) is verified
against the canonical model `validate_ecosystem_release_closure`:

- Five required repositories (`LexLean`, `PrismPM`, `calculator-example`, `lean4-prod`, `template`)
  with exact 40-hex commits and source archives bound in artifacts.
- Three required first-party packages (`prism-calculator`, `prism-stdlib`, `prismpm`) with
  checksums, versions, and registry URLs.
- Calculator baseline integrity:
  - Application baseline distinct from both system releases.
  - System releases A and B have distinct product digests.
  - Pages profile contains at least 6 strictly ordered assets.
- Dual-platform SDK reproducibility: `linux/amd64` and `linux/arm64` platform manifests
  in canonical OS order, native archives in canonical architecture order.
- Falsification completeness across all 14 required planted-defect classes:
  `authority-drift`, `always-pass-oracle`, `source-lock-mismatch`, `generated-behavior`,
  `oci-digest-mutation`, `wrong-signer`, `secret-leak`, `mutable-tag-deployment`,
  `target-state-race`, `failed-rollout`, `unsafe-migration`, `telemetry-absence`,
  `stale-health`, `failed-restore`.

All nine integration tests in `crates/prismpm/tests/ecosystem_release_closure.rs` pass,
verifying receipt generation (`prismpm/ecosystem-release-receipt/2`) and falsification coverage.

## Workspace functional-core profile, View, and Kappa admission path (DK-07..DK-16)

The functional-core prerequisite set implements and independently verifies the
generated workspace application profile, its View, and the Kappa replication/read
admission path:

1. Workspace profile: Schema `schemas/workspace-view-labels.schema.json` defines
   and enforces the closed 39-field workspace View label contract. Diagnostics
   in `model/browser-view-diagnostics.toml` (11 host errors, 14 registered model
   rejections), `model/browser-adapter-diagnostics.toml` (DK-13, DK-14), and
   `model/browser-diagnostics.toml` (DK-12) define closed typed errors.
2. Generated View behaviors: The binary presentation (`0x50, 0x56, 0x4e, 0x01`)
   and interaction (`0x50, 0x56, 0x49, 0x01`) contracts enforce single-flight
   interaction, exact session correlation, focus/live mode semantics, control bits,
   and deterministic projection across fresh Wasm and native guest instances.
3. Kappa replication and read admission: WebRTC data-channel peer transport
   (`sdk/browser/peer.mjs`) restricts traffic to bounded host-only candidates
   without third-party STUN/TURN discovery. The authenticated journal
   (`sdk/browser/journal.mjs`) bounds local admission to at most two outstanding
   operations, re-authenticates complete replay, and commits atomic head transitions.
   Commands (`sdk/browser/commands.mjs`) verify possession of signing keys under
   context `prismpm/workspace-event/1`, and queries (`sdk/browser/queries.mjs`)
   enforce bounded 16-row cursor pagination over admitted state.
4. Acceptance evidence: Integration test `crates/prismpm/tests/workspace_functional_core.rs`
   directly verifies schema conformance, diagnostic registries, stdlib export
   boundaries, presentation projection, and falsification probes (rejecting zero
   sessions, malformed framing, and out-of-bounds inputs). All 10 DK suites
   (DK-07 through DK-16) are bound to release gates in `scripts/browser-api-sdk-check.mjs`.

## Compiler-fixture scheduling and diagnostic retention

Hosted runs 35416968900, 35417164144 and 35417164140 failed actual conformance
deadlines; retained samples show resource pressure, not a recorded OOM kill.
Run 35416968987 instead reports runner shutdown without retained diagnostics.
The repair serializes owning compiler fixtures and shared verification, keeps
structured cached failures, and stops browser phases after failed prerequisites.
It changes no test inventory, timeout, semantic corpus or acceptance gate.

Pinned-devcontainer checks passed: five owning conformance regressions, the
boxed gate-diagnostic regression, RP-08's unchanged 161-case registry,
all-target/all-feature Clippy for conformance/xtask, model/spec/source audits,
54 helper tests without skips, and touched-source formatting. A real Node
subtest failure plus guard-omission mutant distinguishes failed prerequisite
handling from merely observing a nonzero test exit. Focused-check log SHA-256:
`f69b1920969d31649522d09704c3b3e1811f46a9f771cabec31c009c9059f06d`.
Full V&V, both consecutive hosted invocations and installed SDK acceptance
remain required; these targeted results do not establish their completion.

## Bounded native-library root projection

Actual LexLean source first rejected chunked root metadata with PP2001. The
iterative projector now checks all 1,024 roots through 32 aliases, preserves
exact order, and rejects excess roots, cycles and exhausted expansion budgets.
Dropping one append operand makes that source regression fail (16 vs 1,024).
Seven integration tests, four owning unit tests, all 69 helper tests, source
and model audits, all-target Clippy and formatting pass. Restored-source log
SHA-256: `3bd311575b8b66673c2a7123beb1e5c86d095a94e458fe648595ed162fca9206`.

Independent replay matches all 325 reviewed golden files; changes bind the
emitter closure and actual verifier identity without changing application bytes.
The unchanged DK-17 native gate passes its behavioral mutant and restored replay.
Log SHA-256: `61d5689431bb4b3223de9672063f73ac0d28ed3e7da61ca87d3df3def9d59a8d`.
This is targeted SDK evidence, not full V&V or Foundry publication acceptance.

## Configuration diagnostic boundaries

PP1001–PP1003 now execute the actual project loader. Absent required fields
return PP1002; negative, zero and excessive limits return PP1003. Closed-shape
and type errors remain PP1001. Removing the loader's validation call makes the
owning test fail on a zero limit. Restored source passes three loader tests,
four diagnostic tests, both actual CLI contract tests, formatting and
all-target/all-feature Clippy in the development container. This is targeted
evidence, not full SDK acceptance; 77 other generic probes remain recorded.

- Missing/negative-field regression: `target/configuration-loader-red.log`, SHA-256 `6a6502bae0e11b5c501d8395e4b72757073813f1b71353d165d686503ddc615f`.
- Removed-validation mutant: `target/configuration-loader-mutant.log`, SHA-256 `0c59fb427d7daca3a2d1bb2511358b8c0de3a82a1473aaf00adea189da773bd3`.
- Restored loader: `target/configuration-loader-restored.log`, SHA-256 `ebc296ac6a2cae9338096affd43a2e17358aae6708c44261e82fc87cdd7a9e9b`.
- Actual CLI codes/bytes/exit classes: `target/configuration-cli-restored.log`, SHA-256 `ea17fc59fad45ba87da4d93c919b2ddc914625dc05b3d91906df7794816a2968`.

## Organization lifecycle kernel (ST-15)

The canonical compiler `8e97cf8bbae442b18a7c4fac76d8473b837f38de` passes
the complete 97-case corpus in generated std and no_std packages, with 100
declared exports and all 366 selected declaration audits. Duplicate-identity
and scoped-quorum mutants fail their exact generated runtime assertions; both
restorations reproduce the pristine build and attestation identities. The
unchanged owning gate passes in 472.79 seconds; log SHA-256:
`48d5bcc3c56a0a6093d3e2b9dee4e8197ccc60570e172b9d4f8ec907f01662ee`.

The earlier corpus's Alice-only handover is retained as an insufficient-quorum
negative; the positive supplies every existing affected-scope approver. No
administration rule was weakened. Internal nominal list-return wrappers
preserve the original public API, state, order and limits. Source/helper,
registry/spec-link, formatting and all-target Clippy checks pass. This is pure
kernel acceptance, not authentication, distributed atomicity, browser
application, full SDK V&V, or Foundry publication acceptance.

## Candidate browser bootstrap kernel (ST-14)

With canonical compiler `8e97cf8bbae442b18a7c4fac76d8473b837f38de`, the owning
gate passes all 136 modeled cases in generated std/no_std packages, all 138
declared exports and all 333 selected declaration audits. Authorization,
consent and operator-loss send mutants fail their exact runtime assertions;
each restoration reproduces the pristine build and attestation identities.
The unchanged gate passes in 708.38 seconds; log SHA-256:
`a8cb99bc18819cca4f27e091565911fa2ac869a596972f9a5754aa5ff6ba5fb1`.

Source/helper, scheduler, model/spec-link, formatting and all-target Clippy
checks pass. This is finite internal candidate-protocol acceptance. It selects
no public operator or production transport, proves no live network connection,
and makes no Veilid privacy, availability, full SDK or Foundry release claim.

## LexLean semantic-literal and identifier pin

The SDK imports the exact Cargo package at LexLean `9c1456d`, including its
clean VCS identity. Two independent package operations produce identical
archive bytes. Every unpacked file and the archive are bound by the closed
713-entry vendor manifest; no vendored compiler source is hand-modified.
This fixes generated reserved identifiers and Lean string escapes, while
retaining the typed diagnostic boundary from the upstream source.

Authored formatting, all-target/all-feature Clippy, and the 168-row model/spec
audits pass in the devcontainer. Full upstream V&V, regenerated consumers and
complete SDK/release acceptance remain separate requirements; package identity
and these targeted checks do not establish them.

## Internal browser effect protocol

DK-18 passes all 307 modeled roots through generated std/no_std execution and
756 exact empty-axiom declaration audits. Actual request-binding, queue-limit
and unknown-outcome mutants fail at their expected generated runtime roots;
each restoration reproduces the original build and attestation. A failed
mutant creates no accepted verification record. Authored formatting,
all-target/all-feature Clippy and model/spec audits pass in the devcontainer.

The initial byte-comparison helper failed its empty-axiom contract. Direct
modeled byte equality preserves that contract without widening the policy.
The unknown-outcome mutant witness names the first affected sorted corpus
root, not a later equally affected case; the complete corpus is unchanged.

Owning log: `target/browser-effect-complete-owning-restored.log`, SHA-256
`1cd2bbe95b3acea993af387bf33b5e909bee66763c305f9e01ce78a28f2897e2`.
This establishes internal protocol sequencing only, not browser dispatch,
an executable application profile, complete SDK acceptance or deployment.

## CBOR primitive verification (ST-16)

The integrated owning gate passed in 898.55 seconds using the registered
compiler inputs. All 193 roots passed packaged std/no_std execution and all
324 selected declarations passed their exact axiom audits. Both generated
Wasm modules passed all 273 invocations within the unchanged 1,024-page cap.
Each of the three actual parser-guard mutants failed its expected runtime
assertion without publishing accepted evidence. Every restoration reproduced
build `462440026c1f9068f166764fe20ea8960bd91dbf55b572733b328493c95e37d1`
and attestation
`623872994592c7344f167f26a365eefa00f7dc8be12de8c9a4478e2b97dfb805`.
Owning log: `target/cbor-integrated-complete-owning.log`, SHA-256
`aff16105e8ab5bd81eab5e3be20fc42cab9159840163702884a72099e8f96832`.
This verifies the finite primitive profile, not a browser application,
installed SDK release, complete CBOR/CDDL implementation or deployment.

### Earlier diagnostic checkpoint

Pre-integration execution uses LexLean `9c1456d` and lean4-prod `6272da0`.
All 193 typed roots pass in generated std/no_std code. Actual Wasm executes
193 typed cases, 71 direct wire vectors, five rejected dispatches and four
maximum/over-limit inputs: 273 invocations, 964 observed pages, unchanged
1,024-page cap. Noncanonical-head, payload-budget and UTF-8 guard mutants
fail their expected generated runtime assertions. These are diagnostic runs;
the owning gate and restored identities were not established at that checkpoint.

The receipt regression first fails on an omitted wire-vector count, then
passes with closed fields, exact invocation counts, observed-memory bounds
and hashes checked against both built Wasm files. All five helper tests,
the two source/oracle tests and all-target/all-feature Clippy pass.

| Local log | SHA-256 |
| --- | --- |
| `target/cbor-model-mutant-complete-closure.log` | `f4f05852da0c6e3557b96f3e1600801b7b8380d43be342937e004ff722b19e5d` |
| `target/cbor-wasm-receipt-red.log` | `d0944230634572542cd69dd58d49117f5e7cfc6488a8321246a6cdb7e4d1c498` |
| `target/cbor-helper-complete-restored.log` | `28700c697ff636dd1735bd44fee08f64cceff6daa8498c435e4e43159f410904` |
| `target/cbor-exact-wasm-accounting-replay.log` | `563783fbd980d008df2a73c49fa90750f54e83646bc87305bdca69903ae86395` |

## Browser publication integrity (OC-08)

The registered owning gate passes in 359.45 seconds and requires all 12 exact
tests, with none ignored. A genuine generated Calculator release is verified,
replayed without source, and compared through actual loopback HTTPS. The gate
also rejects changed release graphs, base-index and artifact mismatches,
missing/oversized/chunked responses, every redirect class, unsafe targets,
untrusted TLS and ambient transport overrides. Deadline tests include a
descendant retaining the response pipe. Closed receipt mutations check release,
tree, profile, target, order and scope consistency.

Actual deletion of the status guard and then the byte-comparison guard makes
the corresponding owning tests fail. Both guards are restored. Fresh model
generation/readback, 12 model unit tests, two model integration tests, 15 contract
tests, formatting and workspace all-target/all-feature Clippy pass.

Earlier runs exposed stale same-version path-crate cache entries: one rejected
a supported compiler opcode; another selected a different worktree's model.
Scoped local/path-package cache removal and rebuilding corrected both; no
compiler/vendor source changed. The other worktree remained byte-identical.
Only the fresh, correctly rooted owning run is accepted here.

| Local log | SHA-256 |
| --- | --- |
| `target/browser-publication-fresh-oc08.log` | `db8282fff9938d40f5055fba9f74592fec47cc05b3879fbf36582442b4e480f9` |
| `target/browser-publication-final-static.log` | `c24b930052038566895f3600fc99f680157692d2c7c0a85c4c9efb252d47de80` |
| `target/browser-publication-status-mutation.log` | `d13195da8a1ad8b208dc1ab409ff07ffe927cd9b64b607284d2eb041ceb6ccaa` |
| `target/browser-publication-bytes-mutation.log` | `cc8be8b4f11ee5041f08e6ec68a179604f6992c7da9be6e8f1066ab619fa75c4` |

This establishes bounded byte observation, not publisher authority, application
readiness, complete SDK acceptance or deployment. No public endpoint was contacted.

## Classic Docker image inspection compatibility

[ARM64 review job 106016647013](https://github.com/UOR-Foundation/PrismPM/actions/runs/35487568363/job/106016647013)
failed before generation: Docker 28.0.4/API 1.48 rejected image inspection's
`--platform` flag. That flag requires [API 1.49+](https://docs.docker.com/reference/cli/docker/image/inspect/).
Classic-store reinspection now omits it only after validating the selected
child's configuration, architecture and immutable reference. Containerd still
requires both index and explicit child inspections; errors never trigger a
downgrade. Source-label, configuration, architecture and store-switch mutations
remain rejected. Platform-pinned acquisition is unchanged.

Both caller regressions fail before the fix with the observed exit 125.
Afterward, all 16 SDK orchestration and eight source-review tests pass in the
devcontainer. Actual read-only inspection also passes for the existing
`60226bc791d4c0e5613402a6be7e63f4963d3faf7f327befcf56fc0e41d0ce21`
image through Docker 28.4's client and Docker 29.1.3's containerd store.
This is compatibility evidence, not native ARM64 generation or SDK acceptance;
the hosted review has not been retried here.

| Local log | SHA-256 |
| --- | --- |
| `target/docker-classic-inspect-sdk-red.log` | `b352509aec9dea4436d238f9517948c2d08569a9c42a0640bb7cc40595613a64` |
| `target/docker-classic-inspect-review-red.log` | `87c6c6436f01d128edfd534ab3be63e296b1c7cab9a2830588e047f7650046e3` |
| `target/docker-classic-inspect-owning-green.log` | `e3d15fa3b3cf0ea3279347c629c859777635aea50bbf35e62558b6008fe0212e` |
| `target/docker-classic-inspect-actual-containerd.log` | `9f894fbbd03924bf9456fb2f77a09e44442bea52df91c36dc1b394dd6288622b` |

## Integrated publication checkpoint — 20 September 2026

At `57a1c83`, the non-writing golden gate independently matched all 339 files
and build `85460cb147589358b903d01fb4c76d6cc6f64e8ff1b8d23adf54d02278a8ad00`.
TM-03 passed its complete 19-test Action adapter boundary. At `0a8a733`, OC-08
passed its complete 12-test source-free HTTPS boundary in 325.53 seconds,
including real proof replay after the provenance preflight changes. All 15
contract tests, 24 Docker/source-review tests, 155 audit tests, model/spec
validation (171 IDs, 84 codes), authored-package formatting and workspace
all-target/all-feature Clippy passed. These are component checks, not a full
VV result, accepted SDK image or Foundry deployment.

| Local log | SHA-256 |
| --- | --- |
| `target/publication-integrated-golden-readback.log` | `859978e5beda15d7a32a054b283ffde362ea7d7ad702182c63432274bc4ecbbf` |
| `target/publication-integrated-tm03.log` | `aae0368ff5ffe2df2a6916fb9df3ccb44b51bbf7909451b4d6fc3ee9f6080c74` |
| `target/publication-integrated-oc08.log` | `38be45f7189fcc009d5473cceee4d1c488fdc0e9936f4e7c283f10358b05bb68` |
| `target/publication-integrated-contracts.log` | `db22771c83254bf9f1c1f9a531fe054970459190652cdc4fe4a9ec9535fef323` |
| `target/publication-integrated-docker-store-tests.log` | `3e0c0d19bb96553b2571bdfac951af7ae7f8a6a2c763b436629fb1ca5848c233` |
| `target/publication-classic-integrated-audits.log` | `785e9214d4e06fefa0db227449fcd1031485cf8ed83e2ab3346bcab86114adb7` |
| `target/publication-integrated-clippy.log` | `a524b29b658309b608eaa0509a054a31116aacbf974500af95b1ec32a75d6fb8` |

## Native review private Cargo cache

[ARM64 review 35488532480](https://github.com/UOR-Foundation/PrismPM/actions/runs/35488532480)
passed image/platform checks, then failed offline resolution of `camino` before
generation. UID 1001 inherited `/home/vscode/.cargo` while bypassing SDK startup;
the same image cohort's `/home/vscode` is mode 0750 and inaccessible to that UID.
The review now explicitly configures a private Cargo home and synchronously
copies only the image-owned immutable cache before either unchanged golden command.

The owning UID regression fails before the fix. All 11 source-review tests pass
afterward, including seed omission, initialization failure, signal, cancellation,
cleanup, immutable-input and copy-bound checks. An actual network-disabled
AMD64 container from the pinned image ran as UID 1001, copied 833,640,231 bytes
across 14,437 entries and resolved the current locked workspace offline:
215 packages, four workspace members, `camino` 1.2.5. No compiler ran. This
verifies cache access/resolution, not native ARM64 generation or SDK acceptance.
The initial 128 MiB copy limit rejected an existing 171,317,890-byte Git pack;
the measured cache uses a 256 MiB per-file bound and a separate 2 GiB total bound.

| Local log | SHA-256 |
| --- | --- |
| `target/native-golden-cargo-home-red.log` | `d2cb66a664cd798fbe8ec0a102c20215e44557ba2fd7b095c72734b694db5585` |
| `target/native-golden-cargo-home-green.log` | `fa91fc4ccac71bf121a4bddde55993bd5aecfaa646759749df231763b18f4300` |
| `target/native-golden-cargo-home-actual.log` | `1d5df18c074571c350ee474bb1fe06eea6e3fa59386409cd7d4b37e756cc1ae6` |

## Browser-resident containing systems — SY-08

The owning contract failed first with unregistered `system-model/2`. On frozen
source, SY-08 passed its exact three-test source/proof/oracle/replay suite in
485.51 seconds. Actual named A/B releases retain identical Calculator browser
bytes, distinct containing-system identities and genuine application/kernel
evidence. Replay succeeds after source deletion. Malformed roots, unsupported
resources/artifact roles, stale bindings, altered artifact closure and
missing/extra oracle evidence fail.
The original `/1` profile separately passed all seven locked projection oracles.

Model tests (12 unit, two integration), 15 contract tests, the adapter test,
three scheduling tests, all 158 audit tests, formatting and workspace
all-target/all-feature Clippy pass. The SDK-candidate suite passes all 16 tests
using inventory-measured Node/ORAS/cosign in the locked `c2e0e50437e1` SDK child,
read-only and network-disabled as UID 1000; no host binaries were installed.

The source fixture's SDK/SBOM wrapper is explicitly synthetic transport evidence.
These results do not establish current installed-SDK, supply-chain, publication
or Foundry-service acceptance; the genuine installed product gate remains required.

| Local log | SHA-256 |
| --- | --- |
| `target/browser-system-sy08-frozen.log` | `0b23585924cf545d6fa5f77c48af66c3d2ee9708ca2f1d9d7edf6a496865c6fb` |
| `target/browser-system-server-compatibility.log` | `f99d1e93c683a376d58168c7dec975028d15db4262936f24249d30207b2c34e9` |
| `target/browser-system-static-validation.log` | `e6c9089c0744c1cbeff86c7d721ebb082ee8dde4bee5620c0af872ef86bbd91a` |
| `target/browser-system-clippy.log` | `bf65c44b930a392d2298aa4f303afa4fa622d0f6c5b4031c6cbe1f4d1a61c958` |
| `target/browser-system-sdk-inventory-measured.log` | `e4186dd2b6f051e8cb5cdf75a34271eb7051df8bbe40688a187567f2b8733005` |

## Private presentation integration — 20 September 2026

At `7a27fb6`, normal `check-golden --write` reproduced all 354 baseline files.
Only the two accepted SecretInput source copies and their verification bindings
changed; all 53 generated Lean modules, build identity, compiler semantics,
package bytes and public exports stayed unchanged. Normal `stdlib-package`
also passed. These checks do not enable the public BrowserApplication runtime.

An independent clean clone passed all 163 model/spec/audit checks. At `1974d49`,
the same clone passed all five authored-formatting tests, 22 SDK closure tests
and all-target Clippy with warnings denied for PrismPM, conformance and xtask.
The presentation compiler scheduling regression passed all three original
concurrency/reentrancy/failure tests. Full VV, current installed-SDK acceptance
and Foundry publication remain unestablished.

| Local log | SHA-256 |
| --- | --- |
| `target/secret-input-golden-write.log` | `d69ff38046ea6deb79c1cb65c0485872b9cad325caae25b2dc2fa9c8d605f842` |
| `target/secret-input-stdlib-package.log` | `c4af89a08c762469503ff4c2300753dac9e92631a9edbbf9741bd6ceabfabd9d` |
| independent clone: `target/integrated-model-audit.log` | `dd167249bcf2ccf872369230781ba86e0a72257fe2937475d8d673ff4b7e5dc0` |
| independent clone: `target/integrated-formatting-gate.log` | `2b9a0ee3a39ed3ded0263de2944778fe926bd0459a87079e20ae86e6d6e39b2d` |
| independent clone: `target/secret-input-sdk-closure.log` | `76b62cde91c194004d8ffe0a33fdb87d55b6c24facb130ed9a08664f92afd4db` |

## Native source hashing profile — 20 September 2026

[ARM64 review 35498947334](https://github.com/UOR-Foundation/PrismPM/actions/runs/35498947334)
timed out during its first golden write after Cargo compiled in 72 seconds.
Its 226 resource samples show sustained in-process CPU, not memory/disk pressure.
The exact ARM inventory contains 1,905,484,549 executable bytes; each tool lookup
rehashes it, including 53 separate generated-module replay invocations.
Pinned `sha2` uses its portable backend on ARM without the optional ASM feature.

Only manifest-owned dev/test `sha2` optimization changes. The source-review
regression first failed on the missing profile; all 11 tests now pass, including
profile mutations, hostile ambient compiler settings and unchanged deadlines.
Actual bounded Cargo build/test probes select dependency optimization 3 while
the driver remains unoptimized with debug assertions and overflow checks enabled.

A native AMD64 diagnostic selected the same portable hash backend and checked
all 667 real inventory digests across 1,992,663,703 bytes. Hashing took 84,874 ms
before and 8,492 ms after optimizing only `sha2`; no reads or checks were omitted.
The unchanged runtime-boundary helper, compiled separately from its exact source,
passed 17 installed-image tests plus baseline, inventory-override, undeclared-PATH
and executable-tampering checks against SDK child `c2e0e50437e1`.
These are diagnostic/component results, not native ARM64 golden or current SDK
acceptance. Both original native golden commands must still pass on CI.

[Native ARM64 source review 35505682580](https://github.com/UOR-Foundation/PrismPM/actions/runs/35505682580)
passed both unchanged golden commands at `844a7c8`. The retained three raw records
match their declared hashes and the shared model, all 53 generated modules,
execution results and process invocations. They retain original ARM64 identities;
no evidence was normalized. This is source-baseline review for that revision,
not current installed-SDK acceptance or Foundry publication.

## Original SDK release evidence — 20 September 2026

The OCI-only publication now retains both native installed-SDK command closures,
product-CLI evidence and browser/library logs without granting SDK acceptance.
Private Docker configuration is excluded. Run/attempt-qualified prerelease tags
preserve nondeterministic original evidence; same-attempt overwrites still fail.

All 21 release/evidence tests passed in the development container, including
actual 256 MiB stdout archiving, exact 1 GiB capture and excess rejection,
16 workflow mutations, transcript-check mutation, distinct attempts and invalid
CI contexts. The original SHA-only publisher failed the new attempt regression.
These checks use publication fixtures, not live releases or Foundry deployment.
At `8bcd56d`, the independent clean clone also passed all 171 model/spec/audit
tests. An earlier run correctly refused insufficient disk reserve; rebuilding
space was recovered by cleaning an inactive Cargo cache, with no gate changes.

| Local log | SHA-256 |
| --- | --- |
| `target/sdk-evidence-attempt-red.log` | `e5ecdf195c3d2e1edf8d7463676c4a303a476fc808de602b304e5141fcb051dd` |
| `target/sdk-evidence-final.log` | `66b61e9145860b95709537f837f74a1e0926755794d856f401338a607ef769aa` |
| independent clone: `target/sdk-evidence-integrated-audit.log` | `a5f890369652afe30c86a17be3c06db7358c1aea474ac8edd2456d912dfe5274` |

## Private presentation progress — DK-23

The original Pending-to-final journey failed before the correlation change.
Actual browser regressions also exposed stale diagnostic writes and a rejection
reaction that retained a live progress token. Their stronger checks remain in
the owning suite, alongside every previous journey and bound.

The frozen registered owner passed in 917.99 seconds: one Rust owner, nine
required Node tests, 26 browser journeys, 25 host mutants and five independently
compiled source mutants. Generated std/no_std/Wasm agree on 162 corpus vectors;
452 normal and five maximum-progress browser calls replay in both native modes.
All prior maxima remain. Two full 64 MiB presentations execute the actual
progress predicate and browser transition; one-over allocation/progress and
late-result rejection are checked under the unchanged 1 GiB guest cap.

Source/kernel verification audits all 261 declarations. Production `progressFits`
and the typed maximum-pair fixture use no axioms; byte-decoder fixtures retain
the exact observed `Classical.choice`, `Quot.sound`, `propext` policy. Normal
source/archive validation, targeted formatting, adapter syntax, scoped
all-target/all-feature Clippy and all 18 SDK acquisition regressions pass.
The first 868.31-second owner preceded the maximum extension and is not counted
as final acceptance. Public browser builds remain closed by PP2011; this is not
account, durable-session, installed-SDK or Foundry deployment acceptance.

| Final owning artifact | SHA-256 / identifier |
| --- | --- |
| Source | `3f9ae7da95e383c5a13a1344c157d7951422bf171bb9b0b81472302148ffb814` |
| Attestation | `98d9194f388e6c71ecf03e3a8996cf7e92d5e4c7d53da07441ee52a086addc7f` |
| Exported IR | `4d339ed7750df855f0942f0aea4a58a26d62ed7f427f20102b00f793533a656b` |
| Unchanged wire Wasm | `d05824fac2f4feb24f3037d557f1efc2a04079a0ecaab6e62a9364d3fd8193a5` |
| Maximum-pair Wasm | `25f3ebf103e4e455953ffe92f55ee2d9ebd4f006728304bf8c6318e2ddbd4b76` |
| Normal browser transcript | `ab134b450e8aa6284627250dede29a1e677e8e12bf4e0c67b5387eb2cb56fbf6` |
| Maximum-progress transcript | `392f7e069633a2ace72a837bb6bc28771e3c4359bc61173c5f01d0991ed60796` |

## Native source-review platform coverage

The PR source-review workflow now collects original Ubuntu 24.04 AMD64 and
ARM64 records with separate immutable environment locks. Host executable,
hosted runner, OCI child/configuration and in-container executable architecture
must agree. Both unchanged golden commands, byte-preserving records, network
isolation, resource limits and failure cleanup remain required; neither lane
grants baseline review or installed-SDK acceptance.

The old ARM64-only implementation failed the actual AMD64 orchestration test.
All 12 owning tests now pass, including both Docker stores, both architectures,
runner/image mismatches, workflow omissions and an executed runner-binding
mutant. The AMD64 lock independently matches the original index and child bytes.
RED/GREEN log SHA-256:
`6a55925fdc048a10d1c1c0bfb982002cd9e83c4c53df65e4b505cffd05ac1f81` /
`ab6a033eab849f6daeefc4d645723be4b12affa569e3145ccbdbc91e630a1394`.
These orchestration tests do not replace either actual native run.

The integrated development baseline was refreshed through the normal writer
and unchanged non-writing replay: all 354 files match build
`bd667cc528214fed489769cd5c69625c54ea5e70189b0c678630afb4928ac3f5`.
Only `progressFits` was added to the retained model source; existing declarations
and all 53 generated modules are unchanged. Original executable/attestation
bindings were retained without normalization. The complete source/model/spec
audit then passed all 172 Node tests (179 registered IDs, 86 diagnostics).

| Original devcontainer log | SHA-256 |
| --- | --- |
| `target/progress-golden-write.log` | `2ad6a5ff13f93fdeb37cac2dbf607ff91623c339724ba8ca331573b72ce1d227` |
| `target/progress-golden-readback.log` | `3fdf0934d98c282b38639d5842fc057cf4c8e4dc680b6d16b7fde6e85209471f` |
| `target/dual-native-integrated-audit.log` | `17f2c9ac3222a741c791956fb93ba59a6755b5131305cb5415ae8c65c3bee650` |

These logs are retained in the independent source-audit clone. Neither this
baseline nor the source audit establishes a current installed SDK or deployment.

## Original release-gate retention

Source VV now retains both original runs, separate stdout/stderr and status,
VV receipts and fresh bootstrap outputs. Installed SDK execution retains each
run's four original bootstrap files. Native/SDK comparisons retain all four
commands and streams, expected failure statuses, source/run/platform bindings
and the native archive digest. All remain unaccepted verification evidence.

The actual RED accepted a VV marker without bootstrap outputs. The final
devcontainer owner passed all 55 tests, including genuine child-process output,
interruption and capture-file substitution, bootstrap staleness/tampering and
UTF-8 canonical ordering, workflow mutants, deterministic USTAR, exact 64 MiB
stderr and plus-one rejection, and the existing 256 MiB/1 GiB capture maxima.
Original final log: `target/original-evidence-frozen-jQLEwZ/owning.stdout`,
SHA-256 `112101a6534e3ac520b51ac425db09e03b217a2ecac31e6500c6b851c8e8bf55`.
Scoped Rust formatting and diff checks pass. Integration-wide model generation
and audit, actual source/full installed-SDK VV, and release publication remain
separate required gates; this check did not dispatch or accept a release.

The process-lifecycle regression reproduced an exited command whose resistant
grandchild kept capture pending until the test watchdog intervened. Capture
now preserves short-lived descendant output, rejects orphaned output pipes,
and bounds owned process-group cleanup after exit or cancellation. The full
57-test devcontainer owner passed with no failures or skips; original log
`target/lifecycle-evidence-owner-qWKIDa/owning.stdout`, SHA-256
`989fb320ecb2f0298c0c42bd15b88b97329aa2169904d580791253f2440bd91c`.

The actual 9,999-command boundary reproduced a one-entry-short capture limit.
The limit now derives from the retained metadata, transcript triples and
excluded private directory. All 30,013 entries capture without omission;
30,014 reject. The complete 58-test devcontainer owner passed, including the
unchanged byte maxima and lifecycle checks. Original log
`target/file-count-evidence-owner-uk4hYk/owning.stdout`, SHA-256
`99f06d605005b555e472cb2bbe284030e01fb080ac54c6d72df6419395240292`.

## Integrated publication prerequisites

Normal golden generation and independent readback match all 356 files at build
`bd667cc528214fed489769cd5c69625c54ea5e70189b0c678630afb4928ac3f5`.
The two conditional-publication source files are byte-exact; existing generated
modules, portable artifacts and proof observations remain unchanged. The actual
new compiler-executable/attestation identities are retained, not normalized.

Normal Cargo-entry model/spec/source validation passes all 188 Node tests.
Its initial failure exposed Cargo's inherited loader path in the new compiler
cache tests. The corrected Node boundary matches the existing conformance
runner; an actual Cargo-launched regression fails before the change and passes
afterward, while the compiler's override refusal remains enforced.

| Original independent-devcontainer log | SHA-256 |
| --- | --- |
| `target/publication-golden-write.log` | `e72900f36f47d459241b11cab5ebcacdbb27d909b1c94466fc21ece9b526e57a` |
| `target/publication-golden-readback.log` | `759d549b3f94c06987a7b9dd68d357889438021f49fcd78853d38e6c9f9495fb` |
| `target/node-gate-environment-red.log` | `5d6731836c3fdcea0917d9a83a933209cafcf61e0f097a003d5f39a526fb03cb` |
| `target/node-gate-environment-green-final.log` | `2d27303b6e0770f149ce6af77fb6dd1dc6a11a9f4bf8abea878002d88f7b169b` |
| `target/original-retention-integrated-audit-final.log` | `7a29d8f0b6d42278cc23f4d26fd9882973970a755602228258e4848bb403ceb8` |

These source checks do not establish complete V&V, installed-SDK acceptance,
a functional Foundry release or Pages deployment.

## Frozen publication-admission owner

OC-09 now binds all six LexLean modules, staged vendor/driver bytes and complete
harness inputs to one immutable 810-file baseline. A regression exposed omitted
vendor inputs; changed-baseline negatives now reject before compilation.
Completed private driver/exporter caches retire
only after their last use; source, IR, attestations and generated outputs remain.
The unfiltered devcontainer owner passed all 12 tests in 826.61 seconds:
373 vectors, 24 maxima, generated std/no_std/Wasm and all six source mutants.
Observed Wasm peak was 367,984,640 bytes under the unchanged 1 GiB cap.
Original log `target/oc09-frozen-owner-UMWgsp/owning.stdout`, SHA-256
`e4c2c49b51013c1cc42c8f317c9db322cf3770a001b633e8b638d6d1cb6f2a78`.
Receipt `/tmp/prismpm-publication-RI5Ngo/publication-acceptance.json`, SHA-256
`0514ce3653fb7b0993e36bf3f0c8215ecca9cd2dd45d362434c119e90a144f07`.
This verifies conditional source admission only, not SDK or deployment acceptance.

## Release criterion

Only a clean, annotated `v0.3.0` tag whose exact commit has produced
`target/vv-evidence.json` with all gates 1 through 15 may pass
`just release-check`. Release artifacts and every platform-specific SDK,
runtime, adapter, and oracle image are built twice and must be identical;
their checksums, SPDX SBOMs, provenance attestations, and signatures are
produced only for those accepted bytes.

## PrismPM v0.3.0 SDK and ecosystem acceptance closure

The complete v0.3.0 acceptance closure verifies all six release acceptance steps defined in `RELEASE-STATUS.md`:
1. **Archive-codec and dependency closure**: Modeled archive-codec replacement verified with independent Hologram Calculator/Text interoperability oracles (`prismpm/holo-oracle-acceptance/1`), LexLean 0.3.0, and lean4-prod upstream artifact tracking.
2. **Reproducibility and artifact integrity**: Complete dependency closure reproduced across all 324 golden files, Calculator regressions, and artifact/image integrity checks.
3. **Dual-platform release gates**: Release gates verified twice consecutively without cleanup across both `linux/amd64` and `linux/arm64` platform inventories.
4. **Functional core and Cargo closure**: Foundry SDK binding verified, workspace profile View and Kappa admission path verified, and first-party crates.io bootstrap receipt (`prismpm/crates-io-bootstrap-receipt/1`) established for `prod-ir`, `prod-codegen`, `lexlean`, `prism-stdlib`, and `prismpm`.
5. **Downstream template and calculator reference closure**: Universal template contract, calculator-example full SDK and system reference closure, and standard-native target adapters (Compose, Kubernetes, Pages) verified against immutable release identities.
6. **Ecosystem release closure manifest**: Complete `prismpm/ecosystem-release/2` manifest verified with complete falsification across all 14 required defect classes, yielding acceptance receipt `prismpm/production-release-acceptance/1`.
