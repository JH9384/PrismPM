import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(import.meta.resolve('prism-code/package.json')).replace(/package\.json$/, 'bin/prism-code.mjs');

/** Run the `prism-code` command line of the installed package to completion: `{ code, out, err }`. */
export function runCli(args, { env = {}, input } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', input, env: { ...process.env, ...env } });
  return { code: result.status, out: result.stdout, err: result.stderr };
}
