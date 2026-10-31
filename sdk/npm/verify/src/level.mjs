/**
 * The assurance level a list of verdict reasons leaves: the highest level no
 * reason withholds (docs/proposals/269-assurance-levels.md). One function, so
 * `verify` and the statement checks cannot compute it differently.
 */
import * as assurance from './vendor/assurance-levels.mjs';

const { ASSURANCE } = assurance;

export function levelOf(reasons) {
  const { LEVELS, RANK } = ASSURANCE;
  const lowestWithheld = Math.min(...reasons.filter((r) => r.withholds).map((r) => RANK[r.withholds]), LEVELS.length);
  return LEVELS[lowestWithheld - 1];
}
