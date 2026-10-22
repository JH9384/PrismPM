import assert from 'node:assert/strict';
import {fixture, request, expected, encode, bytes, clone} from './corpus.mjs';

const id = index => 'r' + String(index).padStart(5, '0');
const records = count => Array.from({length: count}, (_, index) => ({id: id(index), digest: bytes()}));
const files = count => Array.from({length: count}, (_, index) => ({path: id(index), digest: bytes()}));
const fail = code => encode([1, 1, code]);
const malformed = code => encode([1, 2, code]);
const kinds = ['services', 'components', 'controls', 'dependencies', 'verificationFiles', 'browserFiles', 'oracleAttestations', 'requirements'];
export const maximumNames = Object.freeze(kinds.flatMap(name => [name + 'Exact', name + 'Over'])
  .concat(['CombinedStructuralMaxima', 'AggregateComponentReferencesOver', 'ExactOutput64MiB',
    'ExactOutput64MiBLate', 'OutputOneOver64MiB', 'ExactInput64MiB', 'ExactInput64MiBLate', 'InputOneOver64MiB',
    'MaximumWidthServices', 'MaximumWidthComponentReferences', 'MaximumWidthDependencyUris', 'MaximumCountOutput64MiB',
    'MaximumCountOutput64MiBLate', 'MaximumCountInput64MiB', 'MaximumCountInput64MiBLate',
    'WideServicesExactOutput64MiB', 'WideServicesExactOutput64MiBLate']));

function boundedValue(name, over, value = fixture()) {
  const count = name === 'requirements' ? 4096 : 65536;
  const size = count + Number(over), {closure, capture} = value;
  if (name === 'services') {
    closure.services = Array.from({length: size}, (_, index) => ({id: id(index), components: [id(index)]}));
    capture.components = records(size);
  } else if (name === 'components') {
    capture.components = records(size);
    closure.services[0].components = capture.components.map(row => row.id);
  } else if (name === 'controls') {
    capture.controls = records(size); closure.controls = capture.controls.map(row => row.id);
  } else if (name === 'dependencies') capture.dependencies = records(size);
  else if (name === 'requirements') {
    const obligation = clone(closure.declaration.obligations[1]);
    const requirement = clone(closure.requirements[1]);
    closure.declaration.obligations = Array.from({length: size}, (_, index) => ({...clone(obligation), id: index + 1,
      moment: index === size - 1 ? 1 : 0, assurance: index === size - 1 ? 6 : 1}));
    closure.requirements = Array.from({length: size}, (_, index) => ({...clone(requirement), obligation: index + 1,
      member: {module: 'Publication', name: id(index)}}));
  } else {
    capture[name] = files(size);
    if (name === 'verificationFiles') capture[name][0] = {path: 'manifest.json', digest: capture.verificationManifest};
  }
  return value;
}

function bounded(name, over) {
  const value = boundedValue(name, over);
  return {id: name + (over ? 'Over' : 'Exact'), request: request(value),
    response: over ? malformed(6) : expected(value)};
}

function exactFrame(target, side, late = false, count = 32768, value = fixture()) {
  value.capture.browserFiles = Array.from({length: count}, (_, index) => ({path: id(index) + '-'.repeat(294), digest: bytes()}));
  const measure = side === 'output' ? expected : request;
  let remaining = target - measure(value).length;
  assert.ok(remaining > 0);
  // Every path stays within CBOR's same 256..65535-byte head width, so each
  // appended ASCII byte changes the independent wire length by exactly one.
  // Keep canonical inventory ordering while filling opposite ends of the
  // retained payload. This exercises both early and late aggregate exhaustion.
  const filling = late ? [...value.capture.browserFiles].reverse() : value.capture.browserFiles;
  for (const row of filling) {
    const amount = Math.min(remaining, 2048 - row.path.length);
    row.path += '-'.repeat(amount); remaining -= amount;
  }
  assert.equal(remaining, 0, 'exact aggregate frame fits the unchanged field and row caps');
  const input = request(value), output = expected(value);
  assert.equal(side === 'output' ? output.length : input.length, target);
  return {request: input, response: output};
}

