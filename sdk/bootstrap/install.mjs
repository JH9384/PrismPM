import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { machine, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkedFile,
  LOCK,
  platformMode,
  RUNTIME,
  verifyRuntime,
} from './runner.mjs';

// curl exit statuses that indicate a transient network condition: resolve (6),
// connect (7), partial transfer (18), timeout (28), TLS connect (35), empty
// reply (52), send (55), receive (56). HTTP failures require a separately
// captured transient response code; integrity failures are never retried.
export const TRANSIENT_CURL_STATUS = new Set([6, 7, 18, 28, 35, 52, 55, 56]);
const TRANSIENT_HTTP_STATUS = new Set(['408', '429', '500', '502', '503', '504']);

function transientDownload(error) {
  return TRANSIENT_CURL_STATUS.has(error?.status) ||
    (error?.status === 22 && TRANSIENT_HTTP_STATUS.has(error.stdout?.toString()));
}

// snapshot.debian.org answers bursts of parallel CI builds with 503 for longer
// than a few seconds (rehearsals 41872713783 and 42070834717). Six attempts
// with a 10 s doubling backoff wait at most 10+20+40+80+160 s = 310 s in total;
// every attempt keeps its own time, size and digest limits.
export const DOWNLOAD_ATTEMPTS = 6;
export const DOWNLOAD_DELAY_MS = 10000;

