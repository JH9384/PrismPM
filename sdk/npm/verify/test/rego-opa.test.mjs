// The evaluator against OPA itself (issue #285). The subset's promise is that a policy it accepts means what it
// means under OPA, so OPA is the judge of the corpus and of the shipped policies. Needs `opa` on the PATH, or OPA_BIN;
// the ubuntu job of .github/workflows/npm-verify.yml installs a digest-pinned one and sets REQUIRE_OPA so a missing
// binary fails instead of skipping.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseRego, evaluateRego } from '../src/rego.mjs';
import { POLICIES } from '../src/index.mjs';
import { CASES, INPUT, sourceOf } from './rego-corpus.mjs';
import { here } from './helpers.mjs';

const opa = process.env.OPA_BIN || 'opa';
const available = spawnSync(opa, ['version'], { encoding: 'utf8' }).status === 0;
if (!available && process.env.REQUIRE_OPA) throw new Error(`REQUIRE_OPA is set and ${opa} does not run`);
const skip = available ? false : 'no opa on the PATH; the ubuntu CI job runs this';

const dir = mkdtempSync(join(tmpdir(), 'prism-rego-opa-'));
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const members = (values) => (values ?? []).map(canonical).sort();

/** `data.prism.policy` under OPA: its minimum and its deny, with a set as a list. */
function underOpa(source, input, name) {
  const policy = join(dir, `${name}.rego`);
  const document = join(dir, `${name}.json`);
  writeFileSync(policy, source);
  writeFileSync(document, JSON.stringify(input));
  const run = spawnSync(opa, ['eval', '--format', 'json', '-d', policy, '-i', document, 'data.prism.policy'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `opa refused ${name}:\n${run.stdout}\n${run.stderr}`);
  return JSON.parse(run.stdout).result[0].expressions[0].value;
}

function agree(source, input, name) {
  const ours = evaluateRego(parseRego(source), input);
  const theirs = underOpa(source, input, name);
  assert.equal(ours.minimum, theirs.minimum, 'minimum');
  assert.deepEqual(members(ours.deny), members(theirs.deny), 'deny');
}

CASES.forEach((c, index) => {
  test(`OPA agrees: ${c.name}`, { skip }, () => agree(sourceOf(c), INPUT, `case-${index}`));
});

const fixtures = here('../../spec/test/fixtures/policy/policy-input-v1/');
for (const file of readdirSync(fixtures).filter((f) => f.endsWith('.json'))) {
  for (const [name, source] of Object.entries(POLICIES)) {
    test(`OPA agrees: the ${name} policy on ${file}`, { skip }, () => {
      agree(source, JSON.parse(readFileSync(join(fixtures, file), 'utf8')), `${name}-${file.slice(0, -5)}`);
    });
  }
}
