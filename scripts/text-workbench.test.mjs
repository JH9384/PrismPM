// SDK component tests execute the actual generic runtime in a pinned browser.
// The isolated echo binding below tests transport ownership, never domain math.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import test, {before, after} from 'node:test';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const template = read('crates/prismpm/src/workbench/runtime.js');
const fixture = JSON.parse(read('tests/data/workbench-model-document.json')).application;
const require = createRequire('/opt/prismpm/oracles/package.json');
const {chromium} = require('playwright');
const executablePath = process.arch === 'arm64'
  ? '/ms-playwright/chromium_headless_shell-cft-157.0.8099.0/chrome-headless-shell-linux-arm64/chrome-headless-shell'
  : '/ms-playwright/chromium_headless_shell-cft-157.0.8099.0/chrome-headless-shell-linux64/chrome-headless-shell';
const copy = value => JSON.parse(JSON.stringify(value));
const US = '\u001f';
let browser;
before(async () => {
  assert.equal(require('playwright/package.json').version, '1.62.1');
  browser = await chromium.launch({headless: true, executablePath});
  assert.equal(browser.version(), '157.0.8099.0');
});
after(async () => {await browser?.close();});

function viewData() {
  const view = copy(fixture.workbench);
  view.execution.timeout_milliseconds = 1000;
  return view;
}
function runtime(view = viewData(), source = template, transport = 'browser', outputLimit = 16384) {
  return source.replace('__VIEW__', JSON.stringify(view)).replace('__INPUT_LIMIT__', '4096')
    .replace('__OUTPUT_LIMIT__', String(outputLimit)).replace('__BINDING__', '"./binding.js"').replace('__TRANSPORT__', JSON.stringify(transport));
}
function reply(value = 'HELLO', operation = 'echo') {
  return {version: 1, status: 'ok', operation, message: 'Computed by the isolated transport fixture.', rows: 1, columns: 1,
    cells: [value], details: ['An actual byte binding produced this result.'], request: value.toLowerCase(), response: value, error: ''};
}
async function parser(view = viewData(), source = template, outputLimit = 16384) {
  return (await import('data:text/javascript;base64,' + Buffer.from(runtime(view, source, 'browser', outputLimit)).toString('base64'))).parseResult;
}

