---
title: Holo format
description: The byte layout of a .holo file, its sections, digests and format revisions.
---

Source: `@prism-code/spec` 2026-10-23, `schemas/holo/archive.schema.json`, `index.mjs`.

## Layout

All integers are little-endian. Offsets count from the first byte of the file.

| Offset   | Size     | Field            | Value                                      |
| -------- | -------- | ---------------- | ------------------------------------------ |
| 0        | 4        | magic            | `HOLO`                                     |
| 4        | 2        | physical version | 4                                          |
| 6        | 2        | flags            | 0                                          |
| 8        | 2        | section count    | 8                                          |
| 10       | 192      | section table    | 8 rows of u64 kind, u64 offset, u64 length |
| 202      | variable | section bodies   | contiguous, in table order                 |
| end - 32 | 32       | footer           | BLAKE3 of every earlier byte               |

## Section table

| Row | Kind | Name         | Length            | Content                                                                      |
| --- | ---- | ------------ | ----------------- | ---------------------------------------------------------------------------- |
| 0   | 15   | APP_MANIFEST | 356 bytes         | application manifest, `https://hologram.foundation/realization/app-manifest` |
| 1   | 8    | METADATA     | variable          | source manifest, version 4                                                   |
| 2   | 14   | EXTENSION    | variable          | extension `https://hologram.foundation/extension/application-directory/v1`   |
| 3   | 14   | EXTENSION    | variable          | extension `https://uor.foundation/extension/prismpm-model/v1`                |
| 4   | 16   | CONTENT_BLOB | at least 71 bytes | content blob: a 71-byte `blake3:` label, then the content                    |
| 5   | 16   | CONTENT_BLOB | at least 71 bytes | content blob: a 71-byte `blake3:` label, then the content                    |
| 6   | 16   | CONTENT_BLOB | at least 71 bytes | content blob: a 71-byte `blake3:` label, then the content                    |
| 7   | 16   | CONTENT_BLOB | at least 71 bytes | content blob: a 71-byte `blake3:` label, then the content                    |

The four content blobs are the capability-set, guest, view and model document, sorted by label. Each label is `blake3:` and 64 lowercase hex characters: the BLAKE3 of the content.

## Application manifest

Schema: `https://schemas.uor.foundation/prism/holo/app-manifest/1`, file `schemas/holo/app-manifest.schema.json`.

| Offset | Size | Field                       |
| ------ | ---- | --------------------------- |
| 0      | 57   | prefix: the URI, NUL, u32 3 |
| 57     | 71   | capability-set label        |
| 128    | 71   | guest label                 |
| 199    | 71   | view label                  |
| 270    | 86   | constant suffix             |

The manifest is 356 bytes. Decoded, it has these members.

| Field       | Type   | Required | Constraint                                                                                                                                                                         |
| ----------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uri`       | string | yes      | = `"https://hologram.foundation/realization/app-manifest"`                                                                                                                         |
| `labels`    | array  | yes      | exactly 3 items                                                                                                                                                                    |
| `labels[0]` | string | yes      | matches `^blake3:[0-9a-f]{64}$`                                                                                                                                                    |
| `labels[1]` | string | yes      | matches `^blake3:[0-9a-f]{64}$`                                                                                                                                                    |
| `labels[2]` | string | yes      | matches `^blake3:[0-9a-f]{64}$`                                                                                                                                                    |
| `suffix`    | string | yes      | = `"5200000000000000020000000008000000686f6c6f5f72756e1a000000686f6c6f6772616d3a67756573742f636f72652d7761736d4031030a000000696e6465782e68746d6c08000000706f727461626c6500000000"` |

## Source manifest

Schema: `https://schemas.uor.foundation/prism/holo/source-manifest/4`, file `schemas/holo/source-manifest.schema.json`.

| Field             | Type   | Required | Constraint                   |
| ----------------- | ------ | -------- | ---------------------------- |
| `files`           | array  | yes      | exactly 4 items              |
| `files[0]`        | object | yes      | no other members             |
| `files[0].kind`   | string | yes      | = `"lexlean-build-manifest"` |
| `files[0].sha256` | string | yes      | matches `^[0-9a-f]{64}$`     |
| `files[1]`        | object | yes      | no other members             |
| `files[1].kind`   | string | yes      | = `"lean4-prod-coverage"`    |
| `files[1].sha256` | string | yes      | matches `^[0-9a-f]{64}$`     |
| `files[2]`        | object | yes      | no other members             |
| `files[2].kind`   | string | yes      | = `"lean4-prod-kernel-ir"`   |
| `files[2].sha256` | string | yes      | matches `^[0-9a-f]{64}$`     |
| `files[3]`        | object | yes      | no other members             |
| `files[3].kind`   | string | yes      | = `"model-document"`         |
| `files[3].sha256` | string | yes      | matches `^[0-9a-f]{64}$`     |
| `semantic_id`     | string | yes      | matches `^[0-9a-f]{64}$`     |
| `source_id`       | string | yes      | matches `^[0-9a-f]{64}$`     |
| `version`         | number | yes      | = `4`                        |

