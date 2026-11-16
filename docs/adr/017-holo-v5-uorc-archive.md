# ADR-017: Holo v5, a Prism Application Is a UORC Archive Named by κ

## Status
Proposed, 2026-11-13. Supersedes ADR-015. Amends ADR-016 §2.4, §2.8, §3 and §4.2 to §4.4 for application holos.

## Context
- A v4 `.holo` names its parts with BLAKE3: a 71-byte `blake3:` label on every content blob and a 32-byte BLAKE3 footer over the body. ADR-015 then adds sha256 beside every BLAKE3 digest, because OCI registries, cosign, Kyverno and in-toto tooling know sha256 and not BLAKE3. Every statement, lock row and policy input therefore carries two digests of the same bytes, and every verifier checks both.
- The UOR Framework's content address is κ (uor-addr): `sha256:` and the 64 lowercase hex digits of the SHA-256 of an object's canonical bytes. LexLean #127 moved its own addresses to κ. Foundry and every product it builds are moving every identity to κ, and BLAKE3 survives nowhere.
- UOR-Foundation/compression already defines a self-contained container of ordered objects: the raw UORC archive (`Uorc.Codec.Archive.rawArchive`, what `uorc::archive::raw_objects` writes) sealed by UORC-SHA256-CHAIN-v1. It has its own verifier (`uorc verify`, `uorc inspect`) and a wasm client. Holo v4 restates a frame, an integrity trailer and object labels that UORC already has.
- The κ of a file is SHA-256 over the file, which is also the OCI layer digest of that file. A second "archive digest" is not needed.

## Decision
1. **Container.** A holo v5 is one self-contained raw UORC archive, format 2, profile 1:

   ```text
   "UORC" 02 01 | scope 00 | representation 00 | uleb(count) | uleb(length)* | uleb(bodyLength) | body | seal[32]
   ```

   `body` is the objects end to end; `seal` is UORC-SHA256-CHAIN-v1 over every byte before it. ULEB128 numbers are in shortest form. A reader applies a decode budget of 16 objects and 2^30 body bytes before it returns any object. Any UORC reader opens a holo without Prism code; `tests/data/holo-v5-uorc-oracle.json` records what `uorc inspect` reports for each fixture, and both Prism readers are held to it.
2. **Roles.** Prism defines only what the ordered objects are:

   | # | Role | Bytes |
   |---|------|-------|
   | 0 | `manifest` | canonical JSON, schema `prism/holo/5` |
   | 1 | `source-manifest` | the v4 metadata section, unchanged |
   | 2 | `provenance` | canonical JSON, schema `prismpm/model-provenance/2` |
   | 3 | `capabilities` | the capability set |
   | 4 | `guest` | the Core-Wasm guest |
   | 5 | `view` | the HOLOVIEW bundle |
   | 6 | `model` | the model document |
   | 7 | `attestations` | optional: Sigstore bundles as JSON Lines, present only when signed |

   The manifest names the application, the optional `basis` (the κ of the Prism SDK image the product pins in `prismpm.lock`), `requires` (the κ of the capability set), the two layers (`wasm` with entry `holo_run` and its contract; `view` with entry `index.html`, surface `portable`), and the role, κ and length of objects 1, 3, 4, 5 and 6. It replaces v4's binary AppManifest and its application directory, which restated the same references. The provenance names the manifest by κ (`application_kappa`), so the manifest does not list the provenance.
3. **Identity.** Every identity is a κ-label. The κ of the manifest is the application's identity; the κ of the file is the holo's identity, its OCI digest and the `holo` member of a verdict. There is no BLAKE3 label, footer or fingerprint.
4. **Digest sets.** Every in-toto DigestSet Prism writes for a holo v5 is `{ "sha256": <hex> }` alone, the κ without its prefix. This replaces ADR-015 §2 to §14: statement subjects (provenance, proof, replay), the proof predicate's model document, the replay predicate's model and histories, and provenance dependency rows. A verifier refuses a subject of a v5 holo that carries any other key, so a statement cannot name the same object two ways.
5. **Signing.** Attaching bundles appends object 7 and reseals; stripping removes it and returns the unsigned archive byte for byte. Subjects are content objects, so a bundle stays valid when the holo moves.
6. **Version policy.** Writers emit v5. A v4 holo stays readable as legacy, under ADR-015, so existing verdicts and statements about it still check, but it cannot be signed: attaching refuses it. `upgrade_application` re-emits a v4 holo as v5, keeping every content object byte for byte; its old statements name BLAKE3 labels, so it is signed again.
7. **Not now.** A conditional UORC archive over the SDK basis (storing only what differs from the pinned SDK) needs a caller-supplied basis in uorc and is a later change. `sdk-lock/3` still records two digests; `sdk-lock/4` drops BLAKE3 separately.

## Consequences
- **PrismPM**: `holo::v5` (Rust) and `sdk/npm/prism-code/src/uorc.mjs` write and read the container; `compose_application` writes v5; `parse_application`, attestations, provenance, `prismpm check` (`inspect/verdict_v5.rs`) and `@prism-code/verify` (`src/holo5.mjs`) read v5 and v4. The proof statement model (`bindings/src/Foundation/Proof/V1/Statement.lex.tex`) emits κ digest sets and is regenerated. `@prism-code/spec` gains `HOLO_V5` and `prismpm/model-provenance/2`; predicate and statement schemas require `sha256` and accept `blake3` only beside it, for v4.
- **Smaller files**: the Calculator holo is 23,885 bytes as v5 against 24,801 as v4.
- **Foundry and products**: every stored holo identity, snapshot, ref, proof-reuse key and gallery media address becomes κ. A product re-pins to the SDK release that writes v5.
- **Hologram**: reads v5 through any UORC reader; its own tensor archives are outside this ADR.
- **Identity break, once**: every application holo changes bytes and identity when rebuilt. Content objects keep their bytes, so the guest, view and model κ equal the sha256 ADR-015 already published for them.
