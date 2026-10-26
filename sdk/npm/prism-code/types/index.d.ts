/** prism-code — JavaScript runtime for Prism SDK (PrismPM) applications. */

/** Base of every error the package throws. `code` is stable: a class's own code, or for `PrismCodeError` the check that failed. */
export class PrismError extends Error {
  static readonly code: string;
  code: string;
  /** The verdict reason's check id, such as `holo.integrity` or `proof.subject`, or the reason no verdict was reached. */
  check?: string;
  /** The registered diagnostic of the reason, such as `PP5601`. */
  diagnostic?: string;
  details?: unknown;
  /** The whole verdict, when the error explains a failed one. */
  verdict?: Verdict;
  reasons?: VerdictReason[];
  constructor(
    message: string,
    options?: { code?: string; check?: string; diagnostic?: string; details?: unknown; verdict?: Verdict; reasons?: VerdictReason[]; cause?: unknown },
  );
}

export class PrismCodeError extends PrismError {
  /** The check that failed, e.g. `archive.magic`, `core.exports`, `closure.provenance`, `lock.image`. */
  code: string;
  constructor(code: string, message: string, details?: unknown);
}

/** `verification_failed`: no verdict was reached, or a `holo.*`, `provenance.*` or `policy.*` check failed. */
export class VerificationError extends PrismError {
  static readonly code: 'verification_failed';
}
/** `proof_mismatch`: a `proof.*` check failed. */
export class ProofMismatchError extends PrismError {
  static readonly code: 'proof_mismatch';
}
/** `capability_denied`: the declared world exceeds the granted capabilities (`world.capabilities`). */
export class CapabilityDeniedError extends PrismError {
  static readonly code: 'capability_denied';
}
/**
 * `world_mismatch`: the guest does not have the imports and exports of its declared WIT world (`world.contract`),
 * or the declared world is not the one the caller pinned (`world.hash`). Issue #278.
 */
export class WorldMismatchError extends PrismError {
  static readonly code: 'world_mismatch';
}
/** `determinism_violation`: a replay diverged from its recorded history (`replay.divergence`). */
export class DeterminismViolationError extends PrismError {
  static readonly code: 'determinism_violation';
}
/** `replay_failed`: a replay could not be carried out, or another `replay.*` check failed. */
export class ReplayError extends PrismError {
  static readonly code: 'replay_failed';
}
/** `signing_failed`: `attest` could not sign. `check` is `sign.key`, `sign.identity`, `sign.service`, `sign.config`, `sign.predicate` or `sign.subject`. */
export class SigningError extends PrismError {
  static readonly code: 'signing_failed';
}
/** `signature_invalid`: the DSSE signature, the signing key or the certificate chain of a bundle does not verify. */
export class SignatureInvalidError extends PrismError {
  static readonly code: 'signature_invalid';
}
/** `identity_mismatch`: the signer is valid but is not the certificate identity or OIDC issuer the policy names. */
export class IdentityMismatchError extends PrismError {
  static readonly code: 'identity_mismatch';
}
/** `transparency_failed`: a log entry or signed timestamp is missing, untrusted or not about this bundle. */
export class TransparencyError extends PrismError {
  static readonly code: 'transparency_failed';
}
/** `subject_mismatch`: a statement subject is not a content blob of the holo, or its digests differ from the blob's. */
export class SubjectMismatchError extends PrismError {
  static readonly code: 'subject_mismatch';
}
/** `attestation_not_found`: the holo has no attestation, or none of the requested predicate type. */
export class AttestationNotFoundError extends PrismError {
  static readonly code: 'attestation_not_found';
}
/** `trust_root_invalid`: the pinned trusted root cannot be read or does not pin what the policy needs. */
export class TrustRootError extends PrismError {
  static readonly code: 'trust_root_invalid';
}
export const ERROR_CLASSES: Readonly<Record<string, typeof PrismError>>;
/** The class a verdict reason's check id maps to. */
export function classForCheck(check: string): typeof PrismError;
export function errorForReason(reason: VerdictReason, verdict?: Verdict): PrismError;
/** The error that explains a failed verdict, or null for a passed one. `ranks` is `ASSURANCE.RANK`. */
export function errorFromVerdict(verdict: Verdict, ranks: Record<AssuranceLevel, number>): PrismError | null;

export type AssuranceLevel = 'P0' | 'P1' | 'P2' | 'P3';

