/**
 * `prism-code generate` (issue #289): bindings and a typed client from a
 * holo's WIT world and model, written into an output directory the caller
 * names. There is no default directory and nothing is written into
 * `node_modules`.
 *
 * One code model (`model.mjs`) feeds one writer per language; JavaScript with
 * TypeScript declarations is the first. Beside the files, the output holds
 * `prism-generate.json`: the language, the generator, the world and the model
 * the files came from, and the sha256 of each file. A run whose inputs equal
 * the record and whose files are intact writes nothing. A file's sha256 is
 * over its text with LF line ends. The world and model
 * rows are shaped like `inputs.world` and `inputs.model` of `prismpm.lock`.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { sha256Hex } from '../sha256.mjs';
import { fail } from '../errors.mjs';
import { codeModel } from './model.mjs';
import * as js from './js.mjs';

/** The writer of each language. Rust and Python follow as further parts of #289. */
export const WRITERS = Object.freeze({ js });
export const RECORD = 'prism-generate.json';
export const RECORD_SCHEMA = 'prismpm/generate-record/1';

const { version } = createRequire(import.meta.url)('../../package.json');
const encoder = new TextEncoder();
const sha256 = (text) => sha256Hex(encoder.encode(text));

/**
 * The generator's identity: sha256 over its own source files, LF line ends,
 * so a change to any writer regenerates even at the same package version.
 */
async function generatorDigest() {
  const directory = new URL('./', import.meta.url);
  const names = (await readdir(directory)).filter((n) => /\.(mjs|wit)$/.test(n)).sort();
  let all = '';
  for (const name of names) {
    const text = (await readFile(new URL(name, directory), 'utf8')).replace(/\r\n/g, '\n');
    all += `${name}\n${encoder.encode(text).length}\n${text}`;
  }
  return sha256(all);
}

async function readRecord(out) {
  try {
    const record = JSON.parse(await readFile(join(out, RECORD), 'utf8'));
    return record?.schema === RECORD_SCHEMA && record.files && typeof record.files === 'object' ? record : null;
  } catch {
    return null;
  }
}

async function current(path) {
  try {
    return (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
}

/** Sorted keys, two-space indent, LF, one trailing newline. */
function recordText(record) {
  const sort = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return `${JSON.stringify(sort(record), null, 2)}\n`;
}

/**
 * Generate the bindings of `holo` (bytes) for `language` into `out`.
 * Resolves to `{ status: 'written' | 'unchanged', out, files, record }`;
 * `files` lists the files written, empty when nothing changed.
 */
export async function generate({ holo, out, language = 'js' } = {}) {
  if (typeof out !== 'string' || out === '') fail('generate.output', 'generate needs an output directory; it never writes to a default place');
  if (!Object.hasOwn(WRITERS, language)) fail('generate.language', `generate writes ${Object.keys(WRITERS).join(', ')}; ${language} is not written yet (#289)`);
  const directory = resolve(out);
  const model = await codeModel(holo);
  const files = WRITERS[language].write(model);
  if (files.some(([name]) => name === RECORD)) fail('generate.model', `the application's file name collides with ${RECORD}`);
  if (new Set(files.map(([name]) => name)).size !== files.length) fail('generate.model', 'two generated files share a name; rename the application');
  const record = {
    schema: RECORD_SCHEMA,
    language,
    generator: { name: 'prism-code', version, sha256: await generatorDigest() },
    world: { contract: model.world.contract, blake3: model.world.digest.blake3, sha256: model.world.digest.sha256 },
    model: { blake3: model.application.model.blake3, sha256: model.application.model.sha256 },
    files: Object.fromEntries(await Promise.all(files.map(async ([name, text]) => [name, await sha256(text)]))),
  };

  const previous = await readRecord(directory);
  const texts = await Promise.all(files.map(([name]) => current(join(directory, name))));
  const intact = files.every(([, text], i) => texts[i] === text);
  // Same inputs and generator give the same record; with every file intact there is nothing to do.
  if (intact && (await current(join(directory, RECORD))) === recordText(record)) {
    return { status: 'unchanged', out: directory, files: [], record };
  }
  // A file this run would replace must be one an earlier run wrote, or already equal.
  files.forEach(([name, text], i) => {
    if (texts[i] !== null && texts[i] !== text && !Object.hasOwn(previous?.files ?? {}, name)) {
      fail('generate.output', `${join(directory, name)} exists and was not written by prism-code generate; move it or choose another output directory`);
    }
  });

  await mkdir(directory, { recursive: true });
  const written = [];
  for (const [i, [name, text]] of files.entries()) {
    if (texts[i] === text) continue;
    await writeFile(join(directory, name), text);
    written.push(name);
  }
  // Files an earlier run wrote that this one no longer does.
  for (const name of Object.keys(previous?.files ?? {})) {
    if (!Object.hasOwn(record.files, name) && name !== RECORD && !name.includes('/') && !name.includes('\\')) {
      await rm(join(directory, name), { force: true });
    }
  }
  await writeFile(join(directory, RECORD), recordText(record));
  return { status: 'written', out: directory, files: written, record };
}
