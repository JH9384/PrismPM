// The prism.toml manifest (issue #280, docs/proposals/280-prism-toml.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseManifest,
  validateManifest,
  lintManifest,
  mergeOverlay,
  manifestCapabilities,
  resolveVariables,
  parseToml,
  PrismCodeError,
  MANIFEST_TARGETS,
} from '../src/index.mjs';
import { readManifest, fromFile } from '../src/node.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const holo = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const SPEC_FIXTURES = fileURLToPath(new URL('../../spec/test/fixtures/manifest/manifest-v1/', import.meta.url));

const throwsCode = (fn, code, pattern) =>
  assert.throws(fn, (error) => {
    assert.ok(error instanceof PrismCodeError, `expected PrismCodeError, got ${error}`);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });

const EXCHANGE = `# The exchange-rate calculator
[application]
name = "exchange"
version = "0.1.0"
description = "Converts currencies."
authors = ["Ada <ada@example.com>"]

[model]
source = "model"
build = "prism build"
watch = [
  "model/**/*.lex.tex", # the model
  "examples/*.json",
]

[capabilities]
allow-outbound-hosts = ["https://api.exchange.example"]
allow-key-value-stores = ["rates"]
allow-variables = ["log_level", "exchange_api_key"]

[variables]
log_level = "info"
exchange_api_key = { secret = true }
`;

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'prism-manifest-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', ...options });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

// --- TOML reader ---------------------------------------------------------------------------

test('the TOML reader reads the subset a manifest uses', () => {
  const value = parseToml(`
top = 1
"quoted key" = 'literal \\n stays'
dotted.key = true
[a.b]
s = "tab\\tquote\\" \\u00e9 \\U0001F600"
n = -1_000
list = [1, 2,
  3, # comment
]
inline = { x = "y", z.w = false }
empty = {}
ml = """
first
second \\
   joined"""
lit = '''
raw \\n'''
`);
  assert.deepEqual(value, {
    top: 1,
    'quoted key': 'literal \\n stays',
    dotted: { key: true },
    a: { b: { s: 'tab\tquote" é 😀', n: -1000, list: [1, 2, 3], inline: { x: 'y', z: { w: false } }, empty: {}, ml: 'first\nsecond joined', lit: 'raw \\n' } },
  });
});

test('CRLF line endings and a byte order mark read the same as LF', () => {
  assert.deepEqual(parseToml('\uFEFF[t]\r\nk = "v"\r\n'), parseToml('[t]\nk = "v"\n'));
});

test('the TOML reader refuses what a manifest never has, naming the line', () => {
  const cases = [
    ['a = 1\na = 2', /line 2: key a is defined twice/],
    ['[t]\n[t]', /line 2: table \[t\] is defined twice/],
    ['[[t]]', /arrays of tables/],
    ['x = 1.5', /floats/],
    ['x = 1e3', /floats/],
    ['x = 0x1f', /only decimal integers/],
    ['x = 2026-10-26', /dates and times/],
    ['x = bare', /strings are quoted/],
    ['x = "open', /not closed/],
    ['x = "\\q"', /unknown escape/],
    ['x = [1 2]', /separated by commas/],
    ['x = { a = 1,\n b = 2 }', /inline table stays on one line/],
    ['x = { a = 1 }\n[x]', /defined twice/],
    ['__proto__ = 1', /not allowed/],
    ['[constructor]', /not allowed/],
    ['a = 1 b = 2', /after the value/],
    ['x = 99999999999999999999', /out of range/],
  ];
  for (const [text, pattern] of cases) throwsCode(() => parseToml(text), 'manifest.toml', pattern);
});

test('a key a dotted pair made cannot be redefined by a header', () => {
  throwsCode(() => parseToml('a.b = 1\n[a]'), 'manifest.toml', /defined twice/);
  throwsCode(() => parseToml('a = 1\n[a.b]'), 'manifest.toml', /already a value/);
});

test('non-UTF-8 bytes are refused', () => {
  throwsCode(() => parseToml(Uint8Array.from([0x61, 0x3d, 0xff])), 'manifest.toml', /not UTF-8/);
});

// --- Manifest ------------------------------------------------------------------------------

