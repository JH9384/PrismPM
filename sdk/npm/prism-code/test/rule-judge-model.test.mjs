// The lemma a guarantee's proof applies (`PrismLive.Kernel.ruleJudge_sound`) is LexLean source here
// (model/rule-judge), not a Lean file: two native core modules that rule-judge-model.yml has Lean verify.
// This suite holds the proof writer (kernel-terms.mjs) to that source, so the writer cannot name a
// constant the source does not declare, or ask for axioms the lemma does not pin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { KERNEL_AXIOMS } from '../src/journey/kernel-terms.mjs';

const at = (file) => new URL(`../model/rule-judge/${file}`, import.meta.url);
const read = (file) => readFileSync(at(file), 'utf8');
const VERIFIED = JSON.parse(read('verification.json'));
const SOURCES = ['src/Kernel.lex.tex', 'src/Regions.lex.tex'];

/** Every declaration of a native core module, by name, with its kind and pinned axioms. */
function declarations(text) {
  const out = new Map();
  for (const m of text.matchAll(/^(abbrev|definition|theorem|inductive|constructor|recursor) (\S+?)(?:\.\{[^}]*\})? : [^\n]*\{\n([\s\S]*?)\n\}$/gm)) {
    const policy = /policy: exact\{axioms: \[([^\]]*)\]\}/.exec(m[3]);
    out.set(m[2], { kind: m[1], axioms: policy ? policy[1].split(',').map((a) => a.trim()).filter(Boolean) : null });
  }
  return out;
}

const DECLARED = new Map(SOURCES.flatMap((file) => [...declarations(read(file))]));

/** The constants the proof writer names in the lemma's namespace, read from its own source. */
const WRITER = readFileSync(new URL('../src/journey/kernel-terms.mjs', import.meta.url), 'utf8');
const NAMESPACE = /export const NAMESPACE = '([^']+)'/.exec(WRITER)[1];
const NAMED = [...new Set([...WRITER.matchAll(/\$\{NAMESPACE\}([A-Za-z_][\w.]*)/g)].map((m) => NAMESPACE + m[1]))];

test('the lemma is LexLean source: native core modules and no Lean file', () => {
  const files = readdirSync(at('src'));
  assert.deepEqual(files.sort(), ['Kernel.lex.tex', 'Regions.lex.tex']);
  for (const file of SOURCES) assert.match(read(file), /\\begin\{coremodule\}\nimports \[/, file);
});

test('every constant the proof writer names is declared by the source', () => {
  assert.ok(NAMED.length >= 6, `the writer names ${NAMED.join(', ')}`);
  for (const name of NAMED) assert.ok(DECLARED.has(name), `${name} is declared in model/rule-judge`);
  assert.equal(DECLARED.get(`${NAMESPACE}ruleJudge_sound`).kind, 'theorem');
  assert.equal(DECLARED.get(`${NAMESPACE}wordsCheck`).kind, 'definition');
});

test('the lemma pins exactly the axioms a kernel verdict accepts', () => {
  assert.deepEqual(DECLARED.get(`${NAMESPACE}ruleJudge_sound`).axioms, [...KERNEL_AXIOMS]);
  assert.deepEqual(VERIFIED.roots.find((r) => r.name === `${NAMESPACE}ruleJudge_sound`).axioms, [...KERNEL_AXIOMS]);
});

test('the source is the one Lean verified', () => {
  for (const [file, want] of Object.entries(VERIFIED.sources)) {
    assert.equal(`sha256:${createHash('sha256').update(readFileSync(at(file))).digest('hex')}`, want, file);
  }
  for (const file of SOURCES) assert.ok(file in VERIFIED.sources, `${file} is recorded`);
  for (const root of VERIFIED.roots) {
    assert.deepEqual(DECLARED.get(root.name)?.axioms, root.axioms, `${root.name} is declared with its recorded axioms`);
  }
});
