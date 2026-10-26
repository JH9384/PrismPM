/**
 * The holo binary layouts, format revision 2026-10-23.
 * Source: `Foundation.Holo.V1.Format` and `Foundation.Holo.V1.Wire`.
 * The JSON shapes of the decoded sections are generated in `documents.d.ts`.
 */
import type { HoloAppManifest, HoloApplicationDirectory, HoloSourceManifest, ModelProvenanceV1 } from './documents.js';

/** Every format revision this package knows. A reader lists the ones it accepts. */
export type FormatRevision = '2026-10-23';

/** What a reader declares about the revisions it reads. */
export interface RevisionSupport {
  /** An explicit list, never a date range. */
  accepts: readonly FormatRevision[];
}

/** The identifiers a reader uses to recognize a revision. Archives do not carry the date. */
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

/** Section kind codes. One byte on the wire, followed by seven zero bytes: a u64 little-endian. */
export type SectionKindCode = 15 | 8 | 14 | 16;

export interface SectionKind {
  /** `AppManifest`, row 0. */
  APP_MANIFEST: 15;
  /** `Metadata`, row 1: the source manifest. */
  METADATA: 8;
  /** `Extension`, rows 2 and 3. */
  EXTENSION: 14;
  /** `ContentBlob`, rows 4 to 7. */
  CONTENT_BLOB: 16;
}

/** `blake3:` and 64 lowercase hex characters, 71 bytes. */
export type KappaLabel = `blake3:${string}`;

/** Lowercase hexadecimal. */
export type Hex = string;

/**
 * Byte layout, little-endian:
 *
 *   0         "HOLO"
 *   4         u16 physical version, 4
 *   6         u16 flags, 0
 *   8         u16 section count, 8
 *   10        8 table rows of u64 kind, u64 offset, u64 length
 *   202       section bodies, contiguous, in table order
 *   end - 32  footer: BLAKE3 of every earlier byte
 */
export interface SectionTableEntry {
  kind: SectionKindCode;
  offset: number;
  length: number;
}

/**
 * Application manifest, 356 bytes:
 *
 *   0    57-byte prefix: the URI, NUL, u32 little-endian 3
 *   57   capability set label, 71 bytes
 *   128  guest label, 71 bytes
 *   199  view label, 71 bytes
 *   270  86-byte constant suffix
 */
export type AppManifestLabels = [capabilitySet: KappaLabel, guest: KappaLabel, view: KappaLabel];

/** Extension section body: u16 little-endian name length, the name, then the JSON payload. */
export type ExtensionName =
  | 'https://hologram.foundation/extension/application-directory/v1'
  | 'https://uor.foundation/extension/prismpm-model/v1';

export interface ExtensionPayloads {
  'https://hologram.foundation/extension/application-directory/v1': HoloApplicationDirectory;
  'https://uor.foundation/extension/prismpm-model/v1': ModelProvenanceV1;
}

/** Content blob body: its 71-byte label, then the content. The label is the BLAKE3 of the content. */
export type ContentBlobRole = 'capability-set' | 'guest' | 'model-document' | 'view';

/**
 * HOLOVIEW v1, the portable view bundle, big-endian:
 *
 *   "HOLOVIEW"  u16 version 1
 *   u32 entry path length, entry path
 *   u32 file count
 *   per file, in strict byte-lexical path order: u32 path length, path, u64 content length, content
 */
export interface HoloviewLimits {
  MAGIC: 'HOLOVIEW';
  VERSION: 1;
  ENTRY: 'index.html';
  MAX_FILES: 4096;
  MAX_PATH_BYTES: 1024;
  MAX_FILE_BYTES: 67108864;
  MAX_TOTAL_BYTES: 268435456;
}

/** The Core-Wasm guest contract. See `worlds/core-wasm.wit`. */
export type CoreWasmContract = 'hologram:guest/core-wasm@1';

/** The guest's exports as a host sees them after instantiation. */
export interface CoreWasmExports {
  memory: WebAssembly.Memory;
  /** `(i32) -> i32`: reserve `length` bytes, return their offset. */
  holo_alloc(length: number): number;
  /** `(i32, i32) -> i64`: run a request, return `offset << 32 | length` of the response. */
  holo_run(offset: number, length: number): bigint;
}

/** Every section of a holo, decoded. */
export interface DecodedHolo {
  header: { magic: 'HOLO'; version: 4; flags: 0; sectionCount: 8 };
  sections: SectionTableEntry[];
  appManifest: HoloAppManifest;
  sourceManifest: HoloSourceManifest;
  directory: HoloApplicationDirectory;
  provenance: ModelProvenanceV1;
  blobs: { label: KappaLabel; role: ContentBlobRole; content: Uint8Array }[];
  /** The archive fingerprint. */
  footer: Hex;
}

/** A lowered core-wasm value type, as the canonical ABI lowers a WIT type. */
export type WasmValueType = 'i32' | 'i64' | 'f32' | 'f64';

/** An export of a world: a function with its lowered signature, or an exported memory (WIT cannot name one). */
export type WorldExport =
  | { readonly name: string; readonly kind: 'func'; readonly params: readonly WasmValueType[]; readonly results: readonly WasmValueType[] }
  | { readonly name: string; readonly kind: 'memory' | 'table' | 'global' };

/** An import of a world. The Core-Wasm world has none. */
export interface WorldImport {
  readonly module: string;
  readonly name: string;
  readonly kind: 'func' | 'table' | 'memory' | 'global';
}

/**
 * One row of `WORLDS` (issue #278): the WIT world a guest contract names.
 * `digest` covers the bytes of `file`; it is the lock's `inputs.world` without `contract`.
 */
export interface World {
  /** The version of this row's shape. The world's own version is the `@N` of its contract. */
  readonly version: 1;
  /** The WIT package, for example `hologram:guest@1.0.0`. */
  readonly package: string;
  /** The world's name inside the package. */
  readonly world: string;
  /** The WIT file, relative to the package root. */
  readonly file: string;
  readonly digest: { readonly blake3: string; readonly sha256: string };
  readonly imports: readonly WorldImport[];
  readonly exports: readonly WorldExport[];
}

