/**
 * `prism-code auth login|logout` (#447), also spelled `prism-code login|logout`:
 * the CLI of `prism.auth`, storing where Docker would, so `docker`, `push` and
 * `pull` find the same credential.
 *
 * A password never comes from the command line, where every process and the
 * shell history can read it: it is piped to `--password-stdin` or typed at a
 * prompt that does not echo. Nothing this prints, on stdout, stderr or in an
 * error, holds it; `prism.auth` scrubs what the registry or a store says.
 *
 * `login` asks the registry first (`GET /v2/` with the credential, as `docker
 * login` does) and stores nothing it refuses.
 */
import { createAuth } from '../auth.mjs';
import { createRegistryClient } from '../oci-registry.mjs';
import { readArgs, UsageError, wrapVerbs } from './args.mjs';

export const help = `  prism-code auth login [<registry>] --username <name> [--password-stdin] [--json]
                                                    check a username and password with the registry (Docker Hub by
                                                    default), then store them where Docker would; the password is
                                                    read from stdin or a prompt, never from the command line
  prism-code auth logout [<registry>] [--json]      remove the registry's credential from every store that holds it
  prism-code login ...                              the same as prism-code auth login
  prism-code logout ...                             the same as prism-code auth logout
`;

/** The process's streams and environment, or a test's. */
export function context(io = {}) {
  const env = io.env ?? process.env;
  const checkCredential = io.checkCredential ?? ((registry, credential) => createRegistryClient({ registry, repository: '' }, { resolveCredentials: () => credential, fetch: io.fetch, timeoutMs: 30000 }).ping());
  return {
    stdout: io.stdout ?? process.stdout,
    stderr: io.stderr ?? process.stderr,
    stdin: io.stdin ?? process.stdin,
    env,
    auth: io.auth ?? createAuth({ env, checkCredential }),
  };
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const where = (store) => (store.kind === 'helper' ? `the docker-credential-${store.name} helper` : store.path);

/** All of stdin, without the one line ending `echo` adds. */
async function readStdin(stdin) {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

/** A line typed at the terminal; with `hidden`, nothing is echoed. Ctrl-C or Ctrl-D gives null. */
function prompt(io, question, hidden) {
  const { stdin, stderr } = io;
  stderr.write(question);
  return new Promise((done) => {
    let line = '';
    const raw = hidden && typeof stdin.setRawMode === 'function';
    if (raw) stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    const finish = (value) => {
      stdin.removeListener('data', onData);
      if (raw) stdin.setRawMode(false);
      stdin.pause();
      if (hidden) stderr.write('\n');
      done(value);
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') return finish(line);
        if (ch === '\u0003' || ch === '\u0004') return finish(null);
        if (ch === '\u007f' || ch === '\b') line = line.slice(0, -1);
        else line += ch;
      }
    };
    stdin.on('data', onData);
    stdin.resume();
  });
}

/** `-p` and `--password` are refused without quoting what follows them. */
const PASSWORD_ON_ARGV = /^(?:-p|--password)(?:=.*)?$|^-p.+/s;

async function login(argv, io) {
  if (argv.some((a) => PASSWORD_ON_ARGV.test(a))) {
    throw new UsageError('login takes no password on the command line, where other processes and the shell history can read it; pipe it to --password-stdin, or type it at the prompt');
  }
  const { positional, options } = readArgs(argv, { values: ['username'], flags: ['password-stdin', 'json'], short: { u: 'username' } });
  // A stray word may be a password typed in the wrong place, so it is counted and not quoted.
  if (positional.length > 1) throw new UsageError(`login takes at most one registry, and was given ${positional.length} words`);
  const tty = io.stdin.isTTY === true;
  let username = options.username;
  if (username === undefined) {
    if (!tty || options['password-stdin']) throw new UsageError('login takes --username <name>');
    username = await prompt(io, 'Username: ', false);
    if (username === null) return 130;
  }
  let password;
  if (options['password-stdin']) password = await readStdin(io.stdin);
  else if (tty) {
    password = await prompt(io, 'Password: ', true);
    if (password === null) return 130;
  } else throw new UsageError('login reads the password from --password-stdin, or from a prompt on a terminal');
  const result = await io.auth.login(positional.length === 1 ? { username, password, registry: positional[0] } : { username, password });
  password = null;
  if (options.json) io.stdout.write(json(result));
  else {
    if (result.store.kind === 'config') io.stderr.write(`warning: the credential is stored unencrypted in ${result.store.path}; configure a credential helper to keep it in the system's keychain\n`);
    io.stdout.write(`Login Succeeded: ${result.username} at ${result.registry}${result.verified ? '' : ' (not checked with the registry)'}, stored in ${where(result.store)}\n`);
  }
  return 0;
}

async function logout(argv, io) {
  const { positional, options } = readArgs(argv, { flags: ['json'] });
  if (positional.length > 1) throw new UsageError(`logout takes at most one registry, and was given ${positional.length} words`);
  const result = await io.auth.logout(positional.length === 1 ? { registry: positional[0] } : {});
  if (options.json) io.stdout.write(json(result));
  else io.stdout.write(result.removed ? `Removed the credential for ${result.registry}\n` : `Not logged in to ${result.registry}\n`);
  if (result.ambient && !options.json) io.stderr.write(`warning: ${result.ambient} still gives a token for ${result.registry}; unset it to log out completely\n`);
  return 0;
}

export const verbs = wrapVerbs({ login, logout }, context, help);

/** The top-level spellings, `prism-code login` and `prism-code logout`. */
export const aliases = Object.freeze({ login: 'login', logout: 'logout' });
