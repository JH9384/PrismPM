import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {browserEnvironmentPreflight, validateBrowserEnvironment} from './browser-environment-preflight.mjs';

const versions={chromium:'157.0.8099.0',firefox:'153.0',webkit:'26.5'};
test('the production devcontainer provides the child reaper required by hard browser deadlines',()=>{
  const container=JSON.parse(readFileSync(new URL('../.devcontainer/devcontainer.json',import.meta.url),'utf8'));
  assert.equal(container.init,true);
});
function launcher(calls,{failedEngine,version,evaluation}={}) {
  return async (callback,{engine})=>{
    calls.push(engine);
    if(engine===failedEngine)throw new Error('original missing shared library');
    const baseURL='http://127.0.0.1:43210/';
    const page={
      async goto(url,options){assert.equal(url,baseURL);assert.equal(options.timeout,15000);return {status:()=>200};},
      async evaluate(fn){assert.equal(typeof fn,'function');return evaluation??{
        title:'Browser primitive acceptance',origin:'http://127.0.0.1:43210',ready:'complete',value:5};},
      async close(){},
    };
    return callback({engine,baseURL,browser:{version:()=>version??versions[engine],newPage:async()=>page}});
  };
}

test('browser environment preflight requires all pinned engines and actual page observations',async()=>{
  const calls=[],result=await browserEnvironmentPreflight(launcher(calls));
  assert.deepEqual(calls,['chromium','firefox','webkit']);
  assert.deepEqual(result,{schema:'prismpm/browser-environment/1',engines:[
    {engine:'chromium',version:versions.chromium,evaluated:true},
    {engine:'firefox',version:versions.firefox,evaluated:true},
    {engine:'webkit',version:versions.webkit,evaluated:true},
  ]});
  assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.engines),true);
  assert.equal(result.engines.every(Object.isFrozen),true);
});

test('launch, version and actual page failures cannot produce successful preflight',async()=>{
  for(const failedEngine of Object.keys(versions)) {
    const calls=[];
    await assert.rejects(browserEnvironmentPreflight(launcher(calls,{failedEngine})),error=>
      error.message===`browser environment preflight failed: ${failedEngine}`
        &&error.cause.message==='original missing shared library');
    assert.deepEqual(calls,Object.keys(versions).slice(0,Object.keys(versions).indexOf(failedEngine)+1));
  }
  await assert.rejects(browserEnvironmentPreflight(launcher([],{version:'wrong'})));
  await assert.rejects(browserEnvironmentPreflight(launcher([],{evaluation:{value:5}})));
});

test('closed preflight completion rejects missing duplicate reordered or substituted engine observations',async()=>{
  const good=await browserEnvironmentPreflight(launcher([]));
  for(const change of [r=>r.engines.pop(),r=>r.engines.push(r.engines[0]),
    r=>r.engines.reverse(),r=>r.engines[1].engine='chromium',
    r=>r.engines[1].version='wrong',r=>r.engines[1].evaluated=false,
    r=>r.engines[1].skipped=true,r=>r.extra=true,r=>r.schema='wrong']) {
    const value=structuredClone(good);change(value);assert.throws(()=>validateBrowserEnvironment(value));
  }
});

test('real engine omission mutant cannot yield a complete environment receipt',async()=>{
  const work=mkdtempSync(join(tmpdir(),'prismpm-browser-preflight-mutant-'));
  try {
    mkdirSync(join(work,'scripts'));mkdirSync(join(work,'sdk/browser'),{recursive:true});
    const original=readFileSync(new URL('./browser-environment-preflight.mjs',import.meta.url),'utf8');
    const changed=original.replace("['chromium','firefox','webkit']","['chromium','webkit']");
    assert.notEqual(changed,original);
    writeFileSync(join(work,'scripts/probe.mjs'),changed,{flag:'wx'});
    writeFileSync(join(work,'sdk/browser/browser-test-server.mjs'),
      readFileSync(new URL('../sdk/browser/browser-test-server.mjs',import.meta.url)),{flag:'wx'});
    const mutant=await import(pathToFileURL(join(work,'scripts/probe.mjs')));
    const calls=[];await assert.rejects(mutant.browserEnvironmentPreflight(launcher(calls)));
    assert.deepEqual(calls,['chromium','webkit']);
  }finally{rmSync(work,{recursive:true,force:true});}
});

