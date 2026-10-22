// Independent six-field identity preimages; these are conditional inputs only.
import assert from 'node:assert/strict';
import {fixture, clone, bytes, encode, positional, request, contextPreimage} from '../publication-admission/corpus.mjs';

export function contextFieldsCorpus() {
  const rows = [];
  const add = (id, context) => {
    const body = positional('Context', context).slice(0, -1);
    assert.equal(body.length, 6, 'the context self-digest is never an input');
    rows.push({id, request: encode([1, 0, body]), admission: encode(request.context(context)),
      preimage: contextPreimage(context), response: encode([1, 3, contextPreimage(context)])});
  };
  const baseline = fixture().context;
  baseline.declaration.obligations.forEach((row, index) => { row.id = (index + 1) * 10; row.assurance = 5; });
  add('CompleteSixFieldContext', baseline);
  const leaves = (value, path = []) => value instanceof Uint8Array || typeof value !== 'object'
    ? [[path, value]] : Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]));
  for (const [path, value] of leaves(baseline)) {
    if (path[0] === 'digest') continue;
    const changed = clone(baseline), parent = path.slice(0, -1).reduce((value, key) => value[key], changed), key = path.at(-1);
    parent[key] = value instanceof Uint8Array ? bytes(value.length, 255) : typeof value === 'string'
      ? value + '-changed' : key === 'id' ? value + 1 : key === 'assurance' ? 0 : 1 - value;
    if (key === 'assurance' && parent.moment === 1) parent[key] = 6;
    assert.ok(!contextPreimage(changed).equals(contextPreimage(baseline)), path.join('.'));
    add('Changed' + path.join('.'), changed);
  }
  for (const count of [2, 255, 256, 257, 4096]) {
    const context = fixture(count).context;
    add('Obligations' + count, context);
  }
  const widest = fixture(4096).context;
  function widen(value) {
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string') value[key] = '\u{1f419}'.repeat(512);
      else if (child && typeof child === 'object' && !Array.isArray(child) && !(child instanceof Uint8Array)) widen(child);
    }
  }
  widen(widest); add('CombinedMaximumUtf8TextAndObligations', widest);
  const raw = (id, input, code) => rows.push({id, request: input, response: encode([1, 2, code])});
  const body = positional('Context', baseline).slice(0, -1), input = encode([1, 0, body]);
  for (let index = 0; index < 6; index++) {
    raw('MissingField' + index, encode([1, 0, body.filter((_, at) => at !== index)]), 3);
  }
  raw('ExtraSelfDigest', encode([1, 0, [...body, bytes()]]), 6);
  raw('TrailingBytes', Buffer.concat([input, Buffer.from([0])]), 8);
  raw('WrongVersion', encode([2, 0, body]), 3);
  raw('WrongOperation', encode([1, 1, body]), 3);
  for (const count of [0, 1, 2, 3, input.length - 1]) raw('Truncated' + count, input.subarray(0, count), 2);
  const text = clone(baseline); text.publisherRef = 'x'.repeat(2049);
  raw('PublisherRefOneOver', encode([1, 0, positional('Context', text).slice(0, -1)]), 6);
  const obligations = fixture(4097).context;
  raw('ObligationsOneOver', encode([1, 0, positional('Context', obligations).slice(0, -1)]), 6);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  return rows;
}
