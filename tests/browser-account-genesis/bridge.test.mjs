import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync,copyFileSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {openAccountGenesis} from '../../sdk/browser/account-genesis.mjs';
import {corpus, encode} from './corpus.mjs';
import {canonical, mutations, mutateAccountGenesisSource} from './mutations.mjs';
import {journeyNames, verifyObservations} from './browser.mjs';
import {verifySemanticCounterexample} from './host-mutations.mjs';
import {coherentlyRehashedManifest,executeRequiredSubtest,verifyNativeInventory} from './checks.mjs';
import {frozenInputs,verifyFrozenInputs,repository,sha,describeAccountGenesisArtifact} from './compile.mjs';
import {captureCompilerInputs} from '../browser-view/compiler-owner.mjs';
import {renderAccountGenesisBinding,verifyAccountGenesisConstruction} from '../../sdk/account-genesis-artifact.mjs';
import {accountGenesisBinding} from '../../sdk/browser/account-genesis-binding.mjs';

test('private account factory captures closed data options and refuses shape-only artifacts', async () => {
  for (const value of [null, {}, {wire: new Uint8Array()}, {wire: [], wireDigest: []}])
    await assert.rejects(openAccountGenesis(value), {code: 'invalid-input'});
  let read = false;
  await assert.rejects(openAccountGenesis({get wire() {read = true; return new Uint8Array();},
    wireDigest: new Uint8Array(32)}), {code: 'invalid-input'});
  assert.equal(read, false);
});

