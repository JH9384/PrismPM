// The rule app's rules are stated in LexLean and proved by Lean (model/rule-app). This suite evaluates the model's
// own text beside the JavaScript that follows it, so a change to either that the other does not share is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ANSWER, admits, answerKind, greatestAt, kernelChecked, leastAt, rulesAt } from '../src/journey/rule-app.mjs';
import { reuseAdmits } from '../src/journey/kappa-store.mjs';

const read = (file) => readFileSync(new URL(`../model/rule-app/${file}`, import.meta.url), 'utf8');
const MODEL = read('src/RuleApp.lex.tex');
const PROOFS = read('src/RuleAppProofs.lex.tex');
const VERIFIED = JSON.parse(read('verification.json'));

/** The definitions of a module: name, parameter names and the body as written. */
function definitions(text) {
  const out = new Map();
  for (const m of text.matchAll(/definition\{\s*name: (\w+),\s*parameters: \[([^\]]*)\],\s*result: \w+,\s*body: ([\s\S]*?)\s*\}(?=\n\n|\n\\end|\n$)/g)) {
    out.set(m[1], { parameters: m[2].split(',').map((p) => p.split(':')[0].trim()).filter(Boolean), body: m[3] });
  }
  return out;
}

/** Evaluate a LexLean body over naturals and booleans: the fragment these modules are written in. */
function evaluator(defs) {
  const tokens = (body) => body.match(/\(|\)|<=\?|<\?|=\?|&&|\|\||\+|[A-Za-z_][\w:]*|\d+/g);
  const parse = (ts) => {
    const t = ts.shift();
    if (t !== '(') return /^\d+$/.test(t) ? { n: Number(t) } : { v: t };
    const items = [];
    while (ts[0] !== ')') items.push(ts[0] === '(' ? parse(ts) : ts.shift());
    ts.shift();
    return { items };
  };
  const call = (name, args) => {
    const d = defs.get(name.split('::').pop());
    assert.ok(d, `the model defines ${name}`);
    assert.equal(args.length, d.parameters.length, name);
    return run(parse(tokens(d.body)), Object.fromEntries(d.parameters.map((p, i) => [p, args[i]])));
  };
  const leaf = (x) => (typeof x === 'string' ? (/^\d+$/.test(x) ? { n: Number(x) } : { v: x }) : x);
  function run(node, env) {
    if ('n' in node) return node.n;
    if ('v' in node) {
      assert.ok(node.v in env, `unbound ${node.v}`);
      return env[node.v];
    }
    const it = node.items;
    const ev = (x) => run(leaf(x), env);
    if (it[0] === 'project') return ev(it[1])[it[2]];
    if (it[0] === 'not') return !ev(it[1]);
    if (it[0] === 'if') {
      assert.deepEqual([it[2], it[4]], ['then', 'else']);
      return ev(it[1]) ? ev(it[3]) : ev(it[5]);
    }
    if (it.length === 3 && typeof it[1] === 'string' && ['=?', '<=?', '<?', '&&', '||', '+'].includes(it[1])) {
      const [a, op, b] = [ev(it[0]), it[1], ev(it[2])];
      return op === '=?' ? a === b : op === '<=?' ? a <= b : op === '<?' ? a < b : op === '&&' ? a && b : op === '||' ? a || b : a + b;
    }
    assert.equal(typeof it[0], 'string');
    return call(it[0], it.slice(1).map(ev));
  }
  return call;
}

const model = evaluator(definitions(MODEL));
const proofs = evaluator(new Map([...definitions(MODEL), ...definitions(PROOFS)]));
const FIELDS = ['schema', 'holoNamed', 'holoPinned', 'holoVerified', 'holoVectorsFailed', 'fields', 'fieldsStated', 'boundsAgree', 'words', 'hasProof', 'proofStatement', 'recordStatement'];
// A small generator with a fixed seed, so a failure names the same record every run. Each record starts as one
// the model admits and then has none, one or two of its facts changed, so every rule is broken on its own.
function* records(count) {
  let seed = 0x2f6e2b1;
  const next = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) % n;
  };
  const values = { words: [0, 4, 1000, 1016, 1020, 1023, 1024, 1025], fields: [0, 1, 2, 4, 8], fieldsStated: [0, 1, 2, 4, 8] };
  for (let i = 0; i < count; i++) {
    const fields = values.fields[next(5)];
    const statement = next(3);
    const holo = next(3);
    const r = { schema: 1, holoNamed: holo, holoPinned: holo, holoVerified: 1, holoVectorsFailed: 0, fields, fieldsStated: fields, boundsAgree: 1, words: [0, 4, 1000][next(3)], hasProof: next(2), proofStatement: statement, recordStatement: statement };
    for (let changes = next(3); changes > 0; changes--) {
      const field = FIELDS[next(FIELDS.length)];
      r[field] = values[field] ? values[field][next(values[field].length)] : next(3);
    }
    yield r;
  }
}

test('the model states the record and every rule the JavaScript follows', () => {
  const defs = definitions(MODEL);
  assert.deepEqual([...defs.keys()], ['schemaOne', 'wordsMaximum', 'holoAdmitted', 'numbersAdmitted', 'proofAdmitted', 'admits', 'kernelChecked', 'leastAt', 'greatestAt', 'rulesAt', 'answerOutcome', 'answerInvalid', 'answerFault', 'answerKind', 'reuseAdmits']);
  for (const field of FIELDS) assert.ok(MODEL.includes(`{name: ${field}, type: Nat}`), field);
  assert.equal(model('wordsMaximum', []), 1024);
  assert.deepEqual([model('answerOutcome', []), model('answerInvalid', []), model('answerFault', [])], [ANSWER.outcome, ANSWER.invalid, ANSWER.fault]);
});

