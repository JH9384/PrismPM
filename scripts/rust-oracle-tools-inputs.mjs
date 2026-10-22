// Change detection only; unchanged inputs are not fresh tool qualification.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,lstatSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const recipes=['.devcontainer/Dockerfile','sdk/Dockerfile'];
const harness=['.github/workflows/rust-oracle-tools.yml','scripts/sdk-image-inputs.test.mjs',
  'scripts/sdk-image-inputs.mjs','scripts/sdk-vv-inputs.mjs','sdk/inventory-metadata.mjs',
  '.github/workflows/release.yml','.github/workflows/sdk-candidate.yml','scripts/vv.sh',
  'scripts/rust-oracle-tools-inputs.mjs','scripts/rust-oracle-tools-inputs.test.mjs'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const revision=value=>{assert.match(value,/^[0-9a-f]{40}$/u);return value;};
export function toolStage(recipe) {
  assert.equal(typeof recipe,'string');assert(Buffer.byteLength(recipe)<=256*1024);
  const lines=recipe.split('\n');
  assert.match(lines[0],/^# syntax=\S+@sha256:[0-9a-f]{64}$/u);
  const starts=lines.flatMap((line,index)=>/^FROM \S+ AS rust_oracle_tools$/u.test(line)?[index]:[]);
  assert.equal(starts.length,1,'one explicit Rust tool stage required');
  const start=starts[0],next=lines.findIndex((line,index)=>index>start&&/^FROM /u.test(line));
  assert(next>start,'complete delimited tool stage required');
  // Ambiguous logical lines/heredocs conservatively bind the whole recipe;
  // never mistake literal FROM text for the end of an effective tool stage.
  const prefix=lines.slice(0,next).join('\n');
  if(recipe.includes('<<')||/^#\s*escape=/mu.test(prefix)||/[\\`]$/mu.test(prefix))return recipe;
  // Include every instruction and comment, not a selected list of commands.
  return prefix;
}
function git(root,args,encoding='utf8') {
  return execFileSync('git',['--no-replace-objects','-c','core.fsmonitor=false','-C',root,...args],{encoding,
    timeout:5000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
    env:{PATH:process.env.PATH,LANG:'C',LC_ALL:'C',GIT_CONFIG_GLOBAL:'/dev/null',
      GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'}});
}
function blob(root,commit,path,optional=false) {
  const listing=git(root,['ls-tree','--full-tree','-z',commit,'--',path]);
  if(optional&&!listing)return null;
  const match=/^(100644|100755) blob ([0-9a-f]{40})\t([^\x00]+)\x00$/u.exec(listing);
  assert(match,'one regular Git blob required');assert.equal(match[3],path);
  assert.equal(match[1],path==='scripts/vv.sh'?'100755':'100644','exact input mode');
  // cat-file must not normalize malformed UTF-8 into a matching text digest.
  const bytes=git(root,['cat-file','blob',match[2]],null),content=bytes.toString('utf8');
  assert(bytes.equals(Buffer.from(content)),'UTF-8 input required');
  return content;
}
function workingInput(root,path,expected) {
  assert(lstatSync(root).isDirectory(),'regular checkout root required');
  const parts=path.split('/');let directory=root;
  for(const part of parts.slice(0,-1)) {
    directory=join(directory,part);assert(lstatSync(directory).isDirectory(),'no symlinked input ancestor');
  }
  const fd=openSync(join(root,path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=fstatSync(fd,{bigint:true});
    assert(before.isFile()&&before.nlink===1n&&before.size<=1024n*1024n,'bounded independent regular input');
    assert.equal(Number(before.mode&0o777n),path==='scripts/vv.sh'?0o755:0o644,'exact checked-out mode');
    const bytes=readFileSync(fd);assert(bytes.equals(Buffer.from(expected)),'working input differs from HEAD');
    const after=fstatSync(fd,{bigint:true});
    for(const key of ['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'])assert.equal(after[key],before[key]);
  }finally{closeSync(fd);}
}
export function toolInputChanges(root,base=null) {
  root=resolve(root);
  const head=revision(git(root,['rev-parse','HEAD']).trim());
  git(root,['cat-file','-e',`${head}^{commit}`]);
  if(base!==null){revision(base);git(root,['cat-file','-e',`${base}^{commit}`]);}
  for(const path of [...recipes,...harness]) {
    const expected=blob(root,head,path),bytes=Buffer.from(expected);
    const oid=createHash('sha1').update(`blob ${bytes.length}\x00`).update(bytes).digest('hex');
    assert.equal(git(root,['ls-files','--stage','--error-unmatch','--',path]),
      `${path==='scripts/vv.sh'?'100755':'100644'} ${oid} 0\t${path}\n`,'one unchanged tracked index input');
    workingInput(root,path,expected);
  }
  let legacyBase=false;
  const stages=recipes.map(path=>{
    const current=toolStage(blob(root,head,path));
    const prior=base===null?null:blob(root,base,path);
    let previous=null;
    if(prior!==null) {
      assert(Buffer.byteLength(prior)<=256*1024,'bounded base recipe required');
      if(/\brust_oracle_tools\b/iu.test(prior))previous=toolStage(prior);
      else {
        // A regular, bounded authoritative pre-stage Git recipe cannot
        // authorize reuse. Bind its complete original bytes and force the
        // unchanged full native-construction owner on first rollout.
        assert.match(prior,/^FROM \S+@sha256:[0-9a-f]{64}(?: AS \S+)?$/mu,
          'recognized pinned legacy base recipe required');
        previous=prior;legacyBase=true;
      }
    }
    return {path,head_sha256:digest(current),base_sha256:previous===null?null:digest(previous)};
  });
  const dependencies=harness.map(path=>{
    const prior=base===null?null:blob(root,base,path,true);
    return {path,head_sha256:digest(blob(root,head,path)),base_sha256:prior===null?null:digest(prior)};
  });
  return {schema:'prismpm/rust-tool-input-change/1',scope:'change-detection-only-not-qualification',
    head_revision:head,base_revision:base,
    changed:base===null||legacyBase||[...stages,...dependencies].some(row=>row.head_sha256!==row.base_sha256),
    stages,dependencies};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length,3,'exact base revision or dispatch required');
  console.log(JSON.stringify(toolInputChanges(process.cwd(),process.argv[2]==='dispatch'?null:revision(process.argv[2]))));
}
