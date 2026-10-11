// Real Linux processes and executed source mutants, not installed-SDK acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {executeOwnedSdkCommand} from './sdk-command-owner.mjs';
import {executeQualificationProcess} from './sdk-registry-qualification.mjs';

const options = {profile: 'vv', timeout: 3000, limit: 1024};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const absent = pid => assert(!existsSync(`/proc/${pid}`), 'real fixture must be absent BEFORE safety cleanup');
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'prism-sdk-owned-process-'));
  const marker = join(root, 'child.json'), token = randomBytes(16).toString('hex');
  t.after(async () => {
    if (existsSync(marker)) {
      const row = JSON.parse(readFileSync(marker)); assert.equal(row.token, token);
      assert(Number.isSafeInteger(row.pid) && row.pid > 1);
      if (existsSync(`/proc/${row.pid}`)) {
        const command = readFileSync(`/proc/${row.pid}/cmdline`, 'utf8').split('\0');
        assert(command.includes(marker) && command.includes(token), 'only identified test fixture may be cleaned');
        process.kill(row.pid, 'SIGKILL'); const deadline = performance.now() + 5000;
        while (existsSync(`/proc/${row.pid}`) && performance.now() < deadline) await pause(10);
        absent(row.pid);
      }
    }
    rmSync(root, {recursive: true});
  });
  const holder = `require('node:fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,token:process.argv[2]}),{flag:'wx'});`;
  const parent = (tail, detached = true, pipes = false) => `const fs=require('node:fs');const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(holder + tail)},${JSON.stringify(marker)},${JSON.stringify(token)}],{detached:${detached},stdio:${pipes ? "['ignore',1,2]" : "'ignore'"}});const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(timer);c.unref();process.exit(0)}},5);setTimeout(()=>process.exit(97),2000).unref();`;
  return {root, marker, token, holder, parent, pid: () => JSON.parse(readFileSync(marker)).pid};
}
async function mutant(t, transform) {
  const root = mkdtempSync(join(tmpdir(), 'prism-sdk-owner-source-mutant-'));
  t.after(() => rmSync(root, {recursive: true}));
  const original = readFileSync(new URL('./sdk-command-owner.py', import.meta.url), 'utf8');
  const changed = transform(original); assert.notEqual(changed, original, 'mutant must actually change production source');
  writeFileSync(join(root, 'sdk-command-owner.py'), changed, {flag: 'wx'});
  writeFileSync(join(root, 'sdk-command-owner.mjs'), readFileSync(new URL('./sdk-command-owner.mjs', import.meta.url)), {flag: 'wx'});
  return (await import(pathToFileURL(join(root, 'sdk-command-owner.mjs')).href)).executeOwnedSdkCommand;
}

test('natural trailing escaped work preserves original result and complete output within the original deadline', async t => {
  const f = await fixture(t), tail = "setTimeout(()=>process.stdout.write('TRAILING\\n'),120);";
  const result = await executeOwnedSdkCommand(process.execPath, ['-e', f.parent(tail, true, true)], options);
  assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.timedOut, false);
  assert.equal(result.stdout.toString(), 'TRAILING\n'); assert.equal(result.retirement.descendants_absent, true);
  assert.equal(result.retirement.supervisor_status, 0); absent(f.pid());
});

test('qualification normal leader exit cannot hide redirected same-group or escaped children', async t => {
  for (const detached of [false, true]) {
    const f = await fixture(t), start = performance.now();
    const result = await executeQualificationProcess(process.execPath, ['-e', f.parent('setTimeout(()=>{},15000);', detached)], {timeout: 300});
    assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.timedOut, true);
    assert.equal(result.descendants_absent, true); assert.equal(result.orphaned, true);
    assert(performance.now() - start < 5500); absent(f.pid());
  }
});

