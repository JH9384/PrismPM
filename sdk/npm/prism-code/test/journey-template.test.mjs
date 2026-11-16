// The guided journey's template instance: the canonical layout of the generated LexLean,
// and the files that make the app an instance of UOR-Foundation/template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compile } from '../src/journey/session.mjs';
import { WIDTH, declarationText, renderModel, renderProofs } from '../src/journey/render.mjs';
import { appJson, claims, conformanceText, featureText, idPrefix, idsToml, lexleanLockText, liveUrl, rustTestText, suiteOf } from '../src/journey/template.mjs';

const SPECS = {
  payment: {
    purpose: 'Payment approval: decide whether a payment request is approved.',
    fields: 'role: clerk|manager, amount: number at least 1, limit: number',
    outcomes: 'approved, refused',
    rules: 'when role is manager then approved\nwhen amount is at most limit then approved\notherwise refused',
    properties: 'never when role is clerk and amount > limit then approved\nalways when role is manager then approved',
    examples: 'clerk 250 1000 -> approved\nclerk 1001 1000 -> refused',
  },
  shipping: {
    purpose: 'Shipping tier: choose how an order ships from its weight, distance and membership.',
    fields: 'membership: none|silver|gold|platinum, weight: number at least 1, distance: number at least 1, items: number at least 1',
    outcomes: 'standard, express, freight, refused',
    rules: 'when weight > 30000 then freight\nwhen membership is platinum then express\nwhen membership is gold and distance is at most 500 then express\nwhen items > 50 then refused\notherwise standard',
    properties: 'always when weight > 30000 then freight\nnever when weight > 30000 then express\nnever when membership is none and weight is at most 30000 and items is at most 50 then express',
    examples: 'gold 1200 300 2 -> express\nnone 1200 300 2 -> standard\nplatinum 40000 10 1 -> freight\nsilver 100 100 60 -> refused',
  },
  door: {
    purpose: 'Door: open the door only for a badge on the list.',
    fields: 'badge: guest|staff',
    outcomes: 'open, closed',
    rules: 'when badge is staff then open\notherwise closed',
    properties: 'never when badge is guest then open',
    examples: 'staff -> open\nguest -> closed',
  },
};
const specOf = (name) => compile({ ...SPECS[name], review: 'yes' }).spec;
const sha = (text) => createHash('sha256').update(text).digest('hex');

// Each pair was written to a project and found unchanged by `lexlean fmt --all` in the SDK image
// prismpm-sdk-candidate@sha256:cd3b47d7… on 2026-11-09. A renderer change that moves a digest needs that
// check again (the template's gate runs `lexlean fmt --check`), then the new digest here.
const CANONICAL = {
  payment: ['48189fe3dd81333e9300d2e82b33ee31698b16439b5fff587251ce129093dd25', 'b7002a55a9f3123026f1d3ea5f89ce62da8f45141460784d8cece7a8bd9543f8'],
  shipping: ['9fcb9a40a788a4f5b7eb5137ddca1c30a40a211d8f29752d83aaaf83ebd7ef96', '54a3d324beedb8fa1e6d1e0bacd33d62e6f99e1f09426ba86ef8e21c55bc49f4'],
  door: ['d72d6c299ee977e35149c7cdbba7800a92dab9596f5cb4754fa42b8846828332', 'e56b0b825ea4469ba1eb33d7563e070c5c09f8757d1c424f029ea063141385dd'],
};

test('the model and proofs are the bytes lexlean fmt leaves unchanged, for three specs of different shapes', () => {
  for (const [name, [model, proofs]] of Object.entries(CANONICAL)) {
    const spec = specOf(name);
    assert.equal(sha(renderModel(spec)), model, `${name}: the model's layout changed; check it with lexlean fmt --check`);
    assert.equal(sha(renderProofs(spec)), proofs, `${name}: the proofs' layout changed; check it with lexlean fmt --check`);
  }
});