test('a manifest with every table parses, frozen, with no warnings', () => {
  const { manifest, target, warnings } = parseManifest(EXCHANGE);
  assert.equal(target, null);
  assert.deepEqual(warnings, []);
  assert.equal(manifest.application.name, 'exchange');
  assert.deepEqual(manifest.model.watch, ['model/**/*.lex.tex', 'examples/*.json']);
  assert.deepEqual(manifest.variables.exchange_api_key, { secret: true });
  assert.ok(Object.isFrozen(manifest) && Object.isFrozen(manifest.model.watch));
});

test('the smallest manifest is a name and a version', () => {
  const { manifest } = parseManifest('[application]\nname = "calculator"\nversion = "0.1.0"\n');
  assert.deepEqual(manifest, { application: { name: 'calculator', version: '0.1.0' } });
  assert.deepEqual(manifestCapabilities(manifest), { capabilities: null, capabilitySet: 'default', file: null });
});

test('a secret written as a literal is a lint error, and the message never echoes it', () => {
  const text = '[application]\nname = "a"\nversion = "0.1.0"\n[variables]\napi_key = { value = "hunter2", secret = true }\n';
  assert.throws(
    () => parseManifest(text),
    (error) => {
      assert.equal(error.code, 'manifest.secret');
      assert.match(error.message, /variables\.api_key is a secret, so its value must be env\(NAME\)/);
      assert.doesNotMatch(error.message, /hunter2/);
      assert.equal(error.details.errors[0].rule, 'secret-literal');
      return true;
    },
  );
});

test('a credential-shaped literal is a lint error wherever it is', () => {
  const token = `ghp_${'a'.repeat(36)}`;
  for (const where of [`[variables]\nlog_level = "${token}"`, `[model]\nbuild = "curl -H 'Authorization: ${token}'"`]) {
    const text = `[application]\nname = "a"\nversion = "0.1.0"\n${where}\n`;
    assert.throws(
      () => parseManifest(text),
      (error) => error.code === 'manifest.secret' && /looks like a GitHub token/.test(error.message) && !error.message.includes(token),
    );
  }
  const key = `-----BEGIN PRIVATE KEY-----`;
  assert.equal(lintManifest({ application: { name: 'a', version: '0.1.0' }, variables: { k: key } }).errors[0].rule, 'credential');
});

test('a secret read from the environment passes, and so does an env() literal', () => {
  const text = '[application]\nname = "a"\nversion = "0.1.0"\n[capabilities]\nallow-variables = ["*"]\n[variables]\ntoken = { value = "env(API_TOKEN)", secret = true }\nregion = "env(REGION)"\nmode = "fast"\n';
  const { manifest } = parseManifest(text);
  assert.deepEqual(resolveVariables(manifest, { API_TOKEN: 's3cret', REGION: 'eu' }), { token: 's3cret', region: 'eu', mode: 'fast' });
});

test('env() of an unset variable throws, naming the variable but no value', () => {
  const { manifest } = parseManifest(EXCHANGE);
  assert.throws(
    () => resolveVariables(manifest, {}),
    (error) => error.code === 'manifest.env' && /variables\.exchange_api_key reads env\(EXCHANGE_API_KEY\), and EXCHANGE_API_KEY is not set/.test(error.message),
  );
  assert.deepEqual(resolveVariables(manifest, { EXCHANGE_API_KEY: 'k' }), { log_level: 'info', exchange_api_key: 'k' });
  // An empty string is set.
  assert.equal(resolveVariables(manifest, { EXCHANGE_API_KEY: '' }).exchange_api_key, '');
});

test('a variable the capability set does not allow is a warning, not an error', () => {
  const text = '[application]\nname = "a"\nversion = "0.1.0"\n[variables]\nlog_level = "info"\n';
  const { warnings } = parseManifest(text);
  assert.deepEqual(
    warnings.map((w) => [w.rule, w.at]),
    [['variable-not-granted', 'variables.log_level']],
  );
});

