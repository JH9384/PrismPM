// Planted source defects. Acceptance requires real compilation and behavioral
// refusal failures; successfully editing this AST is not mutation evidence.
import assert from 'node:assert/strict';
const model = 'Foundation.Browser.Application.V1.SessionJournal';
export const metadataMutations = Object.freeze([
  {id: 'metadata-binding', module: model, definition: 'sessionJournalBindingEqual', probe: 'MetadataChangedBinding2'},
  {id: 'metadata-transition', module: model, definition: 'sessionJournalTransitionValid', probe: 'MetadataBeginWhileBusy'},
  {id: 'metadata-epoch', module: model, definition: 'sessionJournalEpochValid', probe: 'MetadataOrdinaryEpochAdvance'},
  {id: 'metadata-frontier', module: model, definition: 'sessionJournalFrontierValid', probe: 'MetadataCheckpointFrontierRequired'},
  {id: 'metadata-recovery', module: model, definition: 'sessionJournalRecoveryFits', probe: 'MetadataRecoveryLinkMismatchUnknown0'},
  {id: 'metadata-anchor', module: model, definition: 'sessionJournalAnchorFits', probe: 'MetadataMissingAnchor'},
  {id: 'metadata-trailing', module: model + 'Wire', definition: 'dispatchSessionJournalWire', probe: 'MetadataWireTrailing'},
]);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function mutateMetadataSource(sources, id) {
  const selected = metadataMutations.find(row => row.id === id); assert.ok(selected, 'closed metadata mutation');
  const before = sources.get(selected.module); assert.ok(Buffer.isBuffer(before));
  const text = before.toString('utf8'), matched = /\\semanticdata\{(.*)\}/.exec(text); assert.ok(matched);
  const data = JSON.parse(matched[1]), declaration = data.declarations.find(row => row.name === selected.definition);
  assert.ok(declaration?.body); let changed = 0;
  if (id === 'metadata-trailing') {
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (value.kind === 'beq' && value.right?.kind === 'primitive' && value.right.operation === 'length'
        && value.right.arguments?.[0]?.kind === 'project' && value.right.arguments[0].field === 'bytes') {
        const original = structuredClone(value); Object.keys(value).forEach(key => delete value[key]);
        Object.assign(value, {kind: 'or', left: original, right: {kind: 'bool', value: true}}); changed++; return;
      }
      Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(visit) : visit(child));
    }
    visit(declaration.body); assert.equal(changed, 6, 'one EOF guard for each actual protocol entry');
  } else {
    declaration.body = {kind: 'or', left: declaration.body, right: {kind: 'bool', value: true}}; changed = 1;
  }
  const after = Buffer.from(text.replace(matched[0], '\\semanticdata{' + JSON.stringify(canonical(data)) + '}'));
  assert.notDeepEqual(after, before); sources.set(selected.module, after);
  return {id, module: selected.module, definition: selected.definition, probe: selected.probe, changed};
}
