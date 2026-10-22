import assert from 'node:assert/strict';
import test from 'node:test';
import {decodePresentation, encodeWire, validateIntent} from '../../sdk/browser/presentation-wire.mjs';
import {validateSemanticPresentation, semanticCatalogueFits} from '../../sdk/browser/semantic-presentation-wire.mjs';
import {corpus, frame, mixedOptions} from './corpus.mjs';

test('dynamic text choices admit stable IDs, duplicate names and strict bounded plain text', () => {
  for (const row of corpus()) {
    if (row.accepted) assert.deepEqual(decodePresentation(row.request), row.value, row.id);
    else assert.throws(() => decodePresentation(row.request), undefined, row.id);
  }
  assert.throws(() => encodeWire(frame([[1, '\ud800']], 1)));
});

test('catalogue and dynamic choices share the unchanged 256 option budget', () => {
  const exact = mixedOptions(256);
  assert.deepEqual(decodePresentation(encodeWire(exact)), exact);
  assert.throws(() => decodePresentation(encodeWire(mixedOptions(257))));
  const legacy = frame(); legacy[6][1][1][0] = 7;
  legacy[6][1][1][5] = [[42, 1], [7, 2]];
  assert.throws(() => decodePresentation(encodeWire(legacy)), 'legacy order remains strict');
});

test('dynamic intent values are stable identifiers, never option text or positions', () => {
  const value = frame();
  assert.equal(validateIntent(value, [1, 1, 1, [[2, 7]]]), true);
  for (const chosen of [0, 2, 'Shared name', '7']) {
    assert.throws(() => validateIntent(value, [1, 1, 1, [[2, chosen]]]));
  }
  value[6][1][1][3] = false;
  assert.equal(validateIntent(value, [1, 1, 1, [[2, 0]]]), true);
});

test('semantic helpers and errors bind text choices without interpreting names as catalogue indices', () => {
  const value = frame(); value[6].push([0, [0, 0]]);
  const envelope = [1, value, 0, 0, 1, [[2, 0, 2, 3, 0, 0], [4, 0, 0, 0, 1, 0]]];
  assert.deepEqual(validateSemanticPresentation(envelope), envelope);
  assert.equal(semanticCatalogueFits(envelope, 3, 1), true);
  const purpose = structuredClone(envelope); purpose[5][0][1] = 4;
  assert.throws(() => validateSemanticPresentation(purpose));
  const badLabel = structuredClone(envelope); badLabel[1][6][1][1][1] = 3;
  assert.equal(semanticCatalogueFits(badLabel, 3, 1), false);
});
