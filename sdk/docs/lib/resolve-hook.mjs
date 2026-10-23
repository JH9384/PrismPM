/**
 * Module resolution hook for the executed examples. It maps the bare
 * specifiers a reader would install, `prism-code` and `@prism-code/spec`, to
 * the checkouts in this repository, so the examples run without `npm install`
 * and read exactly as they would in a project.
 */
let map = {};

export async function initialize(data) {
  map = data?.map ?? {};
}

export async function resolve(specifier, context, next) {
  if (Object.hasOwn(map, specifier)) return { url: map[specifier], shortCircuit: true };
  return next(specifier, context);
}
