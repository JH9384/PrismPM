/**
 * Runs the suite against one runtime and returns its results, a
 * `prism/conformance-results/1` object. A check ends in one of five states:
 *
 *   pass              it ran and matched
 *   fail              it ran and did not match, and nothing declared that, or the shim broke
 *   xfail             a failure the runtime declared, or a placeholder nobody can run yet
 *   unexpected-pass   a declared failure that passed, so the declaration is stale
 *   n/a               in a feature the runtime declared does not apply to it; not run
 *
 * The run fails on `fail` and on `unexpected-pass`, so a declaration cannot
 * outlive the gap it describes.
 */
import { availableParallelism, tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { writeCorpus } from './corpus.mjs';
import { expand, mismatches } from './match.mjs';
import { allChecks, loadScenarios } from './scenarios.mjs';
import { callShim, DEFAULT_TIMEOUT_MS, SHIM_CONTRACT } from './shim.mjs';
import { validate } from './vendor/json-schema.mjs';
import { VERDICT_SCHEMA } from './vendor/verdict-schema.mjs';

export const RESULTS_SCHEMA = 'prism/conformance-results/1';
export const DECLARATION_SCHEMA = 'prism/conformance-declaration/1';
export const STATUSES = Object.freeze(['pass', 'fail', 'xfail', 'unexpected-pass', 'n/a']);

const EMPTY_DECLARATION = Object.freeze({ schema: DECLARATION_SCHEMA, xfail: {}, notApplicable: {} });

/** Why a declaration cannot be used. A stale id is an error, or the suite would slowly stop meaning anything. */
export function problemsOfDeclaration(declaration, features) {
  const problems = [];
  if (declaration?.schema !== DECLARATION_SCHEMA) problems.push(`the declaration's schema must be ${DECLARATION_SCHEMA}`);
  for (const key of Object.keys(declaration ?? {})) if (!['schema', 'xfail', 'notApplicable'].includes(key)) problems.push(`the declaration has an unknown member ${key}`);
  const checks = new Map(allChecks(features).map((check) => [check.id, check]));
  const names = new Set(features.map((feature) => feature.feature));
  const xfail = declaration?.xfail ?? {};
  const notApplicable = declaration?.notApplicable ?? {};
  for (const [id, reason] of Object.entries(xfail)) {
    if (!checks.has(id)) problems.push(`xfail names ${id}, which is no check of this suite`);
    else if (checks.get(id).placeholder) problems.push(`xfail names ${id}, a placeholder, which is an expected failure for every runtime already`);
    else if (Object.hasOwn(notApplicable, checks.get(id).feature)) problems.push(`xfail names ${id}, but its feature is declared not applicable`);
    if (typeof reason !== 'string' || reason.length === 0) problems.push(`xfail ${id} gives no reason`);
  }
  for (const [feature, reason] of Object.entries(notApplicable)) {
    if (!names.has(feature)) problems.push(`notApplicable names ${feature}, which is no feature of this suite`);
    if (typeof reason !== 'string' || reason.length === 0) problems.push(`notApplicable ${feature} gives no reason`);
  }
  return problems;
}

/** Where a shim's answer differs from what the check expects. Empty means it matches. */
export function judge(check, response) {
  if (response.ok === false && 'unsupported' in response) return [`the runtime does not support this: ${response.unsupported}`];
  const alternatives = check.expect.anyOf ?? [check.expect];
  let closest = null;
  for (const expect of alternatives) {
    const problems = [];
    if (expect.ok !== response.ok) {
      problems.push(response.ok ? `expected an error, got the result ${JSON.stringify(response.result).slice(0, 200)}` : `expected a result, got the error ${JSON.stringify(response.error).slice(0, 200)}`);
    } else if (expect.ok) {
      problems.push(...mismatches(expand(expect.result), response.result, '$.result'));
    } else {
      problems.push(...mismatches(expand(expect.error), response.error, '$.error'));
    }
    if (problems.length === 0) return [];
    closest ??= problems;
  }
  return closest;
}

/** A verdict must be a `prism/verdict/1` wherever it appears, whatever else the check asks of it. */
function verdictProblems(check, response) {
  if (check.op !== 'verify') return [];
  const verdict = response.ok ? response.result : response.error?.verdict;
  if (verdict === undefined || verdict === null) return [];
  return validate(VERDICT_SCHEMA, verdict).map((error) => `not a prism/verdict/1: ${error.path} ${error.message}`);
}

async function runCheck(check, context) {
  const base = { id: check.id, feature: check.feature };
  if (check.placeholder) return { ...base, status: 'xfail', reason: `#${check.placeholder.issue}: ${check.placeholder.reason}` };
  if (Object.hasOwn(context.declaration.notApplicable ?? {}, check.feature)) return { ...base, status: 'n/a', reason: context.declaration.notApplicable[check.feature] };
  const request = { op: check.op, input: expand(check.input ?? {}) };
  if (check.archive) request.archive = context.paths[check.archive];
  const { response, broken } = await callShim(context.command, request, { cwd: context.cwd, env: check.env, timeoutMs: context.timeoutMs });
  // A broken shim says nothing about the check, so no declaration excuses it.
  if (broken) return { ...base, status: 'fail', detail: broken };
  const problems = [...judge(check, response), ...verdictProblems(check, response)];
  const declared = (context.declaration.xfail ?? {})[check.id];
  if (problems.length === 0) {
    return declared === undefined ? { ...base, status: 'pass' } : { ...base, status: 'unexpected-pass', reason: declared };
  }
  if (declared !== undefined) return { ...base, status: 'xfail', reason: declared, detail: problems.join('; ') };
  return { ...base, status: 'fail', detail: problems.join('; ') };
}

async function pool(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
  return results;
}

/** Ask the shim who it is. Throws when it does not speak this contract, since no check could mean anything then. */
export async function describeRuntime(command, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { response, broken } = await callShim(command, { op: 'describe', input: {} }, { cwd, timeoutMs });
  if (broken) throw new Error(`describe failed: ${broken}`);
  if (!response.ok) throw new Error(`describe failed: ${JSON.stringify(response.error ?? response.unsupported)}`);
  if (response.result?.contract !== SHIM_CONTRACT) throw new Error(`the shim speaks ${JSON.stringify(response.result?.contract)}; this suite speaks ${SHIM_CONTRACT}`);
  return response.result;
}

/**
 * @param {{ runtime: string, command: string[], declaration?: object, cwd?: string, timeoutMs?: number, concurrency?: number, only?: string, onResult?: (result: object) => void, features?: object[] }} options
 */
export async function runSuite({ runtime, command, declaration = EMPTY_DECLARATION, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, concurrency = Math.min(availableParallelism(), 4), only = null, onResult = null, features = loadScenarios() }) {
  const problems = problemsOfDeclaration(declaration, features);
  if (problems.length) throw new Error(`invalid declaration for ${runtime}:\n${problems.join('\n')}`);
  const described = await describeRuntime(command, { cwd, timeoutMs });
  const selected = allChecks(features).filter((check) => only === null || check.id === only || check.id.startsWith(`${only}.`));
  if (selected.length === 0) throw new Error(`no check matches ${only}`);
  const dir = mkdtempSync(join(tmpdir(), 'prism-conformance-'));
  try {
    const names = [...new Set(selected.map((check) => check.archive).filter(Boolean))];
    const paths = writeCorpus(dir, names);
    const checks = await pool(selected, concurrency, async (check) => {
      const result = await runCheck(check, { command, cwd, timeoutMs, declaration, paths });
      onResult?.(result);
      return result;
    });
    const summary = Object.fromEntries(STATUSES.map((status) => [status, checks.filter((check) => check.status === status).length]));
    return {
      schema: RESULTS_SCHEMA,
      runtime,
      implementation: { name: described.name ?? null, version: described.version ?? null },
      revisions: described.revisions ?? [],
      passed: summary.fail === 0 && summary['unexpected-pass'] === 0,
      complete: only === null,
      summary,
      checks,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
