/**
 * The document a policy judges, `prism/policy-input/1` (issue #285).
 * Design: docs/proposals/285-policy-file.md.
 * Schema: `schemas/policy/policy-input-v1.schema.json`.
 *
 * It is bound to `input` when a policy file is evaluated. A policy never lives
 * in a holo, so nothing here is read from a policy section of one.
 */
import type { CapabilitySet } from './capabilities.js';

export type PolicyInputLevel = 'P0' | 'P1' | 'P2' | 'P3';

export interface PolicyInputDigests {
  sha256: string;
  blake3: string;
}

/** The same shape as a reason of `prism/verdict/1`. */
export interface PolicyInputReason {
  check: string;
  code?: string;
  withholds: 'P1' | 'P2' | 'P3' | null;
  message: string;
}

export interface PolicyInputWorld {
  contract: string;
  /** False when this reader has no world for the contract; then `within`, `pure`, `effects` and `imports` are null. */
  known: boolean;
  within: boolean | null;
  pure: boolean | null;
  effects: Array<'clock' | 'random' | 'socket' | 'filesystem' | 'unknown'> | null;
  imports: Array<{ module: string; name: string; kind: string; capability?: 'outbound-hosts' | 'key-value-stores' | 'variables' }> | null;
  problems: string[];
  /** The capability set blob the holo carries. `empty` means it requests nothing. */
  capability_set: { label: string; empty: boolean } | null;
}

/** One attested statement. `verified` says its signature checked against the trust root. */
export interface PolicyInputPredicate {
  predicateType: string;
  verified: boolean;
  predicate: Record<string, unknown>;
}

export interface PolicyInput {
  schema: 'prism/policy-input/1';
  holo: {
    fingerprint: string;
    /** The format revision the archive matches, or null. */
    revision: string | null;
    digests: {
      archive: PolicyInputDigests;
      capabilities?: PolicyInputDigests;
      guest?: PolicyInputDigests;
      view?: PolicyInputDigests;
      model?: PolicyInputDigests;
    };
  };
  /** The evidence, before any policy judged it. A policy never changes the level. */
  verdict: { level: PolicyInputLevel; reasons: PolicyInputReason[] };
  world: PolicyInputWorld | null;
  /** The set the caller granted, or null. A policy file never grants. */
  capabilities: CapabilitySet | null;
  predicates: {
    provenance: PolicyInputPredicate | null;
    proof: PolicyInputPredicate | null;
    replay: PolicyInputPredicate | null;
  };
}
