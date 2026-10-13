# DK-32 verification

Status: **incomplete; not accepted**. No SDK image, public Browser runtime,
account, mailbox, organization or Foundry release is accepted by this work.

## Accepted upstream oracle — 13 October 2026

The complete seven-file ECDSA oracle closure now pins upstream commit
`37260931105fff57b17bbb80d15fd44b1eb3b930`, which merged WPT #63475.
All 324 original test names and 96 native vectors remain required; no assertion
or engine is omitted. Historical failures below remain unaccepted. Fresh
three-engine, generated-owner and installed-SDK qualification remain required.

## Current integration — 2026-10-08

DK-32 is restored beside the current DK-29/DK-33/DK-34/DK-37/DK-38 owners.
Its complete five-file minimum is 21, including the original generated owner,
all three engines, 24 source mutants, original WPT and two new custody checks.
Compiler-family binding and original/private native execution use the current
fresh-source custody API. Captured inputs reject copied authority and changed
file identity; Cargo updates only the current vendored dependency graph.

Normal model/archive generation and readback plus 13 isolated source/oracle
checks passed in the pinned container during integration. They are not complete
generated-owner acceptance. Current full owner, source audit, native records,
SDK integration and unchanged raw-provider acceptance remain required.
The historical receipts below do not qualify the current source closure.

Pinned Noble SDK/devcontainer image:
`sha256:60226bc791d4c0e5613402a6be7e63f4963d3faf7f327befcf56fc0e41d0ce21`.
Rust 1.97.1, Lean 4.32.1, Node 22.23.2, Playwright/core 1.62.1.

The first complete attempt reached a genuine provider failure after 254.758 s:
source/kernel/observed axioms, native std/no_std, two independent Wasm builds,
all 1,220 vectors, artifact/compiler substitution guards and Chromium journeys
passed. Firefox's original ECDSA WPT entry failed 24 cases. The subsequent
23 source mutations were not reached; this attempt is not complete evidence.

Historical component identities:

- Source: `a1b4bbbfd7fcf4569e8ac9c6588cb439b012ff9cd97200f76148a6963238469f`.
- Attestation: `454795c005098c097b68a2eb0fc84f045a7b156331ee7b22edd5dc39d23d38f3`.
- IR: `1ee683789640c1a3b98fbf6231d07b34f2ce83f758197250d02bd65f06ad1fcc`.
- Wasm: `38d630d941a2b5f9c62dafbeb2724e07b809778380d969e78bcb2424c9697661`.

A fixture-only correction serves immutable original WPT scripts through actual
loopback HTTP, including worker imports. A separate diagnostic collected all
1,944 cases: Chromium 151.0.7922.34 passes 324 per realm; Firefox 153.0 and
WebKit 26.5 each fail 24 per realm (48 per browser, 96 total). Both Window and
DedicatedWorker complete all 324 cases with harness status zero. Every failure
remains a failure. Exact raw
results SHA-256: `95bfef514cb5629a9a19ff6275cb3e0bc1a345fb36c45aae000aeae5e3603011`.

