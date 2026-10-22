// SDK construction only. A manifest is input data, not an acceptance receipt.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chmodSync, closeSync, constants, fchmodSync, fstatSync, futimesSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, opendirSync, readlinkSync, readSync, realpathSync,
  renameSync, rmdirSync, unlinkSync, statfsSync, writeFileSync, writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compilerRevision, decodeExporterSeed, encodeInventory} from './inventory-metadata.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const order = (a, b) => Buffer.from(a).compare(Buffer.from(b));
const limit = Object.freeze({files: 32768, file: 1024 ** 3, total: 4 * 1024 ** 3});
const seedLimit = Object.freeze({files: 4096, file: 256 * 1024 ** 2, total: 512 * 1024 ** 2});
const sourceLimit = Object.freeze({files: 4096, file: 16 * 1024 ** 2, total: 16 * 1024 ** 2});
const identity = ['dev', 'ino', 'uid', 'gid', 'mode', 'size', 'nlink', 'mtimeNs', 'ctimeNs'];
function unchanged(before, after) {
  for (const key of identity) assert.equal(after[key], before[key], `compiler input changed: ${key}`);
}

// Stream hashes; never allocate an input-sized buffer. The same routine is
// used before and after construction, so a changed toolchain cannot be sealed.
export function snapshotFile(path, maximum = limit.file) {
  assert.equal(realpathSync(path), path, 'compiler file is aliased');
  const before = lstatSync(path, {bigint: true});
  assert(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum),
    'bounded singly-linked compiler file required');
  assert.equal(before.mode & 0o7000n, 0n, 'special compiler file permissions refused');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    unchanged(before, fstatSync(fd, {bigint: true}));
    const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    let length = 0;
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      length += count;
      assert(length <= maximum && BigInt(length) <= before.size, 'compiler file grew');
      hash.update(buffer.subarray(0, count));
    }
    assert.equal(BigInt(length), before.size, 'compiler file shortened');
    unchanged(before, fstatSync(fd, {bigint: true}));
    unchanged(before, lstatSync(path, {bigint: true}));
    assert.equal(realpathSync(path), path, 'compiler file ancestor changed');
    return {byte_length: length, mode: Number(before.mode & 0o777n), sha256: hash.digest('hex')};
  } finally { closeSync(fd); }
}

export function readSmall(path, maximum) {
  assert.equal(realpathSync(path), path, 'compiler file is aliased');
  const before = lstatSync(path, {bigint: true});
  assert(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum),
    'bounded singly-linked compiler file required');
  assert.equal(before.mode & 0o7000n, 0n, 'special compiler file permissions refused');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    // Bind the bytes to one descriptor and its original inode. Comparing only
    // hashes from separately reopened files accepts same-byte replacement.
    unchanged(before, fstatSync(fd, {bigint: true}));
    const bytes = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size <= maximum) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    assert(size <= maximum && BigInt(size) === before.size,
      'compiler configuration changed or exceeded bound');
    unchanged(before, fstatSync(fd, {bigint: true}));
    unchanged(before, lstatSync(path, {bigint: true}));
    assert.equal(realpathSync(path), path, 'compiler file ancestor changed');
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, size));
  } finally { closeSync(fd); }
}

export function boundedConstructionRoot(path) {
  assert.equal(realpathSync(path), path, 'construction root is aliased');
  const filesystem = statfsSync(path, {bigint: true});
  validateConstructionFilesystem(filesystem);
  return path;
}

export function validateConstructionFilesystem(filesystem) {
  assert.equal(filesystem.type, 0x01021994n, 'exporter construction requires a bounded tmpfs');
  assert(filesystem.blocks > 0n && filesystem.bsize > 0n
    && filesystem.blocks * filesystem.bsize <= 1024n ** 3n, 'exporter construction tmpfs must have a positive capacity at most 1 GiB');
}

