// Translate explicit expected cases, never evaluate the implementation under test.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const module = 'Foundation.Native.Application.V1.Lease';
export const directory = new URL('../../stdlib/src/Foundation/Native/Application/V1/', import.meta.url);
export const errors = ['BadState', 'ClockRegression', 'Closed', 'Busy', 'Exhausted', 'BadRequest',
  'Expired', 'NoPending', 'BadBinding', 'CancellationRequired', 'CleanupRequired'];
const references = ['application', 'manifest', 'session', 'resource'];
const named = name => ({kind: 'named', member: {module, name}, arguments: []});
const natural = value => {
  assert.match(value, /^(0|[1-9][0-9]*)$/);
  assert(BigInt(value) <= 18446744073709551615n);
  return {kind: 'nat', value};
};
const bytes = hex => {assert.match(hex, /^(?:[0-9a-f]{2})*$/); return {kind: 'bytes', hex};};
const boolean = value => {assert.equal(typeof value, 'boolean'); return {kind: 'bool', value};};
const variable = name => ({kind: 'var', name});
const project = (value, field) => ({kind: 'project', value, field});
const equal = (left, right) => ({kind: 'primitive', operation: 'equal', result: {kind: 'bool'}, arguments: [left, right]});
const all = values => values.reduceRight((right, left) => ({kind: 'and', left, right}), boolean(true));
const branch = (name, binders, body, owner) => ({constructor: {...(owner ? {module: owner} : {}), name}, binders, body});
const match = (scrutinee, branches) => ({kind: 'match', scrutinee, branches});
const constructor = (name, args, type_arguments) => ({kind: 'constructor', constructor: {name}, arguments: args, type_arguments});
const record = (name, fields) => ({kind: 'record', type: {module, name},
  fields: Object.entries(fields).map(([field, value]) => ({field, value}))});
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
function binding(value) {
  keys(value, [...references, 'operation', 'requestDigest', 'deadline']);
  return record('NativeLeaseBinding', Object.fromEntries([...references, 'operation', 'requestDigest', 'deadline']
    .map(key => [key, ['operation', 'deadline'].includes(key) ? natural(value[key]) : bytes(value[key])])));
}
function lease(value) {
  keys(value, ['binding', 'cancelled', 'uncertain']);
  return record('NativeLease', {binding: binding(value.binding), cancelled: boolean(value.cancelled), uncertain: boolean(value.uncertain)});
}
function lane(value) {
  keys(value, [...references, 'nextOperation', 'observed', 'closed', 'active']);
  return record('NativeLane', {...Object.fromEntries(references.map(key => [key, bytes(value[key])])),
    nextOperation: natural(value.nextOperation), observed: natural(value.observed), closed: boolean(value.closed),
    active: constructor(value.active === null ? 'Option.none' : 'Option.some', value.active === null ? [] : [lease(value.active)], [named('NativeLease')])});
}
function expectedState(actual, value) {
  lane(value); // Check the complete expected shape independently of the model.
  return all([...references.map(key => equal(project(actual, key), bytes(value[key]))),
    equal(project(actual, 'nextOperation'), natural(value.nextOperation)), equal(project(actual, 'observed'), natural(value.observed)),
    equal(project(actual, 'closed'), boolean(value.closed)), match(project(actual, 'active'), [
      branch('Option.none', [], boolean(value.active === null)),
      branch('Option.some', ['lease'], value.active === null ? boolean(false) : all([
        ...[...references, 'operation', 'requestDigest', 'deadline'].map(key => equal(project(project(variable('lease'), 'binding'), key),
          ['operation', 'deadline'].includes(key) ? natural(value.active.binding[key]) : bytes(value.active.binding[key]))),
        equal(project(variable('lease'), 'cancelled'), boolean(value.active.cancelled)),
        equal(project(variable('lease'), 'uncertain'), boolean(value.active.uncertain))]))])]);
}
export function corpusModule(index) {
  keys(index, ['schema', 'cases']);
  assert.equal(index.schema, 'prismpm/internal-native-lease-corpus/1');
  assert(Array.isArray(index.cases) && index.cases.length > 0 && index.cases.length < 1000);
  const names = new Set();
  const declarations = index.cases.map((row, position) => {
    keys(row, ['name', 'method', 'args', 'expected']);
    assert.match(row.name, /^[A-Za-z][A-Za-z0-9_]*$/); assert(!names.has(row.name)); names.add(row.name);
    const args = row.args;
    let arguments_;
    switch (row.method) {
      case 'openNativeLane': assert.equal(args.length, 4); arguments_ = args.map(bytes); break;
      case 'beginNativeLease': assert.equal(args.length, 4); arguments_ = [lane(args[0]), bytes(args[1]), natural(args[2]), natural(args[3])]; break;
      case 'cancelNativeLease': case 'closeNativeLane':
        assert.equal(args.length, 2); arguments_ = [lane(args[0]), natural(args[1])]; break;
      case 'completeNativeLease': case 'retainUnknownNativeCleanup': case 'retireCancelledNativeLease':
        assert.equal(args.length, 3); arguments_ = [lane(args[0]), binding(args[1]), natural(args[2])]; break;
      default: assert.fail('unregistered lifecycle method');
    }
    const success = Object.hasOwn(row.expected, 'state');
    keys(row.expected, [success ? 'state' : 'error']);
    if (!success) assert(errors.includes(row.expected.error));
    return {kind: 'definition', name: `probe${String(position).padStart(3, '0')}`, parameters: [], result: {kind: 'bool'}, axioms: [],
      body: match({kind: 'call', function: {module, name: row.method}, arguments: arguments_}, [
        branch('Result.ok', ['actual'], success ? expectedState(variable('actual'), row.expected.state) : boolean(false)),
        branch('Result.error', ['error'], match(variable('error'), errors.map(name =>
          branch(`NativeLeaseError.${name}`, [], boolean(name === row.expected.error), module))))])};
  });
  return {declarations, spec: 'lexlean/semantic-module/1'};
}
export function canonical(value) {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
export function corpusSource(index) {
  return `\\begin{lexlean}{${module}Corpus}\n\\useglossary{lexlean.std.bool@1.1.0}\n\\useglossary{lexlean.std.nat@1.1.0}\n`
    + `\\importmodule{${module}}\n\\title{Natural number}\n\\begin{semanticmodule}\n`
    + `\\semanticdata{${JSON.stringify(canonical(corpusModule(index)))}}\n\\end{semanticmodule}\n\\end{lexlean}\n`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--write'));
  const source = corpusSource(JSON.parse(readFileSync(new URL('lease-corpus.json', directory), 'utf8')));
  const destination = new URL('LeaseCorpus.lex.tex', directory);
  if (process.argv[2] === '--write') writeFileSync(destination, source);
  else assert.equal(readFileSync(destination, 'utf8'), source, 'complete explicit corpus differs from LexLean probes');
}
