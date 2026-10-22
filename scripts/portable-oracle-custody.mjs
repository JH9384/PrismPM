import assert from 'node:assert/strict';
import {lstatSync, realpathSync, readdirSync, cpSync, mkdirSync, writeFileSync, symlinkSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {snapshotFile} from '../sdk/exporter-seed.mjs';
import {redactor} from './ci-observe.mjs';

export function reportChildFailure(name, result, expectedStatus, emit = bytes => process.stderr.write(bytes), environment = process.env) {
  if (result.status === expectedStatus && result.signal === null && !result.error) return;
  assert(/^[a-z0-9-]+$/.test(name), 'invalid oracle diagnostic stage');
  emit(Buffer.from(`oracle stage ${name}: exit=${result.status}, signal=${result.signal}\n`));
  for (const stream of ['stdout', 'stderr']) {
    emit(Buffer.from(`${stream}:\n`));
    let remaining = 32768;
    const redact = redactor(environment, bytes => {
      const selected = bytes.subarray(0, remaining);
      if (selected.length) emit(selected);
      remaining -= selected.length;
    });
    // Redact before truncation so a credential spanning the limit cannot leak.
    redact(Buffer.from(result[stream] ?? ''), true);
    emit(Buffer.from(remaining ? '\n' : '\n[diagnostic limit reached]\n'));
  }
}

const fields = ['dev', 'ino', 'mode', 'size', 'nlink', 'mtimeNs', 'ctimeNs'];
export function capture(selected) {
  const path = realpathSync(selected), before = lstatSync(path, {bigint: true});
  const measurement = snapshotFile(path);
  const identity = Object.fromEntries(fields.map(key => [key, before[key].toString()]));
  const verify = () => {
    assert.equal(realpathSync(selected), path, 'oracle input path changed');
    const current = lstatSync(path, {bigint: true});
    for (const key of fields) assert.equal(current[key].toString(), identity[key], 'oracle input custody changed');
    assert.deepEqual(snapshotFile(path), measurement, 'oracle input bytes changed');
  };
  verify();
  return {selected, path, measurement, identity, verify};
}

export function requireBoundaryCheck(name, diagnostic) {
  const checks = {'wrong-response': 'response-envelope', 'delayed-wrong-response': 'response-envelope',
    duplicate: 'single-invocation', 'delayed-duplicate': 'single-invocation'};
  if (Object.hasOwn(checks, name) && diagnostic.check !== checks[name]) {
    const error = new Error('unrelated assertion is not boundary evidence');
    error.code = 'PORTABLE_WRONG_CHECK';
    throw error;
  }
}

// Only the injected negative-control client uses this owner. It cannot change
// the production fetch, correlated response reader, or acceptance predicates.
export function installDuplicateResponseOwner({payload, maximum, expectedOutput}) {
  if (Object.hasOwn(window, '__prismDuplicateControl')) throw new Error('duplicate control already installed');
  const pending = new Set(), outcomes = [];
  window.__prismDuplicateControl = {pending, outcomes};
  document.querySelector('#application-form').addEventListener('submit', () => {
    if (pending.size + outcomes.length >= 32) {
      if (outcomes.at(-1)?.status !== 'overflow') outcomes.push({status: 'overflow'});
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const operation = (async () => {
      const response = await fetch('/_hologram/intent', {method: 'POST',
        headers: {'content-type': 'application/json'}, signal: controller.signal,
        body: JSON.stringify({version: 1, name: 'application.invoke', payload})});
      if (response.status !== 200 || !response.body) throw new Error('duplicate response');
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
      let bytes = 0, text = '';
      try {
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array) || value.byteLength > maximum - bytes) throw new Error('duplicate bound');
          bytes += value.byteLength;
          text += decoder.decode(value, {stream: true});
        }
        text += decoder.decode();
        const value = JSON.parse(text);
        if (value === null || typeof value !== 'object' || Array.isArray(value)
          || Object.keys(value).sort().join(',') !== 'outputs,version' || value.version !== 1
          || !Array.isArray(value.outputs) || value.outputs.length !== 1 || value.outputs[0] !== expectedOutput)
          throw new Error('duplicate envelope');
        return {status: 'passed', http_status: response.status, bytes, envelope: true};
      } catch (error) {
        controller.abort();
        // Keep cancellation part of this owned task. If it cannot settle, the
        // enclosing process/browser lifetime must retire it; it cannot pass.
        await reader.cancel();
        throw error;
      } finally { reader.releaseLock(); }
    })().catch(error => { controller.abort(); throw error; });
    // Keep the actual operation alive and observe rejection immediately. The
    // outer browser owner joins every task inside its original cleanup budget.
    const work = operation.then(value => { outcomes.push(value); }, () => { outcomes.push({status: 'failed'}); })
      .finally(() => { clearTimeout(timer); pending.delete(work); });
    pending.add(work);
  });
}

