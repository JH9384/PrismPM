/**
 * Run one example script under Node with the module map and capture its
 * standard output. The script's text is shown on the page exactly as it is
 * on disk, and the captured output becomes the output block. A script that
 * exits non-zero fails the generation, so a page can never show an example
 * that does not run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOCS_DIR } from './spec.mjs';
import { PRISM_CODE_DIR } from './runtime.mjs';

export const EXAMPLES_DIR = join(DOCS_DIR, 'examples');
const REGISTER = pathToFileURL(join(DOCS_DIR, 'lib', 'register.mjs')).href;

/** A `.sh` example is command lines a reader types; any other is a Node script. */
const isCommands = (name) => existsSync(join(EXAMPLES_DIR, `${name}.sh`));

export function exampleSource(name) {
  return readFileSync(join(EXAMPLES_DIR, `${name}.${isCommands(name) ? 'sh' : 'mjs'}`), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Run each line of a `.sh` example, every one a `prism-code` command with no
 * quoting, against the command in this repository. Each line's output is
 * captured in turn, and a line that exits non-zero fails the example.
 */
function runCommands(name, { cwd }) {
  const source = exampleSource(name);
  let output = '';
  for (const line of source.split('\n').filter(Boolean)) {
    const [command, ...args] = line.split(/\s+/);
    if (command !== 'prism-code') throw new Error(`example ${name}: ${line} is not a prism-code command`);
    const result = spawnSync(process.execPath, ['--no-warnings', join(PRISM_CODE_DIR, 'bin', 'prism-code.mjs'), ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', PRISM_MINIMUM_LEVEL: '' },
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`example ${name}: ${line} exited with ${result.status}:\n${result.stderr}`);
    output += result.stdout.replace(/\r\n/g, '\n');
  }
  return { name, source, output, language: 'bash' };
}

/**
 * @param {string} name file name under examples/, without `.mjs`
 * @param {{ map: Record<string, string>, cwd: string }} options bare specifier to file URL, and the working directory
 */
export function runExample(name, { map, cwd }) {
  if (isCommands(name)) return runCommands(name, { cwd });
  const source = exampleSource(name);
  const result = spawnSync(process.execPath, ['--no-warnings', '--import', REGISTER, join(EXAMPLES_DIR, `${name}.mjs`)], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PRISM_DOCS_MODULE_MAP: JSON.stringify(map), NO_COLOR: '1', FORCE_COLOR: '0', PRISM_MINIMUM_LEVEL: '' },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`example ${name} exited with ${result.status}:\n${result.stderr}`);
  }
  return { name, source, output: result.stdout.replace(/\r\n/g, '\n') };
}
