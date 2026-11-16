import { TestSetupError } from './errors.mjs';

/** 2026-01-01T00:00:00.000Z, so a test never depends on the day it runs. */
export const DEFAULT_START = Date.UTC(2026, 0, 1);

const toMs = (value) => {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;
  if (!Number.isFinite(ms)) throw new TestSetupError(`the clock start ${String(value)} is not a time`, { check: 'testing.clock' });
  return ms;
};
const delayOf = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) throw new TestSetupError(`a delay is a number of milliseconds, 0 or more, not ${String(ms)}`, { check: 'testing.clock' });
  return ms;
};
/** Let every promise continuation that is ready run before time moves. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A clock that moves only when the test moves it. Timers fire in order of due time, then of creation,
 * and a callback that schedules another timer inside the window being advanced has that timer fire too.
 */
export function createClock({ start = DEFAULT_START } = {}) {
  let current = toMs(start);
  let serial = 0;
  const timers = new Map();

  const nextTimer = () => {
    let best = null;
    for (const [id, timer] of timers) if (best === null || timer.due < best.due || (timer.due === best.due && id < best.id)) best = { id, ...timer };
    return best;
  };
  const fire = async (timer) => {
    timers.delete(timer.id);
    current = Math.max(current, timer.due);
    await timer.callback();
    await settled();
  };

  const clock = {
    /** Milliseconds since the epoch, as `Date.now()` reports them. */
    now: () => current,
    date: () => new Date(current),
    /** Timers waiting to fire. */
    pending: () => timers.size,
    /** Run `callback` once, `ms` from now. Returns an id for `clearTimeout`. */
    setTimeout(callback, ms = 0) {
      if (typeof callback !== 'function') throw new TestSetupError('setTimeout takes a function', { check: 'testing.clock' });
      const id = ++serial;
      timers.set(id, { due: current + delayOf(ms), callback });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id),
    /** A promise that resolves when the clock reaches `ms` from now. It never resolves in real time. */
    sleep: (ms) => new Promise((resolve) => clock.setTimeout(resolve, ms)),
    /** Move time forward by `ms`, firing every timer that falls due on the way, in order. */
    async advance(ms) {
      const target = current + delayOf(ms);
      for (let timer = nextTimer(); timer !== null && timer.due <= target; timer = nextTimer()) await fire(timer);
      current = target;
      await settled();
      return current;
    },
    /** Jump to the next timer and fire it. Resolves to false when none is waiting. */
    async next() {
      const timer = nextTimer();
      if (timer === null) return false;
      await fire(timer);
      return true;
    },
    /** Fire timers until none is left. A timer that always schedules another stops at `limit`, and that is an error. */
    async runAll({ limit = 10000 } = {}) {
      for (let count = 0; await clock.next(); count++) {
        if (count + 1 >= limit) throw new TestSetupError(`${limit} timers fired and more are waiting; a timer keeps scheduling itself`, { check: 'testing.clock' });
      }
      return current;
    },
    /**
     * Time-skipping. Resolves to what `work` resolves to, moving the clock to its next timer each time
     * nothing else can proceed, so `await clock.until(app.run())` takes no real time however long the
     * code sleeps. Rejects with `TestSetupError` when `work` is still pending and no timer is waiting.
     */
    async until(work) {
      const promise = typeof work === 'function' ? work() : work;
      let outcome = null;
      promise.then(
        (value) => (outcome = { value }),
        (error) => (outcome = { error }),
      );
      for (;;) {
        await settled();
        if (outcome !== null) break;
        if (!(await clock.next())) {
          await settled();
          if (outcome !== null) break;
          throw new TestSetupError('the work is still pending and the clock has no timer to skip to; something else is awaited', { check: 'testing.clock' });
        }
      }
      if ('error' in outcome) throw outcome.error;
      return outcome.value;
    },
  };
  return Object.freeze(clock);
}
