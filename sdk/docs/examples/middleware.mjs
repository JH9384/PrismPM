import { load, experimental_tracing } from 'prism-code';

const app = await load('./Calculator.holo');
const stack = app.experimental_middleware;

// A middleware at the dispatch step: it sees the request, calls next, and sees the response.
stack.add(
  (next, context) => async (args) => {
    const response = await next(args);
    console.log(`${context.step}: ${args.request.length} bytes in, ${response.length} bytes out`);
    return response;
  },
  { step: 'dispatch', name: 'sizes', tags: ['example'] },
);

// Tracing takes any OpenTelemetry tracer. This stand-in prints each span as it ends.
const tracer = {
  startActiveSpan(name, options, fn) {
    const span = {
      attributes: { ...options.attributes },
      setAttribute(key, value) { span.attributes[key] = value; },
      setAttributes(more) { Object.assign(span.attributes, more); },
      recordException() {},
      setStatus() {},
      end() { console.log(`span ${name}`, JSON.stringify(span.attributes)); },
    };
    return fn(span);
  },
};
stack.use(experimental_tracing({ tracer, steps: ['dispatch', 'record'] }));

console.log(stack.identify().map((entry) => `${entry.step}:${entry.name}`).join(' '));
await app.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
