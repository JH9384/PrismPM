// Planted defects: a gate counts only when a deliberate defect makes it fail.
// Each case plants one defect in an otherwise valid input and names the refusal
// it must get. A defect that passes is a gate that does not hold.
//
// G2 text: the spec is never altered; text a model or document cannot carry
// as written is refused, naming the character, its code point and its path.
// G7 integrity: lives in test/check.test.mjs and test/verify.test.mjs
// (a tampered holo under a P0 policy) and in sdk/npm/verify/test/policy.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpecError, validateSpec } from '../src/journey/spec.mjs';
import { renderModel } from '../src/journey/render.mjs';

const VALID = Object.freeze({
  name: 'door',
  title: 'Door',
  purpose: 'Open the door only for a badge on the list.',
  fields: [{ name: 'badge', kind: 'choice', values: ['guest', 'staff'], means: 'Who is at the door.' }],
  outcomes: ['open', 'closed'],
  meanings: { open: 'The door opens.' },
  rules: [{ when: [{ field: 'badge', op: 'is', value: 'staff' }], then: 'open', why: 'Staff may enter.' }],
  otherwise: 'closed',
  otherwiseWhy: 'Everyone else waits.',
  properties: [{ kind: 'never', when: [{ field: 'badge', op: 'is', value: 'guest' }], then: 'open', why: 'Guests never get in.' }],
  examples: [{ request: 'staff', response: 'open' }],
  limits: ['It does not check the badge itself.'],
});

const plant = (edit) => {
  const spec = structuredClone(VALID);
  edit(spec);
  return spec;
};

const refusedWith = (spec, rule, where, codePoint) => {
  assert.throws(
    () => validateSpec(spec),
    (error) => {
      assert.ok(error instanceof SpecError, String(error));
      assert.equal(error.rule, rule);
      assert.equal(error.where, where);
      if (codePoint) assert.ok(error.message.includes(codePoint), error.message);
      return true;
    },
  );
};

test('the unplanted spec passes, unchanged in every text it carries', () => {
  const spec = validateSpec(VALID);
  for (const key of ['title', 'purpose', 'otherwiseWhy']) assert.equal(spec[key], VALID[key]);
  assert.equal(spec.fields[0].means, VALID.fields[0].means);
  assert.equal(spec.rules[0].why, VALID.rules[0].why);
  assert.equal(spec.properties[0].why, VALID.properties[0].why);
  assert.deepEqual(spec.meanings, VALID.meanings);
  assert.deepEqual(spec.limits, VALID.limits);
  assert.ok(renderModel(spec).includes('"Door"'));
});

const DEFECTS = [
  ['a quote in the title', (s) => (s.title = 'Door "A"'), 'text.character', 'title', 'U+0022'],
  ['a backslash in the purpose', (s) => (s.purpose = 'Open the door\\now.'), 'text.character', 'purpose', 'U+005C'],
  ['a U+0007 control character in the purpose', (s) => (s.purpose = 'Open\u0007 the door.'), 'text.character', 'purpose', 'U+0007'],
  ['a non-ASCII letter in the title', (s) => (s.title = 'Tür'), 'text.character', 'title', 'U+00FC'],
  ['a newline in a reason', (s) => (s.rules[0].why = 'Staff\nmay enter.'), 'text.character', 'rules[0].why', 'U+000A'],
  ['a U+2028 line separator in a meaning', (s) => (s.meanings.open = 'The door opens.'), 'text.character', 'meanings.open', 'U+2028'],
  ['a control character in a field meaning', (s) => (s.fields[0].means = 'Who\u0000 is there.'), 'text.character', 'fields[0].means', 'U+0000'],
  ['text not in NFC form', (s) => (s.properties[0].why = 'Guésts never get in.'), 'text.character', 'properties[0].why', null],
  ['a doubled space', (s) => (s.otherwiseWhy = 'Everyone  else waits.'), 'text.space', 'otherwiseWhy', null],
  ['a trailing space', (s) => (s.limits[0] = 'It does not check the badge itself. '), 'text.space', 'limits[0]', null],
  ['a title over 64 characters', (s) => (s.title = 'D'.repeat(65)), 'text.length', 'title', null],
  ['a purpose over 200 characters', (s) => (s.purpose = 'x'.repeat(201)), 'text.length', 'purpose', null],
  ['a reason over 240 characters', (s) => (s.rules[0].why = 'y'.repeat(241)), 'text.length', 'rules[0].why', null],
  ['a control character in what a property says', (s) => (s.properties[0].says = 'Never\u001b open.'), 'text.character', 'properties[0].says', 'U+001B'],
];

