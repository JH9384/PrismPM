# @prism-code/spec

The Prism formats as data: TypeScript types, JSON Schemas and WIT files.

A Prism application is built by [PrismPM](https://github.com/UOR-Foundation/PrismPM) into a holo, a content-addressed `.holo` archive.
This package states what a holo and its documents contain.
It holds no functions and has no dependencies.
Readers, such as [`prism-code`](../prism-code/README.md), implement it.

The design is [docs/proposals/263-spec-package.md](../../../docs/proposals/263-spec-package.md).

## Format revision

This package describes holo format revision **`2026-10-23`**.

A revision is a date, independent of the package version.
A reader lists the revisions it accepts, never a date range:

```js
import { FORMAT_REVISION, FORMAT_REVISIONS } from '@prism-code/spec';

const support = { accepts: ['2026-10-23'] };
FORMAT_REVISIONS['2026-10-23'].physicalVersion;   // 4
```

An archive does not carry its revision date.
A reader recognizes the revision by the identifiers in `FORMAT_REVISIONS`.
They are the physical version, section order, extension names and `schema` strings.
So every new revision changes at least one of them.

## The dependency rule

Every Prism package imports format types and constants from `@prism-code/spec`.
No package redeclares them.
This package depends on nothing and holds no functions.

`prism-code` 0.2.0 does not depend on this package yet.
That change is RT-01, [#276](https://github.com/UOR-Foundation/PrismPM/issues/276).

## What is in it

| Path | Contents |
| --- | --- |
| `index.mjs`, `index.d.ts` | Frozen constants: magic, version, section kinds, manifest bytes, extension names, schema paths, predicate types. |
| `types/holo.d.ts` | The binary layouts: header, section table, application manifest, extensions, content blobs, HOLOVIEW, the guest exports. |
| `types/documents.d.ts` | Generated from the JSON Schemas below. Do not edit. |
| `types/attestation.d.ts` | in-toto Statement v1, `PrismDigestSet`, blob and OCI manifest subjects, and the DSSE envelope. |
| `types/predicates.d.ts` | `PredicateMap` and the registry types. |
| `schemas/holo/` | The decoded header and table, application manifest, source manifest and application directory. |
| `schemas/documents/` | `prismpm/model-document/1` to `/6`, `prismpm/sdk-lock/1` and `/2`, `prismpm/model-provenance/1`, `prismpm/build-manifest/1`, `prismpm/browser-provenance/1`. |
| `schemas/attestation/` | in-toto Statement v1 and the DSSE envelope. |
| `predicates/` | The registry, its schema, and one `.d.ts` and one `.schema.json` per predicate. |
| `worlds/core-wasm.wit` | The Core-Wasm guest contract `hologram:guest/core-wasm@1`. |

The model document and lock schemas are byte-identical copies of the repository's `schemas/` folder.
A test fails if they drift.

## The holo in one table

Little-endian. Source: `Foundation.Holo.V1.Format` and `Foundation.Holo.V1.Wire`.

| Offset | Field |
| --- | --- |
| 0 | `HOLO` |
| 4 | u16 physical version, 4 |
| 6 | u16 flags, 0 |
| 8 | u16 section count, 8 |
| 10 | 8 rows of u64 kind, u64 offset, u64 length |
| 202 | section bodies, contiguous, in table order |
| end - 32 | BLAKE3 of every earlier byte, the archive fingerprint |

The rows are, in order: application manifest (15), source manifest (8), two extensions (14), four content blobs (16).
The content blobs are sorted by their `blake3:` label.

## Use

```js
import { SECTION_KIND, SCHEMAS } from '@prism-code/spec';
import modelSchema from '@prism-code/spec/schemas/documents/model-document-v1.schema.json' with { type: 'json' };
```

```ts
import type { ModelDocument, Statement, DsseEnvelope } from '@prism-code/spec';
```

## Predicates

| Predicate type | Status | Owner |
| --- | --- | --- |
| `https://uor.foundation/prism/proof/v1` | experimental: `ProofPredicateV1`, `predicates/proof-v1.schema.json` | [#266](https://github.com/UOR-Foundation/PrismPM/issues/266) |
| `https://uor.foundation/prism/replay/v1` | placeholder | M3 |

Each predicate owns `predicates/<name>-v<N>.d.ts` and `predicates/<name>-v<N>.schema.json`.
The proof predicate is defined: its schema has `$id` `https://uor.foundation/prism/proof/v1/schema.json`, and `ProofStatementV1` is a statement with exactly one subject, the guest blob.
Its design is [docs/proposals/266-proof-predicate.md](../../../docs/proposals/266-proof-predicate.md), and `test/fixtures/proof/calculator.statement.json` is its calculator example.
`replay-v1.d.ts` still holds `unknown`.
To define a predicate, add its schema, fill its type, then set `schema` and `status` in its registry row.
The type files are `.d.ts`, not `.ts`, because the package has no build step.

## Attestation subjects

Subjects follow ADR-015 from [#274](https://github.com/UOR-Foundation/PrismPM/issues/274).
A blob subject carries a `PrismDigestSet`: exactly `sha256` and `blake3`, over the same bytes.
For a content blob, `blake3` equals the blob's label without the `blake3:` prefix.
The footer is BLAKE3 of the body, not of the file, so it never appears under `blake3`.
A registry-facing statement adds `{ name: "oci-manifest", digest: { sha256 } }`.

## Versioning

The package is 0.x: a minor release may break, a patch release only adds or fixes.
The format revision changes independently of the package version.

## Tests

```
node --test "test/*.test.mjs"
node scripts/generate-types.mjs --check
```

The tests decode the reference archive with `prism-code`'s own reader, imported, not copied.
They validate every section and document against these schemas.
The reference archive is calculator-example's `artifacts/Calculator.holo`, SHA-256 `84371aaa...86e7`.
PrismPM's `prism-code` fixture is the same file.

## License

MIT.
