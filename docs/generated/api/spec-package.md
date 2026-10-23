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
