/**
 * The file side of `prism-code replay`, `history` and `run --record` (issue
 * #284). The replay itself is `replay.mjs`, which has no Node imports.
 */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { canonicalJson } from './archive.mjs';
import { ReplayError } from './errors.mjs';
import { displayBytes, displayOutcome, experimental_recorder, experimental_replay, historyJson } from './replay.mjs';

/** The result schema of `--json`, shared with `prismpm replay`. */
export const REPLAY_RESULT_SCHEMA = 'prismpm/replay-result/1';

const JSON_FILE = /\.json$/i;

/** A path given to `replay` as the files it means: a file, or every `.json` directly in a directory, sorted by name. */
async function historyPaths(path) {
  const full = resolve(path);
  const info = await stat(full).catch(() => null);
  if (!info) throw new ReplayError(`${path} does not exist`, { check: 'replay.history' });
  if (!info.isDirectory()) return [full];
  const names = (await readdir(full)).filter((name) => JSON_FILE.test(name)).sort();
  if (names.length === 0) throw new ReplayError(`${path} holds no history`, { check: 'replay.history' });
  return names.map((name) => join(full, name));
}

async function readHistoryFile(path) {
  try {
    return new Uint8Array(await readFile(path));
  } catch (cause) {
    throw new ReplayError(`the history ${path} cannot be read: ${cause.code ?? cause.message}`, { check: 'replay.history', cause });
  }
}

/** Write a history, or print it when `output` is absent. */
export async function writeHistory(history, output) {
  const text = historyJson(history);
  if (output) await writeFile(resolve(output), text);
  else process.stdout.write(text);
}

/**
 * Replay files against an opened application and write the statement when asked,
 * also when the replay diverged: a failed replay is evidence too. Resolves with
 * the result and the file of each history; rejects when the replay could not be
 * carried out, or when a closure was asked for a statement it cannot have.
 */
export async function replayFiles(app, paths, statementPath) {
  if (statementPath && app.kind !== 'holo') throw new ReplayError('a closure has no guest blob for a statement to name; replay a .holo to write one', { check: 'replay.statement' });
  const files = (await Promise.all(paths.map(historyPaths))).flat();
  const histories = await Promise.all(files.map(readHistoryFile));
  const result = await experimental_replay(app, histories, { throw: false });
  if (statementPath) {
    await writeFile(resolve(statementPath), `${canonicalJson(result.statement)}\n`).catch((cause) => {
      throw new ReplayError(`the statement ${statementPath} cannot be written: ${cause.code ?? cause.message}`, { check: 'replay.statement', cause });
    });
  }
  return { result, files };
}

/** The result as `--json` prints it: one canonical JSON object and a newline. */
export function replayJson(result) {
  return `${canonicalJson({ schema: REPLAY_RESULT_SCHEMA, ...result })}\n`;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A replay as text for a person. */
export function formatReplay({ result, files }) {
  const target = result.statement ? `${result.application ?? 'unnamed'}@blake3:${result.statement.subject[0].digest.blake3.slice(0, 12)}` : (result.application ?? 'unnamed');
  const lines = [`Replaying ${plural(files.length, 'history').replace('historys', 'histories')} against ${target}`];
  result.histories.forEach((history, i) => {
    const count = history.divergences.length;
    lines.push(`  ${basename(files[i])}  ${plural(history.events, 'event')}, ${count === 0 ? 'no divergence' : plural(count, 'divergence')}`);
    for (const d of history.divergences) {
      lines.push(`    event ${d.index}: request ${displayBytes(d.request)}`, `      recorded ${displayOutcome(d.expected)}`, `      replayed ${displayOutcome(d.actual)}`);
    }
  });
  lines.push(result.divergenceCount === 0 ? 'Replay: PASS  no divergence' : `Replay: FAIL  ${plural(result.divergenceCount, 'divergence')} (DeterminismViolationError, replay.divergence)`);
  return `${lines.join('\n')}\n`;
}

/**
 * An application whose dispatches are also written to a history file, whole,
 * after each one, so a crash loses at most the dispatch in flight. Used by
 * `run --record`; every other member is the application's own.
 */
export function recordingApplication(app, path) {
  const target = resolve(path);
  const recorder = experimental_recorder(app);
  let writes = Promise.resolve();
  const save = () => {
    writes = writes.then(async () => writeFile(target, historyJson(await recorder.history())));
    return writes;
  };
  return Object.freeze({
    ...app,
    dispatch: async (request) => {
      try {
        return await recorder.dispatch(request);
      } finally {
        await save();
      }
    },
  });
}
