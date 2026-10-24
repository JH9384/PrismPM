/** The bytes of a whole `.holo`. */
export type HoloBytes = ArrayBufferLike | ArrayBufferView;

/** P0 unverified, P1 provenance, P2 proof checked, P3 proof, replay and world (issue #269). */
export type AssuranceLevel = 'P0' | 'P1' | 'P2' | 'P3';

/** Two digests of one byte string, lowercase hex (ADR-015). */
export interface DigestSet {
  sha256: string;
  blake3: string;
}

/** The parts a policy can pin. `archive` is the whole file; the others are content blobs. */
export type DigestTarget = 'archive' | 'capabilities' | 'guest' | 'view' | 'model';

export interface Policy {
  /** Shown in the verdict. Default `default`. */
  name?: string;
  /** The lowest level the policy accepts. Default `P2`, the default policy of issue #269. */
  minimum?: AssuranceLevel;
  /** Expected digests. Every algorithm given must match; at least one per target. A mismatch is a `policy.digests.<target>` reason. */
  digests?: Partial<Record<DigestTarget, Partial<DigestSet>>>;
}

/** One check that did not pass. */
export interface VerdictReason {
  /** `holo.integrity`, `holo.documents`, `provenance.statement`, `proof.statement`, `replay.statement`, `policy.level` or `policy.digests.<target>`. */
  check: string;
  /** The registered diagnostic, when one exists: `PP5601` for `policy.level`. */
  code?: string;
  /** The lowest level this failure withholds, or null for a policy rule. */
  withholds: Exclude<AssuranceLevel, 'P0'> | null;
  /** One plain sentence for a person. Not part of the contract. */
  message: string;
}

/** A `prism/verdict/1` object, the same shape `prism check` and the runtime return (issue #269). */
export interface Verdict {
  schema: 'prism/verdict/1';
  /** The archive fingerprint: `blake3:` and the BLAKE3 of the body. */
  holo: string;
  /** Computed from the evidence. The policy never changes it. */
  level: AssuranceLevel;
  policy: { name: string; minimum: AssuranceLevel };
  /** True when the policy accepts the holo. */
  passed: boolean;
  /** Every check that did not pass, in evaluation order. */
  reasons: VerdictReason[];
}

/** From prism-code `types/index.d.ts` (PR #335, issue #271): the shape both readers return. */
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
  /** Null when the application manifest is not the Wire form. */
  manifest: {
    uri: string;
    labels: { capability_set: string; guest: string; view: string };
    entry: string;
    contract: string;
    view_entry: string;
    surface: string;
  } | null;
  /** Null when the model document does not decode. */
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
  } | null;
  /** Null when the provenance extension does not decode. */
  provenance: {
    schema: string | null;
    application_kappa: string | null;
    model_id: string | null;
    compiler_semantics_id: string | null;
    stdlib_semantics_id: string | null;
    lexlean_commit: string | null;
  } | null;
  /** The guest contract and its world; `imports` and `exports` are null for a contract this reader does not know. */
  world: {
    contract: string;
    imports: string[] | null;
    exports: string[] | null;
    capability_set: { label: string; empty: boolean };
  } | null;
  /** Empty until holos carry an attestation section (#267). */
  attestations: InspectedAttestation[];
  verification: { footer: boolean; labels: boolean; cross_references: boolean };
}

/** Check a holo. Rejects with VerifyError when no verdict can be reached: not bytes, an invalid policy, an unreadable file or an unknown format revision. */
export function verify(bytes: HoloBytes, policy?: Policy): Promise<Verdict>;

/** Describe a holo as `prismpm/holo-inspection/1`. Throws VerifyError when the header or section table cannot be read. */
export function inspect(bytes: HoloBytes): Inspection;

export const INSPECTION_SCHEMA: 'prismpm/holo-inspection/1';

/** The newest holo format revision this package reads. */
export const FORMAT_REVISION: string;

/** Assurance levels, their order and the default policy, as @prism-code/spec states them (issue #269). */
export const ASSURANCE: Readonly<{
  LEVELS: readonly ['P0', 'P1', 'P2', 'P3'];
  RANK: Readonly<{ P0: 0; P1: 1; P2: 2; P3: 3 }>;
  NAMES: Readonly<Record<AssuranceLevel, string>>;
  ADDS: Readonly<Record<AssuranceLevel, readonly string[]>>;
  PREDICATES: Readonly<{ provenance: string; proof: string; replay: string }>;
  DEFAULT_MINIMUM: 'P2';
  DEFAULT_POLICY: 'default';
  EXIT: Readonly<{ PASSED: 0; FAILED: 1; NO_VERDICT: 2 }>;
  VERDICT: 'prism/verdict/1';
  VERDICT_SCHEMA: string;
}>;

export class VerifyError extends Error {
  name: 'VerifyError';
  /** `input`, `policy.invalid`, `archive.magic`, `archive.version`, `archive.flags`, `archive.table` or `format.revision`. */
  code: string;
}
