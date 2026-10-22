// SDK-owned bounded update transport; successful acquisition is not release
// qualification. The caller supplies commands from its verified SDK runtime.
import assert from 'node:assert/strict';
import {constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureMetadataLock} from './metadata-capture.mjs';
import {dockerCredentialProvider} from './metadata-credentials.mjs';
import {credentialHelperRunner} from './metadata-helper.mjs';
import {createRegistryTransport} from './metadata-transport.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;

export function verifiedCommands(path) {
  assert(typeof path === 'string' && path.startsWith('/') && realpathSync(path) === resolve(path), 'absolute unaliased SDK inventory required');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint:true});
    assert(before.isFile() && before.nlink === 1n && before.size > 0 && before.size <= 8n * 1024n * 1024n,
      'bounded single-link SDK command inventory required');
    const bytes = Buffer.alloc(Number(before.size)); let at = 0;
    while (at < bytes.length) {const count = readSync(fd,bytes,at,bytes.length-at,null); assert(count > 0); at += count;}
    assert(readSync(fd,Buffer.alloc(1),0,1,null) === 0, 'SDK command inventory grew');
    for (const after of [fstatSync(fd, {bigint:true}),lstatSync(path,{bigint:true})])
      for (const key of ['dev','ino','uid','gid','nlink','size','mode','mtimeNs','ctimeNs'])
        assert(after[key] === before[key], 'SDK command inventory descriptor or name changed');
    assert.equal(realpathSync(path),resolve(path),'SDK command inventory ancestry changed');
    const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes), value = JSON.parse(text);
    const encoded = JSON.stringify(canonical(value));
    assert(text === encoded || text === encoded + '\n', 'canonical SDK command inventory required');
    assert(value.schema === 'prismpm/sdk-inventory/1' && Array.isArray(value.commands), 'SDK command inventory schema differs');
    return value.commands;
  } finally {closeSync(fd);}
}

export async function captureSdkMetadata(reference, standards, commands) {
  const credentials = dockerCredentialProvider({runHelper:credentialHelperRunner(commands)});
  const lock = await captureMetadataLock(reference, standards, createRegistryTransport(reference, credentials));
  const bytes = Buffer.from(JSON.stringify(canonical(lock)));
  assert(bytes.length <= 64 * 1024 * 1024, 'SDK capture output exceeds bound');
  return bytes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert(process.argv.length === 5, 'metadata capture requires pinned image, standards digest and verified SDK inventory');
  const [reference, standards, inventory] = process.argv.slice(2);
  process.stdout.write(await captureSdkMetadata(reference, standards, verifiedCommands(inventory)));
}
