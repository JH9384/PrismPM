/**
 * @prism-code/testing: test a Prism application without a network or a clock.
 *
 * - `createMockHost`: a deterministic host with a clock that skips time, a seeded random source and
 *   capability-checked stubs for outbound hosts, key-value stores and variables.
 * - `scriptedDispatch`: a stand-in for `app.dispatch` that answers from a list and throws on an
 *   unexpected call; `assertComplete()` throws while calls remain.
 * - History fixtures in the `prism/history/1` format `prism-code replay` reads, through prism-code's
 *   own reader, writer and recorder: `readHistory`, `writeHistory`, `recordHistory`, `assertReplays`.
 * - `referenceArchive`: Calculator and Payment Approval with their recorded histories.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
export { createMockHost } from './host.mjs';
export { createClock, DEFAULT_START } from './clock.mjs';
export { createRandom } from './random.mjs';
export { scriptedDispatch, historyScript } from './script.mjs';
export { readHistory, writeHistory, recordHistory, assertReplays, referenceArchive, referenceArchives } from './history.mjs';
export { TestingError, UnexpectedCallError, ScriptIncompleteError, TestSetupError } from './errors.mjs';
export { HISTORY_SCHEMA, parseHistory, historyJson } from './runtime.mjs';
// The runtime calls a test of a reference archive needs beside the helpers, so such a test imports this package only.
export {
  load,
  fromFile,
  inspect,
  formatInspection,
  canonicalJson,
  experimental_verify,
  historyBytes,
  historyDigest,
  acceptanceHistory,
  experimental_recorder,
  experimental_replay,
  REPLAY_PREDICATE_TYPE,
  DeterminismViolationError,
  PrismError,
  ReplayError,
  blake3Hex,
} from './runtime.mjs';
export { resolveArchive } from './runtime.mjs';
export { runCli } from './cli.mjs';