export function duplicateInjection(target = 'page') {
  assert(['page', 'delayedPage'].includes(target));
  return `duplicatePages.add(${target});\nawait ${target}.evaluate(${installDuplicateResponseOwner.toString()}, {
    payload: decode.decode(Uint8Array.from(recovery.request)), maximum: app.response_maximum * 6 + 256,
    expectedOutput: decode.decode(Uint8Array.from(recovery.response))});`;
}

export function duplicateOwnedDriver(driver) {
  const declarations = 'let primaryFailure;';
  const cleanup = '      const ownCleanup = operation =>';
  const close = 'ownCleanup(() => browser ? diagnosticCleanup.closeBrowser(browser) : Promise.resolve())';
  const failure = "catch (error) { failedCleanup(firstBrowserCleanupFailure ?? error, 'browser'); }";
  assert.equal(driver.split(declarations).length, 2);
  assert.equal(driver.split(cleanup).length, 2);
  assert.equal(driver.split(close).length, 2);
  assert.equal(driver.split(failure).length, 2);
  return driver.replace(declarations, declarations + `
const duplicatePages = new Set();
let duplicateClose;
const closeDuplicateBrowser = () => {
  duplicateClose ??= browser ? diagnosticCleanup.closeBrowser(browser) : Promise.resolve();
  void duplicateClose.catch(() => {});
  return duplicateClose;
};`)
    .replace(cleanup, `      const joinDuplicateResponses = async () => {
      for (const target of duplicatePages) {
        const witness = await target.evaluate(async () => {
          const state = window.__prismDuplicateControl;
          if (!state) return {state: 'missing', pending: null, outcomes: []};
          await Promise.all([...state.pending]);
          return {state: 'joined', pending: Number.isSafeInteger(state.pending.size) && state.pending.size >= 0 && state.pending.size <= 32 ? state.pending.size : null,
            outcomes: state.outcomes.slice(0, 33).map(value => ({
              status: ['passed', 'failed', 'overflow'].includes(value?.status) ? value.status : 'other',
              http_status: Number.isInteger(value?.http_status) && value.http_status >= 100 && value.http_status <= 599 ? value.http_status : null,
              bytes: Number.isSafeInteger(value?.bytes) && value.bytes >= 0 && value.bytes <= 16 * 1024 ** 2 ? value.bytes : null,
              envelope: value?.envelope === true,
            }))};
        });
        emitDiagnostic({schema: 'prismpm/duplicate-control/1', ...witness});
        assert.equal(witness.state, 'joined');
        assert.equal(witness.pending, 0);
        assert.equal(witness.outcomes.length, 1);
        assert.equal(witness.outcomes[0].status, 'passed');
      }
      };
${cleanup}`)
    .replace(close, `ownCleanup(async () => {
          try { await joinDuplicateResponses(); }
          finally { await closeDuplicateBrowser(); }
        })`)
    .replace(failure, `catch (error) {
    // A timeout must initiate physical retirement even if the page evaluation
    // is still pending. The existing process owner owns final descendant reap.
    void closeDuplicateBrowser().catch(() => {});
    failedCleanup(firstBrowserCleanupFailure ?? error, 'browser');
  }`);
}

export function requireDuplicateWitness(value, maximum) {
  assert.deepEqual(Object.keys(value).sort(), ['outcomes', 'pending', 'schema', 'state']);
  assert.equal(value.schema, 'prismpm/duplicate-control/1');
  assert.equal(value.state, 'joined');
  assert.equal(value.pending, 0);
  assert.equal(value.outcomes.length, 1);
  const outcome = value.outcomes[0];
  assert.deepEqual(Object.keys(outcome).sort(), ['bytes', 'envelope', 'http_status', 'status']);
  assert.equal(outcome.status, 'passed');
  assert.equal(outcome.http_status, 200);
  assert.equal(outcome.envelope, true);
  assert(Number.isSafeInteger(outcome.bytes) && outcome.bytes > 0 && outcome.bytes <= maximum);
}

