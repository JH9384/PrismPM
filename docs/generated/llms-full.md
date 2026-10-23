# Prism: every reference and API page

> Prism builds your application into a holo, a content-addressed package that carries its own proof and provenance, and checks them before anything runs.

<!-- reference/holo-format -->

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

Generated from @prism-code/spec 2026-10-23 at 16b5ff3a40856cdc77824b092f10f5eea75ec6c2.

<!-- reference/attestations -->

---
title: Attestations reference
description: The statement and envelope a holo's attestations use, the predicate types and their status.
---

Source: `@prism-code/spec` 2026-10-23, `schemas/attestation/statement.schema.json`, `schemas/attestation/dsse-envelope.schema.json`, `predicates/registry.json`.

## Statement

Every attestation is one statement of type `https://in-toto.io/Statement/v1`.

Schema: `https://schemas.uor.foundation/prism/attestation/statement/1`, file `schemas/attestation/statement.schema.json`.

| Field                | Type               | Required | Constraint                            |
| -------------------- | ------------------ | -------- | ------------------------------------- |
| `_type`              | string             | yes      | = `"https://in-toto.io/Statement/v1"` |
| `subject`            | array              | yes      | at least 1 item; unique items         |
| `subject[]`          | one of 2 forms     | yes      |                                       |
| `subject[] (form 1)` | BlobSubject        | yes      | see BlobSubject                       |
| `subject[] (form 2)` | OciManifestSubject | yes      | see OciManifestSubject                |
| `predicateType`      | string             | yes      | format uri; at least 1 character      |
| `predicate`          | object             | yes      |                                       |

### PrismDigestSet

| Field    | Type   | Required | Constraint               |
| -------- | ------ | -------- | ------------------------ |
| `blake3` | string | yes      | matches `^[0-9a-f]{64}$` |
| `sha256` | string | yes      | matches `^[0-9a-f]{64}$` |

### BlobSubject

| Field    | Type           | Required | Constraint                                 |
| -------- | -------------- | -------- | ------------------------------------------ |
| `name`   | string         | yes      | at least 1 character; not `"oci-manifest"` |
| `digest` | PrismDigestSet | yes      | see PrismDigestSet                         |

### OciManifestSubject

| Field           | Type   | Required | Constraint               |
| --------------- | ------ | -------- | ------------------------ |
| `name`          | string | yes      | = `"oci-manifest"`       |
| `digest`        | object | yes      | no other members         |
| `digest.sha256` | string | yes      | matches `^[0-9a-f]{64}$` |

## Envelope

The bundle wraps each statement in an envelope whose payload type is `application/vnd.in-toto+json`.

Schema: `https://schemas.uor.foundation/prism/attestation/dsse-envelope/1`, file `schemas/attestation/dsse-envelope.schema.json`.

| Field                | Type   | Required | Constraint                                               |
| -------------------- | ------ | -------- | -------------------------------------------------------- |
| `payload`            | string | yes      | matches `^[A-Za-z0-9+/_-]*={0,2}$`                       |
| `payloadType`        | string | yes      | = `"application/vnd.in-toto+json"`                       |
| `signatures`         | array  | yes      | at least 1 item                                          |
| `signatures[]`       | object | yes      | no other members                                         |
| `signatures[].keyid` | string | no       |                                                          |
| `signatures[].sig`   | string | yes      | matches `^[A-Za-z0-9+/_-]*={0,2}$`; at least 1 character |

## Predicate types

| Type                                     | Status      | Schema |
| ---------------------------------------- | ----------- | ------ |
| `https://uor.foundation/prism/proof/v1`  | placeholder | none   |
| `https://uor.foundation/prism/replay/v1` | placeholder | none   |

## Example statement

Status: no holo carries a signed statement yet. Every predicate type in the registry is a placeholder, so no statement is captured on this page.

## Next steps

- [Holo format](/docs/reference/holo-format)
- [Errors reference](/docs/reference/errors)
- [Spec package](/docs/api/spec-package)

Generated from @prism-code/spec 2026-10-23 at 16b5ff3a40856cdc77824b092f10f5eea75ec6c2.

<!-- reference/manifest -->

---
title: Manifest reference
description: Every table and key in prism.toml.
---

Source: `@prism-code/spec` 2026-10-23.

## Fields

Status: no manifest schema exists in the spec package at this revision. This page is generated from it once one does.

## Next steps

- [Lockfile reference](/docs/reference/lockfile)
- [CLI reference](/docs/reference/cli)
- [Holo format](/docs/reference/holo-format)

Generated from @prism-code/spec 2026-10-23 at 16b5ff3a40856cdc77824b092f10f5eea75ec6c2.

<!-- reference/lockfile -->

---
title: Lockfile reference
description: Every field of the lockfile, from the schema the spec package publishes.
---

Source: `@prism-code/spec` 2026-10-23, `schemas/documents/sdk-lock-v1.schema.json`, `schemas/documents/sdk-lock-v2.schema.json`, `schemas/documents/sdk-lock-v3.schema.json`.

The lockfile is a JSON document whose `schema` member names its version.

## `prismpm/sdk-lock/3`

Schema: `https://schemas.uor.foundation/prismpm/sdk-lock/3`, file `schemas/documents/sdk-lock-v3.schema.json`.

