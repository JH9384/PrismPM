/** `prism-code volumes <verb>` (#445): declared stores, never host folders. */
import { resolve } from 'node:path';
import { createVolumes } from '../volumes.mjs';
import { manifestProviders } from '../manifest.mjs';
import { readManifest, releaseProviders, resolveProviders } from '../node.mjs';
import { canonicalJson } from '../archive.mjs';
import { parsed } from './containers.mjs';

/** The volumes of the project in `directory`: its capability grant, its provider declarations, and providers.mjs as the runner. */
async function projectVolumes(directory) {
  const project = await readManifest(resolve(directory ?? '.'));
  const { capabilities, capabilitySet } = project.grant;
  // One declaration at a time, through the functions `prism-code providers` runs.
  const only = ({ name }) => ({ ...project, manifest: { ...project.manifest, capabilities: { [name]: project.manifest.capabilities[name] } } });
  const runner = { up: (declaration) => resolveProviders(only(declaration)), down: (declaration) => releaseProviders(only(declaration)) };
  return createVolumes({ capabilities, ...(capabilitySet ? { set: capabilitySet } : {}), declarations: manifestProviders(project.manifest), runner });
}

const OPTIONS = { project: { type: 'string' }, json: { type: 'boolean' } };

const verb = (usage, count, run) => async (args) => {
  const got = parsed(args, OPTIONS, true, `usage: prism-code volumes ${usage}`);
  if (got === null) return 64;
  if (got.positionals.length !== count) {
    process.stderr.write(`usage: prism-code volumes ${usage}\n`);
    return 64;
  }
  const out = await run(await projectVolumes(got.values.project), got.positionals[0]);
  process.stdout.write(got.values.json ? `${canonicalJson(out.json)}\n` : out.text);
  return 0;
};

const describe = (v) => `${v.name}  provider ${v.provider ?? 'none declared'}  set ${v.set ?? 'none'}  guest access: no (needs ${v.guest.dependsOn.join(', ')})\n`;

export const verbs = Object.freeze({
  // `env` may hold secrets: the names reach stdout, the values never do.
  create: Object.freeze({
    run: verb('create <name> [--project <dir>] [--json]', 1, async (volumes, name) => {
      const { env, withheld, ...volume } = await volumes.create(name);
      const variables = Object.keys(env).sort();
      return { json: { ...volume, variables, withheld: withheld.map((row) => row.name) }, text: `${name}: provisioned; ${variables.length ? `variables ${variables.join(', ')}` : 'no variables'}\n` };
    }),
    usage: '<name> [--project <dir>]',
    summary: "provision a store the capability file allows and a provider declares",
  }),
  inspect: Object.freeze({
    run: verb('inspect <name> [--project <dir>] [--json]', 1, async (volumes, name) => {
      const volume = await volumes.inspect(name);
      return { json: volume, text: describe(volume) };
    }),
    usage: '<name> [--project <dir>] [--json]',
    summary: 'what the capability file and the declarations say about one volume',
  }),
  ls: Object.freeze({
    run: verb('ls [--project <dir>] [--json]', 0, async (volumes) => {
      const list = await volumes.list();
      return { json: list, text: list.length ? list.map(describe).join('') : 'volumes: none granted\n' };
    }),
    usage: '[--project <dir>] [--json]',
    summary: 'every store the capability set allows',
  }),
  rm: Object.freeze({
    run: verb('rm <name> [--project <dir>]', 1, async (volumes, name) => {
      await volumes.remove(name);
      return { json: { name, removed: true }, text: `${name}\n` };
    }),
    usage: '<name> [--project <dir>]',
    summary: "release the store through its provider; the grant stays",
  }),
});
