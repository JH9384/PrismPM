import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {prepare, run, sha, repository} from './compile.mjs';
import {corpus, maximumCorpus, boundaryCorpus} from './corpus.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';
import {inspectEffectModule} from '../../sdk/browser/effects-module.mjs';
export {prerequisite};

export const tsv = vectors => vectors.map(row => row.id + '\t' + Buffer.from(row.request).toString('hex') + '\t' + Buffer.from(row.response).toString('hex') + '\n').join('');
export function executeWasm(bytes, vectors) {
  const limits = inspectEffectModule(bytes, 16384);
  const module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  let maximum = 0;
  for (const vector of vectors) for (let repeat = 0; repeat < 2; repeat++) {
    const instance = new WebAssembly.Instance(module, {});
    const pointer = instance.exports.holo_alloc(vector.request.length) >>> 0;
    assert.ok(pointer + vector.request.length <= instance.exports.memory.buffer.byteLength);
    new Uint8Array(instance.exports.memory.buffer, pointer, vector.request.length).set(vector.request);
    let packed;
    try { packed = BigInt.asUintN(64, instance.exports.holo_run(pointer, vector.request.length)); }
    catch (error) { throw new Error(vector.id + ': actual generated Wasm trapped at ' + instance.exports.memory.buffer.byteLength + ' bytes', {cause: error}); }
    const at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
    assert.ok(length <= 67108864 && at + length <= instance.exports.memory.buffer.byteLength);
    assert.ok(Buffer.from(new Uint8Array(instance.exports.memory.buffer, at, length)).equals(Buffer.from(vector.response)), vector.id + ' generated Wasm output mismatch');
    maximum = Math.max(maximum, instance.exports.memory.buffer.byteLength);
    assert.ok(maximum <= limits.maximumPages * 65536);
  }
  // This tests the actual generated allocation guard and actual declared memory
  // maximum without allocating an over-limit JavaScript input.
  const invalid = new WebAssembly.Instance(module, {});
  assert.throws(() => invalid.exports.holo_alloc(67108865), WebAssembly.RuntimeError);
  assert.throws(() => invalid.exports.memory.grow(limits.maximumPages), RangeError);
  return {maximumBytes: maximum, declaredPages: limits.maximumPages};
}

export async function verifyWire(t, compilerOwner = null) {
  const oraclePaths = ['tests/browser-effects/checks.mjs', 'tests/browser-effects/corpus.mjs',
    'tests/browser-effects/compile.mjs', 'tests/browser-effects/runner.rs',
    'tests/browser-effects/driver/Cargo.toml', 'tests/browser-effects/driver/Cargo.lock',
    'tests/browser-effects/driver/src/main.rs', 'tests/browser-workspace/src/main.rs',
    'tests/browser-journal/driver/src/main.rs', 'sdk/browser/effects-wire.mjs', 'sdk/browser/effects-module.mjs'];
  const oracleClosure = () => Object.fromEntries(oraclePaths.map(path => [path, sha(readFileSync(join(repository, path)))]));
  const oracleSources = oracleClosure();
  const vectors = [...corpus(), ...boundaryCorpus()];
  assert.equal(corpus().length, 216);
  assert.equal(vectors.length, 242);
  const build = prepare(null, compilerOwner);
  t.after(() => rmSync(build.work, {recursive: true, force: true}));
  const file = join(build.work, 'vectors.tsv'); writeFileSync(file, tsv(vectors), {flag: 'wx'});
  const maximum = maximumCorpus();
  const binaries = maximum.map(row => {
    const input = join(build.work, row.id + '.request'), output = join(build.work, row.id + '.response');
    writeFileSync(input, row.request, {flag: 'wx'}); writeFileSync(output, row.response, {flag: 'wx'});
    return {id: row.id, input, output};
  });
  for (const standard of [true, false]) await prerequisite(t, 'all wire vectors and maximum closure twice in generated ' + (standard ? 'std' : 'no_std'), () => {
    const executable = build.compileNative(standard), output = run(executable, [file], build.runner);
    assert.deepEqual([...output.matchAll(/^PASS ([A-Za-z0-9]+)$/gm)].map(row => row[1]), vectors.map(row => row.id));
    assert.match(output, /PASS 242 complete effects vectors twice/);
    for (const row of binaries) assert.equal(run(executable, ['--binary', row.input, row.output], build.runner), 'PASS binary complete effects vector twice\n');
  });
  await prerequisite(t, 'every generated wire vector twice in fresh bounded Core-Wasm, including full active/waiter/completion state', () => {
    build.maximum = executeWasm(build.wasmBytes, [...vectors, ...maximum]);
  });
  assert.deepEqual(oracleClosure(), oracleSources, 'wire acceptance source closure remained frozen');
  t.diagnostic(JSON.stringify({source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: sha(build.wasmBytes), guest: sha(build.guestBytes),
    maximum: build.maximum, vectors: vectors.length, oracleSources,
    bounds: maximum.map(row => ({id: row.id, input: row.request.length, output: row.response.length,
      request: sha(row.request), response: sha(row.response)}))}));
  return build;
}

