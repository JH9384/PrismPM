// Additive infrastructure fault qualification. Every application invocation,
// body, renderer, footer and guest remains the real pinned upstream session.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {capture} from './portable-oracle-custody.mjs';
import {expectedObservationSubmissions, observationFailureDiagnostics, observationSummary} from './portable-oracle-observation.mjs';

export const retirementFaults = Object.freeze([
  'pending-detach', 'rejected-detach', 'primary-body-failure',
  'late-acquisition', 'pending-acquisition', 'rejected-close', 'pending-close',
  'pending-acquisition-rejected-close',
  'registry-overflow', 'owned-operation-failure', 'registry-rejection', 'post-seal-acquisition',
  'preclosed-browser', 'rejected-acquisition',
]);
const positive = new Set(['pending-detach', 'rejected-detach', 'late-acquisition', 'rejected-acquisition']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const replace = (source, point, value) => {
  assert.equal(source.split(point).length, 2, 'unique retirement qualification point');
  return source.replace(point, value);
};
const witnessSchema = 'prismpm/portable-retirement-witness/1';
export function retirementDriver(source, fault, trigger) {
  assert(retirementFaults.includes(fault)); assert(['click', 'keyboard'].includes(trigger));
  let driver = replace(source, 'let browser;', `let retirementAcquisitions = 0, retirementDetaches = 0, retirementEnables = 0;
let retirementActiveDetaches = 0, retirementPeakDetaches = 0, retirementSettledDetaches = 0;
let retirementCloseStarted = 0, retirementClosed = false, retirementCloseHeld = false, retirementHandoffs = 0;
let retirementRetiredListeners = 0, retirementAcquisitionRefusals = 0;
let retirementPreparedAcquisitions = 0, retirementAcquisitionInvocations = 0;
let retirementRegistryAcquisitionRefusals = 0, retirementRegistryTaskRefusals = 0;
let retirementSubmission = 0;
const retirementRegistryRefusals = [];
let retirementBodyInvocations = 0, retirementTargetClosed = false;
let retirementRelease;
const retirementGate = new Promise(resolve => { retirementRelease = resolve; });
const retirementStart = performance.now();
let browser;`);
  driver = replace(driver, "    if (sealed || (closing && kind !== 'retirement') || pending.size >= 128) {",
    "    if (sealed || (closing && kind !== 'retirement') || pending.size >= 128) {\n      if (kind === 'acquisition') retirementRegistryAcquisitionRefusals++;\n      if (kind === 'task') retirementRegistryTaskRefusals++;\n      if (kind === 'acquisition' || kind === 'task') {\n        if (retirementRegistryRefusals.length >= 128) throw new Error('private-retirement-control');\n        retirementRegistryRefusals.push({submission: retirementSubmission, kind});\n      }");
  driver = replace(driver,
    'async function submit(vector, target = page, keyboard = false, {fillInputs = true} = {}) {',
    'async function submit(vector, target = page, keyboard = false, {fillInputs = true} = {}) {\n  retirementSubmission++;');
  const acquired = '      try { value = await target.context().newCDPSession(target); }';
  driver = replace(driver, acquired, `      try {
        ${fault === 'rejected-acquisition'
    ? `const closedTarget = await target.context().newPage(); await closedTarget.close();
        if (!closedTarget.isClosed()) throw new Error('private-retirement-control');
        retirementPreparedAcquisitions++;
        try { retirementAcquisitionInvocations++; value = await target.context().newCDPSession(closedTarget); }
        catch (error) { retirementAcquisitionRefusals++; throw error; }`
    : 'value = await target.context().newCDPSession(target);'}
        retirementAcquisitions++;
        const detach = value.detach.bind(value), send = value.send.bind(value);
        value.send = (...args) => { if (args[0] === 'Network.enable') retirementEnables++; return send(...args); };
        value.detach = async () => {
          retirementDetaches++;
          retirementRetiredListeners += ['Network.requestWillBeSent', 'Network.responseReceived',
            'Network.dataReceived', 'Network.loadingFinished', 'Network.loadingFailed']
            .reduce((count, name) => count + value.listenerCount(name), 0);
          ${['pending-detach', 'primary-body-failure', 'rejected-close', 'pending-close'].includes(fault)
    ? 'try { await detach(); } catch {} await new Promise(() => {});'
    : fault === 'rejected-detach'
      ? "try { await detach(); } catch {} throw new Error('private-retirement-control');"
      : 'await detach();'}
        };
        ${fault === 'late-acquisition' ? 'await retirementGate;' : ''}
      }`);
  if (['pending-acquisition','pending-acquisition-rejected-close'].includes(fault)) {
    // The real session is handed to the real owner before withholding the
    // registered acquisition completion. Retirement can still detach it.
    driver = replace(driver, '      session = value;',
      '      session = value; retirementHandoffs++; await new Promise(() => {});');
  }
  const retirement = '      const work = registry.retire(() => value.detach());';
  driver = replace(driver, retirement, retirement + `
      retirementActiveDetaches++; retirementPeakDetaches = Math.max(retirementPeakDetaches, retirementActiveDetaches);
      const retirementSettled = () => { retirementActiveDetaches--; retirementSettledDetaches++; };
      void work.then(retirementSettled, retirementSettled);`);
  const launched = 'browser = await chromium.launch({headless: true, executablePath: browserExecutable});';
  driver = replace(driver, launched, launched + `
const retirementRealClose = browser.close.bind(browser);
browser.close = async () => {
  retirementCloseStarted++; await retirementRealClose(); retirementClosed = !browser.isConnected();
  ${['rejected-close','primary-body-failure','pending-acquisition-rejected-close'].includes(fault)
    ? "throw new Error('private-retirement-control');"
    : fault === 'pending-close'
      ? 'retirementCloseHeld = retirementClosed; await new Promise(() => {});'
      : ''}
};`);
  if (!['late-acquisition', 'pending-acquisition', 'pending-acquisition-rejected-close', 'registry-overflow', 'registry-rejection', 'post-seal-acquisition'].includes(fault)) {
    const acquisition = '    network = await submissionNetworkOwner(target, `${origin}/_hologram/intent`, expectedRequest, record, diagnosticCleanup);';
    driver = replace(driver, acquisition, acquisition + '\n    await network.ready; // Fault preparation only; ordinary production never joins setup.');
  }
  if (trigger === 'keyboard') {
    driver = replace(driver, '      await submit(vector);', '      await submit(vector, page, true);');
    driver = replace(driver, '    await submit(recovery, delayedPage, false, {fillInputs: false});',
      '    await submit(recovery, delayedPage, true, {fillInputs: false});');
  }
  if (fault === 'primary-body-failure') driver = replace(driver,
    '      try { replyBody = await bounded(reply.body()); }',
    '      await target.close(); retirementTargetClosed = target.isClosed();\n      try { retirementBodyInvocations++; replyBody = await bounded(reply.body()); }');
  const beforeJourneys = "  await journey('attachment-assets', async () => {";
  if (fault === 'registry-overflow') driver = replace(driver, beforeJourneys,
    `  for (let index = 0; index < 128; index++) diagnosticCleanup.own(() => retirementGate);\n${beforeJourneys}`);
  if (fault === 'owned-operation-failure') driver = replace(driver, beforeJourneys,
    `  diagnosticCleanup.own(async () => { throw new Error('private-retirement-control'); });\n${beforeJourneys}`);
  if (fault === 'registry-rejection') driver = replace(driver, beforeJourneys,
    `  diagnosticCleanup.beginClose();\n${beforeJourneys}`);
  if (fault === 'post-seal-acquisition') driver = replace(driver, beforeJourneys,
    `  await diagnosticCleanup.join();\n${beforeJourneys}`);
  const close = 'browser ? diagnosticCleanup.closeBrowser(browser) : Promise.resolve()';
  if (['late-acquisition', 'registry-overflow'].includes(fault)) driver = replace(driver, close,
    '(async () => { retirementRelease(); if (browser) await diagnosticCleanup.closeBrowser(browser); })()');
  driver = replace(driver, '  let cleanupFailure;',
    `${fault === 'preclosed-browser' ? '  if (browser) await browser.close();\n' : ''}  const retirementCleanupStart = performance.now();\n  let cleanupFailure;`);
  driver = replace(driver, '  if (primaryFailure) throw primaryFailure;',
    `  emitDiagnostic({schema: '${witnessSchema}', fault: '${fault}', acquisitions: retirementAcquisitions,
    detaches: retirementDetaches, enables: retirementEnables, elapsed_ms: performance.now() - retirementStart,
    active_detaches: retirementActiveDetaches, peak_detaches: retirementPeakDetaches, settled_detaches: retirementSettledDetaches,
    close_started: retirementCloseStarted, browser_closed: retirementClosed, close_held: retirementCloseHeld,
    retired_listeners: retirementRetiredListeners, handoffs: retirementHandoffs,
    body_invocations: retirementBodyInvocations, target_closed: retirementTargetClosed,
    acquisition_refusals: retirementAcquisitionRefusals,
    prepared_acquisitions: retirementPreparedAcquisitions, acquisition_invocations: retirementAcquisitionInvocations,
    registry_acquisition_refusals: retirementRegistryAcquisitionRefusals, registry_task_refusals: retirementRegistryTaskRefusals,
    registry_refusals: retirementRegistryRefusals,
    ...diagnosticCleanup.summary(),
    cleanup_elapsed_ms: performance.now() - retirementCleanupStart, primary_failure: !!primaryFailure, cleanup_failure: !!cleanupFailure});
  if (primaryFailure) throw primaryFailure;`);
  return driver;
}
export function retirementSummary(value) {
  const witness = value?.witness;
  const count = number => Number.isSafeInteger(number) && number >= 0 && number <= 128 ? number : null;
  const duration = number => Number.isFinite(number) && number >= 0 && number <= 120_000 ? number : null;
  const digest = text => typeof text === 'string' && /^[a-f0-9]{64}$/.test(text) ? text : null;
  const failures = observationSummary(value);
  return {schema: 'prismpm/portable-retirement-diagnostic/1', scope: 'diagnostics-only-not-acceptance',
    fault: retirementFaults.includes(value?.fault) ? value.fault : null,
    trigger: ['click', 'keyboard'].includes(value?.trigger) ? value.trigger : null,
    profile: ['legacy-numeric', 'utf8-text'].includes(value?.profile) ? value.profile : null,
    status: value?.status === 'passed' ? 'passed' : 'incomplete',
    exit_code: failures.exit_code, terminated: failures.terminated, execution_error: failures.execution_error,
    driver_sha256: digest(value?.driver_sha256), oracle_sha256: digest(value?.oracle_sha256),
    model_sha256: digest(value?.model_sha256), archive_sha256: digest(value?.archive_sha256), wasm_sha256: digest(value?.wasm_sha256),
    stdout_sha256: digest(value?.stdout_sha256), stderr_sha256: digest(value?.stderr_sha256),
    submission_failures: failures.submission_failures, cleanup_failures: failures.cleanup_failures,
    submission_failures_truncated: failures.submission_failures_truncated,
    cleanup_failures_truncated: failures.cleanup_failures_truncated,
    witness: {acquisitions: count(witness?.acquisitions), detaches: count(witness?.detaches), enables: count(witness?.enables),
      active_detaches: count(witness?.active_detaches), peak_detaches: count(witness?.peak_detaches),
      settled_detaches: count(witness?.settled_detaches), close_started: count(witness?.close_started),
      browser_closed: witness?.browser_closed === true, close_held: witness?.close_held === true,
      retired_listeners: count(witness?.retired_listeners), handoffs: count(witness?.handoffs),
      body_invocations: count(witness?.body_invocations), target_closed: witness?.target_closed === true,
      acquisition_refusals: count(witness?.acquisition_refusals),
      prepared_acquisitions: count(witness?.prepared_acquisitions), acquisition_invocations: count(witness?.acquisition_invocations),
      registry_acquisition_refusals: count(witness?.registry_acquisition_refusals), registry_task_refusals: count(witness?.registry_task_refusals),
      registry_refusals: registryRefusalSummary(witness?.registry_refusals),
      unresolved_acquisitions: count(witness?.unresolved_acquisitions),
      actual_detaches_settled: count(witness?.actual_detaches_settled),
      closed_browser_transfers: count(witness?.closed_browser_transfers),
      unresolved_detaches: count(witness?.unresolved_detaches),
      elapsed_ms: duration(witness?.elapsed_ms), cleanup_elapsed_ms: duration(witness?.cleanup_elapsed_ms),
      primary_failure: witness?.primary_failure === true, cleanup_failure: witness?.cleanup_failure === true}};
}
function registryRefusalSummary(rows) {
  if (!Array.isArray(rows) || rows.length > 128) return null;
  if (!rows.every(row => row && Object.keys(row).sort().join(',') === 'kind,submission'
    && Number.isSafeInteger(row.submission) && row.submission >= 0 && row.submission <= 128
    && ['acquisition', 'task'].includes(row.kind))) return null;
  return rows.map(({submission, kind}) => ({submission, kind}));
}
export function requirePrimaryBodyFault(witness, failures, stderr) {
  assert.equal(witness.primary_failure, true); assert.equal(witness.acquisitions, 1); assert.equal(witness.detaches, 1);
  assert.equal(witness.target_closed, true, 'actual target close must succeed outside the branded body catch');
  assert.equal(witness.body_invocations, 1, 'actual response body must be invoked after successful target close');
  assert.equal(failures.submission_failures.length, 1); assert.equal(witness.cleanup_failure, true);
  assert.equal(failures.cleanup_failures.length, 1); assert.equal(failures.cleanup_failures[0].failure, 'unexpected');
  assert(['response-body-failed', 'response-body-unavailable'].includes(failures.submission_failures[0].failure));
  assert.match(stderr, /portable View oracle .*response-body-(?:failed|unavailable)|Network\.getResponseBody: No data found for resource/);
}
export function requireAcquisitionRefusal(witness, expected) {
  assert(Number.isSafeInteger(expected) && expected > 1);
  assert.equal(witness.prepared_acquisitions,expected,'actual closed targets must be prepared for every submission');
  assert.equal(witness.acquisition_invocations,expected,'the intended actual protocol operation must be invoked exactly once');
  assert.equal(witness.acquisition_refusals,expected,'only that actual acquisition call may supply the refusal');
  assert.equal(witness.acquisitions,0);assert.equal(witness.enables,0);
}
export function requireRegistryRefusal(witness, expected) {
  assert(Number.isSafeInteger(expected) && expected > 1);
  assert.equal(witness.registry_acquisition_refusals, expected, 'every actual acquisition admission must refuse before starting');
  assert.equal(witness.registry_task_refusals, expected, 'every actual ready-task admission must refuse synchronously');
  assert.equal(witness.acquisitions, 0); assert.equal(witness.detaches, 0); assert.equal(witness.enables, 0);
  assert.equal(witness.unresolved_acquisitions, 0); assert.equal(witness.unresolved_detaches, 0);
  assert.deepEqual(witness.registry_refusals, Array.from({length: expected}, (_, index) =>
    ['acquisition', 'task'].map(kind => ({submission: index + 1, kind}))).flat(),
  'every modeled submission must own its exact ordered pair; matching aggregate omissions cannot pass');
}
function main() {
  const [oracle, artifact, browser, fault, trigger, reference, evidence, ...extra] = process.argv.slice(2);
  assert.equal(extra.length, 0); assert(retirementFaults.includes(fault)); assert(['click', 'keyboard'].includes(trigger));
  assert.equal(process.version, 'v22.23.2');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const sourcePath = join(root, 'crates/prismpm/src/embedded/hologram-oracle.browser.mjs');
  const source = readFileSync(sourcePath, 'utf8');
  const modelPath = join(resolve(artifact), 'model.prism.json');
  const matrixPath = join(root, 'tests/data/portable-oracle-matrix.json');
  const model = JSON.parse(readFileSync(modelPath));
  const matrix = JSON.parse(readFileSync(matrixPath));
  const profile = matrix.profiles.find(row => row.name === model.application.name); assert(profile);
  const archive = join(resolve(artifact), profile.name + '.holo');
  const wasm = join(resolve(artifact), 'core-wasm', profile.cargo_name.replaceAll('-', '_') + '_core_wasm.wasm');
  const subjects = [sourcePath, matrixPath, oracle, modelPath, archive, wasm, reference, process.execPath, browser].map(capture);
  const baseline = JSON.parse(readFileSync(reference));
  assert.equal(baseline.schema, 'prismpm/portable-observation-result/1');
  assert.equal(baseline.status, 'passed'); assert.equal(baseline.profile, profile.profile);
  assert.equal(baseline.trigger, trigger); assert.equal(baseline.mode, 'unobserved');
  const directory = resolve(evidence); mkdirSync(directory);
  const driver = join(directory, 'driver.mjs'); writeFileSync(driver, retirementDriver(source, fault, trigger), {flag: 'wx'});
  const driverSubject = capture(driver); subjects.push(driverSubject);
  const result = spawnSync(resolve(oracle), [archive, modelPath, wasm, driver, process.execPath, resolve(browser)],
    {timeout: 120_000, maxBuffer: 1_048_576, encoding: 'utf8'});
  for (const stream of ['stdout', 'stderr']) writeFileSync(join(directory, stream + '.txt'), result[stream] ?? '', {flag: 'wx'});
  const witnesses = (result.stderr ?? '').split('\n').flatMap(line => {
    try { const row = JSON.parse(line); return row?.schema === witnessSchema ? [row] : []; }
    catch { return []; }
  });
  const faults = observationFailureDiagnostics(result.stderr);
  const receipt = {schema: 'prismpm/portable-retirement-result/1', fault, trigger, profile: profile.profile,
    status: 'incomplete', exit_code: result.status, terminated: result.signal !== null, execution_error: !!result.error,
    driver_sha256: driverSubject.measurement.sha256,
    oracle_sha256: subjects[2].measurement.sha256, model_sha256: subjects[3].measurement.sha256,
    archive_sha256: subjects[4].measurement.sha256, wasm_sha256: subjects[5].measurement.sha256,
    stdout_sha256: sha(result.stdout ?? ''), stderr_sha256: sha(result.stderr ?? ''), witness: witnesses[0],
    submission_failures: faults.submission_failures, cleanup_failures: faults.cleanup_failures,
    submission_failures_truncated: faults.submission_failures_truncated,
    cleanup_failures_truncated: faults.cleanup_failures_truncated};
  writeFileSync(join(directory, 'result.json'), JSON.stringify(receipt) + '\n', {flag: 'wx'});
  for (const subject of subjects) subject.verify();
  assert.ifError(result.error); assert.equal(result.signal, null); assert.equal(result.status, positive.has(fault) ? 0 : 1);
  assert.equal(faults.submission_failures_truncated,false);assert.equal(faults.cleanup_failures_truncated,false);
  assert.equal(witnesses.length, 1, 'one actual browser cleanup witness required');
  const witness = witnesses[0];
  assert.deepEqual(Object.keys(witness).sort(), ['schema', 'fault', 'acquisitions', 'detaches', 'enables',
    'active_detaches', 'peak_detaches', 'settled_detaches', 'close_started', 'browser_closed', 'close_held', 'retired_listeners', 'handoffs',
    'body_invocations', 'target_closed', 'unresolved_acquisitions', 'actual_detaches_settled',
    'closed_browser_transfers', 'unresolved_detaches', 'acquisition_refusals', 'prepared_acquisitions', 'acquisition_invocations',
    'registry_acquisition_refusals', 'registry_task_refusals',
    'registry_refusals',
    'elapsed_ms', 'cleanup_elapsed_ms', 'primary_failure', 'cleanup_failure'].sort());
  assert.equal(witness.fault, fault);
  for (const key of ['acquisitions', 'detaches', 'enables', 'active_detaches', 'peak_detaches', 'settled_detaches', 'close_started', 'retired_listeners', 'handoffs', 'body_invocations',
    'unresolved_acquisitions', 'actual_detaches_settled', 'closed_browser_transfers', 'unresolved_detaches', 'acquisition_refusals',
    'prepared_acquisitions', 'acquisition_invocations', 'registry_acquisition_refusals', 'registry_task_refusals'])
    assert(Number.isSafeInteger(witness[key]) && witness[key] >= 0 && witness[key] <= 128);
  assert.deepEqual(registryRefusalSummary(witness.registry_refusals), witness.registry_refusals);
  assert.equal(witness.close_started, 1); assert.equal(witness.browser_closed, true, 'actual browser close must complete');
  assert.equal(witness.close_held, fault === 'pending-close', 'synthetic close hold starts only after actual close completes');
  assert.equal(witness.retired_listeners, 0, 'every detached real session must have no diagnostic listeners left');
  assert(witness.elapsed_ms >= 0 && witness.elapsed_ms < 120_000, 'original whole-browser deadline');
  assert(witness.cleanup_elapsed_ms >= 0 && witness.cleanup_elapsed_ms < 12_000, 'one original ten-second cleanup bound');
  assert(!(result.stderr ?? '').includes('private-retirement-control'), 'diagnostics cannot publish raw injected errors');
  if (positive.has(fault)) {
    assert.equal(faults.submission_failures.length,0);assert.equal(faults.cleanup_failures.length,0);
    assert.deepEqual(JSON.parse(result.stdout.trim()), baseline.report, 'fault cannot change any actual full-profile acceptance');
    assert.equal(witness.primary_failure, false); assert.equal(witness.cleanup_failure, false);
    assert.equal(witness.active_detaches,0);assert.equal(witness.settled_detaches,witness.detaches);
    assert.equal(witness.unresolved_acquisitions,0);assert.equal(witness.unresolved_detaches,0);
    assert.equal(witness.actual_detaches_settled+witness.closed_browser_transfers,witness.detaches,
      'every started detach must settle or transfer to the successfully retired actual browser');
    if (fault === 'rejected-acquisition') {
      requireAcquisitionRefusal(witness,expectedObservationSubmissions(profile,trigger).length);
    } else assert(witness.acquisitions > 1, 'multiple actual sessions must exercise retirement');
    assert.equal(witness.detaches, witness.acquisitions);
    if (fault === 'late-acquisition') assert.equal(witness.enables, 0, 'retired late sessions cannot enable Network');
    else if (fault !== 'rejected-acquisition') {
      const expected = expectedObservationSubmissions(profile, trigger).length;
      assert.equal(witness.acquisitions, expected); assert.equal(witness.detaches, expected); assert.equal(witness.enables, expected);
      if(fault==='pending-detach')assert(witness.peak_detaches>1&&witness.peak_detaches<=expected,
        'multiple actual bounded retirement operations must overlap within the unchanged owner capacity');
      if(fault==='pending-detach')assert(witness.closed_browser_transfers>0,
        'actual detach completion withheld after physical detachment must transfer only after owned close');
    }
  } else if (fault === 'primary-body-failure') {
    requirePrimaryBodyFault(witness, faults, result.stderr);
  } else {
    assert.equal(faults.submission_failures.length,0);
    assert.equal(witness.primary_failure, false); assert.equal(witness.cleanup_failure, true);
    assert.equal(faults.cleanup_failures.length, 1); assert.equal(faults.cleanup_failures[0].resource, 'browser');
    assert.equal(faults.cleanup_failures[0].failure, ['pending-close', 'pending-acquisition'].includes(fault) ? 'timeout' : 'unexpected');
    if (['pending-close', 'pending-acquisition'].includes(fault)) assert(witness.cleanup_elapsed_ms >= 9_900);
    if (fault === 'pending-acquisition-rejected-close') assert(witness.cleanup_elapsed_ms >= 9_900);
    if (['pending-acquisition','pending-acquisition-rejected-close'].includes(fault)) {
      assert(witness.handoffs>1,'multiple real sessions must be accessible to the owner before withholding acquisition completion');
      assert.equal(witness.handoffs,witness.acquisitions);assert.equal(witness.enables,0,'withheld acquisition cannot enable retired diagnostics');
      assert.equal(witness.detaches,witness.acquisitions);assert.equal(witness.active_detaches,0);
      assert.equal(witness.unresolved_acquisitions,witness.acquisitions,
        'physical browser closure cannot retire unfinished acquisition operations');
    }
    if (['rejected-close','pending-close','pending-acquisition-rejected-close','preclosed-browser'].includes(fault))
      assert.equal(witness.closed_browser_transfers,0,'unsuccessful close cannot authorize transfers');
    if (['rejected-close','pending-close'].includes(fault)) {
      assert(witness.unresolved_detaches>0,'the control must actually withhold detach completion');
      assert(witness.cleanup_elapsed_ms>=9_900);
    }
    if (['registry-overflow', 'post-seal-acquisition'].includes(fault)) assert.equal(witness.acquisitions, 0);
    if (fault === 'registry-rejection') requireRegistryRefusal(witness, expectedObservationSubmissions(profile, trigger).length);
    if (fault === 'owned-operation-failure') {
      assert.equal(witness.registry_acquisition_refusals, 0); assert.equal(witness.registry_task_refusals, 0);
      const expected = expectedObservationSubmissions(profile, trigger).length;
      assert.equal(witness.acquisitions, expected); assert.equal(witness.detaches, expected); assert.equal(witness.enables, expected);
    }
  }
  receipt.status = 'passed';
  writeFileSync(join(directory, 'result.json'), JSON.stringify(receipt) + '\n');
  console.log(JSON.stringify(receipt));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
