/**
 * `holo.verify()`: the verdict `prism check` and `@prism-code/verify` return,
 * as a call of this package (issue #276, design in
 * docs/proposals/269-assurance-levels.md).
 *
 * The checks are @prism-code/verify's own, vendored as one file
 * (src/vendor/verify.mjs), so the three tools cannot disagree. The level is
 * computed from the evidence in the holo and never raised by an option: a
 * holo with no attestation bundle is P0 whatever the policy says.
 *
 * Experimental until the v0.6 freeze, hence the `experimental_` prefix
 * (STABILITY.md).
 */
import { ASSURANCE, VerifyError, verify as verifyBytes } from './vendor/verify.mjs';
import { VerificationError, errorFromVerdict } from './errors.mjs';

/** The environment variable that sets the client's minimum assurance level, P0 to P3. */
export const MINIMUM_LEVEL_ENV = 'PRISM_MINIMUM_LEVEL';

const OPTION_KEYS = ['name', 'minimum', 'digests', 'world', 'throw', 'env'];

function defined(options) {
  if (options === undefined || options === null) return {};
  if (typeof options !== 'object') throw new VerificationError('verify options must be an object', { check: 'policy.invalid' });
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) {
      throw new VerificationError(`unknown verify option ${key}; expected ${OPTION_KEYS.join(', ')}`, { check: 'policy.invalid' });
    }
  }
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

function environment(env) {
  if (env) return env;
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

/**
 * Options by precedence: the environment, then the client's options, then the
 * call's. A member given later replaces the same member given earlier whole;
 * `digests` is not merged per target, and `world` replaces whole.
 */
export function resolveOptions(client, call) {
  const merged = { ...defined(client), ...defined(call) };
  const fromEnvironment = environment(merged.env)[MINIMUM_LEVEL_ENV];
  if (merged.minimum === undefined && fromEnvironment !== undefined && fromEnvironment !== '') {
    if (!ASSURANCE.LEVELS.includes(fromEnvironment)) {
      throw new VerificationError(`${MINIMUM_LEVEL_ENV} is ${JSON.stringify(fromEnvironment)}; expected one of ${ASSURANCE.LEVELS.join(', ')}`, {
        check: 'policy.invalid',
      });
    }
    merged.minimum = fromEnvironment;
  }
  const { throw: throwOnFail = false, env, ...policy } = merged;
  return { policy, throwOnFail };
}

async function bytesOf(source) {
  if (source && typeof source === 'object' && source.kind === 'closure') {
    throw new VerificationError('verify reads a .holo archive; a closure has no footer or section table', { check: 'verify.kind' });
  }
  if (source && typeof source === 'object' && source.kind === 'holo' && source.archive?.bytes) return source.archive.bytes;
  if (typeof Blob !== 'undefined' && source instanceof Blob) return new Uint8Array(await source.arrayBuffer());
  return source;
}

/**
 * Check a holo and return its verdict, a `prism/verdict/1` object.
 *
 * With `throw: true`, a verdict that did not pass is thrown as the typed
 * error that explains it, carrying the whole verdict. A call that cannot
 * reach a verdict at all (not a holo, an unknown format revision, an invalid
 * policy) always throws a `VerificationError`.
 *
 * @param {Uint8Array | ArrayBuffer | Blob | object} source the holo as bytes, a Blob, or a holo opened with `load`
 * @param {{ name?: string, minimum?: string, digests?: object, world?: object | null, throw?: boolean, env?: object }} [options]
 */
export async function experimental_verify(source, options = undefined, clientOptions = undefined) {
  const { policy, throwOnFail } = resolveOptions(clientOptions, options);
  let verdict;
  try {
    verdict = await verifyBytes(await bytesOf(source), policy);
  } catch (error) {
    if (error instanceof VerifyError) throw new VerificationError(error.message, { check: error.code, cause: error });
    throw error;
  }
  if (throwOnFail) {
    const error = errorFromVerdict(verdict, ASSURANCE.RANK);
    if (error) throw error;
  }
  return verdict;
}

/**
 * A client with options of its own. The minimum level defaults to the
 * `PRISM_MINIMUM_LEVEL` environment variable; the client's options replace
 * that, and the options of one call replace the client's.
 *
 * @param {{ name?: string, minimum?: string, digests?: object, world?: object | null, throw?: boolean, env?: object }} [options]
 */
export function experimental_createClient(options = undefined) {
  const client = Object.freeze({ ...defined(options) });
  return Object.freeze({
    options: client,
    verify: (source, callOptions = undefined) => experimental_verify(source, callOptions, client),
  });
}
