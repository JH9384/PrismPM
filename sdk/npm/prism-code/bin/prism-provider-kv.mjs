#!/usr/bin/env node
/**
 * prism-provider-kv — the reference provider (#294, experimental): a local
 * key-value store, kept as one JSON file. It starts no daemon, because a
 * provider's `up` must exit.
 *
 *   prism-provider-kv --project-name <application> up [--store=<label>] [--dir=<path>] [--set=<key>=<value> ...] <name>
 *   prism-provider-kv --project-name <application> down [--store=<label>] [--dir=<path>] <name>
 *
 * `up` creates <dir>/<application>/<store>.json if it is missing and sets each
 * --set key that is missing, so it can run again without overwriting data. It
 * returns URL, a file: URL of the store, and STORE, its label. `down` deletes
 * the file, and succeeds if there is none. The store defaults to the name of
 * the capability and the directory to .prism/kv under the project.
 *
 * It speaks the protocol in docs/proposals/294-provider-services.md: JSON Lines
 * on stdout. Exit codes: 0 done, 1 the store could not be read or written, 64 usage.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const APPLICATION = /^[a-z][a-z0-9-]{0,62}$/;
// The syntax of an allow-key-value-stores entry, without the wildcard.
const STORE = /^[a-z0-9][a-z0-9_-]*$/;

const USAGE = `Usage: prism-provider-kv --project-name <application> <up|down> [--store=<label>] [--dir=<path>] [--set=<key>=<value> ...] <name>

A provider for prism.toml, run by prism-code providers. Keeps a local key-value store as one JSON file.
`;

const say = (type, message) => process.stdout.write(`${JSON.stringify({ type, message })}\n`);

function refuse(code, message) {
  say('error', message);
  return code;
}

function parseArguments(argv) {
  const [flag, application, verb, ...rest] = argv;
  if (flag !== '--project-name' || application === undefined || verb === undefined) return { problem: 'expected --project-name <application> <up|down>' };
  if (!APPLICATION.test(application)) return { problem: 'the project name is not an application name' };
  if (verb !== 'up' && verb !== 'down') return { problem: `unknown verb ${verb}` };
  const options = { store: null, dir: '.prism/kv', set: [] };
  const names = [];
  for (const argument of rest) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(argument);
    if (!match) {
      if (argument.startsWith('-')) return { problem: `unknown flag ${argument}` };
      names.push(argument);
    } else if (match[1] === 'set') options.set.push(match[2]);
    else if (match[1] === 'store' || match[1] === 'dir') options[match[1]] = match[2];
    else return { problem: `unknown flag --${match[1]}` };
  }
  if (names.length !== 1) return { problem: 'expected one capability name' };
  const store = options.store ?? names[0];
  if (!STORE.test(store)) return { problem: `store ${JSON.stringify(store)} must match ${STORE.source}` };
  if (options.dir === '') return { problem: '--dir is empty' };
  const seeds = new Map();
  for (const pair of options.set) {
    const at = pair.indexOf('=');
    if (at < 1) return { problem: '--set takes <key>=<value>' };
    seeds.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return { verb, store, seeds, file: resolve(options.dir, application, `${store}.json`) };
}

function readStore(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const value = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('it is not a JSON object');
  return new Map(Object.entries(value));
}

function up({ store, seeds, file }) {
  const existing = readStore(file);
  const entries = existing ?? new Map();
  let added = 0;
  for (const [key, value] of seeds) {
    if (entries.has(key)) continue;
    entries.set(key, value);
    added += 1;
  }
  if (existing === null || added > 0) {
    mkdirSync(dirname(file), { recursive: true });
    const sorted = Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    // Through a temporary file, so a reader never sees half a store.
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(sorted, null, 2)}\n`);
    renameSync(temporary, file);
  }
  say('info', existing === null ? `created store ${store}` : `store ${store} is ready`);
  say('setenv', `URL=${pathToFileURL(file).href}`);
  say('setenv', `STORE=${store}`);
}

function down({ store, file }) {
  rmSync(file, { force: true });
  try {
    rmdirSync(dirname(file));
  } catch {
    // Another store of this application still lives there.
  }
  say('info', `released store ${store}`);
}

function main(argv) {
  if (argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  const parsed = parseArguments(argv);
  if (parsed.problem) return refuse(64, parsed.problem);
  try {
    if (parsed.verb === 'up') up(parsed);
    else down(parsed);
    return 0;
  } catch (error) {
    return refuse(1, `store ${parsed.store}: ${error.message}`);
  }
}

process.exitCode = main(process.argv.slice(2));