| Field                                            | Type           | Required | Constraint                                                                                                                                                       |
| ------------------------------------------------ | -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputs`                                         | object         | yes      | no other members                                                                                                                                                 |
| `inputs.generation`                              | object         | yes      | no other members                                                                                                                                                 |
| `inputs.generation.application_generator_sha256` | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.generation.library_generator_sha256`     | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.model`                                   | object         | yes      | no other members                                                                                                                                                 |
| `inputs.model.blake3`                            | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.model.sha256`                            | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.spec`                                    | object         | yes      | no other members                                                                                                                                                 |
| `inputs.spec.basis`                              | string         | yes      | one of `"model-sources"`, `"prism-toml"`                                                                                                                         |
| `inputs.spec.blake3`                             | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.toolchain`                               | object         | yes      | no other members                                                                                                                                                 |
| `inputs.toolchain.lean`                          | string         | yes      | matches `^v[0-9]+.[0-9]+.[0-9]+(-[0-9A-Za-z.-]+)?$`; 5 to 64 characters                                                                                          |
| `inputs.toolchain.lexlean`                       | string         | yes      | matches `^[0-9]+.[0-9]+.[0-9]+(-[0-9A-Za-z.-]+)?$`; 5 to 64 characters                                                                                           |
| `inputs.toolchain.prismpm`                       | string         | yes      | matches `^[0-9]+.[0-9]+.[0-9]+(-[0-9A-Za-z.-]+)?$`; 5 to 64 characters                                                                                           |
| `inputs.toolchain.rustc`                         | string         | yes      | matches `^[0-9]+.[0-9]+.[0-9]+(-[0-9A-Za-z.-]+)?$`; 5 to 64 characters                                                                                           |
| `inputs.toolchain.wasm_bindgen`                  | string         | yes      | matches `^[0-9]+.[0-9]+.[0-9]+(-[0-9A-Za-z.-]+)?$`; 5 to 64 characters                                                                                           |
| `inputs.world`                                   | one of 2 forms | yes      |                                                                                                                                                                  |
| `inputs.world (form 1)`                          | null           | yes      |                                                                                                                                                                  |
| `inputs.world (form 2)`                          | object         | yes      | no other members                                                                                                                                                 |
| `inputs.world (form 2).blake3`                   | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.world (form 2).contract`                 | string         | yes      | one of `"hologram:guest/core-wasm@1"`                                                                                                                            |
| `inputs.world (form 2).sha256`                   | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `platforms`                                      | array          | yes      | exactly 2 items; unique items                                                                                                                                    |
| `platforms[]`                                    | object         | yes      | no other members                                                                                                                                                 |
| `platforms[].inventory`                          | array          | yes      | 1 to 8192 items; unique items                                                                                                                                    |
| `platforms[].inventory[]`                        | object         | yes      | no other members                                                                                                                                                 |
| `platforms[].inventory[].digest`                 | string         | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].inventory[].id`                     | string         | yes      | 1 to 128 characters                                                                                                                                              |
| `platforms[].inventory[].kind`                   | string         | yes      | one of `"binary"`, `"crate"`, `"image"`, `"adapter"`, `"oracle"`, `"schema"`, `"workflow"`, `"base-image"`, `"dependency-lock"`, `"trust-root"`, `"test-corpus"` |
| `platforms[].inventory[].version`                | string         | yes      | 1 to 128 characters                                                                                                                                              |
| `platforms[].inventory_digest`                   | string         | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].manifest_digest`                    | string         | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].platform`                           | string         | yes      | one of `"linux/amd64"`, `"linux/arm64"`                                                                                                                          |
| `platforms[].inventory_document`                 | string         | yes      | 1 to 8388608 characters                                                                                                                                          |
| `schema`                                         | string         | yes      | = `"prismpm/sdk-lock/3"`                                                                                                                                         |
| `sdk_image`                                      | string         | yes      | matches `^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$`                                                                                        |
| `sdk_index`                                      | string         | yes      | 1 to 1048576 characters                                                                                                                                          |
| `sdk_version`                                    | string         | yes      | = `"0.3.0"`                                                                                                                                                      |
| `standards_lock`                                 | string         | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |

## `prismpm/sdk-lock/2`

Schema: `https://schemas.uor.foundation/prismpm/sdk-lock/2`, file `schemas/documents/sdk-lock-v2.schema.json`.

| Field                             | Type   | Required | Constraint                                                                                                                                                       |
| --------------------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platforms`                       | array  | yes      | exactly 2 items; unique items                                                                                                                                    |
| `platforms[]`                     | object | yes      | no other members                                                                                                                                                 |
| `platforms[].inventory`           | array  | yes      | 1 to 8192 items; unique items                                                                                                                                    |
| `platforms[].inventory[]`         | object | yes      | no other members                                                                                                                                                 |
| `platforms[].inventory[].digest`  | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].inventory[].id`      | string | yes      | 1 to 128 characters                                                                                                                                              |
| `platforms[].inventory[].kind`    | string | yes      | one of `"binary"`, `"crate"`, `"image"`, `"adapter"`, `"oracle"`, `"schema"`, `"workflow"`, `"base-image"`, `"dependency-lock"`, `"trust-root"`, `"test-corpus"` |
| `platforms[].inventory[].version` | string | yes      | 1 to 128 characters                                                                                                                                              |
| `platforms[].inventory_digest`    | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].manifest_digest`     | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].platform`            | string | yes      | one of `"linux/amd64"`, `"linux/arm64"`                                                                                                                          |
| `platforms[].inventory_document`  | string | yes      | 1 to 8388608 characters                                                                                                                                          |
| `schema`                          | string | yes      | = `"prismpm/sdk-lock/2"`                                                                                                                                         |
| `sdk_image`                       | string | yes      | matches `^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$`                                                                                        |
| `sdk_index`                       | string | yes      | 1 to 1048576 characters                                                                                                                                          |
| `sdk_version`                     | string | yes      | = `"0.3.0"`                                                                                                                                                      |
| `standards_lock`                  | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |

## `prismpm/sdk-lock/1`

Schema: `https://schemas.uor.foundation/prismpm/sdk-lock/1`, file `schemas/documents/sdk-lock-v1.schema.json`.

