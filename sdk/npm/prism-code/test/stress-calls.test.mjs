// Stress, classes A and E: calls an agent gets wrong, and what every failure says.
// The property throughout: a call is answered with a useful result, or with an error that names
// what was wrong and what to send. Never a silent no-op, never a crash, never a change nobody asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHIPPING_DRAFT, fakeDocker, project, startServer, until } from './support/journey-client.mjs';
import { TOOLS, argumentIssue } from '../src/journey/mcp.mjs';
import { STEPS } from '../src/journey/session.mjs';

/** What the project holds, as a caller could tell: the session's answers and the stored spec. */
function state(cwd) {
  const read = (name) => (existsSync(join(cwd, 'prism', name)) ? readFileSync(join(cwd, 'prism', name), 'utf8') : null);
  const session = read('session.json');
  return JSON.stringify({ answers: session ? JSON.parse(session).answers : null, step: session ? JSON.parse(session).step : null, spec: read('spec.json') });
}

/** An error an agent can act on: it is marked as one, and its words say what to do. */
function useful(answer, pattern) {
  assert.equal(answer.isError, true, `expected an error: ${answer.text}`);
  assert.ok(answer.text.trim().length >= 20 && /[.?]$/.test(answer.text.trim()), `the error says too little: ${answer.text}`);
  assert.match(answer.text, pattern);
}

test('a draft passed beside `spec` instead of inside it is refused in words, and nothing changes', async () => {
  const cwd = project();
  const server = startServer(cwd);
  try {
    await server.call('prism_start', { restart: true });
    const before = state(cwd);
    // What an agent does when it takes the spec's members for the tool's arguments (measured on 2026-11-15).
    const flat = await server.call('prism_spec', SHIPPING_DRAFT);
    useful(flat, /prism_spec takes the spec as one argument named `spec`.*It was passed `title`, `fields`, `rules`, `otherwise` beside it, so nothing was read or changed/s);
    assert.equal(state(cwd), before);
    // The same draft where it belongs is taken.
    const right = await server.call('prism_spec', { spec: SHIPPING_DRAFT });
    assert.equal(right.data.step, 'review', right.text);
  } finally {
    await server.close();
  }
});

test('a draft passed as text is the object it spells; anything that is not a spec is refused', async () => {
  const cwd = project();
  const server = startServer(cwd);
  try {
    await server.call('prism_start', { restart: true });
    const text = await server.call('prism_spec', { spec: JSON.stringify(SHIPPING_DRAFT) });
    assert.equal(text.data.step, 'review', text.text);
    const stored = state(cwd);
    for (const spec of [[SHIPPING_DRAFT], 7, true]) useful(await server.call('prism_spec', { spec }), /`spec` must be one JSON object/);
    useful(await server.call('prism_spec', { spec: '{"title": "Shipping", "fields": ' }), /JSON|json/);
    useful(await server.call('prism_spec', { spec: {} }), /rule|field|answer/i);
    assert.equal(state(cwd), stored, 'a refused spec leaves the accepted one in place');
  } finally {
    await server.close();
  }
});

test('every tool refuses an argument it does not take, a wrong type and a missing one, and says what it takes', async () => {
  const cwd = project();
  const server = startServer(cwd);
  try {
    await server.call('prism_start', { restart: true });
    await server.call('prism_spec', { spec: SHIPPING_DRAFT });
    const before = state(cwd);
    for (const tool of TOOLS) {
      const takes = Object.keys(tool.inputSchema.properties);
      const stray = await server.call(tool.name, { colour: 'blue' });
      useful(stray, new RegExp(`${tool.name} does not take \`colour\`\\. ${takes.length ? 'It takes ' : 'It takes no arguments'}`));
      assert.match(stray.text, /Nothing was changed/);
    }
    useful(await server.call('prism_answer', {}), /prism_answer needs `answer`/);
    useful(await server.call('prism_try', {}), /prism_try needs `request`/);
    useful(await server.call('prism_answer', { answer: 7 }), /`answer` must be a string, not the number 7/);
    useful(await server.call('prism_answer', { answer: ['yes'] }), /`answer` must be a string, not a list/);
    useful(await server.call('prism_try', { request: { weight: 5 } }), /`request` must be a string, not an object/);
    useful(await server.call('prism_start', { restart: 'yes' }), /`restart` must be a boolean/);
    useful(await server.call('prism_build', { wait: '45' }), /`wait` must be a number/);
    useful(await server.call('prism_prove', { overwrite: 1 }), /`overwrite` must be a boolean/);
    assert.equal(state(cwd), before, 'no refused call changed the session or the spec');
  } finally {
    await server.close();
  }
});

