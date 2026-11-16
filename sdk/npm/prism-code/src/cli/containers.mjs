/** `prism-code containers <verb>` (#443): the container verbs, under the module's name. */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createPrism } from '../index.mjs';
import { fileContainerStore } from '../node.mjs';
import { readPolicy } from '../check.mjs';
import { canonicalJson } from '../archive.mjs';

/** `parseArgs`, with a usage error as exit 64 instead of a throw. */
export function parsed(args, options, allowPositionals, usage) {
  try {
    return parseArgs({ args, options, allowPositionals, strict: true });
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage}\n`);
    return null;
  }
}

const client = () => createPrism({ store: fileContainerStore(), warn: (message) => process.stderr.write(`warning: ${message} (--allow-unverified)\n`) });

const one = (usage, run, options = {}) => async (args) => {
  const got = parsed(args, options, true, `usage: ${usage}`);
  if (got === null) return 64;
  if (got.positionals.length !== 1) {
    process.stderr.write(`usage: ${usage}\n`);
    return 64;
  }
  return run(client().containers, got.positionals[0], got.values);
};

const CREATE = { policy: { type: 'string' }, 'allow-unverified': { type: 'boolean' }, rm: { type: 'boolean' }, volume: { type: 'string', multiple: true } };

async function create(args) {
  const usage = 'usage: prism-code containers create <app.holo> <input> [--policy <file>] [--allow-unverified] [--rm] [--volume <name>]...';
  const got = parsed(args, CREATE, true, usage);
  if (got === null) return 64;
  if (got.positionals.length !== 2) {
    process.stderr.write(`${usage}\n`);
    return 64;
  }
  const { policy, rm = false, volume = [] } = got.values;
  const container = await client().containers.create(resolve(got.positionals[0]), got.positionals[1], {
    ...(policy === undefined ? {} : { policy: () => readPolicy(policy) }),
    allowUnverified: got.values['allow-unverified'] === true,
    rm,
    ...(volume.length === 0 ? {} : { volumes: volume }),
  });
  process.stdout.write(`${container.id}\n`);
  return 0;
}

async function ps(args) {
  const got = parsed(args, { all: { type: 'boolean', short: 'a' }, json: { type: 'boolean' } }, false, 'usage: prism-code containers ps [--all] [--json]');
  if (got === null) return 64;
  const records = await Promise.all((await client().containers.list({ all: got.values.all === true })).map((container) => container.inspect()));
  if (got.values.json) {
    process.stdout.write(`${canonicalJson(records)}\n`);
    return 0;
  }
  process.stdout.write('CONTAINER ID   IMAGE                STATUS     EXIT  CREATED\n');
  for (const { id, image, state, created } of records) {
    process.stdout.write(`${id.slice(0, 12)}   ${(image.name ?? 'unnamed').slice(0, 20).padEnd(20)} ${state.status.padEnd(10)} ${String(state.exitCode ?? '-').padEnd(5)} ${created}\n`);
  }
  return 0;
}

export const verbs = Object.freeze({
  create: Object.freeze({ run: create, usage: '<app.holo> <input> [--volume <name>]...', summary: 'make a container without starting it; prints its id' }),
  inspect: Object.freeze({ flat: 'inspect', usage: '<container> [--json]', summary: 'the same as prism-code inspect' }),
  logs: Object.freeze({
    run: one('prism-code containers logs <container>', async (containers, id) => {
      process.stdout.write(await containers.logs(id));
      return 0;
    }),
    usage: '<container>',
    summary: 'the output the run returned, from its record',
  }),
  ls: Object.freeze({ run: ps, usage: '[-a|--all] [--json]', summary: 'the same as prism-code ps' }),
  ps: Object.freeze({ run: ps, usage: '[-a|--all] [--json]', summary: 'running containers, or every one with --all' }),
  rm: Object.freeze({ flat: 'rm', usage: '<container>...', summary: 'the same as prism-code rm' }),
  run: Object.freeze({ flat: 'run', usage: '<app.holo> <input> ...', summary: 'the same as prism-code run' }),
  start: Object.freeze({
    run: one('prism-code containers start <container>', async (containers, id) => {
      const container = await containers.start(id);
      if (container.output) process.stdout.write(container.output);
      if (container.error) process.stderr.write(`${container.error.code ?? container.error.name}: ${container.error.message}\n`);
      return container.exitCode;
    }),
    usage: '<container>',
    summary: 'run a created container in this process; the store never keeps the input',
  }),
});

/** Docker's top-level words: `ps` is `containers ps`, `logs` is `containers logs`. */
export const aliases = Object.freeze({ ps: 'ps', logs: 'logs' });
