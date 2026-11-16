/**
 * A rule app as a page anyone can open: a folder of static files, with no
 * server behind it and nothing to build.
 *
 * The folder holds the app's record, the rule judge's holo, the part of this
 * package a browser needs to load a holo, and one page. The page admits the
 * record with the same functions `rule-app.mjs` uses (their source is written
 * into the page), replays the holo's own vectors and the record's, and only
 * then answers. It sends the judge numbers taken from the form, so it reads no
 * request text at all.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readKernelFile } from './kernel-store.mjs';
import { ANSWER, RULE_APP_SCHEMA, admits, answerKind, greatestAt, kernelChecked, leastAt, pinnedHolo, rulesAt } from './rule-app.mjs';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/** Every file of this package that `src/browser.mjs` reaches, relative to `src/`: what a page needs to load a holo. */
export function browserClosure({ read = (file) => readFileSync(file, 'utf8') } = {}) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    const text = read(file);
    // A module that needs Node itself is one a page never reaches: the runtime imports those only on Node.
    if (/\bfrom\s*['"]node:/.test(text)) return;
    seen.add(file);
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) walk(resolve(dirname(file), m[1]));
  };
  walk(join(SRC, 'browser.mjs'));
  return [...seen].map((file) => relative(SRC, file).split('\\').join('/')).sort();
}

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The page's script. The admission functions are the ones this package runs, by their own source. */
function startScript() {
  return `// Written by prism-code. The record decides nothing here: the functions below do, and they are the package's own.
import { loadArchive } from './prism-code/src/index.mjs';
import { HOLDS, KERNEL_AXIOMS, proofLines, readLibrary } from './prism-code/src/journey/kernel-terms.mjs';
import { PROOF_SCHEMA, derivationKey, guaranteeStatement, reuseAdmits } from './prism-code/src/journey/kappa-rules.mjs';
import { findProof, keepProof, opfsStore } from './prism-code/src/journey/kappa-opfs.mjs';

const SCHEMA_ONE = 1;
const WORDS_MAX = 1024;
const ANSWER = ${JSON.stringify(ANSWER)};
const leastAt = ${leastAt.toString()};
const greatestAt = ${greatestAt.toString()};
const rulesAt = ${rulesAt.toString()};
const holoAdmitted = (r) => r.holoNamed === r.holoPinned && r.holoVerified === 1 && r.holoVectorsFailed === 0;
const numbersAdmitted = (r) => r.fieldsStated === r.fields && r.boundsAgree === 1 && r.words + r.fields <= WORDS_MAX;
const proofAdmitted = (r) => r.hasProof === 0 || (r.hasProof === 1 && r.proofStatement === r.recordStatement);
const admits = ${admits.toString()};
const kernelChecked = ${kernelChecked.toString()};
const answerKind = ${answerKind.toString()};

const enc = new TextEncoder();
const dec = new TextDecoder();
const hexWord = (n) => [0, 8, 16, 24].map((k) => ((n >>> k) & 255).toString(16).padStart(2, '0')).join('');
const readWord = (hex) => parseInt(hex.match(/../g).reverse().join(''), 16);
const sha256 = async (bytes) => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const $ = (id) => document.getElementById(id);
// What this browser already fetched and proved, by κ-label. Every read re-derives the label.
const store = await opfsStore();
const unpack = async (response) => new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
/** Bytes named by a label: from the store when they re-derive to it, else fetched, and kept when they are what the label names. */
async function named(label, fetchBytes) {
  const kept = await store.get(label);
  if (kept) return kept;
  const bytes = await fetchBytes();
  if ((await sha256(bytes)) === label) await store.put(bytes);
  return bytes;
}
const say = (id, text, state) => { $(id).textContent = text; if (state) $(id).dataset.state = state; };

async function open() {
  const recordBytes = new Uint8Array(await (await fetch('./app.rule-app.json', { cache: 'no-store' })).arrayBuffer());
  const record = JSON.parse(dec.decode(recordBytes));
  // The guest is loaded from the very bytes that are hashed below, so the bytes checked are the bytes run.
  const holoBytes = await named(record.kernel.holo, async () => new Uint8Array(await (await fetch('./kernel.holo', { cache: 'no-store' })).arrayBuffer()));
  let kernel = null, verified = 0, failed = 1;
  try {
    kernel = await loadArchive(holoBytes, { capabilities: null, capabilitySet: undefined, allowUnverified: false });
    verified = kernel.identities && kernel.identities.verified === true ? 1 : 0;
    failed = (await kernel.acceptance()).failed.length;
  } catch (error) { console.error(error); }
  const fields = record.fields.length;
  const boundsAgree = record.fields.every((f, i) => record.words[leastAt(i)] === (f.kind === 'choice' ? 0 : f.min) && record.words[greatestAt(i)] === (f.kind === 'choice' ? f.values.length - 1 : f.max)) && rulesAt(fields) <= record.words.length ? 1 : 0;
  const facts = {
    schema: record.schema === ${JSON.stringify(RULE_APP_SCHEMA)} ? SCHEMA_ONE : 0,
    holoNamed: record.kernel.holo,
    holoPinned: await sha256(holoBytes),
    holoVerified: verified,
    holoVectorsFailed: failed,
    fields,
    fieldsStated: record.words[1],
    boundsAgree,
    words: record.words.length,
    hasProof: record.proof === null ? 0 : 1,
    proofStatement: record.proof === null ? '' : record.proof.statement,
    recordStatement: await sha256(enc.encode(JSON.stringify(['prism/kernel-statement/1', record.words, record.guarantees]))),
  };
  return { record, facts, kernel, address: await sha256(recordBytes) };
}

function form(record) {
  for (const [i, f] of record.fields.entries()) {
    const label = document.createElement('label');
    label.textContent = f.name;
    const input = f.kind === 'choice' ? document.createElement('select') : document.createElement('input');
    input.id = 'field-' + i;
    if (f.kind === 'choice') for (const v of f.values) input.append(new Option(v, v));
    else Object.assign(input, { type: 'text', inputMode: 'numeric', value: String(f.min), placeholder: f.min + ' to ' + f.max });
    label.append(input);
    $('fields').append(label);
  }
}

/** The request as the judge's numbers, or null when a value is not one the field holds. */
function values(record) {
  const out = [];
  for (const [i, f] of record.fields.entries()) {
    const raw = $('field-' + i).value;
    if (f.kind === 'choice') { const at = f.values.indexOf(raw); if (at < 0) return null; out.push(at); continue; }
    if (!/^(0|[1-9][0-9]{0,9})$/.test(raw)) return null;
    const n = Number(raw);
    if (n < f.min || n > f.max) return null;
    out.push(n);
  }
  return out;
}

/**
 * Lean's kernel, here: every guarantee is written as kernel terms and judged in this page. The kernel, its loader and
 * its library are used only when their bytes have the addresses the manifest names. A guarantee this browser's kernel
 * already accepted is not judged again when reuseAdmits allows it: the same key, kernel, library and proof bytes.
 * When every guarantee is found, the kernel is not fetched or opened at all. Resolves { accepted, reused }.
 */
async function prove(record) {
  const manifest = await (await fetch('./kernel/manifest.json', { cache: 'no-store' })).json();
  const pinned = { kernel: 'sha256:' + manifest.wasm.sha256, library: 'sha256:' + manifest.library.sha256 };
  const keys = record.guarantees.map((guarantee) => {
    const statement = guaranteeStatement(record.words, guarantee);
    return { statement, key: derivationKey(PROOF_SCHEMA, [pinned.kernel, pinned.library, statement]) };
  });
  const found = await Promise.all(keys.map(({ key }) => findProof(store, { key, kernel: pinned.kernel, library: pinned.library })));
  const reusable = found.map((f) => reuseAdmits(f.facts));
  const holds = (axioms) => Array.isArray(axioms) && axioms.every((a) => KERNEL_AXIOMS.includes(a));
  if (reusable.every(Boolean)) return { accepted: found.map((f) => holds(f.proof.axioms)), reused: found.length };
  const file = (entry) => named('sha256:' + entry.sha256, async () => unpack(await fetch('./kernel/' + entry.file, { cache: 'no-store' })));
  const [glue, wasm, library] = await Promise.all([manifest.glue, manifest.wasm, manifest.library].map(file));
  const [g, w, l] = (await Promise.all([glue, wasm, library].map(sha256))).map((label) => label.slice(7));
  if (g !== manifest.glue.sha256 || w !== manifest.wasm.sha256 || l !== manifest.library.sha256) throw new Error('the kernel, its loader or its library is not the pinned one');
  const b = manifest.binding;
  if (!b || b.kernel !== w || b.loader !== g || b.library !== l) throw new Error('there is no record that this kernel judged this library whole');
  const said = [];
  const url = URL.createObjectURL(new Blob([glue], { type: 'text/javascript' }));
  let module;
  try {
    module = await (await import(url)).default({ instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasm, imports).then((r) => done(r.instance, r.module)); return {}; }, print: (s) => said.push(s), printErr: (s) => said.push(s) });
  } finally { URL.revokeObjectURL(url); }
  const run = (entry, bytes) => {
    said.length = 0;
    module.FS.writeFile('/in.ndjson', bytes);
    let exit;
    try { exit = module.ccall(entry, 'number', ['string'], ['/in.ndjson']); } catch (error) { exit = 3; }
    module.FS.unlink('/in.ndjson');
    const axioms = {};
    for (const line of said) { const a = /^axioms ([^:]+): ?(.*)$/.exec(line); if (a) axioms[a[1]] = a[2] ? a[2].split(', ') : []; }
    return { exit, axioms };
  };
  if (module.ccall('checker_ready', 'number', [], []) !== 0) throw new Error('the kernel did not start');
  if (run('load_library', library).exit !== 0) throw new Error('the kernel refused its library');
  const lib = readLibrary(dec.decode(library));
  const accepted = [];
  for (const [i, guarantee] of record.guarantees.entries()) {
    if (reusable[i]) { accepted.push(holds(found[i].proof.axioms)); continue; }
    const text = proofLines(lib, record.words, guarantee);
    const r = run('check_suffix', enc.encode(text));
    const axioms = r.axioms[HOLDS] || null;
    // Only an accepted proof is kept: a refusal carries no bytes that could be checked again.
    if (r.exit === 0 && axioms !== null) await keepProof(store, { key: keys[i].key, kernel: 'sha256:' + w, library: 'sha256:' + l, statement: keys[i].statement, text, axioms });
    accepted.push(r.exit === 0 && holds(axioms));
  }
  return { accepted, reused: reusable.filter(Boolean).length };
}

const app = await open();
window.prismRuleApp = { facts: app.facts, address: app.address, admitted: admits(app.facts), kernelChecked: kernelChecked(app.facts), vectors: null, proved: null, answers: [] };
$('title').textContent = app.record.title || app.record.name;
if (!admits(app.facts)) {
  say('status', 'This page was altered and will not answer: its record, its rule judge or its proof is not the one it names.', 'refused');
} else {
  const prefix = 'rule ' + app.record.words.map(hexWord).join('');
  const ask = async (numbers) => {
    const wellFormed = numbers ? 1 : 0;
    let outcome;
    if (numbers) {
      const reply = dec.decode(await app.kernel.dispatch(enc.encode(prefix + numbers.map(hexWord).join(''))));
      outcome = /^ok [0-9a-f]{24}$/.test(reply) ? app.record.outcomes[readWord(reply.slice(11, 19))] : undefined;
    }
    const kind = answerKind(wellFormed, wellFormed, outcome === undefined ? 0 : 1);
    return kind === ANSWER.outcome ? outcome : kind === ANSWER.invalid ? 'invalid' : null;
  };
  // The record's own vectors that are requests inside the bounds, through the judge, before anything is answered.
  let passed = 0, total = 0;
  for (const v of app.record.vectors) {
    const text = dec.decode(Uint8Array.from(v.request.match(/../g) || [], (h) => parseInt(h, 16)));
    const want = dec.decode(Uint8Array.from(v.response.match(/../g) || [], (h) => parseInt(h, 16)));
    const parts = text.split(' ');
    if (want === 'invalid' || parts.length !== app.record.fields.length) continue;
    const numbers = app.record.fields.map((f, i) => (f.kind === 'choice' ? f.values.indexOf(parts[i]) : Number(parts[i])));
    total++;
    if ((await ask(numbers)) === want) passed++;
  }
  window.prismRuleApp.vectors = { passed, total };
  if (passed !== total) {
    say('status', 'This page will not answer: ' + (total - passed) + ' of ' + total + ' of its own examples fail through the rule judge.', 'refused');
  } else {
    form(app.record);
    const count = app.record.guarantees.length;
    const tail = passed + ' of ' + total + ' examples pass. Nothing you enter leaves this page.';
    say('status', 'Proving ' + count + ' guarantee' + (count === 1 ? '' : 's') + ' here with Lean\\'s kernel. ' + tail, 'unchecked');
    say('address', app.address);
    $('ask').hidden = false;
    // The page takes nobody's word for the proof: it proves every guarantee itself, after the form is on screen.
    // A timer and not an animation frame: a page opened in a background tab must still finish its proof.
    setTimeout(async () => {
      const started = performance.now();
      try {
        const { accepted, reused } = await prove(app.record);
        const all = accepted.every(Boolean);
        window.prismRuleApp.proved = { accepted, reused, ms: Math.round(performance.now() - started) };
        const earlier = reused === 0 ? '' : (reused === count ? 'All' : reused + ' of them') + ' were proved on an earlier visit, under this same kernel and library, and are not proved again. ';
        say('status', (all ? 'Proved here by Lean\\'s kernel, in this browser: ' + count + ' guarantee' + (count === 1 ? ' holds' : 's hold') + ' for every request in the bounds. ' + earlier : 'Lean\\'s kernel, in this browser, did not accept ' + accepted.filter((a) => !a).length + ' of ' + count + ' guarantees. ') + tail, all ? 'checked' : 'refused');
      } catch (error) {
        window.prismRuleApp.proved = { error: String(error && error.message ? error.message : error) };
        say('status', 'Lean\\'s kernel could not run in this browser, so the guarantees are not proved here. ' + tail, 'unchecked');
      }
    }, 50);
    $('ask').addEventListener('submit', async (event) => {
      event.preventDefault();
      const answer = await ask(values(app.record));
      window.prismRuleApp.answers.push(answer);
      say('answer', answer === null ? 'The rule judge gave no answer.' : answer, answer === null ? 'fault' : 'answered');
    });
  }
}
window.prismRuleApp.ready = true;
`;
}