test('the argument check agrees with every tool schema, and passes what the schema allows', () => {
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} says what it takes`);
    assert.equal(argumentIssue(tool.name, Object.fromEntries((tool.inputSchema.required ?? []).map((k) => [k, 'x']))), null);
  }
  assert.equal(argumentIssue('prism_spec', {}), null);
  assert.equal(argumentIssue('prism_spec', { spec: SHIPPING_DRAFT }), null);
  assert.equal(argumentIssue('prism_build', { wait: 10, overwrite: true, remote: 'github', repository: 'owner/name' }), null);
  assert.match(argumentIssue('prism_status', []), /takes its arguments as one JSON object\. It takes no arguments\./);
  assert.match(argumentIssue('prism_try', null), /takes its arguments as one JSON object/);
});

test('an approval at any step but the review is refused as one, and names no app', async () => {
  const cwd = project();
  const server = startServer(cwd);
  try {
    // Measured on 2026-11-15: "yes" at the first question became the purpose, and the app was called "yes".
    for (const answer of ['yes', 'Yes.', 'ok', 'approve', 'looks good', 'go ahead']) {
      await server.call('prism_start', { restart: true });
      const before = state(cwd);
      const refused = await server.call('prism_answer', { answer });
      assert.equal(refused.data.step, 'purpose');
      assert.match(refused.data.issue, /approves a review, and there is no checked spec to review yet: the step is purpose/);
      assert.equal(refused.data.inferred, undefined);
      assert.equal(state(cwd), before);
    }
    // At each later step too, named or current.
    await server.call('prism_answer', { answer: 'Shipping: decide how a parcel is shipped.' });
    for (const step of STEPS.filter((s) => s !== 'review')) {
      const refused = await server.call('prism_answer', { answer: 'yes', step });
      assert.match(refused.data.issue, new RegExp(`the step is ${step}`), `${step}: ${refused.text}`);
    }
    // And at the review, it approves.
    await server.call('prism_spec', { spec: SHIPPING_DRAFT });
    assert.equal((await server.call('prism_answer', { answer: 'yes' })).data.step, 'ready');
  } finally {
    await server.close();
  }
});

test('tools called out of order say what comes first', async () => {
  const cwd = project();
  const server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'ok', build: 'ok' }) });
  try {
    // Before any session at all.
    for (const tool of ['prism_build', 'prism_prove']) {
      const early = await server.call(tool, { wait: 0 });
      assert.equal(early.data.state, 'blocked');
      assert.match(early.data.message, /The spec is not complete yet\. Next question: What should this app decide\?/);
    }
    assert.match((await server.call('prism_try', { request: '5 domestic' })).data.message, /There is no complete spec yet/);
    assert.equal((await server.call('prism_status')).data.step, 'purpose');
    assert.equal((await server.call('prism_spec')).data.spec, null);
    // With a draft checked and not yet approved: building waits for the approval and says so.
    await server.call('prism_spec', { spec: SHIPPING_DRAFT });
    const unapproved = await server.call('prism_build', { wait: 0 });
    assert.equal(unapproved.data.state, 'blocked');
    assert.match(unapproved.data.message, /Next question: Is this right\?/);
    // A request the spec cannot read is answered invalid, not refused.
    for (const request of ['', '   ', '5', '5 mars', '99999999999999999999 domestic', 'domestic 5', '5  domestic']) {
      const tried = await server.call('prism_try', { request });
      assert.equal(tried.isError, false, tried.text);
      assert.equal(tried.data.answer, 'invalid', `${JSON.stringify(request)}: ${tried.text}`);
    }
    assert.equal((await server.call('prism_try', { request: '5 domestic' })).data.answer, 'standard');
  } finally {
    await server.close();
  }
});

test('very large and hostile inputs are refused by a rule, never by a crash', async () => {
  const cwd = project();
  const server = startServer(cwd);
  try {
    await server.call('prism_start', { restart: true });
    const rule = { when: [{ field: 'weight', op: '>', value: 20 }], then: 'express' };
    const cases = [
      { ...SHIPPING_DRAFT, rules: Array.from({ length: 5000 }, () => rule) },
      { ...SHIPPING_DRAFT, fields: Array.from({ length: 500 }, (_, i) => ({ name: `f${i}`, kind: 'number' })) },
      { ...SHIPPING_DRAFT, title: 'x'.repeat(200000) },
      { ...SHIPPING_DRAFT, fields: [{ name: 'weight', kind: 'number', min: 0, max: 1e308 }, SHIPPING_DRAFT.fields[1]] },
      { ...SHIPPING_DRAFT, fields: [{ name: 'weight', kind: 'number', min: -5, max: 50 }, SHIPPING_DRAFT.fields[1]] },
      { ...SHIPPING_DRAFT, fields: [{ name: 'weight', kind: 'number', min: 0.5, max: 50 }, SHIPPING_DRAFT.fields[1]] },
      { ...SHIPPING_DRAFT, fields: [{ name: '__proto__', kind: 'number' }, SHIPPING_DRAFT.fields[1]] },
      { ...SHIPPING_DRAFT, otherwise: null },
      { ...SHIPPING_DRAFT, rules: 'when weight > 20 then express' },
      { ...SHIPPING_DRAFT, rules: [{ when: [{ field: 'weight', op: '>', value: 20 }], then: 'express', unknown: true }] },
      { ...SHIPPING_DRAFT, title: 'Shipping — method' },
    ];
    for (const spec of cases) {
      const answer = await server.call('prism_spec', { spec });
      assert.equal(answer.error, null, `a JSON-RPC error, not a refusal: ${answer.text.slice(0, 200)}`);
      useful(answer, /./);
      assert.doesNotMatch(answer.text, /TypeError|ReferenceError|Cannot read|undefined is not|\bat \S+ \(/, answer.text.slice(0, 300));
    }
    // A very long answer to a question is refused the same way.
    const long = await server.call('prism_answer', { answer: 'decide '.repeat(60000) });
    assert.equal(long.error, null);
    assert.equal(typeof long.data.issue, 'string');
    // The server is still answering.
    assert.equal((await server.call('prism_spec', { spec: SHIPPING_DRAFT })).data.step, 'review');
  } finally {
    await server.close();
  }
});

test('lines that are not requests are answered as the protocol says, and the server goes on', async () => {
  const cwd = project();
  const server = startServer(cwd);
  try {
    server.raw('this is not JSON');
    server.raw('{"jsonrpc":"2.0","method":"notifications/unknown"}');
    assert.equal((await server.rpc('no/such/method', {})).error.code, -32601);
    assert.match((await server.rpc('tools/call', { name: 'prism_delete_everything', arguments: {} })).error.message, /Unknown tool: prism_delete_everything/);
    assert.match((await server.rpc('tools/call', {})).error.message, /Unknown tool/);
    assert.equal((await server.rpc('resources/read', { uri: 'prism://nothing' })).error.code, -32602);
    assert.equal((await server.rpc('ping', {})).error, undefined);
    assert.deepEqual(server.stray.map((m) => m.error?.code), [-32700]);
    assert.equal((await server.call('prism_status')).data.step, 'purpose');
  } finally {
    await server.close();
  }
});

test('with no Docker at all and nothing set, a rule app is still checked, built and answered from (#692)', async () => {
  const cwd = project();
  const server = startServer(cwd, { env: { PRISM_DOCKER: join(cwd, 'no-such-docker'), PRISM_DOCKER_MOUNT: 'native' } });
  try {
    await server.call('prism_start', { restart: true });
    await server.call('prism_spec', { spec: SHIPPING_DRAFT });
    await server.call('prism_answer', { answer: 'yes' });
    const proved = (await until(server, 'prism_prove')).answer;
    assert.equal(proved.data.ok, true, proved.text);
    assert.equal(proved.data.where, 'kernel');
    assert.ok(proved.data.properties.every((p) => p.status === 'kernel-checked'));
    const built = (await until(server, 'prism_build')).answer;
    assert.equal(built.data.ok, true, built.text);
    assert.equal(built.data.where, 'kernel');
    assert.equal(built.data.vectors.passed, built.data.vectors.total);
    assert.match(built.text, /with no SDK image and nothing compiled/);
    const status = await server.call('prism_status');
    assert.equal(status.data.holo, null);
    assert.equal(status.data.proved, null);
    assert.equal(status.data.ruleApp.address, built.data.address);
    const tried = await server.call('prism_try', { request: SHIPPING_DRAFT.examples?.[0]?.request ?? status.data.ruleApp.address });
    assert.ok(tried.data.from === 'the built app (the rule judge)' || tried.data.answer === 'invalid', tried.text);
  } finally {
    await server.close();
  }
});

test('no failure of a proof or a build comes back without saying what happened and what to do', async () => {
  const outcomes = [];
  // Docker not there at all, for an app that is asked to be proved in the SDK image.
  {
    const cwd = project();
    const server = startServer(cwd, { env: { PRISM_DOCKER: join(cwd, 'no-such-docker'), PRISM_DOCKER_MOUNT: 'native', PRISM_CODE_TIER: 'local' } });
    await server.call('prism_start', { restart: true });
    await server.call('prism_spec', { spec: SHIPPING_DRAFT });
    await server.call('prism_answer', { answer: 'yes' });
    outcomes.push(['no docker, prove', (await until(server, 'prism_prove')).answer]);
    outcomes.push(['no docker, build', (await until(server, 'prism_build')).answer]);
    await server.close();
  }
  // The environment stops, and a step fails.
  for (const [label, plan, tool] of [
    ['prove cut', { prove: 'cut' }, 'prism_prove'],
    ['build cut', { prove: 'ok', build: 'cut' }, 'prism_build'],
    ['build fails', { prove: 'ok', build: 'fail' }, 'prism_build'],
    ['build leaves no holo', { prove: 'ok', build: 'ok' }, 'prism_build'],
  ]) {
    const cwd = project();
    const server = startServer(cwd, { env: fakeDocker(cwd, plan) });
    await server.call('prism_start', { restart: true });
    await server.call('prism_spec', { spec: SHIPPING_DRAFT });
    await server.call('prism_answer', { answer: 'yes' });
    outcomes.push([label, (await until(server, tool)).answer]);
    await server.close();
  }
  for (const [label, answer] of outcomes) {
    assert.equal(answer.isError, true, `${label}: ${answer.text}`);
    const d = answer.data;
    assert.ok(typeof d.message === 'string' && d.message.length >= 40, `${label} says too little: ${d.message}`);
    // What happened is never only "failed": there is a diagnostic, the output's last lines, or a next step.
    const detail = (d.diagnostics?.length ?? 0) > 0 || (typeof d.output === 'string' && d.output.trim().length > 0) || typeof d.next === 'string' || /Run `|Call prism_|sign in|setup/i.test(d.message);
    assert.ok(detail, `${label} gives no way forward: ${answer.text}`);
    assert.doesNotMatch(d.message, /undefined|\[object Object\]/, label);
  }
  // A stopped environment is never called a Prism bug.
  for (const [label, answer] of outcomes.filter(([l]) => /cut/.test(l))) assert.doesNotMatch(answer.text, /Prism bug/, label);
});

