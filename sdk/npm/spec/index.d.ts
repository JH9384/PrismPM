/**
 * @prism-code/spec: the Prism formats as types, JSON Schemas and WIT.
 * Format revision 2026-10-23. Constants only; no functions.
 */
import type {
  CoreWasmContract,
  ExtensionName,
  FormatRevision,
  FormatRevisionIdentifiers,
  HoloviewLimits,
  SectionKind,
  SectionKindCode,
} from './types/holo.js';
import type { ModelDocumentV1, ModelDocumentV2, ModelDocumentV3, ModelDocumentV4, ModelDocumentV5, ModelDocumentV6, SdkLockV1, SdkLockV2 } from './types/documents.js';

export type * from './types/holo.js';
export type * from './types/documents.js';
export type * from './types/attestation.js';
export type * from './types/predicates.js';
export type { ProofPredicateV1 } from './predicates/proof-v1.js';
export type { ReplayPredicateV1 } from './predicates/replay-v1.js';

/** Any model document, discriminated by `schema`. */
export type ModelDocument = ModelDocumentV1 | ModelDocumentV2 | ModelDocumentV3 | ModelDocumentV4 | ModelDocumentV5 | ModelDocumentV6;
/** `prismpm.lock`, discriminated by `schema`. */
export type SdkLock = SdkLockV1 | SdkLockV2;

export declare const FORMAT_REVISION: '2026-10-23';
export declare const FORMAT_REVISIONS: Readonly<Record<FormatRevision, Readonly<FormatRevisionIdentifiers>>>;

export declare const MAGIC: 'HOLO';
export declare const PHYSICAL_VERSION: 4;
export declare const FLAGS: 0;
export declare const HEADER_LENGTH: 10;
export declare const TABLE_ENTRY_LENGTH: 24;
export declare const SECTION_COUNT: 8;
export declare const BODY_OFFSET: 202;
export declare const FOOTER_LENGTH: 32;
export declare const SECTION_KIND: Readonly<SectionKind>;
export declare const SECTION_ORDER: readonly [15, 8, 14, 14, 16, 16, 16, 16];
export declare const LABEL_PREFIX: 'blake3:';
export declare const LABEL_LENGTH: 71;

export declare const APP_MANIFEST: Readonly<{
  URI: 'https://hologram.foundation/realization/app-manifest';
  LENGTH: 356;
  PREFIX_LENGTH: 57;
  SUFFIX_LENGTH: 86;
  PREFIX_HEX: string;
  SUFFIX_HEX: string;
  LABELS: readonly ['capability-set', 'guest', 'view'];
}>;

export declare const CAPABILITY_SET: Readonly<{
  URI: 'https://hologram.foundation/realization/capability-set';
  EMPTY_HEX: string;
}>;

export declare const EXTENSION: Readonly<{
  APPLICATION_DIRECTORY: Extract<ExtensionName, 'https://hologram.foundation/extension/application-directory/v1'>;
  PRISMPM_MODEL: Extract<ExtensionName, 'https://uor.foundation/extension/prismpm-model/v1'>;
}>;

export declare const CORE_WASM: Readonly<{
  CONTRACT: CoreWasmContract;
  EXPORTS: readonly ['holo_alloc', 'holo_run', 'memory'];
  ALLOCATOR: 'holo_alloc';
  ENTRY: 'holo_run';
  WORLD: 'worlds/core-wasm.wit';
}>;

export declare const HOLOVIEW: Readonly<HoloviewLimits>;

/** Document `schema` value to package-relative JSON Schema path. */
export declare const SCHEMAS: Readonly<Record<
  | 'prismpm/model-document/1'
  | 'prismpm/model-document/2'
  | 'prismpm/model-document/3'
  | 'prismpm/model-document/4'
  | 'prismpm/model-document/5'
  | 'prismpm/model-document/6'
  | 'prismpm/sdk-lock/1'
  | 'prismpm/sdk-lock/2'
  | 'prismpm/model-provenance/1'
  | 'prismpm/build-manifest/1'
  | 'prismpm/browser-provenance/1',
  string
>>;

export declare const HOLO_SCHEMAS: Readonly<{
  ARCHIVE: 'schemas/holo/archive.schema.json';
  APP_MANIFEST: 'schemas/holo/app-manifest.schema.json';
  SOURCE_MANIFEST: 'schemas/holo/source-manifest.schema.json';
  APPLICATION_DIRECTORY: 'schemas/holo/application-directory.schema.json';
}>;

export declare const ATTESTATION: Readonly<{
  STATEMENT_TYPE: 'https://in-toto.io/Statement/v1';
  DSSE_PAYLOAD_TYPE: 'application/vnd.in-toto+json';
  OCI_MANIFEST_SUBJECT: 'oci-manifest';
  STATEMENT_SCHEMA: 'schemas/attestation/statement.schema.json';
  ENVELOPE_SCHEMA: 'schemas/attestation/dsse-envelope.schema.json';
}>;

export { PROOF_PREDICATE_TYPE } from './predicates/proof-v1.js';
export { REPLAY_PREDICATE_TYPE } from './predicates/replay-v1.js';
export type * from './assurance-levels.js';
export { ASSURANCE } from './assurance-levels.js';