The pinned WPT revision is `986e75d7897742148c16253c08c50c8ba0e7b0f7`.
Its `signature.js` transfers the signature/data buffer unconditionally on each
algorithm-name getter read. The raw minimal reproduction observes one read in
Chromium and two in Firefox/WebKit; the second transfer throws on the detached
buffer (`TypeError`, including WebKit's `Receiver is detached`). This is a
provider/oracle normalization disagreement, not the corrected HTTP/worker
harness issue or evidence that either browser is categorically unsupported.
The unresolved normative clarification is [WebCrypto issue 563](https://github.com/w3c/webcrypto/issues/563).
The original source is not patched and upstream failure metadata is not an
exemption. SDK captured-byte behavior is a distinct, narrower API; its separate
three-engine diagnostic is not provider conformance. WebKit's independently
observed invalid-point import also requires generated point admission before
key facts can be trusted.

Current orchestration retains every required check, collects independent
browser/source failures, and throws an aggregate before any success receipt.
Generated baseline and artifact integrity remain safety prerequisites. A
failed pristine browser cannot authorize host-mutant evidence. Three new
construction tests include actual Node failed-child propagation, missing check
refusal and an executed removed-final-guard defect. Source/installed owner
minimum is 17; every original case remains required.

Current bounded checks: all 39 construction/complete SDK boundary tests pass
(81.704 s), including the actual removed-final-guard defect and complete static
owning closure. Normal model writer/readback and specification bijection pass
(186 IDs, 86 error codes). Earlier authored-format owner: 5/5 (4.53 s).
These are not a fresh complete component or installed-image receipt.

The complete aggregate attempt at source commit `d135287` finished in 1,865.991 s:
13/17 tests passed, four failed, none skipped or cancelled. Generated 1,220-case
parity, artifact substitution checks and final closure passed. Chromium and
Firefox each passed 29 SDK journeys, exact native replay and six host mutants.
All 23 source mutants ran: 21 produced genuine compiled counterexamples;
`ContextValidity` and `KeyValidity` failed strict `LLV7006` unused-parameter
warnings, not behavioral verification. Their constant-body fixtures were invalid.

The corrected fixtures preserve parameter use and target the exact existing
purpose-range/key-prefix counterexamples. Their construction regression fails
on the former fixtures. A fresh source-only diagnostic now passes the unchanged
1,220-case baseline and detects all 23 actual compiled mutants in native
std/no_std and Wasm. Final frozen-input checks and compiler-cache retirement
pass. Diagnostic SHA-256:
`531cb5704a72661f6ad65a96b331da3cdd6e0664a2945c1eb6fa74edcd9da00f`;
retained at `prismpm-signed-context-mutants:/tmp/prismpm-signed-context-N4wZEG/`
and workspace `PrismPM/target/signed-context-mutants-zPvPCb/`. This separate
diagnostic does not execute WPT or establish complete owner acceptance.

The original raw WPT failures remain unchanged. WebKit's pristine SDK journey
also failed: its invalid-point verification returned `signature-rejected`, not
the required invalid-point error. A separately labeled historical-artifact
diagnostic reproduced that exact branded counterexample; it did not authenticate
the invalid key. WebKit host-mutant acceptance was correctly refused without a
passing pristine baseline. Generated point admission remains required.

Attempt receipt: `fc165e27ec33946b7730561aa0aea3a00a8576a7b8ea3998806816bfd18c732d`;
all 846 original input files were independently rehashed afterward. Compiler
caches retired normally, and no successful owner receipt was written. Logs:
`/tmp/dk32-owner-report-VODIOl`; artifacts:
`/tmp/prismpm-signed-context-qtdZY7` in `prismpm-signed-context-owner`.

Remaining: authoritative clarification and reviewed oracle/provider update
for the unchanged raw-provider checks; accepted DK-34 generated curve-point
admission before provider import/key facts; fresh
complete three-engine/source/host verification and installed SDK acceptance.
The normative original-WPT requirement is unchanged.

Local diagnostic logs are retained in `prismpm-signed-context-owner` at
`/tmp/dk32-owner-report-SSdk6q`; the source/artifact component is retained at
`/tmp/prismpm-signed-context-6zns2l`. Workspace copies of logs and raw reports
are under `PrismPM/target/dk32-verification-am2VCNyb/`.

## Source P-256 integration — conditional, 28 September 2026

DK-32 now calls the unchanged DK-34 predicate for both expected and signer
keys, retaining signing-grant validation and key-before-signature errors.
The former off-curve protocol fixture is replaced by the exact SEC2 generator;
a second valid point protects key-mismatch semantics. All 15 imported NIST
point cases remain covered, alongside coordinate and off-curve mutations.
The source-call regression failed before implementation; the historical
generated Wasm also demonstrably accepted the former off-curve key.

The fresh closure kernel-verifies 12 modules and 723 declarations, including
the exact transitive axiom policies. All 1,573 vectors pass twice in native
std/no_std and actual Wasm; independently generated Wasm packages agree.
Maximum observed memory is 9,633,792 bytes under the unchanged 1 GiB ceiling.
Each of the three pinned engines passes 111 SDK journeys, 195 actual generated
calls replayed in native std/no_std, and all six host mutants. All 82 invalid
point cases reject without provider import; five oversized expected keys
retain host input refusal while their signer-side envelopes reach model refusal.

The unchanged raw WPT was rerun in Window and DedicatedWorker: Chromium
passes all 648 cases; Firefox and WebKit each retain 48 failures. The diagnostic
exits unsuccessfully and cannot produce complete owner acceptance. The pinned
generator separately refuses the new genuine kernel IR at static-list lowering.
Native/Wasm/browser evidence uses the explicitly unmerged reviewed compiler
capture `4fd80efbaf6bab84acde401eadc9ccdb73a30898`, executable
`a25445458084f6ca564af287591e5997f20f4f3db9a0c79668c304b38351e72c`.

Retained in `prismpm-signed-context-point-owner:/tmp/prismpm-signed-context-oYBQwS`:
source `19fb7c3c6496cd4e7a8c531d29f74bb096aea936ac6b732324f45e5c4ed02401`,
attestation `d1b97c587a8af9e1714e315c1f02ca08efe2a57d403093ffc276040c05deb33f`.
The initial missing exact axiom-policy failure is retained separately; it was
corrected by declaring the actual imported policy, not bypassing verification.

All 24 source mutants are detected by fresh kernel/native std/no_std/two-Wasm
execution on this exact frozen closure. The three focused validity probes and
remaining 21 probes have a checked, duplicate-free union; no older source
revision or compile failure counts as detection. Union receipt in the same
container: `/tmp/point-admission-24-mutant-union.json`, SHA-256
`6c144c3231bc3c17fdb2d27a38bcd12f89bf258b03827db45071a0867c93bd5e`.

Both complete DK-32/DK-34 owners, raw-provider resolution, an immutable SDK
release and full consumer acceptance remain required. This integration is not
account possession, authority or Foundry application acceptance; SDK pins and
public refusal remain unchanged.
