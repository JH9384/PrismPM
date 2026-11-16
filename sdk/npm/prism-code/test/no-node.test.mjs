// `prism-code` and `prism-code/browser` load where `node:` imports are unavailable: a browser or an edge host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import nodeModule from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256HexSync } from '../src/sha256.mjs';
import { codeHash, describe } from '../src/canonical/index.js';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const HASH = 'sha256:95befdd6e691d4d89031a2a2901cc74fc6242109980b060e08ddf87829924483';

test('the entry points load and dispatch the reference archive with node: imports refused', { skip: nodeModule.registerHooks === undefined && 'needs module.registerHooks' }, () => {
  const child = spawnSync(process.execPath, [here('./support/no-node-host.mjs')], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(child.stdout);

  assert.deepEqual(report.host, { process: 'undefined', buffer: 'undefined' });
  assert.equal(report.refused, 'refused node:fs');
  for (const app of [report.topBytes, report.topUrl, report.browserUrl]) {
    assert.deepEqual(app, { verified: true, response: '1\tok\t42', acceptance: { total: 22, passed: 22, failed: [] }, level: 'P0' });
  }
  // A string reaches `prism-code/browser` from both entry points: fetched, never read as a path.
  assert.deepEqual(report.fetched, ['https://prism.test/Calculator.holo', 'https://prism.test/Calculator.holo']);
  assert.deepEqual(report.closure, { kind: 'closure', verified: true, response: '1\tok\t42', acceptance: { total: 22, passed: 22, failed: [] } });

  // The 0.1.0 calls stay synchronous and hash the same; the top-level ones warn once.
  assert.equal(report.hash, HASH);
  assert.equal(report.topHash, HASH);
  assert.equal(report.topDiffers, false);
  assert.deepEqual(report.describe, describe('﻿a\r\nb'));
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /prism-code\/canonical/);
  assert.equal(report.sha512, 'canonical.algorithm');
});

test('a bundler targeting the browser reaches no built-in and no optional dependency from the entry points', () => {
  const packageRoot = here('../');
  const left = JSON.parse(readFileSync(here('../package.json'), 'utf8')).browser;
  const skipped = new Set(Object.entries(left).filter(([, target]) => target === false).map(([path]) => resolve(packageRoot, path)));
  const visited = new Set();
  const outside = [];
  const rewritten = [];
  const walk = (file) => {
    if (visited.has(file) || skipped.has(file)) return;
    visited.add(file);
    const text = readFileSync(file, 'utf8');
    const specifiers = [
      ...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]/g),
      ...text.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g),
      ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]);
    // An import of a computed URL only reaches the network if webpack is told to leave it alone.
    for (const [, argument] of text.matchAll(/\bimport\(\s*([^)]*)/g)) {
      if (!/^['"]/.test(argument) && !argument.startsWith('/* webpackIgnore: true */')) rewritten.push(`${relative(packageRoot, file)}: import(${argument})`);
    }
    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) walk(resolve(dirname(file), specifier));
      else outside.push(`${relative(packageRoot, file)}: ${specifier}`);
    }
  };
  walk(here('../src/index.mjs'));
  walk(here('../src/browser.mjs'));
  assert.deepEqual(outside, []);
  assert.deepEqual(rewritten, []);
  assert.ok(visited.has(here('../src/canonical/index.js')));
  assert.equal(visited.has(here('../src/node.mjs')), false);
});

test('SHA-256 in JavaScript agrees with node:crypto across block boundaries', () => {
  for (const length of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70000]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 31 + length) & 0xff);
    assert.equal(sha256HexSync(bytes), createHash('sha256').update(bytes).digest('hex'), `length ${length}`);
  }
  // The FIPS 180-4 vector, with no node:crypto on either side.
  assert.equal(sha256HexSync(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('the JavaScript path hashes text as node:crypto does, lone surrogates included', () => {
  const encoder = new TextEncoder();
  for (const text of ['const x = 1;\n', 'héllo wörld\n', '日本語\n', '\u{1F600}\n', 'a\uD800b\n']) {
    const hex = createHash('sha256').update(text, 'utf8').digest('hex');
    assert.equal(sha256HexSync(encoder.encode(text)), hex);
    assert.equal(codeHash(text), `sha256:${hex}`);
    assert.equal(describe(text).bytes, Buffer.byteLength(text, 'utf8'));
  }
});

test('on Node every algorithm still goes to node:crypto', () => {
  assert.equal(codeHash('x\n', { algorithm: 'sha512', canonical: false }), `sha512:${createHash('sha512').update('x\n').digest('hex')}`);
  assert.throws(() => codeHash('x', { algorithm: 'not-a-digest' }), /digest|invalid/i);
});