| Field                 | Type   | Required | Constraint                                                                                                                                                       |
| --------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory`           | array  | yes      | 1 to 8192 items; unique items                                                                                                                                    |
| `inventory[]`         | object | yes      | no other members                                                                                                                                                 |
| `inventory[].digest`  | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `inventory[].id`      | string | yes      | 1 to 128 characters                                                                                                                                              |
| `inventory[].kind`    | string | yes      | one of `"binary"`, `"crate"`, `"image"`, `"adapter"`, `"oracle"`, `"schema"`, `"workflow"`, `"base-image"`, `"dependency-lock"`, `"trust-root"`, `"test-corpus"` |
| `inventory[].version` | string | yes      | 1 to 128 characters                                                                                                                                              |
| `sdk_image`           | string | yes      | matches `^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$`                                                                                        |
| `sdk_version`         | string | yes      | = `"0.3.0"`                                                                                                                                                      |
| `schema`              | string | yes      | = `"prismpm/sdk-lock/1"`                                                                                                                                         |
| `standards_lock`      | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |

## Next steps

- [Manifest reference](/docs/reference/manifest)
- [Holo format](/docs/reference/holo-format)
- [CLI reference](/docs/reference/cli)

Generated from @prism-code/spec 2026-10-23 at 16b5ff3a40856cdc77824b092f10f5eea75ec6c2.

<!-- reference/errors -->

---
title: Errors reference
description: Every error code the runtime raises and every CLI exit code.
---

Source: `prism-code` 0.2.0 source and type declarations, `sdk/docs/cli.json` 2026-10-23.

## Runtime errors

Status: the typed error classes of the v1.0 runtime are not in prism-code 0.2.0, which raises one class with a code. The table lists every code its source raises.

```ts
export class PrismCodeError extends Error {
  code: string;
  details?: unknown;
}
```

| Code                 | Raised in                            |
| -------------------- | ------------------------------------ |
| `archive.blob`       | `src/archive.mjs`                    |
| `archive.bounds`     | `src/archive.mjs`                    |
| `archive.directory`  | `src/archive.mjs`                    |
| `archive.extension`  | `src/archive.mjs`                    |
| `archive.flags`      | `src/archive.mjs`                    |
| `archive.input`      | `src/archive.mjs`                    |
| `archive.kind`       | `src/archive.mjs`                    |
| `archive.magic`      | `src/archive.mjs`                    |
| `archive.manifest`   | `src/archive.mjs`                    |
| `archive.metadata`   | `src/archive.mjs`                    |
| `archive.model`      | `src/archive.mjs`, `src/index.mjs`   |
| `archive.provenance` | `src/archive.mjs`                    |
| `archive.version`    | `src/archive.mjs`                    |
| `closure.files`      | `src/browser.mjs`, `src/closure.mjs` |
| `closure.glue`       | `src/closure.mjs`                    |
| `closure.model`      | `src/closure.mjs`                    |
| `closure.provenance` | `src/closure.mjs`                    |
| `core.allocation`    | `src/closure.mjs`, `src/core.mjs`    |
| `core.compile`       | `src/core.mjs`                       |
| `core.exports`       | `src/core.mjs`                       |
| `core.imports`       | `src/core.mjs`                       |
| `core.request`       | `src/core.mjs`                       |
| `core.response`      | `src/core.mjs`                       |
| `load.fetch`         | `src/browser.mjs`                    |
| `load.path`          | `src/node.mjs`                       |
| `load.source`        | `src/index.mjs`                      |
| `lock.image`         | `src/docker.mjs`                     |
| `mount.environment`  | `src/browser.mjs`                    |
| `view.bounds`        | `src/view.mjs`                       |
| `view.entry`         | `src/view.mjs`                       |
| `view.magic`         | `src/view.mjs`                       |
| `view.order`         | `src/view.mjs`                       |
| `view.version`       | `src/view.mjs`                       |

## CLI exit codes

| Code | Name          | Meaning                                                                                               |
| ---- | ------------- | ----------------------------------------------------------------------------------------------------- |
| 0    | pass          | The verb did what you asked and every check it ran passed.                                            |
| 1    | fail          | A check failed, an intent sentence is unproved, or a replay diverged.                                 |
| 2    | cannot verify | No verdict was reached: a missing attestation, an unreachable registry or an unknown format revision. |

## Next steps

- [CLI reference](/docs/reference/cli)
- [Error types](/docs/api/errors)
- [Load a holo](/docs/api/load)

Generated from prism-code 0.2.0, sdk/docs/cli.json 2026-10-23, @prism-code/spec 2026-10-23 at 16b5ff3a40856cdc77824b092f10f5eea75ec6c2.

<!-- reference/cli -->

---
title: CLI reference
description: Every prism verb, its flags, its exit codes and its usage.
---

Source: `sdk/docs/cli.json` 2026-10-23, the stand-in for `prism --help --json`.

`prismpm` is an alias of `prism` and is kept through every 1.x release.

## Global flags

| Flag                   | Default            | Meaning                                                      |
| ---------------------- | ------------------ | ------------------------------------------------------------ |
| `--json`               | off                | Print the result as one JSON object instead of text.         |
| `--policy <file>`      | the default policy | Policy file for `check` and `run`.                           |
| `--unstable-<feature>` | off                | Enable one experimental feature by name for this invocation. |
| `--help`               |                    | Print usage for the verb and exit 0.                         |

## Exit codes

| Code | Name          | Meaning                                                                                               |
| ---- | ------------- | ----------------------------------------------------------------------------------------------------- |
| 0    | pass          | The verb did what you asked and every check it ran passed.                                            |
| 1    | fail          | A check failed, an intent sentence is unproved, or a replay diverged.                                 |
| 2    | cannot verify | No verdict was reached: a missing attestation, an unreachable registry or an unknown format revision. |

## Verbs

Status: the prism CLI has not shipped, so no verb output is captured. Usage and flags come from the stand-in description.

### init

Scaffold a new application: `prism.toml`, `examples/`, `intent.md`, a default capability set and the lockfile.

```bash
prism init [<name>] [flags]
```

| Flag                                  | Default | Meaning                                |
| ------------------------------------- | ------- | -------------------------------------- |
| `--types <ts\|json-schema\|pydantic>` | ts      | Which type source the scaffold writes. |
| `--template <name>`                   | minimal | Starting examples and intent.          |
| `--force`                             | off     | Overwrite files that already exist.    |

```bash
prism init calculator
```

### build

Compile the model into a holo inside the pinned toolchain image, record provenance and the proof attestation, and cache the result by spec digest.

```bash
prism build [flags]
```

| Flag                       | Default | Meaning                                                                                              |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `--provenance=<min\|max>`  | min     | How much the provenance records. `max` adds every resolved input and the full toolchain environment. |
| `--no-provenance`          | off     | Skip provenance. Unsafe: the holo cannot pass `check` above P0.                                      |
| `--no-cache`               | off     | Rebuild even when the spec digest is unchanged.                                                      |
| `--target <browser\|node>` | none    | Apply the matching overlay, `prism.browser.toml` or `prism.node.toml`.                               |
| `--max-iterations <n>`     | 10      | How many times the agent may revise the model before the build fails.                                |

```bash
prism build
```

### check

Verify the holo's digest, provenance, proof, lockfile pins and declared world against a policy, then print a verdict with the assurance level and reasons.

```bash
prism check [<ref>] [flags]
```

| Flag              | Default            | Meaning                                                                    |
| ----------------- | ------------------ | -------------------------------------------------------------------------- |
| `--policy <file>` | the default policy | Policy to judge against.                                                   |
| `--offline`       | off                | Do not contact the transparency log or any registry. Missing data exits 2. |

```bash
prism check calculator@sha256:3f9c
```

### run

Instantiate the holo after `check` passes at the policy's level, then grant exactly the capability set it declares.

```bash
prism run <ref> [flags]
```

| Flag                 | Default            | Meaning                                                       |
| -------------------- | ------------------ | ------------------------------------------------------------- |
| `--input <json>`     | stdin              | One input to dispatch. Omit it to read inputs line by line.   |
| `--policy <file>`    | the default policy | Policy the gate judges against.                               |
| `--allow-unverified` | off                | Run even when `check` fails. Prints a warning on every start. |
| `--port <n>`         | none               | Serve the instance over HTTP instead of dispatching once.     |

```bash
prism run calculator@sha256:3f9c --input '{"op":"add","a":2,"b":3}'
```

### dev

Watch the model, rebuild and re-check on every change, and serve a local studio with Check and Replay tabs.

```bash
prism dev [flags]
```

| Flag              | Default            | Meaning                              |
| ----------------- | ------------------ | ------------------------------------ |
| `--port <n>`      | 4100               | Studio port.                         |
| `--no-open`       | off                | Do not open the studio in a browser. |
| `--policy <file>` | the default policy | Policy the Check tab judges against. |

```bash
prism dev
```

### replay

Re-execute a recorded history against the current build and fail on the first divergence.

```bash
prism replay <history> [flags]
```

| Flag           | Default           | Meaning                                                  |
| -------------- | ----------------- | -------------------------------------------------------- |
| `--holo <ref>` | the current build | Which holo to replay against.                            |
| `--all`        | off               | Continue past the first divergence and report every one. |

```bash
prism replay history/2026-10-23.jsonl
```

### push

Push a holo and its attestations to an OCI registry. The attestations travel as referrers of the holo.

```bash
prism push <ref> <registry/repo[:tag]> [flags]
```

| Flag                | Default | Meaning                                                |
| ------------------- | ------- | ------------------------------------------------------ |
| `--store <dir>`     | none    | Push to a local directory store instead of a registry. |
| `--no-attestations` | off     | Push the holo only. The pushed holo checks at P0.      |

```bash
prism push calculator@sha256:3f9c ghcr.io/acme/calculator:1.0
```

### pull

Pull a holo and its attestations from an OCI registry or a local directory store.

```bash
prism pull <registry/repo[:tag]|ref> [flags]
```

| Flag            | Default | Meaning                                                |
| --------------- | ------- | ------------------------------------------------------ |
| `--store <dir>` | none    | Pull from a local directory store.                     |
| `--check`       | off     | Run `check` on the pulled holo and exit with its code. |

```bash
prism pull ghcr.io/acme/calculator:1.0
```

### deploy

Publish the holo to a GitHub repository and GitHub Pages, serving its attestations alongside it.

```bash
prism deploy [<ref>] [flags]
```

| Flag                  | Default        | Meaning                     |
| --------------------- | -------------- | --------------------------- |
| `--repo <owner/name>` | the git remote | Repository to publish to.   |
| `--branch <name>`     | gh-pages       | Branch GitHub Pages serves. |
| `--no-pages`          | off            | Push the repository only.   |

```bash
prism deploy
```

### export

Write the six-file browser export, a tarball, or a runnable OCI image that `docker run` serves.

```bash
prism export [<ref>] [flags]
```

| Flag               | Default | Meaning                                     |
| ------------------ | ------- | ------------------------------------------- |
| `--out <dir>`      | export/ | Where the browser export is written.        |
| `--tar <file>`     | none    | Write one tarball instead of a directory.   |
| `--oci <name:tag>` | none    | Write a runnable OCI image under this name. |

```bash
prism export --oci acme/calculator:1.0
```

### inspect

Print the manifest, section digests, format revision, world and attestations of a holo without running it.

```bash
prism inspect <ref> [flags]
```

| Flag                                                           | Default | Meaning                                                                       |
| -------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `--format <manifest\|sections\|world\|attestations\|revision>` | all     | Print one part only.                                                          |
| `--audit`                                                      | off     | Print the security view: signers, trusted base, capability set, theorem list. |
| `--report <file>`                                              | none    | With `--audit`, write the report to a file.                                   |

```bash
prism inspect calculator@sha256:3f9c
```

### attest

Add a signed statement to a holo. Signing is keyless by default.

```bash
prism attest <ref> --predicate <file> --type <uri> [flags]
```

| Flag                 | Default  | Meaning                                                      |
| -------------------- | -------- | ------------------------------------------------------------ |
| `--predicate <file>` | required | JSON file holding the predicate.                             |
| `--type <uri>`       | required | Predicate type URI.                                          |
| `--key <file>`       | none     | Sign with a local key for air-gapped use instead of keyless. |

```bash
prism attest calculator@sha256:3f9c --predicate sbom.json --type https://example.com/sbom/v1
```

### verify

Check a signed statement on a holo against the signing identity you expect.

```bash
prism verify <ref> --certificate-identity <id> --certificate-oidc-issuer <url> [flags]
```

| Flag                              | Default  | Meaning                                               |
| --------------------------------- | -------- | ----------------------------------------------------- |
| `--certificate-identity <id>`     | required | Identity the statement must be signed by.             |
| `--certificate-oidc-issuer <url>` | required | Issuer that identity must come from.                  |
| `--type <uri>`                    | all      | Verify statements of one predicate type only.         |
| `--key <file>`                    | none     | Verify against a local public key instead of keyless. |

```bash
prism verify calculator@sha256:3f9c --certificate-identity ci@acme.example --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### generate

