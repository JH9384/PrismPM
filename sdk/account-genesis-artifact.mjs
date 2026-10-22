// Canonical data formatting only. A record is not proof of construction.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,lstatSync,openSync,readdirSync,readSync} from 'node:fs';
import {join,parse,resolve} from 'node:path';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const closed = (value, names) => {
  assert(value && Object.getPrototypeOf(value) === Object.prototype);
  const fields = Object.getOwnPropertyDescriptors(value);
  assert.deepEqual(Reflect.ownKeys(fields).sort(), names.slice().sort());
  for (const name of names) assert(Object.hasOwn(fields[name], 'value'));
};
export function renderAccountGenesisBinding(value) {
  const names=['schema','model_source_id','model_closure_sha256','ir_sha256','wasm_sha256','wasm_bytes','package_sha256'];
  closed(value,names);
  assert.equal(value.schema,'prismpm/account-genesis-binding/1');
  for(const name of names.filter(name=>name!=='schema'&&name!=='wasm_bytes'))
    {assert.equal(typeof value[name],'string');assert.match(value[name],/^[a-f0-9]{64}$/);}
  assert(Number.isSafeInteger(value.wasm_bytes)&&value.wasm_bytes>=8&&value.wasm_bytes<=67108864);
  return '// Generated from verified LexLean/kernel/IR and two equal generated Wasm artifacts.\n'
    +'// Package integrity requires the independently verified SDK inventory.\n'
    +'export const accountGenesisBinding = Object.freeze('
    +JSON.stringify(Object.fromEntries(names.map(name=>[name,value[name]])))+');\n';
}

// Integrity joins for an independently inventory-verified installed SDK. This
// reader is not a signature verifier, model constructor, or account authority.
export function verifyAccountGenesisConstruction(sdkRoot, expectedInputs) {
  assert(expectedInputs && Object.getPrototypeOf(expectedInputs) === Object.prototype);
  const root = resolve(sdkRoot), captures = [];
  function read(relative) {
    const path = join(root, relative);
    let parent = parse(path).root;
    for (const name of path.slice(parent.length).split('/').slice(0,-1)) {
      parent = join(parent,name);
      const stat = lstatSync(parent);
      assert(stat.isDirectory() && !stat.isSymbolicLink(), 'unaliased SDK proof parent');
    }
    const fd = openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      assert(before.isFile() && before.nlink === 1 && before.size <= 64*1024**2,
        'bounded single-link installed proof');
      const bytes = Buffer.alloc(before.size + 1); let count = 0;
      while (count < bytes.length) {
        const size = readSync(fd,bytes,count,bytes.length-count,null);
        if (!size) break;
        count += size;
      }
      const unchanged = () => {
        const named = lstatSync(path);
        assert(named.isFile() && !named.isSymbolicLink());
        for (const field of ['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'])
          assert.equal(named[field],before[field],'unchanged installed proof '+relative);
      };
      for (const field of ['dev','ino','size','mode','uid','gid','nlink','mtimeMs','ctimeMs'])
        assert.equal(fstatSync(fd)[field],before[field]);
      assert.equal(count,before.size);unchanged();captures.push(unchanged);
      return bytes.subarray(0,count);
    } finally {closeSync(fd);}
  }
  const proofRoot = join(root,'share/account-genesis');
  const recordBytes = read('share/account-genesis/construction.json');
  assert.deepEqual(readdirSync(proofRoot).sort(),
    ['attestation.json','build-manifest.json','construction.json','kernel.ir']);
  const record = JSON.parse(recordBytes);
  assert.equal(recordBytes.toString(),JSON.stringify(record)+'\n','canonical construction record');
  closed(record,['schema','binding','installed','proofs','inputs','scope']);
  assert.equal(record.schema,'prismpm/account-genesis-construction/1');
  assert.equal(record.scope,'construction-only-not-account-service-or-full-owner-acceptance');
  const bindingBytes = read('browser/account-genesis-binding.mjs');
  assert.equal(bindingBytes.toString(),renderAccountGenesisBinding(record.binding));
  function rows(rows, paths, prefix) {
    assert(Array.isArray(rows));assert.deepEqual(rows.map(row=>row.path),paths);
    return rows.map(row => {
      closed(row,['path','bytes','sha256']);
      assert(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 64*1024**2);
      assert.equal(typeof row.sha256,'string');assert.match(row.sha256,/^[a-f0-9]{64}$/);
      const bytes = read(prefix+row.path);
      assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);
      return bytes;
    });
  }
  const installed = rows(record.installed,['account-genesis-binding.mjs','account-genesis.wasm'],'browser/');
  assert.deepEqual(installed[0],bindingBytes);
  assert.equal(installed[1].length,record.binding.wasm_bytes);
  assert.equal(sha(installed[1]),record.binding.wasm_sha256);
  const proofs = rows(record.proofs,['attestation.json','build-manifest.json','kernel.ir'],'share/account-genesis/');
  const attestation = JSON.parse(proofs[0]), manifest = JSON.parse(proofs[1]);
  assert.equal(attestation.spec,'lexlean/attestation/1');assert.equal(attestation.status,'verified');
  assert.equal(attestation.source_id,record.binding.model_source_id);
  assert.equal(manifest.source_id,record.binding.model_source_id);
  assert.equal(attestation.build_manifest.sha256,sha(proofs[1]));
  assert.equal(attestation.build_id,manifest.build_id);
  assert.equal(sha(proofs[2]),record.binding.ir_sha256);
  assert(record.inputs && Object.getPrototypeOf(record.inputs) === Object.prototype);
  assert(Object.keys(record.inputs).length > 0);
  for (const [path,digest] of Object.entries(record.inputs)) {
    assert(Object.hasOwn(expectedInputs,path),'construction input belongs to the independently verified source snapshot');
    assert.equal(digest,expectedInputs[path],'construction input joins the independently verified source snapshot: '+path);
  }
  const moduleRows = Object.entries(record.inputs).filter(([path])=>path.endsWith('.lex.tex'))
    .map(([path,digest])=> {
      assert(path.startsWith('stdlib/src/'));
      assert.equal(typeof digest,'string');assert.match(digest,/^[a-f0-9]{64}$/);
      return [path.slice('stdlib/src/'.length,-'.lex.tex'.length).replaceAll('/','.'),digest];
    }).sort(([a],[b])=>a<b?-1:a>b?1:0);
  assert(moduleRows.length > 0);
  assert.equal(sha(Buffer.from(JSON.stringify(Object.fromEntries(moduleRows)))),record.binding.model_closure_sha256);
  // Package/compiler/retirement metadata are deliberately not reproduced here:
  // only the actual fresh constructor and complete installed owners verify
  // those products. A self-reported artifact map would not prove their bytes.
  for (const unchanged of captures) unchanged();
  return Object.freeze({...record.binding});
}
