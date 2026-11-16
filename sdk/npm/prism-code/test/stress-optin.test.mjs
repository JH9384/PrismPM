// Stress, classes G and H: what needs a model, or Docker and the SDK image. Neither runs unless asked for.
//
//   G  PRISM_STRESS_CHAT_URL=<an OpenAI-style chat completions endpoint> PRISM_STRESS_CHAT_MODEL=<model id>
//      [PRISM_STRESS_CHAT_KEY=<bearer key>] [PRISM_STRESS_CHAT_ORIGIN=<origin header>] [PRISM_STRESS_SENTENCES=<count>]
//      A plain-prompt model writes a draft for each sentence from the server's own instructions, with no
//      other help, and the real server checks it. It reports first-time acceptance and time; it asserts
//      only that nothing breaks. Measured on 2026-11-15 with Qwen3 30B: 10 of 40 on 0.9.1, 33 of 40 since.
//
//   H  PRISM_STRESS_BUILD=1, with Docker and the SDK image present and memory to spare.
//      One draft is built in two projects and rebuilt in place: the three holos are the same bytes,
//      and each is held to its own spec and refused under another. A build takes ten minutes or more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIN, FIXTURES, SHIPPING_DRAFT, project, startServer, until } from './support/journey-client.mjs';
import { INSTRUCTIONS } from '../src/journey/mcp.mjs';
import { DRAFT_JSON_SCHEMA } from '../src/journey/spec-schema.mjs';

const chat = process.env.PRISM_STRESS_CHAT_URL;
const model = process.env.PRISM_STRESS_CHAT_MODEL;

test('G: a plain-prompt model drafts from the server instructions alone', { skip: chat && model ? false : 'set PRISM_STRESS_CHAT_URL and PRISM_STRESS_CHAT_MODEL to run it', timeout: 30 * 60 * 1000 }, async () => {
  const sentences = Object.entries(JSON.parse(readFileSync(join(FIXTURES, 'sentences.json'), 'utf8'))).slice(0, Number(process.env.PRISM_STRESS_SENTENCES ?? 40));
  const cwd = project();
  const server = startServer(cwd);
  const rows = [];
  try {
    for (const [id, sentence] of sentences) {
      const started = performance.now();
      const response = await fetch(chat, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(process.env.PRISM_STRESS_CHAT_KEY ? { authorization: `Bearer ${process.env.PRISM_STRESS_CHAT_KEY}` } : {}), ...(process.env.PRISM_STRESS_CHAT_ORIGIN ? { origin: process.env.PRISM_STRESS_CHAT_ORIGIN } : {}) },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: `${INSTRUCTIONS}\nAnswer with the prism/spec/1 draft as one compact JSON object and nothing else.` },
            { role: 'user', content: sentence },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'prism_spec_draft', schema: DRAFT_JSON_SCHEMA, strict: true } },
        }),
      });
      assert.equal(response.ok, true, `${id}: the endpoint answered ${response.status}`);
      const text = (await response.json()).choices[0].message.content;
      const seconds = (performance.now() - started) / 1000;
      await server.call('prism_start', { restart: true });
      const checked = await server.call('prism_spec', { spec: text });
      assert.equal(checked.error, null, `${id}: the server failed on what the model wrote: ${checked.text.slice(0, 300)}`);
      rows.push({ id, ok: checked.data?.step === 'review' && !checked.data.issue, seconds, why: checked.isError ? checked.text.slice(0, 120) : (checked.data.issue ?? '') });
      // The endpoint used on 2026-11-15 allows 20 requests a minute.
      await new Promise((done) => setTimeout(done, 3200));
    }
  } finally {
    await server.close();
  }
  const accepted = rows.filter((r) => r.ok).length;
  const times = rows.map((r) => r.seconds).sort((a, b) => a - b);
  console.log(`# ${model}: ${accepted} of ${rows.length} drafts accepted first time; median ${times[Math.floor(times.length / 2)].toFixed(1)} s, slowest ${times.at(-1).toFixed(1)} s`);
  for (const r of rows.filter((x) => !x.ok)) console.log(`#   ${r.id}: ${r.why}`);
});

test('H: one draft built in two projects, and rebuilt in place, gives one holo, bound to its spec', { skip: process.env.PRISM_STRESS_BUILD === '1' ? false : 'set PRISM_STRESS_BUILD=1 to run it (Docker, the SDK image, ten minutes or more a build)', timeout: 4 * 60 * 60 * 1000 }, async () => {
  const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const build = async (cwd, spec, { overwrite = false } = {}) => {
    const server = startServer(cwd);
    try {
      if (spec) {
        await server.call('prism_start', { restart: true });
        assert.equal((await server.call('prism_spec', { spec })).data.step, 'review');
        await server.call('prism_answer', { answer: 'yes' });
      }
      const { answer } = await until(server, 'prism_build', { wait: 60, overwrite }, { tries: 400, pauseMs: 1000 });
      // An environment that stopped is this machine's failure, not a result: say so and stop.
      assert.notEqual(answer.data.interrupted, true, `the build environment stopped: ${answer.data.message}`);
      assert.equal(answer.data.ok, true, answer.text);
      assert.equal(answer.data.vectors.passed, answer.data.vectors.total);
      return answer.data;
    } finally {
      await server.close();
    }
  };
  const one = project();
  const two = project();
  const other = project();
  const first = await build(one, SHIPPING_DRAFT);
  const second = await build(two, SHIPPING_DRAFT);
  assert.equal(sha(second.holo), sha(first.holo), 'two projects, one holo');
  assert.equal(second.spec.specAddress, first.spec.specAddress);
  // Rebuilt in place, from nothing.
  writeFileSync(join(one, 'prism', 'session.json'), readFileSync(join(one, 'prism', 'session.json'), 'utf8').replace(/"lastBuild"/, '"previousBuild"'));
  const again = await build(one, null, { overwrite: true });
  assert.equal(sha(again.holo), sha(first.holo), 'rebuilt in place, the same holo');
  // A different spec is a different app, and each holo answers only to its own spec.
  const changed = structuredClone(SHIPPING_DRAFT);
  changed.rules[1].when[0].value = 21;
  const third = await build(other, changed);
  assert.notEqual(sha(third.holo), sha(first.holo));
  const check = (holo, spec) => spawnSync(process.execPath, [BIN, 'check', holo, '--spec', spec, '--policy', join(one, 'prism', 'run-policy.json')], { encoding: 'utf8' });
  assert.match(check(first.holo, join(one, 'prism', 'spec.json')).stdout, /spec\s+ok/);
  assert.match(check(first.holo, join(other, 'prism', 'spec.json')).stdout, /spec\s+failed\s+The holo was built from another spec/);
  assert.match(check(third.holo, join(one, 'prism', 'spec.json')).stdout, /spec\s+failed/);
});
