// The middleware stack (#295): order by step, priority and relative position; tags, removal and
// replacement; a failing middleware as a typed error; tracing spans with a fake tracer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  load,
  experimental_tracing,
  MIDDLEWARE_STEPS,
  MiddlewareError,
  CapabilityDeniedError,
  PrismCodeError,
  PrismError,
  ERROR_CLASSES,
} from '../src/index.mjs';
import { createMiddlewareStack } from '../src/middleware.mjs';

const CALCULATOR = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ADD = encoder.encode('1\tadd\t20\t22');

async function calculator() {
  return load(new Uint8Array(await readFile(CALCULATOR)));
}

/** A middleware that appends `label` to `log` on the way in and on the way out. */
function marker(log, label) {
  return (next) => async (args) => {
    log.push(`${label}>`);
    const result = await next(args);
    log.push(`<${label}`);
    return result;
  };
}

test('the four steps, in the order the runtime performs them', () => {
  assert.deepEqual(MIDDLEWARE_STEPS, ['verify', 'instantiate', 'dispatch', 'record']);
});

test('order by step, then priority, then insertion; the first is outermost', async () => {
  const stack = createMiddlewareStack();
  const log = [];
  stack.add(marker(log, 'record'), { step: 'record', name: 'record' });
  stack.add(marker(log, 'low'), { step: 'dispatch', name: 'low', priority: 'low' });
  stack.add(marker(log, 'a'), { step: 'dispatch', name: 'a' });
  stack.add(marker(log, 'b'), { step: 'dispatch', name: 'b' });
  stack.add(marker(log, 'high'), { step: 'dispatch', name: 'high', priority: 'high' });
  stack.add(marker(log, 'verify'), { step: 'verify', name: 'verify' });
  assert.deepEqual(
    stack.identify().map((e) => `${e.step}:${e.name}`),
    ['verify:verify', 'dispatch:high', 'dispatch:a', 'dispatch:b', 'dispatch:low', 'record:record'],
  );
  const result = await stack.resolve('dispatch', async (args) => {
    log.push('terminal');
    return args.x * 2;
  })({ x: 21 });
  assert.equal(result, 42);
  assert.deepEqual(log, ['high>', 'a>', 'b>', 'low>', 'terminal', '<low', '<b', '<a', '<high']);
});

test('before and after a named middleware, at its step, including chains and late targets', async () => {
  const stack = createMiddlewareStack();
  const log = [];
  // Added before its target exists; it must be on the stack when the step runs.
  stack.addRelativeTo(marker(log, 'pre'), { relation: 'before', toMiddleware: 'core', name: 'pre' });
  stack.add(marker(log, 'core'), { step: 'instantiate', name: 'core' });
  stack.addRelativeTo(marker(log, 'post1'), { relation: 'after', toMiddleware: 'core', name: 'post1' });
  stack.addRelativeTo(marker(log, 'post2'), { relation: 'after', toMiddleware: 'core', name: 'post2' });
  stack.addRelativeTo(marker(log, 'prepre'), { relation: 'before', toMiddleware: 'pre', name: 'prepre' });
  stack.add(marker(log, 'outer'), { step: 'instantiate', name: 'outer', priority: 'high' });
  assert.deepEqual(
    stack.identify().map((e) => `${e.step}:${e.name}`),
    ['instantiate:outer', 'instantiate:prepre', 'instantiate:pre', 'instantiate:core', 'instantiate:post1', 'instantiate:post2'],
  );
  await stack.resolve('instantiate', async () => log.push('terminal'))({});
  assert.deepEqual(log.slice(0, 7), ['outer>', 'prepre>', 'pre>', 'core>', 'post1>', 'post2>', 'terminal']);
  // A middleware relative to one that is not on the stack refuses to run the step.
  stack.remove('core');
  assert.throws(() => stack.identify(), (e) => e instanceof PrismCodeError && e.code === 'middleware.relative');
});

