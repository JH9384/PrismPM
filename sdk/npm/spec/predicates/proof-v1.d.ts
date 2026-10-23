/**
 * The proof predicate, reserved for issue #266.
 *
 * Design: docs/proposals/266-proof-predicate.md. #266 replaces `unknown` with
 * the predicate interface and adds `predicates/proof-v1.schema.json`, with
 * `$id` `https://uor.foundation/prism/proof/v1/schema.json`. It then sets
 * `schema` and `status` in this predicate's row of `predicates/registry.json`.
 *
 * This file is `.d.ts`, not `.ts`: the package has no build step.
 */
export declare const PROOF_PREDICATE_TYPE: 'https://uor.foundation/prism/proof/v1';

export type ProofPredicateV1 = unknown;
