---
title: Write a middleware
description: Add your own code around the steps the runtime performs, and trace each step with OpenTelemetry.
available_in: "1.0-beta"
---
This guide shows you how to put code around what the runtime does with a holo: checking it, starting an instance, running a request, and keeping the exchange. Tracing is the first middleware that ships, and you add it the same way.

The middleware API is experimental. Pin the exact `prism-code` version if you use it.

## The four steps

The runtime performs four steps. Each one has its own chain of middleware, and each middleware wraps exactly that step.

| Step | When it runs | Takes | Returns |
| --- | --- | --- | --- |
| `verify` | `app.experimental_verify(options)` | `{ options }` | the verdict |
| `instantiate` | every `dispatch`, before the request runs | `{ module, imports }` | a `WebAssembly.Instance` |
| `dispatch` | every `dispatch` | `{ request, instance }` | the response bytes |
| `record` | every `dispatch`, after the response | `{ request, response }` | the response bytes |

`instantiate` is where imports are linked, so a check of what a holo may touch fits there. `record` keeps nothing by itself; a middleware there sees every exchange and can keep it. A closure starts its instance once, when it loads, so it runs `verify`, `dispatch` and `record` only. `acceptance()` dispatches each example, so it runs through the same steps.

## Write one

A middleware is a function that takes `next` and a context and returns a handler. The handler gets the step's arguments, calls `next(args)` to run the rest of the step, and returns the result. It can read or change the arguments on the way in and the result on the way out.

```js
const sizes = (next, context) => async (args) => {
  const response = await next(args);
  console.log(`${context.step}: ${args.request.length} bytes in, ${response.length} bytes out`);
  return response;
};
```

`context.step` is the step and `context.application` is the application. Add the middleware to the application's stack with its step, a name and any tags:

```js
app.experimental_middleware.add(sizes, { step: 'dispatch', name: 'sizes', tags: ['example'] });
```

Here it is with tracing, run against Calculator:

{{example:middleware}}

## Order

Within a step, the first middleware is the outermost: it sees the arguments first and the result last. The order is set three ways.

- `priority`: `high`, then `normal` (the default), then `low`. Ties keep the order you added them in.
- `addRelativeTo(middleware, { relation: 'before', toMiddleware: 'sizes', name })` places a middleware next to a named one, at that one's step. `after` places it on the other side. Several placed on the same side keep the order you added them in.
- The named middleware may be added later. It must be on the stack when the step runs, or the step fails with `middleware.relative`.

`app.experimental_middleware.identify()` lists every entry in the order it runs.

## Tags, removal and replacement

Names are unique. Adding a second middleware with a name already on the stack fails with `middleware.name`, unless you pass `override: true`, which replaces the first.

- `remove('sizes')` removes by name, and `remove(sizes)` by the function itself.
- `removeByTag('example')` removes every middleware with that tag.
- `clone()` copies the stack, so you can change the copy and leave the original alone.

## Package middleware as a pluggable

A pluggable is an object with `applyToStack(stack)`. It adds one or more middleware in one call, and `use` applies it:

```js
const timing = {
  applyToStack(stack) {
    stack.add(sizes, { step: 'dispatch', name: 'sizes', tags: ['timing'] });
  },
};
app.experimental_middleware.use(timing);
```

Tracing is a pluggable. So is anything you want to hand to another team as one piece.

## Errors

A middleware that throws a `PrismError` keeps it: a capability check that throws `CapabilityDeniedError` reaches the caller as `CapabilityDeniedError`. A middleware that throws anything else raises `MiddlewareError` (`middleware_failed`). Its `details` name the middleware, its step and its tags, and its `cause` is what was thrown. An error from the runtime, or from a middleware further in, passes through each middleware unchanged, so it is never blamed on one that only passed it on.

## Trace with OpenTelemetry

`experimental_tracing({ tracer })` adds one middleware per step, named `tracing.<step>` and tagged `tracing`, first in its step. Each step becomes a span named `prism.<step>`, with these attributes:

| Attribute | On |
| --- | --- |
| `prism.step` | every span |
| `prism.application.name`, `prism.application.kind` | every span |
| `prism.request.size`, `prism.response.size` | `dispatch` and `record` |
| `prism.verdict.level`, `prism.verdict.passed` | `verify` |
| `prism.error.code` | a span whose step failed, with an error status and the exception |

Pass the tracer from your own OpenTelemetry setup:

```js
import { trace } from '@opentelemetry/api';
import { experimental_tracing } from 'prism-code';

app.experimental_middleware.use(experimental_tracing({ tracer: trace.getTracer('my-service') }));
```

`prism-code` does not depend on `@opentelemetry/api`. Tracing uses only the tracer you pass, so an application that does not trace installs nothing extra. Spans start with `startActiveSpan`, so a span you have open around `dispatch` is their parent. Pass `steps` to trace only some steps, and `removeByTag('tracing')` to stop.

## Next steps

- [Run and gate](/docs/guides/run-and-gate)
- [Dispatch inputs](/docs/api/dispatch)
- [Error types](/docs/api/errors)