export function applyNegativeControl(driver, source, injection, control) {
  if (control === 'noop') return source;
  if (control === 'omit-finished' || control === 'malformed-finished') {
    const point = control === 'omit-finished'
      ? "target.on('requestfinished', onFinished);"
      : "record({event: 'request-finished', invocation: true});";
    assert.equal(driver.split(point).length, 2, 'completion-control mutation must be unique');
    return driver.replace(point, control === 'omit-finished' ? ''
      : "record({event: 'request-finished', invocation: true, unexpected: true});");
  }
  if (control === 'wrong-status') {
    assert.equal(driver.split(injection).length, 2, 'negative-control injection must be unique');
    return driver.replace(injection, injection.replace('status: 200,', 'status: 503,'));
  }
  assert.equal(control, 'none');
  return driver;
}

export function requireRequestCompletion(name, diagnostic) {
  try {
    assert(Array.isArray(diagnostic.events), 'actual submission events required');
    const completed = diagnostic.events.filter(event => event.event === 'request-finished');
    for (const event of completed) {
      assert.deepEqual(Object.keys(event).sort(), ['event', 'invocation']);
      assert.equal(event.invocation, true);
    }
    if (name === 'wrong-response' || name === 'delayed-wrong-response') {
      assert.equal(completed.length, 1, 'the body was read from exactly one completed invocation');
    }
  } catch {
    const error = new Error('correlated request completion evidence differs');
    error.code = 'PORTABLE_REQUEST_COMPLETION';
    throw error;
  }
}

export function refuseCargoAncestorConfiguration(directory) {
  for (let current = realpathSync(directory); ; current = dirname(current)) {
    for (const name of ['config', 'config.toml']) {
      let present = true;
      try { lstatSync(join(current, '.cargo', name)); }
      catch (error) { if (error.code === 'ENOENT') present = false; else throw error; }
      assert.equal(present, false, 'unowned Cargo ancestor configuration');
    }
    if (dirname(current) === current) return;
  }
}

export function snapshotSourceTree(root, {excludeGitDatabase = false} = {}) {
  const rows = [];
  function visit(directory, prefix) {
    assert.equal(realpathSync(directory), directory, 'source directory alias');
    for (const name of readdirSync(directory).sort()) {
      if (excludeGitDatabase && name === '.git') continue;
      assert(!/[\x00-\x1f\x7f]/.test(name), 'source control-character path');
      assert(rows.length < 32768, 'source entry bound exceeded');
      const path = join(directory, name), relative = prefix + name;
      const stat = lstatSync(path);
      assert(!stat.isSymbolicLink(), 'source alias refused');
      if (stat.isDirectory()) {
        rows.push({path: relative, kind: 'directory'});
        visit(path, relative + '/');
      } else rows.push({path: relative, ...snapshotFile(path)});
    }
  }
  visit(root, '');
  return rows;
}

export function privateGitObjects(sourceCargo, privateCargo,
  name = 'hologram-ab6b9bff1a591920', revision = '2bda6a9a9476872dade705bd61ece4209607f6da') {
  const source = realpathSync(join(sourceCargo, 'git/db', name, 'objects'));
  const destination = join(privateCargo, 'git/db', name);
  mkdirSync(join(destination, 'refs/commit'), {recursive: true});
  cpSync(source, join(destination, 'objects'), {recursive: true, errorOnExist: true, force: false});
  // Download caches legitimately hard-link objects. The private copy must not
  // contain aliases; Git fsck and the locked commit authenticate copied bytes.
  const rows = snapshotSourceTree(join(destination, 'objects'));
  assert(!rows.some(row => row.path.startsWith('info/') && row.kind !== 'directory'),
    'Git object alternates or graft metadata refused');
  writeFileSync(join(destination, 'config'), '[core]\n\tbare = true\n\trepositoryformatversion = 0\n', {flag: 'wx'});
  writeFileSync(join(destination, 'HEAD'), 'ref: refs/heads/master\n', {flag: 'wx'});
  writeFileSync(join(destination, 'refs/commit', revision), revision + '\n', {flag: 'wx'});
  return destination;
}

export function privateRegistryDownloads(sourceCargo, privateCargo) {
  mkdirSync(join(privateCargo, 'registry'), {recursive: true});
  for (const name of ['cache', 'index'])
    symlinkSync(realpathSync(join(sourceCargo, 'registry', name)), join(privateCargo, 'registry', name));
}
