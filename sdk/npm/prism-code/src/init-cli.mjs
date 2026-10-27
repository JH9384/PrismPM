/**
 * The `init` verb (issue #281), shared by `prism-code init` and the
 * `create-prism-code` scaffolder, so `npm create prism-code` and
 * `npx prism-code init` write the same project.
 *
 *   init [<dir>] [--name <name>] [--template <name>] [--sdk-image <ref>] [--force]
 *
 * Exit codes: 0 scaffolded, 2 refused (a file exists, a bad name, an SDK
 * image that does not bind), 64 usage, 69 Docker unavailable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { DEFAULT_TEMPLATE, TEMPLATES, bindCommands, nameFromDirectory, planInit } from './init.mjs';
import { PrismCodeError } from './errors.mjs';

export const INIT_USAGE = `Usage: init [<dir>] [--name <name>] [--template <name>] [--sdk-image <ref>] [--force]

  <dir>               the project directory, created when absent; default the current directory
  --name <name>       the application name in prism.toml; default the directory's name
  --template <name>   ${Object.keys(TEMPLATES).join(', ')}; default ${DEFAULT_TEMPLATE}
  --sdk-image <ref>   bind the project to this SDK image, NAME@sha256:DIGEST: copy its standards.lock
                      and write prismpm.lock with prismpm update --toolchain. No SDK release exists yet,
                      so there is no default; without it the project is scaffolded but not bound.
  --force             overwrite files that already exist
`;

const VALUE_OPTIONS = ['name', 'template', 'sdk-image'];

function parse(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (VALUE_OPTIONS.includes(key)) options[key] = eq > 0 ? a.slice(eq + 1) : argv[++i];
      else if (key === 'force' || key === 'help') options[key] = true;
      else return { error: `unknown option ${a}` };
    } else positional.push(a);
  }
  for (const key of VALUE_OPTIONS) if (Object.hasOwn(options, key) && (typeof options[key] !== 'string' || options[key] === '')) return { error: `--${key} takes a value` };
  if (positional.length > 1) return { error: 'init takes at most one directory' };
  return { positional, options };
}

/** Run docker; resolve to `{ code, stdout }`. stdout is captured only when asked. */
function docker(args, { capture = false } = {}) {
  return new Promise((done) => {
    const child = spawn('docker', args, { stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
    const chunks = [];
    if (capture) child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', (error) => done({ code: error.code === 'ENOENT' ? 69 : 70, stdout: null, error }));
    child.on('exit', (code, signal) => done({ code: code ?? (signal ? 1 : 0), stdout: capture ? Buffer.concat(chunks) : null }));
  });
}

const show = (args) => `docker ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;

/**
 * Run `init` with `argv` (the arguments after the verb). Writes to `out` and
 * `err` (`process.stdout`-like) and resolves to an exit code.
 * `PRISM_CODE_DRY_RUN` prints the docker commands instead of running them.
 */
export async function runInit(argv, { out = process.stdout, err = process.stderr, env = process.env, cwd = process.cwd() } = {}) {
  const parsed = parse(argv);
  if (parsed.error) {
    err.write(`${parsed.error}\n\n${INIT_USAGE}`);
    return 64;
  }
  const { positional, options } = parsed;
  if (options.help) {
    out.write(INIT_USAGE);
    return 0;
  }
  const directory = resolve(cwd, positional[0] ?? '.');
  const name = options.name ?? nameFromDirectory(directory);
  let files;
  try {
    files = planInit({ name, template: options.template ?? DEFAULT_TEMPLATE });
  } catch (error) {
    if (!(error instanceof PrismCodeError)) throw error;
    err.write(`${error.code}: ${error.message}\n`);
    return 2;
  }
  const writes = [...files.keys()];
  if (options['sdk-image']) writes.push('standards.lock', 'prismpm.lock');
  if (!options.force) {
    const existing = writes.filter((path) => existsSync(join(directory, path)));
    if (existing.length > 0) {
      err.write(`init.exists: ${existing.slice(0, 5).join(', ')}${existing.length > 5 ? ` and ${existing.length - 5} more` : ''} already exist in ${directory}; pass --force to overwrite\n`);
      return 2;
    }
  }

  out.write(`Creating ${name} in ${directory}\n`);
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), bytes);
  }
  out.write(`  prism.toml         application ${name} 0.1.0, no capabilities granted\n`);
  out.write(`  ${options.template ?? DEFAULT_TEMPLATE} template  ${files.size - 1} files (model, lexicon, Lean workspace, lexlean.lock)\n`);

  if (!options['sdk-image']) {
    out.write(`Not bound to an SDK. No PrismPM SDK release exists yet; bind an image with\n  prism-code init ${positional[0] ?? '.'} --sdk-image <NAME@sha256:DIGEST> --force\n`);
    return 0;
  }

  let uid = null;
  let gid = null;
  if (process.platform !== 'win32') ({ uid, gid } = userInfo());
  let commands;
  try {
    commands = bindCommands({ image: options['sdk-image'], cwd: directory, uid, gid });
  } catch (error) {
    if (!(error instanceof PrismCodeError)) throw error;
    err.write(`${error.code}: ${error.message}\n`);
    return 2;
  }
  if (env.PRISM_CODE_DRY_RUN) {
    out.write(`${show(commands.standards)} > standards.lock\n${show(commands.update)}\n`);
    return 0;
  }

  const standards = await docker(commands.standards, { capture: true });
  if (standards.code !== 0) {
    err.write(standards.code === 69 ? 'docker is not installed or not on PATH; binding an SDK image needs Docker\n' : `init.bind: could not read ${options['sdk-image']}'s standards.lock (docker exited ${standards.code})\n`);
    return standards.code === 69 ? 69 : 2;
  }
  const standardsPath = join(directory, 'standards.lock');
  if (existsSync(standardsPath) && !options.force && !readFileSync(standardsPath).equals(standards.stdout)) {
    err.write('init.bind: standards.lock differs from the one the SDK image carries; review the standards change explicitly\n');
    return 2;
  }
  writeFileSync(standardsPath, standards.stdout);
  out.write('  standards.lock     from the SDK image\n');

  const update = await docker(commands.update);
  if (update.code !== 0) {
    err.write(`init.bind: prismpm update --toolchain exited ${update.code}; the project is scaffolded but prismpm.lock was not written\n`);
    return update.code === 69 ? 69 : 2;
  }
  out.write(`  prismpm.lock       ${options['sdk-image']}\nDone. Next: cd ${positional[0] ?? '.'} && npx prism-code build --check\n`);
  return 0;
}
