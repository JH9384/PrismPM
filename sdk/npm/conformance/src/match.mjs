/**
 * The expectation language of the scenarios. An expected value is a subset of
 * the actual one: every member it names must match, members it does not name are
 * free, so a runtime may report more than the contract asks. Arrays match element
 * by element and must have the same length, unless an operator says otherwise.
 *
 *   { "$contains": [a, b] }   the array holds an element matching each of a, b
 *   { "$excludes": [a] }      the array holds no element matching a
 *   { "$absent": true }       the member is missing or null
 *   { "$utf8": "text" }       the lowercase hex of these UTF-8 bytes
 *   { "$zeros": 53 }          the lowercase hex of this many zero bytes
 *
 * `$utf8` and `$zeros` are written for the reader of a scenario. They expand
 * before a request is sent or an answer compared, so a shim only ever sees hex.
 */
export const OPERATORS = Object.freeze(['$contains', '$excludes', '$absent', '$utf8', '$zeros']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const operatorOf = (value) => (isObject(value) ? Object.keys(value).find((key) => key.startsWith('$')) : undefined);
const hexOf = (bytes) => Buffer.from(bytes).toString('hex');

/** The value with every `$utf8` and `$zeros` replaced by its hex. */
export function expand(value) {
  if (Array.isArray(value)) return value.map(expand);
  if (!isObject(value)) return value;
  if ('$utf8' in value) return hexOf(new TextEncoder().encode(value.$utf8));
  if ('$zeros' in value) return '00'.repeat(value.$zeros);
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, expand(member)]));
}

/** Every `$` key a value uses, so a scenario with a misspelled operator is refused at load. */
export function operatorsIn(value, found = new Set()) {
  if (Array.isArray(value)) for (const item of value) operatorsIn(item, found);
  else if (isObject(value)) {
    for (const [key, member] of Object.entries(value)) {
      if (key.startsWith('$')) found.add(key);
      operatorsIn(member, found);
    }
  }
  return found;
}

const show = (value) => {
  const text = JSON.stringify(value);
  return text === undefined ? 'nothing' : text.length > 160 ? `${text.slice(0, 160)}...` : text;
};

/** Where `actual` differs from `expected`, as sentences. Empty means it matches. */
export function mismatches(expected, actual, path = '$') {
  const operator = operatorOf(expected);
  if (operator === '$absent') return actual === undefined || actual === null ? [] : [`${path}: expected nothing, found ${show(actual)}`];
  if (operator === '$contains') {
    if (!Array.isArray(actual)) return [`${path}: expected an array, found ${show(actual)}`];
    return expected.$contains
      .filter((item) => !actual.some((element) => mismatches(item, element).length === 0))
      .map((item) => `${path}: no element matches ${show(item)}`);
  }
  if (operator === '$excludes') {
    if (!Array.isArray(actual)) return [`${path}: expected an array, found ${show(actual)}`];
    return expected.$excludes
      .filter((item) => actual.some((element) => mismatches(item, element).length === 0))
      .map((item) => `${path}: an element matches ${show(item)}, which must not appear`);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected an array, found ${show(actual)}`];
    if (actual.length !== expected.length) return [`${path}: expected ${expected.length} elements, found ${actual.length}`];
    return expected.flatMap((item, i) => mismatches(item, actual[i], `${path}[${i}]`));
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return [`${path}: expected an object, found ${show(actual)}`];
    return Object.entries(expected).flatMap(([key, member]) => mismatches(member, actual[key], `${path}.${key}`));
  }
  return expected === actual ? [] : [`${path}: expected ${show(expected)}, found ${show(actual)}`];
}