test('a GitHub build with nowhere to build asks where at once, and a repository passed to a running build is not silently ignored', async () => {
  // Measured on 2026-11-16: the question came after minutes of proving, and the repository then
  // passed joined that build and was ignored.
  const cwd = project();
  const server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'ok', build: 'ok', buildMs: 3000 }) });
  try {
    await server.call('prism_start', { restart: true });
    await server.call('prism_spec', { spec: SHIPPING_DRAFT });
    await server.call('prism_answer', { answer: 'yes' });
    const asked = await server.call('prism_build', { remote: 'github', wait: 0 });
    assert.equal(asked.data.needs, 'repository', asked.text);
    assert.match(asked.data.message, /it needs a GitHub repository, and there is none yet/);
    assert.ok(asked.ms < 30000, `${asked.ms} ms: no proof was started before asking`);
    assert.equal(existsSync(join(cwd, 'docker.log')), false, 'nothing ran in the image');
    // A local build is running; a call naming a repository is told it is not applied.
    await server.call('prism_build', { wait: 0 });
    const named = await server.call('prism_build', { repository: 'octo/prism-shipping-method', wait: 0 });
    assert.equal(named.data.state, 'running');
    assert.match(named.data.next, /is still running, and octo\/prism-shipping-method is not applied to it\. Call prism_build again with repository octo\/prism-shipping-method once it returns\./);
  } finally {
    await server.close();
  }
});