test('account construction authoring command refuses invalid or overwrite paths before compilation', t => {
  const root=mkdtempSync(join(tmpdir(),'prismpm-account-proposal-cli-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const generator=join(repository,'sdk/generate-account-genesis.mjs');
  const absent=join(root,'absent'),existing=join(root,'existing'),alias=join(root,'alias');
  mkdirSync(existing);symlinkSync(existing,alias);
  const cases=[[],['unknown'],['check','extra'],['install','extra'],['proposal'],
    ['proposal',absent],['proposal',absent,''],['proposal',absent,'  '],
    ['proposal',absent,'x'.repeat(1025)],['proposal','relative','reason'],
    ['proposal',repository,'reason'],['proposal',join(repository,'proposal-output'),'reason'],
    ['proposal',join(root,'missing-parent','output'),'reason'],['proposal',existing,'reason'],
    ['proposal',join(alias,'output'),'reason']];
  for(const args of cases) {
    const child=spawnSync(process.execPath,[generator,...args],
      {encoding:'utf8',timeout:10000,maxBuffer:1048576});
    assert.equal(child.error,undefined);assert.equal(child.signal,null);
    assert.equal(child.status,1,JSON.stringify(args)+': '+child.stdout+child.stderr);
    assert.equal(child.stdout,'');
    assert.doesNotMatch(child.stderr,/Retained failed compiler owner|Retained incomplete account-genesis/,
      'refusal precedes real compiler ownership');
  }
  assert.equal(lstatSync(absent,{throwIfNoEntry:false}),undefined);
});

test('canonical binding data cannot substitute for an actual unmutated model constructor', t => {
  const source = readFileSync(new URL('../../sdk/browser/account-genesis-binding.mjs', import.meta.url), 'utf8');
  assert.equal(renderAccountGenesisBinding({...accountGenesisBinding}), source);
  const bytes = readFileSync(new URL('../../sdk/browser/account-genesis.wasm', import.meta.url));
  assert.equal(bytes.length, accountGenesisBinding.wasm_bytes);
  assert.equal(sha(bytes), accountGenesisBinding.wasm_sha256);
  // This byte/format check is not a kernel proof. Only the fresh private
  // constructor in the owning gate may establish the actual binding.
  for (const value of [{}, {...accountGenesisBinding}, Object.freeze({...accountGenesisBinding})])
    assert.throws(() => describeAccountGenesisArtifact(value), /actual unmutated account-genesis constructor/);
  for (const change of [value => {value.wasm_sha256 = 'self-selected';}, value => {value.extra = true;},
    value => {value.wasm_bytes = 0;}, value => {value.schema = 'other';}]) {
    const value = {...accountGenesisBinding}; change(value);
    assert.throws(() => renderAccountGenesisBinding(value));
  }
  let getterRead = false;
  assert.throws(() => renderAccountGenesisBinding({...accountGenesisBinding,
    get wasm_sha256() {getterRead = true; return accountGenesisBinding.wasm_sha256;}}));
  assert.equal(getterRead,false,'format validation never invokes a binding accessor');

  // Deliberately synthetic integrity-reader fixture, never kernel/model proof.
  // Actual installation must obtain these records from the private constructor.
  const root = mkdtempSync(join(tmpdir(),'prismpm-account-construction-reader-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const sourceDigest = '1'.repeat(64), packages = {'account-genesis-a': {'src/lib.rs': '2'.repeat(64)}};
  const inputs = {'stdlib/src/Fixture.lex.tex': sourceDigest};
  const kernel = Buffer.from('synthetic reader-only IR, not an executable model');
  const binding = {...accountGenesisBinding,ir_sha256:sha(kernel),
    model_closure_sha256:sha(Buffer.from(JSON.stringify({Fixture:sourceDigest}))),
    package_sha256:sha(Buffer.from(JSON.stringify(packages['account-genesis-a'])))};
  const manifest = Buffer.from(JSON.stringify({source_id:binding.model_source_id,build_id:'fixture'}));
  const attestation = Buffer.from(JSON.stringify({spec:'lexlean/attestation/1',status:'verified',
    source_id:binding.model_source_id,build_id:'fixture',build_manifest:{sha256:sha(manifest)}}));
  const originals = new Map([
    ['browser/account-genesis-binding.mjs',Buffer.from(renderAccountGenesisBinding(binding))],
    ['browser/account-genesis.wasm',bytes],['share/account-genesis/attestation.json',attestation],
    ['share/account-genesis/build-manifest.json',manifest],['share/account-genesis/kernel.ir',kernel],
  ]);
  const rows = (names,prefix)=>names.map(path=>{const content=originals.get(prefix+path);
    return {path,bytes:content.length,sha256:sha(content)};});
  const record = {schema:'prismpm/account-genesis-construction/1',binding,
    installed:rows(['account-genesis-binding.mjs','account-genesis.wasm'],'browser/'),
    proofs:rows(['attestation.json','build-manifest.json','kernel.ir'],'share/account-genesis/'),
    inputs,
    scope:'construction-only-not-account-service-or-full-owner-acceptance'};
  originals.set('share/account-genesis/construction.json',Buffer.from(JSON.stringify(record)+'\n'));
  for(const [relative,content] of originals) {
    const path=join(root,relative);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);
  }
  const verify=()=>verifyAccountGenesisConstruction(root,inputs);
  assert.deepEqual(verify(),binding);
  assert.throws(()=>verifyAccountGenesisConstruction(root,{}),'independently verified inputs required');
  assert.throws(()=>verifyAccountGenesisConstruction(root,{...inputs,'stdlib/src/Fixture.lex.tex':'9'.repeat(64)}));
  for(const [relative,content] of originals) {
    const path=join(root,relative);
    writeFileSync(path,Buffer.concat([content,Buffer.from('x')]));
    assert.throws(verify,undefined,'changed installed member '+relative);
    writeFileSync(path,content);
    const saved=path+'.original';renameSync(path,saved);symlinkSync(saved,path);
    assert.throws(verify,undefined,'aliased installed member '+relative);
    unlinkSync(path);renameSync(saved,path);
  }
  for(const change of [value=>{value.binding.wasm_bytes++;},value=>{value.installed.reverse();},
    value=>{value.proofs.pop();},value=>{value.inputs['stdlib/src/Fixture.lex.tex']='3'.repeat(64);},
    value=>{value.generatedWasm={};},
    value=>{value.extra=true;}]) {
    const value=structuredClone(record);change(value);
    writeFileSync(join(root,'share/account-genesis/construction.json'),JSON.stringify(value)+'\n');
    assert.throws(verify);
  }
  writeFileSync(join(root,'share/account-genesis/construction.json'),originals.get('share/account-genesis/construction.json'));
  assert.deepEqual(verify(),binding);
});

test('canonical source and every canonical mutant bind one changed module and a real counterexample', () => {
  const names = ['Foundation.Browser.Application.V1.AccountGenesis',
    'Foundation.Browser.Application.V1.AccountGenesisWire'];
  const original = new Map(names.map(name => [name,
    readFileSync(new URL('../../stdlib/src/' + name.replaceAll('.', '/') + '.lex.tex', import.meta.url))]));
  const checkCanonical = source => {
    const text = source.toString('utf8'), json = /\\semanticdata\{(.*)\}/.exec(text)[1];
    const data = JSON.parse(json);
    assert.equal(json, JSON.stringify(canonical(data)), 'actual canonical semantic JSON');
    const available = new Set([...text.matchAll(/\\importmodule\{([^}]+)\}/g)].map(row => row[1]));
    available.add(/\\begin\{lexlean\}\{([^}]+)\}/.exec(text)[1]);
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (typeof value.module === 'string') assert.ok(available.has(value.module),
        'qualified semantic reference requires its direct import: ' + value.module);
      for (const child of Object.values(value))
        if (Array.isArray(child)) child.forEach(visit); else visit(child);
    };
    visit(data);
  };
  for (const source of original.values()) checkCanonical(source);
  const ids = new Set(corpus().map(row => row.id));
  for (const mutation of mutations) {
    const source = new Map(original);
    mutateAccountGenesisSource(source, mutation.id);
    for (const bytes of source.values()) checkCanonical(bytes);
    assert.equal([...source].filter(([name, bytes]) => !bytes.equals(original.get(name))).length, 1);
    assert.ok(ids.has(mutation.probe));
  }
});

