// Runtime preservation and malformed transport tests, not full SDK acceptance.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import test from 'node:test';
import {bootstrapFixture} from './sdk-bootstrap-retention-fixture.mjs';
import {bootstrapNames, canonical, hash, readOriginal, validateBootstrapRetention} from './sdk-bootstrap-retention.mjs';
import {assembleSourceEvidence, captureCommand, nativeInvocations, releaseContext, sourceEvidenceNames, validateCommand, validateSourcePart, validateSourceReceipt} from './release-gate-evidence.mjs';
import {captureEvidence, packEvidence} from './sdk-release-evidence.mjs';
import {retainPart, vvParts} from './sdk-vv-run.mjs';
import {workspaceVersion} from './workspace-version.mjs';
const require = createRequire('/opt/prismpm/oracles/package.json'), {load} = require('js-yaml');
const revision = 'a'.repeat(40), image = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:' + 'b'.repeat(64);
const context = releaseContext(revision, 'amd64', image, '123', '1');
const sourceContext = {...context, image_reference: null};
const temporary = t => {const path = mkdtempSync(join(tmpdir(), 'release-original-test-')); t.after(() => rmSync(path, {recursive: true, force: true})); return path;};
const put = (path, name, value) => writeFileSync(join(path, name), Buffer.isBuffer(value) || typeof value === 'string' ? value : canonical(value));
const descriptor = (path, bytes) => ({path, byte_length: bytes.length, sha256: hash(bytes)});
const rawVv = () => Buffer.from(canonical({schema: 'prismpm/vv-evidence/1', commit: revision, status: 'passed', gates: Array.from({length: 15}, (_, i) => i + 1)}));
const rawPart = part => Buffer.from(canonical({commit: revision, part, schema: 'prismpm/vv-part/1', status: 'passed'}));
function commandFixture(root, prefix, command, args, status, stdout = 'unit-only output\n', stderr = '') {
  const out = Buffer.from(stdout), err = Buffer.from(stderr);
  put(root, `${prefix}.stdout`, out); put(root, `${prefix}.stderr`, err);
  put(root, `${prefix}.json`, {command, arguments: args, status, signal: null, descendants_reaped:true, capture_failed:false, orphaned: false, overflow: false, interrupted: null,
    stdout: descriptor(`${prefix}.stdout`, out), stderr: descriptor(`${prefix}.stderr`, err)});
}
function sourceFixture(root) {
  for (const part of vvParts) {
    const raw = rawPart(part), prefix = `source-${part}`;
    commandFixture(root, prefix, 'just', ['vv-part', part], 0);
    put(root, `${prefix}-vv.json`, raw);
    let bootstrap = null;
    if (part === 'source') {
      const rows = [...bootstrapFixture(revision).files].map(([name, bytes]) => {
        const path = `run-1-${name}`; put(root, path, bytes); return descriptor(path, bytes);
      });
      bootstrap = {run: 1, files: rows};
    }
    put(root, `${prefix}-result.json`, {schema: 'prismpm/source-vv-retention/2', scope: 'original-source-part-only',
      ...sourceContext, part, vv: descriptor(`${prefix}-vv.json`, raw), bootstrap});
  }
  put(root, 'source-vv.json', rawVv());
}
function nativeFixture(root) {
  const source = '/unit-only/source';
  for (const [prefix, args, status] of nativeInvocations(source, image, 'amd64', 1000, 1000)) commandFixture(root, prefix, 'docker', args, status);
  put(root, 'native-result.json', {schema: 'prismpm/native-equivalence-retention/1', scope: 'original-native-sdk-comparison-only',
    ...context, root: source, uid: 1000, gid: 1000, archive: descriptor(`prismpm-${workspaceVersion()}-x86_64-unknown-linux-gnu.tar.gz`, Buffer.from('fixture archive'))});
}

test('native and container mutable references use the PP6101 exit class', () => {
  for (const architecture of ['amd64', 'arm64']) {
    const invocations = nativeInvocations('/unit-only/source', image, architecture, 1000, 1000);
    assert.deepEqual(invocations.map(([prefix, , status]) => [prefix, status]), [
      ['native-check', 0], ['container-check', 0], ['native-error', 5], ['container-error', 5],
    ]);
  }
});

test('actual child execution preserves exact binary stdout, stderr and nonzero status', async t => {
  const root = temporary(t), args = ['-e', 'process.stdout.write(Buffer.from([0,255,10]));process.stderr.write("original error\\n");process.exitCode=7'];
  const row = await captureCommand(root, 'actual', process.execPath, args, root);
  assert.equal(row.status, 7); assert.deepEqual(readFileSync(join(root, 'actual.stdout')), Buffer.from([0,255,10]));
  assert.equal(readFileSync(join(root, 'actual.stderr'), 'utf8'), 'original error\n');
  const files = new Map(readdirSync(root).map(name => [name, readFileSync(join(root, name))]));
  validateCommand(files, 'actual', process.execPath, args, 7);
  for(const value of [false,undefined,'true']) {
    const changed={...row,descendants_reaped:value};
    files.set('actual.json',Buffer.from(canonical(changed)));
    assert.throws(()=>validateCommand(files,'actual',process.execPath,args,7));
  }
  files.set('actual.json',Buffer.from(canonical(row)));
  assert.throws(() => validateCommand(files, 'actual', process.execPath, args, 0));
  files.set('actual.stdout', Buffer.from('substituted'));
  assert.throws(() => validateCommand(files, 'actual', process.execPath, args, 7));
  await assert.rejects(captureCommand(root, 'actual', process.execPath, ['-e', 'throw Error("must not execute")'], root));
});