export interface VerdictReason {
  check: string;
  code?: string;
  withholds: AssuranceLevel | null;
  message: string;
}

/** `prism/verdict/1`: what `prism check`, `holo.verify()` and `@prism-code/verify` return. */
export interface Verdict {
  schema: 'prism/verdict/1';
  /** The archive fingerprint, `blake3:` and 64 hex characters. */
  holo: string;
  /** The highest level whose evidence checks out, never the policy's minimum. */
  level: AssuranceLevel;
  policy: { name: string; minimum: AssuranceLevel };
  passed: boolean;
  reasons: VerdictReason[];
}

export interface VerifyOptions {
  name?: string;
  /** Default: `PRISM_MINIMUM_LEVEL`, then `P2`. */
  minimum?: AssuranceLevel;
  /** Digests the holo (`archive`) or one of its parts (`capabilities`, `guest`, `view`, `model`) must have. */
  digests?: Partial<Record<'archive' | 'capabilities' | 'guest' | 'view' | 'model', Partial<DigestSet>>>;
  /**
   * The world the holo must declare, in the shape of the lock's `inputs.world`, so a caller passes `lock.inputs.world`
   * unchanged. Any digest may be left out. `null` expects no world, which no holo satisfies. A mismatch is a
   * `world.hash` reason, never changes the level, and throws `WorldMismatchError` with `throw: true`.
   */
  world?: { contract?: string; blake3?: string; sha256?: string } | null;
  /** Throw the typed error for a verdict that did not pass. Default false. */
  throw?: boolean;
  /** Where `PRISM_MINIMUM_LEVEL` is read. Default `process.env`. */
  env?: Record<string, string | undefined>;
}

export const MINIMUM_LEVEL_ENV: 'PRISM_MINIMUM_LEVEL';
/** Experimental until the v0.6 freeze. Check a holo (bytes, a Blob or an opened holo) and return its verdict. Throws `VerificationError` when no verdict can be reached. */
export function experimental_verify(source: Uint8Array | ArrayBuffer | Blob | Application, options?: VerifyOptions): Promise<Verdict>;
export interface Client {
  readonly options: Readonly<VerifyOptions>;
  verify(source: Uint8Array | ArrayBuffer | Blob | Application, options?: VerifyOptions): Promise<Verdict>;
}
/** Experimental. A client whose options apply to every call and are replaced by the options of one call. */
export function experimental_createClient(options?: VerifyOptions): Client;

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
  /** What the holo says about itself, without running the guest. Rejects with `inspect.kind` for a closure. */
  inspect(): Promise<Inspection>;
  /** Experimental. The verdict `prism check` returns for this holo. Rejects with `VerificationError` for a closure. */
  experimental_verify(options?: VerifyOptions): Promise<Verdict>;
  /** The bundles of the attestation section (#267), in order; empty without the section and for closures. Signatures are not verified. */
  attestations(): Attestation[];
}

/** sha256 and BLAKE3, lowercase hex, over the same bytes (ADR-015). */
export interface DigestSet {
  sha256: string;
  blake3: string;
}

export type SectionRole =
  | 'app-manifest'
  | 'source-manifest'
  | 'application-directory'
  | 'model-provenance'
  | 'capability-set'
  | 'guest'
  | 'view'
  | 'model-document'
  | 'extension'
  | 'content-blob'
  | 'unknown';

export interface InspectedSection {
  index: number;
  /** The table's kind code: 15 app manifest, 8 metadata, 14 extension, 16 content blob. */
  kind: number;
  kind_name: 'app-manifest' | 'metadata' | 'extension' | 'content-blob' | 'unknown';
  role: SectionRole;
  offset: number;
  length: number;
  /** Over exactly the table bytes, `offset` to `offset + length`. */
  digest: DigestSet;
  /** Extensions only: the extension name. */
  name?: string;
  /** Content blobs only: the 71-byte `blake3:` label. */
  label?: string;
  /** Content blobs only: the bytes after the label. `digest.blake3` equals the label when `label_matches`. */
  content?: { length: number; digest: DigestSet; label_matches: boolean };
}

export interface InspectedAttestation {
  predicate_type: string;
  subjects: { name: string; digest: DigestSet }[];
}

