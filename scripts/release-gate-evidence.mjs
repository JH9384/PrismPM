// Original command/evidence retention only; no SDK acceptance or publication.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {closeSync, constants, lstatSync, mkdirSync, openSync, realpathSync, unlinkSync, writeFileSync, writeSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {bootstrapNames, canonical, captureBootstrap, hash, readOriginal, validateBootstrapBytes} from './sdk-bootstrap-retention.mjs';
import {validateVvEvidence} from './sdk-vv-run.mjs';

export function releaseContext(revision, architecture, image, runId, attempt) {
  assert.match(revision, /^[0-9a-f]{40}$/); assert(['amd64', 'arm64'].includes(architecture));
  assert(image === null || /^ghcr\.io\/uor-foundation\/prismpm-sdk@sha256:[0-9a-f]{64}$/.test(image));
  for (const value of [runId, attempt]) assert.match(value, /^[1-9][0-9]{0,19}$/);
  return {source_revision: revision, architecture, image_reference: image, run_id: runId, run_attempt: attempt};
}
function directory(path, fresh) {
  path = resolve(path); assert.equal(realpathSync(dirname(path)), dirname(path));
  if (fresh) mkdirSync(path, {mode: 0o755});
  assert.equal(realpathSync(path), path); assert(lstatSync(path).isDirectory()); return path;
}
const describe = (path, bytes) => ({path, byte_length: bytes.length, sha256: hash(bytes)});
export async function captureCommand(output, prefix, command, args, cwd, environment = process.env) {
  assert(/^[a-z][a-z0-9-]{0,63}$/.test(prefix)); directory(output, false);
  assert(Array.isArray(args) && args.every(value => typeof value === 'string'));
  const streams = ['stdout', 'stderr'], maxima = [256 * 1024 * 1024, 64 * 1024 * 1024];
  const fds = [], sizes = [0, 0], written = [0, 0], digests = streams.map(() => createHash('sha256'));
  let child, failure, watchdog, closeDrain, completion, started=false, protocolValid=true, protocol=Buffer.alloc(0), overflow=false, interrupted=null;
  const stop = error => {
    failure ??= error;
    child?.kill('SIGTERM');
    // The owner has its original five-second TERM grace and one-second
    // retirement bound. Losing supervision never creates accepted output.
    watchdog ??= setTimeout(()=>{
      child?.kill('SIGKILL');child?.stdout.destroy();child?.stderr.destroy();child?.stdio[3].destroy();
    },11000);
  };
  const handlers = ['SIGHUP', 'SIGINT', 'SIGTERM'].map(signal => [signal, () => {interrupted = signal; stop(Error('gate interrupted'));}]);
  try {
    for (const stream of streams) fds.push(openSync(join(output, `${prefix}.${stream}`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644));
    for (const [signal, handler] of handlers) process.on(signal, handler);
    const owner=fileURLToPath(new URL('./release-command-owner.py',import.meta.url));
    child=spawn('/usr/bin/python3',['-I','-B',owner,command,...args],{cwd,env:environment,detached:true,stdio:['ignore','pipe','pipe','pipe']});
    child.stdio[3].on('error',stop).on('data',bytes=>{
      try {
        assert(protocol.length+bytes.length<=4096,'bounded private process-owner protocol');
        protocol=Buffer.concat([protocol,bytes]);
        for(let end;(end=protocol.indexOf(10))!==-1;) {
          const row=JSON.parse(protocol.subarray(0,end));protocol=protocol.subarray(end+1);
          if(row.event==='started') {
            assert(!started&&!completion);assert.deepEqual(Object.keys(row).sort(),['event','pid']);
            assert(Number.isSafeInteger(row.pid)&&row.pid>1);started=true;
          } else if(row.event==='completed') {
            assert(!completion);assert.deepEqual(Object.keys(row).sort(),['cleanup_verified','error','event','orphaned','signal','status']);
            assert.equal(typeof row.cleanup_verified,'boolean');assert.equal(typeof row.orphaned,'boolean');
            assert(row.status===null||Number.isInteger(row.status)&&row.status>=0&&row.status<=255);
            assert(row.signal===null||/^SIG[A-Z0-9]+$/.test(row.signal));
            assert(row.error===null||['observation','ownership','signal','retirement','supervision'].includes(row.error));
            completion=row;
            if(row.orphaned)failure??=Error('gate left orphaned output pipes');
            if(!started||!row.cleanup_verified||row.error)failure??=Error('gate process retirement is uncertain');
          } else throw Error('gate process supervision failed');
        }
      } catch(error) {protocolValid=false;stop(error);}
    });
    for (const [index, stream] of [child.stdout, child.stderr].entries()) stream.on('error', stop).on('data', bytes => {
      sizes[index] += bytes.length;
      if (sizes[index] > maxima[index]) {overflow = true; stop(Error('complete original output exceeds bound')); return;}
      try {for (let offset = 0; offset < bytes.length;) {
        const count = writeSync(fds[index], bytes, offset, bytes.length - offset);
        assert(count > 0, 'original output write made no progress');
        digests[index].update(bytes.subarray(offset, offset + count)); written[index] += count; offset += count;
      }}
      catch (error) {stop(error);}
    });
    const ownerResult = await new Promise(resolveResult => {
      child.once('error', error => {failure ??= error;});
      child.once('exit',()=>{
        // If an uncertain owner exits while an escaped child holds pipes,
        // refuse after a bounded drain, without accepting truncated output.
        closeDrain=setTimeout(()=>{
          failure??=Error('process owner exited without complete output retirement');
          child.stdout.destroy();child.stderr.destroy();child.stdio[3].destroy();
        },1000);
      });
      child.once('close', (status, signal) => resolveResult({status, signal}));
    });
    const descendantsReaped=protocolValid&&protocol.length===0&&started&&completion?.cleanup_verified===true&&completion.error===null
      &&ownerResult.status===0&&ownerResult.signal===null;
    if(!descendantsReaped)
      failure??=Error('gate process retirement is uncertain');
    for (const fd of fds.splice(0)) closeSync(fd);
    const captured = streams.map((stream, index) => {
      const path = `${prefix}.${stream}`, bytes = readOriginal(join(output, path), maxima[index]);
      assert.equal(bytes.length, written[index], 'stored output differs from observed process bytes');
      assert.equal(hash(bytes), digests[index].digest('hex'), 'stored output differs from observed process bytes');
      return describe(path, bytes);
    });
    const record = {command,arguments:args,status:completion?.status??null,signal:completion?.signal??null,
      descendants_reaped:descendantsReaped,capture_failed:!!failure,orphaned:!!completion?.orphaned,overflow,interrupted,stdout:captured[0],stderr:captured[1]};
    writeFileSync(join(output, `${prefix}.json`), canonical(record), {flag: 'wx', mode: 0o644});
    if (failure) throw failure;
    return record;
  } finally {
    clearTimeout(watchdog);
    clearTimeout(closeDrain);
    for (const fd of fds) closeSync(fd);
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}
export function validateCommand(files, prefix, expectedCommand, expectedArgs, status) {
  const row = JSON.parse(files.get(`${prefix}.json`));
  assert.equal(files.get(`${prefix}.json`).toString(), canonical(row));
  assert.deepEqual(Object.keys(row).sort(), ['arguments', 'capture_failed', 'command', 'descendants_reaped', 'interrupted', 'orphaned', 'overflow', 'signal', 'status', 'stderr', 'stdout']);
  assert.equal(row.command, expectedCommand); assert.deepEqual(row.arguments, expectedArgs);
  assert.equal(row.status, status); assert.equal(row.signal, null); assert.equal(row.orphaned, false);
  assert.equal(row.overflow, false); assert.equal(row.interrupted, null);
  assert.equal(row.capture_failed,false,'failed original command capture cannot grant acceptance');
  assert.equal(row.descendants_reaped,true,'actual owned descendants must be reaped');
  for (const stream of ['stdout', 'stderr']) {
    const name = `${prefix}.${stream}`, bytes = files.get(name); assert(Buffer.isBuffer(bytes));
    assert.deepEqual(row[stream], describe(name, bytes));
  }
  return row;
}
export function validateSourceRun(files, run, context) {
  const prefix = `source-${run}`, raw = files.get(`${prefix}-vv.json`); validateVvEvidence(raw, context.source_revision);
  validateCommand(files, prefix, 'just', ['vv'], 0);
  const bootstrap = new Map(bootstrapNames.map(name => [name, files.get(`run-${run}-${name}`)]));
  validateBootstrapBytes(bootstrap);
  assert.deepEqual(JSON.parse(files.get(`${prefix}-result.json`)), {
    schema: 'prismpm/source-vv-retention/1', scope: 'original-source-run-only', ...context, run,
    vv: describe(`${prefix}-vv.json`, raw), bootstrap: {run, files: [...bootstrap].map(([name, bytes]) => describe(`run-${run}-${name}`, bytes))},
  });
}
async function sourceRun(root, output, context, run) {
  assert([1, 2].includes(run)); assert.equal(context.image_reference, null);
  assert.equal(context.architecture, process.arch === 'x64' ? 'amd64' : process.arch);
  const target = join(root, 'target');
  if (!lstatSync(target, {throwIfNoEntry: false})) mkdirSync(target, {mode: 0o755});
  assert.equal(realpathSync(target), target); assert.equal(resolve(output), join(target, 'source-vv-evidence'));
  output = directory(output, run === 1);
  for (const name of ['vv-evidence.json', ...bootstrapNames]) {
    const path = join(root, 'target', name), stat = lstatSync(path, {throwIfNoEntry: false});
    if (stat) {assert(stat.isFile() && stat.nlink === 1); unlinkSync(path);}
  }
  const prefix = `source-${run}`, command = await captureCommand(output, prefix, 'just', ['vv'], root);
  assert.equal(command.status, 0, 'unchanged full source VV failed'); assert.equal(command.signal, null);
  const raw = readOriginal(join(root, 'target/vv-evidence.json'), 4096); validateVvEvidence(raw, context.source_revision);
  writeFileSync(join(output, `${prefix}-vv.json`), raw, {flag: 'wx', mode: 0o644});
  const bootstrap = captureBootstrap(root, output, run);
  writeFileSync(join(output, `${prefix}-result.json`), canonical({schema: 'prismpm/source-vv-retention/1',
    scope: 'original-source-run-only', ...context, run, vv: describe(`${prefix}-vv.json`, raw), bootstrap}), {flag: 'wx', mode: 0o644});
}
export function nativeInvocations(root, image, architecture, uid, gid) {
  for (const id of [uid, gid]) assert(Number.isInteger(id) && id >= 0 && id <= 4294967294);
  const common = ['run', '--rm', '--platform', `linux/${architecture}`, '--network', 'none', '--user', `${uid}:${gid}`,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'];
  const workspace = ['--mount', `type=bind,source=${root},target=/workspace`];
  const native = [...common, '--mount', `type=bind,source=${root}/.native-cli,target=/native,readonly`,
    ...workspace, '--workdir', '/workspace', '--entrypoint', '/native/prismpm',
    'docker.io/library/debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171'];
  const sdk = [...common, ...workspace, image, 'prismpm'];
  return [['native-check', [...native, '--project', '/workspace', '--json', 'check'], 0],
    ['container-check', [...sdk, '--project', '/workspace', '--json', 'check'], 0],
    ['native-error', [...native, '--project', '/workspace', '--json', 'inspect', 'ghcr.io/uor-foundation/calculator:mutable'], 6],
    ['container-error', [...sdk, '--project', '/workspace', '--json', 'inspect', 'ghcr.io/uor-foundation/calculator:mutable'], 6]];
}
export function validateNative(files, context) {
  const result = JSON.parse(files.get('native-result.json'));
  assert.deepEqual(Object.keys(result).sort(), ['architecture', 'archive', 'gid', 'image_reference', 'root', 'run_attempt', 'run_id', 'schema', 'scope', 'source_revision', 'uid']);
  for (const [key, value] of Object.entries(context)) assert.equal(result[key], value);
  assert.equal(result.schema, 'prismpm/native-equivalence-retention/1'); assert.equal(result.scope, 'original-native-sdk-comparison-only');
  assert.equal(resolve(result.root), result.root); assert(!result.root.includes(','));
  assert.deepEqual(Object.keys(result.archive).sort(), ['byte_length', 'path', 'sha256']);
  assert.match(result.archive.path, /^prismpm-0\.3\.0-(?:aarch64|x86_64)-unknown-linux-gnu\.tar\.gz$/);
  assert.equal(result.archive.path.includes('aarch64'), context.architecture === 'arm64');
  assert(Number.isSafeInteger(result.archive.byte_length) && result.archive.byte_length > 0);
  assert.match(result.archive.sha256, /^[0-9a-f]{64}$/);
  for (const [prefix, args, status] of nativeInvocations(result.root, context.image_reference, context.architecture, result.uid, result.gid)) validateCommand(files, prefix, 'docker', args, status);
  assert.deepEqual(files.get('native-check.stdout'), files.get('container-check.stdout'));
  for (const stream of ['stdout', 'stderr']) assert.deepEqual(files.get(`native-error.${stream}`), files.get(`container-error.${stream}`));
}
async function nativeRun(root, output, context, archive) {
  assert(context.image_reference); assert(!root.includes(',')); output = directory(output, true);
  const uid = process.getuid(), gid = process.getgid();
  for (const [prefix, args, expected] of nativeInvocations(root, context.image_reference, context.architecture, uid, gid)) {
    const row = await captureCommand(output, prefix, 'docker', args, root);
    assert.equal(row.status, expected); assert.equal(row.signal, null);
  }
  const record = {schema: 'prismpm/native-equivalence-retention/1', scope: 'original-native-sdk-comparison-only',
    ...context, root, uid, gid, archive: describe(basename(archive), readOriginal(archive, 256 * 1024 * 1024))};
  writeFileSync(join(output, 'native-result.json'), canonical(record), {flag: 'wx', mode: 0o644});
  const files = new Map(['native-result.json', ...nativeInvocations(root, context.image_reference, context.architecture, uid, gid)
    .flatMap(([prefix]) => ['json', 'stdout', 'stderr'].map(suffix => `${prefix}.${suffix}`))]
    .map(name => [name, readOriginal(join(output, name), 256 * 1024 * 1024)]));
  validateNative(files, context);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, rootPath, output, revision, architecture, image, runId, attempt, selection, ...extra] = process.argv.slice(2);
  assert.equal(extra.length, 0); assert(['source-run', 'native'].includes(operation));
  const root = realpathSync(rootPath), context = releaseContext(revision, architecture, image === '-' ? null : image, runId, attempt);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), revision);
  if (operation === 'source-run') await sourceRun(root, output, context, Number(selection));
  else await nativeRun(root, output, context, resolve(selection));
}
