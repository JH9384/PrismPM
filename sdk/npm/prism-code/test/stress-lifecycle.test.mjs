// Stress, class D: what the journey does when the server or its build environment goes away under it.
// The real server runs over stdio; a stand-in takes Docker's place (test/support/fake-docker.mjs), so
// nothing here needs Docker, an image or a network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHIPPING_DRAFT, SHIPPING_HOLO, SHIPPING_SEAL, fakeDocker, project, startServer, until } from './support/journey-client.mjs';
import { cutOff, verifiedHolo } from '../src/journey/engine.mjs';

const lines = (cwd) => (existsSync(join(cwd, 'docker.log')) ? readFileSync(join(cwd, 'docker.log'), 'utf8').trim().split('\n').filter(Boolean) : []);
const count = (cwd, word) => lines(cwd).filter((l) => l === word).length;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** Take a project to an approved spec. */
async function approved(server) {
  await server.call('prism_start', { restart: true });
  const review = await server.call('prism_spec', { spec: SHIPPING_DRAFT });
  assert.equal(review.data.step, 'review', review.text);
  const yes = await server.call('prism_answer', { answer: 'yes' });
  assert.equal(yes.data.step, 'ready', yes.text);
}

test('the whole journey runs to a built app, and the stored spec carries the seal the holo was built with', async () => {
  const cwd = project();
  const server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'ok', build: 'ok', holo: SHIPPING_HOLO }) });
  try {
    await approved(server);
    const { answer } = await until(server, 'prism_build');
    assert.equal(answer.data.ok, true, answer.text);
    assert.deepEqual(answer.data.vectors, { passed: 20, total: 20 });
    // The same draft gives the spec 0.9.1 gave: the holo built then still names it.
    assert.deepEqual(answer.data.spec, { sealed: true, specAddress: SHIPPING_SEAL });
    const status = await server.call('prism_status');
    assert.equal(status.data.built.passed, 20);
    assert.deepEqual(status.data.properties, { 'INV-001': 'proved', 'INV-002': 'proved' });
    assert.equal(count(cwd, 'prove'), 1);
    assert.equal(count(cwd, 'build'), 1);
    // Nothing changed, so nothing is built twice.
    const again = await server.call('prism_build', { wait: 0 });
    assert.match(again.data.note, /not built again/);
    assert.equal(count(cwd, 'build'), 1);
  } finally {
    await server.close();
  }
});

test('a server killed between questions, and after the draft, loses nothing', async () => {
  const cwd = project();
  let server = startServer(cwd);
  await server.call('prism_start', { restart: true });
  await server.call('prism_answer', { answer: 'Shipping: decide how a parcel is shipped.' });
  await server.kill();
  server = startServer(cwd);
  const resumed = await server.call('prism_start');
  assert.match(resumed.data.greeting, /^Welcome back/);
  assert.equal(resumed.data.step, 'fields');
  await server.call('prism_spec', { spec: SHIPPING_DRAFT });
  await server.kill();
  server = startServer(cwd);
  try {
    const status = await server.call('prism_status');
    assert.equal(status.data.step, 'review');
    const read = await server.call('prism_spec');
    assert.equal(read.data.spec.title, 'Shipping Method');
    assert.equal(read.data.spec.properties.length, 2);
  } finally {
    await server.close();
  }
});

test('a proof whose environment stops is reported as that, and proving again works', async () => {
  const cwd = project();
  let server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'cut' }) });
  await approved(server);
  const { answer } = await until(server, 'prism_prove');
  assert.equal(answer.isError, true);
  assert.equal(answer.data.interrupted, true);
  assert.deepEqual([answer.data.stage, answer.data.step], ['prove', 'verify']);
  assert.match(answer.data.message, /did not finish: its environment stopped during the verify step/);
  assert.match(answer.data.message, /Nothing is wrong with the spec/);
  assert.match(answer.data.next, /Call prism_prove again/);
  // It is not the spec's fault and not a model the toolchain refused.
  assert.doesNotMatch(answer.text, /Prism bug|toolchain refuses/);
  await server.close();
  server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'ok' }) });
  try {
    const second = await until(server, 'prism_prove');
    assert.equal(second.answer.data.ok, true, second.answer.text);
  } finally {
    await server.close();
  }
});

