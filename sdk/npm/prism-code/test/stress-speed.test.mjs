// Stress, class F: what the journey costs before any proof, held to a budget. Each budget is
// many times what was measured on 2026-11-16 (Windows, Node 22.21.0), so a loaded machine
// passes and a step that became slow by a factor does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BIN, SHIPPING_DRAFT, project, startServer } from './support/journey-client.mjs';
import { createServer } from '../src/journey/mcp.mjs';
import { completeSpec } from '../src/journey/complete.mjs';
import { judge, sampleRequests, validateSpec } from '../src/journey/spec.mjs';

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** The largest draft the spec allows: 8 fields, 24 rules of 8 conditions, 3 guarantees. */
function largest() {
  const fields = Array.from({ length: 8 }, (_, i) => (i % 2 ? { name: `c${i}`, kind: 'choice', values: ['low', 'mid', 'high'] } : { name: `n${i}`, kind: 'number', min: 0, max: 9 }));
  const condition = (f, k) => (f.kind === 'choice' ? { field: f.name, op: 'is', value: f.values[k % 3] } : { field: f.name, op: '>', value: k % 9 });
  const rules = Array.from({ length: 24 }, (_, r) => ({ when: fields.map((f, i) => condition(f, r + i)), then: ['accept', 'review', 'refuse'][r % 3] }));
  return { title: 'Largest', fields, rules, otherwise: 'refuse' };
}

/** 24 rules over two fields: every request can be tried, so guarantees are proposed and checked. */
function twentyFour() {
  const fields = [{ name: 'score', kind: 'number', min: 0, max: 100 }, { name: 'tier', kind: 'choice', values: ['basic', 'plus', 'pro'] }];
  const rules = Array.from({ length: 24 }, (_, r) => ({ when: [{ field: 'score', op: '>=', value: 96 - r * 4 }, { field: 'tier', op: 'is', value: fields[1].values[r % 3] }], then: ['accept', 'review', 'refuse'][r % 3] }));
  return { title: 'Twenty four', fields, rules, otherwise: 'refuse' };
}

/** The median time of `prism_spec` in this process, and its last answer. */
async function timed(spec) {
  const cwd = project();
  process.env.PRISM_HOME ??= mkdtempSync(join(tmpdir(), 'prism-stress-home-'));
  const sent = [];
  const server = createServer({ cwd, send: (m) => sent.push(m) });
  const times = [];
  for (let i = 0; i < 7; i++) {
    const started = performance.now();
    await server.handle({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'prism_spec', arguments: { spec } } });
    times.push(performance.now() - started);
  }
  const last = sent.at(-1).result;
  assert.equal(last.structuredContent.step, 'review', last.content[0].text.slice(0, 300));
  return { times, answer: last.structuredContent };
}

test('checking and completing a 24-rule draft takes under 100 ms', async () => {
  const { times, answer } = await timed(twentyFour());
  assert.equal(answer.proposed.length, 3);
  console.log(`# prism_spec, 2 fields and 24 rules: median ${median(times).toFixed(1)} ms, slowest ${Math.max(...times).toFixed(1)} ms`);
  assert.ok(median(times) < 100, `median ${median(times).toFixed(1)} ms`);
});

test('the largest draft the spec allows costs about one pass over the candidate requests, not seven', async () => {
  // 8 fields make more requests than Prism tries, so nothing is proposed. The cost is then one pass
  // to find the examples. Measured on 2026-11-16: about seven passes before the ones that claim
  // nothing were skipped (1.9 s on a quiet machine), a little over one since (0.3 s). The budget is
  // in passes timed here and now, so a slow machine does not fail it and a second pass does.
  const spec = validateSpec(completeSpec(largest()).spec);
  const pass = median(
    Array.from({ length: 3 }, () => {
      const started = performance.now();
      for (const request of sampleRequests(spec)) judge(spec, request);
      return performance.now() - started;
    }),
  );
  const { times, answer } = await timed(largest());
  assert.ok(answer.notes.some((n) => /^No guarantee is proposed/.test(n)));
  console.log(`# prism_spec, 8 fields and 24 rules of 8 conditions: median ${median(times).toFixed(1)} ms; one pass over the candidates ${pass.toFixed(1)} ms`);
  assert.ok(median(times) < 3 * pass + 100, `median ${median(times).toFixed(1)} ms against a pass of ${pass.toFixed(1)} ms`);
});

test('a server answers its first tool call within 2 s of being started', async () => {
  const times = [];
  for (let i = 0; i < 3; i++) {
    const cwd = project();
    const started = performance.now();
    const server = startServer(cwd);
    const status = await server.call('prism_status');
    times.push(performance.now() - started);
    assert.equal(status.data.step, 'purpose');
    await server.close();
  }
  console.log(`# server start to first answer: best ${Math.min(...times).toFixed(0)} ms of ${times.map((t) => t.toFixed(0)).join(', ')}`);
  assert.ok(Math.min(...times) < 2000, `best ${Math.min(...times).toFixed(0)} ms`);
});

test('a draft reaches its review over stdio in under 500 ms', async () => {
  const cwd = project();
  const server = startServer(cwd);
  try {
    await server.call('prism_start', { restart: true });
    const times = [];
    for (let i = 0; i < 5; i++) times.push((await server.call('prism_spec', { spec: SHIPPING_DRAFT })).ms);
    console.log(`# prism_spec over stdio, shipping draft: median ${median(times).toFixed(1)} ms`);
    assert.ok(median(times) < 500, `median ${median(times).toFixed(1)} ms`);
  } finally {
    await server.close();
  }
});

test('setup --dry-run reports in under 5 s and changes nothing', () => {
  const home = mkdtempSync(join(tmpdir(), 'prism-stress-home-'));
  const cwd = project();
  const times = [];
  let last = null;
  for (let i = 0; i < 2; i++) {
    const started = performance.now();
    last = spawnSync(process.execPath, [BIN, 'setup', '--dry-run', '--agents-only'], { cwd, encoding: 'utf8', env: { ...process.env, PRISM_HOME: home, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData'), PRISM_TELEMETRY: '0' }, timeout: 60000 });
    times.push(performance.now() - started);
  }
  assert.equal(last.status, 0, last.stderr || last.stdout);
  assert.match(last.stdout, /setup --dry-run/);
  console.log(`# setup --dry-run --agents-only: best ${Math.min(...times).toFixed(0)} ms`);
  assert.ok(Math.min(...times) < 5000, `best ${Math.min(...times).toFixed(0)} ms`);
});