test('post-leader cancellation adopts late double-forked work without signaling an unrelated sentinel', async t => {
  const f = await fixture(t), sentinel = spawn(process.execPath, ['-e', "process.stdout.write('SENTINEL\\n');setInterval(()=>{},1000)"], {stdio: ['ignore', 'pipe', 'ignore']});
  const sentinelClosed = new Promise(resolve => sentinel.once('close', resolve));
  t.after(async () => {sentinel.kill('SIGKILL'); await sentinelClosed;});
  await new Promise(resolve => sentinel.stdout.once('data', resolve));
  const cancellation = new AbortController();
  const grandchild = f.holder + "process.stdout.write('GRANDCHILD\\n');process.on('SIGTERM',()=>{});setTimeout(()=>{},15000);";
  const middle = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)},${JSON.stringify(f.marker)},${JSON.stringify(f.token)}],{detached:true,stdio:['ignore',1,2]}).unref();setTimeout(()=>process.exit(0),50);`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(middle)}],{detached:true,stdio:['ignore',1,2]}).unref();process.exit(0);`;
  let timer;
  try {
    const result = await executeQualificationProcess(process.execPath, ['-e', parent], {signal: cancellation.signal,
      onOutput: (_, bytes) => {if (bytes.includes('GRANDCHILD') && !timer) timer = setTimeout(() => cancellation.abort(), 200);}});
    assert.equal(result.status, 0); assert.equal(result.aborted, true); assert.equal(result.descendants_absent, true);
    assert.equal(result.process_retirement.leader_exit_observed, true); absent(f.pid());
    assert.equal(sentinel.exitCode, null); assert.equal(sentinel.signalCode, null); process.kill(sentinel.pid, 0);
  } finally {clearTimeout(timer);}
});

test('concurrent private owners preserve independent real statuses and exhaust both descendant trees', async t => {
  const one = await fixture(t), two = await fixture(t);
  const results = await Promise.all([one, two].map((f, i) => executeOwnedSdkCommand(process.execPath,
    ['-e', f.parent(`setTimeout(()=>{},${100 + i * 50});`).replace('process.exit(0)', `process.exit(${7 + i})`)], options)));
  assert.deepEqual(results.map(r => r.status), [7, 8]);
  for (const [i, result] of results.entries()) {assert.equal(result.retirement.descendants_absent, true); absent([one, two][i].pid());}
});

test('real escaped output overflow is bounded and reaped before the failed result', async t => {
  const f = await fixture(t);
  await assert.rejects(executeOwnedSdkCommand(process.execPath, ['-e', f.parent("setTimeout(()=>{process.stdout.write('X'.repeat(8192));setInterval(()=>{},1000)},100);", true, true)], options), error => {
    assert.match(error.message, /output exceeded/); assert.equal(error.result.stdout.length, 1024);
    assert.equal(error.result.retirement.descendants_absent, true); absent(f.pid()); return true;
  });
});

test('actual subreaper admission refusal prevents the command from running', async t => {
  const f = await fixture(t), run = await mutant(t, s => s.replace('libc.prctl(36, 1, 0, 0, 0) != 0', 'libc.prctl(-1, 1, 0, 0, 0) != 0'));
  await assert.rejects(run(process.execPath, ['-e', f.holder, f.marker, f.token], options), error => {
    assert.equal(error.result.retirement.descendants_absent, false); assert.equal(error.result.status, null); return true;
  });
  assert(!existsSync(f.marker));
});

test('post-spawn observation failure is not repaired by later successful cleanup', async t => {
  const f = await fixture(t), run = await mutant(t, s => s.replace('self.known.add(self.process.pid)', 'self.known.add(self.process.pid)\n            self.child_path = "/proc/nonexistent-sdk-observer"'));
  await assert.rejects(run(process.execPath, ['-e', f.holder + 'setTimeout(()=>{},15000);', f.marker, f.token], {...options, timeout: 300}), error => {
    assert.equal(error.result.retirement.descendants_absent, false, 'failed observation must prohibit a receipt');
    assert.equal(error.result.retirement.supervisor_status, 125); absent(f.pid()); return true;
  });
});

