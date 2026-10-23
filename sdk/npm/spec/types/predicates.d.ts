/**
 * The predicate map and registry types. `predicates/registry.json` holds each
 * predicate's status and owner. Each predicate owns two files in `predicates/`:
 * `<name>-v<N>.d.ts` for its type and `<name>-v<N>.schema.json` for its schema.
 */
import type { ProofPredicateV1 } from '../predicates/proof-v1.js';
import type { ReplayPredicateV1 } from '../predicates/replay-v1.js';

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
  /** `predicates/<name>-v<N>.schema.json`, or null while the row is a placeholder. */
  schema: string | null;
  description: string;
}

export interface PredicateRegistry {
  schema: 'prism/predicate-registry/1';
  predicates: PredicateRegistryEntry[];
}
