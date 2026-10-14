import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import test from 'node:test';
import {decodeMetadataLayer, label, limits, parseConfig, parseJson, parseManifest, parseMetadataTar, paths, profile, sha} from './metadata-layer.mjs';

// Synthetic SDK evidence exercises parsing only. Actual GNU tar emits the
// archive; neither fixtures nor schema acceptance certify an SDK release.
function fixture() {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-metadata-tar-'));
  const inventory = Buffer.from('{"test":"synthetic inventory"}\n');
  const standards = Buffer.from('synthetic standards bytes\n');
  try {
    for (const name of ['opt', 'opt/prismpm', 'opt/prismpm/share']) mkdirSync(join(work, name), {mode:0o755});
    writeFileSync(join(work, paths.inventory), inventory, {mode:0o444});
    writeFileSync(join(work, paths.standards), standards, {mode:0o444});
    const result = spawnSync('/usr/bin/tar', ['--format=ustar', '--owner=0', '--group=0', '--mtime=@0', '--no-recursion',
      '-cf', '-', 'opt/', 'opt/prismpm/', 'opt/prismpm/share/', paths.inventory, paths.standards],
    {cwd:work, timeout:10000, maxBuffer:1024 * 1024});
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr.toString());
    return {tar:result.stdout, inventory, standards};
  } finally {rmSync(work, {recursive:true, force:true});}
}

const type = 'application/vnd.oci.image.';
const encode = value => Buffer.from(JSON.stringify(value));
const describe = (bytes, mediaType) => ({mediaType, size:bytes.length, digest:sha(bytes)});
function graph(tar, architecture = 'amd64', gzip = false) {
  const layer = gzip ? gzipSync(tar) : tar;
  const config = {os:'linux', architecture, rootfs:{type:'layers', diff_ids:[sha(tar)]},
    config:{Labels:{[label]:profile}}};
  const configBytes = encode(config);
  const manifest = {schemaVersion:2, mediaType:type + 'manifest.v1+json', config:describe(configBytes, type + 'config.v1+json'),
    layers:[describe(layer, type + 'layer.v1.tar' + (gzip ? '+gzip' : ''))]};
  const bytes = encode(manifest);
  return {config, configBytes, manifest, bytes, descriptor:describe(bytes, type + 'manifest.v1+json'), layer};
}

function headerChecksum(bytes, offset = 0) {
  bytes.fill(32, offset + 148, offset + 156);
  let value = 0; for (const byte of bytes.subarray(offset, offset + 512)) value += byte;
  bytes.write(value.toString(8).padStart(6, '0') + '\0 ', offset + 148, 'ascii');
}
function stringField(bytes, offset, length, value) {
  bytes.fill(0, offset, offset + length); bytes.write(value, offset, 'ascii');
}

function manifestNumber(manifest, path, token) {
  const value=structuredClone(manifest), marker='__exact_manifest_numeric_token__';
  let parent=value;
  for(const key of path.slice(0,-1)) parent=parent[key];
  assert.equal(typeof parent[path.at(-1)],'number');
  parent[path.at(-1)]=marker;
  const encoded=JSON.stringify(value), quoted=JSON.stringify(marker);
  assert.equal(encoded.split(quoted).length,2);
  return Buffer.from(encoded.replace(quoted,token));
}

