import assert from 'node:assert/strict';

export const mutationNames = Object.freeze(['duplicate', 'name-limit', 'selection', 'aggregate', 'semantic-field', 'size']);
const visit = (value, fn) => {
  if (!value || typeof value !== 'object') return;
  if (fn(value) === false) return;
  Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(item => visit(item, fn)) : visit(child, fn));
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function mutateSources(sources, kind) {
  assert.ok(mutationNames.includes(kind), 'closed source mutation');
  const name = kind === 'size' ? 'Foundation.Browser.Application.V1.Session'
    : 'Foundation.View.Browser.V1.' + (kind === 'semantic-field' ? 'Semantics' : 'Model');
  const source = sources.get(name).toString('utf8'), match = /\\semanticdata\{(.*)\}/.exec(source);
  const model = JSON.parse(match[1]);
  const selected = model.declarations.find(declaration => declaration.name === ({
    duplicate: 'textChoicesValid', 'name-limit': 'textChoicesValid', selection: 'fieldValueFits',
    aggregate: 'nodesValid', 'semantic-field': 'fieldKind', size: 'sourceViewSizeTextChoiceInto',
  }[kind]));
  assert.ok(selected, 'actual modeled guard declaration'); let changed = 0;
  visit(selected.body, value => {
    if (kind === 'duplicate' && value.kind === 'not' && value.value?.function?.name === 'textChoiceExists') {
      const original = structuredClone(value);
      Object.keys(value).forEach(key => delete value[key]);
      Object.assign(value, {kind: 'or', left: original, right: {kind: 'bool', value: true}}); changed++;
      return false;
    } else if (kind === 'name-limit' && value.kind === 'ble' && value.right?.value === '4096') {
      value.right.value = '4097'; changed++;
    } else if (kind === 'selection' && value.kind === 'call' && value.function?.name === 'textChoiceExists') {
      const original = structuredClone(value);
      Object.keys(value).forEach(key => delete value[key]);
      Object.assign(value, {kind: 'or', left: original, right: {kind: 'bool', value: true}}); changed++;
      return false;
    } else if (kind === 'aggregate' && value.kind === 'ble' && value.right?.value === '256'
      && value.left?.kind === 'var' && value.left.name === 'choices') {
      value.right.value = '257'; changed++;
    } else if (kind === 'semantic-field' && value.kind === 'beq' && value.right?.value === '11') {
      value.right.value = '255'; changed++;
    } else if (kind === 'size' && value.kind === 'call' && value.function?.name === 'sourceViewSizeText') {
      value.arguments[0] = {kind: 'string', value: 'x'}; changed++;
    }
  });
  assert.equal(changed, 1, 'one intended actual source guard mutation ' + kind);
  const output = Buffer.from(source.replace(match[0], '\\semanticdata{' + JSON.stringify(canonical(model)) + '}'));
  assert.notDeepEqual(output, sources.get(name)); sources.set(name, output);
}
