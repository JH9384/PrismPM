/**
 * What the evaluator in src/rego.mjs answers, case by case. `rego.test.mjs` holds the
 * evaluator to these, and `rego-opa.test.mjs` holds OPA to the same answers, so an
 * expected value here is never only this evaluator's opinion. Not a test file.
 *
 * A case is a rule body written under `package prism.policy`, with `minimum := "P0"`
 * added unless the case defines it. `deny` holds the expected members, in any order.
 */
export const INPUT = Object.freeze({
  n: 3,
  s: 'hello',
  list: ['a', 'b', 'c'],
  numbers: [1, 2, 3],
  empty: [],
  object: { x: 1, y: 2 },
  nothing: null,
  yes: true,
  no: false,
  nested: { a: { b: [{ c: 'deep' }] } },
});

export const CASES = Object.freeze([
  { name: 'a constant minimum', rules: 'minimum := "P2"', minimum: 'P2', deny: [] },
  { name: 'a conditional minimum falls back to its default', rules: 'default minimum := "P1"\nminimum := "P3" if input.no', minimum: 'P1', deny: [] },
  { name: 'a conditional minimum that holds', rules: 'default minimum := "P1"\nminimum := "P3" if input.yes', minimum: 'P3', deny: [] },
  { name: 'a minimum with no value is undefined', rules: 'minimum := "P3" if input.no', minimum: undefined, deny: [] },
  { name: 'two definitions may agree', rules: 'minimum := "P1" if input.yes\nminimum := "P1" if input.n == 3', minimum: 'P1', deny: [] },

  { name: 'some over an array', rules: 'deny contains x if {\n\tsome x in input.list\n}', deny: ['a', 'b', 'c'] },
  { name: 'some index and value over an array', rules: 'deny contains [i, x] if {\n\tsome i, x in input.list\n}', deny: [[0, 'a'], [1, 'b'], [2, 'c']] },
  { name: 'some key and value over an object', rules: 'deny contains [k, v] if {\n\tsome k, v in input.object\n}', deny: [['x', 1], ['y', 2]] },
  { name: 'some value over an object', rules: 'deny contains v if {\n\tsome v in input.object\n}', deny: [1, 2] },
  { name: 'some over a set literal', rules: 'deny contains x if {\n\tsome x in {"b", "a", "a"}\n}', deny: ['a', 'b'] },
  { name: 'some over nothing has no solutions', rules: 'deny contains x if {\n\tsome x in input.missing\n}', deny: [] },
  { name: 'some over null has no solutions', rules: 'deny contains x if {\n\tsome x in input.nothing\n}', deny: [] },
  { name: 'some with a wildcard key', rules: 'deny contains v if {\n\tsome _, v in input.object\n}', deny: [1, 2] },
  { name: 'two some literals join', rules: 'deny contains [x, n] if {\n\tsome x in ["a"]\n\tsome n in [1, 2]\n}', deny: [['a', 1], ['a', 2]] },

  { name: 'every that holds', rules: 'deny contains "all" if {\n\tevery x in input.numbers {\n\t\tx > 0\n\t}\n}', deny: ['all'] },
  { name: 'every that fails', rules: 'deny contains "all" if {\n\tevery x in input.numbers {\n\t\tx > 1\n\t}\n}', deny: [] },
  { name: 'every over an empty domain holds', rules: 'deny contains "all" if {\n\tevery x in input.empty {\n\t\tx > 1\n\t}\n}', deny: ['all'] },
  { name: 'every over nothing fails', rules: 'deny contains "all" if {\n\tevery x in input.missing {\n\t\tx > 1\n\t}\n}', deny: [] },
  { name: 'every with key and value', rules: 'deny contains "all" if {\n\tevery k, v in input.object {\n\t\tstartswith(k, "x")\n\t\tv > 0\n\t}\n}', deny: [] },

  { name: 'not of something undefined holds', rules: 'deny contains "gone" if {\n\tnot input.missing\n}', deny: ['gone'] },
  { name: 'not of false holds', rules: 'deny contains "no" if {\n\tnot input.no\n}', deny: ['no'] },
  { name: 'not of true fails', rules: 'deny contains "no" if {\n\tnot input.yes\n}', deny: [] },
  { name: 'not of a comparison over nothing holds', rules: 'deny contains "gone" if {\n\tnot input.missing == 1\n}', deny: ['gone'] },
  { name: 'null is defined and not false', rules: 'deny contains "there" if {\n\tinput.nothing == null\n}\ndeny contains "truthy" if {\n\tinput.nothing\n}', deny: ['there', 'truthy'] },
  { name: 'a comparison with nothing is undefined, not false', rules: 'deny contains "ne" if {\n\tinput.missing != 1\n}', deny: [] },

  { name: 'equality is structural', rules: 'deny contains "same" if {\n\t{"a": [1, 2]} == {"a": [1, 2]}\n}\ndeny contains "sets" if {\n\t{1, 2} == {2, 1}\n}', deny: ['same', 'sets'] },
  { name: 'an array is not a set', rules: 'deny contains "same" if {\n\tinput.numbers == {1, 2, 3}\n}', deny: [] },
  { name: 'a number is not a string', rules: 'deny contains "same" if {\n\tinput.n == "3"\n}', deny: [] },
  { name: 'order of numbers', rules: 'deny contains "a" if {\n\tinput.n < 4\n}\ndeny contains "b" if {\n\tinput.n <= 3\n}\ndeny contains "c" if {\n\tinput.n > 3\n}\ndeny contains "d" if {\n\tinput.n >= 3\n}', deny: ['a', 'b', 'd'] },
  { name: 'order of strings', rules: 'deny contains "a" if {\n\t"P1" < "P2"\n}\ndeny contains "b" if {\n\t"a" > "B"\n}', deny: ['a', 'b'] },

  { name: 'in over an array, a set and object values', rules: 'deny contains "a" if {\n\t"a" in input.list\n}\ndeny contains "s" if {\n\t"a" in {"a"}\n}\ndeny contains "o" if {\n\t1 in input.object\n}\ndeny contains "k" if {\n\t"x" in input.object\n}', deny: ['a', 's', 'o'] },
  { name: 'not in', rules: 'deny contains "out" if {\n\tnot "z" in input.list\n}', deny: ['out'] },
  { name: 'in over nothing fails', rules: 'deny contains "in" if {\n\t"a" in input.missing\n}', deny: [] },
  { name: 'in over a scalar fails', rules: 'deny contains "in" if {\n\t"a" in input.n\n}', deny: [] },

  { name: 'an array comprehension keeps order and repeats', rules: 'names := [x | some x in ["b", "a", "b"]]\ndeny contains names if {\n\tcount(names) > 0\n}', deny: [['b', 'a', 'b']] },
  { name: 'a set comprehension drops repeats', rules: 'names := {x | some x in ["b", "a", "b"]}\ndeny contains n if {\n\tn := count(names)\n}', deny: [2] },
  { name: 'an object comprehension', rules: 'doubled := {k: [v, v] | some k, v in input.object}\ndeny contains doubled.x if {\n\tdoubled.y\n}', deny: [[1, 1]] },
  { name: 'an empty comprehension is defined', rules: 'none := [x | some x in input.empty]\ndeny contains "empty" if {\n\tnone == []\n}', deny: ['empty'] },
  { name: 'a comprehension over several literals', rules: 'big := [x | some x in input.numbers; x > 1]\ndeny contains big if {\n\ttrue\n}', deny: [[2, 3]] },

  { name: 'a rule of a helper', rules: 'ready if input.yes\ndeny contains "ready" if {\n\tready\n}', deny: ['ready'] },
  { name: 'a helper with no value is undefined', rules: 'ready if input.no\ndeny contains "not ready" if {\n\tnot ready\n}', deny: ['not ready'] },
  { name: 'a helper table, indexed', rules: 'rank := {"P0": 0, "P1": 1}\ndeny contains r if {\n\tr := rank["P1"]\n}', deny: [1] },
  { name: 'a helper set is searched', rules: 'bad contains x if {\n\tsome x in input.list\n\tx != "a"\n}\ndeny contains x if {\n\tsome x in bad\n}', deny: ['b', 'c'] },
  { name: 'a helper set is indexed', rules: 'bad contains x if {\n\tsome x in input.list\n}\ndeny contains "hit" if {\n\tbad["a"]\n}\ndeny contains "miss" if {\n\tbad["z"]\n}', deny: ['hit'] },
  { name: 'a helper assigned false is false', rules: 'off := false\ndeny contains "off" if {\n\tnot off\n}\ndeny contains "defined" if {\n\toff == false\n}', deny: ['off', 'defined'] },

  { name: 'a reference through arrays and objects', rules: 'deny contains input.nested.a.b[0].c if {\n\ttrue\n}', deny: ['deep'] },
  { name: 'a reference by a bound variable', rules: 'deny contains v if {\n\tsome k in ["x"]\n\tv := input.object[k]\n}', deny: [1] },
  { name: 'a reference out of range is undefined', rules: 'deny contains "there" if {\n\tinput.list[9]\n}', deny: [] },
  { name: 'a reference through null is undefined', rules: 'deny contains "there" if {\n\tinput.nothing.x\n}', deny: [] },
  { name: 'a reference through a scalar is undefined', rules: 'deny contains "there" if {\n\tinput.n.x\n}', deny: [] },
  { name: 'a head that is undefined adds nothing', rules: 'deny contains input.missing if {\n\ttrue\n}', deny: [] },
  { name: 'a literal with an undefined member is undefined', rules: 'deny contains [input.missing] if {\n\ttrue\n}\ndeny contains {"a": input.missing} if {\n\ttrue\n}\ndeny contains {input.missing} if {\n\ttrue\n}', deny: [] },
  { name: 'an assignment of nothing stops the body', rules: 'deny contains "reached" if {\n\tx := input.missing\n\tnot x\n}', deny: [] },

  { name: 'count', rules: 'deny contains [count(input.list), count(input.object), count({1, 2}), count("héllo")] if {\n\ttrue\n}', deny: [[3, 2, 2, 5]] },
  { name: 'concat of an array keeps order', rules: 'deny contains concat(", ", ["b", "a"]) if {\n\ttrue\n}', deny: ['b, a'] },
  { name: 'concat of a set sorts', rules: 'deny contains concat(", ", {"b", "a"}) if {\n\ttrue\n}', deny: ['a, b'] },
  { name: 'contains, startswith and endswith', rules: 'deny contains [contains(input.s, "ell"), startswith(input.s, "he"), endswith(input.s, "he")] if {\n\ttrue\n}', deny: [[true, true, false]] },
  { name: 'contains is a function in a body', rules: 'deny contains "yes" if {\n\tcontains(input.s, "ell")\n}', deny: ['yes'] },
  { name: 'object.get', rules: 'deny contains [object.get(input.object, "x", 0), object.get(input.object, "z", 0)] if {\n\ttrue\n}', deny: [[1, 0]] },
  { name: 'object.keys', rules: 'deny contains k if {\n\tsome k in object.keys(input.object)\n}', deny: ['x', 'y'] },
  { name: 'set()', rules: 'deny contains count(set()) if {\n\ttrue\n}', deny: [0] },
  { name: 'type_name', rules: 'deny contains [type_name(null), type_name(true), type_name(1), type_name("s"), type_name([]), type_name({}), type_name(set())] if {\n\ttrue\n}', deny: [['null', 'boolean', 'number', 'string', 'array', 'object', 'set']] },
  { name: 'sprintf with each verb', rules: 'deny contains sprintf("%s %d %v %v %v %%", ["a", 1, "b", 2, true]) if {\n\ttrue\n}', deny: ['a 1 b 2 true %'] },
  { name: 'sprintf %v of collections', rules: 'deny contains sprintf("%v %v %v", [["a", 1], {"k": "v"}, {"s"}]) if {\n\ttrue\n}', deny: ['["a", 1] {"k": "v"} {"s"}'] },

  { name: 'a raw string, escapes and comments', rules: '# a comment\ndeny contains `a\\b` if {\n\ttrue # another\n}\ndeny contains "t\\tq\\"\\u00e9" if {\n\ttrue\n}', deny: ['a\\b', 't\tq"é'] },
  { name: 'semicolons and one-line bodies', rules: 'deny contains "a" if { input.yes; input.n == 3 }\ndeny contains "b" if input.yes', deny: ['a', 'b'] },
  { name: 'a rule with no body', rules: 'deny contains "always"', deny: ['always'] },
  { name: 'collections across lines, with trailing commas', rules: 'deny contains {\n\t"k": [\n\t\t1,\n\t\t2,\n\t],\n\t"s": {\n\t\t"x",\n\t},\n} if {\n\ttrue\n}', deny: [{ k: [1, 2], s: ['x'] }] },
  { name: 'an object member named __proto__ is an ordinary member', rules: 'deny contains {"__proto__": 1}', deny: [{ ['__proto__']: 1 }] },
]);

/** The source of a case. */
export function sourceOf({ rules }) {
  const minimum = /^(default )?minimum /m.test(rules) ? '' : 'minimum := "P0"\n';
  return `package prism.policy\n\nimport rego.v1\n\n${minimum}${rules}\n`;
}