test('actual stderr maximum is retained and one extra byte kills execution without accepting truncation', {timeout: 30000}, async t => {
  for (const extra of [0, 1]) {
    const root = temporary(t), count = 64 * 1024 * 1024 + extra;
    const pending = captureCommand(root, 'bounded', process.execPath, ['-e', `process.stderr.write(Buffer.alloc(${count},65))`], root);
    if (extra) await assert.rejects(pending, /bound/); else assert.equal((await pending).status, 0);
    const record = JSON.parse(readFileSync(join(root, 'bounded.json')));
    assert.equal(record.overflow, extra === 1);
    const bytes = readFileSync(join(root, 'bounded.stderr'));
    assert(bytes.length <= 64 * 1024 * 1024); assert(bytes.every(byte => byte === 65));
    if (!extra) assert.equal(bytes.length, count);
  }
});

test('a real child cannot substitute its capture file for the observed pipe bytes', async t => {
  const root = temporary(t), path = join(root, 'changed.stdout');
  await assert.rejects(captureCommand(root, 'changed', process.execPath, ['-e',
    `require('node:fs').writeFileSync(${JSON.stringify(path)},'forged bytes not emitted');process.stdout.write('observed')`], root), /observed process bytes/);
  assert(!existsSync(join(root, 'changed.json')), 'changed output must not receive a completed command record');
});

