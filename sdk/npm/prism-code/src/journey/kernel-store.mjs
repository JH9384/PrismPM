/**
 * Where Lean's kernel, its loader, the lemma library and the rule judge's holo
 * are kept: not in the package, which stays small, but fetched once and kept
 * under `$PRISM_HOME/kernel/<commit>/`.
 *
 * Each file is named by the SHA-256 of its bytes at one commit of
 * UOR-Foundation/foundry. A file is used only when its bytes have that
 * address, whether it was just fetched or read from disk, so neither the
 * network nor the disk is trusted. The request names no app and carries
 * nothing of the user's: it is a GET of four public files.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prismHome } from '../agents.mjs';

export const KERNEL_REPOSITORY = 'UOR-Foundation/foundry';
export const KERNEL_COMMIT = '7755331b8d1cba879d89a1956c0703b749868abd';
/** The files, by the name they are kept under: where each lives in the repository, and the address of its bytes there. */
export const KERNEL_FILES = Object.freeze({
  'lean-kernel.mjs.gz': { path: 'studio/shell/kernel/lean/lean-kernel.mjs.gz', sha256: '8c77e3250d8c124d8f07fca9d9cc508475a062f72e9778208cd8aed3eab39cb9', bytes: 17609 },
  'lean-kernel.wasm.gz': { path: 'studio/shell/kernel/lean/lean-kernel.wasm.gz', sha256: '79accfb403771f7a362e17ed777bb1e84c19cb34e24ae537a919c980e6a833f2', bytes: 420987 },
  'library.ndjson.gz': { path: 'studio/shell/kernel/lean/library.ndjson.gz', sha256: '0253aaa8f557ca95b072ab8dc06ac84c4f95e076eb458dead7d27c0f7afb6434', bytes: 1246498 },
  'kernel.holo': { path: 'studio/shell/kernel/kernel.holo', sha256: 'e775324ea3abf203d3f7cb0b5a31e2c6c2328d751fdddf5fa1c46aae4e0d8cee', bytes: 657131 },
});
const RAW_URL = 'https://raw.githubusercontent.com';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The kernel's files are not on this machine and could not be fetched. `code` is `kernel.unavailable`: it says nothing about an app. */
export class KernelMissing extends Error {
  constructor(message) {
    super(message);
    this.name = 'KernelMissing';
    this.code = 'kernel.unavailable';
  }
}

/** The directory the files are kept in. `PRISM_KERNEL_DIR` names another, for a machine that carries them itself. */
export const kernelDirectory = (env = process.env) => env.PRISM_KERNEL_DIR || join(prismHome(env), 'kernel', KERNEL_COMMIT);

/** One kept file, checked against its address. Throws `KernelMissing` when it is absent or is not the pinned bytes. */
export function readKernelFile(name, { env = process.env } = {}) {
  const want = KERNEL_FILES[name];
  if (!want) throw new Error(`${name} is not a pinned kernel file`);
  const file = join(kernelDirectory(env), name);
  if (!existsSync(file)) throw new KernelMissing(`${name} is not on this machine yet`);
  const bytes = readFileSync(file);
  if (sha256(bytes) !== want.sha256) throw new KernelMissing(`${file} is not the pinned ${name}`);
  return bytes;
}

/** Whether every file is on this machine with its pinned bytes. */
export function hasKernel({ env = process.env } = {}) {
  try {
    for (const name of Object.keys(KERNEL_FILES)) readKernelFile(name, { env });
    return true;
  } catch {
    return false;
  }
}

/**
 * Make sure every file is on this machine, fetching what is missing. A fetched
 * file is written only when its bytes have the pinned address. Resolves the
 * names that were fetched; throws `KernelMissing` when one could not be.
 */
export async function ensureKernel({ env = process.env, fetch = globalThis.fetch, log = () => {} } = {}) {
  const directory = kernelDirectory(env);
  const fetched = [];
  for (const [name, want] of Object.entries(KERNEL_FILES)) {
    try {
      readKernelFile(name, { env });
      continue;
    } catch (error) {
      if (!(error instanceof KernelMissing)) throw error;
    }
    if (fetched.length === 0) log(`Fetching Lean's kernel once (about 2.3 MB) from github.com/${KERNEL_REPOSITORY}; each file is checked against its SHA-256. Nothing about the app is sent.`);
    const url = `${RAW_URL}/${KERNEL_REPOSITORY}/${KERNEL_COMMIT}/${want.path}`;
    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new KernelMissing(`${url} did not answer: ${error.cause?.code ?? error.message}`);
    }
    if (!response.ok) throw new KernelMissing(`${url} answered HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const got = sha256(bytes);
    if (got !== want.sha256) throw new KernelMissing(`${url} has SHA-256 ${got}, not the pinned ${want.sha256}`);
    mkdirSync(directory, { recursive: true });
    // Written beside its name and moved into place, so a reader never sees half a file.
    const partial = join(directory, `${name}.${process.pid}.partial`);
    writeFileSync(partial, bytes);
    renameSync(partial, join(directory, name));
    fetched.push(name);
  }
  return fetched;
}
