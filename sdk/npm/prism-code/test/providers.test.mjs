// Provider services (issue #294, docs/proposals/294-provider-services.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityDeniedError, ERROR_CLASSES, manifestProviders, parseManifest, PrismError, ProviderError, ProviderFailedError, ProviderNotFoundError, ProviderReplyError, PrismCodeError } from '../src/index.mjs';
import { readManifest, releaseProviders, resolveProviders } from '../src/node.mjs';
import { discover, discoverProviders } from '../src/plugins.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const kv = fileURLToPath(new URL('../bin/prism-provider-kv.mjs', import.meta.url));
const windows = process.platform === 'win32';
const SECRET = 'do-not-echo-this-value';

const temporary = (prefix) => mkdtempSync(join(tmpdir(), prefix));

/** Put `prism-provider-<type>` on a PATH directory: a shell script on POSIX, a .cmd shim on Windows. `source` is JavaScript or the path of a script. */
function provider(dir, type, source) {
  let script = source;
  if (!source.endsWith('.mjs')) {
    const scripts = join(dirname(dir), 'scripts');
    mkdirSync(scripts, { recursive: true });
    script = join(scripts, `${type}-${Math.random().toString(36).slice(2)}.cjs`);
    writeFileSync(script, source);
  }
  if (windows) {
    writeFileSync(join(dir, `prism-provider-${type}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    const shim = join(dir, `prism-provider-${type}`);
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(shim, 0o755);
  }
}

function pathDir() {
  const dir = join(temporary('prism-providers-'), 'path dir');
  mkdirSync(dir);
  return dir;
}

/** The environment with PATH replaced, whatever its case on this platform. */
function withPath(path, extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  return { ...env, PATH: [...path, dirname(process.execPath)].join(delimiter), ...extra };
}

const line = (type, message) => `console.log(JSON.stringify({ type: ${JSON.stringify(type)}, message: ${JSON.stringify(message)} }));`;

/** A project holding prism.toml, read as `resolveProviders` takes it. */
async function project(capabilities, { variables = '', files = {}, target = null } = {}) {
  const dir = temporary('prism-project-');
  writeFileSync(join(dir, 'prism.toml'), `[application]\nname = "exchange"\nversion = "0.1.0"\n\n${capabilities}\n${variables}\n`);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return readManifest(dir, { target });
}

const GRANT = '[capabilities]\nallow-providers = ["*"]\nallow-variables = ["*"]\n';
const declare = (name, type, options = '') => `\n[capabilities.${name}]\nprovider = { type = "${type}"${options ? `, options = { ${options} }` : ''} }\n`;

function expectError(error, Class, check) {
  assert.ok(error instanceof Class, `expected ${Class.name}, got ${error}`);
  assert.ok(error instanceof PrismError);
  assert.equal(error.check, check);
  assert.equal(error.code, Class.code);
  return true;
}

// --- The manifest ---------------------------------------------------------------------------

test('a capability declares a provider beside the inline set, and manifestProviders gives its flags', () => {
  const { manifest, warnings } = parseManifest(
    `[application]\nname = "exchange"\nversion = "0.1.0"\n\n[capabilities]\nallow-providers = ["kv"]\nallow-variables = ["rates_url"]\n\n[capabilities.rates]\nprovider = { type = "kv", options = { store = "rates", set = ["b=2", "a=1"], size = 256, durable = true, empty = [] } }\n\n[capabilities.cache]\nprovider = { type = "kv" }\n`,
  );
  assert.deepEqual(warnings, []);
  const declared = manifestProviders(manifest);
  assert.deepEqual(declared.map((p) => p.name), ['cache', 'rates']);
  assert.deepEqual(declared[0].flags, []);
  assert.deepEqual(declared[1].flags, ['--durable=true', '--set=b=2', '--set=a=1', '--size=256', '--store=rates']);
  assert.equal(declared[1].type, 'kv');
});

test('a manifest with no provider declares none, and a capability file sits beside a declaration', () => {
  assert.deepEqual(manifestProviders(parseManifest('[application]\nname = "a"\nversion = "1.0.0"\n').manifest), []);
  const { manifest } = parseManifest('[application]\nname = "a"\nversion = "1.0.0"\n[capabilities]\nfile = "caps.json"\nset = "online"\n[capabilities.rates]\nprovider = { type = "kv" }\n');
  assert.deepEqual(manifestProviders(manifest).map((p) => p.name), ['rates']);
  assert.equal(manifest.capabilities.file, 'caps.json');
});

test('the manifest rules refuse a bad declaration', () => {
  const cases = [
    ['[capabilities]\nalow-variables = ["a"]', /unknown member alow-variables/],
    ['[capabilities]\nrates = "kv"', /must be a table/],
    ['[capabilities.rates]\nimage = "x"', /unknown member image/],
    ['[capabilities.rates]\nprovider = "kv"', /no provider/],
    ['[capabilities.rates]\nprovider = { options = {} }', /type must be a non-empty string/],
    ['[capabilities.rates]\nprovider = { type = "Key Value" }', /a provider type/],
    ['[capabilities.rates]\nprovider = { type = "kv", extra = 1 }', /unknown member extra/],
    ['[capabilities.rates]\nprovider = { type = "kv", options = { Store = "x" } }', /because it becomes a flag/],
    ['[capabilities.rates]\nprovider = { type = "kv", options = { store = { name = "x" } } }', /a string, an integer, a boolean/],
    ['[capabilities.rates]\nprovider = { type = "kv", options = { store = "a\\nb" } }', /control character/],
    ['[capabilities.rates]\nprovider = { type = "kv", options = { token = "env(API_TOKEN)" } }', /read a command line/],
  ];
  for (const [text, pattern] of cases) {
    assert.throws(
      () => parseManifest(`[application]\nname = "a"\nversion = "1.0.0"\n${text}\n`),
      (error) => error instanceof PrismCodeError && error.code === 'manifest.invalid' && pattern.test(error.message),
      text,
    );
  }
});

test('the credential lint covers provider options, and a provider the inline set does not allow is a warning', () => {
  assert.throws(
    () => parseManifest(`[application]\nname = "a"\nversion = "1.0.0"\n[capabilities.rates]\nprovider = { type = "kv", options = { token = "ghp_${'a'.repeat(36)}" } }\n`),
    (error) => error.code === 'manifest.secret' && !error.message.includes('ghp_'),
  );
  const { warnings } = parseManifest('[application]\nname = "a"\nversion = "1.0.0"\n[capabilities.rates]\nprovider = { type = "kv" }\n');
  assert.deepEqual(warnings.map((w) => [w.rule, w.at]), [['provider-not-granted', 'capabilities.rates']]);
});

test('an overlay merges options and can turn providers off', async () => {
  const overlay = '[capabilities]\ndeny-providers = ["*"]\n[capabilities.rates.provider.options]\nstore = "other"\n';
  const browser = await project(`${GRANT}${declare('rates', 'kv', 'store = "rates", dir = "d"')}`, { files: { 'prism.browser.toml': overlay }, target: 'browser' });
  assert.deepEqual(manifestProviders(browser.manifest)[0].flags, ['--dir=d', '--store=other']);
  await assert.rejects(resolveProviders(browser, { env: withPath([]) }), (error) => expectError(error, CapabilityDeniedError, 'capabilities.providers'));
});

// --- The protocol ---------------------------------------------------------------------------

const ECHO = `
${line('info', 'starting')}
${line('debug', 'detail')}
console.log(JSON.stringify({ type: 'setenv', message: 'ARGS=' + JSON.stringify(process.argv.slice(2)) }));
console.log(JSON.stringify({ type: 'setenv', message: 'CWD=' + process.cwd() }));
console.log(JSON.stringify({ type: 'setenv', message: 'MESSAGES=' + process.env.PRISM_PROVIDER_MESSAGES }));
console.log(JSON.stringify({ type: 'setenv', message: 'INHERITED=' + process.env.PROVIDER_TEST_INHERITED }));
console.log(JSON.stringify({ type: 'setenv', message: 'EQUALS=a=b=c' }));
console.log(JSON.stringify({ type: 'setenv', message: 'EMPTY=' }));
console.log(JSON.stringify({ type: 'setenv', message: 'REPEATED=first' }));
console.log('');
console.log(JSON.stringify({ type: 'setenv', message: 'REPEATED=last' }));
process.stdin.on('data', () => {}).on('end', () => { process.stdout.write(JSON.stringify({ type: 'setenv', message: 'STDIN=closed' })); });
`;

test('up runs with the flags in order, in the project directory, and returns <NAME>_<VAR>', async () => {
  const path = pathDir();
  provider(path, 'echo', ECHO);
  const tricky = 'a b&c|d "quoted" %PATH% ^x';
  const p = await project(`${GRANT}${declare('rates', 'echo', `store = 'r', tricky = '${tricky}', size = 3, set = ["x=1", "y=2"], on = true`)}`);
  const messages = [];
  const { env, providers, withheld } = await resolveProviders(p, { env: withPath([path], { PROVIDER_TEST_INHERITED: 'yes' }), onMessage: (m) => messages.push(m) });
  assert.deepEqual(JSON.parse(env.RATES_ARGS), ['--project-name', 'exchange', 'up', '--on=true', '--set=x=1', '--set=y=2', '--size=3', '--store=r', `--tricky=${tricky}`, 'rates']);
  assert.equal(realpathSync(env.RATES_CWD), realpathSync(p.directory));
  assert.equal(env.RATES_MESSAGES, 'info,error,debug,setenv');
  assert.equal(env.RATES_INHERITED, 'yes');
  assert.equal(env.RATES_EQUALS, 'a=b=c', 'split at the first =');
  assert.equal(env.RATES_EMPTY, '');
  assert.equal(env.RATES_REPEATED, 'last');
  assert.equal(env.RATES_STDIN, 'closed', 'a final line with no newline counts');
  assert.deepEqual(withheld, []);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, 'rates');
  assert.equal(providers[0].type, 'echo');
  assert.ok(providers[0].variables.includes('RATES_ARGS'));
  assert.deepEqual(messages, [
    { capability: 'rates', type: 'info', message: 'starting' },
    { capability: 'rates', type: 'debug', message: 'detail' },
  ]);
  assert.ok(Object.isFrozen(env));
});

test('a provider that returns nothing and exits 0 succeeds', async () => {
  const path = pathDir();
  provider(path, 'quiet', '');
  const { env, providers } = await resolveProviders(await project(`${GRANT}${declare('rates', 'quiet')}`), { env: withPath([path]) });
  assert.deepEqual(env, {});
  assert.deepEqual(providers[0].variables, []);
});

test('providers run in order of capability name, one at a time', async () => {
  const dir = temporary('prism-order-');
  const log = join(dir, 'log');
  const path = pathDir();
  provider(path, 'log', `require('node:fs').appendFileSync(${JSON.stringify(log)}, process.argv[process.argv.length - 1] + '\\n');`);
  await resolveProviders(await project(`${GRANT}${declare('zebra', 'log')}${declare('apple', 'log')}`), { env: withPath([path]) });
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['apple', 'zebra']);
});

// --- Deny by default ------------------------------------------------------------------------

const MARK = (file) => `require('node:fs').writeFileSync(${JSON.stringify(file)}, 'ran');`;

test('a provider the set does not allow never runs', async () => {
  const dir = temporary('prism-denied-');
  const mark = join(dir, 'ran');
  const path = pathDir();
  provider(path, 'kv', MARK(mark));
  const env = withPath([path]);
  const denied = (error) => expectError(error, CapabilityDeniedError, 'capabilities.providers') && error.details.resource === 'kv' && error.details.capability === 'rates';
  // No [capabilities] members at all.
  await assert.rejects(resolveProviders(await project(declare('rates', 'kv')), { env }), denied);
  // A set that allows another type.
  await assert.rejects(resolveProviders(await project(`[capabilities]\nallow-providers = ["other"]\n${declare('rates', 'kv')}`), { env }), denied);
  // A deny entry wins.
  await assert.rejects(resolveProviders(await project(`[capabilities]\nallow-providers = ["*"]\ndeny-providers = ["kv"]\n${declare('rates', 'kv')}`), { env }), denied);
  // Allowing a store or a variable is not allowing a provider.
  await assert.rejects(resolveProviders(await project(`[capabilities]\nallow-key-value-stores = ["*"]\nallow-variables = ["*"]\n${declare('rates', 'kv')}`), { env }), denied);
  // A capability file decides, by the set the manifest names.
  const caps = JSON.stringify({ schema: 'prism/capabilities/1', sets: { default: {}, online: { 'allow-providers': ['kv'] } } });
  await assert.rejects(resolveProviders(await project(`[capabilities]\nfile = "caps.json"\n${declare('rates', 'kv')}`, { files: { 'caps.json': caps } }), { env }), denied);
  // down is held to the same grant.
  await assert.rejects(releaseProviders(await project(declare('rates', 'kv')), { env }), denied);
  assert.equal(existsSync(mark), false);
  const { providers } = await resolveProviders(await project(`[capabilities]\nfile = "caps.json"\nset = "online"\n${declare('rates', 'kv')}`, { files: { 'caps.json': caps } }), { env });
  assert.deepEqual(providers.map((p) => p.name), ['rates']);
  assert.equal(existsSync(mark), true);
});

test('every declaration is checked before any provider starts', async () => {
  const dir = temporary('prism-preflight-');
  const mark = join(dir, 'ran');
  const path = pathDir();
  provider(path, 'first', MARK(mark));
  const env = withPath([path]);
  await assert.rejects(resolveProviders(await project(`[capabilities]\nallow-providers = ["first"]\n${declare('a', 'first')}${declare('b', 'second')}`), { env }), (error) => expectError(error, CapabilityDeniedError, 'capabilities.providers'));
  await assert.rejects(resolveProviders(await project(`${GRANT}${declare('a', 'first')}${declare('b', 'absent')}`), { env }), (error) => expectError(error, ProviderNotFoundError, 'provider.not-found'));
  assert.equal(existsSync(mark), false);
});

test('a variable the set does not allow is withheld and reported by name only', async () => {
  const path = pathDir();
  provider(path, 'two', `${line('setenv', 'URL=file:///store')}\n${line('setenv', `TOKEN=${SECRET}`)}`);
  const result = await resolveProviders(await project(`[capabilities]\nallow-providers = ["two"]\nallow-variables = ["rates_url"]\n${declare('rates', 'two')}`), { env: withPath([path]) });
  assert.deepEqual(result.env, { RATES_URL: 'file:///store' });
  assert.deepEqual(result.providers[0].variables, ['RATES_URL']);
  assert.deepEqual(result.withheld, [{ capability: 'rates', name: 'RATES_TOKEN', variable: 'rates_token' }]);
  assert.ok(!JSON.stringify(result).includes(SECRET));
  const denied = await resolveProviders(await project(`[capabilities]\nallow-providers = ["two"]\nallow-variables = ["*"]\ndeny-variables = ["rates_token"]\n${declare('rates', 'two')}`), { env: withPath([path]) });
  assert.deepEqual(Object.keys(denied.env), ['RATES_URL']);
});

test('a name with two sources is an error, whichever the sources are', async () => {
  const path = pathDir();
  provider(path, 'bc', line('setenv', 'B_C=one'));
  provider(path, 'c', line('setenv', 'C=two'));
  const collision = (error) => expectError(error, ProviderReplyError, 'provider.collision') && error.details.variable === 'a_b_c';
  await assert.rejects(resolveProviders(await project(`${GRANT}${declare('a', 'bc')}${declare('a_b', 'c')}`), { env: withPath([path]) }), collision);
  await assert.rejects(resolveProviders(await project(`${GRANT}${declare('a', 'bc')}`, { variables: '[variables]\na_b_c = "literal"\n' }), { env: withPath([path]) }), collision);
});

// --- Failures -------------------------------------------------------------------------------

test('a provider that is not on the PATH is typed', async () => {
  const p = await project(`${GRANT}${declare('rates', 'absent')}`);
  await assert.rejects(resolveProviders(p, { env: withPath([pathDir()]) }), (error) => {
    expectError(error, ProviderNotFoundError, 'provider.not-found');
    assert.ok(error instanceof ProviderError);
    assert.match(error.message, /prism-provider-absent/);
    assert.deepEqual(error.details, { capability: 'rates', type: 'absent' });
    return true;
  });
  assert.equal(ERROR_CLASSES.provider_not_found, ProviderNotFoundError);
  assert.equal(ERROR_CLASSES.provider_reply_invalid, ProviderReplyError);
  assert.equal(ERROR_CLASSES.provider_failed, ProviderFailedError);
});

test('a reply that breaks the protocol is typed, and its message quotes nothing it returned', async () => {
  const cases = [
    ['not JSON', `console.log(${JSON.stringify(SECRET)});`, /line 1 is not JSON/],
    ['not an object', 'console.log("[1]");', /is not an object/],
    ['a missing message', `console.log(JSON.stringify({ type: 'info' }));`, /exactly \{ type, message \}/],
    ['a non-string message', `console.log(JSON.stringify({ type: 'info', message: 1 }));`, /exactly \{ type, message \}/],
    ['an extra member', `console.log(JSON.stringify({ type: 'info', message: 'x', value: ${JSON.stringify(SECRET)} }));`, /exactly \{ type, message \}/],
    ['rawsetenv', line('rawsetenv', `PATH=${SECRET}`), /has a type this version does not accept/],
    ['an unknown type', line('publish-endpoint', SECRET), /has a type this version does not accept/],
    ['a setenv with no =', line('setenv', SECRET), /a setenv with no =/],
    ['a lower-case name', line('setenv', `url=${SECRET}`), /whose name does not match/],
    ['a name with a space', line('setenv', `A B=${SECRET}`), /whose name does not match/],
    ['a NUL in a value', line('setenv', `URL=${SECRET}\0`), /holds a NUL/],
    ['bytes that are not UTF-8', "process.stdout.write(Buffer.from([0x7b, 0xff, 0x7d, 0x0a]));", /is not UTF-8/],
    ['the second line', `${line('info', 'ok')}\nconsole.log('nope');`, /line 2 is not JSON/],
  ];
  for (const [name, source, pattern] of cases) {
    const path = pathDir();
    provider(path, 'bad', source);
    await assert.rejects(
      resolveProviders(await project(`${GRANT}${declare('rates', 'bad')}`), { env: withPath([path]) }),
      (error) => {
        expectError(error, ProviderReplyError, 'provider.reply');
        assert.match(error.message, pattern, name);
        assert.ok(!error.message.includes(SECRET), `${name} echoed the value`);
        assert.ok(!JSON.stringify(error.details).includes(SECRET), `${name} kept the value`);
        assert.equal(error.details.capability, 'rates');
        return true;
      },
      name,
    );
  }
});

test('a reply over the limit is refused', async () => {
  const path = pathDir();
  provider(path, 'big', `const chunk = JSON.stringify({ type: 'info', message: 'x'.repeat(1024) }) + '\\n'; for (let i = 0; i < 2048; i++) process.stdout.write(chunk);`);
  await assert.rejects(resolveProviders(await project(`${GRANT}${declare('rates', 'big')}`), { env: withPath([path]) }), (error) => expectError(error, ProviderReplyError, 'provider.reply') && /more than/.test(error.message));
});

test('a non-zero exit fails, and an error message fails even with exit 0', async () => {
  const path = pathDir();
  provider(path, 'bare', 'process.exit(3);');
  provider(path, 'says', `${line('error', 'no space left')}\nprocess.exit(1);`);
  provider(path, 'lies', line('error', 'quota exceeded'));
  const failed = (pattern, exitCode) => (error) => {
    expectError(error, ProviderFailedError, 'provider.failed');
    assert.ok(error instanceof ProviderError);
    assert.match(error.message, pattern);
    assert.equal(error.details.exitCode, exitCode);
    return true;
  };
  const env = withPath([path]);
  await assert.rejects(resolveProviders(await project(`${GRANT}${declare('rates', 'bare')}`), { env }), failed(/exited 3/, 3));
  await assert.rejects(resolveProviders(await project(`${GRANT}${declare('rates', 'says')}`), { env }), failed(/failed: no space left/, 1));
  await assert.rejects(resolveProviders(await project(`${GRANT}${declare('rates', 'lies')}`), { env }), failed(/failed: quota exceeded/, 0));
});

test('a failure names what is already up, and rolls nothing back', async () => {
  const dir = temporary('prism-rollback-');
  const log = join(dir, 'log');
  const path = pathDir();
  provider(path, 'ok', `require('node:fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');`);
  provider(path, 'broken', 'process.exit(1);');
  await assert.rejects(resolveProviders(await project(`${GRANT}${declare('a', 'ok')}${declare('b', 'broken')}`), { env: withPath([path]) }), (error) => {
    expectError(error, ProviderFailedError, 'provider.failed');
    assert.deepEqual(error.details.started, ['a']);
    return true;
  });
  assert.equal(readFileSync(log, 'utf8'), '--project-name exchange up a\n');
});

test('a provider that does not finish in time is stopped', async () => {
  const path = pathDir();
  provider(path, 'slow', `${line('info', 'waiting')}\nsetTimeout(() => {}, 4000);`);
  const started = Date.now();
  await assert.rejects(resolveProviders(await project(`${GRANT}${declare('rates', 'slow')}`), { env: withPath([path]), timeoutMs: 800 }), (error) => expectError(error, ProviderFailedError, 'provider.timeout'));
  assert.ok(Date.now() - started < 3500, 'the call returned at the timeout');
});

test('an executable that will not start is typed', { skip: windows && 'Windows runs a .cmd through cmd.exe, which starts' }, async () => {
  const path = pathDir();
  const shim = join(path, 'prism-provider-broken');
  writeFileSync(shim, '#!/nonexistent/interpreter\n');
  chmodSync(shim, 0o755);
  await assert.rejects(resolveProviders(await project(`${GRANT}${declare('rates', 'broken')}`), { env: withPath([path]) }), (error) => expectError(error, ProviderFailedError, 'provider.spawn'));
});

test('a throwing onMessage rejects the call instead of crashing the process', async () => {
  const path = pathDir();
  provider(path, 'talks', `${line('info', 'hello')}`);
  await assert.rejects(
    resolveProviders(await project(`${GRANT}${declare('rates', 'talks')}`), {
      env: withPath([path]),
      onMessage: () => {
        throw new RangeError('caller bug');
      },
    }),
    RangeError,
  );
});

// --- down -----------------------------------------------------------------------------------

test('down gets the same options, runs in reverse order, ignores setenv and attempts every provider', async () => {
  const dir = temporary('prism-down-');
  const log = join(dir, 'log');
  const path = pathDir();
  provider(path, 'log', `require('node:fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');\n${line('setenv', 'lower case is not checked=on down')}`);
  provider(path, 'broken', 'process.exit(1);');
  const manifest = `${GRANT}${declare('a', 'log', 'store = "s"')}${declare('b', 'log')}`;
  const { providers } = await releaseProviders(await project(manifest), { env: withPath([path]) });
  assert.deepEqual(providers, ['b', 'a']);
  assert.equal(readFileSync(log, 'utf8'), '--project-name exchange down b\n--project-name exchange down --store=s a\n');

  writeFileSync(log, '');
  await assert.rejects(releaseProviders(await project(`${GRANT}${declare('a', 'log')}${declare('b', 'broken')}${declare('c', 'log')}`), { env: withPath([path]) }), (error) => {
    expectError(error, ProviderFailedError, 'provider.failed');
    assert.deepEqual(error.details.released, ['c', 'a']);
    assert.deepEqual(error.details.failed, ['b']);
    return true;
  });
  assert.equal(readFileSync(log, 'utf8'), '--project-name exchange down c\n--project-name exchange down a\n');
});

// --- Discovery ------------------------------------------------------------------------------

test('providers are found like plugins, and the plugin scan does not list them', () => {
  const first = pathDir();
  const second = pathDir();
  provider(first, 'kv', '');
  provider(second, 'kv', '');
  provider(second, 'other', '');
  const env = withPath([first, second]);
  const found = discoverProviders({ env });
  assert.deepEqual([...found.keys()].sort(), ['kv', 'other']);
  assert.ok(found.get('kv').startsWith(first), 'the first PATH directory wins');
  assert.equal(discover({ env }).has('provider-kv'), false);
  const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8', env });
  assert.ok(!help.stdout.includes('provider-kv'));
  const verb = spawnSync(process.execPath, [bin, 'provider-kv'], { encoding: 'utf8', env });
  assert.equal(verb.status, 64);
});

// --- prism-provider-kv through prism-code, end to end ---------------------------------------

const KV_PROJECT = `[application]
name = "exchange"
version = "0.1.0"

[capabilities]
allow-providers = ["kv"]
allow-key-value-stores = ["rates"]
allow-variables = ["rates_url", "rates_store"]

[capabilities.rates]
provider = { type = "kv", options = { set = ["base=EUR", "quote=USD"] } }
`;

function kvProject(toml = KV_PROJECT) {
  const dir = temporary('prism-kv-');
  writeFileSync(join(dir, 'prism.toml'), toml);
  const path = pathDir();
  provider(path, 'kv', kv);
  return { dir, env: withPath([path]) };
}

const run = (args, env, cwd) => {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env, cwd });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

test('prism-provider-kv works end to end through prism-code providers', () => {
  const { dir, env } = kvProject();
  const file = join(dir, '.prism', 'kv', 'exchange', 'rates.json');

  const text = run(['providers', 'up', dir], env);
  assert.equal(text.code, 0, text.err);
  assert.equal(text.out, 'rates (kv): RATES_URL, RATES_STORE\n');
  assert.match(text.err, /rates: created store rates/);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { base: 'EUR', quote: 'USD' });

  // Another process changes the store; up again keeps the data.
  writeFileSync(file, JSON.stringify({ base: 'GBP', extra: 'kept' }));
  const json = run(['providers', 'up', dir, '--json'], env);
  assert.equal(json.code, 0, json.err);
  const result = JSON.parse(json.out);
  assert.equal(result.env.RATES_STORE, 'rates');
  assert.equal(realpathSync(fileURLToPath(result.env.RATES_URL)), realpathSync(file));
  assert.deepEqual(result.withheld, []);
  assert.deepEqual(result.providers.map((p) => p.variables), [['RATES_URL', 'RATES_STORE']]);
  assert.deepEqual(JSON.parse(readFileSync(fileURLToPath(result.env.RATES_URL), 'utf8')), { base: 'GBP', extra: 'kept', quote: 'USD' }, 'a missing key is added, an existing key is not overwritten');

  // Down releases it, and a second down has nothing to do.
  const down = run(['providers', 'down', dir], env);
  assert.equal(down.code, 0, down.err);
  assert.equal(down.out, 'released: rates\n');
  assert.equal(existsSync(file), false);
  assert.equal(run(['providers', 'down', dir, '--json'], env).out, '{"providers":["rates"]}\n');
});

test('prism-code providers keeps values out of text, withholds what is not granted, and exits 2 on failure', () => {
  const withheld = kvProject(KV_PROJECT.replace('["rates_url", "rates_store"]', '["rates_store"]'));
  const up = run(['providers', 'up', withheld.dir], withheld.env);
  assert.equal(up.code, 0, up.err);
  assert.equal(up.out, 'rates (kv): RATES_STORE\n');
  assert.match(up.err, /returned RATES_URL, and the capability set does not allow the variable rates_url; it is withheld/);
  assert.ok(!up.out.includes('file:') && !up.err.includes('file:'));

  const denied = kvProject(KV_PROJECT.replace('allow-providers = ["kv"]\n', ''));
  const refused = run(['providers', 'up', denied.dir], denied.env);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /capability_denied/);
  assert.match(refused.err, /check: capabilities\.providers/);
  assert.match(refused.err, /warning: provider-not-granted/);
  assert.equal(existsSync(join(denied.dir, '.prism')), false);

  const missing = kvProject();
  const absent = run(['providers', 'up', missing.dir], withPath([]));
  assert.equal(absent.code, 2);
  assert.match(absent.err, /provider_not_found/);

  const empty = kvProject('[application]\nname = "a"\nversion = "1.0.0"\n');
  assert.equal(run(['providers', 'up', empty.dir], empty.env).out, 'providers: none declared\n');
  assert.equal(run(['providers', 'down', empty.dir], empty.env).out, 'released: none\n');
});

test('prism-code providers checks its arguments, runs in the current directory and reads the overlay', () => {
  const { dir, env } = kvProject();
  assert.equal(run(['providers'], env).code, 64);
  assert.equal(run(['providers', 'sideways', dir], env).code, 64);
  assert.equal(run(['providers', 'up', dir, 'extra'], env).code, 64);
  assert.equal(run(['providers', 'up', dir, '--target', 'mobile'], env).code, 64);
  assert.equal(run(['providers', 'up', dir, '--target'], env).code, 64);

  assert.equal(run(['providers', 'up'], env, dir).code, 0);
  assert.ok(existsSync(join(dir, '.prism', 'kv', 'exchange', 'rates.json')));

  writeFileSync(join(dir, 'prism.browser.toml'), '[capabilities]\ndeny-providers = ["kv"]\n');
  assert.equal(run(['providers', 'up', dir, '--target', 'browser'], env).code, 2);
  assert.equal(run(['providers', 'up', dir, '--target', 'node'], env).code, 0);
});

test('prism-code manifest names the declared providers, and only when there are any', () => {
  const { dir, env } = kvProject();
  assert.match(run(['manifest', dir], env).out, /^providers: rates \(kv\)$/m);
  const empty = kvProject('[application]\nname = "a"\nversion = "1.0.0"\n');
  assert.ok(!run(['manifest', empty.dir], empty.env).out.includes('providers'));
});

test('prism-provider-kv takes a store, a directory and keys with = in them, and replies in the protocol', () => {
  const dir = temporary('prism-kv-direct-');
  const call = (...args) => {
    const result = spawnSync(process.execPath, [kv, ...args], { encoding: 'utf8', cwd: dir });
    return { code: result.status, messages: result.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
  };
  const up = call('--project-name', 'app', 'up', '--store=main', '--dir=data', '--set=url=a=b', '--set=__proto__=x', 'cache');
  assert.equal(up.code, 0);
  assert.deepEqual(up.messages.map((m) => m.type), ['info', 'setenv', 'setenv']);
  assert.ok(up.messages.every((m) => Object.keys(m).join() === 'type,message'));
  assert.equal(up.messages[2].message, 'STORE=main');
  const file = join(dir, 'data', 'app', 'main.json');
  const raw = readFileSync(file, 'utf8');
  assert.equal(JSON.parse(raw).url, 'a=b');
  assert.ok(raw.includes('"__proto__"'), 'kept as a key');
  // The store defaults to the capability's name.
  assert.match(call('--project-name', 'app', 'up', 'cache').messages[2].message, /^STORE=cache$/);
  assert.ok(existsSync(join(dir, '.prism', 'kv', 'app', 'cache.json')));
  // A second store survives the first one's release.
  assert.equal(call('--project-name', 'app', 'up', '--dir=data', 'other').code, 0);
  assert.equal(call('--project-name', 'app', 'down', '--store=main', '--dir=data', 'cache').code, 0);
  assert.equal(existsSync(file), false);
  assert.ok(existsSync(join(dir, 'data', 'app', 'other.json')));
  assert.equal(call('--project-name', 'app', 'down', '--dir=data', 'other').code, 0);
  assert.equal(existsSync(join(dir, 'data', 'app')), false, 'the empty application directory goes too');

  for (const args of [
    [],
    ['--project-name', 'app'],
    ['--project-name', 'App!', 'up', 'x'],
    ['--project-name', 'app', 'stop', 'x'],
    ['--project-name', 'app', 'up'],
    ['--project-name', 'app', 'up', 'a', 'b'],
    ['--project-name', 'app', 'up', '--nope=1', 'x'],
    ['--project-name', 'app', 'up', '--flag', 'x'],
    ['--project-name', 'app', 'up', '--set=novalue', 'x'],
    ['--project-name', 'app', 'up', '--store=../escape', 'x'],
    ['--project-name', 'app', 'up', '--dir=', 'x'],
  ]) {
    const refused = call(...args);
    assert.equal(refused.code, 64, args.join(' '));
    assert.equal(refused.messages[0].type, 'error');
  }

  mkdirSync(join(dir, 'bad', 'app'), { recursive: true });
  writeFileSync(join(dir, 'bad', 'app', 'store.json'), 'not json');
  const corrupt = call('--project-name', 'app', 'up', '--dir=bad', 'store');
  assert.equal(corrupt.code, 1);
  assert.equal(corrupt.messages[0].type, 'error');
  const help = spawnSync(process.execPath, [kv, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: prism-provider-kv/);
});

test('the package ships prism-provider-kv as a binary', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin['prism-provider-kv'], './bin/prism-provider-kv.mjs');
  assert.ok(pkg.files.includes('bin'));
});