test('tags, removal by name, by function and by tag, and replacement', async () => {
  const stack = createMiddlewareStack();
  const log = [];
  const keep = marker(log, 'keep');
  stack.add(keep, { step: 'dispatch', name: 'keep' });
  stack.add(marker(log, 't1'), { step: 'dispatch', name: 't1', tags: ['trace'] });
  stack.add(marker(log, 't2'), { step: 'record', tags: ['trace'] });
  stack.add(marker(log, 'gone'), { step: 'verify', name: 'gone' });
  assert.deepEqual(stack.identify().find((e) => e.name === 't1').tags, ['trace']);

  assert.equal(stack.removeByTag('trace'), true);
  assert.equal(stack.removeByTag('trace'), false);
  assert.equal(stack.remove('gone'), true);
  assert.equal(stack.remove('gone'), false);
  assert.deepEqual(stack.identify().map((e) => e.name), ['keep']);

  // A second middleware of the same name is refused, unless it overrides.
  assert.throws(() => stack.add(marker(log, 'x'), { step: 'dispatch', name: 'keep' }), (e) => e.code === 'middleware.name');
  stack.add(marker(log, 'replaced'), { step: 'record', name: 'keep', override: true });
  assert.deepEqual(stack.identify().map((e) => `${e.step}:${e.name}`), ['record:keep']);
  await stack.resolve('record', async () => 'r')({});
  assert.deepEqual(log, ['replaced>', '<replaced']);

  assert.equal(stack.remove(keep), false);
  assert.throws(() => stack.add(keep, { step: 'serialize' }), (e) => e.code === 'middleware.step');
  assert.throws(() => stack.add('nope', { step: 'dispatch' }), (e) => e.code === 'middleware.shape');
  assert.throws(() => stack.use({}), (e) => e.code === 'middleware.shape');
});

test('a Pluggable applies itself, and a clone is independent', () => {
  const stack = createMiddlewareStack();
  const pluggable = {
    applyToStack(s) {
      s.add((next) => next, { step: 'dispatch', name: 'p1', tags: ['p'] });
      s.addRelativeTo((next) => next, { relation: 'after', toMiddleware: 'p1', name: 'p2', tags: ['p'] });
    },
  };
  assert.equal(stack.use(pluggable), stack);
  const copy = stack.clone();
  copy.removeByTag('p');
  assert.deepEqual(stack.identify().map((e) => e.name), ['p1', 'p2']);
  assert.deepEqual(copy.identify(), []);
});

test('a middleware that throws raises MiddlewareError naming it; PrismErrors and runtime errors pass through', async () => {
  assert.equal(ERROR_CLASSES.middleware_failed, MiddlewareError);
  const stack = createMiddlewareStack();
  const boom = new TypeError('boom');
  stack.add(() => async () => {
    throw boom;
  }, { step: 'dispatch', name: 'faulty', tags: ['t'] });
  await assert.rejects(stack.resolve('dispatch', async () => 'never')({}), (error) => {
    assert.ok(error instanceof MiddlewareError && error instanceof PrismError);
    assert.equal(error.code, 'middleware_failed');
    assert.deepEqual(error.details, { name: 'faulty', step: 'dispatch', tags: ['t'] });
    assert.equal(error.cause, boom);
    return true;
  });

  // A typed error a middleware raises on purpose, such as a capability check, is kept as it is.
  const denied = createMiddlewareStack();
  denied.add(() => async () => {
    throw new CapabilityDeniedError('import env.fetch is not granted', { check: 'world.capabilities' });
  }, { step: 'instantiate', name: 'capabilities' });
  await assert.rejects(denied.resolve('instantiate', async () => null)({}), CapabilityDeniedError);

  // An error from further in (here the runtime's own work) is not blamed on the middleware it passes.
  const passing = createMiddlewareStack();
  passing.add(marker([], 'outer'), { step: 'dispatch', name: 'outer' });
  const trap = new RangeError('unreachable');
  await assert.rejects(
    passing.resolve('dispatch', async () => {
      throw trap;
    })({}),
    (error) => error === trap,
  );
});

