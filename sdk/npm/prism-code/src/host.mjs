/**
 * The host side of running the SDK image: which program runs Docker here, how
 * a host path is spelled inside a bind mount, and the cache volume a lockfile's
 * image gets.
 *
 * Three ways of reaching a Docker daemon are told apart:
 *
 *   native   `docker` (or `podman`) is an executable on the PATH, and a host
 *            path mounts as itself (Docker Desktop and Linux both accept it).
 *   wsl      Windows without Docker Desktop, where the daemon runs inside a
 *            WSL distribution. The command is `wsl.exe -d <distro> -- docker`,
 *            and a host path `C:\a\b` mounts as `/mnt/c/a/b`, because the
 *            daemon only sees the distribution's filesystem.
 *   missing  nothing answered.
 *
 * `resolveDocker` probes once, and `setup --local` writes the answer to
 * `$PRISM_HOME/config.json` so every later command spawns the right program
 * without probing. When no setup recorded it, the first command that runs the
 * image records it instead, with the cache volume on, so a local build keeps
 * the SDK's caches on disk whether or not setup was told `--local`. `PRISM_DOCKER` overrides both: a command line such as
 * `wsl.exe -d Ubuntu -- docker`, with `PRISM_DOCKER_MOUNT=wsl` when host
 * paths need the `/mnt/<drive>` spelling.
 *
 * Everything here is a pure function of its context, so the tests give it a
 * `find` and a `run` and never touch this machine.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { prismHome, which } from './agents.mjs';
import { fail } from './errors.mjs';
import { DELEGATED, MOUNT_STYLES, cacheVolumeName, commandDisplay, dockerArguments } from './docker.mjs';

export const HOST_CONFIG_SCHEMA = 'prism/host-config/1';
/** Split a command line on spaces, honouring double quotes, for `PRISM_DOCKER`. */
export function splitCommandLine(text) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (const m of text.matchAll(re)) out.push(m[1] ?? m[2]);
  return out;
}

const DAEMON_ARGS = ['version', '--format', '{{.Server.Version}}'];

function answers(run, command, args) {
  const result = run(command, args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? '').trim() || null;
}

/** WSL distributions, from `wsl.exe -l -q`, which prints UTF-16 with a NUL after every character. */
export function parseDistributions(stdout) {
  return String(stdout ?? '')
    .replace(/\0/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^docker-desktop/i.test(line));
}

/**
 * Find a Docker daemon. Returns `{ kind, command, args, mount, version, distro }`:
 * `command` and `args` are what to spawn before `run ...`, `mount` the mount style.
 * `kind` is `missing` with a `reason` when nothing answered.
 */
