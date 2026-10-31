/**
 * Reads and checks `scenarios/*.json`. One file is one feature, one row of the
 * compliance matrix; one entry of its `checks` is one check, with a stable id.
 * Adding a feature means adding a file. No list in this package names them.
 *
 * A check id never changes meaning: a runtime's declaration and the history of
 * COMPLIANCE.md refer to it. To change what a check asks, give it a new id.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ARCHIVES } from './corpus.mjs';
import { OPERATORS, operatorsIn } from './match.mjs';

export const SCENARIOS_DIR = fileURLToPath(new URL('../scenarios/', import.meta.url));

/** The operations of the shim contract, with whether each reads an archive. See README.md. */
export const OPERATIONS = Object.freeze({
  load: true,
  verify: true,
  inspect: true,
  dispatch: true,
  acceptance: true,
  capabilities: false,
});

const ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const CHECK_KEYS = ['id', 'title', 'op', 'archive', 'input', 'env', 'expect'];
const PLACEHOLDER_KEYS = ['id', 'title', 'placeholder'];

function problemsOfCheck(check, feature) {
  const problems = [];
  const id = check?.id;
  if (typeof id !== 'string' || !ID.test(id)) return [`check id ${JSON.stringify(id)} is not dotted lowercase`];
  if (!id.startsWith(`${feature}.`)) problems.push(`${id} does not start with its feature, ${feature}`);
  if (typeof check.title !== 'string' || check.title.length === 0) problems.push(`${id} has no title`);
  if ('placeholder' in check) {
    for (const key of Object.keys(check)) if (!PLACEHOLDER_KEYS.includes(key)) problems.push(`${id} is a placeholder and cannot have ${key}`);
    if (!Number.isInteger(check.placeholder?.issue)) problems.push(`${id} is a placeholder and names no issue`);
    if (typeof check.placeholder?.reason !== 'string' || check.placeholder.reason.length === 0) problems.push(`${id} is a placeholder and gives no reason`);
    return problems;
  }
  for (const key of Object.keys(check)) if (!CHECK_KEYS.includes(key)) problems.push(`${id} has an unknown member ${key}`);
  if (!Object.hasOwn(OPERATIONS, check.op)) problems.push(`${id} names an unknown operation ${check.op}`);
  else if (OPERATIONS[check.op] && !check.archive) problems.push(`${id}: ${check.op} reads an archive and the check names none`);
  else if (!OPERATIONS[check.op] && check.archive) problems.push(`${id}: ${check.op} reads no archive`);
  if (check.archive && !Object.hasOwn(ARCHIVES, check.archive)) problems.push(`${id} names an unknown archive ${check.archive}`);
  const alternatives = check.expect?.anyOf ?? [check.expect];
  if (!Array.isArray(alternatives) || alternatives.length === 0) problems.push(`${id} has an empty anyOf`);
  for (const expect of alternatives) {
    if (typeof expect?.ok !== 'boolean') problems.push(`${id}: every expectation says ok true or false`);
    else if (expect.ok && !('result' in expect)) problems.push(`${id}: ok true must say what result it expects`);
    else if (!expect.ok && !('error' in expect)) problems.push(`${id}: ok false must say what error it expects`);
  }
  for (const operator of operatorsIn([check.expect, check.input])) if (!OPERATORS.includes(operator)) problems.push(`${id} uses an unknown operator ${operator}`);
  return problems;
}

/** Every problem in one parsed scenario file. */
export function problemsOfFile(file, name) {
  const feature = name.replace(/\.json$/, '');
  if (file?.feature !== feature) return [`${name}: feature must be ${feature}`];
  if (typeof file.title !== 'string' || file.title.length === 0) return [`${name}: no title`];
  if (!Array.isArray(file.checks) || file.checks.length === 0) return [`${name}: no checks`];
  return file.checks.flatMap((check) => problemsOfCheck(check, feature));
}

/** The features in file name order, each `{ feature, title, checks }`. Throws on any problem. */
export function loadScenarios(dir = SCENARIOS_DIR) {
  const names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  const features = names.map((name) => ({ name, file: JSON.parse(readFileSync(join(dir, name), 'utf8')) }));
  const problems = features.flatMap(({ name, file }) => problemsOfFile(file, name));
  const seen = new Set();
  for (const { file } of features) {
    for (const check of file.checks ?? []) {
      if (seen.has(check.id)) problems.push(`check id ${check.id} appears twice`);
      seen.add(check.id);
    }
  }
  if (problems.length) throw new Error(`invalid scenarios:\n${problems.join('\n')}`);
  return features.map(({ file }) => file);
}

export const allChecks = (features) => features.flatMap((feature) => feature.checks.map((check) => ({ ...check, feature: feature.feature })));
