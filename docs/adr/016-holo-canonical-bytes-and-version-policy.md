# ADR-016: `.holo` Normative Home, Canonical Bytes, and Version Policy

## Status
Proposed (2026-10-29), amended 2026-11-01: one format for every Prism SDK application (§4), corrections from implementing the frame (§2.4 to §2.6). Amended by [ADR-017](017-holo-v5-uorc-archive.md) (2026-11-13): an application holo is now a UORC archive (holo v5) named by κ; §2.4, §2.8, §3 and §4.2 to §4.4 describe legacy v4.

## Context
`.holo` is defined in three places that disagree:

- `Hologram-Technologies/hologram` @ `b6d9a76ca953`: the working codec (`crates/hologram-archive/src/format.rs`, `writer.rs`, `loader.rs`) at physical version 4. Its prose spec (`specs/refactor/03-holo-format.md`) still describes v3.
- `Hologram-Technologies/hologram-live` @ `cbbf97b5b819`: the application directory, HOLOVIEW bundle and Core-Wasm guest contract (`src/holo_directory.rs`, `src/holo_view.rs`, ADR-004/006/011/018).
- PrismPM `stdlib/src/Foundation/Holo/V1`: a formal model of two fixed Holo/1 app shapes, checked against pinned copies of the two repos above (`docs/adr/003-independent-oracle-scope.md`).

Two rules that content addressing depends on are written down nowhere:

1. **Canonical bytes.** hologram's writer emits weights in hash-map iteration order (`crates/hologram-archive/src/weight.rs:83`, `writer.rs:388-397`), an order nothing specifies or guarantees. The effect is observed in hologram-ai, which builds on a fork that writes v2: compiling SmolLM2-135M from the same ONNX file twice, with identical flags, gave archives differing in 247,278,842 of 542,167,727 bytes. That the fork shares this weight-store code is likely but unconfirmed. hologram writes content blobs in insertion order and allows duplicates (`writer.rs:171-176`); PrismPM requires strictly ascending κ and rejects duplicates (`Wire.lex.tex:289`, `WireCorpus.lex.tex:387,397`). hologram's warm-start re-fold appends its section last, outside kind order (`crates/hologram-exec/src/warm.rs:114`), through a second serializer (`warm.rs:120`) that also carries the input's flags through.
2. **Version policy.** hologram writes 4 and reads 2..4 (`format.rs:21,26`, `loader.rs:157`). PrismPM accepts only 4 (`Format.lex.tex:39`, `WireCorpus.lex.tex:233,241`). Neither says when the version must change or what an older archive's identity is.

Every application built with the Prism SDK, including Hologram and Hologram AI, uses one `.holo` format, so the definition belongs upstream here. A runtime then consumes generated code instead of maintaining its own. This is a target: hologram at `b6d9a76ca953` depends on `uor-prism`, not on `prism-stdlib`.

## Decision

### 1. Normative home
`stdlib/src/Foundation/Holo` is the only normative definition of the `.holo` container, its section payloads, the app manifest, and the hologram-live formats listed above. hologram's `specs/refactor/03-holo-format.md` and hologram-live's format ADRs become informative and are marked superseded by this ADR. `hologram-archive` replaces its hand-written codec with code generated from this module.

### 2. Canonical bytes
A `.holo` is canonical if and only if all of the following hold. Readers reject a non-canonical archive.

1. **Header.** Magic `HOLO`, physical version 4, flags 0, section count equal to the number of table rows. Integers are little-endian throughout.
2. **Table.** Each row is kind u8, seven zero bytes, offset u64, length u64 (24 bytes).
3. **Payloads.** Contiguous, in table order, starting immediately after the table. No gaps, no overlap, no bytes between the last payload and the footer.
4. **Footer.** 32-byte unkeyed BLAKE3 over every preceding byte. LexLean has no hash primitive, so the model frames a footer it is given and does not compute one. §4.4 fixes where the value comes from.
5. **Section order.** AppManifest (15) first when present, then every other section in ascending kind discriminant. Only Extension (14) and ContentBlob (16) may repeat. Repeated Extension sections are ordered by key bytes, ascending, where key bytes exclude the u16 length prefix; with the prefix the existing extension order inverts (key lengths 62 and 49). Repeated ContentBlob sections are ordered by κ-label bytes, ascending. A duplicate key or κ is rejected. An archive with no sections is rejected, and so is an empty extension key.
6. **Empty sections.** A section that would encode zero entries is omitted. The frame rejects a zero-length section. Each payload codec rejects a section that encodes zero entries in more than zero bytes, such as hologram's empty KernelCalls and Weights (a 4-byte count of 0, written unconditionally at `writer.rs:133,138`).
7. **Lists.** Every list in every payload is either a sequence or a set, fixed per list by Foundation.Holo:
   - Sequences keep producer order because the order is meaning. These are kernel calls, schedule levels and their members, exec-plan levels, input and output ports, manifest layers (boot order), manifest children, certificates (node order), and shape-registry entries (indexed by shape id).
   - Sets are sorted ascending by their key bytes and reject duplicates. These are weights (by fingerprint), constants (by slot), content blobs (by κ), extensions (by key), and capability network endpoints (by the existing canonical endpoint order).