test('the manifest rules reject what the schema rejects', () => {
  const base = (extra) => `[application]\nname = "a"\nversion = "0.1.0"\n${extra}`;
  const cases = [
    ['[model]\nsource = "model"\n', /no \[application\] table/],
    [base('[dependencies]\n'), /unknown member dependencies/],
    [base('[model]\nsource = "../x"\n'), /\.\. segment/],
    [base('[model]\nsource = "/abs"\n'), /relative path/],
    [base('[model]\nwatch = ["a", "a"]\n'), /repeats/],
    [base('[capabilities]\nfile = "c.json"\nallow-variables = ["x"]\n'), /use one or the other/],
    [base('[capabilities]\nset = "online"\n'), /needs capabilities.file/],
    [base('[capabilities]\nallow-outbound-host = []\n'), /unknown member allow-outbound-host/],
    [base('[variables]\nAPI_KEY = "x"\n'), /must match/],
    [base('[variables]\nflag = true\n'), /string or a table/],
    [base('[variables]\nx = { secret = false }\n'), /has no value/],
    [`manifest_version = 2\n${base('')}`, /not one this reader knows/],
    ['[application]\nname = "Calc"\nversion = "0.1.0"\n', /application.name/],
    ['[application]\nname = "a"\nversion = "1.0"\n', /semantic version/],
  ];
  for (const [text, pattern] of cases) throwsCode(() => parseManifest(text), 'manifest.invalid', pattern);
  // An entry the capability reader refuses is refused here too, with its code.
  throwsCode(() => parseManifest(base('[capabilities]\nallow-outbound-hosts = ["api.example.com"]\n')), 'capabilities.invalid', /malformed entry/);
});

test('manifest_version sits above the first table', () => {
  const { manifest } = parseManifest('manifest_version = 1\n[application]\nname = "a"\nversion = "0.1.0"\n');
  assert.equal(manifest.manifest_version, 1);
});

test('an overlay merges tables key by key and replaces arrays', () => {
  const merged = mergeOverlay({ a: { x: 1, list: [1, 2], keep: true }, b: 'base' }, { a: { x: 2, list: [] }, c: { new: 1 } });
  assert.deepEqual(merged, { a: { x: 2, list: [], keep: true }, b: 'base', c: { new: 1 } });
  const overlay = '[capabilities]\nallow-outbound-hosts = []\nallow-key-value-stores = []\n';
  const { manifest, target } = parseManifest(EXCHANGE, { target: 'browser', overlay });
  assert.equal(target, 'browser');
  assert.deepEqual(manifest.capabilities, { 'allow-outbound-hosts': [], 'allow-key-value-stores': [], 'allow-variables': ['log_level', 'exchange_api_key'] });
  assert.equal(manifest.application.name, 'exchange');
});

test('an overlay is checked as part of the merged manifest', () => {
  throwsCode(() => parseManifest(EXCHANGE, { target: 'node', overlay: '[variables]\nexchange_api_key = { value = "literal", secret = true }\n' }), 'manifest.secret');
  throwsCode(() => parseManifest(EXCHANGE, { target: 'node', overlay: 'manifest_version = 1\n' }), 'manifest.overlay', /may not set manifest_version/);
  throwsCode(() => parseManifest(EXCHANGE, { target: 'wasm' }), 'manifest.overlay', /not one of browser, node/);
  throwsCode(() => parseManifest(EXCHANGE, { overlay: '' }), 'manifest.overlay', /without the target/);
  assert.deepEqual(MANIFEST_TARGETS, ['browser', 'node']);
});

test('inline capabilities become the default set of a capability file', () => {
  const { manifest } = parseManifest(EXCHANGE);
  const { capabilities, capabilitySet, file } = manifestCapabilities(manifest);
  assert.equal(file, null);
  assert.equal(capabilitySet, 'default');
  assert.deepEqual(capabilities.sets.default['allow-key-value-stores'], ['rates']);
});

test('the schema in @prism-code/spec and validateManifest agree on every fixture', () => {
  const valid = readdirSync(SPEC_FIXTURES).filter((f) => f.endsWith('.json'));
  const invalid = readdirSync(join(SPEC_FIXTURES, 'invalid')).filter((f) => f.endsWith('.json'));
  assert.ok(valid.length >= 3 && invalid.length >= 6);
  for (const name of valid) {
    const value = JSON.parse(readFileSync(join(SPEC_FIXTURES, name), 'utf8'));
    validateManifest(value);
    assert.deepEqual(lintManifest(value).errors, [], name);
  }
  for (const name of invalid) {
    const value = JSON.parse(readFileSync(join(SPEC_FIXTURES, 'invalid', name), 'utf8'));
    assert.throws(
      () => {
        validateManifest(value);
        const { errors } = lintManifest(value);
        if (errors.length) throw new PrismCodeError('manifest.secret', errors[0].message);
      },
      PrismCodeError,
      name,
    );
  }
});

