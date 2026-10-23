/** prism-code — JavaScript runtime for Prism SDK (PrismPM) applications. */

export class PrismCodeError extends Error {
  /** The check that failed, e.g. `archive.magic`, `core.exports`, `closure.provenance`, `lock.image`. */
  code: string;
  details?: unknown;
}

export interface Limits {
  /** `application.request_maximum`: longer requests get a modeled refusal. */
  request: number;
  /** `application.response_maximum`. */
  response: number;
  /** `application.guest_allocation_maximum`: requests above this are not sent to the guest. */
  guestAllocation: number;
}

export interface Vector {
  request: Uint8Array;
  response: Uint8Array;
}

export interface AcceptanceFailure {
  index: number;
  request: Uint8Array;
  expected: Uint8Array;
  actual?: Uint8Array;
  error?: unknown;
}

export interface AcceptanceResult {
  total: number;
  passed: number;
  failed: AcceptanceFailure[];
}

export interface View {
  entry: string;
  files: Map<string, Uint8Array>;
}

export interface ArchiveIdentities {
  archiveFingerprint: string;
  footer: string;
  guestKappa: string;
  viewKappa: string;
  modelKappa: string;
  capabilitiesKappa: string;
  applicationKappa: string | null;
  /** Footer, every blob label and the manifest/extension cross-references all check out. */
  verified: boolean;
  consistent: boolean;
}

export interface ClosureIdentities {
  verified: boolean;
  mismatches: { field: string; declared: unknown; actual: string }[];
  /** Provenance fields that cannot be checked from the closure alone (they name files outside it). */
  unverifiable: string[];
  stem: string;
  glueName: string;
  wasmName: string;
}

export interface Evidence {
  /** Pointers to the proof and build inputs. The package reads them; it does not check proofs. */
  [key: string]: string | null;
}

export interface Application {
  kind: 'holo' | 'closure';
  name: string | null;
  /** `model.prism.json` (`prismpm/model-document/N`); null for a closure opened without one. */
  model: Record<string, unknown> | null;
  /** `application.profile` (`prismpm/text-application/1|3`) or the document schema for the numeric profile. */
  profile: string | null;
  limits: Limits | null;
  vectors: Vector[];
  provenance: { model: Record<string, unknown> | null; browser: Record<string, unknown> | null };
  /** Hologram application-directory/v1 (archives only). */
  directory: Record<string, unknown> | null;
  metadata: unknown;
  identities: ArchiveIdentities | ClosureIdentities;
  evidence: Evidence;
  view: View;
  /** Run one request through the guest on a fresh instance; bytes in, bytes out. */
  dispatch(request: Uint8Array | ArrayBuffer): Promise<Uint8Array>;
  /** Replay every acceptance vector, comparing bytes. */
  acceptance(): Promise<AcceptanceResult>;
}

export interface LoadOptions {
  /** For closures: the model document (object, bytes, or in Node a path), needed by numeric-profile closures. */
  model?: Record<string, unknown> | Uint8Array | string | null;
  /** For browser closure URLs: the `<stem>_bg.wasm` prefix when it cannot be discovered from app.js. */
  stem?: string;
  files?: string[];
}

/** Open a `.holo` (bytes, Blob, path or URL) or a closure (directory path or URL). */
export function load(source: Uint8Array | ArrayBuffer | Blob | string | URL, options?: LoadOptions): Promise<Application>;
export function loadArchive(source: Uint8Array | ArrayBuffer): Promise<Application>;
export function loadClosure(
  files: Map<string, Uint8Array>,
  importGlue: (name: string) => Promise<Record<string, unknown>>,
  options?: { model?: Record<string, unknown> | Uint8Array | null },
): Promise<Application>;

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
export function parseArchive(source: Uint8Array | ArrayBuffer): ParsedArchive;
export function resolveArchive(parsed: ParsedArchive): {
  directory: Record<string, unknown>;
  provenance: Record<string, unknown>;
  modelDocument: Record<string, unknown>;
  guest: { label: string; content: Uint8Array };
  view: { label: string; content: Uint8Array };
  model: { label: string; content: Uint8Array };
  capabilities: { label: string; content: Uint8Array };
  identities: ArchiveIdentities;
};
/** JSON with sorted keys and no whitespace (`holo/canonical.rs`). */
export function canonicalJson(value: unknown): string;

export function decodeHoloview(bytes: Uint8Array): View;
export function encodeHoloview(view: View): Uint8Array;

export function compileGuest(wasm: Uint8Array): Promise<WebAssembly.Module>;
export function runGuest(module: WebAssembly.Module, request: Uint8Array, limits?: Partial<Limits>): Uint8Array;
export function runAcceptance(vectors: Vector[], dispatch: (request: Uint8Array) => Uint8Array | Promise<Uint8Array>): Promise<AcceptanceResult>;

export function verifyClosure(files: Map<string, Uint8Array>): Promise<{
  stem: string;
  glueName: string;
  wasmName: string;
  provenance: Record<string, unknown>;
  verification: Pick<ClosureIdentities, 'verified' | 'mismatches' | 'unverifiable'>;
}>;

export function blake3(bytes: Uint8Array, length?: number): Uint8Array;
export function blake3Hex(bytes: Uint8Array): string;
/** `blake3:` + 64 hex characters, the Hologram kappa label. */
export function kappa(bytes: Uint8Array): string;

/** @deprecated import from 'prism-code/canonical'; removed in 0.3.0 */
export { canonicalize, codeHash, describe, differs } from '../src/canonical/index.js';