// Each Worker imports a separate real module. Its load number lets one failed
// owner be replaced with a working owner without altering the application JS.
function bindingSource(load, configuration) {
  return `const CONFIG=${JSON.stringify(configuration)};const LOAD=${load};
const decode=new TextDecoder('utf-8',{fatal:true});const encode=new TextEncoder();
export default async function(){const delay=CONFIG.delayFirst&&LOAD===1?CONFIG.delayFirst:CONFIG.delay;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));}
export function invoke_bytes(bytes){
 const text=decode.decode(bytes);const split=text.indexOf('\\u001f');const prefix=text.slice(0,split);const input=text.slice(split+1);
 if(input==='throw')throw new Error('private fixture failure');
 if(input==='bad-json')return encode.encode('{private malformed result');
 if(input==='bad-utf8')return Uint8Array.of(255);
 if(input==='over-limit')return new Uint8Array(16385);
 if(input==='wrong-operation')return encode.encode(JSON.stringify({version:1,status:'ok',operation:'wrong',message:'bad',rows:1,columns:1,cells:['wrong'],details:[],request:input,response:'wrong',error:''}));
 if(input==='slow'||(CONFIG.holdFirst&&LOAD===1)){const stop=performance.now()+(input==='slow'?450:30000);while(performance.now()<stop){}}
 const operation=prefix==='ui-raw-v1'?'raw':'echo';
 const value=input.toUpperCase();
 const zero={'zero-0x3':[0,3],'zero-2x0':[2,0],'zero-0x0':[0,0]}[input];
 const answer={version:1,status:input==='invalid'?'error':'ok',operation,message:'Computed by the isolated transport fixture.',rows:zero?zero[0]:input==='invalid'?0:1,columns:zero?zero[1]:input==='invalid'?0:1,cells:zero||input==='invalid'?[]:[value],details:[],request:input,response:value,error:input==='invalid'?'invalid':''};
 return encode.encode(JSON.stringify(answer));
}`;
}
async function withPage(run, {source = template, view = viewData(), delayScript = 0, draft = 'hello', failFirstLoad = false, transport = 'browser', hologram, ...configuration} = {}) {
  const requests = [], invocations = [];let loads = 0;
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="form-action \'none\'"><title>SDK component</title></head>'
    + '<body><details id="raw-editor"><summary>Raw input</summary><form id="application-form"><textarea id="request"></textarea><button id="submit" disabled>Wait</button></form></details><script type="module" src="/app.js"></script></body></html>';
  const server = createServer(async (request, response) => {
    requests.push(request.url);
    response.setHeader('cache-control', 'no-store');
    if (request.url === '/app.js') {
      if (delayScript) await new Promise(resolve => setTimeout(resolve, delayScript));
      response.setHeader('content-type', 'text/javascript');response.end(runtime(view, source, transport));
    } else if (request.url === '/binding.js') {
      const load = ++loads;
      if (failFirstLoad && load === 1) {response.statusCode = 503;response.end('unavailable');}
      else {response.setHeader('content-type', 'text/javascript');response.end(bindingSource(load, configuration));}
    } else if (request.url === '/_hologram/intent') {
      let body = '';for await (const chunk of request) body += chunk;
      const invocation = JSON.parse(body);invocations.push(invocation);
      response.setHeader('content-type', 'application/json');await hologram(invocation, response, invocations.length);
    } else if (request.url === '/') {response.setHeader('content-type', 'text/html');response.end(html);}
    else {response.statusCode = 404;response.end('not found');}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext();const page = await context.newPage();const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(({draft}) => {
    window.__workers = [];window.__beats = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);const record = {url: String(url), options, terminated: 0, messages: [], posts: [], worker: this};
        window.__workers.push(record);this.__record = record;
        this.addEventListener('message', event => {record.messages.push(event.data);});
      }
      postMessage(message, transfer) {this.__record.posts.push({type: message.type, generation: message.generation, input: Array.from(message.input ?? [])});return super.postMessage(message, transfer);}
      terminate() {this.__record.terminated++;return super.terminate();}
    };
    const interval = setInterval(() => window.__beats.push(performance.now()), 10);
    window.addEventListener('pagehide', () => clearInterval(interval), {once: true});
    new MutationObserver(() => {const node = document.querySelector('#request');if (node && !window.__draftInstalled) {node.value = draft;window.__draftInstalled = true;}}).observe(document, {subtree: true, childList: true});
  }, {draft});
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil: 'commit'});
    await run({page, context, requests, invocations, getLoads: () => loads});
    assert.deepEqual(errors, [], 'actual runtime must have no uncaught page errors');
  } finally {
    await context.close();server.closeAllConnections();await new Promise(resolve => server.close(resolve));
  }
}
const state = (page, value) => page.waitForFunction(value => document.querySelector('#status')?.dataset.state === value, value);
const enabled = page => page.waitForFunction(() => document.querySelector('#guided-submit')?.disabled === false);
async function submit(page, value) {
  await page.locator('#field-message').fill(value);
  await page.locator('#guided-submit').click();
}
async function rawSubmit(page, value) {
  await page.locator('#raw-editor').evaluate(node => {node.open = true;});
  await page.locator('#request').fill(value);await page.locator('#submit').click();
}
async function expectCell(page, value) {
  await page.waitForFunction(value => document.querySelector('#result-table td')?.textContent === value, value);
  assert.equal(await page.locator('#result').textContent(), value);
}