// Symlinks are forbidden in seeds and sources. The upstream toolchain itself
// has declared relative library aliases; record those links and their confined
// targets rather than silently dereferencing or omitting them.
export function snapshotTree(root, {toolchainAliases = false, bounds = limit, custody} = {}) {
  assert.equal(realpathSync(root), root, 'compiler tree root is aliased');
  for (const key of ['files', 'file', 'total'])
    assert(Number.isSafeInteger(bounds[key]) && bounds[key] >= 0 && bounds[key] <= limit[key], 'bounded compiler inventory required');
  const rows = [];
  let total = 0;
  const pending = [{directory: root, prefix: '', before: lstatSync(root, {bigint: true})}];
  const directories = [];
  while (pending.length) {
    const {directory, prefix, before} = pending.pop();
    unchanged(before, lstatSync(directory, {bigint: true}));
    assert(before.isDirectory() && !before.isSymbolicLink(), 'regular compiler directory required');
    assert.equal(before.mode & 0o7000n, 0n, 'special compiler directory permissions refused');
    assert.equal(realpathSync(directory), directory, 'compiler ancestor is aliased');
    directories.push({directory, before});
    custody?.set(prefix, before);
    const stream = opendirSync(directory, {bufferSize: 1});
    try { for (let entry; (entry = stream.readSync()) !== null;) {
      const name = entry.name;
      assert(/^[A-Za-z0-9_.+-]+$/.test(name), 'noncanonical compiler entry');
      assert(rows.length < bounds.files, 'compiler entry count exceeded');
      const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(path, {bigint: true});
      if (stat.isDirectory()) {
        rows.push({path: relative, kind: 'directory', mode: Number(stat.mode & 0o777n)});
        pending.push({directory: path, prefix: relative, before: stat});
      } else if (stat.isSymbolicLink()) {
        assert(toolchainAliases, 'compiler seed/source alias refused');
        const target = readlinkSync(path);
        assert(!target.startsWith('/') && !target.split('/').includes('..'), 'unconfined toolchain alias');
        const resolved = realpathSync(path);
        assert(resolved.startsWith(root + sep) && lstatSync(resolved).isFile(), 'toolchain alias escapes closure');
        unchanged(stat, lstatSync(path, {bigint: true}));
        assert.equal(readlinkSync(path), target);
        rows.push({path: relative, kind: 'symlink', target, mode: Number(stat.mode & 0o777n)});
      } else {
        const row = snapshotFile(path, Math.min(bounds.file, bounds.total - total));
        if (custody) { unchanged(stat, lstatSync(path, {bigint: true})); custody.set(relative, stat); }
        total += row.byte_length;
        rows.push({path: relative, kind: 'file', ...row});
      }
    } } finally { stream.closeSync(); }
    unchanged(before, lstatSync(directory, {bigint: true}));
  }
  // Bind deferred directories to the identity observed by their parent and
  // recheck even already-visited directories before publishing the snapshot.
  for (const {directory, before} of directories) {
    unchanged(before, lstatSync(directory, {bigint: true}));
    assert.equal(realpathSync(directory), directory, 'compiler ancestor changed');
  }
  return rows.sort((a, b) => order(a.path, b.path));
}

// Construction custody only: separate source and seed allowances before
// comparing exact sources. No generated output is acceptance evidence here.
export function separateConstructionTrees(packageRoot, seedRoot, sources, custody, sourceCustody,
  originalPackage, originalStage) {
  const parent = originalStage ?? holdDirectory(dirname(seedRoot));
  const input = originalPackage ?? holdDirectory(packageRoot);
  let output;
  try {
    directoryIdentity(input.before, lstatSync(packageRoot, {bigint:true}));
    directoryIdentity(parent.before, lstatSync(parent.path, {bigint:true}));
    output = createHeldChild(parent, seedRoot.slice(parent.path.length+1));
    // Both endpoints are relative to original held directories. A concurrent
    // named-root substitution cannot redirect this move into foreign storage.
    renameSync(descriptorPath(input.fd,'.lake'), descriptorPath(output.fd,'.lake'));
    directoryIdentity(input.before, lstatSync(packageRoot, {bigint:true}));
    directoryIdentity(output.before, lstatSync(seedRoot, {bigint:true}));
    const observed = new Map();
    assert.deepEqual(snapshotTree(packageRoot, {bounds: sourceLimit, custody:observed}), sources,
      'exporter construction changed source/configuration');
    if (sourceCustody) {
      assert.deepEqual([...observed.keys()].sort(order),[...sourceCustody.keys()].sort(order));
      for(const [path,stat] of sourceCustody) {
        if(path==='') directoryIdentity(stat,observed.get(path));
        else unchanged(stat,observed.get(path));
      }
    }
    return snapshotTree(seedRoot, {bounds: seedLimit, custody});
  } finally {
    if(output)closeSync(output.fd);
    if(!originalPackage)closeSync(input.fd);
    if(!originalStage)closeSync(parent.fd);
  }
}

// Shared construction/admission copy: only authenticated or freshly measured
// manifest rows, never a recursive walk that can discover unbounded new input.
function directoryIdentity(before, after) {
  assert(after.isDirectory() && !after.isSymbolicLink(), 'seed directory identity changed');
  for (const key of ['dev', 'ino', 'uid', 'gid', 'mode'])
    assert.equal(after[key], before[key], `seed directory identity changed: ${key}`);
}

