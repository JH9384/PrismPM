import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureWpt, verifyNativeWpt} from './wpt.mjs';

test('complete pinned original ECDSA source and independent native vectors', () => {
  const capture = captureWpt();
  assert.equal(capture.names.length, 324);
  assert.equal(createHash('sha256').update(JSON.stringify(capture.names)).digest('hex'),
    '03ebd57abddb1cb3aacc3fb73ad3176721a61e3f2d4eb09e9e43743df4948772',
    'every original upstream test name remains registered');
  assert.equal(verifyNativeWpt(capture).length, 96);
});

test('original WPT pin rejects changed source even with self-consistent replacement inventory', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'prismpm-signed-context-wpt-'));
  t.after(() => rmSync(temporary, {recursive: true, force: true}));
  cpSync(new URL('../../sdk/browser/oracles/wpt-ecdsa/', import.meta.url), temporary, {recursive: true});
  const directory = pathToFileURL(temporary + '/'); captureWpt(directory);
  const manifest = JSON.parse(readFileSync(join(temporary, 'source.json')));
  const row = manifest.files.find(row => row.path.endsWith('/ecdsa.js'));
  const changed = Buffer.concat([readFileSync(join(temporary, row.path)), Buffer.from('\n// planted source change\n')]);
  writeFileSync(join(temporary, row.path), changed);
  row.bytes = changed.length; row.sha256 = createHash('sha256').update(changed).digest('hex');
  row.gitBlob = createHash('sha1').update(`blob ${changed.length}\0`).update(changed).digest('hex');
  writeFileSync(join(temporary, 'source.json'), JSON.stringify(manifest, null, 2) + '\n');
  assert.throws(() => captureWpt(directory), /independently verified upstream WPT manifest/);
});
