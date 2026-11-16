/**
 * The argument reader of the `prism-code <module> <verb>` groups. Each verb names
 * the options it takes; anything else is a usage error. A value is never quoted
 * back, because a secret typed in the wrong place must not be printed.
 */

/** A mistake in how a verb was called: printed with the verb's usage, exit 64. */
export class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @param {{ values?: string[], flags?: string[], short?: Record<string, string>, repeat?: string[] }} spec
 * @returns {{ positional: string[], options: Record<string, string | string[] | true> }}
 */
export function readArgs(argv, { values = [], flags = [], short = {}, repeat = [] } = {}) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    let name;
    let value;
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) value = a.slice(eq + 1);
    } else if (/^-[A-Za-z]$/.test(a)) {
      name = short[a[1]];
      if (name === undefined) throw new UsageError(`no option ${a}`);
    } else {
      positional.push(a);
      continue;
    }
    if (values.includes(name)) {
      if (value === undefined) value = argv[++i];
      if (typeof value !== 'string' || value === '') throw new UsageError(`--${name} takes a value`);
      if (repeat.includes(name)) (options[name] ??= []).push(value);
      else options[name] = value;
    } else if (flags.includes(name) && value === undefined) options[name] = true;
    else throw new UsageError(flags.includes(name) ? `--${name} takes no value` : `no option --${name}`);
  }
  return { positional, options };
}

/**
 * Each verb as the dispatcher calls it, `async (argv, io) => exitCode`: `io` is
 * filled in by `context`, and a usage error prints the group's help and exits 64.
 */
export function wrapVerbs(verbs, context, help) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(verbs).map(([name, verb]) => [
        name,
        async (argv = [], io = {}) => {
          const ctx = context(io);
          try {
            return await verb(argv, ctx);
          } catch (error) {
            if (!(error instanceof UsageError)) throw error;
            ctx.stderr.write(`${error.message}\n\n${help}`);
            return 64;
          }
        },
      ]),
    ),
  );
}