## Extensions

An extension body is a u16 little-endian name length, the name, then the JSON payload.

### Application directory

Name: `https://hologram.foundation/extension/application-directory/v1`.

Schema: `https://schemas.uor.foundation/prism/holo/application-directory/1`, file `schemas/holo/application-directory.schema.json`.

| Field                     | Type    | Required | Constraint                       |
| ------------------------- | ------- | -------- | -------------------------------- |
| `schema_version`          | number  | yes      | = `1`                            |
| `primary_layer`           | number  | yes      | = `0`                            |
| `requires_kappa`          | string  | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `layers`                  | array   | yes      | exactly 2 items                  |
| `layers[0]`               | object  | yes      | no other members                 |
| `layers[0].position`      | number  | yes      | = `0`                            |
| `layers[0].kind`          | string  | yes      | = `"wasm"`                       |
| `layers[0].content_kappa` | string  | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `layers[0].entry`         | string  | yes      | = `"holo_run"`                   |
| `layers[0].contract`      | string  | yes      | = `"hologram:guest/core-wasm@1"` |
| `layers[0].architecture`  | null    | yes      | = `null`                         |
| `layers[0].surface`       | null    | yes      | = `null`                         |
| `layers[0].engine`        | null    | yes      | = `null`                         |
| `layers[1]`               | object  | yes      | no other members                 |
| `layers[1].position`      | number  | yes      | = `1`                            |
| `layers[1].kind`          | string  | yes      | = `"view"`                       |
| `layers[1].content_kappa` | string  | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `layers[1].entry`         | string  | yes      | = `"index.html"`                 |
| `layers[1].contract`      | null    | yes      | = `null`                         |
| `layers[1].architecture`  | null    | yes      | = `null`                         |
| `layers[1].surface`       | string  | yes      | = `"portable"`                   |
| `layers[1].engine`        | null    | yes      | = `null`                         |
| `children`                | array   | yes      | at most 0 items                  |
| `blobs`                   | array   | yes      | exactly 4 items; unique items    |
| `blobs[]`                 | object  | yes      | no other members                 |
| `blobs[].kappa`           | string  | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `blobs[].byte_length`     | integer | yes      | 0 to 9007199254740991            |

### Model provenance

Name: `https://uor.foundation/extension/prismpm-model/v1`.

Schema: `https://schemas.uor.foundation/prismpm/model-provenance/1`, file `schemas/documents/model-provenance-v1.schema.json`.

| Field                                                      | Type           | Required | Constraint                       |
| ---------------------------------------------------------- | -------------- | -------- | -------------------------------- |
| `application_kappa`                                        | string         | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `cargo_crate_sha256`                                       | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `cargo_name`                                               | string         | yes      | matches `^[A-Za-z0-9_-]{1,64}$`  |
| `cargo_version`                                            | string         | yes      | 1 to 128 characters              |
| `compiler_semantics_id`                                    | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `core_wasm_contract`                                       | string         | yes      | = `"hologram:guest/core-wasm@1"` |
| `generated_core_sha256`                                    | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `guest_content_kappa`                                      | string         | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `hologram_live_commit`                                     | string         | yes      | matches `^[0-9a-f]{40}$`         |
| `lcnf_manifest_sha256`                                     | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `lean4_prod_commit`                                        | string         | yes      | matches `^[0-9a-f]{40}$`         |
| `lean_manifest_sha256`                                     | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `lexlean_commit`                                           | string         | yes      | matches `^[0-9a-f]{40}$`         |
| `lexlean_package_sha256`                                   | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `model_content_kappa`                                      | string         | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `model_id`                                                 | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `prism_stdlib_crate_sha256`                                | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `schema`                                                   | string         | yes      | = `"prismpm/model-provenance/1"` |
| `semantic_id`                                              | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `snapshot_id`                                              | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `source_id`                                                | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `stdlib_semantics_id`                                      | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `target_profile_id`                                        | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `uor_hologram_commit`                                      | string         | yes      | matches `^[0-9a-f]{40}$`         |
| `view_binding`                                             | one of 2 forms | yes      |                                  |
| `view_binding (form 1)`                                    | object         | yes      | no other members                 |
| `view_binding (form 1).tag`                                | string         | yes      | = `"none"`                       |
| `view_binding (form 2)`                                    | object         | yes      | no other members                 |
| `view_binding (form 2).tag`                                | string         | yes      | = `"present"`                    |
| `view_binding (form 2).browser_projection`                 | one of 2 forms | yes      |                                  |
| `view_binding (form 2).browser_projection (form 1)`        | object         | yes      | no other members                 |
| `view_binding (form 2).browser_projection (form 1).tag`    | string         | yes      | = `"none"`                       |
| `view_binding (form 2).browser_projection (form 2)`        | object         | yes      | no other members                 |
| `view_binding (form 2).browser_projection (form 2).tag`    | string         | yes      | = `"present"`                    |
| `view_binding (form 2).browser_projection (form 2).sha256` | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `view_binding (form 2).view_content_kappa`                 | string         | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `view_binding (form 2).view_model_id`                      | string         | yes      | matches `^[0-9a-f]{64}$`         |

