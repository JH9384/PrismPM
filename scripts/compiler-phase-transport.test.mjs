// Process-boundary unit and diagnostic-transport tests, not compiler acceptance.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const root=new URL('../',import.meta.url);
const sources=[
  {path:'tests/browser-journal/compile.mjs',name:'execute',end:'export function verifyCompilerTools()',bounded:true},
  {path:'sdk/browser/workspace-model-test.mjs',name:'run',end:'function verifyPins()',bounded:false},
];
for(const fixture of sources)for(const outcome of ['success','exit-failure','spawn-error','spawn-throw']){
  test(fixture.path+': diagnostic wrapping preserves '+outcome+' and exact process contract',()=>{
    const source=readFileSync(new URL(fixture.path,root),'utf8');
    const begin=source.indexOf('function '+fixture.name+'('),end=source.indexOf(fixture.end,begin);
    assert(begin>=0&&end>begin);
    const failure=new Error('actual process error'),calls=[],retired=[],observations=[];
    const result={status:outcome==='exit-failure'?7:0,stdout:'actual output',stderr:'actual diagnostic',pid:123,
      error:outcome==='spawn-error'?failure:undefined};
    const childEnvironment={OWNED:'compiler-environment'},extra={CARGO_TARGET_DIR:'/fresh-target'};
    const context={assert,performance:{now:()=>1234},process:{execPath:'/exact/node',env:{FIXTURE:'owned'}},
      compilerEnvironment(value){assert.equal(value,extra);return childEnvironment;},
      terminateOwnedGroup(pid){retired.push(pid);},
      observeCompilerPhase(...args){observations.push(args);},
      spawnSync(...args){calls.push(args);if(outcome==='spawn-throw')throw failure;return result;}};
    const invoke=runInNewContext('('+source.slice(begin,end).trim()+')',context);
    if(outcome==='success')assert.equal(invoke('cargo',['build','--locked'],'/private-work',extra),'actual output');
    else if(outcome==='spawn-throw')assert.throws(()=>invoke('cargo',['build','--locked'],'/private-work',extra),e=>e===failure);
    else assert.throws(()=>invoke('cargo',['build','--locked'],'/private-work',extra),e=>e.code==='ERR_ASSERTION');
    const expected=fixture.bounded?['/usr/bin/timeout',
      ['--signal=TERM','--kill-after=5s','360s','/usr/local/cargo/bin/cargo','build','--locked'],
      {cwd:'/private-work',detached:true,encoding:'utf8',timeout:370000,killSignal:'SIGKILL',
        maxBuffer:32*1024*1024,env:childEnvironment}]
      : ['cargo',['build','--locked'],{cwd:'/private-work',encoding:'utf8',timeout:300000,
        maxBuffer:16*1024*1024,env:{FIXTURE:'owned',CARGO_NET_OFFLINE:'true',...extra}}];
    assert.deepEqual(JSON.parse(JSON.stringify(calls)),[expected]);
    assert.deepEqual(retired,fixture.bounded&&outcome!=='spawn-throw'?[123]:[]);
    assert.deepEqual(JSON.parse(JSON.stringify(observations)),[['cargo',['build','--locked'],1234,outcome==='success']]);
  });
}