test('actual interruption retains the failed command and terminates its resistant owned process', {timeout: 12000}, t => {
  const root = temporary(t), ready = join(root, 'ready');
  const wrapper = `
    import {existsSync} from 'node:fs';
    import {captureCommand} from ${JSON.stringify(new URL('./release-gate-evidence.mjs', import.meta.url).href)};
    const timer = setInterval(() => {if(existsSync(${JSON.stringify(ready)})){clearInterval(timer);process.kill(process.pid,'SIGTERM');}},10);
    try {await captureCommand(${JSON.stringify(root)},'cancelled',process.execPath,['-e',
      ${JSON.stringify(`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`)}],${JSON.stringify(root)}); process.exitCode=1;}
    catch(error){if(error.message!=='gate interrupted')throw error;}
    finally{clearInterval(timer);}
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', wrapper], {timeout: 10000});
  const row = JSON.parse(readFileSync(join(root, 'cancelled.json')));
  assert.equal(row.interrupted, 'SIGTERM'); assert.equal(row.signal, 'SIGKILL'); assert.equal(row.status, null);
  const pid = Number(readFileSync(ready, 'utf8'));
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
});

test('cancellation preserves TERM delivery to deeper original-session descendants before escalation', {timeout:12000},t=>{
  const root=temporary(t),ready=join(root,'deep-ready'),termed=join(root,'deep-term');
  const leaf=`process.on('SIGTERM',()=>require('node:fs').writeFileSync(${JSON.stringify(termed)},'actual TERM'));require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`;
  const leader=`process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{stdio:['ignore',1,2]});setInterval(()=>{},1000)`;
  const wrapper=`import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
    import {captureCommand} from ${JSON.stringify(new URL('./release-gate-evidence.mjs',import.meta.url).href)};
    const timer=setInterval(()=>{if(existsSync(${JSON.stringify(ready)})){clearInterval(timer);process.kill(process.pid,'SIGTERM');}},5);
    try{await assert.rejects(captureCommand(${JSON.stringify(root)},'deep',process.execPath,['-e',${JSON.stringify(leader)}],${JSON.stringify(root)}),/gate interrupted/);}finally{clearInterval(timer);}`;
  execFileSync(process.execPath,['--input-type=module','-e',wrapper],{timeout:10000});
  assert.equal(readFileSync(termed,'utf8'),'actual TERM');
  const pid=Number(readFileSync(ready,'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  assert.equal(JSON.parse(readFileSync(join(root,'deep.json'))).descendants_reaped,true);
});

function backgroundCommand(root, resistant) {
  const grandchild = resistant
    ? `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(join(root, 'grandchild'))},String(process.pid));process.stdout.write('grandchild-ready\\n');setInterval(()=>{},1000)`
    : `setTimeout(()=>{process.stdout.write('late stdout\\n');process.stderr.write('late stderr\\n');},250)`;
  return `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore',1,2]});child.unref();require('node:fs').writeFileSync(${JSON.stringify(join(root, 'leader'))},String(process.pid));process.stdout.write('leader-exit\\n');process.exit(0)`;
}
function killOwnedLeader(root) {
  if (!existsSync(join(root, 'leader'))) return;
  const pid = Number(readFileSync(join(root, 'leader'), 'utf8'));
  assert(Number.isSafeInteger(pid) && pid > 1);
  try {process.kill(-pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
}
// SIGKILL delivery is asynchronous: a killed process stays runnable until the
// kernel tears it down, so wait (bounded) for it to become a zombie or vanish.
async function noExecutingProcess(path) {
  const pid = Number(readFileSync(path, 'utf8'));
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
    } catch (error) {if (error.code !== 'ENOENT') throw error; return;}
    if (state === 'Z') return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(state, 'Z');
}
test('ordinary exit drains short-lived descendants but rejects orphaned pipe holders', {timeout: 17000}, async t => {
  const normal = temporary(t);
  const result = await captureCommand(normal, 'normal', process.execPath, ['-e', backgroundCommand(normal, false)], normal);
  assert.equal(result.status, 0);
  assert.equal(result.orphaned, false);
  assert.equal(readFileSync(join(normal, 'normal.stdout'), 'utf8'), 'leader-exit\nlate stdout\n');
  assert.equal(readFileSync(join(normal, 'normal.stderr'), 'utf8'), 'late stderr\n');
  const root = temporary(t); let forced = false;
  const watchdog = setTimeout(() => {forced = true; killOwnedLeader(root);}, 14000);
  try {
    await assert.rejects(captureCommand(root, 'orphan', process.execPath, ['-e', backgroundCommand(root, true)], root), /orphaned output pipes/);
    assert.equal(forced, false, 'owner, not test watchdog, must terminate the orphaned group');
    const record = JSON.parse(readFileSync(join(root, 'orphan.json')));
    assert.equal(record.status, 0, 'preserve original leader status'); assert.equal(record.signal, null);
    assert.equal(record.orphaned, true); assert.equal(record.interrupted, null);
    const files = new Map(['json', 'stdout', 'stderr'].map(suffix => [`orphan.${suffix}`, readFileSync(join(root, `orphan.${suffix}`))]));
    assert.throws(() => validateCommand(files, 'orphan', process.execPath, ['-e', backgroundCommand(root, true)], 0));
    await noExecutingProcess(join(root, 'grandchild'));
  } finally {clearTimeout(watchdog); killOwnedLeader(root);}
});

test('pipe closure by a TERM-resistant descendant cannot cancel owned escalation or kill another group', {timeout:17000},async t=>{
  const root=temporary(t),closed=join(root,'pipes-closed');
  const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
  const unrelatedClosed=once(unrelated,'close');await once(unrelated,'spawn');
  const grandchild=`process.on('SIGTERM',()=>{require('node:fs').writeFileSync(${JSON.stringify(closed)},'actual handler');require('node:fs').closeSync(1);require('node:fs').closeSync(2);});require('node:fs').writeFileSync(${JSON.stringify(join(root,'grandchild'))},String(process.pid));setInterval(()=>{},1000)`;
  const leader=`const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore',1,2]});child.unref();require('node:fs').writeFileSync(${JSON.stringify(join(root,'leader'))},String(process.pid));process.exit(0)`;
  let forced=false;const watchdog=setTimeout(()=>{forced=true;killOwnedLeader(root);},14000);
  try {
    await assert.rejects(captureCommand(root,'closed-pipes',process.execPath,['-e',leader],root),/orphaned output pipes/);
    assert.equal(forced,false,'the actual owner must retire its descendants');
    assert.equal(readFileSync(closed,'utf8'),'actual handler','genuine TERM handler closed both inherited descriptors');
    await noExecutingProcess(join(root,'grandchild'));
    assert.equal(JSON.parse(readFileSync(join(root,'closed-pipes.json'))).descendants_reaped,true);
    assert.equal(process.kill(unrelated.pid,0),true,'unrelated private process group remains alive');
  } finally {
    clearTimeout(watchdog);killOwnedLeader(root);
    try {process.kill(-unrelated.pid,'SIGKILL');} catch(error) {if(error.code!=='ESRCH')throw error;}
    await unrelatedClosed;
  }
});

test('successful leader and closed pipes do not accept a still-executing silent descendant', {timeout:17000},async t=>{
  const root=temporary(t);
  const grandchild=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(join(root,'grandchild'))},String(process.pid));require('node:fs').closeSync(1);require('node:fs').closeSync(2);setInterval(()=>{},1000)`;
  const leader=`const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore',1,2]});child.unref();require('node:fs').writeFileSync(${JSON.stringify(join(root,'leader'))},String(process.pid));process.exit(0)`;
  let forced=false;const watchdog=setTimeout(()=>{forced=true;killOwnedLeader(root);},14000);
  try {
    await assert.rejects(captureCommand(root,'silent',process.execPath,['-e',leader],root),/orphaned output pipes/);
    assert.equal(forced,false);await noExecutingProcess(join(root,'grandchild'));
    const record=JSON.parse(readFileSync(join(root,'silent.json')));
    assert.equal(record.status,0);assert.equal(record.signal,null);assert.equal(record.orphaned,true);
    assert.equal(record.descendants_reaped,true);
    const files=new Map(['json','stdout','stderr'].map(suffix=>['silent.'+suffix,readFileSync(join(root,'silent.'+suffix))]));
    assert.throws(()=>validateCommand(files,'silent',process.execPath,['-e',leader],0));
  } finally {clearTimeout(watchdog);killOwnedLeader(root);}
});

