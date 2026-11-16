// Every code raised in sdk/npm/prism-code/src and crates/prismpm/src against ERRORS.md and model/errors.toml (#448).
// `xtask validate` gates the Rust side on every change. This also runs when the JavaScript side changes, and fails on any code model/sdk-diagnostics.toml does not register.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errors } from '../src/errors-namespace.mjs';

const repo = (path) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const PP = /\bPP\d{4}\b/g;

const filesUnder = (dir, extensions) =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension)))
    .map((entry) => join(entry.parentPath, entry.name));

const mentionedPP = (dir, extensions) => {
  const mentioned = new Map();
  for (const file of filesUnder(dir, extensions)) {
    for (const [code] of readFileSync(file, 'utf8').matchAll(PP)) if (!mentioned.has(code)) mentioned.set(code, file);
  }
  return mentioned;
};

const modelCodes = new Set([...readFileSync(repo('model/errors.toml'), 'utf8').matchAll(/^code = "(PP\d{4})"\s*$/gm)].map((match) => match[1]));
const errorsMd = readFileSync(repo('ERRORS.md'), 'utf8');
const documentedPP = new Set([...errorsMd.matchAll(/^## `(PP\d{4})`/gm)].map((match) => match[1]));

/** The rows of model/sdk-diagnostics.toml: each `code`, and the `class` it is the own code of, if any. */
const sdkRows = [...readFileSync(repo('model/sdk-diagnostics.toml'), 'utf8').replace(/\r\n/g, '\n').matchAll(/^\[\[error\]\]\ncode = "([^"]+)"\n(?:class = "([^"]+)"\n)?/gm)].map((match) => ({ code: match[1], class: match[2] }));
const sdkCodes = new Set(sdkRows.map((row) => row.code));
const advice = 'Every code prism-code raises is a row of model/sdk-diagnostics.toml, owned by its module\'s capability; add the row and run `cargo xtask validate-model --write` to regenerate ERRORS.md.';

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The codes the package sets on a `PrismCodeError` or passes as `code`. A code built
 * from a variable, such as `export.${check}`, is listed by its prefix, as `export.*`.
 * src/vendor is the copy of @prism-code/verify, whose only registered codes are its PP codes.
 */
function raisedCodes() {
  const raised = new Set();
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  for (const file of filesUnder(dir, ['.mjs', '.js'])) {
    if (/[\\/]vendor[\\/]/.test(file)) continue;
    const text = withoutComments(readFileSync(file, 'utf8'));
    const patterns = [/\bfail\(\s*(['"`])([^'"`]+)\1/g, /new PrismCodeError\(\s*(['"`])([^'"`]+)\1/g, /new [A-Z]\w*Error\([^;]{0,300}?\bcode: (')([^']+)'/g];
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) raised.add(match[2].replace(/\$\{[^}]+\}/g, '*'));
  }
  // A decision table generated from a LexLean model (src/image-store-rules.json) names the code it refuses with.
  for (const file of filesUnder(dir, ['.json'])) {
    if (/[\\/]vendor[\\/]/.test(file)) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(/"refuse ([a-z][\w.-]*)"/g)) raised.add(match[1]);
  }
  return raised;
}

const sorted = (values) => [...values].sort();

test('ERRORS.md and model/errors.toml list the same PP codes', () => {
  assert.ok(modelCodes.size > 0);
  assert.deepEqual(sorted(documentedPP), sorted(modelCodes));
});

test('every PP code in crates/prismpm/src is registered', () => {
  const mentioned = mentionedPP(repo('crates/prismpm/src'), ['.rs', '.js', '.mjs']);
  assert.ok(mentioned.size > 0);
  for (const [code, file] of mentioned) assert.ok(modelCodes.has(code), `${file} names ${code}, which model/errors.toml does not register`);
});

test('every PP code in sdk/npm/prism-code/src is registered', () => {
  const mentioned = mentionedPP(fileURLToPath(new URL('../src/', import.meta.url)), ['.mjs', '.js']);
  assert.ok(mentioned.size > 0);
  for (const [code, file] of mentioned) assert.ok(modelCodes.has(code), `${file} names ${code}, which model/errors.toml does not register`);
});

test('every code of an error class is registered with its class', () => {
  const classes = Object.entries(errors.codes).map(([name, code]) => ({ code, class: name }));
  assert.ok(classes.length > 0);
  assert.deepEqual(sorted(classes.map((row) => `${row.code} ${row.class}`)), sorted(sdkRows.filter((row) => row.class).map((row) => `${row.code} ${row.class}`)), advice);
});

test('every code the package raises is registered, and every check code registered is raised', () => {
  const all = [...raisedCodes()];
  for (const code of all.filter((code) => /^PP\d{4}$/.test(code))) assert.ok(modelCodes.has(code), `prism-code raises ${code}, which model/errors.toml does not register`);
  const raised = new Set(all.filter((code) => !/^PP\d{4}$/.test(code)));
  for (const code of raised) {
    assert.ok(!code.includes('*'), `${code} is built from a variable; raise each code as a literal, so that it can be registered`);
    assert.ok(sdkCodes.has(code), `prism-code raises ${code}, which model/sdk-diagnostics.toml does not register. ${advice}`);
  }
  const checks = sdkRows.filter((row) => !row.class).map((row) => row.code);
  assert.deepEqual(sorted(checks), sorted(raised), 'model/sdk-diagnostics.toml registers a code that prism-code no longer raises; remove its row.');
});

test('ERRORS.md lists every row of model/sdk-diagnostics.toml', () => {
  assert.ok(sdkRows.length > 0);
  for (const row of sdkRows) assert.ok(errorsMd.includes(`| \`${row.code}\` |`), `ERRORS.md has no row for ${row.code}; run cargo xtask validate-model --write`);
});
