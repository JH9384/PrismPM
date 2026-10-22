// A real generated runner blocks on a FIFO after its pre-execution guard.
// Replacing an ELF path while it runs must be caught by the post-run guard.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {lstatSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {run} from '../browser-view/compile.mjs';

const writer = `
import {closeSync, constants, copyFileSync, chmodSync, openSync, readFileSync, renameSync, writeFileSync, writeSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const [fifo,path,saved,input,ready,mode]=process.argv.slice(1), bytes=readFileSync(input);
writeFileSync(ready,'ready\\n',{flag:'wx'});
let fd;
try {
  // This open succeeds only after the actual native runner opens its reader.
  fd=openSync(fifo,'w');
  renameSync(path,saved); copyFileSync(saved,path); chmodSync(path,Number(mode));
  writeSync(fd,bytes); closeSync(fd); fd=undefined;
} catch(error) {
  // Even a mutation-helper error must unblock the real reader and fail closed.
  if(fd===undefined)fd=openSync(fifo,constants.O_RDWR|constants.O_NONBLOCK);
  try{writeSync(fd,bytes);}catch{}
  await delay(5000); closeSync(fd); process.stderr.write(String(error)); process.exitCode=1;
}
`;

export async function verifyNativeDuringUse(build, row) {
  const work = mkdtempSync(join(build.work, 'native-during-use-'));
  const input = join(work, 'input.bin'), output = join(work, 'expected.bin');
  writeFileSync(input, row.request, {flag: 'wx'}); writeFileSync(output, row.response, {flag: 'wx'});
  const original = build.runNative.toString(), guard = 'finally { checkedNative(nativePrograms.get(standard)); }';
  assert.equal(original.split(guard).length, 2, 'exact actual native post-execution guard mutation');
  const changed = original.replace(guard, 'finally {}');
  // Mutate only the actual function's final guard. Preserve the real
  // compileNative preflight and execution, not a simulated successful runner.
  const withoutPostGuard = new Function('compileNative', 'run', 'work', 'return (' + changed + ');')
    (build.compileNative, run, build.work);
  const substitutions = [], missingPostGuardDetections = [];
  async function probe(standard, side, runner, suffix) {
    const label = (standard ? 'std' : 'no-std') + '-' + side + suffix;
    const record = build.nativeEvidence()[standard ? 'std' : 'no-std'];
    const path = join(build.work, record[side].path), saved = path + '.during-use-saved';
    const fifo = join(work, label + '.fifo'), ready = fifo + '.ready';
    const before = lstatSync(path), bytes = readFileSync(path);
    run('/usr/bin/mkfifo', ['--mode=600', fifo], build.work);
    const child = spawn(process.execPath, ['--input-type=module', '-e', writer,
      fifo, path, saved, input, ready, String(before.mode & 0o777)], {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.setEncoding('utf8'); child.stderr.on('data', bytes => {stderr += bytes;});
    const ended = new Promise(resolve => {
      child.once('error', error => resolve({error}));
      child.once('exit', (code, signal) => resolve({code, signal}));
    });
    try {
      const deadline = performance.now() + 10000;
      while (!lstatSync(ready, {throwIfNoEntry: false})) {
        assert.ok(performance.now() < deadline, 'native mutation writer started'); await delay(10);
      }
      let rejected, result;
      try {result = runner(standard, ['session', fifo, output]);} catch (error) {rejected = error;}
      let timer;
      try {
        assert.deepEqual(await Promise.race([ended, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('native mutation writer did not complete')), 10000);
        })]), {code: 0, signal: null}, stderr);
      } finally {clearTimeout(timer);}
      assert.notEqual(lstatSync(path).ino, before.ino);
      assert.deepEqual(readFileSync(path), bytes, 'identical bytes cannot bypass the post-execution identity guard');
      if (!rejected) assert.equal(result, 'PASS binary operation component twice\n', 'real native result before missing-guard detection');
      const identity = rejected?.message.startsWith('immutable ' + side + ' compiler');
      const links = rejected?.message.startsWith('compiler link count\n')
        && rejected.actual === 1n && rejected.expected === BigInt(record[side].links)
        && rejected.expected !== 1n;
      assert.ok(rejected?.code === 'ERR_ASSERTION'
        && rejected.stack.includes('/tests/browser-view/compiler-artifact.mjs:')
        && (identity || links), 'actual native execution cannot retain a replaced ELF path');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await ended;
      if (lstatSync(saved, {throwIfNoEntry: false})) {unlinkSync(path); renameSync(saved, path);}
      unlinkSync(fifo);
    }
    assert.equal(lstatSync(path).ino, before.ino); build.unchanged();
  }
  for (const standard of [true, false]) for (const side of ['original', 'private']) {
    const label = (standard ? 'std' : 'no-std') + '-' + side;
    await probe(standard, side, build.runNative, ''); substitutions.push(label);
    await assert.rejects(probe(standard, side, withoutPostGuard, '-removed-guard'), error =>
      error.code === 'ERR_ASSERTION' && error.message.startsWith('actual native execution cannot retain a replaced ELF path'),
    'the real removed post-execution guard must be detected');
    build.unchanged(); missingPostGuardDetections.push(label);
  }
  return {substitutions, missingPostGuardDetections};
}
