// Independent acceptance inputs; never used by an application model.
import {combinedShape} from '../browser-presentation/maximum-fixtures.mjs';
import {encodeWire, PRESENTATION_MAXIMUM} from '../../sdk/browser/presentation-wire.mjs';
import {decodeSemanticPresentation} from '../../sdk/browser/semantic-presentation-wire.mjs';

export const maximumCases = ['TextFirst', 'TextLast', 'Table1First', 'Table1Last',
  'Table16First', 'Table16Last', 'CombinedFirst', 'CombinedLast'];

export function maximumShape(id) {
  if (!maximumCases.includes(id)) throw Error('unknown semantic maximum');
  const last = id.endsWith('Last');
  let frame, container, index, selector;
  if (id.startsWith('Text')) {
    frame = [1, 1, 0, 0, 0, 0, [[0, [0, 0]],
      ...Array.from({length: 255}, () => [1, [4, '']])]];
    container = frame[6][last ? 255 : 1][1]; index = 1;
    selector = `[data-presentation-node="${last ? 256 : 2}"]`;
  } else {
    if (id.startsWith('Combined')) {
      frame = combinedShape(true);
      for (const node of frame[6].slice(1)) if (node[0] === 0) node[0] = 1;
    } else {
      const columns = id.startsWith('Table16') ? 16 : 1;
      frame = [1, 1, 0, 0, 0, 0, [[0, [0, 0]],
        [1, [9, 0, Array(columns).fill(0), Array.from({length: 4096 / columns}, () => Array(columns).fill(''))]]]];
    }
    const rows = frame[6].at(-1)[1][3];
    container = rows[last ? rows.length - 1 : 0]; index = last ? container.length - 1 : 0;
    selector = `[data-presentation-node="${frame[6].length}"] tbody tr:nth-child(${last ? rows.length : 1}) td:nth-child(${index + 1})`;
  }
  const value = [1, frame, 15, 2, 256,
    frame[6].map((_, i) => [i + 1, 0, 0, 0, i === 0 ? 1 : 0, 0])];
  return {value, selector, setText(text) { container[index] = text; }};
}

export function* maximumCorpus() {
  for (const id of maximumCases) {
    const {value, setText} = maximumShape(id), overhead = encodeWire(value).length;
    // Replacing the empty text adds four CBOR length-header bytes at this size.
    setText('x'.repeat(PRESENTATION_MAXIMUM - overhead - 4));
    const request = encodeWire(value);
    if (request.length !== PRESENTATION_MAXIMUM) throw Error('exact semantic maximum required');
    decodeSemanticPresentation(request);
    yield {id, request, response: request};
  }
}
