/**
 * The `dev` verb (issue #288): watch the project, rebuild and re-check on every
 * change, and serve the local studio.
 *
 *   dev [<dir>] [--port <n>] [--no-open] [--policy <file>] [--build <command>] [--holo <path>]
 *
 * Exit codes: 0 stopped with Ctrl-C, 2 refused (not a project, a bad manifest,
 * the port in use), 64 usage. A build or a check that fails while it runs is
 * shown in the studio and does not stop it.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { createDevLoop, createWatcher, describeProject, judgeHolo, runBuild, watchedPath, watchPatterns } from './dev.mjs';
import { readReplay } from './dev-replay.mjs';
import { STUDIO_PORT, serveStudio } from './dev-server.mjs';
import { fail } from './errors.mjs';
import { POLICIES } from './vendor/verify.mjs';

export const DEV_USAGE = `Usage: dev [<dir>] [--port <n>] [--no-open] [--policy <file>] [--build <command>] [--holo <path>]

  <dir>               the project directory; default the current directory
  --port <n>          the studio's port; default ${STUDIO_PORT}. A port in use is an error, not a move
  --no-open           do not open the studio in a browser
  --policy <file>     the policy the Check tab judges by, a file or a shipped name, as for check; an edit to a file re-checks
  --build <command>   the build to run, in a shell; default [model].build of prism.toml, then prism-code build --update,
                      which rewrites the model's pins in prismpm.lock
  --holo <path>       the file the build writes; default the one the build reports
`;

const VALUE_OPTIONS = ['port', 'policy', 'build', 'holo'];

function parse(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (VALUE_OPTIONS.includes(key)) {
        // The next flag is not this option's value: `--policy --no-open` is a missing value.
        if (eq > 0) options[key] = a.slice(eq + 1);
        else if (argv[i + 1]?.startsWith('--')) options[key] = '';
        else options[key] = argv[++i];
      }
      else if (key === 'no-open' || key === 'help') options[key] = true;
      else return { error: `dev has no option ${a}` };
    } else positional.push(a);
  }
  for (const key of VALUE_OPTIONS) if (Object.hasOwn(options, key) && (typeof options[key] !== 'string' || options[key] === '')) return { error: `--${key} takes a value` };
  if (positional.length > 1) return { error: 'dev takes at most one project directory' };
  if (options.port !== undefined && !(/^\d+$/.test(options.port) && Number(options.port) <= 65535)) return { error: '--port must be 0..65535' };
  return { positional, options };
}

/** The build a project asks for: the flag, then the manifest. Null means this package's own `build`, which `prism build` also spells. */
export function buildCommand(flag, manifest) {
  const command = flag ?? manifest?.model?.build ?? null;
  if (command === null || /^prism(?:-code)?\s+build\s*$/.test(command)) return null;
  return command;
}

function openBrowser(url) {
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  // No opener is no failure: the address is already on the terminal.
  child.on('error', () => {});
  child.unref();
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** One entry of the terminal for one finished cycle. */
export function formatCycle(state, name) {
  const { cycle, result } = state;
  const took = cycle.editToVerdictMs === null ? '' : `  edit to verdict ${seconds(cycle.editToVerdictMs)}`;
  const built = cycle.build ? `Built ${name} in ${seconds(cycle.build.ms)}` : `Checked ${name}`;
  if (result.outcome === 'build-failed') return `Build failed (exit ${result.code ?? 'none'})${took}\n${result.log.trimEnd()}\n`;
  if (result.outcome === 'no-verdict') return `${built}  No verdict: ${result.check}: ${result.message}${took}\n`;
  const { verdict } = result;
  return `${built}  Level: ${verdict.level}  ${verdict.passed ? 'PASSED' : 'FAILED'}, policy ${verdict.policy.name} requires ${verdict.policy.minimum}${took}\n`;
}

export async function runDev(argv) {
  const parsed = parse(argv);
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n\n${DEV_USAGE}`);
    return 64;
  }
  const { positional, options } = parsed;
  if (options.help) {
    process.stdout.write(DEV_USAGE);
    return 0;
  }
  const directory = resolve(positional[0] ?? '.');
  if (!(await stat(directory).catch(() => null))?.isDirectory()) fail('dev.path', `${directory} is not a directory`);
  const project = await describeProject(directory);
  if (!project.isProject && options.build === undefined) fail('dev.project', `${directory} has no prism.toml or prismpm.toml, so there is nothing to build; run prism-code init, or pass --build <command>`);

  const name = project.name ?? 'application';
  const port = Number(options.port ?? STUDIO_PORT);
  const command = buildCommand(options.build, project.manifest);
  const holoPath = options.holo === undefined ? null : resolve(directory, options.holo);
  const patterns = watchPatterns(project.manifest);
  // The policy reaches check as given, so the verdict names it as check does. A shipped policy's name is no file to watch.
  const policyKey = options.policy === undefined || Object.hasOwn(POLICIES, options.policy) ? null : watchedPath(directory, resolve(options.policy));

  let child = null;
  let studio = null;
  const loop = createDevLoop({
    build: () => runBuild({
      directory,
      command,
      holo: holoPath,
      buildRoot: project.buildRoot,
      onSpawn: (spawned) => {
        child = spawned;
      },
    }),
    judge: (holo) => judgeHolo({ directory, holo, policy: options.policy, hasManifest: project.hasManifest }),
    replay: ({ holo, verdict }) => readReplay({ holo, directory, verdict }),
    initial: { project: { name, directory, watch: patterns, build: command ?? 'prism-code build --update', policy: options.policy ?? null } },
    onState: (state) => {
      studio?.publish(state);
      if (state.phase === 'building') process.stdout.write(state.cycle.files.length > 0 ? `Changed ${state.cycle.files.join(', ')}; rebuilding\n` : 'Building\n');
      if (state.phase === 'idle' && state.cycle) process.stdout.write(formatCycle(state, name));
    },
  });

  studio = await serveStudio({ getState: () => loop.state, getHolo: () => loop.holoBytes, port });
  const watcher = await createWatcher({
    root: directory,
    patterns,
    extra: policyKey === null ? [] : [policyKey],
    exclude: holoPath === null ? [] : [watchedPath(directory, holoPath)],
    onChange: ({ files, editedAt }) => {
      // An edit to the policy changes the judgement and not the holo, so it needs no build.
      const rebuild = files.some((file) => file !== policyKey);
      loop.trigger({ reason: rebuild ? 'change' : 'policy', files, editedAt, rebuild });
    },
    onError: (error) => process.stderr.write(`warning: dev.watch: ${error.message}; polling for changes instead\n`),
  });

  process.stdout.write(`Watching ${patterns.join(', ')}\n`);
  process.stdout.write(`Studio at ${studio.url}  tabs: Check, Replay\n`);
  if (command === null) process.stdout.write('Building with --update: prismpm.lock follows the model, so commit it with your source\n');
  if (!options['no-open'] && !process.env.CI) openBrowser(studio.url);
  const first = loop.trigger({ reason: 'start' });

  await new Promise((done) => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, done);
  });
  watcher.close();
  child?.kill();
  await studio.close();
  await Promise.race([first, new Promise((done) => setTimeout(done, 500))]);
  return 0;
}
