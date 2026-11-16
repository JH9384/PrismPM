// What the `prism.auth` tests hold every return value and error to: no secret, however the value is looked at.
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

/** Everything a caller could see of a value or an error, however it looks. */
function visible(value) {
  const parts = [inspect(value, { depth: null, showHidden: true })];
  for (let error = value; error instanceof Error; error = error.cause) parts.push(error.message, error.stack ?? '');
  parts.push(JSON.stringify(value) ?? '');
  return parts.join('\n');
}

export function assertHidden(value, secrets) {
  const seen = visible(value);
  for (const secret of secrets) assert.equal(seen.includes(secret), false, `a secret is visible in: ${seen}`);
}

/** The typed refusal a promise ends in, with no `cause` and none of the secrets visible. */
export async function refusalOf(promise, Class, check, secrets) {
  const error = await promise.then(
    () => assert.fail('expected a refusal'),
    (caught) => caught,
  );
  assert.ok(error instanceof Class, `${error?.name}: ${error?.message}`);
  assert.equal(error.check, check);
  assert.equal(error.cause, undefined);
  assertHidden(error, secrets);
  return error;
}
