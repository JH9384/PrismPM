import assert from 'node:assert/strict';

export const mutationProbes = Object.freeze({
  source: 'SystemReferenceMismatch', services: 'MissingComponent', controls: 'MissingControl',
  manifest: 'ChangedManifestRecord', assurance: 'WrongAssuranceKind', uniqueness: 'DuplicateRequirementMember',
  trailing: 'TrailingCBOR', preimage: 'CompleteConditionalCapture', aggregate: 'AggregateComponentReferencesOver',
  'id-limit': 'OversizedComponentIdentity',
  'partition-count': 'MissingFinalBucketReference',
  'bucket-gap': 'DuplicateAcrossBoundaryBucket',
  'bucket-last': 'DuplicateAcrossLastBucket',
  'bucket-duplicate': 'DuplicateAcrossFirstBucket',
  'context-omission': 'CompleteSixFieldContext',
  'context-substitution': 'CompleteSixFieldContext',
  'context-limit': 'CombinedMaximumUtf8TextAndObligations',
  'writer-payload': 'CompleteConditionalCapture',
  'writer-major': 'CompleteConditionalCapture',
  'writer-size': 'CompleteConditionalCapture',
});
export const mutationNames = Object.freeze(Object.keys(mutationProbes));

export function mutateSources(sources, kind) {
  assert.ok(mutationNames.includes(kind));
  const module = 'Production.PublicationAdmission.' + (kind.startsWith('context-') ? 'V1Wire'
    : kind.startsWith('writer-') || ['trailing', 'preimage'].includes(kind) ? 'LinkageV1Wire' : 'LinkageV1');
  const original = sources.get(module).toString('utf8'), match = /\\semanticdata\{(.*)\}/.exec(original);
  assert.ok(match); const semantic = JSON.parse(match[1]);
  const selected = ({source: 'publicationLinkageValidate', services: 'publicationLinkageServicesPartition',
    controls: 'publicationLinkageControlsPartition', manifest: 'publicationLinkageManifestScan',
    assurance: 'publicationLinkageRequirementKind', uniqueness: 'publicationLinkageRequirementMemberAbsent',
    trailing: 'publicationLinkageFinish', preimage: 'publicationLinkageruntimePreimage',
    aggregate: 'publicationLinkagePublicationServicesScanRows', 'id-limit': 'publicationLinkageSmallRecordRows',
    'partition-count':'publicationLinkageServicesPartition', 'bucket-gap':'publicationLinkageBitBuckets',
    'bucket-last':'publicationLinkageServicesPartition', 'bucket-duplicate':'publicationLinkageBitMark',
    'context-omission':'publicationContextFieldsPreimage', 'context-substitution':'publicationContextFieldsPreimage',
    'context-limit':'publicationWireLimits', 'writer-payload':'publicationLinkagePayloadInto',
    'writer-major':'publicationLinkagePayloadHead', 'writer-size':'publicationLinkagePayloadHead'})[kind];
  const declarations = semantic.declarations.filter(row => row.name === selected);
  assert.equal(declarations.length, 1, 'exact source declaration for ' + kind);
  const declaration = declarations[0]; let changed = 0;
  const walk = (node, visit) => {
    if (!node || typeof node !== 'object') return;
    if (visit(node)) { changed++; return; }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(child => walk(child, visit)); else walk(value, visit);
  };
  if (kind === 'context-omission') {
    // Evaluate the real field writer (including its failures) but omit its
    // successful bytes. This preserves the typed ABI and actual axiom closure.
    assert.equal(declaration.body.function.name, 'publicationWireJoin');
    const writer = declaration.body.arguments[1];
    assert.equal(writer.function.name, 'writePublicationWireText');
    assert.deepEqual(writer.arguments, [{kind:'var', name:'publisherRef'}]);
    const types = [{kind:'bytes'}, {kind:'named', member:{module:'Foundation.Codec.Cbor.V1.Primitive', name:'CborError'}, arguments:[]}];
    declaration.body.arguments[1] = {kind:'match', scrutinee:writer, branches:[
      {constructor:{name:'Result.error'}, binders:['cause'], body:{kind:'constructor',constructor:{name:'Result.error'},
        type_arguments:types, arguments:[{kind:'var',name:'cause'}]}},
      {constructor:{name:'Result.ok'}, binders:['omitted'], body:{kind:'constructor',constructor:{name:'Result.ok'},
        type_arguments:types, arguments:[{kind:'bytes',hex:''}]}}
    ]}; changed = 1;
  } else if (kind === 'partition-count') {
    assert.equal(declaration.body.kind, 'and');
    declaration.body.left = {kind:'or',left:declaration.body.left,right:{kind:'bool',value:true}};
    changed = 1;
  } else if (kind === 'manifest') {
    // Preserve the actual recursive source's top-level fuel match: a rejected
    // recursive body is not a behavioral mutation witness.
    assert.equal(declaration.body.kind, 'match');
    assert.deepEqual(declaration.body.scrutinee, {kind:'var', name:'fuel'});
    assert.equal(declaration.body.branches.length, 2);
    for (const branch of declaration.body.branches)
      branch.body = {kind:'if', condition:branch.body, then_value:{kind:'bool', value:true}, else_value:{kind:'bool', value:true}};
    changed = 1;
  } else if (kind === 'writer-payload') {
    assert.equal(declaration.body.function.name, 'publicationLinkageWireJoin');
    assert.deepEqual(declaration.body.arguments[1].arguments, [{kind:'var', name:'payload'}]);
    declaration.body.arguments[1].arguments = [{kind:'bytes', hex:''}]; changed = 1;
  } else if (['services', 'controls', 'assurance', 'uniqueness'].includes(kind)) {
    // Keep the original expression as the condition so actual kernel axiom
    // dependencies remain audited while the selected guard is made ineffective.
    declaration.body = {kind: 'if', condition: declaration.body, then_value: {kind: 'bool', value: true}, else_value: {kind: 'bool', value: true}};
    changed = 1;
  } else walk(declaration.body, node => {
    if (kind === 'context-substitution' && node.kind === 'var'
      && ['instance', 'publisherRevision'].includes(node.name)) {
      node.name = node.name === 'instance' ? 'publisherRevision' : 'instance'; return true;
    }
    if (kind === 'context-limit' && node.field === 'maximumText') {
      assert.deepEqual(node.value, {kind:'nat',value:'2048'}); node.value.value = '2047'; return true;
    }
    if (kind === 'bucket-gap' && node.kind === 'add' && node.left.kind === 'var' && node.left.name === 'lower'
      && node.right.kind === 'nat' && node.right.value === '256') {
      node.right.value = '257'; return true;
    }
    if (kind === 'bucket-last' && node.kind === 'call' && node.function.name === 'publicationLinkageBitBuckets') {
      node.arguments[2] = {kind:'primitive',operation:'subtract',arguments:[node.arguments[2],{kind:'nat',value:'256'}],result:{kind:'nat'}};
      return true;
    }
    if (kind === 'bucket-duplicate' && node.kind === 'primitive' && node.operation === 'equal'
      && node.arguments[0]?.operation === 'bit_and') {
      const original=structuredClone(node);
      for(const key of Object.keys(node))delete node[key];
      Object.assign(node,{kind:'or',left:original,right:{kind:'bool',value:true}}); return true;
    }
    if (['writer-major', 'writer-size'].includes(kind) && node.kind === 'call' && node.function.name === 'cborWriteHead') {
      const index = kind === 'writer-size' ? 0 : 1;
      node.arguments[index] = {kind:'add', left:node.arguments[index], right:{kind:'nat', value:'1'}};
      return true;
    }
    if (kind === 'source' && node.kind === 'call' && node.function.name === 'publicationLinkageMemberEqual') {
      node.arguments[1] = structuredClone(node.arguments[0]); return true;
    }
    if (kind === 'trailing' && node.kind === 'record' && node.type.name === 'BoundedCursor') {
      const offset = node.fields.find(row => row.field === 'offset'), limit = node.fields.find(row => row.field === 'limit');
      assert.ok(offset && limit); offset.value = structuredClone(limit.value); return true;
    }
    if (kind === 'preimage' && node.kind === 'project' && node.field === 'verificationManifest') {
      node.field = 'sdkLock'; return true;
    }
    if (kind === 'aggregate' && node.kind === 'nat' && node.value === '65536') {
      node.value = '65537'; return true;
    }
    if (kind === 'id-limit' && node.kind === 'nat' && node.value === '128') {
      node.value = '129'; return true;
    }
    return false;
  });
  assert.equal(changed, kind === 'context-substitution' ? 2 : kind === 'bucket-duplicate' ? 4 : 1, 'exact source mutation ' + kind);
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const mutated = Buffer.from(original.replace(match[0], '\\semanticdata{' + JSON.stringify(canonical(semantic)) + '}'));
  assert.notDeepEqual(mutated, sources.get(module)); sources.set(module, mutated);
}
