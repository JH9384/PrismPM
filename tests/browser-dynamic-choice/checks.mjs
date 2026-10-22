import assert from 'node:assert/strict';
import {chmodSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {prepare, frozenInputs, assertFrozenInputs, sha, repository} from './compile.mjs';
import {ownerCorpus} from './corpus.mjs';
import {maximumFrame, maximumIds} from './maximum-fixtures.mjs';
import {mutationNames} from './mutations.mjs';
import {journey, journeyNames, verifyMutants, maximumJourney} from './browser.mjs';
import {corpus as legacyCorpus, boundaries as legacyBoundaries} from '../browser-presentation/corpus.mjs';
import {executeWasm} from '../browser-presentation/checks.mjs';
import {encodeWire} from '../../sdk/browser/presentation-wire.mjs';

const roles = ['wire', 'semantic', 'fixture', 'labels', 'designs', 'intent', 'catalogue', 'size'];
const tsv = rows => rows.map(row => row.id + '\t' + row.role + '\t'
  + Buffer.from(row.request).toString('hex') + '\t' + Buffer.from(row.response).toString('hex') + '\n').join('');

export function nativeReplay(build, rows, stem) {
  assert.match(stem, /^[a-z][a-z0-9-]*$/); assert.ok(rows.length);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  for (const row of rows) { assert.match(row.id, /^[A-Za-z0-9]+$/); assert.ok(roles.includes(row.role)); }
  const path = join(build.work, stem + '.tsv'), bytes = Buffer.from(tsv(rows)); writeFileSync(path, bytes, {flag: 'wx'});
  for (const standard of [true, false]) {
    assert.deepEqual(readFileSync(path), bytes, 'exact native transcript before replay');
    const output = build.runNative(standard, [path]);
    assert.deepEqual(readFileSync(path), bytes, 'exact native transcript after replay');
    assert.equal(output, rows.map(row => 'PASS ' + row.id + '\n').join('')
      + 'PASS ' + rows.length + ' complete dynamic choice vectors twice\n', 'exact ordered complete native stdout');
  }
}

function snapshotInputs(build) {
  const root = join(build.work, 'frozen-inputs'); mkdirSync(root);
  for (const [path, hash] of Object.entries(build.inputs)) {
    const bytes = readFileSync(join(repository, path)); assert.equal(sha(bytes), hash);
    const target = join(root, path); mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, bytes, {flag: 'wx', mode: 0o444});
  }
  return root;
}

function retain(build, result, inputSnapshot) {
  build.unchanged();
  // Every source/tool/test byte is retained once by the baseline, also for the
  // negative owners. Mutated source bytes remain in each actual staged project.
  for (const [path, hash] of Object.entries(build.inputs))
    assert.equal(sha(readFileSync(join(inputSnapshot, path))), hash, 'retained complete source input ' + path);
  const retained = {};
  function files(path) {
    const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink(), 'retained proof/product is not an alias');
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) files(join(path, name));
    else { assert.ok(stat.isFile()); retained[path.slice(build.work.length + 1)] = {bytes: stat.size, sha256: sha(readFileSync(path))}; }
  }
  for (const path of ['project/src', 'project/lexlean.toml', 'project/lean-toolchain', 'project/lakefile.toml',
    'export', 'generated', 'runner/src', 'runner/Cargo.toml', 'runner/Cargo.lock', 'compiler-cache-retirement.json'])
    files(join(build.work, path));
  files(build.verified.root);
  for (const row of build.generatedPackages) if (row.kind === 'wasm') files(join(build.work, row.path));
  const wasm = build.wasmEvidence();
  for (const value of Object.values(wasm)) for (const side of ['original', 'private']) files(join(build.work, value[side].path));
  for (const mode of ['std', 'no_std']) files(join(build.work, 'native-' + mode + '-observer'));
  for (const name of readdirSync(build.work).sort())
    if (/\.(tsv|request|response|size)$/.test(name)) files(join(build.work, name));
  const receipt = {spec: 'prismpm/private-dynamic-choice-evidence/1', scope: 'component-only',
    completeApplicationAccepted: false, ...result, inputs: build.inputs, inputSnapshot,
    sources: Object.fromEntries([...build.sources].map(([name, bytes]) => [name, sha(bytes)])),
    proof: build.verified, ir: build.generation.ir_sha256, native: build.nativeEvidence(), wasm,
    generatedPackages: build.generatedPackages, retainedFiles: retained};
  const path = join(build.work, 'dynamic-choice-evidence.json'), bytes = Buffer.from(JSON.stringify(receipt) + '\n');
  writeFileSync(path, bytes, {flag: 'wx', mode: 0o444});
  assert.deepEqual(JSON.parse(readFileSync(path)), receipt);
  build.unchanged();
  return {path, sha256: sha(bytes), retainedFiles: Object.keys(retained).length};
}

