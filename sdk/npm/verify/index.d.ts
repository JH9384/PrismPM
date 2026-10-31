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
  /**
   * The world the holo must declare (issue #278), in the shape of the lock's `inputs.world`, so a caller passes
   * `lock.inputs.world` unchanged. Any digest may be left out. `null` expects no world, which no holo satisfies.
   * A mismatch is a `world.hash` reason and never changes the level.
   */
  world?: { contract?: string; blake3?: string; sha256?: string } | null;
  /**
   * The source of a Rego policy (issue #285, docs/proposals/285-policy-file.md). It decides alone, so only `name` and
   * `capabilities` may accompany it. Without it, the shipped default policy decides, and `minimum`, `digests`,
   * `world` and `effects` adjust that.
   */
  rego?: string;
  /**
   * The capability set granted to the holo (issue #283): one set of a `prism/capabilities/1` file, or null for
   * nothing. A world importing a capability kind the set grants none of is a `world.capabilities` reason, code
   * `PP5602`: it withholds P3 and fails the policy at every level. Default null.
   */
  capabilities?: CapabilitySet | null;
  /** A decoded `prism/replay/v1` statement from beside the holo. Unsigned, so it can withhold P3 and never support it. */
  replay?: unknown;
  /**
   * Statements from the holo's attestation section whose signatures the caller has already checked (#270). `verify`
   * verifies no signature: an `envelope.verified` that is not true fails `provenance.envelope` or `proof.envelope`
   * and the statement supports nothing. A provenance statement that checks supports P1, a proof statement P2.
   */
  statements?: { provenance?: { statement: unknown; envelope: { verified: boolean; message?: string } }; proof?: { statement: unknown; envelope: { verified: boolean; message?: string } } };
  /**
   * The impure effects the policy allows the world (issue #282). Absent, the default, allows any. `[]` is the
   * pure-world policy: a world importing a clock, random, socket, filesystem or unknown interface fails it with a
   * `policy.effects` reason, which withholds no level. List an effect to grant it, such as `['clock']`.
   */
  effects?: Array<'clock' | 'random' | 'socket' | 'filesystem' | 'unknown'>;
}

/** The document a policy judges, `prism/policy-input/1` (issue #285). Its schema is in `@prism-code/spec`. */
export interface PolicyInput {
  schema: 'prism/policy-input/1';
  holo: {
    fingerprint: string;
    revision: string | null;
    digests: { archive: { sha256: string; blake3: string } } & Partial<Record<'capabilities' | 'guest' | 'view' | 'model', { sha256: string; blake3: string }>>;
  };
  verdict: { level: AssuranceLevel; reasons: VerdictReason[] };
  world: {
    contract: string;
    known: boolean;
    within: boolean | null;
    pure: boolean | null;
    effects: Array<'clock' | 'random' | 'socket' | 'filesystem' | 'unknown'> | null;
    imports: Array<{ module: string; name: string; kind: string; capability?: string }> | null;
    problems: string[];
    capability_set: { label: string; empty: boolean } | null;
  } | null;
  capabilities: CapabilitySet | null;
  predicates: Record<'provenance' | 'proof' | 'replay', { predicateType: string; verified: boolean; predicate: Record<string, unknown> } | null>;
}

/** A parsed policy, from `parsePolicy`. Opaque. */
export interface ParsedPolicy {
  readonly rules: unknown;
}

/** What a policy decided (issue #285). The level is the evidence's, and no policy changes it. */
export interface PolicyDecision {
  minimum: AssuranceLevel;
  /** Whether any rule denied. */
  denied: boolean;
  /** The reasons a denial adds to the verdict. A denial that cites a reason the evidence already holds adds none. */
  denials: Array<{ rule: string; message: string }>;
}

/** The source of each policy this package ships, by name (issue #285). */
export const POLICIES: Readonly<Record<'default' | 'pure-only' | 'provenance-only', string>>;
/** The `schema` member of the document a policy judges. */
export const POLICY_INPUT_SCHEMA: 'prism/policy-input/1';
/** Parse a Rego policy. Throws `VerifyError` `policy.parse`, naming the line and the construct. */
export function parsePolicy(source: string): ParsedPolicy;
/** Evaluate a parsed policy. Throws `VerifyError` `policy.evaluation`, naming the rule. */
export function evaluatePolicy(policy: ParsedPolicy, input: PolicyInput): PolicyDecision;
/** The document a policy judges for this holo. Rejects like `verify`. */
export function policyInput(source: Uint8Array | ArrayBuffer, options?: { capabilities?: CapabilitySet | null; replay?: unknown; statements?: Policy['statements'] }): Promise<PolicyInput>;

/** One set of a `prism/capabilities/1` file (issue #279). */
export interface CapabilitySet {
  'allow-outbound-hosts'?: string[];
  'deny-outbound-hosts'?: string[];
  'allow-key-value-stores'?: string[];
  'deny-key-value-stores'?: string[];
  'allow-variables'?: string[];
  'deny-variables'?: string[];
  'allow-providers'?: string[];
  'deny-providers'?: string[];
}

