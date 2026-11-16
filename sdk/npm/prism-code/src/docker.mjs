/**
 * Delegation of the compiling commands to the digest-pinned SDK image named by
 * the project's `prismpm.lock`. The invocation is the one
 * UOR-Foundation/template's `bootstrap.yml` uses, minus the Docker socket and
 * Buildx lines, which only `build` needs. Pure functions here; `bin/` spawns.
 *
 * Two things `setup` adds: the program that reaches the daemon (host.mjs, which
 * resolves it and builds the whole invocation),
 * which on Windows without Docker Desktop is `wsl.exe -d <distro> -- docker`
 * with host paths spelled `/mnt/<drive>/...`, and a cache volume per SDK
 * image, mounted at `/tmp` in place of the 2 GB in-memory tmpfs. The SDK seeds a
 * 1.2 GB Cargo home under `/tmp` on every run; in a tmpfs that copy competes with
 * the build for memory, and on disk it does not, and it is kept for the next run.
 * Measured on the chess example (WSL, 2026-11-05): a full verify took 814 s with
 * the tmpfs, 317 s on an empty volume and 284 s on a warm one.
 */
import { fail } from './errors.mjs';

/** The template's admission test for an immutable SDK image reference. */
export const SDK_IMAGE_PATTERN = /^[a-z0-9.-]+(:[0-9]{1,5})?\/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/;

export const CONTAINER_HOME = '/tmp/prismpm-home';
export const WINDOWS_WORKDIR = '/work';
/** The tmpfs every run gets when no cache volume is mounted. */
export const TMPFS = '/tmp:rw,exec,nosuid,size=2g';

export const MOUNT_STYLES = Object.freeze(['native', 'wsl']);

/** `C:\a\b` or `C:/a/b` as the WSL daemon sees it: `/mnt/c/a/b`. A path without a drive letter is left alone. */
export function wslMountPath(hostPath) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(hostPath);
  if (!m) return hostPath.replace(/\\/g, '/');
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

/** The host path as the daemon's bind mount source, by mount style. */
export function mountPath(hostPath, style) {
  if (style === 'wsl') return wslMountPath(hostPath);
  if (style === 'native') return hostPath;
  fail('docker.mount', `unknown mount style ${JSON.stringify(style)}; one of ${MOUNT_STYLES.join(', ')}`);
}

/** The cache volume for an SDK image: one per image digest, so two lockfiles never share a cache. */
export function cacheVolumeName(image) {
  const m = /@sha256:([0-9a-f]{64})$/.exec(image);
  if (!m) fail('lock.image', `not an immutable SDK image: ${image}`);
  return `prism-sdk-cache-${m[1].slice(0, 12)}`;
}

/** Read `sdk_image` from a `prismpm.lock` text and admit only an immutable reference. */
export function sdkImageFromLock(lockText) {
  let image;
  try {
    image = JSON.parse(lockText).sdk_image;
  } catch {
    const match = /"sdk_image"\s*:\s*"([^"]*)"/.exec(lockText);
    image = match ? match[1] : undefined;
  }
  if (typeof image !== 'string' || !SDK_IMAGE_PATTERN.test(image)) {
    fail('lock.image', 'prismpm.lock does not select an immutable SDK image', { image });
  }
  return image;
}

/**
 * Build the `docker run` argument list for one command in the SDK image.
 *
 * `cwd` is the project directory. On POSIX hosts it is mounted at the same
 * path so paths in diagnostics match the host; on Windows it is mounted at
 * `/work`. `uid`/`gid` are omitted when unknown (Windows). `program` is the
 * executable inside the image, `prismpm` unless a tier asks for `lexlean`.
 * `cache` names a volume to mount at `/tmp` instead of the tmpfs; `mount` is
 * the mount style of host.mjs, `native` unless the daemon lives in WSL.
 */
export function dockerArguments({
  image,
  cwd,
  command,
  args = [],
  uid = null,
  gid = null,
  platform = process.platform,
  build = false,
  dockerSocket = '/var/run/docker.sock',
  dockerSocketGid = null,
  program = 'prismpm',
  cache = null,
  mount = 'native',
  network = null,
}) {
  if (!SDK_IMAGE_PATTERN.test(image)) fail('lock.image', `not an immutable SDK image: ${image}`);
  const workdir = platform === 'win32' ? WINDOWS_WORKDIR : cwd;
  const out = ['run', '--rm'];
  if (network) out.push('--network', network);
  if (uid !== null && gid !== null && uid >= 0 && gid >= 0) out.push('--user', `${uid}:${gid}`);
  if (build && dockerSocketGid !== null) out.push('--group-add', String(dockerSocketGid));
  if (cache) out.push('--mount', `type=volume,source=${cache},target=/tmp`);
  else out.push('--tmpfs', TMPFS);
  out.push('--volume', `${mountPath(cwd, mount)}:${workdir}`);
  if (build) out.push('--volume', `${dockerSocket}:${dockerSocket}`);
  out.push('--workdir', workdir);
  out.push('--env', `HOME=${CONTAINER_HOME}`);
  out.push('--env', 'PRISMPM_EPHEMERAL_HOME=1');
  if (build) out.push('--env', `SDK_IMAGE=${image}`);
  out.push(image, program, command, ...args);
  return out;
}

/** The path of `cwd` inside the container, where `--workdir` points. */
export function containerWorkdir(cwd, platform = process.platform) {
  return platform === 'win32' ? WINDOWS_WORKDIR : cwd;
}

/** One line for a command and its arguments, quoting what has spaces. */
export function commandDisplay(command, args) {
  const name = /[\\/]/.test(command) ? command.split(/[\\/]/).pop() : command;
  return [name, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

/** Commands this CLI delegates to the image, and whether they need the Docker socket. */
export const DELEGATED = Object.freeze({
  check: { build: false },
  build: { build: true },
  verify: { build: true },
  conformance: { build: false },
  inspect: { build: false },
  'export-browser': { build: false },
  'lock': { build: false },
  'template': { build: false },
});