// Closed-result tests execute the exported parser, rather than a copy of it.
test('text_v3_workbench strict result parser accepts exact Unicode and refuses malformed closed results', async () => {
  const parse = await parser();const good = reply('🌱 <safe>');
  assert.deepEqual({...parse(JSON.stringify(good), 'echo')}, good);
  const empty = {...good, rows: 0, columns: 3, cells: []};assert.equal(parse(JSON.stringify(empty), 'echo').cells.length, 0);
  const failed = {...good, status: 'error', rows: 0, columns: 0, cells: [], error: 'invalid'};
  assert.equal(parse(JSON.stringify(failed), 'echo').error, 'invalid');
  const invalid = [
    {...good, extra: true}, {...good, version: 2}, {...good, operation: 'raw'}, {...good, rows: 2}, {...good, columns: -1},
    {...good, rows: 1.5}, {...good, rows: Number.MAX_SAFE_INTEGER + 1}, {...good, cells: [true]}, {...good, cells: ['']},
    {...good, cells: ['line\nbreak']}, {...good, cells: Array(65).fill('x')}, {...good, details: Array(17).fill('x')},
    {...good, message: ''}, {...good, message: '\u0001'}, {...good, message: '\ud800'}, {...good, request: '\udfff'},
    {...good, response: '\ud800'}, {...good, error: 'invalid'}, {...failed, error: 'unregistered'}, {...failed, rows: 1, columns: 1, cells: ['x']},
  ];
  for (const value of invalid) assert.throws(() => parse(JSON.stringify(value), 'echo'));
  for (const field of Object.keys(good)) {const changed = {...good};delete changed[field];assert.throws(() => parse(JSON.stringify(changed), 'echo'));}
  const encoded = JSON.stringify(good);
  for (const changed of [encoded.replace('{', '{"version":1,'), encoded.replace('{', '{"ver\\u0073ion":1,'), encoded + 'x', encoded.slice(0, -1) + ',}',
    encoded.replace('"rows":1', '"rows":01'), encoded.replace('"rows":1', '"rows":1e0'), encoded.replace('"rows":1', '"rows":-0'),
    encoded.replace('"rows":1', '"rows":null'), encoded.replace('"message":', '"message":true,"unused":'), ' '.repeat(16385) + encoded])
    assert.throws(() => parse(changed, 'echo'));
  const roomy = await parser(viewData(), template, 262144);
  for (const field of ['message', 'cells', 'details']) {
    for (const text of ['x'.repeat(16384), '🌱'.repeat(4096)]) {
      const boundary = {...good, [field]: field === 'message' ? text : [text]};
      assert.equal(Buffer.byteLength(text), 16384);
      assert.deepEqual({...roomy(JSON.stringify(boundary), 'echo')}, boundary, `${field} must admit exactly 16 KiB of UTF-8 text`);
    }
    for (const text of ['x'.repeat(16385), '🌱'.repeat(4096) + 'x']) {
      const over = {...good, [field]: field === 'message' ? text : [text]};
      assert.equal(Buffer.byteLength(text), 16385);
      assert.throws(() => roomy(JSON.stringify(over), 'echo'), `${field} must reject text beyond 16 KiB even inside a larger response`);
    }
  }
});

test('text_v3_workbench strict-result negative control rejects a last-key-wins parser', async () => {
  const end = template.indexOf('\nasync function boundedEnvelope');assert(end > 0);
  const changed = template.slice(0, template.indexOf('export function parseResult'))
    + 'export function parseResult(text,operation){return JSON.parse(text);}\n' + template.slice(end);
  const probe = async source => {const parse = await parser(viewData(), source);assert.throws(() => parse(JSON.stringify(reply()).replace('{', '{"version":1,'), 'echo'));};
  await probe(template);await assert.rejects(probe(changed), assert.AssertionError);
});

test('text_v3_workbench actual worker computes changed inputs, presents source labels safely and recovers typed failures', async () => {
  const view = viewData();view.heading = '<img id="unsafe-heading" src="/leak">';view.operations[0].fields[0].label = 'Exact message 🌱';
  await withPage(async ({page, requests}) => {
    await enabled(page);assert.equal(await page.locator('h1').textContent(), view.heading);assert.equal(await page.locator('#unsafe-heading').count(), 0);
    assert.equal(await page.locator('#status').getAttribute('role'), 'status');assert.equal(await page.locator('#status').getAttribute('aria-live'), 'polite');assert.equal(await page.locator('#status').getAttribute('aria-atomic'), 'true');
    assert.equal(await page.locator('#skip-to-workbench').getAttribute('href'), '#workbench-main');assert.equal(await page.locator('#workbench-main').getAttribute('tabindex'), '-1');
    assert.equal(await page.locator('#field-message').getAttribute('aria-describedby'), 'field-message-help');
    await page.getByLabel('Exact message 🌱', {exact: true}).fill('changed input');await page.locator('#guided-submit').click();await expectCell(page, 'CHANGED INPUT');
    assert.equal(await page.locator('#expected-response-json').textContent(), '', 'editing clears the example evidence');
    await submit(page, '<img id="unsafe-result" src="/leak">');await expectCell(page, '<IMG ID="UNSAFE-RESULT" SRC="/LEAK">');
    assert.equal(await page.locator('#unsafe-result').count(), 0);assert(!requests.some(url => /leak/i.test(url)));
    await submit(page, 'invalid');await state(page, 'ready');
    assert.equal(await page.locator('#result-error h3').textContent(), view.errors[0].title);
    assert.equal(await page.locator('#field-message').getAttribute('aria-invalid'), 'true');
    assert((await page.locator('#field-message').getAttribute('aria-describedby')).includes('result-error'));
    assert.equal(await page.locator('#field-message').evaluate(node => node === document.activeElement), true);
    await submit(page, 'recovered');await expectCell(page, 'RECOVERED');assert.equal(await page.locator('#field-message').getAttribute('aria-invalid'), null);
    const workers = await page.evaluate(() => window.__workers.map(record => ({url: record.url, options: record.options, posts: record.posts.length})));
    assert.equal(workers.length, 1);assert(workers[0].url.endsWith('/app.js'));assert.equal(workers[0].options.type, 'module');assert.equal(workers[0].posts, 4);
  }, {view});
});

