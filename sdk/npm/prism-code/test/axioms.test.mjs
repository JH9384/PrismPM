// prism-code axioms: the declarations of a project, the probe Lean runs, the report it prints, and the
// rewrite of the source. Pure functions on the template and on fixture blocks; the command line is
// exercised with PRISM_CODE_DRY_RUN, so no test needs Docker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateFiles } from '../src/init.mjs';
import { WORK_DIR, collect, compare, declaredAxioms, declarations, formatRows, mismatches, parseReport, probeCommand, readAudit, rewrite, unaudited, withAxioms, writeWork } from '../src/axioms.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const template = fileURLToPath(new URL('../templates/text-request', import.meta.url));
const IMAGE = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:36da25ef924d84899453f24ec0c117a7a220e708037933eb8b499caa7723d99e';
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-axioms-'));
/** The template as init writes it: LF line endings whatever the checkout did, because LexLean refuses CRLF. */
function copyTemplate(root) {
  for (const [path, bytes] of templateFiles()) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
}

const RECURSIVE = `definition{
  name: rowFrom,
  parameters: [i : Nat, fuel : Nat],
  result: Nat,
  body: (match fuel
    | Nat.zero => 0
    | Nat.succ rest => (if (i <? 8) then 0 else (1 + (rowFrom (prim subtract i 8 : Nat) rest)))),
  recursive_argument: fuel
}`;
const THEOREM = `theorem{
  name: accepted,
  parameters: [s : Bytes],
  statement: (((accept s) = true) <-> ((rules s) = true)),
  proof: simplify{definitions: [Bool.and_eq_true, accept]},
  axioms: [propext]
}`;

test('the template\'s declarations: two policed ones, with the axioms the source declares', () => {
  const project = collect(template, '.');
  assert.equal(project.prefix, 'PrismTextRequest');
  const main = project.modules.find((m) => m.name === 'TextRequest');
  assert.equal(main.lean, 'PrismTextRequest.TextRequest');
  assert.deepEqual(main.declarations.map((d) => d.name), ['application', 'dispatch']);
  assert.deepEqual(declaredAxioms(main.declarations[1].block), ['Classical.choice', 'Quot.sound', 'propext']);
  assert.deepEqual(declaredAxioms(main.declarations[0].block), []);
  const bytes = project.modules.find((m) => m.name === 'Foundation.Bytes');
  assert.equal(bytes.lean, 'PrismTextRequest.Foundation.Bytes');
  assert.ok(bytes.declarations.some((d) => d.name === 'byteLength'));
});

test('the report Lean prints is read back, and an error in it is refused', () => {
  const observed = parseReport(`'PrismTextRequest.TextRequest.application' does not depend on any axioms\n'PrismTextRequest.TextRequest.dispatch' depends on axioms: [propext, Quot.sound, Classical.choice]\n`);
  assert.deepEqual(observed.get('PrismTextRequest.TextRequest.application'), []);
  assert.deepEqual(observed.get('PrismTextRequest.TextRequest.dispatch'), ['Classical.choice', 'Quot.sound', 'propext']);
  assert.throws(() => parseReport("Axioms.lean:1:0: error: unknown module prefix 'PrismTextRequest'"), (e) => e.code === 'axioms.probe' && /unknown module prefix/.test(e.message));
  const project = collect(template, '.');
  const rows = compare(project, parseReport(`'PrismTextRequest.TextRequest.application' does not depend on any axioms\n'PrismTextRequest.TextRequest.dispatch' depends on axioms: [propext, Quot.sound]\n${project.modules.flatMap((m) => m.declarations.filter((d) => m.name !== 'TextRequest').map((d) => `'${m.lean}.${d.name}' does not depend on any axioms`)).join('\n')}\n`));
  const dispatch = rows.find((r) => r.name === 'dispatch');
  assert.equal(dispatch.ok, false);
  assert.deepEqual(dispatch.observed, ['Quot.sound', 'propext']);
  assert.match(formatRows(rows), /FIX dispatch .*declared Classical\.choice, Quot\.sound, propext, observed Quot\.sound, propext/);
  assert.match(formatRows(rows), /\d+ of \d+ declarations need their axioms member set; run with --write/);
  assert.ok(compare(project, new Map()).every((r) => r.ok === null), 'an empty report audits nothing, and judges nothing');
});