// Evaluate the exact source hook with instrumented I/O, not a replacement
// compiler. The actual dual-stream and closed-pipe tests below remain owners
// of real OS pipe behavior.
function diagnosticHook(write,clock=()=>1234) {
  const source=readFileSync(new URL('../tests/browser-view/compile.mjs',import.meta.url),'utf8');
  const begin=source.indexOf('export function observeCompilerPhase(');
  const end=source.indexOf('function execute(',begin);
  assert(begin>=0&&end>begin);
  const waits=[];
  const hook=runInNewContext('('+source.slice(begin+'export '.length,end).trim()+')',{
    Buffer,Number,Int32Array,SharedArrayBuffer,
    performance:{now:clock},compilerPhase:()=> 'lexlean-verification',writeSync:write,
    Atomics:{wait(...args){waits.push(args);}},
  });
  return {hook,waits};
}
test('diagnostic transport preserves every byte through short writes and transient errors',()=>{
  const bytes=[],steps=['EINTR','EAGAIN',3,'EWOULDBLOCK',7,Infinity];let calls=0;
  const {hook,waits}=diagnosticHook((fd,record,offset,length)=>{
    assert.equal(fd,2);assert(Buffer.isBuffer(record));assert.equal(length,record.length-offset);
    const step=steps[calls++];assert.notEqual(step,undefined);
    if(typeof step==='string')throw Object.assign(new Error('transport'),{code:step});
    const count=Math.min(length,step);bytes.push(Buffer.from(record.subarray(offset,offset+count)));return count;
  });
  assert.doesNotThrow(()=>hook('driver',['verify'],1222,true));
  assert.equal(calls,steps.length);assert.equal(waits.length,2);
  for(const [array,index,expected,timeout]of waits){assert.equal(array.length,1);assert.equal(index,0);assert.equal(expected,0);assert.equal(timeout,1);}
  assert.equal(Buffer.concat(bytes).toString(),
    '# prismpm-compiler-phase {"phase":"lexlean-verification","elapsed_ms":12,"success":true}\n');
});
for(const code of ['EINTR','EAGAIN','EWOULDBLOCK']) {
  test('permanent '+code+' is bounded and cannot change the real outcome',()=>{
    let calls=0;const {hook,waits}=diagnosticHook(()=>{calls++;throw Object.assign(new Error('transport'),{code});});
    assert.doesNotThrow(()=>hook('driver',['verify'],1234,false));
    assert.equal(calls,64);assert.equal(waits.length,code==='EINTR'?0:64);
  });
}
test('diagnostic deadline is measured after compiler elapsed and stops transient retries',()=>{
  let ticks=0,calls=0;
  const {hook}=diagnosticHook(()=>{calls++;throw Object.assign(new Error('transport'),{code:'EAGAIN'});},
    ()=>1234+50*ticks++);
  assert.doesNotThrow(()=>hook('driver',['verify'],1200,true));
  assert.equal(calls,1);
});
for(const result of ['EPIPE','EBADF','throw',0,-1,0.5,NaN,Infinity,257]) {
  test('unavailable or invalid diagnostic progress is fail-open: '+result,()=>{
    let calls=0;const {hook}=diagnosticHook(()=>{
      calls++;
      if(typeof result==='string')throw Object.assign(new Error('transport'),result==='throw'?{}:{code:result});
      return result;
    });
    assert.doesNotThrow(()=>hook('driver',['verify'],1234,false));assert.equal(calls,1);
  });
}
test('partial progress cannot exceed the fixed attempt bound',()=>{
  let calls=0;const {hook}=diagnosticHook(()=>{calls++;return 1;});
  assert.doesNotThrow(()=>hook('driver',['verify'],1234,true));assert.equal(calls,64);
});
test('compiler elapsed excludes diagnostic retries',()=>{
  let ticks=0,calls=0,record;
  const {hook}=diagnosticHook((_fd,bytes,_offset,length)=>{
    record=Buffer.from(bytes);if(calls++===0)throw Object.assign(new Error('transport'),{code:'EINTR'});return length;
  },()=>1234+ticks++);
  hook('driver',['verify'],1222,true);assert.equal(calls,2);
  assert.equal(JSON.parse(record.toString().slice('# prismpm-compiler-phase '.length)).elapsed_ms,12);
});

test('actual diagnostic hook preserves valid bounded JSON while stdout and stderr are active',()=>{
  const program=`import{writeSync}from'node:fs';
    import{observeCompilerPhase}from ${JSON.stringify(new URL('../tests/browser-view/compile.mjs',import.meta.url).href)};
    for(let i=0;i<512;i++){
      writeSync(1,'concurrent stdout '+i+'\\n');
      observeCompilerPhase('/private/driver-target/debug/browser-workspace-view-driver',['verify'],performance.now(),i%2===0);
    }`;
  const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--input-type=module','-e',program],
    {env:environment,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  assert.ifError(child.error);assert.equal(child.signal,null);assert.equal(child.status,0);
  assert.equal(child.stdout.trimEnd().split('\n').length,512);
  const prefix='# prismpm-compiler-phase ';
  const lines=child.stderr.trimEnd().split('\n').filter(line=>line.startsWith(prefix));
  assert.equal(lines.length,512);
  for(const [i,line]of lines.entries()){
    assert(line.startsWith(prefix));assert(Buffer.byteLength(line+'\n')<=256);
    const record=JSON.parse(line.slice(prefix.length));
    assert.deepEqual(Object.keys(record).sort(),['elapsed_ms','phase','success']);
    assert.equal(record.phase,'lexlean-verification');assert.equal(record.success,i%2===0);
    assert(Number.isSafeInteger(record.elapsed_ms)&&record.elapsed_ms>=0);
  }
});

test('a genuinely closed diagnostic pipe cannot turn the diagnostic hook into a failure',async()=>{
  const program=`import{observeCompilerPhase}from ${JSON.stringify(new URL('../tests/browser-view/compile.mjs',import.meta.url).href)};
    process.stderr.write('READY\\n');await new Promise(resolve=>process.stdin.once('data',resolve));
    observeCompilerPhase('cargo',['build'],performance.now(),false);process.stdout.write('outcome-preserved');`;
  const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,['--input-type=module','-e',program],{env:environment,stdio:['pipe','pipe','pipe']});
  let ready='',stdout='',closed=false;
  child.stdout.on('data',bytes=>{stdout+=bytes;assert(stdout.length<=1024);});
  child.stderr.on('data',bytes=>{
    ready+=bytes;assert(ready.length<=1024);
    if(!closed&&ready.includes('READY\n')){closed=true;child.stderr.destroy();child.stdin.end('continue');}
  });
  const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
  let outcome;
  try{outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(status,signal)=>resolve({status,signal}));});}
  finally{clearTimeout(timer);}
  assert.deepEqual(outcome,{status:0,signal:null});assert(closed);assert.equal(stdout,'outcome-preserved');
});
