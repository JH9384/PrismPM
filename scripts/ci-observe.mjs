// CI diagnostics only: never acceptance evidence or a replacement for a gate.
import { execFile, spawn } from 'node:child_process';
import { chmodSync, existsSync, fchmodSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, writeSync, statfsSync } from 'node:fs';
import { constants } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(import.meta.url);
export const limits = Object.freeze({intervalMs: 30_000, durationMs: 6 * 60 * 60 * 1000, samples: 721, telemetryBytes: 8 * 1024 * 1024,
  sampleBytes: 16 * 1024, headBytes: 32 * 1024 * 1024, tailBytes: 1024 * 1024, containers: 32});
const marker = {owner: 'ci-observe', version: 1};
const number = value => /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(String(value)) && Number.isFinite(Number(value))
  && Number(value) <= Number.MAX_SAFE_INTEGER ? Number(value) : null;
const read = path => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
// These numeric/redacted diagnostics are uploaded by the host user, whose UID
// need not equal the devcontainer user's. Never grant write access to others.
const publicFile = (path, flags) => { const fd = openSync(path, flags, 0o644); fchmodSync(fd, 0o644); return fd; };
const json = (path, value) => {
  const fd = publicFile(path, 'w');
  try { writeSync(fd, `${JSON.stringify(value)}\n`); } finally { closeSync(fd); }
};
const publicDirectory = directory => {
  const first = mkdirSync(directory, {recursive: true, mode: 0o755});
  if (first) {
    let current = first; chmodSync(current, 0o755);
    for (const part of relative(first, directory).split(sep).filter(Boolean)) {
      current = join(current, part); chmodSync(current, 0o755);
    }
  }
};
const owned = directory => {
  const value = JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf8'));
  if (JSON.stringify(value) !== JSON.stringify(marker)) throw new Error('not an observer directory');
};

export function keyNumbers(text, keys) {
  const rows = new Map(text.trim().split('\n').map(line => line.trim().split(/[:\s]+/))
    .map(([key, value]) => [key, number(value)]));
  return Object.fromEntries(keys.map(key => [key, rows.get(key) ?? null]));
}

export function pressure(text) {
  return Object.fromEntries(['some', 'full'].map(kind => {
    const line = text.split('\n').find(value => value.startsWith(`${kind} `)) ?? '';
    const values = new Map(line.split(' ').slice(1).map(value => value.split('=')));
    return [kind, Object.fromEntries(['avg10', 'avg60', 'avg300', 'total'].map(key => [key, number(values.get(key))]))];
  }));
}

