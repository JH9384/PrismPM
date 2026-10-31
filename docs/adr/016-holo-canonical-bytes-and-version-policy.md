# ADR-016: `.holo` Normative Home, Canonical Bytes, and Version Policy

## Status
Proposed (2026-10-29)

## Context
`.holo` is defined in three places that disagree:

- `Hologram-Technologies/hologram` @ `b6d9a76ca953`: the working codec (`crates/hologram-archive/src/format.rs`, `writer.rs`, `loader.rs`) at physical version 4. Its prose spec (`specs/refactor/03-holo-format.md`) still describes v3.
- `Hologram-Technologies/hologram-live` @ `cbbf97b5b819`: the application directory, HOLOVIEW bundle and Core-Wasm guest contract (`src/holo_directory.rs`, `src/holo_view.rs`, ADR-004/006/011/018).
- PrismPM `stdlib/src/Foundation/Holo/V1`: a formal model of two fixed Holo/1 app shapes, checked against pinned copies of the two repos above (`docs/adr/003-independent-oracle-scope.md`).

Two rules that content addressing depends on are written down nowhere:

1. **Canonical bytes.** hologram's writer emits weights in hash-map iteration order (`crates/hologram-archive/src/weight.rs:83`, `writer.rs:388-397`), an order nothing specifies or guarantees. The effect is observed in hologram-ai, which builds on a fork that writes v2: compiling SmolLM2-135M from the same ONNX file twice, with identical flags, gave archives differing in 247,278,842 of 542,167,727 bytes. That the fork shares this weight-store code is likely but unconfirmed. hologram writes content blobs in insertion order and allows duplicates (`writer.rs:171-176`); PrismPM requires strictly ascending κ and rejects duplicates (`Wire.lex.tex:289`, `WireCorpus.lex.tex:387,397`). hologram's warm-start re-fold appends its section last, outside kind order (`crates/hologram-exec/src/warm.rs:114`), through a second serializer (`warm.rs:120`) that also carries the input's flags through.
2. **Version policy.** hologram writes 4 and reads 2..4 (`format.rs:21,26`, `loader.rs:157`). PrismPM accepts only 4 (`Format.lex.tex:39`, `WireCorpus.lex.tex:233,241`). Neither says when the version must change or what an older archive's identity is.

PrismPM is the SDK Hologram is built with, so the definition belongs upstream here. A runtime then consumes generated code instead of maintaining its own.

## Decision

### 1. Normative home
`stdlib/src/Foundation/Holo` is the only normative definition of the `.holo` container, its section payloads, the app manifest, and the hologram-live formats listed above. hologram's `specs/refactor/03-holo-format.md` and hologram-live's format ADRs become informative and are marked superseded by this ADR. `hologram-archive` replaces its hand-written codec with code generated from this module.

### 2. Canonical bytes
A `.holo` is canonical if and only if all of the following hold. Readers reject a non-canonical archive.

1. **Header.** Magic `HOLO`, physical version 4, flags 0, section count equal to the number of table rows. Integers are little-endian throughout.
2. **Table.** Each row is kind u8, seven zero bytes, offset u64, length u64 (24 bytes).
3. **Payloads.** Contiguous, in table order, starting immediately after the table. No gaps, no overlap, no bytes between the last payload and the footer.
4. **Footer.** 32-byte unkeyed BLAKE3 over every preceding byte. PrismPM models this hash itself; it is no longer delegated to adapters.
5. **Section order.** AppManifest (15) first when present, then every other section in ascending kind discriminant. Only Extension (14) and ContentBlob (16) may repeat. Repeated Extension sections are ordered by key bytes, ascending; repeated ContentBlob sections by κ-label bytes, ascending. A duplicate key or κ is rejected.
6. **Empty sections.** A section that would encode zero entries is omitted.
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

## Consequences

- **PrismPM**: no byte changes. Its existing profiles already conform (sections 15, 8, 14, 14, 16×4; extension keys `https://hologram.foundation/…` before `https://uor.foundation/…`; blobs ascending). Work: model the footer hash, number every SectionKind and LayerKind constructor, generalize the fixed 8-section frame, and add corpus probes for out-of-order sections, an empty section, duplicate extension keys, unsorted weights, and a two-run determinism check. Register each new identity in `model/*.toml` before citing it (AGENTS.md).
- **hologram**: until the generated codec lands, `hologram-archive` sorts weights, constants, content blobs and extensions, rejects duplicates, and omits empty sections. Its reader enforces order, padding and flags. `warm.rs` inserts WarmStart in kind order and goes through the single writer. Mark `specs/refactor/03-holo-format.md` superseded.
- **hologram-live**: moves its directory, view and Core-Wasm definitions into Foundation.Holo, then regenerates. It accepts v4 only today, so it changes no policy.
- **hologram-ai**: leaves `humuhumu33/hologram` (still writing v2) for the generated codec.
- **Identity break, once**: re-emitting existing tensor archives that contain two or more weights changes their bytes and footer, so any stored identity of such an archive is invalid. Archives without weights are unaffected; no other archive changes.

## Open questions
1. Capability storage roots and publish/subscribe channels: set or sequence? Sorting them changes the κ of every existing capability set that lists more than one.
2. DTypeRegistry (5) is declared but never written, and Trace (7) is opaque. Define each, or retire it (its discriminant stays reserved)?
3. Do long-lived v2/v3 archives need a normative read spec, so they stay readable after the shim is removed?
4. Naming: module `Foundation.Holo.V1` and profile name "Holo/1" against physical version 4. Should the module track the physical version?
5. What is an archive's identity: its footer (ArchiveFingerprint), a κ over the whole file (ArchiveKappa), or the manifest κ (unchanged between fat and thin packaging)? `Identity.lex.tex` names all three roles but does not relate them.

## References
- hologram `crates/hologram-archive/src/format.rs:21,26`; `writer.rs:121-176,187,217-224,388-397`; `weight.rs:83,92`; `loader.rs:157,252`
- hologram `crates/hologram-exec/src/warm.rs:114,120`
- hologram `specs/refactor/03-holo-format.md`
- PrismPM `stdlib/src/Foundation/Holo/V1/Format.lex.tex:39`; `Wire.lex.tex:210,218,289,379,395`; `WireCorpus.lex.tex:233,241,249,257,273,313,387,397`
- PrismPM `docs/adr/003-independent-oracle-scope.md`, `docs/adr/015-dual-digests.md`
- hologram-live `specs/adrs/009-inference-model-holo-v4.md`
