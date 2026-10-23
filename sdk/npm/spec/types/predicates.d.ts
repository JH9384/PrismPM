/**
 * Predicate types. `predicates/registry.json` holds each one's status and owner.
 *
 * To define a predicate, its owner adds `schemas/predicates/<name>-v1.schema.json`,
 * sets `schema` and `status` in its registry row, and replaces `unknown` below.
 */

/** Placeholder for issue #266: Lean proof evidence with a named trusted computing base. */
export type ProofPredicateV1 = unknown;

/** Placeholder for milestone M3: recorded dispatches that replay against a holo. */
export type ReplayPredicateV1 = unknown;

/** Predicate type URI to predicate body. */
export interface PredicateMap {
  'https://uor.foundation/prism/proof/v1': ProofPredicateV1;
  'https://uor.foundation/prism/replay/v1': ReplayPredicateV1;
}

export type PredicateType = keyof PredicateMap;

export type PredicateStatus = 'placeholder' | 'experimental' | 'beta' | 'stable' | 'deprecated';

/** One row of `predicates/registry.json`. */
export interface PredicateRegistryEntry {
  predicateType: PredicateType;
  status: PredicateStatus;
  owner: { issue: number } | { milestone: string };
  /** Package-relative schema path, null while the row is a placeholder. */
  schema: string | null;
  description: string;
}

export interface PredicateRegistry {
  schema: 'prism/predicate-registry/1';
  predicates: PredicateRegistryEntry[];
}
