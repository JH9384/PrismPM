// Test-only semantic mutations. Each changes an actual source guard; the
// owning gate must rebuild through LexLean, kernel audit and lean4-prod.
import assert from 'node:assert/strict';

const SM = 'Foundation.Browser.Application.V1.Session';
const SW = SM + 'Wire';
export const mutations = Object.freeze([
  {id: 'source-policy', module: 'Fixture', declaration: 'fixtureSourceAuthority', vector: 'SourcePolicyRejects0', fixture: true},
  {id: 'selected-secret', module: SM, declaration: 'readOnlySourceSession', call: 'intentRequiresSecret', value: false, vector: 'ExactSelectedSecretRefused'},
  {id: 'full-predecessor', module: SM, declaration: 'beginSourceCommand', call: 'sourceSessionEqual', vector: 'BeforeInstance'},
  {id: 'contextual-command', module: SM, declaration: 'sourceCompletionFits', call: 'sourceCommandEqual', vector: 'ABAEarlierCommandEnvelopeRejected'},
  {id: 'continuation-predecessor', module: SM, declaration: 'sourcePredecessorFits', vector: 'ContinueContinuation'},
  {id: 'effect-admission', module: SM, declaration: 'sourcePlanBound', call: 'effectRequestValid', vector: 'RequestAdmissionApplication'},
  {id: 'future-frame-reservation', module: SM, declaration: 'sourceEffectAdmissionFits', vector: 'FrameReservationOneOver1-0'},
  {id: 'effect-counter-reservation', module: SM, declaration: 'beginSourceCommand', counter: 'nextEffect', vector: 'EffectReservationOverflow'},
  {id: 'revision-reservation', module: SM, declaration: 'beginSourceCommand', counter: 'revision', vector: 'RevisionReservationOverflow'},
  {id: 'state-size', module: SM, declaration: 'sourceStateWireSize', size: true, vector: 'FrameReservationCurrentOneOver'},
  {id: 'command-size', module: SM, declaration: 'sourceCommandWireSize', size: true, vector: 'FrameReservationCurrentOneOver'},
  {id: 'evidence-size', module: SM, declaration: 'sourceAuthorityWireSize', size: true, vector: 'FrameReservationCurrentOneOver'},
  {id: 'request-size', module: SM, declaration: 'sourceEncodedRequestLength', size: true, vector: 'FrameReservationCurrentOneOver'},
  {id: 'result-size', module: SM, declaration: 'sourceRequestResultMaximum', size: true, vector: 'FrameReservationCurrentOneOver'},
  {id: 'inner-consumption', module: SW, declaration: 'readSourceIntent', inner: true, vector: 'EmbeddedIntentTrailing'},
  {id: 'reference-canonicality', module: SW, declaration: 'readReferenceState', reference: true, vector: 'PlanBeforeExplicitEqual'},
  {id: 'presentation-budget', module: SM, declaration: 'sourceNextViewValid', call: 'sourcePresentationBounded', vector: 'ReadOnlyPresentationBudget'},
  {id: 'unknown-retention', module: SM, declaration: 'unknownSourceCommand', retention: true, vector: 'UnknownRetainsPending'},
  {id: 'close-retention', module: SM, declaration: 'closeSourceSession', retention: true, vector: 'CloseRetainsPending'},
  {id: 'step-reservation', module: SM, declaration: 'continueSourceCommand', step: true, vector: 'MaximumStepsOneOver'},
  {id: 'reply-budget', module: SM, declaration: 'sourceCheckedReply', reply: true, vector: 'ApplicationOneOverReply', maximum: true},
]);

