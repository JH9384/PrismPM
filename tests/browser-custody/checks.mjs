import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {prepare, run, sha, repository, draft} from './compile.mjs';
import {corpus, maximumCorpus} from './corpus.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';
import {inspectEffectModule} from '../../sdk/browser/effects-module.mjs';
export {prerequisite};
export const tsv = vectors => vectors.map(row => row.id + '\t' + Buffer.from(row.request).toString('hex') + '\t' + Buffer.from(row.response).toString('hex') + '\n').join('');

export function executeWasm(bytes, vectors) {
  const limits = inspectEffectModule(bytes, 2048), module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.equal(limits.maximumPages, 2048);
  let maximum = 0;
  for (const vector of vectors) for (let repeat = 0; repeat < 2; repeat++) {
    const instance = new WebAssembly.Instance(module, {});
    const pointer = instance.exports.holo_alloc(vector.request.length) >>> 0;
    assert.ok(pointer + vector.request.length <= instance.exports.memory.buffer.byteLength);
    new Uint8Array(instance.exports.memory.buffer, pointer, vector.request.length).set(vector.request);
    const packed = BigInt.asUintN(64, instance.exports.holo_run(pointer, vector.request.length));
    const at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
    assert.ok(length <= 65536 && at + length <= instance.exports.memory.buffer.byteLength);
    assert.ok(Buffer.from(new Uint8Array(instance.exports.memory.buffer, at, length)).equals(Buffer.from(vector.response)), vector.id + ' generated Wasm output mismatch');
    maximum = Math.max(maximum, instance.exports.memory.buffer.byteLength);
    assert.ok(maximum <= limits.maximumPages * 65536);
  }
  const invalid = new WebAssembly.Instance(module, {});
  assert.throws(() => invalid.exports.holo_alloc(2097153), WebAssembly.RuntimeError);
  assert.throws(() => invalid.exports.memory.grow(limits.maximumPages), RangeError);
  return {maximumBytes: maximum, declaredPages: limits.maximumPages};
}