for (const [name, edit, rule, where, codePoint] of DEFECTS) {
  test(`G2 planted defect: ${name} is refused as ${rule} at ${where}`, () => refusedWith(plant(edit), rule, where, codePoint));
}

test('G2 planted defect: render refuses a string it would have to change, even past validation', () => {
  const spec = validateSpec(VALID);
  spec.title = 'Door "A"';
  assert.throws(() => renderModel(spec), /render refuses/);
});

// G7 at load and run: a holo with any one byte flipped is refused as damage, never with a raw
// decoding error and never by running it. Before, a flip that left a section invalid UTF-8
// escaped as a TypeError (exit 70), and a flip in a document was named as that document.
test('G7 planted defect: one byte flipped anywhere in a holo is refused, never a TypeError, never run', async () => {
  const { readFileSync } = await import('node:fs');
  const { load, DigestMismatchError, PrismCodeError } = await import('../src/index.mjs');
  const holo = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
  const offsets = new Set([0, 4, 9, 10, 40, 200, 300, 1000, holo.length - 200, holo.length - 33, holo.length - 1]);
  for (let at = 0; at < holo.length; at += Math.max(1, Math.floor(holo.length / 97))) offsets.add(at);
  let integrity = 0;
  for (const at of [...offsets].sort((a, b) => a - b)) {
    const altered = new Uint8Array(holo);
    altered[at] ^= 0xff;
    await assert.rejects(load(altered), (error) => {
      assert.ok(!(error instanceof TypeError) && !(error instanceof RangeError), `byte ${at}: raw ${error?.name}: ${error?.message}`);
      assert.ok(error instanceof PrismCodeError || error instanceof DigestMismatchError, `byte ${at}: ${error?.name}: ${error?.message}`);
      if (error instanceof DigestMismatchError) {
        assert.equal(error.check, 'holo.integrity', `byte ${at}`);
        assert.match(error.message, /^integrity failure: the holo was altered/, `byte ${at}`);
        integrity++;
      } else {
        // Only damage to the header or the section table, which locates the footer, may be refused structurally.
        assert.match(error.code, /^archive\.(magic|version|flags|bounds|table|input)$/, `byte ${at}: ${error.code}: ${error.message}`);
      }
      return true;
    });
  }
  assert.ok(integrity > offsets.size / 2, `${integrity} of ${offsets.size} flips named as integrity failures`);
});

test('G7 planted defect: prism-code run refuses a damaged holo under a P0 policy with "integrity failure", exit 1', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'prism-g7-'));
  const holo = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
  const policy = join(dir, 'p0.json');
  writeFileSync(policy, '{"minimum":"P0"}');
  const bin = new URL('../bin/prism-code.mjs', import.meta.url);
  for (const at of [300, 1000, holo.length - 200]) {
    const altered = new Uint8Array(holo);
    altered[at] ^= 0xff;
    const path = join(dir, `altered-${at}.holo`);
    writeFileSync(path, altered);
    const r = spawnSync(process.execPath, [bin.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'run', path, '1 add 2 3', '--policy', policy], { encoding: 'utf8', env: { ...process.env, PRISM_HOME: join(dir, 'home') } });
    assert.equal(r.status, 1, `byte ${at}: exit ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /integrity failure/, `byte ${at}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /TypeError/);
  }
});
