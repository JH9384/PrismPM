// browser.js is current, imports nothing, and runs with no Node globals.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import * as source from '../src/index.mjs';
import { here, reference, table } from './helpers.mjs';

const BROWSER = here('../browser.js');
// A Windows checkout may turn LF into CRLF; the checks below read lines.
const text = readFileSync(BROWSER, 'utf8').replace(/\r\n/g, '\n');

test('browser.js is what scripts/build-browser.mjs makes from src/ today', () => {
  execFileSync(process.execPath, [here('../scripts/build-browser.mjs'), '--check'], { stdio: 'pipe' });
});

test('browser.js has no import, require, dynamic import or Node global', () => {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /^\s*import\b/m);
  assert.doesNotMatch(code, /\bimport\s*\(/);
  assert.doesNotMatch(code, /\brequire\s*\(/);
  assert.doesNotMatch(code, /['"]node:/);
  assert.doesNotMatch(code, /\b(process|Buffer|__dirname|__filename)\b/);
  assert.equal(code.match(/^export\b/gm).length, 1);
});

test('browser.js runs in a bare context that has only ECMAScript and TextDecoder', async () => {
  const context = vm.createContext({ TextDecoder });
  const script = text.replace(/^export const \{ ([^}]+) \} = (\w+);$/m, 'globalThis.verifyPackage = $2;');
  assert.notEqual(script, text);
  vm.runInContext(script, context, { filename: 'browser.js' });
  const bare = context.verifyPackage;
  assert.equal(bare.FORMAT_REVISION, source.FORMAT_REVISION);

  const intact = vm.runInContext('new Uint8Array(24801)', context);
  intact.set(reference());
  const verdict = await bare.verify(intact);
  assert.equal(verdict.schema, 'prism/verdict/1');
  assert.equal(verdict.level, 'P0');
  assert.deepEqual(JSON.parse(JSON.stringify(verdict)), await source.verify(reference()));

  const damaged = reference();
  damaged[table(damaged)[4].offset + 200] ^= 0xff;
  const failed = await bare.verify(damaged);
  assert.equal(failed.level, 'P0');
  assert.ok(failed.reasons.some((r) => r.check === 'holo.integrity' && r.message.startsWith('Section 4 ')));

  assert.deepEqual(JSON.parse(JSON.stringify(bare.inspect(reference()))), JSON.parse(JSON.stringify(source.inspect(reference()))));
});

test('browser.js loads as an ES module with the same exports as src/index.mjs', async () => {
  const module = await import('../browser.js');
  assert.deepEqual(Object.keys(module).sort(), Object.keys(source).sort());
  assert.deepEqual(await module.verify(reference()), await source.verify(reference()));
});

test('browser.js checks a log entry and a timestamp in a bare context, given only WebCrypto', async () => {
  const context = vm.createContext({ TextDecoder });
  const script = text.replace(/^export const \{ ([^}]+) \} = (\w+);$/m, 'globalThis.verifyPackage = $2;');
  vm.runInContext(script, context, { filename: 'browser.js' });
  const dir = here('fixtures/sigstore-conformance/rekor2-dsse-happy-path/');
  const bundle = JSON.parse(readFileSync(`${dir}bundle.sigstore.json`, 'utf8'));
  const root = JSON.parse(readFileSync(`${dir}trusted_root.json`, 'utf8'));
  const bare = await context.verifyPackage.verifyTransparency(bundle, root, { crypto: webcrypto });
  assert.deepEqual(JSON.parse(JSON.stringify(bare)), await source.verifyTransparency(bundle, root));
  assert.equal(bare.passed, true);
  const without = await context.verifyPackage.verifyTransparency(bundle, root);
  assert.equal(without.passed, false);
  assert.ok(without.reasons.some((r) => r.check === 'crypto.unavailable'));
});