function nodeIdentity(before, after) {
  for (const key of ['dev', 'ino', 'uid', 'gid', 'mode'])
    assert.equal(after[key], before[key], `owned exporter node identity changed; cleanup refused: ${key}`);
}

// Remove only names whose original identities this invocation retained.
// rmdir never recursively adopts unknown children; ancestor FDs remain bound.
export function retireOwnedDirectory(root, nodes) {
  const parent = holdDirectory(dirname(root.path));
  try {
    directoryIdentity(root.before, lstatSync(root.path, {bigint:true}));
    directoryIdentity(root.before, fstatSync(root.fd, {bigint:true}));
    for (const [path, before] of [...nodes].filter(([path]) => path).sort((a,b) => order(b[0],a[0]))) {
      const held = heldParent(root, path, nodes);
      try {
        const named = descriptorPath(held.fd, held.name);
        nodeIdentity(before, lstatSync(named, {bigint:true}));
        if (before.isDirectory()) rmdirSync(named);
        else unlinkSync(named);
      } finally { closeSync(held.fd); }
    }
    directoryIdentity(root.before, lstatSync(root.path, {bigint:true}));
    directoryIdentity(parent.before, lstatSync(parent.path, {bigint:true}));
    rmdirSync(descriptorPath(parent.fd, root.path.slice(parent.path.length+1)));
  } finally { closeSync(parent.fd); }
}

export function holdDirectory(path, before = lstatSync(path, {bigint: true})) {
  assert.equal(realpathSync(path), path, 'seed directory is aliased');
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
  try { directoryIdentity(before, fstatSync(fd, {bigint: true})); }
  catch (error) { closeSync(fd); throw error; }
  return {path, before, fd};
}

export function createHeldChild(parent, name) {
  assert.match(name,/^[A-Za-z0-9_.+-]+$/,'one private child name required');
  directoryIdentity(parent.before,lstatSync(parent.path,{bigint:true}));
  const selected=descriptorPath(parent.fd,name);
  mkdirSync(selected,{mode:0o700});
  const before=lstatSync(selected,{bigint:true});
  const fd=openSync(selected,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_CLOEXEC);
  try {
    directoryIdentity(before,fstatSync(fd,{bigint:true}));
    directoryIdentity(parent.before,lstatSync(parent.path,{bigint:true}));
    directoryIdentity(before,lstatSync(join(parent.path,name),{bigint:true}));
    return {path:join(parent.path,name),before,fd};
  } catch(error) {closeSync(fd);throw error;}
}

const descriptorPath = (fd, name = '') => `/proc/self/fd/${fd}${name ? '/' + name : ''}`;

function heldParent(root, relative, created) {
  // This one procfs link is generated from our held FD, never caller data.
  // Every subsequent named ancestor is opened with O_NOFOLLOW.
  let fd = openSync(descriptorPath(root.fd), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_CLOEXEC);
  let prefix = '';
  try {
    directoryIdentity(root.before, fstatSync(fd, {bigint: true}));
    const parts = relative.split('/'), name = parts.pop();
    for (const part of parts) {
      prefix = prefix ? prefix + '/' + part : part;
      const path = descriptorPath(fd, part), observed = lstatSync(path, {bigint: true});
      if (created) directoryIdentity(created.get(prefix), observed);
      const next = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
      try { directoryIdentity(observed, fstatSync(next, {bigint: true})); }
      catch (error) { closeSync(next); throw error; }
      closeSync(fd); fd = next;
    }
    return {fd, name};
  } catch (error) { closeSync(fd); throw error; }
}

