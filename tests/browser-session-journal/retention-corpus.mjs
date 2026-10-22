// Independent bounded protocol fixtures; no storage/authority implementation.
import assert from 'node:assert/strict';
export const reference = number => {const bytes = new Uint8Array(32); new DataView(bytes.buffer).setUint32(0, number); return bytes;};
const none = () => [0], some = value => [1, value], ok = value => [1, 0, value], error = code => [1, 1, code];
const changed = (value, index, replacement) => {const result = structuredClone(value); result[index] = replacement; return result;};

export function encodeRetentionFixture(value) {
  // Only canonical fixture construction, independently cross-checked against
  // the accepted scalar codec on its shared domain. This is not runtime glue.
  const parts = []; let length = 0, nodes = 0;
  function append(bytes) {length += bytes.length; assert.ok(length <= 67108864); parts.push(bytes);}
  function head(major, number) {
    assert.ok(Number.isSafeInteger(number) && number >= 0 && number <= 0xffffffff);
    if (number < 24) return append(Uint8Array.of(major * 32 + number));
    const width = number <= 255 ? 1 : number <= 65535 ? 2 : 4, bytes = new Uint8Array(width + 1);
    bytes[0] = major * 32 + ({1: 24, 2: 25, 4: 26})[width];
    for (let index = width; index > 0; index--) {bytes[index] = number & 255; number = Math.floor(number / 256);}
    append(bytes);
  }
  function item(value, depth) {
    assert.ok(++nodes <= 600000 && depth <= 16);
    if (typeof value === 'number') return head(0, value);
    if (typeof value === 'boolean') return append(Uint8Array.of(value ? 245 : 244));
    if (typeof value === 'string') {assert.ok(value.isWellFormed()); const bytes = new TextEncoder().encode(value); head(3, bytes.length); return append(bytes);}
    if (value instanceof Uint8Array) {head(2, value.length); return append(value);}
    assert.ok(Array.isArray(value) && value.length <= 4097); head(4, value.length);
    for (const child of value) item(child, depth + 1);
  }
  item(value, 0); const bytes = new Uint8Array(length); let at = 0;
  for (const part of parts) {bytes.set(part, at); at += part.length;}
  return bytes;
}
const vector = (id, input, output, area) => ({id, request: encodeRetentionFixture(input), response: encodeRetentionFixture(output), area});

