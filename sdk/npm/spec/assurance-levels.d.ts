/**
 * Assurance levels P0 to P3 and the verdict of a check.
 * Design: docs/proposals/269-assurance-levels.md.
 * Schema: schemas/verdict/verdict-v1.schema.json.
 */

/** P0 unverified, P1 provenance, P2 proof checked, P3 proof, replay and world. */
export type AssuranceLevel = 'P0' | 'P1' | 'P2' | 'P3';

/** A level a failed check can withhold. P0 is never withheld. */
export type WithheldLevel = Exclude<AssuranceLevel, 'P0'>;

/** Evidence a level adds to the level below it. */
export type AssuranceEvidence = 'integrity' | 'provenance' | 'proof' | 'replay' | 'world';

/** One check that did not pass. */
export interface VerdictReason {
  /** Stable dotted check id, for example `proof.subject` or `policy.level`. */
  check: string;
  /** The registered diagnostic, for example `PP5503`, when one exists. */
  code?: string;
  /** The lowest level this failure withholds, or null when it withholds none. */
  withholds: WithheldLevel | null;
  /** One plain sentence for a person. Not part of the contract. */
  message: string;
}

/** The result of `prism check`, `holo.verify()` and `@prism-code/verify`. */
export interface Verdict {
  schema: 'prism/verdict/1';
  /** The holo's archive fingerprint, `blake3:` and 64 lowercase hex characters. */
  holo: string;
  /** The level computed from the evidence. The policy never changes it. */
  level: AssuranceLevel;
  /** The policy the holo was judged against and the lowest level it accepts. */
  policy: { name: string; minimum: AssuranceLevel };
  /** True when the policy accepts the holo. */
  passed: boolean;
  /** Every check that did not pass, in evaluation order. Empty when every check passed. */
  reasons: VerdictReason[];
}

export declare const ASSURANCE: Readonly<{
  LEVELS: readonly ['P0', 'P1', 'P2', 'P3'];
  RANK: Readonly<{ P0: 0; P1: 1; P2: 2; P3: 3 }>;
  NAMES: Readonly<Record<AssuranceLevel, string>>;
  ADDS: Readonly<{
    P0: readonly [];
    P1: readonly ['integrity', 'provenance'];
    P2: readonly ['proof'];
    P3: readonly ['replay', 'world'];
  }>;
  PREDICATES: Readonly<{
    provenance: 'https://slsa.dev/provenance/v1';
    proof: 'https://uor.foundation/prism/proof/v1';
    replay: 'https://uor.foundation/prism/replay/v1';
  }>;
  DEFAULT_MINIMUM: 'P2';
  DEFAULT_POLICY: 'default';
  EXIT: Readonly<{ PASSED: 0; FAILED: 1; NO_VERDICT: 2 }>;
  VERDICT: 'prism/verdict/1';
  VERDICT_SCHEMA: 'schemas/verdict/verdict-v1.schema.json';
}>;
