# DK-31 verification

Private additive dynamic-choice prerequisite; not an accepted SDK or application.
Base: `a3f831b`. The registered owner initially failed in the pinned devcontainer
with `ERR_MODULE_NOT_FOUND` for its absent `checks.mjs` implementation.

Fresh owner at `590a9e4`: 8/8 PASS in 1005.285s, no skipped tests. Execution:
`node --test --test-concurrency=1 --test-timeout=3600000
tests/browser-dynamic-choice/wire.test.mjs
tests/browser-dynamic-choice/component.test.mjs sdk/browser/dynamic-choice.test.mjs`
in the pinned `prismpm-dev` devcontainer.

Evidence: `/tmp/prismpm-dynamic-choice-IjidZV/dynamic-choice-evidence.json`,
SHA-256 `1c8efd5d4d5aeefc2ca5f6e48f44daa6996e3becdd990d6022a0c0e54616334e`.
Frozen input receipt: 885 files,
`eac6e4a8a11d03b07e88ed9ba8cbf887e6f66215dd7edcf30dc14d129a30b56c`.
An independent readback verified all input snapshots and 1,392 retained files
across the baseline and six source mutants, including native/Wasm identities.

Coverage: 13 kernel-checked source modules; eight roots; fresh native std/no_std;
two independently generated Wasm packages per root; 168 new/legacy vectors;
eight combined exact-64-MiB dynamic/mixed frames and one-over; seven generated
browser journeys (53 calls), five killed renderer mutations (33 calls) and
maximum browser frames (16 calls), all replayed by both native modes. Maximum
Wasm memory was 965,279,744 bytes within the unchanged 1 GiB limit. Maximum
browser bytes are hash-bound to the exact native input files. Six independently
compiled source mutants were killed by native/Wasm observations. Each regenerates
native and two Wasm packages for its affected root, not unrelated roots.
The fixture's imported axe 4.13.0 audit reported no violations or incomplete
checks; this is component evidence, not complete accessibility or usability.

Current integration registers semantic presentation as DK-38; DK-29 owns
native exporter acquisition, not presentation diagnostics. Integration still
requires unchanged DK-23/DK-26/DK-38 owners, source-package
regeneration and installed SDK checks. Route/history and transient secret-output SDK
prerequisites, Foundry journeys/authority, production design and human assessment
remain separate application obligations. This capability claims none of them.

The frozen owner map includes all six transitive compiler, package-custody and
presentation helpers. The registration regression parses the actual owning
entry/checks static import graph without evaluating modules, rejects each omitted
helper, and rejects omitted or changed helper hashes in the actual input guard.
Browser-context dynamic imports remain bound by the complete browser module
inventory. Unrelated SDK test files in that inventory are not executed by DK-31.

The owner retains every failed build. Successful baseline/mutant owners
retain source, kernel evidence, IR, packages, original/private Wasm, native
observers, exact replay files and a rehashed receipt; complete input bytes are
snapshotted once. Native stdout is exact and ordered. All 32 actual artifact
substitutions refused: changed source, matching forged manifest, extra file and
hardlink before the first native compile in both modes; original/private/buffer
substitution for all eight generated Wasm roles. Installed SDK registration owns
all eight DK-31 tests with a one-hour deadline; registration is not SDK acceptance.

Generator diagnostic: a normal shared-target Cargo build reused `repo-model`
with another worktree's baked `CARGO_MANIFEST_DIR`. Its five outputs were unchanged
there; it did not regenerate this branch. The exact package's dev cache was
cleaned before retry. Correct output paths and the subsequent normal model check
are required; this attempt supplies no generation or component acceptance.
The retry rebuilt the exact package, wrote only this worktree's generated outputs,
and normal `validate-model` passed: 185 IDs, 86 codes, clean meta-gate/audits. The
source archive is current; this is not generated Rust/package or SDK acceptance.

First full owner: RED after 153.10s; retained `/tmp/prismpm-dynamic-choice-JoDhwd`.
`OptionExtraField` incorrectly expected WrongType. Both existing/new option
readers call the capped array reader with maximum two before exact-arity checking;
three fields therefore produce ValueLimit. Product semantics were unchanged.
Diagnostic-only retained execution found no other disagreement across the 166
native vectors. The fresh passing owner adds short-arity and catalogue-arity
regressions. Retained diagnostic products were not used for acceptance.

Post-owner integration: formatting inventory now includes the semantic and
dynamic-choice harnesses; DK-31 uses the compiler scheduler. Both omissions had
failing regressions before correction. Direct pinned `rustc --test` execution of
the actual modules passed all five formatting tests and all three scheduler
tests. The unchanged complete formatter gate ran in an exact private source
copy outside the nested worktree, avoiding Cargo's outer-workspace discovery
for the pinned LexLean manifest; no compiler manifest was modified. All 885
frozen DK-31 owner inputs remained unchanged. These checks are not full SDK V&V.
