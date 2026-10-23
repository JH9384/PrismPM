/** The bytes of a whole `.holo`. */
export type HoloBytes = ArrayBufferLike | ArrayBufferView;

/** P0 unverified, P1 provenance, P2 proof checked, P3 proof, replay and world (issue #269). */
export type AssuranceLevel = 'P0' | 'P1' | 'P2' | 'P3';

/** Two digests of one byte string, lowercase hex (ADR-015). */
export interface DigestSet {
  sha256: string;
  blake3: string;
}

/** The parts a policy can pin and an inspection reports digests for. `archive` is the whole file. */
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

export interface InspectedSection {
  index: number;
  kind: number;
  kindName: 'app-manifest' | 'metadata' | 'extension' | 'content-blob' | 'unknown';
  offset: number;
  length: number;
  /** Extension sections: the extension name. */
  name?: string;
  /** Content blobs: the `blake3:<hex>` label, the digests of the content, and whether the label matches. */
  label?: string;
  digests?: DigestSet;
  labelMatches?: boolean;
  /** Content blobs the documents name. */
  role?: Exclude<DigestTarget, 'archive'>;
  /** A decoding problem in this section. */
  problem?: string;
}

export interface Inspection {
  /** The format revision the archive's identifiers match, or null. */
  formatRevision: string | null;
  size: number;
  digests: { archive: DigestSet } & Partial<Record<Exclude<DigestTarget, 'archive'>, DigestSet>>;
  /** The stored footer and the BLAKE3 of the body. */
  footer: { stored: string; computed: string; matches: boolean };
  sections: InspectedSection[];
  manifest: { uri: string; labels: { capabilitySet: string; guest: string; view: string } } | null;
  sourceManifest: { version: number; sourceId: string | null; semanticId: string | null; files: { kind: string; sha256: string }[] } | null;
  directory: {
    primaryLayer: number;
    requires: string;
    layers: { position: number; kind: string; kappa: string; entry: string | null; contract: string | null }[];
  } | null;
  provenance: {
    schema: string;
    applicationKappa: string | null;
    modelId: string | null;
    semanticId: string | null;
    compilerSemanticsId: string | null;
    coreWasmContract: string | null;
    cargoName: string | null;
    cargoVersion: string | null;
  } | null;
  modelDocument: {
    schema: string;
    name: string | null;
    cargoName: string | null;
    cargoVersion: string | null;
    coreContract: string | null;
    kappa: string | null;
    sha256: string | null;
    acceptanceVectors: number | null;
  } | null;
  /** Always `{ present: false, section: null }` for format revision 2026-10-23, which has no attestation section yet. */
  attestation: { present: boolean; section: number | null };
}

/** Check a holo. Rejects with VerifyError when no verdict can be reached: not bytes, an invalid policy, an unreadable file or an unknown format revision. */
export function verify(bytes: HoloBytes, policy?: Policy): Promise<Verdict>;

/** Describe a holo. Throws VerifyError when the header or section table cannot be read. */
export function inspect(bytes: HoloBytes): Inspection;

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