function transform(node, predicate, replacement) {
  if (!node || typeof node !== 'object') return 0;
  if (predicate(node)) {
    const next = replacement(structuredClone(node));
    for (const key of Object.keys(node)) delete node[key];
    Object.assign(node, next); return 1;
  }
  return Object.values(node).reduce((count, value) => count + (Array.isArray(value)
    ? value.reduce((sum, child) => sum + transform(child, predicate, replacement), 0)
    : transform(value, predicate, replacement)), 0);
}
const bypass = (original, value = true) => ({kind: value ? 'or' : 'and', left: original, right: {kind: 'bool', value}});
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function mutateSource(sources, id) {
  const mutation = mutations.find(row => row.id === id); assert.ok(mutation, 'closed source mutation inventory');
  const text = sources.get(mutation.module).toString('utf8'), match = /\\semanticdata\{(.*)\}/.exec(text);
  assert.ok(match); const model = JSON.parse(match[1]);
  const declaration = model.declarations.find(row => row.name === mutation.declaration);
  assert.equal(declaration?.kind, 'definition');
  if (mutation.call) {
    assert.equal(transform(declaration.body, row => row.kind === 'call' && row.function.name === mutation.call,
      original => bypass(original, mutation.value ?? true)), 1, id + ' exact guard site');
  } else if (mutation.counter) {
    const contains = (node, field) => JSON.stringify(node).includes('"field":"' + field + '"');
    assert.equal(transform(declaration.body, row => row.kind === 'ble' && row.right?.kind === 'nat' && row.right.value === '4294967295'
      && contains(row.left, mutation.counter) && contains(row.left, 'maximumSteps'), original => bypass(original)), 1, id + ' exact reservation');
  } else if (mutation.size) {
    assert.equal(declaration.result.kind, 'nat');
    // Evaluate the complete original fold (preserving its imports/axioms),
    // then erase only the measured contribution from aggregate accounting.
    declaration.body = {kind: 'match', scrutinee: {kind: 'ble', left: declaration.body, right: {kind: 'nat', value: '67108864'}},
      branches: [false, true].map(value => ({constructor: {name: 'Bool.' + value}, binders: [], body: {kind: 'nat', value: '0'}}))};
  } else if (mutation.retention) {
    assert.equal(transform(declaration.body, row => row.kind === 'record' && row.type.name === 'SourceSession', original => {
      const durable = original.fields.find(field => field.field === 'durable'); assert.ok(durable);
      const fields = ['instance', 'nextCommand', 'application', 'authority'].map(field => ({field,
        value: {kind: 'project', value: structuredClone(durable.value), field}}));
      fields.push({field: 'pending', value: {kind: 'constructor', constructor: {name: 'Option.none'}, arguments: [],
        type_arguments: [{kind: 'named', member: {name: 'SourcePending'}, arguments: []}]}});
      durable.value = {kind: 'record', type: {name: 'SourceDurable'}, fields}; return original;
    }), 1, id + ' exact retained state');
  } else if (mutation.step) {
    assert.equal(transform(declaration.body, row => row.kind === 'blt' && row.left?.field === 'step' && row.right?.field === 'maximumSteps',
      original => bypass(original)), 1, id + ' exact step guard');
  } else if (mutation.reply) {
    assert.equal(transform(declaration.body, row => row.kind === 'ble' && JSON.stringify(row.left).includes('"name":"sourceStateWireSize"'),
      original => bypass(original)), 1, id + ' exact reply guard');
  } else if (mutation.inner) {
    assert.equal(transform(declaration.body, row => row.kind === 'beq' && row.right?.kind === 'primitive' && row.right.operation === 'length',
      original => bypass(original)), 1, id + ' exact embedded consumption');
  } else if (mutation.reference) {
    // The explicit-value path rejects equality to the unique admitted context.
    assert.equal(transform(declaration.body, row => row.kind === 'match' && row.scrutinee?.kind === 'var' && row.scrutinee.name === 'expected'
      && row.branches.find(branch => branch.constructor.name === 'Option.none')?.body.kind === 'bool',
      original => bypass(original)), 1, id + ' exact explicit reference guard');
  } else {
    assert.equal(declaration.result.kind, 'bool'); declaration.body = bypass(declaration.body);
  }
  // Preserve all original evaluated terms/imported axiom dependencies. The
  // mutation must reach generated behavior, not merely fail a source audit.
  sources.set(mutation.module, Buffer.from(text.replace(match[0], '\\semanticdata{' + JSON.stringify(canonical(model)) + '}')));
  return mutation;
}
