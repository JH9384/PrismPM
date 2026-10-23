# Proposal: `@prism-code/spec`, the format and predicate package

Issue: [#263](https://github.com/UOR-Foundation/PrismPM/issues/263).
Milestone: M2 v0.5 Lock, check, proof.
Status: Experimental.

## Summary

`@prism-code/spec` is a small npm package that holds the Prism formats as data.
It has TypeScript types, JSON Schemas and WIT files, and no functions.
It covers the holo section table and every section kind, the model document, the lock and the build documents.
It also covers the in-toto attestation envelope and a registry of predicate types.
It names the holo format revision with a date, `2026-10-23`, apart from the package version.
`prism-code` and every later Prism package take format types from it and redeclare none.
Rust and Python types will later be generated from the same JSON Schemas.

## Motivation

Today the holo format is declared in three places that can drift apart.
LexLean declares it in `Foundation.Holo.V1` under `stdlib/src/Foundation/Holo/V1/`.
PrismPM's Rust writes it in `crates/prismpm/src/holo/archive.rs`.
`prism-code` reads it and redeclares its own types in `sdk/npm/prism-code/types/index.d.ts`.
The M2 to M7 roadmap adds a CLI, an MCP server, a Rust host and a Python reader.
Each would copy the types again.
Three documents inside a holo also have no JSON Schema anywhere.
They are `prismpm/model-provenance/1`, `prismpm/build-manifest/1` and `prismpm/browser-provenance/1`.
Their only definitions are Rust structs and one LexLean structure.

### Goals

1. One package that every Prism package imports for format types and constants.
2. A JSON Schema for every JSON document a holo or a build tree carries.
3. Types for the binary layouts: header, section table, application manifest, content blob, HOLOVIEW bundle and footer.
4. In-toto Statement and DSSE envelope types whose subjects carry `blake3` and `sha256` together.
5. A predicate registry that #266 and M3 extend without changing any other file.
6. A WIT world for the Core-Wasm guest contract `hologram:guest/core-wasm@1`.
7. A date-stamped format revision and a stated rule for how a reader accepts revisions.

### Non-goals

- No parsing, validation or hashing code. Readers live in `prism-code` and its successors.
- No change to holo bytes. Revision `2026-10-23` describes what PrismPM writes today.
- No proof predicate body. #266 designs `https://uor.foundation/prism/proof/v1`.
- No digest policy. #274 owns it, in ADR-015; this package encodes its outcome.
- No Rust or Python generation in this change. This proposal names the generators only.
- No npm publish in this change.

## Proposal

The package lives at `sdk/npm/spec/` and is named `@prism-code/spec`.
Its first version is `0.1.0`.
It is ESM, has zero dependencies and needs Node 22 or a browser.

User stories:

- A runtime author imports `HoloSectionKind` and `FORMAT_REVISION` instead of copying numbers.
- A CI job validates `model.prism.json` against `@prism-code/spec/schemas/documents/model-document-v1.schema.json`.
- The #266 author fills `predicates/proof-v1.schema.json` and `predicates/proof-v1.d.ts`, and nothing else moves.
- A Rust host generates its structs from the same schema files a JavaScript reader uses.

Risks and mitigations:

- Risk: the copied repository schemas drift from `schemas/`. Mitigation: a test compares them byte for byte.
- Risk: new schemas drift from the Rust writer. Mitigation: tests validate real PrismPM output, and graduation moves them into `model/contracts.toml`.
- Risk: "no runtime code" erodes into helpers. Mitigation: a test fails if `index.mjs` exports a function or an unfrozen value.

## Design details

### Package contents

```
sdk/npm/spec/
  package.json            @prism-code/spec 0.1.0, no dependencies
  README.md
  LICENSE
  index.mjs               frozen constants only, no functions
  index.d.ts              the types entry point
  types/
    holo.d.ts             binary layouts, section kinds, revision types
    documents.d.ts        generated from schemas/documents/*.json
    attestation.d.ts      in-toto Statement, DSSE envelope, PrismDigestSet
    predicates.d.ts       the predicate map and registry types
  schemas/
    holo/                 decoded archive, manifest, source manifest, directory
    documents/            model documents, lock, build and provenance documents
    attestation/          in-toto Statement v1, DSSE envelope
  predicates/
    registry.json         predicate type URIs, status and owning issue
    registry.schema.json  the registry's own schema
    proof-v1.d.ts         ProofPredicateV1, reserved for #266
    replay-v1.d.ts        ReplayPredicateV1, reserved for M3
  worlds/
    core-wasm.wit         the guest contract hologram:guest/core-wasm@1
  scripts/
    generate-types.mjs    JSON Schema to TypeScript, not published
  test/                   node --test, not published
```

### The holo section table and section kinds

The constants come from `Foundation.Holo.V1.Format` and `Foundation.Holo.V1.Wire`.
All integers are little-endian.

| Offset | Field | Value in revision 2026-10-23 |
| --- | --- | --- |
| 0 | magic | `HOLO` |
| 4 | u16 physical version | 4 |
| 6 | u16 flags | 0 |
| 8 | u16 section count | 8 |
| 10 | section table | 8 rows of u64 kind, u64 offset, u64 length |
| 202 | section bodies | contiguous, in table order |
| end - 32 | footer | BLAKE3 of every earlier byte, the archive fingerprint |

The wire codec writes each kind as one byte followed by seven zero bytes.
The package states the kind as a u64 and records the codes below.

| Code | `Foundation.Holo.V1.Format.SectionKind` | Rows | Body |
| --- | --- | --- | --- |
| 15 | `AppManifest` | row 0 | 356 bytes, see below |
| 8 | `Metadata` | row 1 | source manifest, canonical JSON |
| 14 | `Extension` | rows 2 and 3 | u16 name length, name, JSON payload |
| 16 | `ContentBlob` | rows 4 to 7 | 71-byte `blake3:` label, then content |

`SectionKind.KernelCalls` exists in `Foundation.Holo.V1.Format` but has no wire code in Prism's codec.
A reader of revision `2026-10-23` refuses it as an unknown kind.

The application manifest is the fixed 356-byte layout of `Foundation.Holo.V1.Wire.validAppManifest`.
It is a 57-byte prefix, three 71-byte kappa labels, then an 86-byte constant suffix.
The prefix is the URI `https://hologram.foundation/realization/app-manifest`, a NUL byte and u32 3.
The labels are, in order, the capability set, the Core-Wasm guest and the HOLOVIEW bundle.
The package exports the prefix and suffix as hex constants.

Row 2 is Hologram's extension `https://hologram.foundation/extension/application-directory/v1`.
Row 3 is PrismPM's extension `https://uor.foundation/extension/prismpm-model/v1`.
Its payload is `prismpm/model-provenance/1`.

The four content blobs are sorted by label, strictly ascending.
They are the capability set, the guest, the model document and the HOLOVIEW bundle.
The capability set of a text or numeric application is the constant `Foundation.Holo.V1.Wire.emptyCapabilities`.
The HOLOVIEW bundle is big-endian: `HOLOVIEW`, u16 version 1, the entry path, then files in byte order.
SPEC section 3 fixes its limits: 4,096 files, 1,024-byte paths, 64 MiB per file and 256 MiB in total.

Binary sections get TypeScript types and exported constants.
Their decoded forms also get JSON Schemas, so a reader's output can be checked:

| Schema file | `$id` | Describes |
| --- | --- | --- |
| `schemas/holo/archive.schema.json` | `https://schemas.uor.foundation/prism/holo/archive/1` | magic, version, flags, the eight table rows and the footer |
| `schemas/holo/app-manifest.schema.json` | `https://schemas.uor.foundation/prism/holo/app-manifest/1` | the manifest URI, its three labels and its suffix |
| `schemas/holo/source-manifest.schema.json` | `https://schemas.uor.foundation/prism/holo/source-manifest/4` | the metadata section, version 4 |
| `schemas/holo/application-directory.schema.json` | `https://schemas.uor.foundation/prism/holo/application-directory/1` | the directory extension as PrismPM writes it |

### Documents

Six model documents and two locks already have schemas in the repository's `schemas/` folder.
`model/contracts.toml` registers them, and `CONTRACTS.md` lists them.
The package carries byte-identical copies, because an npm package cannot reference files outside itself.

| Document | Package file | Source |
| --- | --- | --- |
| `prismpm/model-document/1` to `/6` | `schemas/documents/model-document-v1.schema.json` to `-v6` | copy of `schemas/model-document*.schema.json` |
| `prismpm/sdk-lock/1`, `/2` (the `prismpm.lock` file) | `schemas/documents/sdk-lock-v1.schema.json`, `-v2` | copy of `schemas/sdk-lock*.schema.json` |
| `prismpm/model-provenance/1` | `schemas/documents/model-provenance-v1.schema.json` | new, from `ModelProvenanceV1` in `holo/archive.rs` |
| `prismpm/build-manifest/1` | `schemas/documents/build-manifest-v1.schema.json` | new, from the `build` publisher in `controller/mod.rs` |
| `prismpm/browser-provenance/1` | `schemas/documents/browser-provenance-v1.schema.json` | new, from `application_build.rs` |

The build manifest's `inputs` member is one of `prismpm/build-inputs/1`, `/2` or `/3`.
The new schemas are closed: unknown members are errors, as in the Rust `deny_unknown_fields` structs.
The model provenance schema keeps the tagged `view_binding` and `browser_projection` forms.

### Attestation

`types/attestation.d.ts` and `schemas/attestation/` define in-toto Statement v1 and the DSSE envelope.

```ts
type Hex = string;                       // 64 lowercase hex characters
interface PrismDigestSet {               // exactly these two keys, over the same bytes
  sha256: Hex;
  blake3: Hex;                           // default-mode BLAKE3, 256 bits, no "blake3:" prefix
}
interface BlobSubject { name: string; digest: PrismDigestSet }
interface OciManifestSubject { name: 'oci-manifest'; digest: { sha256: Hex } }
type Subject = BlobSubject | OciManifestSubject;
interface Statement<T extends PredicateType = PredicateType> {
  _type: 'https://in-toto.io/Statement/v1';
  subject: [Subject, ...Subject[]];
  predicateType: T;
  predicate: PredicateMap[T];
}
interface DsseEnvelope {
  payload: string;                       // base64 of the Statement bytes
  payloadType: 'application/vnd.in-toto+json';
  signatures: [{ keyid?: string; sig: string }, ...{ keyid?: string; sig: string }[]];
}
```

#274 fixed the digest shape in ADR-015, PR #324.
A `PrismDigestSet` has exactly two keys, and both cover the same bytes.
For a content blob, `blake3` equals the blob's label without the `blake3:` prefix.
The footer is BLAKE3 of the body, not of the file, so it never appears under `blake3`.
Subjects are content blobs, because an archive cannot name itself.
A registry-facing statement adds an `OciManifestSubject`.
Registries reject `blake3:` digests, and cosign and Kyverno match only the manifest's `sha256`.

### Predicates

`predicates/registry.json` lists every predicate type the Prism tools emit or accept:

| `predicateType` | Status | Owner |
| --- | --- | --- |
| `https://uor.foundation/prism/proof/v1` | placeholder | #266 |
| `https://uor.foundation/prism/replay/v1` | placeholder | M3 |

Each row has `predicateType`, `status`, `issue` or `milestone`, and `schema`.
`schema` is null while the row is a placeholder.
Each predicate owns two files in `predicates/`, as #266 reserved on #263:

- `predicates/proof-v1.d.ts` exports `ProofPredicateV1`, `unknown` until #266 fills it.
- `predicates/proof-v1.schema.json` is reserved, with `$id` `https://uor.foundation/prism/proof/v1/schema.json`.

`index.mjs` exports `PROOF_PREDICATE_TYPE` and `REPLAY_PREDICATE_TYPE`.
The types file is `.d.ts`, not `.ts`, because the package has no build step.
To define a predicate, its owner adds the schema and fills the type.
The owner then sets `schema` and `status: "experimental"` in the registry row.
No other file changes.

### Worlds

`worlds/core-wasm.wit` states the guest contract `hologram:guest/core-wasm@1` in WIT:

```wit
package hologram:guest@1.0.0;

world core-wasm {
  export holo-alloc: func(length: u32) -> u32;
  export holo-run: func(offset: u32, length: u32) -> u64;
}
```

The guest is an import-free core module, not a component.
It exports `memory`, `holo_alloc (i32) -> i32` and `holo_run (i32, i32) -> i64`.
The result of `holo_run` packs the response as `offset << 32 | length`.
WIT names are kebab-case, so `holo-alloc` names the core export `holo_alloc`.
WIT cannot name an exported memory, so the file states `memory` in a comment.
`u32` and `u64` lower to `i32` and `i64` in the canonical ABI, so the types match exactly.
A test checks the world against the reference guest's export section.

### Format revision

A format revision is a date, `YYYY-MM-DD`, as in the Model Context Protocol.
The first revision is `2026-10-23`.
It names the physical v4 layout, the Holo/1 profile and the document schemas listed above.

```js
export const FORMAT_REVISION = '2026-10-23';
export const FORMAT_REVISIONS = Object.freeze({
  '2026-10-23': Object.freeze({ physicalVersion: 4, sectionKinds: [15, 8, 14, 14, 16, 16, 16, 16], ... }),
});
```

A reader states the revisions it accepts as an explicit list, never as a date range.
For example, `accepts: ['2026-10-23']`.
An archive does not carry its revision date.
A reader identifies the revision from the physical version, section kinds, extension names and `schema` strings.
So every new revision must change at least one of those identifiers.
A change that alters none of them is not a format change.
Revisions are final only under the graduation rule below.

### The dependency rule

Every Prism package imports format types and constants from `@prism-code/spec`.
No package redeclares them.
`@prism-code/spec` depends on nothing and holds no functions.
A package may depend on `@prism-code/spec` only, never on another package's format types.

`prism-code` 0.2.0 does not depend on this package yet.
The repository has no npm workspace, and `@prism-code/spec` is not on npm.
Adding the dependency is RT-01, #276, together with `holo.verify()` and typed errors.

### Generating Rust and Python types

The JSON Schemas are the source for every language.
TypeScript for the documents is generated now by `scripts/generate-types.mjs`.
It is a zero-dependency converter for the closed keyword set these schemas use.
A test regenerates the types and fails on any difference.
Later, Rust uses [`typify`](https://github.com/oxidecomputer/typify) and Python uses [`datamodel-code-generator`](https://github.com/koxudaxi/datamodel-code-generator).
Both read JSON Schema draft 2020-12 and run in CI with the same drift check.
The binary layouts stay hand-written, checked by tests against the reference reader.

### Versioning

The package follows 0.x semver, where a minor release may break.
A patch release adds without breaking.
The package version and the format revision are independent.
A package release can add a revision without changing an old one.
1.0 follows the graduation criteria below.

### Test plan

All tests use `node --test` with no dependencies.
They validate with a small JSON Schema validator in `test/`.
It implements the keywords these schemas use, and refuses any other keyword.

The reference archive is `artifacts/Calculator.holo` from [calculator-example](https://github.com/UOR-Foundation/calculator-example).
PrismPM's fixture `sdk/npm/prism-code/fixtures/Calculator.holo` is the same file.
Both have SHA-256 `84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7`.
So there is one reference archive today, not two.

1. Parse the reference archive with `prism-code`'s `parseArchive`, imported, not copied.
2. Validate its decoded header and table, manifest, source manifest and directory against `schemas/holo/`.
3. Validate its model provenance and its model document against `schemas/documents/`.
4. Check that `prism-code`'s constants equal this package's constants.
5. Validate calculator-example's `build-manifest.json` and the closure's `provenance.json`.
6. Check that the build manifest's `Calculator.holo` row has the archive's SHA-256.
7. Check that every copied schema equals its source in `schemas/` byte for byte.
8. Check `worlds/core-wasm.wit` against the reference guest's export names and signatures.
9. Run negative controls: an extra member, a wrong constant and a reordered table must each fail.
10. Regenerate `types/documents.d.ts` and fail on any difference.
11. Check that `index.mjs` exports only frozen data and `package.json` lists no dependencies.
12. Build a statement about the guest blob, and check its `blake3` equals the blob's label.

A CI workflow, `npm-spec.yml`, mirrors `npm-prism-code.yml`.
It runs the tests on Node 22 and 24, on Linux, macOS and Windows.
It has no publish job.

### Graduation criteria

Experimental, 0.1:

- The package merges with the tests above green.

Beta:

- `prism-code` takes its format types from this package (RT-01, #276).
- #266 fills the proof predicate schema and type.
- A second, independent reference archive validates, from a text application profile.
- The new schemas are registered in `model/contracts.toml`, so PrismPM's Rust checks the same files.
- `wasm-tools component wit` parses `worlds/` in CI.

Stable, 1.0:

- Rust and Python types are generated in CI with a drift check.
- The package is published to npm with provenance from a tag workflow.
- Revision `2026-10-23` has a merged conformance scenario.
  Its traceability file maps each MUST in this proposal to a check id.

## Precedent

The issue's precedent line names three projects.

- [`@ai-sdk/provider`](https://github.com/vercel/ai/tree/main/packages/provider) holds the types that every Vercel AI SDK provider pins.
  It ships error classes. This package ships none.
- [`moby/moby/api`](https://github.com/moby/moby/tree/master/api) holds the Engine API types and swagger file as their own module.
- [`sigstore/protobuf-specs`](https://github.com/sigstore/protobuf-specs) holds Sigstore's message formats and generates bindings per language.
  It uses protobuf. This package uses JSON Schema, because Prism's documents are canonical JSON already.

## Alternatives

- Keep the types inside `prism-code`. Rejected: each new package would copy them.
- Generate everything from LexLean now. Rejected for 0.1: LexLean emits Lean, Rust and LaTeX, not TypeScript or JSON Schema.
- Use protobuf, as Sigstore does. Rejected: it adds a second encoding beside canonical JSON.
- Point consumers at the repository's `schemas/` folder. Rejected: npm consumers cannot depend on a repository path.
- Put each predicate in its own package. Rejected for now: a registry row is enough until a predicate needs code.

## Prior art

- [in-toto Attestation Framework](https://github.com/in-toto/attestation): Statement v1, ResourceDescriptor and DigestSet.
- [DSSE](https://github.com/secure-systems-lab/dsse): the signature envelope.
- [Model Context Protocol versioning](https://modelcontextprotocol.io/specification/versioning): date-stamped revisions.
- [WIT](https://component-model.bytecodealliance.org/design/wit.html): the WebAssembly interface type language.
- [JSON Schema draft 2020-12](https://json-schema.org/draft/2020-12): the schema language of `schemas/`.

## Unresolved questions

1. Which media type names a holo? #274's test used the placeholder `application/vnd.uor.prism.holo.v1`.
2. Should a later revision carry its date inside the archive, for example in the source manifest?
3. Should the JSON Schemas themselves be generated from LexLean, as `model/contracts.toml` rule R1 suggests?
4. Should Hologram own the application directory schema, since the extension is Hologram's?
5. Which `$id` prefix should new Prism schemas use? This proposal uses `https://schemas.uor.foundation/prism/`.
   #266 chose `https://uor.foundation/prism/proof/v1/schema.json` for its predicate.
6. Should this package carry the deterministic push-manifest template #274 asks for, or should `prism push` own it?