test('a record or list stays on one line up to the width, breaks one entry per line past it, and a term never breaks', () => {
  assert.equal(WIDTH, 100);
  const fields = (k) => Array.from({ length: k }, (_, i) => `{name: f${i}, type: Nat}`);
  // Two leading spaces and `fields: [...]` with no comma: find a count whose line lands near the width.
  const line = (k) => `  fields: [${fields(k).join(', ')}]`.length;
  const k = [1, 2, 3, 4, 5].find((c) => line(c) <= WIDTH && line(c + 1) > WIDTH);
  const text = (c) => declarationText({ name: 'Request', kind: 'structure', fields: fields(c) });
  assert.match(text(k), new RegExp(`\\n  fields: \\[${fields(k).join(', ').replace(/[[\]{}]/g, '\\$&')}\\]\\n`), 'fits: one line');
  assert.match(text(k + 1), /\n {2}fields: \[\n {4}\{name: f0, type: Nat\},\n/, 'past the width: one entry per line');
  assert.equal(declarationText({ name: 'answerA', kind: 'definition', parameters: [], result: 'Nat', body: '0' }), 'definition{name: answerA, parameters: [], result: Nat, body: 0}');
  const long = `(${'x '.repeat(80)}y)`;
  assert.ok(declarationText({ name: 'f', kind: 'definition', parameters: ['a : Nat'], result: 'Nat', body: long }).includes(`  body: ${long}\n`), 'a term is never broken');
});

test('IDs, suite and test names follow the template meta-gate: two letters, two digits, a test named for its ID', () => {
  const payment = specOf('payment');
  assert.equal(idPrefix(payment), 'PA');
  assert.equal(idPrefix(specOf('door')), 'DO');
  assert.equal(idPrefix({ name: 'custom-match' }), 'CN', 'CM is the meta-gate\'s own rule name');
  assert.equal(suiteOf(payment), 'payment_approval');
  const c = claims(payment);
  assert.deepEqual(c.map((x) => [x.id, x.test, x.theorem]), [['PA-01', 'payment_approval_pa_01', 'inv001Holds'], ['PA-02', 'payment_approval_pa_02', 'inv002Holds']]);
  assert.match(c[0].statement, /^The app never answers approved when /);
  assert.match(c[0].condition, /\(\(project request role\) =\? \(PaymentApproval::roleClerk\)\)/);
});

test('the register, scenarios and CONFORMANCE.md agree, and keep the template\'s own text', () => {
  const spec = specOf('payment');
  const ids = idsToml(spec, '# header\n\nspec = "template/1"\n\n[[id]]\nid = "TC-01"\nlevel = "build"\nsuite = "contract"\nstatement = "x"\n');
  assert.equal(ids, `# header\n\nspec = "template/1"\n\n[[id]]\nid = "PA-01"\nlevel = "build"\nsuite = "payment_approval"\nstatement = ${JSON.stringify(claims(spec)[0].statement)}\n\n[[id]]\nid = "PA-02"\nlevel = "build"\nsuite = "payment_approval"\nstatement = ${JSON.stringify(claims(spec)[1].statement)}\n`);
  const feature = featureText(spec);
  assert.match(feature, /^Feature: payment_approval\n/);
  assert.equal((feature.match(/\n {2}@PA-0[12] @build\n {2}Scenario: /g) ?? []).length, 2);
  const before = '# CONFORMANCE\n\nThe levels.\n\n## contract\n\n| ID | Level | Statement |\n| --- | --- | --- |\n| `TC-01` | `build` | x |\n\n## Cited authorities\n\nNever.\n';
  const after = conformanceText(spec, before);
  assert.equal(after, `# CONFORMANCE\n\nThe levels.\n\n## payment_approval\n\n| ID | Level | Statement |\n| --- | --- | --- |\n| \`PA-01\` | \`build\` | ${claims(spec)[0].statement} |\n| \`PA-02\` | \`build\` | ${claims(spec)[1].statement} |\n\n## Cited authorities\n\nNever.\n`);
});

test('the Rust tests pin each condition and theorem, one test per claim', () => {
  const text = rustTestText(specOf('shipping'));
  assert.equal((text.match(/^#\[test\]\nfn shipping_tier_st_0[1-3]\(\) \{$/gm) ?? []).length, 3);
  assert.match(text, /app\/src\/ShippingTierProofs\.lex\.tex/);
  assert.match(text, /let statement = format!\("statement: \(\(\{breaks\} request\) = false\),"\);/);
  // rustfmt breaks code past 100 columns but leaves a string literal or a comment whole, and the template's
  // gate passed `cargo fmt --check` on this file for this spec.
  for (const line of text.split('\n')) if (!/^ {8}"body: |^\/\/\/ /.test(line)) assert.ok(line.length <= 100, `rustfmt's width: ${line}`);
});

test('lexlean.lock gets the digests of the app\'s project files, and refuses a lock it cannot place them in', () => {
  const zero = '0'.repeat(64);
  const lock = `project_config_sha256 = "${zero}"\n\n[[workspace_file]]\npath = "lake-manifest.json"\nsha256 = "${zero}"\n\n[[workspace_file]]\npath = "lakefile.toml"\nsha256 = "${zero}"\n\n[[workspace_file]]\npath = "lean-toolchain"\nsha256 = "${zero}"\n`;
  const files = { 'lexlean.toml': 'a', 'lake-manifest.json': 'b', 'lakefile.toml': 'c', 'lean-toolchain': 'd' };
  const out = lexleanLockText(lock, files);
  assert.ok(out.includes(`project_config_sha256 = "${sha('a')}"`));
  assert.ok(out.includes(`path = "lakefile.toml"\nsha256 = "${sha('c')}"`));
  assert.throws(() => lexleanLockText('project_config_sha256 = ""\n', files), /no workspace_file/);
});

test('the page describes this app and this repository, and keeps what the template trusts', () => {
  const spec = specOf('payment');
  const app = JSON.parse(appJson(spec, JSON.stringify({ name: 'Template contract', trusted: [{ name: 'SDK image' }], frame: { x: 1 } }), { repository: 'Octo/prism-payment-approval', attestation: 'f'.repeat(64) }));
  assert.equal(app.name, 'Payment approval');
  assert.equal(app.live, 'https://octo.github.io/prism-payment-approval/');
  assert.equal(liveUrl('Octo/prism-payment-approval'), app.live);
  assert.equal(app.repository, 'https://github.com/Octo/prism-payment-approval');
  assert.equal(app.placeholder, 'clerk 250 1000');
  assert.deepEqual(app.answers, { positive: ['approved'], negative: ['refused'], refusal: 'invalid request' });
  assert.equal(app.attestations.proof.id, 'f'.repeat(64));
  assert.deepEqual(app.trusted, [{ name: 'SDK image' }]);
  assert.deepEqual(app.frame, { x: 1 });
  assert.deepEqual(app.theorems.map((t) => t.name), ['inv001Holds', 'inv002Holds']);
});
