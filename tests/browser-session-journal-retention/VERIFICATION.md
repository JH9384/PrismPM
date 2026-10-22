# Private retention component

## Current compiler integration

The guarded input-copy entry and all four component tests are retained with
the complete 18-check owner. Current source, native, browser and installed-SDK
qualification remain unaccepted until verified against this exact closure.
The historical receipts below do not qualify the current compiler integration.

## Historical guarded input-copy owner

27 September 2026, pinned `prismpm-dev` devcontainer: complete owner **18/18
PASS** in 903.217 seconds; separate source-readonly component suite **4/4
PASS** in 10.801 seconds. Neither run skipped, cancelled or deferred cases.

The unchanged owner verified 86 native std/no_std and Wasm vectors, six joint
maxima, eleven Chromium storage journeys with native transcript replay, six
executed host defects and nine independently compiled source defects. Existing
compiler, generated-source, executable and Wasm substitution checks all ran.

The new entry guard permits substitutions only in an owned canonical temporary
`prismpm-retention-input-checks-*` directory with mode `0700`. Before the fix,
the original-entry regression reached an attempted rename on a read-only source
mount; afterward it refused before substitution. Actual nonprivate-mode and
wrong-name probes also refuse, while all five private input defects remain
detected and every captured source byte is restored.

Receipt: `932a932d8e15c34e595cd0493ee714740d15403fea7765869ba6f2eb4bcb46b6`.
840 frozen inputs: `487c97a0f1cbebd5dd20e9f95ab9684929f9e1fa8353909a721ed320a858c8c7`.
Source and Wasm identities match the earlier baseline below.

Raw logs, copied inputs, independent rehash inventory and complete baseline,
mutant and compiler artifacts are retained under
`target/retention-verification/guard-run-kGRl4A9A/` in the guarded worktree.
Archive `complete-artifacts.tar.gz` (135,565,955 bytes):
`d7b692c900f7fc0d2e942bf5b962210053155c4cfb50d978ffc8aaa52e76b15f`.
The rehash independently checked all source inputs, exact generated packages,
native executables, original/private Wasm, IR and proof manifests.

## Earlier receipts

27 September 2026, pinned `prismpm-dev` devcontainer:

```sh
node --test --test-timeout=3600000 tests/browser-session-journal-retention/owner.test.mjs
```

Passed 10/10 TAP tests in 956.109 seconds, without skips or TODOs:

- Fresh pinned source, kernel, exact axiom inventory and LCNF verification.
- 86 independent vectors in native std/no_std and actual Wasm; two independent
  Wasm packages have identical bytes.
- Six joint maxima, preserving 64 roots × 4096 references, 4096 objects and
  16 additions. Peak Wasm memory: 842,858,496 bytes; unchanged 1-GiB memory,
  64-KiB stack and 64-MiB frame limits.
- Nine actual Chromium storage journeys: persistence, competing connections
  and tabs, process restart, shared/staging protection, abort, quota and delayed
  acknowledgement.
- Nine independently compiled source defects detected by native and Wasm
  output mismatch, including balanced traversal and canonical reference bytes.
- Frozen generated-package inventories before the first Cargo build; actual
  source/manifest/extra-file/hardlink and executable substitution refusals.

Receipt: `5f8a637551ca59ed81df15c67c60425eca3554b34e52d9ff232a015c8928ed64`.
Source: `8315ea4809fdbbd53cf0b059292bae26f25e022a65ef1d5c4e4b7d5213c709bf`.
Wasm: `92ce26f8513293215320f1aa34922ea4704c92539d63e5684bdd2c88479beddd`.
829 frozen inputs: `d9437e3a77cad619ca1345b1182abcf8ba532d32da9531a04218fe5cb9c52892`
(SHA-256 of `JSON.stringify(receipt.inputs)`). Log:
`target/retention-verification/run-Ftujw1az/owner.log`; complete evidence retained
in `/tmp/prismpm-session-retention-k5Njl7` inside that container.
The adjacent `positive-artifacts.tar.gz` retains source/proofs/IR/native/Wasm:
`0c43971c0156c8c30c8bd27a53c3db26da32c9dd7f4fec8eb7679336bc5263ea`.

The frozen storage host requested, but did not check, reported strict durability;
its separate correction is recorded in `../browser-session-journal/STORAGE.md`.
The first corrected owner required all ten browser journeys, including the added
relaxed/default/missing-durability refusal. Its changed input closure requires
a fresh complete run; the original receipt is not relabeled as that result.
The corrected ten-journey fixture plus four existing Store cases passed 15/15
TAP tests in 7.562 seconds against the exact original artifact and full receipt.
Separate follow-up receipt:
`42054aac06d8f1822e0dd7ed3551a5203743179f367f1fd8118a7228f7c79d00`.

The later owner additionally requires eleven browser journeys, native replay
of every observed generated call and six actual host mutants; the scoped
follow-up passed. See `../browser-session-journal/STORAGE.md`. The complete
changed-closure run is now recorded above, without relabeling earlier receipts.

This receipt does not establish
authenticated journal closure, freshness, joint real IndexedDB capacity, all-browser support,
installed SDK acceptance, public runtime admission or Foundry acceptance.
