import {encodeWire, PRESENTATION_MAXIMUM} from '../../sdk/browser/presentation-wire.mjs';
import {combinedShape} from '../browser-presentation/maximum-fixtures.mjs';

export const maximumIds = Object.freeze(['DynamicFirst', 'DynamicLast', 'MixedFirst', 'MixedLast',
  'SemanticDynamicFirst', 'SemanticDynamicLast', 'SemanticMixedFirst', 'SemanticMixedLast']);

export function maximumFrame(id) {
  if (!maximumIds.includes(id)) throw Error('closed dynamic choice maximum');
  const frame = combinedShape(true), mixed = id.includes('Mixed'), last = id.endsWith('Last');
  const select = frame[6].find(row => row[1][0] === 7);
  select[1][0] = 11;
  select[1][5] = Array.from({length: mixed ? 255 : 256}, (_, index) =>
    [4294967295 - index, '😀'.repeat(1024)]);
  select[1][4] = 4294967295;
  if (mixed) {
    const index = frame[6].findIndex(row => row[1][0] === 4);
    frame[6][index] = [15, [7, 0, true, false, 1, [[1, 0]], 0]];
  }
  const value = id.startsWith('Semantic') ? [1, frame, 0, 0, 6,
    [[1, 0, 0, 0, 1, 0], [32, 0, 4, 5, 0, 0]]] : frame;
  const table = frame[6].at(-1)[1][3], index = last ? table.length - 1 : 0;
  // The empty string's one-byte head becomes a five-byte head at this boundary.
  const payload = PRESENTATION_MAXIMUM - encodeWire(value).length - 4;
  table[index][0] = 'x'.repeat(payload);
  const bytes = encodeWire(value);
  if (bytes.length !== PRESENTATION_MAXIMUM) throw Error('exact aggregate presentation maximum');
  return {id, value, frame, bytes, role: id.startsWith('Semantic') ? 'semantic' : 'wire',
    payload, selector: '[data-presentation-node="256"] tbody tr:nth-child(' + (index + 1) + ') td'};
}