test('forking into a new session during TERM cannot escape adoption and reaping', {timeout:17000},async t=>{
  const root=temporary(t),escaped=join(root,'escaped');
  const final=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(escaped+'-identity')},require('node:fs').readFileSync('/proc/self/stat'));require('node:fs').writeFileSync(${JSON.stringify(escaped)},String(process.pid));setInterval(()=>{},1000)`;
  const grandchild=`process.on('SIGTERM',()=>{const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(final)}],{detached:true,stdio:'ignore'});child.unref();const ready=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(escaped)})){clearInterval(ready);process.exit(0);}},5);});require('node:fs').writeFileSync(${JSON.stringify(join(root,'grandchild'))},String(process.pid));setInterval(()=>{},1000)`;
  const leader=`const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore',1,2]});child.unref();require('node:fs').writeFileSync(${JSON.stringify(join(root,'leader'))},String(process.pid));process.exit(0)`;
  try {
    await assert.rejects(captureCommand(root,'forked',process.execPath,['-e',leader],root),/orphaned output pipes/);
    for(const name of ['leader','grandchild','escaped']) {
      const pid=Number(readFileSync(join(root,name),'utf8'));
      assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},'each actual adopted process is reaped before rejection');
    }
    assert.equal(JSON.parse(readFileSync(join(root,'forked.json'))).descendants_reaped,true);
  } finally {
    killOwnedLeader(root);
    if(existsSync(escaped)) {
      const pid=Number(readFileSync(escaped,'utf8'));
      try {
        const fields=bytes=>bytes.slice(bytes.lastIndexOf(')')+2).trim().split(' ');
        const original=fields(readFileSync(escaped+'-identity','utf8')),current=fields(readFileSync(`/proc/${pid}/stat`,'utf8'));
        assert.equal(current[19],original[19],'cleanup cannot signal a replacement identity');
        assert.equal(Number(current[2]),pid);assert.equal(Number(current[3]),pid);
        process.kill(-pid,'SIGKILL');
      } catch(error) {if(error.code!=='ENOENT'&&error.code!=='ESRCH')throw error;}
    }
  }
});

function ownerFault(root,point,replacement,body) {
  const source=readFileSync(new URL('./release-command-owner.py',import.meta.url),'utf8');
  assert.equal(source.split(point).length,2,'unique actual owner mutation');
  const path=join(root,'owner.py');writeFileSync(path,source.replace(point,replacement),{flag:'wx',mode:0o600});
  return `import assert from 'node:assert/strict';
    import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
    import {existsSync,readFileSync,writeFileSync} from 'node:fs';
    import {captureCommand} from ${JSON.stringify(new URL('./release-gate-evidence.mjs',import.meta.url).href)};
    const actual=cp.spawn;let calls=0;
    cp.spawn=(command,args,options)=>{assert.equal(command,'/usr/bin/python3');assert.equal(args[2],${JSON.stringify(new URL('./release-command-owner.py',import.meta.url).pathname)});calls++;return actual(command,[...args.slice(0,2),${JSON.stringify(path)},...args.slice(3)],options);};
    syncBuiltinESMExports();
    ${body}
    assert.equal(calls,1);`;
}

test('actual kernel owner-admission refusal cannot start or accept the command', {timeout:12000},t=>{
  const root=temporary(t),marker=join(root,'must-not-start');
  const command=`require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');setInterval(()=>{},1000)`;
  const wrapper=ownerFault(root,'prctl(36, 1, 0, 0, 0)','prctl(-1, 1, 0, 0, 0)',
    `await assert.rejects(captureCommand(${JSON.stringify(root)},'admission',process.execPath,['-e',${JSON.stringify(command)}],${JSON.stringify(root)}));assert(!existsSync(${JSON.stringify(marker)}));`);
  execFileSync(process.execPath,['--input-type=module','-e',wrapper],{timeout:10000});
  assert.equal(JSON.parse(readFileSync(join(root,'admission.json'))).descendants_reaped,false);
});