export function resolveDocker({ platform = process.platform, env = process.env, find, run = spawnSync } = {}) {
  const lookup = find ?? ((name) => which(name, { env, platform }));
  const override = env.PRISM_DOCKER;
  if (override) {
    const [command, ...args] = splitCommandLine(override);
    const mount = env.PRISM_DOCKER_MOUNT ?? (/\bwsl(\.exe)?$/i.test(command) ? 'wsl' : 'native');
    if (!MOUNT_STYLES.includes(mount)) fail('docker.mount', `PRISM_DOCKER_MOUNT must be one of ${MOUNT_STYLES.join(', ')}; got ${mount}`);
    const version = answers(run, command, [...args, ...DAEMON_ARGS]);
    if (!version) return { kind: 'missing', reason: `PRISM_DOCKER=${override} did not answer docker version` };
    return { kind: 'native', command, args, mount, version, distro: null, source: 'PRISM_DOCKER' };
  }
  for (const name of ['docker', 'podman']) {
    const file = lookup(name);
    if (!file) continue;
    const version = answers(run, file, DAEMON_ARGS);
    if (version) return { kind: 'native', command: file, args: [], mount: 'native', version, distro: null, source: 'PATH' };
  }
  if (platform === 'win32') {
    const wsl = lookup('wsl') ?? lookup('wsl.exe');
    if (wsl) {
      const listed = run(wsl, ['-l', '-q'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
      for (const distro of listed.error ? [] : parseDistributions(listed.stdout)) {
        const args = ['-d', distro, '--', 'docker'];
        const version = answers(run, wsl, [...args, ...DAEMON_ARGS]);
        if (version) return { kind: 'wsl', command: wsl, args, mount: 'wsl', version, distro, source: 'WSL' };
      }
      return { kind: 'missing', reason: 'docker is not on the PATH, and no WSL distribution answered docker version' };
    }
  }
  return { kind: 'missing', reason: 'docker is not on the PATH; prism-code check, build and verify run prismpm inside the SDK image' };
}

/** The host config `setup` wrote, or null. A missing or unreadable file is no config. */
export function readHostConfig(configDir) {
  try {
    const config = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'));
    const docker = config?.docker;
    if (!docker || typeof docker.command !== 'string' || !Array.isArray(docker.args) || !MOUNT_STYLES.includes(docker.mount)) return null;
    // The cache is on unless a config turns it off: Docker creates the volume on first mount, so a
    // record without `cache` (Docker found before any image was there) still keeps the caches on disk.
    return { command: docker.command, args: docker.args.map(String), mount: docker.mount, cache: config.cache !== false };
  } catch {
    return null;
  }
}

/** What `config.json` records about Docker, from a resolution. */
export function hostConfigEntry(resolved) {
  return { command: resolved.command, args: resolved.args, mount: resolved.mount };
}

/**
 * The Docker invocation every delegated command uses on this machine: the
 * config `setup` wrote, else a fresh resolution. Throws `docker.missing` when
 * there is none, with the reason.
 */
export function hostDocker({ configDir, env = process.env, platform = process.platform, run = spawnSync, find, probe = true, record = true } = {}) {
  const saved = env.PRISM_DOCKER ? null : readHostConfig(configDir);
  if (saved) return { ...saved, kind: saved.mount === 'wsl' ? 'wsl' : 'native', source: 'config' };
  // A dry run prints a command line; it assumes `docker` rather than probing the machine.
  if (!probe) return { kind: 'native', command: 'docker', args: [], mount: 'native', cache: false, source: 'default' };
  const resolved = resolveDocker({ platform, env, find, run });
  if (resolved.kind === 'missing') fail('docker.missing', resolved.reason);
  // Record what was found, as `setup --local` would: later runs then need no probe, and the cache
  // volume (Docker creates it on first mount) holds the SDK's 1.2 GB Cargo home on disk instead of
  // the 2 GB tmpfs. PRISM_DOCKER is an override for one environment and is never recorded.
  if (record && !env.PRISM_DOCKER && configDir && recordHostConfig(configDir, resolved)) return { ...resolved, cache: true, source: 'recorded' };
  return { ...resolved, cache: false };
}

/**
 * Merge the Docker resolution and `cache: true` into `config.json`, keeping every other key. Best
 * effort: a config that cannot be written leaves the run on the tmpfs, and returns false.
 */
export function recordHostConfig(configDir, resolved) {
  const path = join(configDir, 'config.json');
  let current = {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
  } catch {
    // A missing or unreadable config holds only what setup writes.
  }
  try {
    mkdirSync(configDir, { recursive: true });
    const temporary = `${path}.prism-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify({ ...current, docker: hostConfigEntry(resolved), cache: true }, null, 2)}\n`);
    renameSync(temporary, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the SDK image is on this machine already: false when Docker is
 * missing, does not answer, or has no such image. A dry run never probes and
 * says false.
 */
export function hostImagePresent({ image, env = process.env, run = spawnSync, docker = null } = {}) {
  if (env.PRISM_CODE_DRY_RUN) return false;
  let host = docker;
  try {
    host ??= hostDocker({ configDir: prismHome(env), env, run });
  } catch (error) {
    if (error.code === 'docker.missing') return false;
    throw error;
  }
  const result = run(host.command, [...host.args, 'image', 'inspect', '--format', '{{.Id}}', image], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  return !result.error && result.status === 0;
}

/**
 * The Docker invocation for one delegated command on this host: the program
 * `setup` recorded (or a fresh resolution), its arguments, and `run ...` with
 * this host's user, Docker socket group, mount style and cache volume.
 * Returns `{ command, args, display }`; `display` is the whole line for
 * `PRISM_CODE_DRY_RUN` and error messages.
 */
export function hostDockerArguments({ image, cwd, command, args = [], program = 'prismpm', env = process.env, docker = null, probe = !env.PRISM_CODE_DRY_RUN }) {
  const { build = false } = program === 'prismpm' ? (DELEGATED[command] ?? {}) : {};
  const host = docker ?? hostDocker({ configDir: prismHome(env), env, probe });
  let dockerSocketGid = null;
  let uid = null;
  let gid = null;
  if (process.platform !== 'win32') {
    ({ uid, gid } = userInfo());
    if (build) {
      try {
        dockerSocketGid = statSync('/var/run/docker.sock').gid;
      } catch {
        dockerSocketGid = null;
      }
    }
  }
  const cache = host.cache && env.PRISM_CODE_NO_CACHE !== '1' ? cacheVolumeName(image) : null;
  const runArgs = dockerArguments({ image, cwd, command, args, uid, gid, build, dockerSocketGid, program, cache, mount: host.mount });
  const all = [...host.args, ...runArgs];
  return { command: host.command, args: all, display: commandDisplay(host.command, all) };
}
