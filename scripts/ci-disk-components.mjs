// Diagnostic metadata only, never acceptance evidence or a filesystem snapshot.
// Components are NOT additive: roots can overlap via hardlinks or same-device
// bind mounts, and each walk deduplicates hardlinks only within its component.
// workspace-other excludes only the workspace's direct target child. Docker
// means the default /var/lib/docker root; custom data-roots are not discovered.
// hosted-toolchains covers /opt/hostedtoolcache, not every preinstalled SDK.
// runner-installation assumes /home/runner/actions-runner and can be unavailable.
// Cross-device directories are skipped and marked partial. Same-device bind
// mounts cannot be distinguished from ordinary directories. Permission errors
// are never elevated. Missing Python, unsupported OS and inaccessible roots
// produce unavailable states. A live changing tree is not an atomic snapshot.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

const walker = fileURLToPath(new URL('./ci-disk-walk.py', import.meta.url));
export const diskComponentLabels = Object.freeze([
  'workspace-target', 'workspace-other', 'docker-storage', 'runner-installation', 'hosted-toolchains',
]);
export const diskLimits = Object.freeze({commandMs: 1000, totalMs: 5000, outputBytes: 1024, entries: 20000, depth: 32});
const states = Object.freeze(['complete', 'partial', 'timed-out', 'unavailable', 'entry-limit', 'depth-limit']);
const empty = status => ({status, allocatedBytes: null, entriesVisited: 0, symlinks: 0, skippedMounts: 0, errors: 0});
const bound = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;

// Direct child only. The fixed production scanner never spawns descendants.
// Timeout/overflow kills that child and closes its pipes; no raw stderr is kept.
// A kernel-blocked syscall can delay process reaping even after SIGKILL. The
// pending kill prevents the scanner resuming its walk after that syscall ends.
export async function boundedDiskCommand(command, args, {timeoutMs, outputBytes} = {}) {
  if (!bound(timeoutMs, diskLimits.commandMs) || !bound(outputBytes, diskLimits.outputBytes)) throw Error('invalid disk command bound');
  return new Promise(resolveResult => {
    let child, timer, settled = false, size = 0;
    const chunks = [];
    const finish = (status, stdout = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({status, stdout});
    };
    const abort = status => {
      if (settled) return;
      child?.kill('SIGKILL');
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      child?.unref();
      finish(status);
    };
    try {
      child = spawn(command, args, {shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: {PATH: '/usr/bin:/bin', LC_ALL: 'C'}});
      timer = setTimeout(() => abort('timed-out'), timeoutMs);
      child.once('error', () => finish('unavailable'));
      child.once('close', code => finish(code === 0 ? 'complete' : 'failed', code === 0 ? Buffer.concat(chunks).toString('utf8') : ''));
      for (const [stream, retain] of [[child.stdout, true], [child.stderr, false]]) {
        stream.on('error', () => abort('failed'));
        stream.on('data', bytes => {
          if (settled) return;
          size += bytes.length;
          if (size > outputBytes) { abort('output-limit'); return; }
          if (retain) chunks.push(bytes);
        });
      }
    } catch { abort('unavailable'); }
  });
}

export function parseDiskObservation(text, entryLimit = diskLimits.entries) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > diskLimits.outputBytes
    || !bound(entryLimit, diskLimits.entries)) return empty('invalid-output');
  let values;
  try { values = JSON.parse(text); } catch { return empty('invalid-output'); }
  if (!Array.isArray(values) || values.length !== 6
    || values.some(value => !Number.isSafeInteger(value) || value < 0)
    || values[0] >= states.length || values[2] > entryLimit
    || values.slice(3).some(value => value > entryLimit)
    || (values[0] === 3 && (values[1] !== 0 || values[2] !== 0))) return empty('invalid-output');
  return {status: states[values[0]], allocatedBytes: values[0] === 3 ? null : values[1],
    entriesVisited: values[2], symlinks: values[3], skippedMounts: values[4], errors: values[5]};
}

export function parseDiskCapacity(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > diskLimits.outputBytes) return {status: 'invalid-output'};
  let values;
  try { values = JSON.parse(text); } catch { return {status: 'invalid-output'}; }
  if (!Array.isArray(values) || values.length !== 4 || values.some(value => !Number.isSafeInteger(value) || value < 0)
    || ![0, 3].includes(values[0]) || (values[0] === 3 && values.slice(1).some(value => value !== 0))
    || values[2] > values[1]) return {status: 'invalid-output'};
  return values[0] === 3 ? {status: 'unavailable'}
    : {status: 'ok', totalBytes: values[1], availableBytes: values[2], freeFiles: values[3]};
}

export async function diskComponents({workspace = process.cwd(), commandMs = diskLimits.commandMs,
  totalMs = diskLimits.totalMs, outputBytes = diskLimits.outputBytes, entries = diskLimits.entries,
  depth = diskLimits.depth, componentOffset = 0, execute = boundedDiskCommand} = {}) {
  for (const [key, value] of Object.entries({commandMs, totalMs, outputBytes, entries, depth})) {
    if (!bound(value, diskLimits[key])) throw Error('invalid disk sampling bound');
  }
  if (!Number.isSafeInteger(componentOffset) || componentOffset < 0 || componentOffset >= diskComponentLabels.length)
    throw Error('invalid disk component offset');
  const started = performance.now();
  const components = Object.fromEntries(diskComponentLabels.map(label => [label, empty('not-sampled')])), capacity = {};
  let workspaceRoot;
  try { workspaceRoot = resolve(workspace); } catch { workspaceRoot = null; }
  const roots = [workspaceRoot === null ? null : resolve(workspaceRoot, 'target'), workspaceRoot,
    '/var/lib/docker', '/home/runner/actions-runner', '/opt/hostedtoolcache'];
  const observe = async (root, index, capacityMode = false) => {
    const unavailable = status => capacityMode ? {status} : empty(status);
    const remaining = Math.floor(totalMs - (performance.now() - started));
    if (remaining <= 0) return unavailable('not-sampled');
    if (root === null || process.platform !== 'linux') return unavailable('unavailable');
    const timeoutMs = Math.min(commandMs, remaining);
    let result;
    try {
      const args = capacityMode ? ['--capacity', root] : [root, index === 1 ? '1' : '0',
        String(entries), String(depth), String(Math.max(1, timeoutMs - 100))];
      result = await execute('/usr/bin/python3', ['-I', '-S', '-B', walker, ...args], {timeoutMs, outputBytes});
    } catch { result = {status: 'unavailable'}; }
    return result?.status === 'complete' ? (capacityMode ? parseDiskCapacity(result.stdout) : parseDiskObservation(result.stdout, entries))
      : unavailable(['unavailable', 'timed-out', 'output-limit', 'failed'].includes(result?.status) ? result.status : 'invalid-output');
  };
  // Capacity runs first, under the SAME aggregate deadline as component walks.
  // Workspace and Docker may share a filesystem; these numbers are not additive.
  capacity.workspace = await observe(workspaceRoot, 0, true);
  capacity.docker = await observe('/var/lib/docker', 0, true);
  // The caller can rotate priority per checkpoint so a slow earlier root does
  // not permanently starve later components. Serialization order stays fixed.
  for (let step = 0; step < diskComponentLabels.length; step++) {
    const index = (componentOffset + step) % diskComponentLabels.length;
    components[diskComponentLabels[index]] = await observe(roots[index], index);
  }
  return {schema: 1, components, capacity};
}
