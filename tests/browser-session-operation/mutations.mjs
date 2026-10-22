import assert from 'node:assert/strict';

export const hostMutations = Object.freeze([
  {id: 'capture-before-await', journey: 'capture', before: 'const operation = bytesCopy(value, FRAME);', after: 'const operation = value;'},
  {id: 'same-owner', journey: 'ownership', before: '!record || record.owner !== identity', after: '!record'},
  {id: 'close-revocation', journey: 'ownership', before: "if (closed) throw fail('capture-closed');", after: "if (false && closed) throw fail('capture-closed');"},
  {id: 'same-owner-overlap', journey: 'capture', before: "if (busy) throw fail('capture-busy');", after: "if (false && busy) throw fail('capture-busy');"},
  {id: 'defensive-frame-read', journey: 'ownership', before: '[name, bytes === null ? null : bytes.slice()]', after: '[name, bytes]'},
  {id: 'artifact-snapshot', journey: 'artifacts', before: 'bytes: bytesCopy(fields[role].bytes, FRAME)', after: 'bytes: fields[role].bytes'},
  {id: 'artifact-identity', journey: 'artifacts', before: 'if (artifact.sha256.length !== 32 || !same(await hash(artifact.bytes), artifact.sha256))',
    after: 'if (false && (artifact.sha256.length !== 32 || !same(await hash(artifact.bytes), artifact.sha256)))'},
  {id: 'distinct-predecessor', vector: 'BeginExact', before: 'before === null ? null : response(observation(before), 5)',
    after: 'before === null ? null : response(observation(after), 5)'},
  {id: 'source-error-not-success', vector: 'WrongVersion', before: "&& (bytes[2] === 1 || bytes[2] === 2) && bytes[3] <= 23) throw fail('source-refused');",
    after: '&& (bytes[2] === 1 || bytes[2] === 2) && bytes[3] <= 23) return bytes;'},
]);
export function mutateHost(source, mutation) {
  assert.equal(source.split(mutation.before).length - 1, 1, 'one exact actual host mutation ' + mutation.id);
  return source.replace(mutation.before, mutation.after);
}