const pause = (milliseconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

// Run one download at most `attempts` times with doubling backoff, retrying
// only transient transport or HTTP failures. Retrying never relaxes verification: the
// caller checks the digest of whatever the successful attempt produced.
export function withTransientRetry(
  download,
  { attempts = DOWNLOAD_ATTEMPTS, delay = DOWNLOAD_DELAY_MS, sleep = pause } = {},
) {
  assert(
    Number.isInteger(attempts) && attempts >= 1,
    'attempts must be a positive integer',
  );
  for (let attempt = 1; ; attempt++) {
    try {
      return download();
    } catch (error) {
      if (attempt >= attempts || !transientDownload(error))
        throw error;
      process.stderr.write(
        `download failed with curl status ${error.status}` +
          (error.status === 22 ? ` (HTTP ${error.stdout})` : '') +
          `; retry ${attempt}/${attempts - 1}\n`,
      );
      sleep(delay * 2 ** (attempt - 1));
    }
  }
}

export function publishRuntime(stage, destination) {
  const identity = lstatSync(stage, { bigint: true });
  assert(identity.isDirectory(), 'bootstrap stage must be a directory');
  assert(
    !lstatSync(destination, { throwIfNoEntry: false }),
    'bootstrap runtime destination already exists',
  );
  // Unlike renameSync, GNU mv -n -T never replaces an existing destination,
  // including a late-created empty directory. Coreutils before 9.2 exits 0
  // when it declines; 9.2 and later exit 1. Both leave the stage in place, so
  // the stage's presence, not the exit status, decides a refusal.
  let declined = null;
  try {
    execFileSync(
      '/usr/bin/mv',
      ['--no-clobber', '--no-target-directory', '--', stage, destination],
      { timeout: 10000, stdio: 'inherit' },
    );
  } catch (error) {
    declined = error;
  }
  assert(
    !lstatSync(stage, { throwIfNoEntry: false }),
    'bootstrap runtime destination already exists; publication refused',
  );
  if (declined) throw declined;
  const published = lstatSync(destination, { bigint: true });
  assert(
    published.isDirectory() &&
      published.dev === identity.dev &&
      published.ino === identity.ino,
    'bootstrap publication identity mismatch',
  );
}

// Extract verified packages only; never install maintainer scripts or binfmt.
export function installRuntime(destination = RUNTIME, cache = null) {
  platformMode(process.platform, process.arch, machine());
  assert(
    !lstatSync(destination, { throwIfNoEntry: false }),
    'bootstrap runtime already exists',
  );
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const packages = { ...LOCK.packages, qemu: LOCK.qemu[arch] };
  const work = mkdtempSync(join(tmpdir(), 'prismpm-bootstrap-install.'));
  mkdirSync(dirname(destination), { recursive: true });
  const stage = mkdtempSync(join(dirname(destination), '.bootstrap-stage.'));
  let installed = false;
  try {
    for (const [name, authority] of Object.entries(packages)) {
      const archive = join(work, `${name}.deb`);
      if (cache)
        copyFileSync(
          join(cache, basename(new URL(authority.url).pathname)),
          archive,
        );
      else
        withTransientRetry(() =>
          execFileSync(
            'curl',
            [
              '--disable',
              '--proto',
              '=https',
              '--proto-redir',
              '=https',
              '--tlsv1.2',
              '--fail',
              '--location',
              '--silent',
              '--show-error',
              '--write-out',
              '%{http_code}',
              '--max-time',
              '300',
              '--max-filesize',
              '67108864',
              authority.url,
              '--output',
              archive,
            ],
            { timeout: 310000, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1024 },
          ),
        );
      checkedFile(archive, authority.sha256);
      const unpacked = join(work, name);
      execFileSync('dpkg-deb', ['--extract', archive, unpacked], {
        timeout: 60000,
        stdio: 'inherit',
      });
      const rows = [...LOCK.libraries, ...LOCK.licenses].filter(
        (row) => row.package === name,
      );
      if (name === 'qemu')
        rows.push({
          member: 'usr/bin/qemu-x86_64-static',
          path: 'qemu-x86_64-static',
          sha256: authority.binary_sha256,
        });
      for (const row of rows) {
        const source = join(unpacked, row.member),
          target = join(stage, row.path);
        checkedFile(source, row.sha256);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
        chmodSync(target, row.path.startsWith('licenses/') ? 0o444 : 0o555);
      }
      rmSync(unpacked, { recursive: true });
      rmSync(archive);
    }
    copyFileSync(
      new URL('./runtime.lock.json', import.meta.url),
      join(stage, 'runtime.lock.json'),
    );
    chmodSync(join(stage, 'runtime.lock.json'), 0o444);
    // Explicit traversal permissions survive restrictive builder umasks and the
    // final image's unprivileged user; parent directories outside stage are untouched.
    for (const row of [...LOCK.libraries, ...LOCK.licenses]) {
      for (
        let directory = dirname(join(stage, row.path));
        directory !== dirname(stage);
        directory = dirname(directory)
      )
        chmodSync(directory, 0o755);
    }
    verifyRuntime(stage, arch);
    for (const [path, needed, elfMachine, interpreters] of [
      ['qemu-x86_64-static', [], arch === 'arm64' ? 183 : 62, []],
      ['sysroot/lib64/ld-linux-x86-64.so.2', [], 62, []],
      [
        'sysroot/lib/x86_64-linux-gnu/libc.so.6',
        ['ld-linux-x86-64.so.2'],
        62,
        ['/lib64/ld-linux-x86-64.so.2'],
      ],
      ['sysroot/lib/x86_64-linux-gnu/libgcc_s.so.1', ['libc.so.6'], 62, []],
    ]) {
      const file = join(stage, path),
        header = readFileSync(file).subarray(0, 20);
      assert.equal(header.subarray(0, 6).toString('hex'), '7f454c460201');
      assert.equal(header.readUInt16LE(18), elfMachine);
      const dynamic = execFileSync('readelf', ['--dynamic', file], {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, LC_ALL: 'C' },
      });
      assert(!/\((?:RPATH|RUNPATH)\)/.test(dynamic));
      assert.deepEqual(
        [...dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)]
          .map((match) => match[1])
          .sort(),
        needed.sort(),
        `complete ELF closure: ${path}`,
      );
      const headers = execFileSync('readelf', ['--program-headers', file], {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, LC_ALL: 'C' },
      });
      assert.deepEqual(
        [...headers.matchAll(/Requesting program interpreter: ([^\]]+)/g)].map(
          (match) => match[1],
        ),
        interpreters,
        `closed ELF interpreter: ${path}`,
      );
    }
    chmodSync(stage, 0o755);
    publishRuntime(stage, destination);
    installed = true;
    console.log(
      `Installed hash-verified historical-only runtime for ${arch}; no binfmt registration.`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
    if (!installed) rmSync(stage, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert(
    process.argv.length === 2 ||
      (process.argv.length === 4 && process.argv[2] === '--cache'),
    'usage: install.mjs [--cache DIRECTORY]',
  );
  installRuntime(
    RUNTIME,
    process.argv.length === 4 ? resolve(process.argv[3]) : null,
  );
}