async function responsivenessProbe(source) {
  await withPage(async ({page}) => {
    await enabled(page);await page.waitForTimeout(40);
    await page.evaluate(() => {window.__beats = [performance.now()];});await submit(page, 'slow');await expectCell(page, 'SLOW');
    const beats = await page.evaluate(() => [...window.__beats, performance.now()]);
    assert(beats.length >= 12, 'main-thread heartbeat must continue while the byte guest runs');
    assert(Math.max(...beats.slice(1).map((value, index) => value - beats[index])) < 250, 'byte execution must not block the main event loop');
  }, {source});
}
test('text_v3_workbench worker keeps the event loop responsive and detects a synchronous transport defect', async () => {
  await responsivenessProbe(template);
  const original = "worker.postMessage({type:'invoke',generation:token,input:bytes},[bytes.buffer]);";
  assert.equal(template.split(original).length, 2);
  const changed = template.replace(original, "void import(BINDING).then(binding=>complete(decoder.decode(binding.invoke_bytes(bytes)),token));");
  await assert.rejects(responsivenessProbe(changed), error => error instanceof assert.AssertionError);
});

test('text_v3_workbench cancel retires the busy worker, preserves draft and retries through a new owner', async () => {
  await withPage(async ({page, getLoads}) => {
    await enabled(page);await submit(page, 'retained draft');await state(page, 'running');
    assert.equal(await page.locator('#guided-form').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#application-form').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#status').evaluate(node => node.closest('[aria-busy="true"]') === null), true,
      'the live running status must stay outside busy content so announcements are not deferred');
    assert.equal(await page.locator('#result-table-region').getAttribute('aria-busy'), 'true');
    await page.locator('#cancel').click();
    await enabled(page);assert.equal(await page.locator('#field-message').inputValue(), 'retained draft');assert.equal(await page.locator('#result').textContent(), '');
    assert.equal(await page.evaluate(() => window.__workers[0].terminated), 1);await page.locator('#retry').click();await expectCell(page, 'RETAINED DRAFT');
    assert(getLoads() >= 3);
    for (const selector of ['#guided-form', '#application-form', '#result-table-region'])
      assert.equal(await page.locator(selector).getAttribute('aria-busy'), null);
  }, {holdFirst: true});
});

test('text_v3_workbench timeout terminates the worker and retry computes the retained input', async () => {
  await withPage(async ({page}) => {
    await enabled(page);await submit(page, 'timeout draft');await state(page, 'timeout');
    assert.equal(await page.locator('#field-message').inputValue(), 'timeout draft');assert.equal(await page.evaluate(() => window.__workers[0].terminated), 1);
    assert.equal(await page.locator('#guided-submit').isDisabled(), true);await page.locator('#retry').click();await expectCell(page, 'TIMEOUT DRAFT');
  }, {holdFirst: true});
});

test('text_v3_workbench editing a busy draft invalidates old work and clears results', async () => {
  await withPage(async ({page}) => {
    await enabled(page);await submit(page, 'old draft');await state(page, 'running');await page.locator('#field-message').fill('new draft');
    await enabled(page);assert.equal(await page.evaluate(() => window.__workers[0].terminated), 1);assert.equal(await page.locator('#retry').isHidden(), true);
    assert.equal(await page.locator('#result').textContent(), '');await page.locator('#guided-submit').click();await expectCell(page, 'NEW DRAFT');
  }, {holdFirst: true});
});

async function staleProbe(source) {
  await withPage(async ({page}) => {
    await enabled(page);await submit(page, 'first');await expectCell(page, 'FIRST');await submit(page, 'slow');await state(page, 'running');
    await page.evaluate(() => {const record = window.__workers[0];const prior = record.messages.find(message => message.type === 'result');record.worker.dispatchEvent(new MessageEvent('message', {data: prior}));});
    assert.equal(await page.locator('#status').getAttribute('data-state'), 'running', 'a prior generation must not complete new work');
    assert.equal(await page.locator('#result').textContent(), '');await expectCell(page, 'SLOW');
  }, {source});
}
test('text_v3_workbench stale reply correlation rejects a planted missing-generation guard', async () => {
  await staleProbe(template);
  const first = 'if(data.generation!==generation||!pending)return;';const second = 'if(!pending||token!==generation)return;';
  assert.equal(template.split(first).length, 2);assert.equal(template.split(second).length, 2);
  const changed = template.replace(first, 'if(!pending)return;').replace(second, 'if(!pending)return;');
  await assert.rejects(staleProbe(changed), error => error instanceof assert.AssertionError);
});

