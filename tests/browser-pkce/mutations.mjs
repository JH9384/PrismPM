import assert from 'node:assert/strict';

export const sourceMutations = Object.freeze([
  {id: 'length', declaration: 'pkceVerifierBytes', probe: 'length-42', kind: 'length'},
  {id: 'alphabet', declaration: 'pkceUnreserved', probe: 'octet-128-0-0', kind: 'accept'},
  {id: 'last-character', declaration: 'pkceVerifierCharacters', probe: 'octet-128-127-0', kind: 'last'},
  {id: 'encoding', declaration: 'pkceDigit', probe: 'encoding-octet-0', kind: 'digit'},
  {id: 'entropy-length', declaration: 'pkceEncode32', probe: 'entropy-31', kind: 'length'},
]);
export function mutatePkceSource(sources, id) {
  const mutation = sourceMutations.find(row => row.id === id); assert.ok(mutation);
  const name = 'Foundation.Sec.V1.Pkce', original = sources.get(name).toString('utf8');
  const data = JSON.parse(/\\semanticdata\{(.*)\}/.exec(original)[1]);
  const declaration = data.declarations.find(row => row.name === mutation.declaration); assert.ok(declaration);
  if (mutation.kind === 'accept') declaration.body = {kind: 'blt',
    left: {kind: 'var', name: 'value'}, right: {kind: 'nat', value: '256'}};
  else if (mutation.kind === 'length') declaration.body.scrutinee = {kind: 'bool', value: true};
  else if (mutation.kind === 'last') {
    const body = declaration.body.branches[1].body;
    assert.equal(body.scrutinee.kind, 'blt');
    body.scrutinee.right = {kind: 'primitive', operation: 'subtract', result: {kind: 'nat'},
      arguments: [body.scrutinee.right, {kind: 'nat', value: '1'}]};
  } else {
    const alphabet = declaration.body.arguments[0]; assert.equal(alphabet.kind, 'bytes');
    alphabet.hex = '5f' + alphabet.hex.slice(2);
  }
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  sources.set(name, Buffer.from(original.replace(/\\semanticdata\{.*\}/, '\\semanticdata{' + JSON.stringify(canonical(data)) + '}')));
  return {...mutation, entry: 'pkce'};
}
