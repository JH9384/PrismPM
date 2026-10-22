// Original public test data, not an implementation of P-256 field arithmetic.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root = new URL('./oracles/', import.meta.url);
export const oraclePins = Object.freeze({
  sec1: Object.freeze({url: 'https://www.secg.org/sec1-v2.pdf', bytes: 970457,
    sha256: '54687189af3de645756a30a801b596fd14c6566992c13bfd58eede399f324a89'}),
  sec2: Object.freeze({url: 'https://www.secg.org/sec2-v2.pdf', bytes: 306784,
    sha256: '87b8f3703364ed5b21ba8582e411cc0cbf477bcaa3f4f45e0d6580d1c00d9952'}),
  cavp: Object.freeze({url: 'https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Algorithm-Validation-Program/documents/dss/186-4ecdsatestvectors.zip',
    archiveSha256: 'fe47cc92b4cee418236125c9ffbcd9bb01c8c34e74a4ba195d954bcb72824752',
    member: '186-4ecdsatestvectors/PKV.rsp', bytes: 38511,
    sha256: '1d33551c1a199b1fc2b0e4075cdfd52d4830503ef37e6b16f04ce617d524f3f1'}),
  acvp: Object.freeze({repository: 'https://github.com/usnistgov/ACVP-Server',
    revision: '975de31eb83d87039ec88934fdc47d8c312b892d',
    path: 'gen-val/json-files/ECDSA-KeyVer-FIPS186-5/internalProjection.json',
    gitBlob: 'fcf68c30755eae275df5baff37f0ba7f7eedc2c7', bytes: 17432,
    sha256: 'b8c47508838e8fb9f57eac1fbfda75a4f0b7d340e3a685bc667a19fc8c8c4aaa'}),
});
function original(name, pin, directory) {
  const path = fileURLToPath(new URL(name, directory)), stat = lstatSync(path);
  assert.equal(realpathSync(path), path, 'unaliased original vector source');
  assert.ok(stat.isFile() && stat.nlink === 1 && stat.size < 100000, 'bounded original vector source');
  const encoded = readFileSync(path, 'utf8');
  assert.match(encoded, /^(?:[A-Za-z0-9+/]{1,76}\n)*(?:[A-Za-z0-9+/]{1,76}={0,2}\n)$/);
  const compact = encoded.replaceAll('\n', ''), bytes = Buffer.from(compact, 'base64');
  assert.equal(bytes.toString('base64'), compact, 'canonical byte-preserving source encoding');
  assert.equal(bytes.length, pin.bytes, 'complete original vector source');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, 'independently pinned original vector source');
  if (pin.gitBlob) assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), pin.gitBlob);
  return bytes;
}
function point(source, id, x, y, valid, reason) {
  assert.match(x, /^[a-fA-F0-9]+$/); assert.match(y, /^[a-fA-F0-9]+$/);
  // Upstream supplies integer coordinates, not SEC1 octets. Pad valid-width
  // integers to 32 bytes; preserve oversized integers without truncation.
  const coordinate = value => Buffer.from(value.padStart(Math.max(64, Math.ceil(value.length / 2) * 2), '0'), 'hex');
  return Object.freeze({source, id, x, y, valid, reason,
    key: Buffer.concat([Buffer.from([4]), coordinate(x), coordinate(y)])});
}
export function oraclePoints(directory = root) {
  const cavp = original('PKV.rsp.base64', oraclePins.cavp, directory).toString('ascii');
  const sections = cavp.split(/(?=^\[)/m).filter(section => /^\[P-256\]\r\n/.test(section));
  assert.equal(sections.length, 1, 'one complete P-256 PKV section');
  const blocks = sections[0].replace(/^\[P-256\]\r\n/, '').trim().split(/\r\n\r\n/);
  const cases = blocks.map((block, index) => {
    const match = /^Qx = ([a-f0-9]+)\r\nQy = ([a-f0-9]+)\r\nResult = ([PF]) \(([^\r\n]*)\)$/.exec(block.trim());
    assert.ok(match, 'complete unmodified CAVP coordinate/result record');
    return point('CAVP-PKV-P256', index + 1, match[1], match[2], match[3] === 'P', match[4]);
  });
  assert.equal(cases.length, 12); assert.equal(cases.filter(row => row.valid).length, 4);
  const acvp = JSON.parse(original('ACVP-KeyVer-FIPS186-5.json.base64', oraclePins.acvp, directory));
  assert.equal(acvp.algorithm, 'ECDSA'); assert.equal(acvp.mode, 'keyVer');
  assert.equal(acvp.revision, 'FIPS186-5'); assert.equal(acvp.isSample, true);
  assert.equal(acvp.testGroups.length, 12);
  const groups = acvp.testGroups.filter(group => group.curve === 'P-256');
  assert.equal(groups.length, 1); assert.equal(groups[0].testType, 'AFT');
  assert.deepEqual(groups[0].tests.map(row => row.tcId), [4, 5, 6]);
  for (const row of groups[0].tests) {
    assert.equal(typeof row.testPassed, 'boolean');
    cases.push(point('ACVP-FIPS186-5-P256', row.tcId, row.qx, row.qy, row.testPassed, row.reason));
  }
  assert.equal(cases.length, 15); assert.equal(cases.filter(row => row.valid).length, 5);
  return Object.freeze(cases);
}
