import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimental_recorder, experimental_replay, fromFile, historyJson, parseHistory } from './runtime.mjs';
import { TestSetupError } from './errors.mjs';

const textOf = (path) => readFile(path, 'utf8');

/** Read a `prism/history/1` file. A file the schema rejects is a `ReplayError` (`replay.history`), as for `prism-code replay`. */
export async function readHistory(path) {
  return parseHistory(await textOf(path));
}

/**
 * Write a history as `prism-code history` and `prism-code replay` write it: canonical JSON and one LF,
 * so the same history is the same bytes and a fixture diff shows only what changed.
 */
export async function writeHistory(path, history) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, historyJson(history));
}

/**
 * Record the dispatches `run` makes against `app` as a history. `run` receives a `dispatch` that behaves
 * as `app.dispatch` does, a refusal included, and records each outcome; whatever it throws, the dispatches
 * that finished before are in the history only if `run` returns, so catch what a test expects to throw.
 *
 * @param {object} app an application from `load`
 * @param {(dispatch: (request: Uint8Array | ArrayBuffer) => Promise<Uint8Array>) => unknown} run
 */
export async function recordHistory(app, run) {
  const recorder = experimental_recorder(app);
  await run(recorder.dispatch);
  return recorder.history();
}

/**
 * Replay histories against `app` and resolve to the result, which holds the `prism/replay/v1` statement.
 * A divergence rejects with `DeterminismViolationError`, as `prism-code replay` exits 1 on one.
 */
export function assertReplays(app, histories, options) {
  return experimental_replay(app, histories, options);
}

const FIXTURES = fileURLToPath(new URL('./', import.meta.resolve('prism-code/package.json'))) + 'fixtures';

/** The reference archives found beside prism-code's fixtures, by name: Calculator ships in the npm package, Payment Approval only in the repository. */
export async function referenceArchives({ directory = FIXTURES } = {}) {
  return (await readdir(directory)).filter((file) => file.endsWith('.holo')).map((file) => file.slice(0, -'.holo'.length)).sort();
}

/**
 * A reference archive and its recorded history: `{ name, path, historyPath, bytes(), history(), load(options) }`.
 * `directory` defaults to the fixtures of the installed `prism-code`.
 *
 * @param {string} name `Calculator` or `PaymentApproval`
 */
export async function referenceArchive(name, { directory = FIXTURES } = {}) {
  const names = await referenceArchives({ directory });
  if (!names.includes(name)) throw new TestSetupError(`no reference archive named ${name} in ${directory}; found ${names.join(', ') || 'none'}`, { check: 'testing.fixture' });
  const path = join(directory, `${name}.holo`);
  const historyPath = join(directory, `${name}.history.json`);
  return Object.freeze({
    name,
    path,
    historyPath,
    bytes: async () => new Uint8Array(await readFile(path)),
    history: () => readHistory(historyPath),
    load: (options) => fromFile(path, options),
  });
}
