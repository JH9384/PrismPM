// Harness-only file admission checks; no generated/native execution is claimed.
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureBrowserTranscript} from './checks.mjs';

test('browser transcripts remain distinct and create-new for every engine and maximum run', t => {
  const work = mkdtempSync(join(tmpdir(), 'presentation-replay-harness-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  const stems = ['observed-chromium', 'observed-firefox', 'observed-webkit', 'maximum-progress-browser'];
  for (const [index, stem] of stems.entries()) {
    const request = '0' + index;
    const result = {calls: [{role: 'wire', request, response: 'f4'}]};
    const {path, rows} = captureBrowserTranscript(work, result, stem);
    assert.equal(path, join(work, stem + '.tsv'));
    assert.deepEqual(rows, [{id: 'BrowserWire0', request: Buffer.from(request, 'hex'), response: Buffer.from('f4', 'hex')}]);
    assert.equal(readFileSync(path, 'utf8'), 'BrowserWire0\t' + request + '\tf4\n');
    assert.throws(() => captureBrowserTranscript(work,
      {calls: [{role: 'wire', request, response: 'f5'}]}, stem), {code: 'EEXIST'});
    assert.equal(readFileSync(path, 'utf8'), 'BrowserWire0\t' + request + '\tf4\n', 'no evidence overwrite');
  }
  assert.deepEqual(readdirSync(work).sort(), stems.map(stem => stem + '.tsv').sort());
});

test('browser transcript rejects unknown engines, paths and call roles before creating evidence', t => {
  const work = mkdtempSync(join(tmpdir(), 'presentation-replay-harness-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  for (const stem of [undefined, 'observed-browser', 'observed-safari', '../observed-chromium', '/tmp/observed-chromium'])
    assert.throws(() => captureBrowserTranscript(work, {calls: []}, stem), assert.AssertionError);
  for (const role of ['unknown', '__proto__', 'constructor', 'toString'])
    assert.throws(() => captureBrowserTranscript(work,
      {calls: [{role, request: '00', response: 'f4'}]}, 'observed-chromium'), assert.AssertionError);
  assert.deepEqual(readdirSync(work), []);
});