function verifyArtifactSubstitutions(build) {
  const source = join(build.work, 'generated/src/lib.rs'), manifest = join(build.work, 'generated/generation-manifest.json');
  const original = readFileSync(source), originalManifest = readFileSync(manifest), names = [];
  for (const standard of [true, false]) for (const kind of ['source', 'forged-manifest', 'extra-file', 'hardlink']) {
    const mode = standard ? 'std' : 'no_std', extra = join(build.work, kind === 'hardlink' ? 'source-alias' : 'generated/extra');
    assert.equal(lstatSync(join(build.work, 'native-' + mode + '-observer'), {throwIfNoEntry: false}), undefined);
    assert.equal(lstatSync(join(build.work, 'native-' + mode), {throwIfNoEntry: false}), undefined);
    try {
      if (kind === 'source' || kind === 'forged-manifest') {
        const changed = Buffer.concat([original, Buffer.from('\n// actual package substitution\n')]); writeFileSync(source, changed);
        if (kind === 'forged-manifest') {
          const changedManifest = JSON.parse(originalManifest); changedManifest.files.find(row => row.path === 'src/lib.rs').sha256 = sha(changed);
          writeFileSync(manifest, JSON.stringify(changedManifest, (_key, value) =>
            value && !Array.isArray(value) && typeof value === 'object'
              ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value) + '\n');
        }
      } else if (kind === 'extra-file') writeFileSync(extra, 'extra', {flag: 'wx'});
      else linkSync(source, extra);
      assert.throws(() => build.compileNative(standard), ({source: /manifest digest/, 'forged-manifest': /immutable generated package/,
        'extra-file': /complete generated package file inventory/, hardlink: /bounded single-link custody file/})[kind]);
      assert.equal(lstatSync(join(build.work, 'native-' + mode + '-observer'), {throwIfNoEntry: false}), undefined);
      assert.equal(lstatSync(join(build.work, 'native-' + mode), {throwIfNoEntry: false}), undefined);
      names.push(mode + ':' + kind);
    } finally {
      writeFileSync(source, original); writeFileSync(manifest, originalManifest);
      if (lstatSync(extra, {throwIfNoEntry: false})) unlinkSync(extra);
    }
    build.unchanged();
  }
  for (const role of roles) {
    const evidence = build.wasmEvidence()[role];
    for (const side of ['original', 'private']) {
      const path = join(build.work, evidence[side].path), original = readFileSync(path), changed = Buffer.from(original);
      changed[8] ^= 1; const mode = lstatSync(path).mode & 0o777; let called = false;
      try {
        chmodSync(path, 0o600); writeFileSync(path, changed);
        assert.throws(() => build.withWasm(role, () => {called = true;}), new RegExp('immutable ' + side + ' generated Wasm'));
        assert.equal(called, false, 'altered actual artifact cannot reach execution'); names.push(role + ':' + side);
      } finally {writeFileSync(path, original); chmodSync(path, mode);}
      build.unchanged();
    }
    let buffer, original;
    try {
      assert.throws(() => build.withWasm(role, bytes => {buffer = bytes; original = bytes[8]; bytes[8] ^= 1;}),
        /immutable execution Wasm buffer/); names.push(role + ':buffer');
    } finally {if (buffer) buffer[8] = original;}
    build.unchanged();
  }
  assert.equal(names.length, 32); return names;
}

