/**
 * `prism.errors`: the `errors` module of the nine in #440. It sits below the
 * other eight and depends on none of them.
 *
 * It adds no behavior. The classes and functions are the objects `errors.mjs`
 * exports, so `instanceof` holds across this namespace and the package exports.
 * `fail` stays out: it is the package's own helper, and `index.mjs` does not
 * export it either.
 *
 * - `codes`: the stable code of each class, by class name. `PrismCodeError` has
 *   no entry, because its code is the check that failed, set per instance.
 * - `spec`: the constants of `@prism-code/spec`, copied by scripts/vendor-spec.mjs
 *   because prism-code has no dependencies. The schema paths the spec generates
 *   are not here, because their files are not in this package.
 */
import * as source from './errors.mjs';
import * as spec from './vendor/spec/constants.mjs';

const { fail: _fail, ...surface } = source;

const hasOwnCode = (value) =>
  typeof value === 'function' && (value === source.PrismError || value.prototype instanceof source.PrismError) && value !== source.PrismCodeError;

const codes = Object.freeze(
  Object.fromEntries(
    Object.values(surface)
      .filter(hasOwnCode)
      .map((Class) => [Class.name, Class.code]),
  ),
);

export const errors = Object.freeze({ ...surface, codes, spec });