test('private descriptors cannot be forged by commands and malformed terminal protocols fail closed', async t => {
  const program = String.raw`const fs=require('node:fs');for(const fd of [3,4]){try{fs.writeSync(fd,'{"event":"completed"}\n')}catch{process.stdout.write('PRIVATE-CLOSED\n')}}process.exit(7)`;
  const result = await executeOwnedSdkCommand(process.execPath, ['-e', program], options);
  assert.equal(result.status, 7); assert.equal(result.retirement.descendants_absent, true);
  assert.equal(result.stdout.toString(), 'PRIVATE-CLOSED\nPRIVATE-CLOSED\n');
  for (const transform of [s => s.replace('"event": "completed"', '"event": "wrong-terminal"'),
    s => s.replace('raw = (json.dumps(row', 'emit_duplicate = row.get("event") == "completed"\n    raw = (json.dumps(row').replace('    while raw:', '    if emit_duplicate:\n        raw += raw\n    while raw:'),
    s => s.replace('if len(raw) > 1024:', 'if row.get("event") == "completed":\n        raw = raw[:-1]\n    if len(raw) > 1024:')]) {
    const run = await mutant(t, transform);
    await assert.rejects(run(process.execPath, ['-e', 'process.exit(0)'], options), error => {
      assert.equal(error.result.retirement.descendants_absent, false); return true;
    });
  }
});

test('one bounded reap pass cannot be mistaken for exhaustion; executed omission mutant is killed', async t => {
  const f = await fixture(t);
  const onePass = await mutant(t, s => s.replace('range(4096)', 'range(1)'));
  const correct = await onePass(process.execPath, ['-e', f.parent('setTimeout(()=>{},120);')], options);
  assert.equal(correct.retirement.descendants_absent, true); absent(f.pid());
  const bad = await fixture(t), early = await mutant(t, s => s.replace('            if pid == 0:\n                return', '            if pid == 0:\n                self.cleaned = self.leader is not None  # executed premature-exhaustion mutation\n                return'));
  await assert.rejects(async () => {
    const result = await early(process.execPath, ['-e', bad.parent('setTimeout(()=>{},15000);')], options);
    assert.equal(result.retirement.descendants_absent, true); absent(bad.pid());
  }, 'the real-process absence oracle must reject premature exhaustion');
});

test('foreground expiry after supervisor exit remains failure while a real outside writer delays stream close', async t => {
  const root = mkdtempSync(join(tmpdir(), 'prism-sdk-external-writer-'));
  t.after(() => rmSync(root, {recursive: true}));
  const socket = join(root, 'private.sock');
  // Node's original child streams are socketpairs, not reopenable /proc pipes.
  // Pass the REAL original stdout via SCM_RIGHTS to an unrelated, test-owned
  // receiver. No event/child adapter fabricates supervisor exit or stream close.
  const receiver = String.raw`import array,os,socket,sys,time
s=socket.socket(socket.AF_UNIX);s.bind(sys.argv[1]);s.listen(1)
print("LISTEN",flush=True)
c,_=s.accept();raw,anc,flags,_=c.recvmsg(1,socket.CMSG_SPACE(array.array("i").itemsize))
assert raw==b"F" and flags==0 and len(anc)==1
level,kind,bytes_=anc[0];assert level==socket.SOL_SOCKET and kind==socket.SCM_RIGHTS
fds=array.array("i");fds.frombytes(bytes_);assert len(fds)==1
time.sleep(.35);os.close(fds[0]);c.close();s.close()
`;
  const outside = spawn('/usr/bin/python3', ['-I', '-B', '-c', receiver, socket], {stdio: ['ignore', 'pipe', 'pipe']});
  const closed = new Promise(resolve => outside.once('close', (status, signal) => resolve({status, signal})));
  t.after(async () => {if (outside.exitCode === null && outside.signalCode === null) outside.kill('SIGKILL'); await closed;});
  await new Promise((resolve, reject) => {
    outside.once('error', reject); outside.stdout.once('data', bytes => {
      try {assert.equal(bytes.toString(), 'LISTEN\n'); resolve();} catch (error) {reject(error);}
    });
  });
  const sender = String.raw`import array,os,socket,sys
s=socket.socket(socket.AF_UNIX);s.connect(sys.argv[1])
assert s.sendmsg([b"F"],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array("i",[1]))])==1
s.close()
`;
  await assert.rejects(executeOwnedSdkCommand('/usr/bin/python3', ['-I', '-B', '-c', sender, socket], {...options, timeout: 200}), error => {
    assert.match(error.message, /timed out/); assert.equal(error.result.status, 0);
    assert.equal(error.result.timedOut, true); assert.equal(error.result.retirement.supervisor_status, 0);
    assert.equal(error.result.retirement.close_observed, true); return true;
  });
  assert.deepEqual(await closed, {status: 0, signal: null});
});

