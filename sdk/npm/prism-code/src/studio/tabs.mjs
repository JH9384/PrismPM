/**
 * What each studio tab shows, as data: pure functions of the `prism/dev-state/1`
 * state, with no DOM, so a test reads exactly what the page renders. The page
 * and the tests import this one file.
 */

const isCurrent = (state) => state.phase === 'idle';

function timing(cycle) {
  if (!cycle) return null;
  return { editToVerdictMs: cycle.editToVerdictMs, buildMs: cycle.build?.ms ?? null, checkMs: cycle.checkMs, files: cycle.files };
}

function verdictView(result) {
  const { verdict } = result;
  return {
    passed: verdict.passed,
    level: verdict.level,
    levelName: result.levelName,
    policy: verdict.policy.name,
    minimum: verdict.policy.minimum,
    digest: verdict.holo,
    holo: result.holo,
    reasons: result.reasons,
    limits: result.limits,
  };
}

/**
 * The Check tab. `status` is one of:
 *
 *   waiting       nothing has finished yet
 *   passed        a verdict on the current source; the policy accepts it
 *   failed        a verdict on the current source; the policy rejects it
 *   no-verdict    no verdict was reached, and `problem` says why
 *   build-failed  the build failed, and `log` holds its end
 *
 * `busy` names what is running. While it is set, `current` is false and the
 * rest describes the last finished cycle. A verdict that no longer describes
 * the source is only ever in `previous`.
 */
export function checkTab(state) {
  const { result, previous, cycle, phase } = state;
  const base = { busy: phase === 'idle' ? null : phase, current: isCurrent(state), timing: timing(cycle), problem: null, log: null, verdict: null, previous: null };
  if (!result) return { ...base, status: 'waiting' };
  const earlier = previous ? verdictView(previous) : null;
  if (result.outcome === 'build-failed') return { ...base, status: 'build-failed', log: result.log, problem: { check: 'dev.build', message: `The build exited ${result.code ?? 'without a code'}.` }, previous: earlier };
  if (result.outcome === 'no-verdict') return { ...base, status: 'no-verdict', problem: { check: result.check, message: result.message }, previous: earlier };
  return { ...base, status: result.verdict.passed ? 'passed' : 'failed', verdict: verdictView(result) };
}

/** The Replay tab: the verdict `readReplay` returned, or waiting while no cycle has reached it. */
export function replayTab(state) {
  const { replay } = state;
  if (!replay) return { state: 'waiting', reason: 'The current source has no judged build, so there is nothing to replay against.', events: null, divergences: null, histories: [], current: isCurrent(state) };
  return { state: replay.state, reason: replay.reason ?? null, events: replay.events ?? null, divergences: replay.divergences ?? null, histories: replay.histories ?? [], current: isCurrent(state) };
}

/** The part of a verdict two judges must agree on. A reason's message is for a person and is not compared. */
function essence(verdict) {
  return JSON.stringify([verdict.holo, verdict.level, verdict.passed, verdict.reasons.map((r) => [r.check, r.code ?? null, r.withholds ?? null])]);
}

/**
 * Whether the page's own run of `@prism-code/verify` reached the verdict the
 * command line did. Both are the same code, so a difference means the bytes or
 * the policy differ.
 */
export function agreement(server, browser) {
  return essence(server) === essence(browser);
}

/** The headline of a status. */
export const HEADLINES = Object.freeze({
  waiting: 'Waiting for the first build',
  passed: 'PASSED',
  failed: 'FAILED',
  'no-verdict': 'NO VERDICT',
  'build-failed': 'BUILD FAILED',
});

/** The headline of a replay state. */
export const REPLAY_HEADLINES = Object.freeze({
  waiting: 'Waiting for the first build',
  unavailable: 'Replay unavailable',
  'no-histories': 'Nothing to replay',
  passed: 'REPLAYED',
  diverged: 'DIVERGED',
  'no-verdict': 'NO VERDICT',
});