function indexHtml(record) {
  const title = escapeHtml(record.title || record.name);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { color-scheme: light dark; --ink: #1c1b1a; --paper: #faf9f7; --line: #d9d5cf; --mute: #6b665f; --good: #1f6f4a; --bad: #9c2b2b; }
@media (prefers-color-scheme: dark) { :root { --ink: #ece9e4; --paper: #171615; --line: #3a3733; --mute: #a39d94; --good: #6fcf9f; --bad: #f08a8a; } }
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 34rem; margin: 0 auto; padding: 2.5rem 1rem; }
h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
#status { color: var(--mute); margin: 0 0 1.5rem; }
#status[data-state="checked"] { color: var(--good); }
#status[data-state="refused"] { color: var(--bad); }
form { display: grid; gap: 0.75rem; }
label { display: grid; gap: 0.25rem; font-size: 0.875rem; color: var(--mute); }
input, select, button { font: inherit; padding: 0.5rem 0.625rem; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--ink); }
button { cursor: pointer; justify-self: start; }
#answer { font-size: 1.25rem; min-height: 1.875rem; margin: 1.25rem 0 0; }
#address { color: var(--mute); font: 0.75rem/1.4 ui-monospace, monospace; overflow-wrap: anywhere; margin-top: 2rem; }
</style>
</head>
<body>
<main>
<h1 id="title">${title}</h1>
<p id="status">Checking the app before it answers.</p>
<form id="ask" hidden><div id="fields" style="display: grid; gap: 0.75rem"></div><button type="submit">Decide</button></form>
<output id="answer" for="ask"></output>
<p id="address"></p>
</main>
<script type="module" src="./start.mjs"></script>
</body>
</html>
`;
}

/**
 * Write the page's folder for a record. The same record gives the same files.
 * Returns `{ directory, files }`, the files relative to the folder, sorted.
 */
export function writeRuleAppSite(directory, recordBytes, { holo = null } = {}) {
  const record = JSON.parse(new TextDecoder().decode(recordBytes));
  rmSync(directory, { recursive: true, force: true });
  const files = new Map([
    ['index.html', Buffer.from(indexHtml(record))],
    ['start.mjs', Buffer.from(startScript())],
    ['app.rule-app.json', Buffer.from(recordBytes)],
    ['kernel.holo', Buffer.from(holo ?? pinnedHolo())],
  ]);
  for (const file of browserClosure()) files.set(`prism-code/src/${file}`, readFileSync(join(SRC, file)));
  // Lean's kernel, its library and the writer of the proof terms, so the page proves the guarantees itself.
  for (const name of ['kernel-terms.mjs', 'kappa-rules.mjs', 'kappa-opfs.mjs']) files.set(`prism-code/src/journey/${name}`, readFileSync(join(SRC, 'journey', name)));
  files.set('kernel/manifest.json', readFileSync(join(SRC, 'journey', 'kernel', 'manifest.json')));
  for (const name of ['lean-kernel.mjs.gz', 'lean-kernel.wasm.gz', 'library.ndjson.gz']) files.set(`kernel/${name}`, Buffer.from(readKernelFile(name)));
  for (const [path, bytes] of files) {
    const at = join(directory, path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, bytes);
  }
  return { directory, files: [...files.keys()].sort() };
}