export function verifyInventory() {
  const semantic = name => JSON.parse(/\\semanticdata\{(.*)\}/.exec(readFileSync(join(repository, 'stdlib/src', ...name.split('.')) + '.lex.tex', 'utf8'))[1]);
  const model = semantic('Foundation.Browser.Application.V1.Custody');
  const types = new Map(model.declarations.filter(row => ['structure', 'inductive'].includes(row.kind)).map(row => [row.name, row]));
  const scalar = bytes => ({bytes, nodes: 1, depth: 0});
  const array = values => ({bytes: (values.length < 24 ? 1 : 2) + values.reduce((n, x) => n + x.bytes, 0),
    nodes: 1 + values.reduce((n, x) => n + x.nodes, 0), depth: 1 + Math.max(0, ...values.map(x => x.depth))});
  function shape(type, field = '', path = []) {
    if (type.kind === 'nat') return scalar(5);
    if (type.kind === 'string') return scalar(130);
    if (type.kind === 'bytes') return scalar(['application', 'policy'].includes(field) ? 34 : field === 'publicKey' ? 67 : 1048581);
    if (type.kind === 'list') return array(Array.from({length: 64}, () => shape(type.element, field, path)));
    if (type.kind === 'option') return array([scalar(1), shape(type.value, field, path)]);
    assert.equal(type.kind, 'named'); const name = type.member.name;
    assert.ok(!path.includes(name)); const declaration = types.get(name); assert.ok(declaration);
    if (declaration.kind === 'structure') return array(declaration.fields.map(row => shape(row.type, row.name, [...path, name])));
    const variants = declaration.constructors.map(row => array([scalar(1), ...row.fields.map(type => shape(type, '', [...path, name]))]));
    return Object.fromEntries(['bytes', 'nodes', 'depth'].map(key => [key, Math.max(...variants.map(row => row[key]))]));
  }
  const typed = name => shape({kind: 'named', member: {name}});
  const requests = [array([scalar(1), scalar(1), typed('CustodyPolicy')]),
    array([scalar(1), scalar(1), typed('CustodyPolicy'), array([scalar(1), typed('CustodySnapshot')]), array(Array.from({length: 64}, () => typed('CredentialBinding')))]),
    array([scalar(1), scalar(1), typed('CustodyPolicy'), array([scalar(1), typed('CustodySnapshot')])]),
    array([scalar(1), scalar(1), typed('CustodySnapshot'), scalar(34), scalar(34), scalar(130), scalar(1048581)])];
  const output = array([scalar(1), scalar(1), typed('CustodyReply')]);
  for (const request of requests) { assert.ok(request.bytes <= 2097152); assert.ok(request.nodes <= 4096); assert.ok(request.depth <= 16); }
  assert.ok(output.bytes <= 65536); assert.ok(output.nodes <= 4096); assert.ok(output.depth <= 16);
  const registry = JSON.parse(readFileSync(join(repository, 'model/browser-custody-diagnostics.json')));
  const host = readFileSync(join(repository, 'sdk/browser/credential-custody.mjs'), 'utf8');
  const actual = [...new Set([...host.matchAll(/fail\('([a-z-]+)'/g)].map(row => row[1]))].sort();
  // Conditional storage failure categories are exact and independently listed.
  for (const value of ['storage-quota', 'custody-outcome-unknown']) if (!actual.includes(value)) actual.push(value);
  assert.deepEqual(registry.errors.toSorted(), actual.sort());
  assert.deepEqual(registry.protocol_errors, types.get('CustodyError').constructors.map(row => row.name));
  assert.deepEqual(registry.wire_errors, semantic('Foundation.Codec.Cbor.V1.Primitive').declarations.find(row => row.name === 'CborError').constructors.map(row => row.name));
  assert.equal(registry.capability, 'DK-25');
  return {requests, output};
}

export async function verifyWire(t, compilerOwner = null) {
  const files = ['checks.mjs', 'corpus.mjs', 'compile.mjs', 'runner.rs', 'driver/Cargo.toml', 'driver/Cargo.lock', 'driver/src/main.rs', 'browser.mjs', 'browser-fixture.mjs'];
  const closure = () => Object.fromEntries(files.map(path => [path, sha(readFileSync(join(draft, path)))]));
  const sources = closure(), vectors = corpus(), maximum = maximumCorpus();
  assert.equal(vectors.length, 90); assert.equal(maximum.length, 10);
  const bounds = verifyInventory(), build = prepare(null, compilerOwner);
  t.diagnostic(JSON.stringify({compilerOwner: build.compilerOwner, preparationMs: build.preparationMs}));
  const file = join(build.work, 'vectors.tsv'); writeFileSync(file, tsv(vectors), {flag: 'wx'});
  const binaries = maximum.map(row => {
    const input = join(build.work, row.id + '.request'), output = join(build.work, row.id + '.response');
    writeFileSync(input, row.request, {flag: 'wx'}); writeFileSync(output, row.response, {flag: 'wx'});
    return {...row, input, output};
  });
  for (const standard of [true, false]) await prerequisite(t, 'complete custody vectors and declared maxima twice in generated ' + (standard ? 'std' : 'no_std'), () => {
    const executable = build.compileNative(standard), output = run(executable, [file], build.runner);
    assert.deepEqual([...output.matchAll(/^PASS ([A-Za-z0-9]+)$/gm)].map(row => row[1]), vectors.map(row => row.id));
    assert.match(output, /PASS 90 complete custody vectors twice/);
    for (const row of binaries) assert.equal(run(executable, ['--binary', row.input, row.output], build.runner), 'PASS binary complete custody vector twice\n');
  });
  await prerequisite(t, 'every custody wire vector and full bounded closure twice in actual generated Wasm', () => {
    build.maximum = executeWasm(build.wasmBytes, [...vectors, ...maximum.filter(row => !row.nativeOnly)]);
  });
  assert.deepEqual(closure(), sources);
  const evidence = {source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: sha(build.wasmBytes), maximum: build.maximum, vectors: vectors.length, bounds, sources,
    maxima: maximum.map(row => ({id: row.id, input: row.request.length, output: row.response.length, request: sha(row.request), response: sha(row.response)}))};
  writeFileSync(join(build.work, 'custody-wire-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  t.diagnostic(JSON.stringify(evidence));
  return build;
}

export function verifyModelMutation(kind, compilerOwner = null) {
  const selected = {policy: 'PolicyMismatchContext', limit: 'SignOverSmall', trailing: 'Trailing'}[kind];
  const vector = corpus().find(row => row.id === selected); assert.ok(vector);
  const build = prepare(kind, compilerOwner);
  let passed = false;
  try {
    const file = join(build.work, 'mutation.tsv'); writeFileSync(file, tsv([vector]), {flag: 'wx'});
    for (const standard of [true, false]) {
      const executable = build.compileNative(standard);
      assert.throws(() => run(executable, [file], build.runner), /native output mismatch/);
    }
    assert.throws(() => executeWasm(build.wasmBytes, [vector]), /generated Wasm output mismatch/);
    passed = true;
    return {kind, compilerOwner: build.compilerOwner, preparationMs: build.preparationMs,
      source: build.verified.source_id, attestation: build.verified.attestation_id,
      ir: build.generation.ir_sha256, wasm: sha(build.wasmBytes), vector: vector.id,
      request: sha(vector.request), response: sha(vector.response)};
  } finally {
    // Retain original source, proofs and generated products for independent
    // review. Compiler tools belong to the guarded owner, not this workspace.
    if (!passed) process.stderr.write('Retained failed custody mutation ' + build.work + '\n');
  }
}