test('a build whose environment stops is reported as that, its unverified holo is not taken, and building again works', async () => {
  const cwd = project();
  let server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'ok', build: 'cut', holo: SHIPPING_HOLO }) });
  await approved(server);
  const { answer } = await until(server, 'prism_build');
  assert.equal(answer.data.interrupted, true);
  assert.deepEqual([answer.data.stage, answer.data.step], ['build', 'build']);
  assert.match(answer.data.message, /The build did not finish: its environment stopped during the build step/);
  assert.match(answer.data.next, /Call prism_build again/);
  // The holo is on disk, as it was on 2026-11-16, and Prism does not call the app built.
  assert.equal(verifiedHolo(join(cwd, 'prism')), null);
  assert.equal((await server.call('prism_status')).data.built, null);
  await server.close();
  server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'ok', build: 'ok', holo: SHIPPING_HOLO }) });
  try {
    const second = await until(server, 'prism_build');
    assert.equal(second.answer.data.ok, true, second.answer.text);
    assert.equal((await server.call('prism_status')).data.built.total, 20);
  } finally {
    await server.close();
  }
});

test('a build that fails says why: a step that reports its exit is not an interruption', async () => {
  const cwd = project();
  const server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'ok', build: 'fail' }) });
  try {
    await approved(server);
    const { answer } = await until(server, 'prism_build');
    assert.equal(answer.data.ok, false);
    assert.equal(answer.data.interrupted, undefined);
    assert.match(JSON.stringify(answer.data), /PP9999/);
  } finally {
    await server.close();
  }
});

test('a build that finishes after its server was killed is taken, not lost and not built twice', async () => {
  const cwd = project();
  let server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'ok', build: 'ok', buildMs: 2500, holo: SHIPPING_HOLO }) });
  await approved(server);
  // Wait until the build itself runs, then kill the server as a restarted agent does. The build runs on.
  for (let i = 0; i < 100 && count(cwd, 'build') === 0; i++) {
    await server.call('prism_build', { wait: 0 });
    await pause(100);
  }
  assert.equal(count(cwd, 'build'), 1);
  await server.kill();
  server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'ok', build: 'ok', holo: SHIPPING_HOLO }) });
  try {
    const first = await server.call('prism_build', { wait: 0 });
    // Either it is still writing and Prism waits for it, or it has finished and Prism takes it. It is never started again.
    if (first.data.state === 'running') assert.match(first.data.next, /still writing .* though the Prism server that started it has stopped/);
    const { answer } = await until(server, 'prism_build');
    assert.equal(answer.data.ok, true, answer.text);
    assert.match(answer.data.note, /finished after the Prism server that started it had stopped/);
    assert.deepEqual(answer.data.vectors, { passed: 20, total: 20 });
    assert.equal(count(cwd, 'build'), 1, 'the build ran once');
    const status = await server.call('prism_status');
    assert.equal(status.data.built.total, 20);
    assert.ok(existsSync(status.data.holo));
  } finally {
    await server.close();
  }
});

test('a build cut off with its server is started again, and says that it was', async () => {
  const cwd = project();
  let server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'ok', build: 'cut', buildMs: 400 }) });
  await approved(server);
  for (let i = 0; i < 100 && count(cwd, 'build') === 0; i++) {
    await server.call('prism_build', { wait: 0 });
    await pause(50);
  }
  await server.kill();
  // The stand-in build ends by itself, cut; nothing writes any more.
  await pause(800);
  // Its last write was a moment ago, so a new server first waits for it; make the folder look long quiet.
  rmSync(join(cwd, 'prism', '.prism'), { recursive: true, force: true });
  server = startServer(cwd, { env: fakeDocker(cwd, { prove: 'ok', build: 'ok', holo: SHIPPING_HOLO }) });
  try {
    const { answer, seen } = await until(server, 'prism_build');
    assert.equal(answer.data.ok, true, answer.text);
    assert.match(seen[0].data.note ?? answer.data.note, /did not finish: the Prism server running it stopped\. It was started again\./);
    assert.equal(count(cwd, 'built'), 1);
  } finally {
    await server.close();
  }
});

test('two servers on one project build once', async () => {
  const cwd = project();
  const env = fakeDocker(cwd, { prove: 'ok', build: 'ok', buildMs: 1500, holo: SHIPPING_HOLO });
  const first = startServer(cwd, { env });
  const second = startServer(cwd, { env });
  try {
    await approved(first);
    await first.call('prism_build', { wait: 0 });
    const other = await second.call('prism_build', { wait: 0 });
    assert.equal(other.data.state, 'running');
    assert.match(other.data.next, /another Prism server started .* is still running/);
    const done = await until(first, 'prism_build');
    assert.equal(done.answer.data.ok, true, done.answer.text);
    // The second server sees the first one's result without building.
    const seen = await until(second, 'prism_build');
    assert.equal(seen.answer.data.ok, true, seen.answer.text);
    assert.equal(count(cwd, 'build'), 1);
  } finally {
    await first.close();
    await second.close();
  }
});

