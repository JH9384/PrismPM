import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../', import.meta.url);
const pins = new Map([
  [8949, 'f1164a5b31a39350ad46abe29b83575eb933ca6c45366989c118b6b1058a214a'],
  [8610, '3713f2a50e23a2bea0a6147ad6c4433605a00c3d00a868bfa86a42b204997089'],
  [3629, 'a2a3a39457d30420c812f87a38cc2b9194832f6982ef17e619de7d816879d6a6'],
]);

test('exact RFC authority bytes are retained, including their notices', () => {
  for (const [rfc, hash] of pins) {
    const bytes = readFileSync(new URL(`tests/fixtures/codec/cbor/rfc${rfc}.txt`, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
    assert.match(bytes.toString(), /Copyright/);
  }
});

test('primitive implementation is authored LexLean, with typed cursor results', () => {
  const source = readFileSync(new URL(
    'stdlib/src/Foundation/Codec/Cbor/V1/Primitive.lex.tex', root), 'utf8');
  const line = source.split('\n').find(line => line.startsWith('\\semanticdata{'));
  const model = JSON.parse(line.slice(14, -1));
  assert.equal(model.spec, 'lexlean/semantic-module/1');
  const declarations = new Map(model.declarations.map(row => [row.name, row]));
  assert.equal(declarations.size, model.declarations.length);
  for (const name of ['CborLimits', 'CborDecoded', 'CborArrayHead']) {
    assert.equal(declarations.get(name)?.kind, 'structure', name);
  }
  for (const name of ['CborValue', 'CborError']) {
    assert.equal(declarations.get(name)?.kind, 'inductive', name);
  }
  for (const name of ['readCborPrimitive', 'readCborArrayHead',
    'writeCborPrimitive', 'writeCborArrayHead', 'finishCborCursor',
    'canonicalCborPrimitiveBytes']) {
    const declaration = declarations.get(name);
    assert.equal(declaration?.kind, 'definition', name);
    assert.ok(declaration.body);
  }
  assert.match(source, /\\importmodule\{Foundation\.Codec\}/);
  assert.match(source, /\\importmodule\{Foundation\.Bytes\}/);
});

test('octet oracle independently covers every byte and rejected upper boundaries', () => {
  const source = readFileSync(new URL(
    'stdlib/src/Foundation/Codec/Cbor/V1/PrimitiveCorpus.lex.tex', root), 'utf8');
  const model = JSON.parse(source.split('\n').find(line => line.startsWith('\\semanticdata{')).slice(14, -1));
  const declarations = new Map(model.declarations.map(row => [row.name, row]));
  const actual = [];
  function leaves(expression) {
    if (expression.kind === 'and') { leaves(expression.left); leaves(expression.right); return; }
    assert.equal(expression.kind, 'primitive'); assert.equal(expression.operation, 'equal');
    const [call, expected] = expression.arguments;
    assert.deepEqual(call.function, {module:'Foundation.Codec.Cbor.V1.Primitive', name:'cborOctetBytes'});
    assert.equal(call.arguments.length, 1); assert.equal(call.arguments[0].kind, 'nat');
    assert.equal(expected.kind, 'bytes');
    actual.push([call.arguments[0].value, expected.hex]);
  }
  for (let group = 0; group < 16; group++) leaves(declarations.get('octetLookupChunk' + group).body);
  leaves(declarations.get('octetLookupAbove').body);
  assert.deepEqual(actual, [
    ...Array.from({length:256}, (_, value) => [String(value), value.toString(16).padStart(2, '0')]),
    ...['256','257','511','512','65535','65536','4294967295','4294967296','18446744073709551615'].map(value => [value, '']),
  ]);
  const reached = [];
  function calls(expression) {
    if (expression.kind === 'and') { calls(expression.left); calls(expression.right); return; }
    assert.equal(expression.kind, 'call'); assert.deepEqual(expression.arguments, []);
    reached.push(expression.function.name);
  }
  calls(declarations.get('probeOctetLookup').body);
  assert.deepEqual(reached, [...Array.from({length:16}, (_, i) => 'octetLookupChunk' + i), 'octetLookupAbove']);
  const index = JSON.parse(readFileSync(new URL('stdlib/src/Foundation/Codec/Cbor/V1/primitive-corpus.json', root)));
  const rows = index.cases.filter(row => row.id === 'OctetLookup');
  assert.equal(rows.length, 1); assert.equal(rows[0].count, 256);
  assert.equal(rows[0].root, 'LibraryProbe.Foundation.Codec.Cbor.V1.PrimitiveCorpus.probeOctetLookup');
  assert.equal(index.roots.filter(name => name === rows[0].root).length, 1);
});
