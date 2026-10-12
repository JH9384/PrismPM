// Supplemental oracle-boundary probes. Run each case in its own bounded
// devcontainer; the real upstream executor and generated artifact are retained.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {requireBoundaryCheck, requireRequestCompletion, applyNegativeControl, duplicateInjection, duplicateOwnedDriver, requireDuplicateWitness} from './portable-oracle-custody.mjs';

const [oracle, artifactDirectory, browser, name, evidenceDirectory, trigger = 'click', control = 'none', ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0);
assert.ok(oracle && artifactDirectory && browser && name && evidenceDirectory,
  'usage: probe ORACLE ARTIFACT_DIRECTORY BROWSER CASE NEW_EVIDENCE_DIRECTORY [click|keyboard]');
const matrixPath = fileURLToPath(new URL('../tests/data/portable-oracle-matrix.json', import.meta.url));
const matrix = JSON.parse(readFileSync(matrixPath));
assert.equal(matrix.schema, 'prismpm/portable-oracle-matrix/1');
assert(matrix.triggers.includes(trigger), 'closed trigger required');
assert(['none', 'wrong-status', 'noop', 'omit-finished', 'malformed-finished'].includes(control), 'closed negative control required');
if (control !== 'none') assert.equal(name, 'wrong-response', 'negative controls qualify response probe only');
assert([...matrix.interaction_cases, ...matrix.infrastructure_cases].includes(name), 'closed case required');
if (matrix.infrastructure_cases.includes(name)) assert.equal(trigger, 'click', 'infrastructure probes do not claim keyboard execution');
const sourcePath = fileURLToPath(new URL('../crates/prismpm/src/embedded/hologram-oracle.browser.mjs', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const marker = "  await journey('modeled-vectors', async () => {";
assert.equal(source.split(marker).length, 2, 'probe insertion point must be unique');
const injections = {
  positive: '',
  'delayed-completion': `await page.evaluate(() => {
    const form = document.querySelector('#application-form');
    const original = form.removeAttribute.bind(form);
    window.probeCompletions = 0;
    let pending = false;
    let scheduled = false;
    form.addEventListener('submit', () => {
      pending = true;
      form.setAttribute('aria-busy', 'true');
    }, {capture: true});
    form.removeAttribute = name => {
      if (name !== 'aria-busy' || !pending) return original(name);
    };
    new MutationObserver(() => {
      if (!pending || scheduled) return;
      scheduled = true;
      setTimeout(() => {
        pending = false;
        scheduled = false;
        original('aria-busy');
        window.probeCompletions++;
      }, 250);
    }).observe(document.querySelector('#result'), {childList: true, characterData: true, subtree: true});
  });`,
  'stuck-busy': `await page.evaluate(() => {
    const form = document.querySelector('#application-form');
    const original = form.removeAttribute.bind(form);
    form.addEventListener('submit', () => form.setAttribute('aria-busy', 'true'), {capture: true});
    form.removeAttribute = name => {if (name !== 'aria-busy') original(name);};
  });`,
  'missing-control': "await page.locator('#submit').evaluate(button => button.remove());",
  'body-unavailable': '',
  'method-rewrite': "await page.route('**/_hologram/intent', route => route.continue({method: 'GET'}));",
  'wrong-response': `await page.route('**/_hologram/intent', route => route.fulfill({status: 200,
    contentType: 'application/json', body: JSON.stringify({version: 1, outputs: ['private-oracle-response-71943']})}));`,
  'fill-failure': `let draft = 'private-oracle-draft-71943';
    if (!text) {const fields = decode.decode(Uint8Array.from(valid[0].vector.request)).split('\\t'); fields[2] = draft; draft = fields.join('\\t');}
    valid[0].vector.request = Array.from(new TextEncoder().encode(draft));
    await page.locator(text ? '#request' : '#left').evaluate(field => field.remove());`,
  'private-method': `await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (url, options) => original(url, {...options, method: 'private-oracle-draft-71943'});
  });`,
  // Infrastructure fault, not a replacement application or response oracle.
  'pretend-body-failure': `fill = async () => {
    throw new Error('response.body: Protocol error (Network.getResponseBody): No data found for resource with given identifier');
  };`,
  'body-plus-cleanup': `const close = browser.close.bind(browser);
    browser.close = async () => {await close(); throw new Error('private-oracle-draft-71943');};`,
  'cleanup-failure': `const close = browser.close.bind(browser);
    browser.close = async () => {await close(); throw new Error('private-oracle-draft-71943');};`,
  'setup-failure': '',
  'wrong-method': `await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (url, options) => original(url, {...options, method: 'GET', body: undefined});
  });`,
  'wrong-payload': `await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (url, options) => original(url, {...options, body:
      JSON.stringify({version: 1, name: 'application.invoke', payload: 'oracle-corrupted-payload'})});
  });`,
  duplicate: duplicateInjection(),
  navigation: `await page.evaluate(() => document.querySelector('#application-form').addEventListener('submit', () => {
    location.assign('/index.html');
  }));`,
  'trigger-failure': '',
  'delayed-duplicate': '',
  'delayed-wrong-response': '',
  'delayed-stuck-busy': '',
};
assert.ok(Object.hasOwn(injections, name), 'unknown probe case');
const artifactRoot = resolve(artifactDirectory);
const modelPath = join(artifactRoot, 'model.prism.json');
const modelBytes = readFileSync(modelPath);
const model = JSON.parse(modelBytes);
const fixture = matrix.profiles.find(profile => profile.name === model.application.name);
assert(fixture, 'registered complete application fixture required');
assert.equal(model.application.cargo_name, fixture.cargo_name);
assert.equal(model.application.profile, fixture.profile === 'utf8-text' ? 'prismpm/text-application/1' : undefined);
const archive = join(artifactRoot, fixture.name + '.holo');
const wasm = join(artifactRoot, 'core-wasm', fixture.cargo_name.replaceAll('-', '_') + '_core_wasm.wasm');
const evidence = resolve(evidenceDirectory);
mkdirSync(evidence);
const driver = join(evidence, 'driver.mjs');
let driverBytes = name === 'positive' ? source : source.replace(marker, `${marker}\n    ${injections[name]}\n`);
driverBytes = applyNegativeControl(driverBytes, source, injections['wrong-response'], control);
if (name === 'setup-failure') {
  const setup = 'const input = createInterface';
  assert.equal(source.split(setup).length, 2);
  driverBytes = driverBytes.replace(setup, `throw new Error('private-oracle-draft-71943');\n${setup}`);
}
if (name === 'trigger-failure') {
  const point = '    const trigger = keyboard';
  assert.equal(source.split(point).length, 2);
  driverBytes = driverBytes.replace(point, `    await target.locator(keyboard ? (text ? '#request' : '#right') : '#submit').evaluate(element => element.remove());\n${point}`);
}
if (['delayed-duplicate', 'delayed-wrong-response', 'delayed-stuck-busy'].includes(name)) {
  const point = '    await submit(recovery, delayedPage, false, {fillInputs: false});';
  assert.equal(source.split(point).length, 2);
  const injection = name === 'delayed-duplicate' ? duplicateInjection('delayedPage')
    : injections[name.slice('delayed-'.length)].replaceAll('await page.', 'await delayedPage.');
  driverBytes = driverBytes.replace(point, `    ${injection}\n${point}`);
}
if (name === 'delayed-completion') {
  const submit = '      await submit(vector);';
  assert.equal(source.split(submit).length, 2);
  driverBytes = driverBytes.replace(submit, `
      const completedBefore = await page.evaluate(() => window.probeCompletions);
      await submit(vector);
      assert.equal(await page.evaluate(() => window.probeCompletions), completedBefore + 1,
        'submission returned before delayed completion');`);
  const keyboard = '    await submit(recovery, page, true);';
  assert.equal(source.split(keyboard).length, 2);
  driverBytes = driverBytes.replace(keyboard, `
    const keyboardBefore = await page.evaluate(() => window.probeCompletions);
    await submit(recovery, page, true);
    assert.equal(await page.evaluate(() => window.probeCompletions), keyboardBefore + 1,
      'keyboard submission returned before delayed completion');`);
}
if (trigger === 'keyboard') {
  assert.equal(driverBytes.split('await submit(vector);').length, 2);
  driverBytes = driverBytes.replace('await submit(vector);', 'await submit(vector, page, true);');
  driverBytes = driverBytes.replace('await submit(recovery, delayedPage, false, {fillInputs: false});',
    'await submit(recovery, delayedPage, true, {fillInputs: false});');
}
if (name === 'body-unavailable' || name === 'body-plus-cleanup') {
  const point = '      try { replyBody = await bounded(reply.body()); }';
  assert.equal(driverBytes.split(point).length, 2);
  // Close the actual browser target after correlated headers, then exercise
  // Playwright's real body read. No fabricated exception is body evidence.
  driverBytes = driverBytes.replace(point, `      await target.close();\n${point}`);
}
if (name === 'duplicate' || name === 'delayed-duplicate') driverBytes = duplicateOwnedDriver(driverBytes);
writeFileSync(driver, driverBytes, {flag: 'wx'});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const subjects = {source: sourcePath, matrix: matrixPath, driver, oracle, model: modelPath, archive, wasm,
  node: process.execPath, browser};
const identities = () => Object.fromEntries(Object.entries(subjects).map(([key, path]) =>
  [`${key}_sha256`, sha(readFileSync(path))]));
const before = identities();
const result = spawnSync(resolve(oracle), [archive, modelPath, wasm, driver, process.execPath, resolve(browser)], {
  timeout: 120_000, maxBuffer: 1_048_576, encoding: 'utf8',
});
writeFileSync(join(evidence, 'stdout.txt'), result.stdout ?? '', {flag: 'wx'});
writeFileSync(join(evidence, 'stderr.txt'), result.stderr ?? '', {flag: 'wx'});
const diagnostics = (result.stderr ?? '').split('\n').flatMap(line => {
  try { const value = JSON.parse(line); return ['prismpm/browser-submission-diagnostic/1', 'prismpm/browser-submission-diagnostic/2'].includes(value.schema) ? [value] : []; }
  catch { return []; }
});
const cleanupDiagnostics = (result.stderr ?? '').split('\n').flatMap(line => {
  try { const value = JSON.parse(line); return value.schema === 'prismpm/browser-cleanup-diagnostic/1' ? [value] : []; }
  catch { return []; }
});
const duplicateDiagnostics = (result.stderr ?? '').split('\n').flatMap(line => {
  try { const value = JSON.parse(line); return value.schema === 'prismpm/duplicate-control/1' ? [value] : []; }
  catch { return []; }
});
let accepted = false;
let failure;
let failureCode;
try {
  assert.equal(result.error, undefined, 'spawn, timeout or output-limit failure is not oracle evidence');
  assert.equal(result.signal, null, 'signal termination is not oracle evidence');
  assert.deepEqual(identities(), before, 'probe inputs changed during execution');
  if (name === 'duplicate' || name === 'delayed-duplicate') {
    assert.equal(duplicateDiagnostics.length, 1, 'actual duplicate response owner required');
    requireDuplicateWitness(duplicateDiagnostics[0], model.application.response_maximum * 6 + 256);
  } else assert.deepEqual(duplicateDiagnostics, []);
  if (name === 'positive' || name === 'delayed-completion') {
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.schema, 'prismpm/hologram-oracle/2');
    assert.equal(report.portable_browser.status, 'passed');
    assert.equal(report.portable_browser.retries, 0);
    assert.equal(report.portable_browser.skipped, 0);
    assert.deepEqual(report.portable_browser.cases.map(row => row.name), fixture.journeys);
    assert.deepEqual(report.portable_browser.vector_indexes, fixture.vector_indexes);
    assert.equal(report.portable_browser.profile, fixture.profile);
    assert.equal(report.portable_browser.browser_version, '157.0.8099.0');
    assert.equal(report.portable_browser.playwright, '1.62.1');
    assert.ok(report.portable_browser.cases.every(row => row.status === 'passed' && row.attempts === 1));
    assert.equal(diagnostics.length, 0);
  } else {
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.includes('private-oracle-response-71943'), false, 'response must not leak through diagnostics');
    assert.equal(result.stderr.includes('private-oracle-draft-71943'), false, 'draft must not leak through diagnostics');
    if (name === 'cleanup-failure' || name === 'body-plus-cleanup') {
      assert.deepEqual(cleanupDiagnostics, [{schema: 'prismpm/browser-cleanup-diagnostic/1', resource: 'browser', failure: 'unexpected'}]);
    } else assert.deepEqual(cleanupDiagnostics, []);
    if (name === 'setup-failure' || name === 'cleanup-failure') {
      assert.equal(diagnostics.length, 0);
      assert.match(result.stderr, name === 'setup-failure'
        ? /portable View oracle session: unexpected/ : /portable View oracle cleanup: unexpected/);
    } else {
    assert.equal(diagnostics.length, 1, 'require the actual submission diagnostic, not an unrelated crash');
    const diagnostic = diagnostics[0];
    assert(fixture.journeys.includes(diagnostic.journey), 'failure must identify an actual owning journey');
    assert(Number.isInteger(diagnostic.vectorIndex) && fixture.vector_indexes.includes(diagnostic.vectorIndex),
      'failure must identify an actual modeled vector without disclosing its payload');
    for (const event of diagnostic.events.filter(event => event.event === 'request-failed')) {
      assert.deepEqual(Object.keys(event).sort(), ['event', 'invocation', 'reason']);
      assert(['ERR_ABORTED', 'ERR_FAILED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED',
        'ERR_CONTENT_LENGTH_MISMATCH', 'ERR_INCOMPLETE_CHUNKED_ENCODING', 'ERR_INSUFFICIENT_RESOURCES',
        'ERR_TIMED_OUT', 'ERR_BLOCKED_BY_CLIENT', 'ERR_BLOCKED_BY_RESPONSE', 'unavailable', 'other'].includes(event.reason));
    }
    assert(['observed', 'closed', 'unavailable'].includes(diagnostic.client?.state));
    if (diagnostic.client.state === 'observed') {
      assert.deepEqual(Object.keys(diagnostic.client).sort(),
        ['busy', 'disabled', 'expectedResult', 'outputPresent', 'responseError', 'state']);
      for (const [key, value] of Object.entries(diagnostic.client)) {
        if (key !== 'state') assert.equal(typeof value, 'boolean');
      }
    } else assert.deepEqual(Object.keys(diagnostic.client), ['state']);
    if (name === 'body-unavailable' || name === 'body-plus-cleanup') {
      assert.equal(diagnostic.client.state, 'closed');
      assert(diagnostic.events.some(event => event.event === 'page-close'));
    }
    requireBoundaryCheck(name, diagnostic);
    requireRequestCompletion(name, diagnostic);
    assert.equal(diagnostic.keyboard, trigger === 'keyboard');
    if (name === 'pretend-body-failure') {
      assert.equal(diagnostic.failure, 'unexpected');
      assert.equal(diagnostic.phase, 'fill');
      assert.equal(diagnostic.invocationCount, 0);
      assert.equal(result.stderr.includes('Network.getResponseBody'), false, 'unobserved body failure must not be attributed');
    } else if (name === 'wrong-response' || name === 'delayed-wrong-response') {
      assert.equal(diagnostic.failure, 'assertion');
      assert.equal(diagnostic.phase, 'response-body');
      assert.equal(diagnostic.invocationCount, 1);
      assert.equal(diagnostic.navigated, false);
      assert.equal(diagnostic.events.filter(event => event.event === 'body').length, 1);
    } else if (name === 'fill-failure') {
      assert.equal(diagnostic.failure, 'timeout');
      assert.equal(diagnostic.phase, 'fill');
      assert.equal(diagnostic.invocationCount, 0);
      assert.equal(diagnostic.navigated, false);
    } else if (name === 'missing-control') {
      assert.equal(diagnostic.failure, 'timeout');
      assert.equal(diagnostic.phase, 'initial-readiness');
      assert.equal(diagnostic.invocationCount, 0);
    } else if (name === 'trigger-failure') {
      assert.equal(diagnostic.failure, 'timeout');
      assert.equal(diagnostic.phase, 'submission');
      assert.equal(diagnostic.invocationCount, 0);
    } else if (name === 'duplicate' || name === 'delayed-duplicate') {
      assert.equal(diagnostic.invocationCount, 2);
      assert.equal(diagnostic.failure, 'assertion');
    } else if (name === 'navigation') {
      assert.equal(diagnostic.navigated, true);
    } else if (name === 'stuck-busy' || name === 'delayed-stuck-busy') {
      assert.equal(diagnostic.phase, 'completed-readiness');
      assert.equal(diagnostic.invocationCount, 1);
      assert.equal(diagnostic.navigated, false);
      assert.equal(diagnostic.failure, 'timeout');
    } else {
      assert.equal(diagnostic.invocationCount, 1);
      assert.equal(diagnostic.navigated, false);
      const responses = diagnostic.events.filter(event => event.event === 'response');
      if (name === 'body-unavailable' || name === 'body-plus-cleanup') {
        assert.equal(diagnostic.phase, 'response-body');
        assert.equal(responses.length, 1);
        assert.equal(responses[0].status, 200);
        assert.equal(diagnostic.failure, 'response-body-failed');
        assert.equal(diagnostic.events.some(event => event.event === 'body'), false);
      } else if (name === 'method-rewrite') {
        assert.equal(diagnostic.phase, 'response-body');
        assert.equal(responses.length, 1);
        assert.equal(responses[0].status, 405);
        if (diagnostic.failure === 'response-body-unavailable') {
          assert.match(result.stderr, /Network\.getResponseBody.*No data found for resource/);
          assert.equal(diagnostic.events.some(event => event.event === 'body'), false);
        } else {
          assert.equal(diagnostic.failure, 'assertion');
          assert.equal(diagnostic.check, 'response-status');
          assert.equal(diagnostic.events.filter(event => event.event === 'body').length, 1);
        }
      } else {
        assert.equal(diagnostic.phase, 'submission');
        assert.equal(responses.length, 0, 'mismatched request must not satisfy response correlation');
        const requests = diagnostic.events.filter(event => event.event === 'request');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].method, name === 'wrong-method' ? 'GET' : name === 'private-method' ? 'OTHER' : 'POST');
        assert.equal(diagnostic.failure, 'timeout');
      }
    }
    }
  }
  accepted = true;
} catch (error) {
  failure = String(error);
  failureCode = ['PORTABLE_WRONG_CHECK', 'PORTABLE_REQUEST_COMPLETION'].includes(error?.code) ? error.code : 'PROBE_ASSERTION';
}
const receipt = {schema: 'prismpm/portable-oracle-probe/1', case: name, profile: fixture.profile, trigger, control,
  scope: matrix.infrastructure_cases.includes(name) ? 'infrastructure-fault' : 'interaction-boundary',
  ...before, node_version: process.version,
  exit_code: result.status, signal: result.signal, diagnostics, cleanup_diagnostics: cleanupDiagnostics,
  probe_passed: accepted, product_acceptance: 'not-established',
  ...(duplicateDiagnostics.length ? {duplicate_control: duplicateDiagnostics} : {}),
  ...(failure ? {failure, failure_code: failureCode} : {})};
writeFileSync(join(evidence, 'result.json'), `${JSON.stringify(receipt)}\n`, {flag: 'wx'});
console.log(JSON.stringify(receipt));
if (!accepted) process.exitCode = 1;