8. **Scalars.** Strings are a length prefix, then valid UTF-8 with no normalization and no terminator. κ labels are 71 bytes: `blake3:` plus 64 lowercase hex digits.
9. **Determinism.** A writer's output is a pure function of its semantic input. Conformance requires two independent runs to be byte-identical, and the output to match the corpus's golden BLAKE3 hashes.

These rules tighten v4 without changing its layout, so they do not bump the version. An existing v4 archive that breaks them is non-canonical and is re-emitted, not grandfathered.

### 3. Version policy
1. Physical version 4 is the only normative version. Writers emit 4.
2. Versions 2 and 3 are not defined normatively. A reader may load them through a documented, non-normative legacy shim. Such an archive has no canonical identity: it is never published, content-addressed or cited until re-emitted as canonical v4. PrismPM's validator stays v4-only.
3. Readers fail closed on a newer version, nonzero flags, nonzero padding, an unknown section kind, out-of-order or duplicate sections, and trailing bytes.
4. Closed sets (section kinds, layer kinds, Wasm guest-contract selectors) grow only by appending discriminants. A discriminant is never renumbered or reused, including after retirement. Producer-specific data goes in Extension sections, not new kinds.
5. Any change to a closed set, a payload encoding or a canonical rule bumps the physical version. A bump needs a PrismPM ADR and lands in Foundation.Holo and the generated codec before any runtime writes it.

### 4. One format for every application
Every application built with the Prism SDK, and every `.holo` such an application writes while running, is canonical under §2. No reader or writer has a private layout.

1. **Format and profiles.** The format is §2. A profile (portable application, browser application, tensor archive) only says which sections an archive must hold and what they mean; it never changes byte layout or section order. Every reader checks the canonical frame first and the profile second.
2. **Signed archives.** The attestation Extension is an ordinary extension in key order, not a last row. A signed application archive still has nine rows: AppManifest, Metadata, `https://hologram.foundation/extension/application-directory/v1`, `https://uor.foundation/extension/attestation-bundle/v1`, `https://uor.foundation/extension/prismpm-model/v1`, then four ContentBlobs. Attaching inserts that row and stripping removes it, and stripping still returns the unsigned archive byte for byte. Bundles stay valid when moved, because their subjects are content blobs, not the archive (`docs/proposals/267-attestation-bundle.md`). An archive signed in the old layout is re-emitted by stripping it and attaching the same lines.
3. **SDK paths.** `prismpm build` writes through a fixed eight-section composer (`application_build.rs` to `compose_application` to `archiveBody`), and readers enter through `parse_application`, `inspect` and `inspect/verdict.rs`, by section index. The general encoder and validator become the only path under them, including `BrowserWire` and `PrimaryWire`. The JavaScript reader and writer in `sdk/npm/prism-code` and `sdk/npm/verify` are a second implementation inside this repository: each passes the same corpus until it is generated.
4. **Footer source.** One SDK function seals a body, using the exact `blake3` crate version that HO-14's vector corpus qualifies. No application computes its own footer. The §2.9 golden hashes are checked in Rust conformance, outside the pure model. A LexLean BLAKE3 needs its own ADR.
5. **Hologram and Hologram AI.** These are two separate changes. Their own programs become Prism SDK applications. Separately, the tensor archives they write while running stop using `HoloWriter`: the callers in `hologram-compiler`, `hologram-cli` and `hologram-exec/src/warm.rs` move to the generated codec, and the second serializer in `warm.rs` is removed. The second change comes first and does not wait for the first.

### 5. Implementation order
Each step is one pull request. Steps 2 to 6 are in this repository.