test('admission and the kernel-checked word are the model\'s, on 20,000 records', () => {
  let admitted = 0;
  let checked = 0;
  for (const r of records(20000)) {
    assert.equal(admits(r), model('admits', [r]), JSON.stringify(r));
    assert.equal(kernelChecked(r), model('kernelChecked', [r]), JSON.stringify(r));
    admitted += admits(r) ? 1 : 0;
    checked += kernelChecked(r) ? 1 : 0;
  }
  // Both sides of each rule were reached, so agreement is not vacuous.
  assert.ok(admitted > 4000 && admitted < 16000, String(admitted));
  assert.ok(checked > 2000 && checked < admitted, String(checked));
});

test('the layout of the numbers and the kind of every answer are the model\'s', () => {
  for (let f = 0; f <= 64; f++) {
    assert.equal(leastAt(f), model('leastAt', [f]));
    assert.equal(greatestAt(f), model('greatestAt', [f]));
    assert.equal(rulesAt(f), model('rulesAt', [f]));
  }
  for (const w of [0, 1, 2]) for (const b of [0, 1, 2]) for (const j of [0, 1, 2]) assert.equal(answerKind(w, b, j), model('answerKind', [w, b, j]), `${w}${b}${j}`);
});

const STORED = ['present', 'storedKey', 'computedKey', 'storedKernel', 'kernelPinned', 'storedLibrary', 'libraryPinned', 'storedBytes', 'derivedBytes'];
// Stored proofs that may be reused, each with none, one or two facts changed, so every clause of the rule is broken alone.
function* stored(count) {
  let seed = 0x51ed27;
  const next = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) % n;
  };
  for (let i = 0; i < count; i++) {
    const [key, kernel, library, bytes] = [next(3), next(3), next(3), next(3)];
    const s = { present: 1, storedKey: key, computedKey: key, storedKernel: kernel, kernelPinned: kernel, storedLibrary: library, libraryPinned: library, storedBytes: bytes, derivedBytes: bytes };
    for (let changes = next(3); changes > 0; changes--) s[STORED[next(STORED.length)]] = next(3);
    yield s;
  }
}

test('reuse of a stored proof is the model\'s, on 20,000 stored proofs', () => {
  let reused = 0;
  for (const s of stored(20000)) {
    assert.equal(reuseAdmits(s), model('reuseAdmits', [s]), JSON.stringify(s));
    assert.equal(proofs('breaksReuse', [s]), false);
    assert.equal(proofs('breaksNothingStored', [s]), false);
    reused += reuseAdmits(s) ? 1 : 0;
  }
  assert.ok(reused > 4000 && reused < 16000, String(reused));
  for (const field of STORED) assert.ok(MODEL.includes(`{name: ${field}, type: Nat}`), field);
});

test('every theorem says its counterexample is impossible, and none is found among the records', () => {
  const theorems = [...PROOFS.matchAll(/theorem\{\s*name: (\w+),\s*parameters: \[([^\]]*)\],\s*statement: \(\((\w+) [^)]*\) = false\),\s*proof: linear_arithmetic\{/g)];
  assert.equal(theorems.length, 12);
  assert.equal((PROOFS.match(/theorem\{/g) || []).length, 12, 'every theorem has that one form');
  assert.ok(!/sorry|native_decide|axiom\{/.test(MODEL + PROOFS));
  const about = theorems.filter((t) => t[2].includes('RuleApp::Record')).map((t) => t[3]);
  assert.equal(about.length, 6);
  for (const r of records(5000)) for (const breaks of about) assert.equal(proofs(breaks, [r]), false, `${breaks} ${JSON.stringify(r)}`);
  for (let f = 0; f < 20; f++) for (let g = 0; g < 20; g++) {
    assert.equal(proofs('breaksLayout', [f, g]), false);
    assert.equal(proofs('breaksLayoutOrder', [f, g]), false);
  }
  for (const w of [0, 1, 2]) for (const b of [0, 1, 2]) for (const j of [0, 1, 2]) {
    assert.equal(proofs('breaksReading', [w, b, j]), false);
    assert.equal(proofs('breaksFault', [w, b, j]), false);
  }
});

test('the record of Lean\'s verdict names these exact files and every theorem', () => {
  const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
  assert.equal(VERIFIED.schema, 'prism/model-verification/1');
  assert.equal(VERIFIED.sources['src/RuleApp.lex.tex'], sha(MODEL));
  assert.equal(VERIFIED.sources['src/RuleAppProofs.lex.tex'], sha(PROOFS));
  const named = [...PROOFS.matchAll(/theorem\{\s*name: (\w+),/g)].map((m) => m[1]);
  assert.deepEqual(VERIFIED.theorems.map((t) => t.name), named);
  for (const t of VERIFIED.theorems) {
    assert.ok(t.axioms.every((a) => ['propext', 'Quot.sound', 'Classical.choice'].includes(a)), t.name);
    assert.ok(PROOFS.includes(`axioms: [${t.axioms.join(', ')}]`), t.name);
  }
  assert.match(VERIFIED.image, /^ghcr\.io\/uor-foundation\/prismpm-sdk-candidate@sha256:[0-9a-f]{64}$/);
});

