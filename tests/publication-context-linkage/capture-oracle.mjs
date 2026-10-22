// Independent test oracle over actual retained artifacts, not an authority issuer.
import assert from 'node:assert/strict';
import {lstatSync, readdirSync, readFileSync, realpathSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';
import {sha} from '../browser-view/compile.mjs';
import {encode, positional} from './corpus.mjs';

const ordered = value => Array.isArray(value) ? value.map(ordered)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const canonical = value => Buffer.from(JSON.stringify(ordered(value)));
const digest = bytes => Buffer.from(sha(bytes), 'hex');
const order = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const domain = (name, body) => Buffer.concat([Buffer.from('prismpm/publication-' + name + '/1\0'), encode(body)]);

export function decodeCaptureJson(bytes, format) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 67108864);
  assert.ok(['prismpm', 'lexlean-snapshot'].includes(format), 'closed captured JSON format');
  const value = JSON.parse(bytes);
  // LexLean SemanticSnapshot::canonical_bytes uses exactly one final LF.
  // PrismPM canonical documents do not. Hashes always bind the original bytes.
  const expected = format === 'lexlean-snapshot'
    ? Buffer.concat([canonical(value), Buffer.from('\n')]) : canonical(value);
  assert.ok(expected.equals(bytes), 'exact canonical captured JSON framing: ' + format);
  return value;
}

export function decodeCaptureCbor(input) {
  let offset = 0, nodes = 0;
  function read(depth) {
    assert.ok(depth <= 64 && ++nodes <= 4194304 && offset < input.length, 'bounded complete captured CBOR');
    const head = input[offset++], major = head >> 5, low = head & 31;
    assert.ok([0, 2, 3, 4].includes(major), 'closed captured CBOR major');
    let length;
    if (low < 24) length = low;
    else {
      const width = ({24:1, 25:2, 26:4})[low];
      assert.ok(width && offset + width <= input.length, 'definite UInt32 CBOR head');
      length = input.readUIntBE(offset, width); offset += width;
      assert.ok(length >= ({1:24, 2:256, 4:65536})[width], 'shortest CBOR head');
    }
    if (major === 0) return length;
    if (major === 4) {assert.ok(length <= 65536); return Array.from({length}, () => read(depth + 1));}
    assert.ok(offset + length <= input.length); const bytes = input.subarray(offset, offset + length); offset += length;
    return major === 2 ? Buffer.from(bytes) : new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes);
  }
  assert.ok(Buffer.isBuffer(input) && input.length <= 67108864);
  const result = read(0); assert.equal(offset, input.length, 'no trailing captured CBOR');
  assert.deepEqual(encode(result), input, 'canonical captured CBOR roundtrip'); return result;
}

