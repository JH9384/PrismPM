import assert from 'node:assert/strict';
import {linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {recoveryCorpus} from './corpus.mjs';
import {sourceClosure, frozenInputs, assertCapturedRecoverySources, assertCompilerOwner,
  captureCompilerTool, verifyCompilerTool, verifyCapturedInputBytes,
  captureExtractedCompilerArchive, verifyPrivateCompilerTree, sha} from './compile.mjs';
import {componentMutations, mutateComponentSource} from './mutations.mjs';
import {metadataCorpus} from '../browser-session-journal/metadata-corpus.mjs';
import {verifyNativeInventory} from './checks.mjs';
import {metadataTraversalCorpus} from './traversal-corpus.mjs';

test('recovery owns new source roots without replacing Session late-completion admission', () => {
  const source = readFileSync(new URL('../../stdlib/src/Foundation/Browser/Application/V1/SessionJournalRecovery.lex.tex', import.meta.url), 'utf8');
  const declarations = JSON.parse(/\\semanticdata\{(.*)\}/.exec(source)[1]).declarations;
  for (const name of ['sourceRecoveryContextBytes', 'sourceRecoveryWireBytes', 'recoverQuiescentSourceSession'])
    assert.ok(declarations.some(row => row.name === name), 'actual source root ' + name);
  assert.ok(!declarations.some(row => row.name === 'settleSourceCommand'), 'no replacement late completion reducer');
});

test('every closed source mutation changes one expected source and has an independent behavioral probe', () => {
  const vectors = {...recoveryCorpus(), metadata: [...metadataCorpus(), ...metadataTraversalCorpus()]};
  assert.equal(componentMutations.length, 24);
  assert.equal(new Set(componentMutations.map(row => row.id)).size, 24);
  for (const mutation of componentMutations) {
    const source = sourceClosure(), before = new Map(source);
    mutateComponentSource(source, mutation.id);
    assert.deepEqual([...source.keys()].filter(name => !source.get(name).equals(before.get(name))), [mutation.module]);
    assert.equal(vectors[mutation.entry].filter(row => row.id === mutation.probe).length, 1);
  }
  assert.throws(() => mutateComponentSource(sourceClosure(), 'unknown'));
});

test('complete transitive source and runner snapshots reject buffer substitution or omitted vectors', () => {
  const inputs = frozenInputs(), source = sourceClosure(); assertCapturedRecoverySources(inputs, source);
  assert.ok(inputs['tests/browser-effects/corpus.mjs'], 'actual transitive Session fixture input');
  assert.ok(inputs['tests/browser-session-journal/metadata-maxima.mjs']);
  assert.ok(inputs['tests/browser-session-journal-recovery/mutations.mjs']);
  assert.ok(inputs['tests/browser-view/generated-wasm.mjs'], 'actual artifact guard belongs to frozen closure');
  source.set('Fixture', Buffer.concat([source.get('Fixture'), Buffer.from('\n')]));
  assert.throws(() => assertCapturedRecoverySources(inputs, source), /actual captured source/);
  const rows = [{id: 'a-b'}, {id: 'b-c'}], complete = 'PASS a-b\nPASS b-c\nPASS 2 journal recovery vectors twice\n';
  verifyNativeInventory(complete, rows);
  for (const output of ['', 'PASS 2 journal recovery vectors twice\n', complete.replace('PASS a-b\n', ''), complete + 'PASS extra\n'])
    assert.throws(() => verifyNativeInventory(output, rows));
});

test('independent recovery vectors preserve unresolved refusal and exact context coverage', () => {
  const corpus = recoveryCorpus();
  assert.equal(corpus.unchangedLateCompletion.length, 2);
  for (const name of ['Prepared', 'Unknown', 'ClosedPending', 'ClosedUnknown']) {
    assert.ok(corpus.recovery.some(row => row.id === name + 'CannotRecoverWithoutTerminal'));
    assert.ok(corpus.context.some(row => row.id === name + 'Context'));
  }
  for (const name of ['Principal', 'Scope', 'EpochRollback', 'SameExecution', 'InvalidPredecessor'])
    assert.ok(corpus.recovery.some(row => row.id === name));
});

test('compiler reuse rejects caller-created authority before any invocation', () => {
  let invoked = false;
  for (const owner of [null, {}, Object.freeze({admit() {invoked = true;},
    execute() {invoked = true;}, work: '/tmp/forged-owner', inputs: {}})])
    assert.throws(() => assertCompilerOwner(owner, {}), /actual privately built compiler owner/);
  assert.equal(invoked, false);
});

test('substituted actual tool or launcher refuses before a version command can execute it', t => {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-tool-identity-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  const path = join(work, 'tool'), marker = join(work, 'executed'), alias = join(work, 'launcher');
  const original = '#!/bin/sh\nexit 0\n';
  writeFileSync(path, original, {flag: 'wx', mode: 0o700}); symlinkSync('tool', alias);
  const captured = captureCompilerTool(path), launcher = captureCompilerTool(alias, true);
  const launch = record => {verifyCompilerTool(record); execFileSync(record.path, ['--version']);};
  launch(captured); launch(launcher);
  writeFileSync(path, '#!/bin/sh\nprintf executed > "' + marker + '"\n');
  for (const record of [captured, launcher])
    assert.throws(() => launch(record), /captured compiler tool bytes changed before execution/);
  assert.equal(lstatSync(marker, {throwIfNoEntry: false}), undefined);
  writeFileSync(path, original); verifyCompilerTool(captured);
  const replacement = join(work, 'replacement');
  writeFileSync(replacement, '#!/bin/sh\nprintf executed > "' + marker + '"\n', {flag: 'wx', mode: 0o700});
  unlinkSync(alias); symlinkSync('replacement', alias);
  assert.throws(() => launch(launcher), /captured compiler tool resolution changed/);
  assert.equal(lstatSync(marker, {throwIfNoEntry: false}), undefined);
});

test('byte-equivalent closure verification rejects planted imports, manifests and pinned artifacts', t => {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-frozen-closure-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  const originals = {'owner.mjs': 'import "node:assert/strict";\n',
    'MANIFEST.sha256': 'a'.repeat(64) + '  compiler.rs\n', 'compiler.rs': 'fn main() {}\n'};
  const inputs = Object.freeze(Object.fromEntries(Object.entries(originals).map(([path, bytes]) => {
    writeFileSync(join(work, path), bytes, {flag: 'wx'}); return [path, sha(bytes)];
  })));
  verifyCapturedInputBytes(inputs, work);
  for (const [path, added] of [['owner.mjs', 'import "./unregistered.mjs";\n'],
    ['MANIFEST.sha256', 'b'.repeat(64) + '  replacement.rs\n'], ['compiler.rs', '// substituted pinned source\n']]) {
    writeFileSync(join(work, path), originals[path] + added);
    assert.throws(() => verifyCapturedInputBytes(inputs, work), /immutable complete owner input/);
    writeFileSync(join(work, path), originals[path]); verifyCapturedInputBytes(inputs, work);
  }
  linkSync(join(work, 'compiler.rs'), join(work, 'linked.rs'));
  assert.throws(() => verifyCapturedInputBytes(inputs, work), /regular singly linked compiler input/);
  unlinkSync(join(work, 'linked.rs')); verifyCapturedInputBytes(inputs, work);
  unlinkSync(join(work, 'compiler.rs')); symlinkSync('owner.mjs', join(work, 'compiler.rs'));
  assert.throws(() => verifyCapturedInputBytes(inputs, work), /unaliased compiler input/);
  assert.throws(() => verifyCapturedInputBytes({}, work), /nonempty captured compiler closure/);

  const tree = join(work, 'archive-tree'), archive = join(work, 'source.tar');
  mkdirSync(join(tree, 'nested', 'empty'), {recursive: true, mode: 0o700});
  const file = join(tree, 'nested', 'source.txt');
  writeFileSync(file, 'pinned compiler source\n', {flag: 'wx', mode: 0o600});
  const pack = arguments_ => execFileSync('tar', ['-cf', archive, '-C', tree, ...arguments_]);
  pack(['nested']);
  const captured = captureExtractedCompilerArchive(archive, tree, work);
  assert.deepEqual(captured.directories, ['nested', 'nested/empty']);
  assert.deepEqual(captured.files, {'nested/source.txt': sha(readFileSync(file))});
  verifyPrivateCompilerTree(tree, captured.files, captured.directories);
  writeFileSync(join(tree, 'extra.txt'), 'unlisted', {flag: 'wx'});
  assert.throws(() => verifyPrivateCompilerTree(tree, captured.files, captured.directories), /complete privately staged/);
  unlinkSync(join(tree, 'extra.txt'));
  writeFileSync(file, 'changed source\n');
  assert.throws(() => captureExtractedCompilerArchive(archive, tree, work), /actual extracted pinned compiler source/);
  writeFileSync(file, 'pinned compiler source\n');
  for (const arguments_ of [['nested', 'nested'], ['.'],
    ['--transform=s|nested|../nested|', 'nested'], ['--transform=s|nested|/nested|', 'nested'],
    ['--transform=s|nested|nested//alias|', 'nested']]) {
    pack(arguments_);
    assert.throws(() => captureExtractedCompilerArchive(archive, tree, work), /unique typed|canonical compiler/);
  }
  const aliasPath = join(tree, 'nested', 'alias.txt');
  symlinkSync('source.txt', aliasPath); pack(['nested']);
  assert.throws(() => captureExtractedCompilerArchive(archive, tree, work), /unaliased extracted/);
  unlinkSync(aliasPath); linkSync(file, aliasPath); pack(['nested']);
  assert.throws(() => captureExtractedCompilerArchive(archive, tree, work), /regular singly linked/);
  unlinkSync(aliasPath); pack(['nested']);
  verifyPrivateCompilerTree(tree, captured.files, captured.directories);
  const special = join(tree, '__proto__'); writeFileSync(special, 'own source entry', {flag: 'wx'});
  pack(['nested', '__proto__']);
  const specialCapture = captureExtractedCompilerArchive(archive, tree, work);
  assert.equal(Object.hasOwn(specialCapture.files, '__proto__'), true);
  assert.equal(specialCapture.files.__proto__, sha(readFileSync(special)));
  verifyPrivateCompilerTree(tree, specialCapture.files, specialCapture.directories);
  assert.throws(() => verifyPrivateCompilerTree(tree, captured.files, captured.directories), /complete privately staged/);
  unlinkSync(special);
  const pinnedTree = join(work, 'pinned-tree'); mkdirSync(pinnedTree, {mode: 0o700});
  const pinnedArchive = new URL('../../vendor/lean4-prod/lean.tar', import.meta.url);
  execFileSync('tar', ['--no-same-owner', '--no-same-permissions', '-xf', pinnedArchive.pathname, '-C', pinnedTree]);
  const pinned = captureExtractedCompilerArchive(pinnedArchive.pathname, pinnedTree, work);
  assert.ok(pinned.directories.includes('Conformance') && pinned.files['Conformance.lean']);
  verifyPrivateCompilerTree(pinnedTree, pinned.files, pinned.directories);
});