test('direct supervisor interruption is never repaired by subsequent descendant reaping', async t => {
  const f = await fixture(t); let timer;
  const program = "process.stdout.write('SUPERVISOR '+process.ppid+'\\n');" + f.parent('setTimeout(()=>{},15000);');
  try {
    await assert.rejects(executeOwnedSdkCommand(process.execPath, ['-e', program], {...options,
      onOutput: (_, bytes) => {
        const match = /^SUPERVISOR ([1-9][0-9]*)\n$/.exec(bytes.toString());
        if (match) timer = setTimeout(() => {
          const command = readFileSync(`/proc/${match[1]}/cmdline`, 'utf8').split('\0');
          assert(command.some(argument => argument.endsWith('/sdk-command-owner.py')));
          assert(command.includes(program), 'interrupt only the actual private test invocation');
          process.kill(Number(match[1]), 'SIGTERM');
        }, 250);
      }}), error => {
        assert.equal(error.result.status, 0); assert.equal(error.result.retirement.supervisor_status, 125);
        assert.equal(error.result.retirement.owner_error, 'supervisor-interrupted');
        assert.equal(error.result.retirement.descendants_absent, false); absent(f.pid()); return true;
      });
  } finally {clearTimeout(timer);}
});

test('an executed additive stale-group signal is detected independently of sentinel survival', async t => {
  const check = async extra => {
    const f = await fixture(t), log = join(f.root, 'group-signals.jsonl');
    const run = await mutant(t, original => {
      const observer = `def observe_group(pid, signum):\n    try:\n        owned = os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is None\n    except ChildProcessError:\n        owned = False\n    with open(${JSON.stringify(log)}, "a") as stream:\n        stream.write(json.dumps({"pid":pid,"owned_unreaped":owned})+"\\n")\n    if not owned:\n        return  # observed mutant attempt; never signal an unowned identifier\n    try:\n        os.killpg(pid, signum)\n    except ProcessLookupError:\n        pass\n\n\n`;
      let source = original.replace('os.killpg(pid, signum)', 'observe_group(pid, signum)').replace('class Owner:', observer + 'class Owner:');
      if (extra) source = source.replace('emit({"event": "leader-exited", **self.leader})',
        'emit({"event": "leader-exited", **self.leader})\n                observe_group(self.process.pid, signal.SIGKILL)  # executed stale-PGID mutation');
      return source;
    });
    await assert.rejects(run(process.execPath, ['-e', f.parent('setTimeout(()=>{},15000);')], {...options, timeout: 300}), error => {
      assert.match(error.message, /timed out/); assert.equal(error.result.retirement.descendants_absent, true); absent(f.pid()); return true;
    });
    const rows = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
    for (const row of rows) assert.equal(row.owned_unreaped, true, 'actual waitid observer prohibits post-reap numeric group authority');
  };
  await check(false);
  await assert.rejects(check(true), /actual waitid observer/, 'executed additive group-signal mutant must be rejected, even when ESRCH leaves every sentinel unaffected');
});
