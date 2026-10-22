// Independent finite codec expectations originate in the pinned upstream fixture.
import assert from 'node:assert/strict';
const bytes = hex => Buffer.from(hex, 'hex');
const one = value => Buffer.from([Number(value)]);
const index = value => Buffer.from(String(value));
export function codecCorpus(fixture) {
  assert.equal(fixture.schema, 'prismpm/primary-codec-oracle/1');
  assert.equal(fixture.scope, 'synthetic-codec-only');
  assert.equal(fixture.hologram_revision, '2bda6a9a9476872dade705bd61ece4209607f6da');
  assert.equal(fixture.live_revision, 'd8208266d8abdc2445b7bbc0cef412a566adfaf1');
  const rows = [], names = new Set();
  const add = (id, operation, response, ...arguments_) => {
    assert.ok(!names.has(id)); names.add(id); rows.push({id, operation, response, arguments: arguments_});
  };
  const manifest = bytes(fixture.manifest), archive = bytes(fixture.archive), body = bytes(fixture.body);
  const footer = bytes(fixture.footer), blobs = fixture.blobs.map(bytes);
  const directory = bytes(fixture.directory), provenance = bytes(fixture.provenance), metadata = bytes(fixture.metadata);
  const bodyArgs = [manifest, metadata, directory, provenance, ...blobs];
  assert.equal(manifest.length, 258); assert.equal(footer.length, 32); assert.equal(blobs.length, 3);
  add('EmptyCapabilities', 'capabilities', bytes(fixture.capabilities));
  add('Manifest', 'manifest', manifest, Buffer.from(fixture.requires), Buffer.from(fixture.guest));
  add('ValidManifest', 'valid-manifest', one(true), manifest);
  add('Body', 'body', body, ...bodyArgs);
  add('Frame', 'frame', archive, body, footer);
  add('ValidBody', 'valid-body', one(true), body);
  add('ValidFrame', 'valid-frame', one(true), archive);
  add('ExtractBody', 'body-bytes', body, archive);
  add('ExtractFooter', 'footer', footer, archive);
  for (const [at, label] of [fixture.requires, fixture.guest].entries())
    add('Reference' + at, 'reference', Buffer.from(label), manifest, index(at));
  for (const [at, payload] of fixture.sections.entries())
    add('Section' + at, 'section', bytes(payload), archive, index(at));
  for (const [at, payload] of [directory, provenance].entries())
    add('Extension' + at, 'extension', payload, archive, index(at));
  for (const [at, blob] of blobs.entries()) add('Blob' + at, 'blob', blob, blob.subarray(0, 71), blob.subarray(71));
  for (const [operation, value, limit] of [['reference', manifest, 2], ['section', archive, 7], ['extension', archive, 2]]) {
    for (const at of [limit, 8, 255, 65536, 4294967295, 18446744073709551615n])
      add(operation + 'OutOfRange' + at, operation, null, value, index(at));
  }
  for (let length = 0; length < manifest.length; length++)
    add('TruncatedManifest' + length, 'valid-manifest', one(false), manifest.subarray(0, length));
  add('TrailingManifest', 'valid-manifest', one(false), Buffer.concat([manifest, one(0)]));
  for (let at = 0; at < manifest.length; at++) {
    const changed = Buffer.from(manifest);
    changed[at] = at >= 57 && at < 199 ? 128 : changed[at] ^ 1;
    add('ManifestByte' + at, 'valid-manifest', one(false), changed);
  }
  for (const label of ['', fixture.requires + '0', fixture.requires.slice(1), 'sha256:' + 'a'.repeat(64), 'blake3:' + 'g'.repeat(64)]) {
    add('InvalidRequires' + names.size, 'manifest', null, Buffer.from(label), Buffer.from(fixture.guest));
    add('InvalidGuest' + names.size, 'manifest', null, Buffer.from(fixture.requires), Buffer.from(label));
    add('InvalidBlob' + names.size, 'blob', null, Buffer.from(label), Buffer.from('content'));
  }
  for (let at = 0; at < 10; at++) {
    const changed = Buffer.from(body); changed[at] ^= 1;
    add('Header' + at, 'valid-body', one(false), changed);
  }
  for (let row = 0; row < 7; row++) for (const field of ['kind', 'padding', 'offset', 'length']) {
    const changed = Buffer.from(body), at = 10 + row * 24 + {kind: 0, padding: 1, offset: 8, length: 16}[field];
    changed[at] ^= 1; add('Row' + row + field, 'valid-body', one(false), changed);
  }
  for (const bound of [0, 1, 9, 10, 177, 178, body.length - 1]) {
    const changed = body.subarray(0, bound);
    add('TruncatedBody' + bound, 'valid-body', one(false), changed);
    add('RefusedFraming' + bound, 'frame', null, changed, footer);
  }
  add('TrailingBody', 'valid-body', one(false), Buffer.concat([body, one(0)]));
  for (const size of [0, 1, 31, 33, 64]) add('FooterWidth' + size, 'frame', null, body, Buffer.alloc(size));
  // Framing is not cryptographic authenticity. The complete owner separately
  // requires the exact digest and upstream footer rejection for this case.
  const corruptFooter = Buffer.from(footer); corruptFooter[0] ^= 1;
  add('FooterBytesAreNotAuthenticatedByCodec', 'frame', Buffer.concat([body, corruptFooter]), body, corruptFooter);
  for (const permutation of [[1,0,2], [0,2,1], [2,1,0], [0,0,2], [0,1,1]])
    add('BlobOrder' + permutation.join(''), 'body', null, manifest, metadata, directory, provenance, ...permutation.map(at => blobs[at]));
  const requires = Buffer.from(fixture.requires), guest = Buffer.from(fixture.guest);
  const capAt = blobs.findIndex(blob => blob.subarray(0, 71).equals(requires));
  const guestAt = blobs.findIndex(blob => blob.subarray(0, 71).equals(guest));
  assert.ok(capAt >= 0 && guestAt >= 0 && capAt !== guestAt);
  {
    const changed = blobs.map(blob => Buffer.from(blob)); changed[capAt][71] ^= 1;
    add('NonemptyOrCorruptCapabilityRequest', 'body', null, manifest, metadata, directory, provenance, ...changed);
  }
  for (const [role, start] of [['Requires', 57], ['Guest', 128]]) {
    const changed = Buffer.from(manifest); changed.fill('a', start + 7, start + 71);
    add('Absent' + role + 'Reference', 'body', null, changed, metadata, directory, provenance, ...blobs);
  }
  for (const row of [2, 3]) {
    const start = Number(body.readBigUInt64LE(10 + row * 24 + 8));
    const changed = Buffer.from(body); changed[start + 2] ^= 1;
    add('ForeignExtension' + row, 'valid-body', one(false), changed);
  }
  return rows;
}
export const codecTsv = rows => rows.map(row => [row.id, row.operation,
  row.response === null ? '-' : Buffer.from(row.response).toString('hex'),
  ...row.arguments.map(value => Buffer.from(value).toString('hex'))].join('\t') + '\n').join('');
