// Test-only byte custody. Fresh compiler/kernel execution remains mandatory.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const selections = Object.freeze({
  presentation: Object.freeze({inventory:'six-module',modules:Object.freeze(['Fixture', 'Foundation.Bytes', 'Foundation.Codec',
    'Foundation.Codec.Cbor.V1.Primitive', 'Foundation.View.Browser.V1.Model',
    'Foundation.View.Browser.V1.Wire'])}),
  session: Object.freeze({inventory:'ten-module',modules:Object.freeze(['Fixture',
    'Foundation.Browser.Application.V1.Effects','Foundation.Browser.Application.V1.EffectsWire',
    'Foundation.Browser.Application.V1.Session','Foundation.Browser.Application.V1.SessionWire',
    'Foundation.Bytes','Foundation.Codec','Foundation.Codec.Cbor.V1.Primitive',
    'Foundation.View.Browser.V1.Model','Foundation.View.Browser.V1.Wire'])}),
});

// Only registered complete module selections, never caller-chosen subsets.
export function provenanceProfile(name) {
  assert.ok(typeof name === 'string' && Object.hasOwn(selections,name), 'registered complete provenance family required');
  const {modules,inventory} = selections[name];
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const sourcePath = name => 'src/' + name.replaceAll('.', '/') + '.lex.tex';
  const leanPath = name => 'modules/PrismPM/' + name.replaceAll('.', '/') + '.lean';
  const presentationOutputRows = Object.freeze(modules.flatMap(name => {
    const path = 'PrismPM/' + name.replaceAll('.', '/');
    return [
      {kind: 'lean', path: 'modules/' + path + '.lean'},
      {kind: 'tex', path: 'modules/' + path + '.tex'},
      {kind: 'map', path: 'maps/' + path + '.map.json'},
      {kind: 'coverage', path: 'coverage/' + path + '.coverage.json'},
      {kind: 'lexicon-closure', path: 'lexicons/' + name + '.closure.json'},
    ];
  }).sort((a, b) => Buffer.compare(Buffer.from(a.kind), Buffer.from(b.kind))
    || Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
    .map(row => Object.freeze(row)));
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  function closed(value, keys, label) {
    assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, label);
    const fields = Object.getOwnPropertyDescriptors(value);
    assert.deepEqual(Reflect.ownKeys(fields).sort(), [...keys].sort(), label);
    assert.ok(Object.values(fields).every(field => Object.hasOwn(field, 'value')), label);
  }
  function freeze(value) {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  }
  function bytes(value, label) {
    assert.ok(Buffer.isBuffer(value), label + ' requires captured bytes');
    return Buffer.from(value);
  }
  // LexLean SPEC 21.7: byte-sorted object keys, no null/floats, exactly one LF.
  // Comparing canonical bytes also rejects duplicate keys and lossy UTF-8 input.
  function canonical(value) {
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
      assert.ok(Number.isSafeInteger(value) && !Object.is(value, -0), 'exact canonical integer');
      return String(value);
    }
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, 'canonical JSON object');
    return '{' + Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  function document(value, label) {
    const captured = bytes(value, label), parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(captured));
    assert.deepEqual(Buffer.from(canonical(parsed) + '\n'), captured, label + ' canonical file bytes');
    return parsed;
  }
  // Exact public LexLean content-ID frame recipe, not a new signing authority.
  function framed(domain, fields) {
    const hash = createHash('sha256').update(domain + '\0');
    for (const [label, value] of fields) {
      const key = Buffer.from(label), head = Buffer.alloc(4), length = Buffer.alloc(8);
      head.writeUInt32BE(key.length); length.writeBigUInt64BE(BigInt(value.length));
      hash.update(head).update(key).update(length).update(value);
    }
    return hash.digest('hex');
  }
  function capturedMap(value, label) {
    assert.ok(value instanceof Map, label + ' captured module map');
    assert.deepEqual([...value.keys()], modules, label + ' exact ' + inventory + ' inventory');
    return new Map([...value].map(([name, value]) => [name, bytes(value, label + ' ' + name)]));
  }
  function fileRow(row, path, captured, label) {
    closed(row, ['kind', 'path', 'byte_length', 'sha256'], label + ' closed descriptor');
    assert.equal(row.path, path, label + ' path');
    assert.ok(Number.isSafeInteger(row.byte_length) && row.byte_length >= 0 && digest(row.sha256), label + ' descriptor');
    assert.equal(row.byte_length, captured.length, label + ' byte length');
    assert.equal(row.sha256, sha(captured), label + ' byte digest');
  }
  function outputMap(value, label) {
    assert(value instanceof Map, label + ' captured output map');
    assert.deepEqual([...value.keys()], presentationOutputRows.map(row => row.path), label + ' complete output inventory');
    return new Map([...value].map(([path, value]) => [path, bytes(value, label + ' ' + path)]));
  }
  function inspect({verified, sources, manifestBytes, attestationBytes, generated, outputs}) {
    closed(verified, ['attestation_id', 'build_id', 'semantic_id', 'source_id', 'root', 'modules'], 'closed actual driver record');
    assert.deepEqual(verified.modules, modules, 'driver exact ' + inventory + ' inventory');
    assert.ok(typeof verified.root === 'string' && verified.root.startsWith('/'), 'actual verified root');
    const source = capturedMap(sources, 'source'), lean = capturedMap(generated, 'generated Lean');
    const manifest = document(manifestBytes, 'manifest'), attestation = document(attestationBytes, 'attestation');
    assert.equal(manifest.spec, 'lexlean/build-manifest/1');
    assert.equal(attestation.spec, 'lexlean/attestation/1');
    assert.equal(attestation.status, 'verified');
    for (const key of ['source_id', 'semantic_id', 'build_id']) {
      assert.ok(digest(verified[key]), 'actual driver ' + key);
      assert.equal(manifest[key], verified[key], 'manifest/driver ' + key);
      assert.equal(attestation[key], verified[key], 'attestation/driver ' + key);
    }
    assert.equal(manifest.build_id, framed('lexlean-build-v1', [
      ['source-id', Buffer.from(manifest.source_id, 'hex')],
      ['semantic-id', Buffer.from(manifest.semantic_id, 'hex')],
    ]), 'actual build content ID');
    assert.ok(digest(verified.attestation_id), 'actual driver attestation ID');
    assert.equal(attestation.attestation_id, verified.attestation_id, 'attestation/driver content ID');
    const body = {...attestation}; delete body.attestation_id;
    assert.equal(attestation.attestation_id, framed('lexlean-attestation-v1', [
      ['attestation-body', Buffer.from(canonical(body))],
    ]), 'actual attestation content ID');
    closed(attestation.build_manifest, ['byte_length', 'sha256'], 'attested manifest descriptor');
    assert.equal(attestation.build_manifest.byte_length, manifestBytes.length, 'attested manifest length');
    assert.equal(attestation.build_manifest.sha256, sha(manifestBytes), 'attested manifest digest');
    assert.deepEqual(manifest.selection, modules, 'manifest exact module selection');
    assert.deepEqual(manifest.modules, modules.map(name => ({module: name,
      lean_module: 'PrismPM.' + name, source_path: sourcePath(name)})), 'manifest exact module declarations');
    assert.ok(Array.isArray(manifest.inputs) && Array.isArray(manifest.outputs), 'actual manifest inventories');
    const sourceRows = manifest.inputs.filter(row => row.kind === 'source');
    const leanRows = manifest.outputs.filter(row => row.kind === 'lean' || row.path?.endsWith('.lean'));
    assert.deepEqual(sourceRows.map(row => row.path), modules.map(sourcePath), 'manifest exact source inventory');
    assert.deepEqual(leanRows.map(row => row.path), modules.map(leanPath), 'manifest exact generated Lean inventory');
    for (const [index, name] of modules.entries()) {
      fileRow(sourceRows[index], sourcePath(name), source.get(name), 'source ' + name);
      assert.equal(leanRows[index].kind, 'lean', 'generated Lean descriptor kind');
      fileRow(leanRows[index], leanPath(name), lean.get(name), 'generated Lean ' + name);
    }
    assert.deepEqual(manifest.outputs.map(({kind, path}) => ({kind, path})), presentationOutputRows,
      'manifest complete output inventory');
    const complete = outputMap(outputs, 'kernel outputs');
    for (const row of manifest.outputs) fileRow(row, row.path, complete.get(row.path), 'kernel output ' + row.path);
    for (const name of modules)
      assert.deepEqual(complete.get(leanPath(name)), lean.get(name), 'generated Lean byte digest agrees with complete outputs');
    return {source, lean, complete, manifest, attestation};
  }

  function capturePresentationProvenance(input) {
    const {source, lean, complete, manifest, attestation} = inspect(input);
    const manifestBytes = Buffer.from(input.manifestBytes), attestationBytes = Buffer.from(input.attestationBytes);
    const verified = freeze(JSON.parse(JSON.stringify(input.verified)));
    const evidence = freeze({scope: 'kernel-to-complete-generated-byte-linkage', verified,
      manifest: {byte_length: manifestBytes.length, sha256: sha(manifestBytes)},
      attestation: {byte_length: attestationBytes.length, sha256: sha(attestationBytes)},
      sources: manifest.inputs.filter(row => row.kind === 'source'),
      generated: manifest.outputs.filter(row => row.kind === 'lean'), outputs: manifest.outputs});
    const snapshot = freeze({manifest, attestation});
    return Object.freeze({evidence, snapshot,
      generatedBytes(name) {
        assert.ok(lean.has(name), 'captured generated module required');
        return Buffer.from(lean.get(name));
      },
      verify(observed) {
        assert.deepEqual(observed.verified, verified, 'immutable actual driver record');
        assert.deepEqual(observed.manifestBytes, manifestBytes, 'immutable authenticated manifest');
        assert.deepEqual(observed.attestationBytes, attestationBytes, 'immutable kernel attestation');
        const currentOutputs = outputMap(observed.outputs, 'observed kernel outputs');
        for (const [path, value] of complete)
          assert.deepEqual(currentOutputs.get(path), value, 'immutable complete kernel output ' + path);
        for (const [label, current, expected] of [
          ['original source', observed.sources, source], ['original generated Lean', observed.generated, lean],
          ...(observed.staged === undefined ? [] : [['staged generated Lean', observed.staged, lean]]),
        ]) {
          const map = capturedMap(current, label);
          for (const name of modules) assert.deepEqual(map.get(name), expected.get(name), 'immutable ' + label + ' ' + name);
        }
      }});
  }
  return Object.freeze({outputRows:presentationOutputRows,capture:capturePresentationProvenance});
}

const presentation = provenanceProfile('presentation');
export const presentationOutputRows = presentation.outputRows;
export const capturePresentationProvenance = presentation.capture;