/** `prismpm/holo-inspection/1`: the object `prism-code inspect --json` prints, keys sorted. */
export interface Inspection {
  schema: 'prismpm/holo-inspection/1';
  name: string | null;
  /** The format revision whose identifiers the archive carries, or null when none matches. */
  revision: string | null;
  physical_version: number;
  flags: number;
  /** File size in bytes. */
  size: number;
  /** Over the whole file. */
  digest: DigestSet;
  /** The last 32 bytes: BLAKE3 of every earlier byte. */
  footer: string;
  sections: InspectedSection[];
  manifest: {
    uri: string;
    labels: { capability_set: string; guest: string; view: string };
    entry: string;
    contract: string;
    view_entry: string;
    surface: string;
  };
  model: {
    schema: string | null;
    name: string | null;
    cargo_name: string | null;
    cargo_version: string | null;
    description: string | null;
    profile: string | null;
    function: string | null;
    vectors: number;
    limits: { request: number | null; response: number | null; guest_allocation: number | null };
    /** Over the model document's bytes. `sha256` is the provenance `model_id`. */
    digest: DigestSet;
  };
  provenance: {
    schema: string | null;
    application_kappa: string | null;
    model_id: string | null;
    compiler_semantics_id: string | null;
    stdlib_semantics_id: string | null;
    lexlean_commit: string | null;
  };
  /** The guest contract and its world (issue #278); every member but `contract` and `capability_set` is null for a contract this reader does not know. */
  world: {
    contract: string;
    /** The WIT package, for example `hologram:guest@1.0.0`. */
    package: string | null;
    /** The world's name in that package. */
    name: string | null;
    /** The WIT file in `@prism-code/spec`. */
    file: string | null;
    /** Digests of the WIT file: the lock's `inputs.world` without `contract`. */
    digest: DigestSet | null;
    imports: string[] | null;
    exports: string[] | null;
    /** Whether the guest module has exactly the imports and exports of the world. */
    conforms: boolean | null;
    capability_set: { label: string; empty: boolean };
  } | null;
  /** Empty until holos carry an attestation section (#267). */
  attestations: InspectedAttestation[];
  verification: { footer: boolean; labels: boolean; cross_references: boolean };
}

export const INSPECTION_SCHEMA: 'prismpm/holo-inspection/1';
/** Read a `.holo` without running it. Structural errors throw `archive.*`; integrity results land in `verification`. */
export function inspect(source: Uint8Array | ArrayBuffer | Blob): Promise<Inspection>;
/** The human view `prism-code inspect` prints: aligned columns, full digests, one fact per line. */
export function formatInspection(inspection: Inspection): string;

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

/** `https://uor.foundation/extension/attestation-bundle/v1`: the Extension row that carries the bundles. */
export const ATTESTATION_EXTENSION: 'https://uor.foundation/extension/attestation-bundle/v1';
export const BUNDLE_MEDIA_TYPE: 'application/vnd.dev.sigstore.bundle.v0.3+json';

/** A content-blob subject of an in-holo statement, with both digests (ADR-015). */
export interface AttestationSubject {
  name: string;
  digest: { sha256: string; blake3: string };
  /** The `blake3:` label of the content blob the subject names, or null when no blob of this archive matches. */
  blob: string | null;
}

/** One Sigstore bundle v0.3 line of the attestation section, decoded. */
export interface Attestation {
  /** Line number in the section, from 0. */
  index: number;
  /** The line's exact bytes, without LF: the blob pushed as an OCI referrer. */
  bytes: Uint8Array;
  bundle: Record<string, unknown>;
  mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json';
  verificationMaterial: Record<string, unknown>;
  envelope: { payload: string; payloadType: 'application/vnd.in-toto+json'; signatures: { keyid?: string; sig: string }[] };
  /** At least one signature is non-empty. The provenance placeholder `prismpm build` writes has one empty signature; no verifier accepts it. */
  signed: boolean;
  /** The in-toto Statement v1 decoded from the DSSE payload. */
  statement: { _type: 'https://in-toto.io/Statement/v1'; subject: unknown[]; predicateType: string; predicate?: unknown };
  predicateType: string;
  subjects: AttestationSubject[];
  /** Every subject names a content blob of this archive by its blake3 label. */
  resolved: boolean;
}

/** A Sigstore bundle as an object, a one-line JSON string or its UTF-8 bytes. */
export type BundleInput = Record<string, unknown> | string | Uint8Array;