export function maximum(name) {
  assert.ok(maximumNames.includes(name));
  if (name.startsWith('WideServicesExactOutput64MiB')) {
    const value = fixture(), wide = index => id(index) + '-'.repeat(122);
    value.capture.components = Array.from({length: 65536}, (_, index) => ({id: wide(index), digest: bytes()}));
    value.closure.services = value.capture.components.map(row => ({id: row.id, components: [row.id]}));
    const row = exactFrame(67108864, 'output', name.endsWith('Late'), 32768, value);
    assert.ok(row.request.length <= 67108864);
    return {id: name, ...row};
  }
  if (name === 'MaximumWidthDependencyUris') {
    const value = fixture(); value.capture.dependencies = [];
    const baseInput = request(value).length, baseOutput = expected(value).length;
    // One canonical row: array(2), text(2048), bytes(32). Array length >=256
    // replaces the empty inventory's one-byte head with a three-byte head.
    const width = 1 + 3 + 2048 + 2 + 32;
    // The response's dependency-preimage byte string also changes from its
    // two-byte head to a five-byte head at this aggregate size.
    const count = Math.floor((67108864 - Math.max(baseInput + 2, baseOutput + 5)) / width);
    assert.ok(count >= 256 && count < 65536);
    value.capture.dependencies = Array.from({length: count}, (_, index) => ({
      id: 'https://example.invalid/' + id(index) + '-'.repeat(2018), digest: bytes(),
    }));
    assert.ok(value.capture.dependencies.every(row => Buffer.byteLength(row.id) === 2048));
    const input = request(value), output = expected(value);
    assert.equal(input.length, baseInput + 2 + count * width);
    assert.equal(output.length, baseOutput + 5 + count * width);
    assert.ok(input.length <= 67108864 && output.length <= 67108864);
    assert.ok(Math.max(input.length, output.length) + width > 67108864,
      'one more maximum-width URI exceeds the unchanged aggregate frame cap');
    return {id: name, request: input, response: output};
  }
  if (name === 'MaximumWidthServices' || name === 'MaximumWidthComponentReferences') {
    const value = fixture(), wide = index => id(index) + '-'.repeat(122);
    value.capture.components = Array.from({length: 65536}, (_, index) => ({id: wide(index), digest: bytes()}));
    value.closure.services = name === 'MaximumWidthServices'
      ? value.capture.components.map(row => ({id: row.id, components: [row.id]}))
      : [{id: 'all', components: value.capture.components.map(row => row.id)}];
    assert.ok(value.capture.components.every(row => Buffer.byteLength(row.id) === 128));
    const input = request(value), output = expected(value);
    assert.ok(input.length <= 67108864 && output.length <= 67108864);
    return {id: name, request: input, response: output};
  }
  for (const kind of kinds) for (const over of [false, true])
    if (name === kind + (over ? 'Over' : 'Exact')) return bounded(kind, over);
  if (name === 'CombinedStructuralMaxima') {
    const value = fixture();
    // The service maximum already partitions the complete component maximum.
    for (const kind of kinds.filter(kind => kind !== 'components')) boundedValue(kind, false, value);
    const input = request(value), output = expected(value);
    assert.ok(input.length <= 67108864 && output.length <= 67108864,
      'simultaneous structural maxima fit the unchanged aggregate frame bounds');
    return {id: name, request: input, response: output};
  }
  if (name === 'AggregateComponentReferencesOver') {
    const value = fixture(); value.capture.components = records(65536);
    value.closure.services = [{id: 'a', components: value.capture.components.map(row => row.id)}, {id: 'b', components: [id(0)]}];
    return {id: name, request: request(value), response: fail(0)};
  }
  if (name === 'InputOneOver64MiB') return {id: name, request: Buffer.alloc(67108865), response: malformed(6)};
  const side = name.includes('Input64MiB') ? 'input' : 'output';
  const over = name === 'OutputOneOver64MiB';
  const row = exactFrame(67108864 + Number(over), side, name.endsWith('Late'),
    name.startsWith('MaximumCount') ? 65536 : 32768);
  if (side === 'input') { assert.ok(row.response.length > 67108864); row.response = malformed(6); }
  else {
    assert.ok(row.request.length <= 67108864);
    if (over) row.response = malformed(6);
  }
  return {id: name, ...row};
}
