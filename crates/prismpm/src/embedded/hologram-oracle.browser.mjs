// Acceptance-only browser driver. Expected application behavior comes from
// modeled byte vectors; all successful calls use the real upstream session.
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';

const require = createRequire('/opt/prismpm/oracles/package.json');
assert.equal(require('playwright/package.json').version, '1.62.1');
const {chromium, errors} = require('playwright');
const sanitizedFailures = new WeakSet();
const unavailableBodies = new WeakSet();
const failedBodies = new WeakSet();
function requestFailureReason(value) {
  const known = ['net::ERR_ABORTED', 'net::ERR_FAILED', 'net::ERR_CONNECTION_RESET', 'net::ERR_CONNECTION_CLOSED',
    'net::ERR_CONTENT_LENGTH_MISMATCH', 'net::ERR_INCOMPLETE_CHUNKED_ENCODING', 'net::ERR_INSUFFICIENT_RESOURCES',
    'net::ERR_TIMED_OUT', 'net::ERR_BLOCKED_BY_CLIENT', 'net::ERR_BLOCKED_BY_RESPONSE'];
  // Network diagnostics are not a channel for arbitrary browser/response text.
  return known.includes(value) ? value.slice(5) : value === null ? 'unavailable' : 'other';
}
function failureKind(error) {
  if (unavailableBodies.has(error)) return 'response-body-unavailable';
  if (error instanceof errors.TimeoutError) return 'timeout';
  if (failedBodies.has(error)) return 'response-body-failed';
  if (error instanceof assert.AssertionError) return 'assertion';
  return 'unexpected';
}
async function bounded(operation, diagnostic = false) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new errors.TimeoutError('oracle operation deadline')), 10_000);
      // An optional observer must not keep a completed browser owner alive.
      if (diagnostic) timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}