/** Is a contract's world within a granted set, and is it pure (issue #283)? `known` is false for a contract this reader has no world for. */
export interface WorldPolicyResult {
  known: boolean;
  within: boolean | null;
  problems: string[];
  pure: boolean | null;
  effects: Array<'clock' | 'random' | 'socket' | 'filesystem' | 'unknown'> | null;
}

/** One check that did not pass. */
export interface VerdictReason {
  /** `holo.integrity`, `holo.documents`, `provenance.statement`, `proof.statement`, `replay.statement`, `world.contract`, `world.capabilities`, `world.hash`, `policy.level`, `policy.effects` or `policy.digests.<target>`. */
  check: string;
  /** The registered diagnostic, when one exists: `PP5601` for `policy.level`, `PP5602` for `world.capabilities`. */
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
    digest: { sha256: string; blake3: string } | null;
    imports: string[] | null;
    exports: string[] | null;
    /** Whether the guest module has exactly the imports and exports of the world. */
    conforms: boolean | null;
    /** No clock, random, socket, filesystem or unknown import, so the world is replayable (issue #283, VER-09). */
    pure: boolean | null;
    /** The impure effects the world imports, sorted: `clock`, `filesystem`, `random`, `socket`, `unknown`. */
    effects: Array<'clock' | 'random' | 'socket' | 'filesystem' | 'unknown'> | null;
    capability_set: { label: string; empty: boolean };
  } | null;
  /** Empty until holos carry an attestation section (#267). */
  attestations: InspectedAttestation[];
  verification: { footer: boolean; labels: boolean; cross_references: boolean };
}

/** Check a holo. Rejects with VerifyError when no verdict can be reached: not bytes, an invalid policy, an unreadable file or an unknown format revision. */
export function verify(bytes: HoloBytes, policy?: Policy): Promise<Verdict>;

/** The `world` of an inspection for a guest contract and its module (issue #278). `conforms` is null when the contract is unknown or `guest` is null. */
export function worldOf(contract: string, guest: Uint8Array | null): Omit<NonNullable<Inspection['world']>, 'capability_set'>;

/** Is the world `contract` names within `set`, and is it pure (issue #283)? Throws VerifyError `policy.invalid` for a set of the wrong shape. */
export function worldPolicy(contract: string, set: CapabilitySet | null): WorldPolicyResult;

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
  /** `input`, `policy.invalid`, `trustedroot.invalid`, `archive.magic`, `archive.version`, `archive.flags`, `archive.table` or `format.revision`. */
  code: string;
}

/** Options of `verifyTransparency`. */
export interface TransparencyOptions {
  /** Where WebCrypto comes from. Default `globalThis.crypto`. Without it the result carries a `crypto.unavailable` reason. */
  crypto?: { subtle: SubtleCrypto };
  /** The least number of log entries that must verify. Default 1. */
  entries?: number;
  /** The least number of RFC 3161 timestamps that must verify. Default 1. */
  timestamps?: number;
}

/** One check of `verifyTransparency`: `timestamp.<n>`, `certificate.chain`, `tlog.<n>`, a counted shortfall, or a named failure. */
export interface TransparencyCheck {
  check: string;
  passed: boolean;
  message: string;
}

/** A failed check in the shape of a verdict reason. Every one withholds P1. */
export interface TransparencyReason {
  /** `bundle.shape`, `timestamp`, `timestamp.count`, `certificate.chain`, `tlog.kind`, `tlog.log`, `tlog.body`, `tlog.inclusion`, `tlog.checkpoint`, `tlog.count` or `crypto.unavailable`. */
  check: string;
  withholds: 'P1';
  message: string;
}

export interface TransparencyResult {
  /** True when no check failed and the required numbers of entries and timestamps verified. */
  passed: boolean;
  /** The earliest verified timestamp, as an ISO 8601 UTC string, or null when none verified. */
  time: string | null;
  checks: TransparencyCheck[];
  reasons: TransparencyReason[];
}

/** A Sigstore bundle v0.3 (`sigstore-bundle.schema.json` in @prism-code/spec). A message-signature bundle is also read. */
export type SigstoreBundle = Record<string, unknown>;

/** A Sigstore `trusted_root.json` (`trusted-root.schema.json` in @prism-code/spec), pinned by the caller. */
export type TrustedRoot = Record<string, unknown>;

/**
 * Check the transparency log entries and RFC 3161 timestamps of one Sigstore
 * bundle against a pinned trusted root, offline (issue #275). Rejects with
 * VerifyError `input` for a bundle that is not an object and `trustedroot.invalid`
 * for a trusted root that is not usable; every other problem is a reason.
 */
export function verifyTransparency(bundle: SigstoreBundle, trustedRoot: TrustedRoot, options?: TransparencyOptions): Promise<TransparencyResult>;