test('a module the verify stopped before auditing is reported as not audited, not as an error', () => {
  const project = collect(template, '.');
  // A verify that failed on a policy in TextRequest after auditing it, before the Foundation modules.
  const observed = parseReport("'PrismTextRequest.TextRequest.application' does not depend on any axioms\n'PrismTextRequest.TextRequest.dispatch' depends on axioms: [propext]\n");
  const rows = compare(project, observed);
  const dispatch = rows.find((r) => r.name === 'dispatch');
  assert.equal(dispatch.ok, false);
  const pending = unaudited(rows);
  assert.ok(pending.length > 0 && pending.every((r) => r.observed === null && !r.module.endsWith('TextRequest.lex.tex')));
  assert.deepEqual(mismatches(rows).map((r) => r.name), ['dispatch'], 'a row not audited is no mismatch');
  const text = formatRows(rows);
  assert.match(text, /\?\? {2}byteLength +not audited: the verify stopped on another policy first/);
  assert.match(text, /1 of \d+ declarations need their axioms member set; run with --write\n\d+ of \d+ declarations were not audited; --write fixes the rest and audits again until every one is settled\n$/);
  // --write rewrites the mismatch and leaves every declaration it was not told about byte for byte.
  const root = scratch();
  copyTemplate(root);
  const copied = collect(root, '.');
  const changed = rewrite(root, copied, compare(copied, observed));
  assert.deepEqual([...changed.keys()].map((p) => p.slice(root.length + 1).replace(/\\/g, '/')), ['src/TextRequest.lex.tex']);
  // An audited module that is silent about one of its declarations is still an error: the name is wrong.
  assert.throws(() => compare(project, parseReport("'PrismTextRequest.TextRequest.application' does not depend on any axioms\n")), (e) => e.code === 'axioms.probe' && /dispatch/.test(e.message));
});

test('the audit records LexLean stages are read back in name order, and a failed audit is refused', () => {
  const root = scratch();
  copyTemplate(root);
  const work = writeWork(root, collect(root, '.'));
  assert.throws(() => readAudit(work), (e) => e.code === 'axioms.probe' && /no audit records/.test(e.message));
  mkdirSync(join(work, 'audit'));
  // The shape of a real record (lexlean 0.3.0): argv, exit_code, module, stderr, stdout.
  const record = (module, stdout, exit_code = 0, stderr = '\n') => JSON.stringify({ argv: ['env', 'lean', `$STAGING/audit/LexLeanAudit.Aab.${module}.lean`], exit_code, module: `LexLeanAudit.Aab.${module}`, stderr, stdout });
  writeFileSync(join(work, 'audit', 'LexLeanAudit.Aab.PrismTextRequest.TextRequest.process.json'), record('PrismTextRequest.TextRequest', "'PrismTextRequest.TextRequest.application' does not depend on any axioms\n'PrismTextRequest.TextRequest.dispatch' depends on axioms: [propext, Quot.sound]\n"));
  writeFileSync(join(work, 'audit', 'LexLeanAudit.Aab.LexLeanRuntime.Portable.process.json'), record('LexLeanRuntime.Portable', "'LexLeanRuntime.Decimal' does not depend on any axioms\n"));
  const observed = parseReport(readAudit(work));
  assert.deepEqual(observed.get('PrismTextRequest.TextRequest.dispatch'), ['Quot.sound', 'propext']);
  assert.deepEqual(observed.get('LexLeanRuntime.Decimal'), [], 'records the project does not own are read and then ignored by compare');
  writeFileSync(join(work, 'audit', 'LexLeanAudit.Aab.PrismTextRequest.Foundation.Bytes.process.json'), record('PrismTextRequest.Foundation.Bytes', '', 1, 'unknown constant'));
  assert.throws(() => readAudit(work), (e) => e.code === 'axioms.probe' && /exited 1: unknown constant/.test(e.message));
});

test('an axioms member is set in its canonical place: after the body or proof, before recursive_argument, or last', () => {
  const withRecursion = withAxioms(RECURSIVE, ['propext', 'Quot.sound']);
  assert.match(withRecursion, /rest\)\)\)\),\n {2}axioms: \[Quot\.sound, propext\],\n {2}recursive_argument: fuel\n\}$/);
  assert.equal(withAxioms(withRecursion, []), RECURSIVE, 'none removes the member');
  assert.equal(withAxioms(withRecursion, ['Quot.sound', 'propext']), withRecursion, 'the same set is a fixed point');
  const theorem = withAxioms(THEOREM, ['propext', 'Quot.sound']);
  assert.match(theorem, /accept\]\},\n {2}axioms: \[Quot\.sound, propext\]\n\}$/);
  assert.equal(withAxioms(THEOREM, []), THEOREM.replace(',\n  axioms: [propext]', ''));
  const plain = `definition{\n  name: sq,\n  parameters: [r : Nat],\n  result: Nat,\n  body: (r + 1)\n}`;
  assert.equal(withAxioms(plain, ['propext']), `definition{\n  name: sq,\n  parameters: [r : Nat],\n  result: Nat,\n  body: (r + 1),\n  axioms: [propext]\n}`);
  assert.equal(declarations(`${RECURSIVE}\n\n${THEOREM}\n`).map((d) => `${d.kind} ${d.name}`).join(', '), 'definition rowFrom, theorem accepted');
});

