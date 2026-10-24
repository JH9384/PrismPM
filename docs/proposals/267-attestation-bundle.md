# Proposal 267: the attestation bundle inside the `.holo`

| | |
| --- | --- |
| Issue | [#267](https://github.com/UOR-Foundation/PrismPM/issues/267) |
| Milestone | M2 v0.5 Lock, check, proof |
| Status | Proposed, Experimental |
| Section | One Extension row, kind 14, named `https://uor.foundation/extension/attestation-bundle/v1`, always the last row |
| Bundle | Sigstore bundle v0.3, `application/vnd.dev.sigstore.bundle.v0.3+json`, one per line |
| Depends on | #263 (`@prism-code/spec`), #274 (ADR-015 dual digests), #266 (proof predicate) |
| Blocks | #268 (provenance at build), #271 (`prism inspect`), #272 (`prism attest`, `prism verify`), #273 (`@prism-code/verify`) |
| Reference implementation | JavaScript: `sdk/npm/prism-code/src/attestations.mjs` (this change). Rust and LexLean: the follow-up named under "Wire model change". |

## Summary

A holo today carries proofs only as pointers to evidence on the build host.
This proposal lets the archive carry signed statements about itself.
They live in one more section, appended after the four content blobs.
The section is an ordinary Extension row, kind 14, named `https://uor.foundation/extension/attestation-bundle/v1`.
Its payload is JSON Lines: one Sigstore bundle v0.3 per line.
Each bundle holds a DSSE envelope whose payload is an in-toto Statement v1.
Statement subjects are content blobs of the archive, digested with `sha256` and `blake3` over the same bytes.
The footer stays BLAKE3 of every byte before it, so it covers the bundle.
An archive without the section is byte-for-byte what PrismPM writes today.
On push, each line becomes one OCI 1.1 referrer with the same bytes.

## Motivation

The proof predicate (#266) and build provenance (#268) define what to say.
Neither says where the signed statement lives.
Kept beside the archive, a statement is lost when the file is copied, mailed or served from a static site.
Kept only in a registry, it is invisible offline and in the browser runtime.
Sigstore's model-transparency ships `model.sig` beside the model; BuildKit pushes attestation manifests as referrers.
Prism needs both: the bundle travels inside the file, and the same bytes are discoverable in a registry.

### Goals

- A holo carries zero or more signed statements without changing any other byte of the archive.
- A holo without statements loads exactly as before, in every reader.
- The footer keeps meaning "BLAKE3 of the body", bundle included.
- The unsigned archive is recoverable byte for byte, so reproducibility checks still hold.
- A bundle pushed as an OCI referrer is the same bytes as the line in the archive.
- cosign verifies an extracted bundle against the extracted blob with no Prism code.

### Non-goals

- Signing. `prism attest` (#272) produces bundles; this proposal stores them.
- Verifying signatures or choosing a trust root. That is verifier policy, owned by #272 and #273.
- Defining predicates. #266 owns `prism/proof/v1`; #268 owns provenance.
- Changing physical version 4, the eight existing rows, or any existing extension.

## Proposal

1. The attestation section is an Extension row (kind 14) whose name is `https://uor.foundation/extension/attestation-bundle/v1`.
2. It is optional. When present it is the last row of the table, after the four content blobs, so a strict application archive has nine rows.
3. An archive has at most one attestation section.
4. Its payload is UTF-8 JSON Lines: each line is one Sigstore bundle v0.3 serialized on one line and ended by one LF byte. There is at least one line and no empty line.
5. Each bundle carries a `dsseEnvelope`, never a `messageSignature`. The envelope's `payloadType` is `application/vnd.in-toto+json`.
6. The DSSE payload is an in-toto Statement v1. Every subject is a content blob of the same archive: its `name` is the blob's build-manifest path, and its `digest` has exactly `sha256` and `blake3` over the blob content (ADR-015). The `blake3` value equals the blob label without `blake3:`.
7. No in-holo statement names the archive, its footer or its OCI manifest. Each of those digests would cover the statement itself.
8. The footer is BLAKE3 of every byte before it, including the attestation section.
9. Removing the attestation row, shifting the remaining offsets back by one table row and recomputing the footer yields the unsigned archive byte for byte.
10. On push, each line becomes one OCI referrer of the holo manifest whose single layer is that line's bytes.

## Design details

### Why kind 14 and not a new kind code

Kinds are not Prism's to allocate.
The codes come from Hologram's `hologram-archive` crate, pinned in `tests/holo-codec-oracle/Cargo.toml` at `uor-hologram` revision `2bda6a9a`.
There `SectionKind` is a closed `u8` enum with every code from 1 to 16 taken: `KernelCalls` 1 through `Constants` 11, `ExecPlan` 12, `WarmStart` 13, `Extension` 14, `AppManifest` 15, `ContentBlob` 16.
Its loader refuses any other code with `unknown section kind`.
Its documentation for `Extension` reads, in part, "the format's escape hatch so arbitrary use-cases need not extend this closed enum".
New codes are appended upstream, as `AppManifest` was.

Prism's wire model follows the same table.
`Foundation.Holo.V1.Wire.wireSectionKind` maps row index to code: row 0 is 15, row 1 is 8, rows 2 and 3 are 14, rows 4 to 7 are 16.
`Foundation.Holo.V1.Format.SectionKind` lists `KernelCalls`, which Prism's codec refuses.

A new code, 17, would collide with Hologram's next allocation and be refused by every Hologram loader, including the independent oracle PrismPM tests against.
An Extension row needs no allocation: the name is a URI under `uor.foundation`, like the existing `prismpm-model/v1` extension.
So the attestation section's kind is **14**, and its identity is its extension name.

### Byte layout

Little-endian, as in revision `2026-10-23`.
Rows 0 to 7 are unchanged; row 8 is new.

| Offset | Field | Unsigned | Signed |
| --- | --- | --- | --- |
| 8 | u16 section count | 8 | 9 |
| 10 | section table | 8 rows | 9 rows |
| 202 or 226 | rows 0 to 7 bodies | unchanged | unchanged bytes, offsets plus 24 |
| after row 7 | row 8 body | absent | u16 54, the 54-byte name, the JSON Lines payload |
| end - 32 | footer | BLAKE3 of the body | BLAKE3 of the body, row 8 included |

The row 8 body has the shape every extension has: a u16 name length, the name, then the payload.
The name `https://uor.foundation/extension/attestation-bundle/v1` is 54 bytes.

For the calculator (`calculator-example` `artifacts/Calculator.holo`, 24801 bytes) with one unsigned placeholder bundle around the #266 example statement:

| Row | Kind | Offset unsigned | Offset signed | Length |
| --- | --- | --- | --- | --- |
| 0 | 15 | 202 | 226 | 356 |
| 1 | 8 | 558 | 582 | 610 |
| 2 | 14 | 1168 | 1192 | 1078 |
| 3 | 14 | 2246 | 2270 | 2194 |
| 4 | 16 | 4440 | 4464 | 10569 |
| 5 | 16 | 15009 | 15033 | 3641 |
| 6 | 16 | 18650 | 18674 | 175 |
| 7 | 16 | 18825 | 18849 | 5944 |
| 8 | 14 | absent | 24793 | 5754 |

The signed file is 30579 bytes; its footer is `301208b30381d18c0c8baae5c21c161376271b5ba59d15ecc0874eb3ac7596d8`.
The test `stripping the section returns the original archive byte for byte` recovers the 24801-byte original.

### One bundle line

A line is a Sigstore bundle v0.3 in protobuf JSON form.
`@prism-code/spec` states it as `schemas/attestation/sigstore-bundle.schema.json` and `types/attestation-bundle.d.ts`.

| Field | Value |
| --- | --- |
| `mediaType` | `application/vnd.dev.sigstore.bundle.v0.3+json` |
| `verificationMaterial` | exactly one of `certificate.rawBytes` (keyless, the Fulcio leaf) or `publicKey.hint`; optional `tlogEntries` (Rekor entries with inclusion proof); optional `timestampVerificationData.rfc3161Timestamps` |
| `dsseEnvelope.payloadType` | `application/vnd.in-toto+json` |
| `dsseEnvelope.payload` | base64 of the Statement bytes, exactly as signed |
| `dsseEnvelope.signatures` | at least one `{ keyid?, sig }` |

int64 fields such as `logIndex` are decimal strings, as protobuf JSON writes them.
The v0.2 `x509CertificateChain` is refused; v0.3 carries the leaf only.
Lines are stored as the signer wrote them, not re-canonicalized.
The DSSE signature covers the payload bytes, not the line, so re-serializing a line would keep it valid but break the byte identity with the pushed referrer.

### The statement inside

The decoded payload is an in-toto Statement v1, validated by the existing `schemas/attestation/statement.schema.json`.
Inside a holo one more rule applies: every subject is a `BlobSubject`.
`types/attestation-bundle.d.ts` names this `HoloStatement`.

| Field | Rule |
| --- | --- |
| `_type` | `https://in-toto.io/Statement/v1` |
| `subject[].name` | the blob's build-manifest path, e.g. `core-wasm/prism_calculator_core_wasm.wasm` |
| `subject[].digest` | `PrismDigestSet`: exactly `sha256` and `blake3`, lowercase hex, same bytes |
| `predicateType` | any URI; Prism writes `https://uor.foundation/prism/proof/v1` (#266) and `https://slsa.dev/provenance/v1` (#268) |

The calculator fixture is `sdk/npm/spec/test/fixtures/attestation/statement/calculator.json`, the #266 example statement.
Its subject's `blake3` equals the guest label `blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380` and its `sha256` is `dcf53677c7c80636f8fc2247676b8f747d1549ce4af742c8505eb0f0ae334c03`, both over the 10498 guest bytes.

A bundle may carry any predicate type; readers list what they find.
The same predicate type may appear more than once, for example after a re-signing with a new key.

### Signing order and what moves

1. `prismpm build` composes the unsigned archive, exactly as today.
2. The signer makes statements about its content blobs, which already exist.
3. It signs each one into a bundle.
4. It appends the bundles as row 8 and recomputes the footer.

| Identity | Changes when the bundle is added? |
| --- | --- |
| content-blob labels, guest, view, model, capability set | no |
| application manifest and `application_kappa` | no |
| `prismpm/model-provenance/1` extension | no |
| archive footer (fingerprint), archive kappa, file sha256 | yes |

A statement therefore never invalidates itself, and adding a second bundle never invalidates the first.
`application_kappa` is the identity that survives signing; the footer identifies one exact file.

### Reproducibility

RP-09 compares byte-identical builds.
Signatures are not deterministic: keyless signing uses a fresh key and a fresh certificate each time.
So RP-09 compares the unsigned archive, which rule 9 recovers exactly.
This answers #266's first unresolved question: the bundle does not take part in RP-09, and `timeVerified` may stay.

### A holo without the section

Nothing changes.
The bytes, the eight rows and every identity are those of revision `2026-10-23`.
Every existing reader, including `hologram-archive`, PrismPM's Rust reader and `prism-code` 0.2.0, loads it unchanged.
A reader of the new revision accepts both shapes, and reports an empty list of attestations for this one.

### Readers that predate the section

`prism-code` 0.2.0 already accepts any number of extension rows, so it loads a signed archive and ignores the bundle.
`hologram-archive` accepts Extension rows by design; its application loader still needs one oracle test with a nine-row archive, listed in the follow-up.
PrismPM's Rust reader, through `Foundation.Holo.V1.Wire.validArchiveBody`, requires exactly eight rows today and refuses a signed archive.
That refusal is correct for revision `2026-10-23` and is lifted by the wire model change.

### OCI referrers on push

`prism push` uploads the holo as today; the holo layer is the signed file.
Then, for each line of the attestation section, it pushes one referrer manifest:

| Field | Value |
| --- | --- |
| `artifactType` | `application/vnd.dev.sigstore.bundle.v0.3+json` |
| `layers[0].mediaType` | `application/vnd.dev.sigstore.bundle.v0.3+json` |
| `layers[0]` bytes | the line, without its LF |
| `subject` | the holo's manifest descriptor, `sha256` |
| annotation `dev.sigstore.bundle.content` | `dsse-envelope` |
| annotation `dev.sigstore.bundle.predicateType` | the statement's `predicateType` |

These are the annotations `cosign` writes and `oras discover` shows (ADR-015 evidence).
They let `cosign verify-blob-attestation` verify a pulled bundle against the extracted blob.

cosign and Kyverno image verification also need a subject whose `sha256` is the manifest digest.
An in-holo statement cannot name it, because the manifest covers the holo.
So, as ADR-015's outcome on #267 records, `prism push` signs one more registry-facing statement after the deterministic manifest exists.
Its subjects are `{ "name": "oci-manifest", "digest": { "sha256": "<manifest>" } }` followed by the same blob subjects.
It is pushed as a referrer with the same annotations and is never written into the holo.

### Format revision

Revision `2026-10-23` fixes eight rows; `FORMAT_REVISIONS['2026-10-23'].sectionOrder` is `[15, 8, 14, 14, 16, 16, 16, 16]`.
The attestation section belongs to a new date-stamped revision, dated the day the wire model change merges.
Until then `@prism-code/spec` marks `ATTESTATION_BUNDLE` as draft and leaves `FORMAT_REVISION` unchanged.
The new revision's identifiers add one entry, so a reader can tell the revisions apart:

```js
optionalTrailingExtensions: ['https://uor.foundation/extension/attestation-bundle/v1'],
```

`sectionOrder` stays the order of the required rows.
Every archive valid under `2026-10-23` stays valid under the new revision.

### Wire model change (follow-up, needs the toolchain image)

This change ships the design and the JavaScript reference implementation.
The Rust reader and writer are generated from LexLean, which does not run on the machine that wrote this change.
The follow-up issue makes these edits, in this order.

`stdlib/src/Foundation/Holo/V1/Wire.lex.tex`:

- Add `wireAttestationPrefix`: `wireEncodeLe16 54` followed by the name bytes, beside `wireProvenancePrefix`.
- `wireSectionKind`: map index 8 to `0x0e`; keep 0 to 7.
- `validArchiveBody`: accept header `484f4c4f 0400 0000 0800` with `wireRowsValid body 0 202 8`, or header count `0900` with `wireRowsValid body 0 226 9`.
- `wireRowsValid`: raise the index bound from `index <? 8` to the row count it is called with.
- `wireBodyPayloadsValid`: when the count is 9, require row 8 to start with `wireAttestationPrefix`.
- `wireComposeBodyUnchecked` and `archiveBody`: keep them as the unsigned constructors; add `archiveBodyWithAttestation`, which takes the eight payloads plus the JSON Lines payload and writes a nine-row table from offset 226.
- `archiveSection`: bound the index by the archive's row count instead of 8.
- Add `archiveAttestation : Bytes -> Option Bytes`, returning row 8's payload without the prefix, or none for an eight-row archive.
- Add `archiveStripAttestation : Bytes -> Option Bytes`, returning the unsigned body.

`stdlib/src/Foundation/Holo/V1/WireCorpus.lex.tex`:

- `probeWrongSectionCount` writes count 9 over eight rows; keep it rejected and add probes for a valid nine-row archive, a ninth row with a foreign extension name, a ninth row of kind 16, and count 10.
- Add `probeAttestationStripExact`: stripping the nine-row calculator yields the eight-row calculator.

Generated and checked artifacts:

- `stdlib/generated/package/src/lib.rs`: regenerated; `wireSectionKind`, `wireRowsValid`, `validArchiveBody`, `archiveSection` change, and `archiveBodyWithAttestation`, `archiveAttestation`, `archiveStripAttestation` appear.
- `tests/golden/stdlib/verified/` (`roots.json`, `coverage.json`, `lexlean-attestation.json`) and the native goldens: regenerated.
- `tests/holo-wire-generated.rs`: register the new probes.
- `crates/prismpm/src/holo/archive.rs`: `decode_wire_archive` reads `archiveAttestation`; add `attach_attestations(bytes, bundles)` and `strip_attestations(bytes)` over the generated functions; `compose_application` is unchanged.
- `tests/holo-codec-oracle/`: one test that `hologram::archive::HoloLoader` loads the nine-row calculator and returns the bundle through `extensions()`.

This moves the stdlib semantic identity.
Every newly built holo then carries a new `stdlib_semantics_id` and `prism_stdlib_crate_sha256` in its provenance extension, so the calculator reference archive and ADR-012's receipt identity are regenerated in the same change.

Estimate: about 120 lines of LexLean and 80 lines of Rust, two to three working days with the toolchain image, most of it regeneration and golden refresh.

### Test plan

In this change, run with `node --test`:

- `sdk/npm/prism-code/test/attestations.test.mjs`: the calculator without the section loads, dispatches and has no attestations; appending adds one last kind-14 row with rows 0 to 7 byte-identical; the footer is BLAKE3 of the whole body and breaks when a bundle byte flips; application identities do not move; the bundle reads back with its exact bytes; stripping returns the original; appending twice extends one section in order; the signed archive loads and replays all 22 vectors; malformed bundles, misplaced, repeated, empty and blank-line sections are refused with their check ids.
- `sdk/npm/spec/test/attestation-bundle.test.mjs`: the calculator fixture statement validates and both digests equal the guest blob; the bundle schema's envelope equals `dsse-envelope.schema.json`; keyed and keyless bundles validate; v0.2 shapes, `messageSignature`, both or neither key forms and numeric int64 fields are rejected; prism-code's constants equal the spec's; bundles appended by prism-code read back schema-valid.

Conformance scenario, one Gherkin scenario per ID in `features/suites/holo.feature`, registered in `model/ids.toml` with the wire model change.
HO-21 and HO-22 are taken by PR #246, so these start at HO-23.
The refusal check ids are the error codes `prism-code` raises today; `attestation.absent`, `attestation.strip` and `attestation.referrer` name positive checks.

| ID | Level | MUST | Check id |
| --- | --- | --- | --- |
| `HO-23` | build | A holo without the attestation section loads and verifies with the same bytes and identities as revision `2026-10-23`, and reports no attestations. | `attestation.absent` |
| `HO-24` | build | An attestation section is an Extension row named `https://uor.foundation/extension/attestation-bundle/v1`, is the last row, appears at most once, and the footer is BLAKE3 of the body including it. | `attestation.position`, `attestation.duplicate` |
| `HO-25` | build | Removing the attestation section yields the unsigned archive byte for byte; rows 0 to 7, every blob label and `application_kappa` are unchanged by adding it. | `attestation.strip` |
| `HO-26` | build | Every line is one Sigstore bundle v0.3 with a DSSE envelope over an in-toto Statement v1, and every subject names a content blob of the archive with matching `sha256` and `blake3`. | `attestation.lines`, `attestation.bundle`, `attestation.envelope`, `attestation.statement`, `attestation.subject` |
| `HO-27` | build | A blank line, a v0.2 bundle, a `messageSignature`, a single-digest subject and an `oci-manifest` subject inside the holo are each refused with their check id. | as HO-26 |
| `HO-28` | integration | `prism push` writes one referrer per line whose layer bytes equal the line, with the two `dev.sigstore.bundle.*` annotations, and `cosign verify-blob-attestation` accepts a pulled bundle against the extracted blob. | `attestation.referrer` |

Diagnostics with `PP` codes are registered in `ERRORS.md` together with the IDs.

### Graduation criteria

- Experimental (M2). This proposal is merged. `@prism-code/spec` carries the schema, types and `ATTESTATION_BUNDLE` as draft. `prism-code` reads, appends and strips the section, with the tests above.
- Frozen (M3). The wire model change is merged, so PrismPM's Rust reader and writer agree with `prism-code` on every fixture. HO-23 to HO-28 pass. The new format revision is dated and listed in `FORMAT_REVISIONS`. `prism attest` (#272) writes bundles and `prism inspect` (#271) lists them.
- Stable (1.0). The extension name and line format are final; any change becomes `attestation-bundle/v2`. `@prism-code/verify` (#273) and the Rust verifier agree on every fixture, signed keyless.

## Precedent

- Sigstore model-transparency. It signs a model's files into one Sigstore bundle, `model.sig`, kept beside the model. Copied: one standard bundle per signature, verifiable with stock Sigstore tools. Differs: the bundle lives inside the archive, so it cannot be separated by copying.
- BuildKit attestation manifests. BuildKit attaches in-toto statements to an image as OCI 1.1 referrers. Copied: one referrer per statement, discoverable by the subject digest. Differs: Prism also keeps the bundle offline in the file.
- cosign's bundle referrers. Copied exactly: artifact type `application/vnd.dev.sigstore.bundle.v0.3+json` and the annotations `dev.sigstore.bundle.content` and `dev.sigstore.bundle.predicateType`, verified with cosign 3.1.4 in ADR-015.
- in-toto attestation bundles. The in-toto framework groups statements as JSON Lines, one envelope per line. Copied: JSON Lines. Differs: each line is a full Sigstore bundle, so its verification material travels with it.
- Hologram's own `Extension` kind, documented upstream as the place for producer-defined data.

## Alternatives

- A new section kind code, 17. Rejected: Hologram allocates kind codes, and its loader refuses unknown kinds, so every Hologram reader would refuse a signed archive.
- One extension row per bundle. Rejected: Hologram describes extensions as one per key, and repeating the name makes order and strip rules harder to state.
- One JSON array of bundles. Rejected: re-serializing the array would change each bundle's bytes, breaking byte identity with the pushed referrers.
- A detached `.holo.sigstore.json` file. Rejected: it is lost when the archive travels alone, which is the failure this issue exists to fix.
- Statements about the whole archive or its footer. Rejected by ADR-015 and #266: adding the bundle would change the subject.
- Putting the section before the content blobs. Rejected: every blob offset would move and the unsigned archive would no longer be a prefix-shifted copy.

## Prior art

- Sigstore bundle format, `protobuf-specs` `sigstore_bundle.proto`, media type `application/vnd.dev.sigstore.bundle.v0.3+json`.
- DSSE, Dead Simple Signing Envelope, v1.0.
- in-toto Attestation Framework, Statement v1 and the JSON Lines bundle.
- OCI image-spec and distribution-spec v1.1, referrers and `artifactType`.
- `hologram-archive` `format.rs` and `loader.rs` at `uor-hologram` `2bda6a9a`, the kind table and the extension reader.
- ADR-015, `docs/adr/015-dual-digests.md`, the digest rules and the cosign and Kyverno evidence.

## Unresolved questions

1. Should `prism pull` fold registry referrers back into the archive's attestation section? This proposal only writes them out. Recommendation: no by default, so a pulled file keeps the footer it was pushed with; offer a flag.
2. Which trust root does a verifier pin: the Sigstore public-good instance, a private instance, or keys in `prismpm.lock`? #266 expected #267 to pin it; this proposal leaves it to #272, because the bundle already carries the verification material and the choice is policy.
3. Does Hologram's application loader, as opposed to the archive loader, accept a third extension row? The follow-up's oracle test answers it; if not, the extension name is proposed upstream.
4. Should the new format revision also allow a thin holo, one without content blobs, to carry the section? Then subjects would name blobs that are not in the file. Recommendation: not until thin holos are in a revision.
5. Is there a size bound for the section? A keyless bundle is a few kilobytes plus its statement. Recommendation: 1 MiB, enforced by readers, stated with the wire change.