Regenerate the JS, Rust and Python bindings and the typed client from the world. Nothing is written when nothing changed.

```bash
prism generate [flags]
```

| Flag                      | Default    | Meaning                  |
| ------------------------- | ---------- | ------------------------ |
| `--out <dir>`             | generated/ | Output path.             |
| `--lang <js,rust,python>` | all three  | Which bindings to write. |

```bash
prism generate
```

### lock

Write or refresh the lockfile from the current toolchain image, model and inputs.

```bash
prism lock [flags]
```

| Flag      | Default | Meaning                                           |
| --------- | ------- | ------------------------------------------------- |
| `--check` | off     | Exit 1 when the lockfile is stale. Write nothing. |

```bash
prism lock
```

### update

Bump the pinned toolchain image and print the old and new digests.

```bash
prism update [flags]
```

| Flag                | Default         | Meaning                                        |
| ------------------- | --------------- | ---------------------------------------------- |
| `--toolchain <ref>` | the current 1.x | Toolchain image to pin.                        |
| `--dry-run`         | off             | Print the change without writing the lockfile. |

```bash
prism update
```

## Next steps

- [Manifest reference](/docs/reference/manifest)
- [Errors reference](/docs/reference/errors)
- [Lockfile reference](/docs/reference/lockfile)

Generated from sdk/docs/cli.json 2026-10-23 (stand-in for prism --help --json).

<!-- api/index -->

---
title: prism-code at a glance
description: Load a holo, dispatch an input and replay its examples from Node.js with the prism-code runtime.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`.

## Install

```bash
npm install prism-code
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');
console.log(app.name, app.identities.verified);

const response = await app.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
console.log(JSON.stringify(new TextDecoder().decode(response)));

