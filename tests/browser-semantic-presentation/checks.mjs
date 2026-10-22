import assert from 'node:assert/strict';
import {chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {prepare, run, sha, repository, frozenInputs} from './compile.mjs';
import {corpus, predicates, fixture, labels, designs} from './corpus.mjs';
import {maximumCorpus} from './maximum-fixtures.mjs';
import {encodeWire} from '../../sdk/browser/presentation-wire.mjs';
import {executeWasm} from '../browser-presentation/checks.mjs';
import {assertPaletteInventory, engines, journeyCallInventory, journeyNames} from './browser.mjs';
export {assertPaletteInventory, executeWasm};

const tsv = rows => rows.map(row => row.id + '\t' + Buffer.from(row.request).toString('hex')
  + '\t' + Buffer.from(row.response).toString('hex') + '\n').join('');
export const closure = frozenInputs;

export function captureBrowserEvidence(value) {
  const snapshot = structuredClone(value);
  const freeze = item => {
    if (item !== null && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(snapshot);
}

export function verifyNativeInventory(output, rows) {
  assert.equal(output, rows.map(row => 'PASS ' + row.id + '\n').join('')
    + 'PASS ' + rows.length + ' complete semantic vectors twice\n', 'complete exact semantic native inventory');
}

function archive(build, directory, name, extras) {
  build.unchanged();
  const path = join(directory, name + '.tar.gz');
  run('tar', ['-czf', path, '-C', build.work, 'project/src', 'project/lexlean.toml',
    'project/.lexlean/verified', 'export', 'generated', ...extras,
    ...['a', 'b', 'fixture', 'labels', 'designs', 'predicates'].flatMap(label => ['guest-' + label, 'guest-' + label + '.wasm']),
    ...Object.values(build.wasmEvidence()).map(record => record.original.path),
    'native-std-observer', 'native-no_std-observer'], build.work);
  build.unchanged(); return {file: name + '.tar.gz', sha256: sha(readFileSync(path))};
}

export function nativeReplay(build, rows, stem) {
  assert.match(stem, /^[a-z][a-z0-9-]*$/);
  const path = join(build.work, stem + '.tsv'); writeFileSync(path, tsv(rows), {flag: 'wx'});
  for (const standard of [true, false]) {
    verifyNativeInventory(build.runNative(standard, [path]), rows);
  }
}

function verifyArtifactSubstitutions(build) {
  const names = [], selected = {wasmBytes: 'a', fixtureBytes: 'fixture', labelsBytes: 'labels',
    designsBytes: 'designs', predicatesBytes: 'predicates'};
  for (const [key, role] of Object.entries(selected)) {
    const original = build[key], descriptor = Object.getOwnPropertyDescriptor(build, key);
    assert.equal(descriptor.value, original); assert.equal(descriptor.writable, false);
    assert.equal(descriptor.configurable, false); assert.equal(descriptor.get, undefined);
    const replacement = build.withWasm(role === 'fixture' ? 'a' : 'fixture', bytes => bytes);
    assert.notEqual(sha(replacement), sha(original), 'actual different generated selection');
    assert.throws(() => {build[key] = replacement;}, TypeError);
    names.push(key + ':replacement');
    assert.throws(() => Object.defineProperty(build, key, {get: () => replacement}), TypeError);
    names.push(key + ':redefinition');
    assert.equal(build[key], original); build.unchanged();
  }
  for (const [role, evidence] of Object.entries(build.wasmEvidence())) {
    for (const side of ['original', 'private']) {
      const path = join(build.work, evidence[side].path), original = readFileSync(path), changed = Buffer.from(original);
      changed[8] ^= 1; const mode = lstatSync(path).mode & 0o777; let called = false;
      try {
        chmodSync(path, 0o600); writeFileSync(path, changed);
        assert.throws(() => build.withWasm(role, () => {called = true;}), new RegExp('immutable ' + side + ' generated Wasm'));
        assert.equal(called, false, 'substituted generated artifact cannot reach consumption');
        assert.throws(() => build.unchanged(), new RegExp('immutable ' + side + ' generated Wasm'));
        names.push(role + ':' + side);
      } finally {writeFileSync(path, original); chmodSync(path, mode);}
      build.unchanged();
    }
    let buffer, original;
    try {
      assert.throws(() => build.withWasm(role, bytes => {buffer = bytes; original = bytes[8]; bytes[8] ^= 1;}),
        /immutable execution Wasm buffer/);
      assert.throws(() => build.unchanged(), /immutable execution Wasm buffer/);
      names.push(role + ':buffer');
    } finally {if (buffer) buffer[8] = original;}
    build.unchanged();
  }
  assert.equal(names.length, 28); return Object.freeze(names);
}

export function verifyWire(t) {
  const before = closure(), build = prepare(null, null, before);
  t.after(() => {
    if (build.complete) rmSync(build.work, {recursive: true, force: true});
    else process.stderr.write('Retained incomplete semantic component ' + build.work + '\n');
  });
  assert.ok(build.verified?.attestation_id && build.cacheRetirement?.owner === 'semantic-presentation');
  const generatedSource = join(build.work, 'generated/src/lib.rs'), generatedBytes = readFileSync(generatedSource);
  try {
    writeFileSync(generatedSource, Buffer.concat([generatedBytes, Buffer.from('\n// substituted before first native compile\n')]));
    for (const standard of [true, false]) {
      assert.throws(() => build.compileNative(standard), /generated package manifest digest/);
      assert.equal(lstatSync(join(build.work, 'native-' + (standard ? 'std' : 'no_std')), {throwIfNoEntry: false}), undefined,
        'changed source refuses before creating native target');
    }
    assert.throws(() => build.unchanged(), /generated package manifest digest/);
  } finally {writeFileSync(generatedSource, generatedBytes);}
  build.unchanged();
  build.artifactSubstitutions = verifyArtifactSubstitutions(build);
  // Diagnostic inventory only. Executed corpus, browser journeys and mutants
  // below establish behavior; matching source tokens never establishes it.
  const registry = JSON.parse(readFileSync(join(repository, 'model/browser-semantic-presentation-diagnostics.json')));
  assert.equal(registry.capability, 'DK-38'); assert.equal(registry.error_class, 'PresentationError');
  assert.deepEqual(registry.errors, [...new Set(registry.errors)].sort());
  const diagnosticSource = ['presentation-wire', 'presentation-dom', 'semantic-presentation-wire',
    'semantic-presentation-style'].map(name => readFileSync(join(repository, 'sdk/browser/' + name + '.mjs'), 'utf8')).join('\n');
  for (const code of registry.errors) assert.ok(diagnosticSource.includes("'" + code + "'"), code);
  for (const match of diagnosticSource.matchAll(/(?:fail|PresentationError)\('([a-z-]+)'\)/g)) assert.ok(registry.errors.includes(match[1]), match[1]);
  assert.deepEqual(registry.wire_errors, ['BadLimits', 'BadCursor', 'Truncated', 'WrongType',
    'UnsupportedHead', 'NonCanonical', 'ValueLimit', 'InvalidUtf8', 'TrailingInput', 'InvalidSemanticPresentation']);
  const samples = [
    {id: 'FixtureBaseline', request: encodeWire([1, 1, 0, 0]), response: encodeWire(fixture())},
    {id: 'LabelsBaseline', request: new Uint8Array(), response: new TextEncoder().encode(JSON.stringify(labels))},
    {id: 'DesignsBaseline', request: new Uint8Array(), response: encodeWire(designs)},
  ];
  const rows = corpus(), typed = predicates();
  assert.equal(rows.length, 150); assert.equal(typed.length, 93);
  nativeReplay(build, [...rows, ...typed, ...samples], 'all-vectors');
  for (const standard of [true, false]) {
    const path = build.compileNative(standard), original = readFileSync(path), changed = Buffer.from(original);
    changed[0] ^= 1;
    try {
      writeFileSync(path, changed);
      assert.throws(() => build.compileNative(standard), /immutable actual native binary/);
      assert.throws(() => build.unchanged(), /immutable actual native binary/);
    } finally { writeFileSync(path, original); }
    assert.equal(build.compileNative(standard), path);
  }
  build.maximum = build.withWasm('a', bytes => executeWasm(bytes, rows));
  build.withWasm('predicates', bytes => executeWasm(bytes, typed, 32));
  for (const [index, role] of ['fixture', 'labels', 'designs'].entries())
    build.withWasm(role, bytes => executeWasm(bytes, [samples[index]], 32));
  build.maxima = [];
  function* boundedCases() {
    yield* maximumCorpus();
    yield {id: 'EnvelopeOneOver', request: new Uint8Array(67108865),
      response: Uint8Array.of(0x83, 1, 1, 6)};
  }
  for (const row of boundedCases()) {
    const input = join(build.work, row.id + '.request'), output = join(build.work, row.id + '.response');
    writeFileSync(input, row.request, {flag: 'wx'}); writeFileSync(output, row.response, {flag: 'wx'});
    for (const standard of [true, false]) {
      assert.equal(build.runNative(standard, ['--binary', input, output]), 'PASS binary complete semantic vector twice\n');
    }
    if (row.id === 'EnvelopeOneOver') {
      build.withWasm('a', bytes => {
        const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
        assert.throws(() => instance.exports.holo_alloc(row.request.length), WebAssembly.RuntimeError);
      });
    } else {
      const maximum = build.withWasm('a', bytes => executeWasm(bytes, [row]));
      build.maxima.push({id: row.id, length: row.request.length,
        request: sha(row.request), response: sha(row.response), ...maximum});
    }
  }
  assert.equal(build.maxima.length, 8);
  const directory = join(repository, 'target/semantic-verification'); mkdirSync(directory, {recursive: true});
  build.evidenceDirectory = mkdtempSync(join(directory, 'run-'));
  build.positiveArchive = archive(build, build.evidenceDirectory, 'positive-artifacts', ['all-vectors.tsv']);
  build.mutationEvidence = [];
  build.browserEvidence = [];
  build.browserMutationEvidence = [];
  assert.deepEqual(closure(), before);
  t.diagnostic(JSON.stringify({scope: 'semantic-component-only', source: build.verified.source_id,
    attestation: build.verified.attestation_id, ir: build.generation.ir_sha256, wasm: sha(build.wasmBytes),
    corpus: rows.length, typed: typed.length, maxima: build.maxima,
    inputs: {files: Object.keys(before).length, sha256: sha(Buffer.from(JSON.stringify(before)))},
    generatedPackages: build.generatedPackages, wasmArtifacts: build.wasmEvidence(),
    artifactSubstitutions: build.artifactSubstitutions, native: build.nativeEvidence(),
    evidenceDirectory: build.evidenceDirectory, archive: build.positiveArchive}));
  return build;
}

export function replayBrowser(build, result) {
  assert.equal(result.modelChecked, true); assert.ok(result.calls.length > 0);
  assert.ok(engines.includes(result.engine), 'closed browser transcript engine');
  assert.equal(result.engine, engines[build.browserEvidence.length], 'each required engine is replayed exactly once in order');
  assertBrowserJourneyInventory(result.cases, result.calls.map(({case:caseName, role})=>({case:caseName, role})));
  assertPaletteInventory(result.palettes);
  const roles = {wire: 'Wire', fixture: 'Fixture', labels: 'Labels', designs: 'Designs'};
  const rows = result.calls.map((row, index) => ({id: (assert.ok(roles[row.role]), roles[row.role]) + index,
    request: Buffer.from(row.request, 'hex'), response: Buffer.from(row.response, 'hex')}));
  const observed = 'observed-browser-' + result.engine, counterexample = 'changed-browser-' + result.engine;
  nativeReplay(build, rows, observed);
  const changed = rows.map(row => ({...row, response: Buffer.from(row.response)}));
  changed[0].response[0] ^= 1;
  assert.throws(() => nativeReplay(build, changed, counterexample), /native output mismatch/);
  build.browserEvidence.push(captureBrowserEvidence({engine:result.engine, cases:result.cases,
    callInventory:result.calls.map(({case:caseName, role})=>({case:caseName, role})),
    palettes:result.palettes, calls:rows.length,
    observed:{file:observed + '.tsv', sha256:sha(readFileSync(join(build.work, observed + '.tsv')))},
    counterexample:{file:counterexample + '.tsv', sha256:sha(readFileSync(join(build.work, counterexample + '.tsv')))}}));
}

export function assertBrowserJourneyInventory(names, calls) {
  assert.deepEqual(names, journeyNames, 'exact ordered semantic journey inventory');
  assert.deepEqual(calls, journeyCallInventory, 'exact case-bound generated browser call inventory');
}

export function verifyMutation(kind, baseline) {
  const build = prepare(kind, baseline.sources, baseline.inputs);
  let complete = false;
  try {
    const row = kind === 'design' ? predicates()[1] : kind === 'catalogue' ? predicates()[5]
      : corpus().find(row => row.id === ({purpose: 'PublicSecretPurpose', main: 'MissingMain', trailing: 'Trailing'}[kind]));
    assert.ok(row);
    assert.notEqual(build.verified.source_id, baseline.verified.source_id);
    assert.notEqual(build.verified.attestation_id, baseline.verified.attestation_id);
    assert.notEqual(build.generation.ir_sha256, baseline.generation.ir_sha256);
    const role = ['design', 'catalogue'].includes(kind) ? 'predicates' : 'a';
    const wasmSha = build.withWasm(role, sha);
    assert.notEqual(wasmSha, baseline.withWasm(role, sha));
    const path = join(build.work, 'mutation.tsv'); writeFileSync(path, tsv([row]), {flag: 'wx'});
    for (const standard of [true, false]) {
      assert.throws(() => build.runNative(standard, [path]), /native output mismatch/, kind);
    }
    assert.throws(() => build.withWasm(role, bytes => executeWasm(bytes, [row],
      ['design', 'catalogue'].includes(kind) ? 32 : 67108864)), /generated Wasm output mismatch/, kind);
    const artifacts = archive(build, baseline.evidenceDirectory, kind + '-artifacts', ['mutation.tsv']);
    const receipt = {kind, probe: row.id, request: sha(row.request), response: sha(row.response),
      source: build.verified.source_id, attestation: build.verified.attestation_id,
      ir: build.generation.ir_sha256, wasm: wasmSha, native: build.nativeEvidence(),
      generatedPackages: build.generatedPackages, wasmArtifacts: build.wasmEvidence(), archive: artifacts};
    writeFileSync(join(baseline.evidenceDirectory, kind + '.json'), JSON.stringify(receipt) + '\n', {flag: 'wx'});
    baseline.mutationEvidence.push(receipt); complete = true;
  } finally {
    if (complete) rmSync(build.work, {recursive: true, force: true});
    else process.stderr.write('Retained incomplete semantic mutation ' + build.work + '\n');
  }
}

export function completeEvidence(build) {
  assert.deepEqual(build.mutationEvidence.map(row => row.kind), ['purpose', 'main', 'trailing', 'design', 'catalogue']);
  assert.deepEqual(build.browserEvidence.map(row => row.engine), engines, 'complete required browser transcript inventory');
  assert.deepEqual(build.browserMutationEvidence.map(row => row.engine), engines, 'complete required browser mutation inventory');
  for (const row of build.browserEvidence) {
    assertBrowserJourneyInventory(row.cases, row.callInventory);
    assertPaletteInventory(row.palettes);
    for (const transcript of [row.observed, row.counterexample])
      assert.equal(sha(readFileSync(join(build.work, transcript.file))), transcript.sha256, 'immutable replayed browser transcript');
  }
  for (const row of build.browserMutationEvidence) assert.deepEqual(row.mutants.map(value => value.check),
    ['email-autocomplete', 'email-type', 'error-associations', 'main-landmark',
      'catalogue-preflight-0', 'wide-layout-columns', 'forced-system-palette', 'forced-authored-disabled-background']);
  build.unchanged();
  const receipt = {scope: 'private-semantic-component-only', publicApplicationAccepted: false,
    source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: sha(build.wasmBytes), native: build.nativeEvidence(),
    generatedPackages: build.generatedPackages, wasmArtifacts: build.wasmEvidence(),
    artifactSubstitutions: build.artifactSubstitutions, inputs: build.inputs, maxima: build.maxima,
    mutations: build.mutationEvidence, browsers:build.browserEvidence,
    browserMutations:build.browserMutationEvidence, archive: build.positiveArchive,
    finalArchive: archive(build, build.evidenceDirectory, 'completed-artifacts',
      ['all-vectors.tsv', ...build.browserEvidence.flatMap(row => [row.observed.file, row.counterexample.file])])};
  writeFileSync(join(build.evidenceDirectory, 'owner.json'), JSON.stringify(receipt) + '\n', {flag: 'wx'});
  build.complete = true; return build.evidenceDirectory;
}