export function projectCapturedSource(snapshot) {
  const definitions = new Map(), modules = new Map();
  for (const module of snapshot.modules) {
    assert.ok(!modules.has(module.name)); modules.set(module.name, module);
    for (const declaration of module.declarations) {
      const key = module.name + ':' + declaration.logical_id;
      assert.ok(!definitions.has(key)); definitions.set(key, declaration.linked_ir);
    }
  }
  let steps = 0;
  function literal(node, owner, depth = 0) {
    assert.ok(++steps <= 4194304 && depth <= 64, 'bounded independent source projection');
    const child = value => literal(value, owner, depth + 1);
    if (node.kind === 'string') return node.value;
    if (node.kind === 'bytes') {assert.match(node.hex, /^(?:[a-f0-9]{2})*$/); return Buffer.from(node.hex, 'hex');}
    if (node.kind === 'nat') {const value = Number(node.value); assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff); return value;}
    if (node.kind === 'nil') return [];
    if (node.kind === 'cons') {
      const values = []; let tail = node;
      while (tail.kind === 'cons') {
        assert.ok(++steps <= 4194304); values.push(child(tail.head)); tail = tail.tail;
      }
      assert.equal(tail.kind, 'nil'); return values;
    }
    if (node.kind === 'record') {
      const declaration = definitions.get((node.type.module ?? owner) + ':' + node.type.name);
      assert.equal(declaration?.kind, 'structure', 'exact independent record type');
      assert.deepEqual(node.fields.map(row => row.field), declaration.fields.map(row => row.name), 'complete ordered source record fields');
      assert.equal(new Set(node.fields.map(row => row.field)).size, node.fields.length);
      return Object.fromEntries(node.fields.map(row => [row.field, child(row.value)]));
    }
    if (node.kind === 'call') {
      assert.deepEqual(node.arguments, []);
      const module = node.function.module ?? owner, declaration = definitions.get(module + ':' + node.function.name);
      assert.equal(declaration?.kind, 'definition'); assert.deepEqual(declaration.parameters, []);
      return literal(declaration.body, module, depth + 1);
    }
    assert.equal(node.kind, 'constructor', 'closed independent literal shape');
    const module = node.constructor.module ?? owner, split = node.constructor.name.lastIndexOf('.');
    const name = node.constructor.name.slice(0, split), variant = node.constructor.name.slice(split + 1);
    const declaration = definitions.get(module + ':' + name); assert.equal(declaration?.kind, 'inductive');
    const tag = declaration.constructors.findIndex(row => row.name === variant);
    assert.ok(tag >= 0); return {$tag:tag, values:node.arguments.map(child)};
  }
  const roots = [...definitions].filter(([, row]) => row?.kind === 'definition'
    && row.result?.kind === 'named' && row.result.member.module === 'Production.PublicationAdmission.LinkageV1'
    && row.result.member.name === 'PublicationClosure');
  assert.equal(roots.length, 1, 'unique actual typed publication closure');
  const [[key, definition]] = roots, split = key.indexOf(':'), module = key.slice(0, split), member = key.slice(split + 1);
  assert.deepEqual(definition.parameters, []);
  assert.deepEqual(definition.result.arguments, []);
  const closure = literal(definition.body, module);
  const flatten = (value, field = 'entries', size = 256, maximum = 65536) => {
    assert.deepEqual(Object.keys(value), ['chunks']); const rows = [];
    value.chunks.forEach((chunk, index) => {
      assert.deepEqual(Object.keys(chunk), [field]);
      assert.ok(chunk[field].length > 0 && chunk[field].length <= size);
      if (index + 1 < value.chunks.length) assert.equal(chunk[field].length, size);
      rows.push(...chunk[field]);
    }); assert.ok(rows.length <= maximum); return rows;
  };
  const enumeration = value => {assert.deepEqual(value.values, []); return value.$tag;};
  closure.declaration.minimumTrust = enumeration(closure.declaration.minimumTrust);
  closure.declaration.refKind = enumeration(closure.declaration.refKind);
  closure.declaration.obligations = flatten(closure.declaration.obligations, 'items', 64, 4096)
    .map(row => ({...row, moment:enumeration(row.moment), assurance:enumeration(row.assurance)}));
  closure.services = flatten(closure.services).map(row => ({...row, components:flatten(row.components)}));
  closure.controls = flatten(closure.controls);
  closure.requirements = flatten(closure.requirements, 'entries', 64, 4096).map(row => {
    const value = row.requirement, body = value.values[0]; assert.equal(value.values.length, 1);
    if (value.$tag === 0) return {...row, requirement:{kind:0, theorem:body.theorem}};
    if (value.$tag === 2) return {...row, requirement:{kind:2, criterion:body.criterion, subject:body.subject}};
    assert.equal(value.$tag, 1);
    const input = body.input, selector = input.$tag === 0 ? {kind:0, path:input.values[0]}
      : input.$tag === 1 ? {kind:1, member:input.values[0]} : {kind:2};
    assert.ok(input.$tag <= 2); assert.equal(input.values.length, input.$tag === 2 ? 0 : 1);
    return {...row, requirement:{kind:1, oracle:body.oracle, input:selector, suite:body.suite}};
  });
  return {closure, member:[module, member], module:modules.get(module)};
}