const result = await app.acceptance();
console.log(result.passed, 'of', result.total, 'examples replayed');
```

```text
Calculator true
"1\tok\t42"
22 of 22 examples replayed
```

## Exports

| Export              | Kind      | Declaration                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PrismCodeError`    | class     | `PrismCodeError extends Error`                                                                                                                                                                                                                                                                                                                                                                 |
| `Limits`            | interface | `Limits`                                                                                                                                                                                                                                                                                                                                                                                       |
| `Vector`            | interface | `Vector`                                                                                                                                                                                                                                                                                                                                                                                       |
| `AcceptanceFailure` | interface | `AcceptanceFailure`                                                                                                                                                                                                                                                                                                                                                                            |
| `AcceptanceResult`  | interface | `AcceptanceResult`                                                                                                                                                                                                                                                                                                                                                                             |
| `View`              | interface | `View`                                                                                                                                                                                                                                                                                                                                                                                         |
| `ArchiveIdentities` | interface | `ArchiveIdentities`                                                                                                                                                                                                                                                                                                                                                                            |
| `ClosureIdentities` | interface | `ClosureIdentities`                                                                                                                                                                                                                                                                                                                                                                            |
| `Evidence`          | interface | `Evidence`                                                                                                                                                                                                                                                                                                                                                                                     |
| `Application`       | interface | `Application`                                                                                                                                                                                                                                                                                                                                                                                  |
| `LoadOptions`       | interface | `LoadOptions`                                                                                                                                                                                                                                                                                                                                                                                  |
| `load`              | function  | `load(source: Uint8Array \| ArrayBuffer \| Blob \| string \| URL, options?: LoadOptions): Promise<Application>`                                                                                                                                                                                                                                                                                |
| `loadArchive`       | function  | `loadArchive(source: Uint8Array \| ArrayBuffer): Promise<Application>`                                                                                                                                                                                                                                                                                                                         |
| `loadClosure`       | function  | `loadClosure( files: Map<string, Uint8Array>, importGlue: (name: string) => Promise<Record<string, unknown>>, options?: { model?: Record<string, unknown> \| Uint8Array \| null }, ): Promise<Application>`                                                                                                                                                                                    |
| `ParsedArchive`     | interface | `ParsedArchive`                                                                                                                                                                                                                                                                                                                                                                                |
| `parseArchive`      | function  | `parseArchive(source: Uint8Array \| ArrayBuffer): ParsedArchive`                                                                                                                                                                                                                                                                                                                               |
| `resolveArchive`    | function  | `resolveArchive(parsed: ParsedArchive): { directory: Record<string, unknown>; provenance: Record<string, unknown>; modelDocument: Record<string, unknown>; guest: { label: string; content: Uint8Array }; view: { label: string; content: Uint8Array }; model: { label: string; content: Uint8Array }; capabilities: { label: string; content: Uint8Array }; identities: ArchiveIdentities; }` |
| `canonicalJson`     | function  | `canonicalJson(value: unknown): string`                                                                                                                                                                                                                                                                                                                                                        |
| `decodeHoloview`    | function  | `decodeHoloview(bytes: Uint8Array): View`                                                                                                                                                                                                                                                                                                                                                      |
| `encodeHoloview`    | function  | `encodeHoloview(view: View): Uint8Array`                                                                                                                                                                                                                                                                                                                                                       |
| `compileGuest`      | function  | `compileGuest(wasm: Uint8Array): Promise<WebAssembly.Module>`                                                                                                                                                                                                                                                                                                                                  |
| `runGuest`          | function  | `runGuest(module: WebAssembly.Module, request: Uint8Array, limits?: Partial<Limits>): Uint8Array`                                                                                                                                                                                                                                                                                              |
| `runAcceptance`     | function  | `runAcceptance(vectors: Vector[], dispatch: (request: Uint8Array) => Uint8Array \| Promise<Uint8Array>): Promise<AcceptanceResult>`                                                                                                                                                                                                                                                            |
| `verifyClosure`     | function  | `verifyClosure(files: Map<string, Uint8Array>): Promise<{ stem: string; glueName: string; wasmName: string; provenance: Record<string, unknown>; verification: Pick<ClosureIdentities, 'verified' \| 'mismatches' \| 'unverifiable'>; }>`                                                                                                                                                      |
| `blake3`            | function  | `blake3(bytes: Uint8Array, length?: number): Uint8Array`                                                                                                                                                                                                                                                                                                                                       |
| `blake3Hex`         | function  | `blake3Hex(bytes: Uint8Array): string`                                                                                                                                                                                                                                                                                                                                                         |
| `kappa`             | function  | `kappa(bytes: Uint8Array): string`                                                                                                                                                                                                                                                                                                                                                             |
| `canonicalize`      | export    | `from ../src/canonical/index.js`                                                                                                                                                                                                                                                                                                                                                               |
| `codeHash`          | export    | `from ../src/canonical/index.js`                                                                                                                                                                                                                                                                                                                                                               |
| `describe`          | export    | `from ../src/canonical/index.js`                                                                                                                                                                                                                                                                                                                                                               |
| `differs`           | export    | `from ../src/canonical/index.js`                                                                                                                                                                                                                                                                                                                                                               |

## Next steps

- [Load a holo](/docs/api/load)
- [Dispatch inputs](/docs/api/dispatch)
- [History and replay](/docs/api/history-and-replay)

Generated from prism-code 0.2.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.

<!-- api/load -->

---
title: Load a holo
description: Read a holo from a path, a URL or bytes and get an application you can inspect and run.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`.

## Signature

```ts
export function load(source: Uint8Array | ArrayBuffer | Blob | string | URL, options?: LoadOptions): Promise<Application>;