function replayCalls(build, calls, stem) {
  assert.ok(calls.length);
  const rows = calls.map((row, index) => ({id: 'Observed' + index, role: row.role,
    request: Buffer.from(row.request, 'hex'), response: Buffer.from(row.response, 'hex')}));
  nativeReplay(build, rows, stem);
  // Both actual native observers must reject altered browser observations.
  const changed = rows.map(row => ({...row, response: Buffer.from(row.response)}));
  assert.ok(changed[0].response.length); changed[0].response[0] ^= 1;
  const path = join(build.work, stem + '-changed.tsv'); writeFileSync(path, tsv(changed), {flag: 'wx'});
  for (const standard of [true, false]) assert.throws(() => build.runNative(standard, [path]), /native output mismatch/);
}

function binaryReplay(build, role, input, output) {
  const hashes = [input, output].map(path => sha(readFileSync(path)));
  const unchanged = () => assert.deepEqual([input, output].map(path => sha(readFileSync(path))), hashes,
    'exact binary input and independent expected result');
  for (const standard of [true, false]) {
    unchanged();
    assert.equal(build.runNative(standard, ['--binary', role, input, output]), 'PASS binary dynamic choice vector twice\n');
    unchanged();
  }
}

function verifyMaximum(build) {
  const results = [];
  for (const id of maximumIds) {
    const row = maximumFrame(id), input = join(build.work, id + '.request');
    writeFileSync(input, row.bytes, {flag: 'wx'});
    binaryReplay(build, row.role, input, input);
    const observed = build.withWasm(row.role, bytes => executeWasm(bytes,
      [{id, request: row.bytes, response: row.bytes}]));
    if (row.role === 'wire') {
      const output = join(build.work, id + '.size'); writeFileSync(output, encodeWire(row.bytes.length), {flag: 'wx'});
      binaryReplay(build, 'size', input, output);
      build.withWasm('size', bytes => executeWasm(bytes,
        [{id: id + 'Size', request: row.bytes, response: encodeWire(row.bytes.length)}]));
    }
    results.push({id, role: row.role, request: sha(row.bytes), response: sha(row.bytes),
      length: row.bytes.length, payload: row.payload, ...observed});
  }
  const input = join(build.work, 'one-over.request'), output = join(build.work, 'one-over.response');
  writeFileSync(input, new Uint8Array(67108865), {flag: 'wx'});
  writeFileSync(output, Uint8Array.of(0x83, 1, 1, 6), {flag: 'wx'});
  for (const role of ['wire', 'semantic']) {
    binaryReplay(build, role, input, output);
    build.withWasm(role, bytes => {
      const over = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
      assert.throws(() => over.exports.holo_alloc(67108865), WebAssembly.RuntimeError);
    });
  }
  return results;
}

function verifySourceMutation(kind, baseline, inputSnapshot) {
  const id = ({duplicate: 'DuplicateIdentifier', 'name-limit': 'OverNameBytes', selection: 'IntentUnknownId',
    aggregate: 'MixedOptionsOver', 'semantic-field': 'SemanticDynamicFieldHelpers', size: 'SizeSourceOrderDuplicateNames'})[kind];
  const row = ownerCorpus().find(row => row.id === id); assert.ok(row);
  // An unrelated build failure is a failed owner, never a killed mutation.
  const build = prepare(kind, baseline.sources, baseline.inputs);
  try {
    const path = join(build.work, 'intended-mutation.tsv'); writeFileSync(path, tsv([row]), {flag: 'wx'});
    for (const standard of [true, false]) assert.throws(() => build.runNative(standard, [path]),
      new RegExp(id + ' native output mismatch'), 'intended native mutation assertion ' + kind);
    build.withWasm(row.role, bytes => assert.throws(() => executeWasm(bytes, [row]),
      new RegExp(id + ' generated Wasm output mismatch'), 'intended Wasm mutation assertion ' + kind));
    build.unchanged();
    return {kind, id, evidence: retain(build, {kind, vector: id, intendedMutationRejected: true}, inputSnapshot)};
  } catch (error) {
    process.stderr.write('Retained failed dynamic choice mutation ' + kind + ' at ' + build.work + '\n'); throw error;
  }
}