test('a one-line declaration, as lexlean fmt writes a short one, is found, read and rewritten', () => {
  const text = `definition{name: isWhite, parameters: [p : Nat], result: Bool, body: ((65 <=? p) && (p <=? 90))}\n\ndefinition{name: label, parameters: [], result: String, body: "a } brace", axioms: [propext]}\n\n${RECURSIVE}\n`;
  const found = declarations(text);
  assert.deepEqual(found.map((d) => d.name), ['isWhite', 'label', 'rowFrom']);
  assert.equal(found[1].block, 'definition{name: label, parameters: [], result: String, body: "a } brace", axioms: [propext]}', 'a brace inside a string does not end the block');
  assert.deepEqual(declaredAxioms(found[0].block), []);
  assert.deepEqual(declaredAxioms(found[1].block), ['propext']);
  assert.equal(withAxioms(found[0].block, ['propext']), 'definition{name: isWhite, parameters: [p : Nat], result: Bool, body: ((65 <=? p) && (p <=? 90)), axioms: [propext]}');
  assert.equal(withAxioms(found[1].block, []), 'definition{name: label, parameters: [], result: String, body: "a } brace"}');
  assert.equal(withAxioms(found[1].block, ['Quot.sound', 'propext']), 'definition{name: label, parameters: [], result: String, body: "a } brace", axioms: [Quot.sound, propext]}');
});

test('rewrite changes only the mismatching declarations of a copied template, and leaves the rest byte for byte', () => {
  const root = scratch();
  copyTemplate(root);
  const project = collect(root, '.');
  const observed = new Map();
  for (const m of project.modules) for (const d of m.declarations) observed.set(`${m.lean}.${d.name}`, d.name === 'dispatch' ? ['Quot.sound', 'propext'] : d.name === 'byteLength' ? ['propext'] : declaredAxioms(d.block));
  const rows = compare(project, observed);
  const changed = rewrite(root, project, rows);
  assert.deepEqual([...changed.keys()].map((p) => p.slice(root.length + 1).replace(/\\/g, '/')).sort(), ['src/Foundation/Bytes.lex.tex', 'src/TextRequest.lex.tex']);
  const main = changed.get(join(root, 'src', 'TextRequest.lex.tex'));
  assert.ok(main.includes('  axioms: [Quot.sound, propext]\n}'));
  assert.ok(!main.includes('Classical.choice'));
  const before = readFileSync(join(template, 'src', 'TextRequest.lex.tex'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(main.replace('  axioms: [Quot.sound, propext]', '  axioms: [Classical.choice, Quot.sound, propext]'), before.replace(/\r\n/g, '\n'), 'nothing else moved');
  const bytes = changed.get(join(root, 'src', 'Foundation', 'Bytes.lex.tex'));
  assert.match(bytes, /name: byteLength,\n[\s\S]*?body: \(prim length value : Nat\),\n {2}axioms: \[propext\]\n\}/);
});

test('prism-code axioms writes the probe under .lexlean/axioms and runs it in the image (dry run)', () => {
  const root = scratch();
  copyTemplate(root);
  writeFileSync(join(root, 'prismpm.lock'), JSON.stringify({ sdk_image: IMAGE }));
  const env = { ...process.env, PRISM_CODE_DRY_RUN: '1', PRISM_HOME: join(scratch(), '.prism') };
  const r = spawnSync(process.execPath, [bin, 'axioms'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const workdir = process.platform === 'win32' ? '/work' : realpathSync(root);
  assert.ok(r.stdout.includes(`${IMAGE} sh -c "sh \\"${workdir}/.lexlean/axioms/axioms.sh\\" \\"${workdir}\\" \\"${workdir}/.lexlean/axioms\\""`), r.stdout);
  assert.ok(existsSync(join(root, WORK_DIR, 'axioms.sh')));
  assert.deepEqual(readFileSync(join(root, WORK_DIR, 'modules.txt'), 'utf8').split('\n').filter(Boolean), [
    'PrismTextRequest.Foundation.Bytes',
    'PrismTextRequest.Foundation.Utf8',
    'PrismTextRequest.Foundation.View.Text.V1.Model',
    'PrismTextRequest.TextRequest',
  ]);
  assert.ok(!readFileSync(join(root, WORK_DIR, 'axioms.sh'), 'utf8').includes('\r'), 'the script reaches sh with LF endings');
  assert.deepEqual(probeCommand('C:\\app', 'app', 'win32'), ['-c', 'sh "/work/.lexlean/axioms/axioms.sh" "/work/app" "/work/.lexlean/axioms"']);
  assert.equal(spawnSync(process.execPath, [bin, 'axioms', 'extra'], { cwd: root, env, encoding: 'utf8' }).status, 64);
  assert.equal(spawnSync(process.execPath, [bin, 'axioms'], { cwd: scratch(), env, encoding: 'utf8' }).status, 64, 'no lockfile is usage');
});