export interface LoadOptions {
  model?: Record<string, unknown> | Uint8Array | string | null;
  stem?: string;
  files?: string[];
}
```

## Returns

```ts
export interface Application {
  kind: 'holo' | 'closure';
  name: string | null;
  model: Record<string, unknown> | null;
  profile: string | null;
  limits: Limits | null;
  vectors: Vector[];
  provenance: { model: Record<string, unknown> | null; browser: Record<string, unknown> | null };
  directory: Record<string, unknown> | null;
  metadata: unknown;
  identities: ArchiveIdentities | ClosureIdentities;
  evidence: Evidence;
  view: View;
  dispatch(request: Uint8Array | ArrayBuffer): Promise<Uint8Array>;
  acceptance(): Promise<AcceptanceResult>;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

console.log(app.name);
console.log(app.identities.verified);
console.log(app.limits);
```

```text
Calculator
true
{ request: 52, response: 27, guestAllocation: 65536 }
```

## Next steps

- [Dispatch inputs](/docs/api/dispatch)
- [Inspect a holo](/docs/api/inspect)
- [Holo format](/docs/reference/holo-format)

Generated from prism-code 0.2.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.

<!-- api/inspect -->

---
title: Inspect a holo
description: Read the manifest, digests, world and attestations of a holo without running it.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`; `@prism-code/spec` 2026-10-23, `types/holo.d.ts`.

## Example

Status: `inspect()` is not in prism-code 0.2.0. This page gains an executed example when the runtime ships it. The declarations below are what a reader decodes.

## Signature

```ts
export interface ArchiveIdentities {
  archiveFingerprint: string;
  footer: string;
  guestKappa: string;
  viewKappa: string;
  modelKappa: string;
  capabilitiesKappa: string;
  applicationKappa: string | null;
  verified: boolean;
  consistent: boolean;
}

export interface ParsedArchive {
  bytes: Uint8Array;
  body: Uint8Array;
  version: number;
  flags: number;
  sections: { index: number; kind: number; offset: number; length: number; body: Uint8Array }[];
  manifest: { uri: string; labels: string[]; suffix: Uint8Array; section: number };
  metadata: { text: string; section: number } | null;
  extensions: { name: string; payload: Uint8Array; text: string; section: number }[];
  blobs: { label: string; content: Uint8Array; section: number }[];
  footer: string;
  fingerprint: string;
  verification: { footer: boolean; labels: boolean; labelMismatches: { section: number; label: string; actual: string }[] };
}
```

## What a reader decodes

```ts
export interface SectionTableEntry {
  kind: SectionKindCode;
  offset: number;
  length: number;
}

export type AppManifestLabels = [capabilitySet: KappaLabel, guest: KappaLabel, view: KappaLabel];

export type ExtensionName =
  | 'https://hologram.foundation/extension/application-directory/v1'
  | 'https://uor.foundation/extension/prismpm-model/v1';

export type ContentBlobRole = 'capability-set' | 'guest' | 'model-document' | 'view';
```

## Next steps

- [Load a holo](/docs/api/load)
- [Check a holo](/docs/api/verify)
- [Holo format](/docs/reference/holo-format)

Generated from prism-code 0.2.0, @prism-code/spec 2026-10-23 at 16b5ff3a40856cdc77824b092f10f5eea75ec6c2.

<!-- api/verify -->

---
title: Check a holo
description: Check digest, provenance, proof and world against a policy and get a verdict.
---

Source: `@prism-code/spec` 2026-10-23, `types/holo.d.ts`.

## Example

Status: `verify()` is not in prism-code 0.2.0, which checks the digest footer and every section label on load. This page gains an executed example when the runtime ships the verdict.

## What a reader declares

```ts
export type FormatRevision = '2026-10-23';

export interface RevisionSupport {
  accepts: readonly FormatRevision[];
}

export interface FormatRevisionIdentifiers {
  physicalVersion: number;
  flags: number;
  sectionOrder: readonly SectionKindCode[];
  appManifestUri: string;
  extensions: readonly ExtensionName[];
  coreWasmContract: CoreWasmContract;
  holoviewVersion: number;
  sourceManifestVersion: number;
  provenanceSchema: string;
  modelDocumentSchemas: readonly string[];
}
```

## Next steps

- [Instantiate a holo](/docs/api/instantiate)
- [Attestations reference](/docs/reference/attestations)
- [Load a holo](/docs/api/load)

Generated from @prism-code/spec 2026-10-23 at 16b5ff3a40856cdc77824b092f10f5eea75ec6c2.

<!-- api/instantiate -->

---
title: Instantiate a holo
description: Create a running instance with exactly the capability set you grant.
---

Source: `@prism-code/spec` 2026-10-23, `types/holo.d.ts`, `worlds/core-wasm.wit`.

## Example

Status: `instantiate()` is not in prism-code 0.2.0, which runs each request on a fresh guest instance inside `dispatch()`. The world below is what an instance exports.

## What an instance exports

```ts
export type CoreWasmContract = 'hologram:guest/core-wasm@1';

export interface CoreWasmExports {
  memory: WebAssembly.Memory;
  holo_alloc(length: number): number;
  holo_run(offset: number, length: number): bigint;
}
```

```wit
package hologram:guest@1.0.0;

world core-wasm {
  /// Reserve `length` bytes of guest memory for a request and return their offset.
  export holo-alloc: func(length: u32) -> u32;

  /// Run the request at `offset` with `length` bytes. Returns `offset << 32 | length` of the response.
  export holo-run: func(offset: u32, length: u32) -> u64;
}
```

## Next steps

- [Dispatch inputs](/docs/api/dispatch)
- [Check a holo](/docs/api/verify)
- [Holo format](/docs/reference/holo-format)

Generated from @prism-code/spec 2026-10-23 at 16b5ff3a40856cdc77824b092f10f5eea75ec6c2.

<!-- api/dispatch -->

---
title: Dispatch inputs
description: Send one request to the holo and get its response.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`.

## Signature

```ts
dispatch(request: Uint8Array | ArrayBuffer): Promise<Uint8Array>;

export interface Limits {
  request: number;
  response: number;
  guestAllocation: number;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const request = new TextEncoder().encode('1\tadd\t20\t22');
const response = await app.dispatch(request);

console.log(JSON.stringify(new TextDecoder().decode(response)));
```

```text
"1\tok\t42"
```

## Next steps

- [History and replay](/docs/api/history-and-replay)
- [Error types](/docs/api/errors)
- [Load a holo](/docs/api/load)

Generated from prism-code 0.2.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.

<!-- api/history-and-replay -->

---
title: History and replay
description: Replay the examples a holo carries and prove its behaviour unchanged.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`.

Status: `history()` and `replay()` are not in prism-code 0.2.0. `acceptance()` replays the examples the holo carries and is executed below.

## Signature

```ts
acceptance(): Promise<AcceptanceResult>;

export interface AcceptanceResult {
  total: number;
  passed: number;
  failed: AcceptanceFailure[];
}

export interface AcceptanceFailure {
  index: number;
  request: Uint8Array;
  expected: Uint8Array;
  actual?: Uint8Array;
  error?: unknown;
}

export interface Vector {
  request: Uint8Array;
  response: Uint8Array;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const result = await app.acceptance();

console.log(result);
```

```text
{ total: 22, passed: 22, failed: [] }
```

## Next steps

- [Dispatch inputs](/docs/api/dispatch)
- [CLI reference](/docs/reference/cli)
- [Check a holo](/docs/api/verify)

Generated from prism-code 0.2.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.

<!-- api/as-tool -->

---
title: Use a holo as a tool
description: Wrap a checked holo as a Vercel AI SDK tool so a model can call it.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`.

## Example

Status: `asTool()` is not in prism-code 0.2.0. This page gains its declaration and an executed example when the runtime ships it.

## Next steps

- [Dispatch inputs](/docs/api/dispatch)
- [Load a holo](/docs/api/load)
- [Error types](/docs/api/errors)

Generated from prism-code 0.2.0.

<!-- api/errors -->

---
title: Error types
description: Every error the runtime throws and the code it carries.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`.

## Signature

```ts
export class PrismCodeError extends Error {
  code: string;
  details?: unknown;
}
```

## Codes

| Code                 | Raised in                            |
| -------------------- | ------------------------------------ |
| `archive.blob`       | `src/archive.mjs`                    |
| `archive.bounds`     | `src/archive.mjs`                    |
| `archive.directory`  | `src/archive.mjs`                    |
| `archive.extension`  | `src/archive.mjs`                    |
| `archive.flags`      | `src/archive.mjs`                    |
| `archive.input`      | `src/archive.mjs`                    |
| `archive.kind`       | `src/archive.mjs`                    |
| `archive.magic`      | `src/archive.mjs`                    |
| `archive.manifest`   | `src/archive.mjs`                    |
| `archive.metadata`   | `src/archive.mjs`                    |
| `archive.model`      | `src/archive.mjs`, `src/index.mjs`   |
| `archive.provenance` | `src/archive.mjs`                    |
| `archive.version`    | `src/archive.mjs`                    |
| `closure.files`      | `src/browser.mjs`, `src/closure.mjs` |
| `closure.glue`       | `src/closure.mjs`                    |
| `closure.model`      | `src/closure.mjs`                    |
| `closure.provenance` | `src/closure.mjs`                    |
| `core.allocation`    | `src/closure.mjs`, `src/core.mjs`    |
| `core.compile`       | `src/core.mjs`                       |
| `core.exports`       | `src/core.mjs`                       |
| `core.imports`       | `src/core.mjs`                       |
| `core.request`       | `src/core.mjs`                       |
| `core.response`      | `src/core.mjs`                       |
| `load.fetch`         | `src/browser.mjs`                    |
| `load.path`          | `src/node.mjs`                       |
| `load.source`        | `src/index.mjs`                      |
| `lock.image`         | `src/docker.mjs`                     |
| `mount.environment`  | `src/browser.mjs`                    |
| `view.bounds`        | `src/view.mjs`                       |
| `view.entry`         | `src/view.mjs`                       |
| `view.magic`         | `src/view.mjs`                       |
| `view.order`         | `src/view.mjs`                       |
| `view.version`       | `src/view.mjs`                       |

## Example

Status: the typed error classes of the v1.0 runtime are not in prism-code 0.2.0, which throws one class whose `code` names the check that failed.

## Next steps

- [Errors reference](/docs/reference/errors)
- [Load a holo](/docs/api/load)
- [Dispatch inputs](/docs/api/dispatch)

Generated from prism-code 0.2.0.

<!-- api/spec-package -->

---
title: Spec package
description: The types, JSON Schemas, world file and format revision that every runtime is built from.
---

Source: `@prism-code/spec` 0.1.0, format revision 2026-10-23, `index.d.ts`.

## Install

```bash
npm install @prism-code/spec
```

## Example

```js
import { FORMAT_REVISION, MAGIC, PHYSICAL_VERSION, SECTION_COUNT, SECTION_ORDER, PROOF_PREDICATE_TYPE } from '@prism-code/spec';

console.log(FORMAT_REVISION);
console.log(MAGIC, PHYSICAL_VERSION, SECTION_COUNT);
console.log(SECTION_ORDER.join(' '));
console.log(PROOF_PREDICATE_TYPE);
```

```text
2026-10-23
HOLO 4 8
15 8 14 14 16 16 16 16
https://uor.foundation/prism/proof/v1
```

## Exports

| Export                  | Kind   | Declaration                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ModelDocument`         | type   | `ModelDocument = ModelDocumentV1 \| ModelDocumentV2 \| ModelDocumentV3 \| ModelDocumentV4 \| ModelDocumentV5 \| ModelDocumentV6`                                                                                                                                                                                                                                                                   |
| `SdkLock`               | type   | `SdkLock = SdkLockV1 \| SdkLockV2 \| SdkLockV3`                                                                                                                                                                                                                                                                                                                                                    |
| `FORMAT_REVISION`       | const  | `FORMAT_REVISION: '2026-10-23'`                                                                                                                                                                                                                                                                                                                                                                    |
| `FORMAT_REVISIONS`      | const  | `FORMAT_REVISIONS: Readonly<Record<FormatRevision, Readonly<FormatRevisionIdentifiers>>>`                                                                                                                                                                                                                                                                                                          |
| `MAGIC`                 | const  | `MAGIC: 'HOLO'`                                                                                                                                                                                                                                                                                                                                                                                    |
| `PHYSICAL_VERSION`      | const  | `PHYSICAL_VERSION: 4`                                                                                                                                                                                                                                                                                                                                                                              |
| `FLAGS`                 | const  | `FLAGS: 0`                                                                                                                                                                                                                                                                                                                                                                                         |
| `HEADER_LENGTH`         | const  | `HEADER_LENGTH: 10`                                                                                                                                                                                                                                                                                                                                                                                |
| `TABLE_ENTRY_LENGTH`    | const  | `TABLE_ENTRY_LENGTH: 24`                                                                                                                                                                                                                                                                                                                                                                           |
| `SECTION_COUNT`         | const  | `SECTION_COUNT: 8`                                                                                                                                                                                                                                                                                                                                                                                 |
| `BODY_OFFSET`           | const  | `BODY_OFFSET: 202`                                                                                                                                                                                                                                                                                                                                                                                 |
| `FOOTER_LENGTH`         | const  | `FOOTER_LENGTH: 32`                                                                                                                                                                                                                                                                                                                                                                                |
| `SECTION_KIND`          | const  | `SECTION_KIND: Readonly<SectionKind>`                                                                                                                                                                                                                                                                                                                                                              |
| `SECTION_ORDER`         | const  | `SECTION_ORDER: readonly [15, 8, 14, 14, 16, 16, 16, 16]`                                                                                                                                                                                                                                                                                                                                          |
| `LABEL_PREFIX`          | const  | `LABEL_PREFIX: 'blake3:'`                                                                                                                                                                                                                                                                                                                                                                          |
| `LABEL_LENGTH`          | const  | `LABEL_LENGTH: 71`                                                                                                                                                                                                                                                                                                                                                                                 |
| `APP_MANIFEST`          | const  | `APP_MANIFEST: Readonly<{ URI: 'https://hologram.foundation/realization/app-manifest'; LENGTH: 356; PREFIX_LENGTH: 57; SUFFIX_LENGTH: 86; PREFIX_HEX: string; SUFFIX_HEX: string; LABELS: readonly ['capability-set', 'guest', 'view']; }>`                                                                                                                                                        |
| `CAPABILITY_SET`        | const  | `CAPABILITY_SET: Readonly<{ URI: 'https://hologram.foundation/realization/capability-set'; EMPTY_HEX: string; }>`                                                                                                                                                                                                                                                                                  |
| `EXTENSION`             | const  | `EXTENSION: Readonly<{ APPLICATION_DIRECTORY: Extract<ExtensionName, 'https://hologram.foundation/extension/application-directory/v1'>; PRISMPM_MODEL: Extract<ExtensionName, 'https://uor.foundation/extension/prismpm-model/v1'>; }>`                                                                                                                                                            |
| `CORE_WASM`             | const  | `CORE_WASM: Readonly<{ CONTRACT: CoreWasmContract; EXPORTS: readonly ['holo_alloc', 'holo_run', 'memory']; ALLOCATOR: 'holo_alloc'; ENTRY: 'holo_run'; WORLD: 'worlds/core-wasm.wit'; }>`                                                                                                                                                                                                          |
| `HOLOVIEW`              | const  | `HOLOVIEW: Readonly<HoloviewLimits>`                                                                                                                                                                                                                                                                                                                                                               |
| `SCHEMAS`               | const  | `SCHEMAS: Readonly<Record< \| 'prismpm/model-document/1' \| 'prismpm/model-document/2' \| 'prismpm/model-document/3' \| 'prismpm/model-document/4' \| 'prismpm/model-document/5' \| 'prismpm/model-document/6' \| 'prismpm/sdk-lock/1' \| 'prismpm/sdk-lock/2' \| 'prismpm/sdk-lock/3' \| 'prismpm/model-provenance/1' \| 'prismpm/build-manifest/1' \| 'prismpm/browser-provenance/1', string >>` |
| `HOLO_SCHEMAS`          | const  | `HOLO_SCHEMAS: Readonly<{ ARCHIVE: 'schemas/holo/archive.schema.json'; APP_MANIFEST: 'schemas/holo/app-manifest.schema.json'; SOURCE_MANIFEST: 'schemas/holo/source-manifest.schema.json'; APPLICATION_DIRECTORY: 'schemas/holo/application-directory.schema.json'; }>`                                                                                                                            |
| `ATTESTATION`           | const  | `ATTESTATION: Readonly<{ STATEMENT_TYPE: 'https://in-toto.io/Statement/v1'; DSSE_PAYLOAD_TYPE: 'application/vnd.in-toto+json'; OCI_MANIFEST_SUBJECT: 'oci-manifest'; STATEMENT_SCHEMA: 'schemas/attestation/statement.schema.json'; ENVELOPE_SCHEMA: 'schemas/attestation/dsse-envelope.schema.json'; }>`                                                                                          |
| `PROOF_PREDICATE_TYPE`  | export | `from ./predicates/proof-v1.js`                                                                                                                                                                                                                                                                                                                                                                    |
| `REPLAY_PREDICATE_TYPE` | export | `from ./predicates/replay-v1.js`                                                                                                                                                                                                                                                                                                                                                                   |

## Schemas

| Document                       | File                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `prismpm/model-document/1`     | `schemas/documents/model-document-v1.schema.json`     |
| `prismpm/model-document/2`     | `schemas/documents/model-document-v2.schema.json`     |
| `prismpm/model-document/3`     | `schemas/documents/model-document-v3.schema.json`     |
| `prismpm/model-document/4`     | `schemas/documents/model-document-v4.schema.json`     |
| `prismpm/model-document/5`     | `schemas/documents/model-document-v5.schema.json`     |
| `prismpm/model-document/6`     | `schemas/documents/model-document-v6.schema.json`     |
| `prismpm/sdk-lock/1`           | `schemas/documents/sdk-lock-v1.schema.json`           |
| `prismpm/sdk-lock/2`           | `schemas/documents/sdk-lock-v2.schema.json`           |
| `prismpm/sdk-lock/3`           | `schemas/documents/sdk-lock-v3.schema.json`           |
| `prismpm/model-provenance/1`   | `schemas/documents/model-provenance-v1.schema.json`   |
| `prismpm/build-manifest/1`     | `schemas/documents/build-manifest-v1.schema.json`     |
| `prismpm/browser-provenance/1` | `schemas/documents/browser-provenance-v1.schema.json` |

| Section                 | File                                             |
| ----------------------- | ------------------------------------------------ |
| `ARCHIVE`               | `schemas/holo/archive.schema.json`               |
| `APP_MANIFEST`          | `schemas/holo/app-manifest.schema.json`          |
| `SOURCE_MANIFEST`       | `schemas/holo/source-manifest.schema.json`       |
| `APPLICATION_DIRECTORY` | `schemas/holo/application-directory.schema.json` |

## World

`worlds/core-wasm.wit` declares `hologram:guest/core-wasm@1`.

## Next steps

- [Holo format](/docs/reference/holo-format)
- [Attestations reference](/docs/reference/attestations)
- [prism-code at a glance](/docs/api)

Generated from @prism-code/spec 2026-10-23 at 16b5ff3a40856cdc77824b092f10f5eea75ec6c2.

<!-- api/verify-package -->

---
title: Check in the browser
description: Check a holo offline in any browser without loading the runtime.
---

Source: none at `@prism-code/spec` 2026-10-23.

## Example

Status: `@prism-code/verify` does not exist yet. This page is generated from its declarations once it does.

## Next steps

- [Check a holo](/docs/api/verify)
- [Spec package](/docs/api/spec-package)
- [Load a holo](/docs/api/load)

Generated from @prism-code/spec 2026-10-23 at 16b5ff3a40856cdc77824b092f10f5eea75ec6c2.

<!-- api/testing-package -->

---
title: Testing package
description: Test code that drives a holo with a mock host, skipped time and scripted dispatch.
---

Source: none at `@prism-code/spec` 2026-10-23.

## Example

Status: `@prism-code/testing` does not exist yet. This page is generated from its declarations once it does.

## Next steps

- [History and replay](/docs/api/history-and-replay)
- [Dispatch inputs](/docs/api/dispatch)
- [prism-code at a glance](/docs/api)

Generated from @prism-code/spec 2026-10-23 at 16b5ff3a40856cdc77824b092f10f5eea75ec6c2.