test('text_v3_workbench delayed module loading retains and focuses the exact pre-init raw draft', async () => {
  await withPage(async ({page}) => {
    await page.locator('#raw-editor').waitFor();await page.locator('#raw-editor').evaluate(node => {node.open = true;});await page.locator('#request').focus();await page.locator('#request').evaluate(node => node.setSelectionRange(3, 8, 'backward'));assert.equal(await page.locator('#submit').isDisabled(), true);
    await enabled(page);assert.equal(await page.locator('#request').inputValue(), 'retained 🌱');
    assert.equal(await page.locator('#request').evaluate(node => node === document.activeElement), true);
    assert.deepEqual(await page.locator('#request').evaluate(node => [node.selectionStart, node.selectionEnd, node.selectionDirection]), [3, 8, 'backward']);
    await rawSubmit(page, 'retained 🌱');await expectCell(page, 'RETAINED 🌱');
  }, {delayScript: 300, delay: 100, draft: 'retained 🌱'});
});

test('text_v3_workbench load and compute failures recover without private diagnostics or lost draft', async () => {
  await withPage(async ({page}) => {
    await state(page, 'load_error');assert.equal(await page.locator('#request').inputValue(), 'secret draft');
    assert.equal(await page.locator('#submit').isDisabled(), true);await page.locator('#retry').click();await enabled(page);
    await submit(page, 'throw');await state(page, 'compute_error');assert.equal(await page.locator('#field-message').inputValue(), 'throw');
    assert.equal((await page.locator('body').textContent()).includes('private fixture failure'), false);
    await submit(page, 'healthy');await expectCell(page, 'HEALTHY');
  }, {failFirstLoad: true, draft: 'secret draft'});
});

test('text_v3_workbench invalid scalar Unicode, reserved fields and UTF8 bounds never invoke the byte guest', async () => {
  await withPage(async ({page}) => {
    await enabled(page);
    for (const value of ['x' + US + 'y', 'x'.repeat(4096), '\ud800']) {
      await page.locator('#field-message').evaluate((node, value) => {node.value = value;node.dispatchEvent(new Event('input', {bubbles: true}));}, value);
      await page.locator('#guided-submit').click();await state(page, 'input_error');
      assert.equal(await page.locator('#field-message').getAttribute('aria-invalid'), 'true');
    }
    assert.equal(await page.evaluate(() => window.__workers.reduce((count, record) => count + record.posts.length, 0)), 0);
    await submit(page, 'valid 🌱');await expectCell(page, 'VALID 🌱');
  });
});

test('text_v3_workbench retired worker messages cannot mark a new loading owner ready', async () => {
  await withPage(async ({page}) => {
    await enabled(page);await submit(page, 'retained');await state(page, 'running');await page.locator('#cancel').click();
    await page.evaluate(() => window.__workers[0].worker.dispatchEvent(new MessageEvent('message', {data: {type: 'ready'}})));
    assert.equal(await page.locator('#guided-submit').isDisabled(), true);
    assert.equal(await page.locator('#result').textContent(), '');await enabled(page);
    assert.equal(await page.evaluate(() => window.__workers[0].terminated), 1);
    assert.equal(await page.evaluate(() => window.__workers[1].posts.length), 0);
  }, {holdFirst: true, delay: 250});
});

test('text_v3_workbench initialization deadline retires its worker and retry preserves the raw draft', async () => {
  await withPage(async ({page}) => {
    await state(page, 'timeout');assert.equal(await page.evaluate(() => window.__workers[0].terminated), 1);
    assert.equal(await page.locator('#request').inputValue(), 'init draft');await page.locator('#retry').click();await enabled(page);
    await rawSubmit(page, 'init draft');await expectCell(page, 'INIT DRAFT');
  }, {delayFirst: 2000, draft: 'init draft'});
});

test('text_v3_workbench invalid byte replies fail closed and allow a fresh invocation', async () => {
  await withPage(async ({page}) => {
    await enabled(page);
    for (const value of ['bad-json', 'bad-utf8', 'wrong-operation', 'over-limit']) {
      await submit(page, value);await state(page, value === 'over-limit' ? 'compute_error' : 'response_error');
      assert.equal(await page.locator('#result').textContent(), '');assert.equal(await page.locator('#result-table td').count(), 0);
      await submit(page, 'working');await expectCell(page, 'WORKING');
    }
  });
});

