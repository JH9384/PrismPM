/**
 * The Replay tab's one source (issue #288). This is the only file to change
 * when `prism replay` (#284) reaches main: replace the body of `readReplay`
 * with a call to `experimental_replay` over the project's histories, using the
 * mapping below. The tab, the state and their tests read this interface and
 * nothing of #284.
 *
 * A `ReplayVerdict` is:
 *
 *   state        'unavailable'   this build of prism-code has no replay
 *                'no-histories'  replay exists and the project has nothing to replay
 *                'passed'        every recorded outcome reproduced
 *                'diverged'      at least one recorded outcome did not
 *                'no-verdict'    the replay could not be carried out
 *   reason       a sentence for a person, for every state but 'passed'; never part of the contract
 *   events       how many events were replayed, for 'passed' and 'diverged'
 *   divergences  how many of them differ, for 'passed' and 'diverged'
 *   histories    one { name, events, divergences } per history, for 'passed' and 'diverged'
 *
 * The mapping from `experimental_replay(app, histories, { throw: false })`:
 *
 *   state        result.divergenceCount === 0 ? 'passed' : 'diverged'
 *   events       result.events
 *   divergences  result.divergenceCount
 *   histories    result.histories, with name its file and divergences its list's length
 *
 * A `ReplayError` it rejects with is 'no-verdict', its message the reason. A
 * project with no `history/` directory, or an empty one, is 'no-histories'.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */

/** Every state the tab can show. */
export const REPLAY_STATES = Object.freeze(['unavailable', 'no-histories', 'passed', 'diverged', 'no-verdict']);

/**
 * The replay verdict of the build the Check tab just judged.
 *
 * @param {{ holo: string, directory: string, verdict: object }} _input the holo, the project and its verdict
 * @returns {Promise<{ state: string, reason?: string, events?: number, divergences?: number, histories?: Array<{ name: string, events: number, divergences: number }> }>}
 */
export async function readReplay(_input) {
  return { state: 'unavailable', reason: 'This build of prism-code has no replay yet. The tab fills in when prism replay ships.' };
}
