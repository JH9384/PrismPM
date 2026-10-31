#!/usr/bin/env node
/**
 * Measure `prism-code dev` from the outside (issue #288): start the verb on a
 * project, save a model edit, and time how long the studio takes to show the
 * new verdict. The clock starts just before the save, in this process, so it
 * does not trust the number the verb reports about itself.
 *
 *   dev-measure.mjs --project <dir> --from <text> --to <text> [--edits <n>] [--policy <file>]
 *   dev-measure.mjs --stand-in [--edits <n>]
 *
 * --project runs the project's real build, and --from and --to name the text
 * the edit swaps in the first file under src/ that holds it. --stand-in builds
 * by copying the reference archive, so what it times is the loop alone.
 *
 * With --chrome <path> the page is open in a headless browser for the whole
 * run, and the clock stops when the browser shows the new verdict. The run then
 * also fails on any request that leaves the studio's origin and on any console
 * error, and the page's own verdict must agree. Run inside a namespace with no
 * network, this is the offline test:
 *
 *   sudo unshare -n sh -c 'ip link set lo up && node dev-measure.mjs --stand-in --chrome "$(command -v google-chrome)"'
 *
 * Also: --cold-factor <x> fails the run when an edit takes longer than x times
 * this run's own cold build, --overhead-seconds <n> fails it when an edit spends
 * longer than n outside its build and check, --summary <file> appends a Markdown
 * table, and --json prints the whole result.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));

/** The stand-in build: the holo follows the model, damaged when the model says so, as an edit changes a real archive. */
const STAND_IN_BUILD = `import { readFileSync, writeFileSync } from 'node:fs';
const bytes = readFileSync('base.bin');
if (readFileSync('src/App.lex.tex', 'utf8').includes('DAMAGE')) bytes[bytes.length - 200] ^= 0xff;
writeFileSync('App.holo', bytes);
`;

function parseArguments(argv) {
  const flags = new Set(['stand-in', 'json']);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (flags.has(name)) options[name] = true;
    else options[name] = argv[++i];
  }
  return options;
}

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

/** Remove a temporary directory. A browser may hold its profile a moment after it exits, and a leftover must not fail the run. */
function remove(directory) {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    process.stderr.write(`warning: ${directory} is left behind: ${error.code ?? error.message}\n`);
  }
}

async function until(predicate, what, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await delay(25);
  }
}

function standInProject() {
  const directory = mkdtempSync(join(tmpdir(), 'prism-dev-measure-'));
  mkdirSync(join(directory, 'src'));
  writeFileSync(join(directory, 'prismpm.toml'), 'spec = "prismpm/project/1"\nproject = "StandIn"\nbuild_root = ".prism"\n');
  writeFileSync(join(directory, 'src/App.lex.tex'), 'model\n');
  writeFileSync(join(directory, 'build.mjs'), STAND_IN_BUILD);
  copyFileSync(FIXTURE, join(directory, 'base.bin'));
  return directory;
}

/** The first file under src/ that holds the text, or under a project's model directory. */
function fileHolding(directory, text) {
  const search = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        const found = search(path);
        if (found) return found;
      } else if (entry.name.endsWith('.lex.tex') && readFileSync(path, 'utf8').includes(text)) return path;
    }
    return null;
  };
  const found = search(join(directory, 'src'));
  if (!found) throw new Error(`no .lex.tex file under ${directory}/src holds ${JSON.stringify(text)}`);
  return found;
}

/** Save as an editor does: a temporary file renamed over the source. */
function save(path, text) {
  writeFileSync(`${path}.measure`, text);
  renameSync(`${path}.measure`, path);
}