test('actual vv control flow stops on browser readiness before bootstrap SDK or Cargo; guard omission is detected',()=>{
  for(const omitted of [false,true]) {
    const work=mkdtempSync(join(tmpdir(),'prismpm-browser-preflight-order-'));
    try {
      mkdirSync(join(work,'scripts'));mkdirSync(join(work,'bin'));
      const original=readFileSync(new URL('./vv.sh',import.meta.url),'utf8');
      const changed=omitted?original.replace('bash scripts/browser-environment-preflight.sh\n',''):original;
      if(omitted)assert.notEqual(changed,original);
      writeFileSync(join(work,'scripts/vv.sh'),changed,{flag:'wx'});
      writeFileSync(join(work,'scripts/browser-environment-preflight.sh'),
        readFileSync(new URL('./browser-environment-preflight.sh',import.meta.url)),{flag:'wx'});
      writeFileSync(join(work,'scripts/bootstrap-verify.sh'),'#!/bin/sh\nexit 0\n',{flag:'wx',mode:0o755});
      const fake=`#!${process.execPath}\nconst fs=require('fs');const args=process.argv.slice(2);fs.appendFileSync(process.env.PREFLIGHT_EVENTS,JSON.stringify([process.argv[1].split('/').at(-1),...args])+'\\n');process.exit(args[0]==='scripts/browser-environment-preflight.mjs'?73:0);\n`;
      for(const name of ['node','cargo','docker'])writeFileSync(join(work,'bin',name),fake,{flag:'wx',mode:0o755});
      const events=join(work,'events');
      const run=spawnSync('/bin/bash',[join(work,'scripts/vv.sh')],{cwd:work,encoding:'utf8',timeout:10000,
        env:{...process.env,PATH:join(work,'bin')+':'+process.env.PATH,PREFLIGHT_EVENTS:events,
          PRISMPM_TEST_SDK_IMAGE:'not-used-by-control-flow-test'}});
      assert.ifError(run.error);
      const rows=readFileSync(events,'utf8').trim().split('\n').map(JSON.parse);
      if(!omitted) {assert.equal(run.status,73);assert.deepEqual(rows,[['node','scripts/browser-environment-preflight.mjs']]);}
      else {assert.equal(run.status,0);assert.deepEqual(rows.at(-1),['cargo','xtask','vv']);}
    }finally{rmSync(work,{recursive:true,force:true});}
  }
});

test('fixed whole-command deadline terminates genuine hangs and refuses caller overrides',async()=>{
  const wrapper=readFileSync(new URL('./browser-environment-preflight.sh',import.meta.url),'utf8');
  assert.equal(wrapper.match(/exec timeout --signal=TERM --kill-after=5s 90s node scripts\/browser-environment-preflight\.mjs/gu)?.length,1);
  for(const hard of [false,true]) {
    const work=mkdtempSync(join(tmpdir(),'prismpm-browser-preflight-timeout-'));
    try {
      mkdirSync(join(work,'scripts'));
      // Exercise the same external watchdog, with only the test clock shortened.
      const path=join(work,'scripts/browser-environment-preflight.sh');
      writeFileSync(path,wrapper.replace('--kill-after=5s 90s','--kill-after=1s 1s'),{flag:'wx'});
      const pidPath=join(work,'pid'),closedPath=join(work,'closed');
      writeFileSync(join(work,'scripts/browser-environment-preflight.mjs'),
        `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(pidPath)},String(process.pid));process.on('SIGTERM',()=>{writeFileSync(${JSON.stringify(closedPath)},'closed');process.exit(0);});${hard?'while(true){}':'setInterval(()=>{},1000);'}`,{flag:'wx'});
      const denied=spawnSync('/bin/bash',[path,'skip-webkit'],{encoding:'utf8',timeout:10000});
      assert.equal(denied.status,64);assert.match(denied.stderr,/accepts no overrides/u);
      const started=performance.now(),run=spawnSync('/bin/bash',[path],{encoding:'utf8',timeout:10000});
      assert.ifError(run.error);
      if(hard){assert.equal(run.status,null);assert.equal(run.signal,'SIGKILL');}
      else {assert.equal(run.status,124);assert.equal(run.signal,null);}
      assert.ok(performance.now()-started<8000,'bounded outer command');
      if(!hard)assert.equal(readFileSync(closedPath,'utf8'),'closed');
      const pid=Number(readFileSync(pidPath,'utf8'));let alive=true;
      for(let attempt=0;attempt<20;attempt++){try{process.kill(pid,0);}catch(error){assert.equal(error.code,'ESRCH');alive=false;break;}await new Promise(resolve=>setTimeout(resolve,50));}
      assert.equal(alive,false,'timed-out worker was reaped');
    }finally{rmSync(work,{recursive:true,force:true});}
  }
});