test('observation contract requires exact operation tags, native inventory and executed checks', async () => {
  const operations = [[2, 1], [2, 1], [2], [2], [2, 1], [], [], [2, 1], [], [], [], [2]];
  const calls = [], journeys = journeyNames.map((id, index) => {
    const start = calls.length;
    for (const operation of operations[index]) calls.push({request: encode([1, operation]).toString('hex')});
    return {id, start, end: calls.length};
  });
  verifyObservations({calls, journeys});
  const changed = structuredClone({calls, journeys}); changed.calls[0].request = encode([1, 0]).toString('hex');
  assert.throws(() => verifyObservations(changed), /exact source operation tags/);
  const summary = 'PASS Probe\nPASS 1 account-genesis vectors twice\n';
  verifyNativeInventory(summary, [{id: 'Probe'}]);
  assert.throws(() => verifyNativeInventory(summary.replace('1 account-genesis', '1 journal account-genesis'),
    [{id: 'Probe'}]), /exact native case inventory/);
  const runner = readFileSync(new URL('./runner.rs', import.meta.url), 'utf8');
  assert.ok(runner.includes('println!("PASS {count} account-genesis vectors twice");'));
  assert.ok(runner.includes('println!("PASS binary account-genesis twice");'));
  await assert.rejects(executeRequiredSubtest({test: async () => {}}, 'omitted', () => true),
    /required account-genesis subtest body was not executed/);
  for (const failure of [undefined, null, false, 0, '']) {
    let rejected = false;
    try {
      await executeRequiredSubtest({test: async (_name, body) => {
        try {await body();} catch {}
      }}, 'falsy failure', () => {throw failure;});
    } catch (error) {rejected = true; assert.equal(error, failure);}
    assert.ok(rejected, 'even a falsy thrown value must prevent completion');
  }
  const helper = new URL('./checks.mjs', import.meta.url).href;
  const source = `import test from 'node:test'; import {executeRequiredSubtest} from ${JSON.stringify(helper)};
    test('actual required owner',async t=>{
      await executeRequiredSubtest(t,'actual failed child',()=>{throw 0});
      console.log('INCORRECT_OWNER_ACCEPTANCE');
    });`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source],
    {encoding: 'utf8', timeout: 10000});
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.equal(child.status, 1, child.stderr);
  assert.match(child.stdout, /actual failed child/);
  assert.doesNotMatch(child.stdout, /INCORRECT_OWNER_ACCEPTANCE/);
});

