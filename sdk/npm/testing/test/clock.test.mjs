import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock, createRandom, DEFAULT_START, TestSetupError } from '../src/index.mjs';

test('the clock starts at a fixed time and moves only when told', async () => {
  const clock = createClock();
  assert.equal(clock.now(), DEFAULT_START);
  assert.equal(clock.date().toISOString(), '2026-01-01T00:00:00.000Z');
  await clock.advance(1500);
  assert.equal(clock.now(), DEFAULT_START + 1500);
  assert.equal(createClock({ start: '2030-06-01T12:00:00Z' }).date().toISOString(), '2030-06-01T12:00:00.000Z');
  assert.throws(() => createClock({ start: 'never' }), TestSetupError);
});

test('advance fires due timers in order, with the clock at each timer\'s time', async () => {
  const clock = createClock({ start: 0 });
  const seen = [];
  clock.setTimeout(() => seen.push(['b', clock.now()]), 20);
  clock.setTimeout(() => seen.push(['a', clock.now()]), 10);
  clock.setTimeout(() => seen.push(['c', clock.now()]), 20);
  clock.setTimeout(() => seen.push(['late', clock.now()]), 500);
  await clock.advance(100);
  assert.deepEqual(seen, [['a', 10], ['b', 20], ['c', 20]]);
  assert.equal(clock.now(), 100);
  assert.equal(clock.pending(), 1);
});

test('a timer scheduled by a timer inside the window fires in the same advance; clearTimeout cancels', async () => {
  const clock = createClock({ start: 0 });
  const seen = [];
  clock.setTimeout(() => clock.setTimeout(() => seen.push(clock.now()), 5), 10);
  const cancelled = clock.setTimeout(() => seen.push('cancelled'), 1);
  clock.clearTimeout(cancelled);
  await clock.advance(20);
  assert.deepEqual(seen, [15]);
});

test('sleep resolves when the clock reaches it, never in real time', async () => {
  const clock = createClock({ start: 0 });
  let woke = false;
  const sleeping = clock.sleep(60_000).then(() => (woke = true));
  await clock.advance(59_999);
  assert.equal(woke, false);
  await clock.advance(1);
  await sleeping;
  assert.equal(woke, true);
});

test('until skips time: a minute of sleeping takes no real time', async () => {
  const clock = createClock({ start: 0 });
  const started = Date.now();
  const result = await clock.until(async () => {
    await clock.sleep(30_000);
    await clock.sleep(30_000);
    return clock.now();
  });
  assert.equal(result, 60_000);
  assert.ok(Date.now() - started < 5_000);
});

test('until rejects with what the work rejects with, and says so when nothing can wake it', async () => {
  const clock = createClock({ start: 0 });
  await assert.rejects(clock.until(async () => { await clock.sleep(1); throw new RangeError('boom'); }), RangeError);
  await assert.rejects(clock.until(new Promise(() => {})), (error) => error instanceof TestSetupError && error.check === 'testing.clock');
});

test('runAll stops a timer that always reschedules itself', async () => {
  const clock = createClock({ start: 0 });
  const again = () => clock.setTimeout(again, 1);
  again();
  await assert.rejects(clock.runAll({ limit: 50 }), TestSetupError);
  const done = createClock({ start: 0 });
  done.setTimeout(() => {}, 7);
  assert.equal(await done.runAll(), 7);
});

test('a negative delay is a setup error', () => {
  assert.throws(() => createClock().setTimeout(() => {}, -1), TestSetupError);
});

test('random is seeded: the same seed gives the same sequence, another seed another', () => {
  const take = (random) => [random.next(), random.int(1000), random.uuid(), [...random.bytes(4)]];
  assert.deepEqual(take(createRandom({ seed: 7 })), take(createRandom({ seed: 7 })));
  assert.notDeepEqual(take(createRandom({ seed: 7 })), take(createRandom({ seed: 8 })));
  assert.deepEqual(take(createRandom({ seed: 'a' })), take(createRandom({ seed: 'a' })));
  const random = createRandom({ seed: 1 });
  assert.match(random.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (let i = 0; i < 100; i++) assert.ok(random.int(3) < 3);
  const filled = random.getRandomValues(new Uint32Array(2));
  assert.equal(filled.length, 2);
  assert.throws(() => random.int(0), TestSetupError);
});

test('the sequence for a seed is pinned, so it is the same on every platform', () => {
  const random = createRandom({ seed: 42 });
  assert.deepEqual([random.int(100), random.int(100), random.int(100)], [60, 44, 85]);
});