test('text_v3_workbench reset and example controls change drafts and evidence without replacing computation', async () => {
  await withPage(async ({page}) => {
    await enabled(page);await submit(page, 'changed');await expectCell(page, 'CHANGED');
    await page.locator('#reset').click();assert.equal(await page.locator('#field-message').inputValue(), 'hello');
    assert.equal(await page.locator('#result').textContent(), '');assert.equal(await page.locator('#expected-response-json').textContent(), '');
    await page.locator('#example').selectOption('world');assert.equal(await page.locator('#field-message').inputValue(), 'hello');
    await page.locator('#load-example').click();assert.equal(await page.locator('#field-message').inputValue(), 'world');
    assert.equal(await page.locator('#expected-response-json').textContent(), fixture.workbench.operations[0].examples[1].expected_response);
    assert.equal(await page.locator('#result').textContent(), '');await page.locator('#guided-submit').click();await expectCell(page, 'WORLD');
    assert.equal(await page.locator('#result-table td').textContent(), 'WORLD', 'source example evidence cannot be substituted for actual computation');
  });
});

function intentReply(invocation, value) {
  assert.deepEqual(Object.keys(invocation).sort(), ['name', 'payload', 'version']);
  assert.equal(invocation.version, 1);assert.equal(invocation.name, 'application.invoke');
  const split = invocation.payload.indexOf(US), input = invocation.payload.slice(split + 1);
  return {...reply(value, invocation.payload.startsWith('ui-raw-v1' + US) ? 'raw' : 'echo'), request: input};
}
test('text_v3_workbench real intent transport streams UTF8 and rejects oversized or malformed envelopes', async () => {
  await withPage(async ({page, invocations}) => {
    await enabled(page);await submit(page, 'fragmented 🌱');await expectCell(page, 'FRAGMENTED 🌱');
    assert.equal(await page.evaluate(() => window.__workers.length), 0, 'intent transport must not claim a browser worker');
    for (const value of ['oversized-envelope', 'bad-envelope', 'invalid-output']) {
      await submit(page, value);await state(page, value === 'invalid-output' ? 'response_error' : 'compute_error');
      assert.equal(await page.locator('#result').textContent(), '');
    }
    await rawSubmit(page, 'recovered');await expectCell(page, 'RECOVERED');assert.equal(invocations.length, 5);
  }, {transport: 'hologram', hologram: async (invocation, response) => {
    const input = invocation.payload.slice(invocation.payload.indexOf(US) + 1);
    if (input === 'oversized-envelope') {response.setHeader('content-length', '98561');response.end('{}');return;}
    if (input === 'bad-envelope') {response.end(JSON.stringify({version: 1, outputs: []}));return;}
    if (input === 'invalid-output') {response.end(JSON.stringify({version: 1, outputs: ['invalid result']}));return;}
    const bytes = Buffer.from(JSON.stringify({version: 1, outputs: [JSON.stringify(intentReply(invocation, input.toUpperCase()))]}));
    const split = Math.max(1, bytes.indexOf(Buffer.from('🌱')) + 1);response.write(bytes.subarray(0, split));
    await new Promise(resolve => setTimeout(resolve, 20));response.end(bytes.subarray(split));
  }});
});

test('text_v3_workbench cancelled intent output cannot overwrite its retried computation', async () => {
  await withPage(async ({page, invocations}) => {
    await enabled(page);await submit(page, 'retained bridge input');await state(page, 'running');await page.locator('#cancel').click();await enabled(page);
    assert.equal(await page.locator('#field-message').inputValue(), 'retained bridge input');await page.locator('#retry').click();await expectCell(page, 'NEW OWNER');
    await page.waitForTimeout(450);assert.equal(await page.locator('#result').textContent(), 'NEW OWNER');assert.equal(invocations.length, 2);
  }, {transport: 'hologram', hologram: async (invocation, response, sequence) => {
    if (sequence === 1) await new Promise(resolve => setTimeout(resolve, 400));
    response.end(JSON.stringify({version: 1, outputs: [JSON.stringify(intentReply(invocation, sequence === 1 ? 'STALE OWNER' : 'NEW OWNER'))]}));
  }});
});

async function rawDraftProbe(source) {
  await withPage(async ({page}) => {
    await enabled(page);await rawSubmit(page, 'old raw draft');await state(page, 'running');
    await page.locator('#request').fill('new raw draft');
    assert.equal(await page.evaluate(() => window.__workers[0].terminated), 1, 'raw input editing must retire its busy computation');
    await enabled(page);assert.equal(await page.locator('#retry').isHidden(), true);assert.equal(await page.locator('#result').textContent(), '');
    assert.equal(await page.locator('#request').inputValue(), 'new raw draft');await page.locator('#submit').click();await expectCell(page, 'NEW RAW DRAFT');
  }, {source, holdFirst: true});
}
test('text_v3_workbench raw draft edits retire pending work and reject a missing-input-handler defect', async () => {
  await rawDraftProbe(template);
  const handler = "request.addEventListener('input',draftChanged);";assert.equal(template.split(handler).length, 2);
  await assert.rejects(rawDraftProbe(template.replace(handler, '')), error => error instanceof assert.AssertionError);
});

