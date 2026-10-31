/**
 * A history, `prism/history/1` (issue #284).
 * Design: docs/proposals/284-histories-replay.md.
 * Schema: `schemas/history/history-v1.schema.json`.
 *
 * It generalises the acceptance vectors of a model document: a vector is an
 * event with a response. An event may also record the refusal a dispatch ended
 * in. Bytes are lowercase hex, so a digest has one meaning.
 */
import type { PrismDigestSet } from './attestation.js';

/** The dispatch returned a response. */
export interface HistoryResponseEvent {
  request: string;
  response: string;
  error?: never;
}

/** The dispatch ended in a refusal or a trap, named by its stable code, such as `core.allocation`. */
export interface HistoryErrorEvent {
  request: string;
  error: string;
  response?: never;
}

export type HistoryEvent = HistoryResponseEvent | HistoryErrorEvent;

export interface HistoryV1 {
  schema: 'prism/history/1';
  /** The name of the application when it was recorded, or null. Replay never compares it. */
  application: string | null;
  /** The build the history was recorded from. Absent for a closure. Replay never compares it. */
  recordedFrom?: { guest: PrismDigestSet; model: PrismDigestSet };
  /** At least one, in the order they ran. */
  events: [HistoryEvent, ...HistoryEvent[]];
}