test('manifest numeric admission uses exact schema and descriptor tokens before rounding',()=>{
  const g=graph(fixture().tar);
  g.manifest.layers.unshift(describe(Buffer.from('opaque lower layer'),type+'layer.v1.tar'));
  const paths=[['schemaVersion'],['config','size'],['layers',0,'size'],['layers',1,'size']];
  for(const path of paths) {
    const value=path.reduce((current,key)=>current[key],g.manifest);
    const fractions=[`${value}.0000000000000000001`,`${value}.0000000000000000001e0`,`${BigInt(value)-1n}.9999999999999999999`,`${value}0000000000000000001e-19`];
    for(const token of fractions) {
      const bytes=manifestNumber(g.manifest,path,token);
      assert.equal(path.reduce((current,key)=>current[key],JSON.parse(bytes)),value,'mutation must actually round to the admitted integer');
      assert.throws(()=>parseManifest(bytes,describe(bytes,type+'manifest.v1+json')),/fractional|bound/);
    }
    for(const token of [String(value),`${value}.0`,`${value}.0000`,`${value}0e-1`,`${value}e+0`,`0.${value}e${String(value).length}`,`${value}000e-3`]) {
      const bytes=manifestNumber(g.manifest,path,token);
      assert.deepEqual(parseManifest(bytes,describe(bytes,type+'manifest.v1+json')),g.manifest);
    }
    for(const token of ['0','-0','-1','1e99999999','1e-99999999']) {
      const bytes=manifestNumber(g.manifest,path,token);
      assert.throws(()=>parseManifest(bytes,describe(bytes,type+'manifest.v1+json')));
    }
  }
});

test('exact manifest numbers retain existing config terminal and opaque-layer bounds',()=>{
  const g=graph(fixture().tar);
  const lower=describe(Buffer.from('opaque lower layer'),type+'layer.v1.tar');
  lower.size=Number.MAX_SAFE_INTEGER;g.manifest.layers.unshift(lower);
  for(const [path,maximum] of [[['config','size'],limits.document],[['layers',0,'size'],Number.MAX_SAFE_INTEGER],[['layers',1,'size'],limits.compressed]]) {
    const accepted=structuredClone(g.manifest);
    let parent=accepted;for(const key of path.slice(0,-1)) parent=parent[key];parent[path.at(-1)]=maximum;
    for(const token of [String(maximum),`${maximum}.0`,`${maximum}0e-1`]) {
      const bytes=manifestNumber(accepted,path,token);
      assert.deepEqual(parseManifest(bytes,describe(bytes,type+'manifest.v1+json')),accepted);
    }
    for(const token of [String(BigInt(maximum)+1n),`${maximum}.0000000000000000001`]) {
      const bytes=manifestNumber(accepted,path,token);
      assert.throws(()=>parseManifest(bytes,describe(bytes,type+'manifest.v1+json')),/bound|fractional/);
    }
  }
});

test('manifest numeric checks are path-specific including escaped keys and opaque extensions',()=>{
  const g=graph(fixture().tar);
  g.manifest.extra={schemaVersion:-1.25,config:{size:0.5},layers:[{size:0.25}]};
  g.manifest.config.extra={schemaVersion:-2.5,size:0.125};
  g.manifest.layers[0].extra={schemaVersion:-3.5,size:0.0625};
  const encoded=encode(g.manifest);
  assert.deepEqual(parseManifest(encoded,describe(encoded,type+'manifest.v1+json')),g.manifest);
  for(const [path,key] of [[['schemaVersion'],'schemaVersion'],[['config','size'],'size'],[['layers',0,'size'],'size']]) {
    const value=path.reduce((current,name)=>current[name],g.manifest);
    const raw=manifestNumber(g.manifest,path,`${value}.0000000000000000001`).toString();
    const number=`${value}.0000000000000000001`;
    const escaped=Buffer.from(raw.replace(JSON.stringify(key)+':'+number,'"\\u'+key.charCodeAt(0).toString(16).padStart(4,'0')+key.slice(1)+'":'+number));
    assert.notEqual(escaped.toString(),raw);
    assert.throws(()=>parseManifest(escaped,describe(escaped,type+'manifest.v1+json')),/fractional|bound/);
  }
});

test('actual GNU ustar metadata preserves exact bytes on both native platform descriptors', () => {
  const f = fixture();
  for (const architecture of ['amd64', 'arm64']) for (const compressed of [false, true]) {
    const g = graph(f.tar, architecture, compressed);
    const manifest = parseManifest(g.bytes, g.descriptor);
    const config = parseConfig(g.configBytes, manifest, {os:'linux', architecture});
    assert.deepEqual(decodeMetadataLayer(g.layer, manifest, config), {inventory:f.inventory, standards:f.standards});
  }
});