async function shapeProbe(source) {
  const view = viewData();
  await withPage(async ({page}) => {
    await enabled(page);assert.equal(await page.locator('#result-shape').isHidden(), true);
    await submit(page, 'hello');await expectCell(page, 'HELLO');
    assert.equal(await page.locator('#result-shape').isVisible(), true);
    assert.deepEqual(await page.locator('#result-shape dt').allTextContents(), [view.labels.row, view.labels.column]);
    assert.equal(await page.locator('#result-rows').textContent(), '1');assert.equal(await page.locator('#result-columns').textContent(), '1');
    for (const [input, rows, columns] of [['zero-0x3', 0, 3], ['zero-2x0', 2, 0], ['zero-0x0', 0, 0]]) {
      await submit(page, input);await page.waitForFunction(expected => document.querySelector('#result').textContent === expected, input.toUpperCase());
      assert.equal(await page.locator('#result-shape').isVisible(), true, 'zero-cell matrices must retain a human-readable shape');
      assert.equal(await page.locator('#result-rows').textContent(), String(rows));
      assert.equal(await page.locator('#result-columns').textContent(), String(columns), 'actual column count must survive an empty result');
      assert.equal(await page.locator('#result-table-region').isHidden(), true);
    }
    await page.locator('#field-message').fill('edited');assert.equal(await page.locator('#result-shape').isHidden(), true);
    assert.equal(await page.locator('#result-rows').textContent(), '');assert.equal(await page.locator('#result-columns').textContent(), '');
    await submit(page, 'invalid');await page.waitForFunction(() => document.querySelector('#result-error').hidden === false);
    assert.equal(await page.locator('#result-shape').isHidden(), true);
    assert.equal(await page.locator('#result-rows').textContent(), '', 'typed errors must clear the hidden row count');
    assert.equal(await page.locator('#result-columns').textContent(), '', 'typed errors must clear the hidden column count');
    await page.locator('#reset').click();assert.equal(await page.locator('#result-shape').isHidden(), true);
  }, {source, view});
}
test('text_v3_workbench human shape survives zero-cell results and rejects a forged column count', async () => {
  await shapeProbe(template);
  const columns = "byId('result-columns').textContent=answer.status==='ok'?String(answer.columns):'';";assert.equal(template.split(columns).length, 2);
  await assert.rejects(shapeProbe(template.replace(columns, "byId('result-columns').textContent=answer.status==='ok'?String(answer.rows):'';")), error => error instanceof assert.AssertionError);
  const rows = "byId('result-rows').textContent=answer.status==='ok'?String(answer.rows):'';";assert.equal(template.split(rows).length, 2);
  await assert.rejects(shapeProbe(template.replace(rows, "byId('result-rows').textContent=String(answer.rows);")), error => error instanceof assert.AssertionError);
});

test('text_v3_workbench failed engine recovery stays available after draft edits reset or example changes', async () => {
  await withPage(async ({page}) => {
    await state(page, 'load_error');await page.locator('#raw-editor').evaluate(node => {node.open = true;});
    await page.locator('#request').fill('edited after loading failed');
    assert.equal(await page.locator('#retry').isVisible(), true, 'editing a failed-engine draft must preserve the only recovery control');
    assert.equal(await page.locator('#submit').isDisabled(), true);await page.locator('#retry').click();await enabled(page);
    assert.equal(await page.locator('#request').inputValue(), 'edited after loading failed');
    await page.locator('#submit').click();await expectCell(page, 'EDITED AFTER LOADING FAILED');
  }, {failFirstLoad: true});
  for (const control of ['reset', 'example']) {
    await withPage(async ({page}) => {
      await state(page, 'load_error');
      if (control === 'reset') await page.locator('#reset').click();
      else {await page.locator('#example').selectOption('world');await page.locator('#load-example').click();}
      assert.equal(await page.locator('#retry').isVisible(), true, `${control} must preserve failed-engine recovery`);
      await page.locator('#retry').click();await enabled(page);
      const value = control === 'reset' ? 'hello' : 'world';assert.equal(await page.locator('#field-message').inputValue(), value);
      await page.locator('#guided-submit').click();await expectCell(page, value.toUpperCase());
    }, {failFirstLoad: true});
  }
  await withPage(async ({page}) => {
    await enabled(page);await submit(page, 'old timed-out draft');await state(page, 'timeout');
    await page.locator('#field-message').fill('edited after timeout');assert.equal(await page.locator('#retry').isVisible(), true);
    await page.locator('#retry').click();await enabled(page);
    assert.equal(await page.locator('#result').textContent(), '', 'retry cannot replay a superseded invocation');
    assert.equal(await page.locator('#field-message').inputValue(), 'edited after timeout');
    await page.locator('#guided-submit').click();await expectCell(page, 'EDITED AFTER TIMEOUT');
  }, {holdFirst: true});
  await withPage(async ({page}) => {
    await enabled(page);await rawSubmit(page, 'reserved' + US + 'separator');await state(page, 'input_error');
    await page.locator('#load-example').click();await state(page, 'ready');
    assert.equal(await page.locator('#retry').isHidden(), true);assert.equal(await page.locator('#result').textContent(), '');
    await page.locator('#guided-submit').click();await expectCell(page, 'HELLO');
  });
});

