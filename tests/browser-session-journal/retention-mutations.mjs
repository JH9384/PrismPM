// Source defects must compile and fail the named real native/Wasm oracle.
import assert from 'node:assert/strict';
const module = 'Foundation.Browser.Application.V1.SessionJournalRetention';
export const retentionMutations = Object.freeze([
  {id: 'retention-order', module, definition: 'retentionRefsValid', probe: 'RetentionCommitDuplicateObjects'},
  {id: 'retention-expected', module, definition: 'retentionExpectedHeadFits', probe: 'RetentionStaleExpectedHead'},
  {id: 'retention-root-protection', module, definition: 'retentionRootValid', probe: 'RetentionProtectShared'},
  {id: 'retention-extant', module, definition: 'retentionSubset', probe: 'RetentionMissingRetirement'},
  {id: 'retention-overlap', module, definition: 'retentionDisjoint', probe: 'RetentionAddRetireOverlap'},
  {id: 'retention-count', module, definition: 'retentionFinalize', probe: 'RetentionObject4097Refused'},
  {id: 'retention-trailing', module: module + 'Wire', definition: 'dispatchRetentionWire', probe: 'RetentionWireTrailing'},
  {id: 'retention-range-half', module, definition: 'retentionRefsOrderedTree', probe: 'RetentionUnsortedAt2048'},
  {id: 'retention-reference-head', module: module + 'Wire', definition: 'writeRetentionReference', probe: 'RetentionInitialCreate'},
]);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function mutateRetentionSource(sources, id) {
  const selected = retentionMutations.find(row => row.id === id); assert.ok(selected);
  const original = sources.get(selected.module); assert.ok(Buffer.isBuffer(original));
  const text = original.toString('utf8'), matched = /\\semanticdata\{(.*)\}/.exec(text), model = JSON.parse(matched[1]);
  const declaration = model.declarations.find(row => row.name === selected.definition); assert.ok(declaration?.body);
  let changes = 0;
  if (['retention-count', 'retention-trailing', 'retention-range-half', 'retention-reference-head'].includes(id)) {
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (id === 'retention-reference-head' && value.kind === 'bytes' && value.hex === '5820') {
        value.hex = '5821'; changes++; return;
      }
      const target = id === 'retention-count'
        ? value.kind === 'ble' && value.left?.kind === 'primitive' && value.left.operation === 'length'
          && value.left.arguments?.[0]?.name === 'objects' && value.right?.value === '4096'
        : id === 'retention-range-half' ? value.kind === 'call' && value.function?.name === 'retentionRefsOrderedTree'
          && value.arguments?.[1]?.kind === 'add'
          : id === 'retention-trailing' && value.kind === 'beq' && value.right?.kind === 'primitive' && value.right.operation === 'length'
            && value.right.arguments?.[0]?.kind === 'project' && value.right.arguments[0].field === 'bytes';
      if (target) {
        const prior = structuredClone(value); Object.keys(value).forEach(key => delete value[key]);
        Object.assign(value, {kind: 'or', left: prior, right: {kind: 'bool', value: true}}); changes++; return;
      }
      Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(visit) : visit(child));
    }
    visit(declaration.body); assert.equal(changes, id === 'retention-trailing' ? 2 : 1);
  } else {declaration.body = {kind: 'or', left: declaration.body, right: {kind: 'bool', value: true}}; changes = 1;}
  const next = Buffer.from(text.replace(matched[0], '\\semanticdata{' + JSON.stringify(canonical(model)) + '}'));
  assert.notDeepEqual(next, original); sources.set(selected.module, next);
  return {id, changes, probe: selected.probe, module: selected.module};
}