test('actual ownership observation failure cannot suppress already-owned escalation or grant acceptance', {timeout:12000},t=>{
  const root=temporary(t),ready=join(root,'ready');
  const command=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`;
  const point='emit({"event": "started", "pid": self.process.pid})';
  const wrapper=ownerFault(root,point,point+'\n            self.child_path += "-missing"',
    `const timer=setInterval(()=>{if(existsSync(${JSON.stringify(ready)})){clearInterval(timer);process.kill(process.pid,'SIGTERM');}},5);
    try{await assert.rejects(captureCommand(${JSON.stringify(root)},'observation',process.execPath,['-e',${JSON.stringify(command)}],${JSON.stringify(root)}),/gate interrupted/);}finally{clearInterval(timer);}
    const pid=Number(readFileSync(${JSON.stringify(ready)},'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});`);
  execFileSync(process.execPath,['--input-type=module','-e',wrapper],{timeout:10000});
  const row=JSON.parse(readFileSync(join(root,'observation.json')));
  assert.equal(row.signal,'SIGKILL');assert.equal(row.interrupted,'SIGTERM');assert.equal(row.descendants_reaped,false);
});

test('the actual command cannot inherit the private owner-protocol descriptor',async t=>{
  const root=temporary(t),program='import errno,os\ntry: os.fstat(3)\nexcept OSError as e:\n assert e.errno==errno.EBADF\n print("private-owner-channel-not-inherited")\nelse: raise RuntimeError("inherited owner channel")';
  const row=await captureCommand(root,'private-channel','/usr/bin/python3',['-I','-B','-c',program],root);
  assert.equal(row.status,0);assert.equal(row.descendants_reaped,true);
  assert.equal(readFileSync(join(root,'private-channel.stdout'),'utf8'),'private-owner-channel-not-inherited\n');
});

test('bounded reap passes cannot mistake remaining actual children for completion', {timeout:12000},t=>{
  const root=temporary(t),program='import subprocess\nfor _ in range(8):\n p=subprocess.Popen(["/usr/bin/python3","-I","-B","-c","import time;time.sleep(60)"],start_new_session=True)\n print(p.pid,flush=True)';
  const point='for _ in range(4096):';
  const wrapper=ownerFault(root,point,'for _ in range(1):',
    `await assert.rejects(captureCommand(${JSON.stringify(root)},'reap-budget','/usr/bin/python3',['-I','-B','-c',${JSON.stringify(program)}],${JSON.stringify(root)}),/orphaned output pipes/);
    const pids=readFileSync(${JSON.stringify(join(root,'reap-budget.stdout'))},'utf8').trim().split('\\n').map(Number);assert.equal(pids.length,8);
    for(const pid of pids)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});`);
  execFileSync(process.execPath,['--input-type=module','-e',wrapper],{timeout:10000});
  assert.equal(JSON.parse(readFileSync(join(root,'reap-budget.json'))).descendants_reaped,true);
});

test('loss of private reporting after spawn still retires the actual resistant command', {timeout:12000},t=>{
  const root=temporary(t),ready=join(root,'ready');
  const command=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`;
  const point='emit({"event": "started", "pid": self.process.pid})';
  const replacement=`while not os.path.exists(${JSON.stringify(ready)}):\n                time.sleep(0.005)\n            os.close(3)\n            ${point}`;
  const wrapper=ownerFault(root,point,replacement,
    `await assert.rejects(captureCommand(${JSON.stringify(root)},'reporting-loss',process.execPath,['-e',${JSON.stringify(command)}],${JSON.stringify(root)}));
    const pid=Number(readFileSync(${JSON.stringify(ready)},'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});`);
  execFileSync(process.execPath,['--input-type=module','-e',wrapper],{timeout:10000});
  const row=JSON.parse(readFileSync(join(root,'reporting-loss.json')));
  assert.equal(row.descendants_reaped,false);assert.equal(row.capture_failed,true);
  assert.equal(readFileSync(join(root,'reporting-loss.stderr'),'utf8'),'','supervisor traceback must not contaminate original stderr');
});

test('extra and duplicate private completion messages cannot leave an acceptable failed record', {timeout:12000},t=>{
  for(const extra of ['duplicate','unknown']) {
    const root=temporary(t),point='return 0 if self.cleaned and self.error is None else 125';
    const event=extra==='duplicate'
      ? 'emit({"event": "completed", "status": status, "signal": signame, "orphaned": self.orphaned, "cleanup_verified": self.cleaned, "error": self.error})'
      : 'emit({"event": "unknown"})';
    const wrapper=ownerFault(root,point,event+'\n        '+point,
      `await assert.rejects(captureCommand(${JSON.stringify(root)},'extra',process.execPath,['-e','process.stdout.write("original")'],${JSON.stringify(root)}));`);
    execFileSync(process.execPath,['--input-type=module','-e',wrapper],{timeout:10000});
    const row=JSON.parse(readFileSync(join(root,'extra.json')));
    assert.equal(row.status,0);assert.equal(row.signal,null);assert.equal(row.descendants_reaped,false);assert.equal(row.capture_failed,true);
    const files=new Map(['json','stdout','stderr'].map(suffix=>['extra.'+suffix,readFileSync(join(root,'extra.'+suffix))]));
    assert.throws(()=>validateCommand(files,'extra',process.execPath,['-e','process.stdout.write("original")'],0));
  }
});

test('cancellation after the leader exits terminates its resistant pipe-holding grandchild', {timeout: 12000}, async t => {
  const root = temporary(t), ready = join(root, 'grandchild');
  const wrapper = `
    import {existsSync} from 'node:fs';
    import {captureCommand} from ${JSON.stringify(new URL('./release-gate-evidence.mjs', import.meta.url).href)};
    const timer=setInterval(()=>{if(existsSync(${JSON.stringify(ready)})){clearInterval(timer);process.kill(process.pid,'SIGHUP');}},10);
    try{await captureCommand(${JSON.stringify(root)},'cancel-orphan',process.execPath,['-e',${JSON.stringify(backgroundCommand(root, true))}],${JSON.stringify(root)});process.exitCode=1;}
    catch(error){if(error.message!=='gate interrupted')throw error;}finally{clearInterval(timer);}
  `;
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', wrapper], {timeout: 10000});
    const record = JSON.parse(readFileSync(join(root, 'cancel-orphan.json')));
    assert.equal(record.status, 0); assert.equal(record.interrupted, 'SIGHUP');
    assert.equal(record.orphaned, false, 'cancellation must not be relabeled as an ordinary exit failure');
    await noExecutingProcess(ready);
  } finally {killOwnedLeader(root);}
});

test('source and native archives preserve complete originals without promoting their scope', t => {
  for (const [kind, fixture, binding] of [['source-vv', sourceFixture, sourceContext], ['native-equivalence', nativeFixture, context]]) {
    const root = temporary(t); fixture(root); const output = join(temporary(t), 'original.tar');
    const captured = packEvidence(root, kind, output, binding);
    assert.equal(captured.scope, 'original-gate-evidence-only'); assert(captured.unclaimed.includes('sdk-acceptance'));
    for (const row of captured.files) assert.deepEqual(execFileSync('tar', ['-xOf', output, row.path]), readFileSync(join(root, row.path)));
    for (const changed of [{source_revision: 'c'.repeat(40)}, {run_id: '124'}, {architecture: 'arm64'}]) {
      assert.throws(() => captureEvidence(root, kind, {...binding, ...changed}));
    }
    // A later attempt may keep this earlier job's results; an earlier one may not.
    assert.equal(captureEvidence(root, kind, {...binding, run_attempt: '2'}).manifest.run_attempt, '2');
    const later = temporary(t); fixture(later);
    const result = kind === 'source-vv' ? 'source-dk-2-result.json' : 'native-result.json';
    put(later, result, {...JSON.parse(readFileSync(join(later, result))), run_attempt: '2'});
    assert.throws(() => captureEvidence(later, kind, binding), /attempt later/);
    assert.equal(captureEvidence(later, kind, {...binding, run_attempt: '2'}).manifest.run_attempt, '2');
  }
});

test('a factory receipt is the complete source evidence of its own run, never a relabelled one', t => {
  const root = temporary(t); sourceFixture(root);
  const files = new Map(sourceEvidenceNames().map(name => [name, readOriginal(join(root, name), 256 * 1024 * 1024)]));
  validateSourceReceipt(files, sourceContext);
  // The receipt keeps its own commit and run; it is not accepted as this run's.
  assert.throws(() => validateSourceReceipt(files, {...sourceContext, source_revision: 'c'.repeat(40)}));
  assert.throws(() => validateSourceReceipt(files, {...sourceContext, run_id: '124'}));
  const partial = new Map(files); partial.delete('source-gates-vv.json');
  assert.throws(() => validateSourceReceipt(partial, sourceContext));
  const extra = new Map(files); extra.set('factory-route.json', Buffer.from('{}'));
  assert.throws(() => validateSourceReceipt(extra, sourceContext));
  const changed = new Map(files); changed.set('source-vv.json', Buffer.from(canonical({schema: 'prismpm/vv-evidence/1', commit: revision, status: 'passed', gates: [1]})));
  assert.throws(() => validateSourceReceipt(changed, sourceContext));
});

test('missing bootstrap, failed command, substituted bytes and wrong native invocation fail closed', t => {
  for (const [kind, fixture, binding, changes] of [
    ['source-vv', sourceFixture, sourceContext, [
      root => rmSync(join(root, 'run-1-bootstrap-prior-capture.json')),
      root => rmSync(join(root, 'source-dk-2.json')),
      root => put(root, 'source-dk-2-vv.json', rawPart('dk-2').subarray(1)),
      root => put(root, 'source-dk-2-vv.json', rawPart('source')),
      root => put(root, 'source-source.stdout', 'changed original'),
      root => {const row = JSON.parse(readFileSync(join(root, 'source-conformance.json'))); row.status = 1; put(root, 'source-conformance.json', row);},
      root => {const row = JSON.parse(readFileSync(join(root, 'source-conformance.json'))); row.arguments = ['vv-part', 'dk-2']; put(root, 'source-conformance.json', row);},
      root => put(root, 'source-vv.json', Buffer.from(rawVv().toString().replace('"passed"', '"failed"'))),
      root => rmSync(join(root, 'source-vv.json')),
      root => put(root, 'run-1-extra.json', '{}'),
    ]],
    ['native-equivalence', nativeFixture, context, [
      root => rmSync(join(root, 'container-error.stderr')),
      root => {const row = JSON.parse(readFileSync(join(root, 'native-result.json'))); row.archive.path = 'prismpm-0.3.0-x86_64-unknown-linux-gnu.tar.gz'; put(root, 'native-result.json', row);},
      root => {const row = JSON.parse(readFileSync(join(root, 'native-error.json'))); row.status = 6; put(root, 'native-error.json', row);},
      root => commandFixture(root, 'container-error', 'docker', ['run', 'changed'], 6),
      root => {const row = JSON.parse(readFileSync(join(root, 'native-error.json'))); row.status = 0; put(root, 'native-error.json', row);},
      root => {const row = JSON.parse(readFileSync(join(root, 'native-result.json'))); row.archive.path = `prismpm-${workspaceVersion()}-aarch64-unknown-linux-gnu.tar.gz`; put(root, 'native-result.json', row);},
      root => {const row = JSON.parse(readFileSync(join(root, 'container-check.json'))); commandFixture(root, 'container-check', row.command, row.arguments, 0, 'different success');},
    ]],
  ]) for (const mutate of changes) {
    const root = temporary(t); fixture(root); mutate(root);
    const target = join(temporary(t), 'forbidden.tar'); assert.throws(() => packEvidence(root, kind, target, binding)); assert(!existsSync(target));
  }
});

test('retention requires fresh complete bootstrap outputs from the source part', async t => {
  for (const fault of ['none', 'unicode', 'missing', 'changed', 'stale']) {
    const source = temporary(t), output = temporary(t); mkdirSync(join(source, 'target'));
    const bootstrap = bootstrapFixture(revision, fault === 'unicode'); let calls = 0;
    for (const [name, bytes] of bootstrap.files) put(join(source, 'target'), name, bytes);
    const pending = retainPart(source, output, revision, 'source', async () => {
      calls++;
      for (const name of bootstrapNames) assert(!existsSync(join(source, 'target', name)), 'old success must be invalidated');
      put(join(source, 'target'), 'vv-part-source.json', rawPart('source'));
      if (fault === 'stale') return 0;
      for (const [name, bytes] of bootstrap.files) {
        if (fault === 'missing' && name === 'bootstrap-evidence.json') continue;
        put(join(source, 'target'), name, fault === 'changed' && name === 'bootstrap-current-capture.json' ? '{}' : bytes);
      }
      return 0;
    });
    if (!['none', 'unicode'].includes(fault)) {await assert.rejects(pending); assert(!existsSync(join(output, 'bootstrap.json')));}
    else {
      await pending;
      validateBootstrapRetention(readFileSync(join(output, 'bootstrap.json')), new Map([...bootstrap.retained.keys()].map(name => [name, readFileSync(join(output, name))])), revision);
    }
    assert.equal(calls, 1);
  }
});

test('original files reject symbolic links, hardlinks and parent aliases before command execution', async t => {
  const root = temporary(t), actual = join(root, 'actual'); writeFileSync(actual, 'retain');
  for (const [name, alias] of [['sym', symlinkSync], ['hard', linkSync]]) {
    const path = join(root, name); alias(actual, path); assert.throws(() => readOriginal(path));
  }
  const alias = join(root, 'directory'); symlinkSync(root, alias);
  await assert.rejects(captureCommand(alias, 'refused', process.execPath, ['-e', 'process.exit(0)'], root));
  assert(!existsSync(join(root, 'refused.stdout')));
});

function workflowContract(value) {
  const source = value.jobs['source-vv'].steps.find(step => step.with?.runCmd);
  assert.equal(source.if, undefined); assert.equal(source['continue-on-error'], undefined);
  assert.equal(source.with.runCmd, "set -euo pipefail\nexport PRISMPM_TEST_SDK_IMAGE='${{ steps.sdk.outputs.image }}'\nbash scripts/vv.sh --with-sdk bash -euo pipefail -c \"$(cat <<'PRISMPM_VV'\n"
    + "node scripts/release-gate-evidence.mjs source-run . target/source-vv-evidence '${{ github.sha }}' amd64 - '${{ github.run_id }}' '${{ github.run_attempt }}' '${{ matrix.part }}'\n" + 'PRISMPM_VV\n)"\n');
  assert.deepEqual(value.jobs['source-vv'].strategy.matrix.include.map(row => row.part).sort(), [...vvParts].sort());
  assert.equal(value.jobs['source-vv'].strategy.matrix.include.length, vvParts.length);
  assert.equal(value.jobs['source-vv'].strategy['max-parallel'], 8);
  for (const [name, job] of Object.entries(value.jobs)) assert(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 360, `${name} is bounded by one hosted-job limit`);
  const partUpload = value.jobs['source-vv'].steps.find(step => step.with?.name === 'source-vv-part-${{ matrix.part }}');
  assert.equal(partUpload.if, 'always()'); assert.equal(partUpload.with['if-no-files-found'], 'error');
  assert.equal(partUpload.with.path, 'target/source-vv-evidence/');
  assert.deepEqual(value.jobs.gate.needs, ['policy', 'factory', 'devcontainer-image', 'source-vv']);
  assert(value.jobs.gate.if.includes("(needs.factory.outputs.route == 'establish' && needs.source-vv.result == 'success')"));
  assert(value.jobs.gate.if.includes("(needs.factory.outputs.route == 'proved' && needs.source-vv.result == 'skipped')"));
  const assemble = value.jobs.gate.steps.find(step => step.run?.includes('release-gate-evidence.mjs source-assemble'));
  assert.equal(assemble.if, "${{ needs.factory.outputs.route == 'establish' }}"); assert.equal(assemble['continue-on-error'], undefined); assert(!assemble.run.includes('||'));
  const receipt = value.jobs.gate.steps.find(step => step.run?.includes('release-gate-evidence.mjs source-receipt'));
  assert.equal(receipt.if, "${{ needs.factory.outputs.route == 'proved' }}"); assert.equal(receipt['continue-on-error'], undefined); assert(!receipt.run.includes('||'));
  const sourceUpload = value.jobs.gate.steps.find(step => step.uses?.startsWith('actions/upload-artifact') && step.with?.name === 'source-vv');
  assert.equal(sourceUpload.if, undefined); assert.equal(sourceUpload.with['if-no-files-found'], 'error');
  assert.equal(sourceUpload.with.path, 'target/source-vv-evidence/');
  const native = value.jobs.native.steps.find(step => step.run?.includes('release-gate-evidence.mjs native'));
  assert.equal(native.if, undefined); assert.equal(native['continue-on-error'], undefined);
  assert(!native.run.includes('||'), 'native failure cannot be waived');
  assert(native.run.includes('node scripts/release-gate-evidence.mjs native . .native-equivalence "$GITHUB_SHA" \\\n  "${PLATFORM#linux/}" "$sdk_image" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$archive"'));
  const nativeUpload = value.jobs.native.steps.find(step => step.with?.name === 'sdk-equivalence-${{ matrix.arch }}');
  assert.equal(nativeUpload.if, 'always()'); assert.equal(nativeUpload.with.path, '.native-equivalence/');
  assert.equal(nativeUpload.with['if-no-files-found'], 'error');
  assert.equal(nativeUpload.with['include-hidden-files'], true, 'the hidden native evidence directory must be uploaded');
  assert.deepEqual(value.jobs.native.strategy.matrix.include, [
    {os: 'ubuntu-24.04', platform: 'linux/amd64', target: 'x86_64-unknown-linux-gnu', arch: 'amd64'},
    {os: 'ubuntu-24.04-arm', platform: 'linux/arm64', target: 'aarch64-unknown-linux-gnu', arch: 'arm64'},
  ]);
  assert.equal(value.jobs.native['runs-on'], '${{ matrix.os }}', 'each native archive is built on its own platform');
}
test('actual workflow retains every source part and complete native failure originals', () => {
  const value = load(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')); workflowContract(value);
  for (const mutate of [
    v => {v.jobs['source-vv'].steps.find(s => s.with?.runCmd).with.runCmd = 'just vv\n';},
    v => {v.jobs['source-vv'].strategy.matrix.include.pop();},
    v => {v.jobs['source-vv'].steps.find(s => s.with?.name === 'source-vv-part-${{ matrix.part }}').if = 'success()';},
    v => {v.jobs.gate.needs.pop();},
    v => {v.jobs.gate.steps.find(s => s.run?.includes('source-assemble')).run += ' || true';},
    v => {v.jobs.gate.steps.find(s => s.uses?.startsWith('actions/upload-artifact') && s.with?.name === 'source-vv').if = 'always()';},
    v => {v.jobs.gate.steps.find(s => s.run?.includes('source-receipt')).run += ' || true';},
    v => {v.jobs.gate.if = '${{ always() }}';},
    v => {v.jobs.native.steps.find(s => s.run?.includes('release-gate-evidence.mjs native')).run += ' || true';},
    v => {v.jobs.native.steps.find(s => s.with?.name === 'sdk-equivalence-${{ matrix.arch }}').with.path = '.';},
    v => {delete v.jobs.native.steps.find(s => s.with?.name === 'sdk-equivalence-${{ matrix.arch }}').with['include-hidden-files'];},
    v => {v.jobs.native.strategy.matrix.include[1].arch = 'amd64';},
  ]) {
    const changed = structuredClone(value); mutate(changed);
    assert.throws(() => workflowContract(changed));
  }
});
