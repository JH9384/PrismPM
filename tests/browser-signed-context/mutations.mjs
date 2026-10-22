// Real source defects; the owning test must compile and execute each mutant.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const model = 'Foundation.Browser.Application.V1.SignedContext';
const wire = model + 'Wire';
const truth = () => ({kind: 'bool', value: true});
const field = (node, name) => node?.kind === 'project' && node.field === name;
const call = (node, name) => node?.kind === 'call' && node.function.name === name;
const byteEquality = (node, name) => node.kind === 'primitive' && node.operation === 'equal' && field(node.arguments[0], name);
const scalarEquality = (node, name) => node.kind === 'beq' && field(node.left, name);
const rules = [
  ['BindingMatch', 'BindingMismatch5', model, 'signedContextEqual', node => call(node, 'sourceBindingEqual'), truth],
  ...[['origin', 1], ['subject', 3], ['scope', 4], ['state', 5], ['request', 6], ['challenge', 8]]
    .map(([name, index]) => [name + 'Match', 'ContextMismatch' + index, model, 'signedContextEqual', node => byteEquality(node, name), truth]),
  ...[['purpose', 2], ['credentialEpoch', 7]]
    .map(([name, index]) => [name + 'Match', 'ContextMismatch' + index, model, 'signedContextEqual', node => scalarEquality(node, name), truth]),
  // Retain live parameters and actual imported axiom dependencies so the
  // counterexample reaches behavior rather than source-policy rejection.
  ['ContextValidity', 'ContextRange2', model, 'signedContextValid', node => node.kind === 'ble'
    && field(node.left, 'purpose') && node.right.kind === 'nat' && node.right.value === '3',
    node => ({...node, right: {kind: 'nat', value: '4'}})],
  ['KeyValidity', 'KeyPrefix0', model, 'signedContextKeyValid', () => true,
    node => ({kind: 'or', left: node, right: {kind: 'and',
      left: {kind: 'beq', left: {kind: 'primitive', operation: 'length',
        arguments: [{kind: 'var', name: 'key'}], result: {kind: 'nat'}}, right: {kind: 'nat', value: '65'}},
      right: {kind: 'ble', left: {kind: 'var', name: 'purpose'}, right: {kind: 'nat', value: '3'}}}}), 1, true],
  ['CurveMembership', 'PointMatchFormerShapeOnlyFixture', model, 'signedContextKeyValid',
    node => node.kind === 'and' && call(node.right, 'p256PublicKeyValid'),
    node => ({...node, kind: 'or'})],
  ['SignatureWidth', 'SignatureWidth63', model, 'matchSignedContext', node => node.kind === 'beq'
    && node.left.kind === 'primitive' && node.left.operation === 'length' && field(node.left.arguments[0], 'signature'), truth],
  ['ExpectedKey', 'KeyMismatch', model, 'matchSignedContext', node => node.kind === 'primitive'
    && node.operation === 'equal' && node.arguments[0]?.kind === 'var' && node.arguments[0].name === 'key', truth],
  ...['account-binding', 'account-request', 'organization-approval', 'session-journal-context']
    .map((name, index) => ['Domain' + index, `Projection${index}_4294967295`, model, 'signedContextSigningContext',
      node => node.kind === 'string' && node.value === 'prismpm/' + name + '/1',
      () => ({kind: 'string', value: 'prismpm/incorrect-domain/1'})]),
  ['UnsignedVersion', 'Projection0_4294967295', wire, 'writeSignedContextUnsigned', node => node.kind === 'nat' && node.value === '1',
    () => ({kind: 'nat', value: '2'})],
  ['ProjectionKey', 'Projection0_4294967295', wire, 'writeSignedContextProjection', node => field(node, 'publicKey'),
    node => ({...node, field: 'signature'})],
  ['ProjectionSignature', 'Projection0_4294967295', wire, 'writeSignedContextProjection', node => field(node, 'signature'),
    node => ({...node, field: 'publicKey'})],
  ['EndOfInput', 'Trailing', wire, 'dispatchSignedContext', node => node.kind === 'beq'
    && node.right.kind === 'primitive' && node.right.operation === 'length', truth, 2],
  ['Version', 'Version', wire, 'readSignedContextRequest', node => node.kind === 'beq'
    && field(node.left, 'value') && node.right.kind === 'nat' && node.right.value === '1', truth],
  ['FrameCap', 'FrameOverflow', wire, 'signedContextWireBytes', node => node.kind === 'ble'
    && node.left.kind === 'primitive' && node.left.arguments[0]?.name === 'input',
    node => ({...node, right: {kind: 'nat', value: '2049'}})],
];
export const mutations = Object.freeze(rules.map(([id, probe]) => Object.freeze({id, probe})));
export function mutateSignedContextSource(sources, id) {
  const rule = rules.find(row => row[0] === id); assert.ok(rule, 'closed source mutation');
  const [, probe, module, name, predicate, replacement, expected = 1, rootOnly = false] = rule;
  const before = sources.get(module), text = before.toString('utf8'), original = /\\semanticdata\{(.*)\}/.exec(text);
  const value = JSON.parse(original[1]), declaration = value.declarations.find(row => row.name === name); assert.ok(declaration);
  let count = 0;
  function walk(node) {
    if (!node || typeof node !== 'object') return node;
    if (predicate(node)) {count++; return replacement(node);}
    return Array.isArray(node) ? node.map(walk) : Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
  }
  if (rootOnly) {count = 1; declaration.body = replacement(declaration.body);}
  else declaration.body = walk(declaration.body);
  assert.equal(count, expected, 'one exact declared source defect ' + id);
  const canonical = node => Array.isArray(node) ? node.map(canonical)
    : node && typeof node === 'object'
      ? Object.fromEntries(Object.keys(node).sort().map(key => [key, canonical(node[key])])) : node;
  const after = Buffer.from(text.replace(original[0], '\\semanticdata{' + JSON.stringify(canonical(value)) + '}'));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.notEqual(sha(before), sha(after)); sources.set(module, after);
  return Object.freeze({id, probe, module, declaration: name, before: sha(before), after: sha(after)});
}
