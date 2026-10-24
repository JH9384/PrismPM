import { readSemantic } from '../../scripts/semantic-source.mjs';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {prepare, repository, draft, run, sha} from './compile.mjs';
import {createCompilerOwner, requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../browser-view/compiler-owner-checks.mjs';
import {captureVerificationProducts} from '../browser-view/verification-products.mjs';
import {corpus, historyCorpus, maximumCorpus, partitionCorpus} from './corpus.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';
import {lexiconInputPaths} from '../browser-view/lexicon-inputs.mjs';
import {executeWasm, tsv} from '../browser-effects/checks.mjs';
import {verifyBrowser, verifyHostMutations} from './browser.mjs';

export function verifyInventory() {
  const semantic = file => readSemantic(readFileSync(join(repository, file), 'utf8'));
  const model = semantic('stdlib/src/Foundation/Browser/Application/V1/OperationJournal.lex.tex');
  const effects = semantic('stdlib/src/Foundation/Browser/Application/V1/Effects.lex.tex');
  const cbor = semantic('stdlib/src/Foundation/Codec/Cbor/V1/Primitive.lex.tex');
  const registry = JSON.parse(readFileSync(join(repository, 'model/browser-operation-journal-diagnostics.json')));
  const source = readFileSync(join(repository, 'sdk/browser/operation-journal.mjs'), 'utf8');
  assert.equal(registry.spec, 'prismpm/browser-operation-journal-diagnostics/1');
  assert.equal(registry.capability, 'DK-24'); assert.equal(registry.error_class, 'OperationJournalError');
  assert.deepEqual(registry.errors.toSorted(), [...new Set([...source.matchAll(/fail\('([a-z-]+)'/g)].map(row => row[1]))].sort());
  assert.deepEqual(registry.protocol_errors, model.declarations.find(row => row.name === 'JournalError').constructors.map(row => row.name));
  assert.deepEqual(registry.wire_errors, cbor.declarations.find(row => row.name === 'CborError').constructors.map(row => row.name));
  const journalTypes = new Set(model.declarations.filter(row => ['structure', 'inductive'].includes(row.kind)).map(row => row.name));
  const types = new Map([...model.declarations, ...effects.declarations].filter(row => ['structure', 'inductive'].includes(row.kind)).map(row => [row.name, row]));
  const scalar = bytes => ({bytes, nodes: 1, depth: 0});
  const array = values => ({bytes: (values.length < 24 ? 1 : 2) + values.reduce((n, x) => n + x.bytes, 0),
    nodes: 1 + values.reduce((n, x) => n + x.nodes, 0), depth: 1 + Math.max(0, ...values.map(x => x.depth))});
  const largest = values => Object.fromEntries(['bytes', 'nodes', 'depth'].map(key => [key, Math.max(...values.map(x => x[key]))]));
  function shape(type, field = '', owner = '', path = []) {
    if (type.kind === 'nat') return scalar(5);
    if (type.kind === 'bool') return scalar(1);
    if (type.kind === 'string') return scalar(515);
    if (type.kind === 'bytes') {
      const size = journalTypes.has(owner) ? field === 'signingKey' ? 65 : 32
        : ['application', 'manifest', 'session', 'artifact'].includes(field) ? 32
          : field === 'publicKey' ? 65 : field === 'signature' || owner === 'EffectResult.Signature' ? 64
            : owner === 'EffectResult.RandomBytes' ? 65536
              : owner === 'EffectGuestInvocation' || owner === 'EffectResult.GuestBytes' ? 2097152 : 1048576;
      return scalar((size < 24 ? 1 : size < 256 ? 2 : size < 65536 ? 3 : 5) + size);
    }
    if (type.kind === 'option') return array([scalar(1), shape(type.value, field, owner, path)]);
    if (type.kind === 'list') return array(Array.from({length: !journalTypes.has(owner) && type.element.kind === 'bytes' ? 16 : 64},
      () => shape(type.element, field, owner, path)));
    assert.equal(type.kind, 'named'); const name = type.member.name;
    assert.ok(!path.includes(name), 'acyclic journal and actual effect framing'); const declaration = types.get(name); assert.ok(declaration);
    if (declaration.kind === 'structure') return array(declaration.fields.map(row => shape(row.type, row.name, name, [...path, name])));
    return largest(declaration.constructors.map(row => array([scalar(1), ...row.fields.map(type => shape(type, '', name + '.' + row.name, [...path, name]))])));
  }
  const typed = name => shape({kind: 'named', member: {name}});
  const requests = [array([scalar(1), scalar(1), typed('JournalBinding'), scalar(34)]),
    array([scalar(1), scalar(1), typed('JournalState'), typed('JournalRecord'), scalar(34)]),
    array([scalar(1), scalar(1), typed('JournalRecord'), typed('EffectRequest'), typed('EffectManifest')]),
    array([scalar(1), scalar(1), typed('JournalRecord'), typed('EffectRequest'), typed('EffectResult'), typed('EffectManifest')])];
  const replies = ['JournalBinding', 'JournalRecord', 'JournalState', 'JournalPayload'].map(name => array([scalar(1), scalar(1), typed(name)]));
  for (const value of requests) { assert.ok(value.bytes <= 67108864); assert.ok(value.nodes <= 4096); assert.ok(value.depth <= 16); }
  for (const value of replies) { assert.ok(value.bytes <= 65536); assert.ok(value.nodes <= 4096); assert.ok(value.depth <= 16); }
  return {requests, replies};
}

export function sourceClosure() {
  const local = ['checks.mjs', 'compile.mjs', 'corpus.mjs', 'fallback-owner.test.mjs', 'runner.rs', 'browser.mjs', 'browser-fixture.mjs',
    'driver/Cargo.toml', 'driver/Cargo.lock', 'driver/src/main.rs', 'src/Fixture.lex.tex'];
  const shared = ['sdk/browser/operation-journal.mjs', 'sdk/browser/effects.mjs', 'sdk/browser/credential-custody.mjs',
    'sdk/browser/effects-wire.mjs', 'sdk/browser/effects-module.mjs', 'sdk/browser/identity.mjs', 'sdk/browser/store.mjs',
    'sdk/browser/operation-journal.test.mjs', 'sdk/browser/browser-test-server.mjs',
    'sdk/oracles/package.json', 'sdk/oracles/package-lock.json',
    'tests/browser-view/compile.mjs', 'tests/browser-view/driver-cache.mjs', 'tests/browser-view/prerequisites.mjs',
    'tests/browser-view/compiler-artifact.mjs', 'tests/browser-view/compiler-owner-checks.mjs', 'tests/browser-view/compiler-owner.mjs',
    'tests/browser-view/verification-products.mjs',
    'scripts/semantic-source.mjs', 'crates/conformance/src/bin/prismpm-semantic-source.rs',
    'tests/browser-effects/checks.mjs', 'tests/browser-effects/compile.mjs', 'tests/browser-effects/corpus.mjs',
    'tests/browser-custody/compile.mjs', 'tests/browser-custody/checks.mjs', 'tests/browser-custody/corpus.mjs',
    'tests/browser-custody/browser.mjs', 'tests/browser-custody/browser-fixture.mjs', 'LICENSE-MIT', 'LICENSE-APACHE',
    'tests/browser-workspace/src/main.rs', 'tests/browser-journal/driver/src/main.rs',
    'tests/fixtures/library/native-library/project/lexlean.toml',
    'model/dependencies.toml', 'model/authorities.toml', 'model/browser-operation-journal-diagnostics.json',
    'model/browser-custody-diagnostics.json', 'lean-toolchain', 'rust-toolchain.toml',
    'vendor/lean4-prod/lean.tar', 'vendor/lean4-prod/rust/MANIFEST.sha256', 'vendor/lexlean/MANIFEST.sha256',
    'tests/browser-view/lexicon-inputs.mjs', ...lexiconInputPaths(repository)];
  for (const family of ['browser-custody', 'browser-effects']) {
    for (const file of ['driver/Cargo.toml', 'driver/Cargo.lock', 'driver/src/main.rs', 'runner.rs', 'src/Fixture.lex.tex'])
      shared.push('tests/' + family + '/' + file);
  }
  for (const name of ['OperationJournal', 'OperationJournalWire', 'Custody', 'CustodyWire', 'Effects', 'EffectsWire'])
    shared.push('stdlib/src/Foundation/Browser/Application/V1/' + name + '.lex.tex');
  for (const name of ['Bytes', 'Codec', 'Codec/Cbor/V1/Primitive']) shared.push('stdlib/src/Foundation/' + name + '.lex.tex');
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    for (const line of readFileSync(join(repository, tree, 'MANIFEST.sha256'), 'utf8').trimEnd().split('\n')) {
      const row = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row);
      assert.ok(row[2].split('/').every(part => part && part !== '.' && part !== '..'));
      const path = tree + '/' + row[2];
      assert.equal(sha(readFileSync(join(repository, path))), row[1], 'pinned journal compiler source');
      shared.push(path);
    }
  }
  return Object.fromEntries([...local.map(file => ['tests/browser-operation-journal/' + file, join(draft, file)]), ...shared.map(file => [file, join(repository, file)])]
    .map(([name, file]) => [name, sha(readFileSync(file))]));
}

