import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const original=readFileSync(new URL('./compiler-owner.mjs',import.meta.url),'utf8');
const artifact=readFileSync(new URL('./compiler-artifact.mjs',import.meta.url),'utf8');
const suite=readFileSync(new URL('./compiler-runtime.test.mjs',import.meta.url));
const mutants=[
  ['entry-budget','counts[kind] < 4096','counts[kind] < 4097','runtime admits both complete entry budgets','Missing expected exception'],
  ['byte-budget',"kind === 'build' ? 512 : 16","kind === 'build' ? 513 : 17",'runtime streams exact source/build byte limits','Missing expected exception'],
  ['final-custody','for (const {path, stat} of observed) {','for (const {path, stat} of []) {','runtime rechecks an already observed file','Missing expected exception'],
  ['stream-buffer','Math.min(Math.max(1, size), 65536)','Math.min(Math.max(1, size), 131072)','runtime streams exact source/build byte limits','runtime hashing must not allocate whole files'],
  ['directory-buffer','{bufferSize: 1}','{bufferSize: 2}','runtime walks deep admitted trees','2 !== 1'],
];
for(const[id,before,after,witness,diagnostic]of mutants)test('actual runtime custody defect '+id,t=>{
  const owning=id==='stream-buffer'?artifact:original;
  assert.equal(owning.split(before).length,2,'one exact production guard');
  const work=mkdtempSync(join(tmpdir(),'prismpm-runtime-guard-'));
  t.after(()=>rmSync(work,{recursive:true,force:true}));
  let changed=id==='stream-buffer'?original:original.replace(before,after);
  if(id==='stream-buffer')writeFileSync(join(work,'compiler-artifact.mjs'),artifact.replace(before,after)
    .replace("'./compile.mjs'",JSON.stringify(new URL('./compile.mjs',import.meta.url).href)),{flag:'wx'});
  for(const name of ['compile','compiler-artifact'])if(name!=='compiler-artifact'||id!=='stream-buffer')
    changed=changed.replace(`'./${name}.mjs'`,JSON.stringify(new URL(`./${name}.mjs`,import.meta.url).href));
  writeFileSync(join(work,'compiler-owner.mjs'),changed,{flag:'wx'});
  writeFileSync(join(work,'compiler-runtime.test.mjs'),suite,{flag:'wx'});
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--test',join(work,'compiler-runtime.test.mjs')],
    {env,encoding:'utf8',timeout:30000,maxBuffer:1024**2});
  assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,1);
  assert(result.stdout.split('\n').some(line=>line.startsWith('not ok ')&&line.includes(witness)),'intended behavioral witness');
  assert(result.stdout.includes(diagnostic),result.stdout);
  assert.match(result.stdout,/# tests 8\n/);assert.match(result.stdout,/# skipped 0\n/);assert.match(result.stdout,/# todo 0\n/);
  assert.doesNotMatch(result.stdout+result.stderr,/ERR_MODULE_NOT_FOUND|SyntaxError/);
});