// --- Node: reading a project ---------------------------------------------------------------

test('readManifest reads prism.toml and the overlay for the target, when it exists', async () => {
  const dir = project({ 'prism.toml': EXCHANGE, 'prism.browser.toml': '[capabilities]\nallow-outbound-hosts = []\n' });
  const plain = await readManifest(dir);
  assert.deepEqual(plain.files, ['prism.toml']);
  assert.deepEqual(plain.grant.capabilities.sets.default['allow-outbound-hosts'], ['https://api.exchange.example']);
  const browser = await readManifest(dir, { target: 'browser' });
  assert.deepEqual(browser.files, ['prism.toml', 'prism.browser.toml']);
  assert.deepEqual(browser.grant.capabilities.sets.default['allow-outbound-hosts'], []);
  const node = await readManifest(dir, { target: 'node' });
  assert.deepEqual(node.files, ['prism.toml'], 'no prism.node.toml, no overlay');
});

test('readManifest opens a capability file the manifest names, relative to the project', async () => {
  const caps = JSON.stringify({ schema: 'prism/capabilities/1', sets: { default: {}, online: { 'allow-outbound-hosts': ['https://api.example.com'] } } });
  const dir = project({ 'prism.toml': '[application]\nname = "a"\nversion = "0.1.0"\n[capabilities]\nfile = "caps.json"\nset = "online"\n', 'caps.json': caps });
  const { grant } = await readManifest(dir);
  assert.equal(grant.capabilitySet, 'online');
  const app = await fromFile(holo, grant);
  assert.equal(app.capabilities.set, 'online');
  assert.ok(app.capabilities.allows('outbound-hosts', 'https://api.example.com/x'));
  const missing = project({ 'prism.toml': '[application]\nname = "a"\nversion = "0.1.0"\n[capabilities]\nfile = "nope.json"\n' });
  await assert.rejects(readManifest(missing), (error) => error.code === 'capabilities.path');
  await assert.rejects(readManifest(project({})), (error) => error.code === 'manifest.path');
});

// --- CLI -----------------------------------------------------------------------------------

test('prism-code manifest prints the application, the grant and the variables', () => {
  const dir = project({ 'prism.toml': EXCHANGE });
  const { code, out, err } = run(['manifest', dir]);
  assert.equal(code, 0, err);
  assert.equal(out, 'exchange 0.1.0 from prism.toml\ncapabilities: set default (inline)\nvariables: log_level, exchange_api_key (secret)\n');
  const json = JSON.parse(run(['manifest', dir, '--json']).out);
  assert.deepEqual(json.files, ['prism.toml']);
  assert.equal(json.manifest.application.version, '0.1.0');
  assert.deepEqual(json.warnings, []);
  // The current directory is the default.
  assert.equal(run(['manifest'], { cwd: dir }).code, 0);
});

test('prism-code manifest --target merges the overlay', () => {
  const dir = project({ 'prism.toml': EXCHANGE, 'prism.node.toml': '[application]\ndescription = "Node build."\n' });
  const json = JSON.parse(run(['manifest', dir, '--target', 'node', '--json']).out);
  assert.deepEqual(json.files, ['prism.toml', 'prism.node.toml']);
  assert.equal(json.target, 'node');
  assert.equal(json.manifest.application.description, 'Node build.');
  assert.equal(run(['manifest', dir, '--target', 'wasm']).code, 64);
  assert.equal(run(['manifest', dir, '--target']).code, 64);
});

test('prism-code manifest exits 2 on a secret literal or a bad manifest, and warns on stderr', () => {
  const secret = project({ 'prism.toml': '[application]\nname = "a"\nversion = "0.1.0"\n[variables]\nk = { value = "plain", secret = true }\n' });
  const refused = run(['manifest', secret]);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /^manifest\.secret: variables\.k is a secret/);
  const bad = project({ 'prism.toml': '[application]\nname = "a"\n' });
  assert.equal(run(['manifest', bad]).code, 2);
  assert.equal(run(['manifest', project({})]).code, 2);
  const warned = run(['manifest', project({ 'prism.toml': '[application]\nname = "a"\nversion = "0.1.0"\n[variables]\nx = "1"\n' })]);
  assert.equal(warned.code, 0);
  assert.match(warned.err, /^warning: variable-not-granted: variables\.x/m);
});