function sanitizedFailure(error, phase) {
  if (sanitizedFailures.has(error)) return error;
  const kind = failureKind(error);
  const detail = kind === 'response-body-unavailable'
    ? 'Network.getResponseBody: No data found for resource' : kind;
  // Raw assertion values, Playwright call logs and causes may contain drafts
  // or responses. Preserve the first failure category without publishing them.
  const safe = new Error(`portable View oracle ${phase}: ${detail}`);
  sanitizedFailures.add(safe);
  return safe;
}
function emitDiagnostic(value) {
  try { console.error(JSON.stringify(value)); }
  catch { /* A diagnostic sink is not authority to replace the original failure. */ }
}
// Pending observers belong to the browser lifetime, not to individual body
// acceptance. Register before starting an operation and never silently drop a
// late task. One final cleanup deadline owns the registry and browser together.
function diagnosticRetirementRegistry() {
  const pending = new Set();
  let sealed = false;
  let closing = false;
  let closeStarted = false;
  let uncertainty;
  let releaseBrowser;
  const browserRetired = new Promise(resolve => { releaseBrowser = resolve; });
  let acquisitions = 0, detaches = 0, settledDetaches = 0, transferredDetaches = 0;
  const admit = (operation, kind) => {
    if (sealed || (closing && kind !== 'retirement') || pending.size >= 128) {
      uncertainty ??= new Error('diagnostic cleanup ownership is uncertain');
      throw uncertainty;
    }
    const entry = {};
    pending.add(entry);
    if (kind === 'acquisition') acquisitions++;
    entry.work = Promise.resolve().then(operation).finally(() => {
      if (kind === 'acquisition') acquisitions--;
    });
    // Observe rejection immediately, including if ordinary acceptance ends
    // before this operation. The owner still retains its original outcome.
    void entry.work.then(() => pending.delete(entry), () => {
      uncertainty ??= new Error('diagnostic cleanup operation failed');
      pending.delete(entry);
    });
    return entry.work;
  };
  return {
    own: operation => admit(operation, 'task'),
    acquire: operation => admit(operation, 'acquisition'),
    retire: operation => admit(async () => {
      detaches++;
      // Observe the actual detach even when physical browser retirement wins.
      // Only a completed acquisition may create this retirement obligation.
      const actual = Promise.resolve().then(operation).then(() => 'settled', () => 'settled');
      const transferred = browserRetired.then(() => 'transferred');
      let disposition;
      try { disposition = await bounded(Promise.race([actual, transferred]), true); }
      catch {
        // A diagnostic timeout is not disposal. Keep owning the session until
        // the enclosing browser has demonstrably retired it.
        disposition = await transferred;
      }
      if (disposition === 'settled') settledDetaches++;
      else transferredDetaches++;
    }, 'retirement'),
    beginClose() {
      if (closing || sealed) {
        uncertainty ??= new Error('diagnostic cleanup ownership is uncertain');
      }
      closing = true;
    },
    async closeBrowser(value) {
      if (!closing || closeStarted || !value?.isConnected()) {
        uncertainty ??= new Error('diagnostic browser ownership is uncertain');
        throw uncertainty;
      }
      closeStarted = true;
      await value.close();
      if (value.isConnected()) throw new Error('diagnostic browser retirement is uncertain');
      releaseBrowser();
    },
    summary: () => ({unresolved_acquisitions: acquisitions, actual_detaches_settled: settledDetaches,
      closed_browser_transfers: transferredDetaches, unresolved_detaches: detaches - settledDetaches - transferredDetaches}),
    async join() {
      while (pending.size) await Promise.allSettled([...pending].map(entry => entry.work));
      sealed = true;
      if (uncertainty) throw uncertainty;
    },
    check() { if (uncertainty) throw uncertainty; },
  };
}
// CDP observations are diagnostic only: no body retrieval, request interception,
// cache overrides, or enlarged retention buffers can alter the acceptance path.
function submissionNetworkRecorder(session, endpoint, expectedRequest, record) {
  const requests = new Map();
  let ordinal = 0;
  let overflow = false;
  let active = true;
  const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 16 * 1024 ** 2 ? value : null;
  const listeners = {
    'Network.requestWillBeSent': value => {
      if (value.request?.url !== endpoint) return;
      if (!requests.has(value.requestId)) {
        if (requests.size === 32) { overflow = true; return; }
        requests.set(value.requestId, ++ordinal);
      }
      let payloadMatches = null;
      const payloadOversized = typeof value.request.postData === 'string' && value.request.postData.length > 65_536 * 6 + 256;
      if (typeof value.request.postData === 'string' && !payloadOversized) {
        try { assert.deepEqual(JSON.parse(value.request.postData), expectedRequest); payloadMatches = true; }
        catch { payloadMatches = false; }
      }
      record({event: 'cdp-request', request: requests.get(value.requestId),
        method: ['GET', 'POST'].includes(value.request.method) ? value.request.method : 'OTHER',
        payloadMatches, payloadOversized, redirect: value.redirectResponse !== undefined});
    },
    'Network.responseReceived': value => {
      if (!requests.has(value.requestId)) return;
      record({event: 'cdp-response', request: requests.get(value.requestId), status: integer(value.response?.status),
        serviceWorker: value.response?.fromServiceWorker === true, diskCache: value.response?.fromDiskCache === true});
    },
    'Network.dataReceived': value => {
      if (!requests.has(value.requestId)) return;
      record({event: 'cdp-data', request: requests.get(value.requestId),
        bytes: integer(value.dataLength), encodedBytes: integer(value.encodedDataLength)});
    },
    'Network.loadingFinished': value => {
      if (!requests.has(value.requestId)) return;
      record({event: 'cdp-finished', request: requests.get(value.requestId), encodedBytes: integer(value.encodedDataLength)});
    },
    'Network.loadingFailed': value => {
      if (!requests.has(value.requestId)) return;
      record({event: 'cdp-failed', request: requests.get(value.requestId),
        cancelled: value.canceled === true, reason: requestFailureReason(value.errorText ?? null)});
    },
  };
  const registrations = Object.entries(listeners).map(([name, listener]) => [name, value => { if (active) listener(value); }]);
  for (const [name, listener] of registrations) session.on(name, listener);
  return {
    summary: () => ({state: 'observed', requests: ordinal, overflow}),
    stop() {
      active = false;
      for (const [name, listener] of registrations) {
        try { session.off(name, listener); } catch { /* Diagnostic failure cannot replace the first body failure. */ }
      }
      requests.clear();
    },
  };
}
async function submissionNetworkOwner(target, endpoint, expectedRequest, record,
  registry = diagnosticRetirementRegistry()) {
  const unavailable = () => ({summary: () => ({state: 'unavailable'}), stop() {}});
  let network = unavailable();
  let session;
  let retired = false;
  const retirements = new Set();
  const detach = value => {
    try {
      const work = registry.retire(() => value.detach());
      retirements.add(work);
      void work.then(() => retirements.delete(work), () => retirements.delete(work));
    } catch { /* Registry uncertainty is owned by final browser cleanup. */ }
  };
  const retire = () => {
    retired = true;
    network.stop();
    const closing = session;
    session = undefined;
    if (closing) detach(closing);
  };
  const ready = (async () => { try {
    // The original acquisition promise owns late arrivals even if its deadline
    // wins. A timed-out session must never be abandoned between submissions.
    const acquisition = registry.acquire(async () => {
      let value;
      try { value = await target.context().newCDPSession(target); }
      catch { return null; } // Expected optional acquisition refusal is contained.
      if (retired) { detach(value); return null; }
      session = value;
      return value;
    });
    const acquired = await bounded(acquisition, true);
    if (acquired && !retired) {
      network = submissionNetworkRecorder(acquired, endpoint, expectedRequest, record);
      await bounded(acquired.send('Network.enable'), true);
    }
  } catch {
    retire();
    network = unavailable();
  } })();
  try { registry.own(() => ready); }
  catch { /* Acquisition remains owned; final cleanup refuses uncertainty. */ }
  const stop = async () => {
    retire();
    await ready;
    while (retirements.size) await Promise.allSettled([...retirements]);
  };
  // Ordinary submission never waits for diagnostic acquisition. The separate
  // mandatory observation owner explicitly joins ready before its witness.
  return {summary: () => network.summary(), retire, stop, ready};
}
let browser;
const diagnosticCleanup = diagnosticRetirementRegistry();
let primaryFailure;
try {
const input = createInterface({input: process.stdin, crlfDelay: Infinity})[Symbol.asyncIterator]();
const first = await input.next();
assert.equal(first.done, false);
const {origin, application: app, browser_executable: browserExecutable} = JSON.parse(first.value);
assert.equal(browserExecutable, process.arch === 'x64'
  ? '/ms-playwright/chromium_headless_shell-cft-157.0.8099.0/chrome-headless-shell-linux64/chrome-headless-shell'
  : '/ms-playwright/chromium_headless_shell-cft-157.0.8099.0/chrome-headless-shell-linux-arm64/chrome-headless-shell');
assert.ok(Number.isInteger(app.request_maximum) && app.request_maximum > 0 && app.request_maximum <= 65_536,
  'request bound exceeds pinned portable View transport');
assert.ok(Number.isInteger(app.response_maximum) && app.response_maximum > 0 && app.response_maximum <= 1_048_576,
  'response bound exceeds pinned portable View transport');
const url = new URL(origin);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.protocol, 'http:');
assert.equal(url.origin, origin);
const workbench = app.profile === 'prismpm/text-application/3' && app.workbench !== undefined;
const text = ['prismpm/text-application/1', 'prismpm/text-application/2', 'prismpm/text-application/3'].includes(app.profile);
const profile = workbench ? 'utf8-workbench' : text ? 'utf8-text' : 'legacy-numeric';
const decode = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
const view = workbench ? app.workbench : app.view;
const cases = [];
const vectorIndexes = [];
const directVectorIndexes = [];
const transportRejectedIndexes = [];
const textareaNormalizedIndexes = [];
const unrepresentableFrameIndexes = [];
let activeJourney = 'setup';
browser = await chromium.launch({headless: true, executablePath: browserExecutable});
assert.equal(browser.browserType().name(), 'chromium');
assert.equal(browser.version(), '157.0.8099.0');
const context = await browser.newContext();
const page = await context.newPage();
const unexpected = [];
const allowed = new Set(['/', '/index.html', '/app.css', '/app.js', '/favicon.ico', '/_hologram/intent']);
context.on('request', request => {
  const target = new URL(request.url());
  if (target.origin !== origin || !allowed.has(target.pathname) || target.search) unexpected.push(request.url());
});
page.setDefaultTimeout(10_000);
const output = page.locator('#result');
async function shows(expected, target = page) {
  await target.waitForFunction(value => document.querySelector('#result')?.textContent === value, expected);
}
async function statusShows(expected, target = page) {
  if (!workbench) return shows(expected, target);
  await target.waitForFunction(value => document.querySelector('#status')?.textContent === value, expected);
}
function frame(vector) {
  const request = decode.decode(Uint8Array.from(vector.request));
  if (!workbench) return {request, input: request, button: '#submit', form: '#application-form', field: '#request'};
  const separator = '\u001f';
  if (request.startsWith(view.raw.request_prefix + separator)) return {request,
    input: request.slice(view.raw.request_prefix.length + 1), button: '#submit', form: '#application-form', field: '#request'};
  const operation = view.operations.find(row => request.startsWith(row.request_prefix + separator));
  assert.ok(operation, 'workbench UI request must use a modeled guided or raw prefix');
  const values = request.slice(operation.request_prefix.length + 1).split(separator);
  assert.equal(values.length, operation.fields.length);
  return {request, operation, values, button: '#guided-submit', form: '#guided-form',
    field: '#field-' + operation.fields.at(-1).id};
}
// Failure-only observations, never a substitute for the correlated network
// body or an acceptance predicate. No document text or exception escapes.
async function failedClientState(target, expectedDisplay) {
  let timer;
  try {
    if (target.isClosed()) return {state: 'closed'};
    const expected = expectedDisplay();
    return await Promise.race([
      target.evaluate(({expected, responseError}) => {
        const output = document.querySelector('#result');
        const form = document.querySelector('#application-form');
        const button = document.querySelector('#submit');
        return {state: 'observed', outputPresent: output !== null,
          expectedResult: output !== null && output.textContent === expected,
          responseError: output !== null && output.textContent === responseError,
          busy: form !== null && form.hasAttribute('aria-busy') === true,
          disabled: button === null || button.disabled === true};
      }, {expected, responseError: workbench ? view.statuses.response_error : text ? view.response_error : view.input_error}),
      new Promise(resolve => {timer = setTimeout(() => resolve({state: 'unavailable'}), 250);}),
    ]);
  } catch { return {state: 'unavailable'}; }
  finally { clearTimeout(timer); }
}
async function fill(vector, target = page) {
  const request = decode.decode(Uint8Array.from(vector.request));
  if (workbench) {
    const prepared = frame(vector);
    if (!prepared.operation) {
      await target.locator('#raw-editor').evaluate(node => {node.open = true;});
      await target.locator('#request').fill(prepared.input);
    } else {
      await target.locator('#operation').selectOption(prepared.operation.id);
      for (const [index, field] of prepared.operation.fields.entries()) {
        const control = target.locator('#field-' + field.id);
        if (await control.evaluate(node => node.tagName === 'SELECT')) await control.selectOption(prepared.values[index]);
        else await control.fill(prepared.values[index]);
      }
    }
  } else if (text) await target.locator('#request').fill(request);
  else {
    const [version, operation, left, right] = request.split('\t');
    assert.equal(version, '1');
    const option = view.operations.find(item => item.request_name === operation);
    assert.ok(option, 'modeled operation must have a generated View option');
    await target.locator('#left').fill(left);
    await target.locator('#right').fill(right);
    await target.locator('#operation').selectOption(String(option.discriminant));
  }
}
function displayed(vector) {
  const value = decode.decode(Uint8Array.from(vector.response));
  if (workbench) return JSON.parse(value).response;
  if (text) return value;
  const [version, kind, body, extra] = value.split('\t');
  assert.equal(version, '1');
  assert.equal(extra, undefined);
  if (kind === 'ok') return body;
  assert.equal(kind, 'error');
  assert.ok(['division-by-zero', 'overflow'].includes(body));
  return body === 'division-by-zero' ? view.division_error : view.overflow_error;
}
function applicable(vector) {
  let request;
  try { request = decode.decode(Uint8Array.from(vector.request)); } catch { return false; }
  if (workbench) {
    if (vector.request.length > app.request_maximum) return false;
    const recognized = [view.raw.request_prefix, ...view.operations.map(row => row.request_prefix)]
      .some(prefix => request.startsWith(prefix + '\u001f'));
    if (!recognized) return false;
    let prepared;
    try { prepared = frame(vector); }
    catch { unrepresentableFrameIndexes.push(app.acceptance_vectors.indexOf(vector)); return false; }
    if (!prepared.operation && prepared.input.includes('\u001f')) {
      transportRejectedIndexes.push(app.acceptance_vectors.indexOf(vector)); return false;
    }
    if (prepared.operation?.fields.some((field, index) => field.kind === 'choice'
      && !field.choices.some(choice => choice.value === prepared.values[index]))) {
      unrepresentableFrameIndexes.push(app.acceptance_vectors.indexOf(vector)); return false;
    }
    if (prepared.operation?.fields.some((field, index) => field.required && !prepared.values[index].trim())) {
      transportRejectedIndexes.push(app.acceptance_vectors.indexOf(vector)); return false;
    }
    const values = prepared.operation ? prepared.values : [prepared.input];
    if (values.some((value, index) => prepared.operation && prepared.operation.fields[index].kind !== 'multiline'
      ? /[\r\n]/.test(value) : value.includes('\r'))) {
      textareaNormalizedIndexes.push(app.acceptance_vectors.indexOf(vector)); return false;
    }
    return true;
  }
  if (text) return vector.request.length <= app.request_maximum;
  const fields = request.split('\t');
  const canonical = value => {
    if (!/^-?(0|[1-9][0-9]*)$/.test(value)) return false;
    const number = BigInt(value);
    return number >= -(1n << 63n) && number < (1n << 63n) && number.toString() === value;
  };
  return fields.length === 4 && fields[0] === '1'
    && view.operations.some(item => item.request_name === fields[1])
    && canonical(fields[2]) && canonical(fields[3]);
}
const valid = app.acceptance_vectors.map((vector, index) => ({vector, index})).filter(({vector}) => applicable(vector));
assert.ok(valid.length > 0, 'no modeled request can exercise the actual View');
const recovery = workbench ? valid.find(({vector}) => !frame(vector).operation
  && JSON.parse(decode.decode(Uint8Array.from(vector.response))).status === 'ok')?.vector : valid[0].vector;
