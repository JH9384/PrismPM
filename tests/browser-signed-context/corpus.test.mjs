import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {corpus, context, envelope, publicKey, otherPublicKey, pointCases, encode, rejected} from './corpus.mjs';
import {oraclePoints} from '../browser-p256/oracles.mjs';
import {nativePointValid} from '../browser-p256/corpus.mjs';
import {parameters} from '../browser-p256/parameters.mjs';
import {mutations, mutateSignedContextSource} from './mutations.mjs';
import {coherentlyRehashedManifest} from './checks.mjs';
import {frozenInputs, verifyFrozenInputs, sourceClosure, assertCapturedSignedContextSources, assertSignedContextCompilerInputs} from './compile.mjs';

test('coherent manifest adversary reaches package custody with canonical trailing newline', () => {
  const original = Buffer.from('{"files":[{"path":"src/lib.rs","sha256":"' + '0'.repeat(64) + '"}]}\n');
  const changed = coherentlyRehashedManifest(original, Buffer.from('changed library'));
  assert.equal(changed.at(-1), 10);
  assert.notDeepEqual(changed, original);
  assert.throws(() => coherentlyRehashedManifest(Buffer.from('{"files":[]}\n'), Buffer.from('changed')), /one actual generated library/);
});

test('signed-context closure rejects copied input authority and mismatched source maps before compilation', () => {
  const inputs = frozenInputs(), sources = sourceClosure();
  verifyFrozenInputs(inputs); assertCapturedSignedContextSources(inputs, sources);
  assert.throws(() => verifyFrozenInputs({...inputs}), /actual complete captured signed-context inputs/);
  const changed = new Map(sources), name = changed.keys().next().value;
  changed.set(name, Buffer.concat([changed.get(name), Buffer.from('\n// changed source\n')]));
  assert.throws(() => assertCapturedSignedContextSources(inputs, changed), /actual captured source/);
  changed.delete(name);
  assert.throws(() => assertCapturedSignedContextSources(inputs, changed), /complete captured source module inventory/);
  assert.throws(() => assertSignedContextCompilerInputs({evidence:{family:'signed-context',inputs}}, inputs), /actual fresh compiler owner/);
  verifyFrozenInputs(inputs);
});

test('independent signed-context exact wire bounds and complete finite inventory', () => {
  assert.equal(encode(context()).length, 416);
  assert.equal(encode(envelope().slice(0, 3)).length, 485);
  assert.equal(encode(envelope()).length, 551);
  assert.equal(encode([1, 2, context(), publicKey(), envelope()]).length, 1037);
  const rows = corpus();
  assert.equal(rows.filter(row => row.id.startsWith('Truncated')).length, 1037);
  for (const id of ['BindingMismatch5', 'ContextMismatch8', 'ContextMismatch7', 'KeyMismatch',
    'ContextErrorPrecedence', 'SignatureErrorPrecedence', 'FrameMaximum', 'FrameOverflow'])
    assert.ok(rows.some(row => row.id === id), id);
  const names = ['Foundation.Browser.Application.V1.SignedContext', 'Foundation.Browser.Application.V1.SignedContextWire'];
  const original = new Map(names.map(name => [name, readFileSync(new URL('../../stdlib/src/' + name.replaceAll('.', '/') + '.lex.tex', import.meta.url))]));
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  for (const mutation of mutations) {
    const sources = new Map(original); mutateSignedContextSource(sources, mutation.id);
    assert.ok(rows.some(row => row.id === mutation.probe));
    assert.equal([...sources].filter(([name, bytes]) => !bytes.equals(original.get(name))).length, 1);
    for (const bytes of sources.values()) {
      const json = /\\semanticdata\{(.*)\}/.exec(bytes.toString())[1];
      assert.equal(json, JSON.stringify(canonical(JSON.parse(json))), 'canonical actual mutant ' + mutation.id);
    }
  }
});