test('an application runs its own steps through the stack', async () => {
  const app = await calculator();
  const seen = [];
  const watch = (step) => (next, context) => async (args) => {
    seen.push({ step, context: context.step, name: context.application.name, keys: Object.keys(args).sort() });
    return next(args);
  };
  for (const step of MIDDLEWARE_STEPS) app.experimental_middleware.add(watch(step), { step, name: `watch.${step}` });
  assert.equal(decoder.decode(await app.dispatch(ADD)), '1\tok\t42');
  await app.experimental_verify({ minimum: 'P0' });
  assert.deepEqual(seen.map((s) => [s.step, s.context, s.keys]), [
    ['instantiate', 'instantiate', ['imports', 'module']],
    ['dispatch', 'dispatch', ['instance', 'request']],
    ['record', 'record', ['request', 'response']],
    ['verify', 'verify', ['options']],
  ]);
  assert.ok(seen.every((s) => s.name === app.name));

  // A middleware may change the result; acceptance replays through the same stack.
  app.experimental_middleware.add((next) => async (args) => encoder.encode('changed'), { step: 'record', name: 'rewrite' });
  assert.equal(decoder.decode(await app.dispatch(ADD)), 'changed');
  const replay = await app.acceptance();
  assert.equal(replay.passed, 0);
  app.experimental_middleware.remove('rewrite');
  assert.equal((await app.acceptance()).passed, replay.total);
});

/** Spans as plain objects; `startActiveSpan(name, options, fn)` as `@opentelemetry/api` declares it. */
function fakeTracer() {
  const spans = [];
  return {
    spans,
    startActiveSpan(name, options, fn) {
      const span = {
        name,
        kind: options.kind,
        attributes: { ...options.attributes },
        events: [],
        status: null,
        ended: false,
        setAttributes(a) {
          Object.assign(this.attributes, a);
        },
        setAttribute(k, v) {
          this.attributes[k] = v;
        },
        recordException(e) {
          this.events.push(e);
        },
        setStatus(s) {
          this.status = s;
        },
        end() {
          this.ended = true;
        },
      };
      spans.push(span);
      return fn(span);
    },
  };
}

test('tracing records one span per step with its attributes', async () => {
  const app = await calculator();
  const tracer = fakeTracer();
  app.experimental_middleware.use(experimental_tracing({ tracer }));
  assert.deepEqual(app.experimental_middleware.identify().map((e) => [e.name, e.tags]), [
    ['tracing.verify', ['tracing']],
    ['tracing.instantiate', ['tracing']],
    ['tracing.dispatch', ['tracing']],
    ['tracing.record', ['tracing']],
  ]);
  await app.dispatch(ADD);
  const verdict = await app.experimental_verify({ minimum: 'P0' });
  assert.deepEqual(tracer.spans.map((s) => s.name), ['prism.instantiate', 'prism.dispatch', 'prism.record', 'prism.verify']);
  assert.ok(tracer.spans.every((s) => s.ended && s.status === null && s.kind === 0));
  const [instantiate, dispatch, record, verify] = tracer.spans;
  assert.deepEqual(instantiate.attributes, { 'prism.step': 'instantiate', 'prism.application.name': app.name, 'prism.application.kind': 'holo' });
  assert.equal(dispatch.attributes['prism.request.size'], ADD.length);
  assert.equal(dispatch.attributes['prism.response.size'], encoder.encode('1\tok\t42').length);
  assert.equal(record.attributes['prism.response.size'], dispatch.attributes['prism.response.size']);
  assert.equal(verify.attributes['prism.verdict.level'], verdict.level);
  assert.equal(verify.attributes['prism.verdict.passed'], verdict.passed);

  // Removing the tag removes tracing, and nothing more is recorded.
  app.experimental_middleware.removeByTag('tracing');
  await app.dispatch(ADD);
  assert.equal(tracer.spans.length, 4);
});

test('a failed step ends its span with an error status and the error code', async () => {
  const app = await calculator();
  const tracer = fakeTracer();
  app.experimental_middleware.use(experimental_tracing({ tracer, steps: ['verify'] }));
  await assert.rejects(app.experimental_verify({ minimum: 'P3', throw: true }), PrismError);
  const [span] = tracer.spans;
  assert.equal(span.name, 'prism.verify');
  assert.equal(span.status.code, 2);
  assert.equal(span.events.length, 1);
  assert.equal(typeof span.attributes['prism.error.code'], 'string');
  assert.ok(span.ended);
  assert.throws(() => experimental_tracing({}), (e) => e.code === 'middleware.shape');
});