test('manifest admission checks exact bytes, bounded descriptors and terminal ordering', () => {
  const {tar} = fixture(), original = graph(tar);
  for (const change of [
    x => {x.schemaVersion = 1;}, x => {x.config.size = limits.document + 1;},
    x => {x.config.mediaType = 'text/plain';}, x => {x.config.urls = ['https://example.invalid/'];},
    x => {x.layers = [];}, x => {x.layers = Array(limits.layers + 1).fill(x.layers[0]);},
    x => {x.layers[0].size = limits.compressed + 1;}, x => {x.layers[0].digest = 'sha256:no';},
    x => {x.layers[0].data = '';}, x => {x.layers[0].mediaType = type + 'layer.v1.tar+zstd';},
  ]) {
    const changed = structuredClone(original.manifest); change(changed); const bytes = encode(changed);
    assert.throws(() => parseManifest(bytes, describe(bytes, type + 'manifest.v1+json')));
  }
  assert.throws(() => parseManifest(Buffer.concat([original.bytes, Buffer.from(' ')]), original.descriptor), /size differs/);
  const changed = Buffer.from(original.bytes); changed[0] ^= 1;
  assert.throws(() => parseManifest(changed, original.descriptor), /digest differs/);
  assert.throws(() => parseManifest(original.bytes, {...original.descriptor, size:limits.document + 1}), /bound/);
});

test('configuration refuses wrong platforms, mismatched DiffIDs, legacy images and intersecting volumes', () => {
  const {tar} = fixture(), original = graph(tar);
  for (const change of [
    x => {x.os = 'windows';}, x => {x.architecture = 'arm64';}, x => {x.variant = 'v8';},
    x => {x['os.features'] = [];}, x => {x.rootfs.type = 'unknown';}, x => {x.rootfs.diff_ids = [];},
    x => {x.rootfs.diff_ids = ['bad'];}, x => {delete x.config.Labels[label];},
    x => {x.config.Labels[label] = 'prismpm/sdk-metadata/2';},
    ...['/', '/opt', '/opt/prismpm', '/opt/prismpm/share', '/opt/prismpm/share/inventory.json',
      '/opt/prismpm/share/standards.lock/hidden', '/opt/../opt/prismpm'].map(path => x => {x.config.Volumes = {[path]:{}};}),
  ]) {
    const config = structuredClone(original.config); change(config); const bytes = encode(config);
    assert.throws(() => parseConfig(bytes, {...original.manifest, config:describe(bytes, type + 'config.v1+json')}, {os:'linux', architecture:'amd64'}));
  }
  const config = structuredClone(original.config); config.config.Volumes = {'/workspace':{}};
  const bytes = encode(config);
  assert.deepEqual(parseConfig(bytes, {...original.manifest, config:describe(bytes, type + 'config.v1+json')}, {os:'linux', architecture:'amd64'}), config);
  assert.throws(() => parseConfig(original.configBytes, original.manifest, {os:'windows', architecture:'amd64'}));
});

test('SDK volume admission matches the imported OCI null-or-object schema without hiding metadata', () => {
  const require=createRequire('/opt/prismpm/oracles/package.json');
  assert.equal(require('ajv/package.json').version,'8.20.0');
  assert.equal(require('ajv-draft-04/package.json').version,'1.0.0');
  const Ajv=require('ajv-draft-04'),ajv=new Ajv({strict:false,allErrors:true,validateFormats:false});
  const directory=new URL('../standards/oracles/oci-image-1.1.1/schema/',import.meta.url);
  ajv.addSchema(JSON.parse(readFileSync(new URL('defs.json',directory))),'https://opencontainers.org/schema/image/defs.json');
  const validate=ajv.compile(JSON.parse(readFileSync(new URL('config-schema.json',directory))));
  const original=graph(fixture().tar);
  const admit=value=>{const bytes=encode(value);return parseConfig(bytes,
    {...original.manifest,config:describe(bytes,type+'config.v1+json')},{os:'linux',architecture:'amd64'});};
  for(const volumes of [undefined,null,{}, {'/workspace':{}}, {'/workspace':{description:'opaque object'}}]) {
    const config=structuredClone(original.config);if(volumes!==undefined)config.config.Volumes=volumes;
    assert.equal(validate(config),true,JSON.stringify(validate.errors));
    assert.deepEqual(admit(config),config);
  }
  for(const volumes of [[],false,0,'',{'/workspace':null},{'/workspace':1},{'/workspace':[]}]) {
    const config=structuredClone(original.config);config.config.Volumes=volumes;
    assert.equal(validate(config),false,'independent OCI schema must reject invalid volume shape');
    assert.throws(()=>admit(config));
  }
  // The OCI schema permits these maps; the stricter SDK metadata-custody
  // profile must still refuse every intersecting mount and every case alias.
  for(const path of ['/opt','/opt/prismpm/share/inventory.json']) {
    const config=structuredClone(original.config);config.config.Volumes={[path]:{}};
    assert.equal(validate(config),true);assert.throws(()=>admit(config),/intersects/);
  }
  const alias=structuredClone(original.config);alias.config.Volumes=null;alias.config.Volumeſ={'/opt':{}};
  assert.throws(()=>admit(alias),/casing/);
});

