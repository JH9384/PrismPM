// Closed, actual authored-source mutations; compilation and behavioral failure
// are required. Editing an AST alone is never a successful oracle receipt.
import assert from 'node:assert/strict';
import {metadataMutations, mutateMetadataSource} from '../browser-session-journal/metadata-mutations.mjs';
const module = 'Foundation.Browser.Application.V1.SessionJournalRecovery';
const model = 'recoverQuiescentSourceSession';
export const recoveryMutations = Object.freeze([
  {id: 'recovery-principal', definition: 'sourceRecoveryAuthorityFits', field: 'principal', probe: 'Principal'},
  {id: 'recovery-scope', definition: 'sourceRecoveryAuthorityFits', field: 'scope', probe: 'Scope'},
  {id: 'recovery-epoch', definition: 'sourceRecoveryAuthorityFits', epoch: true, probe: 'EpochRollback'},
  {id: 'recovery-evidence', definition: 'sourceRecoveryAuthorityFits', call: 'sourceAuthorityValid', probe: 'EvidenceOver'},
  {id: 'recovery-state', definition: model, call: 'sourceSessionValid', probe: 'InvalidPredecessor'},
  {id: 'recovery-pending', definition: model, pending: true, probe: 'ClosedPendingCannotRecoverWithoutTerminal'},
  {id: 'recovery-execution', definition: model, execution: true, probe: 'SameExecution'},
  {id: 'recovery-selector', definition: model, selector: true, probe: 'SelectorOver'},
  {id: 'recovery-view', definition: model, call: 'sourceViewValid', probe: 'ViewPhase'},
  {id: 'recovery-presentation', definition: model, call: 'sourcePresentationBounded', probe: 'PresentationOver'},
  {id: 'recovery-reset', definition: model, reset: true, probe: 'MaximumCountersResetOnlyVolatile'},
  {id: 'recovery-trailing', definition: 'readRecoveryOperation', trailing: true, probe: 'ReadyNewEpochTrailing'},
  {id: 'context-state', definition: 'writeRecoveryContext', call: 'sourceSessionValid', entry: 'context', probe: 'InvalidContextPredecessor'},
  {id: 'context-binding', definition: 'writeRecoveryContextValue', context: true, entry: 'context', probe: 'ContextBindsApplication'},
  {id: 'context-trailing', definition: 'readRecoveryContext', trailing: true, entry: 'context', probe: 'PreparedContextTrailing'},
  {id: 'metadata-parse-order', module: 'Foundation.Browser.Application.V1.SessionJournalWire', definition: 'readSessionJournalEntryTree',
    parseOrder: true, entry: 'metadata', probe: 'MetadataTraversalCount5'},
  {id: 'metadata-replay-half', module: 'Foundation.Browser.Application.V1.SessionJournal', definition: 'replaySessionJournalTree',
    skipHalf: true, entry: 'metadata', probe: 'MetadataTraversalCount5'},
].map(row => Object.freeze({module, entry: 'recovery', ...row})));
export const componentMutations = Object.freeze([...recoveryMutations,
  ...metadataMutations.map(row => Object.freeze({...row, entry: 'metadata'}))]);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const bypass = original => ({kind: 'or', left: original, right: {kind: 'bool', value: true}});
function transform(node, predicate, replacement) {
  if (!node || typeof node !== 'object') return 0;
  if (predicate(node)) {
    const next = replacement(structuredClone(node)); Object.keys(node).forEach(key => delete node[key]);
    Object.assign(node, next); return 1;
  }
  return Object.values(node).reduce((sum, child) => sum + (Array.isArray(child)
    ? child.reduce((count, value) => count + transform(value, predicate, replacement), 0)
    : transform(child, predicate, replacement)), 0);
}
export function mutateComponentSource(sources, id) {
  const mutation = componentMutations.find(row => row.id === id); assert.ok(mutation, 'closed compiled mutation identity');
  if (metadataMutations.some(row => row.id === id)) return {...mutateMetadataSource(sources, id), entry: 'metadata'};
  const before = sources.get(mutation.module); assert.ok(Buffer.isBuffer(before));
  const text = before.toString('utf8'), matched = /\\semanticdata\{(.*)\}/.exec(text); assert.ok(matched);
  const data = JSON.parse(matched[1]), declaration = data.declarations.find(row => row.name === mutation.definition);
  assert.equal(declaration?.kind, 'definition');
  let predicate, replacement = bypass;
  if (mutation.field) predicate = row => row.kind === 'primitive' && row.operation === 'equal' && row.arguments[0]?.field === mutation.field;
  else if (mutation.epoch) predicate = row => row.kind === 'ble' && row.left?.field === 'epoch' && row.right?.field === 'epoch';
  else if (mutation.call) predicate = row => row.kind === 'call' && row.function.name === mutation.call;
  else if (mutation.pending) predicate = row => row.kind === 'match' && row.scrutinee?.field === 'pending';
  else if (mutation.execution) predicate = row => row.kind === 'not' && row.value?.kind === 'primitive' && row.value.operation === 'equal' && row.value.arguments[0]?.name === 'execution';
  else if (mutation.selector) predicate = row => row.kind === 'ble' && row.right?.field === 'selectorMaximum';
  else if (mutation.trailing) predicate = row => row.kind === 'beq' && row.right?.kind === 'primitive' && row.right.operation === 'length' && row.right.arguments[0]?.field === 'bytes';
  else if (mutation.reset) {
    predicate = row => row.kind === 'record' && row.type.name === 'SourceVolatile';
    replacement = original => {
      const field = original.fields.find(row => row.field === 'nextEffect'); assert.ok(field);
      field.value = {kind: 'project', field: 'nextEffect', value: {kind: 'project', field: 'volatile', value: {kind: 'var', name: 'state'}}};
      return original;
    };
  } else if (mutation.context) {
    predicate = row => row.kind === 'record' && row.type.name === 'SourceStatePieces';
    replacement = original => {
      const target = original.fields.find(row => row.field === 'application');
      target.value = structuredClone(original.fields.find(row => row.field === 'evidence').value); return original;
    };
  } else if (mutation.parseOrder) {
    predicate = row => row.kind === 'primitive' && row.operation === 'append';
    replacement = original => ({...original, arguments: original.arguments.toReversed()});
  } else if (mutation.skipHalf) {
    predicate = row => row.kind === 'call' && row.function.name === 'replaySessionJournalTree' && row.arguments[1]?.name === 'right';
    replacement = () => ({kind: 'constructor', constructor: {name: 'Result.ok'}, arguments: [{kind: 'var', name: 'next'}],
      type_arguments: ['SessionJournalState', 'SessionJournalError'].map(name => ({kind: 'named', member: {name}, arguments: []}))});
  } else throw Error('unimplemented closed source mutation');
  const changed = transform(declaration.body, predicate, replacement); assert.equal(changed, 1, id + ' exact source site');
  const after = Buffer.from(text.replace(matched[0], '\\semanticdata{' + JSON.stringify(canonical(data)) + '}'));
  assert.notDeepEqual(after, before); sources.set(mutation.module, after); return {...mutation, changed};
}
