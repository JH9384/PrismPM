/**
 * The fixture rule. Every schema has fixtures in <fixtures>/<area>/<name>/, where <area> is the folder under
 * schemas/ (or `predicates`) and <name> is the schema's file name without `.schema.json`:
 *
 *   <case>.json          must validate
 *   invalid/<case>.json  must be rejected
 *   PENDING              the schema predates this rule and has no instance yet; delete it with the first fixture
 *
 * The generated registry is the fixture of predicates/registry.schema.json.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from './json-schema.mjs';
import { here } from './reference.mjs';

export const FIXTURES = here('fixtures/');

const jsonFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []);
const read = (dir, name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

/** The fixture folder of a schema record from discover(), relative to the fixtures root. */
export const fixtureFolder = (record) => `${record.group === 'predicates' ? 'predicates' : record.group.replace(/^schemas\//, '')}/${record.stem}`;

/** @returns {string[]} what is wrong with the fixtures of one schema; empty when it is covered */
export function fixtureProblems(record, root = FIXTURES) {
  const folder = join(root, fixtureFolder(record));
  const shown = `test/fixtures/${fixtureFolder(record)}`;
  const valid = jsonFiles(folder);
  const invalid = jsonFiles(join(folder, 'invalid'));
  const pending = existsSync(join(folder, 'PENDING'));
  const problems = [];
  if (pending && valid.length > 0) problems.push(`${shown} has fixtures, so delete ${shown}/PENDING`);
  if (!pending && valid.length === 0) problems.push(`${record.path} has no fixture. Add a valid instance as ${shown}/<case>.json`);
  for (const name of valid) {
    const errors = validate(record.schema, read(folder, name));
    if (errors.length) problems.push(`${shown}/${name} should be valid: ${errors.join('; ')}`);
  }
  for (const name of invalid) {
    if (validate(record.schema, read(join(folder, 'invalid'), name)).length === 0) problems.push(`${shown}/invalid/${name} should be rejected`);
  }
  return problems;
}
