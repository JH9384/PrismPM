// A rule app's page: static files written with the app, that check it in the browser before it answers (issue #692).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/journey/session.mjs';
import { appDir, readSession } from '../src/journey/project.mjs';
import { build } from '../src/journey/engine.mjs';
import { RULE_JUDGE_HOLO, admits, answerKind, greatestAt, kernelChecked, leastAt, rulesAt } from '../src/journey/rule-app.mjs';
import { browserClosure, writeRuleAppSite } from '../src/journey/rule-app-site.mjs';

process.env.PRISM_HOME = mkdtempSync(join(tmpdir(), 'prism-home-'));
process.env.PRISM_KERNEL_DIR = fileURLToPath(new URL('./fixtures/kernel/', import.meta.url));

const PARKING = {
  purpose: 'Parking fee tier: decide the parking fee tier for a vehicle from the hours parked and the vehicle type.',
  fields: 'hours: number 0..24, vehicle: car|motorcycle|truck',
  outcomes: 'free, standard, premium',
  rules: 'when hours = 0 then free\nwhen vehicle is motorcycle then free\nwhen vehicle is truck then premium\nwhen hours > 8 then premium\notherwise standard',
  properties: 'never when vehicle is motorcycle then premium',
  examples: '0 car -> free\n3 car -> standard\n10 car -> premium',
};
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('the files a page needs are the ones a browser can run: nothing that needs Node itself', () => {
  const files = browserClosure();
  assert.ok(files.includes('browser.mjs') && files.includes('index.mjs') && files.includes('core.mjs') && files.includes('uorc.mjs'));
  for (const file of files) {
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(!/\bfrom\s*['"]node:/.test(text), `${file} imports Node`);
  }
  assert.ok(!files.some((f) => f.startsWith('journey/') || f === 'node.mjs'));
  assert.deepEqual(files, [...files].sort());
});

test('a build writes the page beside the app, and the page carries the record, the judge and the package\'s own rules', { timeout: 120000 }, async () => {
  const dir = appDir(mkdtempSync(join(tmpdir(), 'prism-rule-app-site-')));
  const session = { ...readSession(dir), spec: compile({ ...PARKING, review: 'yes' }).spec, axioms: {}, status: {} };
  const r = await build(dir, session, { env: {} });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.site, join(dir, '.prism', 'site'));
  assert.equal(session.status.ruleApp.site, r.site);
  assert.match(r.message, /Its page is the folder .*site: static files any host serves, which check the app in the browser before it answers\./);
  const at = (file) => readFileSync(join(r.site, file));
  // The record and the judge are the very bytes the build named.
  assert.equal(sha(at('app.rule-app.json')), r.address);
  assert.equal(sha(at('kernel.holo')), RULE_JUDGE_HOLO);
  for (const file of browserClosure()) assert.deepEqual(at(`prism-code/src/${file}`), readFileSync(new URL(`../src/${file}`, import.meta.url)), file);
  // Planted defect P1: the page decides with the package's own functions, by their source, not a second writing of them.
  const script = at('start.mjs').toString('utf8');
  for (const fn of [admits, kernelChecked, answerKind, leastAt, greatestAt, rulesAt]) assert.ok(script.includes(fn.toString()), fn.name);
  assert.match(script, /if \(!admits\(app\.facts\)\) \{\s*say\('status', 'This page was altered and will not answer/);
  // It asks for its own files only: no address outside its folder is in the page or its script.
  const html = at('index.html').toString('utf8');
  assert.ok(!/https?:\/\//.test(html + script));
  assert.match(html, /<title>Parking fee tier<\/title>/);
  assert.match(html, /<script type="module" src="\.\/start\.mjs"><\/script>/);
  // The same record gives the same files, byte for byte.
  const again = writeRuleAppSite(join(dir, '.prism', 'site-again'), at('app.rule-app.json'));
  for (const file of again.files) assert.deepEqual(readFileSync(join(again.directory, file)), at(file), file);
  assert.equal(again.files.length, 4 + browserClosure().length + 5);
  // Planted defect P2: the page proves the guarantees itself. It carries Lean's kernel and library, the pinned bytes,
  // and the same writer of proof terms this package runs, and it does not take the record's word for the proof.
  const manifest = JSON.parse(at('kernel/manifest.json'));
  for (const name of [manifest.glue.file, manifest.wasm.file, manifest.library.file]) assert.deepEqual(at(`kernel/${name}`), readFileSync(new URL(`./fixtures/kernel/${name}`, import.meta.url)), name);
  assert.deepEqual(at('prism-code/src/journey/kernel-terms.mjs'), readFileSync(new URL('../src/journey/kernel-terms.mjs', import.meta.url)));
  assert.ok(!/\bfrom\s*['"]node:/.test(at('prism-code/src/journey/kernel-terms.mjs').toString('utf8')));
  assert.match(script, /import \{ HOLDS, KERNEL_AXIOMS, proofLines, readLibrary \} from '\.\/prism-code\/src\/journey\/kernel-terms\.mjs';/);
  assert.match(script, /const accepted = await prove\(app\.record\);/);
  assert.match(script, /'Proved here by Lean\\'s kernel, in this browser: '/);
  assert.match(script, /if \(g !== manifest\.glue\.sha256 \|\| w !== manifest\.wasm\.sha256 \|\| l !== manifest\.library\.sha256\) throw/);
  // Before its own proof is done the page says it is proving, never that anything is proved.
  assert.ok(!script.includes("'Checked by Lean"));
});

test('a title cannot write markup into the page, and an app whose guarantee fails gets no page', { timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-rule-app-site-title-'));
  const record = { title: '<script>alert(1)</script> & "more"', name: 'x', fields: [], words: [], guarantees: [], vectors: [], outcomes: [], kernel: { holo: RULE_JUDGE_HOLO }, proof: null, schema: 'prism/rule-app/1' };
  const { directory } = writeRuleAppSite(join(dir, 'site'), Buffer.from(JSON.stringify(record)));
  const html = readFileSync(join(directory, 'index.html'), 'utf8');
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;more&quot;'));

  const app = appDir(mkdtempSync(join(tmpdir(), 'prism-rule-app-site-false-')));
  const spec = compile({ ...PARKING, review: 'yes' }).spec;
  const session = { ...readSession(app), spec: { ...spec, rules: spec.rules.map((rule, i) => (i === 1 ? { ...rule, then: 'premium' } : rule)) }, axioms: {}, status: {} };
  const r = await build(app, session, { env: {}, overwrite: true });
  assert.equal(r.ok, false);
  assert.equal(existsSync(join(app, '.prism', 'site')), false);
});