assert.ok(recovery, 'workbench oracle requires an exact modeled successful raw wrapper vector');
async function submissionCompletion(response, trigger, navigation) {
  // Observe trigger rejection immediately, including after body/navigation
  // failure. Do not delay a first body failure until keyboard teardown settles.
  const triggerOutcome = Promise.resolve(trigger).then(
    () => ({status: 'fulfilled'}), reason => ({status: 'rejected', reason}));
  const completed = Promise.resolve(response).then(async body => {
    const initiated = await triggerOutcome;
    if (initiated.status === 'rejected') throw initiated.reason;
    return body;
  });
  return Promise.race([completed, navigation]);
}
async function submit(vector, target = page, keyboard = false, {fillInputs = true} = {}) {
  const triggerSelector = arguments[3]?.triggerSelector ?? null;
  const prepared = frame(vector);
  const ready = ({button: buttonSelector, form: formSelector} = {button: '#submit', form: '#application-form'}) => {
    const button = document.querySelector(buttonSelector);
    const form = document.querySelector(formSelector);
    return button !== null && form !== null && !button.disabled && !form.hasAttribute('aria-busy');
  };
  const expectedRequest = {version: 1, name: 'application.invoke',
    payload: decode.decode(Uint8Array.from(vector.request))};
  const events = [];
  let eventsTruncated = false;
  const record = event => { if (events.length < 32) events.push(event); else eventsTruncated = true; };
  let invocation;
  let invocationCount = 0;
  let navigated = false;
  let phase = 'initial-readiness';
  let check = null;
  let network = {summary: () => ({state: 'unavailable'}), retire() {}, async stop() {}};
  let rejectNavigation;
  const navigation = new Promise((_, reject) => { rejectNavigation = reject; });
  // The observer is armed before readiness/fill, before the submission race.
  void navigation.catch(() => {});
  const onRequest = request => {
    if (request.url() !== `${origin}/_hologram/intent`) return;
    invocationCount++;
    const method = request.method();
    record({event: 'request', method: ['GET', 'POST'].includes(method) ? method : 'OTHER',
      navigation: request.isNavigationRequest()});
    if (request.method() !== 'POST') return;
    try {
      assert.deepEqual(request.postDataJSON(), expectedRequest);
      invocation ??= request;
    } catch { /* A mismatched request cannot satisfy response acceptance. */ }
  };
  const onNavigation = frame => {
    if (frame !== target.mainFrame()) return;
    navigated = true;
    record({event: 'main-frame-navigation'});
    rejectNavigation(new assert.AssertionError({message: 'submission must not navigate the main frame'}));
  };
  const onFailure = request => record({event: 'request-failed', invocation: request === invocation,
    reason: requestFailureReason(request.failure()?.errorText ?? null)});
  const onFinished = request => {
    if (request === invocation) record({event: 'request-finished', invocation: true});
  };
  const onCrash = () => record({event: 'page-crash'});
  const onClose = () => record({event: 'page-close'});
  target.on('request', onRequest);
  target.on('framenavigated', onNavigation);
  target.on('requestfailed', onFailure);
  target.on('requestfinished', onFinished);
  target.on('crash', onCrash);
  target.on('close', onClose);
  try {
    network = await submissionNetworkOwner(target, `${origin}/_hologram/intent`, expectedRequest, record, diagnosticCleanup);
    if (workbench) await target.waitForFunction(ready, {...prepared, button: triggerSelector ?? prepared.button});
    else await target.waitForFunction(ready);
    phase = 'fill';
    if (fillInputs) await fill(vector, target);
    phase = 'submission';
    // Match the request object observed after arming this submission, rather
    // than accepting any response that happens to share the endpoint URL.
    const response = target.waitForResponse(reply => reply.request() === invocation).then(async reply => {
      phase = 'response-body';
      record({event: 'response', status: reply.status(), serviceWorker: reply.fromServiceWorker()});
      // Capture immediately when the correlated response arrives, without
      // waiting for the initiating keyboard/click operation to settle.
      let replyBody;
      try { replyBody = await bounded(reply.body()); }
      catch (error) {
        if (error instanceof Error) failedBodies.add(error);
        if (error instanceof Error && /Network\.getResponseBody.*No data found for resource/.test(error.message))
          unavailableBodies.add(error);
        throw error;
      }
      record({event: 'body', bytes: replyBody.length});
      return {reply, replyBody};
    });
    const trigger = keyboard
      ? target.locator(workbench ? prepared.field : text ? '#request' : '#right').press(text ? 'Control+Enter' : 'Enter')
      : target.locator(triggerSelector ?? prepared.button).click();
    const {reply, replyBody} = await submissionCompletion(response, trigger, navigation);
    check = 'response-status';
    assert.equal(reply.status(), 200);
    check = 'request-envelope';
    assert.deepEqual(reply.request().postDataJSON(), expectedRequest);
    check = 'request-navigation';
    assert.equal(reply.request().isNavigationRequest(), false);
    // A missing body is a failed oracle execution. Preserve the first error;
    // never swallow it and retry the same vanished response.
    check = 'response-json';
    const envelope = JSON.parse(replyBody.toString('utf-8'));
    check = 'response-envelope';
    assert.deepEqual(envelope, {version: 1, outputs: [decode.decode(Uint8Array.from(vector.response))]});
    check = null;
    phase = 'rendered-result';
    await shows(displayed(vector), target);
    if (workbench) {
      const expected = JSON.parse(decode.decode(Uint8Array.from(vector.response)));
      if (expected.status === 'ok') {
        assert.equal(await target.locator('#result-shape').isVisible(), true);
        assert.equal(await target.locator('#result-rows').textContent(), String(expected.rows));
        assert.equal(await target.locator('#result-columns').textContent(), String(expected.columns));
      } else {
        assert.equal(await target.locator('#result-shape').isVisible(), false);
        assert.equal(await target.locator('#result-rows').textContent(), '');
        assert.equal(await target.locator('#result-columns').textContent(), '');
      }
    }
    phase = 'completed-readiness';
    if (workbench) await target.waitForFunction(ready, prepared);
    else await target.waitForFunction(ready);
    check = 'single-invocation';
    assert.equal(invocationCount, 1, 'submission must issue exactly one invocation');
    check = 'main-frame-navigation';
    assert.equal(navigated, false, 'submission must not navigate the main frame');
  } catch (error) {
    const client = await failedClientState(target, () => displayed(vector));
    emitDiagnostic({schema: 'prismpm/browser-submission-diagnostic/2',
      journey: activeJourney, vectorIndex: app.acceptance_vectors.indexOf(vector),
      phase, check, keyboard, events, eventsTruncated, invocationCount, navigated, client, network: network.summary(), failure: failureKind(error)});
    throw sanitizedFailure(error, phase);
  } finally {
    target.off('request', onRequest);
    target.off('framenavigated', onNavigation);
    target.off('requestfailed', onFailure);
    target.off('requestfinished', onFinished);
    target.off('crash', onCrash);
    target.off('close', onClose);
    network.retire();
  }
}
async function journey(name, work) {
  const previousJourney = activeJourney;
  activeJourney = name;
  try { await work(); }
  catch (error) { throw sanitizedFailure(error, name); }
  finally { activeJourney = previousJourney; }
  cases.push({name, status: 'passed', attempts: 1});
}
  await journey('attachment-assets', async () => {
    const modules = [];
    const onModule = response => {if (response.url() === `${origin}/app.js` && response.request().resourceType() === 'script') modules.push(response);};
    if (workbench) page.on('response', onModule);
    try {
    const navigation = await page.goto(`${origin}/`);
    assert.equal(await page.title(), view.title);
    assert.equal(await page.locator('h1').textContent(), view.heading);
    assert.equal(await page.locator(workbench ? '#status' : '#result').getAttribute('aria-live'), 'polite');
    assert.equal(await page.locator('#submit').textContent(), workbench ? view.raw.submit_label : view.submit_label);
    if (workbench) {
      assert.equal(navigation.status(), 200);
      const initial = await page.evaluate(html => [...new DOMParser().parseFromString(html, 'text/html').scripts]
        .map(node => ({src: node.getAttribute('src'), type: node.getAttribute('type')})), await bounded(navigation.text()));
      assert.deepEqual(initial, [{src: 'app.js', type: 'module'}]);
      await page.waitForFunction(() => document.querySelector('#guided-submit')?.disabled === false);
      // The source renderer replaces the body, including its executing module
      // node. Authenticate the original document and its actual module fetch.
      assert.equal((await page.locator('script').all()).length, 0);
      assert.equal(modules.length, 1);
      assert.equal(modules[0].status(), 200);
      assert.equal(modules[0].request().method(), 'GET');
      assert.equal(modules[0].request().redirectedFrom(), null);
    } else {
      assert.equal((await page.locator('script').all()).length, 1);
      assert.equal(await page.locator('script').getAttribute('src'), 'app.js');
    }
    } finally {if (workbench) page.off('response', onModule);}
  });
  await journey('modeled-vectors', async () => {
    for (const {vector, index} of valid) {
      await submit(vector);
      vectorIndexes.push(index);
    }
    await submit(recovery, page, true);
  });
  if (workbench) {
    await journey('workbench-direct-vectors', async () => {
      for (const [index, vector] of app.acceptance_vectors.entries()) {
        let payload;
        try { payload = decode.decode(Uint8Array.from(vector.request)); } catch { continue; }
        if (vector.request.length > app.request_maximum) continue;
        const reply = await fetch(`${origin}/_hologram/intent`, {method: 'POST', headers: {'content-type': 'application/json', origin},
          body: JSON.stringify({version: 1, name: 'application.invoke', payload})});
        assert.equal(reply.status, 200);
        assert.deepEqual(await reply.json(), {version: 1, outputs: [decode.decode(Uint8Array.from(vector.response))]});
        directVectorIndexes.push(index);
      }
    });
    await journey('workbench-ui-input-boundaries', async () => {
      await fill(recovery);
      for (const index of transportRejectedIndexes) {
        const prepared = frame(app.acceptance_vectors[index]), requests = [];
        const listener = request => {if (request.url() === `${origin}/_hologram/intent`) requests.push(request);};
        page.on('request', listener);
        try {
          await fill(app.acceptance_vectors[index]);
          await page.locator(prepared.button).click();
          await statusShows(view.statuses.input_error);
          const invalid = prepared.operation ? prepared.operation.fields.find((field, position) => field.required && !prepared.values[position].trim()) : null;
          assert.equal(await page.locator(invalid ? '#field-' + invalid.id : '#request').getAttribute('aria-invalid'), 'true');
          assert.deepEqual(requests, [], 'reserved separators must not enter a different framed invocation');
        } finally { page.off('request', listener); }
      }
      for (const index of textareaNormalizedIndexes) {
        const vector = app.acceptance_vectors[index];
        await fill(vector);
        const prepared = frame(vector);
        const observed = prepared.operation
          ? await Promise.all(prepared.operation.fields.map(field => page.locator('#field-' + field.id).inputValue()))
          : [await page.locator('#request').inputValue()];
        assert.notDeepEqual(observed, prepared.operation ? prepared.values : [prepared.input],
          'a normalization exception must actually change the rendered input');
        assert.ok(directVectorIndexes.includes(index), 'normalized source bytes still require an exact upstream invocation');
      }
      await submit(recovery);
    });
  }
  await journey('input-validation-recovery', async () => {
    if (workbench) await fill(recovery);
    const requests = [];
    const listener = request => requests.push(request);
    page.on('request', listener);
    if (text) {
      for (const value of ['x'.repeat(app.request_maximum + 1), '\ud800']) {
        await page.locator('#request').evaluate((element, value) => {element.value = value;}, value);
        await page.locator('#submit').click();
        await statusShows(workbench ? view.statuses.input_error : view.input_error);
        assert.equal(await page.locator('#request').getAttribute('aria-invalid'), 'true');
        assert.equal(await page.locator('#request').evaluate(element => document.activeElement === element), true);
      }
    } else {
      for (const value of ['', '+1', '9223372036854775808', '-0', '<script>']) {
        await page.locator('#left').fill(value);
        await page.locator('#submit').click();
        await shows(view.input_error);
      }
    }
    page.off('request', listener);
    assert.equal(requests.length, 0, 'invalid browser input must not reach the guest');
    await submit(recovery);
  });
  await journey('transport-failure-recovery', async () => {
    await page.route('**/_hologram/intent', route => route.abort());
    await fill(recovery);
    await page.locator('#submit').click();
    await statusShows(workbench ? view.statuses.compute_error : text ? view.response_error : view.input_error);
    await page.unroute('**/_hologram/intent');
    await submit(recovery);
  });
  await journey('pre-init-privacy', async () => {
    for (const mode of ['disabled', 'blocked']) {
      const privateContext = await browser.newContext({javaScriptEnabled: mode !== 'disabled'});
      if (mode === 'blocked') await privateContext.route('**/app.js', route => route.abort());
      const privatePage = await privateContext.newPage();
      await privatePage.goto(`${origin}/`);
      await privatePage.waitForLoadState('networkidle');
      if (workbench) await privatePage.locator('#raw-editor').evaluate(node => {node.open = true;});
      const requests = [];
      privatePage.on('request', request => requests.push(request.url()));
      const field = text ? '#request' : '#left';
      await privatePage.locator(field).fill('private-oracle-draft-9137');
      assert.equal(await privatePage.locator('#submit').isDisabled(), true);
      await statusShows(workbench ? view.statuses.initializing : text ? view.response_error : view.input_error, privatePage);
      await privatePage.locator('#application-form').evaluate(form => {
        HTMLFormElement.prototype.submit.call(form);
        form.requestSubmit();
      });
      await privatePage.waitForTimeout(100);
      assert.equal(privatePage.url(), `${origin}/`);
      assert.deepEqual(requests, [], 'draft must not navigate or enter any request');
      await privateContext.close();
    }
  });
  await journey('delayed-init', async () => {
    const delayed = await browser.newContext();
    let release;
    const pending = new Promise(resolve => {release = resolve;});
    const delayModule = async route => {await pending; await route.continue();};
    await delayed.route('**/app.js', delayModule);
    const delayedPage = await delayed.newPage();
    await delayedPage.goto(`${origin}/`, {waitUntil: 'commit'});
    await fill(recovery, delayedPage);
    assert.equal(await delayedPage.locator('#submit').isDisabled(), true);
    await statusShows(workbench ? view.statuses.initializing : text ? view.response_error : view.input_error, delayedPage);
    const before = [];
    delayedPage.on('request', request => {if (request.method() !== 'GET') before.push(request.url());});
    // The separate privacy cases force native submission. Here retain the
    // document and its still-loading module to witness input-before-ready.
    await delayedPage.waitForTimeout(100);
    assert.deepEqual(before, []);
    assert.equal(delayedPage.url(), `${origin}/`);
    release();
    await delayedPage.waitForLoadState('networkidle');
    // The initialization fault has finished. Do not leave global Chromium
    // Fetch interception active while validating actual intent responses.
    await delayed.unroute('**/app.js', delayModule);
    const retained = await delayedPage.evaluate(selector => document.querySelector(selector).value, text ? '#request' : '#left');
    const expectedInput = workbench ? frame(recovery).input : decode.decode(Uint8Array.from(recovery.request));
    assert.equal(retained, text ? expectedInput : expectedInput.split('\t')[2]);
    await submit(recovery, delayedPage, false, {fillInputs: false});
    await delayed.close();
  });
  await journey('intent-boundaries', async () => {
    const body = {version: 1, name: 'application.invoke', payload: decode.decode(Uint8Array.from(recovery.request))};
    const headers = {'content-type': 'application/json', origin};
    const request = (value, options = {}) => fetch(`${origin}/_hologram/intent`, {
      method: 'POST', headers, body: JSON.stringify(value), ...options,
    });
    for (const value of [{...body, extra: true}, {...body, version: 2}, {...body, name: 'host.exec'},
      {...body, payload: 'x'.repeat(65_537)}]) assert.equal((await request(value)).status, 400);
    assert.equal((await request(body, {headers: {...headers, origin: 'https://untrusted.invalid'}})).status, 403);
    assert.equal((await request(body, {headers: {'content-type': 'application/json'}})).status, 403);
    assert.equal((await request(body, {headers: {...headers, 'content-type': 'text/plain'}})).status, 415);
    assert.equal((await request(body, {body: 'x'.repeat(65_536 * 6 + 257)})).status, 413);
    assert.equal((await fetch(`${origin}/_hologram/intent`)).status, 405);
    assert.equal((await fetch(`${origin}/?draft=private`)).status, 400);
    assert.equal((await fetch(`${origin}/%2e%2e/secrets`)).status, 404);
    await submit(recovery);
  });
  if (text) {
    await journey('text-response-bounds', async () => {
      for (const [body, status] of [[Buffer.from([255]), 'compute_error'],
        [Buffer.from(JSON.stringify({version: 1, outputs: ['x'.repeat(app.response_maximum + 1)]})), 'response_error'],
        [Buffer.from(JSON.stringify({version: 1, outputs: []})), 'compute_error'],
        [Buffer.from('x'.repeat(app.response_maximum * 6 + 257)), 'compute_error']]) {
        await page.route('**/_hologram/intent', route => route.fulfill({status: 200, contentType: 'application/json', body}));
        await fill(recovery);
        await page.locator('#submit').click();
        await statusShows(workbench ? view.statuses[status] : view.response_error);
        await page.unroute('**/_hologram/intent');
        await submit(recovery);
      }
    });
    await journey('text-safe-rendering', async () => {
      // Renderer-boundary fault injection, not an application response oracle:
      // a non-echo guest need not return markup merely because its input did.
      const markup = '<img src=x onerror=alert(1)>🌱';
      const value = Buffer.byteLength(markup) <= app.response_maximum ? markup : '<b>'.slice(0, app.response_maximum);
      const responseValue = workbench ? JSON.stringify({...JSON.parse(decode.decode(Uint8Array.from(recovery.response))),
        message: value, response: value, details: [value]}) : value;
      await page.route('**/_hologram/intent', route => route.fulfill({status: 200,
        contentType: 'application/json', body: JSON.stringify({version: 1, outputs: [responseValue]})}));
      await fill(recovery);
      await page.locator('#submit').click();
      await shows(value);
      assert.equal(await output.locator('*').count(), 0);
      await page.unroute('**/_hologram/intent');
      await submit(recovery);
    });
  }
  if (workbench) {
    const framed = (request, response) => ({request: [...Buffer.from(request)], response: [...Buffer.from(response)]});
    const firstGuided = valid.find(({vector}) => frame(vector).operation)?.vector;
    assert.ok(firstGuided, 'workbench oracle requires an exact modeled guided example');
    await journey('workbench-guided-edit', async () => {
      const prepared = frame(firstGuided), operation = prepared.operation;
      await page.locator('#operation').selectOption(operation.id);
      const example = operation.examples[0];
      await page.locator('#example').selectOption(example.id);
      await page.locator('#load-example').click();
      for (const [index, field] of operation.fields.entries()) {
        assert.equal(await page.locator('#field-' + field.id).inputValue(), example.values[index]);
        assert.equal(await page.locator('#field-' + field.id).isDisabled(), false);
      }
      // This is a routing reference from the real upstream, not an additional
      // mathematical oracle. The registered product must independently check
      // its edited arithmetic against known results.
      const alternate = operation.examples.find(row => row.values.some((value, index) => value !== example.values[index]));
      const values = [...(alternate?.values ?? example.values)];
      const index = operation.fields.findIndex(field => field.choices.length === 0 || field.choices.some(choice => choice.value !== values[operation.fields.indexOf(field)]));
      if (index < 0) {
        // A closed single-choice model does not claim a second valid value.
        // Exercise its real invalid-selection boundary instead of inventing
        // a public requirement that every model contain editable text.
        const control = page.locator('#field-' + operation.fields[0].id), requests = [];
        const listener = request => {if (request.url() === `${origin}/_hologram/intent`) requests.push(request);};
        page.on('request', listener);
        try {
          await control.selectOption([]);
          await page.locator('#guided-submit').click();
          await statusShows(view.statuses.input_error);
          assert.equal(await control.inputValue(), '');
          assert.equal(await control.getAttribute('aria-invalid'), 'true');
          assert.deepEqual(requests, [], 'invalid choice must not dispatch an invented modeled value');
        } finally { page.off('request', listener); }
        await submit(recovery);
        return;
      }
      const field = operation.fields[index];
      if (!alternate) values[index] = field.choices.length ? field.choices.find(choice => choice.value !== values[index]).value
        : values[index] === '0' ? '1' : '0';
      const payload = operation.request_prefix + '\u001f' + values.join('\u001f');
      const reference = await fetch(`${origin}/_hologram/intent`, {method: 'POST', headers: {'content-type': 'application/json', origin},
        body: JSON.stringify({version: 1, name: 'application.invoke', payload})});
      assert.equal(reference.status, 200);
      const envelope = await reference.json();
      assert.equal(envelope.version, 1); assert.equal(envelope.outputs.length, 1);
      if (alternate) assert.equal(envelope.outputs[0], alternate.expected_response, 'edited modeled example must retain its exact upstream response');
      const edited = framed(payload, envelope.outputs[0]);
      await submit(edited);
      const structured = JSON.parse(envelope.outputs[0]);
      if (structured.status === 'ok' && structured.cells.length) {
        assert.deepEqual(await page.locator('#result-table tbody td').allTextContents(), structured.cells);
      }
      await submit(recovery);
    });
    await journey('workbench-typed-error-recovery', async () => {
      const negatives = valid.filter(({vector}) => JSON.parse(decode.decode(Uint8Array.from(vector.response))).status === 'error');
      const negative = (negatives.find(({vector}) => !frame(vector).operation) ?? negatives[0])?.vector;
      assert.ok(negative, 'typed workbench errors require a modeled negative UI vector');
      await submit(negative);
      const expected = JSON.parse(decode.decode(Uint8Array.from(negative.response)));
      const hint = view.errors.find(row => row.code === expected.error);
      assert.ok(hint, 'typed error must have source-owned assistance');
      const text = await page.locator('#result-error').innerText();
      for (const value of [hint.title, hint.explanation, hint.recovery]) assert.ok(text.includes(value));
      const prepared = frame(negative);
      const fields = prepared.operation ? hint.fields.filter(id => prepared.operation.fields.some(field => field.id === id))
        .map(id => '#field-' + id) : ['#request'];
      for (const selector of fields) {
        assert.equal(await page.locator(selector).getAttribute('aria-invalid'), 'true');
        assert.ok((await page.locator(selector).getAttribute('aria-describedby')).split(/\s+/).includes('result-error'));
      }
      if (fields.length) assert.equal(await page.locator(fields[0]).evaluate(node => document.activeElement === node), true);
      else for (const field of prepared.operation.fields) {
        assert.equal(await page.locator('#field-' + field.id).getAttribute('aria-invalid'), null,
          'a source-owned global error must not invent a field association');
      }
      await submit(recovery);
      assert.equal(await page.locator('#request').getAttribute('aria-invalid'), null);
    });
    async function delayedCompletion(target, action) {
      let release, arrived;
      const held = new Promise(resolve => {release = resolve;});
      const pending = new Promise(resolve => {arrived = resolve;});
      const handler = async route => {
        const upstream = await route.fetch();
        arrived();
        await held;
        try { await route.fulfill({response: upstream}); }
        catch { /* Logical cancellation may retire the browser fetch itself. */ }
      };
      await target.route('**/_hologram/intent', handler);
      try {
        await fill(recovery, target);
        const before = await target.locator('#request').inputValue();
        await target.locator('#submit').click();
        await bounded(pending);
        await statusShows(view.statuses.running, target);
        await action(target, before, release);
      } finally { release(); await target.unroute('**/_hologram/intent', handler); }
    }
    await journey('workbench-cancel-retirement', async () => {
      await delayedCompletion(page, async (target, before, release) => {
        await target.locator('#cancel').click();
        await statusShows(view.statuses.cancelled, target);
        assert.equal(await target.locator('#request').inputValue(), before);
        const displayed = await target.locator('#result').textContent();
        release(); await target.waitForTimeout(100);
        await statusShows(view.statuses.cancelled, target);
        assert.equal(await target.locator('#result').textContent(), displayed);
      });
      await submit(recovery);
    });
    await journey('workbench-timeout-retry', async () => {
      const timeoutPage = await context.newPage();
      try {
        await timeoutPage.clock.install();
        await timeoutPage.goto(`${origin}/`);
        await delayedCompletion(timeoutPage, async (target, before, release) => {
          await target.clock.fastForward(view.execution.timeout_milliseconds + 1);
          await statusShows(view.statuses.timeout, target);
          assert.equal(await target.locator('#request').inputValue(), before);
          const displayed = await target.locator('#result').textContent();
          release(); await target.waitForTimeout(100);
          await statusShows(view.statuses.timeout, target);
          assert.equal(await target.locator('#result').textContent(), displayed);
        });
        await submit(recovery, timeoutPage, false, {fillInputs: false, triggerSelector: '#retry'});
      } finally { await timeoutPage.close(); }
    });
    await journey('workbench-result-validation', async () => {
      const positive = JSON.parse(decode.decode(Uint8Array.from(recovery.response)));
      const invalid = [{...positive, unexpected: true}, {...positive, operation: 'unmodeled-operation'},
        {...positive, cells: [7]}, {...positive, rows: 1, columns: 2, cells: ['one']},
        {...positive, error: 'unmodeled-error'}, {...positive, status: 'unknown'},
        {...positive, details: Array(view.response.maximum_details + 1).fill('bounded')}];
      for (const value of invalid) {
        await page.route('**/_hologram/intent', route => route.fulfill({status: 200, contentType: 'application/json',
          body: JSON.stringify({version: 1, outputs: [JSON.stringify(value)]})}));
        await fill(recovery);
        await page.locator('#submit').click();
        await statusShows(view.statuses.response_error);
        await page.unroute('**/_hologram/intent');
        await submit(recovery);
      }
    });
  }
  process.stdout.write(`${JSON.stringify({stage: 'live'})}\n`);
  const stopped = await input.next();
  assert.equal(stopped.done, false);
  assert.deepEqual(JSON.parse(stopped.value), {stage: 'stopped'});
  await journey('detached-session', async () => {
    await fill(recovery);
    const pending = page.waitForResponse(response => response.url() === `${origin}/_hologram/intent`);
    await page.locator('#submit').click();
    assert.equal((await pending).status(), 410);
    await statusShows(workbench ? view.statuses.compute_error : text ? view.response_error : view.input_error);
    assert.equal((await fetch(`${origin}/app.js`)).status, 410);
  });
  assert.deepEqual(unexpected, []);
  process.stdout.write(`${JSON.stringify({schema: 'prismpm/portable-browser-oracle/1', profile,
    engine: browser.browserType().name(), browser_version: browser.version(), playwright: '1.62.1', cases, vector_indexes: vectorIndexes,
    ...(workbench ? {direct_vector_indexes: directVectorIndexes, ui_transport_rejected_indexes: transportRejectedIndexes,
      textarea_normalized_vector_indexes: textareaNormalizedIndexes, unrepresentable_frame_vector_indexes: unrepresentableFrameIndexes} : {}),
    skipped: 0, retries: 0, status: 'passed'})}\n`);
} catch (error) {
  primaryFailure = sanitizedFailure(error, 'session');
} finally {
  let cleanupFailure;
  let firstBrowserCleanupFailure;
  const failedCleanup = (error, resource) => {
    cleanupFailure ??= sanitizedFailure(error, 'cleanup');
    emitDiagnostic({schema: 'prismpm/browser-cleanup-diagnostic/1',
      resource, failure: failureKind(error)});
  };
  try {
    diagnosticCleanup.beginClose();
    await bounded((async () => {
      const ownCleanup = operation => Promise.resolve().then(operation).catch(error => {
        firstBrowserCleanupFailure ??= error;
        throw error;
      });
      const outcomes = await Promise.allSettled([ownCleanup(() => diagnosticCleanup.join()),
        ownCleanup(() => browser ? diagnosticCleanup.closeBrowser(browser) : Promise.resolve())]);
      for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
      diagnosticCleanup.check();
    })());
  }
  catch (error) { failedCleanup(firstBrowserCleanupFailure ?? error, 'browser'); }
  try { process.stdin.destroy(); }
  catch (error) { failedCleanup(error, 'stdin'); }
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;
}
