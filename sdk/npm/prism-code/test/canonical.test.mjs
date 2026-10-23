import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, codeHash, describe, differs } from '../src/canonical/index.js';
import * as top from '../src/index.mjs';

// The examples from the 0.1.0 README; the hashes must not change.
const HASH = 'sha256:95befdd6e691d4d89031a2a2901cc74fc6242109980b060e08ddf87829924483';

test('0.1.0 README examples hash the same under prism-code/canonical', () => {
  assert.equal(codeHash('const x = 1;  \r\n\r\n'), HASH);
  assert.equal(codeHash('const x = 1;\n'), HASH);
  assert.equal(differs('const x = 1;\r\n', 'const x = 1;   \n'), false);
  assert.equal(differs('const x = 1;', 'const x = 2;'), true);
  assert.equal(canonicalize('﻿a\r\nb'), 'a\nb\n');
  assert.deepEqual(describe('﻿a\r\nb'), { bytes: 7, lines: 2, eol: 'crlf', hadBom: true, finalNewline: false, hash: codeHash('a\nb\n') });
});

test('the top-level re-exports still work and warn once', () => {
  const warnings = [];
  const listener = (warning) => warnings.push(String(warning.message));
  process.on('warning', listener);
  assert.equal(top.codeHash('const x = 1;\n'), HASH);
  assert.equal(top.differs('a', 'a\n'), false);
  // Warnings are delivered on the next tick; the deprecation is registered once.
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      process.off('warning', listener);
      try {
        assert.equal(warnings.filter((w) => w.includes('prism-code/canonical')).length, 1);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});