export function retentionCorpus() {
  const rows = [], a = reference(1), b = reference(2), c = reference(3), d = reference(4), e = reference(5);
  const empty = [1, 0, [], []], initial = [1, 7, [a, b, c, d], [['app', a, [a, b]], ['staging', c, [b, c]]]];
  const add = (id, snapshot, replacement, additions, retire, expected, area = 'commit') =>
    rows.push(vector(id, [1, 0, snapshot, replacement, additions, retire], expected, area));
  rows.push(vector('RetentionEmptySnapshot', [1, 1, empty], ok(true), 'snapshot'));
  rows.push(vector('RetentionSharedSnapshot', [1, 1, initial], ok(true), 'snapshot'));
  add('RetentionEmptyCommit', empty, none(), [], [], ok([1, 1, [], []]));
  add('RetentionInitialCreate', empty, some(['app', none(), a, [a]]), [a], [], ok([1, 1, [a], [['app', a, [a]]]]));
  add('RetentionStageUnreferenced', empty, none(), [a, b], [], ok([1, 1, [a, b], []]));
  add('RetentionRetireUnreferenced', initial, none(), [], [d], ok([1, 8, [a, b, c], initial[3]]), 'retirement');
  add('RetentionIdempotentAddition', initial, none(), [b], [], ok([1, 8, initial[2], initial[3]]), 'addition');
  add('RetentionAtomicReplacement', initial, some(['app', some(a), d, [d]]), [], [a],
    ok([1, 8, [b, c, d], [['app', d, [d]], initial[3][1]]]), 'replacement');
  add('RetentionAtomicAddReplaceRetire', initial, some(['app', some(a), e, [e]]), [e], [a, d],
    ok([1, 8, [b, c, e], [['app', e, [e]], initial[3][1]]]), 'replacement');
  add('RetentionReleaseStagingMarker', initial, some(['staging', some(c), d, [d]]), [], [c],
    ok([1, 8, [a, b, d], [initial[3][0], ['staging', d, [d]]]]), 'replacement');
  for (const [name, ref] of [['Active', a], ['Shared', b], ['Staging', c]])
    add('RetentionProtect' + name, initial, none(), [], [ref], error(7), 'protected');
  add('RetentionReplacementStillProtectsShared', initial, some(['app', some(a), d, [d]]), [], [a, b], error(7), 'protected');
  add('RetentionMissingNewChunk', initial, some(['app', some(a), e, [b, e]]), [], [a], error(7), 'closure');
  add('RetentionCurrentRootCannotDeleteOwnHead', initial, none(), [], [a, b], error(7), 'closure');
  add('RetentionStaleExpectedHead', initial, some(['app', some(d), d, [d]]), [], [], error(4), 'compare-and-swap');
  add('RetentionCreateCannotReplace', initial, some(['app', none(), d, [d]]), [], [], error(4), 'compare-and-swap');
  add('RetentionUpdateCannotCreate', initial, some(['new', some(a), d, [d]]), [], [], error(4), 'compare-and-swap');
  add('RetentionMissingRetirement', initial, none(), [], [e], error(5), 'retirement');
  add('RetentionAddRetireOverlap', initial, none(), [d], [d], error(6), 'retirement');
  add('RetentionDuplicateAdditions', initial, none(), [d, d], [], error(2), 'canonical');
  add('RetentionUnsortedAdditions', initial, none(), [d, a], [], error(2), 'canonical');
  add('RetentionDuplicateRetirement', initial, none(), [], [d, d], error(3), 'canonical');
  add('RetentionUnsortedRetirement', initial, none(), [], [d, a], error(3), 'canonical');
  add('RetentionShortAddition', initial, none(), [new Uint8Array(31)], [], error(2), 'reference');
  add('RetentionMissingOwnHead', initial, some(['app', some(a), d, [b]]), [], [], error(1), 'closure');
  add('RetentionEmptyNewClosure', initial, some(['app', some(a), d, []]), [], [], error(1), 'closure');
  add('RetentionUnsortedNewClosure', initial, some(['app', some(a), d, [d, b]]), [], [], error(1), 'canonical');
  add('RetentionDuplicateNewClosure', initial, some(['app', some(a), d, [d, d]]), [], [], error(1), 'canonical');
  add('RetentionInvalidName', initial, some(['../not-a-root', none(), d, [d]]), [], [], error(1), 'name');
  add('RetentionName129', initial, some(['x'.repeat(129), none(), d, [d]]), [], [], error(1), 'name');
  for (const [name, snapshot] of [['Version', changed(initial, 0, 2)], ['UnsortedObjects', changed(initial, 2, [b, a, c, d])],
    ['DuplicateObjects', changed(initial, 2, [a, b, c, d, d])], ['UnsortedRoots', changed(initial, 3, [...initial[3]].reverse())],
    ['DuplicateRoots', changed(initial, 3, [initial[3][0], initial[3][0]])], ['MissingChunk', changed(initial, 2, [a, c, d])],
    ['MissingOwnHead', changed(initial, 3, [['app', a, [b]], initial[3][1]])], ['UnsortedClosure', changed(initial, 3, [['app', a, [b, a]], initial[3][1]])],
    ['EmptyClosure', changed(initial, 3, [['app', a, []], initial[3][1]])]]) {
    rows.push(vector('RetentionSnapshot' + name, [1, 1, snapshot], ok(false), 'snapshot'));
    add('RetentionCommit' + name, snapshot, none(), [], [], error(0), 'snapshot');
  }
  const exhausted = changed(initial, 1, 0xffffffff);
  add('RetentionRevisionExhausted', exhausted, none(), [], [], error(10), 'counter');
  const boundary = changed(initial, 1, 0xfffffffe);
  add('RetentionRevisionBoundary', boundary, none(), [], [d], ok([1, 0xffffffff, [a, b, c], initial[3]]), 'counter');
  const sixtyFour = [1, 8, [a], Array.from({length: 64}, (_, index) => ['root-' + String(index).padStart(2, '0'), a, [a]])];
  add('RetentionRoot65Refused', sixtyFour, some(['zz-new', none(), a, [a]]), [], [], error(9), 'capacity');
  add('RetentionRoot64Update', sixtyFour, some(['root-63', some(a), a, [a]]), [], [], ok(changed(sixtyFour, 1, 9)), 'capacity');
  const full = [1, 9, Array.from({length: 4096}, (_, index) => reference(index + 1)), []];
  add('RetentionObject4097Refused', full, none(), [reference(4097)], [], error(8), 'capacity');
  add('RetentionAddition17Refused', empty, none(), Array.from({length: 17}, (_, index) => reference(index + 1)), [], error(2), 'capacity');
  // Independent split/range boundaries exercise the actual4096-item domain;
  // malformed objects use no roots so another closure guard cannot mask a
  // missed ordering/width check in the balanced validator.
  for (const count of [1, 3, 63, 127, 4095]) {
    const objects = Array.from({length: count}, (_, index) => reference(index + 1)), snapshot = [1, 20, objects, []];
    rows.push(vector('RetentionOddSnapshot' + count, [1, 1, snapshot], ok(true), 'split-boundary'));
    add('RetentionOddCommit' + count, snapshot, none(), [], [], ok([1, 21, objects, []]), 'split-boundary');
  }
  for (const index of [0, 2047, 2048, 4095]) {
    const objects = Array.from({length: 4096}, (_, at) => reference(at + 1));
    objects[index] = new Uint8Array(31);
    rows.push(vector('RetentionWidthAt' + index, [1, 1, [1, 0, objects, []]], ok(false), 'split-boundary'));
  }
  for (const index of [1, 2047, 2048, 4095]) {
    const objects = Array.from({length: 4096}, (_, at) => reference(at + 1));
    objects[index] = reference(index);
    rows.push(vector('RetentionDuplicateAt' + index, [1, 1, [1, 0, objects, []]], ok(false), 'split-boundary'));
  }
  for (const index of [0, 2047, 2048, 4094]) {
    const objects = Array.from({length: 4096}, (_, at) => reference(at + 1));
    [objects[index], objects[index + 1]] = [objects[index + 1], objects[index]];
    rows.push(vector('RetentionUnsortedAt' + index, [1, 1, [1, 0, objects, []]], ok(false), 'split-boundary'));
  }
  const oddObjects = Array.from({length: 255}, (_, index) => reference(2 * index + 2));
  const inserted = [reference(1), reference(255), reference(511)];
  const combined = [...oddObjects, ...inserted].toSorted((left, right) => new DataView(left.buffer).getUint32(0) - new DataView(right.buffer).getUint32(0));
  add('RetentionOddInsertRanges', [1, 20, oddObjects, []], none(), inserted, [], ok([1, 21, combined, []]), 'split-boundary');
  add('RetentionOddRetireRanges', [1, 20, oddObjects, []], none(), [], [oddObjects[0], oddObjects[127], oddObjects[254]],
    ok([1, 21, oddObjects.filter((_, index) => ![0, 127, 254].includes(index)), []]), 'split-boundary');
  const canonical = encodeRetentionFixture([1, 1, initial]);
  for (const [name, request, code] of [['Empty', [], 2], ['Trailing', [...canonical, 0], 8], ['Nonminimal', [0x83, 0x18, 1, ...canonical.slice(2)], 5],
    ['Indefinite', [0x9f, ...canonical.slice(1), 0xff], 4], ['Operation', [0x82, 1, 2], 3], ['OuterOver', [0x87], 6]])
    rows.push({id: 'RetentionWire' + name, request: Uint8Array.from(request), response: encodeRetentionFixture([1, 2, code]), area: 'wire'});
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length); return rows;
}