test('coherently rehashed duplicate keys and field aliases cannot hide OCI volumes or layers', () => {
  const g = graph(fixture().tar);
  const check = bytes => parseConfig(bytes, {...g.manifest, config:describe(bytes, type + 'config.v1+json')}, {os:'linux', architecture:'amd64'});
  for (const key of ['volumes', 'VOLUMES', 'VolumeS', 'Volumeſ']) {
    const value = structuredClone(g.config); value.config[key] = {'/opt':{}};
    assert.throws(() => check(encode(value)), /casing/);
  }
  const original = g.configBytes.toString();
  for (const inserted of ['"config":{"Volumes":{"/opt":{}}},', '"os":"windows",', '"\\u006fs":"windows",']) {
    assert.throws(() => check(Buffer.from('{' + inserted + original.slice(1))), /duplicate/);
  }
  for (const key of ['Config', 'ROOTFS', 'OS']) {
    const value = structuredClone(g.config); value[key] = {};
    assert.throws(() => check(encode(value)), /casing/);
  }
  const bytes = Buffer.from('{"layers":[],' + g.bytes.toString().slice(1));
  assert.throws(() => parseManifest(bytes, describe(bytes, type + 'manifest.v1+json')), /duplicate/);
  const value = structuredClone(g.manifest); value.Layers = [];
  const aliased = encode(value);
  assert.throws(() => parseManifest(aliased, describe(aliased, type + 'manifest.v1+json')), /casing/);
});

test('strict JSON preserves ordinary syntax and rejects duplicate, malformed and deeply nested inputs', () => {
  const value = {unicode:'λ', escaped:'"\\\n', nested:[null, true, false, -1.25e20, {a:0}]};
  for (const text of [JSON.stringify(value), JSON.stringify(value, null, 2)]) assert.deepEqual(parseJson(Buffer.from(text)), value);
  for (const text of ['{"a":1,"a":2}', '{"a":{"b":1,"b":2}}', '[1,]', '{"a":1,}', 'true false',
    '"unterminated', '{"a":01}', '[[[[', '['.repeat(66) + '0' + ']'.repeat(66)])
    assert.throws(() => parseJson(Buffer.from(text)), text);
  assert.throws(() => parseJson(Buffer.from([0xff])), /encoded data/);
});

test('only the final layer is used, with matching final DiffID and no later replacement', () => {
  const f = fixture(), g = graph(f.tar);
  const lower = describe(Buffer.from('opaque lower filesystem layer not downloaded by metadata capture'), type + 'layer.v1.tar');
  g.manifest.layers.unshift(lower); g.config.rootfs.diff_ids.unshift(lower.digest);
  const configBytes = encode(g.config); g.manifest.config = describe(configBytes, type + 'config.v1+json');
  const bytes = encode(g.manifest), manifest = parseManifest(bytes, describe(bytes, type + 'manifest.v1+json'));
  const config = parseConfig(configBytes, manifest, {os:'linux', architecture:'amd64'});
  assert.deepEqual(decodeMetadataLayer(f.tar, manifest, config), {inventory:f.inventory, standards:f.standards});
  const later = Buffer.from('replacement'); manifest.layers.push(describe(later, type + 'layer.v1.tar'));
  config.rootfs.diff_ids.push(sha(later));
  assert.throws(() => decodeMetadataLayer(f.tar, manifest, config), /size differs/);
  assert.throws(() => decodeMetadataLayer(later, manifest, config), /alignment/);
});