test('envelope reader binds version separately from context key and signature', () => {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  for (const name of ['SignedContext', 'SignedContextWire']) {
    const source = readFileSync(new URL('../../stdlib/src/Foundation/Browser/Application/V1/' + name + '.lex.tex', import.meta.url), 'utf8');
    const json = /\\semanticdata\{(.*)\}/.exec(source)[1];
    assert.equal(json, JSON.stringify(canonical(JSON.parse(json))), 'canonical actual semantic source ' + name);
  }
  const text = readFileSync(new URL('../../stdlib/src/Foundation/Browser/Application/V1/SignedContextWire.lex.tex', import.meta.url), 'utf8');
  const model = JSON.parse(/\\semanticdata\{(.*)\}/.exec(text)[1]);
  const reader = model.declarations.find(row => row.name === 'readSignedContextEnvelope');
  const values = [];
  function visit(node) {if (!node || typeof node !== 'object') return;
    if (node.kind === 'record' && node.type.name === 'SignedContextEnvelope') values.push(node);
    for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(visit) : visit(value);
  }
  visit(reader.body); assert.equal(values.length, 1);
  const check = value => assert.deepEqual(value.fields.map(field => [field.field, field.value.field, field.value.value.name]),
    [['context', 'value', 'field1'], ['publicKey', 'value', 'field2'], ['signature', 'value', 'field3']]);
  check(values[0]);
  const shifted = structuredClone(values[0]); shifted.fields[0].value.value.name = 'field0';
  assert.throws(() => check(shifted));
});

test('signed-context admits complete source-validated points rather than provider key shape', () => {
  const source = readFileSync(new URL('../../stdlib/src/Foundation/Browser/Application/V1/SignedContext.lex.tex', import.meta.url), 'utf8');
  assert.match(source, /\\importmodule\{Foundation\.Crypto\.P256\.Model\}/);
  const model = JSON.parse(/\\semanticdata\{(.*)\}/.exec(source)[1]);
  const key = model.declarations.find(row => row.name === 'signedContextKeyValid');
  assert.equal(key.body.kind, 'and');
  assert.equal(key.body.left.function.name, 'effectSigningGrantValid');
  assert.deepEqual(key.body.right, {arguments: [{kind: 'var', name: 'key'}],
    function: {module: 'Foundation.Crypto.P256.Model', name: 'p256PublicKeyValid'}, kind: 'call'});
  const p = BigInt('0x' + parameters.p), b = BigInt('0x' + parameters.b);
  const independent = key => {
    if (key.length !== 65 || key[0] !== 4) return false;
    const x = BigInt('0x' + Buffer.from(key.subarray(1, 33)).toString('hex'));
    const y = BigInt('0x' + Buffer.from(key.subarray(33)).toString('hex'));
    return x < p && y < p && (y * y - x * x * x + 3n * x - b) % p === 0n;
  };
  for (const key of [publicKey(), otherPublicKey()]) assert.equal(independent(key), true);
  assert.notDeepEqual(publicKey(), otherPublicKey());
  const points = pointCases(), rows = corpus();
  assert.equal(rows.length, 1573);
  assert.equal(points.length, 88);
  for (const row of points) {
    assert.equal(independent(row.key), row.valid, row.id);
    assert.equal(nativePointValid(row.key), row.valid, row.id);
    for (const operation of ['Roundtrip', 'Projection', 'Match', 'Expected'])
      assert.ok(rows.some(value => value.id === 'Point' + operation + row.id));
  }
  assert.deepEqual(points.slice(0, 15).map(row => row.id), oraclePoints().map(row => row.source + row.id));
});

test('validity mutants retain parameter use and exact semantic counterexamples', () => {
  const name = 'Foundation.Browser.Application.V1.SignedContext';
  const original = readFileSync(new URL('../../stdlib/src/' + name.replaceAll('.', '/') + '.lex.tex', import.meta.url));
  const rows = corpus();
  for (const [id, declarationName, probe, request, response] of [
    ['ContextValidity', 'signedContextValid', 'ContextRange2', [1, 0, envelope(context(4))], rejected(0)],
    ['KeyValidity', 'signedContextKeyValid', 'KeyPrefix0', [1, 0, envelope(context(), Uint8Array.from([0, ...publicKey().slice(1)]))], rejected(1)],
  ]) {
    const sources = new Map([[name, original]]);
    mutateSignedContextSource(sources, id);
    const data = JSON.parse(/\\semanticdata\{(.*)\}/.exec(sources.get(name).toString())[1]);
    const declaration = data.declarations.find(row => row.name === declarationName);
    const uses = new Set(), calls = new Set();
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (node.kind === 'var') uses.add(node.name);
      if (node.kind === 'call') calls.add(node.function.name);
      for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(visit) : visit(value);
    }
    visit(declaration.body);
    for (const parameter of declaration.parameters)
      assert.ok(uses.has(parameter.name), id + ' must reach behavior, not LLV7006: ' + parameter.name);
    if (id === 'KeyValidity') assert.ok(calls.has('p256PublicKeyValid'), 'retain exact imported axiom dependencies');
    const row = rows.find(row => row.id === probe);
    assert.deepEqual(row.request, encode(request));
    assert.deepEqual(row.response, encode(response));
    assert.equal(mutations.find(row => row.id === id).probe, probe);
  }
});
