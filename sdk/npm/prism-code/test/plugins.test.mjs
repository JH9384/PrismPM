import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, errorHookMessages, escapeCmdArgument, invocation, readMetadata } from '../src/plugins.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const doctor = fileURLToPath(new URL('../bin/prism-doctor.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const windows = process.platform === 'win32';

// A plugin that prints its arguments as JSON, exits with `exit <n>`, and
// answers the hook call with what it was told.
const ECHO = `
const [first, ...rest] = process.argv.slice(2);
if (first === 'prism-cli-plugin-metadata') {
  process.stdout.write(JSON.stringify({ schemaVersion: '1', vendor: 'test', version: '1.0.0', shortDescription: 'Print the arguments', errorHooks: JSON.parse(process.env.ECHO_HOOKS ?? '[]') }));
} else if (first === 'prism-cli-plugin-hooks') {
  const call = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify({ messages: [\`echo saw \${call.command} exit \${call.exitCode} args \${JSON.stringify(call.args)}\`] }));
} else if (first === 'exit') {
  process.exit(Number(rest[0]));
} else {
  process.stdout.write(JSON.stringify(process.argv.slice(2)));
}
`;

/** Put `prism-<name>` on a PATH directory: a shell script on POSIX, a .cmd shim on Windows. */
function plugin(dir, name, source) {
  const scripts = join(dirname(dir), 'scripts');
  mkdirSync(scripts, { recursive: true });
  let script = source;
  if (!source.endsWith('.mjs')) {
    script = join(scripts, `prism-${name}.cjs`);
    writeFileSync(script, source);
  }
  if (windows) {
    writeFileSync(join(dir, `prism-${name}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    const shim = join(dir, `prism-${name}`);
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(shim, 0o755);
  }
}

function pathDir() {
  const dir = join(mkdtempSync(join(tmpdir(), 'prism-plugins-')), 'path dir');
  mkdirSync(dir);
  return dir;
}

/** The environment with PATH replaced, whatever its case on this platform. */
function withPath(path, extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  return { ...env, PATH: [...path, dirname(process.execPath)].join(delimiter), ...extra };
}

function run(args, env, options = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env, ...options });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('discovery: prism-<name> on the PATH, first directory wins, prism-code itself is not a plugin', () => {
  const first = pathDir();
  const second = pathDir();
  plugin(first, 'echo', ECHO);
  plugin(second, 'echo', ECHO);
  plugin(second, 'other', ECHO);
  plugin(second, 'code', ECHO);
  plugin(second, 'Bad_Name', ECHO);
  mkdirSync(join(second, windows ? 'prism-dir.cmd' : 'prism-dir'));
  if (!windows) writeFileSync(join(second, 'prism-noexec'), '#!/bin/sh\n');
  const found = discover({ env: { PATH: [first, second].join(delimiter), Path: [first, second].join(delimiter) } });
  assert.deepEqual([...found.keys()].sort(), ['echo', 'other']);
  assert.equal(dirname(found.get('echo')), first);
});

test('Windows resolution: Path and PATHEXT order, names case-insensitive, no extension no plugin', () => {
  const a = pathDir();
  const b = pathDir();
  for (const file of ['PRISM-Foo.CMD', 'prism-foo.exe', 'prism-bar.ps1', 'prism-baz', 'prism-qux.Bat']) writeFileSync(join(a, file), '');
  writeFileSync(join(b, 'prism-bar.bat'), '');
  const env = { Path: `${a};${b}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const found = discover({ env, platform: 'win32' });
  assert.deepEqual(Object.fromEntries(found), { foo: join(a, 'prism-foo.exe'), qux: join(a, 'prism-qux.Bat'), bar: join(b, 'prism-bar.bat') });
  // Without PATHEXT the Windows default applies, and .ps1 is never run.
  assert.equal(discover({ env: { PATH: a }, platform: 'win32' }).get('foo'), join(a, 'prism-foo.exe'));
  assert.equal(discover({ env: { PATH: a }, platform: 'win32' }).has('bar'), false);

  const cmd = invocation('C:\\Program Files\\x\\prism-foo.cmd', ['two words', 'a&b'], { env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, platform: 'win32' });
  assert.equal(cmd.command, 'C:\\Windows\\system32\\cmd.exe');
  assert.deepEqual(cmd.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(cmd.args[3], '"C:\\Program^ Files\\x\\prism-foo.cmd ^^^"two^^^ words^^^" ^^^"a^^^&b^^^""');
  assert.equal(cmd.options.windowsVerbatimArguments, true);
  assert.deepEqual(invocation('C:\\x\\prism-foo.exe', ['a b'], { platform: 'win32' }), { command: 'C:\\x\\prism-foo.exe', args: ['a b'], options: {} });
  assert.equal(escapeCmdArgument('back\\"slash\\'), '^"back\\\\\\^"slash\\\\^"');
});

test('a built-in verb wins over a plugin of the same name', () => {
  const dir = pathDir();
  plugin(dir, 'vectors', ECHO);
  plugin(dir, 'build', ECHO);
  plugin(dir, 'export-browser', ECHO);
  const env = withPath([dir]);
  const vectors = run(['vectors'], env);
  assert.equal(vectors.code, 64);
  assert.match(vectors.err, /vectors takes one artifact/);
  const help = run(['--help'], env);
  assert.equal(help.code, 0);
  assert.doesNotMatch(help.out, /Plugins/);
});

test('arguments and the exit code pass through to the plugin untouched', () => {
  const dir = pathDir();
  plugin(dir, 'echo', ECHO);
  const env = withPath([dir]);
  const args = ['plain', 'two words', '--port', '9', '--flag=x', '--', '-v', 'a"b', 'x&y|z', '100%', '%PATH%', '^caret', '(paren)', '!bang!', ''];
  const echoed = run(['echo', ...args], env);
  assert.equal(echoed.code, 0, echoed.err);
  assert.deepEqual(JSON.parse(echoed.out), args);
  assert.equal(run(['echo', 'exit', '7'], env).code, 7);
  assert.equal(run(['echo', 'exit', '0'], env).code, 0);
});

test('--help lists plugins under their own heading, and an invalid plugin is named but never runs', () => {
  const dir = pathDir();
  plugin(dir, 'echo', ECHO);
  plugin(dir, 'broken', 'process.stdout.write("not json");');
  const env = withPath([dir]);
  const help = run(['--help'], env);
  assert.equal(help.code, 0);
  const [, plugins] = help.out.split(/^Plugins .*:$/m);
  assert.match(plugins, /^ {2}echo {4}Print the arguments \(test, 1\.0\.0\)$/m);
  assert.match(plugins, /^ {2}broken {2}invalid: prism-cli-plugin-metadata did not print JSON$/m);
  // The verbs the #360 test reads from --help stay the built-in ones.
  const printed = [...help.out.matchAll(/^ {2}prism-code ([a-z][a-z-]*)\b/gm)].map((m) => m[1]);
  assert.equal(printed.includes('echo'), false);
  const broken = run(['broken'], env);
  assert.equal(broken.code, 64);
  assert.match(broken.err, /prism-broken is not a valid plugin: prism-cli-plugin-metadata did not print JSON/);
  assert.equal(run(['nothing-here'], env).code, 64);
});

test('error hooks run after a hooked verb fails, and only then', () => {
  const dir = pathDir();
  plugin(dir, 'echo', ECHO);
  plugin(dir, 'other', ECHO);
  const env = withPath([dir], { ECHO_HOOKS: '["vectors","other"]' });
  const failed = run(['vectors', '--model', 'm.json'], env);
  assert.equal(failed.code, 64);
  assert.match(failed.err, /\nWhat's next:\n {2}echo saw vectors exit 64 args \["--model","m.json"\]\n/);
  // The plugin's own failure is hooked by the other plugin, never by itself.
  const plugged = run(['other', 'exit', '3'], env);
  assert.equal(plugged.code, 3);
  assert.equal(plugged.err.match(/saw other exit 3/g).length, 1);
  assert.doesNotMatch(run(['vectors', fixture], env).err, /What's next/);
  assert.doesNotMatch(run(['nothing-here'], env).err, /What's next/);
  assert.doesNotMatch(run(['vectors'], { ...env, PRISM_CODE_NO_HOOKS: '1' }).err, /What's next/);
  assert.deepEqual(errorHookMessages({ command: 'vectors', args: [], exitCode: 0, env }), []);
});

test('prism-doctor is a valid plugin and its hook explains a missing lockfile or Docker', () => {
  const dir = pathDir();
  plugin(dir, 'doctor', doctor);
  const env = withPath([dir]);
  const file = discover({ env }).get('doctor');
  const { metadata } = readMetadata(file, { env });
  assert.equal(metadata.vendor, 'UOR Foundation');
  assert.deepEqual(metadata.errorHooks, ['check', 'build', 'verify', 'conformance', 'export-browser']);
  const hook = (call) => JSON.parse(spawnSync(process.execPath, [doctor, 'prism-cli-plugin-hooks'], { input: JSON.stringify(call), encoding: 'utf8' }).stdout).messages;
  assert.equal(hook({ command: 'build', exitCode: 69 }).length, 1);
  assert.deepEqual(hook({ command: 'check', exitCode: 1 }), []);
  assert.deepEqual(hook({ command: 'vectors', exitCode: 64 }), []);
  assert.deepEqual(hook({ command: 'check', args: ['app.holo', '--policy', 'p.json'], exitCode: 64 }), []);

  const empty = mkdtempSync(join(tmpdir(), 'prism-doctor-'));
  const check = run(['build', '--check'], env, { cwd: empty });
  assert.equal(check.code, 64);
  assert.match(check.err, /prismpm\.lock not found[\s\S]*What's next:\n {2}Run `prism-code doctor`/);
  const report = run(['doctor'], env, { cwd: empty });
  assert.match(report.out, /^ok {4}node \d+/m);
  assert.match(report.out, /^warn {2}no prismpm\.lock here/m);
  assert.equal(run(['doctor', 'extra'], env, { cwd: empty }).code, 64);
});
