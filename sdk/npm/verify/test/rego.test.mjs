// The Rego subset of src/rego.mjs (issue #285): what it answers, what it refuses, and what stops an evaluation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRego, evaluateRego, RegoError } from '../src/rego.mjs';
import { CASES, INPUT, sourceOf } from './rego-corpus.mjs';

const canonical = (values) => values.map((value) => JSON.stringify(value)).sort();
const module = (rules) => `package prism.policy\n\nimport rego.v1\n\nminimum := "P0"\n${rules}\n`;

for (const c of CASES) {
  test(`corpus: ${c.name}`, () => {
    const { minimum, deny } = evaluateRego(parseRego(sourceOf(c)), INPUT);
    assert.equal(minimum, c.minimum === undefined && /minimum/.test(c.rules) ? undefined : c.minimum ?? 'P0');
    assert.deepEqual(canonical(deny), canonical(c.deny));
  });
}

const REFUSED = [
  ['a function', 'f(x) := x\ndeny contains f(1)', /f is a function/],
  ['a call of an unlisted function', 'deny contains time.now_ns()', /the function time\.now_ns is outside the subset/],
  ['http.send', 'deny contains http.send({})', /http\.send is outside the subset/],
  ['a regex', 'deny contains "x" if regex.match("a", "b")', /regex\.match is outside the subset/],
  ['a partial object', 'p[k] := 1 if {\n\tsome k in input.list\n}\ndeny contains p', /partial object/],
  ['else', 'x := 1 if input.no else := 2\ndeny contains x', /else is outside the subset/],
  ['with', 'deny contains "x" if {\n\tinput.a with input as {}\n}', /with is outside the subset/],
  ['unification', 'deny contains "x" if {\n\ty = 1\n}', /= is outside the subset/],
  ['a rule written with =', 'x = 1\ndeny contains x', /= is outside the subset/],
  ['arithmetic', 'deny contains "x" if {\n\t1 + 1 == 2\n}', /operator \+ is outside the subset/],
  ['a set difference', 'deny contains "x" if {\n\ty := {1} - {2}\n\ty\n}', /operator - is outside the subset/],
  ['a set intersection', 'deny contains "x" if {\n\ty := {1} & {2}\n\ty\n}', /operator & is outside the subset/],
  ['a wildcard in a reference', 'deny contains "x" if {\n\tinput.list[_] == "a"\n}', /wildcard in a reference is outside the subset/],
  ['an unbound variable in a reference', 'deny contains "x" if {\n\tinput.list[i] == "a"\n}', /i is unsafe/],
  ['a bare some', 'deny contains "x" if {\n\tsome i\n\tinput.list[i] == "a"\n}', /a bare some is outside the subset/],
  ['data', 'deny contains "x" if {\n\tdata.y\n}', /data is outside the subset/],
  ['an import after the rules start', 'import rego.v1\ndeny contains "x"', /import is a keyword/],
  ['k, v in as an expression', 'deny contains "x" if {\n\t1, "b" in input.list\n}', /k, v in collection as an expression/],
  ['a variable used before it is bound', 'deny contains "x" if {\n\ty == 1\n\ty := 1\n}', /y is unsafe/],
  ['a head variable the body does not bind', 'deny contains y if {\n\tinput.yes\n}', /y is unsafe/],
  ['a variable that does not exist', 'deny contains "x" if {\n\tnope\n}', /nope is unsafe/],
  ['a rebound name', 'deny contains "x" if {\n\ty := 1\n\ty := 2\n}', /y is already bound/],
  ['a local that shadows input', 'deny contains "x" if {\n\tinput := 1\n}', /input is already bound/],
  ['a local that shadows a rule', 'r := 1\ndeny contains r if {\n\tr := 2\n}', /r is already bound/],
  ['recursion', 'a contains x if {\n\tsome x in b\n}\nb contains x if {\n\tsome x in a\n}\ndeny contains x if {\n\tsome x in a\n}', /the rules recurse/],
  ['a rule named data', 'data := 1', /a rule cannot be named data|data is a keyword|cannot be named/],
  ['an empty body', 'deny contains "x" if {\n}', /a body is empty/],
  ['a string with a line break', 'deny contains "x\ny"', /not closed on its line/],
  ['a stray character', 'deny contains @', /unexpected character/],
  ['deny as a value', 'deny := "x"', /deny is a set/],
  ['deny defined two ways', 'deny contains "x"\ndeny := "y"', /defined both/],
  ['two defaults', 'default d := 1\ndefault d := 2\ndeny contains d', /more than one default/],
  ['an allow rule nothing consults', 'allow if input.yes', /the rule allow decides nothing/],
  ['a misspelled deny', 'denny contains "x"', /the rule denny decides nothing/],
];

for (const [name, rules, pattern] of REFUSED) {
  test(`refused when parsed: ${name}`, () => {
    assert.throws(() => parseRego(module(rules)), (error) => {
      assert.ok(error instanceof RegoError, String(error));
      assert.equal(error.kind, 'parse');
      assert.match(error.message, pattern);
      return true;
    });
  });
}