test('counterfeit semantic error labels and fields never establish assertion provenance', () => {
  const record = {journey: 'declaration', check: 'key-identity', expected: 'sha256:' + '00'.repeat(32), actual: 'sha256:' + '01'.repeat(32)};
  for (const error of [record, Object.freeze({...record}),
    Object.assign(Error('actual account-genesis semantic counterexample'), record),
    Error('planted ordinary SDK failure: key-identity')])
    assert.throws(() => verifySemanticCounterexample(error, 'key-identity'), /privately branded/);
});

test('coherently changed package fixture preserves canonical bytes to reach immutable custody',()=>{
  const bytes=Buffer.from('changed generated library\n');
  const original=Buffer.from(JSON.stringify({schema:'fixture',files:[{path:'src/lib.rs',sha256:'0'.repeat(64)}]})+'\n');
  const changed=coherentlyRehashedManifest(original,bytes);
  assert.equal(changed.toString(),JSON.stringify(JSON.parse(changed))+'\n');
  assert.deepEqual(JSON.parse(changed),{schema:'fixture',files:[{path:'src/lib.rs',sha256:sha(bytes)}]});
  assert.notDeepEqual(changed,original);
  for(const files of [[],[{path:'src/lib.rs'},{path:'src/lib.rs'}]])
    assert.throws(()=>coherentlyRehashedManifest(Buffer.from(JSON.stringify({files})),bytes),/one actual generated library/);
});

test('account owner captures its complete current compiler subset and refuses original source substitutions',t=>{
  const inputs=frozenInputs();verifyFrozenInputs(inputs);
  for(const [path,digest] of Object.entries(captureCompilerInputs('account-genesis')))
    assert.equal(inputs[path],digest,'actual current compiler-only source subset '+path);
  for(const forged of [Object.freeze({...inputs}),Object.freeze({})])
    assert.throws(()=>verifyFrozenInputs(forged),/actual complete captured account-genesis inputs/);
  const root=mkdtempSync(join(tmpdir(),'prismpm-account-input-custody-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const path of Object.keys(inputs)) {
    const destination=join(root,path);mkdirSync(dirname(destination),{recursive:true});
    copyFileSync(join(repository,path),destination);
  }
  const childSource=`import assert from 'node:assert/strict';
  import {chmodSync,copyFileSync,linkSync,lstatSync,readFileSync,renameSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
  import {join} from 'node:path';
  import * as isolated from ${JSON.stringify(pathToFileURL(join(root,'tests/browser-account-genesis/compile.mjs')).href)};
  const path=join(isolated.repository,'tests/browser-account-genesis/runner.rs'),bytes=readFileSync(path),mode=lstatSync(path).mode&0o777;
  for(const kind of ['content','deleted','inode','mode','hardlink','symlink']) {
    const captured=isolated.frozenInputs(),saved=path+'.original';isolated.verifyFrozenInputs(captured);
    try {
      if(kind==='content')writeFileSync(path,Buffer.concat([bytes,Buffer.from('\\n')]));
      if(kind==='mode')chmodSync(path,mode^0o040);
      if(['deleted','inode','hardlink','symlink'].includes(kind)) {
        renameSync(path,saved);
        if(kind==='inode')copyFileSync(saved,path);
        if(kind==='hardlink')linkSync(saved,path);
        if(kind==='symlink')symlinkSync(saved,path);
      }
      assert.throws(()=>isolated.verifyFrozenInputs(captured),undefined,'actual source '+kind+' substitution');
    } finally {
      if(['deleted','inode','hardlink','symlink'].includes(kind)) {
        if(kind!=='deleted')unlinkSync(path);renameSync(saved,path);
      } else {writeFileSync(path,bytes);chmodSync(path,mode);}
    }
  }
  console.log('PASS six actual original source custody substitutions');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',childSource],
    {encoding:'utf8',timeout:120000,maxBuffer:1048576});
  assert.equal(child.error,undefined);assert.equal(child.signal,null);
  assert.equal(child.status,0,child.stdout+child.stderr);
  assert.equal(child.stdout,'PASS six actual original source custody substitutions\n');
});