export function retentionMaximumCorpus() {
  const refs = Array.from({length: 4096}, (_, index) => reference(index + 1));
  const roots = Array.from({length: 64}, (_, index) => ['root-' + String(index).padStart(2, '0') + '-'.repeat(121), refs[index], refs]);
  assert.equal(roots[0][0].length, 128);
  const maximum = [1, 0xfffffffe, refs, roots];
  const rows = [vector('RetentionMaximumFrontier', [1, 0, maximum, none(), refs.slice(0, 16), []], ok([1, 0xffffffff, refs, roots]), 'maximum')];
  rows.push(vector('RetentionMaximumPredicate', [1, 1, maximum], ok(true), 'maximum'));
  rows.push(vector('RetentionRetire4096', [1, 0, [1, 9, refs, []], none(), [], refs], ok([1, 10, [], []]), 'maximum'));
  const additions = Array.from({length: 16}, (_, index) => reference(4097 + index)), kept = refs.slice(0, 4080), after = [...kept, ...additions];
  const beforeRoots = roots.map(row => [row[0], row[1], kept]), nextRoot = [roots[0][0], additions[0], after], afterRoots = [nextRoot, ...beforeRoots.slice(1)];
  rows.push(vector('RetentionFullCapacityAtomic16Replace', [1, 0, [1, 10, refs, beforeRoots],
    some([nextRoot[0], some(refs[0]), nextRoot[1], nextRoot[2]]), additions, refs.slice(4080)], ok([1, 11, after, afterRoots]), 'maximum'));
  rows.push(vector('RetentionMaximumSharedChunkProtected', [1, 0, maximum, none(), [], [refs[4095]]], error(7), 'maximum'));
  const over = Array.from({length: 4097}, (_, index) => reference(index + 1));
  rows.push(vector('RetentionObjectSnapshot4097WireRefusal', [1, 1, [1, 0, over, []]], [1, 2, 6], 'maximum'));
  for (const row of rows) assert.ok(row.request.length <= 67108864 && row.response.length <= 67108864);
  return rows;
}
