/**
 * The registry types. `predicates/registry.json` is generated from one row file
 * per predicate. Each predicate owns four files in `predicates/`:
 * `<name>-v<N>.json` for its status, owner and description, `<name>-v<N>.d.ts`
 * for its type, and `<name>-v<N>.schema.json` for its schema (none while the
 * row is a placeholder). `PredicateMap` and `PredicateType` are generated into
 * `types/predicate-map.d.ts` from those files.
 */
import type { PredicateType } from './predicate-map.js';

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
