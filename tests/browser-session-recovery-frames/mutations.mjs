// Actual authored-source mutations; surviving compile/proof is mandatory.
import assert from 'node:assert/strict';
const moduleName = 'Foundation.Browser.Application.V1.SessionRecoveryFrames';
const call = (node, name) => node.kind === 'call' && node.function.name === name;
const field = (node, name) => node?.kind === 'project' && node.field === name;
export const mutations = Object.freeze([
  {id: 'state-validation', entry: 'layout', definition: 'writeRecoveryFrameLayout', probe: 'InvalidState',
    match: node => call(node, 'sourceSessionValid')},
  {id: 'pending-custody', entry: 'layout', definition: 'writeRecoveryFrameLayout', probe: 'ClosedPending',
    match: node => node.kind === 'match' && field(node.scrutinee, 'pending')},
  {id: 'prefix-offset', entry: 'layout', definition: 'recoveryFrameLayout', probe: 'Phase0Counter0',
    match: node => node.kind === 'nat' && node.value === '36', replace: () => ({kind: 'nat', value: '35'})},
  {id: 'layout-admission', entry: 'tail', definition: 'writeRecoveryFrameTail', probe: 'LayoutZeroPrefix',
    match: node => call(node, 'recoveryFrameLayoutValid')},
  {id: 'principal-binding', entry: 'tail', definition: 'writeRecoveryFrameTail', probe: 'Principal',
    match: node => node.kind === 'primitive' && node.operation === 'equal' && field(node.arguments[0], 'principal')},
  {id: 'scope-binding', entry: 'tail', definition: 'writeRecoveryFrameTail', probe: 'Scope',
    match: node => node.kind === 'primitive' && node.operation === 'equal' && field(node.arguments[0], 'scope')},
  {id: 'epoch-monotonic', entry: 'tail', definition: 'writeRecoveryFrameTail', probe: 'EpochRollback',
    match: node => node.kind === 'ble' && field(node.left, 'epoch')},
  {id: 'authority-bounds', entry: 'tail', definition: 'writeRecoveryFrameTail', probe: 'EvidenceOver',
    match: node => call(node, 'sourceAuthorityValid')},
  {id: 'execution-change', entry: 'tail', definition: 'writeRecoveryFrameTail', probe: 'SameExecution',
    match: node => node.kind === 'not'},
  {id: 'selector-limit', entry: 'tail', definition: 'writeRecoveryFrameTail', probe: 'SelectorOver',
    match: node => node.kind === 'ble' && field(node.right, 'selectorMaximum')},
  {id: 'presentation-limit', entry: 'tail', definition: 'writeRecoveryFrameTail', probe: 'PresentationOver',
    match: node => call(node, 'sourcePresentationBounded')},
  {id: 'ready-presentation', entry: 'tail', definition: 'writeRecoveryFrameTail', probe: 'ViewPhase',
    match: node => call(node, 'sourceViewValid')},
  {id: 'final-size', entry: 'tail', definition: 'assembleRecoveryFrameTail', probe: 'FinalStateOneOver',
    match: node => node.kind === 'ble' && node.right?.operation === 'subtract'},
  {id: 'authority-span', entry: 'tail', definition: 'assembleRecoveryFrameTail', probe: 'Phase0Counter0',
    match: node => call(node, 'readRecoveryFrameSpan') && node.arguments[1]?.name === 'authorityStart',
    replace: node => ({...structuredClone(node), arguments: [node.arguments[0], node.arguments[2], node.arguments[2]]})},
  {id: 'execution-span', entry: 'tail', definition: 'readRecoveryFrameTail', probe: 'Phase0Counter0',
    match: node => call(node, 'writeRecoveryFrameTail'),
    replace: node => ({...structuredClone(node), arguments: node.arguments.map((value, index) => index === 8 ? node.arguments[7] : value)})},
  {id: 'tail-header-size', entry: 'tail', definition: 'assembleRecoveryFrameTail', probe: 'Phase0Counter0',
    match: node => call(node, 'cborWriteHead'),
    replace: node => ({...structuredClone(node), arguments: [{...structuredClone(node.arguments[0]),
      right: {kind: 'nat', value: '5'}}, ...node.arguments.slice(1)]})},
  ...['Layout', 'Tail'].map(name => ({id: name.toLowerCase() + '-eof', entry: name.toLowerCase(),
    definition: 'readRecoveryFrame' + name, probe: 'Trailing',
    match: node => node.kind === 'beq' && node.right?.kind === 'primitive' && node.right.operation === 'length'})),
]);
export function mutateFramesSource(sources, id) {
  const mutation = mutations.find(value => value.id === id); assert.ok(mutation);
  const text = sources.get(moduleName).toString('utf8'), match = /\\semanticdata\{(.*)\}/.exec(text);
  const model = JSON.parse(match[1]), declaration = model.declarations.find(value => value.name === mutation.definition);
  assert.ok(declaration); let count = 0;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (mutation.match(node)) {
      const changed = mutation.replace ? mutation.replace(node) : {kind: 'or', left: structuredClone(node), right: {kind: 'bool', value: true}};
      for (const key of Object.keys(node)) delete node[key]; Object.assign(node, changed); count++; return;
    }
    for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(walk) : walk(value);
  }
  walk(declaration.body); assert.equal(count, 1, 'exact mutation location ' + id);
  sources.set(moduleName, Buffer.from(text.replace(match[0], '\\semanticdata{' + JSON.stringify(model) + '}')));
  return {id, entry: mutation.entry, probe: mutation.probe};
}
