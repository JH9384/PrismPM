/**
 * The CLI groups of the nine modules (#441): `prism-code <module> <verb>`.
 *
 * Each module that has verbs gets one line here and one file beside this one.
 * The file exports `verbs`, a frozen table from verb to one of
 * - `{ flat, usage, summary }`, the same command as the flat verb `flat`;
 * - `{ run, usage, summary }`, where `run(args)` resolves to the exit code;
 * - a function `(args) => exitCode`, when the file also exports `help`, its
 *   usage lines verbatim.
 * A file may export `aliases`, top-level verbs that mean one of its verbs
 * (`login` for `auth login`). A group verb is used only when the word after the
 * module is one of its verbs, so a flat verb that shares a module's name
 * (`verify`) keeps working.
 */
import * as auth from './auth.mjs';
import * as containers from './containers.mjs';
import * as images from './images.mjs';
import * as system from './system.mjs';
import * as volumes from './volumes.mjs';

const FILES = Object.freeze({ containers, images, system, auth, volumes });

const entry = (verb) => (typeof verb === 'function' ? Object.freeze({ run: verb }) : verb);

/** Each module's verbs, as `{ flat }` or `{ run }` entries. */
export const GROUPS = Object.freeze(Object.fromEntries(Object.entries(FILES).map(([module, file]) =>
  [module, Object.freeze(Object.fromEntries(Object.entries(file.verbs).map(([name, verb]) => [name, entry(verb)])))])));

/** Top-level verbs that mean a group verb: `login` is `auth login`. */
export const TOP_LEVEL = Object.freeze(Object.fromEntries(Object.entries(FILES).flatMap(([module, file]) =>
  Object.entries(file.aliases ?? {}).map(([alias, name]) => [alias, Object.freeze([module, name])]))));

/** Docker's singular management commands: `image ls` is `images ls`, `container ls` is `containers ls` (#347). */
export const MODULE_ALIASES = Object.freeze({ container: 'containers', image: 'images', volume: 'volumes' });

/** The module a word names: itself, or the module its singular spelling names. */
export const moduleOf = (word) => (Object.hasOwn(MODULE_ALIASES, word) ? MODULE_ALIASES[word] : word);

/** The group verb `args` names, or null when `args` is not a group command. */
export function groupVerb(word, args) {
  const module = moduleOf(word);
  const verbs = Object.hasOwn(GROUPS, module) ? GROUPS[module] : null;
  const name = args[0];
  if (verbs === null || typeof name !== 'string' || !Object.hasOwn(verbs, name)) return null;
  return { module, name, verb: verbs[name] };
}

/** The usage lines of every group, in the layout of the flat verbs' lines. */
export function groupUsage() {
  const lines = [];
  for (const [module, verbs] of Object.entries(GROUPS)) {
    if (typeof FILES[module].help === 'string') {
      lines.push(FILES[module].help.replace(/\n$/, ''));
      continue;
    }
    const line = (head, summary) => lines.push(head.length < 52 ? `${head.padEnd(52)}${summary}` : `${head}\n${' '.repeat(52)}${summary}`);
    for (const [name, { usage, summary }] of Object.entries(verbs)) line(`  prism-code ${module} ${name}${usage ? ` ${usage}` : ''}`, summary);
    for (const [alias, name] of Object.entries(FILES[module].aliases ?? {})) line(`  prism-code ${alias} ...`, `the same as prism-code ${module} ${name}`);
  }
  return lines.join('\n');
}