/** The attestation row, or null. Throws when it is repeated or not the last row. */
export function attestationSection(source: Uint8Array | ArrayBuffer | ParsedArchive): { section: number; payload: Uint8Array } | null;
/** Every bundle of the attestation section; an empty array without it. */
export function readAttestations(source: Uint8Array | ArrayBuffer | ParsedArchive): Attestation[];
/** Decode one bundle line; `labels` are the archive's blob labels used to resolve subjects. */
export function decodeBundle(line: string | Uint8Array, labels?: Set<string>): Omit<Attestation, 'index'>;
/** A new archive with the bundles added as the last row; other row bodies are byte-identical and the footer is recomputed. */
export function appendAttestations(source: Uint8Array | ArrayBuffer | ParsedArchive, bundles: BundleInput[]): Uint8Array;
/** The archive without its attestation row: the unsigned archive. */
export function stripAttestations(source: Uint8Array | ArrayBuffer | ParsedArchive): Uint8Array;
/** `https://slsa.dev/provenance/v1`. */
export const PROVENANCE_PREDICATE_TYPE: 'https://slsa.dev/provenance/v1';
/** The build type of a holo built by `prismpm build`. */
export const HOLO_BUILD_TYPE: 'https://uor.foundation/prism/holo-build/v1';
export const PROVENANCE_MODES: Readonly<{ MIN: 'min'; MAX: 'max' }>;

/** One resolved dependency row of a provenance statement. */
export interface ProvenanceDependency {
  name: string;
  uri: string;
  digest?: { blake3?: string; sha256?: string };
  mediaType?: string;
}

export interface ProvenanceStatement {
  _type: 'https://in-toto.io/Statement/v1';
  subject: { name: string; digest: { blake3: string; sha256: string } }[];
  predicateType: 'https://slsa.dev/provenance/v1';
  predicate: Record<string, unknown>;
}

export interface ProvenanceOptions {
  /** The bytes of `prismpm.lock`, schema `prismpm/sdk-lock/2` or `/3`. */
  lock: Uint8Array | string;
  /** `min` unless told otherwise. Max records the arguments, platform, invocation id and timestamps. */
  mode?: 'min' | 'max';
  /** Max only: the command line after `prismpm`. */
  arguments?: string[];
  /** Max only: the OCI platform of the builder, for example `linux/amd64`. */
  platform?: string;
  /** Max only. */
  invocationId?: string;
  /** Max only, UTC RFC 3339 without fractions. */
  startedOn?: string;
  /** Max only, UTC RFC 3339 without fractions. */
  finishedOn?: string;
  /** The build-manifest path of each blob; the defaults are the paths `prismpm build` writes. */
  subjectNames?: { guest?: string; view?: string; model?: string; capabilities?: string };
}

/** The resolved dependency rows a lock gives, sorted by uri then name. */
export function resolvedDependencies(lock: Uint8Array | string): Promise<ProvenanceDependency[]>;
/** The SLSA provenance v1 statement of a holo. Throws `provenance.*` errors. */
export function provenanceStatement(source: Uint8Array | ArrayBuffer | ParsedArchive, options: ProvenanceOptions): Promise<ProvenanceStatement>;
/** The bytes a DSSE envelope signs: canonical JSON of the statement. */
export function statementBytes(statement: ProvenanceStatement): Uint8Array;
/** One unsigned bundle line for a statement, as canonical JSON bytes. */
export function provenanceBundle(statement: ProvenanceStatement): Uint8Array;
/** The provenance statements an archive carries, with their mode and whether any signature is present. */
export function readProvenance(source: Uint8Array | ArrayBuffer | ParsedArchive): { index: number; mode: 'min' | 'max'; signed: boolean; statement: ProvenanceStatement }[];
/** A new archive that carries its provenance statement as an unsigned bundle. Refuses an archive that already has one. */
export function attachProvenance(source: Uint8Array | ArrayBuffer | ParsedArchive, options: ProvenanceOptions): Promise<Uint8Array>;

/** Encode header, table, bodies and BLAKE3 footer from rows. */
export function encodeArchive(sections: { kind: number; body: Uint8Array }[], options?: { version?: number; flags?: number }): Uint8Array;

/** @deprecated import from 'prism-code/canonical'; removed in 0.3.0 */
export { canonicalize, codeHash, describe, differs } from '../src/canonical/index.js';