export function verifyCaptureOracle(root, executableSha, sourceRoot) {
  const files = new Map();
  function read(path) {
    assert.ok(typeof path === 'string' && path.length > 0 && !path.startsWith('/')
      && !/[\\\0]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..'),
      'canonical confined capture path');
    assert.ok(resolve(root, path).startsWith(root + sep), 'canonical confined capture path');
    const absolute = join(root, path); assert.equal(realpathSync(absolute), absolute, 'unaliased retained capture');
    const stat = lstatSync(absolute); assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= 67108864);
    const bytes = readFileSync(absolute); files.set(path, {bytes:bytes.length, sha256:sha(bytes)}); return bytes;
  }
  const json = path => decodeCaptureJson(read(path),
    path === 'captured/build/lexlean/snapshot.json' ? 'lexlean-snapshot' : 'prismpm');
  function inventory(directory) {
    const rows = [];
    function visit(path) {
      for (const name of readdirSync(join(root, directory, path)).sort(order)) {
        const relative = path ? path + '/' + name : name, absolute = join(root, directory, relative), stat = lstatSync(absolute);
        assert.ok(!stat.isSymbolicLink());
        if (stat.isDirectory()) visit(relative); else rows.push([relative, digest(read(directory + '/' + relative))]);
      }
    }
    visit(''); return rows.sort(([a], [b]) => order(a, b));
  }
  const receipt = json('capture-evidence.json');
  assert.equal(receipt.schema, 'prismpm/conditional-publication-capture-evidence/1');
  assert.equal(receipt.complete_application_accepted, false); assert.equal(receipt.source_free, true);
  assert.equal(receipt.test_executable_sha256, executableSha);
  assert.equal(receipt.runtime_inventory_sha256, sha(read('installed-sdk-inventory.json')));
  assert.equal(receipt.runtime_scope, 'conditional source-built test controller in immutable SDK; not installed-controller acceptance');
  assert.equal(receipt.publisher_field_substitutions, 3);
  assert.deepEqual(receipt.refused_attempts, ['instance', 'revision', 'empty-ref', 'oversized-ref']);
  const roles = ['build-manifest', 'sdk-lock', 'standards-lock', 'semantic-snapshot', 'model', 'system',
    'runtime-manifest', 'kernel-attestation', 'provenance', 'validation', 'oracle-attestation'];
  assert.deepEqual(receipt.graph_refusals.map(row => [row.role, row.defect]), roles.flatMap(role =>
    [[role, 'changed'], [role, 'missing']]));
  for (const row of receipt.graph_refusals) assert.equal(row.code, 'PP6101');
  const build = json('build-manifest.json'), snapshot = json('captured/build/lexlean/snapshot.json');
  const system = json('captured/build/system.prism.json'), provenance = json('provenance.json');
  const lock = json('sdk-lock.json'), installed = JSON.parse(read('installed-sdk-inventory.json'));
  assert.equal(sha(read('sdk-lock.json')), receipt.sdk_lock_sha256);
  assert.equal(lock.sdk_image, receipt.sdk_image);
  for (const original of installed.artifacts)
    assert.deepEqual(lock.inventory.filter(row => original.id === row.id), [original]);
  assert.equal(lock.inventory.length, installed.artifacts.length + 1);
  const archive = sha(readFileSync(join(sourceRoot, 'sdk/stdlib-sources.tar')));
  assert.equal(receipt.fixture_source_archive_sha256, archive);
  const sources = lock.inventory.filter(row => row.id === 'stdlib-sources');
  assert.equal(receipt.installed_sdk_source_matches, sources.length === 1
    && sources[0].kind === 'crate' && sources[0].digest === 'sha256:' + archive);
  const {closure, member, module} = projectCapturedSource(snapshot);
  for (const capturedModule of snapshot.modules)
    assert.equal(sha(read('producer-source/' + capturedModule.source.path)), capturedModule.source.sha256);
  const expectedSource = [digest(read('captured/build/lexlean/snapshot.json')), Buffer.from(snapshot.source_id, 'hex'),
    Buffer.from(snapshot.semantic_id, 'hex'), Buffer.from(snapshot.compiler_semantics_id, 'hex'), member,
    Buffer.from(module.source.sha256, 'hex'), [closure.system.module, closure.system.name],
    digest(read('captured/build/system.prism.json')), closure.target];
  const recordRows = (rows, key) => rows.map(row => [key(row), digest(canonical(row))]).sort(([a], [b]) => order(a, b));
  const dependencies = provenance.predicate.buildDefinition.resolvedDependencies;
  const runtime = inventory('captured/runtime'), oracles = inventory('captured/oracles');
  const browser = inventory('captured/build/view/browser');
  const actualBuildFiles = inventory('captured/build');
  assert.deepEqual(actualBuildFiles.map(([path, hash]) => [path, hash.toString('hex')]),
    build.files.map(row => [row.path, row.sha256]).sort(([a], [b]) => order(a, b)), 'full retained build-file inventory');
  const metadata = read('metadata.request'), decoded = decodeCaptureCbor(metadata);
  const expectedCapture = [expectedSource, recordRows(system.components, row => row.id), recordRows(system.controls, row => row),
    digest(read('provenance.json')), recordRows(dependencies, row => row.uri), digest(read('sdk-lock.json')),
    digest(read('standards-lock.json')), digest(read('captured/build/lexlean/build/manifest.json')),
    digest(read('captured/runtime/lexlean-attestation.json')), digest(read('build-manifest.json')),
    digest(read('captured/runtime/manifest.json')), runtime, browser, digest(read('validation.json')), oracles];
  assert.deepEqual(decoded, [1, 0, positional('Closure', closure), expectedCapture], 'independent actual retained metadata projection');
  assert.equal(sha(metadata), receipt.metadata_sha256);
  const c = decoded[2], x = expectedCapture;
  const preimages = [domain('declaration', c[2]), domain('services-closure', [x[0], c[3], x[1]]),
    domain('controls-closure', [x[0], c[4], x[2], x[6], c[5]]), domain('dependencies-closure', [x[3], x[4]]),
    domain('compiler-closure', [x[5], x[7], x[8], x[9], x[10]]), domain('runtime-closure', [x[10], x[11], x[12]]),
    domain('oracles-closure', [x[0], c[5], x[6], x[5], x[13], x[14]])];
  preimages.forEach((value, index) => assert.deepEqual(read('linkage-' + index + '.preimage'), value));
  assert.deepEqual(receipt.linkage_sha256, preimages.map(sha));
  const source = dependencies.filter(row => Object.hasOwn(row.digest, 'gitCommit')); assert.equal(source.length, 1);
  assert.match(source[0].digest.gitCommit, /^[0-9a-f]{40}$/);
  const rootDigest = provenance.subject[0].digest.sha256;
  assert.equal(receipt.root_digest, 'sha256:' + rootDigest);
  const ociRoot = read('release/.prism/oci/blobs/sha256/' + rootDigest); assert.equal(sha(ociRoot), rootDigest);
  const configDigest = JSON.parse(ociRoot).config.digest.slice(7), config = read('release-config.json');
  assert.deepEqual(config, read('release/.prism/oci/blobs/sha256/' + configDigest)); assert.equal(sha(config), configDigest);
  const tree = browser.map(([path, hash]) => ({path, digest:'sha256:' + hash.toString('hex'),
    size:files.get('captured/build/view/browser/' + path).bytes}));
  const subject = [source[0].uri, Buffer.from(source[0].digest.gitCommit, 'hex'), Buffer.from(rootDigest, 'hex'),
    digest(read('captured/build/model.prism.json')), digest(read('build-manifest.json')),
    ...preimages.slice(1, 4).map(digest), Buffer.from(lock.sdk_image.split('@sha256:')[1], 'hex'),
    ...preimages.slice(4).map(digest), digest(canonical(tree))];
  const fields = [c[2], digest(preimages[0]), subject, digest(Buffer.from('OC-10 conditional fixture attempt')),
    digest(Buffer.from('OC-10 conditional publisher revision, not authentication')).subarray(0, 20), 'refs/heads/conditional-fixture'];
  const contextPreimage = domain('context', fields), contextDigest = digest(contextPreimage);
  assert.deepEqual(read('context.preimage'), contextPreimage); assert.equal(receipt.context_digest, contextDigest.toString('hex'));
  const admission = encode([1, 4, [...fields, contextDigest]]); assert.deepEqual(read('context.request'), admission);
  return {linkage:{id:'ActualCapturedRelease', request:metadata, response:encode([1, 0, ...preimages])},
    context:{id:'ActualCapturedContext', request:encode([1, 0, fields]), admission, preimage:contextPreimage,
      response:encode([1, 3, contextPreimage])}, evidence:{files:Object.fromEntries(files), installedSdkSourceMatches:receipt.installed_sdk_source_matches,
      actualCaptureSha256:sha(read('capture-evidence.json')), sourceRevision:source[0].digest.gitCommit}};
}
