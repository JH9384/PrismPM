import assert from 'node:assert/strict';

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

const model = 'Foundation.Browser.Application.V1.AccountGenesis', wire = model + 'Wire';
export const mutations = Object.freeze([
  {id: 'namespace-width', module: model, definition: 'validateAccountGenesis', probe: 'FieldWidth1_31'},
  {id: 'nonce-width', module: model, definition: 'validateAccountGenesis', probe: 'FieldWidth2_31'},
  {id: 'key-prefix', module: model, definition: 'validateAccountGenesis', probe: 'KeyPrefix0'},
  {id: 'curve-membership', module: model, definition: 'validateAccountGenesis', probe: 'InitialKeyByte1'},
  {id: 'namespace-match', module: model, definition: 'matchAccountGenesisNamespace', probe: 'NamespaceMismatch0'},
  {id: 'identity-domain', module: model, definition: 'accountGenesisDomain', probe: 'Projection1'},
  {id: 'trailing-input', module: wire, definition: 'finishAccountGenesis', probe: 'Trailing'},
  {id: 'frame-limit', module: wire, definition: 'accountGenesisWireBytes', probe: 'FrameOverflow'},
  {id: 'request-version', module: wire, definition: 'readAccountGenesisRequest', probe: 'RequestVersion'},
  {id: 'genesis-version', module: wire, definition: 'readAccountGenesis', probe: 'GenesisVersion'},
  {id: 'nonce-projection', module: wire, definition: 'writeAccountGenesis', probe: 'Roundtrip1'},
].map(Object.freeze));

export function mutateAccountGenesisSource(sources, id) {
  const selected = mutations.find(row => row.id === id); assert.ok(selected, 'registered genesis mutation');
  const original = sources.get(selected.module), text = original.toString('utf8');
  const data = JSON.parse(/\\semanticdata\{(.*)\}/.exec(text)[1]);
  const declaration = data.declarations.find(row => row.name === selected.definition); assert.ok(declaration);
  let count = 0;
  const yes = {kind: 'bool', value: true};
  if (id === 'namespace-width') {declaration.body.scrutinee = yes; count++;}
  else if (id === 'nonce-width') {declaration.body.branches[1].body.scrutinee = yes; count++;}
  else if (id === 'key-prefix') {
    const guard = declaration.body.branches[1].body.branches[1].body;
    guard.scrutinee = {kind: 'or', left: guard.scrutinee, right: yes}; count++;
  }
  else if (id === 'curve-membership') {
    const guard = declaration.body.branches[1].body.branches[1].body;
    assert.equal(guard.scrutinee.function.name, 'p256PublicKeyValid');
    guard.scrutinee = {kind: 'or', left: guard.scrutinee, right: {kind: 'call', function: {module: 'Foundation.Browser.Application.V1.Effects', name: 'effectSigningGrantValid'},
      arguments: [{kind: 'record', type: {module: 'Foundation.Browser.Application.V1.Effects', name: 'EffectSigningGrant'}, fields: [
        {field: 'publicKey', value: {kind: 'project', value: {kind: 'var', name: 'value'}, field: 'initialKey'}},
        {field: 'context', value: {kind: 'string', value: 'prismpm/account-genesis/1'}},
      ]}]}}; count++;
  }
  else if (id === 'identity-domain') {declaration.body.hex = declaration.body.hex.slice(0, -2); count++;}
  else if (id === 'frame-limit') {declaration.body.scrutinee = yes; count++;}
  else {
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (id === 'namespace-match' && value.kind === 'match' && value.scrutinee.kind === 'primitive'
        && value.scrutinee.operation === 'equal') {value.scrutinee = yes; count++; return;}
      if (id === 'nonce-projection' && value.kind === 'project' && value.field === 'nonce') {
        value.field = 'namespace'; count++; return;
      }
      if (value.kind === 'match' && value.scrutinee.kind === 'beq') {
        const left = value.scrutinee.left;
        if (id === 'trailing-input' && left.kind === 'project' && left.field === 'cursor'
          || ['request-version', 'genesis-version'].includes(id)
            && left.kind === 'project' && left.value.kind === 'var' && left.value.name === 'version') {
          value.scrutinee = yes; count++; return;
        }
      }
      Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(visit) : visit(child));
    }
    visit(declaration.body);
  }
  assert.equal(count, 1, 'one exact source defect ' + id);
  const changed = Buffer.from(text.replace(/\\semanticdata\{.*\}/,
    '\\semanticdata{' + JSON.stringify(canonical(data)) + '}'));
  assert.notDeepEqual(changed, original);
  sources.set(selected.module, changed); return selected;
}