export async function verifyDynamicChoice(t) {
  const inputs = frozenInputs(), build = prepare(null, null, inputs);
  let success = false;
  try {
    assert.ok(build.verified.attestation_id && build.cacheRetirement.owner === 'dynamic-choice');
    const inputSnapshot = snapshotInputs(build), artifactSubstitutions = verifyArtifactSubstitutions(build);
    // No new diagnostic codes or weakened legacy code ownership.
    const registry = JSON.parse(readFileSync(join(repository, 'model/browser-semantic-presentation-diagnostics.json')));
    assert.equal(registry.capability, 'DK-38'); assert.equal(registry.error_class, 'PresentationError');
    const sources = ['presentation-wire', 'presentation-dom', 'semantic-presentation-wire', 'semantic-presentation-style']
      .map(name => readFileSync(join(repository, 'sdk/browser/' + name + '.mjs'), 'utf8')).join('\n');
    for (const match of sources.matchAll(/(?:fail|PresentationError)\('([a-z-]+)'\)/g)) assert.ok(registry.errors.includes(match[1]));
    const rows = [...ownerCorpus(), ...[...legacyCorpus(), ...legacyBoundaries()]
      .map(row => ({...row, id: 'Legacy' + row.id, role: 'wire'}))];
    nativeReplay(build, rows, 'all-vectors');
    const memory = {};
    for (const role of roles) memory[role] = build.withWasm(role, bytes => executeWasm(bytes,
      rows.filter(row => row.role === role), ['fixture', 'labels', 'designs'].includes(role) ? 32 : 67108864));
    const maxima = verifyMaximum(build);
    const browser = await journey(build); assert.deepEqual(browser.cases, journeyNames); assert.equal(browser.calls.length, 53);
    replayCalls(build, browser.calls, 'observed-browser');
    const rendererMutants = await verifyMutants(build); assert.equal(rendererMutants.calls.length, 33);
    replayCalls(build, rendererMutants.calls, 'mutated-browser');
    const maximumBrowser = await maximumJourney(build);
    for (const result of maximumBrowser.results) {
      const expected = maxima.find(row => row.id === result.id); assert.ok(expected);
      assert.equal(result.payload, expected.payload); assert.equal(result.observations.length, 2);
      for (const [repeat, observed] of result.observations.entries()) {
        assert.deepEqual({...observed, memory: undefined}, {repeat, role: expected.role, request: expected.request,
          response: expected.response, length: expected.length, memory: undefined});
        assert.ok(observed.memory <= 1073741824);
      }
    }
    replayCalls(build, maximumBrowser.calls, 'maximum-browser-catalogues');
    // Observed maximum hashes bind to the exact files already executed twice by
    // both native modes; they are not constructed browser response transcripts.
    const sourceMutants = [];
    for (const kind of mutationNames) {
      t.diagnostic('Compiling intended source mutation ' + kind);
      sourceMutants.push(verifySourceMutation(kind, build, inputSnapshot));
    }
    build.unchanged(); assertFrozenInputs(inputs);
    const result = {scope: 'dynamic-choice-component-only', source: build.verified.source_id,
      attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
      corpus: rows.length, native: build.nativeEvidence(), wasm: build.wasmEvidence(),
      packages: build.generatedPackages, memory, maxima, browser: {cases: browser.cases, calls: browser.calls.length,
        audits: browser.audits, maximum: maximumBrowser.results, rendererMutants: rendererMutants.names}, sourceMutants, artifactSubstitutions,
      frozenInputs: {files: Object.keys(inputs).length, sha256: sha(Buffer.from(JSON.stringify(inputs)))},
      obligations: ['unchanged DK-23, DK-26 and DK-38 full owners', 'installed SDK/source archive regeneration',
        'application authorization, meaningful option names and human usability/accessibility assessment']};
    const evidence = retain(build, result, inputSnapshot);
    t.diagnostic(JSON.stringify({evidence, scope: result.scope, corpus: rows.length, sourceMutants, artifactSubstitutions}));
    success = true;
  } finally {
    process.stderr.write('Retained ' + (success ? 'complete component' : 'failed') + ' dynamic choice evidence ' + build.work + '\n');
  }
}
