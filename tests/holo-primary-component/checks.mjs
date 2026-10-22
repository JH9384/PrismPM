import assert from 'node:assert/strict';
import {lstatSync, mkdirSync, readFileSync, realpathSync, statfsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createComponentCompiler, frozenInputs, prepareComponent, requirePreparedComponent, sha} from './compile.mjs';
import {verifyCompilerOwnerSubstitutions} from '../browser-view/compiler-owner-checks.mjs';
import {prepareOracle} from './oracle.mjs';
import {codecCorpus, codecTsv} from './corpus.mjs';
import {mutations, mutationProbes} from './mutations.mjs';
import {artifactAdversaries, componentAdversaries, inputClosureAdversaries} from './adversaries.mjs';
import {profileLinkAdversaries} from './profile-links.mjs';
import {corpus} from '../browser-session/corpus.mjs';
import {maximumVectors, effectResultMaxima} from '../browser-session/maxima.mjs';
import {executeWasm, tsv} from '../browser-session-journal/runtime.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
}
const json = value => Buffer.from(JSON.stringify(canonical(value)));
const owners = new WeakSet();
function files(root) {
  mkdirSync(root);
  const captured = new Map();
  const put = (name, bytes) => {
    assert.match(name, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
    const path = join(root, name);
    writeFileSync(path, bytes, {flag:'wx'}); captured.set(path, sha(bytes)); return path;
  };
  return {put, verify() {
    for (const [path, digest] of captured) {
      const stat = lstatSync(path);
      assert.equal(realpathSync(path), path, 'unaliased captured component input');
      assert.ok(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid(), 'owned singly linked component input');
      assert.equal(sha(readFileSync(path)), digest, 'exact captured component input ' + path);
    }
  }, evidence() {return Object.fromEntries([...captured].map(([path, digest]) => [path.slice(root.length + 1), digest]));}};
}

// Test-only owner: no archive or receipt supplied by a caller can manufacture a
// fresh compiler result. The profile is not a public Browser admission API.
export function composeComponent(owner, oracle) {
  requirePreparedComponent(owner);
  assert.equal(owner.mutation, null, 'mutated source cannot produce accepted component evidence');
  owner.compileNative(true); owner.compileNative(false); owner.unchanged();
  const storage = files(join(owner.work, 'component'));
  let sequence = 0;
  function invoke(operation, arguments_) {
    requirePreparedComponent(owner); storage.verify();
    const paths = arguments_.map(bytes => storage.put('argument-' + sequence++, bytes));
    const results = [];
    for (const standard of [true, false]) {
      const path = join(owner.work, 'component', 'output-' + sequence++);
      const output = owner.runNative(standard, [operation, path, ...paths]).trim();
      assert.equal(output, 'SOME', 'source composer must accept exact admitted component');
      results.push(readFileSync(path));
    }
    assert.deepEqual(results[0], results[1], 'std/no_std exact codec output ' + operation);
    owner.unchanged(); storage.verify(); return results[0];
  }
  const guest = owner.wasm.session[0].run(bytes => Buffer.from(bytes));
  const source = {source_id:owner.verified.source_id, semantic_id:owner.verified.semantic_id,
    attestation_id:owner.verified.attestation_id, build_id:owner.verified.build_id,
    exact_proof:owner.verificationEvidence, modules:owner.sourceEvidence};
  const model = json({schema:'prismpm/component-model/1', profile:'holo/1-primary-component',
    entry:'PrismPM.Foundation.Browser.Application.V1.SessionWire.sourceSessionWireBytes',
    source, input_ir_sha256:owner.generation.ir_sha256, captured_inputs:owner.inputs,
    generated_packages:owner.generatedPackages, guest_sha256:sha(guest), native:owner.nativeEvidence(),
    source_semantics:'private-generated-session', application_acceptance:false});
  const metadata = json({schema:'prismpm/component-source/1', source});
  const capabilities = invoke('capabilities', []);
  const identity = bytes => {
    const path = storage.put('identity-' + sequence++, bytes);
    const result = oracle.call(['identity', path]); storage.verify();
    assert.equal(result.length, bytes.length); assert.match(result.kappa, /^blake3:[a-f0-9]{64}$/);
    assert.equal(result.digest, result.kappa.slice(7)); return result;
  };
  const capabilityId = identity(capabilities), guestId = identity(guest), modelId = identity(model);
  assert.equal(new Set([capabilityId.kappa, guestId.kappa, modelId.kappa]).size, 3, 'distinct actual component content roles');
  const manifest = invoke('manifest', [Buffer.from(capabilityId.kappa), Buffer.from(guestId.kappa)]);
  const applicationId = identity(manifest);
  const contents = [[capabilityId, capabilities], [guestId, guest], [modelId, model]]
    .sort(([a], [b]) => a.kappa < b.kappa ? -1 : a.kappa > b.kappa ? 1 : 0);
  // Exact upstream directory DTO serialization, independently compared by the
  // pinned oracle; no host byte-level archive or manifest encoder exists here.
  const directory = Buffer.from(JSON.stringify({schema_version:1,primary_layer:0,requires_kappa:capabilityId.kappa,
    layers:[{position:0,kind:'wasm',content_kappa:guestId.kappa,entry:'holo_run',
      contract:'hologram:guest/core-wasm@1',architecture:null,surface:null,engine:null}],children:[],
    blobs:contents.map(([id, bytes]) => ({kappa:id.kappa,byte_length:bytes.length}))}));
  const provenance = json({schema:'prismpm/component-provenance/1',profile:'holo/1-primary-component',
    source, input_ir_sha256:owner.generation.ir_sha256, model_content_kappa:modelId.kappa,
    guest_content_kappa:guestId.kappa, capabilities_content_kappa:capabilityId.kappa,
    application_kappa:applicationId.kappa, generated_packages:owner.generatedPackages,
    hologram_live_revision:'d8208266d8abdc2445b7bbc0cef412a566adfaf1',
    uor_hologram_revision:'2bda6a9a9476872dade705bd61ece4209607f6da'});
  const blobs = contents.map(([id, bytes]) => invoke('blob', [Buffer.from(id.kappa), bytes]));
  const body = invoke('body', [manifest, metadata, directory, provenance, ...blobs]);
  const footer = Buffer.from(identity(body).digest, 'hex');
  const archive = invoke('frame', [body, footer]);
  const archiveId = identity(archive);
  const paths = Object.freeze({archive:storage.put('source-session.holo', archive), guest:storage.put('guest.wasm', guest),
    model:storage.put('model.json', model), metadata:storage.put('metadata.json', metadata),
    provenance:storage.put('provenance.json', provenance)});
  const expected = Object.freeze({archive:sha(archive),guest:sha(guest),model:sha(model),metadata:sha(metadata),provenance:sha(provenance)});
  const value = Object.freeze({paths, archiveId, applicationId, expected,
    verify() {
      requirePreparedComponent(owner); storage.verify(); oracle.verify();
      for (const [name, path] of Object.entries(paths)) assert.equal(sha(readFileSync(path)), expected[name], 'admitted component artifact ' + name);
      owner.wasm.session[0].run(bytes => assert.deepEqual(readFileSync(paths.guest), bytes));
    }, evidence: storage.evidence()});
  owners.add(value); value.verify(); return value;
}

function verifyRuntime(component, owner, oracle, rows, name) {
  assert.ok(owners.has(component), 'actual source-composed component required');
  component.verify();
  const storage = files(join(owner.work, name));
  const vectors = rows.map((row, at) => ({id:row.id, request:storage.put('request-' + at, row.request),
    response:storage.put('response-' + at, row.response)}));
  for (const standard of [true, false]) {
    if (name === 'finite') {
      const input = storage.put('native-' + standard + '.tsv', tsv(rows));
      const output = owner.runNative(standard, ['session-corpus', input]);
      assert.equal(output, rows.map(row => 'PASS ' + row.id + '\n').join('')
        + 'PASS ' + rows.length + ' session-corpus vectors twice\n', 'exact ordered native Session inventory');
    } else {
      const output = join(owner.work, name, 'native-output-' + standard);
      assert.equal(owner.runNative(standard, ['session', output, vectors[0].request]).trim(), 'SOME');
      assert.deepEqual(readFileSync(output), Buffer.from(rows[0].response));
    }
  }
  let maximumBytes = 0;
  for (const wasm of owner.wasm.session) maximumBytes = Math.max(maximumBytes,
    wasm.run(bytes => executeWasm(bytes, rows)).maximumBytes);
  const list = storage.put('vectors.json', json(vectors));
  storage.verify(); component.verify();
  const receipt = oracle.call(['execute', ...Object.values(component.paths), list]);
  component.verify(); storage.verify();
  assert.equal(receipt.schema, 'prismpm/primary-binary-oracle/1');
  assert.equal(receipt.scope, 'private-component-only');
  assert.equal(receipt.archive_kappa, component.archiveId.kappa);
  assert.equal(receipt.application_kappa, component.applicationId.kappa);
  assert.equal(receipt.exact_archive_direct_and_resident, true);
  assert.equal(receipt.lifecycle_refusals, 3);
  assert.equal(receipt.actual_allocator_first_over_refusals, 2);
  assert.equal(receipt.allocation_errors.length, 2);
  for (const error of receipt.allocation_errors) {
    assert.equal(error.code, 'LIVE_PROTOCOL_ERROR');
    assert.ok(error.message.startsWith('guest ' + component.archiveId.kappa + ' trapped in `holo_alloc`: '));
  }
  const unloaded = {code:'LIVE_NOT_FOUND',message:component.archiveId.kappa + ' is not loaded as a resident holo; run `hologram holo load ' + component.archiveId.kappa + '` first'};
  assert.deepEqual(receipt.lifecycle_errors, [unloaded,
    {code:'LIVE_CONFLICT',message:'application ' + component.applicationId.kappa + ' is not running (state Stopped)'}, unloaded]);
  assert.deepEqual(receipt.vectors.map(row => row.id), rows.map(row => row.id));
  for (const [at, observed] of receipt.vectors.entries()) {
    assert.equal(observed.direct_repeats, 2); assert.equal(observed.resident_repeats, 2);
    assert.equal(observed.request_length, rows[at].request.length);
    assert.equal(observed.response_length, rows[at].response.length);
    assert.match(observed.request_kappa, /^blake3:[a-f0-9]{64}$/);
    assert.match(observed.response_kappa, /^blake3:[a-f0-9]{64}$/);
  }
  return {name, count:rows.length, maximumBytes, files:storage.evidence(), receipt};
}

function archiveNegatives(component, owner, oracle) {
  component.verify();
  const storage = files(join(owner.work, 'archive-negatives'));
  const baseline = readFileSync(component.paths.archive), originalBody = baseline.subarray(0, -32);
  const variants = [];
  const footer = Buffer.from(baseline); footer[footer.length - 1] ^= 1;
  variants.push(['corrupt-footer', footer]);
  const reseal = (name, body) => {
    const path = storage.put(name + '.body', body);
    const digest = oracle.call(['identity', path]).digest;
    assert.match(digest, /^[a-f0-9]{64}$/);
    return Buffer.concat([body, Buffer.from(digest, 'hex')]);
  };
  const guest = Buffer.from(originalBody);
  const guestKappa = oracle.call(['identity', component.paths.guest]).kappa;
  let guestOffset = null;
  for (let row = 4; row < 7; row++) {
    const start = Number(guest.readBigUInt64LE(10 + row * 24 + 8));
    if (guest.subarray(start, start + 71).toString() === guestKappa) guestOffset = start + 71;
  }
  assert.notEqual(guestOffset, null); guest[guestOffset + 7] ^= 1;
  variants.push(['unaddressed-guest-substitution', reseal('guest', guest)]);
  const directory = Buffer.from(originalBody);
  const start = Number(directory.readBigUInt64LE(10 + 2 * 24 + 8));
  const primary = directory.indexOf(Buffer.from('"primary_layer":0'), start);
  assert.ok(primary >= start); directory[primary + '"primary_layer":'.length] = 49;
  variants.push(['inconsistent-directory', reseal('directory', directory)]);
  const receipts = [];
  for (const [name, bytes] of variants) {
    const path = storage.put(name + '.holo', bytes);
    // This deliberate distinction prevents a framing predicate from being
    // promoted to a cryptographic or source-provenance acceptance claim.
    for (const standard of [true, false]) {
      const output = join(owner.work, 'archive-negatives', name + '-' + standard + '.bool');
      assert.equal(owner.runNative(standard, ['valid-frame', output, path]).trim(), 'SOME');
      assert.deepEqual(readFileSync(output), Buffer.from([1]));
    }
    const result = oracle.call(['reject', path]);
    assert.equal(result.refused_before_session, true); assert.ok(result.error.length > 0);
    storage.verify(); component.verify(); receipts.push({name,sha256:sha(bytes),result});
  }
  assert.equal(receipts.length, 3); return receipts;
}

export async function verifyComponent() {
  const inputs = frozenInputs(), compiler = createComponentCompiler(inputs);
  const owner = prepareComponent(compiler, inputs), inputNegatives = inputClosureAdversaries(owner.inputs);
  const compilerNegatives = verifyCompilerOwnerSubstitutions(compiler);
  const artifactNegatives = artifactAdversaries(owner);
  owner.compileNative(true); owner.compileNative(false); owner.unchanged();
  const oracle = prepareOracle(), fixture = oracle.call(['synthetic']), codec = codecCorpus(fixture);
  assert.equal(codec.length, 642, 'complete pinned-independent structural codec corpus');
  const probes = mutationProbes(codec);
  const codecPath = join(owner.work, 'codec.tsv'); writeFileSync(codecPath, codecTsv(codec), {flag:'wx'});
  for (const standard of [true, false]) {
    const output = owner.runNative(standard, ['codec-corpus', codecPath]);
    assert.equal(output, codec.map(row => 'PASS ' + row.id + '\n').join('')
      + 'PASS ' + codec.length + ' codec-corpus vectors twice\n', 'exact ordered native codec inventory');
  }
  const component = composeComponent(owner, oracle), finite = corpus();
  const componentNegatives = componentAdversaries(component, owner,
    candidate => verifyRuntime(candidate, owner, oracle, [], 'must-not-enter-runtime'));
  const upstreamNegatives = archiveNegatives(component, owner, oracle);
  const profileNegatives = profileLinkAdversaries(component, owner, oracle);
  assert.equal(finite.length, 895, 'complete unchanged source Session finite corpus');
  const observations = [verifyRuntime(component, owner, oracle, finite, 'finite')];
  let ordinal = 0;
  for (const vectors of [maximumVectors(), effectResultMaxima()]) for (const vector of vectors) {
      const disk = statfsSync(owner.work, {bigint:true});
      assert.ok(disk.bavail * disk.bsize >= 12n * 1024n ** 3n, '12 GiB owner reserve before every actual maximum');
      observations.push(verifyRuntime(component, owner, oracle, [vector], 'maximum-' + ordinal++));
      process.stdout.write('PASS actual primary archive maximum ' + vector.id + '\n');
    }
  assert.equal(ordinal, 27, 'complete unchanged Session maximum domain');
  const mutationReceipts = [];
  for (const [index, mutation] of mutations.entries()) {
    const disk = statfsSync(owner.work, {bigint:true});
    assert.ok(disk.bavail * disk.bsize >= 12n * 1024n ** 3n, '12 GiB owner reserve before every real source mutant');
    const changed = prepareComponent(compiler, owner.inputs, mutation.id);
    const probe = [probes[index]];
    const path = join(changed.work, 'probe.tsv'); writeFileSync(path, codecTsv(probe), {flag:'wx'});
    for (const standard of [true, false]) {
      changed.compileNative(standard);
      assert.throws(() => changed.runNative(standard, ['codec-corpus', path]),
        error => String(error).includes(mutation.probe) && String(error).includes('assertion `left == right` failed'),
        'actual generated mutant must disagree, not fail compilation or trap');
    }
    changed.unchanged();
    mutationReceipts.push({id:mutation.id,probe:mutation.probe,work:changed.work,source:changed.verified.source_id,
      attestation:changed.verified.attestation_id,ir:changed.generation.ir_sha256,native:changed.nativeEvidence(),
      packages:changed.generatedPackages,wasm:changed.wasm.session.map(value => value.evidence),
      input_sha256:sha(readFileSync(path)),compiler:changed.compiler,
      nativeArtifacts:changed.nativeArtifacts(),provenance:changed.provenance});
    process.stdout.write('PASS actual primary source mutant ' + mutation.id + '\n');
  }
  assert.equal(mutationReceipts.length, 7);
  owner.unchanged(); oracle.verify(); component.verify();
  const oracleRetirement = oracle.retire();
  const native = owner.nativeEvidence(), nativeArtifacts = owner.nativeArtifacts();
  const compilerRetirement = compiler.close();
  const evidence = {schema:'prismpm/primary-component-owner/1',scope:'private-component-format-and-binary-interoperability',
    componentAccepted:true,publicApplicationAccepted:false,source:owner.verified,inputs:owner.inputs,
    proof:owner.verificationEvidence,ir:owner.generation.ir_sha256,packages:owner.generatedPackages,
    native,nativeArtifacts,compiler:owner.compiler,compilerNegatives,
    provenance:owner.provenance,wasm:owner.wasm.session.map(value => value.evidence),
    upstream:oracle.evidence,codecCount:codec.length,finiteCount:finite.length,maximumCount:ordinal,profileNegatives,
    archive:component.expected,archive_kappa:component.archiveId.kappa,application_kappa:component.applicationId.kappa,
    observations,inputNegatives,artifactNegatives,componentNegatives,upstreamNegatives,
    mutations:mutationReceipts,compilerRetirement,oracleRetirement};
  const receipt = join(owner.work, 'primary-component-evidence.json');
  writeFileSync(receipt, json(evidence), {flag:'wx'}); return {receipt,sha256:sha(readFileSync(receipt))};
}