test('closed tar rejects traversal, duplicates, missing ancestors, links, devices, sparse and extended headers', () => {
  const {tar} = fixture();
  for (const type of ['1', '2', '3', '4', '6', 'x', 'g', 'L', 'S']) {
    const bytes = Buffer.from(tar); bytes[156] = type.charCodeAt(0); headerChecksum(bytes);
    assert.throws(() => parseMetadataTar(bytes), /nonregular/);
  }
  for (const name of ['../opt/', '/opt/', 'opt//', './opt/', 'opt/.wh.share', 'unrelated/']) {
    const bytes = Buffer.from(tar); stringField(bytes, 0, 100, name); headerChecksum(bytes);
    assert.throws(() => parseMetadataTar(bytes));
  }
  for (const mutate of [
    x => stringField(x, 512, 100, 'opt/'),
    x => stringField(x, 157, 100, '/somewhere'),
    x => stringField(x, 345, 155, '../'),
    x => stringField(x, 100, 8, '0000777'),
    x => stringField(x, 108, 8, '0000001'),
    x => stringField(x, 124, 12, '0000 777'),
    x => {x[124] = 128;},
    x => {x[500] = 1;},
    x => {x[263] = 49;},
  ]) {
    const bytes = Buffer.from(tar); mutate(bytes); headerChecksum(bytes); headerChecksum(bytes, 512);
    assert.throws(() => parseMetadataTar(bytes));
  }
  assert.throws(() => parseMetadataTar(tar.subarray(512)), /parent|ancestors|absent/);
  const reordered = Buffer.from(tar); tar.copy(reordered, 0, 512, 1024); tar.copy(reordered, 512, 0, 512);
  assert.throws(() => parseMetadataTar(reordered), /parent/);
});

test('closed tar rejects truncation, payload padding, trailing data, checksum changes and oversized input', () => {
  const {tar} = fixture();
  for (const bytes of [tar.subarray(0, 100), tar.subarray(0, 3072), Buffer.concat([tar, Buffer.from([1])]),
    Buffer.alloc(limits.expanded + 512)]) assert.throws(() => parseMetadataTar(bytes));
  const changed = Buffer.from(tar); changed[100] ^= 1; assert.throws(() => parseMetadataTar(changed), /checksum/);
  const padding = Buffer.from(tar); padding[2100] = 1; assert.throws(() => parseMetadataTar(padding), /padding/);
  const trailing = Buffer.from(tar); trailing[tar.length - 1] = 1; assert.throws(() => parseMetadataTar(trailing), /trailing/);
});

test('layer verifies compressed digest, expanded DiffID and single gzip member without decompression bombs', () => {
  const {tar} = fixture(), original = graph(tar, 'amd64', true);
  assert.throws(() => decodeMetadataLayer(Buffer.from('wrong'), original.manifest, original.config), /size/);
  const changed = structuredClone(original.config); changed.rootfs.diff_ids[0] = sha('wrong');
  assert.throws(() => decodeMetadataLayer(original.layer, original.manifest, changed), /DiffID/);
  const variants = [Buffer.concat([original.layer, gzipSync(Buffer.alloc(0))]),
    Buffer.concat([original.layer, Buffer.alloc(8)]), original.layer.subarray(0, original.layer.length - 1),
    gzipSync(Buffer.alloc(limits.expanded + 1))];
  const badCrc = Buffer.from(original.layer); badCrc[badCrc.length - 8] ^= 1; variants.push(badCrc);
  for (const bytes of variants) {
    const manifest = structuredClone(original.manifest); manifest.layers[0] = describe(bytes, type + 'layer.v1.tar+gzip');
    assert.throws(() => decodeMetadataLayer(bytes, manifest, original.config));
  }
});
