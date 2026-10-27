#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

// The LexLean package version this repository selects (the v0.4.0 tag).
export const LEXLEAN_VERSION='0.4.0';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command,args,cwd) => {
  const result=spawnSync(command,args,{cwd,env:{...process.env,CARGO_NET_OFFLINE:'true'},encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
  if(result.status!==0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
};

const present = path => {
  try { lstatSync(path); return true; } catch(error) { if(error.code==='ENOENT') return false; throw error; }
};
const directoryIdentity = path => {
  const st=lstatSync(path,{bigint:true}); assert.ok(st.isDirectory()&&!st.isSymbolicLink(),`not an owned directory: ${path}`);
  return [st.dev,st.ino];
};
const requireDirectory = (path,identity) => assert.deepEqual(directoryIdentity(path),identity,`owned directory changed: ${path}`);
const regularIdentity = path => {
  const st=lstatSync(path,{bigint:true});
  assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1n,`not a private regular input: ${path}`);
  return [st.dev,st.ino,st.mode,st.nlink,st.uid,st.gid];
};

// Internal, serialized repository producer transaction. Validation failures
// retain the original vendor plus exact register/lock bytes. This is not a
// crash-atomic multi-path publication or an adversarial same-UID filesystem API.
export function replaceDependencyTransaction(repoRoot, prepare, validate, writeDependency=writeFileSync) {
  const vendor=join(repoRoot,'vendor/lexlean'), stage=join(repoRoot,'vendor/.lexlean-reconcile-stage'), backup=join(repoRoot,'vendor/.lexlean-reconcile-backup');
  const dependencyPath=join(repoRoot,'model/dependencies.toml'), lockPath=join(repoRoot,'Cargo.lock');
  const parents=[repoRoot,join(repoRoot,'vendor'),join(repoRoot,'model')].map(path=>[path,directoryIdentity(path)]);
  const requireParents=()=>{for(const [path,identity] of parents)requireDirectory(path,identity);};
  const dependencyIdentity=regularIdentity(dependencyPath), lockIdentity=regularIdentity(lockPath);
  assert.ok(!present(stage)&&!present(backup),'prior reconciliation stage or backup exists; refusing replacement');
  const original=directoryIdentity(vendor), dependency=readFileSync(dependencyPath), lock=readFileSync(lockPath);
  let staged, moved=false, installed=false, committed=false, primary;
  try {
    mkdirSync(stage); staged=directoryIdentity(stage);
    const updated=prepare(stage,dependency.toString('utf8'));
    requireParents();
    requireDirectory(stage,staged); requireDirectory(vendor,original);
    assert.deepEqual(regularIdentity(dependencyPath),dependencyIdentity);assert.deepEqual(regularIdentity(lockPath),lockIdentity);
    assert.deepEqual(readFileSync(dependencyPath),dependency); assert.deepEqual(readFileSync(lockPath),lock);
    assert.ok(!present(backup),'foreign reconciliation backup appeared');
    renameSync(vendor,backup); moved=true;
    renameSync(stage,vendor); installed=true;
    writeDependency(dependencyPath,updated);
    const value=validate();
    requireParents();regularIdentity(dependencyPath);regularIdentity(lockPath);
    requireDirectory(vendor,staged); requireDirectory(backup,original);
    committed=true;
    rmSync(backup,{recursive:true}); moved=false;
    return value;
  } catch(error) {
    primary=error;
    if(!committed){
      const failures=[];
      const attempt=action=>{try{action();}catch(failure){failures.push(failure);}};
      if(installed) attempt(()=>{requireParents();requireDirectory(vendor,staged);assert.ok(!present(stage),'foreign stage prevents rollback');renameSync(vendor,stage);installed=false;});
      if(moved&&!installed) attempt(()=>{requireParents();requireDirectory(backup,original);assert.ok(!present(vendor),'foreign vendor prevents rollback');renameSync(backup,vendor);moved=false;});
      if(!moved&&!installed){
        attempt(()=>{requireParents();regularIdentity(dependencyPath);writeFileSync(dependencyPath,dependency);});
        attempt(()=>{requireParents();regularIdentity(lockPath);writeFileSync(lockPath,lock);});
      }
      if(failures.length) primary=new AggregateError([error,...failures],'reconciliation failed; rollback incomplete; original failure retained',{cause:error});
    }
    throw primary;
  } finally {
    if(staged&&!installed&&present(stage)){
      try {requireParents();requireDirectory(stage,staged);rmSync(stage,{recursive:true});}
      catch(error){if(primary)throw new AggregateError([primary,error],'reconciliation failure and owned-stage cleanup failure',{cause:primary});throw error;}
    }
  }
}

export function packageTreeManifest(root, crateName) {
  const rows=[];
  const walk=(dir)=>{
    for(const name of readdirSync(dir).sort()){
      if(dir===root && name==='MANIFEST.sha256') continue;
      const path=join(dir,name), st=lstatSync(path);
      assert.ok(!st.isSymbolicLink(), `vendored package contains symlink ${path}`);
      if(st.isDirectory()) walk(path);
      else if(st.isFile()){
        const rel=relative(root,path).replaceAll('\\','/');
        assert.match(rel,/^[A-Za-z0-9_./-]+$/);
        rows.push([sha(readFileSync(path)),rel]);
      } else throw new Error(`unsupported package entry ${path}`);
    }
  };
  walk(root);
  rows.sort((a,b)=>Buffer.from(a[1]).compare(Buffer.from(b[1])));
  assert.ok(rows.some(([,p])=>p===crateName), 'crate archive is not in the vendor closure');
  return rows.map(([digest,path])=>`${digest}  ${path}\n`).join('');
}

export function updateDependencyRegister(source,{revision,version,manifestSha,crateSha}) {
  assert.equal(version,LEXLEAN_VERSION,'unsupported LexLean package version');
  assert.match(revision,/^[0-9a-f]{40}$/);
  assert.match(manifestSha,/^[0-9a-f]{64}$/);
  assert.match(crateSha,/^[0-9a-f]{64}$/);
  assert.equal([...source.matchAll(/^\[\[dependency\]\]\nid = "lexlean"$/gm)].length,1,'expected exactly one LexLean dependency row');
  const start=source.indexOf('[[dependency]]\nid = "lexlean"');
  assert.ok(start>=0,'lexlean dependency row is absent');
  const next=source.indexOf('\n[[dependency]]',start+1);
  const end=next<0?source.length:next;
  const old=source.slice(start,end);
  // The register may still name the previous release; its crate path must match it.
  const registered=old.match(/^version = "(\d+\.\d+\.\d+)"$/m)?.[1];
  assert.ok(registered,'LexLean dependency row has no exact version');
  const registeredPattern=registered.replaceAll('.','\\.');
  assert.match(old,/^source = "vendored"$/m);
  const blocks=old.trim().split(/\n(?=\[\[dependency\.artifact\]\])/);
  assert.equal(blocks.length,3,'expected the closed LexLean dependency and two artifacts');
  const canonicalBlock=(block,patterns)=>{
    const lines=block.split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
    assert.equal(lines.length,patterns.length,'unexpected or duplicate LexLean identity field');
    patterns.forEach((pattern,index)=>assert.match(lines[index],pattern));
  };
  canonicalBlock(blocks[0],[/^\[\[dependency\]\]$/,/^id = "lexlean"$/,new RegExp(`^version = "${registeredPattern}"$`),/^revision = "[0-9a-f]{40}"$/,/^source = "vendored"$/]);
  canonicalBlock(blocks[1],[/^\[\[dependency\.artifact\]\]$/,/^kind = "tree-manifest"$/,/^path = "vendor\/lexlean\/MANIFEST\.sha256"$/,/^sha256 = "[0-9a-f]{64}"$/,/^tree_root = "vendor\/lexlean"$/]);
  canonicalBlock(blocks[2],[/^\[\[dependency\.artifact\]\]$/,/^kind = "file"$/,new RegExp(`^path = "vendor/lexlean/lexlean-${registeredPattern}\\.crate"$`),/^sha256 = "[0-9a-f]{64}"$/]);
  let changed=old;
  const replaceRequired=(pattern,replacement,label)=>{
    assert.equal([...changed.matchAll(new RegExp(pattern.source,pattern.flags+'g'))].length,1,`expected exactly one valid ${label}`);
    changed=changed.replace(pattern,replacement);
  };
  replaceRequired(new RegExp(`^version = "${registeredPattern}"$`,'m'),`version = "${version}"`,'LexLean version');
  replaceRequired(/^revision = "[0-9a-f]{40}"$/m,`revision = "${revision}"`,'LexLean revision');
  replaceRequired(/(path = "vendor\/lexlean\/MANIFEST\.sha256"\nsha256 = ")[0-9a-f]{64}(")/,`$1${manifestSha}$2`,'LexLean manifest digest');
  replaceRequired(new RegExp(`path = "vendor/lexlean/lexlean-${registeredPattern}\\.crate"\\nsha256 = "[0-9a-f]{64}"`),`path = "vendor/lexlean/lexlean-${version}.crate"\nsha256 = "${crateSha}"`,'LexLean crate digest');
  // A reproducibly packaged, already-selected dependency is a valid no-op.
  // Closed canonical identity blocks reject even mixed-validity duplicate keys.
  return source.slice(0,start)+changed+source.slice(end);
}

export function assertCleanCheckout(lexRoot, revision) {
  assert.match(revision,/^[0-9a-f]{40}$/,'LexLean revision must be a full commit');
  assert.equal(run('git',['rev-parse','HEAD'],lexRoot),revision,'LexLean checkout is not the selected revision');
  // Ignored build outputs are excluded by Git; every untracked source is refused.
  assert.equal(run('git',['status','--porcelain','--untracked-files=all'],lexRoot),'','LexLean source is dirty');
}

export function reconcile(repoRoot, lexRoot, revision) {
  repoRoot=resolve(repoRoot); lexRoot=resolve(lexRoot);
  assertCleanCheckout(lexRoot, revision);

  run('cargo',['--offline','xtask','check-package'],lexRoot);
  run('cargo',['--offline','xtask','release-artifacts'],lexRoot);

  const identity=JSON.parse(readFileSync(join(lexRoot,'release/release-identity.json'),'utf8'));
  assert.equal(identity.spec,'lexlean/release-identity/1');
  assert.equal(identity.package,'lexlean');
  assert.equal(identity.version,LEXLEAN_VERSION);
  assert.equal(identity.lean_toolchain,'leanprover/lean4:v4.32.1');
  const version=identity.version, crateName=`lexlean-${version}.crate`;
  const crateBytes=readFileSync(join(lexRoot,'release/lexlean.crate'));
  assert.equal(sha(crateBytes),identity.crate_sha256,'LexLean release identity crate digest drift');
  // A second owning package invocation must reproduce the captured archive.
  run('cargo',['--offline','xtask','release-artifacts'],lexRoot);
  assert.deepEqual(readFileSync(join(lexRoot,'release/lexlean.crate')),crateBytes,'LexLean package is not reproducible');

  const work=mkdtempSync(join(tmpdir(),'prismpm-lexlean-reconcile-'));
  const workIdentity=directoryIdentity(work);
  const unpack=join(work,'unpack');
  let failure;
  try {
    run('mkdir',['-p',unpack],repoRoot);
    run('tar',['-xzf',join(lexRoot,'release/lexlean.crate'),'-C',unpack],repoRoot);
    const packageRoot=join(unpack,`lexlean-${version}`);
    assert.equal(run('git',['rev-parse',`${revision}^{tree}`],lexRoot).length,40);
    const vcs=JSON.parse(readFileSync(join(packageRoot,'.cargo_vcs_info.json'),'utf8'));
    assert.equal(vcs.git?.sha1,revision,'packaged .cargo_vcs_info.json does not bind selected revision');

    const sourceTree=run('git',['rev-parse',`${revision}^{tree}`],lexRoot);
    return replaceDependencyTransaction(repoRoot,(stage,oldDependencies)=>{
    cpSync(packageRoot,stage,{recursive:true,errorOnExist:true,force:false});
    writeFileSync(join(stage,crateName),crateBytes);
    const manifest=packageTreeManifest(stage,crateName);
    writeFileSync(join(stage,'MANIFEST.sha256'),manifest);
    const manifestSha=sha(Buffer.from(manifest)), crateSha=sha(crateBytes);

    return updateDependencyRegister(oldDependencies,{revision,version,manifestSha,crateSha});
    },()=>{
    // Resolve only after the exact packaged dependency is in place. Existing locked
    // versions remain preferred; new transitive requirements are admitted once here.
    run('cargo',['metadata','--offline','--format-version','1'],repoRoot);
    run('cargo',['check','--workspace','--all-targets','--all-features','--locked','--offline'],repoRoot);
    // Generated documents and locks still belong to their normal writers.
    // Validate them only after those writers finish via --validate-generated.
    return {revision,source_tree:sourceTree,version,crate_sha256:sha(crateBytes),manifest_sha256:sha(readFileSync(join(repoRoot,'vendor/lexlean/MANIFEST.sha256')))};
    });
  } catch(error) { failure=error; throw error; }
  finally {
    try {requireDirectory(work,workIdentity);rmSync(work,{recursive:true});}
    catch(error){if(failure)throw new AggregateError([failure,error],'reconciliation and private extraction cleanup failed',{cause:failure});throw error;}
  }
}

export function validateGenerated(repoRoot) {
  // This public xtask entry point includes audit_dependencies and all other audits.
  // A preparation check is never substituted for either complete VV pass.
  run('cargo',['run','--locked','--offline','-q','-p','xtask','--','validate'],resolve(repoRoot));
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  if(process.argv.length===3 && process.argv[2]==='--validate-generated') {
    validateGenerated(root);
    process.exit(0);
  }
  if(process.argv.length!==4){
    console.error('usage: node scripts/reconcile-lexlean.mjs <lexlean-checkout> <40-hex-revision> | --validate-generated');
    process.exit(2);
  }
  const result=reconcile(resolve(dirname(fileURLToPath(import.meta.url)),'..'),process.argv[2],process.argv[3]);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