function size(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(B|kB|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/.exec(value);
  if (!match) return null;
  const units = {B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12,
    KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4};
  return number(String(Math.round(Number(match[1]) * units[match[2]])));
}

export function dockerUsage(text) {
  const records = [];
  for (const line of text.split('\n').slice(0, 256)) {
    const fields = line.split('\t');
    if (fields.length !== 7 || !/^[0-9a-f]{12}(?:[0-9a-f]{52})?$/.test(fields[0])) continue;
    const pair = value => { const parts = value.split(' / '); return parts.length === 2 ? parts.map(size) : [null, null]; };
    const percent = value => value.endsWith('%') ? number(value.slice(0, -1)) : null;
    const [memoryBytes, memoryLimitBytes] = pair(fields[2]);
    const [blockReadBytes, blockWriteBytes] = pair(fields[5]);
    const [networkReadBytes, networkWriteBytes] = pair(fields[6]);
    records.push({id: fields[0], cpuPercent: percent(fields[1]), memoryBytes, memoryLimitBytes,
      memoryPercent: percent(fields[3]), pids: number(fields[4]), blockReadBytes, blockWriteBytes,
      networkReadBytes, networkWriteBytes});
  }
  return records.sort((a, b) => a.id.localeCompare(b.id)).slice(0, limits.containers);
}

// Closed names and numeric kernel fields only: never command lines, paths or
// environment. Process activity is diagnostic, not evidence of a passing gate.
export function compilerProcess(text) {
  if (typeof text !== 'string' || text.length > 4096) return null;
  const match = /^(\d+) \((cargo|rustc|lean|lake|xtask|timeout)\) (.*)$/.exec(text.trim());
  if (!match) return null;
  const fields = match[3].split(' ');
  if (fields.length < 22 || !/^[RSDZTWtXIP]$/.test(fields[0])) return null;
  const values = [match[1], fields[1], fields[11], fields[12], fields[21]].map(value =>
    /^(?:0|[1-9][0-9]*)$/.test(value) ? number(value) : null);
  if (values.some(value => value === null) || values[0] === 0) return null;
  const [pid, parentPid, userTicks, systemTicks, residentPages] = values;
  return {tool: match[2], pid, parentPid, state: fields[0], userTicks, systemTicks, residentPages};
}

function compilerActivity() {
  try {
    const candidates = readdirSync('/proc').filter(name => /^[1-9][0-9]*$/.test(name)).sort((a, b) => Number(a) - Number(b));
    const processes = []; let truncated = candidates.length > 8192;
    for (const pid of candidates.slice(0, 8192)) {
      const value = compilerProcess(read(`/proc/${pid}/stat`));
      if (value) {
        if (processes.length === 32) { truncated = true; break; }
        processes.push(value);
      }
    }
    return {available: true, truncated, processes};
  } catch { return {available: false, truncated: false, processes: []}; }
}

function filesystem(path) {
  try {
    const value = statfsSync(path);
    return {totalBytes: number(value.bsize * value.blocks), availableBytes: number(value.bsize * value.bavail),
      freeBytes: number(value.bsize * value.bfree), files: number(value.files), freeFiles: number(value.ffree)};
  } catch { return null; }
}

export async function sample() {
  const docker = await new Promise(resolveResult => {
    execFile('docker', ['stats', '--no-stream', '--format',
      '{{.ID}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.PIDs}}\t{{.BlockIO}}\t{{.NetIO}}'],
    {timeout: 2500, killSignal: 'SIGKILL', maxBuffer: 64 * 1024}, (error, stdout) => {
      resolveResult(error ? {available: false, containers: []} : {available: true, containers: dockerUsage(stdout)});
    });
  });
  return {time: new Date().toISOString(),
    memoryKiB: keyNumbers(read('/proc/meminfo'), ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree']),
    pressure: Object.fromEntries(['cpu', 'memory', 'io'].map(key => [key, pressure(read(`/proc/pressure/${key}`))])),
    filesystem: {workspace: filesystem(process.cwd()), docker: filesystem('/var/lib/docker')},
    cgroup: {memoryBytes: number(read('/sys/fs/cgroup/memory.current').trim()),
      memoryLimitBytes: number(read('/sys/fs/cgroup/memory.max').trim()),
      pids: number(read('/sys/fs/cgroup/pids.current').trim()),
      memoryEvents: keyNumbers(read('/sys/fs/cgroup/memory.events'), ['low', 'high', 'max', 'oom', 'oom_kill', 'oom_group_kill']),
      cpu: keyNumbers(read('/sys/fs/cgroup/cpu.stat'), ['usage_usec', 'user_usec', 'system_usec', 'nr_periods', 'nr_throttled', 'throttled_usec'])},
    compilerActivity: compilerActivity(), docker};
}

export async function monitor(directory, {intervalMs = limits.intervalMs, durationMs = limits.durationMs, samples = limits.samples,
  telemetryBytes = limits.telemetryBytes, collect = sample} = {}) {
  for (const [key, value] of Object.entries({intervalMs, durationMs, samples, telemetryBytes})) {
    if (!Number.isSafeInteger(value) || value < 1 || value > limits[key]) throw new Error('invalid monitor bound');
  }
  owned(directory);
  const fd = publicFile(join(directory, 'resources.jsonl'), 'wx');
  let count = 0, bytes = 0, reason = 'sample-limit';
  const deadline = Date.now() + durationMs;
  json(join(directory, 'ready.json'), marker);
  try {
    for (; count < samples;) {
      if (existsSync(join(directory, 'stop'))) { reason = 'stopped'; break; }
      if (Date.now() >= deadline) { reason = 'duration-limit'; break; }
      const line = Buffer.from(`${JSON.stringify(await collect())}\n`);
      if (line.length > limits.sampleBytes || bytes + line.length > telemetryBytes) { reason = 'byte-limit'; break; }
      writeSync(fd, line); bytes += line.length; count += 1;
      if (count === samples) break;
      const until = Math.min(deadline, Date.now() + intervalMs);
      while (Date.now() < until && !existsSync(join(directory, 'stop'))) await delay(Math.min(100, until - Date.now()));
    }
  } catch { reason = 'collection-error'; }
  finally {
    closeSync(fd);
    json(join(directory, 'monitor-result.json'), {samples: count, bytes, reason});
  }
}

export async function start(directory) {
  publicDirectory(directory);
  const ownerFile = publicFile(join(directory, 'owner.json'), 'wx');
  try { writeSync(ownerFile, `${JSON.stringify(marker)}\n`); } finally { closeSync(ownerFile); }
  const child = spawn(process.execPath, [script, '_monitor', directory], {detached: true, stdio: 'ignore'});
  let failed = false;
  child.once('error', () => { failed = true; });
  child.unref();
  const deadline = Date.now() + 5000;
  while (!existsSync(join(directory, 'ready.json'))) {
    if (failed || Date.now() > deadline) { closeSync(publicFile(join(directory, 'stop'), 'w')); throw new Error('monitor did not start'); }
    await delay(20);
  }
}

export async function stop(directory) {
  if (!existsSync(directory)) return;
  owned(directory);
  // Cooperative shutdown addresses this directory's monitor, never a reused PID.
  closeSync(publicFile(join(directory, 'stop'), 'w'));
  const deadline = Date.now() + 8000;
  while (!existsSync(join(directory, 'monitor-result.json'))) {
    if (Date.now() > deadline) throw new Error('monitor did not stop');
    await delay(20);
  }
}

export function redactor(environment, emit) {
  // Do not rely on GitHub's console masking to protect uploaded log artifacts.
  const secrets = [...new Set(Object.entries(environment)
    .filter(([name, value]) => /(?:TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL|AUTHORIZATION|(?:API|ACCESS|PRIVATE|SIGNING|SESSION)[_-]?KEY|DATABASE_URL|CONNECTION_STRING|DSN)/i.test(name) && value)
    .map(([, value]) => value))].map(value => Buffer.from(value)).sort((a, b) => b.length - a.length);
  const reserve = Math.max(1, ...secrets.map(value => value.length)) - 1;
  let pending = Buffer.alloc(0);
  return (chunk, final = false) => {
    pending = Buffer.concat([pending, chunk]);
    const safe = final ? pending.length : Math.max(0, pending.length - reserve);
    let cursor = 0;
    while (cursor < safe) {
      let position = safe, found;
      for (const secret of secrets) {
        const candidate = pending.indexOf(secret, cursor);
        if (candidate >= 0 && candidate < position) { position = candidate; found = secret; }
      }
      if (position > cursor) emit(pending.subarray(cursor, position));
      if (found) { emit(Buffer.from('[REDACTED]')); cursor = position + found.length; }
      else cursor = position;
    }
    pending = pending.subarray(cursor);
  };
}

export function boundedLog(directory, {headBytes = limits.headBytes, tailBytes = limits.tailBytes} = {}) {
  for (const [key, value] of Object.entries({headBytes, tailBytes})) {
    if (!Number.isSafeInteger(value) || value < 1 || value > limits[key]) throw new Error('invalid log bound');
  }
  const head = publicFile(join(directory, 'gate.log'), 'wx');
  let headSize = 0, observedBytes = 0, tail, tailSize = 0, generation = -1;
  const metadata = () => ({observedBytes, headBytes: headSize, tailBytes: tailSize, generation,
    truncated: generation >= 0, headLimit: headBytes, tailLimit: tailBytes,
    note: 'gate.log is the prefix; tail files alternate, newest generation modulo 2'});
  return {
    write(chunk) {
      observedBytes += chunk.length;
      const prefix = Math.min(chunk.length, headBytes - headSize);
      if (prefix) { writeSync(head, chunk.subarray(0, prefix)); headSize += prefix; }
      chunk = chunk.subarray(prefix);
      while (chunk.length) {
        if (tail === undefined || tailSize === tailBytes) {
          if (tail !== undefined) closeSync(tail);
          generation += 1; tailSize = 0;
          tail = publicFile(join(directory, `gate.tail-${generation % 2}.log`), 'w');
          json(join(directory, 'log-retention.json'), metadata());
        }
        const length = Math.min(chunk.length, tailBytes - tailSize);
        writeSync(tail, chunk.subarray(0, length)); tailSize += length; chunk = chunk.subarray(length);
      }
    },
    close() {
      closeSync(head); if (tail !== undefined) closeSync(tail);
      json(join(directory, 'log-retention.json'), metadata());
      return metadata();
    },
  };
}

function supervise(command) {
  // Keep the owned group leader alive until the parent finishes cleanup. An
  // exited command or closed output pipe cannot then recycle the group ID.
  process.on('SIGINT', () => {}); process.on('SIGTERM', () => {});
  process.on('disconnect', () => process.kill(-process.pid, 'SIGKILL'));
  let reported = false;
  const report = exitCode => {
    if (reported) return; reported = true;
    process.send({exitCode}, () => {
      // Descendants may still hold these pipes; the parent drains them normally.
      closeSync(1); closeSync(2);
    });
  };
  const commandProcess = spawn(command[0], command.slice(1), {stdio: 'inherit'});
  commandProcess.once('error', () => report(127));
  commandProcess.once('exit', (status, signal) => report(status ?? 128 + (constants.signals[signal] ?? 0)));
}

export async function run(directory, command) {
  let code = 127, diagnosticsError = false;
  let capture, child, closed = false, requestedSignal, escalation, started = false, brokenPipe = false, commandCode;
  const signals = ['SIGINT', 'SIGTERM'];
  const killOwnedGroup = signal => {
    // Our supervisor remains the live group leader until we kill the group.
    if (child?.pid && !closed) {
      try { process.kill(-child.pid, signal); } catch { /* Owned group already exited. */ }
    }
  };
  const forward = signal => {
    requestedSignal = signal;
    killOwnedGroup(signal);
    if (!escalation) escalation = setTimeout(() => {
      killOwnedGroup('SIGKILL');
      // Only after the owned group has been killed may broken local pipes be
      // destroyed. Earlier close would hide a still-running descendant.
      if (brokenPipe) { child?.stdout.destroy(); child?.stderr.destroy(); }
    }, 2000);
  };
  const handlers = signals.map(signal => () => forward(signal));
  signals.forEach((signal, index) => process.on(signal, handlers[index]));
  try {
    await start(directory);
    started = true;
    capture = boundedLog(directory);
    json(join(directory, 'gate-result.json'), {state: 'running'});
    if (requestedSignal) { code = 128 + constants.signals[requestedSignal]; return code; }
    child = spawn(process.execPath, [script, '_gate', '--', ...command],
      {detached: true, stdio: ['inherit', 'pipe', 'pipe', 'ipc']});
    child.on('message', value => {
      if (value && Object.keys(value).join(',') === 'exitCode' && Number.isInteger(value.exitCode)
        && value.exitCode >= 0 && value.exitCode <= 255 && commandCode === undefined) {
        commandCode = value.exitCode;
        // Completion ends ownership of every gate descendant, even one holding
        // a pipe open. Buffered output still drains; the real exit code wins.
        if (!requestedSignal) killOwnedGroup('SIGKILL');
      }
    });
    const merged = new PassThrough();
    const exit = new Promise(resolveExit => {
      child.once('error', () => resolveExit(127));
      child.once('close', (status, signal) => { closed = true; resolveExit(status ?? 128 + (constants.signals[signal] ?? 0)); });
    });
    let ended = 0;
    const readers = [child.stdout, child.stderr].map(source => {
      // Redact each stream before merging: stderr must not interrupt a secret
      // split between two stdout chunks (or vice versa).
      const filter = new Transform({transform(chunk, _encoding, callback) { redact(chunk); callback(); },
        flush(callback) { redact(Buffer.alloc(0), true); callback(); }});
      const redact = redactor(process.env, bytes => filter.push(bytes));
      filter.pipe(merged, {end: false});
      filter.once('end', () => { if (++ended === 2) merged.end(); });
      return pipeline(source, filter);
    });
    const sink = new Writable({write(chunk, _encoding, callback) {
      try { capture.write(chunk); } catch { diagnosticsError = true; }
      process.stdout.write(chunk, callback);
    }});
    // A broken diagnostic pipe must not orphan a detached gate. Escalation is
    // restricted to that gate's new process group, never other CI processes.
    const stdoutError = () => { diagnosticsError = true; merged.destroy(new Error('output closed')); };
    process.stdout.on('error', stdoutError);
    try {
      await Promise.all([...readers, pipeline(merged, sink)]);
      if (!requestedSignal) killOwnedGroup('SIGKILL');
      const supervisorCode = await exit;
      code = commandCode ?? supervisorCode;
    }
    catch {
      diagnosticsError = true; brokenPipe = true; forward('SIGTERM');
      const supervisorCode = await exit;
      code = commandCode ?? supervisorCode;
      if (code === 0) code = 125;
    } finally { process.stdout.removeListener('error', stdoutError); }
  } finally {
    try { capture?.close(); } catch { diagnosticsError = true; }
    if (started) { try { await stop(directory); } catch { diagnosticsError = true; } }
    if (code === 0 && requestedSignal) code = 128 + constants.signals[requestedSignal];
    if (started) {
      try { json(join(directory, 'gate-result.json'), {state: 'completed', exitCode: code, diagnosticsError}); }
      catch { process.stderr.write('CI diagnostic result could not be retained.\n'); }
    }
    clearTimeout(escalation);
    signals.forEach((signal, index) => process.removeListener(signal, handlers[index]));
  }
  return code;
}

async function main() {
  const [mode, path, ...args] = process.argv.slice(2);
  if (mode === '_gate') {
    if (path !== '--' || !args.length || !process.send) throw new Error('invalid gate supervisor');
    supervise(args); return;
  }
  if (!path || !['start', 'stop', '_monitor', 'run'].includes(mode)
    || (mode === 'run' ? args[0] !== '--' || args.length < 2 : args.length !== 0)) throw new Error('invalid invocation');
  const directory = resolve(path);
  if (mode === 'start') await start(directory);
  if (mode === 'stop') await stop(directory);
  if (mode === '_monitor') await monitor(directory);
  if (mode === 'run') process.exitCode = await run(directory, args.slice(1));
}
if (process.argv[1] && resolve(process.argv[1]) === script) {
  main().catch(() => { process.stderr.write('CI diagnostics failed; command and environment details withheld.\n'); process.exitCode = 125; });
}