test('text_v3_workbench input validation preserves the independent initialization deadline and owner', async () => {
  await withPage(async ({page}) => {
    await state(page, 'initializing');await page.locator('#raw-editor').evaluate(node => {node.open = true;});
    await page.locator('#request').fill('bad' + US + 'separator');await page.locator('#request').press('Control+Enter');await state(page, 'input_error');
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('#status').getAttribute('data-state'), 'timeout', 'invalid input must not cancel the independent engine initialization deadline');
    assert.equal(await page.evaluate(() => window.__workers[0].terminated), 1);assert.equal(await page.locator('#retry').isVisible(), true);
  }, {delayFirst: 5000});
  await withPage(async ({page}) => {
    await state(page, 'initializing');await page.locator('#raw-editor').evaluate(node => {node.open = true;});
    await page.locator('#request').fill('bad' + US + 'separator');await page.locator('#request').press('Control+Enter');await state(page, 'input_error');
    await enabled(page);assert.equal(await page.evaluate(() => window.__workers[0].terminated), 0, 'input validation cannot retire a loading owner');
    assert.equal(await page.locator('#retry').isHidden(), true, 'successful initialization must clear false engine-failure state');
    await rawSubmit(page, 'corrected');await expectCell(page, 'CORRECTED');
  }, {delayFirst: 400});
});

test('text_v3_workbench example picker retains a modeled prompt and enables only actionable loads', async () => {
  const view = viewData();
  await withPage(async ({page}) => {
    await enabled(page);assert.equal(await page.locator('#example').inputValue(), view.initial_example);
    assert.equal(await page.locator('#load-example').isEnabled(), true);
    assert.deepEqual(await page.locator('#example option').evaluateAll((nodes, ids) => nodes.filter(node => ids.includes(node.value)).map(node => node.value), view.operations[0].examples.map(row => row.id)),
      view.operations[0].examples.map(row => row.id));
    await submit(page, 'manual edit');await expectCell(page, 'MANUAL EDIT');
    assert.equal(await page.locator('#example option:checked').count(), 1, 'editing must retain a visible source-labeled example prompt');
    assert.equal(await page.locator('#example option:checked').textContent(), view.labels.examples);
    assert.equal(await page.locator('#example').inputValue(), '');assert.equal(await page.locator('#load-example').isDisabled(), true);
    await page.locator('#example').selectOption('world');assert.equal(await page.locator('#load-example').isEnabled(), true);
    assert.equal(await page.locator('#field-message').inputValue(), 'manual edit', 'selection alone cannot overwrite the edited draft');
    assert.equal(await page.locator('#result').textContent(), '', 'changing the selected example clears the old computed result');
    await page.locator('#load-example').click();assert.equal(await page.locator('#field-message').inputValue(), 'world');
    assert.equal(await page.locator('#expected-response-json').textContent(), view.operations[0].examples[1].expected_response);
    assert.equal(await page.locator('#result').textContent(), '');await page.locator('#guided-submit').click();await expectCell(page, 'WORLD');
    await page.locator('#reset').click();assert.equal(await page.locator('#example').inputValue(), '');
    assert.equal(await page.locator('#load-example').isDisabled(), true);assert.equal(await page.locator('#result').textContent(), '');
    await page.locator('#example').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#example').inputValue(), view.operations[0].examples[0].id);
    await page.keyboard.press('Tab');assert.equal(await page.locator('#load-example').evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Space');assert.equal(await page.locator('#field-message').inputValue(), 'hello');
  }, {view});
});