test('spec.json edited by hand is adopted, a broken one is named, and a deleted one loses nothing', async () => {
  const cwd = project();
  const server = startServer(cwd);
  const file = join(cwd, 'prism', 'spec.json');
  try {
    await server.call('prism_start', { restart: true });
    await server.call('prism_spec', { spec: SHIPPING_DRAFT });
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    // A valid edit: the threshold moves, and the review starts over with it.
    stored.rules[1].when[0].value = 30;
    stored.rules[1].says = 'when weight > 30 then express';
    stored.examples = [];
    writeFileSync(file, JSON.stringify(stored));
    const adopted = await server.call('prism_status');
    assert.equal(adopted.isError, false, adopted.text);
    const read = await server.call('prism_spec');
    assert.equal(read.data.spec.rules[1].when[0].value, 30);
    // A spec.json that does not read: every tool says what is wrong with it, and nothing is built from the old one.
    writeFileSync(file, '{"title": "Shipping Method", "fields": ');
    const broken = await server.call('prism_build', { wait: 0 });
    assert.equal(broken.data.state, 'blocked');
    assert.match(broken.data.message, /prism\/spec\.json does not read: .+ Fix spec\.json, or pass the corrected spec to prism_spec\./);
    // Deleted: the session still holds the answers, and says so truthfully.
    rmSync(file);
    const after = await server.call('prism_status');
    assert.equal(after.isError, false, after.text);
    assert.equal(typeof after.data.step, 'string');
    const again = await server.call('prism_spec', { spec: SHIPPING_DRAFT });
    assert.equal(again.data.step, 'review', again.text);
  } finally {
    await server.close();
  }
});

test('a step that began and never reported its exit is the one that was cut', () => {
  assert.equal(cutOff('@@step prelock\n@@exit prelock 0\n@@step build\nworking\n'), 'build');
  assert.equal(cutOff('@@step prelock\n@@exit prelock 0\n@@step build\n@@exit build 1\n'), null);
  assert.equal(cutOff('docker: no such image\n'), null);
  assert.equal(cutOff(''), null);
});

test('a session started over forgets the app before: its spec.json is not approved by the next yes', async () => {
  const cwd = project();
  const server = startServer(cwd);
  const file = join(cwd, 'prism', 'spec.json');
  try {
    await server.call('prism_start', { restart: true });
    await server.call('prism_spec', { spec: SHIPPING_DRAFT });
    const old = readFileSync(file, 'utf8');
    // Measured on 2026-11-16, in 0.9.2: after this restart the next call took the file for an edit,
    // put the session at its review, and "yes" approved an app nobody had been shown.
    const again = await server.call('prism_start', { restart: true });
    assert.equal(again.data.step, 'purpose');
    assert.equal(again.data.note, undefined);
    assert.equal((await server.call('prism_status')).data.step, 'purpose');
    assert.equal((await server.call('prism_spec')).data.spec, null);
    const yes = await server.call('prism_answer', { answer: 'yes' });
    assert.equal(yes.data.step, 'purpose');
    assert.match(yes.data.issue, /there is no checked spec to review yet/);
    assert.equal((await server.call('prism_build', { wait: 0 })).data.state, 'blocked');
    // The file is left as it was, and an edit to it afterwards is still taken, and still reviewed first.
    assert.equal(readFileSync(file, 'utf8'), old);
    const stored = JSON.parse(old);
    stored.title = 'Shipping Again';
    writeFileSync(file, JSON.stringify(stored));
    const edited = await server.call('prism_status');
    assert.equal(edited.data.step, 'review');
    // A new draft replaces it.
    await server.call('prism_start', { restart: true });
    const fresh = await server.call('prism_spec', { spec: { ...SHIPPING_DRAFT, title: 'Parcels' } });
    assert.equal(fresh.data.step, 'review', fresh.text);
    assert.match(readFileSync(file, 'utf8'), /"title": ?"Parcels"/);
  } finally {
    await server.close();
  }
});
