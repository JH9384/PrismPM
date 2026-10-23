# Proposal 266: proof predicate `prism/proof/v1` with a named TCB

| | |
| --- | --- |
| Issue | [#266](https://github.com/UOR-Foundation/PrismPM/issues/266) |
| Milestone | M2 v0.5 Lock, check, proof |
| Status | Proposed, Experimental |
| Predicate type | `https://uor.foundation/prism/proof/v1` |
| Depends on | #263 (`@prism-code/spec`), #274 (dual digests) |
| Blocks | #268 (provenance at build), #269 (assurance levels), `@prism-code/verify` |

## Summary

Every Prism application ships proofs that the Lean 4 kernel has checked.
Today that fact is buried in `.prism/verified/<id>/` on the build host.
This proposal lifts it into one signed statement that travels with the `.holo`.
The statement is an in-toto Statement v1 in a DSSE envelope.
Its subject is the shipped Core-Wasm guest blob, digested with BLAKE3 and SHA-256.
Its predicate names the verifier, the model, every theorem with its verdict, and the trusted computing base (TCB).
A consumer checks it offline without Lean: signature, subject, verifier pin, verdict.
Every field is projected from evidence the build already writes.

## Motivation

The honest claim of the Prism SDK has two halves.
Every application ships machine-checked proofs of its model.
The toolchain is attested and reproducible, not proven.
Nothing in a `.holo` today states that claim in a form a third party can check.
The `prismpm/model-provenance/1` extension records commits and digests but no verdict.
The `prismpm/application-verification-manifest/1` holds the verdict but stays on the build host.
Consumers, registries and policy engines need the verdict next to the artifact.
The SLSA ecosystem already has a shape for "a verifier looked at this subject and reached this result".
This proposal reuses that shape and adds the one thing SLSA lacks: a named TCB.

### Goals

- One statement per application that says which theorems were checked, by which kernel, with which result.
- A subject any OCI, Sigstore or IPFS tool can match: the guest blob, with `blake3` and `sha256`.
- An explicit TCB list. Each entry says whether it is trusted or verified. None is verified.
- Offline checkability by `prism check` and `@prism-code/verify` without a Lean toolchain.
- Every field traceable to a file the SDK writes today.

### Non-goals

- Making the proof re-checkable without Lean. That needs `.olean` files or a kernel in the browser. See Alternatives.
- Proving the Lean-to-Rust renderer, rustc or wasm-bindgen. They stay trusted.
- Defining the assurance levels. #269 owns P0 to P3. This predicate only states which level it supports.
- Defining the DSSE signing keys or the bundle section. #267 owns both.
- Changing `.holo` physical v4 or `prismpm/model-provenance/1`.

## Proposal

User stories.

- A registry operator runs `prism check app.holo` on a mirror with no Lean. They learn that five theorems passed under the Lean 4.32.1 kernel in a pinned SDK image.
- A Kyverno or cosign policy matches the guest blob's `sha256` against the statement's subject and requires `verifiedLevels` to contain `P2`.
- An auditor reads the `tcb` list and knows exactly what they trust. It names the Lean kernel, LexLean, lean4-prod, rustc, wasm-bindgen and the SDK image.
- A browser page loads the `.holo` with `prism-code` and shows "proofs checked" only when the statement verifies.

Risks and mitigations.

- Risk: the statement is read as "the wasm is proven correct". Mitigation: the TCB list and the fixed wording in "The named TCB" below.
- Risk: a verifier trusts a statement signed by anyone. Mitigation: #267 pins the trust root; this predicate only defines what the signature covers.
- Risk: the `blake3` digest algorithm is unknown to upstream tools. Mitigation: `sha256` always accompanies it; #274 tests discovery.
- Risk: `timeVerified` breaks byte-identical builds (RP-09, HO-06). Mitigation: the statement lives in the attestation bundle, which #267 must exclude from reproducibility comparison. Unresolved question 1.
- Risk: today Lean runs in `prismpm verify`, not `prismpm build` (SPEC §6). Mitigation: the statement is produced wherever Lean runs; the roadmap (#254, #268) folds that step into `prism build`.

## Design details

### Statement envelope

The statement is an in-toto Statement v1 inside a DSSE envelope.
PrismPM already validates in-toto Statement v1 with `sdk/oracles/go/intoto-statement-validator` (SC-02).

| Field | Type | Value | Source |
| --- | --- | --- | --- |
| `_type` | string | `https://in-toto.io/Statement/v1` | fixed |
| `subject` | array, exactly one | `{ name, digest: { blake3, sha256 } }` | holo identities, guest blob |
| `subject[0].name` | string | build-manifest path of the guest, e.g. `core-wasm/prism_calculator_core_wasm.wasm` | `manifest.json` row of kind `artifact` |
| `subject[0].digest.blake3` | hex, 64 chars | the guest content blob's label without the `blake3:` prefix | `holo-identities.json` `guest_content_kappa` |
| `subject[0].digest.sha256` | hex, 64 chars | SHA-256 of the same bytes | `manifest.json` row `sha256` |
| `predicateType` | string | `https://uor.foundation/prism/proof/v1` | fixed |
| `predicate` | object | `ProofPredicateV1` below | projected |

The subject is the guest blob, not the archive.
The archive footer changes when the View or the bundle changes; the proof does not.
A statement about the archive would be invalidated by adding the bundle that carries it.

### Predicate fields

Every field is required unless marked optional.
Digests are lowercase hex without an algorithm prefix, as in-toto DigestSet requires.

```ts
interface ProofPredicateV1 {
  verifier: {
    id: "https://uor.foundation/prism/verifier/lean4";
    lean: { version: string; commit: string };
    lexlean: { version: string; commit: string; crateSha256: string };
    prismpm: { version: string };
    sdkImage: string;                       // "<repo>@sha256:<hex>" from prismpm.lock
  };
  policy: { uri: string; digest: { sha256: string } };
  model: {
    document: { sha256: string; blake3: string };
    sourceId: string;
    semanticId: string;
    snapshotId: string;
    compilerSemanticsId: string;
    leanManifestSha256: string;
    modules: { name: string; leanSha256: string }[];
  };
  theorems: {
    name: string;                           // as declared in the generated Lean
    module: string;
    verdict: "PASSED" | "FAILED";
    axioms: { policy: { kind: "none" | "allow" | "exact"; axioms: string[] }; observed: string[] };
  }[];
  verificationResult: "PASSED" | "FAILED";
  verifiedLevels: ("P0" | "P1" | "P2" | "P3")[];
  tcb: { component: string; role: string; version: string; digest?: string; trust: "trusted" }[];
  evidence: {
    lexleanAttestation: { sha256: string };
    verificationManifest: { sha256: string };
  };
  timeVerified: string;                     // RFC 3339, UTC
}
```

| Field | Justification | Source today |
| --- | --- | --- |
| `verifier.id` | SLSA VSA requires a URI. The issue's short name `lean4` is its last segment. | fixed |
| `verifier.lean` | Names the kernel that produced the verdict. | `tools.lock` `[lean]` `release`, `commit` |
| `verifier.lexlean` | Names the compiler whose Lean output was checked. | `model/dependencies.toml` `lexlean`; `model-provenance.json` `lexlean_commit`, `lexlean_package_sha256` |
| `verifier.prismpm` | Names the producer of the statement. | `prismpm.lock` `sdk_version` |
| `verifier.sdkImage` | Pins the image that hosted the check. A consumer compares it with its own lock. | `prismpm.lock` `sdk_image` (SPEC §13) |
| `policy` | VSA shape. The policy is the per-declaration `axiom_policy` table. Its digest is the snapshot that carries it. | `lexlean/snapshot.json`, `snapshot_id` |
| `model.document` | The model the theorems are about. SHA-256 is `model_id`; BLAKE3 is the content label. | `model-provenance.json` `model_id`, `model_content_kappa` |
| `model.sourceId` and siblings | Bind the `.lex.tex` sources, their semantics and the compiler. | `model.prism.json` `provenance` |
| `model.leanManifestSha256` | Binds the LexLean build manifest that lists every generated Lean file. | `model-provenance.json` `lean_manifest_sha256` |
| `model.modules[]` | The Lean modules that were elaborated and replayed. | `manifest.json` rows of kind `lean` |
| `theorems[].name` | Full Lean name: namespace plus declaration, as written in the generated module. | LexLean attestation `declarations[].name` |
| `theorems[].axioms` | The audit PrismPM already enforces: observed axioms against declared policy (VR-05). | attestation `declarations[].observed`, `policy` |
| `theorems[].verdict` | Per-theorem result. Today a `verified` attestation implies every row is `ok`. | attestation `declarations[].result`; leanchecker process records |
| `verificationResult` | VSA shape. PASSED only when every theorem is PASSED and every leanchecker replay exited 0. | verification manifest `processes` |
| `verifiedLevels` | VSA shape. This statement alone supports at most `P2`. | fixed `["P2"]` until #269 |
| `tcb` | The named trusted computing base. See below. | `tools.lock`, `model/dependencies.toml`, `prismpm.lock` |
| `evidence` | Lets a re-checker fetch the retained evidence by digest. | `verification-manifest.json` `lexlean_attestation_sha256`; attestation id (SPEC §8) |
| `timeVerified` | VSA shape. Not an input to any identity. | clock at statement time |

Theorem names come from the generated Lean, not from the `.lex.tex` source.
The calculator module is `PrismCalculator.Calculator` (`module_prefix` plus entrypoint name).
Its theorems are `addCorrect`, `subtractCorrect`, `multiplyCorrect`, `divideCorrect` and `calculate_correct`.
The generated file declares them as `public theorem addCorrect …` inside `namespace PrismCalculator.Calculator`.
The full name is therefore `PrismCalculator.Calculator.addCorrect`.

Only theorems are listed.
Definitions, structures and inductives have axiom audits too, but they are not claims.
A consumer who wants them reads the LexLean attestation by its `evidence` digest.

### Example statement for the calculator

Digests below are read from `calculator-example` `artifacts/Calculator.holo` and `artifacts/build-manifest.json`.
The SDK image digest and `timeVerified` are illustrative; the calculator repository does not commit its `prismpm.lock`.

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    {
      "name": "core-wasm/prism_calculator_core_wasm.wasm",
      "digest": {
        "blake3": "2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380",
        "sha256": "dcf53677c7c80636f8fc2247676b8f747d1549ce4af742c8505eb0f0ae334c03"
      }
    }
  ],
  "predicateType": "https://uor.foundation/prism/proof/v1",
  "predicate": {
    "verifier": {
      "id": "https://uor.foundation/prism/verifier/lean4",
      "lean": { "version": "v4.32.1", "commit": "f054605aea4b840552cca2e725580bffd1e1b704" },
      "lexlean": {
        "version": "0.3.0",
        "commit": "0b53334e5846a1f5e5d9bb3bf6959c085daa4d08",
        "crateSha256": "feedcdaf2a18a9e63d2bbe1dd744f7fa790a2bc3af4a85a10403f7de10676a64"
      },
      "prismpm": { "version": "0.3.0" },
      "sdkImage": "ghcr.io/uor-foundation/prismpm@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    },
    "policy": {
      "uri": "https://uor.foundation/prism/proof/v1/policy/axiom-audit",
      "digest": { "sha256": "34dc17084bb03c1397da9e7b8505b4173c1b4b133ed3656d403eb45bca590da8" }
    },
    "model": {
      "document": {
        "sha256": "074921890f5c372c89f4ed794d26dd550231d5e9bf99bf9474cc1a78923292c6",
        "blake3": "e76544838a98c46341ed8807f72897ec68de5a8a9bf28721738a76761c9df90e"
      },
      "sourceId": "63611de07b58d03b3a9976b34138d903215e50c53ec2ba4ee3cdeb452b0710ad",
      "semanticId": "be75c14a6c6ae7c21e0bf6abe3c6312cf107fee86d6a01092306ba7162d4a949",
      "snapshotId": "34dc17084bb03c1397da9e7b8505b4173c1b4b133ed3656d403eb45bca590da8",
      "compilerSemanticsId": "49561889f77c9c3571da51e8e53233da9df5ab8f46d16165159425ba2e82dc44",
      "leanManifestSha256": "3779d20d45e41bf56ce8ca65e57767e527f14e56d028f1bb8116d87e08ac080a",
      "modules": [
        {
          "name": "PrismCalculator.Calculator",
          "leanSha256": "17792fa9c98f1c3f77d52f410e42b0e1ec6ac78026351fd949feab2594e27cda"
        }
      ]
    },
    "theorems": [
      { "name": "PrismCalculator.Calculator.addCorrect", "module": "PrismCalculator.Calculator", "verdict": "PASSED",
        "axioms": { "policy": { "kind": "none", "axioms": [] }, "observed": [] } },
      { "name": "PrismCalculator.Calculator.subtractCorrect", "module": "PrismCalculator.Calculator", "verdict": "PASSED",
        "axioms": { "policy": { "kind": "none", "axioms": [] }, "observed": [] } },
      { "name": "PrismCalculator.Calculator.multiplyCorrect", "module": "PrismCalculator.Calculator", "verdict": "PASSED",
        "axioms": { "policy": { "kind": "none", "axioms": [] }, "observed": [] } },
      { "name": "PrismCalculator.Calculator.divideCorrect", "module": "PrismCalculator.Calculator", "verdict": "PASSED",
        "axioms": { "policy": { "kind": "none", "axioms": [] }, "observed": [] } },
      { "name": "PrismCalculator.Calculator.calculate_correct", "module": "PrismCalculator.Calculator", "verdict": "PASSED",
        "axioms": { "policy": { "kind": "none", "axioms": [] }, "observed": [] } }
    ],
    "verificationResult": "PASSED",
    "verifiedLevels": ["P2"],
    "tcb": [
      { "component": "lean4-kernel", "role": "type-checks every listed theorem; the verdict is its acceptance",
        "version": "leanprover/lean4:v4.32.1", "digest": "f054605aea4b840552cca2e725580bffd1e1b704", "trust": "trusted" },
      { "component": "leanchecker", "role": "replays each module environment through the same kernel; not independent of it",
        "version": "leanprover/lean4:v4.32.1", "trust": "trusted" },
      { "component": "lexlean", "role": "translates .lex.tex into the Lean that was checked",
        "version": "0.3.0", "digest": "feedcdaf2a18a9e63d2bbe1dd744f7fa790a2bc3af4a85a10403f7de10676a64", "trust": "trusted" },
      { "component": "lean4-prod", "role": "exports LCNF from the checked Lean and renders the Rust core",
        "version": "c4078cf96537cd71c0818bbed0aa82300ef66786", "trust": "trusted" },
      { "component": "rustc", "role": "compiles the Rust core to the Core-Wasm guest, the subject",
        "version": "1.97.1", "trust": "trusted" },
      { "component": "wasm-bindgen-cli", "role": "generates the browser adapter around the guest; outside the subject",
        "version": "0.2.122", "trust": "trusted" },
      { "component": "sdk-image", "role": "hosts every step above; pinned in prismpm.lock",
        "version": "0.3.0", "digest": "0000000000000000000000000000000000000000000000000000000000000000", "trust": "trusted" }
    ],
    "evidence": {
      "lexleanAttestation": { "sha256": "64a57f317b61ca30f627293b304eee52be0dce3c060b2033098cf40770169498" },
      "verificationManifest": { "sha256": "07d48406772000cce194d0e0f85c02517d927d334cd25ef54b3b8b446a67ad56" }
    },
    "timeVerified": "2026-10-23T00:00:00Z"
  }
}
```

### The named TCB

A trusted computing base is the set of components whose failure would make the verdict false.
This predicate names every one of them and marks each `trusted`.
The Lean kernel at v4.32.1 is trusted: it is the checker, and nothing checks it.
`leanchecker` is trusted and is never called independent: it replays the environment through that same kernel.
LexLean is trusted to have written the Lean that was checked; the source maps make that reviewable, not proven.
lean4-prod, rustc and wasm-bindgen are trusted to have turned the checked Lean into the shipped bytes.
The acceptance corpus is evidence of that, not proof.
The SDK image is trusted because every step ran inside it.
No entry is `verified`, and the schema does not allow that value.
The docs and the site must use this wording: "Every Prism application ships machine-checked proofs of its model. The checker is the Lean 4 kernel at a pinned version. The toolchain that turns the model into the shipped program is attested and reproducible, not proven."
They must never write "independently verified", "proven correct", or "leanchecker independently confirms".

### How the statement is produced

The statement is projected after Lean has run, inside the SDK image.
Today Lean runs in `prismpm verify` (SPEC §6, §8); `build` makes no verification claim.
The roadmap folds that step into `prism build` (#254, #268).
This proposal describes the projection, not the verb that triggers it.

1. LexLean verifies the generated modules and writes `attestation.json` with `status: verified`. It lists every declaration's observed axioms and policy (`vendor/lexlean/schemas/attestation-v2.schema.json`).
2. PrismPM stages the attested Lean, runs `lake build`, then `lake env leanchecker <module>` per module. A nonzero exit is `PP5002` (SPEC §8, VR-04).
3. PrismPM validates the declaration audit against the snapshot. A mismatch is `PP5003` (VR-05).
4. PrismPM publishes `verification-manifest.json` with the normalized process records (VR-06, VR-07).
5. The projector reads the attestation for theorems and axioms, and `manifest.json` for the Lean and guest rows. It reads `model-provenance.json` for model and source ids, and `holo-identities.json` for the guest label. It reads `tools.lock` and `prismpm.lock` for the verifier and the TCB.
6. It computes SHA-256 over the guest blob and emits the statement as canonical JSON (`holo/canonical.rs` rules).
7. #267 wraps it in a DSSE envelope and stores it in the attestation bundle. On push the same bundle becomes an OCI referrer.

A failing build publishes no verified directory (SPEC §8).
A `FAILED` statement is therefore written only to the build's evidence directory, never into a `.holo`.
It exists so that a CI system can record and sign a failure.

### How the statement is checked offline

`prism check` and `@prism-code/verify` run these checks without Lean, Lake or the SDK image.
`prism-code` already parses the archive, recomputes every BLAKE3 label and reads the provenance extension (HO-20).

| Check id | MUST | What it compares |
| --- | --- | --- |
| `proof.envelope` | The DSSE signature MUST verify against the trust root from #267. | signature, payload type |
| `proof.statement` | `_type` and `predicateType` MUST be the fixed values; the predicate MUST validate against the JSON Schema. | shape |
| `proof.subject` | `subject[0].digest.blake3` MUST equal the guest blob's label; `sha256` MUST equal SHA-256 of the same bytes. | archive bytes |
| `proof.model` | `model.document.sha256` MUST equal the model blob's SHA-256 and the extension's `model_id`; `snapshotId` and siblings MUST equal the extension's values. | `prismpm/model-provenance/1` |
| `proof.verifier` | When a `prismpm.lock` is present, `verifier.sdkImage` MUST equal its `sdk_image`; `verifier.lean.version` MUST equal the pinned toolchain. | lock |
| `proof.verdict` | `verificationResult` MUST be `PASSED`; every theorem MUST be `PASSED` with `observed` within its policy. | predicate only |
| `proof.tcb` | `tcb` MUST contain the seven roles above and every `trust` MUST be `trusted`. | predicate only |
| `proof.level` | `verifiedLevels` MUST contain the level the caller's policy requires; default `P2` (#269). | predicate only |

Each failed check maps to one diagnostic in a new family, class `acceptance`, exit code 1:

| Code | Title |
| --- | --- |
| `PP5501` | Proof statement signature failure |
| `PP5502` | Proof statement shape failure |
| `PP5503` | Proof subject disagreement |
| `PP5504` | Proof model disagreement |
| `PP5505` | Proof verifier pin disagreement |
| `PP5506` | Proof verdict not PASSED |
| `PP5507` | Proof TCB incomplete |

### What `prism check` cannot know

Without re-running Lean, the checker trusts the signer for four things.

- That the kernel really accepted the proofs. The statement says so; only a replay shows it.
- That the shipped wasm computes what the Lean defines. No proof exists; the acceptance corpus is evidence.
- That the theorems mean what the author intended. Reading the generated Lean is the only way.
- That the named SDK image was the one used. The signature binds the claim, not the execution.

`prism check` must print these limits with its result, in one line each.

### Relationship to sibling work

- #268 provenance: a second statement about the same subject, predicate `https://slsa.dev/provenance/v1`. `resolvedDependencies` carries the lock; this predicate carries the verdict. Neither duplicates the other.
- #267 attestation bundle: carries both statements. This proposal does not define the section kind, the envelope keys or the referrer layout.
- #269 assurance levels: `verifiedLevels` uses its vocabulary. P2 means "proof checked". P3 needs replay and a declared world, which this predicate does not attest.
- #263 spec package: the type and schema land there, not here. Reserve `predicates/proof-v1.ts` exporting `ProofPredicateV1` and `PROOF_PREDICATE_TYPE`, and `predicates/proof-v1.schema.json` with `$id` `https://uor.foundation/prism/proof/v1/schema.json`. Rust and Python types are generated from it.
- #274 dual digests: this predicate assumes the decision "both digests, always". If #274 decides otherwise, `subject[0].digest.blake3` becomes optional and nothing else changes.

### Test plan

Fixtures live in `@prism-code/spec` under `fixtures/proof/` once #263 lands; until then under `sdk/npm/prism-code/test/fixtures/proof/`.

- `calculator.statement.json`: the example above with a real `sdkImage` from the calculator lock.
- `text.statement.json`: the same for the text/3 reference application used by `hologram_interop`.
- `calculator.tampered-subject.statement.json`: one hex digit of `subject[0].digest.sha256` changed. `proof.subject` MUST fail with `PP5503`.
- `calculator.failed.statement.json`: `verificationResult: FAILED` with one theorem `FAILED`. `proof.verdict` MUST fail with `PP5506`.
- `calculator.unknown-tcb.statement.json`: `tcb` missing `leanchecker`. `proof.tcb` MUST fail with `PP5507`.
- Every fixture MUST pass `intoto-statement-validator` (SC-02).

Conformance scenario. One Gherkin scenario per ID in `features/suites/verification.feature`, registered in `model/ids.toml` at level `build`.

| ID | MUST | Check id |
| --- | --- | --- |
| `VR-12` | A built application carries exactly one `prism/proof/v1` statement whose subject is its guest blob. | `proof.statement`, `proof.subject` |
| `VR-13` | The statement's model digests equal the archive's model blob and provenance extension. | `proof.model` |
| `VR-14` | The statement's verifier pins equal `prismpm.lock` and `tools.lock`. | `proof.verifier` |
| `VR-15` | Every listed theorem is PASSED with an empty observed axiom set under policy `none`, and the result is PASSED. | `proof.verdict` |
| `VR-16` | The statement names the seven TCB roles, each `trusted`. | `proof.tcb` |
| `VR-17` | A tampered subject, a FAILED verdict and a missing TCB entry are each rejected with their registered diagnostic. | `proof.subject`, `proof.verdict`, `proof.tcb` |

The traceability file is this table.
`cargo xtask validate-model` regenerates `CONFORMANCE.md` and SPEC Appendix A from `model/ids.toml`.

### Graduation criteria

- Experimental (M2). This document is merged. The type and schema are in `@prism-code/spec`. The fixtures above pass in `prism-code` tests. The calculator and text archives carry the statement.
- Frozen (M3). VR-12 to VR-17 are merged with their conformance tests. `prism check` emits the eight check ids and seven diagnostics. One release cycle passes with no field change.
- Stable (1.0). The predicate type URI is final, and any change becomes `prism/proof/v2`. `@prism-code/verify` and the Rust verifier agree on every fixture.

## Precedent

- SLSA Verification Summary Attestation. Copied: `verifier.id`, `policy`, `verificationResult`, `verifiedLevels`, `timeVerified`. Differs: `verifiedLevels` uses P-levels, and `tcb` is new. A VSA has no notion of what the verifier itself trusts.
- in-toto test-result predicate. Copied: a list of named results with a per-item verdict. Differs: our items are theorems with axiom audits, not test cases.
- Lean `.olean` plus `lake-manifest.json`. The only cheap re-check precedent. Not shipped here; see Alternatives. The `leanManifestSha256` and module digests keep the door open.
- Roadmap row: #254 "Proof predicate `prism/proof/v1` with a named trusted base (the Lean kernel)".

## Alternatives

- Ship `.olean` files inside the `.holo`. A consumer with Lean could replay them. Cost: the archive grows by the compiled closure, and the replay still runs the same kernel. Rejected for v1; the `evidence` digests let a consumer fetch them from the build host instead.
- Re-run Lean at install time. Honest and strong, but it needs the SDK image on every consumer. The browser path (HO-20) cannot do it at all. Rejected as the default; it remains the P3 path once #269 defines replay.
- No predicate, provenance only. SLSA provenance says who built it, not whether proofs passed. The verdict would stay on the build host. Rejected; it is the status quo.
- Subject is the archive footer. Rejected above: adding the bundle that carries the statement would change the subject.
- `verifier.id` equal to the bare string `lean4`. Rejected: VSA requires a TypeURI.

## Prior art

- SLSA VSA specification, `https://slsa.dev/spec/v1.1/verification_summary`.
- in-toto Attestation Framework, Statement v1 and the `test-result` predicate.
- Sigstore `model-transparency`, which signs a model's files and ships the signature beside them.
- Lean 4 `lean4checker`, which PrismPM invokes as `leanchecker`. Its own description: it replays a module's environment so the kernel accepts every declaration again.
- PrismPM `prismpm/model-provenance/1`, the pre-archive evidence this predicate reuses field by field.

## Unresolved questions

1. Does the attestation bundle section take part in RP-09 byte-identical builds? If yes, `timeVerified` must be dropped or fixed to `SOURCE_DATE_EPOCH`. #267 decides.
2. Which verb produces the statement before `prism build` absorbs verification: `prismpm verify` today, or a new `prismpm attest`? #268 decides.
3. The roadmap's `prism check` collides with today's `prismpm check`, which validates the model in memory (CT-03). One of them needs a new name.
4. Should definitions and inductives with nonempty axiom policies appear in `theorems`, or stay in the attestation only?
5. Is one statement per application enough, or does a multi-module application need one per module? The calculator has one module.
6. Which `prismpm.lock` field holds the SDK version for `verifier.prismpm`? `sdk-lock/2` fixes `sdk_version` to `0.3.0`; the lock needs a bump path first (#194).
