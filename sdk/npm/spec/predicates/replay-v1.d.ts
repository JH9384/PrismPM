/**
 * The replay predicate `https://uor.foundation/prism/replay/v1` (issue #284).
 *
 * Design: docs/proposals/284-histories-replay.md. Schema:
 * `predicates/replay-v1.schema.json`, `$id`
 * `https://uor.foundation/prism/replay/v1/schema.json`. This type states the
 * schema exactly; a test compares their members.
 *
 * The statement is an in-toto Statement v1 with exactly one subject, the
 * Core-Wasm guest blob, digested as ADR-015 fixes it. It holds no clock, so
 * replaying the same histories against the same build with the same runtime
 * writes the same bytes.
 */
import type { BlobSubject, PrismDigestSet } from '../types/attestation.js';

export declare const REPLAY_PREDICATE_TYPE: 'https://uor.foundation/prism/replay/v1';

/** The runtime that re-executed the histories. */
export interface ReplayRuntime {
  /** `prism-code` or `prismpm`. */
  name: string;
  version: string;
}

/** One history that was replayed. */
export interface ReplayedHistory {
  /** Both digests cover the history's canonical JSON, with no trailing newline. */
  digest: PrismDigestSet;
  /** Events re-executed, at least one. */
  events: number;
  /** Events whose outcome differs from the recording. */
  divergences: number;
}

export interface ReplayPredicateV1 {
  runtime: ReplayRuntime;
  /** The model blob of the build that was replayed. SHA-256 is `model_id`; BLAKE3 is the blob's label without `blake3:`. */
  model: PrismDigestSet;
  /** At least one, each distinct. */
  histories: [ReplayedHistory, ...ReplayedHistory[]];
  /** The sum of `histories[].divergences`. Anything but zero withholds P3. */
  divergenceCount: number;
}

/** A complete replay statement: exactly one subject, the Core-Wasm guest blob. */
export interface ReplayStatementV1 {
  _type: 'https://in-toto.io/Statement/v1';
  subject: [BlobSubject];
  predicateType: typeof REPLAY_PREDICATE_TYPE;
  predicate: ReplayPredicateV1;
}
