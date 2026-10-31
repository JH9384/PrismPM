/**
 * @prism-code/conformance: the suite every Prism runtime runs in CI through an
 * entrypoint shim. README.md states the shim contract. Experimental until the
 * v0.6 freeze, like the runtime contract it checks.
 */
export { SHIM_CONTRACT, callShim } from './shim.mjs';
export { runSuite, describeRuntime, judge, problemsOfDeclaration, RESULTS_SCHEMA, DECLARATION_SCHEMA, STATUSES } from './run.mjs';
export { loadScenarios, allChecks, problemsOfFile, OPERATIONS } from './scenarios.mjs';
export { ARCHIVES, archiveNames, archiveBytes, writeCorpus, computeLock, readLock } from './corpus.mjs';
export { mismatches, expand, OPERATORS } from './match.mjs';
export { renderMatrix, problemsOfResults, sameMatrix } from './matrix.mjs';
export { runGate, formatGate, globToRegExp, problemsOfConfig } from './gate.mjs';