1. The canonical frame ([#402](https://github.com/UOR-Foundation/PrismPM/pull/402)).
2. Signed archives in canonical order (§4.2), before the v0.4.0 tag. Latest release is v0.2.0 and `@prism-code/*` is not on npm, so the old layout has not shipped. This changes `Wire`, the corpus, `tests/holo-codec-oracle`, `tests/data/holo-codec-v1.json`, the Rust readers, `sdk/npm/prism-code/src/attestations.mjs`, the signed fixtures and `SPEC.md`.
3. Reject zero-section archives and empty extension keys. Express every profile, including `PrimaryWire`, over the general frame (§4.1, §4.3).
4. The shared footer function and a public write path for any canonical archive, not only the eight-section application (§4.3, §4.4).
5. Weights and Constants codecs, which fix the non-determinism in Context and let the corpus reject unsorted weights.
6. The remaining payload codecs and §2.7 list rules: KernelCalls, Schedule, ShapeRegistry, ExecPlan, Inputs, Outputs, Certificates, capability endpoints, WarmStart.
7. Publish `prism-stdlib`, or pin hologram to a PrismPM revision until it is published.
8. hologram: `hologram-archive` uses the generated codec (§4.5). Its reader accepts canonical v4 only, plus any §3.2 legacy shim.
9. hologram-live: move its directory, view and Core-Wasm definitions into Foundation.Holo, then regenerate.
10. hologram-ai: leave `humuhumu33/hologram` for the generated codec. Re-emit existing archives as canonical v4.
11. Build Hologram and Hologram AI themselves with the Prism SDK, once open question 6 is answered.

## Consequences

- **PrismPM**: unsigned archives keep their bytes, because the existing profiles already conform (sections 15, 8, 14, 14, 16×4; extension keys `https://hologram.foundation/…` before `https://uor.foundation/…`; blobs ascending). Signed archives change layout (§4.2). Work is in §5. Register each new identity in `model/*.toml` before citing it (AGENTS.md).
- **hologram**: until the generated codec lands, `hologram-archive` sorts weights, constants, content blobs and extensions, rejects duplicates, and omits empty sections. Its reader enforces order, padding and flags. `warm.rs` inserts WarmStart in kind order and goes through the single writer. Mark `specs/refactor/03-holo-format.md` superseded.
- **hologram-live**: moves its directory, view and Core-Wasm definitions into Foundation.Holo, then regenerates. It accepts v4 only today, so it changes no policy.
- **hologram-ai**: leaves `humuhumu33/hologram` (still writing v2) for the generated codec.
- **Identity break, once**: re-emitting changes the bytes and footer of existing tensor archives that hold two or more weights or an empty KernelCalls or Weights section, and of archives signed in the old layout, so any stored identity of such an archive is invalid. Every other canonical archive keeps its bytes. Hologram's writer emits both sections unconditionally, so this also reaches its archives with no kernels or no weights, such as hologram-live's.

## Open questions
1. Capability storage roots and publish/subscribe channels: set or sequence? Sorting them changes the κ of every existing capability set that lists more than one.
2. DTypeRegistry (5) is declared but never written, and Trace (7) is opaque. Define each, or retire it (its discriminant stays reserved)?
3. Do long-lived v2/v3 archives need a normative read spec, so they stay readable after the shim is removed?
4. Naming: module `Foundation.Holo.V1` and profile name "Holo/1" against physical version 4. Should the module track the physical version?
5. What is an archive's identity: its footer (ArchiveFingerprint), a κ over the whole file (ArchiveKappa), or the manifest κ (unchanged between fat and thin packaging)? `Identity.lex.tex` names all three roles but does not relate them.

6. What does it mean for Hologram's own program to be a Prism SDK application? `prismpm build` today produces one profile: a Core-Wasm guest with a model, a view and a fixed set of four content blobs. Does Hologram fit that profile, or does it need a new one (§4.1)? This blocks only §5 step 11.

## References
- hologram `crates/hologram-archive/src/format.rs:21,26`; `writer.rs:121-176,187,217-224,388-397`; `weight.rs:83,92`; `loader.rs:157,252`
- hologram `crates/hologram-exec/src/warm.rs:114,120`
- hologram `specs/refactor/03-holo-format.md`
- PrismPM `stdlib/src/Foundation/Holo/V1/Format.lex.tex:39`; `Wire.lex.tex:210,218,289,379,395`; `WireCorpus.lex.tex:233,241,249,257,273,313,387,397`
- PrismPM `docs/adr/003-independent-oracle-scope.md`, `docs/adr/015-dual-digests.md`, `docs/proposals/267-attestation-bundle.md`
- PrismPM `tests/holo-codec-oracle/src/main.rs` (`attestation_vector` calls `HoloWriter::assemble`, which keeps the order it is given; `HoloWriter::finish` writes extensions before content blobs, `writer.rs:167-177`)
- hologram-live `specs/adrs/009-inference-model-holo-v4.md`