test('OPA refuses literals of different types when it compiles; here the comparison is false', () => {
  // The one known difference: OPA's type checker has no counterpart here, so this is accepted and answers, never disagreeing with an answer OPA gives.
  const program = parseRego(module('deny contains "same" if {\n\t1 == "1"\n}\ndeny contains "differ" if {\n\t1 != "1"\n}'));
  assert.deepEqual(evaluateRego(program, {}).deny, ['differ']);
});

test('a module must be the package this file reads, and define minimum', () => {
  assert.throws(() => parseRego('deny contains "x"'), /a policy starts with package prism\.policy/);
  assert.throws(() => parseRego('package other\nminimum := "P0"'), /the package must be prism\.policy, not other/);
  assert.throws(() => parseRego('package prism.policy\ndeny contains "x"'), /a policy defines minimum/);
  assert.throws(() => parseRego('package prism.policy\nminimum contains "P0"'), /minimum is one value/);
  assert.throws(() => parseRego('package prism.policy\nimport data.other\nminimum := "P0"'), /only rego\.v1 may be imported, not data\.other/);
  assert.throws(() => parseRego(42), /a policy is text/);
  assert.throws(() => parseRego('#'.repeat(256 * 1024 + 1)), /at most/);
});

test('a parse error names its line and column', () => {
  assert.throws(() => parseRego(module('deny contains @')), /line 6, column 15: unexpected character/);
  const lines = 'package prism.policy\nminimum := "P0"\n\n\ndeny contains x if {\n\tx := `a\nb`\n\ty\n}\n';
  assert.throws(() => parseRego(lines), /line 8, column 2: y is unsafe/);
});

test('terms nest only so deep', () => {
  const deep = `${'['.repeat(200)}1${']'.repeat(200)}`;
  assert.throws(() => parseRego(module(`deny contains ${deep}`)), /nest deeper than 64/);
});

const EVALUATION = [
  ['a complete rule with two values', 'x := 1 if input.yes\nx := 2 if input.yes\ndeny contains x', /rule x at line \d+: x has two different values, 1 and 2/],
  ['count of a number', 'deny contains count(input.n)', /rule deny at line \d+: count wants a collection or a string, and got a number/],
  ['startswith of a number', 'deny contains startswith(input.n, "a")', /startswith wants a string as argument 1/],
  ['concat of numbers', 'deny contains concat(",", input.numbers)', /concat wants a string as argument 2, and got a number/],
  ['object.get of an array', 'deny contains object.get(input.list, "x", 0)', /object\.get wants a object as argument 1/],
  ['sprintf with too few values', 'deny contains sprintf("%s %s", ["a"])', /wants more than the 1 values/],
  ['sprintf with too many values', 'deny contains sprintf("%s", ["a", "b"])', /uses 1 of the 2 values/],
  ['sprintf %s of a number', 'deny contains sprintf("%s", [1])', /%s wants a string/],
  ['sprintf %d of a string', 'deny contains sprintf("%d", ["a"])', /%d wants an integer/],
  ['sprintf with a verb it lacks', 'deny contains sprintf("%q", ["a"])', /no verb %q/],
  ['an order between a number and a string', 'deny contains "x" if {\n\tinput.n < input.s\n}', /< compares two numbers or two strings, and got a number and a string/],
  ['an order between arrays', 'deny contains "x" if {\n\tinput.list < input.list\n}', /< compares two numbers or two strings/],
  ['an object key that is not a string', 'deny contains {1: 2}', /an object key must be a string/],
];

for (const [name, rules, pattern] of EVALUATION) {
  test(`stops the evaluation: ${name}`, () => {
    const program = parseRego(module(rules));
    assert.throws(() => evaluateRego(program, INPUT), (error) => {
      assert.ok(error instanceof RegoError, String(error));
      assert.equal(error.kind, 'evaluation');
      assert.match(error.message, pattern);
      return true;
    });
  });
}

test('an evaluation that runs too long stops, naming its rule', () => {
  const program = parseRego(module('deny contains [a, b] if {\n\tsome a in input.big\n\tsome b in input.big\n}'));
  const big = Array.from({ length: 2000 }, (_, i) => i);
  assert.throws(() => evaluateRego(program, { big }), /rule deny at line 6: the evaluation took more than 2000000 steps/);
});

test('an undefined decision is reported as undefined, and a policy with no deny denies nothing', () => {
  assert.deepEqual(evaluateRego(parseRego('package prism.policy\nminimum := "P1"'), {}), { minimum: 'P1', deny: [] });
  assert.equal(evaluateRego(parseRego('package prism.policy\nminimum := "P1" if input.no'), {}).minimum, undefined);
});

test('the input is read and never written', () => {
  const frozen = Object.freeze({ list: Object.freeze(['a']), object: Object.freeze({ x: 1 }) });
  const program = parseRego(module('deny contains [x, k] if {\n\tsome x in input.list\n\tsome k, _ in input.object\n}'));
  assert.deepEqual(evaluateRego(program, frozen).deny, [['a', 'x']]);
});

test('an input member named __proto__ does not reach the prototype', () => {
  const input = JSON.parse('{"__proto__": {"polluted": true}}');
  const program = parseRego(module('deny contains "own" if {\n\tinput["__proto__"].polluted\n}\ndeny contains "inherited" if {\n\tinput.toString\n}'));
  assert.deepEqual(evaluateRego(program, input).deny, ['own']);
  assert.equal({}.polluted, undefined);
});
