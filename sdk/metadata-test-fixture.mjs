import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {label, limits, paths, profile, sha} from './metadata-layer.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const encode = value => Buffer.from(JSON.stringify(canonical(value)) + '\n');
const media = 'application/vnd.oci.image.';

// All fixture inventories are synthetic. No mocked transport response counts
// as actual SDK image materialization or acceptance evidence.
export function fixture(t, mutation = '', options = {}) {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-metadata-capture-'));
  t.after(() => rmSync(work, {recursive:true, force:true}));
  const blobs = new Map(), manifests = [], inventories = new Map(), lowerDigests = [];
  const put = (bytes, mediaType) => {
    const digest = sha(bytes); blobs.set(digest, bytes); return {digest, size:bytes.length, mediaType};
  };
  const standards = options.standards ?? Buffer.from('synthetic test standards\n');
  for (const architecture of ['amd64', 'arm64']) {
    const root = join(work, architecture); mkdirSync(root);
    for (const dir of ['opt', 'opt/prismpm', 'opt/prismpm/share']) mkdirSync(join(root, dir), {mode:0o755});
    const artifacts = ['adapter','base-image','binary','crate','dependency-lock','oracle','schema','test-corpus','trust-root','workflow']
      .map(kind => ({id:'test-' + kind, kind, version:'test', digest:sha(architecture + kind)}));
    if (mutation === 'identities' && architecture === 'arm64') artifacts[0].version = 'different';
    const inventory = options.inventories?.get(architecture) ?? encode({schema:'prismpm/sdk-inventory/1', artifacts,
      commands:['cargo','devcontainer','docker','just','prismpm'].map(command =>
        ({command, executable:'/usr/local/bin/' + command, sha256:sha(architecture + command).slice(7)}))});
    inventories.set(architecture, inventory);
    writeFileSync(join(root, paths.inventory), inventory, {mode:0o444});
    writeFileSync(join(root, paths.standards), mutation === 'standards' && architecture === 'arm64' ? 'different' : standards, {mode:0o444});
    const result = spawnSync('/usr/bin/tar', ['--format=ustar','--owner=0','--group=0','--mtime=@0','--no-recursion','-cf','-',
      'opt/','opt/prismpm/','opt/prismpm/share/',paths.inventory,paths.standards], {cwd:root, timeout:10000, maxBuffer:1024 * 1024});
    assert.ifError(result.error); assert.equal(result.status, 0);
    const lower = put(Buffer.from('never fetched lower layer ' + architecture), media + 'layer.v1.tar');
    lowerDigests.push(lower.digest);
    const terminal = put(result.stdout, media + 'layer.v1.tar');
    const config = {architecture, os:'linux', config:{Labels:{[label]:profile}}, rootfs:{type:'layers', diff_ids:[lower.digest, terminal.digest]}};
    if (mutation === 'legacy') delete config.config.Labels[label];
    if (mutation === 'platform' && architecture === 'arm64') config.architecture = 'amd64';
    if (mutation === 'diffid') config.rootfs.diff_ids[1] = sha('other');
    const manifest = put(encode({schemaVersion:2, mediaType:media + 'manifest.v1+json',
      config:put(encode(config), media + 'config.v1+json'), layers:[lower, terminal]}), media + 'manifest.v1+json');
    manifests.push({...manifest, platform:{os:'linux', architecture}});
  }
  const index = encode({schemaVersion:2, mediaType:media + 'index.v1+json', manifests});
  const reference = (options.repository ?? 'example.invalid/test-sdk') + '@' + put(index, media + 'index.v1+json').digest;
  const calls = [];
  const transport = async request => {
    calls.push(request);
    assert(['manifest','blob'].includes(request.kind));
    assert(request.timeout_ms > 0 && request.timeout_ms <= 45000);
    assert(request.maximum > 0 && request.maximum <= limits.compressed);
    const bytes = blobs.get(request.reference.split('@')[1]); assert(bytes, 'only exact selected graph blobs');
    assert(!lowerDigests.includes(request.reference.split('@')[1]), 'ordinary filesystem layers must never be fetched');
    return bytes;
  };
  return {reference, standards, inventories, index, calls, transport, blobs, lowerDigests};
}