export function stageSeedFiles(seed, staging, manifest, {rootIdentity, custody = new Map()} = {}) {
  assert.equal(process.platform, 'linux', 'qualified seed copying requires Linux descriptor paths');
  decodeExporterSeed(Buffer.from(encodeInventory(manifest)));
  assert.equal(realpathSync(staging), staging);
  const directory = lstatSync(staging, {bigint: true});
  assert(directory.isDirectory() && directory.uid === BigInt(process.getuid()) && (directory.mode & 0o7777n) === 0o700n,
    'staging must be private and owned by the current process user');
  assert.deepEqual(snapshotTree(staging), [], 'exclusive empty staging required');
  const sourceRoot = holdDirectory(seed);
  let stageRoot;
  try { stageRoot = holdDirectory(staging, rootIdentity ?? directory); }
  catch (error) { closeSync(sourceRoot.fd); throw error; }
  const created = custody;
  created.set('', stageRoot.before);
  let total = 0;
  try { for (const row of manifest.files) {
    directoryIdentity(sourceRoot.before, lstatSync(seed, {bigint: true}));
    directoryIdentity(stageRoot.before, lstatSync(staging, {bigint: true}));
    const destination = join(staging, row.path);
    if (row.kind === 'directory') {
      const parent = heldParent(stageRoot, row.path, created);
      try {
        const path = descriptorPath(parent.fd, parent.name);
        mkdirSync(path, {mode: row.mode});
        const createdIdentity = lstatSync(path, {bigint: true});
        const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
        try {
          directoryIdentity(createdIdentity, fstatSync(fd, {bigint: true}));
          fchmodSync(fd, row.mode);
          const before = fstatSync(fd, {bigint: true});
          directoryIdentity(before, lstatSync(path, {bigint: true}));
          created.set(row.path, before);
        } finally { closeSync(fd); }
      } finally { closeSync(parent.fd); }
      continue;
    }
    assert.equal(row.kind, 'file');
    total += row.byte_length; assert(total <= 512 * 1024 ** 2, 'seed copy aggregate exceeded');
    const source = join(seed, row.path);
    const expected = {byte_length: row.byte_length, mode: row.mode, sha256: row.sha256};
    const custody = lstatSync(source, {bigint: true});
    const sameInput = after => {
      for (const key of ['dev', 'ino', 'uid', 'gid', 'mode', 'size', 'nlink', 'mtimeNs', 'ctimeNs'])
        assert.equal(after[key], custody[key], `seed input identity changed: ${key}`);
    };
    assert.deepEqual(snapshotFile(source, row.byte_length), expected, 'seed file changed before copying');
    const inputParent = heldParent(sourceRoot, row.path);
    let input;
    try { input = openSync(descriptorPath(inputParent.fd, inputParent.name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    finally { closeSync(inputParent.fd); }
    try {
      const before = fstatSync(input, {bigint: true});
      sameInput(before);
      assert(before.isFile() && before.nlink === 1n && before.size === BigInt(row.byte_length));
      const outputParent = heldParent(stageRoot, row.path, created);
      let output;
      try { output = openSync(descriptorPath(outputParent.fd, outputParent.name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, row.mode); }
      finally { closeSync(outputParent.fd); }
      try {
        const outputIdentity = fstatSync(output, {bigint:true});
        created.set(row.path, outputIdentity);
        const buffer = Buffer.alloc(64 * 1024), hash = createHash('sha256');
        let remaining = row.byte_length;
        while (remaining) {
          const count = readSync(input, buffer, 0, Math.min(remaining, buffer.length), null);
          assert(count > 0, 'seed file shortened while copying'); hash.update(buffer.subarray(0, count));
          for (let written = 0; written < count;) {
            const size = writeSync(output, buffer, written, count - written, null);
            assert(size > 0, 'seed copy made no progress'); written += size;
          }
          remaining -= count;
        }
        assert.equal(readSync(input, buffer, 0, 1, null), 0, 'seed file grew while copying');
        assert.equal(hash.digest('hex'), row.sha256, 'copied seed hash differs');
        sameInput(fstatSync(input, {bigint: true}));
        sameInput(lstatSync(source, {bigint: true}));
        assert.equal(realpathSync(source), source, 'seed input ancestor changed');
        fchmodSync(output, row.mode);
        futimesSync(output, Number(before.atimeNs) / 1e9, Number(before.mtimeNs) / 1e9);
        const actual = fstatSync(output, {bigint: true}), named = lstatSync(destination, {bigint: true});
        for (const key of ['dev','ino','uid','gid']) assert.equal(actual[key], outputIdentity[key], 'owned output identity changed');
        created.set(row.path, actual);
        for (const key of ['dev', 'ino', 'uid', 'gid', 'mode', 'size', 'nlink'])
          assert.equal(named[key], actual[key], `staged seed file identity changed: ${key}`);
      } finally { closeSync(output); }
    } finally { closeSync(input); }
    assert.deepEqual(snapshotFile(source, row.byte_length), expected, 'seed file changed during copying');
    assert.deepEqual(snapshotFile(destination, row.byte_length), expected, 'staged seed file changed');
  }
  directoryIdentity(sourceRoot.before, lstatSync(seed, {bigint: true}));
  directoryIdentity(stageRoot.before, lstatSync(staging, {bigint: true}));
  for (const [path, before] of created) nodeIdentity(before, lstatSync(join(staging, path), {bigint: true}));
  assert.deepEqual(snapshotTree(staging, {bounds: seedLimit}), manifest.files, 'staged exporter bytes differ');
  } finally { try { closeSync(stageRoot.fd); } finally { closeSync(sourceRoot.fd); } }
}

// Node exposes only replacing rename. Use the actual Linux/glibc no-replace
// primitive through isolated system Python, with no fallback on unsupported
// kernels/filesystems. https://man7.org/linux/man-pages/man2/rename.2.html
const noReplaceProgram = `import ctypes,json,os,stat,sys
source,destination,expected,expected_private,expected_value=json.loads(sys.argv[1])
assert sys.platform == 'linux'
parent=os.path.dirname(destination)
assert os.path.realpath(parent) == parent
flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
target_fd=os.open(parent,flags)
source_fd=None
def identity(value):
 return [value.st_dev,value.st_ino,value.st_uid,value.st_gid,value.st_mode]
try:
 target=os.fstat(target_fd)
 assert identity(target) == expected
 assert target.st_uid == os.getuid() and not target.st_mode & 0o7022
 private=os.path.dirname(source)
 assert os.path.realpath(private) == private
 source_fd=os.open(private,flags)
 owner=os.fstat(source_fd)
 assert identity(owner) == expected_private
 assert owner.st_uid == os.getuid() and stat.S_IMODE(owner.st_mode) == 0o700
 assert os.path.dirname(private) == parent
 value=os.stat(os.path.basename(source),dir_fd=source_fd,follow_symlinks=False)
 assert identity(value) == expected_value
 assert stat.S_ISDIR(value.st_mode) and value.st_uid == os.getuid() and stat.S_IMODE(value.st_mode) == 0o755
 function=ctypes.CDLL(None,use_errno=True).renameat2
 function.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
 function.restype=ctypes.c_int
 if function(source_fd,os.fsencode(os.path.basename(source)),target_fd,os.fsencode(os.path.basename(destination)),1) != 0:
  raise OSError(ctypes.get_errno(),'exclusive exporter publication failed')
 assert identity(os.fstat(target_fd)) == expected
 assert os.path.realpath(parent) == parent and identity(os.stat(parent,follow_symlinks=False)) == expected
 assert identity(os.stat(os.path.basename(destination),dir_fd=target_fd,follow_symlinks=False)) == identity(value)
 assert identity(os.fstat(source_fd)) == expected_private
 assert os.path.realpath(private) == private and identity(os.stat(private,follow_symlinks=False)) == expected_private
finally:
 if source_fd is not None: os.close(source_fd)
 os.close(target_fd)
`;

export function publishSeedFiles(seedRoot, destination, manifest) {
  assert.equal(realpathSync(dirname(destination)), dirname(destination));
  const parent = lstatSync(dirname(destination));
  assert(parent.isDirectory() && parent.uid === process.getuid() && (parent.mode & 0o7022) === 0,
    'exporter publication parent must be owned and not group/world writable');
  assert.equal(lstatSync(destination, {throwIfNoEntry: false}), undefined, 'cannot overwrite exporter seed');
  const encoded = encodeInventory(manifest);
  assert(Buffer.byteLength(encoded) <= 8 * 1024 * 1024, 'exporter manifest exceeded bound');
  const publication = mkdtempSync(join(dirname(destination), '.exporter-publication-'));
  const publicationIdentity = lstatSync(publication);
  const heldPublication = holdDirectory(publication, lstatSync(publication, {bigint:true}));
  const payloadNodes = new Map();
  let published = false;
  try {
    const payload = join(publication, 'seed');
    mkdirSync(descriptorPath(heldPublication.fd, 'seed'), {mode: 0o700});
    const payloadIdentity = lstatSync(descriptorPath(heldPublication.fd, 'seed'), {bigint:true});
    payloadNodes.set('',payloadIdentity);
    stageSeedFiles(seedRoot, payload, manifest, {rootIdentity: payloadIdentity, custody: payloadNodes});
    assert.deepEqual(snapshotTree(seedRoot, {bounds: seedLimit}), manifest.files, 'exporter seed changed during publication');
    const heldPayload = holdDirectory(payload, payloadIdentity);
    try {
      const fd = openSync(descriptorPath(heldPayload.fd,'manifest.json'),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o444);
      try {
        payloadNodes.set('manifest.json',fstatSync(fd,{bigint:true}));
        writeFileSync(fd,encoded); fchmodSync(fd,0o444);
        payloadNodes.set('manifest.json',fstatSync(fd,{bigint:true}));
      } finally {closeSync(fd);}
      // Only our held payload changes mode; ancestor substitution cannot
      // redirect this operation or the preceding manifest write.
      fchmodSync(heldPayload.fd,0o755);
      const readable = fstatSync(heldPayload.fd,{bigint:true});
      for (const key of ['dev','ino','uid','gid']) assert.equal(readable[key],payloadIdentity[key], 'owned payload identity changed');
      assert.equal(readable.mode & 0o7777n,0o755n);
      payloadNodes.set('',readable);
    } finally {closeSync(heldPayload.fd);}
    assert.equal(lstatSync(destination, {throwIfNoEntry: false}), undefined);
    const identity = stat => ['dev', 'ino', 'uid', 'gid', 'mode'].map(key => {
      assert(Number.isSafeInteger(stat[key]) && stat[key] >= 0); return stat[key];
    });
    const result = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', noReplaceProgram, JSON.stringify([
      payload, destination, identity(parent), identity(publicationIdentity), identity(lstatSync(payload)),
    ])], {env: {LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'}, encoding: 'utf8', timeout: 10000, maxBuffer: 8192});
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'exclusive exporter publication interrupted');
    assert.equal(result.status, 0, 'exclusive exporter publication refused');
    published = true;
  } finally {
    try {
      // A successful publication moved the sole owned payload out. Unknown
      // inserted descendants must make this empty-directory removal fail.
      // Failed copies retain only the identities captured at actual creation.
      // Unknown or substituted nodes refuse cleanup rather than being adopted.
      const nodes = published ? new Map() : new Map([...payloadNodes].map(([path,stat])=>[path?'seed/'+path:'seed',stat]));
      retireOwnedDirectory(heldPublication, nodes);
    } finally { closeSync(heldPublication.fd); }
  }
}

export function constructionEnvironment(environment, directory) {
  boundedConstructionRoot(directory);
  return {...environment, TMPDIR: directory};
}

export function createConstructionStage(root) {
  boundedConstructionRoot(root);
  const path = join(root, 'prismpm-exporter-construction');
  mkdirSync(path, {mode: 0o700});
  return {path, identity: lstatSync(path,{bigint:true})};
}

export function runConstruction(program, argv, cwd, environment, held) {
  if(held) {
    directoryIdentity(held.directory.before,lstatSync(held.directory.path,{bigint:true}));
    directoryIdentity(held.temporary.before,lstatSync(held.temporary.path,{bigint:true}));
    cwd='/proc/self/fd/3';
    environment={...environment,TMPDIR:'/proc/self/fd/4'};
  }
  const result = spawnSync('/usr/bin/timeout', ['--signal=TERM', '--kill-after=5s', '360s', program, ...argv],
    {cwd, env: environment, encoding: 'utf8', timeout: 370000, maxBuffer: 16 * 1024 * 1024,
      ...(held?{stdio:['ignore','pipe','pipe',held.directory.fd,held.temporary.fd]}:{})});
  assert.ifError(result.error);
  assert.equal(result.signal, null, 'exporter construction interrupted');
  assert.equal(result.status, 0, `exporter construction failed (${program} ${argv.join(' ')}): ${result.stderr}`);
  if(held) {
    directoryIdentity(held.directory.before,lstatSync(held.directory.path,{bigint:true}));
    directoryIdentity(held.temporary.before,lstatSync(held.temporary.path,{bigint:true}));
  }
  return {argv: [program, ...argv], environment, executable_sha256: snapshotFile(realpathSync(program)).sha256,
    exit_code: result.status, stdout: result.stdout, stderr: result.stderr};
}

export function runtimePaths(stdout) {
  if (stdout.trim() === 'statically linked') return [];
  const paths = [];
  for (const line of stdout.split('\n').filter(line => line.trim())) {
    if (/^\s*linux-vdso\.so\.1 \(0x[0-9a-f]+\)$/.test(line)) continue;
    const path = /(?:=>\s+|^\s*)(\/[^\s]+)\s+\(0x[0-9a-f]+\)$/.exec(line)?.[1];
    assert(path, 'unresolved or unrecognized compiler runtime dependency');
    paths.push(resolve(path));
  }
  assert(paths.length, 'empty runtime dependency observation');
  return paths;
}

// Private native construction classifier. gABI ELF64 header/program-header
// layouts: https://gabi.xinuos.com/elf/02-eheader.html and /07-pheader.html.
// Never infer static linkage from a failed ldd command or its error text.
export function elfRuntimeMode(fd, length, architecture = process.arch) {
  assert(Number.isSafeInteger(length) && length >= 0 && length <= limit.file, 'bounded ELF input required');
  const exact = (offset, size) => {
    assert(Number.isSafeInteger(offset) && offset >= 0 && offset + size <= length, 'truncated ELF structure');
    const bytes = Buffer.alloc(size); let count = 0;
    while (count < size) {
      const read = readSync(fd, bytes, count, size - count, offset + count);
      assert(read > 0, 'ELF input shortened'); count += read;
    }
    return bytes;
  };
  if (length < 4) return null;
  if (!exact(0, 4).equals(Buffer.from([127, 69, 76, 70]))) return null;
  const header = exact(0, 64), machine = {x64: 62, arm64: 183}[architecture];
  assert(machine, 'supported native ELF architecture required');
  assert.equal(header[4], 2, 'native ELF64 required');
  assert.equal(header[5], 1, 'native little-endian ELF required');
  assert.equal(header[6], 1, 'ELF identification version');
  assert([2, 3].includes(header.readUInt16LE(16)), 'executable ELF type required');
  assert.equal(header.readUInt16LE(18), machine, 'foreign ELF machine');
  assert.equal(header.readUInt32LE(20), 1, 'ELF header version');
  assert.equal(header.readUInt16LE(52), 64, 'ELF header size');
  assert.equal(header.readUInt16LE(54), 56, 'ELF program-header size');
  const count = header.readUInt16LE(56), offset = header.readBigUInt64LE(32);
  assert(count > 0 && count <= 4096, 'bounded explicit ELF program-header count required');
  assert(offset >= 64n && offset + BigInt(count * 56) <= BigInt(length), 'bounded ELF program-header table required');
  const table = exact(Number(offset), count * 56); let dynamic = false, load = false;
  for (let index = 0; index < count; index++) {
    const row = table.subarray(index * 56, (index + 1) * 56), type = row.readUInt32LE(0);
    if (type === 0) continue; // PT_NULL has no defined remaining fields.
    const start = row.readBigUInt64LE(8), size = row.readBigUInt64LE(32);
    assert(start + size <= BigInt(length), 'ELF segment outside file');
    assert.notEqual(type, 5, 'reserved ELF shared-library segment refused');
    if (type === 1) { load = true; assert(size <= row.readBigUInt64LE(40), 'ELF load segment exceeds memory'); }
    if (type === 2 || type === 3) dynamic = true;
  }
  assert(load, 'ELF executable requires a load segment');
  return dynamic ? 'dynamic' : 'static';
}

export function runtimeClosure(programs, toolchain, cwd, environment, observe = runConstruction) {
  const paths = new Map();
  for (const program of programs) {
    assert.equal(realpathSync(program), program, 'runtime program alias refused');
    const before = lstatSync(program, {bigint: true});
    assert(before.isFile() && before.nlink === 1n && before.size <= BigInt(limit.file), 'bounded runtime executable required');
    const fd = openSync(program, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      unchanged(before, fstatSync(fd, {bigint: true}));
      const mode = elfRuntimeMode(fd, Number(before.size));
      if (mode === 'dynamic') {
        const observation = observe('/usr/bin/ldd', [program], cwd, environment);
        for (const selected of runtimePaths(observation.stdout)) {
          const canonical = realpathSync(selected);
          if (canonical.startsWith(toolchain + sep)) continue;
          paths.set(selected, {selected, path: canonical, ...snapshotFile(canonical)});
        }
      }
      unchanged(before, fstatSync(fd, {bigint: true}));
      unchanged(before, lstatSync(program, {bigint: true}));
      assert.equal(realpathSync(program), program, 'runtime program ancestor changed');
    } finally { closeSync(fd); }
  }
  return [...paths.values()].sort((a, b) => order(a.selected, b.selected));
}

export function buildSeed(source, destination) {
  assert.equal(process.platform, 'linux');
  const architecture = {x64: 'amd64', arm64: 'arm64'}[process.arch];
  assert(architecture, 'native supported SDK platform required');
  assert.equal(realpathSync(source), source);
  assert.equal(lstatSync(destination, {throwIfNoEntry: false}), undefined, 'cannot overwrite exporter seed');
  assert.equal(realpathSync(dirname(destination)), dirname(destination));
  const constructionRoot = boundedConstructionRoot(realpathSync(tmpdir()));
  const dependencyPath = join(source, 'model/dependencies.toml');
  const dependency = readSmall(dependencyPath, 1024 * 1024);
  const revision = compilerRevision(dependency);
  const archive = join(source, 'vendor/lean4-prod/lean.tar');
  const archiveRow = snapshotFile(archive, 16 * 1024 * 1024);
  const records = dependency.split('[[dependency.artifact]]').slice(1).map(section => section.split('[[dependency]]')[0]);
  const matches = records.filter(section => /^path = "vendor\/lean4-prod\/lean.tar"$/m.test(section));
  assert.equal(matches.length, 1, 'one registered exporter archive required');
  assert.equal(/^sha256 = "([0-9a-f]{64})"$/m.exec(matches[0])?.[1], archiveRow.sha256);
  const toolchainName = readSmall(join(source, 'lean-toolchain'), 256).trim();
  assert.match(toolchainName, /^leanprover\/lean4:v[0-9]+\.[0-9]+\.[0-9]+$/);
  const toolchain = '/usr/local/elan/toolchains/' + toolchainName.replace('/', '--').replace(':', '---');
  const toolsBefore = snapshotTree(toolchain, {toolchainAliases: true});
  const environment = {PATH: `${toolchain}/bin:/usr/bin:/bin`, LANG: 'C', LC_ALL: 'C',
    ELAN_HOME: '/usr/local/elan', ELAN_TOOLCHAIN: toolchainName, LEAN_NUM_THREADS: '2', SOURCE_DATE_EPOCH: '0'};
  // Lake records absolute compiler paths in its traces. A fixed private path
  // inside each isolated SDK build makes those genuine traces reproducible.
  // Exclusive creation rejects collisions; existing state is never reused.
  const {path: staging, identity: owned} = createConstructionStage(constructionRoot);
  const heldStage = holdDirectory(staging, owned);
  const sourceCustody = new Map(), seedCustody = new Map();
  let heldPackage;
  let completed = false;
  try {
    const childEnvironment = constructionEnvironment(environment, staging);
    heldPackage = createHeldChild(heldStage,'package');
    sourceCustody.set('',heldPackage.before);
    const packageRoot = heldPackage.path;
    const held={directory:heldPackage,temporary:heldStage};
    const extraction = runConstruction('/usr/bin/tar', ['--extract', '--file', archive, '--directory', '/proc/self/fd/3'], source, childEnvironment,held);
    assert.deepEqual(snapshotFile(archive, 16 * 1024 * 1024), archiveRow);
    assert.equal(lstatSync(join(packageRoot, '.lake'), {throwIfNoEntry: false}), undefined);
    const sources = snapshotTree(packageRoot, {bounds: sourceLimit, custody: sourceCustody});
    const build = runConstruction(join(toolchain, 'bin/lake'), ['build', 'prod-export'], packageRoot, childEnvironment,held);
    const seedRoot = join(staging, 'seed');
    const files = separateConstructionTrees(packageRoot, seedRoot, sources, seedCustody,sourceCustody,heldPackage,heldStage);
    assert(files.some(row => row.path === '.lake/build/bin/prod-export' && row.kind === 'file' && (row.mode & 0o111)),
      'actual native exporter missing');
    assert.deepEqual(snapshotTree(toolchain, {toolchainAliases: true}), toolsBefore, 'toolchain changed during construction');
    const programs = toolsBefore.filter(row => row.kind === 'file' && row.path.startsWith('bin/') && (row.mode & 0o111))
      .map(row => join(toolchain, row.path));
    const runtime = runtimeClosure([...programs, join(seedRoot, '.lake/build/bin/prod-export')], toolchain, source, childEnvironment);
    assert.deepEqual(snapshotTree(toolchain, {toolchainAliases: true}), toolsBefore, 'toolchain changed during runtime inspection');
    const manifest = {schema: 'prismpm/exporter-seed/1', platform: `linux/${architecture}`,
      compiler_revision: revision, archive_sha256: archiveRow.sha256, toolchain: toolchainName,
      configuration: {argv: ['build', 'prod-export'], environment, construction_root: staging,
        temporary_directory: 'private-bounded-tmpfs'},
      source_files: sources, toolchain_files: toolsBefore, runtime_files: runtime, files};
    const encoded = encodeInventory(manifest);
    assert(Buffer.byteLength(encoded) <= 8 * 1024 * 1024, 'exporter manifest exceeded bound');
    // Snapshot/size checks precede the only persistent copy. An interrupted
    // copy never publishes the destination; raw process output stays separate
    // from the deterministic manifest and is not rewritten to invent a build.
    publishSeedFiles(seedRoot, destination, manifest);
    completed = true;
    return {manifest_sha256: sha(encoded), files: files.length, construction: {extraction, build}};
  } finally {
    try {
      if (completed || (heldPackage && sourceCustody.size===1 && seedCustody.size===0
          && snapshotTree(heldPackage.path,{bounds:sourceLimit}).length===0)) {
        assert.equal(heldStage.before.dev, BigInt(owned.dev));
        assert.equal(heldStage.before.ino, BigInt(owned.ino));
        const nodes = new Map([
          ...[...sourceCustody].map(([path, stat]) => [path ? 'package/'+path : 'package',stat]),
          ...[...seedCustody].map(([path, stat]) => [path ? 'seed/'+path : 'seed',stat]),
        ]);
        retireOwnedDirectory(heldStage, nodes);
      }
    } finally { if(heldPackage)closeSync(heldPackage.fd); closeSync(heldStage.fd); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, 'usage: exporter-seed.mjs SOURCE DESTINATION');
  process.stdout.write(encodeInventory(buildSeed(resolve(process.argv[2]), resolve(process.argv[3]))));
}
