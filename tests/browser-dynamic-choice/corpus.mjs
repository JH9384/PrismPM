import {encodeWire} from '../../sdk/browser/presentation-wire.mjs';

export const frame = (options = [[42, 'Shared name'], [7, 'Shared name']], selected = 42) =>
  [1, 1, 0, 0, 0, 0, [[0, [2, 0]],
    [1, [11, 1, true, true, selected, options, 0]],
    [1, [8, 2, 1, true, true, [2]]]]];

export function corpus() {
  const positive = [
    ['SourceOrderDuplicateNames', frame()],
    ['UnicodeMarkupText', frame([[4294967295, '\uFEFF<svg onload="bad()">😀</svg>'], [1, 'é']], 1)],
    ['ExactNameBytes', frame([[1, '😀'.repeat(1024)]], 1)],
    ['NoSelection', frame([], 0)],
  ];
  for (let phase = 1; phase <= 3; phase++) {
    const value = frame(); value[2] = phase;
    value[6][1][1][2] = false; value[6][2][1][3] = false;
    positive.push(['DisabledPhase' + phase, value]);
  }
  const negative = [
    ['DuplicateIdentifier', x => { x[6][1][1][5][1][0] = 42; }],
    ['ZeroIdentifier', x => { x[6][1][1][5][1][0] = 0; }],
    ['MissingSelection', x => { x[6][1][1][4] = 2; }],
    ['EmptyName', x => { x[6][1][1][5][1][1] = ''; }],
    ['OverNameBytes', x => { x[6][1][1][5][1][1] = '😀'.repeat(1024) + 'x'; }],
    ['CatalogueIndexAsText', x => { x[6][1][1][5][1][1] = 1; }],
    ['OptionExtraField', x => { x[6][1][1][5][1].push('extra'); }],
    ['OptionMissingField', x => { x[6][1][1][5][1].pop(); }],
    ['MissingEpoch', x => { x[6][1][1].pop(); }],
    ['OutsideForm', x => { x[6][1][0] = 0; }],
    ['EnabledPending', x => { x[2] = 1; }],
    ['DisabledBoundField', x => { x[6][1][1][2] = false; }],
  ].map(([id, mutate]) => { const value = frame(); mutate(value); return [id, value]; });
  return [...positive.map(([id, value]) => ({id, value, accepted: true, request: encodeWire(value)})),
    ...negative.map(([id, value]) => ({id, value, accepted: false, request: encodeWire(value)}))];
}

export function mixedOptions(count) {
  const value = frame(Array.from({length: count - 1}, (_, i) => [i + 1, 'Name ' + i]), 1);
  value[6].push([1, [7, 1, true, false, 4294967295, [[4294967295, 2]], 0]]);
  return value;
}

export const labels = ['Application', 'Choose organization', 'Continue', 'Choose an organization.',
  'Choose an available organization.', 'Skip to main content']
  .map((text, index) => ({id: 'label' + String(index).padStart(2, '0'), text}));
export const designs = [[
  [0xffffff, 0x161616, 0x555555, 0x005fcc, 0xffffff, 0xb00020, 0x005fcc, 0, 1000, 1500, 1000, 250, 72, 16, 48, 44],
  [0x121212, 0xffffff, 0xcccccc, 0x9dc4ff, 0x121212, 0xffb4ab, 0x9dc4ff, 0, 1000, 1500, 1000, 250, 72, 16, 48, 44],
]];
export const semantic = value => {
  const copy = structuredClone(value); copy[6].push([0, [0, 0]]);
  return [1, copy, 0, 0, 6, [[2, 0, 4, 5, 0, 0], [copy[6].length, 0, 0, 0, 1, 0]]];
};
export function sourceFixture(revision = 1, phase = 0, focus = 0) {
  return [1, [1, revision, phase, 0, 0, focus, [[0, [0, 0]], [1, [2, 1]],
    [2, [11, 1, phase === 0, true, 42, [[42, 'Shared name'], [7, 'Shared name'],
      [9, '<svg onload="bad()">😀</svg>']], 0]], [2, [8, 2, 1, phase === 0, true, [3]]]]],
  0, 0, 6, [[1, 0, 0, 0, 1, 0], [3, 0, 4, 0, 0, 0]]];
}

