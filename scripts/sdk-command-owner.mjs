// Private per-command Linux supervision; no Node-global reaper or numeric-PGID fallback.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {constants} from 'node:os';
import {fileURLToPath} from 'node:url';

const ownerPath = fileURLToPath(new URL('./sdk-command-owner.py', import.meta.url));
const keys = (row, expected) => assert.deepEqual(Object.keys(row).sort(), expected.slice().sort());
const terminal = row => {
  assert((Number.isInteger(row.status) && row.status >= 0 && row.status <= 255 && row.signal === null)
    || (row.status === null && Object.hasOwn(constants.signals, row.signal)), 'original leader result required');
};

export function executeOwnedSdkCommand(command, args, {profile, environment, timeout, limit, aggregate = false,
  signal, onOutput, interruptions = false}) {
  assert.equal(process.platform, 'linux'); assert(['vv', 'qualification'].includes(profile));
  assert(typeof command === 'string' && command.length > 0 && Array.isArray(args) && args.every(a => typeof a === 'string'));
  assert(Number.isSafeInteger(timeout) && timeout > 0 && Number.isSafeInteger(limit) && limit > 0);
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/python3', ['-I', '-B', ownerPath, profile, command, ...args],
      {env: environment, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']});
    const chunks = [[], []], lengths = [0, 0], protocol = [];
    let protocolBytes = 0, pending = '', leader, started, completed, protocolFailure, failure,
      timedOut = false, overflow = false, aborted = false, settled = false, ownerExited,
      closeObserved = false, retirementTimer, retirementDeadline;
    const timers = [];
    const retirement = uncertainty => ({scope: 'private-linux-subreaper-exhaustion',
      leader_exit_observed: leader !== undefined, close_observed: closeObserved,
      descendants_absent: completed?.descendants_absent === true && closeObserved
        && ownerExited?.status === 0 && ownerExited.signal === null && !protocolFailure && !uncertainty,
      uncertainty, supervisor_status: ownerExited?.status ?? null, supervisor_signal: ownerExited?.signal ?? null,
      owner_error: completed?.error ?? null, protocol_failure: protocolFailure ?? null,
      python_version: started?.python_version ?? null});
    const result = uncertainty => ({...(leader ?? {status: null, signal: null}), pid: started?.pid ?? null,
      stdout: Buffer.concat(chunks[0]), stderr: Buffer.concat(chunks[1]), timedOut, overflow, aborted,
      orphaned: completed?.orphaned ?? false, close_observed: closeObserved,
      retirement: retirement(uncertainty)});
    const clean = () => {
      for (const timer of timers) clearTimeout(timer); clearTimeout(retirementTimer);
      signal?.removeEventListener('abort', abort);
      for (const [name, handler] of handlers) process.removeListener(name, handler);
    };
    const fail = uncertainty => {
      if (settled) return;
      settled = true; clean();
      const error = failure ?? Error(uncertainty); error.result = result(uncertainty);
      // Snapshot BEFORE releasing our descriptors; descriptor disposal is not
      // adoption, waiting, timely retirement, or permission to signal old PIDs.
      for (const stream of child.stdio.slice(1)) stream?.destroy();
      reject(error);
    };
    const stop = (error, operational = false) => {
      if (settled) return;
      if (profile === 'vv' || operational) failure ??= error;
      if (retirementDeadline !== undefined) return;
      retirementDeadline = performance.now() + 5000;
      retirementTimer = setTimeout(() => fail('owned descendant retirement unproven within five seconds'), 5000);
      // FD4 is an owned channel, not a PID/PGID that could be reused after exit.
      if (!child.stdio[4].destroyed) child.stdio[4].write('S', error => {
        if (error && !settled) {protocolFailure ??= String(error); failure ??= error;}
      });
    };
    const abort = () => {aborted = true; stop(Error('bounded process aborted'));};
    const handlers = interruptions ? ['SIGHUP', 'SIGINT', 'SIGTERM'].map(name =>
      [name, () => stop(Error(`interrupted by ${name}`))]) : [];
    for (const [name, handler] of handlers) process.on(name, handler);
    signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort();
    timers.push(setTimeout(() => {timedOut = true; stop(Error('bounded process timed out'));}, timeout));
    for (const [index, stream] of [child.stdout, child.stderr].entries()) {
      stream.on('error', error => stop(error, true));
      stream.on('data', bytes => {
        if (settled) return;
        const prior = aggregate ? lengths[0] + lengths[1] : lengths[index];
        const remaining = Math.max(0, limit - prior);
        if (remaining) chunks[index].push(Buffer.from(bytes.subarray(0, remaining)));
        lengths[index] += bytes.length;
        if ((aggregate ? lengths[0] + lengths[1] : lengths[index]) > limit) {
          overflow = true; stop(Error('bounded process output exceeded'));
        } else try {onOutput?.(index ? 'stderr' : 'stdout', bytes);}
        catch (error) {stop(error, true);}
      });
    }
    child.stdio[4].on('error', error => {if (!settled) {protocolFailure ??= String(error); stop(error, true);}});
    child.stdio[3].on('error', error => {protocolFailure ??= String(error); stop(error, true);});
    child.stdio[3].on('data', bytes => {
      if (settled) return;
      try {
        protocolBytes += bytes.length; assert(protocolBytes <= 4096, 'bounded supervisor protocol');
        assert(bytes.every(byte => byte === 10 || (byte >= 32 && byte < 127)), 'ASCII supervisor protocol');
        pending += bytes.toString('ascii');
        for (let end; (end = pending.indexOf('\n')) !== -1;) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          assert(line.length <= 1024 && protocol.length < 3);
          const row = JSON.parse(line); assert(row && typeof row === 'object' && !Array.isArray(row));
          if (protocol.length === 0) {
            keys(row, ['event', 'pid', 'python_version']); assert.equal(row.event, 'started');
            assert(Number.isSafeInteger(row.pid) && row.pid > 1);
            assert(['3.11.2', '3.12.3'].includes(row.python_version)); started = row;
          } else if (protocol.length === 1) {
            keys(row, ['event', 'status', 'signal']); assert.equal(row.event, 'leader-exited'); terminal(row);
            leader = {status: row.status, signal: row.signal};
          } else {
            keys(row, ['event', 'status', 'signal', 'descendants_absent', 'orphaned', 'error']);
            assert.equal(row.event, 'completed'); terminal(row);
            assert.deepEqual({status: row.status, signal: row.signal}, leader);
            assert(typeof row.descendants_absent === 'boolean' && typeof row.orphaned === 'boolean');
            assert(row.error === null || typeof row.error === 'string'); completed = row;
          }
          protocol.push(row);
        }
      } catch (error) {protocolFailure ??= String(error); stop(error, true);}
    });
    child.once('error', error => {failure ??= error; fail('private supervisor spawn failed');});
    child.once('exit', (status, signal) => {
      ownerExited = {status, signal};
      // Even a broken owner must not leave inherited pipes postponing failure
      // indefinitely. This is the SAME five-second budget, never an extension.
      if (retirementDeadline === undefined) {
        retirementDeadline = performance.now() + 5000;
        retirementTimer = setTimeout(() => fail('owned descendant retirement unproven within five seconds'), 5000);
      }
    });
    child.once('close', (status, signal) => {
      if (settled) return;
      closeObserved = true;
      const valid = !protocolFailure && pending === '' && protocol.length === 3
        && completed?.descendants_absent === true && completed.error === null
        && status === 0 && signal === null && ownerExited?.status === 0 && ownerExited.signal === null
        && performance.now() < retirementDeadline;
      if (!valid) {fail(protocolFailure ?? 'private supervisor completion or exhaustion unproven'); return;}
      settled = true; clean(); const observed = result(null);
      if (failure) {failure.result = observed; reject(failure);} else resolve(observed);
    });
  });
}