## Capability set

URI: `https://hologram.foundation/realization/capability-set`. The blob of an application that requests nothing, as hex:

```text
68747470733a2f2f686f6c6f6772616d2e666f756e646174696f6e2f7265616c697a6174696f6e2f6361706162696c6974792d7365740000000000290000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

## Model documents

A holo carries one model document. Its `schema` member names one of these.

| Schema                     | File                                              |
| -------------------------- | ------------------------------------------------- |
| `prismpm/model-document/1` | `schemas/documents/model-document-v1.schema.json` |
| `prismpm/model-document/2` | `schemas/documents/model-document-v2.schema.json` |
| `prismpm/model-document/5` | `schemas/documents/model-document-v5.schema.json` |
| `prismpm/model-document/6` | `schemas/documents/model-document-v6.schema.json` |

## Portable view

The view blob is a `HOLOVIEW` bundle, version 1, big-endian, with entry `index.html`.

| Limit       | Value     |
| ----------- | --------- |
| files       | 4096      |
| path bytes  | 1024      |
| file bytes  | 67108864  |
| total bytes | 268435456 |

## World

The guest implements `hologram:guest/core-wasm@1` and exports `holo_alloc`, `holo_run`, `memory`. The world file is `worlds/core-wasm.wit`.

```wit
package hologram:guest@1.0.0;

world core-wasm {
  /// Reserve `length` bytes of guest memory for a request and return their offset.
  export holo-alloc: func(length: u32) -> u32;

  /// Run the request at `offset` with `length` bytes. Returns `offset << 32 | length` of the response.
  export holo-run: func(offset: u32, length: u32) -> u64;
}
```

## Digest footer

The last 32 bytes are the BLAKE3 of every earlier byte. Read the footer, hash the rest of the file, and compare.

## Format revisions

A revision is a date. A file does not carry its revision, so a reader recognizes it by these identifiers.

### 2026-10-23

| Identifier              | Value                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `physicalVersion`       | `4`                                                                                                                   |
| `flags`                 | `0`                                                                                                                   |
| `sectionOrder`          | `15`, `8`, `14`, `14`, `16`, `16`, `16`, `16`                                                                         |
| `appManifestUri`        | `https://hologram.foundation/realization/app-manifest`                                                                |
| `extensions`            | `https://hologram.foundation/extension/application-directory/v1`, `https://uor.foundation/extension/prismpm-model/v1` |
| `coreWasmContract`      | `hologram:guest/core-wasm@1`                                                                                          |
| `holoviewVersion`       | `1`                                                                                                                   |
| `sourceManifestVersion` | `4`                                                                                                                   |
| `provenanceSchema`      | `prismpm/model-provenance/1`                                                                                          |
| `modelDocumentSchemas`  | `prismpm/model-document/1`, `prismpm/model-document/2`, `prismpm/model-document/5`, `prismpm/model-document/6`        |

`@prism-code/spec` exports `FORMAT_REVISION`, the revision it describes: `2026-10-23`.

## Next steps

- [Attestations reference](/docs/reference/attestations)
- [Spec package](/docs/api/spec-package)
- [Load a holo](/docs/api/load)

Generated from @prism-code/spec 2026-10-23 at 31b61e31c986041a4667e2143680fdd9c3f7b812.