const failure = code => Uint8Array.of(0x83, 1, 1, code);
export function ownerCorpus() {
  const shapeErrors = new Set(['CatalogueIndexAsText', 'OptionMissingField', 'MissingEpoch']);
  const rows = corpus().map(row => ({...row, role: 'wire',
    // Existing tag7 and new tag11 both cap the option array at two elements
    // before checking its exact arity: oversize is ValueLimit, short is WrongType.
    response: row.accepted ? row.request : failure(row.id === 'OptionExtraField' ? 6 : shapeErrors.has(row.id) ? 3 : 9)}));
  const catalogueExtra = frame([[1, 'unused']], 1);
  catalogueExtra[6][1][1][0] = 7; catalogueExtra[6][1][1][5] = [[1, 0, 'extra']];
  rows.push({id: 'CatalogueOptionExtraField', role: 'wire', request: encodeWire(catalogueExtra), response: failure(6)});
  for (const [id, count] of [['MixedOptionsExact', 256], ['MixedOptionsOver', 257]]) {
    const request = encodeWire(mixedOptions(count));
    rows.push({id, role: 'wire', request, response: count === 256 ? request : failure(9)});
  }
  const badUtf8 = encodeWire(frame([[1, 'x']], 1));
  const at = badUtf8.indexOf(0x78); if (at < 0) throw Error('UTF-8 fixture byte missing'); badUtf8[at] = 0xff;
  rows.push({id: 'InvalidNameUtf8', role: 'wire', request: badUtf8, response: failure(7)});
  const trailing = Uint8Array.from([...encodeWire(frame()), 0]);
  rows.push({id: 'TrailingDynamicFrame', role: 'wire', request: trailing, response: failure(8)});
  for (const [id, value, valid] of [['ChosenId', 7, true], ['DefaultId', 42, true],
    ['UnknownId', 2, false], ['RequiredZero', 0, false], ['NameNotId', 'Shared name', false]]) {
    rows.push({id: 'Intent' + id, role: 'intent', request: encodeWire([frame(), [1, 1, 1, [[2, value]]]]),
      response: Uint8Array.of(valid ? 245 : 244)});
  }
  const optional = frame(); optional[6][1][1][3] = false;
  rows.push({id: 'IntentOptionalZero', role: 'intent', request: encodeWire([optional, [1, 1, 1, [[2, 0]]]]), response: Uint8Array.of(245)});
  const envelope = semantic(frame()), encoded = encodeWire(envelope);
  rows.push({id: 'SemanticDynamicFieldHelpers', role: 'semantic', request: encoded, response: encoded});
  rows.push({id: 'CatalogueDynamicNames', role: 'catalogue', request: encoded, response: Uint8Array.of(245)});
  const wrongLabel = structuredClone(envelope); wrongLabel[1][6][1][1][1] = 6;
  rows.push({id: 'CatalogueMissingFieldLabel', role: 'catalogue', request: encodeWire(wrongLabel), response: Uint8Array.of(244)});
  const wrongPurpose = structuredClone(envelope); wrongPurpose[5][0][1] = 4;
  rows.push({id: 'SemanticWrongPurpose', role: 'semantic', request: encodeWire(wrongPurpose), response: failure(9)});
  for (let phase = 0; phase <= 3; phase++) rows.push({id: 'FixturePhase' + phase, role: 'fixture',
    request: encodeWire([1, 1, phase, 0]), response: encodeWire(sourceFixture(1, phase, 0))});
  rows.push({id: 'LabelsSource', role: 'labels', request: new Uint8Array(), response: new TextEncoder().encode(JSON.stringify(labels))});
  rows.push({id: 'DesignsSource', role: 'designs', request: new Uint8Array(), response: encodeWire(designs)});
  for (const row of corpus().filter(row => row.accepted)) rows.push({id: 'Size' + row.id, role: 'size',
    request: row.request, response: encodeWire(row.request.length)});
  return rows;
}