/** A small client for the Chrome DevTools protocol over the WebSocket Node ships. */
async function openBrowser(chrome, url) {
  const profile = mkdtempSync(join(tmpdir(), 'prism-dev-chrome-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    // Outside a namespace with no network, nothing but this machine resolves either.
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
  ];
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  const child = spawn(chrome, [...args, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (text) => {
    stderr += text;
  });
  const endpoint = await until(() => /DevTools listening on (ws:\/\/\S+)/.exec(stderr)?.[1], 'the browser to start', 30000);
  const { host } = new URL(endpoint);
  const page = await (await fetch(`http://${host}/json/new?about:blank`, { method: 'PUT' })).json();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    socket.onopen = done;
    socket.onerror = () => reject(new Error('the browser refused the debugging connection'));
  });
  let id = 0;
  const pending = new Map();
  const requests = [];
  const problems = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiting?.reject(new Error(message.error.message));
      else waiting?.resolve(message.result);
    } else if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    else if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') problems.push(`${message.params.entry.text} ${message.params.entry.url ?? ''}`.trim());
  };
  const send = (method, params = {}) => new Promise((done, reject) => {
    id += 1;
    pending.set(id, { resolve: done, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  };
  return {
    requests,
    problems,
    /** What the Check tab shows now. */
    read: () => evaluate(`({
      headline: document.querySelector('#panel-check .headline strong')?.textContent ?? null,
      level: document.querySelector('[data-testid=level]')?.textContent ?? null,
      digest: document.querySelector('[data-testid=digest]')?.textContent ?? null,
      agrees: document.querySelector('[data-testid=browser-check]')?.dataset.agrees ?? null,
      replay: document.querySelector('[data-testid=replay-state]')?.textContent ?? null,
      busy: document.querySelector('#panel-check .busy') !== null,
    })`),
    async close() {
      socket.close();
      const exited = new Promise((done) => child.once('exit', done));
      child.kill();
      await exited;
      remove(profile);
    },
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const standIn = options['stand-in'] === true;
  if (!standIn && !(options.project && options.from && options.to)) throw new Error('give --stand-in, or --project with --from and --to');
  const directory = standIn ? standInProject() : resolve(options.project);
  const from = standIn ? 'model' : options.from;
  const to = standIn ? 'model DAMAGE' : options.to;
  const edits = Number(options.edits ?? 4);
  const buildTimeoutMs = Number(options['timeout-seconds'] ?? 1800) * 1000;
  const coldFactor = options['cold-factor'] === undefined ? null : Number(options['cold-factor']);
  const overheadLimitMs = options['overhead-seconds'] === undefined ? null : Number(options['overhead-seconds']) * 1000;
  const source = standIn ? join(directory, 'src/App.lex.tex') : fileHolding(directory, from);

  const args = [BIN, 'dev', directory, '--no-open', '--port', options.port ?? '0'];
  if (standIn) args.push('--build', 'node build.mjs', '--holo', 'App.holo');
  if (options.policy) args.push('--policy', resolve(options.policy));
  const dev = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  dev.stdout.setEncoding('utf8').on('data', (text) => {
    out += text;
  });
  dev.stderr.setEncoding('utf8').on('data', (text) => {
    out += text;
  });
  const url = await until(() => /Studio at (http:\/\/localhost:\d+)/.exec(out)?.[1], `the studio address in ${out}`, 30000);
  const direct = url.replace('localhost', '127.0.0.1');
  const state = async () => (await fetch(`${direct}/api/state`)).json();

  let browser = null;
  const result = { project: directory, standIn, editFile: source, cold: null, edits: [], browser: null };
  try {
    const started = Date.now();
    if (options.chrome) browser = await openBrowser(options.chrome, url);
    const first = await until(async () => {
      const current = await state();
      return current.phase === 'idle' && current.cycle ? current : null;
    }, 'the first build', buildTimeoutMs);
    if (first.result.outcome !== 'verdict') throw new Error(`the first build reached no verdict: ${JSON.stringify(first.result).slice(0, 2000)}`);
    result.cold = { totalMs: Date.now() - started, buildMs: first.cycle.build.ms, checkMs: first.cycle.checkMs, digest: first.result.verdict.holo, level: first.result.verdict.level, passed: first.result.verdict.passed };

    const original = readFileSync(source, 'utf8');
    if (!original.includes(from)) throw new Error(`${source} does not hold ${JSON.stringify(from)}`);
    const edited = original.replace(from, to);
    let cycle = first.cycle.number;
    for (let i = 0; i < edits; i++) {
      // Odd edits go back to the original text: a rebuild that reuses its old directory must still be judged right.
      const text = i % 2 === 0 ? edited : original;
      const t0 = Date.now();
      save(source, text);
      const settled = await until(async () => {
        const current = await state();
        return current.phase === 'idle' && current.cycle.number > cycle ? current : null;
      }, `the verdict on edit ${i + 1}`, buildTimeoutMs);
      const serverMs = Date.now() - t0;
      cycle = settled.cycle.number;
      const record = {
        edit: i + 1,
        serverMs,
        pageMs: null,
        reportedMs: settled.cycle.editToVerdictMs,
        buildMs: settled.cycle.build?.ms ?? null,
        checkMs: settled.cycle.checkMs,
        outcome: settled.result.outcome,
        digest: settled.result.verdict?.holo ?? null,
        passed: settled.result.verdict?.passed ?? null,
      };
      if (settled.result.outcome !== 'verdict') throw new Error(`edit ${i + 1} reached no verdict: ${JSON.stringify(settled.result).slice(0, 2000)}`);
      if (browser) {
        const shown = await until(async () => {
          const view = await browser.read();
          return view.digest === record.digest && view.agrees !== null && !view.busy ? view : null;
        }, `the browser to show ${record.digest}`, 30000);
        record.pageMs = Date.now() - t0;
        record.page = shown;
        if (shown.agrees !== 'true') throw new Error(`edit ${i + 1}: the page's verdict differs from the command line's: ${JSON.stringify(shown)}`);
      }
      result.edits.push(record);
    }
    save(source, original);
    if (edits % 2 === 1) await delay(100);

    const expectedDigests = result.edits.map((record) => record.digest);
    if (edits >= 2 && expectedDigests[1] !== result.cold.digest) throw new Error(`going back to the original source gave ${expectedDigests[1]}, not the first build's ${result.cold.digest}`);

    if (browser) {
      const origin = new URL(url).origin;
      const outside = browser.requests.filter((request) => !request.startsWith(`${origin}/`) && request !== 'about:blank');
      const view = await browser.read();
      result.browser = { requests: browser.requests.length, distinct: [...new Set(browser.requests)], outside, consoleProblems: browser.problems, replay: view.replay };
      if (outside.length > 0) throw new Error(`the page reached outside its origin: ${outside.join(', ')}`);
      if (browser.problems.length > 0) throw new Error(`the page logged errors: ${browser.problems.join(' | ')}`);
    }
  } finally {
    await browser?.close();
    const stopped = new Promise((done) => dev.once('exit', done));
    dev.kill();
    await stopped;
    if (standIn) remove(directory);
  }

  const times = result.edits.map((record) => record.pageMs ?? record.serverMs).sort((a, b) => a - b);
  // What the loop itself costs: the time of an edit that went to neither the build nor the check.
  for (const record of result.edits) record.overheadMs = (record.pageMs ?? record.serverMs) - (record.buildMs ?? 0) - (record.checkMs ?? 0);
  const overheads = result.edits.map((record) => record.overheadMs);
  const coldLimitMs = coldFactor === null ? null : result.cold.buildMs * coldFactor;
  result.editToVerdict = { minMs: times[0], medianMs: times[Math.floor(times.length / 2)], maxMs: times.at(-1), coldBuildMs: result.cold.buildMs, coldLimitMs, maxOverheadMs: Math.max(...overheads), overheadLimitMs };
  const seconds = (ms) => (ms === null || ms === undefined ? '' : (ms / 1000).toFixed(2));
  const table = [
    `### \`prism-code dev\` edit to verdict${standIn ? ', stand-in build (the loop alone)' : ''}`,
    '',
    `Cold first build ${seconds(result.cold.buildMs)} s. Clock stops when ${browser ? 'the browser shows' : 'the studio state holds'} the verdict.`,
    '',
    '| Edit | Edit to verdict (s) | Build (s) | Check (s) | Loop (s) | Verdict digest |',
    '| --- | --- | --- | --- | --- | --- |',
    ...result.edits.map((record) => `| ${record.edit} | ${seconds(record.pageMs ?? record.serverMs)} | ${seconds(record.buildMs)} | ${seconds(record.checkMs)} | ${seconds(record.overheadMs)} | \`${(record.digest ?? '').slice(0, 19)}\` |`),
    '',
    `Median ${seconds(result.editToVerdict.medianMs)} s, slowest ${seconds(result.editToVerdict.maxMs)} s, slowest loop ${seconds(result.editToVerdict.maxOverheadMs)} s.${coldLimitMs === null ? '' : ` Limit ${seconds(coldLimitMs)} s, ${coldFactor} times the cold build.`}`,
    ...(result.browser ? ['', `The browser made ${result.browser.requests} requests, all to the studio's origin: ${result.browser.distinct.map((request) => new URL(request).pathname).filter((path, index, all) => all.indexOf(path) === index).join(', ')}. Replay tab: ${result.browser.replay}.`] : []),
    '',
  ].join('\n');
  if (options.summary) appendFileSync(options.summary, table);
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : table);
  if (coldLimitMs !== null && result.editToVerdict.maxMs > coldLimitMs) {
    process.stderr.write(`the slowest edit took ${seconds(result.editToVerdict.maxMs)} s, over ${coldFactor} times this run's cold build of ${seconds(result.cold.buildMs)} s\n`);
    return 1;
  }
  if (overheadLimitMs !== null && result.editToVerdict.maxOverheadMs > overheadLimitMs) {
    process.stderr.write(`an edit spent ${seconds(result.editToVerdict.maxOverheadMs)} s outside its build and check, over the limit of ${seconds(overheadLimitMs)} s\n`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exit(1);
  },
);
