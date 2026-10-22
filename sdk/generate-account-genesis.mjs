// SDK construction only: never accepts a caller-supplied model/artifact/receipt.
import assert from 'node:assert/strict';
import {closeSync,constants,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,opendirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {renderAccountGenesisBinding,verifyAccountGenesisConstruction} from './account-genesis-artifact.mjs';
import {createCompilerOwner} from '../tests/browser-view/compiler-owner.mjs';
import {prepareAccountGenesis,describeAccountGenesisArtifact,repository,sha} from '../tests/browser-account-genesis/compile.mjs';
import {requireGeneratedWasm} from '../tests/browser-view/generated-wasm.mjs';
import {captureFile,capturedFile} from '../tests/browser-view/file-custody.mjs';
const [mode,...extra]=process.argv.slice(2);
const proposal=mode==='proposal';
assert((extra.length===0 && ['check','install'].includes(mode)) ||
  (proposal && extra.length===2 && extra[1].trim().length>0 && Buffer.byteLength(extra[1])<=1024),
  'closed account-genesis construction command');
let proposalPath;
if(proposal) {
  proposalPath=resolve(extra[0]);
  assert(proposalPath===extra[0] && proposalPath!==repository && !proposalPath.startsWith(repository+sep),
    'proposal must use an exact external absolute path, never edit repository artifacts');
  assert(realpathSync(dirname(proposalPath))===dirname(proposalPath),'unaliased existing proposal parent');
  assert.throws(()=>lstatSync(proposalPath),{code:'ENOENT'},'proposal cannot overwrite existing evidence');
}
const compiler=createCompilerOwner('account-genesis');
let build,retired=false,completed=false,failed=false;
try {
build=prepareAccountGenesis(compiler);
const binding=describeAccountGenesisArtifact(build),source=renderAccountGenesisBinding(binding);
const artifact=requireGeneratedWasm(build.wasmOwners['account-genesis']);
const wasm=Buffer.from(artifact.bytes),bindingPath=join(repository,'sdk/browser/account-genesis-binding.mjs');
const wasmPath=join(repository,'sdk/browser/account-genesis.wasm');
const proofs=['attestation.json','build-manifest.json'].map(name=>[name,readFileSync(join(build.verified.root,name))]);
proofs.push(['kernel.ir',readFileSync(join(build.work,'export/kernel.ir'))]);
for(const path of [bindingPath,wasmPath]) {
  const stat=lstatSync(path);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1,'single-link generated SDK artifact');
}
if(!proposal) {
  assert.equal(readFileSync(bindingPath,'utf8'),source,'binding must match actual complete model/kernel/package constructor');
  assert.deepEqual(readFileSync(wasmPath),wasm,'committed artifact must equal both fresh generated Wasm builds');
}
build.unchanged();const retirement=compiler.close();retired=true;
assert.throws(()=>compiler.runDriver(['--help'],build.work),/compiler owner closed/);
build.unchangedSourcesAndProducts();
if(proposal) {
  // Authoring output is deliberately outside the captured source. The
  // immutable check/install path above never consumes or trusts this proposal.
  assert(proposalPath!==build.work && !proposalPath.startsWith(build.work+sep));
  mkdirSync(proposalPath,{recursive:false,mode:0o700});
  const parent=dirname(proposalPath);
  let parentFd,rootFd,publicationError;
  try {
  parentFd=openSync(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  rootFd=openSync(proposalPath,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const parentBefore=fstatSync(parentFd,{bigint:true}),rootBefore=fstatSync(rootFd,{bigint:true});
  const unchangedDirectory=(path,before)=>{
    for(const current of [fstatSync(path===parent?parentFd:rootFd,{bigint:true}),lstatSync(path,{bigint:true})]) {
      assert(current.isDirectory()&&!current.isSymbolicLink());
      for(const field of ['dev','ino','mode','uid','gid'])assert.equal(current[field],before[field],'unchanged proposal directory');
    }
    assert.equal(realpathSync(path),path,'unaliased proposal directory');
  };
  const rows=[],captures=[];let total=0;
  const publish=(path,bytes)=>{
    assert(typeof path==='string' && !path.startsWith('/') &&
      !path.split('/').some(part=>!part || part==='.' || part==='..') && Buffer.byteLength(path)<=4096);
    const maximum=(['compiler/driver','compiler/exporter'].includes(path)?256:64)*1024**2;
    assert(Buffer.isBuffer(bytes) && bytes.length<=maximum && rows.length<4096);
    total+=bytes.length;assert(total<=768*1024**2,'bounded complete proposal');
    unchangedDirectory(parent,parentBefore);unchangedDirectory(proposalPath,rootBefore);
    const destination=join(proposalPath,path);
    mkdirSync(dirname(destination),{recursive:true,mode:0o700});
    const fd=openSync(destination,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o444);
    let writeError;
    try {
      assert(fstatSync(fd).isFile()&&fstatSync(fd).nlink===1);
      writeFileSync(fd,bytes);fsyncSync(fd);
    } catch(error) {writeError=error;throw error;}
    finally {
      try {closeSync(fd);}catch(error) {
        throw new AggregateError(writeError?[writeError,error]:[error],
          'proposal file publication or retirement failed',{cause:writeError});
      }
    }
    const captured=captureFile(destination);assert.deepEqual(captured.bytes,bytes);
    captures.push({path:destination,evidence:captured.evidence});
    unchangedDirectory(parent,parentBefore);unchangedDirectory(proposalPath,rootBefore);
    rows.push({path,bytes:bytes.length,sha256:sha(bytes)});
  };
  publish('UNACCEPTED.txt',Buffer.from(
    'Preparation only. Complete DK33, installed SDK, both native platforms and full V&V remain required.\n'));
  const candidates=[['account-genesis-binding.mjs',Buffer.from(source)],['account-genesis.wasm',wasm]];
  for(const [path,bytes] of [...candidates,...proofs])publish(path,bytes);
  publish('observations.json',Buffer.from(JSON.stringify({
    compiler:build.compilerTools,wasm:build.generatedWasm,packages:build.generatedPackages,
  })+'\n'));
  for(const [name,files] of Object.entries(build.generatedPackages)) {
    const directory=join(build.work,name==='native'?'generated':name);
    for(const [path,digest] of Object.entries(files)) {
      const captured=captureFile(join(directory,path));assert.equal(sha(captured.bytes),digest);
      publish('packages/'+name+'/'+path,captured.bytes);
    }
  }
  for(const [name,owner] of Object.entries(build.wasmArtifacts))
    publish('wasm/'+name+'.wasm',Buffer.from(requireGeneratedWasm(owner).bytes));
  for(const name of ['driver','exporter']) {
    const evidence=build.compilerTools[name].private;
    const captured=captureFile(join(build.compilerTools.work,evidence.path),256*1024**2);
    assert.equal(sha(captured.bytes),evidence.sha256);
    for(const [actual,expected] of [['dev','device'],['ino','inode'],['uid','uid'],['gid','gid'],
      ['mode','mode'],['nlink','links'],['size','size']])
      assert.equal(captured.evidence[actual],String(evidence[expected]),'retired private executable identity');
    publish('compiler/'+name,captured.bytes);
  }
  for(const name of ['compiler-owner-retirement-intent.json','compiler-owner-retirement.json'])
    publish('compiler/'+name,captureFile(join(build.compilerTools.work,name)).bytes);
  build.unchangedSourcesAndProducts();
  for(const capture of captures)capturedFile(capture.path,capture.evidence);
  publish('proposal.json',Buffer.from(JSON.stringify({
    schema:'prismpm/account-genesis-proposal/1',scope:'unaccepted-source-authoring-only',
    reason:extra[1],binding,files:rows.slice(),inputs:build.inputs,retirement,product_acceptance:false,
  })+'\n'));
  build.unchangedSourcesAndProducts();
  const expectedDirectories=new Set(['.']);
  for(const {path} of rows)for(let directory=dirname(path);directory!=='.';directory=dirname(directory))
    expectedDirectories.add(directory);
  const expectedFiles=new Set(rows.map(row=>row.path)),seenFiles=new Set(),seenDirectories=new Set();
  const pending=['.'];
  while(pending.length) {
    const relative=pending.pop(),directory=join(proposalPath,relative);
    assert(expectedDirectories.has(relative)&&!seenDirectories.has(relative),'closed proposal directory census');
    seenDirectories.add(relative);
    const before=lstatSync(directory,{bigint:true});
    assert(before.isDirectory()&&!before.isSymbolicLink()&&realpathSync(directory)===directory);
    const stream=opendirSync(directory,{bufferSize:1});
    try {
      for(let entry;(entry=stream.readSync())!==null;) {
        const path=relative==='.'?entry.name:relative+'/'+entry.name;
        const stat=lstatSync(join(proposalPath,path));
        if(stat.isDirectory()&&!stat.isSymbolicLink()) {
          assert(expectedDirectories.has(path),'unexpected proposal directory');pending.push(path);
        } else {
          assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&expectedFiles.has(path),
            'unexpected or aliased proposal member');
          assert(!seenFiles.has(path));seenFiles.add(path);
        }
      }
    } finally {stream.closeSync();}
    const after=lstatSync(directory,{bigint:true});
    for(const field of ['dev','ino','mode','uid','gid','nlink','size','mtimeNs','ctimeNs'])
      assert.equal(after[field],before[field],'unchanged proposal directory census');
  }
  assert.deepEqual([...seenFiles].sort(),[...expectedFiles].sort());
  assert.deepEqual([...seenDirectories].sort(),[...expectedDirectories].sort());
  for(const capture of captures)capturedFile(capture.path,capture.evidence);
  unchangedDirectory(parent,parentBefore);unchangedDirectory(proposalPath,rootBefore);
  fsyncSync(rootFd);fsyncSync(parentFd);
  } catch(error) {publicationError=error;throw error;}
  finally {
    const errors=[];
    for(const fd of [rootFd,parentFd])if(fd!==undefined)try {closeSync(fd);}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(publicationError?[publicationError,...errors]:errors,
      'proposal publication or directory retirement failed',{cause:publicationError});
  }
}
if(mode==='install') {
  const output='/opt/prismpm/browser/account-genesis.wasm',proofRoot='/opt/prismpm/share/account-genesis';
  writeFileSync(output,wasm,{flag:'wx',mode:0o444});
  mkdirSync(proofRoot,{recursive:false});
  const rows=[];
  for(const [name,bytes] of proofs) {
    assert(bytes.length<=64*1024**2);writeFileSync(join(proofRoot,name),bytes,{flag:'wx',mode:0o444});
    rows.push({path:name,bytes:bytes.length,sha256:sha(bytes)});
  }
  writeFileSync(join(proofRoot,'construction.json'),JSON.stringify({schema:'prismpm/account-genesis-construction/1',
    binding,installed:[['account-genesis-binding.mjs',Buffer.from(source)],['account-genesis.wasm',wasm]]
      .map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes)})),
    proofs:rows,inputs:build.inputs,scope:'construction-only-not-account-service-or-full-owner-acceptance'})+'\n',{flag:'wx',mode:0o444});
  assert.deepEqual(readFileSync(output),wasm);
  assert.equal(readFileSync('/opt/prismpm/browser/account-genesis-binding.mjs','utf8'),source);
  assert.deepEqual(verifyAccountGenesisConstruction('/opt/prismpm',build.inputs),binding);
}
console.log(JSON.stringify({mode,binding,retirement,...(proposal?{retained_work:build.work}:{}),
  scope:'actual account-genesis artifact construction; complete DK33/SDK acceptance remains mandatory'}));
if(!proposal)rmSync(build.work,{recursive:true,force:false});
completed=true;
} catch(error) {failed=true;throw error;}
finally {
  if(!retired)try {compiler.close();}catch(error){if(!failed)throw error;}
  if(build&&!completed)process.stderr.write('Retained incomplete account-genesis construction '+build.work+'\n');
}