export async function verifyWire(t, compilerOwner = null) {
  const before = sourceClosure(), bounds = verifyInventory(), vectors = [...corpus(), ...historyCorpus()];
  if (compilerOwner) for (const [path, digest] of Object.entries(compilerOwner.evidence.inputs))
    assert.equal(before[path], digest, 'compiler tool closure differs from frozen journal inputs');
  assert.equal(corpus().length, 68); assert.equal(historyCorpus().length, 1024);
  const maximum = maximumCorpus(), partitions = partitionCorpus(); assert.equal(maximum.length, 4); assert.equal(partitions.length, 7);
  const build = prepare(null, false, compilerOwner), file = join(build.work, 'vectors.tsv'); writeFileSync(file, tsv(vectors), {flag: 'wx'});
  t.diagnostic(JSON.stringify({compilerOwner: build.compilerOwner, preparationMs: build.preparationMs}));
  const binaries = [...maximum, ...partitions].map(row => {
    const input = join(build.work, row.id + '.request'), output = join(build.work, row.id + '.response');
    writeFileSync(input, row.request, {flag: 'wx'}); writeFileSync(output, row.response, {flag: 'wx'});
    return {id: row.id, input, output};
  });
  for (const standard of [true, false]) await prerequisite(t, 'complete generated journal history, actual-request and payload bounds in ' + (standard ? 'std' : 'no_std'), () => {
    const executable = build.compileNative(standard), output = run(executable, [file], build.runner);
    assert.deepEqual([...output.matchAll(/^PASS ([A-Za-z0-9]+)$/gm)].map(row => row[1]), vectors.map(row => row.id));
    assert.match(output, /PASS 1092 complete journal vectors twice/);
    for (const row of binaries) assert.equal(run(executable, ['--binary', row.id, row.input, row.output], build.runner), 'PASS binary complete journal vector twice\n');
  });
  await prerequisite(t, 'complete fresh Core-Wasm journal, history, actual-request and exact64MiB partition bounds', () => {
    build.maximum = {journal: executeWasm(build.journalBytes, [...vectors, ...maximum]),
      partition: executeWasm(build.partitionBytes, partitions.filter(row => !row.nativeOnly))};
  });
  assert.deepEqual(sourceClosure(), before);
  const evidence = {source: build.verified.source_id, attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
    journal: sha(build.journalBytes), partition: sha(build.partitionBytes), effects: sha(build.wasmBytes), guest: sha(build.guestBytes),
    vectors: vectors.length, maximum: build.maximum, bounds, sources: before,
    maxima: [...maximum, ...partitions].map(row => ({id: row.id, length: row.request.length, request: sha(row.request), response: sha(row.response)}))};
  writeFileSync(join(build.work, 'operation-journal-wire-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  t.diagnostic(JSON.stringify(evidence)); return build;
}

export function verifyModelMutation(kind, compilerOwner = null) {
  const selected = {binding: 'TerminalMismatch3', trailing: 'WireTrailing', reservation: 'ReserveTerminalSlot',
    payload: 'PayloadMissing', partition: 'Partition1048576'}[kind];
  const vector = (kind === 'partition' ? partitionCorpus() : corpus()).find(row => row.id === selected); assert.ok(vector);
  const build = prepare(kind, false, compilerOwner); let passed = false;
  if (compilerOwner) assert.equal(build.compilerOwner, compilerOwner.identity);
  try {
    const file = join(build.work, 'mutation.tsv'); writeFileSync(file, tsv([vector]), {flag: 'wx'});
    for (const standard of [true, false]) assert.throws(() => run(build.compileNative(standard), [file], build.runner), /native output mismatch/, kind + ' native mutant');
    assert.throws(() => executeWasm(kind === 'partition' ? build.partitionBytes : build.journalBytes, [vector]),
      /generated Wasm output mismatch/, kind + ' actual Wasm mutant');
    build.verifyEvidence();
    passed = true;
    return {kind, compilerOwner: build.compilerOwner, preparationMs: build.preparationMs,
      cacheRetirement: build.cacheRetirement, source: build.verified.source_id,
      attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
      wasm: sha(kind === 'partition' ? build.partitionBytes : build.journalBytes),
      vector: vector.id, request: sha(vector.request), response: sha(vector.response)};
  } finally { if (passed) rmSync(build.work, {recursive: true, force: true}); }
}

export async function verifyOperationJournal(t) {
  const inputs = sourceClosure();
  let build, custody, passed = false;
  try {
    const owner = createCompilerOwner('operation-journal');
    let retirementAttempted = false;
    t.after(() => {
      if (!retirementAttempted) {retirementAttempted = true; owner.close();}
    });
    const substitutions = verifyCompilerOwnerSubstitutions(owner);
    await prerequisite(t, 'registered errors and complete closed structural byte budgets', () => verifyInventory());
    await prerequisite(t, 'genuine source, kernel and generated operation-journal closure', async child => {
      build = await verifyWire(child, owner); assert.equal(build.compilerOwner, owner.identity);
    });
    await prerequisite(t, 'genuine independent source-owned custody dependency', async child => {
      const {verifyWire} = await import('../browser-custody/checks.mjs'); custody = await verifyWire(child);
    });
    await prerequisite(t, 'actual durable browser journal and authenticated native transcript replay', child => verifyBrowser(child, build, custody));
    await verifyHostMutations(t, build, custody);
    for (const kind of ['binding', 'trailing', 'reservation', 'payload', 'partition']) await prerequisite(t, 'actual source/kernel journal mutation ' + kind, () => {
      const result = verifyModelMutation(kind, owner); assert.equal(result.compilerOwner, owner.identity); t.diagnostic(JSON.stringify(result));
    });
    const products = captureVerificationProducts(build.work, 'operation-journal');
    retirementAttempted = true;
    const retirement = owner.close();
    assert.deepEqual(captureVerificationProducts(build.work, 'operation-journal'), products,
      'complete generated products unchanged through compiler retirement');
    build.verifyEvidence();
    assert.deepEqual(sourceClosure(), inputs, 'complete journal inputs unchanged through compiler retirement');
    assert.throws(() => requireCompilerOwner(owner, 'operation-journal'), /compiler owner closed/);
    assert.throws(() => owner.close(), /compiler owner closed/);
    t.diagnostic(JSON.stringify({compiler: owner.evidence, substitutions, retirement}));
    const evidence = {wire: sha(readFileSync(join(build.work, 'operation-journal-wire-evidence.json'))),
      browser: sha(readFileSync(join(build.work, 'operation-journal-browser-evidence.json'))),
      custody: sha(readFileSync(join(custody.work, 'custody-wire-evidence.json'))), source: sourceClosure(),
      hostMutations: 12, modelMutations: 5, publicApplicationAccepted: false};
    writeFileSync(join(build.work, 'operation-journal-acceptance.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
    t.diagnostic('retained exact acceptance evidence ' + build.work + ' and custody ' + custody.work);
    passed = true;
  } finally {
    // Evidence is never an acceptance input. Keep this fresh owned directory
    // for review; bounded negative-build fixtures are removed after success.
    if (!passed) t.diagnostic('incomplete journal gate retained its diagnostic source/build evidence');
  }
}
