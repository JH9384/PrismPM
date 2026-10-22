import assert from 'node:assert/strict';
const moduleName = 'Foundation.Holo.V1.PrimaryWire';
export const mutations = Object.freeze([
  {id:'manifest-length', probe:'ValidManifest'},
  {id:'capability-content', probe:'NonemptyOrCorruptCapabilityRequest'},
  {id:'guest-reference', probe:'AbsentGuestReference'},
  {id:'sorted-blobs', probe:'BlobOrder102'},
  {id:'extension-key', probe:'ForeignExtension3'},
  {id:'footer-width', probe:'FooterWidth31'},
  {id:'section-rows', probe:'Row1kind'},
]);
export function mutationProbes(rows) {
  assert.ok(Array.isArray(rows), 'actual codec corpus required');
  return mutations.map(mutation => {
    const selected = rows.filter(row => row.id === mutation.probe);
    assert.equal(selected.length, 1, 'exact codec probe for ' + mutation.id);
    return selected[0];
  });
}
function visit(value, rewrite) {
  if (Array.isArray(value)) return value.map(item => visit(item, rewrite));
  if (!value || typeof value !== 'object') return value;
  return rewrite(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, rewrite)])));
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
}
export function mutateSource(sources, id) {
  const mutation = mutations.find(item => item.id === id); assert.ok(mutation);
  const original = sources.get(moduleName).toString('utf8');
  const data = JSON.parse(/\\semanticdata\{(.*)\}/.exec(original)[1]);
  let changes = 0;
  const declaration = name => {const value = data.declarations.find(item => item.name === name); assert.ok(value); return value;};
  const change = (name, fn) => {const d = declaration(name); d.body = visit(d.body, value => {
    const changed = fn(value); if (changed !== value) changes++; return changed;
  });};
  if (id === 'manifest-length') change('primaryValidAppManifest', value => value.kind === 'nat' && value.value === '258' ? {...value, value:'259'} : value);
  if (id === 'capability-content') change('primaryWirePayloadsValid', value => value.kind === 'call' && value.function.name === 'primaryWireCapabilitiesPresent'
    ? {...value, function:{name:'primaryWireReferencePresent'}} : value);
  if (id === 'guest-reference') change('primaryWirePayloadsValid', value => value.kind === 'call' && value.function.name === 'primaryWireReferencePresent'
    ? {kind:'bool',value:true} : value);
  if (id === 'sorted-blobs') change('primaryWireBlobsValid', value => value.kind === 'call' && value.function.name === 'wireBytesLess'
    && value.arguments[0].arguments[0].name === 'blob0' ? {kind:'bool',value:true} : value);
  if (id === 'extension-key') change('primaryWireBodyPayloadsValid', value => value.kind === 'call' && value.function.name === 'wireWindowEquals'
    && value.arguments[3].function?.name === 'primaryWireProvenancePrefix' ? {kind:'bool',value:true} : value);
  if (id === 'footer-width') change('primaryFrameArchive', value => value.kind === 'nat' && value.value === '32' ? {...value,value:'31'} : value);
  if (id === 'section-rows') change('primaryValidArchiveBody', value => value.kind === 'call' && value.function.name === 'wireRowsValid'
    ? {kind:'bool',value:true} : value);
  assert.equal(changes, 1, 'exactly one genuine authored source mutation');
  sources.set(moduleName, Buffer.from(original.replace(/\\semanticdata\{.*\}/,
    () => '\\semanticdata{' + JSON.stringify(canonical(data)) + '}')));
  return mutation;
}
