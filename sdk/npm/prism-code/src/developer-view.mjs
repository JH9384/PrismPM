/**
 * The developer view of #346 on the prism-code surface (#347).
 *
 * The glossary is declared once, as the LexLean model
 * `bindings/src/Foundation/Views/V1/Developer.lex.tex`. This package's surface is
 * written to `developer-surface.json`; `test/developer-view.test.mjs` keeps that
 * file equal to the CLI help and the client, and `cargo xtask check-developer-view`
 * checks it against the model, which also renders `docs/developer-glossary.md`.
 *
 * Renamed verbs and flags keep a deprecated alias for one minor release. The
 * aliases are declared in the model too, and the check refuses this table when
 * the two differ.
 */

export const SURFACE_SCHEMA = 'prism-code/developer-surface/1';

/** The deprecated aliases, the model's `developerAliases`. */
export const ALIASES = Object.freeze([
  Object.freeze({ kind: 'verb', name: 'history', target: 'record', removal: '0.9.0' }),
  Object.freeze({ kind: 'flag', name: 'holo', target: 'image', removal: '0.9.0' }),
]);

/** Namespaces whose members are new with Prism, or are the model's errors, and keep their canonical names (#346). */
const CANONICAL_MEMBERS = Object.freeze(['errors', 'verify']);

const spelled = (alias, name) => (alias.kind === 'flag' ? `--${name}` : name);

/** The one warning an alias prints: it names the new term. */
export function aliasWarning(alias) {
  return `prism-code: ${spelled(alias, alias.name)} is deprecated and is removed in prism-code ${alias.removal}; use ${spelled(alias, alias.target)}`;
}

/**
 * The arguments with each deprecated alias replaced by its new term. `warn`
 * receives one warning for each alias used. The verb is the first argument, and
 * nothing after `--` is read. Flags are renamed only for a verb `ownsFlags`
 * accepts: a verb prism-code hands to prismpm or a plugin keeps that tool's flags.
 */
export function resolveAliases(argv, warn, ownsFlags = () => true) {
  const used = new Set();
  const replace = (alias) => {
    if (!used.has(alias)) {
      used.add(alias);
      warn(aliasWarning(alias));
    }
    return alias.target;
  };
  const out = [];
  let flags = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      out.push(...argv.slice(i));
      break;
    }
    const verb = i === 0 ? ALIASES.find((a) => a.kind === 'verb' && a.name === arg) : undefined;
    if (verb) {
      out.push(replace(verb));
      continue;
    }
    if (i === 0) flags = ownsFlags(arg);
    if (flags && arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
      const flag = ALIASES.find((a) => a.kind === 'flag' && a.name === name);
      if (flag) {
        out.push(`--${replace(flag)}${eq > 0 ? arg.slice(eq) : ''}`);
        continue;
      }
    }
    out.push(arg);
  }
  return out;
}

const sorted = (values) => [...new Set(values)].sort();

function members(value, place, out) {
  for (const key of Object.keys(value).sort()) {
    const member = value[key];
    if (typeof member === 'function') out.push({ kind: 'method', place: `${place}.${key}`, name: key });
    else if (member !== null && typeof member === 'object') {
      out.push({ kind: 'namespace', place: `${place}.${key}`, name: key });
      if (!CANONICAL_MEMBERS.includes(key) || place !== 'prism') members(member, `${place}.${key}`, out);
    }
  }
  return out;
}

/**
 * The developer surface: the verbs and flags the CLI help names, the client's
 * namespaces and methods, and the deprecated aliases, as `developer-surface.json`
 * holds it.
 */
export function developerSurface({ usage, client, delegated = [], groups = [], moduleAliases = [] }) {
  // A module group's line, `prism-code <module> <verb>`, names the verb; the module is a namespace (#441).
  const lines = [...usage.matchAll(/^ {2}prism-code ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/gm)];
  const grouped = lines.filter((m) => groups.includes(m[1]) && m[2] !== undefined);
  const verbs = sorted([...lines.filter((m) => !grouped.includes(m)).map((m) => m[1]), ...delegated]);
  const groupVerbs = sorted(grouped.map((m) => `${m[1]} ${m[2]}`));
  const flags = sorted([...usage.matchAll(/(?<![\w-])--([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
  return {
    schema: SURFACE_SCHEMA,
    names: [
      ...verbs.map((name) => ({ kind: 'verb', place: `prism-code ${name}`, name })),
      ...groupVerbs.map((place) => ({ kind: 'verb', place: `prism-code ${place}`, name: place.split(' ')[1] })),
      ...flags.map((name) => ({ kind: 'flag', place: `--${name}`, name })),
      // Docker's singular spelling of a module group, `prism-code image ls` (#347).
      ...sorted(moduleAliases).map((name) => ({ kind: 'namespace', place: `prism-code ${name}`, name })),
      ...members(client, 'prism', []),
    ],
    aliases: ALIASES.map((alias) => ({ ...alias })),
  };
}