export function verifyModelMutation(kind, compilerOwner = null) {
  const selected = {binding: 'CompletionSubstitution', trailing: 'Trailing', unknown: 'UnknownRetainsBoth'}[kind];
  const vector = corpus().find(row => row.id === selected); assert.ok(vector);
  const build = prepare(kind, compilerOwner);
  try {
    const file = join(build.work, 'mutation.tsv'); writeFileSync(file, tsv([vector]), {flag: 'wx'});
    for (const standard of [true, false]) {
      const executable = build.compileNative(standard);
      assert.throws(() => run(executable, [file], build.runner), /native output mismatch/, 'real generated ' + kind + ' mutant must fail');
    }
    assert.throws(() => executeWasm(build.wasmBytes, [vector]), /generated Wasm output mismatch/, 'real generated Wasm mutation');
    build.verifyEvidence();
    if (compilerOwner) assert.equal(build.compilerOwner, compilerOwner.identity);
  } finally { rmSync(build.work, {recursive: true, force: true}); }
}

export function verifyInventory() {
  const source = readFileSync(join(repository, 'sdk/browser/effects.mjs'), 'utf8');
  const registry = JSON.parse(readFileSync(join(repository, 'model/browser-effect-diagnostics.json')));
  assert.equal(registry.spec, 'prismpm/browser-effect-diagnostics/1');
  assert.equal(registry.capability, 'DK-20');
  assert.equal(registry.error_class, 'EffectHostError');
  const referenced = new Set([...source.matchAll(/(?:fail|#terminate)\('([a-z-]+)'/g)].map(row => row[1]));
  referenced.add('effect-outcome-unknown');
  assert.deepEqual([...new Set(registry.errors)].sort(), [...referenced].sort());
  const semantic = file => JSON.parse(/\\semanticdata\{(.*)\}/.exec(readFileSync(join(repository, file), 'utf8'))[1]);
  const effects = semantic('stdlib/src/Foundation/Browser/Application/V1/Effects.lex.tex');
  const cbor = semantic('stdlib/src/Foundation/Codec/Cbor/V1/Primitive.lex.tex');
  const names = (model, name) => model.declarations.find(row => row.name === name).constructors.map(row => row.name);
  assert.deepEqual(registry.protocol_errors, names(effects, 'EffectProtocolError'));
  assert.deepEqual(registry.wire_errors, names(cbor, 'CborError'));
  assert.deepEqual(registry.effect_failures, names(effects, 'EffectFailure'));
  // Independent structural upper bound over every union branch, not just the
  // selected maximum-runtime examples. It includes duplicated active/waiter/
  // completion payloads and all 64 possible grants. No recursive type is
  // accepted here; the actual wire has only acyclic records and bounded lists.
  const types = new Map(effects.declarations.filter(row => ['structure', 'inductive'].includes(row.kind)).map(row => [row.name, row]));
  const scalar = size => ({bytes: size, nodes: 1, depth: 0});
  const array = values => ({bytes: (values.length < 24 ? 1 : 2) + values.reduce((n, value) => n + value.bytes, 0),
    nodes: 1 + values.reduce((n, value) => n + value.nodes, 0), depth: 1 + Math.max(0, ...values.map(value => value.depth))});
  const largest = values => Object.fromEntries(['bytes', 'nodes', 'depth'].map(key => [key, Math.max(...values.map(value => value[key]))]));
  function shape(type, field = '', owner = '', path = []) {
    if (type.kind === 'nat') return scalar(5);
    if (type.kind === 'bool') return scalar(1);
    if (type.kind === 'string') return scalar(515);
    if (type.kind === 'bytes') {
      const size = ['application', 'manifest', 'session', 'artifact'].includes(field) ? 32 : field === 'publicKey' ? 65
        : field === 'signature' || owner === 'EffectResult.Signature' ? 64 : owner === 'EffectResult.RandomBytes' ? 65536
        : owner === 'EffectGuestInvocation' || owner === 'EffectResult.GuestBytes' ? 2097152 : 1048576;
      return scalar((size < 24 ? 1 : size < 256 ? 2 : size < 65536 ? 3 : 5) + size);
    }
    if (type.kind === 'option') return array([scalar(1), shape(type.value, field, owner, path)]);
    if (type.kind === 'list') return array(Array.from({length: type.element.kind === 'bytes' ? 16 : 64}, () => shape(type.element, field, owner, path)));
    assert.equal(type.kind, 'named');
    const name = type.member.name; assert.ok(!path.includes(name), 'acyclic modeled wire shape');
    const declaration = types.get(name); assert.ok(declaration, 'closed modeled wire type ' + name);
    if (declaration.kind === 'structure') return array(declaration.fields.map(item => shape(item.type, item.name, name, [...path, name])));
    return largest(declaration.constructors.map(variant => array([scalar(1), ...variant.fields.map(type => shape(type, '', name + '.' + variant.name, [...path, name]))])));
  }
  const typed = name => shape({kind: 'named', member: {name}});
  const frames = [array([scalar(1), scalar(1), typed('EffectManifest'), scalar(34)]),
    array([scalar(1), scalar(1), typed('EffectSession'), typed('EffectRequest')]),
    array([scalar(1), scalar(1), typed('EffectSession'), typed('EffectCompletion')]),
    array([scalar(1), scalar(1), typed('EffectSession')])];
  for (const frame of frames) {
    assert.ok(frame.bytes < 67108864, 'all modeled branches fit frame including completion duplication');
    assert.ok(frame.nodes < 4096, 'decoded node amplification fits host fuel');
    assert.ok(frame.depth <= 16, 'decoded depth fits host bound');
  }
  return frames;
}
