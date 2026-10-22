// Test-only byte custody. Fresh compiler/kernel execution remains mandatory.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePath = name => 'src/' + name.replaceAll('.', '/') + '.lex.tex';
const leanPath = name => 'modules/PrismPM/' + name.replaceAll('.', '/') + '.lean';
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
function capturedMap(value, label, modules) {
  assert.ok(value instanceof Map, label + ' captured module map');
  assert.deepEqual([...value.keys()], modules, label + ' exact module inventory');
  return new Map([...value].map(([name, value]) => [name, bytes(value, label + ' ' + name)]));
}
function fileRow(row, path, captured, label) {
  closed(row, ['kind', 'path', 'byte_length', 'sha256'], label + ' closed descriptor');
  assert.equal(row.path, path, label + ' path');
  assert.ok(Number.isSafeInteger(row.byte_length) && row.byte_length >= 0 && digest(row.sha256), label + ' descriptor');
  assert.equal(row.byte_length, captured.length, label + ' byte length');
  assert.equal(row.sha256, sha(captured), label + ' byte digest');
}
function inspect(modules, {verified, sources, manifestBytes, attestationBytes, generated}) {
  closed(verified, ['attestation_id', 'build_id', 'semantic_id', 'source_id', 'root', 'modules'], 'closed actual driver record');
  assert.deepEqual(verified.modules, modules, 'driver exact module inventory');
  assert.ok(typeof verified.root === 'string' && verified.root.startsWith('/'), 'actual verified root');
  const source = capturedMap(sources, 'source', modules), lean = capturedMap(generated, 'generated Lean', modules);
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
  return {source, lean, manifest, attestation};
}

export function captureKernelProvenance(expectedModules, input) {
  assert.ok(Array.isArray(expectedModules) && expectedModules.length > 0, 'expected source closure required');
  const modules = Object.freeze([...expectedModules]);
  assert.ok(modules.every(name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name)), 'closed module names required');
  assert.deepEqual(modules, [...new Set(modules)].sort(), 'sorted unique expected module closure required');
  const {source, lean, manifest, attestation} = inspect(modules, input);
  const manifestBytes = Buffer.from(input.manifestBytes), attestationBytes = Buffer.from(input.attestationBytes);
  const verified = freeze(JSON.parse(JSON.stringify(input.verified)));
  const evidence = freeze({scope: 'kernel-to-generated-lean-byte-linkage', verified,
    manifest: {byte_length: manifestBytes.length, sha256: sha(manifestBytes)},
    attestation: {byte_length: attestationBytes.length, sha256: sha(attestationBytes)},
    sources: manifest.inputs.filter(row => row.kind === 'source'),
    generated: manifest.outputs.filter(row => row.kind === 'lean')});
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
      for (const [label, current, expected] of [
        ['original source', observed.sources, source], ['original generated Lean', observed.generated, lean],
        ...(observed.staged === undefined ? [] : [['staged generated Lean', observed.staged, lean]]),
      ]) {
        const map = capturedMap(current, label, modules);
        for (const name of modules) assert.deepEqual(map.get(name), expected.get(name), 'immutable ' + label + ' ' + name);
      }
    }});
}
