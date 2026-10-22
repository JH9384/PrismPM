import assert from 'node:assert/strict';
import {chmodSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {prepare, frozenInputs, compilerInputs, assertFrozenInputs, sha, repository} from './compile.mjs';
import {corpus} from './corpus.mjs';
import {contextFieldsCorpus} from './context-fields-corpus.mjs';
import {maximumNames, maximum} from './maximum-fixtures.mjs';
import {mutationNames, mutationProbes} from './mutations.mjs';
import {executeWasm} from './execute.mjs';
import {createCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../browser-view/compiler-owner-checks.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';
import {verifyCapturedPublicationLinkage, requireCaptureCompletion} from './capture-owner.mjs';
const tsv = rows => rows.map(row => row.id + '\t' + Buffer.from(row.request).toString('hex') + '\t'
  + Buffer.from(row.response).toString('hex') + '\n').join('');
const contextTsv = rows => {
  const hexadecimal = value => value ? Buffer.from(value).toString('hex') : '-';
  return rows.map(row => [row.id, row.request, row.response, row.admission, row.preimage]
    .map((value, index) => index ? hexadecimal(value) : value).join('\t') + '\n').join('');
};

function nativeReplay(build, rows, stem) {
  assert.match(stem, /^[a-z][a-z0-9-]*$/); assert.ok(rows.length);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  for (const row of rows) assert.match(row.id, /^[A-Za-z0-9]+$/);
  const path = join(build.work, stem + '.tsv'), bytes = Buffer.from(tsv(rows));
  writeFileSync(path, bytes, {flag: 'wx'});
  for (const standard of [true, false]) {
    assert.deepEqual(readFileSync(path), bytes);
    const output = build.runNative(standard, [path]);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(output, rows.map(row => 'PASS ' + row.id + '\n').join('')
      + 'PASS ' + rows.length + ' complete publication linkage vectors twice\n',
      'exact ordered complete native stdout');
  }
}
function contextReplay(build) {
  const rows = contextFieldsCorpus(); assert.equal(rows.length, 76);
  const bytes = Buffer.from(contextTsv(rows));
  const path = join(build.work, 'context-fields.tsv'); writeFileSync(path, bytes, {flag: 'wx'});
  for (const standard of [true, false]) {
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(build.runNative(standard, [path], true), rows.map(row => 'PASS ' + row.id + '\n').join('')
      + 'PASS 76 complete six-field vectors twice\n');
    assert.deepEqual(readFileSync(path), bytes);
  }
  const projection = build.withWasm('context-fields-wasm', bytes => executeWasm(bytes, rows));
  const admission = rows.filter(row => row.admission).map(row => ({...row, request: row.admission}));
  assert.equal(admission.length, 59);
  const opcodeFour = build.withWasm('admission-wasm', bytes => executeWasm(bytes, admission));
  return {vectors: rows.length, parityVectors: admission.length, corpusSha256: sha(bytes), projection, opcodeFour};
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
    'export', 'generated', 'runner/src', 'runner/Cargo.lock',
    'context-fields-runner/src', 'context-fields-runner/Cargo.lock'])
    files(join(build.work, path));
  for (const runner of ['runner', 'context-fields-runner'])
    if (lstatSync(join(build.work, runner, 'Cargo.toml'), {throwIfNoEntry:false}))
      files(join(build.work, runner, 'Cargo.toml'));
  files(build.verified.root);
  for (const row of build.generatedPackages) if (row.kind === 'wasm') files(join(build.work, row.path));
  const wasm = build.wasmEvidence();
  for (const value of Object.values(wasm)) for (const side of ['original', 'private']) files(join(build.work, value[side].path));
  for (const mode of Object.keys(build.nativeEvidence())) files(join(build.work, 'native-' + mode + '-observer'));
  for (const name of readdirSync(build.work).sort())
    if (/\.(tsv|request|response|size)$/.test(name)) files(join(build.work, name));
  const receipt = {spec: 'prismpm/private-publication-linkage-evidence/1', scope: 'component-only',
    completeApplicationAccepted: false, ...result, inputs: build.inputs, inputSnapshot,
    sources: Object.fromEntries([...build.sources].map(([name, bytes]) => [name, sha(bytes)])),
    proof: build.verified, ir: build.generation.ir_sha256, native: build.nativeEvidence(), wasm,
    compiler: build.compilerTools,
    generatedPackages: build.generatedPackages, retainedFiles: retained};
  const path = join(build.work, 'publication-linkage-evidence.json'), bytes = Buffer.from(JSON.stringify(receipt) + '\n');
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
          writeFileSync(manifest, JSON.stringify(changedManifest) + '\n');
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
  for (const role of ['wasm', 'context-fields-wasm', 'admission-wasm']) {
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
  assert.equal(names.length, 17); return names;
}


function binaryReplay(build, row) {
  const input = join(build.work, row.id + '.request'), output = join(build.work, row.id + '.response');
  writeFileSync(input, row.request, {flag: 'wx'}); writeFileSync(output, row.response, {flag: 'wx'});
  const hashes = [sha(row.request), sha(row.response)];
  const unchanged = () => assert.deepEqual([input, output].map(path => sha(readFileSync(path))), hashes);
  for (const standard of [true, false]) {
    unchanged();
    assert.equal(build.runNative(standard, ['--binary', input, output]), 'PASS binary complete publication linkage vector twice\n');
    unchanged();
  }
  const wasm = build.withWasm('wasm', bytes => executeWasm(bytes, [row]));
  return {id: row.id, request: hashes[0], response: hashes[1], inputBytes: row.request.length, outputBytes: row.response.length, wasm};
}

function mutant(kind, baseline, inputSnapshot) {
  const probe = mutationProbes[kind];
  const context = kind.startsWith('context-');
  const row = maximumNames.includes(probe) ? maximum(probe)
    : (context ? contextFieldsCorpus() : corpus()).find(row => row.id === probe);
  assert.ok(row, 'exact registered mutation witness');
  const build = prepare(baseline.compilerOwner, kind, baseline.sources, baseline.inputs);
  assert.notEqual(build.verified.source_id, baseline.verified.source_id);
  assert.notEqual(build.verified.attestation_id, baseline.verified.attestation_id);
  assert.notEqual(build.generation.ir_sha256, baseline.generation.ir_sha256);
  try {
    const path = join(build.work, 'intended-mutation.tsv');
    writeFileSync(path, context ? contextTsv([row]) : tsv([row]), {flag: 'wx'});
    for (const standard of [true, false])
      assert.throws(() => build.runNative(standard, [path], context),
        new RegExp(probe + (context ? ' six-field bytes' : ' native output mismatch')));
    build.withWasm(context ? 'context-fields-wasm' : 'wasm', bytes => assert.throws(() => executeWasm(bytes, [row]),
      new RegExp(probe + ' generated Wasm output mismatch')));
    build.unchanged();
    return {kind, probe, evidence: retain(build, {kind, probe, intendedMutationRejected: true}, inputSnapshot)};
  } catch (error) {
    process.stderr.write('Retained failed publication linkage source mutant ' + kind + ' at ' + build.work + '\n');
    throw error;
  }
}

export async function verifyGeneratedLinkage(t) { return verifyLinkage(t, false); }
export async function verifyCompletePublicationLinkage(t) { return verifyLinkage(t, true); }
async function verifyLinkage(t, completeOwner) {
  const inputs = frozenInputs(), compiler = createCompilerOwner('publication-linkage', compilerInputs(inputs));
  const build = prepare(compiler, null, null, inputs);
  const inputSnapshot = snapshotInputs(build);
  const result = {vectors: corpus().length, maxima: [], mutations: []};
  let complete = false;
  try {
    await prerequisite(t, 'actual complete compiler source, executable and runtime substitutions are refused', () => {
      result.compilerSubstitutions = verifyCompilerOwnerSubstitutions(compiler, inputs);
    });
    await prerequisite(t, 'actual native package and Wasm substitutions are refused before execution', () => {
      result.substitutions = verifyArtifactSubstitutions(build);
    });
    await prerequisite(t, 'complete independent corpus agrees in std, no_std and fresh Core-Wasm', () => {
      const rows = corpus(); assert.equal(rows.length, 119);
      nativeReplay(build, rows, 'complete-vectors');
      result.wasm = build.withWasm('wasm', bytes => executeWasm(bytes, rows));
    });
    await prerequisite(t, 'actual native semantic helpers satisfy complete independent boundary witnesses', () => {
      const expected = 'PASS 260 independent collector order, duplicates, missing-member and fuel witnesses\n'
        + 'PASS 131592 independent bit-mask and repeated-index witnesses\n'
        + 'PASS 710 independent public exact partition and bounded duplicate/fuel witnesses\n'
        + 'PASS 3192 independent and original-helper payload boundary/error-order witnesses\n'
        + 'PASS four complete independent semantic witness groups\n';
      for (const standard of [true, false])
        assert.equal(build.runNative(standard, ['--semantic-witnesses']), expected, 'exact complete semantic witness inventory');
      result.semanticWitnesses = {collector:260, bits:131592, partition:710, payload:3192, modes:['std', 'no_std']};
    });
    await prerequisite(t, 'typed six-field preimage and private projection agree with unchanged opcode four', () => {
      result.contextFields = contextReplay(build);
    });
    for (const name of maximumNames) await prerequisite(t, 'actual unchanged bound ' + name, () => {
      const observed = binaryReplay(build, maximum(name));
      result.maxima.push(observed);
      console.log(JSON.stringify({scope:'private-linkage-maximum',work:build.work,...observed}));
    });
    await prerequisite(t, 'actual observers reject a changed independent expected result', () => {
      const row = corpus()[0]; row.response = Buffer.from(row.response); row.response[0] ^= 1;
      const path = join(build.work, 'changed-expected.tsv'); writeFileSync(path, tsv([row]), {flag: 'wx'});
      for (const standard of [true, false]) assert.throws(() => build.runNative(standard, [path]),
        new RegExp(row.id + ' native output mismatch'));
      build.withWasm('wasm', bytes => assert.throws(() => executeWasm(bytes, [row]),
        new RegExp(row.id + ' generated Wasm output mismatch')));
    });
    for (const kind of mutationNames) await prerequisite(t, 'actual compiled source mutation ' + kind, () => {
      result.mutations.push(mutant(kind, build, inputSnapshot));
    });
    assert.equal(result.maxima.length, maximumNames.length);
    assert.equal(result.mutations.length, mutationNames.length);
    if (completeOwner) {
      result.actualCapture = await verifyCapturedPublicationLinkage(t, build);
      requireCaptureCompletion(result.actualCapture);
    }
    build.unchanged();
    result.evidence = retain(build, result, inputSnapshot);
    result.compilerRetirement = compiler.close();
    assert.throws(() => compiler.runDriver(['--help'], build.work), /compiler owner closed/);
    t.diagnostic(JSON.stringify(result));
    complete = true;
  } finally {
    assertFrozenInputs(inputs);
    if (!complete) process.stderr.write('Retained incomplete publication linkage owner ' + build.work + '\n');
  }
}

export async function verifyGeneratedLinkageResources(t) {
  const inputs = frozenInputs(), compiler = createCompilerOwner('publication-linkage', compilerInputs(inputs));
  const build = prepare(compiler, null, null, inputs), inputSnapshot = snapshotInputs(build);
  const result = {scope:'resource-diagnostic-only', completeApplicationAccepted:false, maxima:[]};
  let complete = false;
  try {
    const rows = corpus(); assert.equal(rows.length,119);
    nativeReplay(build,rows,'resource-vectors');
    result.wasm = build.withWasm('wasm',bytes=>executeWasm(bytes,rows));
    for (const name of ['servicesExact','CombinedStructuralMaxima','ExactOutput64MiB','ExactInput64MiB'])
      await prerequisite(t,'resource regression '+name,()=>{
        const observed=binaryReplay(build,maximum(name));result.maxima.push(observed);
        console.log(JSON.stringify({scope:result.scope,work:build.work,...observed}));
      });
    result.evidence=retain(build,result,inputSnapshot);
    result.compilerRetirement=compiler.close();
    t.diagnostic(JSON.stringify(result));complete=true;
  } finally {
    assertFrozenInputs(inputs);
    if (!complete) process.stderr.write('Retained incomplete publication linkage resource diagnostic '+build.work+'\n');
  }
}
