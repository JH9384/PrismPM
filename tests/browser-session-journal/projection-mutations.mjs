// Actual modeled-source defects for the private projection owner.
import assert from 'node:assert/strict';
const base = 'Foundation.Browser.Application.V1.';
export const projectionMutations = Object.freeze([
  {id: 'predecessor-eof', module: base + 'SessionJournalProjection', definition: 'projectSessionOperationPredecessor',
    entry: 'predecessor', probes: Array.from({length: 9}, (_, tag) => 'ProjectionTrailingOperation' + tag)},
  {id: 'predecessor-successor', module: base + 'SessionJournalProjection', definition: 'sourceSessionPredecessorBytes',
    entry: 'predecessor', probes: ['ReadOnlyPreservesDurable', 'BeginExact', 'ContinueExact']},
  {id: 'observation-eof', module: base + 'SessionJournalObservation', definition: 'readSessionObservation',
    entry: 'observation', probes: ['ObservationTrailing']},
  {id: 'observation-validity', module: base + 'SessionJournalObservation', definition: 'writeSessionObservation',
    entry: 'observation', probes: ['ObservationInvalidPrincipal', 'ObservationInvalidInstance', 'ObservationInvalidPhase']},
  {id: 'observation-principal', module: base + 'SessionJournalObservation', definition: 'writeSessionObservationValue',
    entry: 'observation', probes: ['ObserveInitialize', 'ObserveBeginExact']},
  {id: 'observation-execution', module: base + 'SessionJournalObservation', definition: 'writeSessionObservationValue',
    entry: 'observation', probes: ['ObserveInitialize', 'ObserveBeginExact']},
  {id: 'observation-command', module: base + 'SessionJournalObservation', definition: 'writeSessionObservationValue',
    entry: 'observation', probes: ['ObserveBeginExact', 'ObserveContinueExact']},
  {id: 'observation-request', module: base + 'SessionJournalObservation', definition: 'writeSessionObservedPending',
    entry: 'observation', probes: ['ObserveBeginExact', 'ObserveContinueExact']},
]);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function mutateProjectionSource(sources, id) {
  const selected = projectionMutations.find(row => row.id === id); assert.ok(selected, 'closed projection mutation');
  const before = sources.get(selected.module); assert.ok(Buffer.isBuffer(before));
  const text = before.toString('utf8'), match = /\\semanticdata\{(.*)\}/.exec(text); assert.ok(match);
  const data = JSON.parse(match[1]), declaration = data.declarations.find(row => row.name === selected.definition);
  assert.ok(declaration?.body); let changed = 0;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    let replacement;
    if (id.endsWith('-eof') && node.kind === 'beq' && node.left?.kind === 'project' && node.left.field === 'cursor'
      && node.right?.kind === 'primitive' && node.right.operation === 'length')
      replacement = {kind: 'or', left: structuredClone(node), right: {kind: 'bool', value: true}};
    if (id === 'observation-validity' && node.kind === 'call' && node.function?.name === 'sourceSessionValid')
      replacement = {kind: 'or', left: structuredClone(node), right: {kind: 'bool', value: true}};
    if (id === 'observation-principal' && node.kind === 'project' && node.field === 'principal')
      replacement = {...node, field: 'scope'};
    if (id === 'observation-execution' && node.kind === 'project' && node.field === 'execution')
      replacement = {kind: 'project', field: 'instance', value: {kind: 'project', field: 'durable', value: {kind: 'var', name: 'value'}}};
    if (id === 'observation-command' && node.kind === 'project' && node.field === 'nextCommand')
      replacement = {kind: 'nat', value: '0'};
    if (id === 'observation-request' && node.kind === 'call' && node.function?.name === 'writeSourceBalancedEffectRequest')
      replacement = {kind: 'call', function: {module: base + 'EffectsWire', name: 'writeEffectWireNat'}, arguments: [{kind: 'nat', value: '0'}]};
    if (replacement) {
      Object.keys(node).forEach(key => delete node[key]); Object.assign(node, replacement); changed++; return;
    }
    Object.values(node).forEach(child => Array.isArray(child) ? child.forEach(visit) : visit(child));
  }
  if (id === 'predecessor-successor') {
    declaration.body = {kind: 'call', function: {module: base + 'SessionWire', name: 'sourceSessionWireBytes'},
      arguments: [{kind: 'var', name: 'input'}]}; changed = 1;
  } else visit(declaration.body);
  assert.equal(changed, id === 'predecessor-eof' ? 9 : 1, 'exact named source defect count');
  const after = Buffer.from(text.replace(match[0], '\\semanticdata{' + JSON.stringify(canonical(data)) + '}'));
  assert.notDeepEqual(after, before); sources.set(selected.module, after);
  return {...selected, changed};
}
