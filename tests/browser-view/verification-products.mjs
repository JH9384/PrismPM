// Preservation of actual generated products; never generation or acceptance by itself.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync} from 'node:fs';
import {join} from 'node:path';

// Cargo may hard-link a genuine release product to its deps output. Preserve
// that actual identity/count; do not apply single-link compiler-source admission.
function observeProduct(path) {
  assert.equal(realpathSync(path), path, 'unaliased generated product');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint:true});
    assert(before.isFile() && before.uid === BigInt(process.getuid())
      && before.nlink > 0n && before.size <= 256n * 1024n ** 2n, 'bounded owned regular generated product');
    const chunk = Buffer.alloc(65536), digest = createHash('sha256');
    for (let offset = 0; BigInt(offset) < before.size;) {
      const count = readSync(fd, chunk, 0, Math.min(chunk.length, Number(before.size) - offset), null);
      assert(count > 0, 'generated product shortened');
      digest.update(chunk.subarray(0, count)); offset += count;
    }
    assert.equal(readSync(fd, chunk, 0, 1, null), 0, 'generated product grew');
    for (const after of [fstatSync(fd, {bigint:true}), lstatSync(path, {bigint:true})])
      for (const key of ['dev','ino','uid','gid','mode','nlink','size','mtimeNs','ctimeNs'])
        assert.equal(after[key], before[key], 'stable generated product custody');
    assert.equal(realpathSync(path), path, 'generated product ancestry changed');
    return {stat:before, sha256:digest.digest('hex')};
  } finally {closeSync(fd);}
}

export function captureVerificationProducts(work, family) {
  assert(['effects', 'budget', 'operation-journal'].includes(family));
  assert.equal(realpathSync(work), work, 'unaliased verification workspace');
  const rows = [], directories = [];
  let bytes = 0;
  function regular(path) {
    assert.equal(realpathSync(path), path, 'unaliased generated product');
    const observed = observeProduct(path), stat = observed.stat;
    bytes += Number(stat.size);
    assert(bytes <= 512 * 1024 ** 2, 'bounded generated product closure');
    assert(rows.length < 8192, 'bounded generated product inventory');
    rows.push({path:path.slice(work.length + 1), sha256:observed.sha256,
      device:stat.dev.toString(), inode:stat.ino.toString(), uid:stat.uid.toString(),
      gid:stat.gid.toString(), mode:Number(stat.mode), links:stat.nlink.toString(),
      size:Number(stat.size), mtime:stat.mtimeNs.toString(), ctime:stat.ctimeNs.toString()});
  }
  function tree(path) {
    assert.equal(realpathSync(path), path, 'unaliased generated directory');
    const stat = lstatSync(path);
    assert(stat.isDirectory(), 'actual generated directory required');
    assert.equal(stat.uid, process.getuid(), 'owned generated directory');
    assert.equal(stat.mode & 0o022, 0, 'generated directory cannot be group/other writable');
    directories.push({path:path.slice(work.length + 1), device:stat.dev, inode:stat.ino,
      uid:stat.uid, gid:stat.gid, mode:stat.mode});
    assert(directories.length <= 8192, 'bounded generated directory inventory');
    for (const name of readdirSync(path).sort()) {
      // Cargo targets are reconstructible cache. Their actual Wasm/native
      // products are selected separately below, not omitted from preservation.
      if (name === 'target') continue;
      const child = join(path, name), value = lstatSync(child);
      assert(!value.isSymbolicLink(), 'generated products cannot be aliases');
      if (value.isDirectory()) tree(child); else {assert(value.isFile()); regular(child);}
    }
  }
  for (const name of ['project', 'lean', 'export', 'generated', 'runner']) tree(join(work, name));
  if (family === 'operation-journal') tree(join(work, 'generated-b'));
  const guests = readdirSync(work).filter(name => name.startsWith('guest-')).sort();
  assert.equal(guests.length, family === 'effects' ? 3 : family === 'budget' ? 2 : 7);
  for (const name of guests) {
    tree(join(work, name));
    const release = join(work, name, 'target/wasm32-unknown-unknown/release');
    const outputs = readdirSync(release).filter(path => path.endsWith('.wasm')).sort();
    assert.equal(outputs.length, 1, 'one actual generated guest product');
    regular(join(release, outputs[0]));
  }
  regular(join(work, 'native-target/release/browser-' + family + '-runner'));
  return {directories:directories.sort((a, b) => a.path.localeCompare(b.path)),
    files:rows.sort((a, b) => a.path.localeCompare(b.path))};
}
